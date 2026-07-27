import type {
  ResearchCostEstimate,
  ResearchProvider,
  ResearchProviderRequest,
} from "./model.mjs";

export class ResearchBudgetExceededError extends Error {
  estimatedCostUsd: number;
  limitUsd: number;
}

export class ResearchCostController {
  constructor(options?: { maxEstimatedCostUsd?: number });
  estimate(
    provider: ResearchProvider,
    request: ResearchProviderRequest
  ): Promise<ResearchCostEstimate>;
  assertWithinBudget(
    estimate: ResearchCostEstimate,
    options?: { maxEstimatedCostUsd?: number }
  ): ResearchCostEstimate;
}

export class ResearchRequestCoalescer {
  readonly size: number;
  has(key: string): boolean;
  run<T>(key: string, factory: () => Promise<T> | T): Promise<T>;
}
