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
    // front of the shared row for Manager accounts only, leaving Admin's
    // view (which already has its own Admin-only row above) unchanged.
    const grid = document.querySelector(".card-grid:not(#adminOnlyTiles)");
    const mgrTile = grid?.querySelector('a[href="manager-feed.html"]');
    if (grid && mgrTile) grid.insertBefore(mgrTile, grid.firstElementChild);
  }

  document.getElementById("dashboardContent").hidden = false;
});
