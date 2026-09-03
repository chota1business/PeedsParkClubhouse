// PeedsPark Admin — Google Calendar Feed (Phase 13, Admin only).
// Lets an Admin generate/copy/revoke their own token(s) for the calendar-feed
// Edge Function. The feed URL itself (with ?token=...) is the only thing
// gating access to the ICS feed, since Google's calendar-subscribe fetcher
// can't send a login session — see supabase/functions/calendar-feed/index.ts
// and supabase/migrations/020_admin_calendar_feed.sql for the full reasoning.

const CALENDAR_FEED_BASE_URL = "https://cvqvxclvizpltnflbdlh.supabase.co/functions/v1/calendar-feed";

let currentStaff = null;

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
  await loadActiveLinks();

  document.getElementById("generateBtn").addEventListener("click", generateLink);
  document.getElementById("copyNewBtn").addEventListener("click", () => copyText(document.getElementById("newLinkUrl").textContent, "copiedNote"));
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
  });
});

async function loadActiveLinks() {
  const listEl = document.getElementById("activeLinksList");
  const { data, error } = await supabaseClient
    .from("calendar_feed_tokens")
    .select("id, token, created_at, last_accessed_at")
    .eq("staff_id", currentStaff.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    listEl.innerHTML = `<p class="muted" style="padding:10px 0;">Couldn't load your links: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!data || !data.length) {
    listEl.innerHTML = `<p class="muted" style="padding:10px 0;">No active links yet — generate one above.</p>`;
    return;
  }

  listEl.innerHTML = data.map((t) => {
    const url = `${CALENDAR_FEED_BASE_URL}?token=${t.token}`;
    const created = new Date(t.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    const lastAccessed = t.last_accessed_at
      ? new Date(t.last_accessed_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
      : "Never fetched yet";
    return `
      <div class="enquiry-card" style="margin-bottom:12px;">
        <p style="word-break:break-all; background:#F4F4F4; padding:8px 10px; border-radius:8px; font-family:monospace; font-size:0.82rem; margin:0 0 10px;">${escapeHtml(url)}</p>
        <p class="muted" style="font-size:0.82rem; margin:0 0 10px;">Created ${created} · Last fetched by Google: ${lastAccessed}</p>
        <button class="btn btn-outline-dark copy-link-btn" data-url="${escapeHtml(url)}" style="margin-right:10px;">Copy link</button>
        <button class="btn btn-outline-dark revoke-link-btn" data-id="${t.id}" style="border-color:#c0392b; color:#c0392b;">Revoke</button>
      </div>`;
  }).join("");

  listEl.querySelectorAll(".copy-link-btn").forEach((btn) => {
    btn.addEventListener("click", () => copyText(btn.dataset.url));
  });
  listEl.querySelectorAll(".revoke-link-btn").forEach((btn) => {
    btn.addEventListener("click", () => revokeLink(btn.dataset.id));
  });
}

async function generateLink() {
  const btn = document.getElementById("generateBtn");
  const errEl = document.getElementById("generateError");
  errEl.hidden = true;
  btn.disabled = true;
  btn.textContent = "Generating…";

  const { data, error } = await supabaseClient.rpc("create_calendar_feed_token");

  btn.disabled = false;
  btn.textContent = "+ Generate new link";

  if (error) {
    errEl.textContent = "Couldn't generate a link: " + error.message;
    errEl.hidden = false;
    return;
  }

  const url = `${CALENDAR_FEED_BASE_URL}?token=${data}`;
  document.getElementById("newLinkUrl").textContent = url;
  document.getElementById("newLinkBanner").hidden = false;
  document.getElementById("newLinkBanner").scrollIntoView({ behavior: "smooth", block: "center" });
  await loadActiveLinks();
}

async function revokeLink(id) {
  if (!confirm("Revoke this calendar link? Google Calendar will stop getting updates from it right away, and this can't be undone — you'd need to generate a new link.")) {
    return;
  }
  const { error } = await supabaseClient.rpc("revoke_calendar_feed_token", { p_id: id });
  if (error) {
    alert("Couldn't revoke: " + error.message);
    return;
  }
  document.getElementById("newLinkBanner").hidden = true;
  await loadActiveLinks();
}

function copyText(text, noteId) {
  navigator.clipboard.writeText(text).then(() => {
    const note = document.getElementById(noteId || "copiedNote");
    if (note) {
      note.style.display = "inline";
      setTimeout(() => { note.style.display = "none"; }, 1800);
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
