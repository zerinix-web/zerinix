import { z } from "zod";
import {
  runDecisionEngine,
  decisionEngineResultSchema,
  decisionEngineStatusValues,
  type DecisionEngineInput,
  type DecisionEngineOutput,
} from "./decision-engine.ts";
import { businessIntelligenceContextSchema } from "./business-intelligence-orchestrator.ts";
import { executiveDecisionBriefSchema } from "./executive-decision-brief.ts";

// ZERINIX Executive Decision System v1.
//
// This is the top of the ZERINIX Intelligence stack: it combines
// Decision Engine, Business Intelligence Orchestrator, Confidence
// Engine, Conflict Detection Engine, Evidence Quality Scoring, Source
// Reliability Engine, Evidence Corroboration Engine, Live Research
// Engine, and Research Prioritization/Execution Planning into ONE
// complete strategic decision package. Like Brain Orchestrator and
// Business Intelligence Orchestrator before it, this module is NOT
// another intelligence engine and never computes anything itself --
// every one of the 9 modules above is already fully wired together by
// Decision Engine v1 (which already runs Business Intelligence
// Orchestrator internally for supported requests, and Business
// Intelligence Orchestrator already runs the other 7 in real
// dependency order). This module's entire job is to call Decision
// Engine EXACTLY ONCE and assemble its already-computed, already-
// validated output -- decision status, executive summary, the
// Business Intelligence context, and the resulting Executive Decision
// Brief -- into one coherent, schema-validated package. There is no
// second code path that re-runs, re-scores, or re-derives anything:
// every module this system "combines" remains completely independent
// and unmodified, and every field in the returned package is either a
// direct passthrough of an already-computed real value, or a plain
// summary trace line quoting those same real values.
//
// Deliberate override, matching the identical precedent already
// established by Business Intelligence Orchestrator over its own 8
// stages: once this system's own flag confirms it should run, it
// explicitly passes `enabled: true` to Decision Engine, overriding
// Decision Engine's own independent flag. There is no useful scenario
// where an operator turns the top-of-stack system on but wants the
// layer directly beneath it to silently no-op.
//
// Scope (v1): this module makes no network/AI calls, never generates a
// report, and is not wired into any route, PDF generation, UI, or
// billing. Feature-flagged via ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED,
// defaulting to disabled (or pass `enabled: true`, primarily for
// tests) -- when disabled, Decision Engine is invoked with its own
// flag forced off too, so nothing beneath this facade runs either.

export const EXECUTIVE_DECISION_SYSTEM_ENABLED_ENV_VAR = "ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED";

export function isExecutiveDecisionSystemEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[EXECUTIVE_DECISION_SYSTEM_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const executiveDecisionPackageSchema = z
  .object({
    enabled: z.boolean(),
    status: z.enum(decisionEngineStatusValues),
    businessIntelligenceApplied: z.boolean(),
    // Convenience flattening of decision.* below -- identical values,
    // exposed at the top level so a caller doesn't need to reach into
    // the nested decision object for the fields it most likely wants.
    executiveSummary: z.string().trim().max(2000).nullable(),
    recommendationStatus: z.string().trim().max(60).nullable(),
    nextRecommendedAction: z.string().trim().max(400).nullable(),
    stopReason: z.string().trim().max(500).nullable(),
    selectedDomain: z.string().trim().max(60).nullable(),
    // The full Decision Engine result, unmodified.
    decision: decisionEngineResultSchema,
    // The full Business Intelligence Orchestrator context, unmodified
    // -- null only when it never ran (unsupported domain, evidence
    // caught by the earlier checkpoint, or the whole system disabled).
    businessIntelligence: businessIntelligenceContextSchema.nullable(),
    // The full, BI-informed Executive Decision Brief, unmodified --
    // null under the same conditions as above, or when Decision Engine
    // stopped before reaching it for any other domain.
    executiveDecisionBrief: executiveDecisionBriefSchema.nullable(),
    packageTrace: z.array(shortString(600)).max(20),
  })
  .strict();

export type ExecutiveDecisionPackage = z.infer<typeof executiveDecisionPackageSchema>;

export type ExecutiveDecisionSystemOutput = {
  package: ExecutiveDecisionPackage;
  // The complete, untouched Decision Engine output this package was
  // assembled from -- nothing is lost even if a future field is never
  // promoted into the package itself.
  decisionEngineOutput: DecisionEngineOutput;
};

export type ExecutiveDecisionSystemInput = Omit<DecisionEngineInput, "enabled"> & {
  // Explicit override, primarily for tests; when omitted, falls back
  // to the ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED environment
  // variable. Controls this system's own flag only -- see the file
  // header for why Decision Engine's own flag is always overridden to
  // match once this system is confirmed enabled.
  enabled?: boolean;
};

function buildPackage(decisionEngineOutput: DecisionEngineOutput): ExecutiveDecisionPackage {
  const { decision, results } = decisionEngineOutput;
  const businessIntelligence = results.businessIntelligenceContext;
  const executiveDecisionBrief = results.executiveDecisionBrief;

  const packageTrace: string[] = [
    `Decision Engine status: "${decision.status}"${decision.stopReason ? ` (${decision.stopReason})` : ""}.`,
  ];
  if (businessIntelligence) {
    packageTrace.push(
      `Business Intelligence Orchestrator ran: aggregateConfidence=${businessIntelligence.aggregateConfidence}, aggregateEvidenceQuality=${businessIntelligence.aggregateEvidenceQuality}, executiveDecisionSignal="${businessIntelligence.executiveDecisionSignal}".`
    );
    if (businessIntelligence.conflictDetection?.overallSeverity) {
      packageTrace.push(
        `Conflict Detection Engine found "${businessIntelligence.conflictDetection.overallSeverity}"-severity conflict(s).`
      );
    }
    if (businessIntelligence.aggregatedResearchRequirements.detectedGaps.length > 0) {
      packageTrace.push(
        `Research requirements detected: ${businessIntelligence.aggregatedResearchRequirements.detectedGaps.join(", ")}.`
      );
    }
  } else {
    packageTrace.push("Business Intelligence Orchestrator did not run for this request.");
  }
  if (executiveDecisionBrief) {
    packageTrace.push(
      `Executive Decision Brief recommendation status: "${executiveDecisionBrief.recommendationStatus}".`
    );
  }

  return {
    enabled: decision.enabled,
    status: decision.status,
    businessIntelligenceApplied: decision.businessIntelligenceApplied,
    executiveSummary: decision.executiveSummary,
    recommendationStatus: decision.recommendationStatus,
    nextRecommendedAction: decision.nextRecommendedAction,
    stopReason: decision.stopReason,
    selectedDomain: decision.selectedDomain,
    decision,
    businessIntelligence,
    executiveDecisionBrief,
    packageTrace,
  };
}

export function runExecutiveDecisionSystem(
  input: ExecutiveDecisionSystemInput = {}
): ExecutiveDecisionSystemOutput {
  const enabled = input.enabled ?? isExecutiveDecisionSystemEnabled();
  const decisionEngineOutput = runDecisionEngine({ ...input, enabled });

  return {
    package: buildPackage(decisionEngineOutput),
    decisionEngineOutput,
  };
}
