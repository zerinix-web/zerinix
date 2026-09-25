import type { User } from "@supabase/supabase-js";
import {
  hasVerifiedAdminOrOwnerClaim,
  isAdminOrOwnerRole,
  isLocalDevelopmentOwnerOrAdmin,
  isPrivateBetaAllowed,
} from "./beta-access.ts";
import { isAppAttestedAccount } from "./ios-app-store-access.ts";

type AdminRoleLoader = (userId: string) => Promise<unknown>;

export type StrategicReportAccess = {
  allowed: boolean;
  branch:
    | "approved_beta"
    | "verified_admin_owner_claim"
    | "verified_admin_owner_role"
    | "local_development_owner_admin"
    | "attested_ios_app_store"
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

// TASK #69A-16B -- extracted from authorizeStrategicReportAccess's own two
// admin/owner branches (verified JWT claim, then the DB-backed admin_roles
// lookup) so OTHER server-side authorization decisions -- e.g. PDF export
// quota exemption -- can reuse the exact same canonical, server-verified
// admin/owner resolution without also pulling in isPrivateBetaAllowed's
// unrelated beta-email-allowlist branch (a private-beta-approved account
// is not necessarily an admin/owner, and must never be treated as one).
// Never reads anything client-supplied: `account` is the Supabase `User`
// object returned by supabase.auth.getUser() (server-verified JWT), and
// the role lookup is a service-role-backed DB query, isolated in
// supabase/admin.ts via the same lazy dynamic import
// authorizeStrategicReportAccess already uses (so this file's own source
// text never references service-role credentials directly, preserving
// admin-panel-security.test.mjs's service-role isolation allowlist).
export async function isVerifiedAdminOrOwnerAccount(
  account: User,
  { loadAdminRole = loadActiveAdminRole }: { loadAdminRole?: AdminRoleLoader } = {}
): Promise<boolean> {
  if (hasVerifiedAdminOrOwnerClaim(account)) {
    return true;
  }

  try {
    const role = await loadAdminRole(account.id);
    return isAdminOrOwnerRole(role);
  } catch (error) {
    console.error("[strategic-report-access] admin role lookup failed", {
      userId: account.id,
      error,
    });
    return false;
  }
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

  // An account created through the iOS App Store app. Reached only after this
  // server verified an Apple App Attest assertion (see
  // app/api/ios/registration/route.ts), and recorded in app_metadata, which
  // the user cannot write. The private-beta allowlist above is untouched: an
  // account that did not come through that attested path still needs it.
  if (isAppAttestedAccount(account)) {
    return { allowed: true, branch: "attested_ios_app_store" };
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
