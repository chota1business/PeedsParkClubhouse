// PeedsPark — homepage (index.html) behaviour: Quick Enquiry form only.
// Nav toggle/active-tab logic lives in js/nav.js (shared across all pages).
// The check-availability-and-book flow lives in js/facility-page.js, used
// by the dedicated facility pages (pool.html, badminton.html, ac-hall.html,
// non-ac-hall.html, lawn.html) — this page has no live-availability picker.

const WHATSAPP_NUMBER = "919846718106"; // owner's WhatsApp, country code + number, no plus/spaces

document.addEventListener("DOMContentLoaded", () => {
  const today = new Date().toISOString().split("T")[0];
  const enquiryDate = document.getElementById("enquiryDate");
  if (enquiryDate) enquiryDate.min = today;

  // Phase 10: live digit-only filtering + hard 10-char cap on the phone
  // field, ported from the old Apps Script site's fix — stops the native
  // "please match the requested format" browser popup from ever triggering,
  // since the field can never hold anything but digits by the time it's
  // submitted.
  setupPhoneField("enquiryPhone", "enquiryPhoneNote");

  setupEnquiryForm();
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

// Phase 10: strips anything non-numeric as the customer types or pastes,
// and caps at 10 digits — same behaviour as the old site, so a pasted
// "98467-18106" quietly becomes "9846718106" instead of failing validation.
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

// Shows the "valid 10-digit mobile number" error inline under the given
// field instead of a native alert() popup — ported from the old site's fix.
function showPhoneError(noteId, inputId) {
  const note = document.getElementById(noteId);
  if (note) {
    note.textContent = "Please enter a valid 10-digit mobile number.";
    note.hidden = false;
  }
  document.getElementById(inputId)?.focus();
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
      showPhoneError("enquiryPhoneNote", "enquiryPhone");
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

// Phase 10: confirmation-first flow, ported from the old Apps Script site's
// fix — a successful submission no longer auto-opens a WhatsApp tab (that
// read as broken on several phones/browsers: a blank popup, or blocked
// entirely). Instead the form is swapped out for an on-page confirmation
// with its own "Send WhatsApp Message" button the customer taps themselves.
function showEnquiryConfirmation(row, payload) {
  const form = document.getElementById("enquiryForm");
  const panel = document.getElementById("enquiryConfirmation");
  const waMessage = encodeURIComponent(
    `Hi PeedsPark! I just sent an enquiry (${row.enquiry_code}).\n` +
    `Name: ${payload.customer_name}\n` +
    (payload.facility_id ? `Facility: ${payload.facility_id}\n` : "") +
    (payload.preferred_date ? `Preferred date: ${payload.preferred_date}\n` : "") +
    (payload.message ? `Message: ${payload.message}` : "")
  );
  const waLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${waMessage}`;

  panel.innerHTML = confirmationPanelHtml({
    heading: "Enquiry received!",
    reference: row.enquiry_code,
    message: `Your enquiry for ${payload.facility_id || "PeedsPark"} is sent for confirmation.`,
    waLink,
    anotherText: "Send another enquiry",
  });
  panel.hidden = false;
  form.hidden = true;

  wireSendAnotherLink(panel, form);
}

// Shared markup for the enquiry confirmation panel — mirrors the old site's
// confirmation card (icon, reference, message, a WhatsApp button the
// customer taps themselves, and a link back to the form).
function confirmationPanelHtml({ heading, reference, message, waLink, anotherText }) {
  return `
    <div style="text-align:center;">
      <div style="font-size:40px;margin-bottom:10px;">✅</div>
      <h3 style="margin:0 0 8px;">${heading}</h3>
      <p class="muted" style="margin:0 0 6px;">Reference</p>
      <p style="font-size:1.2rem;font-weight:700;margin:0 0 16px;">${reference}</p>
      <p style="font-weight:700;margin:0 0 16px;">${message}</p>
      <a class="btn btn-primary" href="${waLink}" target="_blank" rel="noopener">💬 Send WhatsApp Message</a>
      <br><a href="#" data-send-another style="display:inline-block;margin-top:14px;font-weight:600;">${anotherText}</a>
    </div>`;
}

// Swaps the confirmation panel back out for the form, so the customer can
// submit a second enquiry without reloading the page.
function wireSendAnotherLink(panel, form) {
  const link = panel.querySelector("[data-send-another]");
  if (!link) return;
  link.addEventListener("click", (e) => {
    e.preventDefault();
    panel.hidden = true;
    if (form) form.hidden = false;
  });
}
