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

// Shared payment-entry prompt, used everywhere a booking gets approved or
// an existing payment gets topped up (Bookings, Pool & Badminton, Manager
// Feed). Returns { total_amount, amount_paid, payment_status } or null if
// the manager backs out or enters something invalid — they can just
// re-click the button to try again.
//   allowPartial: false for Pool/Badminton (must be paid in full — DB-enforced
//     backstop too), true for Hall/Lawn/AC/Non-AC (50% advance allowed).
//   previousTotal/previousPaid: pre-fill when topping up an existing booking's payment.
function promptPaymentEntry({ allowPartial, previousTotal, previousPaid, label }) {
  const totalStr = prompt(
    `${label} — total amount for this booking (₹):`,
    previousTotal != null ? String(previousTotal) : ""
  );
  if (totalStr === null) return null;
  const total = Number(totalStr);
  if (!Number.isFinite(total) || total < 0) {
    alert("Enter a valid total amount (0 or more).");
    return null;
  }

  const paidStr = prompt(
    `${label} — amount paid so far (₹), out of ₹${total}:`,
    previousPaid != null ? String(previousPaid) : ""
  );
  if (paidStr === null) return null;
  const paid = Number(paidStr);
  if (!Number.isFinite(paid) || paid < 0) {
    alert("Enter a valid amount paid (0 or more).");
    return null;
  }
  if (paid > total) {
    alert("Amount paid can't be more than the total amount.");
    return null;
  }

  let payment_status;
  if (paid >= total) payment_status = "received"; // covers a ₹0/₹0 complimentary booking too
  else if (paid > 0) payment_status = "partial";
  else payment_status = "unpaid";

  if (payment_status === "partial" && !allowPartial) {
    alert("This facility must be paid in full before it can be approved — partial payment isn't allowed here.");
    return null;
  }

  return { total_amount: total, amount_paid: paid, payment_status };
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
