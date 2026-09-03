// PeedsPark Admin — Pool/Badminton hourly booking management (Phase 4)

const HOURLY_STATUS_COLORS = { pending: "#D9A441", approved: "#2E9E5B", rejected: "#B33A3A", cancelled: "#8A8A8A" };
// Badminton has two separate courts in the schema (badminton_1, badminton_2),
// each its own facility_id — not a single "badminton" row. Pool is the only
// facility_id that's just "pool".
const HOURLY_FACILITY_LABELS = { pool: "🏊 Pool", badminton_1: "🏸 Badminton Court 1", badminton_2: "🏸 Badminton Court 2" };

let staff = null;
let allHourly = [];
let activeFacility = "all";
let activeStatus = "all";
let listControls = null;

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireStaffSession();
  if (!session) return;
  staff = session.staff;

  document.getElementById("staffName").textContent = staff.full_name;
  document.getElementById("staffRole").textContent = staff.role;
  document.getElementById("pageContent").hidden = false;

  document.querySelectorAll("[data-facility]").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("[data-facility]").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeFacility = chip.dataset.facility;
      listControls?.resetPage();
      renderBookings();
    });
  });

  document.querySelectorAll("[data-status]").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("[data-status]").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeStatus = chip.dataset.status;
      listControls?.resetPage();
      renderBookings();
    });
  });

  listControls = createListControls({
    searchInputId: "hourlySearch",
    dateFromId: "hourlyDateFrom",
    dateToId: "hourlyDateTo",
    pagerContainerId: "hourlyPager",
    searchText: (b) => `${b.customer_name} ${b.phone}`,
    dateField: (b) => b.booking_date,
    onChange: renderBookings,
  });

  // Dashboard tiles deep-link here as hourly-bookings.html?facility=pool /
  // ?facility=badminton — pre-select the matching facility chip so staff
  // land already filtered instead of having to click it themselves.
  const urlFacility = new URLSearchParams(window.location.search).get("facility");
  if (urlFacility === "pool" || urlFacility === "badminton") {
    const targetChip = document.querySelector(`[data-facility="${urlFacility}"]`);
    if (targetChip) {
      document.querySelectorAll("[data-facility]").forEach(c => c.classList.remove("active"));
      targetChip.classList.add("active");
      activeFacility = urlFacility;
    }
  }

  const toggleBlocksBtn = document.getElementById("toggleBlocksBtn");
  const blocksPanel = document.getElementById("blocksPanel");
  toggleBlocksBtn?.addEventListener("click", () => {
    blocksPanel.hidden = !blocksPanel.hidden;
    toggleBlocksBtn.textContent = blocksPanel.hidden ? "🚫 Manage Blocks" : "✖ Close Blocks";
  });

  document.getElementById("unblockForm").addEventListener("submit", createUnblock);
  document.getElementById("blockForm").addEventListener("submit", createBlock);
  wireEditBookingModal();
  // Blocking a facility for maintenance is Admin-only (DB-enforced via RLS
  // too) — Managers can still see existing blocks below, just not create or
  // remove them.
  if (staff.role !== "admin") {
    document.getElementById("blockForm").hidden = true;
    document.getElementById("blockAdminNote")?.removeAttribute("hidden");
  }

  await Promise.all([loadBookings(), loadUnblocks(), loadBlocks()]);
});

const FACILITY_LABELS_FULL = { pool: "Swimming Pool", badminton_1: "Badminton Court 1", badminton_2: "Badminton Court 2" };

