import type { ResearchEvidence } from "../research-evidence/model.mjs";
import type { EvidenceCollector } from "../research-evidence/collector.mjs";
import type { ResearchCache } from "./cache.mjs";
import type {
  ResearchCostController,
  ResearchRequestCoalescer,
} from "./cost.mjs";
import type {
  ResearchCostEstimate,
  ResearchProvider,
  ResearchProviderKind,
  ResearchProviderMetadata,
  ResearchProviderRequest,
  ResearchRequestInput,
} from "./model.mjs";
import type { ResearchQueryPolicy } from "./policy.mjs";
import type { ResearchProviderRegistry } from "./registry.mjs";
import type {
  ResearchCacheStatus,
  ResearchUsageTracker,
} from "./usage.mjs";

export type ResearchExecutionResult = {
  request: ResearchProviderRequest;
  evidence: ResearchEvidence[];
  providerMetadata: ResearchProviderMetadata;
  estimatedCost: ResearchCostEstimate;
  cacheStatus: ResearchCacheStatus;
};

export type ResearchExecutionOptions = {
  providerId?: string;
  providerKind?: ResearchProviderKind;
  userId?: string;
  maxEstimatedCostUsd?: number;
  allowTopicReuse?: boolean;
  cacheTtlMs?: number;
  now?: string | number | Date;
};

export type ResearchCoordinatorOptions = {
  providers?: ResearchProvider[];
  registry?: ResearchProviderRegistry;
  policy?: ResearchQueryPolicy;
  cache?: ResearchCache<ResearchExecutionResult>;
  costController?: ResearchCostController;
  usageTracker?: ResearchUsageTracker;
  coalescer?: ResearchRequestCoalescer;
  evidenceCollector?: EvidenceCollector;
};

export class ResearchCoordinator {
  constructor(options?: ResearchCoordinatorOptions);
  research(
    input: ResearchRequestInput,
    options?: ResearchExecutionOptions
  ): Promise<ResearchExecutionResult>;
}

