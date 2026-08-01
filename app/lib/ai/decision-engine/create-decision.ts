import type { DynamicReportPlan } from "../dynamic-report-plan.ts";
import type { ExpertiseProfile } from "../expertise-profile.ts";
import type { EvidenceScoringResult, ScoredEvidenceFinding } from "../evidence-scoring/index.ts";
import type { ValidatedEvidenceCollection } from "../research-execution/evidence-decision-support.ts";
import {
  professionalDecisionSchema,
  type ProfessionalDecision,
} from "./contracts.ts";

type DecisionInput = {
  expertiseProfile: ExpertiseProfile;
  reportPlan: DynamicReportPlan;
  validation: ValidatedEvidenceCollection;
  scoring: EvidenceScoringResult;
};

const impactWeight = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
} as const;

function clamp(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function unique(values: readonly string[], limit = 8) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

function rankFindings(findings: ScoredEvidenceFinding[]) {
  return [...findings].sort(
    (left, right) =>
      impactWeight[right.decisionImpact] - impactWeight[left.decisionImpact] ||
      right.finalEvidenceScore - left.finalEvidenceScore
  );
}

function materialFindings(
  validation: ValidatedEvidenceCollection,
  scoring: EvidenceScoringResult
) {
  const validationById = new Map(validation.findings.map((finding) => [finding.id, finding]));
  const supersededConflictFindingIds = new Set(
    scoring.conflicts.flatMap((conflict) =>
      conflict.preferredFindingId
        ? conflict.findingIds.filter((id) => id !== conflict.preferredFindingId)
        : []
    )
  );
  return rankFindings(
    scoring.findings.filter((finding) => {
      const validated = validationById.get(finding.id);
      return Boolean(
        validated &&
        !supersededConflictFindingIds.has(finding.id) &&
        finding.scoreBand !== "low" &&
        finding.evidenceState !== "unresolved" &&
        finding.evidenceState !== "assumption"
      );
    })
  ).map((scored) => ({ scored, validated: validationById.get(scored.id)! }));
}

function decisionBasis(
  item: ReturnType<typeof materialFindings>[number],
  fallbackPriority: "critical" | "high" | "medium" | "low" = "medium"
) {
  return {
    statement: item.validated.claim,
    whyItMatters: item.validated.reason,
    evidenceIds: [item.validated.id],
    score: item.scored.finalEvidenceScore,
    priority:
      item.scored.decisionImpact === "unknown"
        ? fallbackPriority
        : item.scored.decisionImpact,
  };
}

function criticalMissing(validation: ValidatedEvidenceCollection) {
  return validation.decisionGates
    .filter(
      (gate) =>
        gate.status !== "passed" &&
        (gate.decisionImpact === "critical" || gate.decisionImpact === "high")
    )
    .map((gate) => ({
      information: gate.condition,
      whyItBlocksDecision: `The ${gate.decisionImpact} decision gate is ${gate.status}, so the requested decision cannot be supported conclusively.`,
      requiredAction: gate.requiredNextAction,
      decisionGateId: gate.id,
    }));
}

function decisionConflicts({
  validation,
  scoring,
}: Pick<DecisionInput, "validation" | "scoring">) {
  const findingById = new Map(validation.findings.map((finding) => [finding.id, finding]));
  const scoredByConflict = new Map(scoring.conflicts.map((conflict) => [conflict.conflictId, conflict]));
  return validation.conflicts.map((conflict) => {
    const scored = scoredByConflict.get(conflict.id);
    return {
      field: conflict.field,
      competingClaims: conflict.findingIds.flatMap((id) => {
        const finding = findingById.get(id);
        return finding ? [finding.claim] : [];
      }),
      preferredClaim: scored?.preferredFindingId
        ? findingById.get(scored.preferredFindingId)?.claim || ""
        : "",
      explanation:
        scored?.explanation ||
        "The conflict remains unresolved because no evidence item has a defensible quality advantage.",
      decisionImpact: conflict.decisionImpact,
    };
  });
}

function chooseOutcome({
  material,
  missing,
  conflicts,
  preferredConflictFindingIds,
}: {
  material: ReturnType<typeof materialFindings>;
  missing: ReturnType<typeof criticalMissing>;
  conflicts: ReturnType<typeof decisionConflicts>;
  preferredConflictFindingIds: Set<string>;
}): ProfessionalDecision["outcome"] {
  const verifiedAdverse = material.some(
    ({ scored, validated }) =>
      validated.impactDirection === "adverse" &&
      (scored.scoreBand === "high" || preferredConflictFindingIds.has(scored.id)) &&
      (scored.decisionImpact === "critical" || scored.decisionImpact === "high") &&
      validated.evidenceState === "officially_verified"
  );
  if (verifiedAdverse) return "avoid";

  const unresolvedMaterialConflict = conflicts.some(
    (conflict) =>
      !conflict.preferredClaim &&
      (conflict.decisionImpact === "critical" || conflict.decisionImpact === "high")
  );
  if (missing.length || unresolvedMaterialConflict) return "wait";
  if (!material.length) return "insufficient_evidence";

  const favorable = material.filter(
    ({ validated }) => validated.impactDirection === "favorable"
  );
  const adverse = material.filter(
    ({ validated }) => validated.impactDirection === "adverse"
  );
  if (!favorable.length || adverse.length) return "conditional_proceed";
  return "proceed";
}

function confidenceAssessment({
  material,
  missing,
  conflicts,
  scoring,
}: {
  material: ReturnType<typeof materialFindings>;
  missing: ReturnType<typeof criticalMissing>;
  conflicts: ReturnType<typeof decisionConflicts>;
  scoring: EvidenceScoringResult;
}) {
  const weightedEvidence = material.length
    ? material.reduce(
        (sum, item) =>
          sum +
          item.scored.finalEvidenceScore *
            Math.max(1, impactWeight[item.scored.decisionImpact]),
        0
      ) /
      material.reduce(
        (sum, item) => sum + Math.max(1, impactWeight[item.scored.decisionImpact]),
        0
      )
    : 0.15;
  const intelligence = scoring.intelligence.summary;
  const qualityContribution = intelligence.averageEvidenceQuality * 0.35;
  const coverageContribution = (intelligence.evidenceCoverage / 100) * 0.2;
  const authorityContribution = intelligence.averageAuthority * 0.2;
  const freshnessContribution = intelligence.averageFreshness * 0.15;
  const materialContribution = weightedEvidence * 0.1;
  const missingPenalty = Math.min(0.3, missing.length * 0.075);
  const unresolvedConflictCount = scoring.intelligence.conflicts.filter(
    (conflict) => conflict.status === "unresolved"
  ).length;
  const resolvedConflictCount = Math.max(
    0,
    scoring.intelligence.conflicts.length - unresolvedConflictCount
  );
  const conflictPenalty = Math.min(
    0.25,
    unresolvedConflictCount * 0.1 + resolvedConflictCount * 0.025
  );
  const score = clamp(
    qualityContribution +
      coverageContribution +
      authorityContribution +
      freshnessContribution +
      materialContribution -
      missingPenalty -
      conflictPenalty
  );
  const positiveDrivers = unique([
    ...material
      .filter(({ scored }) => scored.scoreBand === "high")
      .slice(0, 3)
      .map(({ validated }) => validated.claim),
    ...(intelligence.averageAuthority >= 0.75
      ? ["The evidence set has strong source authority."]
      : []),
    ...(intelligence.evidenceCoverage >= 75
      ? [`Evidence coverage is ${intelligence.evidenceCoverage}%.`]
      : []),
    ...(intelligence.averageFreshness >= 0.75
      ? ["The material evidence is sufficiently current."]
      : []),
  ]);
  const limitingFactors = unique([
    ...missing.map((item) => item.information),
    ...conflicts
      .filter((conflict) => !conflict.preferredClaim)
      .map((conflict) => `Unresolved conflict: ${conflict.field}`),
    ...(material.every(({ scored }) => scored.scoreBand !== "high")
      ? ["No high-confidence evidence supports the decision."]
      : []),
    ...(intelligence.evidenceCoverage < 60
      ? [`Evidence coverage is limited to ${intelligence.evidenceCoverage}%.`]
      : []),
    ...(intelligence.averageAuthority < 0.5
      ? ["The available evidence has limited source authority."]
      : []),
    ...(intelligence.averageFreshness < 0.5
      ? ["The available evidence is stale or undated."]
      : []),
  ]);
  const level = score >= 0.75 ? "high" as const : score >= 0.5 ? "moderate" as const : "low" as const;

  return {
    score,
    level,
    explanation: `Confidence is ${level} (${score}). Evidence quality contributes ${clamp(qualityContribution)}, coverage contributes ${clamp(coverageContribution)}, authority contributes ${clamp(authorityContribution)}, freshness contributes ${clamp(freshnessContribution)}, and material decision support contributes ${clamp(materialContribution)}. Missing critical information reduces confidence by ${missingPenalty}; evidence conflicts reduce it by ${conflictPenalty}.`,
    positiveDrivers,
    limitingFactors,
  };
}

function executiveDecision(
  outcome: ProfessionalDecision["outcome"],
  goal: string
) {
  if (outcome === "avoid") {
    return `Do not proceed with ${goal}; verified material adverse evidence currently outweighs the supported upside.`;
  }
  if (outcome === "wait") {
    return `Defer ${goal} until the identified decision-blocking evidence or material contradiction is resolved.`;
  }
  if (outcome === "proceed") {
    return `Proceed with ${goal}; the strongest available evidence supports action and no critical decision gate remains unresolved.`;
  }
  if (outcome === "conditional_proceed") {
    return `Proceed with ${goal} only on a controlled, conditional basis because the evidence is directionally supportive but not uniformly favorable.`;
  }
  return `No defensible action can yet be recommended for ${goal}; the available evidence is not sufficient to support a professional decision.`;
}

function nextAction({
  outcome,
  missing,
  material,
  conflicts,
  reportPlan,
  expertiseProfile,
}: {
  outcome: ProfessionalDecision["outcome"];
  missing: ReturnType<typeof criticalMissing>;
  material: ReturnType<typeof materialFindings>;
  conflicts: ReturnType<typeof decisionConflicts>;
  reportPlan: DynamicReportPlan;
  expertiseProfile: ExpertiseProfile;
}) {
  const firstMissing = missing[0];
  if (firstMissing) {
    return {
      action: firstMissing.requiredAction,
      reason: `This action resolves the highest-priority missing condition: ${firstMissing.information}.`,
      supportingEvidenceIds: [],
      decisionGateIds: [firstMissing.decisionGateId],
    };
  }
  const unresolvedConflict = conflicts.find((conflict) => !conflict.preferredClaim);
  if (unresolvedConflict) {
    return {
      action: `Obtain a controlling, higher-authority source for ${unresolvedConflict.field}.`,
      reason: unresolvedConflict.explanation,
      supportingEvidenceIds: [],
      decisionGateIds: [],
    };
  }
  const lead = material[0];
  if (outcome === "avoid" && lead) {
    return {
      action: `Do not proceed unless higher-authority evidence disproves: ${lead.validated.claim}`,
      reason: lead.validated.reason,
      supportingEvidenceIds: [lead.validated.id],
      decisionGateIds: [],
    };
  }
  if (lead) {
    return {
      action: `Advance the next controlled step for ${reportPlan.primaryDecision}.`,
      reason: `The action is supported by the highest-priority finding: ${lead.validated.claim}`,
      supportingEvidenceIds: [lead.validated.id],
      decisionGateIds: [],
    };
  }
  const requiredEvidence = reportPlan.requiredEvidence[0] || expertiseProfile.requiredEvidence[0];
  return {
    action: requiredEvidence
      ? `Obtain and validate ${requiredEvidence}.`
      : "Obtain decision-specific primary evidence before acting.",
    reason: "No medium- or high-confidence evidence currently supports a substantive action.",
    supportingEvidenceIds: [],
    decisionGateIds: [],
  };
}

export function createProfessionalDecision(input: DecisionInput): ProfessionalDecision {
  const material = materialFindings(input.validation, input.scoring);
  const missing = criticalMissing(input.validation);
  const conflicts = decisionConflicts(input);
  const preferredConflictFindingIds = new Set(
    input.scoring.conflicts
      .map((conflict) => conflict.preferredFindingId)
      .filter(Boolean)
  );
  const outcome = chooseOutcome({
    material,
    missing,
    conflicts,
    preferredConflictFindingIds,
  });
  const adverse = material.filter(({ validated }) => validated.impactDirection === "adverse");
  const favorable = material.filter(({ validated }) => validated.impactDirection === "favorable");
  const neutral = material.filter(({ validated }) => validated.impactDirection === "neutral");
  const missingBases = missing.map((item) => ({
    statement: item.information,
    whyItMatters: item.whyItBlocksDecision,
    evidenceIds: [] as string[],
    score: 0,
    priority: "critical" as const,
  }));
  const unresolvedConflictBases = conflicts
    .filter((conflict) => !conflict.preferredClaim)
    .map((conflict) => ({
      statement: `Conflicting evidence remains unresolved for ${conflict.field}.`,
      whyItMatters: conflict.explanation,
      evidenceIds: [] as string[],
      score: 0,
      priority: conflict.decisionImpact,
    }));
  const rationaleCandidates = rankFindings([
    ...adverse.map((item) => item.scored),
    ...favorable.map((item) => item.scored),
    ...neutral.map((item) => item.scored),
  ]).slice(0, 5);
  const materialById = new Map(material.map((item) => [item.scored.id, item]));
  const evidenceRationale = rationaleCandidates.flatMap((finding) => {
    const item = materialById.get(finding.id);
    return item ? [decisionBasis(item)] : [];
  });
  const rationale = [
    ...(outcome === "wait" ? [...missingBases, ...unresolvedConflictBases] : []),
    ...evidenceRationale,
  ].slice(0, 5);
  if (!rationale.length) {
    rationale.push({
      statement: "Available evidence does not support a substantive professional decision.",
      whyItMatters: "Acting without material evidence would create an unsupported recommendation.",
      evidenceIds: [],
      score: 0,
      priority: "critical",
    });
  }

  return professionalDecisionSchema.parse({
    version: "professional_decision_v1",
    outcome,
    executiveDecision: executiveDecision(outcome, input.expertiseProfile.userGoal),
    topRisks: [
      ...adverse.map((item) => decisionBasis(item)),
      ...missingBases,
      ...unresolvedConflictBases,
    ].slice(0, 5),
    topOpportunities: favorable.slice(0, 5).map((item) => decisionBasis(item)),
    decisionRationale: rationale,
    recommendedNextAction: nextAction({
      outcome,
      missing,
      material,
      conflicts,
      reportPlan: input.reportPlan,
      expertiseProfile: input.expertiseProfile,
    }),
    confidence: confidenceAssessment({
      material,
      missing,
      conflicts,
      scoring: input.scoring,
    }),
    missingCriticalInformation: missing,
    conflicts,
  });
}
