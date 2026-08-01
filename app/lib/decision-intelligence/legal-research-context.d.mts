export type LegalResearchIssue = {
  id: string;
  label: string;
  queryTerms: string;
  preferredSources: string[];
  priority: "critical" | "high";
};

export type LegalResearchContext = {
  country: string;
  region: string;
  jurisdiction: string;
  legalDomain: string;
  issues: LegalResearchIssue[];
  userFacts: Array<{ field: string; value: string }>;
  requestedDecision: string;
  urgency: string;
};

export function extractLegalResearchContext(prompt: string): LegalResearchContext;
