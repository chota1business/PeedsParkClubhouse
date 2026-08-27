-- Phase 3: public submission function for Hall/Lawn booking requests.
-- Same pattern as 006_public_submit_functions.sql (submit_enquiry) — anonymous
-- customers have no SELECT policy on booking_requests (protects other
-- customers' PII), so a plain `.insert(payload).select()` from the client
-- would fail: Postgres requires a row to satisfy its SELECT policy to be
-- returned by INSERT ... RETURNING. This function runs as its own owner
-- (SECURITY DEFINER) and returns only the generated booking_code — nothing
-- else about the row, and nothing about any other booking.
--
-- Matches booking_requests' real columns (customer_name, phone, email,
-- facility_id, booking_date, slot, guests, notes) — no "source" column
-- exists on this table (unlike enquiries), so there is no p_source param.

create or replace function public.submit_booking_request(
  p_customer_name text,
  p_phone text,
  p_facility_id text,
  p_booking_date date,
  p_slot text,
  p_email text default null,
  p_guests integer default null,
  p_notes text default null
)
returns table (booking_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  insert into booking_requests (customer_name, phone, email, facility_id, booking_date, slot, guests, notes)
  values (p_customer_name, p_phone, p_email, p_facility_id, p_booking_date, p_slot, p_guests, p_notes)
  returning booking_requests.booking_code into v_code;

  return query select v_code;
end;
$$;

revoke all on function public.submit_booking_request from public;
grant execute on function public.submit_booking_request to anon, authenticated;
