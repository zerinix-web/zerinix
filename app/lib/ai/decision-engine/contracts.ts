import { z } from "zod";

export const decisionOutcomeSchema = z.enum([
  "proceed",
  "conditional_proceed",
  "wait",
  "avoid",
  "insufficient_evidence",
]);

export const decisionConfidenceLevelSchema = z.enum([
  "high",
  "moderate",
  "low",
]);

const decisionBasisSchema = z.object({
  statement: z.string().min(1),
  whyItMatters: z.string().min(1),
  evidenceIds: z.array(z.string()),
  score: z.number().min(0).max(1),
  priority: z.enum(["critical", "high", "medium", "low"]),
});

const missingCriticalInformationSchema = z.object({
  information: z.string().min(1),
  whyItBlocksDecision: z.string().min(1),
  requiredAction: z.string().min(1),
  decisionGateId: z.string().min(1),
});

const decisionConflictSchema = z.object({
  field: z.string().min(1),
  competingClaims: z.array(z.string()).min(2),
  preferredClaim: z.string(),
  explanation: z.string().min(1),
  decisionImpact: z.enum(["critical", "high", "medium", "low"]),
});

export const professionalDecisionSchema = z.object({
  version: z.literal("professional_decision_v1"),
  outcome: decisionOutcomeSchema,
  executiveDecision: z.string().min(1),
  topRisks: z.array(decisionBasisSchema).max(5),
  topOpportunities: z.array(decisionBasisSchema).max(5),
  decisionRationale: z.array(decisionBasisSchema).min(1).max(5),
  recommendedNextAction: z.object({
    action: z.string().min(1),
    reason: z.string().min(1),
    supportingEvidenceIds: z.array(z.string()),
    decisionGateIds: z.array(z.string()),
  }),
  confidence: z.object({
    score: z.number().min(0).max(1),
    level: decisionConfidenceLevelSchema,
    explanation: z.string().min(1),
    positiveDrivers: z.array(z.string()),
    limitingFactors: z.array(z.string()),
  }),
  missingCriticalInformation: z.array(missingCriticalInformationSchema),
  conflicts: z.array(decisionConflictSchema),
});

export type ProfessionalDecision = z.infer<typeof professionalDecisionSchema>;
