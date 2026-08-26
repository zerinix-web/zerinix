// Decision Engine V2 -- Controlled A/B Readiness Layer.
//
// PURPOSE: a second, DELIBERATELY MORE RESTRICTED comparison sink than
// shadow-log.ts (which is a rich, local-file, DEV-ONLY diagnostic tool
// gated by shouldLogOperationalInfo()). This module is the one designed
// to be safe to enable against REAL PRODUCTION TRAFFIC:
//
// 1. Every field is DERIVED/aggregate (decision codes, confidence
//    numbers, dimension STATES, boolean/count summaries) -- never a
//    quoted report sentence, never raw user prompt text, never PII.
//    "Prefer compact derived comparison metadata" is enforced by the
//    TYPE ITSELF: AbComparisonRecord has no string field wide enough to
//    hold report prose.
// 2. Off by DEFAULT in production. logOperationalInfo() (the existing
//    operational-logging primitive used throughout this codebase) is
//    ALREADY a no-op when NODE_ENV==="production" unless
//    ZERINIX_VERBOSE_LOGS==="true" -- so shadow-mode's existing console
//    log already never fires on real prod traffic today. Turning
//    controlled A/B capture on for real production traffic requires a
//    SEPARATE, explicitly-named, human-set environment flag
//    (ZERINIX_DECISION_ENGINE_V2_AB_LOGGING), independent of the
//    general verbose-logs switch -- so enabling comparison CAPTURE can
//    never be confused with, or accidentally trigger, enabling V2's
//    DECISION output for anyone. There is no code path anywhere in this
//    module (or shadow-mode.ts, or route.ts) that reads this result
//    back into a user-facing field -- flipping this flag changes
//    logging volume only.
// 3. Never throws, never blocks, never mutates its input, never affects
//    the response. See buildAbComparisonRecord/recordControlledComparison.

import { logOperationalInfo, shouldLogOperationalInfo } from "@/app/lib/security/logging";
import type { ExecutiveDecisionCode } from "@/app/lib/report-engine/executive-decision-brief";
import { dimensionKeys, type DecisionV2Result, type DimensionKey, type DimensionState } from "./types.ts";

export type AbDisagreementType =
  | "none"
  | "legacy_more_negative_minor"
  | "legacy_more_negative_major"
  | "legacy_more_positive_minor"
  | "legacy_more_positive_major";

export type AbComparisonRecord = {
  engineVersion: "decision-engine-v2.0";
  traceId: string | null;
  timestamp: string;
  legacyDecision: ExecutiveDecisionCode | null;
  legacyConfidence: number | null;
  v2Decision: DecisionV2Result["decision"];
  v2Confidence: number;
  v2ConfidenceBand: DecisionV2Result["confidenceBand"];
  agree: boolean;
  disagreementType: AbDisagreementType;
  // Short, already-derived category strings (dimension KEYS and generic
  // situational phrasing) -- never a quoted report sentence. Reused
  // from shadow-mode.ts's own explainDisagreement so both sinks agree
  // on why a disagreement happened.
  disagreementReasons: string[];
  // {key -> state} only -- no scores, no rationale, no evidence text.
  dimensionStates: Record<DimensionKey, DimensionState>;
  evidenceCompletenessScore: number;
  evidenceQualityScore: number;
  // Distinct from "unknown": true only when at least one dimension
  // actually carries real negative evidence (weak/unfavorable) --
  // missing/unknown evidence never sets this, preserving the
  // "missing evidence != negative evidence" invariant at this layer too.
  hasNegativeEvidence: boolean;
  negativeDimensionCount: number;
  unknownDimensionCount: number;
};

const DECISION_RANK: Record<ExecutiveDecisionCode, number> = {
  GO: 2,
  CONDITIONAL_GO: 1,
  NO_GO: 0,
};

function classifyDisagreement(
  legacy: ExecutiveDecisionCode | null,
  v2: DecisionV2Result["decision"]
): AbDisagreementType {
  if (legacy === null || legacy === v2) return "none";
  const distance = Math.abs(DECISION_RANK[legacy] - DECISION_RANK[v2 as ExecutiveDecisionCode]);
  const severity = distance >= 2 ? "major" : "minor";
  return DECISION_RANK[legacy] < DECISION_RANK[v2 as ExecutiveDecisionCode]
    ? `legacy_more_negative_${severity}`
    : `legacy_more_positive_${severity}`;
}

