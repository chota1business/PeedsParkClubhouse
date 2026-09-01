// PeedsPark — customer-facing site behaviour
// Enquiry + availability check, wired to Supabase (public, insert-only per RLS).

const WHATSAPP_NUMBER = "919846718106"; // owner's WhatsApp, country code + number, no plus/spaces

document.addEventListener("DOMContentLoaded", () => {
  const today = new Date().toISOString().split("T")[0];
  ["availDate", "enquiryDate", "hallBookingDate", "hourlyBookingDate"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.min = today;
  });

  // Mobile nav toggle
  const navToggle = document.getElementById("navToggle");
  const mainNav = document.getElementById("mainNav");
  if (navToggle && mainNav) {
    navToggle.addEventListener("click", () => mainNav.classList.toggle("open"));
  }

  setupHourlyFacilityToggle();
  setupHallBookingForm();
  setupHourlyBookingForm();
  setupEnquiryForm();
  setupAvailabilityForm();

  // Phase 9: re-check the picked hourly slot client-side whenever these
  // change, so a conflict shows up before the customer submits, not after.
  ["hourlyDuration", "hourlyMode", "hourlyStartTime", "hourlyGuests", "hourlyBookingDate"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", revalidateHourlyDuration);
  });
});

// Minimum-fill-time spam check: record when the form first became visible,
// and refuse to submit if it's answered implausibly fast (bots do this; a
// real person filling in name/phone/message takes at least a few seconds).
const formRenderedAt = Date.now();
const MIN_FILL_TIME_MS = 3000;

function isSupabaseReady() {
  if (!supabaseClient) {
    alert("Booking system isn't connected yet — please WhatsApp or call us directly for now.");
    return false;
  }
  return true;
}

function isValidPhone(phone) {
  return /^[0-9]{10}$/.test(phone);
}

