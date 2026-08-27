// PeedsPark — customer-facing site behaviour
// Enquiry + availability check, wired to Supabase (public, insert-only per RLS).

const WHATSAPP_NUMBER = "919846718106"; // owner's WhatsApp, country code + number, no plus/spaces

document.addEventListener("DOMContentLoaded", () => {
  const today = new Date().toISOString().split("T")[0];
  const availDate = document.getElementById("availDate");
  const enquiryDate = document.getElementById("enquiryDate");
  if (availDate) availDate.min = today;
  if (enquiryDate) enquiryDate.min = today;

  // Mobile nav toggle
  const navToggle = document.getElementById("navToggle");
  const mainNav = document.getElementById("mainNav");
  if (navToggle && mainNav) {
    navToggle.addEventListener("click", () => mainNav.classList.toggle("open"));
  }

  setupEnquiryForm();
  setupAvailabilityForm();
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

function setupAvailabilityForm() {
  const form = document.getElementById("availabilityForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isSupabaseReady()) return;

    const facility = document.getElementById("availFacility").value;
    const date = document.getElementById("availDate").value;
    const resultBox = document.getElementById("availabilityResult");

    resultBox.className = "availability-result";
    resultBox.textContent = "Checking...";

    const { data, error } = await supabaseClient
      .from("public_availability")
      .select("*")
      .eq("facility_id", facility)
      .eq("date", date);

    if (error) {
      console.error(error);
      resultBox.className = "availability-result busy";
      resultBox.textContent = "Couldn't check availability right now — please WhatsApp or call us.";
      return;
    }

    if (!data || data.length === 0) {
      resultBox.className = "availability-result ok";
      resultBox.textContent = "✅ Looks open! Send us a Quick Enquiry below to lock in your date.";
      return;
    }

    const summary = data.map(row => {
      if (row.label) return `${row.label} slot: ${row.status}`;
      if (row.start_time) return `${row.start_time}–${row.end_time}: ${row.status}`;
      return row.status;
    }).join(", ");

    resultBox.className = "availability-result busy";
    resultBox.textContent = `⚠️ Some slots are already taken on this date (${summary}). Send an enquiry and we'll confirm what's still open.`;
  });
}
