// PeedsPark Admin — Blocks & Closures (Admin only).
//
// One page replacing three older mechanisms:
//   * the maintenance block panel that used to sit on bookings.html
//   * the identical panel on hourly-bookings.html
//   * the members-reserved-hours open/close panel (facility_reserved_windows
//     + reserved_window_unblocks), which is now just another kind of block.
//
// Everything reads and writes the single `blocks` table (plus
// `block_exceptions` for per-date overrides). The per-hour picture comes from
// the get_block_grid() RPC so the block rules live in exactly one place —
// the database — rather than being re-implemented here.

const FACILITIES = [
  { id: "ac_hall",     name: "AC Hall",           kind: "fixed"  },
  { id: "non_ac_hall", name: "Non-AC Hall",       kind: "fixed"  },
  { id: "lawn",        name: "Lawn",              kind: "fixed"  },
  { id: "pool",        name: "Swimming Pool",     kind: "hourly" },
  { id: "badminton_1", name: "Badminton Court 1", kind: "hourly", badminton: true },
  { id: "badminton_2", name: "Badminton Court 2", kind: "hourly", badminton: true },
];
const FACILITY_LABELS = Object.fromEntries(FACILITIES.map((f) => [f.id, f.name]));

const TYPE_LABELS = {
  badminton_members: "Badminton time slot block",
  maintenance: "Maintenance",
  closure: "Facility closure",
};
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let currentStaff = null;
let allBlocks = [];
let blockFilter = "all";
let gridData = null;

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireStaffSession();
  if (!session) return;
  currentStaff = session.staff;

  document.getElementById("staffName").textContent = currentStaff.full_name;
  document.getElementById("staffRole").textContent = currentStaff.role;

  // Admin-only, enforced here AND by RLS on blocks/block_exceptions — a
  // Manager who navigates straight to this URL gets the same panel every
  // other protected page uses, and would be refused by the database anyway.
  if (currentStaff.role !== "admin") {
    document.getElementById("notAuthorised")?.removeAttribute("hidden");
    return;
  }
  document.getElementById("pageContent").hidden = false;

  buildFacilityPickers();
  buildDayOfWeekChecks();
  wireTabs();
  wireForm();
  wireBlockFilters();

  const dateInput = document.getElementById("gridDate");
  dateInput.value = todayIso();
  dateInput.min = "2020-01-01";
  document.getElementById("gridFacility").addEventListener("change", loadGrid);
  dateInput.addEventListener("change", loadGrid);

  await Promise.all([loadGrid(), loadBlocks()]);
});

/* ------------------------------------------------------------------ *
 * Setup
 * ------------------------------------------------------------------ */

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildFacilityPickers() {
  document.getElementById("gridFacility").innerHTML = FACILITIES
    .map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`)
    .join("");

  document.getElementById("facilityChecks").innerHTML = FACILITIES
    .map((f) => `
      <label class="check-row" data-facility="${f.id}" data-badminton="${f.badminton ? "1" : "0"}">
        <input type="checkbox" name="facility_id" value="${f.id}">
        <span>${escapeHtml(f.name)}</span>
      </label>`)
    .join("");
}

function buildDayOfWeekChecks() {
  // Monday-first reads more naturally than Postgres's Sunday-first dow, but
  // the value stored is still the Postgres dow number.
  const order = [1, 2, 3, 4, 5, 6, 0];
  document.getElementById("dowChecks").innerHTML = order
    .map((d) => `
      <label class="check-row">
        <input type="checkbox" name="days_of_week" value="${d}" checked>
        <span>${DAY_NAMES[d]}</span>
      </label>`)
    .join("");
}

function wireTabs() {
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.tab;
      document.getElementById("tabDay").hidden = target !== "day";
      document.getElementById("tabAdd").hidden = target !== "add";
      document.getElementById("tabRules").hidden = target !== "rules";
    });
  });
}

function wireBlockFilters() {
  document.querySelectorAll("[data-blockfilter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-blockfilter]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      blockFilter = btn.dataset.blockfilter;
      renderBlocks();
    });
  });
}

/* ------------------------------------------------------------------ *
 * Day view — the per-hour grid
 * ------------------------------------------------------------------ */

async function loadGrid() {
  const facility = document.getElementById("gridFacility").value;
  const date = document.getElementById("gridDate").value;
  const container = document.getElementById("hourGrid");

  if (!facility || !date) {
    container.innerHTML = `<p class="muted center" style="padding:40px;">Pick a facility and date.</p>`;
    return;
  }

  container.innerHTML = `<p class="muted center" style="padding:40px;">Loading…</p>`;
  const { data, error } = await supabaseClient.rpc("get_block_grid", {
    p_facility_id: facility,
    p_date: date,
  });

  if (error) {
    container.innerHTML = `<p class="muted center" style="padding:40px;">Couldn't load this day: ${escapeHtml(error.message)}</p>`;
    return;
  }
  gridData = data;
  renderGrid();
}

