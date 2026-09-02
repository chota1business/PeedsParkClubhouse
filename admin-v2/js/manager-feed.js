// PeedsPark Admin — Manager Feed (Phase 12)
// Unified read of enquiries + booking_requests + hourly_bookings via the
// manager_activity_feed VIEW (019_phase12_manager_ops.sql) — the three
// tables themselves are untouched and stay separate; this page is a
// read-only convenience on top of them, and every action here still
// writes to the correct underlying table, same as the dedicated
// Enquiries/Bookings/Pool&Badminton pages. See
// claude/db-login-migration-plan.md Phase 12 for why the tables weren't
// merged.

const TYPE_LABELS = { enquiry: "Enquiry", hall_lawn_booking: "Hall/Lawn", hourly_booking: "Pool/Badminton" };
const STATUS_COLORS = {
  // enquiry lifecycle
  new: "#0E7C7B", contacted: "#D9A441", follow_up: "#FF6B35", converted: "#2E9E5B", lost: "#8A8A8A",
  // booking lifecycle
  pending: "#D9A441", approved: "#2E9E5B", rejected: "#B33A3A", cancelled: "#8A8A8A",
};
const ENQUIRY_STATUS_LABELS = { new: "New", contacted: "Contacted", follow_up: "Follow-up", converted: "Converted", lost: "Lost" };
const FACILITY_LABELS = {
  ac_hall: "AC Hall", non_ac_hall: "Non-AC Hall", lawn: "Lawn",
  pool: "Swimming Pool", badminton_1: "Badminton Court 1", badminton_2: "Badminton Court 2",
};
const HALL_LAWN_IDS = ["ac_hall", "non_ac_hall", "lawn"];

let staff = null;
let allFeed = [];
let activeType = "all";
let searchTerm = "";
let allExpenses = [];
let activeMonthFilter = "current";

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireStaffSession();
  if (!session) return;
  staff = session.staff;

  document.getElementById("staffName").textContent = staff.full_name;
  document.getElementById("staffRole").textContent = staff.role;
  document.getElementById("pageContent").hidden = false;

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("bookingDateInput").min = today;
  document.getElementById("expenseDateInput").value = today;
  document.getElementById("expenseDateInput").max = today;

  wireTabs();
  wireActivityControls();
  wireAddBookingModal();
  wireExpensesControls();
  wireAddExpenseModal();

  await Promise.all([loadFeed(), loadExpenses()]);
});

// ---------- Tabs ----------

function wireTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.tab;
      document.getElementById("tab-activity").hidden = target !== "activity";
      document.getElementById("tab-expenses").hidden = target !== "expenses";
    });
  });
}

// ---------- Activity feed ----------

function wireActivityControls() {
  document.querySelectorAll("[data-type]").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("[data-type]").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeType = chip.dataset.type;
      renderFeed();
    });
  });

  document.getElementById("feedSearch").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderFeed();
  });
}

async function loadFeed() {
  const { data, error } = await supabaseClient
    .from("manager_activity_feed")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    document.getElementById("feedList").innerHTML =
      `<p class="muted center" style="padding:40px;">Couldn't load the feed: ${escapeHtml(error.message)}</p>`;
    return;
  }

  allFeed = data || [];
  renderFeed();
}

function renderFeed() {
  const container = document.getElementById("feedList");
  let rows = allFeed;

  if (activeType !== "all") rows = rows.filter((r) => r.record_type === activeType);
  if (searchTerm) {
    rows = rows.filter((r) =>
      (r.customer_name || "").toLowerCase().includes(searchTerm) || (r.phone || "").includes(searchTerm)
    );
  }

  if (rows.length === 0) {
    container.innerHTML = `<p class="muted center" style="padding:40px;">Nothing here${searchTerm ? " for that search" : ""}.</p>`;
    return;
  }

  container.innerHTML = rows.map(feedRowHtml).join("");

  container.querySelectorAll("select.status-select").forEach((sel) => {
    sel.addEventListener("change", (e) => updateEnquiryStatus(e.target.dataset.id, e.target.value));
  });
  container.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => handleBookingAction(btn.dataset.id, btn.dataset.recordType, btn.dataset.action));
  });
}

