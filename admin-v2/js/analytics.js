// PeedsPark Admin — Analytics dashboard. Calls the get_dashboard_stats() RPC
// (staff-only, checked server-side too) and renders the result as bold,
// colourful stat tiles + simple CSS bar visualisations — no chart library.

const FACILITY_LABELS = {
  ac_hall: "AC Hall", non_ac_hall: "Non-AC Hall", lawn: "Lawn",
  pool: "Swimming Pool", badminton_1: "Badminton Court 1", badminton_2: "Badminton Court 2",
};
const STATUS_LABELS = { pending: "Pending", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" };
const FUNNEL_STAGES = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "follow_up", label: "Follow-up" },
  { key: "converted", label: "Converted" },
  { key: "lost", label: "Lost" },
];

let staff = null;

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireStaffSession();
  if (!session) return;
  staff = session.staff;

  document.getElementById("staffName").textContent = staff.full_name;
  document.getElementById("staffRole").textContent = staff.role;
  document.getElementById("pageContent").hidden = false;

  document.querySelectorAll("[data-range]").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("[data-range]").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const { start, end } = rangeFromPreset(chip.dataset.range);
      loadStats(start, end);
    });
  });

  document.getElementById("customRangeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    document.querySelectorAll("[data-range]").forEach((c) => c.classList.remove("active"));
    const data = Object.fromEntries(new FormData(e.target).entries());
    if (!data.start || !data.end) return;
    if (data.end < data.start) {
      alert("End date must be on or after the start date.");
      return;
    }
    loadStats(data.start, data.end);
  });

  const { start, end } = rangeFromPreset("7");
  loadStats(start, end);
});

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function rangeFromPreset(preset) {
  if (preset === "month") {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    return { start, end: todayStr() };
  }
  const n = Number(preset);
  return { start: daysAgoStr(n - 1), end: todayStr() };
}

async function loadStats(start, end) {
  document.getElementById("statsContent").hidden = true;
  document.getElementById("loadingNote").hidden = false;
  document.getElementById("loadingNote").textContent = "Loading analytics…";
  document.getElementById("rangeLabel").textContent = `${start} → ${end}`;

  const { data, error } = await supabaseClient.rpc("get_dashboard_stats", { p_start: start, p_end: end });

  document.getElementById("loadingNote").hidden = true;
  if (error) {
    document.getElementById("loadingNote").hidden = false;
    document.getElementById("loadingNote").textContent = "Couldn't load analytics: " + error.message;
    return;
  }

  renderStats(data);
  document.getElementById("statsContent").hidden = false;
}

function renderStats(d) {
  document.getElementById("statCashInflow").textContent = `₹${Number(d.cash_inflow || 0).toFixed(2)}`;
  document.getElementById("statRevenueTotal").textContent = `₹${Number(d.revenue_total || 0).toFixed(2)}`;

  const funnel = d.enquiry_funnel || {};
  const enquiryCount = Object.values(funnel).reduce((s, n) => s + Number(n), 0);
  document.getElementById("statEnquiryCount").textContent = enquiryCount;

  const snapshot = d.status_snapshot || {};
  const bookingCount = Object.values(snapshot).reduce((s, n) => s + Number(n), 0);
  document.getElementById("statBookingCount").textContent = bookingCount;

  renderRevenueBars(d.revenue_by_facility || {});
  renderOccupancyBars(d.occupancy || {});
  renderFunnel(funnel);
  renderStatusChips(snapshot);
}

function renderRevenueBars(byFacility) {
  const container = document.getElementById("revenueBars");
  const entries = Object.entries(byFacility);
  if (entries.length === 0) {
    container.innerHTML = `<p class="no-data-note">No approved, paid bookings in this period yet.</p>`;
    return;
  }
  const max = Math.max(...entries.map(([, v]) => Number(v)), 1);
  container.innerHTML = entries
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([facilityId, amount], i) => `
      <div class="bar-row">
        <div class="bar-row-head"><span>${FACILITY_LABELS[facilityId] || facilityId}</span><span>₹${Number(amount).toFixed(2)}</span></div>
        <div class="bar-track"><div class="bar-fill c${i % 6}" style="width:${Math.max(3, (Number(amount) / max) * 100)}%"></div></div>
      </div>`)
    .join("");
}

function renderOccupancyBars(occupancy) {
  const container = document.getElementById("occupancyBars");
  const entries = Object.entries(occupancy);
  if (entries.length === 0) {
    container.innerHTML = `<p class="no-data-note">No data for this period.</p>`;
    return;
  }
  container.innerHTML = entries
    .map(([facilityId, info], i) => `
      <div class="bar-row">
        <div class="bar-row-head"><span>${info.name || FACILITY_LABELS[facilityId] || facilityId}</span><span>${info.occupancy_pct}%</span></div>
        <div class="bar-track"><div class="bar-fill c${i % 6}" style="width:${Math.min(100, Math.max(Number(info.occupancy_pct) > 0 ? 3 : 0, Number(info.occupancy_pct)))}%"></div></div>
      </div>`)
    .join("");
}

function renderFunnel(funnel) {
  const container = document.getElementById("funnelBars");
  container.innerHTML = FUNNEL_STAGES.map((s) => `
    <div class="funnel-stage funnel-${s.key}">
      <strong>${funnel[s.key] || 0}</strong>
      <span>${s.label}</span>
    </div>`).join("");
}

function renderStatusChips(snapshot) {
  const container = document.getElementById("statusChips");
  const keys = Object.keys(STATUS_LABELS).filter((k) => snapshot[k]);
  if (keys.length === 0) {
    container.innerHTML = `<p class="no-data-note">No bookings in this period.</p>`;
    return;
  }
  container.innerHTML = keys
    .map((k) => `<span class="status-chip status-${k}">${STATUS_LABELS[k]}: ${snapshot[k]}</span>`)
    .join("");
}