function setupEnquiryForm() {
  const form = document.getElementById("enquiryForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Honeypot: real visitors never fill this hidden field in.
    const hp = document.getElementById("hpField");
    if (hp && hp.value.trim() !== "") {
      return; // silently drop — looks successful to a bot, does nothing
    }

    if (Date.now() - formRenderedAt < MIN_FILL_TIME_MS) {
      alert("Please take a moment to fill in the form.");
      return;
    }

    const data = Object.fromEntries(new FormData(form).entries());

    if (!isValidPhone(data.phone)) {
      alert("Please enter a valid 10-digit mobile number.");
      return;
    }
    if (!data.customer_name || data.customer_name.trim().length < 2) {
      alert("Please enter your name.");
      return;
    }

    if (!isSupabaseReady()) return;

    const source = detectSource();
    const payload = {
      customer_name: data.customer_name.trim(),
      phone: data.phone.trim(),
      email: data.email?.trim() || null,
      facility_id: data.facility_id || null,
      preferred_date: data.preferred_date || null,
      guests: data.guests ? Number(data.guests) : null,
      message: data.message?.trim() || null,
      source,
    };

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";

    // Goes through the submit_enquiry() database function rather than a plain
    // insert — anonymous visitors correctly have no read access to the
    // enquiries table (that's what keeps other customers' details private),
    // and Postgres requires a row to be select-visible to come back from
    // `.insert().select()`. The function runs as its owner, inserts safely,
    // and returns only the generated enquiry code — nothing else.
    const { data: result, error } = await supabaseClient.rpc("submit_enquiry", {
      p_customer_name: payload.customer_name,
      p_phone: payload.phone,
      p_email: payload.email,
      p_facility_id: payload.facility_id,
      p_preferred_date: payload.preferred_date,
      p_guests: payload.guests,
      p_message: payload.message,
      p_source: payload.source,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = "Send Enquiry";

    if (error) {
      console.error(error);
      alert(
        error.message?.includes("Too many submissions")
          ? "You've sent a few enquiries recently — please wait a bit before trying again, or WhatsApp us directly."
          : "Something went wrong sending your enquiry. Please try WhatsApp or call us instead."
      );
      return;
    }

    const enquiryCode = result?.[0]?.enquiry_code;
    showEnquiryConfirmation({ enquiry_code: enquiryCode }, payload);
    form.reset();
  });
}

function detectSource() {
  const ref = document.referrer.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const utm = (params.get("utm_source") || "").toLowerCase();

  if (utm.includes("google") || ref.includes("google.")) return "google";
  if (utm.includes("facebook") || ref.includes("facebook.")) return "facebook";
  if (utm.includes("instagram") || ref.includes("instagram.")) return "instagram";
  if (utm.includes("whatsapp") || ref.includes("wa.me") || ref.includes("whatsapp.")) return "whatsapp";
  if (!ref) return "direct";
  return "other";
}

function showEnquiryConfirmation(row, payload) {
  const panel = document.getElementById("enquiryConfirmation");
  const waMessage = encodeURIComponent(
    `Hi PeedsPark! I just sent an enquiry (${row.enquiry_code}).\n` +
    `Name: ${payload.customer_name}\n` +
    (payload.facility_id ? `Facility: ${payload.facility_id}\n` : "") +
    (payload.preferred_date ? `Preferred date: ${payload.preferred_date}\n` : "") +
    (payload.message ? `Message: ${payload.message}` : "")
  );
  const waLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${waMessage}`;

  panel.hidden = false;
  panel.innerHTML = `
    ✅ Enquiry sent (${row.enquiry_code}). We'll get back to you shortly.<br>
    <a class="btn btn-primary" style="margin-top:10px;" href="${waLink}" target="_blank" rel="noopener">
      💬 Confirm on WhatsApp
    </a>`;

  // Open WhatsApp automatically too, same as the original flow — the button
  // above is the fallback for browsers/devices that block the auto-open.
  window.open(waLink, "_blank");
}

// Facility type isn't in the <select> — the RPC itself returns "type"
// (fixed vs hourly) so the renderer branches on the response, not a
// hardcoded map here (one less place to keep in sync with `facilities`).
const FIXED_SLOT_KEYS = ["morning", "evening", "full_day"];

// Remembers the last hourly-slot check so the duration/mode selects on the
// Pool/Badminton booking form can be revalidated client-side without a
// fresh round trip every keystroke. Cleared whenever the checked
// facility/date changes.
let lastHourlyCheck = null; // { facility, date, bookingModel, slots }

function statusBadgeStyle(status) {
  if (status === "Available") return "background:#D9EAD3;color:#2e6b2e;";
  if (status === "Blocked") return "background:#e0e0e0;color:#555;";
  if (status === "Pending") return "background:#FCE8B2;color:#8a6400;";
  // Reserved = members-only hours (badminton) nobody's opened for public
  // booking yet — distinct from Booked/Full so it doesn't read as "someone
  // beat you to it" when actually nobody can book it right now.
  if (status === "Reserved") return "background:#E8DDEF;color:#5A3A78;"; // --plum tint
  return "background:#F4CCCC;color:#9c2b2b;"; // Booked / Full
}

function slotBadgeHtml(status) {
  return `<span style="${statusBadgeStyle(status)}padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;">${status}</span>`;
}

function slotRowHtml(label, status, onBookAttr) {
  const right = status === "Available"
    ? `<button type="button" class="btn btn-primary btn-sm" ${onBookAttr}>Request to Book</button>`
    : slotBadgeHtml(status);
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee;">
      <span style="font-weight:700;">${label}</span>
      ${right}
    </div>`;
}

function setupAvailabilityForm() {
  const form = document.getElementById("availabilityForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await refreshAvailabilityPicker();
  });

  // Auto-refresh when either field changes, same as the booking forms below —
  // avoids someone clicking "Check Availability" once, changing the date,
  // and still seeing the previous date's (now stale) slot list.
  document.getElementById("availFacility").addEventListener("change", refreshAvailabilityPicker);
  document.getElementById("availDate").addEventListener("change", refreshAvailabilityPicker);
}

async function refreshAvailabilityPicker() {
  if (!isSupabaseReady()) return;

  const facility = document.getElementById("availFacility").value;
  const date = document.getElementById("availDate").value;
  const resultBox = document.getElementById("availabilityResult");

  if (!date) return;

  lastHourlyCheck = null;
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
    const rows = FIXED_SLOT_KEYS.map((key) => {
      const slot = data.slots[key];
      const attr = `data-fixed-facility="${facility}" data-fixed-date="${date}" data-fixed-slot="${key}"`;
      return slotRowHtml(slot.label, slot.status, attr);
    }).join("");
    resultBox.innerHTML = `<div>${rows}</div><p class="form-note" style="margin-top:10px;">Pick an open slot above, or send a Quick Enquiry below if you're not sure yet.</p>`;
    wireFixedSlotButtons(resultBox);
    return;
  }

  if (data.type === "hourly") {
    lastHourlyCheck = { facility, date, bookingModel: data.bookingModel, slots: data.slots };
    const rows = data.slots.map((slot, index) => {
      const label = `${slot.start} – ${slot.end}` + (data.bookingModel === "capacity" && slot.status === "Available" ? ` (${slot.remaining} of ${slot.capacity} spots left)` : "");
      const attr = `data-hourly-facility="${facility}" data-hourly-date="${date}" data-hourly-index="${index}" data-hourly-start="${slot.start}"`;
      return slotRowHtml(label, slot.status, attr);
    }).join("");
    resultBox.innerHTML = `<div>${rows}</div><p class="form-note" style="margin-top:10px;">Pick an open hour above to start your booking.</p>`;
    wireHourlySlotButtons(resultBox);
    return;
  }

  resultBox.innerHTML = "Couldn't check availability for this facility right now — please WhatsApp or call us.";
}

