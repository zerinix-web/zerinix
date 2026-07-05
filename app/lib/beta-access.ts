const primaryAllowedEmail = [
  "yesilovaibrahim38",
  ["gmail", "com"].join("."),
].join("@");

const allowedBetaEmails = new Set([primaryAllowedEmail]);

export function isPrivateBetaAllowed(email?: string | null) {
  return Boolean(email && allowedBetaEmails.has(email.toLowerCase()));
}
