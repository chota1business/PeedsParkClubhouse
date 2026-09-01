-- Phase 9 (1/4): partial-payment tracking for Hall/Lawn bookings.
--
-- Ported from the old ls-park-clubhouse site's Aug 2026 change: Hall bookings
-- already allowed a "Partial" (50% advance) payment state; that change added
-- Lawn to the same allowlist. Pool/Badminton bookings are paid in full only
-- (matches the old site's PARTIAL_PAYMENT_ALLOWED_FACILITY_IDS) and don't
-- track payment status at all on the new site (hourly_bookings has no
-- payment_status column), so this migration only touches booking_requests.

alter table booking_requests
  drop constraint booking_requests_payment_status_check;

alter table booking_requests
  add constraint booking_requests_payment_status_check
  check (payment_status = any (array['unpaid', 'partial', 'received']));

-- Business rule: "partial" only makes sense for Hall/Lawn bookings, which
-- take a 50% advance. Pool/Badminton aren't offered online booking with
-- payment tracking at all yet, so this is really just future-proofing —
-- but enforce it at the DB level rather than trusting the admin UI alone,
-- consistent with how every other business rule in this project is
-- enforced server-side (see check_hourly_capacity, the rate-limit checks).
alter table booking_requests
  add constraint booking_requests_partial_only_hall_lawn_check
  check (payment_status <> 'partial' or facility_id in ('ac_hall', 'non_ac_hall', 'lawn'));
