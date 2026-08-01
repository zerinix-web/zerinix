import { isFounderEmail } from "./founder-access.mjs";
import { isPrivateBetaEmailAllowed } from "./private-beta-access.mjs";

type BetaAccessIdentity = {
  identity_data?: Record<string, unknown> | null;
};

type BetaAccessAccount = {
  email?: string | null;
  identities?: BetaAccessIdentity[] | null;
  app_metadata?: Record<string, unknown> | null;
};

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function collectAccountEmails(account: BetaAccessAccount) {
  const emails = new Set<string>();
  const addEmail = (value: unknown) => {
    const email = readString(value);

    if (email) {
      emails.add(normalizeEmail(email));
    }
  };

  addEmail(account.email);

  account.identities?.forEach((identity) => {
    addEmail(identity.identity_data?.email);
  });

  return emails;
}

export function isPrivateBetaAllowed(
  account?: BetaAccessAccount | string | null,
  allowedEmails = process.env.PRIVATE_BETA_ALLOWED_EMAILS || ""
) {
  if (!account || !allowedEmails.trim()) {
    return false;
  }

  const betaAccount = typeof account === "string" ? { email: account } : account;

  return isPrivateBetaEmailAllowed(betaAccount.email, allowedEmails);
}

export function isFounderAccount(account?: BetaAccessAccount | string | null) {
  if (!account) {
    return false;
  }

  const betaAccount = typeof account === "string" ? { email: account } : account;
  const accountEmails = collectAccountEmails(betaAccount);

  return [...accountEmails].some((email) => isFounderEmail(email));
}

export function isAdminOrOwnerRole(value: unknown) {
  return new Set(["admin", "owner"]).has(readString(value).toLowerCase());
}

export function hasVerifiedAdminOrOwnerClaim(account: BetaAccessAccount) {
  const adminRoles = new Set(["admin", "owner"]);
  const role = readString(account.app_metadata?.role).toLowerCase();
  const roles = Array.isArray(account.app_metadata?.roles)
    ? account.app_metadata.roles
    : [];

  return (
    adminRoles.has(role) ||
    roles.some((value) =>
      adminRoles.has(readString(value).toLowerCase())
    )
  );
}

export function isLocalDevelopmentOwnerOrAdmin(
  request: Request,
  account?: BetaAccessAccount | null
) {
  if (
    !account ||
    process.env.NODE_ENV !== "development" ||
    process.env.VERCEL
  ) {
    return false;
  }

  try {
    const hostname = new URL(request.url).hostname.toLowerCase();
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]";

    return (
      isLocalhost &&
      (isFounderAccount(account) || hasVerifiedAdminOrOwnerClaim(account))
    );
  } catch {
    return false;
  }
}
