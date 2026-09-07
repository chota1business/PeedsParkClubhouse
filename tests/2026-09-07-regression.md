# September 7 regression checks

Run `node tests/admin-workflows.cjs` from the repository root. This uses headless Playwright and mocked API responses; it does not create production bookings or expenses. Set `PLAYWRIGHT_PATH` if Playwright is installed elsewhere.

Run `tests/admin-permissions.sql` against a test database with the current migrations. It uses a transaction and rolls back its fixtures. It checks actual RLS and booking RPC behavior; browser mocks do not prove database permissions.

Use the September 7 entries in `tests/test-plan-artifact.html` for manual acceptance. They cover Pool Manager setup/access, facility booking and expense creation, inline conversion, payment validation, duplicate/failed conversions, date clearing, pagination, hidden Manager Feed, admin-only Analytics Expenses, mobile layout and password setup. Manual checks are pending until performed; automated passes do not mark them complete.

The Expenses tab is admin-only. Existing Admin/Manager facility expense-entry permissions remain unchanged. Hiding Manager Feed removes its dashboard entry; the legacy URL remains available to existing full-site staff.

Also check today's public-page work visually before publishing:

- Every public footer and Privacy Contact includes both clickable email addresses.
- Badminton blocked slots show Not Available, available slots Reserve, and elapsed slots Past, without exposing internal block labels.
- Aqua theme is consistent across home/facilities; footer/check-availability shading and reverted Call Us styling match the agreed design.
- Homepage welcome banner loads; enquiry banner matches form height on desktop and stacks on mobile. Intro copy is short; phone/email text is black and matches surrounding type.
- Gallery ticker works and all images load. Club House intro copy and type size match the page.

Do not create real customer records or send notifications for manual testing without using an agreed test environment/account.
