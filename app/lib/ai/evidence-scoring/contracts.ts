import { z } from "zod";
import { evidenceStateSchema } from "../research-execution/evidence-decision-support.ts";

export const evidenceScoreBandSchema = z.enum(["high", "medium", "low"]);

export const evidenceScoreCriteriaSchema = z.object({
  relevance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  completeness: z.number().min(0).max(1),
  consistency: z.number().min(0).max(1),
});

export const scoredEvidenceFindingSchema = z.object({
  id: z.string().min(1),
  field: z.string().min(1),
  claim: z.string().min(1),
  evidenceState: evidenceStateSchema,
  sourceIds: z.array(z.string()),
  criteria: evidenceScoreCriteriaSchema,
  finalEvidenceScore: z.number().min(0).max(1),
  scoreBand: evidenceScoreBandSchema,
  decisionImpact: z.enum(["critical", "high", "medium", "low", "unknown"]),
  conflictStatus: z.enum(["none", "conflicted"]),
  scoreExplanation: z.string().min(1),
});

export const scoredConflictAssessmentSchema = z.object({
  conflictId: z.string().min(1),
  field: z.string().min(1),
  findingIds: z.array(z.string()).min(2),
  preferredFindingId: z.string(),
  confidenceGap: z.number().min(0).max(1),
  resolution: z.enum([
    "higher_scoring_evidence_preferred",
    "no_reliable_winner",
  ]),
  explanation: z.string().min(1),
});

export const evidenceScoringResultSchema = z.object({
  version: z.literal("evidence_scoring_v1"),
  findings: z.array(scoredEvidenceFindingSchema),
  bands: z.object({
    high: z.array(z.string()),
    medium: z.array(z.string()),
    low: z.array(z.string()),
  }),
  conflicts: z.array(scoredConflictAssessmentSchema),
});

export type ScoredEvidenceFinding = z.infer<typeof scoredEvidenceFindingSchema>;
export type EvidenceScoringResult = z.infer<typeof evidenceScoringResultSchema>;
