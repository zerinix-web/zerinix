import type { AnalysisAsset } from "@/app/lib/ai/analysis-assets";
import type {
  DecisionEvidence,
  DecisionIntelligenceContext,
  DecisionDomain,
  ExtractedFact,
  ResearchTask,
  ResearchTaskResult,
} from "./contracts";
import { createDecisionResult } from "./decision-engine";
import { crossValidateEvidence } from "./evidence-engine";
import { convertExtractedFactsToEvidence } from "./evidence-extraction";
import { extractStructuredAssetFacts } from "./extraction";
import { detectDecisionIntent } from "./intent";
import { detectDecisionDomain, getDomainProfile } from "./profiles";
import { buildDecisionResearchPlan } from "./research-plan";
import {
  runFailSafeDecisionPhase,
  type DecisionIntelligencePhaseLogger,
} from "./fail-safe";

function combinedInput(prompt: string, assets: readonly AnalysisAsset[]) {
  return [
    prompt,
    ...assets.map(
      (asset) => `${asset.name}\n${asset.type}\n${asset.textContent || ""}`
    ),
  ].join("\n");
}

export function prepareDecisionIntelligence({
  prompt,
  assets,
  domainOverride,
  seedFacts = [],
  onPhase,
}: {
  prompt: string;
  assets: AnalysisAsset[];
  domainOverride?: DecisionDomain;
  seedFacts?: ExtractedFact[];
  onPhase?: DecisionIntelligencePhaseLogger;
}) {
  const input = combinedInput(prompt, assets);
  const intent = runFailSafeDecisionPhase({
    phase: "Intent Detection",
    execute: () => detectDecisionIntent(input),
    fallback: () => ({
      primary: "strategic_advisory" as const,
      secondary: [],
      confidence: 0,
      rationale: ["Intent detection was unavailable; legacy report generation continued."],
    }),
    onPhase,
    completedDetails: (result) => ({
      primaryIntent: result.primary,
      secondaryIntentCount: result.secondary.length,
      confidence: result.confidence,
    }),
  });
  const domain = runFailSafeDecisionPhase({
    phase: "Domain Detection",
    execute: () => domainOverride || detectDecisionDomain(input),
    fallback: () => "general" as const,
    onPhase,
    completedDetails: (result) => ({ domain: result }),
  });
  const domainProfile = getDomainProfile(domain);
  const extractedFacts = runFailSafeDecisionPhase({
    phase: "Asset Extraction",
    execute: () => {
      const extracted = [
        ...seedFacts,
        ...extractStructuredAssetFacts(prompt, assets),
      ];
      return extracted.filter(
        (fact, index, items) =>
          items.findIndex(
            (candidate) =>
              candidate.field === fact.field &&
              candidate.value === fact.value &&
              candidate.source === fact.source
          ) === index
      );
    },
    fallback: () => seedFacts,
    onPhase,
    completedDetails: (result) => ({
      assetCount: assets.length,
      extractedFactCount: result.length,
    }),
  });
  const researchPlan = runFailSafeDecisionPhase({
    phase: "Research Planning",
    execute: () =>
      buildDecisionResearchPlan({
        profile: domainProfile,
        intent,
        facts: extractedFacts,
        prompt,
      }),
    fallback: () => [],
    onPhase,
    completedDetails: (result) => ({
      taskCount: result.length,
      requiredTaskCount: result.filter((task) => task.required).length,
    }),
  });

  return {
    intent,
    domain,
    domainProfile,
    extractedFacts,
    researchPlan,
  };
}

