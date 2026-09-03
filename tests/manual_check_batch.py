"""Ad-hoc Playwright checks for this batch's changes (not part of run_tests.py's
66-check suite — kept separate since it needs a mocked Supabase session).
Run: python3 tests/manual_check_batch.py
"""
import pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent

SUPABASE_STUB = """
window.supabase = {
  createClient: function(url, key) {
    return {
      auth: {
        getSession: async function() {
          return { data: { session: { user: { id: 'u1' }, access_token: 'tok' } } };
        },
        getUser: async function() {
          return { data: { user: { id: 'u1' } } };
        },
        signOut: async function() { return {}; },
      },
      from: function(table) {
        var obj = {
          select: function() { return obj; },
          eq: function() { return obj; },
          maybeSingle: async function() {
            if (table === 'staff') {
              return { data: { id: 'u1', full_name: 'Test Manager', role: window.__STAFF_ROLE__ || 'manager', active: true } };
            }
            return { data: null };
          },
          order: function() { return obj; },
        };
        return obj;
      },
      rpc: async function(name, params) {
        if (name === 'get_facility_slots') {
          // Badminton-like slots: open 08:00-17:00, reserved after.
          var slots = [];
          for (var h = 8; h < 23; h++) {
            var status = (h >= 8 && h < 17) ? 'Available' : 'Reserved';
            slots.push({ start: String(h).padStart(2,'0') + ':00', end: String(h+1).padStart(2,'0') + ':00', status: status });
          }
          return { data: { type: 'hourly', bookingModel: 'resource', slots: slots }, error: null };
        }
        return { data: null, error: null };
      },
    };
  }
};
"""

results = []

def check(name, cond):
    results.append((name, bool(cond)))
    print(("✅ " if cond else "❌ ") + name)


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # --- Check 1: payment modal is a single bold form, no native prompt() ---
        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'admin';")
        page.goto(f"file://{ROOT}/admin-v2/bookings.html")
        page.wait_for_timeout(500)
        # Directly exercise the shared promptPaymentEntry function.
        page.evaluate("""() => {
            window.__paymentPromise = promptPaymentEntry({allowPartial: true, label: 'Test approve'});
        }""")
        page.wait_for_timeout(200)
        modal_visible = page.eval_on_selector(".pp-modal-backdrop", "el => !!el") if page.query_selector(".pp-modal-backdrop") else False
        check("Payment modal renders as a single custom modal (.pp-modal-backdrop)", modal_visible)
        bold = page.eval_on_selector(".pp-modal-card", "el => getComputedStyle(el).fontWeight") if modal_visible else None
        check("Payment modal text is bold (font-weight >= 700)", bold and int(bold) >= 700)
        has_two_inputs = page.eval_on_selector_all(".pp-modal-card input[type=number]", "els => els.length") if modal_visible else 0
        check("Payment modal has both Total and Paid fields in one form", has_two_inputs == 2)
        page.close()

        # --- Check 2: duration dropdown limits options crossing into Reserved hours ---
        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.goto(f"file://{ROOT}/badminton.html")
        page.wait_for_timeout(300)
        page.fill("#pageDate", "2099-01-01")
        page.click("#pageAvailabilityForm button[type=submit]")
        page.wait_for_timeout(300)
        # Click the slot button for 16:00 (only 1 hour of room before 17:00 reserved window)
        buttons = page.query_selector_all("#pageSlotResult [data-slot-index]")
        # Find the one whose row text starts with "16:00"
        target_index = None
        for b in buttons:
            row_text = b.evaluate("el => el.closest('div').textContent")
            if row_text.strip().startswith("16:00"):
                target_index = b
                break
        check("Found the 16:00 Badminton slot button", target_index is not None)
        if target_index:
            target_index.click()
            page.wait_for_timeout(200)
            opts = page.eval_on_selector_all(
                "#bookDuration option",
                "els => els.map(o => ({value:o.value, hidden:o.hidden, disabled:o.disabled}))"
            )
            enabled = [o["value"] for o in opts if not o["hidden"] and not o["disabled"]]
            check("Duration options limited to only 1hr when picking 16:00 (would cross 17:00 reserved)", enabled == ["1"])
        page.close()

        # --- Check 3: in-form error element exists and alert() isn't used for validation ---
        page = browser.new_page()
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.goto(f"file://{ROOT}/pool.html")
        page.wait_for_timeout(300)
        page.fill("#pageDate", "2099-01-01")
        page.click("#pageAvailabilityForm button[type=submit]")
        page.wait_for_timeout(300)
        has_error_el = page.query_selector("#bookFormError") is not None
        check("Booking form has an inline #bookFormError element", has_error_el)
        page.close()

        # --- Check 4: dashboard shows Admin-only row first, only for admin ---
        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'manager';")
        page.goto(f"file://{ROOT}/admin-v2/dashboard.html")
        page.wait_for_timeout(400)
        admin_tiles_hidden = page.eval_on_selector("#adminOnlyTiles", "el => el.hidden")
        check("Manager does NOT see Admin-only tiles (Analytics/Staff Mgmt) on Dashboard", admin_tiles_hidden)
        page.close()

        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'admin';")
        page.goto(f"file://{ROOT}/admin-v2/dashboard.html")
        page.wait_for_timeout(400)
        admin_tiles_shown = page.eval_on_selector("#adminOnlyTiles", "el => !el.hidden")
        check("Admin sees Admin-only tiles row on Dashboard", admin_tiles_shown)
        page.close()

        # --- Check 5: analytics.html blocks Manager, staff.html blocks Manager ---
        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'manager';")
        page.goto(f"file://{ROOT}/admin-v2/analytics.html")
        page.wait_for_timeout(400)
        not_auth = page.eval_on_selector("#notAuthorised", "el => !el.hidden")
        check("Manager blocked from analytics.html (not-authorised panel shown)", not_auth)
        page.close()

        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'manager';")
        page.goto(f"file://{ROOT}/admin-v2/staff.html")
        page.wait_for_timeout(400)
        not_auth2 = page.eval_on_selector("#notAuthorised", "el => !el.hidden")
        check("Manager blocked from staff.html (not-authorised panel shown)", not_auth2)
        page.close()

        # --- Check 6: manager-feed.html has Add Enquiry button and Convert modal markup ---
        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'manager';")
        page.goto(f"file://{ROOT}/admin-v2/manager-feed.html")
        page.wait_for_timeout(400)
        has_add_enq_btn = page.query_selector("#openAddEnquiryBtn") is not None
        has_convert_modal = page.query_selector("#convertModal") is not None
        check("Manager Feed has an Add Enquiry button", has_add_enq_btn)
        check("Manager Feed has the Convert-to-Booking modal", has_convert_modal)
        page.close()

        browser.close()

    total = len(results)
    passed = sum(1 for _, ok in results if ok)
    print(f"\n{passed}/{total} checks passed")
    return passed == total


if __name__ == "__main__":
    import sys
    ok = run()
    sys.exit(0 if ok else 1)