function wireFixedSlotButtons(container) {
  container.querySelectorAll("[data-fixed-slot]").forEach((btn) => {
    btn.addEventListener("click", () => {
      prefillHallBookingForm(
        btn.dataset.fixedFacility,
        btn.dataset.fixedDate,
        btn.dataset.fixedSlot
      );
    });
  });
}

function wireHourlySlotButtons(container) {
  container.querySelectorAll("[data-hourly-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      prefillHourlyBookingForm(
        btn.dataset.hourlyFacility,
        btn.dataset.hourlyDate,
        btn.dataset.hourlyStart
      );
    });
  });
}

function prefillHallBookingForm(facility, date, slotKey) {
  const form = document.getElementById("hallBookingForm");
  if (!form) return;
  form.elements["facility_id"].value = facility;
  document.getElementById("hallBookingDate").value = date;
  form.elements["slot"].value = slotKey;
  document.getElementById("book-hall-lawn").scrollIntoView({ behavior: "smooth", block: "start" });
  form.querySelector("[name=customer_name]")?.focus();
}

function prefillHourlyBookingForm(facility, date, startTime) {
  const form = document.getElementById("hourlyBookingForm");
  if (!form) return;
  document.getElementById("hourlyFacility").value = facility;
  setupHourlyFacilityToggle(); // re-run the pool-fields show/hide for the new facility
  document.getElementById("hourlyBookingDate").value = date;
  document.getElementById("hourlyStartTime").value = startTime;
  document.getElementById("hourlyDuration").value = "1";
  revalidateHourlyDuration();
  document.getElementById("book-hourly").scrollIntoView({ behavior: "smooth", block: "start" });
  form.querySelector("[name=customer_name]")?.focus();
}

// Client-side re-check of the currently-selected duration/mode against the
// slots fetched by the last availability check — catches an obvious
// conflict (e.g. picking 3 hours starting from a slot that's only free for
// 1 more hour) before the customer submits, rather than only finding out
// after. This is a courtesy check, not the source of truth — the DB's
// check_hourly_capacity trigger is what actually enforces this either way,
// so a stale/skipped check here can never let a real conflict through.
function revalidateHourlyDuration() {
  const noteEl = document.getElementById("hourlyDurationNote");
  if (!noteEl) return;

  const facility = document.getElementById("hourlyFacility").value;
  const date = document.getElementById("hourlyBookingDate").value;
  const startTime = document.getElementById("hourlyStartTime").value;
  const duration = parseInt(document.getElementById("hourlyDuration").value, 10) || 1;
  const submitBtn = document.querySelector("#hourlyBookingForm button[type=submit]");

  if (!lastHourlyCheck || lastHourlyCheck.facility !== facility || lastHourlyCheck.date !== date) {
    noteEl.textContent = ""; // no fresh check to validate against — let the DB be the judge
    if (submitBtn) submitBtn.disabled = false;
    return;
  }

  const startIndex = lastHourlyCheck.slots.findIndex((s) => s.start === startTime);
  if (startIndex === -1) {
    noteEl.textContent = "";
    if (submitBtn) submitBtn.disabled = false;
    return;
  }

  const isPool = lastHourlyCheck.bookingModel === "capacity";
  const mode = isPool ? document.getElementById("hourlyMode").value : null;
  const guestCount = parseInt(document.getElementById("hourlyGuests").value, 10) || 0;

  let ok = true;
  let message = "✓ Available for the full duration.";
  for (let i = startIndex; i < startIndex + duration; i++) {
    const s = lastHourlyCheck.slots[i];
    if (!s) { ok = false; message = "That's past closing time for this many hours."; break; }
    if (s.status === "Blocked") { ok = false; message = `${s.start}–${s.end} is blocked by management.`; break; }
    if (isPool) {
      if (mode === "exclusive" && s.remaining !== s.capacity) { ok = false; message = `${s.start}–${s.end} already has a shared booking — can't book Exclusive.`; break; }
      if (s.status === "Full") { ok = false; message = `${s.start}–${s.end} is already full.`; break; }
      if (mode !== "exclusive" && guestCount && guestCount > s.remaining) { ok = false; message = `Only ${s.remaining} spot(s) left at ${s.start}–${s.end} — reduce your guest count.`; break; }
    } else if (s.status === "Reserved") {
      ok = false; message = `${s.start}–${s.end} is reserved for members and hasn't been opened for booking. Contact the club.`; break;
    } else if (s.status !== "Available") {
      ok = false; message = `${s.start}–${s.end} is already booked.`; break;
    }
  }

  noteEl.textContent = message;
  noteEl.style.color = ok ? "#2e6b2e" : "#9c2b2b";
  if (submitBtn) submitBtn.disabled = !ok;
}

