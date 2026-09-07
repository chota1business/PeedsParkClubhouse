-- Pool-scoped staff access and atomic booking-enquiry creation/conversion.
alter table public.staff drop constraint staff_role_check;
alter table public.staff add constraint staff_role_check check (role in ('admin','manager','pool_manager'));

-- Existing all-site policies/RPCs must not silently include the scoped role.
create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where id = auth.uid() and active and role in ('admin','manager'));
$$;
create or replace function private.can_manage_facility(p_facility text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where id = auth.uid() and active
    and (role in ('admin','manager') or (role = 'pool_manager' and p_facility = 'pool')));
$$;
revoke all on function private.can_manage_facility(text) from public, anon;
grant execute on function private.can_manage_facility(text) to authenticated;

create policy pool_manager_hourly_select on public.hourly_bookings for select to authenticated
  using (facility_id = 'pool' and private.can_manage_facility(facility_id));
create policy pool_manager_hourly_update on public.hourly_bookings for update to authenticated
  using (facility_id = 'pool' and private.can_manage_facility(facility_id))
  with check (facility_id = 'pool' and private.can_manage_facility(facility_id));
create policy pool_manager_enquiries_select on public.enquiries for select to authenticated
  using (facility_id = 'pool' and private.can_manage_facility(facility_id));
create policy pool_manager_enquiries_update on public.enquiries for update to authenticated
  using (facility_id = 'pool' and private.can_manage_facility(facility_id))
  with check (facility_id = 'pool' and private.can_manage_facility(facility_id));
create policy pool_manager_audit_insert on public.audit_log for insert to authenticated
  with check (actor_id = auth.uid() and private.current_staff_role() = 'pool_manager'
    and table_name in ('hourly_bookings','enquiries'));

create or replace function public.staff_create_hourly_booking(
  p_customer_name text, p_phone text, p_facility_id text, p_booking_date date,
  p_start_time time, p_end_time time, p_guests integer default 1, p_mode text default null,
  p_email text default null, p_mark_approved boolean default false)
returns table(booking_code text) language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if auth.uid() is null or not private.can_manage_facility(p_facility_id) then raise exception 'Not authorised'; end if;
  insert into hourly_bookings(customer_name,phone,email,facility_id,booking_date,start_time,end_time,guests,mode,booking_source,created_by,status)
  values(p_customer_name,p_phone,p_email,p_facility_id,p_booking_date,p_start_time,p_end_time,p_guests,p_mode,'staff',auth.uid(),case when p_mark_approved then 'approved' else 'pending' end)
  returning hourly_bookings.booking_code into v_code;
  return query select v_code;
end;
$$;
revoke all on function public.staff_create_hourly_booking(text,text,text,date,time,time,integer,text,text,boolean) from public, anon;
grant execute on function public.staff_create_hourly_booking(text,text,text,date,time,time,integer,text,text,boolean) to authenticated;

