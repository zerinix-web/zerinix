import { isFounderEmail } from "@/app/lib/founder-access.mjs";
import { isPrivateBetaEmailAllowed } from "@/app/lib/private-beta-access.mjs";

type BetaAccessIdentity = {
  identity_data?: Record<string, unknown> | null;
};

type BetaAccessAccount = {
  email?: string | null;
  identities?: BetaAccessIdentity[] | null;
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
