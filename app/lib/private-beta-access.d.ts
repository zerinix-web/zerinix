export function normalizePrivateBetaEmail(value: unknown): string;
export function parsePrivateBetaAllowedEmails(value?: string): string[];
export function isPrivateBetaEmailAllowed(
  email: unknown,
  allowedEmails?: string
): boolean;
