// PeedsPark — Gallery lightbox (click-to-enlarge)
//
// Vanilla JS, no library. Reads the existing figure/img/figcaption markup in
// #gallery .gallery-grid — nothing else needs to change to add a photo,
// the lightbox just picks it up automatically.

document.addEventListener("DOMContentLoaded", () => {
  const grid = document.querySelector(".gallery-grid");
  if (!grid) return;

  const figures = Array.from(grid.querySelectorAll("figure"));
  if (!figures.length) return;

  const photos = figures.map((fig) => {
    const img = fig.querySelector("img");
    const caption = fig.querySelector("figcaption");
    return { src: img ? img.src : "", alt: img ? img.alt : "", caption: caption ? caption.textContent : "" };
  });

  // Build the overlay once, hidden by default (sitewide [hidden] rule wins).
  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay";
  overlay.setAttribute("hidden", "");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <button type="button" class="lightbox-close" aria-label="Close">&times;</button>
    <button type="button" class="lightbox-prev" aria-label="Previous photo">&#8249;</button>
    <button type="button" class="lightbox-next" aria-label="Next photo">&#8250;</button>
    <div class="lightbox-content">
      <img alt="">
      <p class="lightbox-caption"></p>
    </div>
  `;
  document.body.appendChild(overlay);

  const imgEl = overlay.querySelector("img");
  const captionEl = overlay.querySelector(".lightbox-caption");
  let currentIndex = 0;

  function show(index) {
    currentIndex = (index + photos.length) % photos.length;
    const photo = photos[currentIndex];
    imgEl.src = photo.src;
    imgEl.alt = photo.alt;
    captionEl.textContent = photo.caption;
  }

  function open(index) {
    show(index);
    overlay.removeAttribute("hidden");
    document.body.classList.add("lightbox-open");
  }

  function close() {
    overlay.setAttribute("hidden", "");
    document.body.classList.remove("lightbox-open");
    imgEl.src = ""; // stop loading/decoding once hidden
  }

  figures.forEach((fig, index) => {
    fig.setAttribute("tabindex", "0");
    fig.setAttribute("role", "button");
    const caption = fig.querySelector("figcaption");
    fig.setAttribute("aria-label", `View larger photo: ${caption ? caption.textContent : "gallery photo"}`);
    fig.addEventListener("click", () => open(index));
    fig.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open(index);
      }
    });
  });

  overlay.querySelector(".lightbox-close").addEventListener("click", close);
  overlay.querySelector(".lightbox-prev").addEventListener("click", () => show(currentIndex - 1));
  overlay.querySelector(".lightbox-next").addEventListener("click", () => show(currentIndex + 1));

  // Click the dark backdrop (not the image/content) to close.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  document.addEventListener("keydown", (e) => {
    if (overlay.hasAttribute("hidden")) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") show(currentIndex - 1);
    if (e.key === "ArrowRight") show(currentIndex + 1);
  });
});
