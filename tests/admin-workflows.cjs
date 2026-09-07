const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/tincy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
function mockSupabase({ role }) {
  window.savedRequests = [];
  const enquiry = { id: 'enquiry-1', enquiry_code: 'ENQ-1', customer_name: 'Test Customer', phone: '9000000001', email: '', facility_id: 'pool', preferred_date: '2099-09-07', guests: 3, message: 'Keep these notes', status: 'new', created_at: '2026-09-07T10:00:00Z' };
  const bookings = Array.from({ length: 31 }, (_, i) => ({ id: `booking-${i}`, booking_code: `POOL-${i}`, customer_name: `Guest ${i}`, phone: '9000000002', facility_id: 'pool', booking_date: '2099-09-07', start_time: '10:00', end_time: '11:00', guests: 1, mode: 'shared', status: 'pending', payment_status: 'unpaid', created_at: '2026-09-06T10:00:00Z' }));
  const staff = { id: 'staff-test', full_name: 'Test Staff', role, active: true };
  const tables = { staff: [staff], enquiries: [enquiry], hourly_bookings: bookings, booking_requests: [], expenses: [], manager_activity_feed: [{ ...enquiry, code: 'ENQ-1', record_type: 'enquiry', activity_date: enquiry.preferred_date, notes: enquiry.message }] };
  function query(table) {
    (window.readTables ||= []).push(table);
    let rows = tables[table] || [], single = false;
    if (table === 'expenses') rows = Array.from({ length: 31 }, (_, i) => ({ id: i, expense_date: new Date().toISOString().slice(0, 10), amount: 100, facility_id: 'pool', category: 'maintenance', description: i === 0 ? '<img src=x onerror=alert(1)>' : 'Pool supplies', paid_by: 'Manager' }));
    const q = { select() { return q; }, order() { return q; },
      gte(k, v) { rows = rows.filter(x => x[k] >= v); return q; }, lte(k, v) { rows = rows.filter(x => x[k] <= v); return q; }, range(a, b) { rows = rows.slice(a, b + 1); return q; },
      eq(k, v) { rows = rows.filter(x => x[k] === v); return q; }, in(k, v) { rows = rows.filter(x => v.includes(x[k])); return q; },
      maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      insert(data) { window.savedRequests.push({ table, data }); return q; }, update(data) { window.savedRequests.push({ table, data }); return q; },
      then(resolve) { return Promise.resolve(window.failExpenses && table === 'expenses' ? { data: null, error: { message: 'Test failure' } } : { data: single ? rows[0] : rows, error: null }).then(resolve); } };
    return q;
  }
  window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: staff.id }, access_token: 'test-only' } } }), getUser: async () => ({ data: { user: { id: staff.id } } }), signOut: async () => ({}) }, from: query,
    rpc: async (name, data) => { window.savedRequests.push({ name, data }); return { data: { booking_code: 'SAVED-1' }, error: null }; } }) };
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const base = `http://127.0.0.1:${server.address().port}/admin-v2/`;
  const errors = [];
  async function pageFor(url, role = 'admin') {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(`${url}: ${error.message}`));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.fulfill({ body: '', contentType: 'text/javascript' }));
    await page.addInitScript(mockSupabase, { role });
    await page.goto(base + url);
    await page.locator('#pageContent').waitFor({ state: 'visible' });
    return page;
  }
  try {
    const analytics = await pageFor('analytics.html');
    assert.ok(!await analytics.evaluate(() => (window.readTables || []).includes('expenses')));
    await analytics.getByRole('button', { name: 'Expenses', exact: true }).click();
    await analytics.locator('#expensesTotal').filter({ hasText: '31 expenses' }).waitFor();
    assert.match(await analytics.locator('#expensesTotal').innerText(), /3100.00/);
    assert.equal(await analytics.locator('#expensesList img').count(), 0);
    assert.equal(await analytics.locator('#overviewPanel').isVisible(), false);
    assert.equal(await analytics.locator('[data-page-nav="prev"]').count(), 0);
    await analytics.locator('[data-page-nav="next"]').click();
    await analytics.locator('[data-page-nav="next"]').click();
    assert.equal(await analytics.locator('[data-page-nav="next"]').count(), 0);
    await analytics.locator('#expenseSearch').fill('no such expense');
    assert.equal(await analytics.locator('#expensesList').innerText(), 'No expenses match your search.');
    await analytics.locator('#expenseSearch').fill('');
    await analytics.locator('[name="start"]').fill('2099-01-01');
    await analytics.locator('[name="end"]').fill('2099-01-02');
    await analytics.getByRole('button', { name: 'Apply custom range' }).click();
    await analytics.getByText('No expenses in this period.', { exact: true }).waitFor();
    await analytics.getByRole('button', { name: 'Overview', exact: true }).click();
    assert.equal(await analytics.locator('#overviewPanel').isVisible(), true);
    await analytics.evaluate(() => { window.failExpenses = true; });
    await analytics.getByRole('button', { name: 'Expenses', exact: true }).click();
    await analytics.getByText("Couldn't load expenses: Test failure", { exact: true }).waitFor();
    await analytics.evaluate(() => { window.failExpenses = false; });
    await analytics.getByRole('button', { name: 'Last 7 days', exact: true }).click();
    await analytics.locator('#expensesTotal').filter({ hasText: '31 expenses' }).waitFor();
    await analytics.setViewportSize({ width: 390, height: 844 });
    assert.ok(await analytics.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await analytics.close();
    for (const role of ['admin', 'manager']) {
      const dashboard = await browser.newPage();
      await dashboard.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.fulfill({ body: '', contentType: 'text/javascript' }));
      await dashboard.addInitScript(mockSupabase, { role });
      await dashboard.goto(base + 'dashboard.html');
      await dashboard.locator('#dashboardContent').waitFor({ state: 'visible' });
      assert.equal(await dashboard.locator('a[href="manager-feed.html"]').count(), 0);
      if (role === 'manager') {
        await dashboard.goto(base + 'analytics.html');
        await dashboard.locator('#notAuthorised').waitFor({ state: 'visible' });
        assert.equal(await dashboard.locator('#pageContent').isVisible(), false);
        assert.ok(!await dashboard.evaluate(() => (window.readTables || []).includes('expenses')));
        assert.equal(await dashboard.evaluate(() => savedRequests.length), 0);
      }
      await dashboard.close();
    }
    const page = await pageFor('hourly-bookings.html?facility=pool');
    await page.locator('[data-page-nav="next"]').waitFor();
    assert.equal(await page.locator('[data-page-nav="prev"]').count(), 0);
    await page.locator('[data-page-nav="next"]').click();
    await page.locator('[data-page-nav="next"]').click();
    assert.equal(await page.locator('[data-page-nav="next"]').count(), 0);
    assert.equal(await page.locator('[data-page-nav="prev"]').count(), 1);
    await page.locator('#hourlyDateFrom').fill('2100-01-01');
    await page.locator('#hourlyDateFrom').dispatchEvent('change');
    assert.equal(await page.locator('#bookingList .enquiry-card').count(), 0);
    await page.getByRole('button', { name: 'Clear dates' }).click();
    assert.equal(await page.locator('#hourlyDateFrom').inputValue(), '');
    assert.equal(await page.locator('#bookingList .enquiry-card').count(), 15);
    assert.equal(await page.locator('[data-page-nav="prev"]').count(), 0);
    await page.locator('#openAddBookingBtn').click();
    let form = page.locator('#sharedAddBooking form');
    assert.deepEqual(await form.locator('[name="facility_id"] option').evaluateAll(els => els.map(e => e.value)), ['pool']);
    await form.locator('[name="customer_name"]').fill('New Guest');
    await form.locator('[name="phone"]').fill('9000000012');
    await form.locator('[name="booking_date"]').fill('2099-09-07');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('#sharedAddBooking').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => savedRequests.at(-1).name), 'staff_save_booking_enquiry');
    await page.locator('#openAddExpenseBtn').click();
    form = page.locator('#sharedAddExpense form');
    await form.locator('[name="amount"]').fill('100');
    await form.locator('[name="description"]').fill('Pool supplies');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('#sharedAddExpense').waitFor({ state: 'hidden' });
    assert.ok(await page.evaluate(() => savedRequests.some(x => x.table === 'expenses')));
    assert.equal(await page.evaluate(() => savedRequests.at(-1).table), 'audit_log');
    await page.close();

    for (const [url, allowed] of [['bookings.html', ['ac_hall','non_ac_hall','lawn']], ['hourly-bookings.html?facility=badminton', ['badminton_1','badminton_2']]]) {
      const facility = await pageFor(url);
      await facility.locator('#openAddBookingBtn').click();
      assert.deepEqual(await facility.locator('#sharedAddBooking [name="facility_id"] option').evaluateAll(els => els.map(e => e.value)), allowed);
      await facility.close();
    }
    const pool = await pageFor('hourly-bookings.html?facility=pool', 'pool_manager');
    assert.equal(await pool.locator('#facilityFilterRow').isVisible(), false);
    assert.equal(await pool.locator('#openAddExpenseBtn').isVisible(), false);
    assert.deepEqual(await pool.locator('#editFacilitySelect option').evaluateAll(els => els.map(e => e.value)), ['pool']);
    await pool.goto(base + 'bookings.html');
    await pool.waitForURL('**/hourly-bookings.html?facility=pool');
    await pool.goto(base + 'analytics.html');
    await pool.waitForURL('**/hourly-bookings.html?facility=pool');
    await pool.close();

    const feed = await pageFor('manager-feed.html');
    assert.equal(await feed.locator('[data-convert]').count(), 0);
    assert.equal(await feed.locator('#convertModal').count(), 0);
    await feed.locator('[data-action="edit-enquiry"]').click();
    form = feed.locator('#enquiryForm2');
    assert.equal(await form.locator('[name="guests"]').inputValue(), '3');
    await form.locator('[name="customer_name"]').fill('Updated Guest');
    await form.locator('[data-convert-enquiry]').click();
    await form.locator('[name="mark_approved"]').check();
    await form.locator('[name="total_amount"]').fill('200');
    await form.locator('[name="amount_paid"]').fill('200');
    assert.equal(await feed.locator('.modal-backdrop:visible').count(), 1);
    await feed.setViewportSize({ width: 390, height: 844 });
    assert.ok(await feed.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await feed.screenshot({ path: process.env.TEMP + '/peedspark-admin-conversion.png', fullPage: true });
    await form.getByRole('button', { name: 'Save and convert to booking' }).click();
    await feed.locator('#enquiryModal').waitFor({ state: 'hidden' });
    const saved = await feed.evaluate(() => savedRequests.find(x => x.name === 'staff_save_booking_enquiry').data.p_data);
    assert.equal(saved.customer_name, 'Updated Guest'); assert.equal(saved.guests, 3); assert.equal(saved.enquiry_id, 'enquiry-1'); assert.equal(saved.amount_paid, 200);
    await feed.close();
    for (const valid of [true, false]) {
      const reset = await browser.newPage();
      await reset.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.fulfill({ body: '', contentType: 'text/javascript' }));
      await reset.addInitScript(({ valid }) => {
        window.supabase = { createClient: () => ({ auth: {
          onAuthStateChange() {},
          verifyOtp: async data => { window.verifiedToken = data; return valid ? { data: { session: { user: { id: 'test' } } }, error: null } : { data: {}, error: { message: 'Expired' } }; },
          updateUser: async () => ({ error: null }), signOut: async () => ({})
        } }) };
      }, { valid });
      await reset.goto(base + 'reset-password.html?token_hash=test-token');
      await reset.locator(valid ? '#resetForm' : '#resetInvalid').waitFor({ state: 'visible' });
      assert.ok(!reset.url().includes('token_hash'));
      if (!valid) assert.equal(await reset.locator('#resetForm').isVisible(), false);
      else {
        await reset.locator('#newPassword').fill('test-password-only');
        await reset.locator('#confirmPassword').fill('test-password-only');
        await reset.locator('#resetForm button[type="submit"]').click();
        await reset.locator('#resetSuccess').waitFor({ state: 'visible' });
      }
      await reset.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: hidden Manager Feed, admin-only Analytics Expenses (dates/search/totals/pagination/error recovery/mobile), facility creation/expenses, pool scope, inline conversion/payment, Clear dates, pagination, password setup and no JS page errors.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
