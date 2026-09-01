-- Phase 5: owner alert email on every new enquiry / booking_request / hourly_booking.
--
-- How this works end to end: an AFTER INSERT trigger on each of the three
-- public-submission tables calls the `notify-owner` Edge Function (deployed
-- separately) via pg_net (async HTTP from Postgres — the trigger never blocks
-- or fails the customer's submission if the email send is slow or fails).
-- The Edge Function does the actual Resend API call.
--
-- Auth: the Edge Function is deployed with verify_jwt=false (it has no normal
-- caller, only this trigger) and instead checks a shared secret header
-- (x-webhook-secret) against its own WEBHOOK_SECRET env var. That secret is
-- generated here and stored in Supabase Vault — never hardcoded in a
-- migration file that ends up in a public-ish git repo.

create extension if not exists pg_net;

-- Generate the shared secret once, store it in Vault. If this migration is
-- ever re-run, don't rotate it silently (vault.create_secret would error on
-- a duplicate name anyway) — that's intentional, rotating requires updating
-- both sides (this + the Edge Function secret) deliberately.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'webhook_secret') then
    perform vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'webhook_secret', 'Shared secret between DB triggers and the notify-owner Edge Function');
  end if;
end $$;

-- Project URL is stable and not sensitive — safe to hardcode.
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
