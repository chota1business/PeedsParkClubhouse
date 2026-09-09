-- Restored from the applied production migration history; no customer data.
-- Fix: the plan (and dashboard.html's own role description) says Managers get
-- "block/unblock slots" as a day-to-day tool, alongside Admins. But blocks_admin_delete
-- restricted unblocking (= deleting a block row, since blocks has no "cancelled"
-- status of its own) to Admins only — inconsistent with the stated design.
-- Caught by cross-checking the new Unblock UI against the original role design,
-- not by a user report.
drop policy blocks_admin_delete on blocks;
create policy blocks_staff_delete on blocks for delete using (private.is_staff());
