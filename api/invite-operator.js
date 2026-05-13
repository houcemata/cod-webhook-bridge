import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const getAppUrl = (req) => {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const host = req.headers.host;
  return host ? `https://${host}` : "";
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Supabase server keys are not configured" });
  }

  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!accessToken) {
    return res.status(401).json({ error: "Missing admin session" });
  }

  const { email, name } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanName = String(name || "").trim();
  if (!cleanEmail || !cleanName) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return res.status(401).json({ error: "Invalid admin session" });
  }

  const { data: roleData, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .eq("role", "admin")
    .single();

  if (roleError || roleData?.role !== "admin") {
    return res.status(403).json({ error: "Only admins can invite operators" });
  }

  const redirectTo = `${getAppUrl(req)}/operator.html`;
  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(cleanEmail, {
    data: { name: cleanName, role: "operator" },
    redirectTo,
  });

  if (inviteError) {
    return res.status(400).json({ error: inviteError.message });
  }

  const invitedUser = inviteData?.user;
  if (!invitedUser?.id) {
    return res.status(500).json({ error: "Invite was sent, but no user id was returned" });
  }

  const { data: existingRole } = await admin
    .from("user_roles")
    .select("id")
    .eq("user_id", invitedUser.id)
    .maybeSingle();

  const rolePayload = { user_id: invitedUser.id, email: cleanEmail, role: "operator", name: cleanName };
  const roleQuery = existingRole?.id
    ? admin.from("user_roles").update(rolePayload).eq("id", existingRole.id)
    : admin.from("user_roles").insert(rolePayload);
  const { error: saveRoleError } = await roleQuery;

  if (saveRoleError) {
    return res.status(500).json({ error: saveRoleError.message });
  }

  return res.status(200).json({ ok: true, user_id: invitedUser.id });
}
