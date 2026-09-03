// PeedsPark Admin — shared auth logic (login form + session/role guard).
// Loaded on every admin-v2 page after js/supabase-client.js.

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");
  if (loginForm) setupLoginForm(loginForm);

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await supabaseClient?.auth.signOut();
      window.location.href = "index.html";
    });
  }
});

function setupLoginForm(form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("loginError");
    errorEl.hidden = true;

    if (!supabaseClient) {
      errorEl.textContent = "Login system isn't connected yet.";
      errorEl.hidden = false;
      return;
    }

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in...";

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    submitBtn.disabled = false;
    submitBtn.textContent = "Log In";

    if (error) {
      errorEl.textContent = "Incorrect email or password.";
      errorEl.hidden = false;
      return;
    }

    // Confirm this authenticated user is actually active staff before letting
    // them into the dashboard — a valid login alone isn't enough (see RLS:
    // staff_select_own policy on the `staff` table backs this check up server-side too).
    const { data: staffRow } = await supabaseClient
      .from("staff")
      .select("*")
      .eq("id", data.user.id)
      .eq("active", true)
      .maybeSingle();

    if (!staffRow) {
      await supabaseClient.auth.signOut();
      errorEl.textContent = "This account isn't set up as active PeedsPark staff.";
      errorEl.hidden = false;
      return;
    }

    window.location.href = "dashboard.html";
  });
}

