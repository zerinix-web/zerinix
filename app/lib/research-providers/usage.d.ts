import type {
  ResearchProviderKind,
  ResearchProviderRequest,
} from "./model.mjs";

export type ResearchCacheStatus =
  | "miss"
  | "exact-hit"
  | "topic-hit"
  | "coalesced";
export type ResearchUsageStatus = "completed" | "failed";

export type ResearchUsageEvent = {
  occurredAt: string;
  userId?: string;
  queryHash: string;
  queryLabel: string;
  providerId: string;
  providerKind: ResearchProviderKind;
  cacheStatus: ResearchCacheStatus;
  duplicateRequest: boolean;
  estimatedCostUsd: number;
  resultCount: number;
  durationMs: number;
  status: ResearchUsageStatus;
};

export type ResearchUsageEventInput = Partial<
  Omit<ResearchUsageEvent, "queryHash" | "queryLabel">
> & {
  request: ResearchProviderRequest;
};

export interface ResearchUsageTracker {
  record(event: ResearchUsageEventInput): Promise<void> | void;
}

export type ResearchAdminMetrics = {
  researchCalls: number;
  completedCalls: number;
  failedCalls: number;
  estimatedApiCostUsd: number;
  cacheHitRate: number;
  mostExpensiveQueries: Array<{
    queryHash: string;
    queryLabel: string;
    callCount: number;
    estimatedCostUsd: number;
  }>;
  providerUsage: Array<{
    providerId: string;
    callCount: number;
    estimatedCostUsd: number;
    cacheHits: number;
    failures: number;
  }>;
};

export function createResearchUsageEvent(
  input: ResearchUsageEventInput
): ResearchUsageEvent;
export function createResearchAdminMetrics(
  events: ResearchUsageEventInput[],
  options?: { expensiveQueryLimit?: number }
): ResearchAdminMetrics;

export class InMemoryResearchUsageTracker
  implements ResearchUsageTracker
{
  record(event: ResearchUsageEventInput): Promise<void>;
  snapshot(): ResearchUsageEvent[];
  clear(): void;
}
