-- 021_unified_blocks.sql
-- One block mechanism for every facility.
--
-- Before this migration there were three separate mechanisms:
--   * blocks                    one-off From/To datetime, Admin-only (maintenance)
--   * facility_reserved_windows hard-coded badminton member hours (05-08, 17-23)
--   * reserved_window_unblocks  per-date "open this window" overrides
--
-- After it, `blocks` is the single source of truth:
--   * block_type   badminton_members | maintenance | closure
--   * group_id     one multi-facility submission = one group
--   * one-off      start_at / end_at (timestamptz)      is_recurring = false
--   * recurring    start_time / end_time (IST wall clock) + days_of_week
--                  + optional valid_from / valid_to       is_recurring = true
--   * block_exceptions  per-date, per-hour "open this" overrides against any block
--
-- The old badminton tables are migrated across and left in place (unused) as a
-- rollback path. They are NOT dropped here.

-- ------------------------------------------------------------------
-- 1. Extend blocks
-- ------------------------------------------------------------------
alter table blocks
  add column if not exists block_type   text    not null default 'maintenance',
  add column if not exists group_id     uuid    not null default gen_random_uuid(),
  add column if not exists is_recurring boolean not null default false,
  add column if not exists start_time   time,
  add column if not exists end_time     time,
  add column if not exists days_of_week int[]   not null default '{0,1,2,3,4,5,6}',
  add column if not exists valid_from   date,
  add column if not exists valid_to     date,
  add column if not exists active       boolean not null default true;

alter table blocks alter column start_at drop not null;
alter table blocks alter column end_at   drop not null;

alter table blocks drop constraint if exists chk_block_time_order;
alter table blocks drop constraint if exists chk_block_type;
alter table blocks drop constraint if exists chk_block_shape;

alter table blocks
  add constraint chk_block_type check (block_type in ('badminton_members','maintenance','closure')),
  add constraint chk_block_shape check (
    (is_recurring = false and start_at is not null and end_at is not null and end_at > start_at
       and start_time is null and end_time is null)
    or
    (is_recurring = true and start_time is not null and end_time is not null and end_time > start_time
       and start_at is null and end_at is null
       and (valid_to is null or valid_from is null or valid_to >= valid_from))
  );

create index if not exists idx_blocks_group on blocks(group_id);
create index if not exists idx_blocks_recurring on blocks(facility_id, is_recurring, active);

-- ------------------------------------------------------------------
-- 2. Exceptions: open a specific date/hour range inside any block
-- ------------------------------------------------------------------
create table if not exists block_exceptions (
  id             uuid primary key default gen_random_uuid(),
  block_id       uuid not null references blocks(id) on delete cascade,
  exception_date date not null,
  start_time     time not null,
  end_time       time not null,
  reason         text,
  created_by     uuid references staff(id),
  created_at     timestamptz not null default now(),
  constraint chk_block_exception_time_order check (end_time > start_time),
  constraint uq_block_exception unique (block_id, exception_date, start_time, end_time)
);
create index if not exists idx_block_exceptions_lookup on block_exceptions(block_id, exception_date);
create index if not exists idx_block_exceptions_created_by on block_exceptions(created_by);

alter table block_exceptions enable row level security;

drop policy if exists block_exceptions_staff_select on block_exceptions;
drop policy if exists block_exceptions_admin_insert on block_exceptions;
drop policy if exists block_exceptions_admin_delete on block_exceptions;
create policy block_exceptions_staff_select on block_exceptions for select using (private.is_staff());
create policy block_exceptions_admin_insert on block_exceptions for insert with check (private.is_admin());
create policy block_exceptions_admin_delete on block_exceptions for delete using (private.is_admin());

revoke all on block_exceptions from anon;
grant select, insert, delete on block_exceptions to authenticated;

-- ------------------------------------------------------------------
-- 3. Migrate badminton member hours + existing unblocks
-- ------------------------------------------------------------------
do $$
declare
  w record;
  u record;
  v_group_0508 uuid := gen_random_uuid();
  v_group_1723 uuid := gen_random_uuid();
  v_block_id uuid;
