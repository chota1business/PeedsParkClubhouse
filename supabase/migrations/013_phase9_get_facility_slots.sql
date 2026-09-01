-- Phase 9 (2/4): get_facility_slots() — powers the homepage's "click a slot
-- to book it" availability picker (ported/improved from the old site's
-- Apps Script availability endpoint). Computed server-side, from the same
-- tables check_hourly_capacity() and the booking pages already use, so the
-- picker can never show something as available that the DB would then
-- reject at submit time.
--
-- Returns one JSON shape for hall/lawn (type "fixed": Morning/Evening/Full
-- Day, each Available/Pending/Booked/Blocked) and another for pool/
-- badminton (type "hourly": one row per hour between the facility's
-- open_time/close_time).
--
-- SECURITY DEFINER + granted to anon: this only ever reads already-public
-- availability information (the same thing public_availability exposes),
-- never anything a customer shouldn't see, and takes no rate-limited or
-- mutating action — same trust boundary as the public_availability view.

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
          -- (badminton_1 / badminton_2), capacity 1 — simple booked/available.
          select exists (
            select 1 from hourly_bookings
             where facility_id = p_facility_id
               and booking_date = p_date
               and status in ('pending', 'approved')
               and (start_time, end_time) overlaps (slot_start, slot_end)
          ) into v_has_exclusive; -- reused as "taken" flag here

          v_status := case
            when v_blocked then 'Blocked'
            when v_has_exclusive then 'Booked'
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
