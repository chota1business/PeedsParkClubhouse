// PeedsPark — owner alert email (Phase 5)
//
// Called by a Postgres trigger (see 011_notify_owner_setup.sql) every time a
// customer submits an enquiry, a Hall/Lawn booking, or a Pool/Badminton
// booking. Sends one alert email to the owner via Resend so they don't have
// to keep checking the admin dashboard.
//
// This function is deployed with verify_jwt=false because its only caller is
// the database trigger, not a browser — there is no user session to check a
// JWT against. Instead it checks a shared secret header (x-webhook-secret)
// against WEBHOOK_SECRET, which must match the value stored in Supabase
// Vault by 011_notify_owner_setup.sql. Anyone without that secret gets 401.
//
// Required Edge Function secrets (set in Supabase Dashboard → Edge Functions
// → notify-owner → Secrets — cannot be set via migration/API):
//   RESEND_API_KEY   — from resend.com dashboard → API Keys
//   OWNER_EMAIL       — where alerts should land, e.g. tincye29@gmail.com
//   WEBHOOK_SECRET    — MUST exactly match the value generated in
//                       011_notify_owner_setup.sql (ask Claude/check Vault
//                       if you need to see it again, or re-run the migration
//                       clause manually to fetch it from vault.decrypted_secrets)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL");
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");

const FACILITY_LABELS: Record<string, string> = {
  ac_hall: "AC Hall",
  non_ac_hall: "Non-AC Hall",
  lawn: "Lawn",
  pool: "Swimming Pool",
  badminton_1: "Badminton Court 1",
  badminton_2: "Badminton Court 2",
};