-- One transaction: create, link, approve/payment and convert the enquiry.
create or replace function public.staff_save_booking_enquiry(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_facility text := p_data->>'facility_id';
  v_enquiry_id uuid := nullif(p_data->>'enquiry_id','')::uuid;
  v_enquiry public.enquiries%rowtype;
  v_phone text := trim(p_data->>'phone');
  v_name text := trim(p_data->>'customer_name');
  v_date date := (p_data->>'booking_date')::date;
  v_start time := nullif(p_data->>'start_time','')::time;
  v_end time := nullif(p_data->>'end_time','')::time;
  v_guests integer := coalesce((p_data->>'guests')::integer, 1);
  v_approved boolean := coalesce((p_data->>'mark_approved')::boolean, false);
  v_total numeric := (p_data->>'total_amount')::numeric;
  v_paid numeric := (p_data->>'amount_paid')::numeric;
  v_payment text;
  v_code text;
  v_id uuid;
  v_table text;
  v_fac public.facilities%rowtype;
begin
  if auth.uid() is null or not private.can_manage_facility(v_facility) then raise exception 'Not authorised'; end if;
  select * into v_fac from public.facilities where id = v_facility and active;
  if not found or v_facility not in ('ac_hall','non_ac_hall','lawn','pool','badminton_1','badminton_2') then raise exception 'Choose an active facility'; end if;
  if v_date is null or v_date < (now() at time zone 'Asia/Kolkata')::date then raise exception 'Choose today or a future date'; end if;
  if coalesce(length(v_name),0) < 2 then raise exception 'Enter the customer name'; end if;
  if v_guests < 1 then raise exception 'Guests must be at least one'; end if;
  if v_enquiry_id is not null then
    select * into v_enquiry from public.enquiries where id = v_enquiry_id for update;
    if not found or not private.can_manage_facility(v_enquiry.facility_id) then raise exception 'Not authorised for this enquiry'; end if;
    if v_enquiry.status = 'converted'
       or exists(select 1 from public.booking_requests where enquiry_id=v_enquiry_id)
       or exists(select 1 from public.hourly_bookings where enquiry_id=v_enquiry_id)
    then raise exception 'This enquiry already has a booking'; end if;
    v_phone := v_enquiry.phone;
  end if;
  if v_phone is null or v_phone !~ '^[0-9]{10}$' then raise exception 'Enter a valid 10-digit mobile number'; end if;
  if v_approved then
    if v_total is null or v_paid is null or v_total < 0 or v_paid < 0 or v_paid > v_total then raise exception 'Enter valid payment amounts'; end if;
    v_payment := case when v_paid >= v_total then 'received' when v_paid > 0 then 'partial' else 'unpaid' end;
  else v_total := null; v_paid := 0; v_payment := 'unpaid'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_facility || ':' || v_date::text,0));
  if v_facility in ('ac_hall','non_ac_hall','lawn') then
    if p_data->>'slot' is null or p_data->>'slot' not in ('morning','evening','full_day') then raise exception 'Choose a slot'; end if;
    select b.booking_code into v_code from public.staff_create_booking_request(
      v_name,v_phone,v_facility,v_date,p_data->>'slot',nullif(p_data->>'email',''),v_guests,nullif(p_data->>'notes',''),false) b;
    update public.booking_requests set enquiry_id=v_enquiry_id, status=case when v_approved then 'approved' else 'pending' end,
      total_amount=v_total,amount_paid=v_paid,payment_status=v_payment,
      approved_at=case when v_approved then now() end, approved_by=case when v_approved then auth.uid() end
      where booking_code=v_code returning id into v_id;
    v_table := 'booking_requests';
  else
    if v_start is null or v_end is null or v_end <= v_start then raise exception 'Choose a valid time range'; end if;
    if v_start < v_fac.open_time or v_end > v_fac.close_time then raise exception 'Choose a time within facility opening hours'; end if;
    if v_facility = 'pool' and (p_data->>'mode' is null or p_data->>'mode' not in ('shared','exclusive')) then raise exception 'Choose a booking mode'; end if;
    select b.booking_code into v_code from public.staff_create_hourly_booking(v_name,v_phone,v_facility,v_date,v_start,v_end,
      case when v_facility='pool' then v_guests else 1 end,
      case when v_facility='pool' then p_data->>'mode' else null end,nullif(p_data->>'email',''),false) b;
    update public.hourly_bookings set enquiry_id=v_enquiry_id, status=case when v_approved then 'approved' else 'pending' end,
      total_amount=v_total,amount_paid=v_paid,payment_status=v_payment,
      approved_at=case when v_approved then now() end, approved_by=case when v_approved then auth.uid() end
      where booking_code=v_code returning id into v_id;
    v_table := 'hourly_bookings';
  end if;
  if v_enquiry_id is not null then
    update public.enquiries set customer_name=v_name,email=nullif(p_data->>'email',''),facility_id=v_facility,
      preferred_date=v_date,guests=v_guests,message=nullif(p_data->>'notes',''),status='converted',updated_at=now()
      where id=v_enquiry_id;
  end if;
  insert into public.audit_log(actor_id,action,table_name,record_id,details)
    values(auth.uid(),case when v_enquiry_id is null then 'staff_create_booking_enquiry' else 'convert_enquiry_to_booking' end,
      v_table,v_id,jsonb_build_object('booking_code',v_code,'enquiry_id',v_enquiry_id));
  return jsonb_build_object('booking_code',v_code,'id',v_id);
end;
$$;
revoke all on function public.staff_save_booking_enquiry(jsonb) from public, anon;
grant execute on function public.staff_save_booking_enquiry(jsonb) to authenticated;
