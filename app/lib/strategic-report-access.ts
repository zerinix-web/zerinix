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

// The service-role lookup itself lives in supabase/admin.ts (a server-only
// admin module already allowed to touch service-role credentials) and is
// only referenced here as a plain async function, never imported eagerly
// at module scope -- this keeps this file free of any service-role
// credential reference while still defaulting to the real lookup.
async function loadActiveAdminRole(userId: string) {
  const admin = await import("./supabase/admin.ts");
  return admin.loadActiveAdminRole(userId);
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
