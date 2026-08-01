import type {
  DecisionEvidence,
  DomainDecisionRule,
  EvidenceValidation,
} from "./contracts";

function isDecisionGradeEvidence(item: DecisionEvidence) {
  return (
    item.verified &&
    item.value.trim().length > 0 &&
    (item.category === "Verified Asset" || /^https?:\/\//i.test(item.url))
  );
}

export function reasonAboutDecisionRule({
  rule,
  validation,
  researchCompletion,
  verifiedFactRatio,
}: {
  rule: DomainDecisionRule;
  validation: EvidenceValidation;
  researchCompletion: number;
  verifiedFactRatio: number;
}) {
  const relevantEvidence = validation.evidence.filter(
    (item) =>
      isDecisionGradeEvidence(item) &&
      (rule.evidenceFields.length === 0 ||
        rule.evidenceFields.includes(item.field))
  );
  const bestEvidenceByField = new Map<string, DecisionEvidence>();
  relevantEvidence.forEach((item) => {
    const current = bestEvidenceByField.get(item.field);
    if (!current || item.confidence > current.confidence) {
      bestEvidenceByField.set(item.field, item);
    }
  });
  const strongestEvidence = [...bestEvidenceByField.values()];
  const evidenceStrength = strongestEvidence.length
    ? strongestEvidence.reduce((sum, item) => sum + item.confidence, 0) /
      strongestEvidence.length
    : 0;
  const relevantConflicts = validation.conflicts.filter((conflict) =>
    rule.riskFields.includes(conflict.field)
  );
  const assessedEvidence = strongestEvidence.filter(
    (item) => item.impact && item.impact !== "unknown"
  );
  const impactScore = assessedEvidence.length
    ? assessedEvidence.reduce(
        (sum, item) =>
          sum +
          (item.impact === "favorable"
            ? 100
            : item.impact === "neutral"
              ? 50
              : 0),
        0
      ) / assessedEvidence.length
    : 50;

  return {
    relevantEvidence,
    relevantConflicts,
    evidenceStrength,
    impactScore,
    assessedEvidenceCount: assessedEvidence.length,
    researchCompletion,
    verifiedFactRatio,
    explanation: `${rule.label} uses ${Math.round(
      validation.coverage
    )}% critical-field coverage, ${Math.round(
      evidenceStrength
    )}% evidence strength, ${Math.round(
      researchCompletion
    )}% required-research completion, ${Math.round(
      impactScore
    )}% evidence impact, and ${relevantConflicts.length} relevant conflict(s).`,
  };
}
