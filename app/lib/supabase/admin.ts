import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "./env";

export function createServiceRoleClient() {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service-role configuration is missing.");
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Service-role credentials are confined to this file and the other
// server-only admin modules in the same allowlist (see
// admin-panel-security.test.mjs's "service-role access is isolated"
// check) -- strategic-report-access.ts needs this lookup but must not
// reference createServiceRoleClient/SUPABASE_SERVICE_ROLE_KEY itself, so
// the lookup lives here and is imported as a plain async function.
export async function loadActiveAdminRole(userId: string) {
  const serviceClient = createServiceRoleClient();
  const { data, error } = await serviceClient
    .from("admin_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (error) throw error;
  return data?.role;
}