function feedRowHtml(r) {
  const color = STATUS_COLORS[r.status] || "#999";
  const waLink = `https://wa.me/${(r.phone || "").replace(/\D/g, "")}`;
  const facilityLabel = r.facility_id ? (FACILITY_LABELS[r.facility_id] || r.facility_id) : "no facility chosen";

  let whenText = "";
  if (r.record_type === "enquiry") {
    whenText = r.activity_date ? r.activity_date : "no date given";
  } else if (r.record_type === "hall_lawn_booking") {
    whenText = `${r.activity_date} · ${r.slot}`;
  } else if (r.record_type === "hourly_booking") {
    whenText = `${r.activity_date} · ${r.start_time}–${r.end_time}`;
  }

  const sourceBadge = r.booking_source === "staff" ? `<span class="source-badge">phoned in</span>` : "";

  let actionsHtml = "";
  if (r.record_type === "enquiry") {
    actionsHtml = `
      <select class="status-select" data-id="${r.id}">
        ${Object.entries(ENQUIRY_STATUS_LABELS).map(([val, label]) =>
          `<option value="${val}" ${val === r.status ? "selected" : ""}>${label}</option>`
        ).join("")}
      </select>`;
  } else {
    // hall_lawn_booking / hourly_booking share the same pending/approved/cancelled actions here.
    // Payment marking, refunds, and blocks stay on the dedicated Bookings /
    // Pool & Badminton pages — this feed is the fast call-and-decide path.
    const actions = [];
    if (r.status === "pending") {
      actions.push(`<button class="btn btn-primary btn-sm" data-id="${r.id}" data-record-type="${r.record_type}" data-action="approve">✅ Approve</button>`);
      actions.push(`<button class="btn btn-outline-dark btn-sm" data-id="${r.id}" data-record-type="${r.record_type}" data-action="reject">❌ Reject</button>`);
    }
    if (r.status === "approved") {
      actions.push(`<button class="btn btn-outline-dark btn-sm" data-id="${r.id}" data-record-type="${r.record_type}" data-action="cancel">🚫 Cancel</button>`);
    }
    actionsHtml = actions.join("");
  }

  return `
    <div class="enquiry-card" style="border-left-color:${color};">
      <div class="enquiry-card-main">
        <div>
          <span class="type-badge ${r.record_type}">${TYPE_LABELS[r.record_type]}</span>
          <strong>${escapeHtml(r.customer_name)}</strong>
          <span class="muted"> · ${escapeHtml(r.phone)}</span>
          ${sourceBadge}
        </div>
        <div class="muted small">
          ${r.code} · ${escapeHtml(facilityLabel)} · ${whenText}
          ${r.payment_status ? " · payment: " + r.payment_status : ""}
          · status: <strong>${r.status}</strong>
          · ${new Date(r.created_at).toLocaleString()}
        </div>
        ${r.notes ? `<p class="enquiry-message">${escapeHtml(r.notes)}</p>` : ""}
      </div>
      <div class="enquiry-card-actions">
        ${actionsHtml}
        <a class="btn btn-outline-dark btn-sm" href="${waLink}" target="_blank" rel="noopener">💬 WhatsApp</a>
        <a class="btn btn-outline-dark btn-sm" href="tel:${r.phone}">📞 Call</a>
      </div>
    </div>`;
}

async function updateEnquiryStatus(id, newStatus) {
  const row = allFeed.find((r) => r.id === id && r.record_type === "enquiry");
  const oldStatus = row?.status;

  const { error } = await supabaseClient
    .from("enquiries")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    alert("Couldn't update status: " + error.message);
    return;
  }

  await writeAudit("update_enquiry_status", "enquiries", id, { from: oldStatus, to: newStatus });
  if (row) row.status = newStatus;
  renderFeed();
}

