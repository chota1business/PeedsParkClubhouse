-- CRITICAL fix, found during a pre-ship security self-review (not a user report,
-- not caught by earlier testing — found by deliberately trying to write directly
-- to these tables the way a real attacker would, bypassing the site's JS).
--
-- Every "public write" table (enquiries, booking_requests, hourly_bookings) had a
-- permissive INSERT policy (`with_check = true`) left over from before the
-- submit_*() SECURITY DEFINER functions existed. Combined with anon/authenticated
-- holding a raw INSERT grant on these tables, anyone with the public anon key
-- (which is visible in the site's own JavaScript — that's normal and fine for
-- Supabase) could bypass the site entirely and POST straight to
-- /rest/v1/booking_requests (or hourly_bookings, or enquiries) with an
-- attacker-chosen `status` — e.g. status: "approved" — and it would insert
-- successfully with NO admin review, NO rate limiting bypassed (the rate-limit
-- trigger still fires either way), and NO trace of it having skipped the normal
-- flow. Reproduced and confirmed against the live database: a forged "approved"
-- Hall booking, a forged "approved" Pool booking, and a forged "converted"
-- enquiry all inserted successfully via this path before this fix.
--
-- Root cause: the submit_*() functions (006/007/008) were added as the *correct*
-- path, but the old, permissive direct-insert policies were never removed —
-- both paths stayed open at once. The fix: remove the direct path entirely.
-- The submit_*() functions still work perfectly after this, because they are
-- SECURITY DEFINER, owned by the table owner (`postgres`), which bypasses RLS
-- and table grants regardless of what anon/authenticated are allowed to do
-- directly. This is the same "grants vs RLS are separate layers" lesson from
-- 004_fix_private_schema_usage.sql, applied in the opposite direction: there we
-- had to ADD a grant back; here we REMOVE one that should never have stayed.

-- Drop the now-redundant, over-permissive insert policies.
drop policy if exists enquiries_public_insert on enquiries;
drop policy if exists booking_requests_public_insert on booking_requests;
drop policy if exists hourly_bookings_public_insert on hourly_bookings;

-- Revoke every standing table privilege anon holds on these three tables. Anon
-- has no legitimate reason to touch them directly anymore — all public writes
-- go through submit_enquiry() / submit_booking_request() / submit_hourly_booking(),
-- which run as the table owner and are unaffected by this revoke. This also
-- closes the (lower-risk, since PostgREST's REST API doesn't expose TRUNCATE)
-- but still real over-grant of DELETE/UPDATE/TRUNCATE that RLS happened to mask.
revoke all on enquiries from anon;
revoke all on booking_requests from anon;
revoke all on hourly_bookings from anon;

-- `authenticated` covers staff only (customers never get a login, by design).
-- Staff still need SELECT/UPDATE (dashboard actions), gated correctly by the
-- existing is_staff()/is_admin() RLS policies (unaffected by this migration) —
-- but never a raw INSERT that skips the audit-logged approval flow.
revoke insert on enquiries from authenticated;
revoke insert on booking_requests from authenticated;
revoke insert on hourly_bookings from authenticated;
