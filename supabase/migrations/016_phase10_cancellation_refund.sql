-- Phase 10 (2/3): cancellation reason + refund tracking.
--
-- Until now, cancelling a booking just flipped status to 'cancelled' — no
-- record of why, or what (if anything) was refunded. This adds a reason
-- and timestamp to both booking tables that support cancellation, and
-- refund tracking to booking_requests specifically (the only table with a
-- payment_status to refund against — hourly_bookings/Pool/Badminton still
-- don't track payment at all, unchanged from Phase 4/9).
--
-- Deliberately no refund_amount-in-rupees ledger beyond a free-text note:
-- there's no pricing table anywhere in this schema (facilities have no
-- price column — payment is still negotiated off-platform), so a numeric
-- amount field would have no total to be a percentage of. refund_notes is
-- where staff record what actually happened ("₹5000 refunded via UPI"),
-- consistent with how payment_status itself already works (a label, not a
-- ledger).

alter table booking_requests add column cancellation_reason text;
alter table booking_requests add column cancelled_at timestamptz;
alter table booking_requests add column refund_status text not null default 'none'
  check (refund_status = any (array['none', 'partial', 'full']));
alter table booking_requests add column refund_notes text;

alter table hourly_bookings add column cancellation_reason text;
alter table hourly_bookings add column cancelled_at timestamptz;

-- refund_status only makes sense once a booking is actually cancelled —
-- and only 'partial'/'full' should ever require a note explaining what
-- happened. Enforced here rather than left to the admin UI to remember.
alter table booking_requests add constraint booking_requests_refund_requires_cancelled_check
  check (refund_status = 'none' or status = 'cancelled');
