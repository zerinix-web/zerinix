// Market Intelligence Research V2 -- evidence completeness check.
//
// Deliberately simple and explicit: a field is "resolved" only if it has
// at least one grounded (verified) evidence item. Nothing here fabricates
// or infers evidence to close a gap -- an unresolved field stays
// unresolved and is reported as such.
import type {
  MarketFieldResearchOutcome,
  MarketResearchCompleteness,
} from "./types.ts";

function verifiedCount(outcome: MarketFieldResearchOutcome) {
  return outcome.items.filter((item) => item.verified).length;
}

export function assessMarketEvidenceCompleteness(
  outcomes: readonly MarketFieldResearchOutcome[]
): MarketResearchCompleteness {
  const attemptedFields = outcomes.map((outcome) => outcome.task.field);
  const unresolvedFields = outcomes
    .filter((outcome) => verifiedCount(outcome) === 0)
    .map((outcome) => outcome.task.field);

  const requiredOutcomes = outcomes.filter((outcome) => outcome.task.required);
  const requiredWithEvidence = requiredOutcomes.filter(
    (outcome) => verifiedCount(outcome) > 0
  );
  const requiredResearchCompletion = requiredOutcomes.length
    ? Math.round((requiredWithEvidence.length / requiredOutcomes.length) * 100)
    : 100;

  const totalVerifiedEvidence = outcomes.reduce(
    (sum, outcome) => sum + verifiedCount(outcome),
    0
  );
  const researchCompleted =
    requiredResearchCompletion === 100 && totalVerifiedEvidence > 0;

  // Only block entirely (clarification) when literally nothing verifiable
  // was found anywhere -- the same conservative bar the pipeline already
  // used elsewhere: a partially incomplete but non-empty registry still
  // produces a preliminary report rather than a hard refusal.
  const recommendedOutput =
    totalVerifiedEvidence === 0
      ? ("clarification" as const)
      : requiredResearchCompletion < 100
        ? ("preliminary_report" as const)
        : ("full_report" as const);

  return {
    attemptedFields,
    unresolvedFields,
    requiredResearchCompletion,
    researchCompleted,
    recommendedOutput,
  };
}
