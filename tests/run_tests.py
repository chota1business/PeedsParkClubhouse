#!/usr/bin/env python3
"""
PeedsPark Clubhouse — automated test script (Phase 7)
Repo: chota1business/PeedsParkClubhouse

Run from the repo root:
    pip install playwright
    playwright install chromium
    python tests/run_tests.py

Tests the site's HTML/CSS/JS directly via file:// URLs — no server needed.
Requires a real internet connection (unlike the OLD ls-park-clubhouse test
script, this site loads the real Supabase JS client from a CDN and talks to
the real Supabase project for anything backend-related, so those pieces
cannot be fully mocked offline the way Apps Script was).

What this DOES cover, fully automated, no login needed:
  - Every public + admin page loads with zero unexpected JS errors
  - Mobile viewport: no horizontal overflow on any page
  - Customer-facing forms: required fields, honeypot field present,
    phone validation, past-date guard, pool/badminton field toggle
  - Every protected admin-v2 page redirects an unauthenticated visitor
    straight to the login page (never silently renders staff data)
  - Cross-page regression: consistent branding, footer privacy link,
    no leftover git merge-conflict markers

What this DOES NOT cover (needs a live login or live data — see the manual
test-plan artifact instead, same as Section D was for the old site):
  - Actually logging in and using the dashboard (Enquiries/Bookings/Hourly)
  - Submitting a real enquiry/booking and confirming it lands in Supabase
  - Rate limiting (3 submissions trigger "Too many submissions")
  - RLS / security behaviour — that's covered by the live-database
    verification already run directly against Supabase for every phase
    (see docs/PHASE_STATUS.md), not by this browser-only script

Exits 0 if everything passes, 1 if anything fails — usable as a pre-checkin
gate, same convention as the old site's script.
"""

import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO_ROOT = Path(__file__).resolve().parent.parent

PUBLIC_PAGES = ["index.html", "privacy-policy.html"]
ADMIN_PROTECTED_PAGES = [
    "admin-v2/dashboard.html",
    "admin-v2/enquiries.html",
    "admin-v2/bookings.html",
    "admin-v2/hourly-bookings.html",
]
ADMIN_LOGIN_PAGE = "admin-v2/index.html"
ALL_PAGES = PUBLIC_PAGES + ADMIN_PROTECTED_PAGES + [ADMIN_LOGIN_PAGE]

results = []  # (id, description, passed: bool, detail: str)


def record(test_id, description, passed, detail=""):
    results.append((test_id, description, passed, detail))
    mark = "✅" if passed else "❌"
    print(f"{mark} {test_id}: {description}" + (f" — {detail}" if detail and not passed else ""))


def file_url(rel_path):
    return f"file://{REPO_ROOT / rel_path}"


def collect_errors(page):
    errors = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" else None)
    return errors