async function handleBookingAction(id, recordType, action) {
  const table = recordType === "hall_lawn_booking" ? "booking_requests" : "hourly_bookings";
  const row = allFeed.find((r) => r.id === id && r.record_type === recordType);
  if (!row) return;

  if (action === "cancel") {
    const reason = prompt(
      `Cancel the approved booking ${row.code} for ${row.customer_name}? This frees the slot back up.\n\nReason for cancellation (staff only, optional):`,
      ""
    );
    if (reason === null) return;

    const update = {
      status: "cancelled",
      cancellation_reason: reason.trim() || null,
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseClient.from(table).update(update).eq("id", id);
    if (error) { alert("Couldn't cancel this booking: " + error.message); return; }
    await writeAudit(`cancel_${recordType}`, table, id, { code: row.code, reason: update.cancellation_reason });
    row.status = "cancelled";
    renderFeed();
    return;
  }

  const confirmMsgs = {
    approve: `Approve ${row.code} for ${row.customer_name}?`,
    reject: `Reject ${row.code}? This cannot be undone from here.`,
  };
  if (!confirm(confirmMsgs[action])) return;

  const statusMap = { approve: "approved", reject: "rejected" };
  const update = { status: statusMap[action], updated_at: new Date().toISOString() };
  const { error } = await supabaseClient.from(table).update(update).eq("id", id);

  if (error) {
    // Same DB backstops as the dedicated Bookings/Pool&Badminton pages —
    // the approved-slot unique index (Hall/Lawn) and check_hourly_capacity
    // (Pool/Badminton) can both reject an approval here too.
    alert(
      error.message?.includes("duplicate key") || error.code === "23505"
        ? "That slot is already approved for another booking on this date."
        : error.message?.includes("Capacity exceeded") || error.message?.includes("Exclusive booking conflicts")
        ? "Can't approve — this would exceed capacity or conflicts with another approved booking. " + error.message
        : "Couldn't update this booking: " + error.message
    );
    return;
  }

  await writeAudit(`${action}_${recordType}`, table, id, { code: row.code });
  row.status = update.status;
  renderFeed();
}

// ---------- Add Booking modal ----------

function wireAddBookingModal() {
  const modal = document.getElementById("addBookingModal");
  document.getElementById("openAddBookingBtn").addEventListener("click", () => { modal.hidden = false; });
  document.getElementById("closeAddBookingBtn").addEventListener("click", () => { modal.hidden = true; });
  document.getElementById("cancelAddBookingBtn").addEventListener("click", () => { modal.hidden = true; });

  const facilitySelect = document.getElementById("bookingFacilitySelect");
  const toggleFields = () => {
    const isHallLawn = HALL_LAWN_IDS.includes(facilitySelect.value);
    document.getElementById("fixedSlotFields").hidden = !isHallLawn;
    document.getElementById("hourlyFields").hidden = isHallLawn;
    document.getElementById("modeFieldWrap").hidden = facilitySelect.value !== "pool";
  };
  facilitySelect.addEventListener("change", toggleFields);
  toggleFields();

  const phoneInput = document.getElementById("bookingPhoneInput");
  phoneInput.addEventListener("input", () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 10);
  });

  document.getElementById("addBookingForm").addEventListener("submit", submitAddBooking);
}

function addHours(time, hours) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + hours * 60;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

async function submitAddBooking(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());

  if (!/^[0-9]{10}$/.test(data.phone)) {
    alert("Please enter a valid 10-digit mobile number.");
    return;
  }

  const isHallLawn = HALL_LAWN_IDS.includes(data.facility_id);
  const markApproved = form.elements["mark_approved"].checked;
  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving...";

  let result, error;
  if (isHallLawn) {
    ({ data: result, error } = await supabaseClient.rpc("staff_create_booking_request", {
      p_customer_name: data.customer_name.trim(),
      p_phone: data.phone.trim(),
      p_facility_id: data.facility_id,
      p_booking_date: data.booking_date,
      p_slot: data.slot,
      p_email: data.email?.trim() || null,
      p_guests: data.guests ? Number(data.guests) : null,
      p_notes: data.notes?.trim() || null,
      p_mark_approved: markApproved,
    }));
  } else {
    const isPool = data.facility_id === "pool";
    const startTime = data.start_time;
    const endTime = addHours(startTime, Number(data.duration || 1));
    ({ data: result, error } = await supabaseClient.rpc("staff_create_hourly_booking", {
      p_customer_name: data.customer_name.trim(),
      p_phone: data.phone.trim(),
      p_facility_id: data.facility_id,
      p_booking_date: data.booking_date,
      p_start_time: startTime,
      p_end_time: endTime,
      p_guests: isPool ? Number(data.guests || 1) : 1,
      p_mode: isPool ? data.mode : null,
      p_email: data.email?.trim() || null,
      p_mark_approved: markApproved,
    }));
  }

  submitBtn.disabled = false;
  submitBtn.textContent = "Save Booking";

  if (error) {
    alert(
      error.message?.includes("duplicate key") || error.code === "23505"
        ? "That slot is already approved for another booking on this date."
        : error.message?.includes("Capacity exceeded") || error.message?.includes("Exclusive booking conflicts")
        ? "Can't save — this would exceed capacity or conflicts with another approved booking. " + error.message
        : "Couldn't save this booking: " + error.message
    );
    return;
  }

  const code = result?.[0]?.booking_code;
  await writeAudit(
    isHallLawn ? "staff_create_booking_request" : "staff_create_hourly_booking",
    isHallLawn ? "booking_requests" : "hourly_bookings",
    null,
    { code, facility_id: data.facility_id, phoned_in: true }
  );

  document.getElementById("addBookingModal").hidden = true;
  form.reset();
  document.getElementById("bookingDateInput").min = new Date().toISOString().slice(0, 10);
  alert(`Saved as ${code}.`);
  await loadFeed();
}

