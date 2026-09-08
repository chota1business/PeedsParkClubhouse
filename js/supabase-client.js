// PeedsPark — Supabase connection config
//
// The actual URL/key come from window.CONFIG, defined in config.js:
//   - Locally: config.js is gitignored — copy config.example.js (or your own
//     copy) to config.js and fill in the values, or leave the checked-in
//     defaults in place.
//   - In production: .github/workflows/inject-secrets.yml generates config.js
//     from repository secrets at deploy time, so it never lives in git.
// config.js must be loaded (via <script>) before this file on every page.
//
// The "anon"/publishable key is a PUBLIC key by design — it's meant to ship
// to every visitor's browser. It has no power beyond what Row Level Security
// (see supabase/migrations/002_rls_policies.sql) allows: insert-only on
// enquiries/booking_requests/hourly_bookings, and read-only on facilities and
// the public_availability view. Never put the "service_role" key here or in
// any file that reaches the browser.

const SUPABASE_URL = window.CONFIG?.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = window.CONFIG?.SUPABASE_ANON_KEY || "";

let supabaseClient = null;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "PeedsPark: Supabase is not configured yet — forms will show a friendly error " +
    "instead of submitting. Make sure config.js is loaded and defines window.CONFIG."
  );
} else if (typeof window.supabase === "undefined") {
  // The Supabase CDN script failed to load (network issue, ad blocker, CDN outage).
  // Fail soft: the rest of the page's JS (nav, etc.) must keep working.
  console.error("PeedsPark: Supabase library failed to load from CDN — booking/login features are unavailable right now.");
} else {
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    console.error("PeedsPark: failed to initialise Supabase client.", err);
  }
}
