// PeedsPark Admin — shared auth logic (login form + session/role guard).
// Loaded on every admin-v2 page after js/supabase-client.js.

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");
  if (loginForm) setupLoginForm(loginForm);

  const forgotLink = document.getElementById("forgotPasswordLink");
  if (forgotLink) setupForgotPasswordLink(forgotLink);

  const changePasswordBtn = document.getElementById("changePasswordBtn");
  if (changePasswordBtn) {
    changePasswordBtn.addEventListener("click", () => openChangePasswordModal());
  }

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

// "Forgot password?" on the login page — toggles the inline email form and,
// on submit, asks Supabase to email a recovery link. Deliberately shows the
// same message on success or failure (Supabase's own resetPasswordForEmail
// does the same) so this can't be used to check which emails have accounts.
function setupForgotPasswordLink(link) {
  const form = document.getElementById("forgotForm");
  if (!form) return;

  link.addEventListener("click", (e) => {
    e.preventDefault();
    form.hidden = !form.hidden;
    if (!form.hidden) document.getElementById("forgotEmail")?.focus();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const messageEl = document.getElementById("forgotMessage");
    messageEl.hidden = true;

    if (!supabaseClient) {
      messageEl.textContent = "Login system isn't connected yet.";
      messageEl.hidden = false;
      return;
    }

    const email = document.getElementById("forgotEmail").value.trim();
    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    // Same folder, same origin — swap index.html for reset-password.html.
    const redirectTo = window.location.href.replace(/index\.html.*$/, "reset-password.html");
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });

    submitBtn.disabled = false;
    submitBtn.textContent = "Send Reset Link";
    messageEl.textContent = error
      ? "Something went wrong sending the reset email — try again in a moment."
      : "If that email has a staff account, a reset link is on its way — check your inbox (and spam folder). The link expires after a while, so use it soon.";
    messageEl.hidden = false;
  });
}

// "Change Password" button in the header of every logged-in admin-v2 page.
// Self-contained (injects its own markup + styles) so no page's HTML needed
// touching beyond the one button — works the same on every page that includes
// this script. Uses supabase.auth.updateUser, which only works for the
// currently signed-in user (no separate "current password" needed —
// being logged in already proves that).
let _changePasswordModalBuilt = false;

function openChangePasswordModal() {
  if (!_changePasswordModalBuilt) buildChangePasswordModal();
  const backdrop = document.getElementById("changePasswordBackdrop");
  document.getElementById("cpNewPassword").value = "";
  document.getElementById("cpConfirmPassword").value = "";
  document.getElementById("cpError").hidden = true;
  backdrop.hidden = false;
  document.getElementById("cpNewPassword").focus();
}

function buildChangePasswordModal() {
  _changePasswordModalBuilt = true;

  const style = document.createElement("style");
  style.textContent = `
    #changePasswordBackdrop {
      position: fixed; inset: 0; background: rgba(27,42,74,0.55); z-index: 200;
      display: flex; align-items: flex-start; justify-content: center; padding: 30px 16px; overflow-y: auto;
    }
    #changePasswordBackdrop .cp-card {
      background: var(--white, #fff); border-radius: 14px; box-shadow: 0 8px 24px rgba(27,42,74,0.2);
      padding: 28px; max-width: 420px; width: 100%; margin: auto;
    }
    #changePasswordBackdrop .cp-card h3 { margin-top: 0; }
    #changePasswordBackdrop .cp-card label { display: block; font-weight: 700; font-size: 0.85rem; color: var(--navy, #1B2A4A); margin: 14px 0 6px; }
    #changePasswordBackdrop .cp-card input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 2px solid #E4E0D8; font: inherit; box-sizing: border-box; }
    #changePasswordBackdrop .cp-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
  `;
  document.head.appendChild(style);

  const backdrop = document.createElement("div");
  backdrop.id = "changePasswordBackdrop";
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <div class="cp-card">
      <h3>Change Password</h3>
      <form id="changePasswordForm">
        <label>New password
          <input type="password" id="cpNewPassword" required minlength="8" autocomplete="new-password">
        </label>
        <label>Confirm new password
          <input type="password" id="cpConfirmPassword" required minlength="8" autocomplete="new-password">
        </label>
        <p id="cpError" class="login-error" hidden></p>
        <div class="cp-actions">
          <button type="button" id="cpCancelBtn" class="btn btn-outline-dark">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Password</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.hidden = true;
  });
  document.getElementById("cpCancelBtn").addEventListener("click", () => {
    backdrop.hidden = true;
  });

  document.getElementById("changePasswordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("cpError");
    errorEl.hidden = true;

    const password = document.getElementById("cpNewPassword").value;
    const confirm = document.getElementById("cpConfirmPassword").value;

    if (password.length < 8) {
      errorEl.textContent = "Password must be at least 8 characters.";
      errorEl.hidden = false;
      return;
    }
    if (password !== confirm) {
      errorEl.textContent = "Passwords don't match.";
      errorEl.hidden = false;
      return;
    }

    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";

    const { error } = await supabaseClient.auth.updateUser({ password });

    submitBtn.disabled = false;
    submitBtn.textContent = "Save Password";

    if (error) {
      errorEl.textContent = "Couldn't update your password: " + error.message;
      errorEl.hidden = false;
      return;
    }

    backdrop.hidden = true;
    alert("Password updated.");
  });
}
