-- Restored from the applied production migration history; no customer data.
-- Aggregated stats for the new Admin analytics dashboard: cash inflow,
-- occupancy, enquiry funnel, status snapshot, revenue per facility + total.
-- Staff-only (checked explicitly, not just relying on RLS, since this
-- deliberately reads across all facilities/customers in one call).
--
-- Basis note: cash inflow / revenue use approved_at (when a booking was
-- approved and its payment amount recorded) as "when the money counts" --
-- this is the only payment timestamp the schema has. A later "Update
-- Payment" top-up on an already-approved booking does NOT move its
-- approved_at, so a top-up doesn't shift which period it's counted in.
-- Good enough for a manual, no-ledger payment system; a real payment
-- ledger table would be needed for exact day-by-day cash accounting.
create or replace function public.get_dashboard_stats(p_start date, p_end date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_days int;
  v_result jsonb;
  v_cash_inflow numeric;
  v_revenue_by_facility jsonb;
  v_occupancy jsonb;
  v_funnel jsonb;
  v_status_snapshot jsonb;
begin
  if not private.is_staff() then
    raise exception 'Not authorised';
  end if;

  if p_end < p_start then
    return jsonb_build_object('error', 'end date before start date');
  end if;
  v_days := (p_end - p_start) + 1;

  -- Cash inflow: total amount_paid across both booking tables, attributed
  -- to the day the booking was approved.
  select coalesce(sum(amount_paid), 0) into v_cash_inflow
  from (
    select amount_paid from booking_requests
     where approved_at is not null and approved_at::date between p_start and p_end
    union all
    select amount_paid from hourly_bookings
     where approved_at is not null and approved_at::date between p_start and p_end
  ) x;

  -- Revenue per facility (same basis as cash inflow above).
  select coalesce(jsonb_object_agg(facility_id, total), '{}'::jsonb) into v_revenue_by_facility
  from (
    select facility_id, sum(amount_paid) as total
    from (
      select facility_id, amount_paid from booking_requests
       where approved_at is not null and approved_at::date between p_start and p_end
      union all
      select facility_id, amount_paid from hourly_bookings
       where approved_at is not null and approved_at::date between p_start and p_end
    ) y
    group by facility_id
  ) z;

  -- Occupancy per facility type over the period.
  --   Hall/Lawn: slot-halves used (full_day = 2 halves) / (days * 2 halves) per facility.
  --   Pool: guest-hours booked / (days * open_hours * capacity).
  --   Badminton: hours booked / (days * open_hours), per court.
  with hall_lawn_occ as (
    select f.id as facility_id, f.name,
      coalesce(sum(case when br.slot = 'full_day' then 2 when br.slot in ('morning','evening') then 1 else 0 end), 0) as used_halves,
      v_days * 2 as capacity_halves
    from facilities f
    left join booking_requests br
      on br.facility_id = f.id and br.status = 'approved' and br.booking_date between p_start and p_end
    where f.type in ('hall', 'lawn')
    group by f.id, f.name
  ),
  pool_occ as (
    select f.id as facility_id, f.name,
      coalesce(sum(extract(epoch from (hb.end_time - hb.start_time)) / 3600.0 * hb.guests), 0) as guest_hours_used,
      v_days * (extract(hour from f.close_time) - extract(hour from f.open_time)) * coalesce(f.capacity, 1) as capacity_guest_hours
    from facilities f
    left join hourly_bookings hb
      on hb.facility_id = f.id and hb.status = 'approved' and hb.booking_date between p_start and p_end
    where f.type = 'pool'
    group by f.id, f.name, f.open_time, f.close_time, f.capacity
  ),
  badminton_occ as (
    select f.id as facility_id, f.name,
      coalesce(sum(extract(epoch from (hb.end_time - hb.start_time)) / 3600.0), 0) as hours_used,
      v_days * (extract(hour from f.close_time) - extract(hour from f.open_time)) as capacity_hours
    from facilities f
    left join hourly_bookings hb
      on hb.facility_id = f.id and hb.status = 'approved' and hb.booking_date between p_start and p_end
    where f.type = 'badminton'
    group by f.id, f.name, f.open_time, f.close_time
  )
  select jsonb_object_agg(facility_id, jsonb_build_object('name', name, 'occupancy_pct', occupancy_pct))
    into v_occupancy
  from (
    select facility_id, name,
      case when capacity_halves > 0 then round(100.0 * used_halves / capacity_halves, 1) else 0 end as occupancy_pct
    from hall_lawn_occ
    union all
    select facility_id, name,
      case when capacity_guest_hours > 0 then round(100.0 * guest_hours_used / capacity_guest_hours, 1) else 0 end as occupancy_pct
    from pool_occ
    union all
    select facility_id, name,
      case when capacity_hours > 0 then round(100.0 * hours_used / capacity_hours, 1) else 0 end as occupancy_pct
    from badminton_occ
  ) all_occ;

  -- Enquiry funnel: counts by status, for enquiries created in the period.
  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) into v_funnel
  from (
    select status, count(*) as cnt
    from enquiries
    where created_at::date between p_start and p_end
    group by status
  ) e;

  -- Status snapshot: booking status counts (both tables combined), for
  -- bookings created in the period.
  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) into v_status_snapshot
  from (
    select status, count(*) as cnt
    from (
      select status, created_at from booking_requests where created_at::date between p_start and p_end
      union all
      select status, created_at from hourly_bookings where created_at::date between p_start and p_end
    ) b
    group by status
  ) s;

  v_result := jsonb_build_object(
    'start', p_start, 'end', p_end, 'days', v_days,
    'cash_inflow', v_cash_inflow,
    'revenue_by_facility', v_revenue_by_facility,
    'revenue_total', v_cash_inflow,
    'occupancy', v_occupancy,
    'enquiry_funnel', v_funnel,
    'status_snapshot', v_status_snapshot
  );
  return v_result;
end;
$function$;

revoke execute on function public.get_dashboard_stats(date, date) from anon;
