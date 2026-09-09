-- Restored from the applied production migration history; no customer data.
-- Admin-only Google Calendar subscribe feed for Club House bookings
-- (AC Hall / Non-AC Hall / Lawn only — Pool and Badminton are out of scope
-- per the owner's request). Read-only ICS feed: an Admin generates a
-- long random token here, subscribes to it in Google Calendar as
-- "From URL", and Google refreshes it periodically. Only APPROVED bookings
-- appear — pending/rejected/cancelled requests are deliberately left out.
--
-- Security model: the feed URL itself is the only thing gating access
-- (Google's calendar-subscribe fetcher can't send a login/JWT), so the
-- token must be unguessable — 192 bits of randomness, hex-encoded — and
-- is stored so it can be revoked instantly if a link ever leaks.

create table if not exists calendar_feed_tokens (
  id                uuid primary key default gen_random_uuid(),
  staff_id          uuid not null references staff(id) on delete cascade,
  token             text not null unique,
  created_at        timestamptz not null default now(),
  last_accessed_at  timestamptz,
  revoked_at        timestamptz
);
create index if not exists idx_calendar_feed_tokens_staff on calendar_feed_tokens(staff_id);

alter table calendar_feed_tokens enable row level security;

create policy calendar_feed_tokens_select on calendar_feed_tokens for select
  using (staff_id = auth.uid() or private.is_admin());

create policy calendar_feed_tokens_insert on calendar_feed_tokens for insert
  with check (private.is_admin() and staff_id = auth.uid());

create policy calendar_feed_tokens_update on calendar_feed_tokens for update
  using (staff_id = auth.uid() or private.is_admin());

revoke all on calendar_feed_tokens from anon, authenticated;
grant select, insert, update on calendar_feed_tokens to authenticated;

create or replace function create_calendar_feed_token()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token text;
begin
  if not private.is_admin() then
    raise exception 'Admin only';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');

  insert into calendar_feed_tokens (staff_id, token)
  values (auth.uid(), v_token);

  return v_token;
end;
$$;
revoke all on function create_calendar_feed_token() from public;
grant execute on function create_calendar_feed_token() to authenticated;

create or replace function revoke_calendar_feed_token(p_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update calendar_feed_tokens
     set revoked_at = now()
   where id = p_id
     and (staff_id = auth.uid() or private.is_admin())
     and revoked_at is null;
$$;
revoke all on function revoke_calendar_feed_token(uuid) from public;
grant execute on function revoke_calendar_feed_token(uuid) to authenticated;

create or replace function get_admin_calendar_feed(p_token text)
returns table (
  booking_code text,
  facility_id text,
  facility_name text,
  booking_date date,
  slot text,
  customer_name text,
  phone text,
  guests int,
  notes text
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token_id uuid;
begin
  select id into v_token_id
    from calendar_feed_tokens
   where token = p_token
     and revoked_at is null;

  if v_token_id is null then
    return;
  end if;

  update calendar_feed_tokens
     set last_accessed_at = now()
   where id = v_token_id;

  return query
    select br.booking_code, br.facility_id, f.name, br.booking_date, br.slot,
           br.customer_name, br.phone, br.guests, br.notes
      from booking_requests br
      join facilities f on f.id = br.facility_id
     where br.facility_id in ('ac_hall', 'non_ac_hall', 'lawn')
       and br.status = 'approved'
     order by br.booking_date, br.slot;
end;
$$;
revoke all on function get_admin_calendar_feed(text) from public;
grant execute on function get_admin_calendar_feed(text) to anon, authenticated;
