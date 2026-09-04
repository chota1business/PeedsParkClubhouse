// PeedsPark Admin — Hall/Lawn booking management + block/unblock (Phase 3)

const BOOKING_STATUS_COLORS = { pending: "#D9A441", approved: "#2E9E5B", rejected: "#B33A3A", cancelled: "#8A8A8A" };
const FACILITY_LABELS = { ac_hall: "AC Hall", non_ac_hall: "Non-AC Hall", lawn: "Lawn" };
const HALL_LAWN_IDS = ["ac_hall", "non_ac_hall", "lawn"];

let staff = null;
let allBookings = [];
let allEnquiries = [];
let activeFilter = "all";
let listControls = null;

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireStaffSession();
  if (!session) return;
  staff = session.staff;

  document.getElementById("staffName").textContent = staff.full_name;
  document.getElementById("staffRole").textContent = staff.role;
  document.getElementById("pageContent").hidden = false;

  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeFilter = chip.dataset.status;
      listControls?.resetPage();
      renderBookings();
    });
  });

  listControls = createListControls({
    searchInputId: "bookingSearch",
    dateFromId: "bookingDateFrom",
    dateToId: "bookingDateTo",
    pagerContainerId: "bookingPager",
    searchText: (r) => `${r.customer_name} ${r.phone}`,
    dateField: (r) => r._kind === "enquiry" ? r.preferred_date : r.booking_date,
    onChange: renderBookings,
  });

  wireEditBookingModal();
  wireEnquiryModal();
  await Promise.all([loadBookings(), loadEnquiries()]);
});

async function loadBookings() {
  const { data, error } = await supabaseClient
    .from("booking_requests")
    .select("*")
    .order("booking_date", { ascending: true });

  if (error) {
    document.getElementById("bookingList").innerHTML = `<p class="muted center" style="padding:40px;">Couldn't load bookings: ${escapeHtml(error.message)}</p>`;
    return;
  }
  allBookings = (data || []).map(b => ({ ...b, _kind: "booking" }));
  listControls?.resetPage();
  renderBookings();
}

// Item 2 — this page (like Manager Feed) shows both enquiry and booking
// requests for its facilities, not just bookings.
async function loadEnquiries() {
  const { data, error } = await supabaseClient
    .from("enquiries")
    .select("*")
    .in("facility_id", HALL_LAWN_IDS)
    .order("preferred_date", { ascending: true });

  if (error) return; // non-fatal — bookings list still works on its own
  allEnquiries = (data || []).map(e => ({ ...e, _kind: "enquiry" }));
  renderBookings();
}

function renderBookings() {
  const container = document.getElementById("bookingList");
  let bookingRows = activeFilter === "all" ? allBookings : allBookings.filter(b => b.status === activeFilter);
  // Enquiries have no booking status, so they only show under "All" or
  // "Pending" (an un-actioned enquiry reads the same as a pending request).
  let enquiryRows = (activeFilter === "all" || activeFilter === "pending") ? allEnquiries : [];
  let rows = [...bookingRows, ...enquiryRows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  rows = listControls ? listControls.apply(rows) : rows;

  if (rows.length === 0) {
    container.innerHTML = `<p class="muted center" style="padding:40px;">No bookings or enquiries here.</p>`;
    listControls?.renderPager(0);
    return;
  }

  const page = listControls ? listControls.paginate(rows) : { rows };
  container.innerHTML = page.rows.map(r => r._kind === "enquiry" ? enquiryRowHtml(r) : bookingRowHtml(r)).join("");
  container.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => handleBookingAction(btn.dataset.id, btn.dataset.action, btn.dataset.kind));
  });
  listControls?.renderPager(rows.length);
}

