import { z } from "zod";
import {
  applyDocumentAwareModeOverride,
  classifyAttachmentDocument,
  type DocumentAwareRoutingResult,
  type DocumentClassificationAsset,
  type DocumentClassificationResult,
} from "./document-intelligence.ts";
import {
  createUniversalDocumentIntelligenceFallback,
  type DocumentDomain,
  type UniversalDocumentIntelligence,
} from "./universal-document-intelligence.ts";
import {
  createLegalDocumentSummaryFallback,
  type LegalDocumentSummary,
} from "./legal-document-understanding.ts";
import { createLegalCaseAnalysis, type LegalCaseAnalysis } from "./legal-case-analysis.ts";
import { runDecisionIntentEngine, type DecisionIntentResult } from "./decision-intent-engine.ts";
import { runDecisionStrategyEngine, type DecisionStrategyResult } from "./decision-strategy-engine.ts";
import {
  runDynamicResearchPlanner,
  type DynamicResearchPlannerResult,
  type ResearchDomain,
} from "./dynamic-research-planner.ts";
import {
  runEvidenceAcquisitionEngine,
  type EvidenceAcquisitionCandidate,
  type EvidenceAcquisitionResult,
  type EvidenceCategory,
} from "./evidence-acquisition-engine.ts";
import { runExpertReasoningEngine, type ExpertReasoningResult } from "./expert-reasoning-engine.ts";
import {
  buildExecutiveDecisionBriefFromExpertReasoning,
  type ExecutiveDecisionBrief,
} from "./executive-decision-brief.ts";

// ZERINIX Intelligence Pipeline v1.
//
// This connects the existing standalone intelligence modules into one
// execution pipeline. It is a CONNECTOR, not a new intelligence engine:
// every classification, extraction, and recommendation still comes
// entirely from the underlying modules; this file only decides call
// order, wires each module's output into the next module's input, and
// records what ran, what was skipped, and why.
//
// Scope (v1, standalone): feature-flagged, not wired into any route, and
// does not modify report generation, PDF generation, billing, UI, or any
// existing production behavior. Enable it explicitly via
// ZERINIX_INTELLIGENCE_PIPELINE_ENABLED=true (or the `enabled` input
// override, primarily for tests) -- when disabled, no module is called
// at all.
//
// Requested order vs. real execution order:
// The requested stage order is 1) Attachment Detection, 2) Universal
// Document Intelligence, 3) Legal Intelligence (only if legal),
// 4) Decision Intent Engine, 5) Decision Strategy Engine,
// 6) Dynamic Research Planner, 7) Evidence Acquisition Engine,
// 8) Expert Reasoning Engine, 9) Executive Decision Brief.
//
// Decision Strategy Engine's own input type
// (decision-strategy-engine.ts's DecisionStrategyInput) requires
// decisionIntentResult, expertReasoningResult, AND executiveDecisionBrief
// as non-optional parameters. At requested position 5, Expert Reasoning
// Engine (8) and Executive Decision Brief (9) have not run yet, so
// Decision Strategy Engine cannot literally execute there without
// fabricating placeholder inputs for the other two -- which this
// pipeline will never do. Modifying decision-strategy-engine.ts's
// signature to make those fields optional would change an existing,
// already-tested standalone module, which this task explicitly forbids
// ("connect the existing standalone intelligence modules"). So Decision
// Strategy Engine is executed LAST in real order, after its real
// dependencies exist; `requestedOrder` always reflects the literal
// specification, `executionOrder` reflects what actually ran, and
// `orderDeviations` explains the one place they differ. This is the same
// resolution already used for an identical structural conflict in
// brain-orchestrator.ts.
//
// Every other requested-order dependency is satisfiable as specified:
// Decision Intent Engine's `expertReasoningResult` field is optional, so
// it can run at position 4 without Expert Reasoning Engine having run
// yet; Dynamic Research Planner and Evidence Acquisition Engine have no
// hard dependency on any other stage's output.
//
// A confirmed legal document (Attachment Detection classifies it as
// legal_document / legal_case_analysis) stops the pipeline after Legal
// Intelligence: business intelligence stages never run on a legal
// document, matching the same rule already enforced identically in
// brain-orchestrator.ts, expert-reasoning-engine.ts, and
// decision-intent-engine.ts. Outside that one hard gate, every stage from
// 4 onward always runs and is trusted to apply its own already-tested
// "insufficient evidence" / "unsupported context" handling -- this
// pipeline does not duplicate that safety logic at the connector level.

