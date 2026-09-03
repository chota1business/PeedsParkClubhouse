// PeedsPark Admin — Customers (Phase 10)
// Reads from customer_activity (a staff-only view over the auto-populated
// `customers` table — see 015_phase10_customers.sql). No submit/insert path
// here at all; customers are only ever created by the link_customer()
// trigger on a real enquiry/booking submission.

let currentStaff = null;
let allCustomers = [];
let activeSort = "recent";
let listControls = null;

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
      activeSort = chip.dataset.sort;
      listControls?.resetPage();
      renderList();
    });
  });

  // Customers have no single "booking date" — customer_activity only carries
  // first_seen_at/last_seen_at timestamps, so the date range here filters on
  // last_seen_at (the most useful "when were they last active" reading).
  listControls = createListControls({
    searchInputId: "customerSearch",
    dateFromId: "customerDateFrom",
    dateToId: "customerDateTo",
    pagerContainerId: "customerPager",
    searchText: (c) => `${c.name} ${c.phone}`,
    dateField: (c) => (c.last_seen_at ? c.last_seen_at.slice(0, 10) : null),
    onChange: renderList,
  });

  await loadCustomers();
});

async function loadCustomers() {
  const { data, error } = await supabaseClient
    .from("customer_activity")
    .select("*");

  if (error) {
    document.getElementById("customerList").innerHTML =
      `<p class="muted center" style="padding:40px;">Couldn't load customers: ${escapeHtml(error.message)}</p>`;
    return;
  }

  allCustomers = data || [];
  listControls?.resetPage();
  renderList();
}

function renderList() {
  const container = document.getElementById("customerList");
  let rows = listControls ? listControls.apply(allCustomers) : allCustomers;

  rows = [...rows].sort((a, b) => {
    if (activeSort === "frequent") {
      const totalA = a.enquiry_count + a.hall_lawn_booking_count + a.hourly_booking_count;
      const totalB = b.enquiry_count + b.hall_lawn_booking_count + b.hourly_booking_count;
      return totalB - totalA;
    }
    return new Date(b.last_seen_at) - new Date(a.last_seen_at);
  });

  if (rows.length === 0) {
    container.innerHTML = `<p class="muted center" style="padding:40px;">No customers match the current search/filter.</p>`;
    listControls?.renderPager(0);
    return;
  }

  const page = listControls ? listControls.paginate(rows) : { rows };
  container.innerHTML = page.rows.map(rowHtml).join("");

  container.querySelectorAll("[data-notes-id]").forEach(btn => {
    btn.addEventListener("click", () => editNotes(btn.dataset.notesId));
  });
  listControls?.renderPager(rows.length);
}

function rowHtml(c) {
  const waLink = `https://wa.me/${c.phone}`;
  const totalActivity = c.enquiry_count + c.hall_lawn_booking_count + c.hourly_booking_count;
  const isRepeat = totalActivity > 1;
  return `
    <div class="enquiry-card" style="border-left-color:${isRepeat ? "var(--plum)" : "#ccc"};">
      <div class="enquiry-card-main">
        <div>
          <strong>${escapeHtml(c.name)}</strong>
          <span class="muted"> · ${escapeHtml(c.phone)}</span>
          ${c.email ? `<span class="muted"> · ${escapeHtml(c.email)}</span>` : ""}
          ${isRepeat ? `<span style="background:var(--plum);color:#fff;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;margin-left:8px;">repeat</span>` : ""}
        </div>
        <div class="muted small">
          ${c.enquiry_count} enquir${c.enquiry_count === 1 ? "y" : "ies"} · ${c.hall_lawn_booking_count} Hall/Lawn booking${c.hall_lawn_booking_count === 1 ? "" : "s"} · ${c.hourly_booking_count} Pool/Badminton booking${c.hourly_booking_count === 1 ? "" : "s"}
          · ${c.approved_booking_count} approved total
          · first seen ${new Date(c.first_seen_at).toLocaleDateString()}
          · last seen ${new Date(c.last_seen_at).toLocaleDateString()}
        </div>
        ${c.notes ? `<p class="enquiry-message">📝 ${escapeHtml(c.notes)}</p>` : ""}
      </div>
      <div class="enquiry-card-actions">
        <button class="btn btn-outline-dark btn-sm" data-notes-id="${c.id}">📝 ${c.notes ? "Edit" : "Add"} note</button>
        <a class="btn btn-outline-dark btn-sm" href="${waLink}" target="_blank" rel="noopener">💬 WhatsApp</a>
        <a class="btn btn-outline-dark btn-sm" href="tel:${c.phone}">📞 Call</a>
      </div>
    </div>`;
}

async function editNotes(id) {
  const customer = allCustomers.find(c => c.id === id);
  if (!customer) return;

  const notes = prompt(`Staff note for ${customer.name} (${customer.phone}):`, customer.notes || "");
  if (notes === null) return; // cancelled

  const { error } = await supabaseClient
    .from("customers")
    .update({ notes: notes.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    alert("Couldn't save note: " + error.message);
    return;
  }

  customer.notes = notes.trim() || null;
  renderList();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
