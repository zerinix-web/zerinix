import {
  normalizeProviderText,
  stableResearchHash,
} from "./model.mjs";

function freshnessKey(freshness) {
  if (freshness.mode === "recent") return `recent:${freshness.maxAgeDays}`;
  if (freshness.mode === "since") return `since:${freshness.since}`;
  return "any";
}

function normalizedQuery(value) {
  return normalizeProviderText(value, 400).toLowerCase();
}

function querySimilarity(left, right) {
  const leftTokens = new Set(normalizedQuery(left).split(/\s+/).filter(Boolean));
  const rightTokens = new Set(normalizedQuery(right).split(/\s+/).filter(Boolean));

  if (!leftTokens.size || !rightTokens.size) return 0;

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function topicSet(request) {
  return new Set(
    [request.industry || "", ...(request.topics || [])]
      .map((value) => normalizeProviderText(value, 100).toLowerCase())
      .filter(Boolean)
  );
}

function topicOverlap(left, right) {
  const leftTopics = topicSet(left);
  const rightTopics = topicSet(right);

  if (!leftTopics.size || !rightTopics.size) return 0;

  const overlap = [...leftTopics].filter((topic) => rightTopics.has(topic)).length;
  return overlap / Math.min(leftTopics.size, rightTopics.size);
}

export function buildResearchCacheKey(request, providerId) {
  return stableResearchHash(
    [
      providerId,
      normalizedQuery(request.query),
      request.language,
      request.region,
      request.maxResults,
      freshnessKey(request.freshness),
    ].join("|")
  );
}

export function buildResearchTopicCacheKey(request, providerId) {
  const topics = [...topicSet(request)].sort().join(",");
  return stableResearchHash(
    [providerId, request.language, request.region, topics].join("|")
  );
}

export function getResearchCacheTtlMs(request) {
  if (request.freshness.mode === "recent") {
    return Math.max(
      15 * 60_000,
      Math.min(24 * 60 * 60_000, request.freshness.maxAgeDays * 60 * 60_000)
    );
  }

  if (request.freshness.mode === "since") {
    return 6 * 60 * 60_000;
  }

  return 24 * 60 * 60_000;
}

export class InMemoryResearchCache {
  constructor() {
    this.entries = new Map();
    this.topicIndex = new Map();
  }

  get(request, providerId, options = {}) {
    const now = new Date(options.now || Date.now());
    const key = buildResearchCacheKey(request, providerId);
    const entry = this.entries.get(key);

    if (!entry) return null;
    if (new Date(entry.expiresAt).getTime() <= now.getTime()) {
      this.deleteEntry(entry);
      return null;
    }

    return entry;
  }

  findReusable(request, providerId, options = {}) {
    const now = new Date(options.now || Date.now());
    const topicKey = buildResearchTopicCacheKey(request, providerId);
    const keys = this.topicIndex.get(topicKey) || new Set();
    let best = null;
    let bestScore = 0;

    for (const key of keys) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      if (new Date(entry.expiresAt).getTime() <= now.getTime()) {
        this.deleteEntry(entry);
        continue;
      }

      const score =
        querySimilarity(request.query, entry.request.query) * 0.75 +
        topicOverlap(request, entry.request) * 0.25;

      if (score >= 0.78 && score > bestScore) {
        best = entry;
        bestScore = score;
      }
    }

    return best;
  }

  set(request, providerId, value, options = {}) {
    const createdAt = new Date(options.now || Date.now());
    const ttlMs = Number.isFinite(options.ttlMs)
      ? Math.max(1_000, options.ttlMs)
      : getResearchCacheTtlMs(request);
    const key = buildResearchCacheKey(request, providerId);
    const topicKey = buildResearchTopicCacheKey(request, providerId);
    const entry = {
      key,
      topicKey,
      providerId,
      request,
      value,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
    };

    this.entries.set(key, entry);
    const indexedKeys = this.topicIndex.get(topicKey) || new Set();
    indexedKeys.add(key);
    this.topicIndex.set(topicKey, indexedKeys);

    return entry;
  }

  clear() {
    this.entries.clear();
    this.topicIndex.clear();
  }

  deleteEntry(entry) {
    this.entries.delete(entry.key);
    const keys = this.topicIndex.get(entry.topicKey);
    keys?.delete(entry.key);
    if (keys?.size === 0) this.topicIndex.delete(entry.topicKey);
  }
}