// Shared payment-entry modal, used everywhere a booking gets approved or
// an existing payment gets topped up (Bookings, Pool & Badminton, Manager
// Feed). Returns a Promise resolving to { total_amount, amount_paid, payment_status }
// or null if the manager cancels — they can just re-click the button to try again.
//   allowPartial: false for Pool/Badminton (must be paid in full — DB-enforced
//     backstop too), true for Hall/Lawn/AC/Non-AC (50% advance allowed).
//   previousTotal/previousPaid: pre-fill when topping up an existing booking's payment.
function promptPaymentEntry({ allowPartial, previousTotal, previousPaid, label }) {
  return new Promise((resolve) => {
    ensurePaymentModalStyles();

    const backdrop = document.createElement("div");
    backdrop.className = "pp-modal-backdrop";
    backdrop.innerHTML = `
      <div class="pp-modal-card" role="dialog" aria-modal="true" aria-labelledby="ppModalTitle">
        <h3 id="ppModalTitle" class="pp-modal-title">${escapeHtmlLocal(label || "Enter payment")}</h3>
        <p class="pp-modal-error" hidden></p>
        <label class="pp-modal-field">
          <span>Total amount for this booking (₹)</span>
          <input type="number" min="0" step="1" id="ppTotalInput" inputmode="decimal">
        </label>
        <label class="pp-modal-field">
          <span>Amount paid so far (₹)</span>
          <input type="number" min="0" step="1" id="ppPaidInput" inputmode="decimal">
        </label>
        <p class="pp-modal-partial-note"${allowPartial ? " hidden" : ""}>This facility must be paid in full before it can be approved — partial payment isn't allowed here.</p>
        <div class="pp-modal-actions">
          <button type="button" class="btn btn-outline-dark pp-modal-cancel">Cancel</button>
          <button type="button" class="btn btn-primary pp-modal-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const totalInput = backdrop.querySelector("#ppTotalInput");
    const paidInput = backdrop.querySelector("#ppPaidInput");
    const errorEl = backdrop.querySelector(".pp-modal-error");
    const saveBtn = backdrop.querySelector(".pp-modal-save");
    const cancelBtn = backdrop.querySelector(".pp-modal-cancel");

    totalInput.value = previousTotal != null ? String(previousTotal) : "";
    paidInput.value = previousPaid != null ? String(previousPaid) : "";

    function cleanup(result) {
      document.removeEventListener("keydown", onKeydown);
      backdrop.remove();
      resolve(result);
    }

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }

    function submit() {
      errorEl.hidden = true;
      const total = Number(totalInput.value);
      if (totalInput.value.trim() === "" || !Number.isFinite(total) || total < 0) {
        showError("Enter a valid total amount (0 or more).");
        totalInput.focus();
        return;
      }
      const paid = Number(paidInput.value);
      if (paidInput.value.trim() === "" || !Number.isFinite(paid) || paid < 0) {
        showError("Enter a valid amount paid (0 or more).");
        paidInput.focus();
        return;
      }
      if (paid > total) {
        showError("Amount paid can't be more than the total amount.");
        paidInput.focus();
        return;
      }

      let payment_status;
      if (paid >= total) payment_status = "received"; // covers a ₹0/₹0 complimentary booking too
      else if (paid > 0) payment_status = "partial";
      else payment_status = "unpaid";

      if (payment_status === "partial" && !allowPartial) {
        showError("This facility must be paid in full before it can be approved — partial payment isn't allowed here.");
        return;
      }

      cleanup({ total_amount: total, amount_paid: paid, payment_status });
    }

    function onKeydown(e) {
      if (e.key === "Escape") cleanup(null);
      if (e.key === "Enter") submit();
    }

    saveBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", () => cleanup(null));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) cleanup(null);
    });
    document.addEventListener("keydown", onKeydown);

    totalInput.focus();
  });
}

function escapeHtmlLocal(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function ensurePaymentModalStyles() {
  if (document.getElementById("ppModalStyles")) return;
  const style = document.createElement("style");
  style.id = "ppModalStyles";
  style.textContent = `
    .pp-modal-backdrop {
      position: fixed; inset: 0; background: rgba(20, 20, 30, 0.55);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999; padding: 16px;
    }
    .pp-modal-card {
      background: #fff; border-radius: 14px; padding: 24px;
      width: 100%; max-width: 420px; box-shadow: 0 12px 40px rgba(0,0,0,0.3);
      font-weight: 700; color: #1a1a2e;
    }
    .pp-modal-title { margin: 0 0 16px; font-size: 1.15rem; font-weight: 800; color: #1a1a2e; }
    .pp-modal-error {
      background: #ffe3e3; color: #b3261e; border-radius: 8px;
      padding: 8px 12px; margin: 0 0 14px; font-weight: 700; font-size: 0.9rem;
    }
    .pp-modal-field { display: block; margin-bottom: 14px; font-weight: 700; color: #1a1a2e; }
    .pp-modal-field span { display: block; margin-bottom: 6px; font-weight: 700; color: #1a1a2e; }
    .pp-modal-field input {
      width: 100%; padding: 10px 12px; font-size: 1rem; font-weight: 700;
      border: 2px solid #ccc; border-radius: 8px; color: #1a1a2e; box-sizing: border-box;
    }
    .pp-modal-field input:focus { outline: none; border-color: #2b6cb0; }
    .pp-modal-partial-note {
      background: #fff4d6; color: #7a5200; border-radius: 8px;
      padding: 8px 12px; margin: 0 0 14px; font-weight: 700; font-size: 0.85rem;
    }
    .pp-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }
  `;
  document.head.appendChild(style);
}

// Call from any protected admin-v2 page. Redirects to login if not authenticated,
// shows the "not authorised" panel if authenticated but not active staff,
// otherwise resolves with { user, staff }.
async function requireStaffSession() {
  if (!supabaseClient) {
    document.getElementById("notAuthorised")?.removeAttribute("hidden");
    return null;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "index.html";
    return null;
  }

  const { data: staffRow } = await supabaseClient
    .from("staff")
    .select("*")
    .eq("id", session.user.id)
    .eq("active", true)
    .maybeSingle();

  if (!staffRow) {
    document.getElementById("notAuthorised")?.removeAttribute("hidden");
    return null;
  }

  return { user: session.user, staff: staffRow };
}
