type LogMetadata = Record<string, unknown>;

const sensitiveKeyPattern = /secret|token|key|password|authorization|cookie|card|session/i;
const redacted = "[REDACTED]";

const sensitiveContentPatterns: RegExp[] = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:sk_live|sk_test)_[A-Za-z0-9]{16,}\b/g,
  /\b(?:sb_secret|sb_publishable|sbp|sbr)_[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:password|passwd|pwd)\s*[:=]\s*['"]?[^'",\s}]{3,}/gi,
  /\bAuthorization\s*[:=]\s*(?:Bearer\s+)?[A-Za-z0-9._~+/=-]{10,}/gi,
  /\bCookie\s*[:=]\s*[^;\n\r]{8,}(?:;[^;\n\r]{3,})*/gi,
  /\b(?:session|session_id|sessionId|sid)\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]{10,}/gi,
  /\b[A-Za-z0-9+/]{80,}={0,2}\b/g,
];

function sanitizeString(value: string) {
  return sensitiveContentPatterns.reduce(
    (sanitized, pattern) => sanitized.replace(pattern, redacted),
    value
  );
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (sensitiveKeyPattern.test(key)) {
    return redacted;
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue("", item));
  }

  if (typeof value === "object" && value !== null) {
    return sanitizeMetadata(value as LogMetadata);
  }

  return value;
}

export function sanitizeMetadata(metadata: LogMetadata = {}) {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, sanitizeValue(key, value)])
  );
}

export function shouldLogOperationalInfo() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ZERINIX_VERBOSE_LOGS === "true"
  );
}

export function logOperationalInfo(scope: string, metadata: LogMetadata = {}) {
  if (!shouldLogOperationalInfo()) {
    return;
  }

  console.info(scope, sanitizeMetadata(metadata));
}

export function logOperationalError(
  scope: string,
  error: unknown,
  metadata: LogMetadata = {}
) {
  const message = sanitizeString(
    error instanceof Error ? error.message : String(error || "Unknown error")
  );

  console.error(scope, sanitizeMetadata({ ...metadata, message }));
}