export const intelligencePipelineStageValues = [
  "Attachment Detection",
  "Universal Document Intelligence",
  "Legal Intelligence",
  "Decision Intent Engine",
  "Decision Strategy Engine",
  "Dynamic Research Planner",
  "Evidence Acquisition Engine",
  "Expert Reasoning Engine",
  "Executive Decision Brief",
] as const;

export type IntelligencePipelineStage = (typeof intelligencePipelineStageValues)[number];

export const INTELLIGENCE_PIPELINE_ENABLED_ENV_VAR = "ZERINIX_INTELLIGENCE_PIPELINE_ENABLED";

export function isIntelligencePipelineEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[INTELLIGENCE_PIPELINE_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

const skippedStageSchema = z
  .object({
    stage: z.enum(intelligencePipelineStageValues),
    reason: shortString(400),
  })
  .strict();

export const intelligencePipelineResultSchema = z
  .object({
    enabled: z.boolean(),
    requestedOrder: z.array(z.enum(intelligencePipelineStageValues)).length(intelligencePipelineStageValues.length),
    executionOrder: z.array(z.enum(intelligencePipelineStageValues)).max(intelligencePipelineStageValues.length),
    executedStages: z.array(z.enum(intelligencePipelineStageValues)).max(intelligencePipelineStageValues.length),
    skippedStages: z.array(skippedStageSchema).max(intelligencePipelineStageValues.length),
    stopReason: z.string().trim().max(500).nullable(),
    orderDeviations: z.array(shortString(500)).max(10),
    pipelineTrace: z.array(shortString(500)).max(40),
    executionTimeMs: z.number().min(0),
  })
  .strict();

export type IntelligencePipelineResult = z.infer<typeof intelligencePipelineResultSchema>;

// Additive, beyond the required result schema: the raw output of every
// stage that actually ran, so a future consumer can use the real data
// without re-running the pipeline. Never validated against the strict
// result schema itself -- these are the underlying modules' own already
// schema-validated outputs.
export type IntelligencePipelineResults = {
  documentClassification: DocumentClassificationResult | null;
  documentRouting: DocumentAwareRoutingResult | null;
  universalDocumentIntelligence: UniversalDocumentIntelligence | null;
  legalDocumentSummary: LegalDocumentSummary | null;
  legalCaseAnalysis: LegalCaseAnalysis | null;
  decisionIntentResult: DecisionIntentResult | null;
  decisionStrategyResult: DecisionStrategyResult | null;
  dynamicResearchPlan: DynamicResearchPlannerResult | null;
  evidenceAcquisitionResult: EvidenceAcquisitionResult | null;
  expertReasoningResult: ExpertReasoningResult | null;
  executiveDecisionBrief: ExecutiveDecisionBrief | null;
};

export type IntelligencePipelineOutput = {
  pipeline: IntelligencePipelineResult;
  results: IntelligencePipelineResults;
};

export type IntelligencePipelineInput = {
  // Explicit override, primarily for tests; when omitted, falls back to
  // the ZERINIX_INTELLIGENCE_PIPELINE_ENABLED environment variable.
  enabled?: boolean;
  prompt?: string;
  conversationContext?: readonly string[];
  attachments?: readonly DocumentClassificationAsset[];
  marketResearchEvidence?: readonly string[];
  businessPlanEvidence?: readonly string[];
  financialEvidence?: readonly string[];
  userProvidedFacts?: readonly string[];
  availableEvidence?: readonly string[];
  additionalVerifiedEvidence?: readonly string[];
  additionalDirectionalSignals?: readonly string[];
  additionalAssumptions?: readonly string[];
  externalEvidenceCandidates?: readonly EvidenceAcquisitionCandidate[];
};

const DOCUMENT_DOMAIN_TO_RESEARCH_DOMAIN: Partial<Record<DocumentDomain, ResearchDomain>> = {
  Legal: "legal",
  Financial: "finance",
  Business: "business",
  Medical: "healthcare",
  "Real Estate": "real_estate",
  Engineering: "engineering",
};

function mapDocumentDomainToResearchDomain(domain: DocumentDomain): ResearchDomain | undefined {
  return DOCUMENT_DOMAIN_TO_RESEARCH_DOMAIN[domain];
}

const MARKET_EVIDENCE_CATEGORIES: readonly EvidenceCategory[] = [
  "market_size",
  "cagr",
  "competitors",
  "pricing_benchmarks",
  "customer_segments",
  "industry_trends",
];

const EVIDENCE_CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  market_size: "Market size",
  cagr: "CAGR",
  competitors: "Competitors",
  pricing_benchmarks: "Pricing benchmarks",
  customer_segments: "Customer segments",
  industry_trends: "Industry trends",
  unit_economics_benchmarks: "Unit economics benchmarks",
  regulatory_considerations: "Regulatory considerations",
  technology_trends: "Technology trends",
};

