-- Phase 9 (3/4): automated follow-up digests to the owner.
--
-- Ported from the old ls-park-clubhouse site's 12-hour reminder trigger, but
-- deliberately simplified to an OWNER-ONLY digest rather than the old
-- site's direct customer emails. Two reasons:
--   1. Consistency with the Phase 5 decision already made with the user:
--      WhatsApp for customers, email only goes to the owner.
--   2. A real technical constraint: the notify-owner Edge Function sends via
--      Resend's free-tier "onboarding@resend.dev" sender, which can only
--      deliver to the account owner's own verified address — it cannot
--      legitimately email arbitrary customers without a verified domain.
--      Building customer-facing reminder emails now would silently fail.
-- If/when a verified sending domain is set up, this can be extended to also
-- message customers directly — until then, the owner gets nagged instead,
-- same as they already do for new submissions.
--
-- Two separate jobs (matching the old site's split): a 12-hourly enquiry
-- digest, and a daily pending-request/unpaid-booking digest. Each digest
-- lists whatever is CURRENTLY still open — no per-item cooldown/dedup
-- needed, since the job itself only runs on its own schedule.

create extension if not exists pg_cron;

-- ── Enquiry digest: enquiries open 12+ hours, not yet Converted/Lost ──────
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
    return; -- nothing overdue — no email, same as the old site's behaviour
  end if;

  perform private.notify_owner('digest_enquiries', jsonb_build_object('items', v_items));
end;
$$;

revoke all on function private.send_enquiry_digest from public;

-- ── Booking digest: pending requests 24h+ old, and approved-but-unpaid
--    bookings for a date that hasn't passed yet ─────────────────────────
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

-- Schedule: enquiry digest at 00:00 and 12:00 UTC (5:30am / 5:30pm IST);
-- booking digest once daily at 03:30 UTC (9am IST) — standard pg_cron
-- syntax, fixed clock times, not anchored to when this migration runs.
select cron.schedule('phase9-enquiry-digest', '0 */12 * * *', $$select private.send_enquiry_digest();$$);
select cron.schedule('phase9-booking-digest', '30 3 * * *', $$select private.send_booking_digest();$$);
