export class ResearchBudgetExceededError extends Error {
  constructor(estimatedCostUsd, limitUsd) {
    super(
      `Estimated research cost $${estimatedCostUsd.toFixed(4)} exceeds the configured request limit of $${limitUsd.toFixed(4)}.`
    );
    this.name = "ResearchBudgetExceededError";
    this.estimatedCostUsd = estimatedCostUsd;
    this.limitUsd = limitUsd;
  }
}

function normalizeCostEstimate(value) {
  const estimatedCostUsd = Number(value?.estimatedCostUsd);
  const billableUnits = Number(value?.billableUnits);

  return {
    currency: "USD",
    estimatedCostUsd: Number.isFinite(estimatedCostUsd)
      ? Math.max(0, estimatedCostUsd)
      : 0,
    billableUnits: Number.isFinite(billableUnits)
      ? Math.max(0, billableUnits)
      : 0,
    unitName: String(value?.unitName || "request").slice(0, 80),
    freeTierEligible: Boolean(value?.freeTierEligible),
  };
}

export class ResearchCostController {
  constructor(options = {}) {
    this.maxEstimatedCostUsd = Number.isFinite(options.maxEstimatedCostUsd)
      ? Math.max(0, options.maxEstimatedCostUsd)
      : 1;
  }

  async estimate(provider, request) {
    return normalizeCostEstimate(await provider.estimateCost(request));
  }

  assertWithinBudget(estimate, options = {}) {
    const limit = Number.isFinite(options.maxEstimatedCostUsd)
      ? Math.max(0, options.maxEstimatedCostUsd)
      : this.maxEstimatedCostUsd;

    if (estimate.estimatedCostUsd > limit) {
      throw new ResearchBudgetExceededError(
        estimate.estimatedCostUsd,
        limit
      );
    }

    return estimate;
  }
}

export class ResearchRequestCoalescer {
  constructor() {
    this.pending = new Map();
  }

  run(key, factory) {
    if (this.pending.has(key)) {
      return this.pending.get(key);
    }

    const promise = Promise.resolve()
      .then(factory)
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);

    return promise;
  }

  has(key) {
    return this.pending.has(key);
  }

  get size() {
    return this.pending.size;
  }
}
