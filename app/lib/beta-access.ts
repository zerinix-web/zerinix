const allowedBetaEmails = new Set([
  "yesilovaibrahim38@gmail.com",
]);

export function isPrivateBetaAllowed(email?: string | null) {
  return Boolean(email && allowedBetaEmails.has(email.toLowerCase()));
}
