// PeedsPark Admin — the "set a new password" step of the forgot-password flow.
// Reached only via the recovery link Supabase emails (see admin-auth.js's
// setupForgotPasswordLink, which calls resetPasswordForEmail with this page
// as the redirect target). Supabase's own JS client detects the recovery
// token in the URL and fires a PASSWORD_RECOVERY auth event — only then do we
// reveal the form, so a plain visit to this page with no valid token can't
// set anyone's password.

document.addEventListener("DOMContentLoaded", () => {
  if (!supabaseClient) {
    showInvalid();
    return;
  }

  let recoveryConfirmed = false;

  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      recoveryConfirmed = true;
      document.getElementById("resetPending").hidden = true;
      document.getElementById("resetForm").hidden = false;
    }
  });

  // If the recovery redirect already landed before this listener attached
  // (e.g. the browser fired the event on page load, before DOMContentLoaded's
  // own handler ran), fall back to checking for a live session.
  setTimeout(async () => {
    if (recoveryConfirmed) return;
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      recoveryConfirmed = true;
      document.getElementById("resetPending").hidden = true;
      document.getElementById("resetForm").hidden = false;
    } else {
      showInvalid();
    }
  }, 2500);

  document.getElementById("resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("resetError");
    errorEl.hidden = true;

    const password = document.getElementById("newPassword").value;
    const confirm = document.getElementById("confirmPassword").value;

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
    submitBtn.textContent = "Set Password";

    if (error) {
      errorEl.textContent = "Couldn't set the new password: " + error.message;
      errorEl.hidden = false;
      return;
    }

    await supabaseClient.auth.signOut();
    document.getElementById("resetForm").hidden = true;
    document.getElementById("resetSuccess").hidden = false;
  });
});

function showInvalid() {
  document.getElementById("resetPending").hidden = true;
  document.getElementById("resetInvalid").hidden = false;
}