begin
  -- Skip if already migrated (idempotent)
  if exists (select 1 from blocks where block_type = 'badminton_members') then
    return;
  end if;

  for w in select * from facility_reserved_windows order by facility_id, start_time loop
    insert into blocks (facility_id, block_type, group_id, is_recurring, start_time, end_time, days_of_week, reason)
    values (
      w.facility_id, 'badminton_members',
      case when w.start_time = '05:00' then v_group_0508 else v_group_1723 end,
      true, w.start_time, w.end_time, '{0,1,2,3,4,5,6}', 'Members playing hours'
    );
  end loop;

  for u in select * from reserved_window_unblocks loop
    select id into v_block_id
      from blocks
     where facility_id = u.facility_id
       and block_type = 'badminton_members'
       and is_recurring
       and start_time <= u.start_time
       and end_time   >= u.end_time
     limit 1;
    if v_block_id is not null then
      insert into block_exceptions (block_id, exception_date, start_time, end_time, reason, created_by)
      values (v_block_id, u.booking_date, u.start_time, u.end_time, u.reason, u.created_by)
      on conflict do nothing;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------
-- 4. Core helper: which block (if any) covers this facility/date/time range?
--    Returns the block_type with highest priority (closure > maintenance >
--    badminton_members), or null when the range is open.
--    All times are IST wall-clock, matching slot labels and facility hours.
-- ------------------------------------------------------------------
create or replace function public.facility_block_type(
  p_facility_id text, p_date date, p_start time, p_end time
) returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select b.block_type
    from blocks b
   where b.facility_id = p_facility_id
     and b.active
     and (
       -- one-off block: compare in IST
       (not b.is_recurring
          and b.start_at < ((p_date + p_end)   at time zone 'Asia/Kolkata')
          and b.end_at   > ((p_date + p_start) at time zone 'Asia/Kolkata'))
       or
       -- recurring rule: day-of-week + validity window + time overlap
       (b.is_recurring
          and extract(dow from p_date)::int = any (b.days_of_week)
          and (b.valid_from is null or p_date >= b.valid_from)
          and (b.valid_to   is null or p_date <= b.valid_to)
          and b.start_time < p_end
          and b.end_time   > p_start)
     )
     -- an exception that fully covers the requested range opens it
     and not exists (
       select 1 from block_exceptions e
        where e.block_id = b.id
          and e.exception_date = p_date
          and e.start_time <= p_start
          and e.end_time   >= p_end
     )
   order by case b.block_type when 'closure' then 1 when 'maintenance' then 2 else 3 end
   limit 1;
$$;

revoke all on function public.facility_block_type(text, date, time, time) from public, anon;
grant execute on function public.facility_block_type(text, date, time, time) to authenticated;

-- Public label for a block type, shared by get_facility_slots and the grid.
create or replace function public.block_type_label(p_type text) returns text
language sql immutable
as $$
  select case p_type
    when 'closure' then 'Closed'
    when 'maintenance' then 'Under Maintenance'
    when 'badminton_members' then 'Members Only'
    else null end;
$$;
grant execute on function public.block_type_label(text) to anon, authenticated;

