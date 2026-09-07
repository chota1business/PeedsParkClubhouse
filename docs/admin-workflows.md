# Admin workflow update

The `pool_manager` role can read and update pool hourly bookings and pool enquiries, and create/convert pool booking enquiries. It cannot access expenses, customer lists, other facilities, analytics, staff management, or block management. Existing admin/manager access is unchanged. The shared session guard routes Pool Managers directly to the Pool view; database policies independently enforce the facility boundary.

`admin-actions.js` supplies booking creation, facility expense creation, and conversion fields inside the existing enquiry edit form. Conversion uses `staff_save_booking_enquiry` to create the booking, link it, save payment and mark the enquiry converted in one transaction. It locks the source enquiry, rejects duplicate conversions, checks source and destination facility permissions, and preserves database capacity/block triggers. The RPC intentionally uses a definer context for atomic writes to the existing RPC-only booking tables, rejects unauthorised callers explicitly, fixes its search path and grants execution only to authenticated users.

Date filters have a shared Clear dates action; unavailable Prev/Next controls are omitted. Pool/Badminton enquiry filtering now uses the enquiry's preferred date.

## Deployment

- Supabase migration `20260907120022_pool_manager_admin_workflows.sql` is already applied to the configured project.
- The updated `create-staff` function is deployed with JWT verification enabled and its existing active-admin check.
- Pool Manager (`poolmanager@gmail.com`) has been created. Its one-time password setup link is supplied privately in the task response, not saved in the repository.
- Publish the updated admin HTML, JavaScript and CSS together. Password setup supports direct recovery tokens as well as existing email recovery redirects. The direct setup route removes its token from browser history and verifies it with Supabase before showing the password form.

## Validation

- `tests/admin-permissions.sql`: transactional live-database tests for permitted pool access, denied other-facility reads/writes, denied expenses and aggregate RPCs, reassignment prevention, inactive users, atomic conversion/payment, failure rollback, duplicate conversion and normal manager access. Test records are rolled back.
- `node tests/admin-workflows.cjs`: headless browser tests with mocked network responses for facility actions, scope/redirects, date reset, pagination boundaries, in-place conversion, retained edits, mobile width, and valid/expired setup tokens. Set `PLAYWRIGHT_PATH` if Playwright is installed outside the bundled runtime.
- Security advisors were checked. Existing warnings remain for the public availability view, existing public RPCs and auth configuration. The new RPC is intentionally an authenticated definer endpoint with explicit per-facility checks; see [Supabase advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
