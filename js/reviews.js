// PeedsPark — homepage Reviews section: renders approved reviews and
// handles the "Write a Review" submission form.
//
// Wrapped in an IIFE deliberately: js/app.js (loaded just before this file
// on index.html) already declares top-level `const MIN_FILL_TIME_MS` and
// `const formRenderedAt` in the page's shared global scope — re-declaring
// either of those here (outside an IIFE) would be a page-breaking
// SyntaxError, not a harmless shadow, since both scripts share one global
// scope. Everything this file needs from app.js (isValidPhone,
// setupPhoneField, showPhoneError, showFormError, clearFormError,
// isSupabaseReady) is a plain `function` declaration, which IS safe to
// call across script tags — those are reused as-is below, not redefined.
(function () {
  const MIN_FILL_TIME_MS = 3000;
  const formRenderedAt = Date.now();

  const FACILITY_LABELS = {
    ac_hall: "AC Hall",
    non_ac_hall: "Non-AC Hall",
    lawn: "Party Lawn",
    pool: "Swimming Pool",
    badminton: "Badminton",
  };

  document.addEventListener("DOMContentLoaded", () => {
    loadApprovedReviews();
    setupStarPicker();
    wireReviewFormToggle();
    setupPhoneField("reviewPhone", "reviewPhoneNote"); // reused from js/app.js
    setupReviewForm();
  });

  async function loadApprovedReviews() {
    const grid = document.getElementById("reviewsGrid");
    const empty = document.getElementById("reviewsEmpty");
    if (!grid) return;

    if (!supabaseClient) {
      if (empty) empty.hidden = false;
      return;
    }

    const { data, error } = await supabaseClient
      .from("reviews")
      .select("customer_name, rating, review_text, facility_group, is_featured, created_at")
      .eq("status", "approved")
      .order("is_featured", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(9);

    if (error) {
      console.error(error);
      if (empty) empty.hidden = false;
      return;
    }

    if (!data || data.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }

    grid.innerHTML = data.map(reviewCardHtml).join("");
  }

  function reviewCardHtml(r) {
    const rating = Math.max(0, Math.min(5, Number(r.rating) || 0));
    const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
    const facilityLabel = FACILITY_LABELS[r.facility_group] || "PeedsPark visit";
    // First name only on the public card — a small privacy default (full
    // name is still visible to staff in the admin moderation queue).
    const firstName = (r.customer_name || "").trim().split(/\s+/)[0] || "Guest";
    return `
      <div class="review-card${r.is_featured ? " featured" : ""}">
        <div class="review-stars" aria-label="${rating} out of 5 stars">${stars}</div>
        <p class="review-text">"${escapeHtml(r.review_text)}"</p>
        <div class="review-meta"><span>${escapeHtml(firstName)}</span><span>${escapeHtml(facilityLabel)}</span></div>
      </div>`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // --- Star picker ---
  function setupStarPicker() {
    const picker = document.getElementById("starPicker");
    const ratingInput = document.getElementById("reviewRating");
    if (!picker || !ratingInput) return;

    const buttons = Array.from(picker.querySelectorAll(".star-btn"));

    function paint(upTo) {
      buttons.forEach((btn) => {
        btn.classList.toggle("selected", Number(btn.dataset.star) <= upTo);
      });
    }

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        ratingInput.value = btn.dataset.star;
        paint(Number(btn.dataset.star));
        const note = document.getElementById("reviewRatingNote");
        if (note) {
          note.hidden = true;
          note.textContent = "";
        }
      });
      btn.addEventListener("mouseenter", () => paint(Number(btn.dataset.star)));
    });
    picker.addEventListener("mouseleave", () => paint(Number(ratingInput.value) || 0));
  }

  // --- Show/hide the form ---
  function wireReviewFormToggle() {
    const btn = document.getElementById("showReviewFormBtn");
    const form = document.getElementById("reviewForm");
    if (!btn || !form) return;
    btn.addEventListener("click", () => {
      form.hidden = false;
      btn.hidden = true;
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // --- Submit handler ---
  function setupReviewForm() {
    const form = document.getElementById("reviewForm");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearFormError("reviewFormError"); // reused from js/app.js

      // Honeypot: real visitors never fill this hidden field in.
      const hp = document.getElementById("reviewHpField");
      if (hp && hp.value.trim() !== "") {
        return; // silently drop — looks successful to a bot, does nothing
      }

      if (Date.now() - formRenderedAt < MIN_FILL_TIME_MS) {
        showFormError("reviewFormError", "Please take a moment to fill in the form.");
        return;
      }

      const data = Object.fromEntries(new FormData(form).entries());

      if (!isValidPhone(data.phone)) { // reused from js/app.js
        showPhoneError("reviewPhoneNote", "reviewPhone"); // reused from js/app.js
        return;
      }
      if (!data.customer_name || data.customer_name.trim().length < 2) {
        showFormError("reviewFormError", "Please enter your name.");
        return;
      }
      const rating = Number(data.rating);
      if (!rating || rating < 1 || rating > 5) {
        const note = document.getElementById("reviewRatingNote");
        if (note) {
          note.textContent = "Please pick a star rating.";
          note.hidden = false;
        }
        return;
      }
      if (!data.review_text || data.review_text.trim().length < 10) {
        showFormError("reviewFormError", "Please share a few words about your experience (at least 10 characters).");
        return;
      }

      if (!isSupabaseReady("reviewFormError")) return; // reused from js/app.js

      const submitBtn = document.getElementById("reviewSubmitBtn");
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending...";

      const { error } = await supabaseClient.rpc("submit_review", {
        p_customer_name: data.customer_name.trim(),
        p_phone: data.phone.trim(),
        p_rating: rating,
        p_review_text: data.review_text.trim(),
        p_facility_group: data.facility_group || null,
      });

      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Review";

      if (error) {
        console.error(error);
        showFormError(
          "reviewFormError",
          error.message?.includes("Too many submissions")
            ? "You've submitted a few reviews recently — please wait a bit before trying again."
            : "Something went wrong submitting your review. Please try again in a moment."
        );
        return;
      }

      const panel = document.getElementById("reviewConfirmation");
      if (panel) {
        panel.innerHTML = `
          <div style="text-align:center;">
            <div style="font-size:40px;margin-bottom:10px;">✅</div>
            <h3 style="margin:0 0 8px;">Thank you!</h3>
            <p style="font-weight:700;margin:0;">We read every review before it goes live — yours will appear here once approved.</p>
          </div>`;
        panel.hidden = false;
      }
      form.hidden = true;
    });
  }
})();
