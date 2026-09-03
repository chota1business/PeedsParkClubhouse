// PeedsPark Admin — Hall/Lawn booking management + block/unblock (Phase 3)

const BOOKING_STATUS_COLORS = { pending: "#D9A441", approved: "#2E9E5B", rejected: "#B33A3A", cancelled: "#8A8A8A" };
const FACILITY_LABELS = { ac_hall: "AC Hall", non_ac_hall: "Non-AC Hall", lawn: "Lawn" };

let staff = null;
let allBookings = [];
let activeFilter = "all";

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
      renderBookings();
    });
  });

  document.getElementById("blockForm").addEventListener("submit", createBlock);
  wireEditBookingModal();
  // Blocking a facility for maintenance is Admin-only (DB-enforced via RLS
  // too) — Managers can still see existing blocks below, just not create or
  // remove them.
  if (staff.role !== "admin") {
    document.getElementById("blockForm").hidden = true;
    document.getElementById("blockAdminNote")?.removeAttribute("hidden");
  }

  await Promise.all([loadBookings(), loadBlocks()]);
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
  allBookings = data || [];
  renderBookings();
}

function renderBookings() {
  const container = document.getElementById("bookingList");
  const rows = activeFilter === "all" ? allBookings : allBookings.filter(b => b.status === activeFilter);

  if (rows.length === 0) {
    container.innerHTML = `<p class="muted center" style="padding:40px;">No bookings here.</p>`;
    return;
  }

  container.innerHTML = rows.map(bookingRowHtml).join("");
  container.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => handleBookingAction(btn.dataset.id, btn.dataset.action));
  });
}

