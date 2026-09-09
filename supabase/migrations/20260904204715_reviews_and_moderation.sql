-- Restored from the applied production migration history; no customer data.
-- Customer reviews / testimonials — public submission, staff-moderated
-- before anything shows on the site. Mirrors the enquiries/booking_requests
-- pattern already in use: no public INSERT/UPDATE policy on the table
-- itself, a SECURITY DEFINER RPC (submit_review) does the insert, the
-- existing generic check_submission_rate_limit() and trigger_notify_owner()
-- triggers are reused as-is.

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text not null,
  -- Free-text facility label, not an FK to facilities(id) — badminton has
  -- two separate court rows (badminton_1/badminton_2) for booking purposes,
  -- but a reviewer just says "Badminton", not which court. Kept intentionally
  -- looser than the booking tables' facility_id for that reason.
  facility_group text,
  rating smallint not null,
  review_text text not null,
  status text not null default 'pending',
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.staff(id),
  constraint reviews_rating_check check (rating between 1 and 5),
  constraint reviews_status_check check (status in ('pending','approved','rejected')),
  constraint reviews_facility_group_check check (
    facility_group is null or facility_group in ('ac_hall','non_ac_hall','lawn','pool','badminton')
  ),
  constraint reviews_text_length_check check (char_length(review_text) between 5 and 2000)
);

comment on table public.reviews is 'Customer-submitted reviews/testimonials. Public can insert (via submit_review RPC only) and read approved rows; staff moderate (approve/reject/feature) via the admin portal.';
comment on column public.reviews.facility_group is 'Free-text facility label (not an FK) — badminton has 2 court rows for booking but reviewers just say "Badminton".';

create index reviews_status_idx on public.reviews (status);
create index reviews_created_at_idx on public.reviews (created_at desc);

alter table public.reviews enable row level security;

-- Public can read only approved reviews — same shape as facilities_public_read,
-- appropriate here because an approved review is meant to be public-facing
-- (unlike enquiries, which are private CRM data staff-only).
create policy reviews_public_read on public.reviews
  for select
  using (status = 'approved');

create policy reviews_staff_select on public.reviews
  for select
  using (private.is_staff());

create policy reviews_staff_update on public.reviews
  for update
  using (private.is_staff());

create policy reviews_admin_delete on public.reviews
  for delete
  using (private.is_admin());

-- Reuse the existing generic rate-limit trigger (keys off phone + created_at,
-- table-name-agnostic) — same guard already protecting enquiries/bookings.
create trigger trg_rate_limit_reviews
  before insert on public.reviews
  for each row execute function check_submission_rate_limit();

-- Reuse the existing generic owner-notification trigger.
create trigger notify_owner_on_review
  after insert on public.reviews
  for each row execute function trigger_notify_owner('review');

-- Public submission entry point. SECURITY DEFINER so it can insert despite
-- the table having no public INSERT policy — same reasoning as
-- submit_enquiry(): anonymous visitors have no direct write access, the
-- function is the only door in, and it runs as its owner.
create or replace function public.submit_review(
  p_customer_name text,
  p_phone text,
  p_rating integer,
  p_review_text text,
  p_facility_group text default null
)
returns table(review_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  insert into reviews (customer_name, phone, rating, review_text, facility_group)
  values (p_customer_name, p_phone, p_rating, p_review_text, p_facility_group)
  returning reviews.id into v_id;

  return query select v_id;
end;
$$;

grant execute on function public.submit_review(text, text, integer, text, text) to anon, authenticated;
