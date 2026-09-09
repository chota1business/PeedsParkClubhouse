-- Restored from the applied production migration history; no customer data.
drop view if exists manager_activity_feed;

create view manager_activity_feed as
 SELECT 'enquiry'::text AS record_type,
    enquiries.id,
    enquiries.enquiry_code AS code,
    enquiries.customer_name,
    enquiries.phone,
    enquiries.email,
    enquiries.facility_id,
    enquiries.preferred_date AS activity_date,
    NULL::text AS slot,
    NULL::time without time zone AS start_time,
    NULL::time without time zone AS end_time,
    enquiries.status,
    NULL::text AS payment_status,
    NULL::numeric AS total_amount,
    NULL::numeric AS amount_paid,
    'online'::text AS booking_source,
    enquiries.message AS notes,
    enquiries.created_at,
    enquiries.updated_at,
    enquiries.customer_id
   FROM enquiries
UNION ALL
 SELECT 'hall_lawn_booking'::text AS record_type,
    booking_requests.id,
    booking_requests.booking_code AS code,
    booking_requests.customer_name,
    booking_requests.phone,
    booking_requests.email,
    booking_requests.facility_id,
    booking_requests.booking_date AS activity_date,
    booking_requests.slot,
    NULL::time without time zone AS start_time,
    NULL::time without time zone AS end_time,
    booking_requests.status,
    booking_requests.payment_status,
    booking_requests.total_amount,
    booking_requests.amount_paid,
    booking_requests.booking_source,
    booking_requests.notes,
    booking_requests.created_at,
    booking_requests.updated_at,
    booking_requests.customer_id
   FROM booking_requests
UNION ALL
 SELECT 'hourly_booking'::text AS record_type,
    hourly_bookings.id,
    hourly_bookings.booking_code AS code,
    hourly_bookings.customer_name,
    hourly_bookings.phone,
    hourly_bookings.email,
    hourly_bookings.facility_id,
    hourly_bookings.booking_date AS activity_date,
    NULL::text AS slot,
    hourly_bookings.start_time,
    hourly_bookings.end_time,
    hourly_bookings.status,
    hourly_bookings.payment_status,
    hourly_bookings.total_amount,
    hourly_bookings.amount_paid,
    hourly_bookings.booking_source,
    NULL::text AS notes,
    hourly_bookings.created_at,
    hourly_bookings.updated_at,
    hourly_bookings.customer_id
   FROM hourly_bookings;

grant select, insert, update, delete, truncate, references, trigger on manager_activity_feed to authenticated, anon, service_role, postgres;

alter view manager_activity_feed set (security_invoker = true);
