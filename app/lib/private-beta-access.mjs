export function normalizePrivateBetaEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function parsePrivateBetaAllowedEmails(
  value = process.env.PRIVATE_BETA_ALLOWED_EMAILS || ""
) {
  return String(value)
    .split(",")
    .map((email) => normalizePrivateBetaEmail(email))
    .filter(Boolean);
}

export function isPrivateBetaEmailAllowed(
  email,
  allowedEmails = process.env.PRIVATE_BETA_ALLOWED_EMAILS || ""
) {
  const normalizedEmail = normalizePrivateBetaEmail(email);

  if (!normalizedEmail) {
    return false;
  }

  return parsePrivateBetaAllowedEmails(allowedEmails).includes(normalizedEmail);
}