// SAFEGUARD: capturing a comparison for a partial report would compare
// V2's read of an incomplete evidence set against a legacy decision
// that itself carries an explicit "partial" caveat -- neither side's
// output is representative of a finished analysis, so the comparison
// itself would be misleading. Building a record for a partial report is
// refused outright (returns null) rather than left to the caller to
// remember to filter out downstream.
export function buildAbComparisonRecord(input: {
  result: DecisionV2Result;
  legacyDecision: ExecutiveDecisionCode | null;
  legacyConfidence: number | null;
  disagreementReasons: string[];
  traceId: string | null;
  isPartialReport: boolean;
}): AbComparisonRecord | null {
  if (input.isPartialReport) return null;

  const { result } = input;
  const dimensionStates = Object.fromEntries(
    result.dimensions.map((d) => [d.key, d.state])
  ) as Record<DimensionKey, DimensionState>;
  // Defensive: every one of the 7 known dimension keys should be
  // present; if assessAllDimensions's shape ever drifts, fail the
  // record rather than silently reporting an incomplete comparison.
  for (const key of dimensionKeys) {
    if (!(key in dimensionStates)) return null;
  }

  const negativeDimensionCount = result.dimensions.filter(
    (d) => d.state === "weak" || d.state === "unfavorable"
  ).length;
  const unknownDimensionCount = result.dimensions.filter((d) => d.state === "unknown").length;

  return {
    engineVersion: result.engineVersion,
    traceId: input.traceId,
    timestamp: new Date().toISOString(),
    legacyDecision: input.legacyDecision,
    legacyConfidence: input.legacyConfidence,
    v2Decision: result.decision,
    v2Confidence: result.confidence,
    v2ConfidenceBand: result.confidenceBand,
    agree: input.legacyDecision === result.decision,
    disagreementType: classifyDisagreement(input.legacyDecision, result.decision),
    disagreementReasons: input.disagreementReasons,
    dimensionStates,
    evidenceCompletenessScore: result.evidenceCompletenessScore,
    evidenceQualityScore: result.evidenceQualityScore,
    hasNegativeEvidence: negativeDimensionCount > 0,
    negativeDimensionCount,
    unknownDimensionCount,
  };
}

// Separate from shouldLogOperationalInfo(): dev/verbose mode already
// gets this data via shadow-log.ts's richer local file, so this flag
// exists specifically to let a real production deployment opt IN to
// compact, privacy-safe comparison capture without also turning on
// every other ZERINIX_VERBOSE_LOGS-gated log line, and without any
// change firing automatically. Defaults OFF everywhere.
export function shouldRecordControlledComparison(): boolean {
  return process.env.ZERINIX_DECISION_ENGINE_V2_AB_LOGGING === "true" || shouldLogOperationalInfo();
}

// SAFEGUARD: comparison/logging failure must never fail the request.
// The entire body is try/catch-wrapped and this function has no return
// value the caller could depend on -- there is nothing for a caller to
// do differently based on whether this succeeded or not.
export function recordControlledComparison(record: AbComparisonRecord | null): void {
  if (!record) return;
  if (!shouldRecordControlledComparison()) return;

  try {
    // The record is embedded as a JSON string in the log SCOPE
    // (message) argument, not only passed as the metadata object --
    // some log pipelines (confirmed for the local Next.js dev logger)
    // silently drop a console.info call's second (object) argument
    // when persisting to disk. A plain string argument survives every
    // logging backend this codebase could plausibly run on, so the
    // scope string is the reliable channel; the object argument below
    // is kept only for structured-log backends that DO parse it.
    logOperationalInfo(`[decision-engine-v2] ab-readiness comparison ${JSON.stringify(record)}`, {
      traceId: record.traceId,
    });
  } catch {
    // Never let a diagnostics-logging failure affect the request that
    // produced it.
  }
}
