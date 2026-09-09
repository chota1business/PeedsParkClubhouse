-- Restored from the applied production migration history; no customer data.
-- CRITICAL fix, found during a pre-ship security self-review (not a user report,
-- not caught by earlier testing — found by deliberately trying to write directly
-- to these tables the way a real attacker would, bypassing the site's JS).
--
-- Every "public write" table (enquiries, booking_requests, hourly_bookings) had a
-- permissive INSERT policy (`with_check = true`) left over from before the
-- submit_*() SECURITY DEFINER functions existed. Combined with anon/authenticated
-- holding a raw INSERT grant on these tables, anyone with the public anon key
-- (which is visible in the site's own JavaScript -- that's normal and fine for
-- Supabase) could bypass the site entirely and POST straight to
-- /rest/v1/booking_requests (or hourly_bookings, or enquiries) with an
-- attacker-chosen `status` -- e.g. status: "approved" -- and it would insert
-- successfully with NO admin review. Reproduced and confirmed against the live
-- database before this fix.
--
-- Fix: remove the direct path entirely. The submit_*() functions still work
-- after this because they are SECURITY DEFINER, owned by the table owner
-- (postgres), which bypasses RLS and table grants regardless of what
-- anon/authenticated are allowed to do directly.

drop policy if exists enquiries_public_insert on enquiries;
drop policy if exists booking_requests_public_insert on booking_requests;
drop policy if exists hourly_bookings_public_insert on hourly_bookings;

revoke all on enquiries from anon;
revoke all on booking_requests from anon;
revoke all on hourly_bookings from anon;

revoke insert on enquiries from authenticated;
revoke insert on booking_requests from authenticated;
revoke insert on hourly_bookings from authenticated;
