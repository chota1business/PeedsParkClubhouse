-- Phase 10 (3/3): wire up the previously-orphaned facilities.member_hours_open
-- column into an actual "members-reserved badminton hours" feature — the
-- old Apps Script site's BADMINTON_RESERVED_WINDOWS concept (05:00-08:00 and
-- 17:00-23:00 reserved for members by default; staff can "open" a specific
-- date's window for public booking).
--
-- member_hours_open semantics (finally defined): true = the reserved-window
-- restriction is ACTIVELY ENFORCED for that facility. It's a per-facility
-- feature flag, not a per-window one — only badminton_1/badminton_2 get it
-- set true below. Pool/Hall/Lawn have no such concept and stay false.
--
-- Two new tables:
--   facility_reserved_windows  — the standing reserved windows themselves
--                                 (seeded once here; not exposed for staff
--                                 to edit via UI in this phase — changing the
--                                 windows is a rare enough event to do via
--                                 SQL, same as facilities.open_time/close_time).
--   reserved_window_unblocks   — per-date staff overrides ("open Badminton
--                                 Court 1's evening reserved window on 14 Sep
--                                 for a tournament"). This is the table the
--                                 admin UI manages.

create table if not exists facility_reserved_windows (
  id          uuid primary key default gen_random_uuid(),
  facility_id text not null references facilities(id),
  start_time  time not null,
  end_time    time not null,
  constraint chk_reserved_window_time_order check (end_time > start_time)
);

insert into facility_reserved_windows (facility_id, start_time, end_time)
select f.id, w.start_time, w.end_time
from facilities f
cross join (values ('05:00'::time, '08:00'::time), ('17:00'::time, '23:00'::time)) as w(start_time, end_time)
where f.id in ('badminton_1', 'badminton_2')
  and not exists (
    select 1 from facility_reserved_windows existing
     where existing.facility_id = f.id
       and existing.start_time = w.start_time
       and existing.end_time = w.end_time
  );

create table if not exists reserved_window_unblocks (
  id            uuid primary key default gen_random_uuid(),
  facility_id   text not null references facilities(id),
  booking_date  date not null,
  start_time    time not null,
  end_time      time not null,
  reason        text,
  created_by    uuid references staff(id),
  created_at    timestamptz not null default now(),
  constraint chk_unblock_time_order check (end_time > start_time)
);
create index if not exists idx_reserved_window_unblocks_facility_date
  on reserved_window_unblocks (facility_id, booking_date);

comment on table facility_reserved_windows is 'Standing members-reserved time windows per facility (badminton courts only, for now). Edited via SQL, not the admin UI.';
comment on table reserved_window_unblocks is 'Per-date staff overrides that open a specific reserved window for public booking. Managed from the admin UI.';

-- RLS: staff-only, same pattern as blocks/audit_log elsewhere in the schema.
alter table facility_reserved_windows enable row level security;
alter table reserved_window_unblocks enable row level security;

create policy facility_reserved_windows_staff_select on facility_reserved_windows
  for select to authenticated using (private.is_staff());

create policy reserved_window_unblocks_staff_select on reserved_window_unblocks
  for select to authenticated using (private.is_staff());
create policy reserved_window_unblocks_staff_insert on reserved_window_unblocks
  for insert to authenticated with check (private.is_staff());
create policy reserved_window_unblocks_staff_delete on reserved_window_unblocks
  for delete to authenticated using (private.is_staff());

grant select on facility_reserved_windows to authenticated;
grant select, insert, delete on reserved_window_unblocks to authenticated;
revoke all on facility_reserved_windows from anon;
revoke all on reserved_window_unblocks from anon;

-- ============================================================
-- Enforce the rule server-side in check_hourly_capacity() — the same
-- trigger that already enforces capacity/exclusivity, so a submit_hourly_
-- booking() call for a reserved, un-opened window is rejected the same way
-- a full pool slot is: at the DB layer, regardless of what the client sent.
-- ============================================================
create or replace function check_hourly_capacity() returns trigger as $$
declare
  fac_capacity int;
  fac_member_hours_open boolean;
  guests_booked int;
  has_exclusive boolean;
begin
  if new.status not in ('pending','approved') then
    return new; -- rejected/cancelled rows never consume capacity
  end if;

  select capacity, member_hours_open into fac_capacity, fac_member_hours_open
    from facilities where id = new.facility_id;

  -- Members-reserved window check (badminton only, while the flag is on):
  -- reject unless staff explicitly opened a matching window for this date.
  if fac_member_hours_open and exists (
    select 1 from facility_reserved_windows
     where facility_id = new.facility_id
       and (start_time, end_time) overlaps (new.start_time, new.end_time)
  ) and not exists (
    select 1 from reserved_window_unblocks
     where facility_id = new.facility_id
       and booking_date = new.booking_date
       and start_time <= new.start_time
       and end_time >= new.end_time
  ) then
    raise exception 'This time is within the members-reserved hours for % and hasn''t been opened for public booking on %.', new.facility_id, new.booking_date;
  end if;

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

alter function check_hourly_capacity() set search_path = public;

-- ============================================================
-- get_facility_slots() — add a 'Reserved' status for badminton slots that
-- fall in a members-reserved window with no matching unblock, so the
-- picker shows the true state instead of a misleading 'Available'.
-- ============================================================
create or replace function public.get_facility_slots(p_facility_id text, p_date date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_type text;
  v_capacity int;
  v_open time;
  v_close time;
  v_member_hours_open boolean;
  v_result jsonb;
begin
  select type, capacity, open_time, close_time, member_hours_open
    into v_type, v_capacity, v_open, v_close, v_member_hours_open
    from facilities
   where id = p_facility_id and active = true;

  if v_type is null then
    return jsonb_build_object('error', 'unknown facility');
  end if;

  if v_type in ('hall', 'lawn') then
    -- Fixed slots: Morning 08:00-14:00, Evening 16:00-22:00, Full Day
    -- covers (and conflicts with) both. These times aren't stored per
    -- booking (booking_requests.slot is just a label) so they're fixed
    -- constants here, matching the old site's SLOT_TIMES exactly.
    declare
      v_morning_status text := 'Available';
      v_evening_status text := 'Available';
      v_fullday_status text := 'Available';
      v_blocked boolean;
      r record;
    begin
      select exists (
        select 1 from blocks
         where facility_id = p_facility_id
           and start_at < (p_date + time '23:59:59')
           and end_at > p_date
      ) into v_blocked;

      if v_blocked then
        v_morning_status := 'Blocked';
        v_evening_status := 'Blocked';
        v_fullday_status := 'Blocked';
      else
        for r in
          select slot, status
            from booking_requests
           where facility_id = p_facility_id
             and booking_date = p_date
             and status in ('pending', 'approved')
        loop
          declare
            v_label text := case when r.status = 'approved' then 'Booked' else 'Pending' end;
          begin
            if r.slot = 'full_day' then
              v_morning_status := v_label;
              v_evening_status := v_label;
              v_fullday_status := v_label;
            elsif r.slot = 'morning' then
              if v_morning_status = 'Available' then v_morning_status := v_label; end if;
              if v_fullday_status = 'Available' then v_fullday_status := v_label; end if;
            elsif r.slot = 'evening' then
              if v_evening_status = 'Available' then v_evening_status := v_label; end if;
              if v_fullday_status = 'Available' then v_fullday_status := v_label; end if;
            end if;
          end;
        end loop;
      end if;

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
      v_blocked boolean;
      v_has_exclusive boolean;
      v_guests_booked int;
      v_status text;
      v_remaining int;
      v_reserved boolean;
      v_unblocked boolean;
    begin
      h := extract(hour from v_open)::int;
      while h < extract(hour from v_close)::int loop
        slot_start := make_time(h, 0, 0);
        slot_end := make_time(h + 1, 0, 0);

        select exists (
          select 1 from blocks
           where facility_id = p_facility_id
             and start_at < (p_date + slot_end)
             and end_at > (p_date + slot_start)
        ) into v_blocked;

        if v_type = 'pool' then
          select exists (
            select 1 from hourly_bookings
             where facility_id = p_facility_id
               and booking_date = p_date
               and status in ('pending', 'approved')
               and mode = 'exclusive'
               and (start_time, end_time) overlaps (slot_start, slot_end)
          ) into v_has_exclusive;

          select coalesce(sum(guests), 0) into v_guests_booked
            from hourly_bookings
           where facility_id = p_facility_id
             and booking_date = p_date
             and status in ('pending', 'approved')
             and (start_time, end_time) overlaps (slot_start, slot_end);

          v_remaining := greatest(coalesce(v_capacity, 0) - v_guests_booked, 0);

          if v_blocked then
            v_status := 'Blocked';
          elsif v_has_exclusive then
            v_status := 'Booked'; -- exclusive booking, whole pool taken
            v_remaining := 0;
          elsif v_remaining <= 0 then
            v_status := 'Full';
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
          -- Badminton: this facility_id is already one specific court
          -- (badminton_1 / badminton_2), capacity 1 — simple booked/available,
          -- plus a Reserved status for members-only hours nobody's opened.
          select exists (
            select 1 from hourly_bookings
             where facility_id = p_facility_id
               and booking_date = p_date
               and status in ('pending', 'approved')
               and (start_time, end_time) overlaps (slot_start, slot_end)
          ) into v_has_exclusive; -- reused as "taken" flag here

          v_reserved := false;
          if v_member_hours_open then
            select exists (
              select 1 from facility_reserved_windows
               where facility_id = p_facility_id
                 and (start_time, end_time) overlaps (slot_start, slot_end)
            ) into v_reserved;

            if v_reserved then
              select exists (
                select 1 from reserved_window_unblocks
                 where facility_id = p_facility_id
                   and booking_date = p_date
                   and start_time <= slot_start
                   and end_time >= slot_end
              ) into v_unblocked;
              if v_unblocked then
                v_reserved := false;
              end if;
            end if;
          end if;

          v_status := case
            when v_blocked then 'Blocked'
            when v_has_exclusive then 'Booked'
            when v_reserved then 'Reserved'
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
$$;

grant execute on function public.get_facility_slots(text, date) to anon, authenticated;

-- Flip the flag on: this is what actually turns the feature on for the two
-- badminton courts. Pool/Hall/Lawn stay at their existing false default.
update facilities set member_hours_open = true where id in ('badminton_1', 'badminton_2');
