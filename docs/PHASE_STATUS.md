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

## Phases 5–7: not started

| Phase | Status |
|---|---|
| 0 — Setup | ✅ Done, live |
| 1 — Auth | ✅ Done |
| 2 — Enquiries | ✅ Done |
| 3 — Hall/Lawn bookings | ✅ Done |
| 4 — Pool & Badminton | ✅ Done |
| 5 — Notifications | Not started |
| 6 — Security hardening | Rate limiting + honeypot + validation + RLS advisor pass done; leaked-password-protection toggle pending (user action); final review still pending — do it once Phase 5 exists |
| 7 — Parallel testing | Not started |
| 8 — Privacy policy | ✅ Done |
