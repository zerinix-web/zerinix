import type {
  ResearchCostEstimate,
  ResearchProvider,
  ResearchProviderRequest,
  ResearchProviderResult,
} from "../model.mjs";

export type TavilyCostMetadata = {
  providerId: string;
  providerName: "Tavily";
  estimatedCostUsd: number;
  billableUnits: number;
  queryHash: string;
  queryLength: number;
  language: string;
  region: string;
  maxResults: number;
  freshnessMode: ResearchProviderRequest["freshness"]["mode"];
};

export type TavilyLogger = {
  info(scope: string, metadata: Record<string, unknown>): void;
  error(scope: string, metadata: Record<string, unknown>): void;
};

export type TavilyResearchProviderOptions = {
  id?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  estimatedCostPerCreditUsd?: number;
  onCostEstimate?: (
    metadata: TavilyCostMetadata
  ) => Promise<void> | void;
  logger?: TavilyLogger;
  clock?: () => Date;
};

export class TavilyProviderError extends Error {
  status: number;
  code: string;
}
export class TavilyRateLimitError extends TavilyProviderError {
  retryAfterSeconds: number | null;
}
export class TavilyTimeoutError extends TavilyProviderError {
  timeoutMs: number;
}

export class TavilyResearchProvider implements ResearchProvider {
  readonly id: string;
  readonly name: "Tavily";
  readonly kind: "Search API";
  constructor(options?: TavilyResearchProviderOptions);
  supports(request: ResearchProviderRequest): boolean;
  estimateCost(request?: ResearchProviderRequest): ResearchCostEstimate;
  buildRequestBody(request: ResearchProviderRequest): Record<string, unknown>;
  research(request: ResearchProviderRequest): Promise<ResearchProviderResult>;
}
