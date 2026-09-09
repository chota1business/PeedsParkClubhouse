-- Restored from the applied production migration history; no customer data.
alter table booking_requests
  drop constraint booking_requests_payment_status_check;

alter table booking_requests
  add constraint booking_requests_payment_status_check
  check (payment_status = any (array['unpaid', 'partial', 'received']));

alter table booking_requests
  add constraint booking_requests_partial_only_hall_lawn_check
  check (payment_status <> 'partial' or facility_id in ('ac_hall', 'non_ac_hall', 'lawn'));
