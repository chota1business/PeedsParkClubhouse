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
    actions.push(`<button class="btn btn-outline-dark btn-sm" data-id="${b.id}" data-action="paid">💰 Mark Paid</button>`);
  }

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
          · payment: ${b.payment_status}
          · status: <strong>${b.status}</strong>
        </div>
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

  const confirmMsgs = {
    approve: `Approve booking ${booking.booking_code} for ${booking.customer_name}?`,
    reject: `Reject booking ${booking.booking_code}? This cannot be undone from here.`,
    cancel: `Cancel the approved booking ${booking.booking_code}? This frees the slot back up.`,
    paid: `Mark ${booking.booking_code} as payment received?`,
  };
  if (!confirm(confirmMsgs[action])) return;

  const statusMap = { approve: "approved", reject: "rejected", cancel: "cancelled" };
  const update = action === "paid"
    ? { payment_status: "received", updated_at: new Date().toISOString() }
    : { status: statusMap[action], updated_at: new Date().toISOString() };

  const { error } = await supabaseClient.from("booking_requests").update(update).eq("id", id);

  if (error) {
    // The approved-slot unique index (one facility/date/slot can only have one
    // approved booking) surfaces here as a constraint violation if two pending
    // requests target the same slot and both get approved.
    alert(
      error.message?.includes("duplicate key") || error.code === "23505"
        ? "That slot is already approved for another booking on this date."
        : "Couldn't update this booking: " + error.message
    );
    return;
  }

  await writeAudit(action === "paid" ? "mark_payment_received" : `${action}_booking`, "booking_requests", id, { booking_code: booking.booking_code });
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
        <button class="btn btn-outline-dark btn-sm" data-unblock="${b.id}">Unblock</button>
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
