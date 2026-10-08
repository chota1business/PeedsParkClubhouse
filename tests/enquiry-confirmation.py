"""Offline browser regression for enquiry confirmation placement and escaping."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for width in (1280, 390):
            page = browser.new_page(viewport={'width': width, 'height': 844}, reduced_motion='reduce')
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base) else route.abort())
            page.goto(base + '/index.html')
            before = page.locator('#enquiryForm').evaluate('(el) => el.getBoundingClientRect().top + scrollY')
            page.locator('#enquirySubmitBtn').scroll_into_view_if_needed()
            attack = '<img src=x onerror="window.injected=true"> & <script>window.injected=true</script>'
            page.evaluate('''payload => showEnquiryConfirmation({enquiry_code: 'ENQ-TEST'}, payload)''', {
                'customer_name': 'Test', 'facility_id': attack, 'guests': attack,
                'preferred_date': '2026-12-20', 'message': attack,
            })
            panel = page.locator('#enquiryConfirmation')
            assert panel.is_visible()
            assert not page.locator('#enquiryForm').is_visible()
            assert panel.locator('img, script').count() == 0
            assert attack in panel.inner_text()
            assert not page.evaluate('Boolean(window.injected)')
            after = panel.evaluate('(el) => el.getBoundingClientRect().top + scrollY')
            assert abs(after - before) < 40, (width, before, after)
            bounds = panel.bounding_box()
            assert 0 <= bounds['y'] < 844, (width, bounds)
            assert page.evaluate('document.activeElement.id') == 'enquiryConfirmation'
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            panel.locator('[data-send-another]').click()
            assert page.locator('#enquiryForm').is_visible()
            assert not panel.is_visible()
            assert page.evaluate('document.activeElement.id') == 'name'
            page.close()
            print(f'PASS {width}px: same-position confirmation, visible/focused, escaped details, return to form')
        browser.close()
finally:
    server.shutdown()
