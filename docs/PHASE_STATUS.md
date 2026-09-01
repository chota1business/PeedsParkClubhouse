# PeedsPark — Build Status

Tracks progress against `PeedsPark_DB_Login_Migration_Plan.docx` (v1.1, 24 Aug 2026).
Repo: chota1business/PeedsParkClubhouse — built fresh, independent of the current live site at tincyme.github.io/ls-park-clubhouse, which stays untouched until cutover.

**Live Supabase project:** `peedspark-clubhouse` (ref `cvqvxclvizpltnflbdlh`, region ap-south-1/Mumbai), free tier, org "chota1business's Org". URL: https://cvqvxclvizpltnflbdlh.supabase.co

## Phase 0 — Setup: ✅ done and live
## Phase 1 — Auth: ✅ done. First Admin (Tincy, tincye29@gmail.com) created and linked.

## Phase 2 — Enquiries: ✅ done

- `admin-v2/enquiries.html` + `js/enquiries.js` — staff view all enquiries, filter by status (New/Contacted/Follow-up/Converted/Lost, colour-coded), update status inline, one-tap WhatsApp/Call, writes an audit_log entry on every status change.
- Dashboard's Enquiries tile now links live instead of "Coming in Phase 2".

**Critical bug found and fixed during verification** (not caught by earlier testing — only surfaced by testing the exact RETURNING pattern the site's JS uses): Postgres requires a row to pass its SELECT policy to appear in an `INSERT ... RETURNING` result. Anonymous customers correctly have no SELECT access to enquiries (that's what keeps other customers' details private) — but the site's enquiry form used `.insert(payload).select()` to get back the generated code, which would have failed with an RLS error for **every real customer submission**. Confirmed the failure directly against the live database, then fixed it properly: enquiry submission now goes through a `submit_enquiry()` database function (`006_public_submit_functions.sql`) that inserts as its own owner and returns only the generated code — nothing else, tighter than before. Re-verified end-to-end: submission works, the rate limiter still fires correctly through the new path (tested to the 4th submission), and the full staff flow (select → update status → audit log entry) was independently verified against the live database, then all test rows cleaned up.

**Important note for Phase 3/4**: booking_requests and hourly_bookings will hit the exact same RETURNING problem once their public submission forms are built — must use the same `submit_...()` function pattern from the start, not a plain insert.

## Phase 3 — Hall/Lawn Bookings: ✅ done

- `admin-v2/bookings.html` + `js/bookings.js` — staff view all Hall/Lawn booking requests, filter by status (Pending/Approved/Rejected/Cancelled, colour-coded), approve/reject/cancel/mark-paid with a confirm() on every action, one-tap WhatsApp, block/unblock a facility (maintenance, private events) with a reason and time range, every action writes an `audit_log` entry.
- Public submission side: `js/app.js`'s `setupHallBookingForm()` and `setupHourlyBookingForm()` (Phase 4's backend, built early) both go through `submit_booking_request()` / `submit_hourly_booking()` database functions (`007_submit_booking_request.sql`, `008_submit_hourly_booking.sql`) — the same SECURITY DEFINER pattern as `submit_enquiry()`, applied proactively so the RETURNING/RLS bug from Phase 2 could never recur here.
- Dashboard's Hall & Lawn Bookings tile now links live instead of "Coming in Phase 3".

**Correction found and fixed during Phase 3 review** (found by reviewing the admin UI against the stated role design, not from a user report): the `blocks_admin_delete` policy from `002_rls_policies.sql` restricted unblocking a facility to Admins only. But Managers run the facility day to day and are meant to have block/unblock as a routine tool, same as Admins — the insert/select/update policies on `blocks` were already staff-wide, only delete was narrower. Fixed via `009_fix_blocks_delete_policy.sql`: dropped `blocks_admin_delete`, added `blocks_staff_delete` using `private.is_staff()` (same helper the other three policies use). Verified against the live database: staff can create and delete a test block, anon is still correctly rejected (`new row violates row-level security policy`) on both insert and delete.

**End-to-end verification against the live database** (same rigour as Phase 2): submitted a test booking as anon via `submit_booking_request()` — confirmed anon still cannot SELECT the row afterward (PII stays protected); approved it and marked payment received as the real Admin account, confirmed each `update` and its `audit_log` entry; submitted a test hourly booking via `submit_hourly_booking()` and confirmed the existing `check_hourly_capacity()` trigger still correctly allows overlapping *shared*-capacity pool bookings within the facility's capacity limit (pool capacity is 8, two 2‑guest bookings correctly coexist) — this is expected shared-facility behaviour, not a gap; all test rows cleaned up afterward. Ran the security advisor — no new findings beyond the already-accepted ones (the `submit_*` functions being anon/authenticated-callable is intentional; leaked-password-protection toggle is still a pending user action, see Phase 6).

