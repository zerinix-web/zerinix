import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryResearchUsageTracker,
  ResearchCoordinator,
  ResearchProviderCostCatalog,
  ResearchQuotaChecker,
  ResearchQuotaExceededError,
  calculateResearchCacheEfficiency,
  calculateTotalEstimatedSpend,
  createResearchAdminMetrics,
} from "../app/lib/research-providers/index.mjs";

const now = "2026-07-27T12:00:00.000Z";

function usageInput(overrides = {}) {
  return {
    occurredAt: now,
    requestTimestamp: now,
    userId: "user-1",
    workspaceId: "workspace-1",
    request: {
      query: "AI accounting software market",
      language: "en",
      region: "US",
      maxResults: 5,
      freshness: { mode: "any" },
      topics: [],
    },
    providerId: "tavily-search",
    providerName: "Tavily",
    providerKind: "Search API",
    cacheStatus: "miss",
    estimatedCostUsd: 0.01,
    resultCount: 3,
    status: "completed",
    ...overrides,
  };
}

class MockProvider {
  constructor(cost = 0.01) {
    this.id = "mock-search";
    this.name = "Other";
    this.kind = "Search API";
    this.cost = cost;
    this.calls = 0;
  }

  supports() {
    return true;
  }

  estimateCost() {
    return {
      currency: "USD",
      estimatedCostUsd: this.cost,
      billableUnits: 1,
      unitName: "request",
      freeTierEligible: false,
    };
  }

  async research() {
    this.calls += 1;
    return {
      rawEvidenceItems: [],
      metadata: {
        providerId: this.id,
        providerKind: this.kind,
        executedAt: now,
        resultCount: 0,
      },
      estimatedCost: this.estimateCost(),
    };
  }
}

