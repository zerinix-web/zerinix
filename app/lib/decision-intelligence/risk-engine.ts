import type {
  DomainProfile,
  EvidenceValidation,
} from "./contracts";

export function analyzeDecisionRisks({
  profile,
  validation,
}: {
  profile: DomainProfile;
  validation: EvidenceValidation;
}) {
  const unresolvedCritical = validation.unresolvedFields.filter((field) =>
    profile.criticalEvidence.includes(field)
  );
  const materialityOrder = [
    "title_status",
    "zoning",
    "access",
    "hazards",
    "comparables",
    "valuation_method",
    "infrastructure",
    "liquidity",
  ];
  const materiality = (field: string) => {
    const index = materialityOrder.indexOf(field);
    return index === -1 ? materialityOrder.length : index;
  };
  const conflictRisks = [...validation.conflicts]
    .sort((left, right) =>
      left.severity === right.severity
        ? 0
        : left.severity === "high"
          ? -1
          : right.severity === "high"
            ? 1
            : left.severity === "medium"
              ? -1
              : 1
    )
    .map((item) => item.explanation);
  const adverseRisks = validation.evidence
    .filter(
      (item) =>
        item.verified &&
        item.impact === "adverse" &&
        item.value.trim().length > 0 &&
        (item.category === "Verified Asset" || /^https?:\/\//i.test(item.url))
    )
    .sort(
      (left, right) =>
        materiality(left.field) - materiality(right.field) ||
        right.confidence - left.confidence
    )
    .map(
      (item) =>
        `${item.field}: ${item.impactReason || item.summary} [${item.id}]`
    );
  const unresolvedRisks = [...unresolvedCritical]
    .sort((left, right) => materiality(left) - materiality(right))
    .map(
      (field) => `Critical decision evidence remains unresolved: ${field}.`
    );
  const risks = [...new Set([
    ...conflictRisks,
    ...adverseRisks,
    ...unresolvedRisks,
  ])].slice(0, 3);
  const opportunities = [
    ...validation.evidence
      .filter(
        (item) =>
          item.verified &&
          item.impact === "favorable" &&
          item.value.trim().length > 0 &&
          (item.category === "Verified Asset" || /^https?:\/\//i.test(item.url))
      )
      .sort((left, right) => right.confidence - left.confidence)
      .map(
        (item) =>
          `${item.field}: ${item.impactReason || item.summary} [${item.id}]`
      ),
  ].filter((item, index, items) => items.indexOf(item) === index).slice(0, 3);

  return {
    risks,
    opportunities,
    unresolvedCritical,
    riskCoverage: profile.riskModel.map((risk) => ({
      risk,
      supported: validation.evidence.some(
        (item) =>
          item.verified &&
          item.value.trim().length > 0 &&
          (item.category === "Verified Asset" || /^https?:\/\//i.test(item.url)) &&
          (item.field.includes(risk) ||
            item.summary.toLowerCase().includes(risk.toLowerCase()))
      ),
    })),
  };
}
