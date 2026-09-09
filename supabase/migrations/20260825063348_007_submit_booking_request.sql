-- Restored from the applied production migration history; no customer data.
-- Phase 3: public submission function for Hall/Lawn bookings — same pattern
-- as submit_enquiry() (see 006), applied proactively this time rather than
-- discovered by a production failure. SECURITY DEFINER, returns only the
-- generated booking_code. The rate-limit trigger and the approved-slot
-- uniqueness constraint still fire — both are table-level, independent of RLS.
create or replace function public.submit_booking_request(
  p_customer_name text,
  p_phone text,
  p_facility_id text,
  p_booking_date date,
  p_slot text,
  p_email text default null,
  p_guests int default null,
  p_notes text default null
) returns table(booking_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  insert into booking_requests (customer_name, phone, email, facility_id, booking_date, slot, guests, notes)
  values (p_customer_name, p_phone, p_email, p_facility_id, p_booking_date, p_slot, p_guests, p_notes)
  returning booking_requests.booking_code into v_code;

  return query select v_code;
end;
$$;

grant execute on function public.submit_booking_request to anon, authenticated;