// Never re-fabricates anything: this only reformats a field that Evidence
// Acquisition Engine itself already refused to fabricate (its own
// extracted_fact/source are either verbatim-from-source or absent).
function formatVerifiedEvidenceLine(
  result: EvidenceAcquisitionResult,
  category: EvidenceCategory
): string | null {
  const entry = result.evidence[category];
  if (entry.evidence_type === "missing" || !entry.extracted_fact) {
    return null;
  }
  return `${EVIDENCE_CATEGORY_LABELS[category]}: ${entry.extracted_fact} (source: ${entry.source})`;
}

function extractMarketResearchEvidenceFromAcquisition(result: EvidenceAcquisitionResult): string[] {
  return MARKET_EVIDENCE_CATEGORIES.map((category) => formatVerifiedEvidenceLine(result, category)).filter(
    (line): line is string => line !== null
  );
}

function extractFinancialEvidenceFromAcquisition(result: EvidenceAcquisitionResult): string[] {
  const line = formatVerifiedEvidenceLine(result, "unit_economics_benchmarks");
  return line ? [line] : [];
}

const ALL_STAGES_AFTER_ATTACHMENT_DETECTION: readonly IntelligencePipelineStage[] = [
  "Universal Document Intelligence",
  "Legal Intelligence",
  "Decision Intent Engine",
  "Dynamic Research Planner",
  "Evidence Acquisition Engine",
  "Expert Reasoning Engine",
  "Executive Decision Brief",
  "Decision Strategy Engine",
];

const ALL_STAGES_AFTER_UNIVERSAL_DOCUMENT_INTELLIGENCE: readonly IntelligencePipelineStage[] = [
  "Legal Intelligence",
  "Decision Intent Engine",
  "Dynamic Research Planner",
  "Evidence Acquisition Engine",
  "Expert Reasoning Engine",
  "Executive Decision Brief",
  "Decision Strategy Engine",
];

const STAGES_AFTER_LEGAL_INTELLIGENCE: readonly IntelligencePipelineStage[] = [
  "Decision Intent Engine",
  "Dynamic Research Planner",
  "Evidence Acquisition Engine",
  "Expert Reasoning Engine",
  "Executive Decision Brief",
  "Decision Strategy Engine",
];

const STAGES_AFTER_DECISION_INTENT: readonly IntelligencePipelineStage[] = [
  "Dynamic Research Planner",
  "Evidence Acquisition Engine",
  "Expert Reasoning Engine",
  "Executive Decision Brief",
  "Decision Strategy Engine",
];

const STAGES_AFTER_DYNAMIC_RESEARCH_PLANNER: readonly IntelligencePipelineStage[] = [
  "Evidence Acquisition Engine",
  "Expert Reasoning Engine",
  "Executive Decision Brief",
  "Decision Strategy Engine",
];

const STAGES_AFTER_EVIDENCE_ACQUISITION: readonly IntelligencePipelineStage[] = [
  "Expert Reasoning Engine",
  "Executive Decision Brief",
  "Decision Strategy Engine",
];

const STAGES_AFTER_EXPERT_REASONING: readonly IntelligencePipelineStage[] = [
  "Executive Decision Brief",
  "Decision Strategy Engine",
];

const STAGES_AFTER_EXECUTIVE_DECISION_BRIEF: readonly IntelligencePipelineStage[] = ["Decision Strategy Engine"];

