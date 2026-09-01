-- Phase 10 cleanup: fix advisor findings introduced by this phase's own
-- migrations (015/017) rather than leaving them for later. Everything else
-- get_advisors flagged is pre-existing from earlier phases and untouched.

-- function_search_path_mutable: normalize_phone had no search_path pinned.
-- It's a pure SQL function with no schema-qualified references, so this is
-- low-risk, but pin it anyway for the same reason every other function in
-- this schema does (defence against search_path hijacking).
alter function private.normalize_phone(text) set search_path = public;

-- unindexed_foreign_keys: the two new FKs from migration 017.
create index if not exists idx_facility_reserved_windows_facility
  on facility_reserved_windows (facility_id);
create index if not exists idx_reserved_window_unblocks_created_by
  on reserved_window_unblocks (created_by);
