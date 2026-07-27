import type {
  ResearchUsageEvent,
  ResearchUsageStore,
} from "./usage.mjs";

export type ResearchQuotaTier = "free" | "paid" | "enterprise";
export type ResearchQuotaReason =
  | "daily_count"
  | "monthly_count"
  | "monthly_cost";

export type ResearchQuotaRule = {
  dailyResearchCount: number;
  monthlyResearchCount: number;
  monthlyEstimatedCostUsd: number;
};
export type ResearchQuotaRules = Record<ResearchQuotaTier, ResearchQuotaRule>;
export type ResearchQuotaUsage = ResearchQuotaRule;
export type ResearchQuotaDecision = {
  allowed: boolean;
  tier: ResearchQuotaTier;
  reason: ResearchQuotaReason | null;
  limits: ResearchQuotaRule;
  usage: ResearchQuotaUsage;
  remaining: ResearchQuotaUsage;
  resetAt: string;
  message: string;
  reservationId?: string;
};
export type ResearchQuotaInput = {
  userId: string;
  workspaceId?: string;
  tier?: ResearchQuotaTier;
  estimatedCostUsd?: number;
  now?: string | number | Date;
};

export const RESEARCH_QUOTA_TIERS: readonly ResearchQuotaTier[];
export const DEFAULT_RESEARCH_QUOTA_RULES: Readonly<ResearchQuotaRules>;
export function createResearchQuotaRules(
  overrides?: Partial<Record<ResearchQuotaTier, Partial<ResearchQuotaRule>>>
): ResearchQuotaRules;

export class ResearchQuotaContextError extends Error {}
export class ResearchQuotaExceededError extends Error {
  code: "RESEARCH_QUOTA_EXCEEDED";
  decision: ResearchQuotaDecision;
}
export class ResearchQuotaChecker {
  constructor(options: {
    usageStore: ResearchUsageStore;
    rules?: Partial<
      Record<ResearchQuotaTier, Partial<ResearchQuotaRule>>
    >;
    clock?: () => string | number | Date;
  });
  check(input: ResearchQuotaInput): Promise<ResearchQuotaDecision>;
  checkAndReserve(
    input: ResearchQuotaInput
  ): Promise<ResearchQuotaDecision>;
  release(reservationId?: string): void;
  getRemainingUsage(input: Omit<ResearchQuotaInput, "estimatedCostUsd">): Promise<{
    tier: ResearchQuotaTier;
    limits: ResearchQuotaRule;
    usage: ResearchQuotaUsage;
    remaining: ResearchQuotaUsage;
  }>;
}

export type ResearchUsageStorageRecord = ResearchUsageEvent;
