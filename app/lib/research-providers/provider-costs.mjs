const DEFAULT_PROVIDER_COSTS = Object.freeze({
  Tavily: Object.freeze({ perRequestUsd: 0.008, perResultUsd: 0 }),
  Exa: Object.freeze({ perRequestUsd: 0, perResultUsd: 0 }),
  Bing: Object.freeze({ perRequestUsd: 0, perResultUsd: 0 }),
  Other: Object.freeze({ perRequestUsd: 0, perResultUsd: 0 }),
});

function normalizeProviderName(value) {
  const name = String(value || "Other").trim();
  const knownName = Object.keys(DEFAULT_PROVIDER_COSTS).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase()
  );
  return knownName || name || "Other";
}

function normalizePricing(pricing = {}) {
  return {
    perRequestUsd: Math.max(0, Number(pricing.perRequestUsd) || 0),
    perResultUsd: Math.max(0, Number(pricing.perResultUsd) || 0),
  };
}

export class ResearchProviderCostCatalog {
  constructor(overrides = {}) {
    this.pricing = new Map(
      Object.entries(DEFAULT_PROVIDER_COSTS).map(([provider, pricing]) => [
        provider,
        { ...pricing },
      ])
    );

    for (const [provider, pricing] of Object.entries(overrides)) {
      this.pricing.set(normalizeProviderName(provider), normalizePricing(pricing));
    }
  }

  getPricing(providerName) {
    const normalizedName = normalizeProviderName(providerName);
    return {
      ...(this.pricing.get(normalizedName) ||
        this.pricing.get("Other") ||
        DEFAULT_PROVIDER_COSTS.Other),
    };
  }

  estimate(providerName, input = {}) {
    const pricing = this.getPricing(providerName);
    const resultCount = Math.max(
      0,
      Math.round(Number(input.resultCount ?? input.maxResults) || 0)
    );
    return Number(
      (
        pricing.perRequestUsd +
        pricing.perResultUsd * resultCount
      ).toFixed(6)
    );
  }
}

export { DEFAULT_PROVIDER_COSTS };