export function finalizeDecisionIntelligence({
  prepared,
  extractedFacts = [],
  evidence,
  unresolvedFields,
  completedTaskFields,
  taskResults = [],
  onPhase,
}: {
  prepared: ReturnType<typeof prepareDecisionIntelligence>;
  extractedFacts?: ExtractedFact[];
  evidence: DecisionEvidence[];
  unresolvedFields: string[];
  completedTaskFields: string[];
  taskResults?: ResearchTaskResult[];
  onPhase?: DecisionIntelligencePhaseLogger;
}): DecisionIntelligenceContext {
  const allFacts = [...prepared.extractedFacts, ...extractedFacts].filter(
    (fact, index, items) =>
      items.findIndex(
        (candidate) =>
          candidate.field === fact.field &&
          candidate.value === fact.value &&
          candidate.source === fact.source
      ) === index
  );
  const researchPlan: ResearchTask[] = prepared.researchPlan.map((task) => {
    const result = taskResults.find(
      (candidate) =>
        candidate.id === task.id || candidate.field === task.field
    );
    return {
      ...task,
      provider: result?.provider || task.provider,
      status:
        result?.status ||
        (completedTaskFields.includes(task.field)
          ? "completed_with_evidence"
          : unresolvedFields.includes(task.field)
            ? "completed_no_evidence"
            : "failed"),
      statusReason: result?.reason || "",
      providerConfigured: result?.providerConfigured,
      requestStartedAt: result?.requestStartedAt,
      requestEndedAt: result?.requestEndedAt,
      resultStatus: result?.resultStatus,
      sourceTitles: result?.sourceTitles || [],
      sourceUrls: result?.sourceUrls || [],
      sourceTypes: result?.sourceTypes || [],
      officialSourceCount: result?.officialSourceCount || 0,
      extractedFacts: result?.extractedFacts || [],
      timeoutReason: result?.timeoutReason || "",
      notFoundReason: result?.notFoundReason || "",
      attempts: result?.attempts || [],
      confidence:
        result?.confidence ??
        evidence
          .filter((item) => item.field === task.field)
          .reduce((highest, item) => Math.max(highest, item.confidence), 0),
    };
  });
  const effectiveUnresolvedFields = [
    ...new Set([
      ...unresolvedFields,
      ...researchPlan
        .filter(
          (task) =>
            task.required &&
            task.status !== "completed_with_evidence"
        )
        .map((task) => task.field),
    ]),
  ];
  const allEvidence = runFailSafeDecisionPhase({
    phase: "Evidence Collection",
    execute: () => {
      const factEvidence = convertExtractedFactsToEvidence(allFacts);
      return [...factEvidence, ...evidence].filter(
        (item, index, items) =>
          items.findIndex(
            (candidate) =>
              candidate.field === item.field &&
              candidate.value === item.value &&
              candidate.source === item.source
          ) === index
      );
    },
    fallback: () => evidence,
    onPhase,
    completedDetails: (result) => ({ evidenceCount: result.length }),
  });
  const evidenceValidation = runFailSafeDecisionPhase({
    phase: "Cross Validation",
    execute: () =>
      crossValidateEvidence({
        profile: prepared.domainProfile,
        evidence: allEvidence,
        facts: allFacts,
        unresolvedFields: effectiveUnresolvedFields,
      }),
    fallback: () => ({
      evidence: allEvidence,
      conflicts: [],
      corroboratedFields: [],
      unresolvedFields: [
        ...new Set([
          ...effectiveUnresolvedFields,
          ...prepared.domainProfile.criticalEvidence,
        ]),
      ],
      coverage: 0,
      confidence: 0,
    }),
    onPhase,
    completedDetails: (result) => ({
      coverage: result.coverage,
      confidence: result.confidence,
      conflictCount: result.conflicts.length,
    }),
  });
  const decision = runFailSafeDecisionPhase({
    phase: "Decision Engine",
    execute: () =>
      createDecisionResult({
        profile: prepared.domainProfile,
        validation: evidenceValidation,
        facts: allFacts,
        researchPlan,
      }),
    fallback: () => ({
      finalDecision: "WAIT" as const,
      recommendation: "Wait" as const,
      confidence: 0,
      topReasons: [
        "No decision-grade evidence was available after the Decision Intelligence phase failed.",
        "No authoritative source supports an irreversible commitment.",
        "Critical evidence coverage is 0%, so BUY is not defensible.",
        "Source consistency cannot be assessed without usable evidence.",
        "WAIT preserves capital until the required authoritative records are obtained.",
      ],
      decisionChangingEvidence:
        "The highest-leverage missing evidence is the authoritative record for the first unresolved critical field.",
      conflictExplanation: "",
      scores: [],
      opportunities: [],
      risks: ["Decision Intelligence was unavailable; use the legacy report analysis."],
      contradictions: evidenceValidation.conflicts,
      unknowns: evidenceValidation.unresolvedFields,
      rationale: ["No automated decision score was applied."],
      nextActions: evidenceValidation.unresolvedFields
        .slice(0, 3)
        .map(
          (field) =>
            `Obtain the authoritative record required to resolve ${field}.`
        ),
    }),
    onPhase,
    completedDetails: (result) => ({
      recommendation: result.recommendation,
      confidence: result.confidence,
      scoreCount: result.scores.length,
    }),
  });
  const criticalUnknownRatio = prepared.domainProfile.criticalEvidence.length
    ? evidenceValidation.unresolvedFields.filter((field) =>
        prepared.domainProfile.criticalEvidence.includes(field)
      ).length / prepared.domainProfile.criticalEvidence.length
    : 0;
  const resolvedEvidenceCount = evidenceValidation.evidence.filter(
    (item) => item.verified && item.field !== "uploaded_asset"
  ).length;
  const outputMode = runFailSafeDecisionPhase({
    phase: "Executive Recommendation",
    execute: () =>
      resolvedEvidenceCount === 0 && criticalUnknownRatio > 0.4
        ? ("clarification" as const)
        : criticalUnknownRatio > 0.4 || decision.finalDecision === "WAIT"
          ? ("preliminary_report" as const)
          : ("full_report" as const),
    fallback: () => "preliminary_report" as const,
    onPhase,
    completedDetails: (result) => ({ outputMode: result }),
  });

  return {
    version: "decision_intelligence_v1",
    ...prepared,
    extractedFacts: allFacts,
    researchPlan,
    evidenceValidation,
    decision,
    outputMode,
  };
}

