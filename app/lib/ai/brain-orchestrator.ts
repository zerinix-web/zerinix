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
  type UniversalDocumentIntelligence,
} from "./universal-document-intelligence.ts";
import { buildDecisionPlan, type DecisionPlan } from "./intelligence-router.ts";
import { runExpertReasoningEngine, type ExpertReasoningResult } from "./expert-reasoning-engine.ts";
import {
  buildExecutiveDecisionBriefFromExpertReasoning,
  type ExecutiveDecisionBrief,
} from "./executive-decision-brief.ts";
import { runDecisionIntentEngine, type DecisionIntentResult } from "./decision-intent-engine.ts";
import { runDecisionStrategyEngine, type DecisionStrategyResult } from "./decision-strategy-engine.ts";

// ZERINIX Brain Orchestrator v1. This is NOT another intelligence
// engine -- it never classifies, extracts, or reasons about anything
// itself. It only decides which of the 7 existing engines to run, in
// what order, and coordinates the evidence/confidence that flows
// between them. Every actual decision (what the document is, what the
// user wants, what to recommend) still comes entirely from the engines
// themselves; this module's only outputs are about the *execution*
// of those engines, never new business content.
//
// Real dependency order (not the narrative "...-> Executive Brief" shape
// in illustrative workflow diagrams): Executive Decision Brief only
// needs the Expert Reasoning Engine's output
// (buildExecutiveDecisionBriefFromExpertReasoning), and Decision
// Strategy Engine requires the Executive Decision Brief as an input
// parameter. So Executive Decision Brief must run BEFORE Decision
// Intent/Decision Strategy, not after -- this orchestrator follows the
// engines' actual function signatures (dependency validation), not a
// diagram that would be impossible to execute as literally ordered.

export const brainEngineNames = [
  "Document Intelligence",
  "Universal Document Intelligence",
  "Intelligence Router",
  "Expert Reasoning Engine",
  "Executive Decision Brief",
  "Decision Intent Engine",
  "Decision Strategy Engine",
] as const;

export type BrainEngineName = (typeof brainEngineNames)[number];

const shortString = (max: number) => z.string().trim().min(1).max(max);

const skippedModuleSchema = z
  .object({
    module: z.enum(brainEngineNames),
    reason: shortString(400),
  })
  .strict();

