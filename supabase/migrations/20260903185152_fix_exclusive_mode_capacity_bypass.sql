-- Restored from the applied production migration history; no customer data.
create or replace function public.check_hourly_capacity()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
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

  -- Guest count must never exceed the facility's physical capacity, whether
  -- the booking is shared or exclusive — exclusive mode only changes whether
  -- OTHER bookings can overlap this time slot, it does not raise the room's
  -- actual capacity. Checked before the exclusive/overlap branch below so an
  -- exclusive booking can no longer skip this check entirely.
  if fac_capacity is not null and new.guests > fac_capacity then
    raise exception 'Capacity exceeded for % on % between % and % (booked 0 + requested % > capacity %)',
      new.facility_id, new.booking_date, new.start_time, new.end_time, new.guests, fac_capacity;
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
$function$;
