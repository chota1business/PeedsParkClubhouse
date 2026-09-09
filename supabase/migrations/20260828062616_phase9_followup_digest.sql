-- Restored from the applied production migration history; no customer data.
create extension if not exists pg_cron;

create or replace function private.send_enquiry_digest()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'enquiry_code', enquiry_code,
           'customer_name', customer_name,
           'phone', phone,
           'facility_id', facility_id,
           'status', status,
           'hours_open', floor(extract(epoch from (now() - created_at)) / 3600)
         ) order by created_at), '[]'::jsonb)
    into v_items
    from enquiries
   where status in ('new', 'contacted', 'follow_up')
     and created_at <= now() - interval '12 hours';

  if jsonb_array_length(v_items) = 0 then
    return;
  end if;

  perform private.notify_owner('digest_enquiries', jsonb_build_object('items', v_items));
end;
$$;

revoke all on function private.send_enquiry_digest from public;

create or replace function private.send_booking_digest()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pending jsonb;
  v_unpaid jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'booking_code', booking_code,
           'customer_name', customer_name,
           'phone', phone,
           'facility_id', facility_id,
           'booking_date', booking_date,
           'slot', slot,
           'hours_pending', floor(extract(epoch from (now() - created_at)) / 3600)
         ) order by created_at), '[]'::jsonb)
    into v_pending
    from booking_requests
   where status = 'pending'
     and created_at <= now() - interval '24 hours';

  select coalesce(jsonb_agg(jsonb_build_object(
           'booking_code', booking_code,
           'customer_name', customer_name,
           'phone', phone,
           'facility_id', facility_id,
           'booking_date', booking_date,
           'slot', slot,
           'payment_status', payment_status
         ) order by booking_date), '[]'::jsonb)
    into v_unpaid
    from booking_requests
   where status = 'approved'
     and payment_status in ('unpaid', 'partial')
     and booking_date >= current_date;

  if jsonb_array_length(v_pending) = 0 and jsonb_array_length(v_unpaid) = 0 then
    return;
  end if;

  perform private.notify_owner('digest_bookings', jsonb_build_object('pending', v_pending, 'unpaid', v_unpaid));
end;
$$;

revoke all on function private.send_booking_digest from public;

select cron.schedule('phase9-enquiry-digest', '0 */12 * * *', $$select private.send_enquiry_digest();$$);
select cron.schedule('phase9-booking-digest', '30 3 * * *', $$select private.send_booking_digest();$$);
