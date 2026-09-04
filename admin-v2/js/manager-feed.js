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
  pending: "#D9A441", approved: "#2E9E5B", cancelled: "#8A8A8A",
};
const ENQUIRY_STATUS_LABELS = { new: "New", contacted: "Contacted", follow_up: "Follow-up", converted: "Converted", lost: "Lost" };
const FACILITY_LABELS = {
  ac_hall: "AC Hall", non_ac_hall: "Non-AC Hall", lawn: "Lawn",
  pool: "Swimming Pool", badminton_1: "Badminton Court 1", badminton_2: "Badminton Court 2",
};
const HALL_LAWN_IDS = ["ac_hall", "non_ac_hall", "lawn"];
const CLUB_HOUSE_IDS = ["ac_hall", "non_ac_hall", "lawn"];

let staff = null;
let allFeed = [];
let activeType = "all";
let allExpenses = [];
let activeMonthFilter = "current";
let listControls = null;

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
  wireAddEnquiryModal();
  wireConvertModal();
  wireExpensesControls();
  wireAddExpenseModal();
  wireEditFeedBookingModal();

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
  document.getElementById("feedTypeFilter").addEventListener("change", (e) => {
    activeType = e.target.value;
    listControls?.resetPage();
    renderFeed();
  });

  listControls = createListControls({
    searchInputId: "feedSearch",
    dateFromId: "feedDateFrom",
    dateToId: "feedDateTo",
    pagerContainerId: "feedPager",
    searchText: (r) => `${r.customer_name} ${r.phone}`,
    dateField: (r) => r.activity_date,
    onChange: renderFeed,
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
  listControls?.resetPage();
  renderFeed();
}

function renderFeed() {
  const container = document.getElementById("feedList");
  let rows = allFeed;

  // "enquiry" filters by record type; "club_house" / "pool" / "badminton"
  // filter by facility group (matching the Dashboard's grouping) and apply
  // to enquiries and bookings alike — user request, dropdown replacing the
  // old per-record-type filter chips.
  if (activeType === "enquiry") {
    rows = rows.filter((r) => r.record_type === "enquiry");
  } else if (activeType === "club_house") {
    rows = rows.filter((r) => CLUB_HOUSE_IDS.includes(r.facility_id));
  } else if (activeType === "pool") {
    rows = rows.filter((r) => r.facility_id === "pool");
  } else if (activeType === "badminton") {
    rows = rows.filter((r) => (r.facility_id || "").startsWith("badminton"));
  }
  rows = listControls ? listControls.apply(rows) : rows;

  if (rows.length === 0) {
    container.innerHTML = `<p class="muted center" style="padding:40px;">Nothing here for the current search/filter.</p>`;
    listControls?.renderPager(0);
    return;
  }

  const page = listControls ? listControls.paginate(rows) : { rows };
  container.innerHTML = page.rows.map(feedRowHtml).join("");

  container.querySelectorAll("[data-action='edit-enquiry']").forEach((btn) => {
    btn.addEventListener("click", () => openEnquiryModal(allFeed.find((r) => r.id === btn.dataset.id)));
  });
  container.querySelectorAll("[data-action='edit-booking']").forEach((btn) => {
    btn.addEventListener("click", () => openEditFeedBookingModal(allFeed.find((r) => r.id === btn.dataset.id && r.record_type === btn.dataset.recordType)));
  });
  container.querySelectorAll("[data-convert]").forEach((btn) => {
    btn.addEventListener("click", () => openConvertModal(btn.dataset.convert));
  });
  listControls?.renderPager(rows.length);
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

  // Every row now gets the same three actions — Edit, WhatsApp, Call. Edit
  // is where status changes happen (enquiry status, or approve/reject/
  // cancel for bookings) — no more inline status dropdown or separate
  // Approve/Cancel buttons. Enquiries additionally keep "Convert to
  // Booking" since that's a distinct action, not a status change.
  let actionsHtml = "";
  if (r.record_type === "enquiry") {
    actionsHtml = `
      <button class="btn btn-outline-dark btn-sm" data-action="edit-enquiry" data-id="${r.id}">✏️ Edit</button>
      ${r.status !== "converted" ? `<button class="btn btn-primary btn-sm" data-convert="${r.id}">📅 Convert to Booking</button>` : ""}`;
  } else {
    // hall_lawn_booking / hourly_booking — date/slot/facility changes still
    // go through the dedicated Bookings / Pool & Badminton pages; this
    // feed's Edit only covers status + payment + refund, for the fast
    // call-and-decide path.
    const canEdit = r.status === "pending" || r.status === "approved";
    actionsHtml = canEdit
      ? `<button class="btn btn-outline-dark btn-sm" data-action="edit-booking" data-id="${r.id}" data-record-type="${r.record_type}">✏️ Edit</button>`
      : "";
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
          ${r.payment_status ? " · payment: " + r.payment_status + (r.total_amount != null ? ` (₹${Number(r.amount_paid).toFixed(2)} of ₹${Number(r.total_amount).toFixed(2)})` : "") : ""}
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

// ---------- Edit Booking modal (feed's fast call-and-decide path) ----------

// No "rejected" option any more — a pending request that isn't going
// forward is simply cancelled (user request, to keep this one action
// instead of two).
const FEED_STATUS_OPTIONS = {
  pending: [["pending", "Pending"], ["approved", "Approved"], ["cancelled", "Cancelled"]],
  approved: [["approved", "Approved"], ["cancelled", "Cancelled"]],
};

function wireEditFeedBookingModal() {
  const modal = document.getElementById("editFeedBookingModal");
  document.getElementById("closeEditFeedBookingBtn").addEventListener("click", () => { modal.hidden = true; });
  document.getElementById("editFeedBookingForm").addEventListener("submit", submitEditFeedBooking);
  document.getElementById("editFeedBookingStatus").addEventListener("change", (e) => {
    document.getElementById("editFeedCancelFields").hidden = e.target.value !== "cancelled";
  });
}

function openEditFeedBookingModal(row) {
  if (!row) return;
  const modal = document.getElementById("editFeedBookingModal");
  const form = document.getElementById("editFeedBookingForm");
  document.getElementById("editFeedBookingError").hidden = true;

  form.elements["id"].value = row.id;
  form.elements["record_type"].value = row.record_type;
  form.elements["customer_name"].value = row.customer_name;
  form.elements["phone"].value = row.phone; // locked — shown for reference only
  form.elements["email"].value = row.email || "";
  form.elements["facility_label"].value = row.facility_id ? (FACILITY_LABELS[row.facility_id] || row.facility_id) : "no facility chosen";
  form.elements["booking_date"].value = row.activity_date || "";
  form.elements["total_amount"].value = row.total_amount ?? "";
  form.elements["amount_paid"].value = row.amount_paid ?? "";
  form.elements["notes"].value = row.notes || "";
  form.elements["cancellation_reason"].value = "";
  form.elements["refund_status"].value = "none";
  form.elements["refund_notes"].value = "";

  const statusSelect = document.getElementById("editFeedBookingStatus");
  const options = FEED_STATUS_OPTIONS[row.status] || [[row.status, row.status]];
  statusSelect.innerHTML = options.map(([v, label]) => `<option value="${v}">${label}</option>`).join("");
  statusSelect.value = row.status;
  document.getElementById("editFeedCancelFields").hidden = true;

  modal.dataset.originalStatus = row.status;
  modal.hidden = false;
}

async function submitEditFeedBooking(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const errorEl = document.getElementById("editFeedBookingError");
  errorEl.hidden = true;

  const modal = document.getElementById("editFeedBookingModal");
  const originalStatus = modal.dataset.originalStatus;
  const recordType = data.record_type;
  const table = recordType === "hall_lawn_booking" ? "booking_requests" : "hourly_bookings";
  const row = allFeed.find((r) => r.id === data.id && r.record_type === recordType);
  if (!row) return;

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
  if (newStatus === "approved" && originalStatus === "pending" && totalAmount == null) {
    errorEl.textContent = "Enter a total amount before approving this booking.";
    errorEl.hidden = false;
    return;
  }

  let paymentStatus = row.payment_status;
  if (totalAmount != null || amountPaid != null) {
    const t = totalAmount ?? row.total_amount ?? 0;
    const p = amountPaid ?? row.amount_paid ?? 0;
    paymentStatus = p >= t && t > 0 ? "received" : p > 0 ? "partial" : "unpaid";
  }

  const update = {
    customer_name: data.customer_name.trim(),
    email: data.email?.trim() || null,
    notes: data.notes?.trim() || null,
    status: newStatus,
    total_amount: totalAmount,
    amount_paid: amountPaid,
    payment_status: paymentStatus,
    updated_at: new Date().toISOString(),
  };
  // Only touch the date if one was actually entered — an emptied field
  // should never null out a real booking date.
  if (data.booking_date) update.booking_date = data.booking_date;

  let auditAction = `edit_${recordType}`;
  if (newStatus !== originalStatus) {
    if (newStatus === "approved") {
      const { data: { user } } = await supabaseClient.auth.getUser();
      update.approved_by = user.id;
      update.approved_at = new Date().toISOString();
      auditAction = `approve_${recordType}`;
    } else if (newStatus === "rejected") {
      auditAction = `reject_${recordType}`;
    } else if (newStatus === "cancelled") {
      update.cancellation_reason = data.cancellation_reason?.trim() || null;
      update.cancelled_at = new Date().toISOString();
      auditAction = `cancel_${recordType}`;
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

  const { error } = await supabaseClient.from(table).update(update).eq("id", data.id);
  if (error) {
    errorEl.textContent =
      error.message?.includes("duplicate key") || error.code === "23505"
        ? "That slot is already approved for another booking on this date."
        : error.message?.includes("Capacity exceeded") || error.message?.includes("Exclusive booking conflicts")
        ? "Can't save — this would exceed capacity or conflicts with another approved booking. " + error.message
        : "Couldn't save changes: " + error.message;
    errorEl.hidden = false;
    return;
  }

  await writeAudit(auditAction, table, data.id, { code: row.code, status: newStatus });
  Object.assign(row, update);
  modal.hidden = true;
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

  // Approving requires a payment amount, same as approving from the feed
  // list itself — ask for it before creating the row so a phoned-in booking
  // can't be marked approved without payment being recorded.
  let paymentEntry = null;
  if (markApproved) {
    paymentEntry = await promptPaymentEntry({
      allowPartial: true,
      label: `Approve this booking for ${data.customer_name.trim()}`,
    });
    if (!paymentEntry) return; // backed out — leave the modal open, nothing saved yet
  }

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
  const table = isHallLawn ? "booking_requests" : "hourly_bookings";

  if (markApproved && paymentEntry) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error: payError } = await supabaseClient
      .from(table)
      .update({
        total_amount: paymentEntry.total_amount,
        amount_paid: paymentEntry.amount_paid,
        payment_status: paymentEntry.payment_status,
        approved_at: new Date().toISOString(),
        approved_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("booking_code", code);
    if (payError) {
      alert(`Saved as ${code}, but couldn't record the payment: ${payError.message}. Use Update Payment on it from the feed.`);
    }
  }

  await writeAudit(
    isHallLawn ? "staff_create_booking_request" : "staff_create_hourly_booking",
    table,
    null,
    { code, facility_id: data.facility_id, phoned_in: true, ...(paymentEntry ? { total_amount: paymentEntry.total_amount, amount_paid: paymentEntry.amount_paid } : {}) }
  );

  document.getElementById("addBookingModal").hidden = true;
  form.reset();
  document.getElementById("bookingDateInput").min = new Date().toISOString().slice(0, 10);
  alert(`Saved as ${code}.`);
  await loadFeed();
}

// ---------- Add Enquiry modal ----------

function wireAddEnquiryModal() {
  const modal = document.getElementById("enquiryModal");
  document.getElementById("openAddEnquiryBtn").addEventListener("click", () => openEnquiryModal());
  document.getElementById("closeEnquiryModalBtn").addEventListener("click", () => { modal.hidden = true; });

  const phoneInput = document.getElementById("enquiryPhoneInput2");
  phoneInput.addEventListener("input", () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 10);
  });

  document.getElementById("enquiryForm2").addEventListener("submit", submitEnquiryModal);
}

// Called with no argument to Add a new enquiry, or with a feed row to Edit
// one — status is only shown/editable in Edit mode (a new enquiry always
// starts as "new").
function openEnquiryModal(row) {
  const modal = document.getElementById("enquiryModal");
  const form = document.getElementById("enquiryForm2");
  form.reset();
  const statusWrap = document.getElementById("enquiryStatusFieldWrap");

  const phoneInput = form.elements["phone"];
  if (row) {
    document.getElementById("enquiryModalTitle").textContent = "Edit Enquiry";
    form.elements["id"].value = row.id;
    form.elements["customer_name"].value = row.customer_name;
    phoneInput.value = row.phone;
    phoneInput.disabled = true; // locked once an enquiry exists — user request
    phoneInput.classList.add("locked-field");
    form.elements["email"].value = row.email || "";
    form.elements["facility_id"].value = row.facility_id || "";
    form.elements["preferred_date"].value = row.activity_date || "";
    form.elements["message"].value = row.notes || "";
    form.elements["status"].value = row.status || "new";
    statusWrap.hidden = false;
  } else {
    document.getElementById("enquiryModalTitle").textContent = "Add Enquiry";
    form.elements["id"].value = "";
    phoneInput.disabled = false;
    phoneInput.classList.remove("locked-field");
    statusWrap.hidden = true;
  }
  modal.hidden = false;
}

async function submitEnquiryModal(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());

  // Phone is locked (excluded from the form payload) once an enquiry
  // already exists — only validate/require it for a brand-new enquiry.
  if (!data.id && !/^[0-9]{10}$/.test(data.phone)) {
    alert("Please enter a valid 10-digit mobile number.");
    return;
  }
  if (!data.customer_name || data.customer_name.trim().length < 2) {
    alert("Please enter the customer's name.");
    return;
  }

  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving...";

  if (data.id) {
    // Editing an existing enquiry — status changes now happen here instead
    // of the old inline per-row dropdown. Phone is not included: it's
    // locked in the edit form (user request).
    const update = {
      customer_name: data.customer_name.trim(),
      email: data.email?.trim() || null,
      facility_id: data.facility_id || null,
      preferred_date: data.preferred_date || null,
      guests: data.guests ? Number(data.guests) : null,
      message: data.message?.trim() || null,
      status: data.status,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseClient.from("enquiries").update(update).eq("id", data.id);

    submitBtn.disabled = false;
    submitBtn.textContent = "Save Enquiry";

    if (error) {
      alert("Couldn't save changes: " + error.message);
      return;
    }
    await writeAudit("edit_enquiry", "enquiries", data.id, { status: data.status });
    document.getElementById("enquiryModal").hidden = true;
    await loadFeed();
    return;
  }

  // Phoned-in enquiry — goes through the same submit_enquiry() path the
  // public site uses, so it gets a real enquiry code and the same validation.
  const { data: result, error } = await supabaseClient.rpc("submit_enquiry", {
    p_customer_name: data.customer_name.trim(),
    p_phone: data.phone.trim(),
    p_email: data.email?.trim() || null,
    p_facility_id: data.facility_id || null,
    p_preferred_date: data.preferred_date || null,
    p_guests: data.guests ? Number(data.guests) : null,
    p_message: data.message?.trim() || null,
    p_source: "phone",
  });

  submitBtn.disabled = false;
  submitBtn.textContent = "Save Enquiry";

  if (error) {
    alert("Couldn't save this enquiry: " + error.message);
    return;
  }
  await writeAudit("add_enquiry", "enquiries", null, { code: result?.[0]?.enquiry_code, phoned_in: true });

  document.getElementById("enquiryModal").hidden = true;
  await loadFeed();
}

// ---------- Convert Enquiry to Booking modal ----------

let convertingEnquiry = null;

function wireConvertModal() {
  const modal = document.getElementById("convertModal");
  document.getElementById("closeConvertModalBtn").addEventListener("click", () => { modal.hidden = true; });

  const facilitySelect = document.getElementById("convertFacilitySelect");
  const toggleFields = () => {
    const isHallLawn = HALL_LAWN_IDS.includes(facilitySelect.value);
    document.getElementById("convertFixedSlotFields").hidden = !isHallLawn;
    document.getElementById("convertHourlyFields").hidden = isHallLawn;
    document.getElementById("convertModeFieldWrap").hidden = facilitySelect.value !== "pool";
  };
  facilitySelect.addEventListener("change", toggleFields);

  document.getElementById("convertForm").addEventListener("submit", submitConvert);
}

// Feed rows are the trimmed manager_activity_feed view (no guests/message
// columns), so pull the full enquiry row before opening the modal.
async function openConvertModal(enquiryId) {
  const { data: enquiry, error } = await supabaseClient
    .from("enquiries")
    .select("*")
    .eq("id", enquiryId)
    .single();

  if (error || !enquiry) {
    alert("Couldn't load this enquiry: " + (error?.message || "not found"));
    return;
  }
  convertingEnquiry = enquiry;

  const modal = document.getElementById("convertModal");
  const form = document.getElementById("convertForm");
  form.reset();
  form.elements["enquiry_id"].value = enquiry.id;
  document.getElementById("convertCustomerLine").textContent =
    `${enquiry.customer_name} · ${enquiry.phone}${enquiry.email ? " · " + enquiry.email : ""}`;

  const facilitySelect = document.getElementById("convertFacilitySelect");
  if (enquiry.facility_id && FACILITY_LABELS[enquiry.facility_id]) {
    facilitySelect.value = enquiry.facility_id;
  }
  document.getElementById("convertDateInput").value = enquiry.preferred_date || "";
  form.elements["guests"].value = enquiry.guests || "";

  const isHallLawn = HALL_LAWN_IDS.includes(facilitySelect.value);
  document.getElementById("convertFixedSlotFields").hidden = !isHallLawn;
  document.getElementById("convertHourlyFields").hidden = isHallLawn;
  document.getElementById("convertModeFieldWrap").hidden = facilitySelect.value !== "pool";

  modal.hidden = false;
}

async function submitConvert(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const enquiry = convertingEnquiry;
  if (!enquiry || enquiry.id !== data.enquiry_id) return;

  const isHallLawn = HALL_LAWN_IDS.includes(data.facility_id);
  const markApproved = form.elements["mark_approved"].checked;

  let paymentEntry = null;
  if (markApproved) {
    paymentEntry = await promptPaymentEntry({
      allowPartial: true,
      label: `Approve this booking for ${enquiry.customer_name}`,
    });
    if (!paymentEntry) return;
  }

  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "Creating...";

  let result, error;
  if (isHallLawn) {
    ({ data: result, error } = await supabaseClient.rpc("staff_create_booking_request", {
      p_customer_name: enquiry.customer_name,
      p_phone: enquiry.phone,
      p_facility_id: data.facility_id,
      p_booking_date: data.booking_date,
      p_slot: data.slot,
      p_email: enquiry.email || null,
      p_guests: data.guests ? Number(data.guests) : null,
      p_notes: enquiry.message || null,
      p_mark_approved: markApproved,
    }));
  } else {
    const isPool = data.facility_id === "pool";
    const startTime = data.start_time;
    const endTime = addHours(startTime, Number(data.duration || 1));
    ({ data: result, error } = await supabaseClient.rpc("staff_create_hourly_booking", {
      p_customer_name: enquiry.customer_name,
      p_phone: enquiry.phone,
      p_facility_id: data.facility_id,
      p_booking_date: data.booking_date,
      p_start_time: startTime,
      p_end_time: endTime,
      p_guests: isPool ? Number(data.guests || 1) : 1,
      p_mode: isPool ? data.mode : null,
      p_email: enquiry.email || null,
      p_mark_approved: markApproved,
    }));
  }

  submitBtn.disabled = false;
  submitBtn.textContent = "Create Booking";

  if (error) {
    alert(
      error.message?.includes("duplicate key") || error.code === "23505"
        ? "That slot is already approved for another booking on this date."
        : error.message?.includes("Capacity exceeded") || error.message?.includes("Exclusive booking conflicts")
        ? "Can't create — this would exceed capacity or conflicts with another approved booking. " + error.message
        : "Couldn't create this booking: " + error.message
    );
    return;
  }

  const code = result?.[0]?.booking_code;
  const table = isHallLawn ? "booking_requests" : "hourly_bookings";

  const linkUpdate = { enquiry_id: enquiry.id };
  if (markApproved && paymentEntry) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    Object.assign(linkUpdate, {
      total_amount: paymentEntry.total_amount,
      amount_paid: paymentEntry.amount_paid,
      payment_status: paymentEntry.payment_status,
      approved_at: new Date().toISOString(),
      approved_by: user.id,
    });
  }
  const { error: linkError } = await supabaseClient.from(table).update(linkUpdate).eq("booking_code", code);
  if (linkError) console.error("Couldn't link booking to enquiry:", linkError);

  const { error: statusError } = await supabaseClient
    .from("enquiries")
    .update({ status: "converted", updated_at: new Date().toISOString() })
    .eq("id", enquiry.id);
  if (statusError) console.error("Couldn't mark enquiry converted:", statusError);

  await writeAudit("convert_enquiry_to_booking", table, null, { enquiry_code: enquiry.enquiry_code, booking_code: code });

  convertingEnquiry = null;
  document.getElementById("convertModal").hidden = true;
  alert(`Created booking ${code}.`);
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
  document.getElementById("openAddExpenseBtn").addEventListener("click", () => {
    document.getElementById("addExpenseForm").reset();
    document.getElementById("addExpenseForm").elements["id"].value = "";
    document.getElementById("expenseModalTitle").textContent = "Log an expense";
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById("expenseDateInput").value = today;
    modal.hidden = false;
  });
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
  container.querySelectorAll("[data-edit-expense]").forEach((btn) => {
    btn.addEventListener("click", () => openEditExpenseModal(allExpenses.find((x) => x.id === btn.dataset.editExpense)));
  });
}

function openEditExpenseModal(expense) {
  if (!expense) return;
  const modal = document.getElementById("addExpenseModal");
  const form = document.getElementById("addExpenseForm");
  document.getElementById("expenseModalTitle").textContent = "Edit expense";
  form.elements["id"].value = expense.id;
  form.elements["expense_date"].value = expense.expense_date;
  form.elements["amount"].value = expense.amount;
  form.elements["category"].value = expense.category;
  form.elements["facility_id"].value = expense.facility_id || "";
  form.elements["description"].value = expense.description;
  form.elements["paid_by"].value = expense.paid_by || "";
  modal.hidden = false;
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
      <div class="enquiry-card-actions">
        <button class="btn btn-outline-dark btn-sm" data-edit-expense="${x.id}">✏️ Edit</button>
      </div>
    </div>`;
}

async function submitAddExpense(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());

  const fields = {
    expense_date: data.expense_date,
    category: data.category,
    facility_id: data.facility_id || null,
    description: data.description.trim(),
    amount: Number(data.amount),
    paid_by: data.paid_by?.trim() || null,
  };

  if (data.id) {
    const { error } = await supabaseClient.from("expenses").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", data.id);
    if (error) {
      alert("Couldn't save changes: " + error.message);
      return;
    }
    await writeAudit("edit_expense", "expenses", data.id, { category: data.category, amount: data.amount });
  } else {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { data: inserted, error } = await supabaseClient
      .from("expenses")
      .insert({ ...fields, created_by: user.id })
      .select()
      .single();

    if (error) {
      alert("Couldn't save this expense: " + error.message);
      return;
    }
    await writeAudit("log_expense", "expenses", inserted.id, { category: data.category, amount: data.amount });
  }

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
