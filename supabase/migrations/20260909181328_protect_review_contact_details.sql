-- Public reviews expose display fields only; contact details stay admin-only.
revoke select on public.reviews from anon;
grant select (customer_name, rating, review_text, facility_group, is_featured, created_at, status) on public.reviews to anon;
-- Table-level grants for authenticated admins are still filtered by RLS.
-- Do not let arbitrary signed-in accounts inherit the public review policy.
alter policy reviews_public_read on public.reviews to anon;
notify pgrst, 'reload schema';
