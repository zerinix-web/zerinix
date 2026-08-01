import type {
  DecisionEvidence,
  EvidenceCategory,
  ExtractedFact,
} from "./contracts";

function providerFor(category: EvidenceCategory, source: string) {
  if (category === "Verified Asset") return "asset_extraction";
  if (category === "Official Source") return "official_source";
  if (category === "External Research") return "external_research";
  if (/user prompt/i.test(source)) return "user";
  return "decision_intelligence";
}

export function convertExtractedFactsToEvidence(
  facts: readonly ExtractedFact[],
  checkedAt = new Date().toISOString()
): DecisionEvidence[] {
  return facts.map((fact, index) => ({
    id: `A${index + 1}`,
    field: fact.field,
    title: fact.field.replace(/_/g, " "),
    summary: `${fact.field} extracted from ${fact.source}.`,
    value: fact.value,
    source: fact.source,
    url: "",
    provider: providerFor(fact.category, fact.source),
    confidence: fact.confidence,
    official: fact.category === "Official Source",
    verified: fact.verified,
    publishedDate: "",
    lastChecked: checkedAt,
    supportingData: [fact.value],
    category: fact.category,
    impact: "unknown",
    impactReason: "An extracted fact is not favorable or adverse by itself.",
    sourceType:
      fact.category === "Verified Asset" ? "uploaded_asset" : "extracted_fact",
    authorityLevel:
      fact.category === "Verified Asset"
        ? "uploaded"
        : fact.category === "Official Source"
          ? "primary"
          : /user prompt/i.test(fact.source)
            ? "user"
            : "method",
  }));
}
