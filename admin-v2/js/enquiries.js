// PeedsPark Admin — Enquiries management (Phase 2)

const STATUS_COLORS = {
  new: "#0E7C7B",
  contacted: "#D9A441",
  follow_up: "#FF6B35",
  converted: "#2E9E5B",
  lost: "#8A8A8A",
};
const STATUS_LABELS = {
  new: "New",
  contacted: "Contacted",
  follow_up: "Follow-up",
  converted: "Converted",
  lost: "Lost",
};
const HALL_LAWN_IDS = ["ac_hall", "non_ac_hall", "lawn"];
const FACILITY_LABELS = {
  ac_hall: "AC Hall", non_ac_hall: "Non-AC Hall", lawn: "Lawn",
  pool: "Swimming Pool", badminton_1: "Badminton Court 1", badminton_2: "Badminton Court 2",
};

let currentStaff = null;
let allEnquiries = [];
let activeFilter = "all";

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireStaffSession();
  if (!session) return;
  currentStaff = session.staff;

  document.getElementById("staffName").textContent = currentStaff.full_name;
  document.getElementById("staffRole").textContent = currentStaff.role;
  document.getElementById("pageContent").hidden = false;

  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeFilter = chip.dataset.status;
      renderList();
    });
  });

  wireEnquiryModal();
  wireConvertModal();

  await loadEnquiries();
});

async function loadEnquiries() {
  const { data, error } = await supabaseClient
    .from("enquiries")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    document.getElementById("enquiryList").innerHTML =
      `<p class="muted center" style="padding:40px;">Couldn't load enquiries: ${escapeHtml(error.message)}</p>`;
    return;
  }

  allEnquiries = data || [];
  renderList();
}

function renderList() {
  const container = document.getElementById("enquiryList");
  const rows = activeFilter === "all" ? allEnquiries : allEnquiries.filter(e => e.status === activeFilter);

  if (rows.length === 0) {
    container.innerHTML = `<p class="muted center" style="padding:40px;">No enquiries here.</p>`;
    return;
  }

  container.innerHTML = rows.map(rowHtml).join("");

  container.querySelectorAll("select.status-select").forEach(sel => {
    sel.addEventListener("change", (e) => updateStatus(e.target.dataset.id, e.target.value));
  });
  container.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => openEnquiryModal(allEnquiries.find(e => e.id === btn.dataset.edit)));
  });
  container.querySelectorAll("[data-convert]").forEach(btn => {
    btn.addEventListener("click", () => openConvertModal(allEnquiries.find(e => e.id === btn.dataset.convert)));
  });
}

function rowHtml(e) {
  const color = STATUS_COLORS[e.status] || "#999";
  const waLink = `https://wa.me/${e.phone.replace(/\D/g, "")}`;
  return `
    <div class="enquiry-card" style="border-left-color:${color};">
      <div class="enquiry-card-main">
        <div>
          <strong>${escapeHtml(e.customer_name)}</strong>
          <span class="muted"> · ${escapeHtml(e.phone)}</span>
          ${e.email ? `<span class="muted"> · ${escapeHtml(e.email)}</span>` : ""}
        </div>
        <div class="muted small">
          ${e.enquiry_code} · ${e.facility_id ? escapeHtml(e.facility_id) : "no facility chosen"}
          ${e.preferred_date ? " · " + e.preferred_date : ""}
          ${e.guests ? " · " + e.guests + " guests" : ""}
          · source: ${e.source || "unknown"}
          · ${new Date(e.created_at).toLocaleString()}
        </div>
        ${e.message ? `<p class="enquiry-message">${escapeHtml(e.message)}</p>` : ""}
      </div>
      <div class="enquiry-card-actions">
        <select class="status-select" data-id="${e.id}">
          ${Object.entries(STATUS_LABELS).map(([val, label]) =>
            `<option value="${val}" ${val === e.status ? "selected" : ""}>${label}</option>`
          ).join("")}
        </select>
        ${e.status !== "converted" ? `<button class="btn btn-primary btn-sm" data-convert="${e.id}">📅 Convert to Booking</button>` : ""}
        <button class="btn btn-outline-dark btn-sm" data-edit="${e.id}">✏️ Edit</button>
        <a class="btn btn-outline-dark btn-sm" href="${waLink}" target="_blank" rel="noopener">💬 WhatsApp</a>
        <a class="btn btn-outline-dark btn-sm" href="tel:${e.phone}">📞 Call</a>
      </div>
    </div>`;
}

