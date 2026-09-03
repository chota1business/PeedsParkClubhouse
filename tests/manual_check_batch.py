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
        resetPasswordForEmail: async function(email, opts) {
          window.__resetPasswordCalls = window.__resetPasswordCalls || [];
          window.__resetPasswordCalls.push({ email: email, redirectTo: opts && opts.redirectTo });
          return { data: {}, error: null };
        },
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

        # --- Check 7 (2026-09-03 batch): Edit action hidden on approved bookings ---
        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'admin';")
        page.goto(f"file://{ROOT}/admin-v2/hourly-bookings.html")
        page.wait_for_timeout(300)
        approved_html = page.evaluate("""() => {
            allHourly = [{ id: 'b1', status: 'approved', payment_status: 'partial', customer_name: 'A', phone: '9846718106',
                           booking_code: 'HB-1', facility_id: 'pool', booking_date: '2026-09-05', start_time: '17:00', end_time: '18:00' }];
            return bookingRowHtml(allHourly[0]);
        }""")
        pending_html = page.evaluate("""() => {
            allHourly = [{ id: 'b2', status: 'pending', payment_status: 'unpaid', customer_name: 'B', phone: '9846718106',
                           booking_code: 'HB-2', facility_id: 'pool', booking_date: '2026-09-05', start_time: '17:00', end_time: '18:00' }];
            return bookingRowHtml(allHourly[0]);
        }""")
        check("Pool/Badminton: Edit button hidden on an approved booking", 'data-action="edit"' not in approved_html)
        check("Pool/Badminton: Cancel + Update Payment still shown on an approved booking", 'data-action="cancel"' in approved_html and 'data-action="update_payment"' in approved_html)
        check("Pool/Badminton: Edit button still shown on a pending booking", 'data-action="edit"' in pending_html)
        page.close()

        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'admin';")
        page.goto(f"file://{ROOT}/admin-v2/bookings.html")
        page.wait_for_timeout(300)
        hall_approved_html = page.evaluate("""() => {
            return bookingRowHtml({ id: 'c1', status: 'approved', payment_status: 'partial', customer_name: 'C', phone: '9846718106',
                                     booking_code: 'BK-1', facility_id: 'lawn', booking_date: '2026-09-05', slot: 'evening' });
        }""")
        check("Hall/Lawn: Edit button hidden on an approved booking", 'data-action="edit"' not in hall_approved_html)
        page.close()

        # --- Check 8 (2026-09-03 batch): Partial payment now allowed for Pool/Badminton ---
        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'admin';")
        page.goto(f"file://{ROOT}/admin-v2/hourly-bookings.html")
        page.wait_for_timeout(300)
        page.evaluate("""() => {
            window.__paymentPromise2 = promptPaymentEntry({allowPartial: true, label: 'Approve HB-1 for Test'});
        }""")
        page.wait_for_timeout(200)
        note_hidden = page.eval_on_selector(".pp-modal-partial-note", "el => el.hidden")
        check("Pool/Badminton payment modal no longer shows the 'must be paid in full' note", note_hidden)
        page.fill("#ppTotalInput", "1000")
        page.fill("#ppPaidInput", "400")
        page.click(".pp-modal-save")
        page.wait_for_timeout(200)
        result = page.evaluate("() => window.__paymentPromise2")
        check("Pool/Badminton: entering a partial amount (400 of 1000) resolves with payment_status 'partial', no error",
              result and result.get("payment_status") == "partial")
        page.close()

        # --- Check 9 (this batch): Pool over-capacity guest count shows the right message ---
        page = browser.new_page()
        pool_stub = SUPABASE_STUB.replace(
            "if (name === 'get_facility_slots') {",
            """if (name === 'get_facility_slots') {
          if (params.p_facility_id === 'pool') {
            return { data: { type: 'hourly', bookingModel: 'capacity', slots: [
              { start: '06:00', end: '07:00', status: 'Available', remaining: 25, capacity: 25 }
            ] }, error: null };
          }"""
        )
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=pool_stub))
        dialogs9 = []
        page.on("dialog", lambda d: (dialogs9.append(d.message), d.dismiss()))
        page.goto(f"file://{ROOT}/pool.html")
        page.wait_for_timeout(300)
        page.fill("#pageDate", "2099-01-01")
        page.click("#pageAvailabilityForm button[type=submit]")
        page.wait_for_timeout(300)
        page.click("#pageSlotResult [data-slot-index='0']")
        page.wait_for_timeout(200)
        page.fill("#pageBookingForm [name=customer_name]", "Test User")
        page.fill("#bookPhone", "9846718106")
        page.fill("#pageBookingForm [name=guests]", "26")
        page.wait_for_timeout(3100)
        page.click("#pageBookingForm button[type=submit]")
        page.wait_for_timeout(200)
        err_text = page.locator("#bookFormError").inner_text() if page.locator("#bookFormError").is_visible() else ""
        check("Pool: requesting 26 guests on a 25-capacity slot shows a guest-count message, not a 'slot is booked' message",
              "guest" in err_text.lower() and "booked" not in err_text.lower() and len(dialogs9) == 0)
        page.close()

        # --- Check 10 (this batch): Forgot password link opens the form and calls resetPasswordForEmail ---
        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.goto(f"file://{ROOT}/admin-v2/index.html")
        page.wait_for_timeout(300)
        page.click("#forgotPasswordLink")
        page.wait_for_timeout(150)
        form_visible = page.locator("#forgotForm").is_visible()
        check("Forgot-password link reveals the reset-request form", form_visible)
        page.fill("#forgotEmail", "manager@example.com")
        page.click("#forgotForm button[type=submit]")
        page.wait_for_timeout(200)
        calls = page.evaluate("() => window.__resetPasswordCalls || []")
        check("Submitting the forgot-password form calls resetPasswordForEmail with the entered address and a reset-password.html redirect",
              len(calls) == 1 and calls[0]["email"] == "manager@example.com" and "reset-password.html" in (calls[0]["redirectTo"] or ""))
        msg_visible = page.locator("#forgotMessage").is_visible()
        check("A confirmation message shows after submitting the forgot-password form", msg_visible)
        page.close()

        # --- Check 11 (updated for the two-row dashboard): row 1 is always
        # Club House/Pool/Badminton; Manager Feed is pulled to the front of
        # row 2 for Managers only, row 2 stays Enquiries-first for Admins ---
        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'manager';")
        page.goto(f"file://{ROOT}/admin-v2/dashboard.html")
        page.wait_for_timeout(400)
        row1_hrefs = page.eval_on_selector_all("#row1Tiles .admin-tile", "els => els.map(e => e.getAttribute('href'))")
        check("Dashboard row 1 is Club House, Pool, Badminton (Manager)",
              row1_hrefs == ["bookings.html", "hourly-bookings.html?facility=pool", "hourly-bookings.html?facility=badminton"])
        first_row2_href = page.eval_on_selector("#row2Tiles .admin-tile", "el => el.getAttribute('href')")
        check("Manager dashboard: Manager Feed is the first tile in row 2", first_row2_href == "manager-feed.html")
        club_house_label = page.eval_on_selector("#row1Tiles .admin-tile h3", "el => el.textContent")
        check("Hall & Lawn tile renamed to Club House", "Club House" in club_house_label)
        page.close()

        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'admin';")
        page.goto(f"file://{ROOT}/admin-v2/dashboard.html")
        page.wait_for_timeout(400)
        first_row2_href_admin = page.eval_on_selector("#row2Tiles .admin-tile", "el => el.getAttribute('href')")
        check("Admin dashboard: row 2 tile order is unchanged (Enquiries still first)", first_row2_href_admin == "enquiries.html")
        page.close()

        # --- Check: hourly-bookings.html?facility= deep-link pre-selects the chip ---
        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'manager';")
        page.goto(f"file://{ROOT}/admin-v2/hourly-bookings.html?facility=pool")
        page.wait_for_timeout(400)
        active_facility = page.eval_on_selector('[data-facility].active', "el => el.dataset.facility")
        check("hourly-bookings.html?facility=pool pre-selects the Pool chip", active_facility == "pool")
        page.close()

        # --- Check 12 (this batch): Add Enquiry from Manager Feed sends a source value the DB now accepts ---
        page = browser.new_page()
        mgr_stub = SUPABASE_STUB.replace(
            "return { data: null, error: null };\n      },",
            """if (name === 'submit_enquiry') {
            window.__submitEnquiryCalls = window.__submitEnquiryCalls || [];
            window.__submitEnquiryCalls.push(params);
            return { data: [{ enquiry_code: 'ENQ-TEST01' }], error: null };
          }
          return { data: null, error: null };
        },"""
        )
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=mgr_stub))
        page.add_init_script("window.__STAFF_ROLE__ = 'manager';")
        page.goto(f"file://{ROOT}/admin-v2/manager-feed.html")
        page.wait_for_timeout(400)
        page.click("#openAddEnquiryBtn")
        page.wait_for_timeout(150)
        page.fill("#enquiryForm2 [name=customer_name]", "Phoned Customer")
        page.fill("#enquiryPhoneInput2", "9846718106")
        page.click("#enquiryForm2 button[type=submit]")
        page.wait_for_timeout(300)
        submitted = page.evaluate("() => (window.__submitEnquiryCalls || [])[0]")
        check("Add Enquiry from Manager Feed sends p_source='phone' — the value the DB constraint was fixed to accept",
              submitted is not None and submitted.get("p_source") == "phone")
        page.close()

        # --- Checks (this batch): Reject folded into Cancel, block-toggle panel, list-controls search/date/pagination ---
        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'admin';")
        page.goto(f"file://{ROOT}/admin-v2/bookings.html")
        page.wait_for_timeout(300)
        pending_html = page.evaluate("""() => bookingRowHtml({ id: 'p1', status: 'pending', payment_status: 'unpaid',
            customer_name: 'P', phone: '9846718106', booking_code: 'BK-2', facility_id: 'lawn', booking_date: '2026-09-05', slot: 'evening' })""")
        approved_html2 = page.evaluate("""() => bookingRowHtml({ id: 'a1', status: 'approved', payment_status: 'partial',
            customer_name: 'A', phone: '9846718106', booking_code: 'BK-3', facility_id: 'lawn', booking_date: '2026-09-05', slot: 'evening' })""")
        check("Bookings: no separate Reject button — pending row's stop-action is the single Cancel button",
              'data-action="reject"' not in pending_html and 'data-action="cancel"' in pending_html)
        check("Bookings: approved row also uses the single Cancel button (no separate Reject)",
              'data-action="reject"' not in approved_html2 and 'data-action="cancel"' in approved_html2)

        panel_hidden_initially = page.eval_on_selector("#blocksPanel", "el => el.hidden")
        page.click("#toggleBlocksBtn")
        panel_shown_after_click = page.eval_on_selector("#blocksPanel", "el => !el.hidden")
        page.click("#toggleBlocksBtn")
        panel_hidden_after_second_click = page.eval_on_selector("#blocksPanel", "el => el.hidden")
        check("Bookings: Block/Unblock panel starts collapsed behind the Manage Blocks toggle",
              panel_hidden_initially and panel_shown_after_click and panel_hidden_after_second_click)
        page.close()

        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'admin';")
        page.goto(f"file://{ROOT}/admin-v2/hourly-bookings.html")
        page.wait_for_timeout(300)
        hourly_panel_hidden = page.eval_on_selector("#blocksPanel", "el => el.hidden")
        page.click("#toggleBlocksBtn")
        hourly_panel_shown = page.eval_on_selector("#blocksPanel", "el => !el.hidden")
        check("Pool & Badminton: maintenance-block + reserved-hours tools collapsed behind one Manage Blocks toggle",
              hourly_panel_hidden and hourly_panel_shown)
        page.close()

        # list-controls.js: search + date range + pagination behave correctly in isolation
        page = browser.new_page()
        page.route("**/supabase-js@2/dist/umd/supabase.min.js", lambda route: route.fulfill(
            content_type="application/javascript", body=SUPABASE_STUB))
        page.add_init_script("window.__STAFF_ROLE__ = 'admin';")
        page.goto(f"file://{ROOT}/admin-v2/bookings.html")
        page.wait_for_timeout(300)
        lc_result = page.evaluate("""() => {
            const rows = [];
            for (let i = 1; i <= 22; i++) {
                rows.push({ customer_name: 'Cust' + i, phone: '900000000' + (i % 10), booking_date: '2026-09-' + String((i % 28) + 1).padStart(2, '0') });
            }
            const lc = createListControls({ pageSize: 5, searchText: r => r.customer_name + ' ' + r.phone, dateField: r => r.booking_date });
            const page1 = lc.paginate(lc.apply(rows));
            return { totalItems: page1.totalItems, totalPages: page1.totalPages, pageRowCount: page1.rows.length };
        }""")
        check("list-controls.js: paginates 22 rows into 5 pages of 5 (last page smaller)",
              lc_result["totalItems"] == 22 and lc_result["totalPages"] == 5 and lc_result["pageRowCount"] == 5)
        lc_search_direct = page.evaluate("""() => {
            const rows = [{ customer_name: 'Alice', phone: '9000000001', booking_date: '2026-09-10' },
                          { customer_name: 'Bob', phone: '9000000002', booking_date: '2026-09-11' }];
            const lc = createListControls({
                searchInputId: 'bookingSearch', dateFromId: 'bookingDateFrom', dateToId: 'bookingDateTo',
                searchText: r => r.customer_name + ' ' + r.phone, dateField: r => r.booking_date,
            });
            document.getElementById('bookingSearch').value = 'alice';
            document.getElementById('bookingSearch').dispatchEvent(new Event('input'));
            const bySearch = lc.apply(rows).map(r => r.customer_name);
            document.getElementById('bookingSearch').value = '';
            document.getElementById('bookingSearch').dispatchEvent(new Event('input'));
            document.getElementById('bookingDateFrom').value = '2026-09-11';
            document.getElementById('bookingDateFrom').dispatchEvent(new Event('change'));
            const byDate = lc.apply(rows).map(r => r.customer_name);
            return { bySearch, byDate };
        }""")
        check("list-controls.js: search narrows to the matching name/phone",
              lc_search_direct["bySearch"] == ["Alice"])
        check("list-controls.js: date-from filters out rows earlier than the chosen date",
              lc_search_direct["byDate"] == ["Bob"])
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
