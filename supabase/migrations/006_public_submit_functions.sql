-- Fix: Postgres requires a row to pass its SELECT policy to appear in an
-- INSERT ... RETURNING result. Anonymous customers correctly have NO select
-- access to enquiries/booking_requests/hourly_bookings (that's what keeps
-- other customers' names/phones private) — but that means a plain
-- `.insert(...).select()` from the browser, which the site's JS relies on to
-- get back the generated enquiry/booking code, would fail for every real
-- submission. Verified this failure directly against the live database
-- before writing this fix.
--
-- Fix: a SECURITY DEFINER function that performs the insert as the function
-- owner (bypassing the RLS visibility problem entirely, since it never does
-- a client-visible SELECT) and returns ONLY the generated code — tighter
-- than before, since it can no longer echo back anything else either.
-- All existing protections (rate limit trigger, capacity/overlap trigger)
-- still fire, because those are table-level triggers, independent of RLS.
--
-- The same pattern must be used for booking_requests/hourly_bookings once
-- their public submission forms are built (Phase 3/4) — see docs/PHASE_STATUS.md.

create or replace function public.submit_enquiry(
  p_customer_name text,
  p_phone text,
  p_email text default null,
  p_facility_id text default null,
  p_preferred_date date default null,
  p_guests int default null,
  p_message text default null,
  p_source text default null
) returns table(enquiry_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  insert into enquiries (customer_name, phone, email, facility_id, preferred_date, guests, message, source)
  values (p_customer_name, p_phone, p_email, p_facility_id, p_preferred_date, p_guests, p_message, p_source)
  returning enquiries.enquiry_code into v_code;

  return query select v_code;
end;
$$;

grant execute on function public.submit_enquiry to anon, authenticated;
