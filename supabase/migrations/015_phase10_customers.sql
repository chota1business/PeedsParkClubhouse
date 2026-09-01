-- Phase 10 (1/3): customer identity.
--
-- Every enquiry/booking so far has stored name/phone/email as plain text,
-- repeated on every row, with no way to see "this phone number has booked
-- 4 times" without exporting and matching by hand. This adds a `customers`
-- table keyed on phone (normalized to digits-only), auto-populated by a
-- trigger on every submission — no change needed to the submit_*()
-- functions themselves, and no new customer-facing surface (customers still
-- never log in, per the original design).

create table customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique, -- normalized: digits only, e.g. "9846718106"
  name text not null, -- most recent name seen for this phone
  email text, -- most recent non-null email seen
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  notes text, -- staff-only free text, e.g. "VIP", "difficult — always haggles"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_customers_phone on customers (phone);

comment on table customers is 'Auto-populated from enquiries/booking_requests/hourly_bookings by trigger. Customers never see or touch this table — staff-only.';

alter table customers enable row level security;

create policy customers_staff_select on customers
  for select using (private.is_staff());

create policy customers_staff_update on customers
  for update using (private.is_staff());
  -- notes/name/email can be corrected by staff; no insert/delete policy for
  -- anyone — rows are only ever created by the trigger below (SECURITY
  -- DEFINER, bypasses RLS) or removed manually via the SQL editor if ever
  -- needed.

grant select, update on customers to authenticated;
revoke all on customers from anon;

-- customer_id link on each submission table. Nullable + ON DELETE SET NULL:
-- a booking/enquiry must never disappear or fail to insert because of a
-- problem linking it to a customer row.
alter table enquiries add column customer_id uuid references customers(id) on delete set null;
alter table booking_requests add column customer_id uuid references customers(id) on delete set null;
alter table hourly_bookings add column customer_id uuid references customers(id) on delete set null;

create index idx_enquiries_customer_id on enquiries (customer_id);
create index idx_booking_requests_customer_id on booking_requests (customer_id);
create index idx_hourly_bookings_customer_id on hourly_bookings (customer_id);

-- Normalizes a phone number to digits-only for matching. Same idea as the
-- WhatsApp-link building already done client-side (phone.replace(/\D/g, ""))
-- — kept simple and consistent rather than validating an exact format here.
create or replace function private.normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
$$;

-- Finds or creates the customer row for this phone number, updates
-- name/email/last_seen_at, and stamps NEW.customer_id. Fires as a
-- BEFORE INSERT trigger on all three submission tables, so it works
-- regardless of whether the row came through a submit_*() RPC or (in
-- principle) a future direct staff insert — one place, not three.
create or replace function private.link_customer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_phone text;
  v_customer_id uuid;
begin
  v_phone := private.normalize_phone(new.phone);

  if v_phone = '' then
    return new; -- no phone to key on (shouldn't happen — phone is required
                -- on every submission form — but never block an insert over it)
  end if;

  insert into customers (phone, name, email)
  values (v_phone, new.customer_name, new.email)
  on conflict (phone) do update set
    name = excluded.name,
    email = coalesce(excluded.email, customers.email),
    last_seen_at = now(),
    updated_at = now()
  returning id into v_customer_id;

  new.customer_id := v_customer_id;
  return new;
end;
$$;

drop trigger if exists link_customer_on_enquiry on enquiries;
create trigger link_customer_on_enquiry
  before insert on enquiries
  for each row execute function private.link_customer();

drop trigger if exists link_customer_on_booking_request on booking_requests;
create trigger link_customer_on_booking_request
  before insert on booking_requests
  for each row execute function private.link_customer();

drop trigger if exists link_customer_on_hourly_booking on hourly_bookings;
create trigger link_customer_on_hourly_booking
  before insert on hourly_bookings
  for each row execute function private.link_customer();

-- Repeat-customer view for the admin UI: one row per customer with
-- aggregate activity counts, so "who are our regulars" is a single query
-- instead of exporting and matching phone numbers by hand.
create view customer_activity as
select
  c.id,
  c.phone,
  c.name,
  c.email,
  c.notes,
  c.first_seen_at,
  c.last_seen_at,
  (select count(*) from enquiries e where e.customer_id = c.id) as enquiry_count,
  (select count(*) from booking_requests b where b.customer_id = c.id) as hall_lawn_booking_count,
  (select count(*) from hourly_bookings h where h.customer_id = c.id) as hourly_booking_count,
  (select count(*) from booking_requests b where b.customer_id = c.id and b.status = 'approved')
    + (select count(*) from hourly_bookings h where h.customer_id = c.id and h.status = 'approved') as approved_booking_count
from customers c;

alter view customer_activity set (security_invoker = true);

grant select on customer_activity to authenticated;
revoke all on customer_activity from anon;
