-- Restored from the applied production migration history; no customer data.
create or replace function public.get_dashboard_facility_counts()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
begin
  if not private.is_staff() then
    raise exception 'Not authorised';
  end if;

  select jsonb_build_object(
    'club_house', jsonb_build_object(
      'bookings_pending', (
        select count(*) from booking_requests
        where facility_id in ('ac_hall','non_ac_hall','lawn') and status = 'pending'
      ),
      'enquiries_open', (
        select count(*) from enquiries
        where facility_id in ('ac_hall','non_ac_hall','lawn') and status in ('new','contacted','follow_up')
      )
    ),
    'pool', jsonb_build_object(
      'bookings_pending', (
        select count(*) from hourly_bookings
        where facility_id = 'pool' and status = 'pending'
      ),
      'enquiries_open', (
        select count(*) from enquiries
        where facility_id = 'pool' and status in ('new','contacted','follow_up')
      )
    ),
    'badminton', jsonb_build_object(
      'bookings_pending', (
        select count(*) from hourly_bookings
        where facility_id in ('badminton_1','badminton_2') and status = 'pending'
      ),
      'enquiries_open', (
        select count(*) from enquiries
        where facility_id in ('badminton_1','badminton_2') and status in ('new','contacted','follow_up')
      )
    )
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_dashboard_facility_counts() from public, anon;
grant execute on function public.get_dashboard_facility_counts() to authenticated;
