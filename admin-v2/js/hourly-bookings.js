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

  await loadBookings();
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

  const confirmMsgs = {
    approve: `Approve booking ${booking.booking_code} for ${booking.customer_name}?`,
    reject: `Reject booking ${booking.booking_code}? This cannot be undone from here.`,
    cancel: `Cancel the approved booking ${booking.booking_code}? This frees the slot back up.`,
  };
  if (!confirm(confirmMsgs[action])) return;

  const statusMap = { approve: "approved", reject: "rejected", cancel: "cancelled" };
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
