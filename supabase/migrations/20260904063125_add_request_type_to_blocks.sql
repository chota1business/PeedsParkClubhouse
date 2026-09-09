-- Restored from the applied production migration history; no customer data.
-- Adds a structured "Request type" to the block/unblock form (user request):
-- Badminton time slot block / Maintenance / Facility closure. Nullable so
-- existing historical blocks (created before this field existed) aren't
-- affected — new blocks are required to set it client-side.
alter table blocks add column if not exists request_type text;
alter table blocks drop constraint if exists blocks_request_type_check;
alter table blocks add constraint blocks_request_type_check
  check (request_type is null or request_type in ('badminton_time_slot_block', 'maintenance', 'facility_closure'));
