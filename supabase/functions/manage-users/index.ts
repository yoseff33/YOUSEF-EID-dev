import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) throw new Error("missing_token");

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) throw new Error("invalid_token");

    const { data: caller, error: callerError } = await admin
      .from("profiles")
      .select("role,is_active")
      .eq("id", authData.user.id)
      .single();
    if (callerError || caller?.role !== "admin" || !caller?.is_active) throw new Error("permission_denied");

    const body = await req.json();
    const action = String(body.action || "");

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const fullName = String(body.fullName || "").trim();
      const role = ["admin", "sales", "inventory"].includes(body.role) ? body.role : "sales";
      if (!email || password.length < 8 || !fullName) throw new Error("invalid_user_data");

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, role },
      });
      if (error) throw error;

      const { error: profileError } = await admin.from("profiles").upsert({
        id: data.user.id,
        email,
        full_name: fullName,
        role,
        is_active: true,
      });
      if (profileError) throw profileError;
      return json({ ok: true, userId: data.user.id });
    }

    if (action === "update") {
      const userId = String(body.userId || "");
      const fullName = String(body.fullName || "").trim();
      const role = ["admin", "sales", "inventory"].includes(body.role) ? body.role : "sales";
      const isActive = Boolean(body.isActive);
      if (!userId || !fullName) throw new Error("invalid_user_data");
      if (userId === authData.user.id && (!isActive || role !== "admin")) throw new Error("cannot_remove_own_admin_access");

      const { error } = await admin.from("profiles").update({
        full_name: fullName,
        role,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
      if (error) throw error;
      await admin.auth.admin.updateUserById(userId, { user_metadata: { full_name: fullName, role } });
      return json({ ok: true });
    }

    throw new Error("unknown_action");
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
