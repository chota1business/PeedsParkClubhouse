-- PeedsPark Club House — Phase 0/1: Row Level Security
-- Run after 001_init_schema.sql.
-- Model: customers never authenticate (anon key, insert-only on public tables).
--        Admin/Manager authenticate via Supabase Auth and get roles from the staff table.

-- ---------- helper functions ----------
create or replace function current_staff_role() returns text
language sql stable security definer as $$
  select role from staff where id = auth.uid() and active = true
$$;

create or replace function is_staff() returns boolean
language sql stable security definer as $$
  select exists (select 1 from staff where id = auth.uid() and active = true)
$$;

create or replace function is_admin() returns boolean
language sql stable security definer as $$
  select exists (select 1 from staff where id = auth.uid() and active = true and role = 'admin')
$$;

-- ---------- enable RLS everywhere ----------
alter table staff             enable row level security;
alter table facilities        enable row level security;
alter table enquiries         enable row level security;
alter table booking_requests  enable row level security;
alter table hourly_bookings   enable row level security;
alter table blocks            enable row level security;
alter table audit_log         enable row level security;

-- ============================================================
-- STAFF — admins manage all staff; a manager can see only their own row.
-- ============================================================
create policy staff_select_own on staff for select
  using (id = auth.uid() or is_admin());

create policy staff_admin_write on staff for insert with check (is_admin());
create policy staff_admin_update on staff for update using (is_admin());
create policy staff_admin_delete on staff for delete using (is_admin());

-- ============================================================
-- FACILITIES — public read (needed for the site's availability display),
-- only admins can change configuration.
-- ============================================================
create policy facilities_public_read on facilities for select using (true);
create policy facilities_admin_write on facilities for insert with check (is_admin());
create policy facilities_admin_update on facilities for update using (is_admin());
create policy facilities_admin_delete on facilities for delete using (is_admin());

-- ============================================================
-- ENQUIRIES — anyone (including anon/customers) can INSERT a new enquiry.
-- Only staff can read, update status, or delete. No anon SELECT — customers
-- cannot see anyone else's enquiry, including their own after submitting.
-- ============================================================
create policy enquiries_public_insert on enquiries for insert
  with check (true);

create policy enquiries_staff_select on enquiries for select
  using (is_staff());

create policy enquiries_staff_update on enquiries for update
  using (is_staff());

create policy enquiries_admin_delete on enquiries for delete
  using (is_admin());

-- ============================================================
-- BOOKING REQUESTS — same pattern: public insert-only, staff manage.
-- ============================================================
create policy booking_requests_public_insert on booking_requests for insert
  with check (true);

create policy booking_requests_staff_select on booking_requests for select
  using (is_staff());

create policy booking_requests_staff_update on booking_requests for update
  using (is_staff());

create policy booking_requests_admin_delete on booking_requests for delete
  using (is_admin());

-- ============================================================
-- HOURLY BOOKINGS (Pool & Badminton) — same pattern.
-- ============================================================
create policy hourly_bookings_public_insert on hourly_bookings for insert
  with check (true);

create policy hourly_bookings_staff_select on hourly_bookings for select
  using (is_staff());

create policy hourly_bookings_staff_update on hourly_bookings for update
  using (is_staff());

create policy hourly_bookings_admin_delete on hourly_bookings for delete
  using (is_admin());

-- ============================================================
-- BLOCKS — staff only, both read and write (customers never create/see these
-- directly; they only see the resulting "unavailable" slot via public_availability).
-- ============================================================
create policy blocks_staff_select on blocks for select using (is_staff());
create policy blocks_staff_insert on blocks for insert with check (is_staff());
create policy blocks_staff_update on blocks for update using (is_staff());
create policy blocks_admin_delete on blocks for delete using (is_admin());

-- ============================================================
-- AUDIT LOG — staff can read; rows are written by Edge Functions using the
-- service role (bypasses RLS by design — audit entries must not be editable
-- by the very staff accounts being audited). No client-side insert/update/delete.
-- ============================================================
create policy audit_log_staff_select on audit_log for select using (is_staff());

-- ============================================================
-- PUBLIC AVAILABILITY VIEW — anonymous read allowed (no PII exposed by design,
-- see 001_init_schema.sql). Views inherit the security of their querying role;
-- granting select here is safe specifically because the view excludes name/phone/email.
-- ============================================================
grant select on public_availability to anon, authenticated;
