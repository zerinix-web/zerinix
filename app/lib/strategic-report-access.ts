import type { User } from "@supabase/supabase-js";
import {
  hasVerifiedAdminOrOwnerClaim,
  isAdminOrOwnerRole,
  isLocalDevelopmentOwnerOrAdmin,
  isPrivateBetaAllowed,
} from "./beta-access.ts";

type AdminRoleLoader = (userId: string) => Promise<unknown>;

export type StrategicReportAccess = {
  allowed: boolean;
  branch:
    | "approved_beta"
    | "verified_admin_owner_claim"
    | "verified_admin_owner_role"
    | "local_development_owner_admin"
    | "private_beta_denied";
};

async function loadActiveAdminRole(userId: string) {
  const { createServiceRoleClient } = await import("./supabase/admin.ts");
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

export async function authorizeStrategicReportAccess({
  request,
  account,
  allowedEmails,
  loadAdminRole = loadActiveAdminRole,
}: {
  request: Request;
  account: User;
  allowedEmails?: string;
  loadAdminRole?: AdminRoleLoader;
}): Promise<StrategicReportAccess> {
  if (isPrivateBetaAllowed(account, allowedEmails)) {
    return { allowed: true, branch: "approved_beta" };
  }

  if (hasVerifiedAdminOrOwnerClaim(account)) {
    return { allowed: true, branch: "verified_admin_owner_claim" };
  }

  if (isLocalDevelopmentOwnerOrAdmin(request, account)) {
    return { allowed: true, branch: "local_development_owner_admin" };
  }

  try {
    const role = await loadAdminRole(account.id);
    if (isAdminOrOwnerRole(role)) {
      return { allowed: true, branch: "verified_admin_owner_role" };
    }
  } catch (error) {
    console.error("[strategic-report-access] admin role lookup failed", {
      userId: account.id,
      error,
    });
  }

  return { allowed: false, branch: "private_beta_denied" };
}
