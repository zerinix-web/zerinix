export const RESEARCH_PROVIDER_KINDS = Object.freeze([
  "Search API",
  "News",
  "Research Paper",
  "Company Data",
]);

export const RESEARCH_FRESHNESS_MODES = Object.freeze([
  "any",
  "recent",
  "since",
]);

export function normalizeProviderText(value, maxLength = 400) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function stableResearchHash(value) {
  let hash = 2166136261;

  for (const character of String(value)) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

