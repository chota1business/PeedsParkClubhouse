// PeedsPark — shared "check availability & book" flow for facility pages
// (pool.html, badminton.html, ac-hall.html, non-ac-hall.html, lawn.html).
// Each page sets window.FACILITY_PAGE_CONFIG before this script loads, e.g.:
//
//   window.FACILITY_PAGE_CONFIG = {
//     type: "hourly",              // "hourly" | "fixed"
//     bookingModel: "capacity",    // "capacity" (pool) | "resource" (badminton) — hourly only
//     facilities: [{ id: "pool", label: "Swimming Pool" }],
//     showCourtSelector: false,    // true for badminton (two courts)
//     showModeAndGuests: true,     // true for pool only (Shared/Exclusive + guest count)
//   };
//
// This mirrors the old Apps Script site's merged "check a date, then request
// to book" flow: one date/facility picker, a slot list, and clicking an
// Available slot reveals an inline mini booking form for that slot — no
// separate "Check Availability" and "Book" sections to keep in sync.

const WHATSAPP_NUMBER = "919846718106";

const formRenderedAt = Date.now();
const MIN_FILL_TIME_MS = 3000;

const FIXED_SLOT_KEYS = ["morning", "evening", "full_day"];

// End times for the fixed Hall/Lawn slots, matching get_facility_slots()'s
// hardcoded windows (Morning 8am-2pm, Evening 4pm-10pm). Full Day is treated
// as over once Evening ends, since that's the later of the two windows it
// covers — once it's past 10pm there's no meaningful "rest of the day" left
// to book, for any of the three.
const FIXED_SLOT_END_TIMES = {
  morning: "14:00",
  evening: "22:00",
  full_day: "22:00",
};

let selectedSlot = null; // { facility, date, type: 'fixed'|'hourly', slotKey?, start?, remaining?, capacity? }

document.addEventListener("DOMContentLoaded", () => {
  const config = window.FACILITY_PAGE_CONFIG;
  if (!config) return;

  const today = new Date().toISOString().split("T")[0];
  const dateInput = document.getElementById("pageDate");
  if (dateInput) dateInput.min = today;

  const facilitySelect = document.getElementById("pageFacility");
  if (facilitySelect && config.facilities.length > 1) {
    facilitySelect.innerHTML = config.facilities
      .map((f) => `<option value="${f.id}">${f.label}</option>`)
      .join("");
    facilitySelect.closest(".form-row, label")?.removeAttribute("hidden");
  } else if (facilitySelect) {
    // Single-facility page: no need to show a selector at all, but the
    // <select> still needs a real <option> so .value actually sticks —
    // setting .value on an empty <select> silently no-ops and leaves the
    // facility_id sent to the server blank.
    facilitySelect.innerHTML = `<option value="${config.facilities[0].id}">${config.facilities[0].label}</option>`;
    facilitySelect.value = config.facilities[0].id;
    facilitySelect.closest("label")?.setAttribute("hidden", "");
  }

  setupPhoneField("bookPhone", "bookPhoneNote");

  const form = document.getElementById("pageAvailabilityForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      refreshSlotPicker(config);
    });
  }
  facilitySelect?.addEventListener("change", () => refreshSlotPicker(config));
  dateInput?.addEventListener("change", () => refreshSlotPicker(config));

  const bookingForm = document.getElementById("pageBookingForm");
  if (bookingForm) {
    bookingForm.addEventListener("submit", (e) => submitBooking(e, config));
  }

  document.getElementById("changeSlotLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    selectedSlot = null;
    backToSlotPicker();
  });
});

function isSupabaseReady(errorId) {
  if (!supabaseClient) {
    const msg = "Booking system isn't connected yet — please WhatsApp or call us directly for now.";
    if (errorId && document.getElementById(errorId)) {
      showFormError(errorId, msg);
    } else {
      alert(msg);
    }
    return false;
  }
  return true;
}

function isValidPhone(phone) {
  return /^[0-9]{10}$/.test(phone);
}

function setupPhoneField(inputId, noteId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const note = document.getElementById(noteId);
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 10);
    if (note) {
      note.hidden = true;
      note.textContent = "";
    }
  });
}

