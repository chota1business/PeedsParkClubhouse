begin;
insert into auth.users(id,email) values ('00000000-0000-4000-a000-000000009071','test-pool-scope@example.invalid');
insert into public.staff(id,full_name,role,active) values ('00000000-0000-4000-a000-000000009071','Temporary permission test','pool_manager',true);
insert into public.enquiries(id,customer_name,phone,facility_id,preferred_date,guests,message)
values ('00000000-0000-4000-a000-000000009072','Permission test','9000009071','pool','2099-09-07',1,'Original'),
('00000000-0000-4000-a000-000000009073','Permission test','9000009072','ac_hall','2099-09-07',1,'Other facility');
select set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000009071',true);
set local role authenticated;
do $$
declare v_result jsonb; v_count integer; v_denied boolean; v_payload jsonb;
begin
  if private.is_staff() then raise exception 'Pool manager received full staff access'; end if;
  if not private.can_manage_facility('pool') or private.can_manage_facility('ac_hall') then raise exception 'Incorrect facility scope'; end if;
  if exists(select 1 from public.enquiries where facility_id is distinct from 'pool') then raise exception 'Other enquiries exposed'; end if;
  if exists(select 1 from public.hourly_bookings where facility_id is distinct from 'pool') then raise exception 'Other bookings exposed'; end if;
  if exists(select 1 from public.booking_requests) or exists(select 1 from public.expenses) or exists(select 1 from public.customers) then raise exception 'Unrelated records exposed'; end if;
  if exists(select 1 from public.manager_activity_feed where facility_id is distinct from 'pool') then raise exception 'View bypassed scope'; end if;
  update public.enquiries set message='Permitted edit' where id='00000000-0000-4000-a000-000000009072';
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'Pool edit was blocked'; end if;
  update public.enquiries set message='Forbidden edit' where id='00000000-0000-4000-a000-000000009073';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'Other facility edit succeeded'; end if;
  v_denied := false;
  begin
    update public.enquiries set facility_id='ac_hall' where id='00000000-0000-4000-a000-000000009072';
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'Facility reassignment allowed'; end if;
  v_denied := false;
  begin perform public.get_dashboard_facility_counts(); exception when others then v_denied := true; end;
  if not v_denied then raise exception 'All-site RPC allowed'; end if;
  v_payload := jsonb_build_object('enquiry_id','00000000-0000-4000-a000-000000009072','customer_name','Edited name','phone','9000009071',
    'facility_id','pool','booking_date','2099-09-07','start_time','10:00','end_time','11:00','guests',1,'mode','shared','notes','Edited notes',
    'mark_approved',true,'total_amount',100,'amount_paid',100);
  v_denied := false;
  begin perform public.staff_save_booking_enquiry(v_payload || '{"facility_id":"badminton_1"}'::jsonb); exception when others then v_denied := true; end;
  if not v_denied then raise exception 'Other facility RPC allowed'; end if;
  v_denied := false;
  begin perform public.staff_save_booking_enquiry(v_payload || '{"amount_paid":200}'::jsonb); exception when others then v_denied := true; end;
  if not v_denied then raise exception 'Invalid payment accepted'; end if;
  if exists(select 1 from public.hourly_bookings where enquiry_id='00000000-0000-4000-a000-000000009072') then raise exception 'Failed conversion left a booking'; end if;
  if not exists(select 1 from public.enquiries where id='00000000-0000-4000-a000-000000009072' and status='new') then raise exception 'Failed conversion changed enquiry status'; end if;
  v_result := public.staff_save_booking_enquiry(v_payload);
  if not exists(select 1 from public.hourly_bookings where id=(v_result->>'id')::uuid and enquiry_id='00000000-0000-4000-a000-000000009072' and status='approved' and amount_paid=100) then raise exception 'Conversion not linked with payment'; end if;
  if not exists(select 1 from public.enquiries where id='00000000-0000-4000-a000-000000009072' and status='converted' and customer_name='Edited name' and message='Edited notes') then raise exception 'Enquiry edits lost'; end if;
  v_denied := false;
  begin perform public.staff_save_booking_enquiry(v_payload); exception when others then v_denied := true; end;
  if not v_denied then raise exception 'Duplicate conversion allowed'; end if;
  v_denied := false;
  begin insert into public.expenses(expense_date,category,amount,description,facility_id,created_by) values(current_date,'other',1,'Forbidden','ac_hall',auth.uid()); exception when insufficient_privilege then v_denied:=true; end;
  if not v_denied then raise exception 'Pool manager allowed other facility expenses'; end if;
end;
$$;
reset role;
update public.staff set active=false where id='00000000-0000-4000-a000-000000009071';
set local role authenticated;
do $$ begin
  if private.can_manage_facility('pool') then raise exception 'Inactive pool account retained access'; end if;
  if exists(select 1 from public.enquiries) then raise exception 'Inactive account retained rows'; end if;
end $$;
reset role;
update public.staff set active=true,role='manager' where id='00000000-0000-4000-a000-000000009071';
set local role authenticated;
do $$ declare result jsonb; begin
  if not private.is_staff() or not private.can_manage_facility('ac_hall') then raise exception 'Existing manager scope broken'; end if;
  result := public.staff_save_booking_enquiry('{"customer_name":"Hall test","phone":"9000009073","facility_id":"ac_hall","booking_date":"2099-09-08","slot":"morning","guests":10,"mark_approved":true,"total_amount":1000,"amount_paid":500}'::jsonb);
  if not exists(select 1 from public.booking_requests where id=(result->>'id')::uuid and status='approved' and payment_status='partial' and amount_paid=500) then raise exception 'Hall creation/payment failed'; end if;
end $$;
reset role;
rollback;
select 'Pool scope, RLS, conversion/payment, duplicate prevention, inactive staff and existing manager checks passed; fixtures rolled back.' as result;
