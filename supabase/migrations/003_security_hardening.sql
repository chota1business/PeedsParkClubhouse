-- PeedsPark — Phase 0 follow-up: close findings from the Supabase security advisor.
-- 1) Move RLS helper functions into a `private` schema so PostgREST never exposes
--    them as public /rest/v1/rpc/... endpoints. They still work perfectly inside
--    RLS policies — a policy evaluates as the querying role's privileges, not
--    through the PostgREST API surface, so this doesn't affect access control.
-- 2) Pin search_path on every function (was "mutable" — a known privilege-
--    escalation vector where a caller's session search_path could shadow an
--    unqualified table/function reference).
-- 3) Mark the public_availability view security_barrier to prevent a
--    maliciously crafted filter from leaking filtered-out rows via planner
--    side channels (it must stay security-definer-style since it deliberately
--    bypasses the underlying tables' staff-only RLS to show safe columns only —
--    this is the one advisor ERROR left unresolved, by design: see README note).

create schema if not exists private;
revoke all on schema private from anon, authenticated;

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and active = true)
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and active = true and role = 'admin')
$$;

create or replace function private.current_staff_role() returns text
language sql stable security definer set search_path = public as $$
  select role from staff where id = auth.uid() and active = true
$$;

-- Re-point every policy at the private.* versions.
drop policy staff_select_own on staff;
create policy staff_select_own on staff for select using (id = auth.uid() or private.is_admin());
drop policy staff_admin_write on staff;
create policy staff_admin_write on staff for insert with check (private.is_admin());
drop policy staff_admin_update on staff;
create policy staff_admin_update on staff for update using (private.is_admin());
drop policy staff_admin_delete on staff;
create policy staff_admin_delete on staff for delete using (private.is_admin());

drop policy facilities_admin_write on facilities;
create policy facilities_admin_write on facilities for insert with check (private.is_admin());
drop policy facilities_admin_update on facilities;
create policy facilities_admin_update on facilities for update using (private.is_admin());
drop policy facilities_admin_delete on facilities;
create policy facilities_admin_delete on facilities for delete using (private.is_admin());

drop policy enquiries_staff_select on enquiries;
create policy enquiries_staff_select on enquiries for select using (private.is_staff());
drop policy enquiries_staff_update on enquiries;
create policy enquiries_staff_update on enquiries for update using (private.is_staff());
drop policy enquiries_admin_delete on enquiries;
create policy enquiries_admin_delete on enquiries for delete using (private.is_admin());

drop policy booking_requests_staff_select on booking_requests;
create policy booking_requests_staff_select on booking_requests for select using (private.is_staff());
drop policy booking_requests_staff_update on booking_requests;
create policy booking_requests_staff_update on booking_requests for update using (private.is_staff());
drop policy booking_requests_admin_delete on booking_requests;
create policy booking_requests_admin_delete on booking_requests for delete using (private.is_admin());

drop policy hourly_bookings_staff_select on hourly_bookings;
create policy hourly_bookings_staff_select on hourly_bookings for select using (private.is_staff());
drop policy hourly_bookings_staff_update on hourly_bookings;
create policy hourly_bookings_staff_update on hourly_bookings for update using (private.is_staff());
drop policy hourly_bookings_admin_delete on hourly_bookings;
create policy hourly_bookings_admin_delete on hourly_bookings for delete using (private.is_admin());

drop policy blocks_staff_select on blocks;
create policy blocks_staff_select on blocks for select using (private.is_staff());
drop policy blocks_staff_insert on blocks;
create policy blocks_staff_insert on blocks for insert with check (private.is_staff());
drop policy blocks_staff_update on blocks;
create policy blocks_staff_update on blocks for update using (private.is_staff());
drop policy blocks_admin_delete on blocks;
create policy blocks_admin_delete on blocks for delete using (private.is_admin());

drop policy audit_log_staff_select on audit_log;
create policy audit_log_staff_select on audit_log for select using (private.is_staff());

-- Old public-schema versions are no longer referenced by any policy — drop them
-- so they can't be called via PostgREST RPC at all.
drop function if exists is_staff();
drop function if exists is_admin();
drop function if exists current_staff_role();

-- Pin search_path on the remaining SECURITY DEFINER / trigger functions.
create or replace function next_enquiry_code() returns text
language sql set search_path = public as $$ select 'ENQ-' || lpad(nextval('enquiry_code_seq')::text, 5, '0') $$;

create or replace function next_booking_code() returns text
language sql set search_path = public as $$ select 'BK-' || lpad(nextval('booking_code_seq')::text, 5, '0') $$;

alter function check_hourly_capacity() set search_path = public;
alter function check_submission_rate_limit() set search_path = public;

-- Close the security-barrier gap on the public availability view.
alter view public_availability set (security_barrier = true);
