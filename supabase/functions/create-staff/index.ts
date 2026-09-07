// PeedsPark Admin — create-staff Edge Function.
// Lets an authenticated Admin create a new staff login (Manager or Admin)
// without exposing the service-role key to the browser. Deployed with
// verify_jwt: true, so Supabase already rejects unauthenticated calls before
// this code runs; the function itself re-checks that the caller is active
// staff with role = 'admin' before doing anything.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";

  // Client scoped to the caller's own JWT — used only to confirm who is calling.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !user) return json({ error: "Not authenticated." }, 401);

  // Service-role client — bypasses RLS, used to verify the caller is an
  // active Admin and to perform the privileged create.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: callerStaff } = await adminClient
    .from("staff")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!callerStaff || !callerStaff.active || callerStaff.role !== "admin") {
    return json({ error: "Only an active Admin can create staff accounts." }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const full_name = String(body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = body.phone ? String(body.phone).trim() : null;
  const role = body.role === "admin" ? "admin" : body.role === "manager" ? "manager" : body.role === "pool_manager" ? "pool_manager" : null;
  const password = String(body.password || "");

  if (full_name.length < 2) return json({ error: "Enter the staff member's full name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (!role) return json({ error: "Role must be Admin, Manager or Pool Manager." }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr || !created?.user) {
    const msg = createErr?.message?.includes("already been registered")
      ? "That email is already registered — use a different email."
      : (createErr?.message || "Couldn't create the login.");
    return json({ error: msg }, 400);
  }

  const { data: staffRow, error: staffErr } = await adminClient
    .from("staff")
    .insert({ id: created.user.id, full_name, phone, role, active: true })
    .select()
    .single();

  if (staffErr) {
    // Roll back the auth user so we don't leave an orphaned login with no staff row.
    await adminClient.auth.admin.deleteUser(created.user.id);
    return json({ error: "Couldn't save the staff record: " + staffErr.message }, 400);
  }

  return json({ staff: staffRow });
});