function renderGrid() {
  const container = document.getElementById("hourGrid");
  const tiles = gridData?.tiles || [];

  if (!tiles.length) {
    container.innerHTML = `<p class="muted center" style="padding:40px;">Nothing to show for this day.</p>`;
    return;
  }

  container.innerHTML = tiles.map((t, i) => {
    const time = `${t.start} – ${t.end}`;
    if (t.state === "open") {
      return `
        <button type="button" class="hour-tile state-open" disabled>
          <span><span class="hour-time">${time}</span></span>
          <span class="hour-state">Open</span>
        </button>`;
    }
    if (t.state === "opened") {
      return `
        <button type="button" class="hour-tile state-opened" data-tile="${i}">
          <span>
            <span class="hour-time">${time}</span>
            <span class="hour-hint">Tap to block again</span>
          </span>
          <span class="hour-state">Opened</span>
        </button>`;
    }
    return `
      <button type="button" class="hour-tile state-blocked type-${escapeHtml(t.block_type)}" data-tile="${i}">
        <span>
          <span class="hour-time">${time}</span>
          <span class="hour-hint">Tap to open this hour</span>
        </span>
        <span class="hour-state">${escapeHtml(t.label || "Blocked")}</span>
      </button>`;
  }).join("");

  container.querySelectorAll("[data-tile]").forEach((btn) => {
    btn.addEventListener("click", () => toggleTile(Number(btn.dataset.tile)));
  });
}

async function toggleTile(index) {
  const tile = gridData?.tiles?.[index];
  if (!tile) return;
  const date = document.getElementById("gridDate").value;
  const facilityName = FACILITY_LABELS[document.getElementById("gridFacility").value] || "";
  const when = `${tile.start}–${tile.end} on ${date}`;

  if (tile.state === "opened") {
    if (!confirm(`Put the block back on ${facilityName} for ${when}?`)) return;
    const { error } = await supabaseClient
      .from("block_exceptions")
      .delete()
      .eq("id", tile.exception_id);
    if (error) { alert(`Couldn't re-block: ${error.message}`); return; }
    await writeAudit("reblock_hour", "block_exceptions", tile.exception_id, {
      facility_id: document.getElementById("gridFacility").value, date, start: tile.start, end: tile.end,
    });
  } else {
    if (!confirm(`Open ${facilityName} for public booking, ${when}?\n\nThis affects this date only — the standing block stays in place for every other day.`)) return;
    const { data: inserted, error } = await supabaseClient
      .from("block_exceptions")
      .insert({
        block_id: tile.block_id,
        exception_date: date,
        start_time: tile.start,
        end_time: tile.end,
      })
      .select()
      .single();
    if (error) { alert(`Couldn't open this time: ${error.message}`); return; }
    await writeAudit("open_blocked_hour", "block_exceptions", inserted.id, {
      facility_id: document.getElementById("gridFacility").value, date, start: tile.start, end: tile.end,
      block_type: tile.block_type,
    });
  }

  await Promise.all([loadGrid(), loadBlocks()]);
}

/* ------------------------------------------------------------------ *
 * Add a block
 * ------------------------------------------------------------------ */

function wireForm() {
  const form = document.getElementById("blockForm");

  form.querySelectorAll('input[name="block_type"]').forEach((radio) => {
    radio.addEventListener("change", () => applyTypeRules(radio.value));
  });

  form.addEventListener("submit", submitBlock);
}

// The badminton members block only makes sense on a badminton court, so the
// other facilities are visibly disabled rather than silently rejected later.
function applyTypeRules(type) {
  document.getElementById("fieldsMaintenance").hidden = type !== "maintenance";
  document.getElementById("fieldsClosure").hidden = type !== "closure";
  document.getElementById("fieldsMembers").hidden = type !== "badminton_members";

  document.querySelectorAll("#facilityChecks .check-row").forEach((row) => {
    const isBadminton = row.dataset.badminton === "1";
    const allowed = type !== "badminton_members" || isBadminton;
    const box = row.querySelector("input");
    box.disabled = !allowed;
    if (!allowed) box.checked = false;
    row.classList.toggle("is-disabled", !allowed);
  });

  if (type === "badminton_members") {
    document.querySelector('#blockForm [name="start_time"]').value = "05:00";
    document.querySelector('#blockForm [name="end_time"]').value = "08:00";
  }

  document.getElementById("saveBlockBtn").textContent =
    type === "closure" ? "Close Facility" : type === "badminton_members" ? "Add Members Block" : "Add Block";
}

