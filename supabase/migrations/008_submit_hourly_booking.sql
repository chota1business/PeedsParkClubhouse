-- Phase 4 (backend applied early, alongside 007): public submission function
-- for Pool/Badminton hourly bookings. Same RETURNING/RLS reasoning as
-- submit_booking_request — see 007 and PHASE_STATUS.md.
--
-- Matches hourly_bookings' real columns (customer_name, phone, email,
-- facility_id, booking_date, start_time, end_time, guests, mode) — this
-- table has no "notes" or "payment_status" column (unlike booking_requests),
-- and uses "mode" (e.g. badminton singles/doubles) instead.
--
-- check_hourly_capacity() (BEFORE INSERT/UPDATE trigger, 001_init_schema.sql)
-- enforces overlap/capacity rules at insert time; this function does not
-- duplicate that logic — it just performs the insert as its own owner so the
-- generated booking_code can be returned to an anonymous customer.

create or replace function public.submit_hourly_booking(
  p_customer_name text,
  p_phone text,
  p_facility_id text,
  p_booking_date date,
  p_start_time time,
  p_end_time time,
  p_guests integer default 1,
  p_mode text default null,
  p_email text default null
)
returns table (booking_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  insert into hourly_bookings (customer_name, phone, email, facility_id, booking_date, start_time, end_time, guests, mode)
  values (p_customer_name, p_phone, p_email, p_facility_id, p_booking_date, p_start_time, p_end_time, p_guests, p_mode)
  returning hourly_bookings.booking_code into v_code;

  return query select v_code;
end;
$$;

revoke all on function public.submit_hourly_booking from public;
grant execute on function public.submit_hourly_booking to anon, authenticated;