**Note for whoever builds Phase 4's admin UI**: the two local migration files for `submit_booking_request()`/`submit_hourly_booking()` were rewritten once already because the first draft didn't match what was actually applied live (extra `p_source` param, wrong column names) — always pull the real signature from the database (`pg_get_functiondef`) rather than reconstructing it from memory before writing a migration file to disk.

## Phase 4 — Pool & Badminton Bookings: ✅ done

- `admin-v2/hourly-bookings.html` + `js/hourly-bookings.js` — staff view all Pool/Badminton bookings, filter by facility (Pool / Badminton — both courts) and status (Pending/Approved/Rejected/Cancelled), approve/reject/cancel with a confirm() on every action, one-tap WhatsApp, every action writes an `audit_log` entry. No "mark paid" here — `hourly_bookings` has no `payment_status` column, unlike Hall/Lawn.
- Dashboard's Pool & Badminton tile now links live instead of "Coming in Phase 4".

**Bug found and fixed before this shipped** (found while seeding test data, not from a user report): the facilities table has **two separate badminton courts** — `badminton_1` and `badminton_2` — not one generic `badminton` facility. The customer-facing site (`index.html`) already had this right. My first draft of the admin filter chip and facility-label lookup used a single `"badminton"` key, which would have silently shown zero results whenever staff filtered by badminton (the filter would never match either court's real facility_id) and shown a raw id instead of a friendly name on every badminton row. Fixed: the filter now matches both courts via prefix (`badminton_1`/`badminton_2` both start with `badminton`), and the label map has a distinct entry for each court.

**End-to-end verification against the live database**: submitted a pool booking as anon, approved it as staff, confirmed the `audit_log` entry, confirmed anon still can't SELECT the row afterward; confirmed the existing `check_hourly_capacity()` trigger rejects a pool booking **at submission time** (not just on approval) once it would exceed the facility's shared capacity (pool capacity 8 — a 4-guest booking plus a 5-guest overlapping request was correctly refused with "Capacity exceeded"); confirmed the same trigger rejects an overlapping *exclusive*-mode badminton booking on the **same** court but allows the identical time slot on the **other** court (courts are independent facility_ids, as they should be); walked a badminton booking through reject, and a second through approve → cancel, confirming both status transitions and their audit entries. All test rows cleaned up afterward. Security advisor re-run clean — no new findings.

## 🔴 CRITICAL — Pre-ship security review (27 Aug 2026): ✅ found and fixed

Before telling the user this was ready to ship, I deliberately tried to write to the database the way a real attacker would — bypassing the site's JS entirely and posting straight to the REST API — rather than only testing through the app. That surfaced a real, exploitable gap that had been sitting live since Phase 2:

**The bug:** `enquiries`, `booking_requests`, and `hourly_bookings` each still had their original permissive INSERT policy (`with_check = true`) from before the `submit_*()` functions existed, and `anon`/`authenticated` still held a raw INSERT grant on all three tables. The `submit_*()` functions were the *intended* path, but nothing had ever closed the old direct-insert path — both were open at once. Anyone with the site's public anon key (visible in its own JS — normal for Supabase, not itself a problem) could skip the site and POST directly to e.g. `/rest/v1/booking_requests` with `status: "approved"` and it would insert successfully. **Confirmed live**: a forged "approved" Hall booking, a forged "approved" Pool booking, and a forged "converted" enquiry all inserted with zero admin review before the fix. This would have let anyone fabricate fake-approved bookings or quietly mark enquiries as handled, with no trace of it having skipped the normal flow.

**The fix** (`010_lock_down_direct_writes.sql`): dropped the three permissive insert policies and revoked all standing table privileges from `anon` (it has no legitimate reason to touch these tables directly anymore) and the INSERT privilege from `authenticated` (staff still need SELECT/UPDATE for the dashboard, correctly gated by `is_staff()`/`is_admin()` — they never need a raw insert that skips the audit-logged approval flow). The `submit_*()` functions are unaffected because they're `SECURITY DEFINER`, owned by the table owner (`postgres`), which bypasses RLS and grants regardless of what `anon`/`authenticated` can do directly.

**Verified against the live database after the fix:** the same forged-insert attempt now fails with `permission denied` for both `anon` and `authenticated`; all three legitimate `submit_*()` RPC paths still work end-to-end; staff can still SELECT/UPDATE via the dashboard exactly as before. Security advisor re-run clean, all test rows cleaned up.

**Lesson for every phase from here on**: whenever a table moves from "direct insert" to "insert via a `submit_*()` function," the old direct-insert policy and grant must be removed in the *same* migration — leaving both paths open is the actual vulnerability, not either one alone. Worth a specific check before Phase 5/6's final review too.

## Phase 5 — Notifications: 🔶 in progress

Scope narrowed with the user: WhatsApp for customers (already working — every form's confirmation panel has a prefilled "Confirm on WhatsApp" link, built during Phases 2–4), plus a new **owner alert email** on every new enquiry/booking. No customer confirmation emails (avoids the domain-verification question entirely for now).

- `supabase/migrations/011_notify_owner_setup.sql` — enables `pg_net`, generates a shared webhook secret into Supabase Vault, adds an `AFTER INSERT` trigger on `enquiries`/`booking_requests`/`hourly_bookings` that calls the Edge Function asynchronously (never blocks or fails a customer's submission).
- `supabase/functions/notify-owner/index.ts` — deployed and live. Checks the shared secret (not a JWT — its only caller is the DB trigger), formats a plain-language alert email per submission type, sends via Resend.
- **Blocked on the user**: needs a Resend API key (free tier) plus the `WEBHOOK_SECRET`/`OWNER_EMAIL`/`RESEND_API_KEY` set as Edge Function secrets in the Supabase dashboard — cannot be set via migration or MCP tools. Once set, this needs a real end-to-end test (a live submission → confirm the email actually lands) before marking Phase 5 done.

## Phase 6 — Security hardening: 🔶 mostly done

Rate limiting confirmed attached to all three public tables (`trg_rate_limit_enquiries`/`booking_requests`/`hourly_bookings`, all `BEFORE INSERT`), plus the capacity trigger on `hourly_bookings` (`BEFORE INSERT OR UPDATE`) and the critical direct-write lockdown (see above) — all reverified in one pass. Full RLS policy inventory reviewed across every table (`staff`, `facilities`, `blocks`, `audit_log`, plus the three booking tables) — consistent, no other gaps found. Security advisor clean.

**Still open**: "leaked password protection" toggle in Supabase Auth settings — a one-click dashboard action only the user can do. Final sign-off review once Phase 5 is fully wired and tested end-to-end.

## Phase 7 — Parallel testing: 🔶 in progress

Mirrors the pattern already used for the old site (`docs/automated-test-script.md`/`docs/test-plan-link.md` describe that one — this is the equivalent for the new Supabase-backed site):

- `tests/run_tests.py` — Playwright script, 25 automated checks: every page loads clean, no mobile overflow, honeypot/date-guard/phone-field presence, pool/badminton field toggle, every admin-v2 page correctly refuses to show staff content without a session (accepts either valid fail-safe path — redirect-to-login when Supabase loads but there's no session, or the "Not authorised" panel when Supabase itself fails to load — both are intentional, not a bug in either direction). Ran clean (25/25), then verified it actually catches a real regression by deliberately breaking the footer's privacy-policy link and confirming the script caught it, then restored the file and confirmed byte-identical to the original.
- QA checklist artifact (Sanity/A–F sections, same structure as the old test-plan artifact) — published at https://claude.ai/code/artifact/0e23bad0-e031-49a2-8991-36b3fd69a5c7, tags every item auto vs manual, includes the specific "re-check the direct-write lockdown" item from the critical fix above so that particular class of bug gets checked again after any future schema change.

**Not yet done**: an actual full manual run-through of the checklist against the live site with a real staff login (I've been verifying the backend directly against the live database throughout, which is a different and more thorough check than clicking through the UI end-to-end as a human would) — worth doing once Phase 5's email is confirmed working, so one pass covers everything.

## Phase 9 — Old-site catch-up (partial payments, follow-up digests, slot picker): ✅ Done

Built after comparing the old `ls-park-clubhouse` site's Aug 2026 changes (Google Sheets/Apps Script + HTML, both committed and uncommitted) against this site. Three gaps identified and closed; a fourth item (the old site's "Payment gate" feature) turned out to already be covered by the existing "Mark Paid" admin action, so nothing further was needed there.

**1. Partial-payment tracking** (`012_phase9_partial_payment.sql`) — `booking_requests.payment_status` now allows `unpaid` / `partial` / `received`, matching the old site's 50%-advance tracking for Hall+Lawn. A second CHECK constraint (`booking_requests_partial_only_hall_lawn_check`) enforces `partial` can only be set for `ac_hall`/`non_ac_hall`/`lawn` — Pool/Badminton bookings don't track payment at all, same as before. Verified: both Hall and Lawn accept `partial`, Pool is rejected, a bogus payment_status value is rejected. Admin UI (`admin-v2/js/bookings.js`) got a new "🌗 Mark Partial (50%)" action next to "💰 Mark Paid", shown only where the DB would actually accept it.

**2. `get_facility_slots()` RPC** (`013_phase9_get_facility_slots.sql`) — a SECURITY DEFINER function (same trust model as `public_availability`, read-only, no rate-limited action) that returns real per-slot availability computed from the same tables `check_hourly_capacity()` uses: Morning/Evening/Full Day status for Hall/Lawn (with the correct full-day-conflicts-with-both logic), and hourly Available/Full/Booked/Blocked status — with remaining capacity — for Pool/Badminton, using each facility's actual `open_time`/`close_time` from the `facilities` table. Verified against seeded test bookings (shared capacity math, exclusive-mode conflicts, pending-vs-approved status, blocks) and confirmed callable by the `anon` role.

**3. Homepage slot-picker UX** (`index.html` + `js/app.js`) — the "Check Availability" section now renders the real slot list from `get_facility_slots()` with a "Request to Book" button per open slot, which prefills the matching booking form (facility/date/slot, or facility/date/start-time) and scrolls to it — closing the old site's "check then re-type everything" gap. Added a client-side duration/mode re-check for Pool/Badminton bookings (using the already-fetched slot data) that flags an obvious conflict — e.g. picking 3 hours starting from a slot that's only free for 1 more — before submit, same idea as the old site's `validateConsecutiveHours_`. This is a courtesy check only; the DB's `check_hourly_capacity` trigger remains the actual enforcement either way, so a stale or skipped client check can never let a real conflict through.

**4. Follow-up digests** (`014_phase9_followup_digest.sql` + `notify-owner` Edge Function v2) — ported the old site's 12-hour reminder trigger, but as an **owner-only digest**, not the old site's direct customer emails. Two reasons, both already true of this project: the Phase 5 decision (WhatsApp for customers, email only to the owner), and a real technical constraint — Resend's free-tier `onboarding@resend.dev` sender can only deliver to the account's own verified address, so customer-facing reminder emails would silently fail today. `pg_cron` now runs `private.send_enquiry_digest()` twice daily (enquiries open 12h+, not yet Converted/Lost) and `private.send_booking_digest()` once daily (booking requests pending 24h+, plus approved-but-unpaid bookings for upcoming dates) — both call the existing `notify_owner()` → Edge Function path, extended with two new digest email formats. Verified against seeded stale/pending/unpaid test rows before rollback.

**Not ported, deliberately**: the old site's actual "Payment gate" feature and its direct customer-facing reminder emails — see above for why each was skipped rather than silently built.

**Verification**: `tests/run_tests.py` extended with a 7-check Section G (slot-picker render, prefill for both fixed and hourly facilities, remaining-capacity display, the client-side duration conflict check and its recovery, no stray JS errors) — mocks the RPC response so it runs offline like the rest of the suite. Full suite: 32/32 passing. Security advisor re-run — no new findings beyond the two pre-existing, already-documented ones (leaked-password toggle pending user action; the `get_facility_slots`/`submit_*` SECURITY DEFINER warnings are expected, same pattern as every public-facing RPC in this project).

## Status table

| Phase | Status |
|---|---|
| 0 — Setup | ✅ Done, live |
| 1 — Auth | ✅ Done |
| 2 — Enquiries | ✅ Done |
| 3 — Hall/Lawn bookings | ✅ Done |
| 4 — Pool & Badminton | ✅ Done |
| 5 — Notifications | 🔶 Built, blocked on user's Resend API key + Edge Function secrets |
| 6 — Security hardening | 🔶 Mostly done — leaked-password toggle + final sign-off pending |
| 7 — Parallel testing | 🔶 Automated script + checklist artifact done — full manual run-through pending |
| 8 — Privacy policy | ✅ Done |
| 9 — Old-site catch-up (partial payments, digests, slot picker) | ✅ Done |