function bookingRowHtml(b) {
  const color = BOOKING_STATUS_COLORS[b.status] || "#999";
  const waLink = `https://wa.me/${b.phone.replace(/\D/g, "")}`;
  const actions = [];
  if (b.status === "pending") {
    actions.push(`<button class="btn btn-primary btn-sm" data-id="${b.id}" data-action="approve">✅ Approve</button>`);
    actions.push(`<button class="btn btn-outline-dark btn-sm" data-id="${b.id}" data-action="reject">❌ Reject</button>`);
  }
  if (b.status === "approved") {
    actions.push(`<button class="btn btn-outline-dark btn-sm" data-id="${b.id}" data-action="cancel">🚫 Cancel</button>`);
    if (b.payment_status !== "received") {
      actions.push(`<button class="btn btn-outline-dark btn-sm" data-id="${b.id}" data-action="update_payment">💰 Update Payment</button>`);
    }
  }
  if (b.status === "pending" || b.status === "approved") {
    actions.push(`<button class="btn btn-outline-dark btn-sm" data-id="${b.id}" data-action="edit">✏️ Edit</button>`);
  }
  // Refund only makes sense once cancelled, and only if money had actually
  // changed hands (payment_status partial/received) — DB-enforced too
  // (booking_requests_refund_requires_cancelled_check).
  if (b.status === "cancelled" && b.payment_status !== "unpaid") {
    actions.push(`<button class="btn btn-outline-dark btn-sm" data-id="${b.id}" data-action="refund">💸 ${b.refund_status !== "none" ? "Update Refund" : "Refund"}</button>`);
  }

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
        ${actions.join("")}
        <a class="btn btn-outline-dark btn-sm" href="${waLink}" target="_blank" rel="noopener">💬 WhatsApp</a>
      </div>
    </div>`;
}

async function handleBookingAction(id, action) {
  const booking = allBookings.find(b => b.id === id);
  if (!booking) return;

  if (action === "cancel") return cancelBooking(booking);
  if (action === "refund") return recordRefund(booking);
  if (action === "approve") return approveWithPayment(booking);
  if (action === "update_payment") return updatePayment(booking);
  if (action === "edit") return openEditBookingModal(booking);

  const confirmMsgs = {
    reject: `Reject booking ${booking.booking_code}? This cannot be undone from here.`,
  };
  if (!confirm(confirmMsgs[action])) return;

  const update = { status: "rejected", updated_at: new Date().toISOString() };
  const { error } = await supabaseClient.from("booking_requests").update(update).eq("id", id);
  if (error) {
    alert("Couldn't update this booking: " + error.message);
    return;
  }

  await writeAudit("reject_booking", "booking_requests", id, { booking_code: booking.booking_code });
  Object.assign(booking, update);
  renderBookings();
}

// Hall/Lawn/AC/Non-AC allow a Partial (advance) payment — every facility on
// this page does, since Pool/Badminton live on the separate hourly-bookings
// page. Approval can't complete until an amount is entered, per owner
// request: no booking gets confirmed to the customer without payment being
// recorded first.
async function approveWithPayment(booking) {
  const entry = await promptPaymentEntry({
    allowPartial: true,
    label: `Approve ${booking.booking_code} for ${booking.customer_name}`,
  });
  if (!entry) return;

  const update = {
    status: "approved",
    total_amount: entry.total_amount,
    amount_paid: entry.amount_paid,
    payment_status: entry.payment_status,
    approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data: { user } } = await supabaseClient.auth.getUser();
  update.approved_by = user.id;

  const { error } = await supabaseClient.from("booking_requests").update(update).eq("id", booking.id);
  if (error) {
    // The approved-slot unique index (one facility/date/slot can only have one
    // approved booking) surfaces here as a constraint violation if two pending
    // requests target the same slot and both get approved.
    alert(
      error.message?.includes("duplicate key") || error.code === "23505"
        ? "That slot is already approved for another booking on this date."
        : "Couldn't approve this booking: " + error.message
    );
    return;
  }

  await writeAudit("approve_booking", "booking_requests", booking.id, {
    booking_code: booking.booking_code, total_amount: entry.total_amount, amount_paid: entry.amount_paid,
  });
  Object.assign(booking, update);
  renderBookings();
}

async function updatePayment(booking) {
  const entry = await promptPaymentEntry({
    allowPartial: true,
    previousTotal: booking.total_amount,
    previousPaid: booking.amount_paid,
    label: `Update payment for ${booking.booking_code}`,
  });
  if (!entry) return;

  const update = {
    total_amount: entry.total_amount,
    amount_paid: entry.amount_paid,
    payment_status: entry.payment_status,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseClient.from("booking_requests").update(update).eq("id", booking.id);
  if (error) {
    alert("Couldn't update payment: " + error.message);
    return;
  }

  await writeAudit("update_payment", "booking_requests", booking.id, {
    booking_code: booking.booking_code, total_amount: entry.total_amount, amount_paid: entry.amount_paid,
  });
  Object.assign(booking, update);
  renderBookings();
}

async function cancelBooking(booking) {
  const reason = prompt(
    `Cancel the approved booking ${booking.booking_code} for ${booking.customer_name}? This frees the slot back up.\n\nReason for cancellation (shown to staff only, optional):`,
    ""
  );
  if (reason === null) return; // staff backed out of the dialog entirely

  const update = {
    status: "cancelled",
    cancellation_reason: reason.trim() || null,
    cancelled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient.from("booking_requests").update(update).eq("id", booking.id);
  if (error) {
    alert("Couldn't cancel this booking: " + error.message);
    return;
  }

  await writeAudit("cancel_booking", "booking_requests", booking.id, { booking_code: booking.booking_code, reason: update.cancellation_reason });
  Object.assign(booking, update);
  renderBookings();
}

async function recordRefund(booking) {
  const current = booking.refund_status !== "none" ? booking.refund_status : "";
  let refundStatus = prompt(
    `Refund status for ${booking.booking_code} (payment was: ${booking.payment_status}).\nType one of: none, partial, full`,
    current
  );
  if (refundStatus === null) return;
  refundStatus = refundStatus.trim().toLowerCase();
  if (!["none", "partial", "full"].includes(refundStatus)) {
    alert('Refund status must be exactly one of: none, partial, full.');
    return;
  }

  let notes = "";
  if (refundStatus !== "none") {
    notes = prompt(`What happened? (e.g. "₹5000 refunded via UPI on 12 Sep")`, booking.refund_notes || "");
    if (notes === null) return;
  }

  const update = {
    refund_status: refundStatus,
    refund_notes: refundStatus === "none" ? null : (notes.trim() || null),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient.from("booking_requests").update(update).eq("id", booking.id);
  if (error) {
    // booking_requests_refund_requires_cancelled_check is the real backstop —
    // the Refund button only shows for already-cancelled bookings, so this
    // shouldn't fire in practice, but the DB is what actually enforces it.
    alert("Couldn't save refund status: " + error.message);
    return;
  }

  await writeAudit("record_refund", "booking_requests", booking.id, { booking_code: booking.booking_code, refund_status: refundStatus });
  Object.assign(booking, update);
  renderBookings();
}

async function loadBlocks() {
  const { data, error } = await supabaseClient
    .from("blocks")
    .select("*")
    .in("facility_id", ["ac_hall", "non_ac_hall", "lawn"])
    .order("start_at", { ascending: true });

  const container = document.getElementById("blockList");
  if (error) {
    container.innerHTML = `<p class="muted small">Couldn't load blocks: ${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data || data.length === 0) {
    container.innerHTML = `<p class="muted small">No active blocks.</p>`;
    return;
  }

  container.innerHTML = data.map(b => `
    <div class="enquiry-card" style="border-left-color:var(--navy);">
      <div class="enquiry-card-main">
        <strong>${FACILITY_LABELS[b.facility_id] || b.facility_id}</strong>
        <div class="muted small">${new Date(b.start_at).toLocaleString()} → ${new Date(b.end_at).toLocaleString()} ${b.reason ? "· " + escapeHtml(b.reason) : ""}</div>
      </div>
      <div class="enquiry-card-actions">
        ${staff.role === "admin" ? `<button class="btn btn-outline-dark btn-sm" data-unblock="${b.id}">Unblock</button>` : ""}
      </div>
    </div>`).join("");

  container.querySelectorAll("[data-unblock]").forEach(btn => {
    btn.addEventListener("click", () => removeBlock(btn.dataset.unblock));
  });
}