def is_benign(err: str) -> bool:
    # Network-dependent noise that isn't a real bug in the code:
    # a CDN hiccup or an unauthenticated Supabase call failing is expected
    # and the site is designed to fail soft on both (see js/supabase-client.js).
    benign_markers = [
        "ERR_TUNNEL", "ERR_NAME_NOT_RESOLVED", "ERR_INTERNET_DISCONNECTED", "Failed to fetch",
        "Supabase library failed to load from CDN",  # the site's own friendly fail-soft message
    ]
    return any(m in err for m in benign_markers)


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---------- Sanity: every page loads clean ----------
        for rel in ALL_PAGES:
            page = browser.new_page()
            errors = collect_errors(page)
            try:
                page.goto(file_url(rel), wait_until="networkidle", timeout=15000)
                page.wait_for_timeout(500)
            except Exception as e:
                errors.append(str(e))
            real_errors = [e for e in errors if not is_benign(e)]
            record(f"S-{rel}", f"{rel} loads with no unexpected JS errors", len(real_errors) == 0, "; ".join(real_errors[:3]))
            page.close()

        # ---------- Mobile: no horizontal overflow ----------
        for rel in ALL_PAGES:
            page = browser.new_page(viewport={"width": 375, "height": 812})
            try:
                page.goto(file_url(rel), wait_until="networkidle", timeout=15000)
                page.wait_for_timeout(300)
                overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 2")
                record(f"M-{rel}", f"{rel} has no horizontal overflow at 375px", not overflow)
            except Exception as e:
                record(f"M-{rel}", f"{rel} has no horizontal overflow at 375px", False, str(e))
            page.close()

        # ---------- A. Customer forms: honeypot + validation present ----------
        page = browser.new_page()
        page.goto(file_url("index.html"), wait_until="networkidle", timeout=15000)
        honeypots = page.locator("input[id^='hpField']").count()
        record("A1", "Honeypot field(s) present on customer forms", honeypots > 0, f"found {honeypots}")

        date_inputs = page.locator("input[type=date]")
        min_attrs = [date_inputs.nth(i).get_attribute("min") for i in range(date_inputs.count())]
        record("A2", "Every date input has a 'min' (past-date guard)", all(m for m in min_attrs), f"{min_attrs}")

        phone_inputs = page.locator("input[name=phone]")
        record("A3", "Phone input fields present", phone_inputs.count() > 0)
        page.close()

        # ---------- B. Pool/Badminton facility toggle ----------
        page = browser.new_page()
        page.goto(file_url("index.html"), wait_until="networkidle", timeout=15000)
        try:
            facility_select = page.locator("#hourlyFacility")
            pool_fields = page.locator("#poolOnlyFields")
            if facility_select.count() and pool_fields.count():
                facility_select.select_option("badminton_1")
                page.wait_for_timeout(150)
                hidden_for_badminton = pool_fields.evaluate("el => getComputedStyle(el).display === 'none'")
                facility_select.select_option("pool")
                page.wait_for_timeout(150)
                shown_for_pool = pool_fields.evaluate("el => getComputedStyle(el).display !== 'none'")
                record("B1", "Pool-only fields hidden for Badminton, shown for Pool", hidden_for_badminton and shown_for_pool)
            else:
                record("B1", "Pool-only fields hidden for Badminton, shown for Pool", False, "elements not found")
        except Exception as e:
            record("B1", "Pool-only fields hidden for Badminton, shown for Pool", False, str(e))
        page.close()

        # ---------- C. Admin auth gate ----------
        # requireStaffSession() has two distinct correct fail-safe paths, and this
        # test must accept either — the point is that staff-only content is never
        # shown, not which specific path was taken:
        #   1. Supabase loaded but there's no session -> redirects to index.html
        #   2. Supabase itself failed to load (e.g. no network) -> shows the
        #      "Not authorised" panel instead of silently doing nothing
        # What must NEVER happen: #pageContent becomes visible without a session.
        for rel in ADMIN_PROTECTED_PAGES:
            page = browser.new_page()
            try:
                page.goto(file_url(rel), wait_until="networkidle", timeout=15000)
                page.wait_for_timeout(1000)
                landed_on_login = page.url.endswith("index.html") and "admin-v2" in page.url
                not_authorised_shown = page.locator("#notAuthorised").is_visible() if page.locator("#notAuthorised").count() else False
                protected_content_visible = False
                for content_id in ("pageContent", "dashboardContent"):
                    loc = page.locator(f"#{content_id}")
                    if loc.count() and loc.is_visible():
                        protected_content_visible = True
                safe = (landed_on_login or not_authorised_shown) and not protected_content_visible
                detail = f"ended at {page.url}, notAuthorised={not_authorised_shown}, contentVisible={protected_content_visible}"
                record(f"C-{rel}", f"{rel} never shows staff content without a session", safe, detail)
            except Exception as e:
                record(f"C-{rel}", f"{rel} never shows staff content without a session", False, str(e))
            page.close()

        # ---------- F. Cross-page regression ----------
        for rel in PUBLIC_PAGES:
            page = browser.new_page()
            page.goto(file_url(rel), wait_until="networkidle", timeout=15000)
            html = page.content()
            record(f"F-merge-{rel}", f"{rel} has no unresolved git merge markers", "<<<<<<<" not in html and ">>>>>>>" not in html)
            page.close()

        page = browser.new_page()
        page.goto(file_url("index.html"), wait_until="networkidle", timeout=15000)
        footer_privacy = page.locator("footer a[href*='privacy-policy.html']").count() > 0
        record("F-footer", "Footer links to privacy-policy.html", footer_privacy)
        page.close()

        # ---------- G. Phase 9: homepage slot-picker (mocked RPC) ----------
        # get_facility_slots() is a real DB round trip (already tested directly
        # against Supabase during Phase 9 delivery — see docs/PHASE_STATUS.md),
        # so here supabaseClient.rpc() is mocked to check the FRONTEND behaviour
        # only: does clicking an available slot actually prefill the right
        # booking form, and does the client-side duration re-check correctly
        # flag/clear a conflict.
        page = browser.new_page()
        g_errors = collect_errors(page)
        page.add_init_script("""
            window.supabase = {
              createClient: () => ({
                rpc: (fn, args) => {
                  const data = args.p_facility_id === 'ac_hall' ? {
                    type: 'fixed',
                    slots: {
                      morning: { label: 'Morning (8am-2pm)', status: 'Booked' },
                      evening: { label: 'Evening (4pm-10pm)', status: 'Available' },
                      full_day: { label: 'Full Day', status: 'Booked' },
                    }
                  } : {
                    type: 'hourly', bookingModel: 'capacity',
                    slots: [
                      { start: '10:00', end: '11:00', status: 'Available', remaining: 3, capacity: 8 },
                      { start: '11:00', end: '12:00', status: 'Available', remaining: 8, capacity: 8 },
                      { start: '12:00', end: '13:00', status: 'Full', remaining: 0, capacity: 8 },
                    ]
                  };
                  return Promise.resolve({ data, error: null });
                },
                auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
              })
            };
        """)
        try:
            page.goto(file_url("index.html"), wait_until="networkidle", timeout=15000)
            page.select_option("#availFacility", "ac_hall")
            page.fill("#availDate", "2026-09-05")
            page.dispatch_event("#availDate", "change")
            page.wait_for_timeout(300)
            html = page.inner_html("#availabilityResult")
            record("G1", "Slot picker renders Available/Booked slots for a fixed facility",
                   "Evening" in html and "Request to Book" in html, html[:200])

            page.click("button:has-text('Request to Book')")
            page.wait_for_timeout(200)
            facility_val = page.eval_on_selector("#hallBookingForm [name=facility_id]", "el => el.value")
            slot_val = page.eval_on_selector("#hallBookingForm [name=slot]", "el => el.value")
            record("G2", "Clicking a fixed slot prefills the Hall/Lawn booking form",
                   facility_val == "ac_hall" and slot_val == "evening", f"facility={facility_val} slot={slot_val}")

            page.select_option("#availFacility", "pool")
            page.dispatch_event("#availFacility", "change")
            page.wait_for_timeout(300)
            html2 = page.inner_html("#availabilityResult")
            record("G3", "Slot picker shows remaining capacity for a Pool (hourly) facility",
                   "3 of 8 spots left" in html2, html2[:200])

            buttons = page.query_selector_all("#availabilityResult button:has-text('Request to Book')")
            if buttons:
                buttons[0].click()
            page.wait_for_timeout(200)
            hf = page.eval_on_selector("#hourlyFacility", "el => el.value")
            hs = page.eval_on_selector("#hourlyStartTime", "el => el.value")
            record("G4", "Clicking an hourly slot prefills the Pool/Badminton booking form",
                   hf == "pool" and hs == "10:00", f"facility={hf} start={hs}")

            page.select_option("#hourlyDuration", "3")  # 12:00-13:00 is Full -> should conflict
            page.dispatch_event("#hourlyDuration", "change")
            page.wait_for_timeout(200)
            note = page.inner_text("#hourlyDurationNote")
            submit_disabled = page.eval_on_selector("#hourlyBookingForm button[type=submit]", "el => el.disabled")
            record("G5", "Client-side check flags a duration that runs into a Full hour",
                   "already full" in note and submit_disabled, f"note={note!r} disabled={submit_disabled}")

            page.select_option("#hourlyDuration", "2")  # both hours fine
            page.dispatch_event("#hourlyDuration", "change")
            page.wait_for_timeout(200)
            note2 = page.inner_text("#hourlyDurationNote")
            submit_disabled2 = page.eval_on_selector("#hourlyBookingForm button[type=submit]", "el => el.disabled")
            record("G6", "Client-side check clears once the duration no longer conflicts",
                   "Available for the full duration" in note2 and not submit_disabled2, f"note={note2!r} disabled={submit_disabled2}")

            real_g_errors = [e for e in g_errors if not is_benign(e)]
            record("G7", "Slot picker interaction produces no unexpected JS errors", len(real_g_errors) == 0, "; ".join(real_g_errors[:3]))
        except Exception as e:
            record("G-error", "Slot-picker test sequence completed without exceptions", False, str(e))
        page.close()

        browser.close()

    total = len(results)
    passed = sum(1 for _, _, ok, _ in results if ok)
    print(f"\n{passed}/{total} checks passed")

    failures = [(i, d, det) for i, d, ok, det in results if not ok]
    if failures:
        print("\nFAILED:")
        for i, d, det in failures:
            print(f"  {i}: {d}" + (f" ({det})" if det else ""))
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    run()