function showFormError(msg) {
  const el = document.getElementById("blockFormError");
  el.textContent = msg;
  el.hidden = false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearFormError() {
  const el = document.getElementById("blockFormError");
  el.hidden = true;
  el.textContent = "";
}

async function submitBlock(e) {
  e.preventDefault();
  clearFormError();
  const form = e.target;

  const type = form.querySelector('input[name="block_type"]:checked')?.value;
  if (!type) return showFormError("Pick a request type first.");

  const facilities = Array.from(form.querySelectorAll('input[name="facility_id"]:checked')).map((c) => c.value);
  if (!facilities.length) return showFormError("Pick at least one facility.");

  const reason = form.reason.value.trim() || null;
  const groupId = crypto.randomUUID();
  let rows = [];
  let summary = "";

  if (type === "maintenance") {
    const startAt = form.start_at.value;
    const endAt = form.end_at.value;
    if (!startAt || !endAt) return showFormError("Enter both a From and a To date-time.");
    if (new Date(endAt) <= new Date(startAt)) return showFormError("The To time has to be after the From time.");
    rows = facilities.map((f) => ({
      facility_id: f, block_type: type, group_id: groupId, is_recurring: false,
      start_at: new Date(startAt).toISOString(), end_at: new Date(endAt).toISOString(), reason,
    }));
    summary = `${formatDateTime(startAt)} to ${formatDateTime(endAt)}`;

  } else if (type === "closure") {
    const from = form.closure_from.value;
    const to = form.closure_to.value;
    if (!from || !to) return showFormError("Enter both a From and a To date.");
    if (to < from) return showFormError("The To date has to be on or after the From date.");
    // Whole days in IST: midnight on the start date through midnight after the
    // end date, so the last day is included.
    const startAt = new Date(`${from}T00:00:00+05:30`).toISOString();
    const endAt = new Date(`${to}T00:00:00+05:30`);
    endAt.setDate(endAt.getDate() + 1);
    rows = facilities.map((f) => ({
      facility_id: f, block_type: type, group_id: groupId, is_recurring: false,
      start_at: startAt, end_at: endAt.toISOString(), reason,
    }));
    summary = from === to ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`;

  } else {
    const startTime = form.start_time.value;
    const endTime = form.end_time.value;
    if (!startTime || !endTime) return showFormError("Enter both a From and a To time.");
    if (endTime <= startTime) return showFormError("The To time has to be after the From time.");
    const days = Array.from(form.querySelectorAll('input[name="days_of_week"]:checked')).map((c) => Number(c.value));
    if (!days.length) return showFormError("Tick at least one day of the week.");
    const validTo = form.valid_to.value || null;
    rows = facilities.map((f) => ({
      facility_id: f, block_type: type, group_id: groupId, is_recurring: true,
      start_time: startTime, end_time: endTime, days_of_week: days,
      valid_from: todayIso(), valid_to: validTo, reason,
    }));
    summary = `${startTime}–${endTime}, ${days.length === 7 ? "every day" : days.map((d) => DAY_NAMES[d]).join(", ")}`;
  }

  const names = facilities.map((f) => FACILITY_LABELS[f]).join(", ");
  if (!confirm(`${TYPE_LABELS[type]}\n${names}\n${summary}\n\nAdd this block?`)) return;

  const btn = document.getElementById("saveBlockBtn");
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "Saving…";

  const { data: inserted, error } = await supabaseClient.from("blocks").insert(rows).select();
  btn.disabled = false;
  btn.textContent = originalText;

  if (error) return showFormError(`Couldn't save: ${error.message}`);

  await writeAudit("create_block", "blocks", groupId, {
    block_type: type, facilities, summary, count: inserted?.length || rows.length,
  });

  form.reset();
  applyTypeRules("");
  document.getElementById("fieldsMaintenance").hidden = true;
  document.getElementById("fieldsClosure").hidden = true;
  document.getElementById("fieldsMembers").hidden = true;
  buildDayOfWeekChecks();

  await Promise.all([loadBlocks(), loadGrid()]);
  document.querySelector('[data-tab="rules"]').click();
}

/* ------------------------------------------------------------------ *
 * All blocks
 * ------------------------------------------------------------------ */

async function loadBlocks() {
  const listEl = document.getElementById("blockList");
  const { data, error } = await supabaseClient
    .from("blocks")
    .select("*, block_exceptions(id, exception_date, start_time, end_time)")
    .eq("active", true)
    .order("block_type", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    listEl.innerHTML = `<p class="muted center" style="padding:40px;">Couldn't load blocks: ${escapeHtml(error.message)}</p>`;
    return;
  }

  allBlocks = data || [];
  renderBlocks();
}

// Rows sharing a group_id came from one submission across several facilities,
// so they're shown (and removed) as one entry rather than six near-identical
// cards.
function groupBlocks(blocks) {
  const groups = new Map();
  blocks.forEach((b) => {
    if (!groups.has(b.group_id)) groups.set(b.group_id, { ...b, ids: [], facilities: [], exceptionCount: 0 });
    const g = groups.get(b.group_id);
    g.ids.push(b.id);
    g.facilities.push(b.facility_id);
    g.exceptionCount += (b.block_exceptions || []).filter(isUpcoming).length;
  });
  return Array.from(groups.values());
}

function isUpcoming(ex) {
  return ex.exception_date >= todayIso();
}

function renderBlocks() {
  const listEl = document.getElementById("blockList");
  const groups = groupBlocks(
    blockFilter === "all" ? allBlocks : allBlocks.filter((b) => b.block_type === blockFilter)
  );

  if (!groups.length) {
    listEl.innerHTML = `<p class="muted center" style="padding:40px;">No blocks here yet.</p>`;
    return;
  }

  listEl.innerHTML = groups.map((g) => `
    <div class="enquiry-card">
      <div class="enquiry-card-main">
        <div class="block-card-top">
          <span class="type-chip ${escapeHtml(g.block_type)}">${escapeHtml(TYPE_LABELS[g.block_type] || g.block_type)}</span>
          <span class="block-when">${escapeHtml(describeWhen(g))}</span>
        </div>
        <p class="block-facilities">${escapeHtml(g.facilities.map((f) => FACILITY_LABELS[f] || f).join(" · "))}</p>
        ${g.reason ? `<p class="block-reason">${escapeHtml(g.reason)}</p>` : ""}
        ${g.exceptionCount ? `<p class="block-exceptions">${g.exceptionCount} upcoming hour${g.exceptionCount === 1 ? "" : "s"} opened for booking</p>` : ""}
      </div>
      <div class="enquiry-card-actions">
        <button class="btn btn-outline-dark btn-sm" data-remove="${escapeHtml(g.group_id)}">🗑 Remove</button>
      </div>
    </div>`).join("");

  listEl.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removeBlockGroup(btn.dataset.remove));
  });
}

