-- Restored from the applied production migration history; no customer data.
-- Phase 12: Manager operations — unified enquiry+booking feed, staff-entered
-- (phone) bookings, and a running-costs expense log. No changes to the
-- existing enquiries/booking_requests/hourly_bookings tables' meaning —
-- see claude/db-login-migration-plan.md for why they stay separate.

-- 1. Exempt authenticated staff from the phone-based rate limit. It exists
--    to stop a bot/customer from spamming the public forms; a manager
--    keying in a real phone call for a customer who happens to have
--    already submitted 3 times online in the last 30 minutes should never
--    be blocked by it.
create or replace function public.check_submission_rate_limit()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  recent_count int;
begin
  if private.is_staff() then
    return new;
  end if;

  execute format(
    'select count(*) from %I where phone = $1 and created_at > now() - interval ''30 minutes''',
    TG_TABLE_NAME
  ) into recent_count using new.phone;

  if recent_count >= 3 then
    raise exception 'Too many submissions from this phone number recently. Please try again later.';
  end if;

  return new;
end;
$function$;

-- 2. Tag which channel a booking came in through, and which staff member
--    entered it if manual. Existing rows default to 'online' (correct —
--    every row so far genuinely came from the public forms).
alter table public.booking_requests
  add column booking_source text not null default 'online' check (booking_source in ('online', 'staff')),
  add column created_by uuid references public.staff(id);

alter table public.hourly_bookings
  add column booking_source text not null default 'online' check (booking_source in ('online', 'staff')),
  add column created_by uuid references public.staff(id);

-- 3. Staff-only equivalents of the public submit_* functions, for a manager
--    entering a booking taken over a phone call. Deliberately plain INSERTs
--    into the same tables (not a separate code path), so every existing
--    safeguard — the uq_booking_requests_approved_slot unique index,
--    trg_check_hourly_capacity, link_customer, notify_owner — applies
--    identically to a staff-entered row. p_mark_approved defaults to false
--    (lands as 'pending', same as an online submission, reviewed the same
--    way) — pass true only when the manager wants to record it as already
--    confirmed on the call itself.
create or replace function public.staff_create_booking_request(
  p_customer_name text,
  p_phone text,
  p_facility_id text,
  p_booking_date date,
  p_slot text,
  p_email text default null,
  p_guests integer default null,
  p_notes text default null,
  p_mark_approved boolean default false
) returns table(booking_code text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_code text;
begin
  if not private.is_staff() then
    raise exception 'Not authorised';
  end if;

  insert into booking_requests (
    customer_name, phone, email, facility_id, booking_date, slot, guests, notes,
    booking_source, created_by, status
  )
  values (
    p_customer_name, p_phone, p_email, p_facility_id, p_booking_date, p_slot, p_guests, p_notes,
    'staff', auth.uid(), case when p_mark_approved then 'approved' else 'pending' end
  )
  returning booking_requests.booking_code into v_code;

  return query select v_code;
end;
$function$;

create or replace function public.staff_create_hourly_booking(
  p_customer_name text,
  p_phone text,
  p_facility_id text,
  p_booking_date date,
  p_start_time time,
  p_end_time time,
  p_guests integer default 1,
  p_mode text default null,
  p_email text default null,
  p_mark_approved boolean default false
) returns table(booking_code text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_code text;
begin
  if not private.is_staff() then
    raise exception 'Not authorised';
  end if;

  insert into hourly_bookings (
    customer_name, phone, email, facility_id, booking_date, start_time, end_time, guests, mode,
    booking_source, created_by, status
  )
  values (
    p_customer_name, p_phone, p_email, p_facility_id, p_booking_date, p_start_time, p_end_time, p_guests, p_mode,
    'staff', auth.uid(), case when p_mark_approved then 'approved' else 'pending' end
  )
  returning hourly_bookings.booking_code into v_code;

  return query select v_code;
end;
$function$;

revoke all on function public.staff_create_booking_request from public, anon;
revoke all on function public.staff_create_hourly_booking from public, anon;
grant execute on function public.staff_create_booking_request to authenticated;
grant execute on function public.staff_create_hourly_booking to authenticated;

-- 4. Running-costs expense log — deliberately NOT linked to any booking
--    (the user confirmed this means general operating costs: maintenance,
--    wages, supplies, utilities — not a per-booking cost breakdown).
--    facility_id is optional (null = a general/whole-site expense).
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null check (category in ('maintenance', 'wages', 'supplies', 'utilities', 'other')),
  facility_id text references public.facilities(id),
  description text not null,
  amount numeric(10,2) not null check (amount >= 0),
  paid_by text,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.expenses is 'Operational running costs (maintenance/wages/supplies/utilities), logged by staff. Not linked to bookings — no per-booking cost breakdown exists in this schema.';

alter table public.expenses enable row level security;

create policy expenses_staff_select on public.expenses for select using (private.is_staff());
create policy expenses_staff_insert on public.expenses for insert with check (private.is_staff());
create policy expenses_staff_update on public.expenses for update using (private.is_staff());
create policy expenses_admin_delete on public.expenses for delete using (private.is_admin());

create index idx_expenses_date on public.expenses (expense_date);
create index idx_expenses_facility on public.expenses (facility_id);

-- 5. The unified Manager Feed — a read-only VIEW combining all three
--    submission tables, NOT a merge of the underlying tables (see
--    claude/db-login-migration-plan.md Phase 12 for why they stay
--    separate). security_invoker means this view runs with the *caller's*
--    permissions on the underlying tables, so it inherits exactly the same
--    staff-only RLS those tables already enforce — it grants no new access.
create view public.manager_activity_feed
with (security_invoker = true) as
select
  'enquiry'::text as record_type,
  id,
  enquiry_code as code,
  customer_name,
  phone,
  email,
  facility_id,
  preferred_date as activity_date,
  null::text as slot,
  null::time as start_time,
  null::time as end_time,
  status,
  null::text as payment_status,
  'online'::text as booking_source,
  message as notes,
  created_at,
  updated_at,
  customer_id
from public.enquiries
union all
select
  'hall_lawn_booking'::text,
  id,
  booking_code,
  customer_name,
  phone,
  email,
  facility_id,
  booking_date,
  slot,
  null::time,
  null::time,
  status,
  payment_status,
  booking_source,
  notes,
  created_at,
  updated_at,
  customer_id
from public.booking_requests
union all
select
  'hourly_booking'::text,
  id,
  booking_code,
  customer_name,
  phone,
  email,
  facility_id,
  booking_date,
  null::text,
  start_time,
  end_time,
  status,
  null::text,
  booking_source,
  null::text,
  created_at,
  updated_at,
  customer_id
from public.hourly_bookings;

grant select on public.manager_activity_feed to authenticated;