-- ------------------------------------------------------------------
-- 5. get_facility_slots — read blocks through the helper.
--    Hall/Lawn: now evaluated per slot (Morning 08-14, Evening 16-22,
--    Full Day 08-22) instead of "any block that day blocks the whole day".
-- ------------------------------------------------------------------
create or replace function public.get_facility_slots(p_facility_id text, p_date date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_type text;
  v_capacity int;
  v_open time;
  v_close time;
  v_result jsonb;
begin
  select type, capacity, open_time, close_time
    into v_type, v_capacity, v_open, v_close
    from facilities
   where id = p_facility_id and active = true;

  if v_type is null then
    return jsonb_build_object('error', 'unknown facility');
  end if;

  if v_type in ('hall', 'lawn') then
    declare
      v_morning_status text := 'Available';
      v_evening_status text := 'Available';
      v_fullday_status text := 'Available';
      v_bm text; v_be text;
      r record;
    begin
      v_bm := facility_block_type(p_facility_id, p_date, time '08:00', time '14:00');
      v_be := facility_block_type(p_facility_id, p_date, time '16:00', time '22:00');

      if v_bm is not null then v_morning_status := block_type_label(v_bm); end if;
      if v_be is not null then v_evening_status := block_type_label(v_be); end if;
      if v_bm is not null or v_be is not null then
        v_fullday_status := block_type_label(coalesce(
          case when v_bm = 'closure' or v_be = 'closure' then 'closure' end,
          case when v_bm = 'maintenance' or v_be = 'maintenance' then 'maintenance' end,
          coalesce(v_bm, v_be)));
      end if;

      for r in
        select slot, status
          from booking_requests
         where facility_id = p_facility_id
           and booking_date = p_date
           and status = 'approved'
      loop
        if r.slot = 'full_day' then
          if v_morning_status = 'Available' then v_morning_status := 'Booked'; end if;
          if v_evening_status = 'Available' then v_evening_status := 'Booked'; end if;
          if v_fullday_status = 'Available' then v_fullday_status := 'Booked'; end if;
        elsif r.slot = 'morning' then
          if v_morning_status = 'Available' then v_morning_status := 'Booked'; end if;
          if v_fullday_status = 'Available' then v_fullday_status := 'Booked'; end if;
        elsif r.slot = 'evening' then
          if v_evening_status = 'Available' then v_evening_status := 'Booked'; end if;
          if v_fullday_status = 'Available' then v_fullday_status := 'Booked'; end if;
        end if;
      end loop;

      v_result := jsonb_build_object(
        'type', 'fixed',
        'slots', jsonb_build_object(
          'morning', jsonb_build_object('label', 'Morning (8am-2pm)', 'status', v_morning_status),
          'evening', jsonb_build_object('label', 'Evening (4pm-10pm)', 'status', v_evening_status),
          'full_day', jsonb_build_object('label', 'Full Day', 'status', v_fullday_status)
        )
      );
      return v_result;
    end;
  end if;

  if v_type in ('pool', 'badminton') then
    declare
      slots jsonb := '[]'::jsonb;
      h int;
      slot_start time;
      slot_end time;
      v_block text;
      v_has_exclusive_approved boolean;
      v_has_exclusive_pending boolean;
      v_guests_approved int;
      v_guests_pending int;
      v_status text;
      v_remaining int;
      v_has_approved boolean;
      v_has_pending boolean;
    begin
      h := extract(hour from v_open)::int;
      while h < extract(hour from v_close)::int loop
        slot_start := make_time(h, 0, 0);
        slot_end := make_time(h + 1, 0, 0);

        v_block := facility_block_type(p_facility_id, p_date, slot_start, slot_end);

        if v_type = 'pool' then
          select exists (
            select 1 from hourly_bookings
             where facility_id = p_facility_id and booking_date = p_date
               and status = 'approved' and mode = 'exclusive'
               and (start_time, end_time) overlaps (slot_start, slot_end)
          ) into v_has_exclusive_approved;

          select exists (
            select 1 from hourly_bookings
             where facility_id = p_facility_id and booking_date = p_date
               and status = 'pending' and mode = 'exclusive'
               and (start_time, end_time) overlaps (slot_start, slot_end)
          ) into v_has_exclusive_pending;

          select coalesce(sum(guests), 0) into v_guests_approved
            from hourly_bookings
           where facility_id = p_facility_id and booking_date = p_date
             and status = 'approved'
             and (start_time, end_time) overlaps (slot_start, slot_end);

          select coalesce(sum(guests), 0) into v_guests_pending
            from hourly_bookings
           where facility_id = p_facility_id and booking_date = p_date
             and status = 'pending'
             and (start_time, end_time) overlaps (slot_start, slot_end);

          v_remaining := greatest(coalesce(v_capacity, 0) - v_guests_approved - v_guests_pending, 0);

          if v_block is not null then
            v_status := block_type_label(v_block);
            v_remaining := 0;
          elsif v_has_exclusive_approved then
            v_status := 'Booked'; v_remaining := 0;
          elsif v_has_exclusive_pending then
            v_status := 'Pending'; v_remaining := 0;
          elsif coalesce(v_capacity, 0) - v_guests_approved <= 0 then
            v_status := 'Booked';
          elsif v_remaining <= 0 then
            v_status := 'Pending';
          else
            v_status := 'Available';
          end if;

          slots := slots || jsonb_build_object(
            'start', to_char(slot_start, 'HH24:MI'),
            'end', to_char(slot_end, 'HH24:MI'),
            'status', v_status,
            'remaining', v_remaining,
            'capacity', v_capacity
          );
        else
          select exists (
            select 1 from hourly_bookings
             where facility_id = p_facility_id and booking_date = p_date
               and status = 'approved'
               and (start_time, end_time) overlaps (slot_start, slot_end)
          ) into v_has_approved;

          select exists (
            select 1 from hourly_bookings
             where facility_id = p_facility_id and booking_date = p_date
               and status = 'pending'
               and (start_time, end_time) overlaps (slot_start, slot_end)
          ) into v_has_pending;

          v_status := case
            when v_block is not null then block_type_label(v_block)
            when v_has_approved then 'Booked'
            when v_has_pending then 'Pending'
            else 'Available'
          end;

          slots := slots || jsonb_build_object(
            'start', to_char(slot_start, 'HH24:MI'),
            'end', to_char(slot_end, 'HH24:MI'),
            'status', v_status
          );
        end if;

        h := h + 1;
      end loop;

      v_result := jsonb_build_object('type', 'hourly', 'bookingModel', case when v_type = 'pool' then 'capacity' else 'resource' end, 'slots', slots);
      return v_result;
    end;
  end if;

  return jsonb_build_object('error', 'unsupported facility type');
end;
$function$;

-- ------------------------------------------------------------------
-- 6. check_hourly_capacity — block enforcement via the helper (replaces the
--    facility_reserved_windows / reserved_window_unblocks check). Blocks are
--    enforced on INSERT and on any UPDATE that changes facility/date/time, so
--    a status or payment edit on an existing booking is never rejected by a
--    block added later.
-- ------------------------------------------------------------------
create or replace function public.check_hourly_capacity()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  fac_capacity int;
  guests_booked int;
  has_exclusive boolean;
  v_block text;
  v_schedule_changed boolean;
begin
  if new.status not in ('pending','approved') then
    return new; -- rejected/cancelled rows never consume capacity
  end if;

  select capacity into fac_capacity from facilities where id = new.facility_id;

  v_schedule_changed := (tg_op = 'INSERT')
    or old.facility_id is distinct from new.facility_id
    or old.booking_date is distinct from new.booking_date
    or old.start_time  is distinct from new.start_time
    or old.end_time    is distinct from new.end_time;

  if v_schedule_changed then
    v_block := facility_block_type(new.facility_id, new.booking_date, new.start_time, new.end_time);
    if v_block = 'badminton_members' then
      raise exception 'This time is within the members-reserved hours for % and hasn''t been opened for public booking on %.', new.facility_id, new.booking_date;
    elsif v_block = 'maintenance' then
      raise exception '% is under maintenance on % between % and %.', new.facility_id, new.booking_date, new.start_time, new.end_time;
    elsif v_block = 'closure' then
      raise exception '% is closed on %.', new.facility_id, new.booking_date;
    end if;
  end if;

  if fac_capacity is not null and new.guests > fac_capacity then
    raise exception 'Capacity exceeded for % on % between % and % (booked 0 + requested % > capacity %)',
      new.facility_id, new.booking_date, new.start_time, new.end_time, new.guests, fac_capacity;
  end if;

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
$function$;

-- ------------------------------------------------------------------
-- 7. NEW: block enforcement for Hall/Lawn booking_requests. Previously only
--    the UI hid blocked slots — nothing at the database stopped a request
--    landing on a blocked date.
-- ------------------------------------------------------------------
create or replace function public.check_booking_request_block()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_start time; v_end time; v_block text; v_changed boolean;
begin
  if new.status not in ('pending','approved') then return new; end if;

  v_changed := (tg_op = 'INSERT')
    or old.facility_id  is distinct from new.facility_id
    or old.booking_date is distinct from new.booking_date
    or old.slot         is distinct from new.slot;
  if not v_changed then return new; end if;

  v_start := case new.slot when 'evening' then time '16:00' else time '08:00' end;
  v_end   := case new.slot when 'morning' then time '14:00' else time '22:00' end;

  v_block := facility_block_type(new.facility_id, new.booking_date, v_start, v_end);
  if v_block = 'closure' then
    raise exception '% is closed on %.', new.facility_id, new.booking_date;
  elsif v_block is not null then
    raise exception '% is blocked (%) on % for the % slot.', new.facility_id, block_type_label(v_block), new.booking_date, new.slot;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_check_booking_request_block on booking_requests;
create trigger trg_check_booking_request_block
  before insert or update on booking_requests
  for each row execute function check_booking_request_block();

-- ------------------------------------------------------------------
-- 8. Admin grid RPC: per-hour (or per-slot for Hall/Lawn) block picture for
--    one facility on one date, including which block/exception is behind it,
--    so the admin page can toggle hours without re-implementing the rules.
-- ------------------------------------------------------------------
create or replace function public.get_block_grid(p_facility_id text, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_type text; v_open time; v_close time;
  tiles jsonb := '[]'::jsonb;
  starts time[] := '{}'; ends time[] := '{}';
  h int; i int; s time; e time;
  b_id uuid; b_group uuid; b_type text; b_reason text; b_rec boolean;
  ex_id uuid; ex_reason text;
  v_tile jsonb;
begin
  if not private.is_staff() then
    raise exception 'not authorised';
  end if;

  select type, open_time, close_time into v_type, v_open, v_close
    from facilities where id = p_facility_id;
  if v_type is null then return jsonb_build_object('error','unknown facility'); end if;

  if v_type in ('hall','lawn') then
    starts := array[time '08:00', time '16:00'];
    ends   := array[time '14:00', time '22:00'];
  else
    h := extract(hour from v_open)::int;
    while h < extract(hour from v_close)::int loop
      starts := starts || make_time(h,0,0);
      ends   := ends   || make_time(h+1,0,0);
      h := h + 1;
    end loop;
  end if;

  for i in 1 .. coalesce(array_length(starts,1),0) loop
    s := starts[i]; e := ends[i];
    b_id := null; b_group := null; b_type := null; b_reason := null; b_rec := null;
    ex_id := null; ex_reason := null;

    -- highest-priority block covering this tile, ignoring exceptions
    select bb.id, bb.group_id, bb.block_type, bb.reason, bb.is_recurring
      into b_id, b_group, b_type, b_reason, b_rec
      from blocks bb
     where bb.facility_id = p_facility_id and bb.active
       and (
         (not bb.is_recurring
            and bb.start_at < ((p_date + e) at time zone 'Asia/Kolkata')
            and bb.end_at   > ((p_date + s) at time zone 'Asia/Kolkata'))
         or
         (bb.is_recurring
            and extract(dow from p_date)::int = any (bb.days_of_week)
            and (bb.valid_from is null or p_date >= bb.valid_from)
            and (bb.valid_to   is null or p_date <= bb.valid_to)
            and bb.start_time < e and bb.end_time > s)
       )
     order by case bb.block_type when 'closure' then 1 when 'maintenance' then 2 else 3 end
     limit 1;

    if b_id is null then
      v_tile := jsonb_build_object('start', to_char(s,'HH24:MI'), 'end', to_char(e,'HH24:MI'), 'state', 'open');
    else
      select x.id, x.reason into ex_id, ex_reason
        from block_exceptions x
       where x.block_id = b_id and x.exception_date = p_date
         and x.start_time <= s and x.end_time >= e
       limit 1;
      v_tile := jsonb_build_object(
        'start', to_char(s,'HH24:MI'), 'end', to_char(e,'HH24:MI'),
        'state', case when ex_id is null then 'blocked' else 'opened' end,
        'block_id', b_id, 'group_id', b_group, 'block_type', b_type,
        'label', block_type_label(b_type), 'reason', b_reason,
        'is_recurring', b_rec,
        'exception_id', ex_id, 'exception_reason', ex_reason
      );
    end if;
    tiles := tiles || v_tile;
  end loop;

  return jsonb_build_object('type', case when v_type in ('hall','lawn') then 'fixed' else 'hourly' end, 'tiles', tiles);
end;
$function$;

revoke all on function public.get_block_grid(text, date) from public, anon;
grant execute on function public.get_block_grid(text, date) to authenticated;

-- ------------------------------------------------------------------
-- 9. member_hours_open no longer drives anything; leave the column, note it.
-- ------------------------------------------------------------------
comment on column facilities.member_hours_open is 'Deprecated by 021_unified_blocks: member hours are now badminton_members rows in blocks.';
comment on table facility_reserved_windows is 'Deprecated by 021_unified_blocks (migrated into blocks). Kept for rollback; safe to drop later.';
comment on table reserved_window_unblocks is 'Deprecated by 021_unified_blocks (migrated into block_exceptions). Kept for rollback; safe to drop later.';
