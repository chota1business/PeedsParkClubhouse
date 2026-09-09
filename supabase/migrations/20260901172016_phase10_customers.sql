-- Restored from the applied production migration history; no customer data.
create table customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text not null,
  email text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  notes text,
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

grant select, update on customers to authenticated;
revoke all on customers from anon;

alter table enquiries add column customer_id uuid references customers(id) on delete set null;
alter table booking_requests add column customer_id uuid references customers(id) on delete set null;
alter table hourly_bookings add column customer_id uuid references customers(id) on delete set null;

create index idx_enquiries_customer_id on enquiries (customer_id);
create index idx_booking_requests_customer_id on booking_requests (customer_id);
create index idx_hourly_bookings_customer_id on hourly_bookings (customer_id);

create or replace function private.normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
$$;

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
    return new;
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
