const ambiguousBusinessPrompts = new Set([
  "test",
  "deneme",
  "hi",
  "hello",
  "hey",
  "merhaba",
  "selam",
  "ok",
  "okay",
  "evet",
  "start",
  "başla",
  "help",
  "yardım",
  "business",
  "iş",
  "idea",
  "fikir",
  "startup",
  "market",
  "pazar",
  "business idea",
  "startup idea",
  "market idea",
  "new business",
  "new startup",
  "what should i build",
  "what business should i start",
  "give me an idea",
  "i need an idea",
  "bana fikir ver",
  "ne kurmalıyım",
]);

const ambiguousBusinessPatterns = [
  /\bwhat\s+should\s+i\s+(build|start|create|launch)\b/i,
  /\bwhich\s+(business|startup|idea|market)\s+should\s+i\b/i,
  /\b(give|suggest)\s+me\s+(a\s+)?(business|startup|market)?\s*idea\b/i,
  /\b(i\s+need|i\s+want)\s+(a\s+)?(business|startup|market)?\s*idea\b/i,
];

const concreteBusinessTerms = [
  "ai",
  "assistant",
  "automation",
  "battery",
  "brand",
  "chain",
  "clinic",
  "company",
  "crm",
  "cybersecurity",
  "electric",
  "ev",
  "factory",
  "franchise",
  "global",
  "hospital",
  "hotel",
  "legal",
  "luxury",
  "manufacturer",
  "marketplace",
  "platform",
  "premium",
  "private",
  "restaurant",
  "saas",
  "service",
  "software",
  "studio",
  "yacht",
];

export function normalizeBusinessIdeaInput(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isConcreteBusinessDescription(value: string) {
  const normalized = normalizeBusinessIdeaInput(value);
  const words = normalized.split(" ").filter(Boolean);

  return (
    words.length >= 2 &&
    concreteBusinessTerms.some((term) => words.includes(term))
  );
}

export function isAmbiguousBusinessRequest(value: string) {
  const normalized = normalizeBusinessIdeaInput(value);

  if (!normalized) {
    return true;
  }

  if (isConcreteBusinessDescription(normalized)) {
    return false;
  }

  if (ambiguousBusinessPrompts.has(normalized)) {
    return true;
  }

  return ambiguousBusinessPatterns.some((pattern) => pattern.test(normalized));
}
