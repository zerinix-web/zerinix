export type ResearchEvidenceType =
  | "News"
  | "Government"
  | "Research Paper"
  | "Company Website"
  | "Financial Filing"
  | "Industry Report"
  | "AI Generated";

export type EvidenceProvenance = {
  collector: string;
  provider?: string;
  sourceId?: string;
  originalUrl?: string;
  collectedAt: string;
};

export type ResearchEvidence = {
  title: string;
  source: string;
  url: string;
  publishedAt: string | null;
  author: string | null;
  snippet: string;
  relevanceScore: number;
  reliabilityScore: number;
  evidenceType: ResearchEvidenceType;
  language: string;
  extractedFacts: string[];
  provenance: EvidenceProvenance[];
  duplicateCount: number;
  independentConfirmations: number;
  rankingScore: number;
};

export type ResearchEvidenceInput = Partial<
  Omit<
    ResearchEvidence,
    "provenance" | "duplicateCount" | "independentConfirmations" | "rankingScore"
  >
> & {
  provenance?: Partial<EvidenceProvenance>[];
};

export const RESEARCH_EVIDENCE_TYPES: readonly ResearchEvidenceType[];
export function clampEvidenceScore(value: unknown, fallback?: number): number;
export function normalizeEvidenceText(value: unknown): string;
export function normalizeEvidenceUrl(value: unknown): string;
export function getEvidenceDomain(value: string): string;
export function canonicalEvidenceKey(evidence: ResearchEvidence): string;