test("free-tier quota allows a request and reports remaining usage", async () => {
  const store = new InMemoryResearchUsageTracker();
  const checker = new ResearchQuotaChecker({
    usageStore: store,
    rules: {
      free: {
        dailyResearchCount: 2,
        monthlyResearchCount: 4,
        monthlyEstimatedCostUsd: 1,
      },
    },
  });

  const decision = await checker.check({
    userId: "user-1",
    tier: "free",
    estimatedCostUsd: 0.1,
    now,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.remaining.dailyResearchCount, 1);
  assert.equal(decision.remaining.monthlyResearchCount, 3);
  assert.equal(decision.remaining.monthlyEstimatedCostUsd, 0.9);
});

test("quota returns a controlled exceeded decision at the free daily limit", async () => {
  const store = new InMemoryResearchUsageTracker();
  await store.record(usageInput());
  const checker = new ResearchQuotaChecker({
    usageStore: store,
    rules: {
      free: {
        dailyResearchCount: 1,
        monthlyResearchCount: 10,
        monthlyEstimatedCostUsd: 10,
      },
    },
  });

  const decision = await checker.check({
    userId: "user-1",
    tier: "free",
    estimatedCostUsd: 0.01,
    now,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "daily_count");
  assert.equal(decision.remaining.dailyResearchCount, 0);
  assert.match(decision.message, /quota exceeded/i);
});

test("paid users can continue after the configured free-user limit", async () => {
  const store = new InMemoryResearchUsageTracker();
  await store.record(usageInput());
  const checker = new ResearchQuotaChecker({
    usageStore: store,
    rules: {
      free: {
        dailyResearchCount: 1,
        monthlyResearchCount: 1,
        monthlyEstimatedCostUsd: 0.01,
      },
      paid: {
        dailyResearchCount: 10,
        monthlyResearchCount: 100,
        monthlyEstimatedCostUsd: 5,
      },
    },
  });

  const free = await checker.check({
    userId: "user-1",
    tier: "free",
    estimatedCostUsd: 0.01,
    now,
  });
  const paid = await checker.check({
    userId: "user-1",
    tier: "paid",
    estimatedCostUsd: 0.01,
    now,
  });

  assert.equal(free.allowed, false);
  assert.equal(paid.allowed, true);
  assert.equal(paid.remaining.dailyResearchCount, 8);
});

test("monthly estimated-cost quota is evaluated independently of count limits", async () => {
  const store = new InMemoryResearchUsageTracker();
  await store.record(usageInput({ estimatedCostUsd: 0.09 }));
  const checker = new ResearchQuotaChecker({
    usageStore: store,
    rules: {
      free: {
        dailyResearchCount: 100,
        monthlyResearchCount: 100,
        monthlyEstimatedCostUsd: 0.1,
      },
    },
  });

  const decision = await checker.check({
    userId: "user-1",
    tier: "free",
    estimatedCostUsd: 0.02,
    now,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "monthly_cost");
});

test("cache efficiency tracks hits, misses, saved calls, and estimated savings", () => {
  const events = [
    usageInput({ estimatedCostUsd: 0.02 }),
    usageInput({
      cacheStatus: "exact-hit",
      estimatedCostUsd: 0,
      estimatedCostAvoidedUsd: 0.02,
    }),
    usageInput({
      cacheStatus: "topic-hit",
      estimatedCostUsd: 0,
      estimatedCostAvoidedUsd: 0.02,
    }),
  ];

  assert.deepEqual(calculateResearchCacheEfficiency(events), {
    cacheHits: 2,
    cacheMisses: 1,
    savedRequestsEstimate: 2,
    cacheHitRate: 0.6667,
    estimatedCostSavingsUsd: 0.04,
  });
});

test("cost catalog supports different Tavily, Exa, Bing, and fallback costs", () => {
  const catalog = new ResearchProviderCostCatalog({
    Tavily: { perRequestUsd: 0.01 },
    Exa: { perRequestUsd: 0.02, perResultUsd: 0.001 },
    Bing: { perRequestUsd: 0.03 },
    Other: { perRequestUsd: 0.04 },
  });

  assert.equal(catalog.estimate("Tavily", { maxResults: 5 }), 0.01);
  assert.equal(catalog.estimate("Exa", { maxResults: 5 }), 0.025);
  assert.equal(catalog.estimate("Bing", { maxResults: 5 }), 0.03);
  assert.equal(catalog.estimate("Custom provider", { maxResults: 5 }), 0.04);
  assert.equal(
    calculateTotalEstimatedSpend([
      usageInput({ estimatedCostUsd: 0.01 }),
      usageInput({ estimatedCostUsd: 0.025 }),
    ]),
    0.035
  );
});

test("quota enforcement occurs before provider execution", async () => {
  const store = new InMemoryResearchUsageTracker();
  await store.record(usageInput());
  const checker = new ResearchQuotaChecker({
    usageStore: store,
    rules: {
      free: {
        dailyResearchCount: 1,
        monthlyResearchCount: 1,
        monthlyEstimatedCostUsd: 1,
      },
    },
  });
  const provider = new MockProvider();
  const coordinator = new ResearchCoordinator({
    providers: [provider],
    usageTracker: store,
    quotaChecker: checker,
  });

  await assert.rejects(
    coordinator.research(
      { query: "Cloud security market size" },
      { userId: "user-1", researchTier: "free", now }
    ),
    ResearchQuotaExceededError
  );
  assert.equal(provider.calls, 0);
});

test("allowed provider execution records trusted usage and workspace context", async () => {
  const store = new InMemoryResearchUsageTracker();
  const checker = new ResearchQuotaChecker({
    usageStore: store,
    rules: {
      enterprise: {
        dailyResearchCount: 100,
        monthlyResearchCount: 1000,
        monthlyEstimatedCostUsd: 100,
      },
    },
  });
  const provider = new MockProvider(0.03);
  const coordinator = new ResearchCoordinator({
    providers: [provider],
    usageTracker: store,
    quotaChecker: checker,
  });

  await coordinator.research(
    { query: "Industrial robotics adoption" },
    {
      userId: "user-2",
      workspaceId: "workspace-2",
      researchTier: "enterprise",
      now,
    }
  );

  const events = await store.list({ userId: "user-2" });
  assert.equal(provider.calls, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].workspaceId, "workspace-2");
  assert.equal(events[0].providerName, "Other");
  assert.equal(events[0].cacheHit, false);
  assert.equal(events[0].estimatedCostUsd, 0.03);
});

test("admin metrics expose cost, expensive queries, cache, and provider breakdown", () => {
  const metrics = createResearchAdminMetrics([
    usageInput({ estimatedCostUsd: 0.04, resultCount: 4 }),
    usageInput({
      providerId: "exa-search",
      providerName: "Exa",
      estimatedCostUsd: 0.02,
      resultCount: 2,
    }),
    usageInput({
      cacheStatus: "exact-hit",
      estimatedCostUsd: 0,
      estimatedCostAvoidedUsd: 0.04,
    }),
  ]);

  assert.equal(metrics.researchCalls, 3);
  assert.equal(metrics.estimatedApiCostUsd, 0.06);
  assert.equal(metrics.cacheEfficiency.savedRequestsEstimate, 1);
  assert.equal(metrics.providerUsage.length, 2);
  assert.equal(metrics.mostExpensiveQueries[0].estimatedCostUsd, 0.06);
});