function enquiryRowHtml(e) {
  const waLink = `https://wa.me/${(e.phone || "").replace(/\D/g, "")}`;
  const telLink = `tel:${(e.phone || "").replace(/\D/g, "")}`;
  return `
    <div class="enquiry-card" style="border-left-color:#7C6FBB;">
      <div class="enquiry-card-main">
        <div>
          <span class="row-kind-tag kind-enquiry">Enquiry</span>
          <strong>${escapeHtml(e.customer_name)}</strong>
          <span class="muted"> · ${escapeHtml(e.phone)}</span>
        </div>
        <div class="muted small">
          ${e.enquiry_code} · ${FACILITY_LABELS[e.facility_id] || "Not sure / multiple"}
          ${e.preferred_date ? " · " + e.preferred_date : ""}
          ${e.guests ? " · " + e.guests + " guests" : ""}
          · status: <strong>${e.status}</strong>
        </div>
        ${e.message ? `<p class="enquiry-message">${escapeHtml(e.message)}</p>` : ""}
      </div>
      <div class="enquiry-card-actions">
        <button class="btn btn-outline-dark btn-sm" data-id="${e.id}" data-kind="enquiry" data-action="edit">✏️ Edit</button>
        <a class="btn btn-outline-dark btn-sm" href="${waLink}" target="_blank" rel="noopener">💬 WhatsApp</a>
        <a class="btn btn-outline-dark btn-sm" href="${telLink}">📞 Call</a>
      </div>
    </div>`;
}

function bookingRowHtml(b) {
  const color = BOOKING_STATUS_COLORS[b.status] || "#999";
  const waLink = `https://wa.me/${b.phone.replace(/\D/g, "")}`;
  const telLink = `tel:${b.phone.replace(/\D/g, "")}`;
  // Every row gets exactly the same three actions now — Edit is the one
  // place status, payment and (once cancelled) refund get changed. Terminal
  // bookings (rejected/cancelled) have nothing left to edit, so they only
  // get WhatsApp/Call.
  const canEdit = b.status === "pending" || b.status === "approved";

  const cancelInfo = b.status === "cancelled" && (b.cancellation_reason || b.refund_status !== "none")
    ? `<div class="muted small">
        ${b.cancellation_reason ? "🚫 " + escapeHtml(b.cancellation_reason) : ""}
        ${b.refund_status !== "none" ? ` · refund: <strong>${b.refund_status}</strong>${b.refund_notes ? " — " + escapeHtml(b.refund_notes) : ""}` : ""}
      </div>`
    : "";

  return `
    <div class="enquiry-card" style="border-left-color:${color};">
      <div class="enquiry-card-main">
        <div>
          <span class="row-kind-tag kind-booking">Booking</span>
          <strong>${escapeHtml(b.customer_name)}</strong>
          <span class="muted"> · ${escapeHtml(b.phone)}</span>
        </div>
        <div class="muted small">
          ${b.booking_code} · ${FACILITY_LABELS[b.facility_id] || b.facility_id} · ${b.booking_date} · ${b.slot}
          ${b.guests ? " · " + b.guests + " guests" : ""}
          · payment: ${b.payment_status}${b.total_amount != null ? ` (₹${Number(b.amount_paid).toFixed(2)} of ₹${Number(b.total_amount).toFixed(2)})` : ""}
          · status: <strong>${b.status}</strong>
        </div>
        ${cancelInfo}
        ${b.notes ? `<p class="enquiry-message">${escapeHtml(b.notes)}</p>` : ""}
      </div>
      <div class="enquiry-card-actions">
        ${canEdit ? `<button class="btn btn-outline-dark btn-sm" data-id="${b.id}" data-kind="booking" data-action="edit">✏️ Edit</button>` : ""}
        <a class="btn btn-outline-dark btn-sm" href="${waLink}" target="_blank" rel="noopener">💬 WhatsApp</a>
        <a class="btn btn-outline-dark btn-sm" href="${telLink}">📞 Call</a>
      </div>
    </div>`;
}

async function handleBookingAction(id, action, kind) {
  if (kind === "enquiry") {
    const enquiry = allEnquiries.find(e => e.id === id);
    if (enquiry && action === "edit") openEnquiryModal(enquiry);
    return;
  }
  const booking = allBookings.find(b => b.id === id);
  if (!booking) return;
  if (action === "edit") return openEditBookingModal(booking);
}

// ---------- Edit Booking modal ----------
// Single place to change everything about a booking: status (approve a
// pending request, or cancel an approved one — replacing the old separate
// Reject/Cancel buttons), payment (total/paid), and — only once the
// booking is being set to cancelled — refund status/notes. Phone is shown
// but disabled, so it never leaves the form's payload.

