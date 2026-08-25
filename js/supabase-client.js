// PeedsPark — Supabase connection config
//
// TODO: fill these in once the Supabase project exists (Project Settings → API).
// The "anon" key is a PUBLIC key by design — it's meant to sit in this file and
// ship to every visitor's browser. It has no power beyond what Row Level Security
// (see supabase/migrations/002_rls_policies.sql) allows: insert-only on
// enquiries/booking_requests/hourly_bookings, and read-only on facilities and
// the public_availability view. Never put the "service_role" key here or in
// any file that reaches the browser.

const SUPABASE_URL = "https://cvqvxclvizpltnflbdlh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__YwQN797avQlDxOh8FvFBA_ZaNTfCUh";

let supabaseClient = null;

if (SUPABASE_URL.startsWith("TODO") || SUPABASE_ANON_KEY.startsWith("TODO")) {
  console.warn(
    "PeedsPark: Supabase is not configured yet — forms will show a friendly error " +
    "instead of submitting. Fill in js/supabase-client.js once the project exists."
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
