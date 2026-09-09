-- Restored from the applied production migration history; no customer data.
alter table public.hourly_bookings
  add column refund_status text not null default 'none',
  add column refund_notes text;

alter table public.hourly_bookings
  add constraint hourly_bookings_refund_status_check
    check (refund_status = any (array['none','partial','full']));

alter table public.hourly_bookings
  add constraint hourly_bookings_refund_requires_cancelled_check
    check (refund_status = 'none' or status = 'cancelled');
