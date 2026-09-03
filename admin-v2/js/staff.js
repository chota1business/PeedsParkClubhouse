// PeedsPark Admin — Staff Management (Admin only).
// Lists staff (RLS lets an Admin see/update every row), and creates new
// logins via the create-staff Edge Function, since creating an auth.users
// account needs the service-role key and can't be done from the browser.

let currentStaff = null;
let allStaff = [];

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireStaffSession();
  if (!session) return;
  currentStaff = session.staff;

  document.getElementById("staffName").textContent = currentStaff.full_name;
  document.getElementById("staffRole").textContent = currentStaff.role;

  if (currentStaff.role !== "admin") {
    document.getElementById("notAuthorised")?.removeAttribute("hidden");
    return;
  }

  document.getElementById("pageContent").hidden = false;
  await loadStaff();

  document.getElementById("addStaffBtn").addEventListener("click", openStaffModal);
  document.getElementById("closeStaffModal").addEventListener("click", closeStaffModal);
  document.getElementById("cancelStaffModal").addEventListener("click", closeStaffModal);
  document.getElementById("addStaffModal").addEventListener("click", (e) => {
    if (e.target.id === "addStaffModal") closeStaffModal();
  });
  document.getElementById("addStaffForm").addEventListener("submit", submitAddStaff);
});

async function loadStaff() {
  const listEl = document.getElementById("staffList");
  const { data, error } = await supabaseClient
    .from("staff")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    listEl.innerHTML = `<p class="muted center" style="padding:40px;">Couldn't load staff: ${escapeHtml(error.message)}</p>`;
    return;
  }

  allStaff = data || [];
  renderStaff();
}

function renderStaff() {
  const listEl = document.getElementById("staffList");
  if (!allStaff.length) {
    listEl.innerHTML = `<p class="muted center" style="padding:40px;">No staff yet.</p>`;
    return;
  }

  listEl.innerHTML = allStaff.map((s) => `
    <div class="enquiry-card" style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
      <div>
        <strong>${escapeHtml(s.full_name)}</strong>
        <span class="type-badge ${s.role === "admin" ? "hall_lawn_booking" : "hourly_booking"}" style="margin-left:8px;">${s.role}</span>
        ${!s.active ? '<span class="source-badge">Inactive</span>' : ""}
        <br><span class="muted">${escapeHtml(s.phone || "No phone on file")}</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${s.id !== currentStaff.id
          ? `<button type="button" class="btn btn-outline-dark btn-sm" data-toggle-id="${s.id}">${s.active ? "Deactivate" : "Reactivate"}</button>`
          : `<span class="muted" style="font-size:0.85rem;">(you)</span>`}
      </div>
    </div>
  `).join("");

  listEl.querySelectorAll("[data-toggle-id]").forEach((btn) => {
    btn.addEventListener("click", () => toggleActive(btn.dataset.toggleId));
  });
}

async function toggleActive(id) {
  const row = allStaff.find((s) => s.id === id);
  if (!row) return;
  const nextActive = !row.active;
  const verb = nextActive ? "reactivate" : "deactivate";
  if (!confirm(`${verb.charAt(0).toUpperCase() + verb.slice(1)} ${row.full_name}'s login?`)) return;

  const { error } = await supabaseClient.from("staff").update({ active: nextActive }).eq("id", id);
  if (error) {
    alert(`Couldn't ${verb} this account: ${error.message}`);
    return;
  }
  row.active = nextActive;
  renderStaff();
}

function openStaffModal() {
  document.getElementById("addStaffForm").reset();
  document.getElementById("staffFormError").hidden = true;
  document.getElementById("addStaffModal").hidden = false;
}

function closeStaffModal() {
  document.getElementById("addStaffModal").hidden = true;
}

async function submitAddStaff(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("staffFormError");
  errorEl.hidden = true;

  const data = Object.fromEntries(new FormData(form).entries());
  if (data.phone && !/^[0-9]{10}$/.test(data.phone.trim())) {
    errorEl.textContent = "Phone must be a valid 10-digit mobile number, or left blank.";
    errorEl.hidden = false;
    return;
  }

  const saveBtn = document.getElementById("saveStaffBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Creating...";

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/create-staff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        full_name: data.full_name.trim(),
        email: data.email.trim(),
        phone: data.phone ? data.phone.trim() : null,
        role: data.role,
        password: data.password,
      }),
    });
    const result = await resp.json();

    if (!resp.ok || result.error) {
      errorEl.textContent = result.error || "Couldn't create this staff login.";
      errorEl.hidden = false;
      return;
    }

    closeStaffModal();
    await loadStaff();
  } catch (err) {
    errorEl.textContent = "Couldn't reach the server — please try again.";
    errorEl.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Create Login";
  }
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
