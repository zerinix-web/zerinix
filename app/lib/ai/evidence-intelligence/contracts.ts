import { z } from "zod";

export const evidenceCategorySchema = z.enum([
  "Ownership",
  "Legal",
  "Zoning",
  "Market",
  "Infrastructure",
  "Environmental",
  "Financial",
  "Demographic",
  "Transportation",
  "Satellite",
  "News",
  "Comparable Sales",
]);

export const evidenceIntelligenceStatusSchema = z.enum([
  "verified",
  "pending_verification",
  "conflicting",
  "inferred",
  "missing",
]);

export const evidenceCitationSchema = z.object({
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.string().url(),
  accessedAt: z.string(),
});

export const evidenceQualityScoresSchema = z.object({
  reliabilityScore: z.number().min(0).max(1),
  freshnessScore: z.number().min(0).max(1),
  authorityScore: z.number().min(0).max(1),
  completenessScore: z.number().min(0).max(1),
  evidenceQualityScore: z.number().min(0).max(1),
});

export const structuredEvidenceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  sourceName: z.string().min(1),
  sourceType: z.string().min(1),
  sourceAuthority: z.number().min(0).max(1),
  evidenceCategory: evidenceCategorySchema,
  evidenceStatus: evidenceIntelligenceStatusSchema,
  confidence: z.number().min(0).max(1),
  freshness: z.number().min(0).max(1),
  collectedAt: z.string(),
  supportsDecision: z.boolean(),
  contradictsDecision: z.boolean(),
  relatedRisks: z.array(z.string()),
  relatedOpportunities: z.array(z.string()),
  citations: z.array(evidenceCitationSchema),
  reliabilityScore: z.number().min(0).max(1),
  freshnessScore: z.number().min(0).max(1),
  authorityScore: z.number().min(0).max(1),
  completenessScore: z.number().min(0).max(1),
  evidenceQualityScore: z.number().min(0).max(1),
  quality: evidenceQualityScoresSchema,
  field: z.string().min(1),
  decisionImpact: z.enum(["critical", "high", "medium", "low", "unknown"]),
  mergedEvidenceIds: z.array(z.string()).min(1),
});

export const evidenceIntelligenceConflictSchema = z.object({
  id: z.string().min(1),
  evidenceCategory: evidenceCategorySchema,
  field: z.string().min(1),
  evidenceIds: z.array(z.string()).min(2),
  competingClaims: z.array(z.string()).min(2),
  sourceNames: z.array(z.string()),
  preferredEvidenceId: z.string(),
  status: z.enum(["resolved_by_quality", "unresolved"]),
  qualityGap: z.number().min(0).max(1),
  explanation: z.string().min(1),
});

const evidenceSummaryItemSchema = z.object({
  evidenceId: z.string().min(1),
  statement: z.string().min(1),
});

export const evidenceIntelligenceSummarySchema = z.object({
  verifiedFacts: z.array(evidenceSummaryItemSchema),
  pendingVerification: z.array(evidenceSummaryItemSchema),
  conflictingEvidence: z.array(
    z.object({
      conflictId: z.string().min(1),
      statement: z.string().min(1),
    })
  ),
  missingEvidence: z.array(z.string()),
  criticalUnknowns: z.array(z.string()),
  evidenceCoverage: z.number().min(0).max(100),
  averageEvidenceQuality: z.number().min(0).max(1),
  averageAuthority: z.number().min(0).max(1),
  averageFreshness: z.number().min(0).max(1),
});

export const evidenceIntelligenceResultSchema = z.object({
  version: z.literal("evidence_intelligence_v2"),
  evidence: z.array(structuredEvidenceSchema),
  conflicts: z.array(evidenceIntelligenceConflictSchema),
  summary: evidenceIntelligenceSummarySchema,
});

export type StructuredEvidence = z.infer<typeof structuredEvidenceSchema>;
export type EvidenceIntelligenceConflict = z.infer<
  typeof evidenceIntelligenceConflictSchema
>;
export type EvidenceIntelligenceResult = z.infer<
  typeof evidenceIntelligenceResultSchema
>;