// What status a booking can move to, from its current status.
const BOOKING_STATUS_OPTIONS = {
  pending: [["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"]],
  approved: [["approved", "Approved"], ["cancelled", "Cancelled"]],
};

function wireEditBookingModal() {
  const modal = document.getElementById("editBookingModal");
  document.getElementById("closeEditBookingBtn").addEventListener("click", () => { modal.hidden = true; });
  document.getElementById("editBookingForm").addEventListener("submit", submitEditBooking);
  document.getElementById("editBookingStatus").addEventListener("change", (e) => {
    document.getElementById("editCancelFields").hidden = e.target.value !== "cancelled";
  });
}

function openEditBookingModal(booking) {
  const modal = document.getElementById("editBookingModal");
  const form = document.getElementById("editBookingForm");
  document.getElementById("editBookingError").hidden = true;

  form.elements["id"].value = booking.id;
  form.elements["customer_name"].value = booking.customer_name;
  form.elements["phone"].value = booking.phone; // locked — shown for reference only
  form.elements["email"].value = booking.email || "";
  form.elements["facility_id"].value = booking.facility_id;
  form.elements["booking_date"].value = booking.booking_date;
  form.elements["slot"].value = booking.slot;
  form.elements["guests"].value = booking.guests || "";
  form.elements["notes"].value = booking.notes || "";
  form.elements["total_amount"].value = booking.total_amount ?? "";
  form.elements["amount_paid"].value = booking.amount_paid ?? "";
  form.elements["cancellation_reason"].value = booking.cancellation_reason || "";
  form.elements["refund_status"].value = booking.refund_status || "none";
  form.elements["refund_notes"].value = booking.refund_notes || "";

  const statusSelect = document.getElementById("editBookingStatus");
  const options = BOOKING_STATUS_OPTIONS[booking.status] || [[booking.status, booking.status]];
  statusSelect.innerHTML = options.map(([v, label]) => `<option value="${v}">${label}</option>`).join("");
  statusSelect.value = booking.status;
  document.getElementById("editCancelFields").hidden = booking.status !== "cancelled";

  modal.dataset.originalStatus = booking.status;
  modal.hidden = false;
}

async function submitEditBooking(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const errorEl = document.getElementById("editBookingError");
  errorEl.hidden = true;

  const modal = document.getElementById("editBookingModal");
  const originalStatus = modal.dataset.originalStatus;
  const booking = allBookings.find(b => b.id === data.id);
  if (!booking) return;

  const newStatus = data.status;
  const totalAmount = data.total_amount.trim() === "" ? null : Number(data.total_amount);
  const amountPaid = data.amount_paid.trim() === "" ? null : Number(data.amount_paid);

  if (totalAmount != null && (!Number.isFinite(totalAmount) || totalAmount < 0)) {
    errorEl.textContent = "Total amount must be 0 or more.";
    errorEl.hidden = false;
    return;
  }
  if (amountPaid != null && (!Number.isFinite(amountPaid) || amountPaid < 0)) {
    errorEl.textContent = "Amount paid must be 0 or more.";
    errorEl.hidden = false;
    return;
  }
  if (totalAmount != null && amountPaid != null && amountPaid > totalAmount) {
    errorEl.textContent = "Amount paid can't be more than the total amount.";
    errorEl.hidden = false;
    return;
  }

  // Approving a booking requires payment to have been recorded — no booking
  // gets confirmed to the customer without an amount entered first. Partial
  // payment is fine (Hall/Lawn/AC/Non-AC all allow it).
  if (newStatus === "approved" && originalStatus === "pending" && totalAmount == null) {
    errorEl.textContent = "Enter a total amount before approving this booking.";
    errorEl.hidden = false;
    return;
  }

  let paymentStatus = booking.payment_status;
  if (totalAmount != null || amountPaid != null) {
    const t = totalAmount ?? booking.total_amount ?? 0;
    const p = amountPaid ?? booking.amount_paid ?? 0;
    paymentStatus = p >= t && t > 0 ? "received" : p > 0 ? "partial" : "unpaid";
  }

  const update = {
    customer_name: data.customer_name.trim(),
    email: data.email?.trim() || null,
    facility_id: data.facility_id,
    booking_date: data.booking_date,
    slot: data.slot,
    guests: data.guests ? Number(data.guests) : null,
    notes: data.notes?.trim() || null,
    status: newStatus,
    total_amount: totalAmount,
    amount_paid: amountPaid,
    payment_status: paymentStatus,
    updated_at: new Date().toISOString(),
  };

  let auditAction = "edit_booking";
  if (newStatus !== originalStatus) {
    if (newStatus === "approved") {
      const { data: { user } } = await supabaseClient.auth.getUser();
      update.approved_by = user.id;
      update.approved_at = new Date().toISOString();
      auditAction = "approve_booking";
    } else if (newStatus === "rejected") {
      auditAction = "reject_booking";
    } else if (newStatus === "cancelled") {
      update.cancellation_reason = data.cancellation_reason?.trim() || null;
      update.cancelled_at = new Date().toISOString();
      auditAction = "cancel_booking";
    }
  }

  if (newStatus === "cancelled") {
    const refundStatus = data.refund_status || "none";
    if (!["none", "partial", "full"].includes(refundStatus)) {
      errorEl.textContent = "Refund status must be none, partial, or full.";
      errorEl.hidden = false;
      return;
    }
    update.cancellation_reason = data.cancellation_reason?.trim() || null;
    update.refund_status = refundStatus;
    update.refund_notes = refundStatus === "none" ? null : (data.refund_notes?.trim() || null);
  }

  const { error } = await supabaseClient.from("booking_requests").update(update).eq("id", data.id);
  if (error) {
    // Same approved-slot unique index applies here — if the new date/slot,
    // or approving into an already-taken slot, collides with another
    // approved booking.
    errorEl.textContent =
      error.message?.includes("duplicate key") || error.code === "23505"
        ? "That slot is already approved for another booking on this date."
        : "Couldn't save changes: " + error.message;
    errorEl.hidden = false;
    return;
  }

  await writeAudit(auditAction, "booking_requests", data.id, { booking_code: booking.booking_code, status: newStatus });
  Object.assign(booking, update);
  modal.hidden = true;
  renderBookings();
}

