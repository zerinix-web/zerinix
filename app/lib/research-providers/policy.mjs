import { normalizeProviderText } from "./model.mjs";

const promptInjectionPatterns = [
  /\bignore\s+(?:all|any|the|previous|prior)\s+(?:instructions?|prompts?|rules?)\b/i,
  /\b(?:system|developer)\s+(?:message|prompt|instructions?)\b/i,
  /\breveal\s+(?:the\s+)?(?:prompt|instructions?|secrets?|api keys?)\b/i,
  /\b(?:jailbreak|prompt injection|bypass safety|override policy)\b/i,
  /<\s*(?:system|assistant|developer|tool)\b/i,
  /\b(?:BEGIN|END)\s+(?:SYSTEM|PROMPT|INSTRUCTIONS)\b/i,
];

function normalizeLanguage(value) {
  const language = normalizeProviderText(value, 16).toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z]{2})?$/.test(language) ? language : "en";
}

function normalizeRegion(value) {
  const region = normalizeProviderText(value, 16).toUpperCase();
  return /^[A-Z]{2,3}$/.test(region) ? region : "GLOBAL";
}

function normalizeMaxResults(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 10;
  return Math.max(1, Math.min(50, Math.round(number)));
}

function normalizeFreshness(value) {
  if (!value || typeof value !== "object") {
    return { mode: "any" };
  }

  if (value.mode === "recent") {
    const maxAgeDays = Number(value.maxAgeDays);
    return {
      mode: "recent",
      maxAgeDays: Number.isFinite(maxAgeDays)
        ? Math.max(1, Math.min(3_650, Math.round(maxAgeDays)))
        : 30,
    };
  }

  if (value.mode === "since") {
    const since = new Date(value.since);
    if (Number.isFinite(since.getTime())) {
      return { mode: "since", since: since.toISOString() };
    }
  }

  return { mode: "any" };
}

function normalizeTopics(value) {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .map((topic) => normalizeProviderText(topic, 80).toLowerCase())
        .filter(Boolean)
    ),
  ].slice(0, 10);
}

export class UnsafeResearchQueryError extends Error {
  constructor(message = "Research query was rejected by the provider safety policy.") {
    super(message);
    this.name = "UnsafeResearchQueryError";
  }
}

export class ResearchQueryPolicy {
  prepare(input = {}) {
    const query = normalizeProviderText(input.query, 400);

    if (!query) {
      throw new UnsafeResearchQueryError("Research query is required.");
    }

    if (promptInjectionPatterns.some((pattern) => pattern.test(query))) {
      throw new UnsafeResearchQueryError();
    }

    return {
      query,
      language: normalizeLanguage(input.language),
      region: normalizeRegion(input.region),
      maxResults: normalizeMaxResults(input.maxResults),
      freshness: normalizeFreshness(input.freshness),
      ...(normalizeProviderText(input.industry, 100)
        ? { industry: normalizeProviderText(input.industry, 100) }
        : {}),
      topics: normalizeTopics(input.topics),
    };
  }
}

