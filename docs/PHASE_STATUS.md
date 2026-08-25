# PeedsPark — Build Status

Tracks progress against `PeedsPark_DB_Login_Migration_Plan.docx` (v1.1, 24 Aug 2026).
Repo: chota1business/PeedsParkClubhouse — built fresh, independent of the current live site at tincyme.github.io/ls-park-clubhouse, which stays untouched until cutover.

**Live Supabase project:** `peedspark-clubhouse` (ref `cvqvxclvizpltnflbdlh`, region ap-south-1/Mumbai), free tier, org "chota1business's Org". URL: https://cvqvxclvizpltnflbdlh.supabase.co

## Phase 0 — Setup: ✅ done and live

- All 3 migrations applied to the **live** project (not just written): `001_init_schema.sql`, `002_rls_policies.sql`, `003_security_hardening.sql`.
- Ran Supabase's own security advisor after applying — it found real issues (RLS helper functions exposed as public RPC endpoints, mutable search_path on 7 functions) and they're fixed, verified by re-running the advisor until clean.
- One advisor ERROR remains **by design, not by oversight**: `public_availability` is a security-definer view. It has to be — it deliberately bypasses the underlying tables' staff-only RLS to show anonymous visitors safe columns only (facility/date/time/status, never name/phone/email). Mitigated with `security_barrier = true` to close a side-channel leak risk. Documenting this rather than silently leaving an unexplained red flag.
- Customer-facing site (`index.html`, `css/style.css`, `js/app.js`, `privacy-policy.html`) — rendered and screenshotted at desktop + mobile, zero console errors.
- `js/supabase-client.js` now has the **live** project URL and publishable key, and fails soft (not a page-breaking error) if the Supabase library itself can't load.

## Phase 1 — Auth: 🟡 in progress

**Done:**
- `admin-v2/index.html` — staff login page (email/password via Supabase Auth).
- `admin-v2/dashboard.html` — post-login shell: shows staff name/role, role-based menu (Staff Management tile only shown to Admins), a working "not authorised" state for any authenticated-but-not-staff account, and Log Out.
- `admin-v2/js/admin-auth.js` — the actual guard logic: checks a live session AND an active row in `staff` before granting access (RLS backs this up server-side independently).
- Rendered and screenshotted — confirmed the "not authorised" fallback renders correctly when there's no session.

**Blocked on one manual step (by design — see chat):** Supabase doesn't let the very first login be created through code, since that needs the service-role key, which should only ever be used inside Supabase's own trusted dashboard. Waiting on Tincy's account (tincye29@gmail.com) to be created there. Once it exists, I'll link it into the `staff` table as Admin and Phase 1 is complete.

## Phases 2–8: not started

| Phase | Status |
|---|---|
| 0 — Setup | ✅ Done, live |
| 1 — Auth | 🟡 Login + dashboard shell built; waiting on first Admin account (manual dashboard step) |
| 2 — Enquiries | Not started (public capture works; Admin/Manager management UI doesn't exist) |
| 3 — Hall/Lawn bookings | Not started (public check works; approve/reject/cancel UI doesn't exist) |
| 4 — Pool & Badminton | Not started (public check works; management UI doesn't exist) |
| 5 — Notifications | Not started |
| 6 — Security hardening | Rate limiting + honeypot + validation + RLS advisor pass done; final review still pending until Phases 2–4 exist |
| 7 — Parallel testing | Not started |
| 8 — Privacy policy | ✅ Done |