async function writeAudit(action, table, recordId, details) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  await supabaseClient.from("audit_log").insert({
    actor_id: user.id, action, table_name: table, record_id: recordId, details,
  });
}

// ---------- Edit Enquiry modal (item 2 — enquiries merged into this page) ----------

function wireEnquiryModal() {
  const modal = document.getElementById("enquiryModal");
  document.getElementById("closeEnquiryModalBtn").addEventListener("click", () => { modal.hidden = true; });
  document.getElementById("enquiryForm2").addEventListener("submit", submitEnquiryModal);
}

function openEnquiryModal(enquiry) {
  const modal = document.getElementById("enquiryModal");
  const form = document.getElementById("enquiryForm2");
  document.getElementById("enquiryModalError").hidden = true;

  form.elements["id"].value = enquiry.id;
  form.elements["customer_name"].value = enquiry.customer_name;
  const phoneInput = form.elements["phone"];
  phoneInput.value = enquiry.phone || ""; // locked — shown for reference only
  form.elements["email"].value = enquiry.email || "";
  form.elements["facility_id"].value = enquiry.facility_id || "";
  form.elements["preferred_date"].value = enquiry.preferred_date || "";
  form.elements["guests"].value = enquiry.guests || "";
  form.elements["status"].value = enquiry.status;
  form.elements["message"].value = enquiry.message || "";

  modal.hidden = false;
}

async function submitEnquiryModal(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const errorEl = document.getElementById("enquiryModalError");
  errorEl.hidden = true;

  const update = {
    customer_name: data.customer_name.trim(),
    email: data.email?.trim() || null,
    facility_id: data.facility_id || null,
    preferred_date: data.preferred_date || null,
    guests: data.guests ? Number(data.guests) : null,
    status: data.status,
    message: data.message?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient.from("enquiries").update(update).eq("id", data.id);
  if (error) {
    errorEl.textContent = "Couldn't save changes: " + error.message;
    errorEl.hidden = false;
    return;
  }

  const enquiry = allEnquiries.find(en => en.id === data.id);
  if (enquiry) Object.assign(enquiry, update);
  document.getElementById("enquiryModal").hidden = true;
  renderBookings();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
