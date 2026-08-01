import type {
  DecisionEvidence,
  ExtractedFact,
  ResearchProviderRequest,
  ResearchTask,
  ResearchTaskResult,
} from "../../decision-intelligence/contracts.ts";

export type ResearchProviderKind =
  | "internal_extraction"
  | "uploaded_document"
  | "ocr"
  | "url_analysis"
  | "web_search"
  | "tavily"
  | "openai_web_search"
  | "government_public_data"
  | "future_provider";

export type AdapterCitation = {
  title: string;
  url: string;
  excerpt?: string;
  accessedAt?: string;
};

export type ResearchAdapterResult = {
  source: string;
  confidence: number;
  evidence: unknown[];
  citations: unknown[];
  metadata: Record<string, unknown>;
  extractedFacts?: ExtractedFact[];
  attemptedFields?: string[];
  unresolvedFields?: string[];
  taskResults?: ResearchTaskResult[];
  summary?: string;
  responseId?: string;
};

export type ResearchProviderAdapter = {
  id: string;
  kind: ResearchProviderKind;
  priority: number;
  timeoutMs: number;
  canExecute(task: ResearchTask): boolean;
  execute(request: ResearchProviderRequest): Promise<ResearchAdapterResult>;
};

export type ProviderExecutionTiming = {
  providerKind: ResearchProviderKind;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  taskCount: number;
  attempts: number;
  status: "completed" | "partial" | "failed" | "timed_out";
};

export type ValidatedProviderResult = {
  adapterId: string;
  providerKind: ResearchProviderKind;
  confidence: number;
  evidence: DecisionEvidence[];
  citations: AdapterCitation[];
  metadata: Record<string, unknown>;
  extractedFacts: ExtractedFact[];
  attemptedFields: string[];
  unresolvedFields: string[];
  taskResults: ResearchTaskResult[];
  summary: string;
  responseId: string;
};

export type NormalizedEvidenceFinding = {
  id: string;
  taskId: string;
  field: string;
  claim: string;
  evidence: string;
  confidence: number;
  sourceIds: string[];
  citationIds: string[];
  official: boolean;
  metadata: {
    impact: "favorable" | "neutral" | "adverse" | "unknown";
    authorityLevel: string;
    trustBoundary: "untrusted_external_content" | "trusted_internal_content";
  };
};

export type NormalizedEvidenceCitation = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  accessedAt: string;
};

export type NormalizedEvidenceSource = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  sourceType: string;
  official: boolean;
};

export type EvidenceCollection = {
  findings: NormalizedEvidenceFinding[];
  citations: NormalizedEvidenceCitation[];
  sources: NormalizedEvidenceSource[];
  confidenceScore: number;
  missingInformation: string[];
  warnings: string[];
  timings: ProviderExecutionTiming[];
};

export type ResearchExecutionResult = {
  collection: EvidenceCollection;
  evidence: DecisionEvidence[];
  extractedFacts: ExtractedFact[];
  attemptedFields: string[];
  unresolvedFields: string[];
  taskResults: ResearchTaskResult[];
  summary: string;
  responseId: string;
};