function describeWhen(g) {
  if (g.is_recurring) {
    const days = (g.days_of_week || []).length === 7
      ? "every day"
      : (g.days_of_week || []).map((d) => DAY_NAMES[d]).join(", ");
    const until = g.valid_to ? ` · until ${formatDate(g.valid_to)}` : "";
    return `${g.start_time?.slice(0, 5)}–${g.end_time?.slice(0, 5)} · ${days}${until}`;
  }
  return `${formatDateTime(g.start_at)} to ${formatDateTime(g.end_at)}`;
}

async function removeBlockGroup(groupId) {
  const group = groupBlocks(allBlocks).find((g) => g.group_id === groupId);
  if (!group) return;
  const names = group.facilities.map((f) => FACILITY_LABELS[f] || f).join(", ");

  if (!confirm(`Remove this block?\n\n${TYPE_LABELS[group.block_type]}\n${names}\n${describeWhen(group)}\n\nThose times go back to being bookable by the public.`)) return;

  const { error } = await supabaseClient.from("blocks").delete().eq("group_id", groupId);
  if (error) { alert(`Couldn't remove: ${error.message}`); return; }

  await writeAudit("delete_block", "blocks", groupId, {
    block_type: group.block_type, facilities: group.facilities,
  });

  await Promise.all([loadBlocks(), loadGrid()]);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function formatDate(value) {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

async function writeAudit(action, table, recordId, details) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  await supabaseClient.from("audit_log").insert({
    actor_id: user.id, action, table_name: table, record_id: recordId, details,
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
