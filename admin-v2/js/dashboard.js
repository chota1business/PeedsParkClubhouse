// PeedsPark Admin — dashboard shell: session/role guard + role-based menu.

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireStaffSession();
  if (!session) return; // requireStaffSession already redirected or showed the not-authorised panel

  const { staff } = session;

  document.getElementById("staffName").textContent = staff.full_name;
  document.getElementById("staffRole").textContent = staff.role;
  document.getElementById("welcomeName").textContent = `, ${staff.full_name}`;

  if (staff.role === "admin") {
    document.getElementById("adminOnlyTiles")?.removeAttribute("hidden");
    loadReviewsPendingCount(); // Reviews is Admin-only, so only load this for admins
  } else {
    // Manager's most-used tool day to day is Manager Feed — move it to the
    // front of its row (Enquiries / Customers / Manager Feed) for Manager
    // accounts only, leaving Admin's view (which already has its own
    // Admin-only row above) unchanged. Row 1 (Club House / Pool /
    // Badminton) stays in place either way — those are the facility tiles,
    // not the feed.
    const row2 = document.getElementById("row2Tiles");
    const mgrTile = row2?.querySelector('a[href="manager-feed.html"]');
    if (row2 && mgrTile) row2.insertBefore(mgrTile, row2.firstElementChild);
  }

  document.getElementById("dashboardContent").hidden = false;

  const moreToolsToggle = document.getElementById("moreToolsToggle");
  const moreToolsGrid = document.getElementById("moreToolsGrid");
  moreToolsToggle?.addEventListener("click", () => {
    const isOpen = moreToolsToggle.getAttribute("aria-expanded") === "true";
    moreToolsToggle.setAttribute("aria-expanded", String(!isOpen));
    moreToolsGrid.hidden = isOpen;
  });

  loadFacilityCounts();
});

// Pending-reviews badge on the Reviews tile — a quick nudge that
// something's waiting in the moderation queue, same count-chip look as
// the facility badges above but sourced directly from the reviews table
// (no RPC needed: staff can already SELECT all reviews per RLS — and since
// Reviews is now Admin-only, this is only ever called for an admin session,
// see the role check above).
async function loadReviewsPendingCount() {
  const { count, error } = await supabaseClient
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const el = document.getElementById("reviewsPendingCount");
  if (!el) return;
  if (error) {
    console.error("Couldn't load pending reviews count:", error);
    return;
  }
  el.innerHTML = count > 0
    ? `<span class="count-chip">${count} review${count === 1 ? "" : "s"} pending</span>`
    : `<span class="count-chip zero">All clear</span>`;
  el.hidden = false;
}

// Badges on the Club House / Pool / Badminton tiles — how many pending
// booking requests and open (not yet converted/lost) enquiries each
// facility has waiting on staff, so it's visible at a glance from the
// Dashboard instead of having to open each page to check.
async function loadFacilityCounts() {
  const { data, error } = await supabaseClient.rpc("get_dashboard_facility_counts");
  if (error || !data) {
    console.error("Couldn't load facility counts:", error);
    return; // tiles just show no badge — not worth blocking the dashboard over
  }
  document.querySelectorAll("[data-facility-counts]").forEach((el) => {
    const key = el.dataset.facilityCounts;
    const counts = data[key];
    if (!counts) return;
    const chips = [];
    if (counts.bookings_pending > 0) {
      chips.push(`<span class="count-chip">${counts.bookings_pending} booking${counts.bookings_pending === 1 ? "" : "s"} pending</span>`);
    }
    if (counts.enquiries_open > 0) {
      chips.push(`<span class="count-chip">${counts.enquiries_open} enquir${counts.enquiries_open === 1 ? "y" : "ies"} open</span>`);
    }
    if (chips.length === 0) {
      chips.push(`<span class="count-chip zero">All clear</span>`);
    }
    el.innerHTML = chips.join("");
    el.hidden = false;
  });
}
