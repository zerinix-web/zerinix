import {
  normalizeProviderText,
  stableResearchHash,
} from "./model.mjs";

export function createResearchUsageEvent(input) {
  const queryLabel =
    normalizeProviderText(input.queryLabel, 120) ||
    normalizeProviderText(input.request?.query, 120);
  const occurredAt = new Date(input.occurredAt || Date.now());

  return {
    occurredAt: Number.isFinite(occurredAt.getTime())
      ? occurredAt.toISOString()
      : new Date().toISOString(),
    ...(input.userId ? { userId: String(input.userId).slice(0, 128) } : {}),
    queryHash:
      normalizeProviderText(input.queryHash, 80) ||
      stableResearchHash(
        `${input.request?.language}|${input.request?.region}|${queryLabel.toLowerCase()}`
      ),
    queryLabel,
    providerId: String(input.providerId || "unknown").slice(0, 100),
    providerKind: input.providerKind,
    cacheStatus: input.cacheStatus || "miss",
    duplicateRequest: Boolean(input.duplicateRequest),
    estimatedCostUsd: Math.max(0, Number(input.estimatedCostUsd) || 0),
    resultCount: Math.max(0, Math.round(Number(input.resultCount) || 0)),
    durationMs: Math.max(0, Math.round(Number(input.durationMs) || 0)),
    status: input.status === "failed" ? "failed" : "completed",
  };
}

export class InMemoryResearchUsageTracker {
  constructor() {
    this.events = [];
  }

  async record(event) {
    this.events.push(createResearchUsageEvent(event));
  }

  snapshot() {
    return this.events.map((event) => ({ ...event }));
  }

  clear() {
    this.events.length = 0;
  }
}

export function createResearchAdminMetrics(events, options = {}) {
  const limit = Math.max(1, Math.min(50, Math.round(options.expensiveQueryLimit || 10)));
  const normalizedEvents = (Array.isArray(events) ? events : []).map(
    createResearchUsageEvent
  );
  const completed = normalizedEvents.filter((event) => event.status === "completed");
  const cacheHits = completed.filter((event) => event.cacheStatus !== "miss").length;
  const queryCosts = new Map();
  const providers = new Map();

  for (const event of normalizedEvents) {
    const query = queryCosts.get(event.queryHash) || {
      queryHash: event.queryHash,
      queryLabel: event.queryLabel,
      callCount: 0,
      estimatedCostUsd: 0,
    };
    query.callCount += 1;
    query.estimatedCostUsd += event.estimatedCostUsd;
    queryCosts.set(event.queryHash, query);

    const provider = providers.get(event.providerId) || {
      providerId: event.providerId,
      callCount: 0,
      estimatedCostUsd: 0,
      cacheHits: 0,
      failures: 0,
    };
    provider.callCount += 1;
    provider.estimatedCostUsd += event.estimatedCostUsd;
    if (event.cacheStatus !== "miss") provider.cacheHits += 1;
    if (event.status === "failed") provider.failures += 1;
    providers.set(event.providerId, provider);
  }

  return {
    researchCalls: normalizedEvents.length,
    completedCalls: completed.length,
    failedCalls: normalizedEvents.length - completed.length,
    estimatedApiCostUsd: Number(
      normalizedEvents
        .reduce((sum, event) => sum + event.estimatedCostUsd, 0)
        .toFixed(6)
    ),
    cacheHitRate: completed.length
      ? Number((cacheHits / completed.length).toFixed(4))
      : 0,
    mostExpensiveQueries: [...queryCosts.values()]
      .sort(
        (left, right) =>
          right.estimatedCostUsd - left.estimatedCostUsd ||
          right.callCount - left.callCount
      )
      .slice(0, limit),
    providerUsage: [...providers.values()].sort(
      (left, right) => right.estimatedCostUsd - left.estimatedCostUsd
    ),
  };
}
