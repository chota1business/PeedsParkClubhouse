-- Restored from the applied production migration history; no customer data.
-- 1. Pool capacity 8 -> 25
update facilities set capacity = 25 where id = 'pool';

-- 2. Payment amount tracking on booking_requests (Hall/Lawn)
alter table booking_requests
  add column if not exists total_amount numeric(10,2),
  add column if not exists amount_paid numeric(10,2) not null default 0,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists enquiry_id uuid references enquiries(id);

-- 3. Payment amount tracking on hourly_bookings (Pool/Badminton) -- these had
--    no payment tracking at all before.
alter table hourly_bookings
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists total_amount numeric(10,2),
  add column if not exists amount_paid numeric(10,2) not null default 0,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists enquiry_id uuid references enquiries(id);

alter table hourly_bookings
  drop constraint if exists hourly_bookings_payment_status_check;
alter table hourly_bookings
  add constraint hourly_bookings_payment_status_check
  check (payment_status in ('unpaid','partial','received'));

-- 4. get_facility_slots: Hall/Lawn no longer blocked by a merely-pending
--    request (owner: approval can take days, don't want the slot to look
--    taken to other customers in the meantime). Pool/Badminton unchanged --
--    still block on pending too. The uq_booking_requests_approved_slot
--    unique index still prevents two requests for the same slot both being
--    approved, so this is safe: worst case two people request the same
--    slot and staff can only approve one of them.
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
             and status = 'approved'
        loop
          declare
            v_label text := 'Booked';
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
            v_status := 'Booked';
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
          select exists (
            select 1 from hourly_bookings
             where facility_id = p_facility_id
               and booking_date = p_date
               and status in ('pending', 'approved')
               and (start_time, end_time) overlaps (slot_start, slot_end)
          ) into v_has_exclusive;

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
$function$;

-- 5. Restrict maintenance blocks to Admin only (was any staff).
drop policy if exists blocks_staff_insert on blocks;
drop policy if exists blocks_staff_update on blocks;
drop policy if exists blocks_staff_delete on blocks;
create policy blocks_admin_insert on blocks for insert with check (private.is_admin());
create policy blocks_admin_update on blocks for update using (private.is_admin());
create policy blocks_admin_delete on blocks for delete using (private.is_admin());
-- blocks_staff_select stays as-is so managers can still see existing blocks.
