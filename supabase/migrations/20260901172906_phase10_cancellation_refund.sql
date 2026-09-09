-- Restored from the applied production migration history; no customer data.
alter table booking_requests add column cancellation_reason text;
alter table booking_requests add column cancelled_at timestamptz;
alter table booking_requests add column refund_status text not null default 'none'
  check (refund_status = any (array['none', 'partial', 'full']));
alter table booking_requests add column refund_notes text;

alter table hourly_bookings add column cancellation_reason text;
alter table hourly_bookings add column cancelled_at timestamptz;

alter table booking_requests add constraint booking_requests_refund_requires_cancelled_check
  check (refund_status = 'none' or status = 'cancelled');
