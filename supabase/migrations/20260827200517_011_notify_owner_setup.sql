-- Restored from the applied production migration history; no customer data.
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'webhook_secret') then
    perform vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'webhook_secret', 'Shared secret between DB triggers and the notify-owner Edge Function');
  end if;
end $$;

create or replace function private.notify_owner(p_type text, p_record jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'webhook_secret';

  perform net.http_post(
    url := 'https://cvqvxclvizpltnflbdlh.supabase.co/functions/v1/notify-owner',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object('type', p_type, 'record', p_record)
  );
end;
$$;

revoke all on function private.notify_owner from public;

create or replace function public.trigger_notify_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform private.notify_owner(TG_ARGV[0], to_jsonb(NEW));
  return NEW;
end;
$$;

drop trigger if exists notify_owner_on_enquiry on enquiries;
create trigger notify_owner_on_enquiry
  after insert on enquiries
  for each row execute function public.trigger_notify_owner('enquiry');

drop trigger if exists notify_owner_on_booking_request on booking_requests;
create trigger notify_owner_on_booking_request
  after insert on booking_requests
  for each row execute function public.trigger_notify_owner('booking_request');

drop trigger if exists notify_owner_on_hourly_booking on hourly_bookings;
create trigger notify_owner_on_hourly_booking
  after insert on hourly_bookings
  for each row execute function public.trigger_notify_owner('hourly_booking');