const confidencePipelineEntrySchema = z
  .object({
    module: z.enum(brainEngineNames),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const finalDecisionStateValues = [
  "not_started",
  "proceed",
  "proceed_with_conditions",
  "wait",
  "reject",
  "insufficient_evidence",
] as const;

export const brainExecutionResultSchema = z
  .object({
    executedModules: z.array(z.enum(brainEngineNames)).max(brainEngineNames.length),
    skippedModules: z.array(skippedModuleSchema).max(brainEngineNames.length),
    executionOrder: z.array(z.enum(brainEngineNames)).max(brainEngineNames.length),
    executionTime: z.number().min(0),
    evidencePipeline: z.array(shortString(600)).max(200),
    confidencePipeline: z.array(confidencePipelineEntrySchema).max(brainEngineNames.length),
    finalDecisionState: z
      .object({
        status: z.enum(finalDecisionStateValues),
        summary: z.string().trim().max(800),
      })
      .strict(),
    stopReason: z.string().trim().max(500).nullable(),
    nextRecommendedAction: shortString(400),
    executionTrace: z.array(shortString(500)).max(50),
  })
  .strict();

export type BrainExecutionResult = z.infer<typeof brainExecutionResultSchema>;

// Additive, beyond the required output field list: the raw result of
// each executed engine, so a future report-generation consumer can use
// the actual data without re-running the whole pipeline. Never exposed
// as part of the required BrainExecutionResult fields themselves.
export type BrainExecutionResults = {
  documentIntelligence: ReturnType<typeof classifyAttachmentDocument> | null;
  universalDocumentIntelligence: UniversalDocumentIntelligence | null;
  decisionPlan: DecisionPlan | null;
  expertReasoningResult: ExpertReasoningResult | null;
  executiveDecisionBrief: ExecutiveDecisionBrief | null;
  decisionIntentResult: DecisionIntentResult | null;
  decisionStrategyResult: DecisionStrategyResult | null;
};

export type BrainOrchestratorOutput = {
  execution: BrainExecutionResult;
  results: BrainExecutionResults;
};

// A caller that already computed one or more of the early stages itself
// (e.g. a route that must classify the attachment before this
// orchestrator ever runs, to decide the request's analysisMode) can pass
// those results in here. The orchestrator then reuses them verbatim
// instead of calling the underlying engine a second time -- this is
// what "prevent duplicate execution of existing intelligence modules"
// means in practice: the same deterministic function is never invoked
// twice for the same input just because two different callers both
// needed its output.
export type BrainOrchestratorPrecomputed = {
  documentClassification?: DocumentClassificationResult;
  documentRouting?: DocumentAwareRoutingResult;
  universalDocumentIntelligence?: UniversalDocumentIntelligence;
  decisionPlan?: DecisionPlan;
};

export type BrainOrchestratorInput = {
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
  precomputed?: BrainOrchestratorPrecomputed;
};

export function runBrainOrchestrator(input: BrainOrchestratorInput): BrainOrchestratorOutput {
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
    precomputed,
  } = input;

  const startedAt = Date.now();
  const executedModules: BrainEngineName[] = [];
  const skippedModules: z.infer<typeof skippedModuleSchema>[] = [];
  const evidencePipeline: string[] = [];
  const confidencePipeline: z.infer<typeof confidencePipelineEntrySchema>[] = [];
  const executionTrace: string[] = [];

  const results: BrainExecutionResults = {
    documentIntelligence: null,
    universalDocumentIntelligence: null,
    decisionPlan: null,
    expertReasoningResult: null,
    executiveDecisionBrief: null,
    decisionIntentResult: null,
    decisionStrategyResult: null,
  };

  const recordEvidence = (engineName: BrainEngineName, trace: readonly string[]) => {
    for (const line of trace) {
      evidencePipeline.push(`[${engineName}] ${line}`);
    }
  };
  const recordConfidence = (engineName: BrainEngineName, confidence: number) => {
    confidencePipeline.push({ module: engineName, confidence });
  };
  const skipRemaining = (fromIndex: number, reason: string) => {
    for (const engineName of brainEngineNames.slice(fromIndex)) {
      skippedModules.push({ module: engineName, reason });
      executionTrace.push(`Skipping ${engineName}: ${reason}`);
    }
  };

  function finish(
    stopReason: string | null,
    nextRecommendedAction: string,
    finalDecisionState: BrainExecutionResult["finalDecisionState"]
  ): BrainOrchestratorOutput {
    const execution: BrainExecutionResult = {
      executedModules,
      skippedModules,
      executionOrder: [...brainEngineNames],
      executionTime: Date.now() - startedAt,
      evidencePipeline,
      confidencePipeline,
      finalDecisionState,
      stopReason,
      nextRecommendedAction,
      executionTrace,
    };
    return { execution, results };
  }

  // Stage 1: Document Intelligence. Cheapest, most foundational check --
  // decides immediately whether this is a legal document that must never
  // reach a business engine (rule: never execute business engines for
  // unsupported document categories).
  let documentClassification: DocumentClassificationResult;
  let documentRouting: DocumentAwareRoutingResult;
  if (precomputed?.documentClassification && precomputed?.documentRouting) {
    documentClassification = precomputed.documentClassification;
    documentRouting = precomputed.documentRouting;
    executionTrace.push("Reusing precomputed Document Intelligence result (not re-executed).");
  } else {
    executionTrace.push("Running Document Intelligence.");
    documentClassification = classifyAttachmentDocument({ assets: attachments });
    documentRouting = applyDocumentAwareModeOverride({
      selectedMode: "chat",
      classification: documentClassification,
    });
  }
  results.documentIntelligence = documentClassification;
  executedModules.push("Document Intelligence");
  recordConfidence("Document Intelligence", documentClassification.confidence);
  executionTrace.push(
    `Document Intelligence classified this attachment as "${documentClassification.category}" (confidence ${documentClassification.confidence}).`
  );

  if (documentRouting.documentCategory === "legal_document" && documentRouting.analysisType === "legal_case_analysis") {
    const stopReason =
      "Document Intelligence classified the attachment as a legal document; business intelligence engines never run for unsupported document categories.";
    skipRemaining(1, stopReason);
    return finish(stopReason, "Route this request to Strategic Advisory / legal review, not business analysis.", {
      status: "insufficient_evidence",
      summary: stopReason,
    });
  }

  // Stage 2: Universal Document Intelligence.
  let universalDocumentIntelligence: UniversalDocumentIntelligence;
  if (precomputed?.universalDocumentIntelligence) {
    universalDocumentIntelligence = precomputed.universalDocumentIntelligence;
    executionTrace.push("Reusing precomputed Universal Document Intelligence result (not re-executed).");
  } else {
    executionTrace.push("Running Universal Document Intelligence.");
    try {
      universalDocumentIntelligence = createUniversalDocumentIntelligenceFallback({
        assets: attachments,
      });
    } catch (error) {
      return handleFailure("Universal Document Intelligence", 1, error);
    }
  }
  results.universalDocumentIntelligence = universalDocumentIntelligence;
  executedModules.push("Universal Document Intelligence");
  recordConfidence("Universal Document Intelligence", universalDocumentIntelligence.domainConfidence);
  executionTrace.push(
    `Universal Document Intelligence detected domain "${universalDocumentIntelligence.documentDomain}" (confidence ${universalDocumentIntelligence.domainConfidence}).`
  );

  // Stage 3: Intelligence Router.
  let decisionPlan: DecisionPlan;
  if (precomputed?.decisionPlan) {
    decisionPlan = precomputed.decisionPlan;
    executionTrace.push("Reusing precomputed Intelligence Router result (not re-executed).");
  } else {
    executionTrace.push("Running Intelligence Router.");
    try {
      decisionPlan = buildDecisionPlan({ prompt, documentIntelligence: universalDocumentIntelligence });
    } catch (error) {
      return handleFailure("Intelligence Router", 2, error);
    }
  }
  results.decisionPlan = decisionPlan;
  executedModules.push("Intelligence Router");
  recordConfidence("Intelligence Router", decisionPlan.confidence);
  executionTrace.push(
    `Intelligence Router recommends ${decisionPlan.recommendedAnalyses.length} module(s) for this input.`
  );

  // Stage 4: Expert Reasoning Engine.
  executionTrace.push("Running Expert Reasoning Engine.");
  let expertReasoningResult: ExpertReasoningResult;
  try {
    expertReasoningResult = runExpertReasoningEngine({
      prompt,
      documentIntelligence: universalDocumentIntelligence,
      decisionPlan,
      marketResearchEvidence,
      businessPlanEvidence,
      financialEvidence,
      userProvidedFacts,
    });
  } catch (error) {
    return handleFailure("Expert Reasoning Engine", 3, error);
  }
  results.expertReasoningResult = expertReasoningResult;
  executedModules.push("Expert Reasoning Engine");
  recordConfidence("Expert Reasoning Engine", expertReasoningResult.confidence);
  recordEvidence("Expert Reasoning Engine", expertReasoningResult.evidenceTrace);

  if (expertReasoningResult.detectedBusinessContext === "unsupported") {
    const stopReason =
      "Expert Reasoning Engine determined this input is outside the supported business reasoning contexts; running the remaining business decision engines would be unnecessary.";
    skipRemaining(4, stopReason);
    return finish(
      stopReason,
      "This input is not a supported business decision context. No further business analysis is recommended.",
      { status: "insufficient_evidence", summary: stopReason }
    );
  }

  // Stage 5: Executive Decision Brief (only needs Expert Reasoning Engine's output).
  executionTrace.push("Running Executive Decision Brief.");
  let executiveDecisionBrief: ExecutiveDecisionBrief;
  try {
    executiveDecisionBrief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult);
  } catch (error) {
    return handleFailure("Executive Decision Brief", 4, error);
  }
  results.executiveDecisionBrief = executiveDecisionBrief;
  executedModules.push("Executive Decision Brief");
  recordConfidence("Executive Decision Brief", executiveDecisionBrief.decisionConfidence);
  recordEvidence("Executive Decision Brief", executiveDecisionBrief.evidenceTrace);

  // Stage 6: Decision Intent Engine.
  executionTrace.push("Running Decision Intent Engine.");
  let decisionIntentResult: DecisionIntentResult;
  try {
    decisionIntentResult = runDecisionIntentEngine({
      userRequest: prompt,
      conversationContext,
      documentIntelligence: universalDocumentIntelligence,
      expertReasoningResult,
      availableEvidence,
    });
  } catch (error) {
    return handleFailure("Decision Intent Engine", 5, error);
  }
  results.decisionIntentResult = decisionIntentResult;
  executedModules.push("Decision Intent Engine");
  recordConfidence("Decision Intent Engine", decisionIntentResult.confidence);
  recordEvidence("Decision Intent Engine", decisionIntentResult.evidenceTrace);

  if (decisionIntentResult.cannotDetermineReason) {
    const stopReason = `Decision Intent Engine could not determine a decision objective: ${decisionIntentResult.cannotDetermineReason}`;
    skipRemaining(6, stopReason);
    return finish(
      stopReason,
      "Ask the user what specific business decision this analysis should support before running Decision Strategy.",
      { status: "insufficient_evidence", summary: stopReason }
    );
  }

  // Stage 7: Decision Strategy Engine.
  executionTrace.push("Running Decision Strategy Engine.");
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
    return handleFailure("Decision Strategy Engine", 6, error);
  }
  results.decisionStrategyResult = decisionStrategyResult;
  executedModules.push("Decision Strategy Engine");
  recordConfidence("Decision Strategy Engine", decisionStrategyResult.confidence);
  recordEvidence("Decision Strategy Engine", decisionStrategyResult.evidenceTrace);

  return finish(
    null,
    decisionStrategyResult.executionPriority[0] ||
      "Review the Decision Strategy Engine's recommendation and proceed accordingly.",
    {
      status: decisionStrategyResult.recommendedDecision.status,
      summary: decisionStrategyResult.executiveSummary,
    }
  );

  function handleFailure(
    engineName: BrainEngineName,
    stageIndex: number,
    error: unknown
  ): BrainOrchestratorOutput {
    const message = error instanceof Error ? error.message : String(error);
    const stopReason = `${engineName} failed: ${message}`;
    executionTrace.push(stopReason);
    skipRemaining(stageIndex + 1, `Upstream failure in ${engineName} stopped downstream execution.`);
    return finish(stopReason, "Investigate the failure before retrying this request.", {
      status: "insufficient_evidence",
      summary: stopReason,
    });
  }
}
