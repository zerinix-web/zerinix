import type { ResearchEvidenceInput } from "../research-evidence/model.mjs";

export type ResearchProviderKind =
  | "Search API"
  | "News"
  | "Research Paper"
  | "Company Data";

export type ResearchFreshnessRequirement =
  | { mode: "any" }
  | { mode: "recent"; maxAgeDays: number }
  | { mode: "since"; since: string };

export type ResearchProviderRequest = {
  query: string;
  language: string;
  region: string;
  maxResults: number;
  freshness: ResearchFreshnessRequirement;
  industry?: string;
  topics: string[];
};

export type ResearchProviderMetadata = {
  providerId: string;
  providerKind: ResearchProviderKind;
  requestId?: string;
  executedAt: string;
  resultCount: number;
  durationMs?: number;
  cacheableUntil?: string;
  notes?: string[];
};

export type ResearchCostEstimate = {
  currency: "USD";
  estimatedCostUsd: number;
  billableUnits: number;
  unitName: string;
  freeTierEligible: boolean;
};

export type ResearchProviderResult = {
  rawEvidenceItems: ResearchEvidenceInput[];
  metadata: ResearchProviderMetadata;
  estimatedCost: ResearchCostEstimate;
};

/**
 * Future providers own their credentials in server-only implementation modules.
 * Requests and execution contexts intentionally contain no key/token fields.
 */
export interface ResearchProvider {
  readonly id: string;
  readonly kind: ResearchProviderKind;
  supports(request: ResearchProviderRequest): boolean;
  estimateCost(
    request: ResearchProviderRequest
  ): ResearchCostEstimate | Promise<ResearchCostEstimate>;
  research(
    request: ResearchProviderRequest
  ): Promise<ResearchProviderResult>;
}

export type ResearchRequestInput = {
  query?: unknown;
  language?: unknown;
  region?: unknown;
  maxResults?: unknown;
  freshness?: unknown;
  industry?: unknown;
  topics?: unknown;
};

export const RESEARCH_PROVIDER_KINDS: readonly ResearchProviderKind[];
export const RESEARCH_FRESHNESS_MODES: readonly ResearchFreshnessRequirement["mode"][];
export function normalizeProviderText(value: unknown, maxLength?: number): string;
export function stableResearchHash(value: unknown): string;

