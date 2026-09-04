// PeedsPark Admin — Reviews moderation.
// Any active staff (Admin or Manager) can approve/reject/feature a review —
// this is a day-to-day task, same tier as approving a booking. Permanently
// deleting a review is Admin only, matching the reviews_admin_delete RLS
// policy on the database side (a Manager clicking Delete would just get an
// RLS error back — the button is hidden for them so that never happens).

const STATUS_COLORS = {
  pending: "#D9A441",
  approved: "#2E9E5B",
  rejected: "#C0392B",
};
const STATUS_LABELS = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};
const FACILITY_LABELS = {
  ac_hall: "AC Hall",
  non_ac_hall: "Non-AC Hall",
  lawn: "Party Lawn",
  pool: "Swimming Pool",
  badminton: "Badminton",
};

let currentStaff = null;
let allReviews = [];
let activeFilter = "pending";
let listControls = null;

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireStaffSession();
  if (!session) return;
  currentStaff = session.staff;

  document.getElementById("staffName").textContent = currentStaff.full_name;
  document.getElementById("staffRole").textContent = currentStaff.role;
  document.getElementById("pageContent").hidden = false;

  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeFilter = chip.dataset.status;
      listControls?.resetPage();
      renderList();
    });
  });

  listControls = createListControls({
    searchInputId: "reviewAdminSearch",
    pagerContainerId: "reviewAdminPager",
    searchText: (r) => `${r.customer_name} ${r.phone} ${r.review_text}`,
    onChange: renderList,
  });

  await loadReviews();
});

async function loadReviews() {
  const { data, error } = await supabaseClient
    .from("reviews")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    document.getElementById("reviewAdminList").innerHTML =
      `<p class="muted center" style="padding:40px;">Couldn't load reviews: ${escapeHtml(error.message)}</p>`;
    return;
  }

  allReviews = data || [];
  listControls?.resetPage();
  renderList();
}

function renderList() {
  const container = document.getElementById("reviewAdminList");
  let rows = activeFilter === "all" ? allReviews : allReviews.filter((r) => r.status === activeFilter);
  rows = listControls ? listControls.apply(rows) : rows;

  if (rows.length === 0) {
    container.innerHTML = `<p class="muted center" style="padding:40px;">No reviews here.</p>`;
    listControls?.renderPager(0);
    return;
  }

  const page = listControls ? listControls.paginate(rows) : { rows };
  container.innerHTML = page.rows.map(rowHtml).join("");

  container.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", () => setStatus(btn.dataset.approve, "approved"));
  });
  container.querySelectorAll("[data-reject]").forEach((btn) => {
    btn.addEventListener("click", () => setStatus(btn.dataset.reject, "rejected"));
  });
  container.querySelectorAll("[data-unpending]").forEach((btn) => {
    // Move an approved/rejected review back to Pending, in case of a
    // mis-click — every status change stays reversible from this page.
    btn.addEventListener("click", () => setStatus(btn.dataset.unpending, "pending"));
  });
  container.querySelectorAll("[data-feature]").forEach((btn) => {
    btn.addEventListener("click", () => toggleFeatured(btn.dataset.feature));
  });
  container.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteReview(btn.dataset.delete));
  });

  listControls?.renderPager(rows.length);
}

function rowHtml(r) {
  const color = STATUS_COLORS[r.status] || "#999";
  const facilityLabel = FACILITY_LABELS[r.facility_group] || "General visit";
  const stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
  const waLink = `https://wa.me/${(r.phone || "").replace(/\D/g, "")}`;

  return `
    <div class="enquiry-card" style="border-left-color:${color};">
      <div class="enquiry-card-main">
        <div>
          <strong>${escapeHtml(r.customer_name)}</strong>
          <span class="muted"> · ${escapeHtml(r.phone)}</span>
          <span class="muted"> · ${facilityLabel}</span>
          ${r.is_featured ? `<span class="role-badge" style="background:var(--coral-dark);">Featured</span>` : ""}
        </div>
        <div class="muted small">
          ${STATUS_LABELS[r.status] || r.status} · <span style="color:${color};letter-spacing:1px;">${stars}</span> · ${new Date(r.created_at).toLocaleString()}
        </div>
        <p class="enquiry-message">"${escapeHtml(r.review_text)}"</p>
      </div>
      <div class="enquiry-card-actions">
        ${r.status !== "approved" ? `<button class="btn btn-primary btn-sm" data-approve="${r.id}">✓ Approve</button>` : ""}
        ${r.status !== "rejected" ? `<button class="btn btn-outline-dark btn-sm" data-reject="${r.id}">✕ Reject</button>` : ""}
        ${r.status !== "pending" ? `<button class="btn btn-outline-dark btn-sm" data-unpending="${r.id}">↺ Back to Pending</button>` : ""}
        ${r.status === "approved" ? `<button class="btn btn-outline-dark btn-sm" data-feature="${r.id}">${r.is_featured ? "☆ Unfeature" : "★ Feature"}</button>` : ""}
        <a class="btn btn-outline-dark btn-sm" href="${waLink}" target="_blank" rel="noopener">💬 WhatsApp</a>
        ${currentStaff.role === "admin" ? `<button class="btn btn-outline-dark btn-sm" data-delete="${r.id}" style="border-color:#C0392B;color:#C0392B;">🗑 Delete</button>` : ""}
      </div>
    </div>`;
}

async function setStatus(id, status) {
  const patch = { status };
  if (status === "approved") {
    patch.approved_at = new Date().toISOString();
    patch.approved_by = currentStaff.id;
  } else {
    patch.approved_at = null;
    patch.approved_by = null;
  }

  const { error } = await supabaseClient.from("reviews").update(patch).eq("id", id);
  if (error) {
    alert(`Couldn't update this review: ${error.message}`);
    return;
  }
  await loadReviews();
}

async function toggleFeatured(id) {
  const row = allReviews.find((r) => r.id === id);
  if (!row) return;

  const { error } = await supabaseClient
    .from("reviews")
    .update({ is_featured: !row.is_featured })
    .eq("id", id);

  if (error) {
    alert(`Couldn't update this review: ${error.message}`);
    return;
  }
  await loadReviews();
}

async function deleteReview(id) {
  if (!confirm("Permanently delete this review? This can't be undone.")) return;

  const { error } = await supabaseClient.from("reviews").delete().eq("id", id);
  if (error) {
    alert(`Couldn't delete this review: ${error.message}`);
    return;
  }
  await loadReviews();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}
