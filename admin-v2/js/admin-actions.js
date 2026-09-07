// Shared creation and in-place enquiry conversion for all staff facility views.
const AdminActions = (() => {
  const labels = { ac_hall: "AC Hall", non_ac_hall: "Non-AC Hall", lawn: "Lawn", pool: "Swimming Pool", badminton_1: "Badminton Court 1", badminton_2: "Badminton Court 2" };
  const halls = ["ac_hall", "non_ac_hall", "lawn"];
  let config;
  let currentEnquiry = null;
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const field = (name, label, type = "text", extra = "") => `<label>${label}<input name="${name}" type="${type}" ${extra}></label>`;
  const options = (ids) => ids.map(id => `<option value="${id}">${labels[id]}</option>`).join("");
  const details = () => `<fieldset class="booking-details-fields">
    <legend>Booking details</legend>
    <label data-fixed>Slot<select name="slot"><option value="morning">Morning (8am–2pm)</option><option value="evening">Evening (4pm–10pm)</option><option value="full_day">Full Day</option></select></label>
    <div data-hourly class="modal-row">${field("start_time", "Start time", "time", 'value="10:00"')}
      <label>Duration<select name="duration"><option value="1">1 hour</option><option value="2">2 hours</option><option value="3">3 hours</option><option value="4">4 hours</option></select></label></div>
    <label data-pool>Booking mode<select name="mode"><option value="shared">Shared</option><option value="exclusive">Exclusive</option></select></label>
    <label class="inline-check"><input type="checkbox" name="mark_approved">Already confirmed with the customer</label>
    <div data-payment class="modal-row">${field("total_amount", "Total amount (₹)", "number", 'min="0" step="0.01"')}${field("amount_paid", "Amount paid (₹)", "number", 'min="0" step="0.01"')}</div>
  </fieldset>`;

  function setGroup(group, enabled) {
    group.hidden = !enabled;
    group.querySelectorAll("input, select, textarea").forEach(el => { el.disabled = !enabled; });
  }

  function syncDetails(form, enabled = true) {
    const box = form.querySelector(".booking-details-fields");
    if (!box) return;
    setGroup(box, enabled);
    if (!enabled) return;
    const facility = form.elements.facility_id.value;
    setGroup(box.querySelector("[data-fixed]"), halls.includes(facility));
    setGroup(box.querySelector("[data-hourly]"), !halls.includes(facility));
    setGroup(box.querySelector("[data-pool]"), facility === "pool");
    setGroup(box.querySelector("[data-payment]"), form.elements.mark_approved.checked);
    form.elements.start_time.required = !halls.includes(facility);
    form.elements.total_amount.required = form.elements.mark_approved.checked;
    form.elements.amount_paid.required = form.elements.mark_approved.checked;
  }

  function error(form, message = "") {
    const el = form.querySelector("[data-action-error]");
    el.textContent = message;
    el.hidden = !message;
  }

  function notice(message) {
    let el = document.getElementById("adminActionNotice");
    if (!el) {
      el = document.createElement("p");
      el.id = "adminActionNotice";
      el.className = "confirmation-panel";
      el.setAttribute("role", "status");
      document.getElementById("pageContent").prepend(el);
    }
    el.textContent = message;
  }

  function modal(id, title, fields) {
    const el = document.createElement("div");
    el.id = id;
    el.className = "modal-backdrop";
    el.hidden = true;
    el.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="${id}Title">
      <button type="button" class="modal-close" data-close aria-label="Close">&times;</button>
      <h3 id="${id}Title">${title}</h3><form>${fields}<p data-action-error class="form-error" role="alert" hidden></p>
      <div class="modal-actions"><button type="button" class="btn btn-outline-dark" data-close>Cancel</button><button type="submit" class="btn btn-primary">Save</button></div></form></div>`;
    document.body.append(el);
    el.querySelectorAll("[data-close]").forEach(btn => btn.addEventListener("click", () => { el.hidden = true; }));
    el.addEventListener("keydown", e => { if (e.key === "Escape") el.hidden = true; });
    return el;
  }

  function bookingPayload(form, enquiry = null) {
    const data = Object.fromEntries(new FormData(form));
    const facility = data.facility_id;
    if (!config.facilityIds().includes(facility)) throw new Error("Choose a facility you can manage.");
    if (!data.customer_name?.trim() || data.customer_name.trim().length < 2) throw new Error("Enter the customer's name.");
    const phone = enquiry ? enquiry.phone : data.phone?.trim();
    if (!/^\d{10}$/.test(phone || "")) throw new Error("Enter a valid 10-digit phone number.");
    const date = data.booking_date || data.preferred_date;
    if (!date) throw new Error("Choose a booking date.");
    const approved = form.elements.mark_approved.checked;
    const total = approved ? Number(data.total_amount) : null;
    const paid = approved ? Number(data.amount_paid) : null;
    if (approved && (data.total_amount === "" || data.amount_paid === "" || !Number.isFinite(total) || !Number.isFinite(paid) || paid < 0 || total < paid)) {
      throw new Error("Enter a valid total and payment. Payment cannot exceed the total.");
    }
    let end = null;
    if (!halls.includes(facility)) {
      if (!/^\d{2}:\d{2}$/.test(data.start_time || "")) throw new Error("Choose a start time.");
      const [h, m] = data.start_time.split(":").map(Number);
      const minutes = h * 60 + m + Number(data.duration) * 60;
      if (minutes >= 1440) throw new Error("The booking must finish before midnight.");
      end = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    }
    return { enquiry_id: enquiry?.id || null, customer_name: data.customer_name.trim(), phone,
      email: data.email?.trim() || null, facility_id: facility, booking_date: date, slot: data.slot || null,
      start_time: data.start_time || null, end_time: end, mode: facility === "pool" ? data.mode : null,
      guests: data.guests ? Number(data.guests) : null, notes: data.notes || data.message || null,
      mark_approved: approved, total_amount: total, amount_paid: paid };
  }

  async function saveBooking(form, enquiry = null) {
    error(form);
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    try {
      const payload = bookingPayload(form, enquiry);
      button.disabled = true;
      const { data, error: failure } = await supabaseClient.rpc("staff_save_booking_enquiry", { p_data: payload });
      if (failure) throw failure;
      form.closest(".modal-backdrop").hidden = true;
      notice(`Saved booking enquiry ${data.booking_code}.`);
      await config.onSaved();
    } catch (err) { error(form, err.message || "Couldn't save. Please try again."); }
    finally { button.disabled = false; }
  }

  function prepareEnquiry(row) {
    currentEnquiry = row || null;
    const form = document.getElementById("enquiryForm2");
    const button = form.querySelector("[data-convert-enquiry]");
    button.hidden = !row || row.status === "converted";
    form.elements.mark_approved.checked = false;
    syncEnquiry();
    error(form);
  }

  function syncEnquiry() {
    const form = document.getElementById("enquiryForm2");
    const enabled = !!currentEnquiry && currentEnquiry.status !== "converted" && form.elements.status.value === "converted";
    syncDetails(form, enabled);
    form.elements.facility_id.required = enabled;
    form.elements.preferred_date.required = enabled;
    form.querySelector('button[type="submit"]').textContent = enabled ? "Save and convert to booking" : "Save Enquiry";
  }

  function init(opts) {
    config = opts;
    const booking = modal("sharedAddBooking", "Add Booking enquiry", `
      <label>Facility<select name="facility_id" required></select></label>
      <div class="modal-row">${field("customer_name", "Name", "text", 'required minlength="2"')}${field("phone", "Phone", "tel", 'required inputmode="numeric" pattern="[0-9]{10}" maxlength="10"')}</div>
      <div class="modal-row">${field("email", "Email (optional)", "email")}${field("guests", "Guests", "number", 'min="1"')}</div>
      ${field("booking_date", "Date", "date", "required")}${details()}<label>Notes<textarea name="notes" rows="2"></textarea></label>`);
    const form = booking.querySelector("form");
    document.getElementById("openAddBookingBtn").addEventListener("click", () => {
      form.reset(); error(form);
      form.elements.facility_id.innerHTML = options(config.facilityIds());
      form.elements.booking_date.min = today();
      syncDetails(form); booking.hidden = false;
      form.elements.customer_name.focus();
    });
    form.addEventListener("change", () => syncDetails(form));
    form.addEventListener("submit", e => { e.preventDefault(); saveBooking(form); });

    const enquiryForm = document.getElementById("enquiryForm2");
    if (enquiryForm) {
      enquiryForm.querySelector(".modal-actions").insertAdjacentHTML("beforebegin", `<button type="button" class="btn btn-outline-dark" data-convert-enquiry>Convert to Booking</button>${details()}<p data-action-error class="form-error" role="alert" hidden></p>`);
      enquiryForm.querySelector("[data-convert-enquiry]").addEventListener("click", () => { enquiryForm.elements.status.value = "converted"; syncEnquiry(); });
      enquiryForm.addEventListener("change", syncEnquiry);
      enquiryForm.addEventListener("submit", e => {
        if (currentEnquiry && currentEnquiry.status !== "converted" && enquiryForm.elements.status.value === "converted") {
          e.preventDefault(); e.stopImmediatePropagation(); saveBooking(enquiryForm, currentEnquiry);
        }
      }, true);
      prepareEnquiry(null);
    }
    if (opts.expenses !== false) setupExpense();
  }

  function setupExpense() {
    const trigger = document.getElementById("openAddExpenseBtn");
    if (config.staff.role === "pool_manager") { trigger.hidden = true; return; }
    const expense = modal("sharedAddExpense", "Add Expense", `<div class="modal-row">${field("expense_date", "Date", "date", "required")}${field("amount", "Amount (₹)", "number", 'required min="0" step="0.01"')}</div>
      <div class="modal-row"><label>Category<select name="category"><option value="maintenance">Maintenance</option><option value="wages">Wages</option><option value="supplies">Supplies</option><option value="utilities">Utilities</option><option value="other">Other</option></select></label>
      <label>Facility<select name="facility_id" required></select></label></div>
      <label>Description<textarea name="description" required rows="2"></textarea></label>${field("paid_by", "Paid by (optional)")}`);
    const form = expense.querySelector("form");
    trigger.addEventListener("click", () => {
      form.reset(); error(form);
      form.elements.facility_id.innerHTML = options(config.facilityIds());
      form.elements.expense_date.value = today(); form.elements.expense_date.max = today();
      expense.hidden = false;
    });
    form.addEventListener("submit", async e => {
      e.preventDefault(); error(form);
      const button = form.querySelector('button[type="submit"]');
      if (button.disabled) return;
      button.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(form));
        if (!config.facilityIds().includes(data.facility_id)) throw new Error("Choose a facility you can manage.");
        if (!data.description.trim()) throw new Error("Enter an expense description.");
        const { error: failure } = await supabaseClient.from("expenses").insert({ ...data, description: data.description.trim(), amount: Number(data.amount), created_by: config.staff.id });
        if (failure) throw failure;
        expense.hidden = true; notice("Expense saved. You can review it in Manager Feed → Expenses.");
      } catch (err) { error(form, err.message || "Couldn't save this expense."); }
      finally { button.disabled = false; }
    });
  }
  return { init, prepareEnquiry, bookingPayload };
})();
