-- Phase 3 bug fix, found during admin UI review (not a user report):
-- blocks_admin_delete (from 002_rls_policies.sql) restricted unblocking a
-- facility to Admins only. But the plan and the dashboard's own role design
-- say Managers get block/unblock as a day-to-day tool alongside Admins —
-- Managers run the facility day to day and need to be able to clear a
-- maintenance block without waiting on an Admin. Widen the delete policy to
-- any staff member (private.is_staff() = admin or manager), matching the
-- insert policy which was already staff-wide.

drop policy if exists blocks_admin_delete on blocks;

create policy blocks_staff_delete on blocks
  for delete
  using (private.is_staff());