async function createBlock(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());

  if (new Date(data.end_at) <= new Date(data.start_at)) {
    alert("End time must be after start time.");
    return;
  }
  if (!confirm(`Block ${FACILITY_LABELS[data.facility_id]} from ${data.start_at} to ${data.end_at}?`)) return;

  const { data: { user } } = await supabaseClient.auth.getUser();
  const { data: inserted, error } = await supabaseClient
    .from("blocks")
    .insert({
      facility_id: data.facility_id,
      start_at: new Date(data.start_at).toISOString(),
      end_at: new Date(data.end_at).toISOString(),
      reason: data.reason?.trim() || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    alert("Couldn't create block: " + error.message);
    return;
  }

  await writeAudit("create_block", "blocks", inserted.id, { facility_id: data.facility_id, start_at: data.start_at, end_at: data.end_at });
  form.reset();
  await loadBlocks();
}

async function removeBlock(id) {
  if (!confirm("Remove this block? The slot becomes available again immediately.")) return;
  const { error } = await supabaseClient.from("blocks").delete().eq("id", id);
  if (error) {
    alert("Couldn't remove block: " + error.message);
    return;
  }
  await writeAudit("remove_block", "blocks", id, {});
  await loadBlocks();
}

// ---------- Edit Booking modal ----------

function wireEditBookingModal() {
  const modal = document.getElementById("editBookingModal");
  document.getElementById("closeEditBookingBtn").addEventListener("click", () => { modal.hidden = true; });
  document.getElementById("editBookingForm").addEventListener("submit", submitEditBooking);
}

function openEditBookingModal(booking) {
  const modal = document.getElementById("editBookingModal");
  const form = document.getElementById("editBookingForm");
  form.elements["id"].value = booking.id;
  form.elements["customer_name"].value = booking.customer_name;
  form.elements["phone"].value = booking.phone;
  form.elements["booking_date"].value = booking.booking_date;
  form.elements["slot"].value = booking.slot;
  form.elements["guests"].value = booking.guests || "";
  form.elements["notes"].value = booking.notes || "";
  modal.hidden = false;
}

async function submitEditBooking(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());

  if (!/^[0-9]{10}$/.test(data.phone)) {
    alert("Please enter a valid 10-digit mobile number.");
    return;
  }

  const update = {
    customer_name: data.customer_name.trim(),
    phone: data.phone.trim(),
    booking_date: data.booking_date,
    slot: data.slot,
    guests: data.guests ? Number(data.guests) : null,
    notes: data.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient.from("booking_requests").update(update).eq("id", data.id);
  if (error) {
    // Same approved-slot unique index applies here if the new date/slot
    // collides with another approved booking.
    alert(
      error.message?.includes("duplicate key") || error.code === "23505"
        ? "That slot is already approved for another booking on this date."
        : "Couldn't save changes: " + error.message
    );
    return;
  }

  await writeAudit("edit_booking", "booking_requests", data.id, { booking_date: data.booking_date, slot: data.slot });
  const booking = allBookings.find(b => b.id === data.id);
  if (booking) Object.assign(booking, update);
  document.getElementById("editBookingModal").hidden = true;
  renderBookings();
}

async function writeAudit(action, table, recordId, details) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  await supabaseClient.from("audit_log").insert({
    actor_id: user.id, action, table_name: table, record_id: recordId, details,
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
