// PeedsPark Admin — dashboard shell: session/role guard + role-based menu.

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireStaffSession();
  if (!session) return; // requireStaffSession already redirected or showed the not-authorised panel

  const { staff } = session;

  document.getElementById("staffName").textContent = staff.full_name;
  document.getElementById("staffRole").textContent = staff.role;
  document.getElementById("welcomeName").textContent = `, ${staff.full_name}`;

  if (staff.role === "admin") {
    document.getElementById("staffTile")?.removeAttribute("hidden");
  }

  document.getElementById("dashboardContent").hidden = false;
});
