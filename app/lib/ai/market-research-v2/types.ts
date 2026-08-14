// Market Intelligence Research V2 -- explicit typed contracts.
//
// V2 is an isolated replacement for the Market Intelligence research ->
// evidence layer only. It does not touch research execution, validators,
// report generation, scoring, PDF generation, or UI for any other report
// type, and its output is adapted (see adapter.ts) into the exact
// DomainResearchBundle shape the existing report generator already
// consumes -- so nothing downstream needs to change.
import type { ResearchTask } from "../../decision-intelligence/contracts.ts";

// The fixed, explicit vocabulary an evidence item's source can be
// classified as. Constrained via JSON schema enum on the model's own
// response -- never inferred afterward from keywords in prose.
export const marketEvidenceTypeValues = [
  "official_government",
  "official_statistics",
  "official_filing",
  "audited_statement",
  "regulator",
  "company_source",
  "credible_market_data",
  "professional_standard",
  "other",
] as const;

export type MarketEvidenceType = (typeof marketEvidenceTypeValues)[number];

// One explicit, fully-typed unit of evidence. Every field is populated
// directly from the model's structured response for exactly one requested
// evidence field -- no implicit labels, no keyword-guessed classification,
// no loosely inferred field names.
export type MarketEvidenceItem = {
  field: string;
  claim: string;
  value: string;
  sourceTitle: string;
  sourceUrl: string;
  publisher: string;
  publishedAt: string;
  evidenceType: MarketEvidenceType;
  confidence: number;
  // True only when sourceUrl matches a citation the web-search tool itself
  // returned for this request (see execute.ts's collectCitedUrls) -- i.e.
  // grounded in a real search result, not just a model-asserted URL.
  verified: boolean;
};

export type MarketFieldResearchStatus =
  | "completed_with_evidence"
  | "completed_no_evidence"
  | "failed"
  | "timed_out";

export type MarketFieldResearchOutcome = {
  task: ResearchTask;
  items: MarketEvidenceItem[];
  status: MarketFieldResearchStatus;
  reason: string;
};

export type MarketResearchCompleteness = {
  attemptedFields: string[];
  unresolvedFields: string[];
  requiredResearchCompletion: number;
  researchCompleted: boolean;
  recommendedOutput: "full_report" | "preliminary_report" | "clarification";
};
