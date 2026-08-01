import type {
  DomainProfile,
  ExtractedFact,
  IntentDetection,
  ResearchTask,
} from "./contracts";
import { extractLegalResearchContext } from "./legal-research-context.mjs";

export function buildDecisionResearchPlan({
  profile,
  intent,
  facts,
  prompt,
}: {
  profile: DomainProfile;
  intent: IntentDetection;
  facts: readonly ExtractedFact[];
  prompt: string;
}): ResearchTask[] {
  const identifiers = facts
    .filter((item) => item.verified && item.field !== "uploaded_asset")
    .map((item) => `${item.field}: ${item.value}`)
    .join(" ");
  const queryContext =
    identifiers || prompt.replace(/\s+/g, " ").trim().slice(0, 260);

  if (profile.id === "legal") {
    const legalContext = extractLegalResearchContext(prompt);
    if (legalContext.issues.length > 0) {
      const jurisdiction = legalContext.jurisdiction || "applicable jurisdiction";
      const factContext = legalContext.userFacts
        .map((fact) => `${fact.field}: ${fact.value}`)
        .join("; ");
      return legalContext.issues.map((issue, index) => ({
        id: `legal_research_${index + 1}_${issue.id}`,
        field: issue.id,
        priority: issue.priority,
        reason: `Verify ${issue.label} for the detected ${legalContext.legalDomain} matter. Decision intent: ${intent.primary}.`,
        query: `${jurisdiction} ${legalContext.legalDomain} ${issue.queryTerms} ${issue.preferredSources.join(" ")} ${factContext}`
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 900),
        provider: "auto",
        status: "skipped_with_reason",
        statusReason: "Awaiting provider selection and execution.",
        confidence: 0,
        required: issue.priority === "critical",
        preferredSources: issue.preferredSources,
        jurisdiction,
        legalIssue: issue.label,
        requestedDecision: legalContext.requestedDecision,
        urgency: legalContext.urgency,
        userFacts: legalContext.userFacts.map(
          (fact) => `${fact.field}: ${fact.value}`
        ),
      }));
    }
  }

  return profile.researchRequirements.map((requirement, index) => ({
    id: `${profile.id}_research_${index + 1}`,
    field: requirement.field,
    priority: requirement.priority,
    reason: `${requirement.reason} Decision intent: ${intent.primary}.`,
    query: `${queryContext} ${requirement.reason} ${requirement.preferredSources.join(" ")}`.slice(
      0,
      600
    ),
    provider: "auto",
    status: "skipped_with_reason",
    statusReason: "Awaiting provider selection and execution.",
    confidence: 0,
    required: requirement.required,
    preferredSources: requirement.preferredSources,
  }));
}