async function loadBlocks() {
  const { data, error } = await supabaseClient
    .from("blocks")
    .select("*")
    .in("facility_id", ["pool", "badminton_1", "badminton_2"])
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
        <strong>${FACILITY_LABELS_FULL[b.facility_id] || b.facility_id}</strong>
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
  if (!confirm(`Block ${FACILITY_LABELS_FULL[data.facility_id]} from ${data.start_at} to ${data.end_at}?`)) return;

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

async function loadBookings() {
  const { data, error } = await supabaseClient
    .from("hourly_bookings")
    .select("*")
    .order("booking_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    document.getElementById("bookingList").innerHTML = `<p class="muted center" style="padding:40px;">Couldn't load bookings: ${escapeHtml(error.message)}</p>`;
    return;
  }
  allHourly = data || [];
  listControls?.resetPage();
  renderBookings();
}

function renderBookings() {
  const container = document.getElementById("bookingList");
  let rows = allHourly;
  // "badminton" matches both badminton_1 and badminton_2 via prefix; "pool" matches only "pool".
  if (activeFacility !== "all") rows = rows.filter(b => b.facility_id === activeFacility || b.facility_id.startsWith(activeFacility));
  if (activeStatus !== "all") rows = rows.filter(b => b.status === activeStatus);
  rows = listControls ? listControls.apply(rows) : rows;

  if (rows.length === 0) {
    container.innerHTML = `<p class="muted center" style="padding:40px;">No bookings here.</p>`;
    listControls?.renderPager(0);
    return;
  }

  const page = listControls ? listControls.paginate(rows) : { rows };
  container.innerHTML = page.rows.map(bookingRowHtml).join("");
  container.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => handleAction(btn.dataset.id, btn.dataset.action));
  });
  listControls?.renderPager(rows.length);
}

function bookingRowHtml(b) {
  const color = HOURLY_STATUS_COLORS[b.status] || "#999";
  const waLink = `https://wa.me/${b.phone.replace(/\D/g, "")}`;
  const actions = [];
  if (b.status === "pending") {
    actions.push(`<button class="btn btn-primary btn-sm" data-id="${b.id}" data-action="approve">✅ Approve</button>`);
  }
  // Reject (pending) and Cancel (approved) are the same button now — Cancel
  // decides what it means from the booking's own current status.
  if (b.status === "pending" || b.status === "approved") {
    actions.push(`<button class="btn btn-outline-dark btn-sm" data-id="${b.id}" data-action="cancel">🚫 Cancel</button>`);
  }
  if (b.status === "approved" && b.payment_status !== "received") {
    actions.push(`<button class="btn btn-outline-dark btn-sm" data-id="${b.id}" data-action="update_payment">💰 Update Payment</button>`);
  }
  if (b.status === "pending") {
    // Once approved, editing details is no longer offered here — cancel and
    // rebook instead, or use Update Payment to adjust what was paid.
    actions.push(`<button class="btn btn-outline-dark btn-sm" data-id="${b.id}" data-action="edit">✏️ Edit</button>`);
  }

  const cancelInfo = b.status === "cancelled" && b.cancellation_reason
    ? `<div class="muted small">🚫 ${escapeHtml(b.cancellation_reason)}</div>`
    : "";

  return `
    <div class="enquiry-card" style="border-left-color:${color};">
      <div class="enquiry-card-main">
        <div>
          <strong>${escapeHtml(b.customer_name)}</strong>
          <span class="muted"> · ${escapeHtml(b.phone)}</span>
        </div>
        <div class="muted small">
          ${b.booking_code} · ${HOURLY_FACILITY_LABELS[b.facility_id] || b.facility_id} · ${b.booking_date} · ${b.start_time}–${b.end_time}
          ${b.guests ? " · " + b.guests + " guests" : ""}
          ${b.mode ? " · mode: " + escapeHtml(b.mode) : ""}
          ${b.status !== "pending" && b.status !== "rejected" ? ` · payment: ${b.payment_status}${b.total_amount != null ? ` (₹${Number(b.amount_paid).toFixed(2)} of ₹${Number(b.total_amount).toFixed(2)})` : ""}` : ""}
          · status: <strong>${b.status}</strong>
        </div>
        ${cancelInfo}
      </div>
      <div class="enquiry-card-actions">
        ${actions.join("")}
        <a class="btn btn-outline-dark btn-sm" href="${waLink}" target="_blank" rel="noopener">💬 WhatsApp</a>
      </div>
    </div>`;
}

async function handleAction(id, action) {
  const booking = allHourly.find(b => b.id === id);
  if (!booking) return;

  if (action === "cancel") return cancelBooking(booking);
  if (action === "approve") return approveWithPayment(booking);
  if (action === "update_payment") return updatePayment(booking);
  if (action === "edit") return openEditBookingModal(booking);
}

