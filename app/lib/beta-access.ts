const primaryAllowedEmail = [
  "yesilovaibrahim38",
  ["gmail", "com"].join("."),
].join("@");
const ownerAllowedEmail = [
  "yesilova_ibrahim",
  ["hotmail", "com"].join("."),
].join("@");
const primaryDeveloperHandle = ["iyslv94", "coder"].join("-");

const allowedBetaEmails = new Set([primaryAllowedEmail, ownerAllowedEmail]);
const allowedDeveloperHandles = new Set([primaryDeveloperHandle]);

type BetaAccessIdentity = {
  provider?: string | null;
  identity_data?: Record<string, unknown> | null;
};

type BetaAccessAccount = {
  id?: string | null;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
  identities?: BetaAccessIdentity[] | null;
};

export type PrivateBetaAccessDiagnostics = {
  userId: string;
  userEmail: string;
  provider: string;
  appMetadataProvider: string;
  userMetadataEmail: string;
  userMetadataFullName: string;
  checks: Array<{
    label: string;
    passed: boolean;
  }>;
};

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeGmailAddress(value: string) {
  const email = normalizeEmail(value);
  const [localPart, domain] = email.split("@");

  if (!localPart || (domain !== "gmail.com" && domain !== "googlemail.com")) {
    return email;
  }

  return `${localPart.split("+")[0].replace(/\./g, "")}@gmail.com`;
}

function normalizeHandle(value: string) {
  return value.trim().toLowerCase();
}

function emailMatchesAllowedOwner(value: string) {
  if (!value) {
    return false;
  }

  const normalizedEmail = normalizeEmail(value);
  const normalizedGmailEmail = normalizeGmailAddress(value);

  return [...allowedBetaEmails].some(
    (email) =>
      normalizedEmail === normalizeEmail(email) ||
      normalizedGmailEmail === normalizeGmailAddress(email)
  );
}

function collectAccountEmails(account: BetaAccessAccount) {
  const emails = new Set<string>();
  const addEmail = (value: unknown) => {
    const email = readString(value);

    if (email) {
      emails.add(normalizeEmail(email));
      emails.add(normalizeGmailAddress(email));
    }
  };

  addEmail(account.email);
  addEmail(account.user_metadata?.email);
  addEmail(account.app_metadata?.email);

  account.identities?.forEach((identity) => {
    addEmail(identity.identity_data?.email);
  });

  return emails;
}

function collectAccountHandles(account: BetaAccessAccount) {
  const handles = new Set<string>();
  const addHandle = (value: unknown) => {
    const handle = readString(value);

    if (handle) {
      handles.add(normalizeHandle(handle));
    }
  };

  addHandle(account.user_metadata?.user_name);
  addHandle(account.user_metadata?.preferred_username);
  addHandle(account.user_metadata?.name);
  addHandle(account.app_metadata?.user_name);
  addHandle(account.app_metadata?.preferred_username);

  account.identities?.forEach((identity) => {
    addHandle(identity.identity_data?.user_name);
    addHandle(identity.identity_data?.preferred_username);
    addHandle(identity.identity_data?.name);
  });

  return handles;
}

export function getPrivateBetaAccessDiagnostics(
  account: BetaAccessAccount
): PrivateBetaAccessDiagnostics {
  const accountEmails = collectAccountEmails(account);
  const accountHandles = collectAccountHandles(account);
  const appMetadataProvider = readString(account.app_metadata?.provider);
  const identityProvider = readString(account.identities?.[0]?.provider);
  const provider = appMetadataProvider || identityProvider || "unknown";
  const userEmail = readString(account.email);
  const userMetadataEmail = readString(account.user_metadata?.email);
  const identityEmailExactPassed =
    account.identities?.some((identity) => {
      const email = readString(identity.identity_data?.email);

      return email
        ? [...allowedBetaEmails].some(
            (allowedEmail) => normalizeEmail(email) === normalizeEmail(allowedEmail)
          )
        : false;
    }) ?? false;
  const identityEmailGmailPassed =
    account.identities?.some((identity) => {
      const email = readString(identity.identity_data?.email);

      return email
        ? [...allowedBetaEmails].some(
            (allowedEmail) =>
              normalizeGmailAddress(email) === normalizeGmailAddress(allowedEmail)
          )
        : false;
    }) ?? false;

  return {
    userId: readString(account.id),
    userEmail,
    provider,
    appMetadataProvider: appMetadataProvider || "unknown",
    userMetadataEmail,
    userMetadataFullName: readString(account.user_metadata?.full_name),
    checks: [
      {
        label: "user.email exact owner match",
        passed: [...allowedBetaEmails].some(
          (email) => normalizeEmail(userEmail) === normalizeEmail(email)
        ),
      },
      {
        label: "user.email Gmail-normalized owner match",
        passed: [...allowedBetaEmails].some(
          (email) => normalizeGmailAddress(userEmail) === normalizeGmailAddress(email)
        ),
      },
      {
        label: "user_metadata.email owner match",
        passed: emailMatchesAllowedOwner(userMetadataEmail),
      },
      {
        label: "identity email exact owner match",
        passed: identityEmailExactPassed,
      },
      {
        label: "identity email Gmail-normalized owner match",
        passed: identityEmailGmailPassed,
      },
      {
        label: "developer handle metadata match",
        passed: [...allowedDeveloperHandles].some((handle) =>
          accountHandles.has(normalizeHandle(handle))
        ),
      },
      {
        label: "collected email allowlist match",
        passed: [...allowedBetaEmails].some((email) =>
          emailMatchesAllowedOwner(email)
            ? accountEmails.has(normalizeEmail(email)) ||
              accountEmails.has(normalizeGmailAddress(email))
            : false
        ),
      },
    ],
  };
}

export function isPrivateBetaAllowed(account?: BetaAccessAccount | string | null) {
  if (!account) {
    return false;
  }

  const betaAccount = typeof account === "string" ? { email: account } : account;
  const accountEmails = collectAccountEmails(betaAccount);
  const accountHandles = collectAccountHandles(betaAccount);

  for (const email of allowedBetaEmails) {
    if (accountEmails.has(normalizeEmail(email)) || accountEmails.has(normalizeGmailAddress(email))) {
      return true;
    }
  }

  for (const handle of allowedDeveloperHandles) {
    if (accountHandles.has(normalizeHandle(handle))) {
      return true;
    }
  }

  return false;
}

export function isFounderAccount(account?: BetaAccessAccount | string | null) {
  if (!account) {
    return false;
  }

  const betaAccount = typeof account === "string" ? { email: account } : account;
  const accountEmails = collectAccountEmails(betaAccount);

  return (
    accountEmails.has(normalizeEmail(ownerAllowedEmail)) ||
    accountEmails.has(normalizeGmailAddress(ownerAllowedEmail))
  );
}
