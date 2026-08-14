// Market Intelligence Research V2 -- adapter into the existing report
// generator's input contract.
//
// This is the one place V2 touches the legacy shape at all: it builds a
// real DomainResearchBundle (the exact type runDomainAwareResearch has
// always returned) from V2's own evidence, so every downstream consumer
// (market-intelligence-graph.ts, market-research-coverage.ts, the report
// generation prompt in app/api/market-analysis/route.ts, the report
// schema, PDF, and database) needs zero changes.
import type {
  DecisionIntelligenceContext,
} from "../../decision-intelligence/contracts.ts";
import { getDomainProfile } from "../../decision-intelligence/profiles.ts";
import type { DomainResearchBundle, DomainResearchEvidence } from "../domain-research.ts";
import {
  type MarketEvidenceItem,
  type MarketEvidenceType,
  type MarketFieldResearchOutcome,
  type MarketResearchCompleteness,
} from "./types.ts";

const primaryAuthorityEvidenceTypes = new Set<MarketEvidenceType>([
  "official_government",
  "official_statistics",
  "official_filing",
  "audited_statement",
  "regulator",
]);

let evidenceIdCounter = 0;
function nextEvidenceId(field: string) {
  evidenceIdCounter += 1;
  return `market_v2_${field}_${evidenceIdCounter}`;
}

function toDomainResearchEvidence(item: MarketEvidenceItem): DomainResearchEvidence {
  return {
    id: nextEvidenceId(item.field),
    field: item.field,
    claim: item.claim,
    value: item.value,
    label: item.verified ? "Verified from external source" : "Unknown",
    sourceTitle: item.sourceTitle,
    publisher: item.publisher,
    url: item.sourceUrl,
    sourceType: item.evidenceType,
    authorityLevel: primaryAuthorityEvidenceTypes.has(item.evidenceType)
      ? "primary"
      : "secondary",
    confidence: item.confidence,
    publishedDate: item.publishedAt,
    lastChecked: new Date().toISOString(),
    supportingData: [],
    impact: "neutral",
    impactReason: "",
    qualityScore: item.confidence,
    provider: "market_research_v2",
  };
}

function buildDecisionIntelligence(
  completeness: MarketResearchCompleteness,
  evidence: DomainResearchEvidence[]
): DecisionIntelligenceContext {
  const profile = getDomainProfile("general");
  const resolvedFieldCount =
    completeness.attemptedFields.length - completeness.unresolvedFields.length;
  const coverage = completeness.attemptedFields.length
    ? Math.round((resolvedFieldCount / completeness.attemptedFields.length) * 100)
    : 0;
  const confidence = evidence.length
    ? Math.round(
        evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length
      )
    : 0;

  return {
    version: "decision_intelligence_v1",
    intent: {
      primary: "strategic_advisory",
      secondary: [],
      confidence,
      rationale: ["Market Intelligence Research V2: evidence-only research pipeline."],
    },
    domain: "general",
    domainProfile: profile,
    extractedFacts: [],
    researchPlan: [],
    evidenceValidation: {
      evidence: [],
      conflicts: [],
      corroboratedFields: completeness.attemptedFields.filter(
        (field) => !completeness.unresolvedFields.includes(field)
      ),
      unresolvedFields: completeness.unresolvedFields,
      coverage,
      confidence,
    },
    decision: {
      finalDecision: "WAIT",
      recommendation: "Wait",
      confidence,
      topReasons: [
        `Verified evidence collected for ${resolvedFieldCount} of ${completeness.attemptedFields.length} researched Market Intelligence fields.`,
      ],
      decisionChangingEvidence: completeness.unresolvedFields.length
        ? `Verifiable evidence for: ${completeness.unresolvedFields.join(", ")}.`
        : "",
      conflictExplanation: "",
      scores: [],
      opportunities: [],
      risks: completeness.unresolvedFields.length
        ? [`No verifiable evidence found for: ${completeness.unresolvedFields.join(", ")}.`]
        : [],
      contradictions: [],
      unknowns: completeness.unresolvedFields,
      rationale: [
        "Market Intelligence Research V2 is evidence-only and does not compute an investment BUY/WAIT/AVOID decision.",
      ],
      nextActions: [],
    },
    outputMode: completeness.recommendedOutput,
  };
}

export function buildMarketResearchV2Bundle({
  outcomes,
  completeness,
}: {
  outcomes: readonly MarketFieldResearchOutcome[];
  completeness: MarketResearchCompleteness;
}): DomainResearchBundle {
  const evidence = outcomes.flatMap((outcome) =>
    outcome.items.map(toDomainResearchEvidence)
  );
  const verifiedEvidenceCount = evidence.filter(
    (item) => item.label === "Verified from external source"
  ).length;

  return {
    domain: "business",
    decisionType: "market_entry",
    identifiers: [],
    plan: outcomes.map((outcome) => {
      // The report quality gate (domain-research.ts's
      // validateDomainResearchQuality, untouched by V2) requires every
      // task marked "completed_with_evidence" to carry the sourceUrls/
      // sourceTitles that back it -- and execute.ts only ever reports
      // that status when verified items exist, so this must be built
      // from the same verified subset, not the full (possibly
      // ungrounded) items list.
      const verifiedItems = outcome.items.filter((item) => item.verified);
      return {
        id: outcome.task.id,
        field: outcome.task.field,
        priority: outcome.task.priority,
        reason: outcome.task.reason,
        objective: outcome.task.reason,
        preferredSources: outcome.task.preferredSources,
        query: outcome.task.query,
        critical: outcome.task.priority === "critical",
        provider: "market_research_v2",
        status: outcome.status,
        confidence: verifiedItems.length
          ? Math.max(...verifiedItems.map((item) => item.confidence))
          : 0,
        required: outcome.task.required,
        sourceTitles: verifiedItems.map((item) => item.sourceTitle),
        sourceUrls: verifiedItems.map((item) => item.sourceUrl),
        sourceTypes: verifiedItems.map((item) => item.evidenceType),
        officialSourceCount: verifiedItems.filter((item) =>
          primaryAuthorityEvidenceTypes.has(item.evidenceType)
        ).length,
      };
    }),
    evidence,
    attemptedFields: completeness.attemptedFields,
    unresolvedFields: completeness.unresolvedFields,
    researchAttempted: true,
    researchCompleted: completeness.researchCompleted,
    requiredResearchCompletion: completeness.requiredResearchCompletion,
    recommendedOutput: completeness.recommendedOutput,
    summary: `Market Intelligence Research V2 completed. ${verifiedEvidenceCount} verified evidence item(s) across ${completeness.attemptedFields.length} researched field(s).`,
    providerResponseId: "",
    decisionIntelligence: buildDecisionIntelligence(completeness, evidence),
    fallbackUsed: false,
    failurePhase: "",
    failureReason: "",
    timings: {
      entityExtractionMs: 0,
      researchPlanningMs: 0,
      researchExecutionMs: 0,
    },
  };
}
