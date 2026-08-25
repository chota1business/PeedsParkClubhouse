-- PeedsPark Club House — Phase 0: initial schema
-- Run in order: 001_init_schema.sql, then 002_rls_policies.sql
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE throughout.

create extension if not exists pgcrypto; -- for gen_random_uuid()

-- ============================================================
-- Human-readable code generators (server-side, so the client never
-- invents an ID and no two submissions can collide).
-- ============================================================
create sequence if not exists enquiry_code_seq;
create sequence if not exists booking_code_seq;

create or replace function next_enquiry_code() returns text
language sql as $$ select 'ENQ-' || lpad(nextval('enquiry_code_seq')::text, 5, '0') $$;

create or replace function next_booking_code() returns text
language sql as $$ select 'BK-' || lpad(nextval('booking_code_seq')::text, 5, '0') $$;

-- ============================================================
-- STAFF  (Admin / Manager accounts)
-- One row per Supabase Auth user, created after inviting them via Auth.
-- ============================================================
create table if not exists staff (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  phone       text,
  role        text not null check (role in ('admin', 'manager')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table staff is 'Admin/Manager accounts. Customers never appear here — they never log in.';

-- ============================================================
-- FACILITIES  (config, replaces hard-coded values)
-- ============================================================
create table if not exists facilities (
  id                 text primary key,           -- e.g. 'ac_hall','non_ac_hall','lawn','pool','badminton_1','badminton_2'
  name               text not null,
  type               text not null check (type in ('hall', 'lawn', 'pool', 'badminton')),
  capacity           int,                          -- max guests (pool: per-hour headcount)
  open_time          time not null,
  close_time         time not null,
  member_hours_open  boolean not null default false, -- badminton member-reserved-hours toggle
  active             boolean not null default true
);

insert into facilities (id, name, type, capacity, open_time, close_time) values
  ('ac_hall',      'AC Hall',       'hall',      100, '06:00', '23:00'),
  ('non_ac_hall',  'Non-AC Hall',   'hall',      250, '06:00', '23:00'),
  ('lawn',         'Lawn',          'lawn',      null,'06:00', '23:00'),
  ('pool',         'Swimming Pool', 'pool',      8,   '06:00', '20:00'),
  ('badminton_1',  'Badminton Court 1', 'badminton', 1, '05:00', '23:00'),
  ('badminton_2',  'Badminton Court 2', 'badminton', 1, '05:00', '23:00')
on conflict (id) do nothing;

-- ============================================================
-- ENQUIRIES
-- ============================================================
create table if not exists enquiries (
  id             uuid primary key default gen_random_uuid(),
  enquiry_code   text unique not null default next_enquiry_code(),
  customer_name  text not null,
  phone          text not null,
  email          text,
  facility_id    text references facilities(id),
  preferred_date date,
  guests         int,
  message        text,
  source         text check (source in ('google','facebook','instagram','whatsapp','direct','other')),
  status         text not null default 'new' check (status in ('new','contacted','follow_up','converted','lost')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_enquiries_status on enquiries(status);
create index if not exists idx_enquiries_created on enquiries(created_at);

-- ============================================================
-- BOOKING REQUESTS  (Hall / Lawn — morning/evening/full-day slots)
-- ============================================================
create table if not exists booking_requests (
  id             uuid primary key default gen_random_uuid(),
  booking_code   text unique not null default next_booking_code(),
  customer_name  text not null,
  phone          text not null,
  email          text,
  facility_id    text not null references facilities(id),
  booking_date   date not null,
  slot           text not null check (slot in ('morning','evening','full_day')),
  guests         int,
  status         text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','received')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_booking_requests_facility_date on booking_requests(facility_id, booking_date);

-- Prevent two APPROVED bookings on the same facility/date/slot (mirrors current double-booking fix)
create unique index if not exists uq_booking_requests_approved_slot
  on booking_requests (facility_id, booking_date, slot)
  where status = 'approved';

-- ============================================================
-- HOURLY BOOKINGS  (Pool & Badminton)
-- ============================================================
create table if not exists hourly_bookings (
  id             uuid primary key default gen_random_uuid(),
  booking_code   text unique not null default next_booking_code(),
  customer_name  text not null,
  phone          text not null,
  email          text,
  facility_id    text not null references facilities(id),
  booking_date   date not null,
  start_time     time not null,
  end_time       time not null,
  guests         int not null default 1,
  mode           text check (mode in ('shared','exclusive')), -- pool only; null for badminton
  status         text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint chk_time_order check (end_time > start_time)
);
create index if not exists idx_hourly_bookings_facility_date on hourly_bookings(facility_id, booking_date);

-- Capacity check trigger — enforces the "3x" capacity rule at the database layer too
-- (client typing check + submit check + this DB check = defence in depth, same principle as today)
create or replace function check_hourly_capacity() returns trigger as $$
declare
  fac_capacity int;
  guests_booked int;
  has_exclusive boolean;
begin
  if new.status not in ('pending','approved') then
    return new; -- rejected/cancelled rows never consume capacity
  end if;

  select capacity into fac_capacity from facilities where id = new.facility_id;

  -- Exclusive-mode pool booking: no overlap with ANY other active booking allowed
  select exists (
    select 1 from hourly_bookings
    where facility_id = new.facility_id
      and booking_date = new.booking_date
      and status in ('pending','approved')
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and mode = 'exclusive'
      and (start_time, end_time) overlaps (new.start_time, new.end_time)
  ) into has_exclusive;

  if has_exclusive or new.mode = 'exclusive' then
    if exists (
      select 1 from hourly_bookings
      where facility_id = new.facility_id
        and booking_date = new.booking_date
        and status in ('pending','approved')
        and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and (start_time, end_time) overlaps (new.start_time, new.end_time)
    ) then
      raise exception 'Exclusive booking conflicts with an existing booking on % between % and %', new.facility_id, new.start_time, new.end_time;
    end if;
    return new;
  end if;

  -- Shared/normal capacity check (also covers badminton, capacity = 1)
  select coalesce(sum(guests), 0) into guests_booked
  from hourly_bookings
  where facility_id = new.facility_id
    and booking_date = new.booking_date
    and status in ('pending','approved')
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and (start_time, end_time) overlaps (new.start_time, new.end_time);

  if fac_capacity is not null and (guests_booked + new.guests) > fac_capacity then
    raise exception 'Capacity exceeded for % on % between % and % (booked % + requested % > capacity %)',
      new.facility_id, new.booking_date, new.start_time, new.end_time, guests_booked, new.guests, fac_capacity;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_check_hourly_capacity on hourly_bookings;
create trigger trg_check_hourly_capacity
  before insert or update on hourly_bookings
  for each row execute function check_hourly_capacity();

-- ============================================================
-- BLOCKS  (maintenance / private-event closures, with overlap detection)
-- ============================================================
create table if not exists blocks (
  id          uuid primary key default gen_random_uuid(),
  facility_id text not null references facilities(id),
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  reason      text,
  created_by  uuid references staff(id),
  created_at  timestamptz not null default now(),
  constraint chk_block_time_order check (end_at > start_at)
);
create index if not exists idx_blocks_facility on blocks(facility_id, start_at, end_at);

-- ============================================================
-- AUDIT LOG  (new capability — not possible cleanly in Sheets)
-- ============================================================
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references staff(id),
  action      text not null,        -- e.g. 'approve_booking', 'block_slot', 'cancel_booking'
  table_name  text not null,
  record_id   text,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_log_created on audit_log(created_at);

-- ============================================================
-- SPAM PROTECTION — server-side rate limit (max 3 submissions per phone
-- per 30 minutes), enforced in the database so it can't be bypassed by
-- calling the public API directly (the anon key is, by design, public).
-- Mirrors the current Apps Script rate limit; the honeypot field and
-- minimum-fill-time check happen client-side in js/app.js.
-- ============================================================
create or replace function check_submission_rate_limit() returns trigger as $$
declare
  recent_count int;
begin
  execute format(
    'select count(*) from %I where phone = $1 and created_at > now() - interval ''30 minutes''',
    TG_TABLE_NAME
  ) into recent_count using new.phone;

  if recent_count >= 3 then
    raise exception 'Too many submissions from this phone number recently. Please try again later.';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_rate_limit_enquiries on enquiries;
create trigger trg_rate_limit_enquiries
  before insert on enquiries
  for each row execute function check_submission_rate_limit();

drop trigger if exists trg_rate_limit_booking_requests on booking_requests;
create trigger trg_rate_limit_booking_requests
  before insert on booking_requests
  for each row execute function check_submission_rate_limit();

drop trigger if exists trg_rate_limit_hourly_bookings on hourly_bookings;
create trigger trg_rate_limit_hourly_bookings
  before insert on hourly_bookings
  for each row execute function check_submission_rate_limit();

-- ============================================================
-- PUBLIC AVAILABILITY VIEW  (what anonymous visitors are allowed to see)
-- Exposes only facility/date/time/status — never customer name, phone, or email.
-- ============================================================
create or replace view public_availability as
  select facility_id, booking_date as date, slot::text as label, status,
         null::time as start_time, null::time as end_time
  from booking_requests
  where status in ('pending','approved')
  union all
  select facility_id, booking_date as date, null as label, status,
         start_time, end_time
  from hourly_bookings
  where status in ('pending','approved')
  union all
  select facility_id, start_at::date as date, null as label, 'blocked' as status,
         start_at::time as start_time, end_at::time as end_time
  from blocks;

comment on view public_availability is 'Safe to expose to anonymous visitors — no customer PII. Underlying tables stay locked down by RLS (see 002_rls_policies.sql).';