function setupHourlyFacilityToggle() {
  const facilitySelect = document.getElementById("hourlyFacility");
  const poolFields = document.getElementById("poolOnlyFields");
  if (!facilitySelect || !poolFields) return;

  const toggle = () => {
    poolFields.style.display = facilitySelect.value === "pool" ? "grid" : "none";
  };
  facilitySelect.addEventListener("change", toggle);
  toggle();
}

function setupHallBookingForm() {
  const form = document.getElementById("hallBookingForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const hp = document.getElementById("hpFieldHall");
    if (hp && hp.value.trim() !== "") return;
    if (Date.now() - formRenderedAt < MIN_FILL_TIME_MS) {
      alert("Please take a moment to fill in the form.");
      return;
    }

    const data = Object.fromEntries(new FormData(form).entries());
    if (!isValidPhone(data.phone)) {
      alert("Please enter a valid 10-digit mobile number.");
      return;
    }
    if (!isSupabaseReady()) return;

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";

    const { data: result, error } = await supabaseClient.rpc("submit_booking_request", {
      p_customer_name: data.customer_name.trim(),
      p_phone: data.phone.trim(),
      p_facility_id: data.facility_id,
      p_booking_date: data.booking_date,
      p_slot: data.slot,
      p_email: data.email?.trim() || null,
      p_guests: data.guests ? Number(data.guests) : null,
      p_notes: data.notes?.trim() || null,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = "Request Booking";

    if (error) {
      console.error(error);
      alert(
        error.message?.includes("Too many submissions")
          ? "You've sent a few requests recently — please wait a bit, or WhatsApp us directly."
          : "Something went wrong sending your request. Please try WhatsApp or call us instead."
      );
      return;
    }

    const code = result?.[0]?.booking_code;
    showBookingConfirmation("hallBookingConfirmation", code, data);
    form.reset();
  });
}

function setupHourlyBookingForm() {
  const form = document.getElementById("hourlyBookingForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const hp = document.getElementById("hpFieldHourly");
    if (hp && hp.value.trim() !== "") return;
    if (Date.now() - formRenderedAt < MIN_FILL_TIME_MS) {
      alert("Please take a moment to fill in the form.");
      return;
    }

    const data = Object.fromEntries(new FormData(form).entries());
    if (!isValidPhone(data.phone)) {
      alert("Please enter a valid 10-digit mobile number.");
      return;
    }
    if (!isSupabaseReady()) return;

    const isPool = data.facility_id === "pool";
    const startTime = data.start_time;
    const endTime = addHours(startTime, Number(data.duration));

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";

    const { data: result, error } = await supabaseClient.rpc("submit_hourly_booking", {
      p_customer_name: data.customer_name.trim(),
      p_phone: data.phone.trim(),
      p_facility_id: data.facility_id,
      p_booking_date: data.booking_date,
      p_start_time: startTime,
      p_end_time: endTime,
      p_guests: isPool ? Number(data.guests || 1) : 1,
      p_mode: isPool ? data.mode : null,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = "Request Booking";

    if (error) {
      console.error(error);
      let msg = "Something went wrong sending your request. Please try WhatsApp or call us instead.";
      if (error.message?.includes("Too many submissions")) {
        msg = "You've sent a few requests recently — please wait a bit, or WhatsApp us directly.";
      } else if (error.message?.includes("Capacity exceeded") || error.message?.includes("conflicts with")) {
        msg = "That slot is already full or booked exclusively — please try a different time.";
      }
      alert(msg);
      return;
    }

    const code = result?.[0]?.booking_code;
    showBookingConfirmation("hourlyBookingConfirmation", code, { ...data, start_time: startTime, end_time: endTime });
    form.reset();
  });
}

function addHours(time, hours) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + hours * 60;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function showBookingConfirmation(panelId, code, data) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  const waMessage = encodeURIComponent(
    `Hi PeedsPark! I just requested a booking (${code}).\n` +
    `Name: ${data.customer_name}\n` +
    `Facility: ${data.facility_id}\n` +
    (data.booking_date ? `Date: ${data.booking_date}\n` : "") +
    (data.slot ? `Slot: ${data.slot}\n` : "") +
    (data.start_time ? `Time: ${data.start_time}–${data.end_time}\n` : "")
  );
  const waLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${waMessage}`;

  panel.hidden = false;
  panel.innerHTML = `
    ✅ Booking requested (${code}). We'll confirm shortly.<br>
    <a class="btn btn-primary" style="margin-top:10px;" href="${waLink}" target="_blank" rel="noopener">
      💬 Confirm on WhatsApp
    </a>`;
  window.open(waLink, "_blank");
}
