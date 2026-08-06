// Extracted verbatim from components/Planner.tsx as the first safe
// refactor step: a self-contained "decision/recommendation label
// normalization" responsibility. Both functions are pure string ->
// string transforms with no dependency on any other Planner-local
// helper, component state, or hooks -- they were already declared at
// module scope in Planner.tsx, so moving them here changes nothing
// about their behavior.
//
// Note: formatDecisionLabel's fallback (Title Case) intentionally
// differs from detectRecommendation's fallback (uppercase passthrough,
// via its own local normalizeDecision) for inputs outside the three
// explicitly handled cases -- e.g. "PASS" stays "PASS" from
// detectRecommendation but becomes "Pass" from formatDecisionLabel.
// This is preserved exactly as-is, not reconciled, since doing so
// would be a behavior change outside the scope of this refactor.

export function detectRecommendation(content: string) {
  const normalizeDecision = (decision: string) => {
    const normalized = decision.trim().replace(/\s+/g, " ").toUpperCase();

    if (normalized === "NO GO" || normalized === "REJECT") return "REJECT";
    if (normalized === "GO" || normalized === "RAISE" || normalized === "BOOTSTRAP") {
      return "VALIDATE";
    }
    if (normalized === "WAIT" || normalized === "HOLD FOR VALIDATION") return "HOLD";

    return normalized;
  };
  const explicit = content.match(
    /\b(?:recommendation|decision|karar)\s*[:\-–—]\s*([A-Z][A-Z ]{1,34})\b/i
  );
  const explicitDecision = explicit?.[1]?.trim().replace(/\s+/g, " ").toUpperCase();

  if (explicitDecision && !["CONFIDENCE", "INVESTMENT", "MAIN RISK"].includes(explicitDecision)) {
    return normalizeDecision(explicitDecision);
  }

  const match = content.match(/\b(HOLD FOR VALIDATION|VALIDATE|HOLD|REJECT|GO|PASS|NO GO|WAIT|PIVOT|RAISE|BOOTSTRAP)\b/i);
  const recommendation = match?.[1]?.toUpperCase() || "";

  return normalizeDecision(recommendation);
}

export function formatDecisionLabel(decision: string) {
  const normalized = decision.trim().replace(/\s+/g, " ").toUpperCase();

  if (normalized === "HOLD FOR VALIDATION" || normalized === "WAIT") {
    return "HOLD";
  }

  if (normalized === "GO" || normalized === "RAISE" || normalized === "BOOTSTRAP") {
    return "VALIDATE";
  }

  return normalized
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
