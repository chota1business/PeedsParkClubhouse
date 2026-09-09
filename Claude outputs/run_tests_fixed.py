#!/usr/bin/env python3
"""
PeedsPark Clubhouse — automated test script
Repo: chota1business/PeedsParkClubhouse

Run from the repo root:
    pip install playwright
    playwright install chromium
    python tests/run_tests.py
"""

import sys
import os
import time
import threading
import socket
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

REPO_ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "http://localhost:8000"
SERVER_PORT = 8000

# CRITICAL: Change to repo root BEFORE server starts
# This ensures SimpleHTTPRequestHandler serves from correct directory
os.chdir(str(REPO_ROOT))

PUBLIC_PAGES = [
    "index.html",
    "club-house.html",
    "pool.html",
    "badminton.html",
    "ac-hall.html",
    "non-ac-hall.html",
    "lawn.html",
    "privacy-policy.html",
]
FACILITY_PICKER_PAGES = ["pool.html", "badminton.html", "ac-hall.html", "non-ac-hall.html", "lawn.html"]
ADMIN_PROTECTED_PAGES = [
    "admin-v2/dashboard.html",
    "admin-v2/enquiries.html",
    "admin-v2/bookings.html",
    "admin-v2/hourly-bookings.html",
    "admin-v2/manager-feed.html",
    "admin-v2/blocks.html",
]
ADMIN_LOGIN_PAGE = "admin-v2/index.html"
ALL_PAGES = PUBLIC_PAGES + ADMIN_PROTECTED_PAGES + [ADMIN_LOGIN_PAGE]

results = []


def record(test_id, description, passed, detail=""):
    results.append((test_id, description, passed, detail))
    mark = "✅" if passed else "❌"
    print(f"{mark} {test_id}: {description}" + (f" — {detail}" if detail and not passed else ""))


def file_url(rel_path):
    return f"{BASE_URL}/{rel_path}"


def collect_errors(page):
    errors = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" else None)
    return errors


def is_benign(err: str) -> bool:
    benign_markers = [
        "ERR_TUNNEL", "ERR_NAME_NOT_RESOLVED", "ERR_INTERNET_DISCONNECTED", "Failed to fetch",
        "Supabase library failed to load from CDN",
    ]
    return any(m in err for m in benign_markers)


def mock_rpc_init_script(data_by_facility_json):
    return f"""
        window.supabase = {{
          createClient: () => ({{
            rpc: (fn, args) => {{
              const byFacility = {data_by_facility_json};
              const data = byFacility[args.p_facility_id] || byFacility['*'];
              return Promise.resolve({{ data, error: null }});
            }},
            auth: {{ getSession: () => Promise.resolve({{ data: {{ session: null }} }}) }},
          }})
        }};
    """


