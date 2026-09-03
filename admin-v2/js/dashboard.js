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
});
