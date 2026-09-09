-- Restored from the applied production migration history; no customer data.
-- Phase 4: public submission function for Pool & Badminton hourly bookings —
-- same SECURITY DEFINER pattern as submit_enquiry/submit_booking_request.
-- The capacity/overlap trigger and rate-limit trigger still fire (table-level).
create or replace function public.submit_hourly_booking(
  p_customer_name text,
  p_phone text,
  p_facility_id text,
  p_booking_date date,
  p_start_time time,
  p_end_time time,
  p_guests int default 1,
  p_mode text default null,
  p_email text default null
) returns table(booking_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  insert into hourly_bookings (customer_name, phone, email, facility_id, booking_date, start_time, end_time, guests, mode)
  values (p_customer_name, p_phone, p_email, p_facility_id, p_booking_date, p_start_time, p_end_time, p_guests, p_mode)
  returning hourly_bookings.booking_code into v_code;

  return query select v_code;
end;
$$;

grant execute on function public.submit_hourly_booking to anon, authenticated;