def start_http_server():
    """Start HTTP server. Already in correct directory via os.chdir() above."""
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

    server = HTTPServer(("127.0.0.1", SERVER_PORT), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    # Wait for server to start
    time.sleep(0.5)
    max_retries = 10
    for _ in range(max_retries):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.connect(("127.0.0.1", SERVER_PORT))
            sock.close()
            print(f"✓ HTTP server started at {BASE_URL}")
            return server
        except ConnectionRefusedError:
            time.sleep(0.1)

    print("✗ Failed to start HTTP server", file=sys.stderr)
    sys.exit(1)


def run():
    server = start_http_server()

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
        record("A1", "Honeypot field present on the Quick Enquiry form", honeypots > 0, f"found {honeypots}")

        date_inputs = page.locator("input[type=date]")
        min_attrs = [date_inputs.nth(i).get_attribute("min") for i in range(date_inputs.count())]
        record("A2", "Every date input on the homepage has a 'min' (past-date guard)", all(m for m in min_attrs), f"{min_attrs}")

        phone_inputs = page.locator("input[name=phone]")
        record("A3", "Phone input field present", phone_inputs.count() > 0)
        page.close()

        # ---------- B. Nav present + correct active tab on every public page ----------
        for rel in PUBLIC_PAGES:
            page = browser.new_page()
            page.goto(file_url(rel), wait_until="networkidle", timeout=15000)
            page.wait_for_timeout(200)
            nav_links = page.locator("#mainNav a").count()
            active_count = page.locator("#mainNav a.active").count()
            expected_active = 0 if rel == "privacy-policy.html" else 1
            record(f"B-{rel}", f"{rel} nav has links and the expected active tab",
                   nav_links >= 4 and active_count == expected_active, f"links={nav_links} active={active_count}")
            page.close()

        # ---------- C. Admin auth gate ----------
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
            if rel != "privacy-policy.html":
                record(f"F-privacy-{rel}", f"{rel} links to privacy-policy.html", "privacy-policy.html" in html)
            page.close()

        # ---------- G. Facility pages: merged check-availability-and-book flow ----------
        page = browser.new_page()
        page.add_init_script(mock_rpc_init_script("""{
            '*': {
              type: 'fixed',
              slots: {
                morning: { label: 'Morning (8am-2pm)', status: 'Booked' },
                evening: { label: 'Evening (4pm-10pm)', status: 'Available' },
                full_day: { label: 'Full Day', status: 'Booked' },
              }
            }
        }"""))
        try:
            page.goto(file_url("ac-hall.html"), wait_until="networkidle", timeout=15000)
            page.fill("#pageDate", "2026-12-05")
            page.dispatch_event("#pageDate", "change")
            page.wait_for_timeout(300)
            html = page.inner_html("#pageSlotResult")
            record("G1", "ac-hall.html slot picker renders Available/Booked fixed slots",
                   "Evening" in html and "Request to Book" in html, html[:200])

            page.click("button:has-text('Request to Book')")
            page.wait_for_timeout(200)
            wrap_visible = page.locator("#bookingDetailsWrap").is_visible()
            slot_label = page.inner_text("#slotLabelText")
            record("G2", "Clicking a fixed slot reveals the inline booking form with the right slot label",
                   wrap_visible and "Evening" in slot_label, f"visible={wrap_visible} label={slot_label!r}")
        except Exception as e:
            record("G1-2", "ac-hall.html fixed-slot picker sequence", False, str(e))
        page.close()

        # ---------- G3/G4: pool.html hourly ----------
        page = browser.new_page()
        page.add_init_script(mock_rpc_init_script("""{
            '*': {
              type: 'hourly', bookingModel: 'capacity',
              slots: [
                { start: '10:00', end: '11:00', status: 'Available', remaining: 3, capacity: 8 },
                { start: '11:00', end: '12:00', status: 'Available', remaining: 8, capacity: 8 },
                { start: '12:00', end: '13:00', status: 'Full', remaining: 0, capacity: 8 },
              ]
            }
        }"""))
        try:
            page.goto(file_url("pool.html"), wait_until="networkidle", timeout=15000)
            page.fill("#pageDate", "2026-12-05")
            page.dispatch_event("#pageDate", "change")
            page.wait_for_timeout(300)
            html2 = page.inner_html("#pageSlotResult")
            record("G3", "pool.html slot picker shows remaining capacity for hourly slots",
                   "3 of 8 spots left" in html2, html2[:200])

            buttons = page.query_selector_all("#pageSlotResult button:has-text('Request to Book')")
            if buttons:
                buttons[0].click()
            page.wait_for_timeout(200)
            mode_wrap_visible = page.locator("#modeGuestsWrap").is_visible()
            slot_label = page.inner_text("#slotLabelText")
            record("G4", "Clicking an hourly slot on pool.html reveals mode+guests fields",
                   mode_wrap_visible and "10:00" in slot_label, f"mode_visible={mode_wrap_visible} label={slot_label!r}")
        except Exception as e:
            record("G3-4", "pool.html hourly-slot picker sequence", False, str(e))
        page.close()

        # ---------- G5: badminton.html resource booking ----------
        page = browser.new_page()
        page.add_init_script(mock_rpc_init_script("""{
            '*': {
              type: 'hourly', bookingModel: 'resource',
              slots: [
                { start: '10:00', end: '11:00', status: 'Available' },
              ]
            }
        }"""))
        try:
            page.goto(file_url("badminton.html"), wait_until="networkidle", timeout=15000)
            page.fill("#pageDate", "2026-12-05")
            page.dispatch_event("#pageDate", "change")
            page.wait_for_timeout(300)
            buttons = page.query_selector_all("#pageSlotResult button:has-text('Request to Book')")
            if buttons:
                buttons[0].click()
            page.wait_for_timeout(200)
            mode_wrap_hidden = not page.locator("#modeGuestsWrap").is_visible()
            record("G5", "badminton.html hides mode/guests fields (resource booking, not capacity)", mode_wrap_hidden)
        except Exception as e:
            record("G5", "badminton.html hides mode/guests fields", False, str(e))
        page.close()

        # ---------- H. Phase 10 UX fixes ----------
        page = browser.new_page()
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
        page.goto(file_url("index.html"), wait_until="networkidle", timeout=15000)
        page.fill("#enquiryPhone", "ab98-467/18106xyz")
        phone_value = page.eval_on_selector("#enquiryPhone", "el => el.value")
        record("H1", "Phone field strips non-digits and caps at 10 as you type",
               phone_value == "9846718106", f"value={phone_value!r}")

        page.fill("#enquiryForm [name=customer_name]", "Test User")
        page.fill("#enquiryPhone", "12345")
        page.wait_for_timeout(3100)
        page.click("#enquiryForm button[type=submit]")
        page.wait_for_timeout(200)
        note_visible = page.locator("#enquiryPhoneNote").is_visible()
        note_text = page.inner_text("#enquiryPhoneNote") if note_visible else ""
        record("H2", "Invalid phone shows an inline red error, not a native popup",
               note_visible and "10-digit" in note_text and len(dialogs) == 0,
               f"visible={note_visible} text={note_text!r} dialogs={dialogs}")
        page.close()

        # ---------- H3: past hourly slot ----------
        page = browser.new_page()
        now = time.localtime()
        today_str = time.strftime("%Y-%m-%d", now)
        past_hour = (now.tm_hour - 1) % 24
        future_hour = (now.tm_hour + 2) % 24
        page.add_init_script(mock_rpc_init_script(f"""{{
            '*': {{
              type: 'hourly', bookingModel: 'resource',
              slots: [
                {{ start: '{past_hour:02d}:00', end: '{(past_hour+1)%24:02d}:00', status: 'Available' }},
                {{ start: '{future_hour:02d}:00', end: '{(future_hour+1)%24:02d}:00', status: 'Available' }},
              ]
            }}
        }}"""))
        try:
            page.goto(file_url("badminton.html"), wait_until="networkidle", timeout=15000)
            page.fill("#pageDate", today_str)
            page.dispatch_event("#pageDate", "change")
            page.wait_for_timeout(300)
            html = page.inner_html("#pageSlotResult")
            past_badged = "Past" in html
            still_bookable_future = html.count("Request to Book") == 1
            record("H3", "An already-passed hourly slot today shows 'Past', not bookable",
                   past_badged and still_bookable_future, html[:300])
        except Exception as e:
            record("H3", "An already-passed hourly slot today shows 'Past', not bookable", False, str(e))
        page.close()

        # ---------- H4 & H5: confirmation-first flows ----------
        page = browser.new_page()
        popped_up = []
        page.add_init_script("""
            window.supabase = {
              createClient: () => ({
                rpc: (fn, args) => Promise.resolve({ data: [{ enquiry_code: 'ENQ-TEST01' }], error: null }),
                auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
              })
            };
        """)
        page.on("popup", lambda p: popped_up.append(p.url))
        page.on("dialog", lambda d: d.dismiss())
        try:
            page.goto(file_url("index.html"), wait_until="networkidle", timeout=15000)
            page.fill("#enquiryForm [name=customer_name]", "Test User")
            page.fill("#enquiryPhone", "9846718106")
            page.wait_for_timeout(3100)
            page.click("#enquiryForm button[type=submit]")
            page.wait_for_timeout(500)
            form_hidden = page.eval_on_selector("#enquiryForm", "el => el.hidden")
            panel_visible = page.locator("#enquiryConfirmation").is_visible()
            wa_present = page.locator("#enquiryConfirmation a[href*='wa.me']").count() > 0
            record("H4", "Enquiry form: successful submission shows a confirmation panel, never auto-opens WhatsApp",
                   form_hidden and panel_visible and wa_present and len(popped_up) == 0,
                   f"form_hidden={form_hidden} panel_visible={panel_visible} wa_present={wa_present} popups={popped_up}")
        except Exception as e:
            record("H4", "Enquiry form confirmation-first flow", False, str(e))
        page.close()

        page = browser.new_page()
        popped_up2 = []
        page.add_init_script(mock_rpc_init_script("""{
            '*': { type: 'fixed', slots: {
              morning: { label: 'Morning', status: 'Available' },
              evening: { label: 'Evening', status: 'Booked' },
              full_day: { label: 'Full Day', status: 'Booked' },
            }}
        }"""))
        page.on("popup", lambda p: popped_up2.append(p.url))
        try:
            page.goto(file_url("ac-hall.html"), wait_until="networkidle", timeout=15000)
            page.evaluate("""() => {
                supabaseClient.rpc = (fn, args) => {
                    if (fn === 'get_facility_slots') {
                        return Promise.resolve({ data: { type: 'fixed', slots: {
                            morning: { label: 'Morning', status: 'Available' },
                            evening: { label: 'Evening', status: 'Booked' },
                            full_day: { label: 'Full Day', status: 'Booked' },
                        }}, error: null });
                    }
                    if (fn === 'submit_booking_request') {
                        return Promise.resolve({ data: [{ booking_code: 'BK-TEST01' }], error: null });
                    }
                    return Promise.resolve({ data: null, error: { message: 'unexpected rpc ' + fn } });
                };
            }""")
            page.fill("#pageDate", "2026-12-05")
            page.dispatch_event("#pageDate", "change")
            page.wait_for_timeout(300)
            page.click("button:has-text('Request to Book')")
            page.wait_for_timeout(200)
            page.fill("#pageBookingForm [name=customer_name]", "Test User")
            page.fill("#bookPhone", "9846718106")
            page.wait_for_timeout(3100)
            page.click("#pageBookingForm button[type=submit]")
            page.wait_for_timeout(500)
            panel_visible2 = page.locator("#bookingConfirmation").is_visible()
            wa_present2 = page.locator("#bookingConfirmation a[href*='wa.me']").count() > 0
            record("H5", "Facility booking form: successful submission shows a confirmation panel, never auto-opens WhatsApp",
                   panel_visible2 and wa_present2 and len(popped_up2) == 0,
                   f"panel_visible={panel_visible2} wa_present={wa_present2} popups={popped_up2}")
        except Exception as e:
            record("H5", "Facility booking form confirmation-first flow", False, str(e))
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
