-- Restored from the applied production migration history; no customer data.
-- Bug fix (batch dated after 8.7): "Add Enquiry" from both the Enquiries
-- page and Manager Feed sends p_source: 'phone' for a staff-logged phoned-in
-- enquiry, but enquiries_source_check only allowed
-- google/facebook/instagram/whatsapp/direct/other — 'phone' was never a
-- valid value, so every phoned-in Add Enquiry failed with a check-constraint
-- violation. Fix: add 'phone' as a real, meaningful source value rather than
-- folding it into 'other' (it's genuinely useful to distinguish phoned-in
-- leads in reporting).
alter table public.enquiries drop constraint enquiries_source_check;
alter table public.enquiries add constraint enquiries_source_check
  check (source = any (array['google','facebook','instagram','whatsapp','direct','phone','other']));
