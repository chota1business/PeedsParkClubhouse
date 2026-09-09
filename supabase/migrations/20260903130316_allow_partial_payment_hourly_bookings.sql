-- Restored from the applied production migration history; no customer data.
-- Item #3 (2026-09-03 batch): Pool/Badminton should allow Partial payment,
-- same as Hall/Lawn. hourly_bookings_payment_status_check already permits
-- 'partial' as a valid value; this separate constraint was the actual
-- blocker forcing full-or-nothing payment. Drop it.
alter table public.hourly_bookings drop constraint if exists hourly_bookings_no_partial_check;
