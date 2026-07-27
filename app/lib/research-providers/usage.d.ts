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
  requestTimestamp: string;
  userId?: string;
  workspaceId?: string;
  queryHash: string;
  queryLabel: string;
  providerId: string;
  providerName: string;
  providerKind: ResearchProviderKind;
  cacheStatus: ResearchCacheStatus;
  cacheHit: boolean;
  providerExecuted: boolean;
  duplicateRequest: boolean;
  estimatedCostUsd: number;
  estimatedCostAvoidedUsd: number;
  resultCount: number;
  durationMs: number;
  status: ResearchUsageStatus;
};

export type ResearchUsageEventInput = Partial<ResearchUsageEvent> & {
  request?: ResearchProviderRequest;
};

export interface ResearchUsageTracker {
  record(event: ResearchUsageEventInput): Promise<void> | void;
}

export type ResearchUsageFilter = {
  userId?: string;
  workspaceId?: string;
  providerId?: string;
  from?: string | number | Date;
  to?: string | number | Date;
};

export interface ResearchUsageStore extends ResearchUsageTracker {
  list(
    filter?: ResearchUsageFilter
  ): Promise<ResearchUsageEvent[]> | ResearchUsageEvent[];
}

export type ResearchCacheEfficiencyMetrics = {
  cacheHits: number;
  cacheMisses: number;
  savedRequestsEstimate: number;
  cacheHitRate: number;
  estimatedCostSavingsUsd: number;
};

export type ResearchAdminMetrics = {
  researchCalls: number;
  completedCalls: number;
  failedCalls: number;
  estimatedApiCostUsd: number;
  cacheHitRate: number;
  cacheEfficiency: ResearchCacheEfficiencyMetrics;
  mostExpensiveQueries: Array<{
    queryHash: string;
    queryLabel: string;
    callCount: number;
    estimatedCostUsd: number;
  }>;
  providerUsage: Array<{
    providerId: string;
    providerName: string;
    callCount: number;
    estimatedCostUsd: number;
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: number;
    resultCount: number;
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
export function calculateTotalEstimatedSpend(
  events: ResearchUsageEventInput[]
): number;
export function calculateResearchCacheEfficiency(
  events: ResearchUsageEventInput[]
): ResearchCacheEfficiencyMetrics;

export class InMemoryResearchUsageTracker
  implements ResearchUsageStore
{
  record(event: ResearchUsageEventInput): Promise<void>;
  list(filter?: ResearchUsageFilter): Promise<ResearchUsageEvent[]>;
  snapshot(): ResearchUsageEvent[];
  clear(): void;
}
