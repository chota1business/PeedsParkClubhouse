// PeedsPark — Admin Google Calendar subscribe feed (Phase 13)
//
// Emits a read-only iCalendar (RFC 5545) feed of APPROVED Club House
// bookings (AC Hall / Non-AC Hall / Lawn only — Pool and Badminton are out
// of scope by design, see 020_admin_calendar_feed.sql). An Admin subscribes
// to this URL in Google Calendar via "Other calendars → From URL". Google
// re-fetches it periodically on ITS OWN schedule (usually every few hours,
// sometimes up to ~24h) — there is no way to force a faster refresh from
// our side, and this is a strict limitation of the "subscribe by URL"
// approach the owner chose over live two-way sync.
//
// Auth model: Google's calendar-subscribe fetcher cannot send a login
// session or JWT, so this function is deployed with verify_jwt=false and
// does its own token check instead (?token=... in the query string, checked
// against calendar_feed_tokens via the get_admin_calendar_feed() RPC, which
// is SECURITY DEFINER and independent of auth.uid()). A missing, invalid,
// or revoked token gets an identical 404 (not 401) — see the RPC's own
// comment for why: a probing request must not be able to tell "wrong
// token" apart from "valid token that was revoked" via the status code.
//
// Required Edge Function secret (Supabase Dashboard → Edge Functions →
// calendar-feed → Secrets):
//   (none beyond the platform-injected SUPABASE_URL / SUPABASE_ANON_KEY,
//   which every Edge Function gets automatically — this function only
//   needs the anon key since the RPC itself is what checks the token.)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const FACILITY_LABELS: Record<string, string> = {
  ac_hall: "AC Hall",
  non_ac_hall: "Non-AC Hall",
  lawn: "Lawn",
};

// Fixed slot times, IST — matches supabase/migrations/017_phase10_reserved_hours.sql
// exactly. These are NOT stored per booking (booking_requests.slot is just a
// label), so they're hardcoded here too, same as everywhere else in the app.
const SLOTS: Record<string, [number, number, number, number]> = {
  // [startHour, startMinute, endHour, endMinute] — IST, 24h
  morning: [8, 0, 14, 0],
  evening: [16, 0, 22, 0],
  full_day: [8, 0, 22, 0], // spans morning + evening back-to-back
};

function icsEscape(text: string): string {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// IST wall-clock date+time -> UTC ICS timestamp (YYYYMMDDTHHMMSSZ).
// IST is UTC+5:30 with no DST, so this is a fixed offset — no VTIMEZONE
// block needed as long as every DTSTART/DTEND is emitted in UTC ('Z' suffix).
function istToIcsUtc(dateStr: string, hour: number, minute: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d, hour, minute) - (5 * 60 + 30) * 60 * 1000;
  return new Date(ms).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function nowIcsUtc(): string {
  return new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response("Not found", { status: 404 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: bookings, error } = await supabase.rpc("get_admin_calendar_feed", { p_token: token });

  if (error) {
    console.error("calendar-feed: RPC error", error);
    return new Response("Not found", { status: 404 });
  }

  // Empty result covers BOTH "token is invalid/revoked" (RPC returns zero
  // rows on purpose) AND "token is valid but there are genuinely zero
  // approved Club House bookings yet". We can't tell these apart here, and
  // that's fine — a real Admin with a fresh account just sees an empty
  // calendar until the first approval, same as opening bookings.html would
  // show "no bookings". If this feels confusing in practice, the RPC could
  // be changed to signal validity separately, but that would also make an
  // invalid token distinguishable from a revoked one, which we deliberately
  // avoid — see 020_admin_calendar_feed.sql.
  const rows = bookings ?? [];

  const events = rows.map((b: any) => {
    const [startH, startM, endH, endM] = SLOTS[b.slot] ?? SLOTS.full_day;
    const dtStart = istToIcsUtc(b.booking_date, startH, startM);
    const dtEnd = istToIcsUtc(b.booking_date, endH, endM);
    const facility = FACILITY_LABELS[b.facility_id] ?? b.facility_name ?? b.facility_id;

    const descParts = [`Booking: ${b.booking_code}`, `Phone: ${b.phone}`];
    if (b.notes) descParts.push(`Notes: ${b.notes}`);

    return [
      "BEGIN:VEVENT",
      `UID:${b.booking_code}@peedspark.com`,
      `DTSTAMP:${nowIcsUtc()}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${icsEscape(`${facility} — ${b.customer_name} (${b.guests ?? "?"} guests)`)}`,
      `DESCRIPTION:${icsEscape(descParts.join("\\n"))}`,
      "LOCATION:" + icsEscape("Ammancherry, Kerala 686561"),
      "STATUS:CONFIRMED",
      "END:VEVENT",
    ].join("\r\n");
  });

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PeedsPark Club House//Admin Calendar Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:PeedsPark Club House Bookings",
    "X-WR-TIMEZONE:Asia/Kolkata",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
});