function showPhoneError(noteId, inputId) {
  const note = document.getElementById(noteId);
  if (note) {
    note.textContent = "Please enter a valid 10-digit mobile number.";
    note.hidden = false;
  }
  document.getElementById(inputId)?.focus();
}

// Generic inline form error — shows msg in red inside the form itself
// instead of a native alert() popup (honeypot/fill-time guard, name
// validation, and the final booking-submit error all route through this).
function showFormError(noteId, msg) {
  const note = document.getElementById(noteId);
  if (note) {
    note.textContent = msg;
    note.hidden = false;
    note.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function clearFormError(noteId) {
  const note = document.getElementById(noteId);
  if (note) {
    note.hidden = true;
    note.textContent = "";
  }
}

function statusBadgeStyle(status) {
  if (status === "Available") return "background:#D9EAD3;color:#2e6b2e;";
  if (status === "Blocked") return "background:#e0e0e0;color:#555;";
  if (status === "Pending") return "background:#FCE8B2;color:#8a6400;";
  if (status === "Reserved") return "background:#E8DDEF;color:#5A3A78;";
  if (status === "Past") return "background:#e0e0e0;color:#777777;";
  return "background:#F4CCCC;color:#9c2b2b;"; // Booked / Full
}

// Human-readable date for the "date + slot being booked" recap shown once
// a slot is picked, and again on the "Booking request sent" confirmation —
// e.g. "Wed, 10 Sep 2026". Parsed with an explicit local midnight so the
// weekday never shifts a day off from a bare "YYYY-MM-DD" being read as UTC.
function formatDateLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function isPastSlot(dateStr, startTime) {
  const todayStr = new Date().toISOString().split("T")[0];
  if (dateStr !== todayStr) return false;
  const [h, m] = startTime.split(":").map(Number);
  const now = new Date();
  return h * 60 + m <= now.getHours() * 60 + now.getMinutes();
}

// Same idea for the fixed Hall/Lawn slots (Morning/Evening/Full Day), but
// keyed off each slot's END time rather than its start — these are whole
// multi-hour windows, not hourly increments, so a slot only stops being
// bookable once it's fully over, not the moment it begins.
function isPastFixedSlot(dateStr, slotKey) {
  const todayStr = new Date().toISOString().split("T")[0];
  if (dateStr !== todayStr) return false;
  const endTime = FIXED_SLOT_END_TIMES[slotKey];
  if (!endTime) return false;
  const [h, m] = endTime.split(":").map(Number);
  const now = new Date();
  return h * 60 + m <= now.getHours() * 60 + now.getMinutes();
}

function slotBadgeHtml(status) {
  return `<span style="${statusBadgeStyle(status)}padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;">${status}</span>`;
}

function slotRowHtml(label, status, index) {
  const right = status === "Available"
    ? `<button type="button" class="btn btn-primary btn-sm" data-slot-index="${index}">Request to Book</button>`
    : slotBadgeHtml(status);
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee;">
      <span style="font-weight:700;">${label}</span>
      ${right}
    </div>`;
}

async function refreshSlotPicker(config) {
  if (!isSupabaseReady()) return;

  const facility = document.getElementById("pageFacility").value;
  const date = document.getElementById("pageDate").value;
  const resultBox = document.getElementById("pageSlotResult");
  if (!date || !resultBox) return;

  selectedSlot = null;
  backToSlotPicker();

  const todayStr = new Date().toISOString().split("T")[0];
  if (date < todayStr) {
    resultBox.className = "availability-result busy";
    resultBox.innerHTML = "Please choose today or a future date.";
    return;
  }

  resultBox.className = "availability-result";
  resultBox.innerHTML = "Checking...";

  const { data, error } = await supabaseClient.rpc("get_facility_slots", {
    p_facility_id: facility,
    p_date: date,
  });

  if (error || !data || data.error) {
    console.error(error || data?.error);
    resultBox.className = "availability-result busy";
    resultBox.innerHTML = "Couldn't check availability right now — please WhatsApp or call us.";
    return;
  }

  resultBox.className = "availability-result";

  if (data.type === "fixed") {
    const slotsList = FIXED_SLOT_KEYS.map((key) => {
      const slot = { key, ...data.slots[key] };
      return slot.status === "Available" && isPastFixedSlot(date, key)
        ? { ...slot, status: "Past" }
        : slot;
    });
    const rows = slotsList.map((slot, i) => slotRowHtml(slot.label, slot.status, i)).join("");
    resultBox.innerHTML = `<div>${rows}</div><p class="form-note" style="margin-top:10px;">Pick an open slot above to request a booking.</p>`;
    wireSlotButtons(resultBox, (index) => {
      const slot = slotsList[index];
      selectedSlot = { facility, date, type: "fixed", slotKey: slot.key, label: slot.label, humanLabel: slot.label };
      showBookingDetails(config, slot.label);
    });
    return;
  }

  if (data.type === "hourly") {
    const slots = data.slots.map((slot) =>
      slot.status === "Available" && isPastSlot(date, slot.start) ? { ...slot, status: "Past" } : slot
    );
    const rows = slots.map((slot, i) => {
      const label = `${slot.start} – ${slot.end}` + (data.bookingModel === "capacity" && slot.status === "Available" ? ` (${slot.remaining} of ${slot.capacity} spots left)` : "");
      return slotRowHtml(label, slot.status, i);
    }).join("");
    resultBox.innerHTML = `<div>${rows}</div><p class="form-note" style="margin-top:10px;">Pick an open hour above to start your booking.</p>`;
    wireSlotButtons(resultBox, (index) => {
      const slot = slots[index];
      const humanLabel = `${slot.start} – ${slot.end}`;
      selectedSlot = {
        facility, date, type: "hourly", start: slot.start,
        remaining: slot.remaining, capacity: slot.capacity, bookingModel: data.bookingModel, humanLabel,
      };
      showBookingDetails(config, humanLabel);
      updateDurationOptions(slots, slot.start);
    });
    return;
  }

  resultBox.innerHTML = "Couldn't check availability for this facility right now — please WhatsApp or call us.";
}

function wireSlotButtons(container, onClick) {
  container.querySelectorAll("[data-slot-index]").forEach((btn) => {
    btn.addEventListener("click", () => onClick(Number(btn.dataset.slotIndex)));
  });
}

// Reveals the inline mini booking form under the slot list, mirroring the
// old site's "Request to Book — <slot>" reveal instead of a separate section.
function showBookingDetails(config, slotLabel) {
  // Note: the availability form/slot list are left visible (not hidden) now
  // that they live in the left column and the booking form is in the right
  // column — the customer can see both the slot they picked and the full
  // list at once, and can pick a different slot without a "change slot"
  // round-trip. Only the right-column placeholder is swapped out.
  const wrap = document.getElementById("bookingDetailsWrap");
  const placeholder = document.getElementById("bookingPlaceholder");
  if (!wrap) return;
  if (placeholder) placeholder.hidden = true;
  wrap.hidden = false;
  document.getElementById("bookingConfirmation").hidden = true;
  clearFormError("bookFormError");
  // Date + time slot being booked, shown here and repeated verbatim on the
  // "Booking request sent" confirmation panel.
  document.getElementById("slotLabelText").textContent = `${formatDateLabel(selectedSlot.date)} · ${slotLabel}`;

  const durationWrap = document.getElementById("durationFieldWrap");
  const modeWrap = document.getElementById("modeGuestsWrap");
  if (durationWrap) durationWrap.hidden = selectedSlot.type !== "hourly";
  if (modeWrap) modeWrap.hidden = !(selectedSlot.type === "hourly" && config.showModeAndGuests);

  wrap.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Limits the Duration dropdown to only durations that stay fully inside
// consecutive Available hours from the picked start time — e.g. Badminton
// courts have reserved member hours outside 08:00-17:00, so a court opening
// at 15:00 can only take a 1- or 2-hour booking, not 3, even though 3 hours
// is offered as an option. This stops the customer from picking a duration
// that the server will reject with a members-reserved-hours error.
function updateDurationOptions(slots, startTime) {
  const select = document.getElementById("bookDuration");
  if (!select) return;

  const startIndex = slots.findIndex((s) => s.start === startTime);
  let maxDuration = 1;
  if (startIndex !== -1) {
    maxDuration = 0;
    for (let i = startIndex; i < slots.length; i++) {
      if (slots[i].status !== "Available") break;
      maxDuration++;
    }
    if (maxDuration < 1) maxDuration = 1;
  }

  let firstEnabledValue = null;
  Array.from(select.options).forEach((opt) => {
    const hours = Number(opt.value);
    const allowed = hours <= maxDuration;
    opt.disabled = !allowed;
    opt.hidden = !allowed;
    if (allowed && firstEnabledValue === null) firstEnabledValue = opt.value;
  });

  if (select.selectedOptions[0]?.disabled && firstEnabledValue !== null) {
    select.value = firstEnabledValue;
  }
}

function backToSlotPicker() {
  const wrap = document.getElementById("bookingDetailsWrap");
  const placeholder = document.getElementById("bookingPlaceholder");
  const resultBox = document.getElementById("pageSlotResult");
  const form = document.getElementById("pageAvailabilityForm");
  const confirmation = document.getElementById("bookingConfirmation");
  if (wrap) wrap.hidden = true;
  if (placeholder) placeholder.hidden = false;
  if (resultBox) resultBox.hidden = false;
  if (form) form.hidden = false;
  if (confirmation) confirmation.hidden = true;
  document.getElementById("pageBookingForm")?.reset();
  const durationSelect = document.getElementById("bookDuration");
  if (durationSelect) {
    Array.from(durationSelect.options).forEach((opt) => {
      opt.disabled = false;
      opt.hidden = false;
    });
  }
}

function facilityLabelFor(config, facilityId) {
  return config.facilities.find((f) => f.id === facilityId)?.label || facilityId;
}

function addHours(time, hours) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + hours * 60;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

async function submitBooking(e, config) {
  e.preventDefault();
  if (!selectedSlot) return;

  const form = e.target;
  clearFormError("bookFormError");
  const hp = document.getElementById("bookHp");
  if (hp && hp.value.trim() !== "") return;
  if (Date.now() - formRenderedAt < MIN_FILL_TIME_MS) {
    showFormError("bookFormError", "Please take a moment to fill in the form.");
    return;
  }

  const data = Object.fromEntries(new FormData(form).entries());
  if (!isValidPhone(data.phone)) {
    showPhoneError("bookPhoneNote", "bookPhone");
    return;
  }
  if (!data.customer_name || data.customer_name.trim().length < 2) {
    showFormError("bookFormError", "Please enter your name.");
    return;
  }
  // Pool is capacity-based (shared, per-guest) — catch an over-capacity
  // guest count before it ever reaches the server, so the customer gets a
  // clear reason instead of a generic booking-failure message.
  if (config.showModeAndGuests && selectedSlot.type === "hourly" && data.mode !== "exclusive") {
    const requestedGuests = Number(data.guests || 1);
    if (selectedSlot.remaining != null && requestedGuests > selectedSlot.remaining) {
      showFormError(
        "bookFormError",
        `Only ${selectedSlot.remaining} guest spot${selectedSlot.remaining === 1 ? "" : "s"} left for this hour — please reduce the number of guests or choose another slot.`
      );
      return;
    }
  }
  if (!isSupabaseReady("bookFormError")) return;

  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "Sending...";

  let result, error, code, confirmDetails;

  if (selectedSlot.type === "fixed") {
    ({ data: result, error } = await supabaseClient.rpc("submit_booking_request", {
      p_customer_name: data.customer_name.trim(),
      p_phone: data.phone.trim(),
      p_facility_id: selectedSlot.facility,
      p_booking_date: selectedSlot.date,
      p_slot: selectedSlot.slotKey,
      p_email: data.email?.trim() || null,
      p_guests: data.guests ? Number(data.guests) : null,
      p_notes: data.notes?.trim() || null,
    }));
    code = result?.[0]?.booking_code;
    confirmDetails = {
      facility: selectedSlot.facility, date: selectedSlot.date, slot: selectedSlot.slotKey,
      facilityLabel: facilityLabelFor(config, selectedSlot.facility),
      dateLabel: formatDateLabel(selectedSlot.date), humanLabel: selectedSlot.humanLabel,
    };
  } else {
    const duration = Number(document.getElementById("bookDuration")?.value || 1);
    const isPool = config.showModeAndGuests;
    const startTime = selectedSlot.start;
    const endTime = addHours(startTime, duration);
    const humanLabel = `${startTime} – ${endTime}`;

    ({ data: result, error } = await supabaseClient.rpc("submit_hourly_booking", {
      p_customer_name: data.customer_name.trim(),
      p_phone: data.phone.trim(),
      p_facility_id: selectedSlot.facility,
      p_booking_date: selectedSlot.date,
      p_start_time: startTime,
      p_end_time: endTime,
      p_guests: isPool ? Number(data.guests || 1) : 1,
      p_mode: isPool ? data.mode : null,
    }));
    code = result?.[0]?.booking_code;
    confirmDetails = {
      facility: selectedSlot.facility, date: selectedSlot.date, start_time: startTime, end_time: endTime,
      facilityLabel: facilityLabelFor(config, selectedSlot.facility),
      dateLabel: formatDateLabel(selectedSlot.date), humanLabel,
    };
  }

  submitBtn.disabled = false;
  submitBtn.textContent = "Send Booking Request";

  if (error) {
    console.error(error);
    let msg = "Something went wrong sending your request. Please try WhatsApp or call us instead.";
    if (error.message?.includes("Too many submissions")) {
      msg = "You've sent a few requests recently — please wait a bit, or WhatsApp us directly.";
    } else if (error.message?.includes("Capacity exceeded")) {
      // Distinct from the exclusive-conflict case below — this means the
      // requested guest count doesn't fit in what's left, not that the
      // whole slot is taken.
      msg = "That's more guests than the remaining space for this slot — please reduce the number of guests or choose another slot.";
    } else if (error.message?.includes("conflicts with")) {
      msg = "That slot is already booked exclusively by another group — please try a different time.";
    } else if (error.message?.includes("members-reserved hours") || error.message?.includes("hasn't been opened for public booking")) {
      msg = "Part of this time falls within members-reserved hours and isn't open for public booking yet — please choose a shorter duration or a different time.";
    }
    showFormError("bookFormError", msg);
    return;
  }

  showBookingConfirmation(code, confirmDetails);
}

function showBookingConfirmation(code, details) {
  const wrap = document.getElementById("bookingDetailsWrap");
  const panel = document.getElementById("bookingConfirmation");
  if (!panel) return;

  const waMessage = encodeURIComponent(
    `Hi PeedsPark! I just requested a booking (${code}).\n` +
    `Facility: ${details.facility}\n` +
    (details.date ? `Date: ${details.date}\n` : "") +
    (details.slot ? `Slot: ${details.slot}\n` : "") +
    (details.start_time ? `Time: ${details.start_time}–${details.end_time}\n` : "")
  );
  const waLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${waMessage}`;

  panel.innerHTML = `
    <div style="text-align:center;">
      <div style="font-size:40px;margin-bottom:10px;">✅</div>
      <h3 style="margin:0 0 8px;">Booking request sent!</h3>
      <p class="confirm-details">${details.facilityLabel}</p>
      <p class="confirm-details" style="margin-bottom:14px;"><strong>${details.dateLabel} · ${details.humanLabel}</strong></p>
      <p class="muted" style="margin:0 0 6px;">Reference</p>
      <p style="font-size:1.2rem;font-weight:700;margin:0 0 16px;">${code}</p>
      <p style="font-weight:700;margin:0 0 16px;">Your request is sent for confirmation.</p>
      <a class="btn btn-primary" href="${waLink}" target="_blank" rel="noopener">💬 Send WhatsApp Message</a>
      <br><a href="#" data-send-another style="display:inline-block;margin-top:14px;font-weight:600;">Check another date</a>
    </div>`;
  panel.hidden = false;
  if (wrap) wrap.hidden = true;

  panel.querySelector("[data-send-another]")?.addEventListener("click", (e) => {
    e.preventDefault();
    panel.hidden = true;
    selectedSlot = null;
    backToSlotPicker();
  });
}