export function formatDecisionIntelligenceContext(
  context: DecisionIntelligenceContext
) {
  return `ZERINIX Decision Intelligence Engine
Version: ${context.version}
Intent: ${context.intent.primary}
Secondary intents: ${context.intent.secondary.join(", ") || "none"}
Intent confidence: ${context.intent.confidence}/100
Domain: ${context.domainProfile.label}
Output mode: ${context.outputMode}

Extracted facts:
${context.extractedFacts
  .map(
    (fact) =>
      `- [${fact.category}] ${fact.field}: ${fact.value} | confidence ${fact.confidence}/100 | source ${fact.source}`
  )
  .join("\n") || "- None"}

Research plan:
${context.researchPlan
  .map(
    (task) =>
      `- ${task.id} | ${task.priority} | ${task.status} | ${task.field} | provider ${task.provider} | provider configured ${task.providerConfigured === false ? "no" : "yes"} | request ${task.requestStartedAt || "not recorded"} to ${task.requestEndedAt || "not recorded"} | result ${task.resultStatus || "not recorded"} | sources ${task.sourceTitles?.join("; ") || "none"} | URLs ${task.sourceUrls?.join("; ") || "none"} | confidence ${task.confidence}/100 | required ${task.required ? "yes" : "no"} | failure/absence reason ${task.statusReason || task.timeoutReason || task.notFoundReason || "none"} | ${task.reason}`
  )
  .join("\n") || "- No external research required"}

Evidence validation:
- Evidence records: ${context.evidenceValidation.evidence.length}
- Coverage: ${context.evidenceValidation.coverage}/100
- Confidence: ${context.evidenceValidation.confidence}/100
- Corroborated fields: ${context.evidenceValidation.corroboratedFields.join(", ") || "none"}
- Unresolved fields: ${context.evidenceValidation.unresolvedFields.join(", ") || "none"}
- Contradictions: ${context.evidenceValidation.conflicts.map((item) => `${item.field}: ${item.explanation}`).join(" | ") || "none"}
- Evidence impacts: ${context.evidenceValidation.evidence
    .filter((item) => item.impact && item.impact !== "unknown")
    .map(
      (item) =>
        `${item.id} ${item.field}=${item.impact}: ${item.impactReason || "No impact explanation"}`
    )
    .join(" | ") || "none assessed"}

Decision:
- Final decision: ${context.decision.finalDecision}
- Confidence: ${context.decision.confidence}/100
- Top five reasons: ${context.decision.topReasons.join(" | ")}
- Decision-changing evidence: ${context.decision.decisionChangingEvidence}
- Conflict explanation: ${context.decision.conflictExplanation || "none"}
${context.decision.scores.map((score) => `- ${score.label}: ${score.score}/100 | ${score.explanation} | evidence ${score.evidenceIds.join(", ") || "none"}`).join("\n")}
- Risks: ${context.decision.risks.join(" | ") || "none"}
- Opportunities: ${context.decision.opportunities.join(" | ") || "none"}
- Next actions: ${context.decision.nextActions.join(" | ") || "none"}

Executive report contract:
- Preserve the current report schema and rendering contract.
- Cover Executive Summary, Verified Findings, Evidence Summary, Key Opportunities, Major Risks, Unknown Information, Contradictions, Confidence Level, Recommended Next Actions, and Decision Recommendation in the closest existing sections.
- Treat the decision result above as the structured recommendation source of truth.
- Mark each paragraph with exactly one provenance category: Verified Asset, Official Source, External Research, AI Inference, Estimated, or Missing Information.
- Never combine verified evidence, inference, estimates, and missing information in the same paragraph.
- Cite the evidence ID or source URL for every material factual claim.
- Include every research task that did not produce evidence, preserving its exact status token and reason.
- Never state that research is complete unless every required task is completed_with_evidence.`;
}