// Pool/Badminton now allow Partial (advance) payment too, same as Hall/Lawn.
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

  const { error } = await supabaseClient.from("hourly_bookings").update(update).eq("id", booking.id);
  if (error) {
    // The check_hourly_capacity() trigger re-validates on UPDATE too — if two
    // pending requests overlap and both get approved, the second approval can
    // fail once capacity/exclusivity is exceeded.
    alert(
      error.message?.includes("Capacity exceeded") || error.message?.includes("Exclusive booking conflicts")
        ? "Can't approve — this would exceed capacity or conflicts with another approved booking for that time. " + error.message
        : "Couldn't approve this booking: " + error.message
    );
    return;
  }

  await writeAudit("approve_hourly_booking", "hourly_bookings", booking.id, {
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
  const { error } = await supabaseClient.from("hourly_bookings").update(update).eq("id", booking.id);
  if (error) {
    alert("Couldn't update payment: " + error.message);
    return;
  }

  await writeAudit("update_payment_hourly", "hourly_bookings", booking.id, {
    booking_code: booking.booking_code, total_amount: entry.total_amount, amount_paid: entry.amount_paid,
  });
  Object.assign(booking, update);
  renderBookings();
}

// One button covers both the old "Reject" (pending) and "Cancel" (approved)
// — decided by the booking's current status, not by which button was
// clicked. See bookings.js's cancelBooking for the identical pattern.
async function cancelBooking(booking) {
  const isPending = booking.status === "pending";
  const reason = prompt(
    isPending
      ? `Decline the pending request ${booking.booking_code} for ${booking.customer_name}? This cannot be undone from here.\n\nReason (shown to staff only, optional):`
      : `Cancel the approved booking ${booking.booking_code} for ${booking.customer_name}? This frees the slot back up.\n\nReason for cancellation (shown to staff only, optional):`,
    ""
  );
  if (reason === null) return; // staff backed out of the dialog entirely

  if (isPending) {
    const update = { status: "rejected", updated_at: new Date().toISOString() };
    const { error } = await supabaseClient.from("hourly_bookings").update(update).eq("id", booking.id);
    if (error) {
      alert("Couldn't update this booking: " + error.message);
      return;
    }
    await writeAudit("reject_hourly_booking", "hourly_bookings", booking.id, { booking_code: booking.booking_code });
    Object.assign(booking, update);
    renderBookings();
    return;
  }

  const update = {
    status: "cancelled",
    cancellation_reason: reason.trim() || null,
    cancelled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient.from("hourly_bookings").update(update).eq("id", booking.id);
  if (error) {
    alert("Couldn't cancel this booking: " + error.message);
    return;
  }

  await writeAudit("cancel_hourly_booking", "hourly_bookings", booking.id, { booking_code: booking.booking_code, reason: update.cancellation_reason });
  Object.assign(booking, update);
  renderBookings();
}

const RESERVED_FACILITY_LABELS = { badminton_1: "Badminton Court 1", badminton_2: "Badminton Court 2" };

async function loadUnblocks() {
  const { data, error } = await supabaseClient
    .from("reserved_window_unblocks")
    .select("*")
    .gte("booking_date", new Date().toISOString().slice(0, 10)) // past dates are just history — no need to manage them
    .order("booking_date", { ascending: true });

  const container = document.getElementById("unblockList");
  if (error) {
    container.innerHTML = `<p class="muted small">Couldn't load opened windows: ${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data || data.length === 0) {
    container.innerHTML = `<p class="muted small">No windows opened for public booking right now — all reserved hours stay members-only.</p>`;
    return;
  }

  container.innerHTML = data.map(u => `
    <div class="enquiry-card" style="border-left-color:var(--plum);">
      <div class="enquiry-card-main">
        <strong>${RESERVED_FACILITY_LABELS[u.facility_id] || u.facility_id}</strong>
        <div class="muted small">${u.booking_date} · ${u.start_time}–${u.end_time} ${u.reason ? "· " + escapeHtml(u.reason) : ""}</div>
      </div>
      <div class="enquiry-card-actions">
        <button class="btn btn-outline-dark btn-sm" data-close-unblock="${u.id}">Close</button>
      </div>
    </div>`).join("");

  container.querySelectorAll("[data-close-unblock]").forEach(btn => {
    btn.addEventListener("click", () => removeUnblock(btn.dataset.closeUnblock));
  });
}

async function createUnblock(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());

  if (data.end_time <= data.start_time) {
    alert("End time must be after start time.");
    return;
  }
  const label = RESERVED_FACILITY_LABELS[data.facility_id] || data.facility_id;
  if (!confirm(`Open ${label}'s ${data.start_time}–${data.end_time} reserved window for public booking on ${data.booking_date}?`)) return;

  const { data: { user } } = await supabaseClient.auth.getUser();
  const { data: inserted, error } = await supabaseClient
    .from("reserved_window_unblocks")
    .insert({
      facility_id: data.facility_id,
      booking_date: data.booking_date,
      start_time: data.start_time,
      end_time: data.end_time,
      reason: data.reason?.trim() || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    alert("Couldn't open this window: " + error.message);
    return;
  }

  await writeAudit("open_reserved_window", "reserved_window_unblocks", inserted.id, { facility_id: data.facility_id, booking_date: data.booking_date, start_time: data.start_time, end_time: data.end_time });
  form.reset();
  document.querySelector('#unblockForm [name="end_time"]').value = "23:00";
  await loadUnblocks();
}

async function removeUnblock(id) {
  if (!confirm("Close this window? It goes back to members-reserved immediately.")) return;
  const { error } = await supabaseClient.from("reserved_window_unblocks").delete().eq("id", id);
  if (error) {
    alert("Couldn't close this window: " + error.message);
    return;
  }
  await writeAudit("close_reserved_window", "reserved_window_unblocks", id, {});
  await loadUnblocks();
}

// ---------- Edit Booking modal ----------

function addHours(time, hours) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + hours * 60;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function durationHours(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60;
  return Math.max(1, Math.round(diff / 60));
}

function wireEditBookingModal() {
  const modal = document.getElementById("editBookingModal");
  document.getElementById("closeEditBookingBtn").addEventListener("click", () => { modal.hidden = true; });
  document.getElementById("editBookingForm").addEventListener("submit", submitEditBooking);
}

function openEditBookingModal(booking) {
  const modal = document.getElementById("editBookingModal");
  const form = document.getElementById("editBookingForm");
  form.elements["id"].value = booking.id;
  form.elements["facility_id"].value = booking.facility_id;
  form.elements["customer_name"].value = booking.customer_name;
  form.elements["phone"].value = booking.phone;
  form.elements["booking_date"].value = booking.booking_date;
  form.elements["start_time"].value = booking.start_time;
  form.elements["duration"].value = String(durationHours(booking.start_time, booking.end_time));
  form.elements["guests"].value = booking.guests || "";
  form.elements["mode"].value = booking.mode || "shared";
  document.getElementById("editModeFieldWrap").hidden = booking.facility_id !== "pool";
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

  const isPool = data.facility_id === "pool";
  const endTime = addHours(data.start_time, Number(data.duration || 1));

  const update = {
    customer_name: data.customer_name.trim(),
    phone: data.phone.trim(),
    booking_date: data.booking_date,
    start_time: data.start_time,
    end_time: endTime,
    guests: isPool ? Number(data.guests || 1) : 1,
    mode: isPool ? data.mode : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient.from("hourly_bookings").update(update).eq("id", data.id);
  if (error) {
    alert(
      error.message?.includes("Capacity exceeded") || error.message?.includes("Exclusive booking conflicts")
        ? "Can't save — this would exceed capacity or conflicts with another approved booking for that time. " + error.message
        : "Couldn't save changes: " + error.message
    );
    return;
  }

  await writeAudit("edit_hourly_booking", "hourly_bookings", data.id, { booking_date: data.booking_date, start_time: data.start_time });
  const booking = allHourly.find(b => b.id === data.id);
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
