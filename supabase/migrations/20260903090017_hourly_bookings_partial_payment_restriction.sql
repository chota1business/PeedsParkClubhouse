-- Restored from the applied production migration history; no customer data.
-- Mirrors booking_requests_partial_only_hall_lawn_check: Pool/Badminton must
-- be paid in full to approve (owner's longstanding rule from the old
-- system), only Hall/Lawn/AC/Non-AC allow a partial (advance) payment.
-- hourly_bookings only ever holds pool/badminton rows, so this is effectively
-- "no partial for hourly facilities at all" -- consistent with precedent.
alter table hourly_bookings
  drop constraint if exists hourly_bookings_no_partial_check;
alter table hourly_bookings
  add constraint hourly_bookings_no_partial_check
  check (payment_status <> 'partial');
