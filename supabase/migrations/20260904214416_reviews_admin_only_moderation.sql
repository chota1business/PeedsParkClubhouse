-- Restored from the applied production migration history; no customer data.
-- Reviews moderation was originally Manager+Admin (reviews_staff_select /
-- reviews_staff_update, using private.is_staff()). Owner decided reviews
-- should be Admin-only, matching Blocks & Closures' access tier. Renamed to
-- match this codebase's existing naming convention for admin-only policies
-- (see blocks_admin_update / blocks_admin_insert on the blocks table) and
-- tightened from is_staff() to is_admin(). reviews_public_read (public,
-- approved-only) and reviews_admin_delete (already admin-only) are unchanged.

alter policy reviews_staff_select on public.reviews rename to reviews_admin_select;
alter policy reviews_admin_select on public.reviews using (private.is_admin());

alter policy reviews_staff_update on public.reviews rename to reviews_admin_update;
alter policy reviews_admin_update on public.reviews using (private.is_admin());
