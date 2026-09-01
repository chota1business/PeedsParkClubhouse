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
      renderBookings();
    });
  });

  document.querySelectorAll("[data-status]").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("[data-status]").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeStatus = chip.dataset.status;
      renderBookings();
    });
  });

  document.getElementById("unblockForm").addEventListener("submit", createUnblock);

  await Promise.all([loadBookings(), loadUnblocks()]);
});

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
  renderBookings();
}

function renderBookings() {
  const container = document.getElementById("bookingList");
  let rows = allHourly;
  // "badminton" matches both badminton_1 and badminton_2 via prefix; "pool" matches only "pool".
  if (activeFacility !== "all") rows = rows.filter(b => b.facility_id === activeFacility || b.facility_id.startsWith(activeFacility));
  if (activeStatus !== "all") rows = rows.filter(b => b.status === activeStatus);

  if (rows.length === 0) {
    container.innerHTML = `<p class="muted center" style="padding:40px;">No bookings here.</p>`;
    return;
  }

  container.innerHTML = rows.map(bookingRowHtml).join("");
  container.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => handleAction(btn.dataset.id, btn.dataset.action));
  });
}

function bookingRowHtml(b) {
  const color = HOURLY_STATUS_COLORS[b.status] || "#999";
  const waLink = `https://wa.me/${b.phone.replace(/\D/g, "")}`;
  const actions = [];
  if (b.status === "pending") {
    actions.push(`<button class="btn btn-primary btn-sm" data-id="${b.id}" data-action="approve">✅ Approve</button>`);
    actions.push(`<button class="btn btn-outline-dark btn-sm" data-id="${b.id}" data-action="reject">❌ Reject</button>`);
  }
  if (b.status === "approved") {
    actions.push(`<button class="btn btn-outline-dark btn-sm" data-id="${b.id}" data-action="cancel">🚫 Cancel</button>`);
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

  const confirmMsgs = {
    approve: `Approve booking ${booking.booking_code} for ${booking.customer_name}?`,
    reject: `Reject booking ${booking.booking_code}? This cannot be undone from here.`,
  };
  if (!confirm(confirmMsgs[action])) return;

  const statusMap = { approve: "approved", reject: "rejected" };
  const update = { status: statusMap[action], updated_at: new Date().toISOString() };

  const { error } = await supabaseClient.from("hourly_bookings").update(update).eq("id", id);

  if (error) {
    // The check_hourly_capacity() trigger re-validates on UPDATE too — if two
    // pending requests overlap and both get approved, the second approval can
    // fail once capacity/exclusivity is exceeded.
    alert(
      error.message?.includes("Capacity exceeded") || error.message?.includes("Exclusive booking conflicts")
        ? "Can't approve — this would exceed capacity or conflicts with another approved booking for that time. " + error.message
        : "Couldn't update this booking: " + error.message
    );
    return;
  }

  await writeAudit(`${action}_hourly_booking`, "hourly_bookings", id, { booking_code: booking.booking_code });
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
