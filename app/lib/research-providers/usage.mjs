import {
  normalizeProviderText,
  stableResearchHash,
} from "./model.mjs";

export function createResearchUsageEvent(input) {
  const queryLabel =
    normalizeProviderText(input.queryLabel, 120) ||
    normalizeProviderText(input.request?.query, 120);
  const occurredAt = new Date(input.occurredAt || Date.now());
  const requestTimestamp = new Date(input.requestTimestamp || occurredAt);
  const cacheStatus = input.cacheStatus || "miss";

  return {
    occurredAt: Number.isFinite(occurredAt.getTime())
      ? occurredAt.toISOString()
      : new Date().toISOString(),
    requestTimestamp: Number.isFinite(requestTimestamp.getTime())
      ? requestTimestamp.toISOString()
      : new Date().toISOString(),
    ...(input.userId ? { userId: String(input.userId).slice(0, 128) } : {}),
    ...(input.workspaceId
      ? { workspaceId: String(input.workspaceId).slice(0, 128) }
      : {}),
    queryHash:
      normalizeProviderText(input.queryHash, 80) ||
      stableResearchHash(
        `${input.request?.language}|${input.request?.region}|${queryLabel.toLowerCase()}`
      ),
    queryLabel,
    providerId: String(input.providerId || "unknown").slice(0, 100),
    providerName: normalizeProviderText(
      input.providerName || input.providerId || "unknown",
      100
    ),
    providerKind: input.providerKind,
    cacheStatus,
    cacheHit: cacheStatus !== "miss",
    providerExecuted:
      typeof input.providerExecuted === "boolean"
        ? input.providerExecuted
        : cacheStatus === "miss",
    duplicateRequest: Boolean(input.duplicateRequest),
    estimatedCostUsd: Math.max(0, Number(input.estimatedCostUsd) || 0),
    estimatedCostAvoidedUsd: Math.max(
      0,
      Number(input.estimatedCostAvoidedUsd) || 0
    ),
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

  async list(filter = {}) {
    const from = filter.from ? new Date(filter.from).getTime() : -Infinity;
    const to = filter.to ? new Date(filter.to).getTime() : Infinity;

    return this.events
      .filter((event) => {
        const timestamp = new Date(event.requestTimestamp).getTime();
        return (
          (!filter.userId || event.userId === filter.userId) &&
          (!filter.workspaceId || event.workspaceId === filter.workspaceId) &&
          (!filter.providerId || event.providerId === filter.providerId) &&
          timestamp >= from &&
          timestamp < to
        );
      })
      .map((event) => ({ ...event }));
  }

  snapshot() {
    return this.events.map((event) => ({ ...event }));
  }

  clear() {
    this.events.length = 0;
  }
}

export function calculateTotalEstimatedSpend(events) {
  return Number(
    (Array.isArray(events) ? events : [])
      .map(createResearchUsageEvent)
      .reduce((sum, event) => sum + event.estimatedCostUsd, 0)
      .toFixed(6)
  );
}

export function calculateResearchCacheEfficiency(events) {
  const normalizedEvents = (Array.isArray(events) ? events : []).map(
    createResearchUsageEvent
  );
  const cacheHits = normalizedEvents.filter((event) => event.cacheHit);
  const cacheMisses = normalizedEvents.filter((event) => !event.cacheHit);
  const providerMissCosts = new Map();

  for (const event of cacheMisses) {
    const costs = providerMissCosts.get(event.providerId) || [];
    costs.push(event.estimatedCostUsd);
    providerMissCosts.set(event.providerId, costs);
  }

  const estimatedCostSavingsUsd = cacheHits.reduce((sum, event) => {
    if (event.estimatedCostAvoidedUsd > 0) {
      return sum + event.estimatedCostAvoidedUsd;
    }
    const costs = providerMissCosts.get(event.providerId) || [];
    const averageCost = costs.length
      ? costs.reduce((subtotal, cost) => subtotal + cost, 0) / costs.length
      : 0;
    return sum + averageCost;
  }, 0);

  return {
    cacheHits: cacheHits.length,
    cacheMisses: cacheMisses.length,
    savedRequestsEstimate: cacheHits.length,
    cacheHitRate: normalizedEvents.length
      ? Number((cacheHits.length / normalizedEvents.length).toFixed(4))
      : 0,
    estimatedCostSavingsUsd: Number(estimatedCostSavingsUsd.toFixed(6)),
  };
}

export function createResearchAdminMetrics(events, options = {}) {
  const limit = Math.max(1, Math.min(50, Math.round(options.expensiveQueryLimit || 10)));
  const normalizedEvents = (Array.isArray(events) ? events : []).map(
    createResearchUsageEvent
  );
  const completed = normalizedEvents.filter((event) => event.status === "completed");
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
      providerName: event.providerName,
      callCount: 0,
      estimatedCostUsd: 0,
      cacheHits: 0,
      cacheMisses: 0,
      resultCount: 0,
      failures: 0,
    };
    provider.callCount += 1;
    provider.estimatedCostUsd += event.estimatedCostUsd;
    provider.resultCount += event.resultCount;
    if (event.cacheHit) provider.cacheHits += 1;
    else provider.cacheMisses += 1;
    if (event.status === "failed") provider.failures += 1;
    providers.set(event.providerId, provider);
  }

  return {
    researchCalls: normalizedEvents.length,
    completedCalls: completed.length,
    failedCalls: normalizedEvents.length - completed.length,
    estimatedApiCostUsd: calculateTotalEstimatedSpend(normalizedEvents),
    cacheHitRate: calculateResearchCacheEfficiency(completed).cacheHitRate,
    cacheEfficiency: calculateResearchCacheEfficiency(normalizedEvents),
    mostExpensiveQueries: [...queryCosts.values()]
      .sort(
        (left, right) =>
          right.estimatedCostUsd - left.estimatedCostUsd ||
          right.callCount - left.callCount
      )
      .slice(0, limit),
    providerUsage: [...providers.values()]
      .map((provider) => ({
        ...provider,
        cacheHitRate: provider.callCount
          ? Number((provider.cacheHits / provider.callCount).toFixed(4))
          : 0,
      }))
      .sort((left, right) => right.estimatedCostUsd - left.estimatedCostUsd),
  };
}