async function updateStatus(id, newStatus) {
  const enquiry = allEnquiries.find(e => e.id === id);
  const oldStatus = enquiry?.status;

  const { error } = await supabaseClient
    .from("enquiries")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    alert("Couldn't update status: " + error.message);
    return;
  }

  // Best-effort audit trail — RLS (audit_log_staff_insert) requires actor_id = auth.uid().
  const { data: { user } } = await supabaseClient.auth.getUser();
  await supabaseClient.from("audit_log").insert({
    actor_id: user.id,
    action: "update_enquiry_status",
    table_name: "enquiries",
    record_id: id,
    details: { from: oldStatus, to: newStatus },
  });

  if (enquiry) enquiry.status = newStatus;
  renderList();
}

// ---------- Add / Edit Enquiry modal ----------

function wireEnquiryModal() {
  const modal = document.getElementById("enquiryModal");
  document.getElementById("openAddEnquiryBtn").addEventListener("click", () => openEnquiryModal(null));
  document.getElementById("closeEnquiryModalBtn").addEventListener("click", () => { modal.hidden = true; });

  const phoneInput = document.getElementById("enquiryPhoneInput2");
  phoneInput.addEventListener("input", () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 10);
  });

  document.getElementById("enquiryForm2").addEventListener("submit", submitEnquiryModal);
}

function openEnquiryModal(enquiry) {
  const modal = document.getElementById("enquiryModal");
  const form = document.getElementById("enquiryForm2");
  form.reset();
  document.getElementById("enquiryModalTitle").textContent = enquiry ? "Edit Enquiry" : "Add Enquiry";
  form.elements["id"].value = enquiry?.id || "";
  if (enquiry) {
    form.elements["customer_name"].value = enquiry.customer_name || "";
    form.elements["phone"].value = enquiry.phone || "";
    form.elements["email"].value = enquiry.email || "";
    form.elements["facility_id"].value = enquiry.facility_id || "";
    form.elements["preferred_date"].value = enquiry.preferred_date || "";
    form.elements["guests"].value = enquiry.guests || "";
    form.elements["message"].value = enquiry.message || "";
  }
  modal.hidden = false;
}

async function submitEnquiryModal(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());

  if (!/^[0-9]{10}$/.test(data.phone)) {
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
    // Editing an existing enquiry — direct update (enquiries_staff_update RLS).
    const { error } = await supabaseClient
      .from("enquiries")
      .update({
        customer_name: data.customer_name.trim(),
        phone: data.phone.trim(),
        email: data.email?.trim() || null,
        facility_id: data.facility_id || null,
        preferred_date: data.preferred_date || null,
        guests: data.guests ? Number(data.guests) : null,
        message: data.message?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);

    submitBtn.disabled = false;
    submitBtn.textContent = "Save Enquiry";

    if (error) {
      alert("Couldn't save this enquiry: " + error.message);
      return;
    }
    await writeAudit("edit_enquiry", "enquiries", data.id, {});
  } else {
    // Adding a phoned-in enquiry — goes through the same submit_enquiry()
    // path the public site uses, so it gets a real enquiry code and the
    // same validation.
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
  }

  document.getElementById("enquiryModal").hidden = true;
  await loadEnquiries();
}

// ---------- Convert to Booking modal ----------

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

function addHours(time, hours) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + hours * 60;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function openConvertModal(enquiry) {
  if (!enquiry) return;
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
  const enquiry = allEnquiries.find(x => x.id === data.enquiry_id);
  if (!enquiry) return;

  const isHallLawn = HALL_LAWN_IDS.includes(data.facility_id);
  const markApproved = form.elements["mark_approved"].checked;

  let paymentEntry = null;
  if (markApproved) {
    paymentEntry = promptPaymentEntry({
      allowPartial: isHallLawn,
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

  // Link the new booking back to the enquiry it came from, and record
  // payment if it was approved on the spot.
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

  // Mark the enquiry converted.
  const { error: statusError } = await supabaseClient
    .from("enquiries")
    .update({ status: "converted", updated_at: new Date().toISOString() })
    .eq("id", enquiry.id);
  if (statusError) console.error("Couldn't mark enquiry converted:", statusError);
  else { enquiry.status = "converted"; }

  await writeAudit("convert_enquiry_to_booking", table, null, { enquiry_code: enquiry.enquiry_code, booking_code: code });

  document.getElementById("convertModal").hidden = true;
  alert(`Created booking ${code}.`);
  renderList();
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