function subjectAndBody(type: string, record: Record<string, unknown>): { subject: string; html: string } {
  const name = String(record.customer_name ?? "Unknown");
  const phone = String(record.phone ?? "");
  const waLink = `https://wa.me/${phone.replace(/\D/g, "")}`;

  if (type === "enquiry") {
    const code = String(record.enquiry_code ?? "");
    return {
      subject: `New enquiry ${code} — ${name}`,
      html: `
        <h2>New enquiry: ${code}</h2>
        <p><b>${name}</b> · ${phone} · <a href="${waLink}">WhatsApp</a></p>
        ${record.facility_id ? `<p>Facility: ${FACILITY_LABELS[String(record.facility_id)] ?? record.facility_id}</p>` : ""}
        ${record.preferred_date ? `<p>Preferred date: ${record.preferred_date}</p>` : ""}
        ${record.message ? `<p>Message: ${record.message}</p>` : ""}
        <p style="color:#8A8A8A;">Source: ${record.source ?? "unknown"}</p>
      `,
    };
  }

  if (type === "booking_request") {
    const code = String(record.booking_code ?? "");
    const facility = FACILITY_LABELS[String(record.facility_id)] ?? String(record.facility_id ?? "");
    return {
      subject: `New ${facility} booking request ${code} — ${name}`,
      html: `
        <h2>New booking request: ${code}</h2>
        <p><b>${name}</b> · ${phone} · <a href="${waLink}">WhatsApp</a></p>
        <p>${facility} · ${record.booking_date} · ${record.slot}${record.guests ? ` · ${record.guests} guests` : ""}</p>
        ${record.notes ? `<p>Notes: ${record.notes}</p>` : ""}
        <p style="color:#8A8A8A;">Open the admin dashboard to approve or reject.</p>
      `,
    };
  }

  if (type === "hourly_booking") {
    const code = String(record.booking_code ?? "");
    const facility = FACILITY_LABELS[String(record.facility_id)] ?? String(record.facility_id ?? "");
    return {
      subject: `New ${facility} booking request ${code} — ${name}`,
      html: `
        <h2>New booking request: ${code}</h2>
        <p><b>${name}</b> · ${phone} · <a href="${waLink}">WhatsApp</a></p>
        <p>${facility} · ${record.booking_date} · ${record.start_time}–${record.end_time}${record.guests ? ` · ${record.guests} guests` : ""}</p>
        <p style="color:#8A8A8A;">Open the admin dashboard to approve or reject.</p>
      `,
    };
  }

  if (type === "digest_enquiries") {
    const items = (record.items as Record<string, unknown>[]) ?? [];
    const rows = items.map((it) => {
      const facility = it.facility_id ? (FACILITY_LABELS[String(it.facility_id)] ?? String(it.facility_id)) : "";
      return `<tr>
        <td style="padding:6px;border-bottom:1px solid #eee;">${it.enquiry_code}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;">${it.customer_name}<br><span style="color:#8A8A8A;font-size:12px;">${it.phone}</span></td>
        <td style="padding:6px;border-bottom:1px solid #eee;">${facility}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;">${it.status}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;">${it.hours_open}h</td>
      </tr>`;
    }).join("");
    return {
      subject: `${items.length} enquir${items.length === 1 ? "y needs" : "ies need"} follow-up — PeedsPark`,
      html: `
        <h2>Enquiries waiting 12+ hours</h2>
        <p>These haven't moved to Converted or Lost yet:</p>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="text-align:left;"><th>Code</th><th>Customer</th><th>Facility</th><th>Status</th><th>Waiting</th></tr>
          ${rows}
        </table>
        <p style="color:#8A8A8A;">Open the admin dashboard to update their status.</p>
      `,
    };
  }

  if (type === "digest_bookings") {
    const pending = (record.pending as Record<string, unknown>[]) ?? [];
    const unpaid = (record.unpaid as Record<string, unknown>[]) ?? [];
    const pendingRows = pending.map((it) => {
      const facility = FACILITY_LABELS[String(it.facility_id)] ?? String(it.facility_id);
      return `<tr>
        <td style="padding:6px;border-bottom:1px solid #eee;">${it.booking_code}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;">${it.customer_name}<br><span style="color:#8A8A8A;font-size:12px;">${it.phone}</span></td>
        <td style="padding:6px;border-bottom:1px solid #eee;">${facility} · ${it.booking_date} · ${it.slot}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;">${it.hours_pending}h</td>
      </tr>`;
    }).join("");
    const unpaidRows = unpaid.map((it) => {
      const facility = FACILITY_LABELS[String(it.facility_id)] ?? String(it.facility_id);
      return `<tr>
        <td style="padding:6px;border-bottom:1px solid #eee;">${it.booking_code}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;">${it.customer_name}<br><span style="color:#8A8A8A;font-size:12px;">${it.phone}</span></td>
        <td style="padding:6px;border-bottom:1px solid #eee;">${facility} · ${it.booking_date} · ${it.slot}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;">${it.payment_status}</td>
      </tr>`;
    }).join("");
    return {
      subject: `${pending.length} pending / ${unpaid.length} unpaid booking(s) — PeedsPark`,
      html: `
        ${pending.length ? `<h2>Booking requests still pending (24h+)</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="text-align:left;"><th>Code</th><th>Customer</th><th>Booking</th><th>Waiting</th></tr>
          ${pendingRows}
        </table>` : ""}
        ${unpaid.length ? `<h2 style="margin-top:${pending.length ? "20px" : "0"};">Confirmed bookings not fully paid</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="text-align:left;"><th>Code</th><th>Customer</th><th>Booking</th><th>Payment</th></tr>
          ${unpaidRows}
        </table>` : ""}
        <p style="color:#8A8A8A;">Open the admin dashboard to approve, reject, or record payment.</p>
      `,
    };
  }

  // Fallback — shouldn't be reached, but never leave a blank email.
  return { subject: `PeedsPark notification (${type})`, html: `<p>Unrecognised notification type: ${type}</p>` };
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!RESEND_API_KEY || !OWNER_EMAIL) {
    console.error("notify-owner: missing RESEND_API_KEY or OWNER_EMAIL secret");
    // Return 200 anyway — this must never make the customer's submission
    // appear to fail. The gap just means no alert email went out; check the
    // Supabase function logs.
    return new Response(JSON.stringify({ skipped: "missing config" }), { status: 200 });
  }

  try {
    const { type, record } = await req.json();
    const { subject, html } = subjectAndBody(type, record ?? {});

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "PeedsPark Alerts <onboarding@resend.dev>",
        to: [OWNER_EMAIL],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend error:", res.status, errText);
      return new Response(JSON.stringify({ sent: false, error: errText }), { status: 200 });
    }

    return new Response(JSON.stringify({ sent: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("notify-owner error:", err);
    // Still 200: a malformed payload or Resend outage should never surface
    // as a failure to the customer submitting the form.
    return new Response(JSON.stringify({ sent: false, error: String(err) }), { status: 200 });
  }
});
