// PeedsPark — shared header behaviour, included on every page.
// Mobile hamburger toggle + auto-highlight the current page's nav tab, so
// each page doesn't need to hand-write which link gets class="active".

document.addEventListener("DOMContentLoaded", () => {
  const focusEnquiryName = () => {
    if (!["#name", "#enquire"].includes(location.hash)) return;
    const name = document.querySelector("#enquiryForm #name");
    if (!name) return;
    name.focus({ preventScroll: true });
    name.scrollIntoView({ block: "start", behavior: "instant" });
  };
  document.querySelectorAll('a[href="#name"]').forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      document.getElementById("mainNav")?.classList.remove("open");
      history.pushState(null, "", "#name");
      focusEnquiryName();
    });
  });
  window.addEventListener("hashchange", focusEnquiryName);
  window.addEventListener("load", focusEnquiryName, { once: true });
  focusEnquiryName();
  const navToggle = document.getElementById("navToggle");
  const mainNav = document.getElementById("mainNav");
  if (navToggle && mainNav) {
    navToggle.addEventListener("click", () => mainNav.classList.toggle("open"));
  }

  if (mainNav) {
    // Current page's file name (e.g. "pool.html"), or "index.html" for "/".
    let current = window.location.pathname.split("/").pop();
    if (!current) current = "index.html";

    const links = Array.from(mainNav.querySelectorAll("a"));
    const matched = links.find((link) => (link.getAttribute("href") || "").split("#")[0] === current);

    // Only reassign "active" when a nav tab actually points at this exact
    // page. A facility sub-page like ac-hall.html has no nav link of its
    // own — it's reached via the Club House tab — so its markup hardcodes
    // class="active" on that tab; leave it alone rather than clearing it.
    if (matched) {
      links.forEach((link) => link.classList.remove("active"));
      matched.classList.add("active");
    }
  }
});