// ---------- Expenses ----------

function wireExpensesControls() {
  document.querySelectorAll("[data-month]").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("[data-month]").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeMonthFilter = chip.dataset.month;
      renderExpenses();
    });
  });
}

function wireAddExpenseModal() {
  const modal = document.getElementById("addExpenseModal");
  document.getElementById("openAddExpenseBtn").addEventListener("click", () => { modal.hidden = false; });
  document.getElementById("closeAddExpenseBtn").addEventListener("click", () => { modal.hidden = true; });
  document.getElementById("cancelAddExpenseBtn").addEventListener("click", () => { modal.hidden = true; });
  document.getElementById("addExpenseForm").addEventListener("submit", submitAddExpense);
}

async function loadExpenses() {
  const { data, error } = await supabaseClient
    .from("expenses")
    .select("*")
    .order("expense_date", { ascending: false });

  if (error) {
    document.getElementById("expenseList").innerHTML =
      `<p class="muted center" style="padding:40px;">Couldn't load expenses: ${escapeHtml(error.message)}</p>`;
    return;
  }

  allExpenses = data || [];
  renderExpenses();
}

function renderExpenses() {
  const container = document.getElementById("expenseList");
  const summary = document.getElementById("expenseSummary");
  let rows = allExpenses;

  if (activeMonthFilter === "current") {
    const now = new Date();
    rows = rows.filter((x) => {
      const d = new Date(x.expense_date);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
  }

  const total = rows.reduce((sum, x) => sum + Number(x.amount), 0);
  summary.innerHTML = `
    <div class="stat-tile"><strong>₹${total.toFixed(2)}</strong><span>${activeMonthFilter === "current" ? "This month" : "All time"} total</span></div>
    <div class="stat-tile"><strong>${rows.length}</strong><span>Expense${rows.length === 1 ? "" : "s"} logged</span></div>`;

  if (rows.length === 0) {
    container.innerHTML = `<p class="muted center" style="padding:40px;">No expenses logged ${activeMonthFilter === "current" ? "this month" : "yet"}.</p>`;
    return;
  }

  container.innerHTML = rows.map(expenseRowHtml).join("");
}

function expenseRowHtml(x) {
  const facilityLabel = x.facility_id ? (FACILITY_LABELS[x.facility_id] || x.facility_id) : "General / whole site";
  return `
    <div class="enquiry-card" style="border-left-color:var(--brick);">
      <div class="enquiry-card-main">
        <div>
          <strong>₹${Number(x.amount).toFixed(2)}</strong>
          <span class="muted"> · ${escapeHtml(x.category)}</span>
        </div>
        <div class="muted small">
          ${x.expense_date} · ${escapeHtml(facilityLabel)}${x.paid_by ? " · paid by " + escapeHtml(x.paid_by) : ""}
        </div>
        <p class="enquiry-message">${escapeHtml(x.description)}</p>
      </div>
    </div>`;
}

async function submitAddExpense(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());

  const { data: { user } } = await supabaseClient.auth.getUser();
  const { data: inserted, error } = await supabaseClient
    .from("expenses")
    .insert({
      expense_date: data.expense_date,
      category: data.category,
      facility_id: data.facility_id || null,
      description: data.description.trim(),
      amount: Number(data.amount),
      paid_by: data.paid_by?.trim() || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    alert("Couldn't save this expense: " + error.message);
    return;
  }

  await writeAudit("log_expense", "expenses", inserted.id, { category: data.category, amount: data.amount });
  document.getElementById("addExpenseModal").hidden = true;
  form.reset();
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("expenseDateInput").value = today;
  await loadExpenses();
}

// ---------- Shared ----------

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
