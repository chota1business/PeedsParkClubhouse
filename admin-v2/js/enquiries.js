// PeedsPark Admin — Enquiries management (Phase 2)

const STATUS_COLORS = {
  new: "#0E7C7B",
  contacted: "#D9A441",
  follow_up: "#FF6B35",
  converted: "#2E9E5B",
  lost: "#8A8A8A",
};
const STATUS_LABELS = {
  new: "New",
  contacted: "Contacted",
  follow_up: "Follow-up",
  converted: "Converted",
  lost: "Lost",
};

let currentStaff = null;
let allEnquiries = [];
let activeFilter = "all";

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireStaffSession();
  if (!session) return;
  currentStaff = session.staff;

  document.getElementById("staffName").textContent = currentStaff.full_name;
  document.getElementById("staffRole").textContent = currentStaff.role;
  document.getElementById("pageContent").hidden = false;

  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeFilter = chip.dataset.status;
      renderList();
    });
  });

  await loadEnquiries();
});

async function loadEnquiries() {
  const { data, error } = await supabaseClient
    .from("enquiries")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    document.getElementById("enquiryList").innerHTML =
      `<p class="muted center" style="padding:40px;">Couldn't load enquiries: ${escapeHtml(error.message)}</p>`;
    return;
  }

  allEnquiries = data || [];
  renderList();
}

function renderList() {
  const container = document.getElementById("enquiryList");
  const rows = activeFilter === "all" ? allEnquiries : allEnquiries.filter(e => e.status === activeFilter);

  if (rows.length === 0) {
    container.innerHTML = `<p class="muted center" style="padding:40px;">No enquiries here.</p>`;
    return;
  }

  container.innerHTML = rows.map(rowHtml).join("");

  container.querySelectorAll("select.status-select").forEach(sel => {
    sel.addEventListener("change", (e) => updateStatus(e.target.dataset.id, e.target.value));
  });
}

function rowHtml(e) {
  const color = STATUS_COLORS[e.status] || "#999";
  const waLink = `https://wa.me/${e.phone.replace(/\D/g, "")}`;
  return `
    <div class="enquiry-card" style="border-left-color:${color};">
      <div class="enquiry-card-main">
        <div>
          <strong>${escapeHtml(e.customer_name)}</strong>
          <span class="muted"> · ${escapeHtml(e.phone)}</span>
          ${e.email ? `<span class="muted"> · ${escapeHtml(e.email)}</span>` : ""}
        </div>
        <div class="muted small">
          ${e.enquiry_code} · ${e.facility_id ? escapeHtml(e.facility_id) : "no facility chosen"}
          ${e.preferred_date ? " · " + e.preferred_date : ""}
          ${e.guests ? " · " + e.guests + " guests" : ""}
          · source: ${e.source || "unknown"}
          · ${new Date(e.created_at).toLocaleString()}
        </div>
        ${e.message ? `<p class="enquiry-message">${escapeHtml(e.message)}</p>` : ""}
      </div>
      <div class="enquiry-card-actions">
        <select class="status-select" data-id="${e.id}">
          ${Object.entries(STATUS_LABELS).map(([val, label]) =>
            `<option value="${val}" ${val === e.status ? "selected" : ""}>${label}</option>`
          ).join("")}
        </select>
        <a class="btn btn-outline-dark btn-sm" href="${waLink}" target="_blank" rel="noopener">💬 WhatsApp</a>
        <a class="btn btn-outline-dark btn-sm" href="tel:${e.phone}">📞 Call</a>
      </div>
    </div>`;
}

async function updateStatus(id, newStatus) {
  const enquiry = allEnquiries.find(e => e.id === id);
  const oldStatus = enquiry?.status;

  const { error } = await supabaseClient
    .from("enquiries")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    alert("Couldn't update status: " + error.message);
    return;
  }

  // Best-effort audit trail — RLS (audit_log_staff_insert) requires actor_id = auth.uid().
  const { data: { user } } = await supabaseClient.auth.getUser();
  await supabaseClient.from("audit_log").insert({
    actor_id: user.id,
    action: "update_enquiry_status",
    table_name: "enquiries",
    record_id: id,
    details: { from: oldStatus, to: newStatus },
  });

  if (enquiry) enquiry.status = newStatus;
  renderList();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