export function runIntelligencePipeline(
  input: IntelligencePipelineInput = {}
): IntelligencePipelineOutput {
  const startedAt = Date.now();

  const results: IntelligencePipelineResults = {
    documentClassification: null,
    documentRouting: null,
    universalDocumentIntelligence: null,
    legalDocumentSummary: null,
    legalCaseAnalysis: null,
    decisionIntentResult: null,
    decisionStrategyResult: null,
    dynamicResearchPlan: null,
    evidenceAcquisitionResult: null,
    expertReasoningResult: null,
    executiveDecisionBrief: null,
  };

  const enabled = input.enabled ?? isIntelligencePipelineEnabled();

  if (!enabled) {
    const reason = `Intelligence Pipeline is disabled (set ${INTELLIGENCE_PIPELINE_ENABLED_ENV_VAR}="true" to enable it).`;
    return {
      pipeline: {
        enabled: false,
        requestedOrder: [...intelligencePipelineStageValues],
        executionOrder: [],
        executedStages: [],
        skippedStages: intelligencePipelineStageValues.map((stage) => ({ stage, reason })),
        stopReason: "Intelligence Pipeline is disabled via feature flag; no stage was executed.",
        orderDeviations: [],
        pipelineTrace: [
          `Intelligence Pipeline is disabled (${INTELLIGENCE_PIPELINE_ENABLED_ENV_VAR} is not "true"); no engine was called.`,
        ],
        executionTimeMs: Date.now() - startedAt,
      },
      results,
    };
  }

  const {
    prompt = "",
    conversationContext = [],
    attachments = [],
    marketResearchEvidence = [],
    businessPlanEvidence = [],
    financialEvidence = [],
    userProvidedFacts = [],
    availableEvidence = [],
    additionalVerifiedEvidence = [],
    additionalDirectionalSignals = [],
    additionalAssumptions = [],
    externalEvidenceCandidates = [],
  } = input;

  const executionOrder: IntelligencePipelineStage[] = [];
  const executedStages: IntelligencePipelineStage[] = [];
  const skippedStages: z.infer<typeof skippedStageSchema>[] = [];
  const pipelineTrace: string[] = [];
  const orderDeviations: string[] = [];

  function finish(stopReason: string | null): IntelligencePipelineOutput {
    return {
      pipeline: {
        enabled: true,
        requestedOrder: [...intelligencePipelineStageValues],
        executionOrder,
        executedStages,
        skippedStages,
        stopReason,
        orderDeviations,
        pipelineTrace,
        executionTimeMs: Date.now() - startedAt,
      },
      results,
    };
  }

  function skipRemaining(stages: readonly IntelligencePipelineStage[], reason: string) {
    for (const stage of stages) {
      skippedStages.push({ stage, reason });
      pipelineTrace.push(`Skipping ${stage}: ${reason}`);
    }
  }

  function handleFailure(
    stage: IntelligencePipelineStage,
    remaining: readonly IntelligencePipelineStage[],
    error: unknown
  ): IntelligencePipelineOutput {
    const message = error instanceof Error ? error.message : String(error);
    const stopReason = `${stage} failed: ${message}`;
    pipelineTrace.push(stopReason);
    skipRemaining(remaining, `Upstream failure in ${stage} stopped downstream execution.`);
    return finish(stopReason);
  }

  // Stage 1: Attachment Detection.
  pipelineTrace.push("Running Attachment Detection.");
  executionOrder.push("Attachment Detection");
  let documentClassification: DocumentClassificationResult;
  let documentRouting: DocumentAwareRoutingResult;
  try {
    documentClassification = classifyAttachmentDocument({ assets: attachments });
    documentRouting = applyDocumentAwareModeOverride({
      selectedMode: "chat",
      classification: documentClassification,
    });
  } catch (error) {
    return handleFailure("Attachment Detection", ALL_STAGES_AFTER_ATTACHMENT_DETECTION, error);
  }
  results.documentClassification = documentClassification;
  results.documentRouting = documentRouting;
  executedStages.push("Attachment Detection");
  pipelineTrace.push(
    `Attachment Detection classified this input as "${documentClassification.category}" (confidence ${documentClassification.confidence}).`
  );

  // Stage 2: Universal Document Intelligence.
  pipelineTrace.push("Running Universal Document Intelligence.");
  executionOrder.push("Universal Document Intelligence");
  let universalDocumentIntelligence: UniversalDocumentIntelligence;
  try {
    universalDocumentIntelligence = createUniversalDocumentIntelligenceFallback({ assets: attachments });
  } catch (error) {
    return handleFailure(
      "Universal Document Intelligence",
      ALL_STAGES_AFTER_UNIVERSAL_DOCUMENT_INTELLIGENCE,
      error
    );
  }
  results.universalDocumentIntelligence = universalDocumentIntelligence;
  executedStages.push("Universal Document Intelligence");
  pipelineTrace.push(
    `Universal Document Intelligence detected domain "${universalDocumentIntelligence.documentDomain}" (confidence ${universalDocumentIntelligence.domainConfidence}).`
  );

  const isLegalCaseAnalysis =
    documentRouting.documentCategory === "legal_document" && documentRouting.analysisType === "legal_case_analysis";

  // Stage 3: Legal Intelligence -- only if legal.
  if (isLegalCaseAnalysis) {
    pipelineTrace.push("Running Legal Intelligence.");
    executionOrder.push("Legal Intelligence");
    let legalDocumentSummary: LegalDocumentSummary;
    let legalCaseAnalysis: LegalCaseAnalysis;
    try {
      legalDocumentSummary = createLegalDocumentSummaryFallback({ assets: attachments });
      legalCaseAnalysis = createLegalCaseAnalysis(legalDocumentSummary);
    } catch (error) {
      return handleFailure("Legal Intelligence", STAGES_AFTER_LEGAL_INTELLIGENCE, error);
    }
    results.legalDocumentSummary = legalDocumentSummary;
    results.legalCaseAnalysis = legalCaseAnalysis;
    executedStages.push("Legal Intelligence");
    pipelineTrace.push("Legal Intelligence produced a structured case summary and case analysis.");

    const stopReason =
      "Attachment Detection confirmed this is a legal document; business intelligence stages never run on a legal document.";
    skipRemaining(STAGES_AFTER_LEGAL_INTELLIGENCE, stopReason);
    return finish(stopReason);
  }

  skippedStages.push({
    stage: "Legal Intelligence",
    reason: "Attachment was not confidently classified as a legal document requiring legal case analysis.",
  });
  pipelineTrace.push("Skipping Legal Intelligence: attachment is not a confidently classified legal document.");

  // Stage 4 (requested order): Decision Intent Engine. Runs without
  // expertReasoningResult -- Expert Reasoning Engine (requested position
  // 8) has not run yet, and DecisionIntentInput.expertReasoningResult is
  // optional, so this is a fully supported path (decision-intent-engine.ts
  // has its own unsupported-context gate that does not require it).
  pipelineTrace.push("Running Decision Intent Engine.");
  executionOrder.push("Decision Intent Engine");
  let decisionIntentResult: DecisionIntentResult;
  try {
    decisionIntentResult = runDecisionIntentEngine({
      userRequest: prompt,
      conversationContext,
      documentIntelligence: universalDocumentIntelligence,
      availableEvidence,
    });
  } catch (error) {
    return handleFailure("Decision Intent Engine", STAGES_AFTER_DECISION_INTENT, error);
  }
  results.decisionIntentResult = decisionIntentResult;
  executedStages.push("Decision Intent Engine");
  pipelineTrace.push(
    decisionIntentResult.cannotDetermineReason
      ? `Decision Intent Engine could not determine a decision objective: ${decisionIntentResult.cannotDetermineReason}`
      : `Decision Intent Engine identified "${decisionIntentResult.decisionCategory}" as the primary decision category.`
  );

  // Stage 6 (requested order): Dynamic Research Planner. Given a domain
  // hint derived from Universal Document Intelligence's own
  // classification when one cleanly maps; otherwise the planner falls
  // back to its own prompt/attachment keyword detection.
  pipelineTrace.push("Running Dynamic Research Planner.");
  executionOrder.push("Dynamic Research Planner");
  let dynamicResearchPlan: DynamicResearchPlannerResult;
  try {
    dynamicResearchPlan = runDynamicResearchPlanner({
      prompt,
      attachmentText: attachments.map((asset) => asset.textContent || "").filter(Boolean),
      detectedDomain: mapDocumentDomainToResearchDomain(universalDocumentIntelligence.documentDomain),
    });
  } catch (error) {
    return handleFailure("Dynamic Research Planner", STAGES_AFTER_DYNAMIC_RESEARCH_PLANNER, error);
  }
  results.dynamicResearchPlan = dynamicResearchPlan;
  executedStages.push("Dynamic Research Planner");
  pipelineTrace.push(
    `Dynamic Research Planner built ${dynamicResearchPlan.tasks.length} task(s) for domain "${dynamicResearchPlan.detectedDomain}".`
  );

  // Stage 7 (requested order): Evidence Acquisition Engine.
  pipelineTrace.push("Running Evidence Acquisition Engine.");
  executionOrder.push("Evidence Acquisition Engine");
  let evidenceAcquisitionResult: EvidenceAcquisitionResult;
  try {
    evidenceAcquisitionResult = runEvidenceAcquisitionEngine({
      prompt,
      userProvidedFacts: [...businessPlanEvidence, ...userProvidedFacts],
      externalEvidenceCandidates,
    });
  } catch (error) {
    return handleFailure("Evidence Acquisition Engine", STAGES_AFTER_EVIDENCE_ACQUISITION, error);
  }
  results.evidenceAcquisitionResult = evidenceAcquisitionResult;
  executedStages.push("Evidence Acquisition Engine");
  pipelineTrace.push(
    `Evidence Acquisition Engine resolved ${evidenceAcquisitionResult.externalVerifiedCount} externally verified, ${evidenceAcquisitionResult.userProvidedCount} user-provided, and ${evidenceAcquisitionResult.missingEvidenceCount} missing evidence categories.`
  );

  // Stage 8 (requested order): Expert Reasoning Engine, fed with Evidence
  // Acquisition Engine's own verified findings -- never re-fabricated,
  // only reformatted from fields that were themselves already
  // never-fabricated.
  pipelineTrace.push("Running Expert Reasoning Engine.");
  executionOrder.push("Expert Reasoning Engine");
  let expertReasoningResult: ExpertReasoningResult;
  try {
    expertReasoningResult = runExpertReasoningEngine({
      prompt,
      documentIntelligence: universalDocumentIntelligence,
      marketResearchEvidence: [
        ...marketResearchEvidence,
        ...extractMarketResearchEvidenceFromAcquisition(evidenceAcquisitionResult),
      ],
      businessPlanEvidence,
      financialEvidence: [
        ...financialEvidence,
        ...extractFinancialEvidenceFromAcquisition(evidenceAcquisitionResult),
      ],
      userProvidedFacts,
    });
  } catch (error) {
    return handleFailure("Expert Reasoning Engine", STAGES_AFTER_EXPERT_REASONING, error);
  }
  results.expertReasoningResult = expertReasoningResult;
  executedStages.push("Expert Reasoning Engine");
  pipelineTrace.push(
    `Expert Reasoning Engine detected business context "${expertReasoningResult.detectedBusinessContext}" (confidence ${expertReasoningResult.confidence}).`
  );

  // Stage 9 (requested order): Executive Decision Brief.
  pipelineTrace.push("Running Executive Decision Brief.");
  executionOrder.push("Executive Decision Brief");
  let executiveDecisionBrief: ExecutiveDecisionBrief;
  try {
    executiveDecisionBrief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult);
  } catch (error) {
    return handleFailure("Executive Decision Brief", STAGES_AFTER_EXECUTIVE_DECISION_BRIEF, error);
  }
  results.executiveDecisionBrief = executiveDecisionBrief;
  executedStages.push("Executive Decision Brief");
  pipelineTrace.push(
    `Executive Decision Brief recommendation status: "${executiveDecisionBrief.recommendationStatus}".`
  );

  // Stage 5 (requested order) -- executed LAST in real order. See the
  // file-level comment above for why: Decision Strategy Engine's own
  // input type requires decisionIntentResult, expertReasoningResult, and
  // executiveDecisionBrief as non-optional, so it cannot run at requested
  // position 5 without those already existing.
  orderDeviations.push(
    "Decision Strategy Engine was requested at position 5, but decision-strategy-engine.ts's own input type requires decisionIntentResult, expertReasoningResult, and executiveDecisionBrief as non-optional parameters -- since Expert Reasoning Engine (8) and Executive Decision Brief (9) had not run yet at that point, Decision Strategy Engine was executed last instead, once all of its real dependencies existed."
  );
  pipelineTrace.push("Running Decision Strategy Engine (executed last; see orderDeviations).");
  executionOrder.push("Decision Strategy Engine");
  let decisionStrategyResult: DecisionStrategyResult;
  try {
    decisionStrategyResult = runDecisionStrategyEngine({
      decisionIntentResult,
      expertReasoningResult,
      executiveDecisionBrief,
      verifiedEvidence: additionalVerifiedEvidence,
      directionalSignals: additionalDirectionalSignals,
      assumptions: additionalAssumptions,
    });
  } catch (error) {
    return handleFailure("Decision Strategy Engine", [], error);
  }
  results.decisionStrategyResult = decisionStrategyResult;
  executedStages.push("Decision Strategy Engine");
  pipelineTrace.push(
    `Decision Strategy Engine recommendation status: "${decisionStrategyResult.recommendedDecision.status}".`
  );

  return finish(null);
}
