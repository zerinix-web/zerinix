// Decision Engine V2 -- SHADOW MODE wiring.
//
// PHASE 6: this is the ONLY place V2's result touches the live request
// path, and it does so read-only. It runs V2 alongside the already-
// computed legacy decision, logs a comparison via the existing
// operational-logging mechanism (app/lib/security/logging.ts --
// already used throughout app/api/market-analysis/route.ts for exactly
// this "compute something, log it, never surface it to the user"
// purpose), and returns nothing the caller is required to use. It never
// writes to a new database table, never appears in the response sent to
// the client, and never alters `report` in place.

import { logOperationalInfo } from "@/app/lib/security/logging";
import { extractMarketIntelligenceBannerConfidence } from "@/app/lib/report-engine/executive-decision-vocabulary";
import {
  extractExecutiveDecisionFromText,
  type ExecutiveDecisionCode,
} from "@/app/lib/report-engine/executive-decision-brief";
import { runDecisionEngineV2 } from "./engine.ts";
import type { DecisionEngineV2Input } from "./dimensions.ts";
import type { DecisionV2Code, DecisionV2Result, DimensionAssessment } from "./types.ts";
import { recordShadowComparisonToDisk } from "./shadow-log.ts";
import { buildAbComparisonRecord, recordControlledComparison } from "./ab-readiness.ts";

// A trimmed, log-safe projection of a full DimensionAssessment -- kept
// as its own type so the log schema is explicit and stable rather
// than "whatever DimensionAssessment happens to contain".
//
// Deliberately named "dimensionName", NOT "key"/"dimensionKey":
// sanitizeMetadata's sensitiveKeyPattern (app/lib/security/logging.ts)
// redacts any field whose NAME contains "key" ANYWHERE as a plain
// substring, case-insensitive, no word boundary -- so "dimensionKey"
// still matches (it contains "Key") even though a dimension key
// ("marketAttractiveness" etc.) is not remotely sensitive. Confirmed
// by direct inspection of a written log entry. "dimensionName" avoids
// every substring in sensitiveKeyPattern without loosening the shared
// sanitizer for everyone else.
export type ShadowDimensionSnapshot = {
  dimensionName: string;
  state: string;
  score: number | null;
  uncertainty: string;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  rationale: string;
  isHardBlocker: boolean;
};

function snapshotDimension(dimension: DimensionAssessment): ShadowDimensionSnapshot {
  return {
    dimensionName: dimension.key,
    state: dimension.state,
    score: dimension.score,
    uncertainty: dimension.uncertainty,
    supportingEvidence: dimension.supportingEvidence,
    contradictingEvidence: dimension.contradictingEvidence,
    rationale: dimension.rationale,
    isHardBlocker: dimension.isHardBlocker === true,
  };
}

export type DecisionEngineShadowComparison = {
  legacyDecision: ExecutiveDecisionCode | null;
  legacyConfidence: number | null;
  v2Decision: DecisionV2Code;
  v2Confidence: number;
  v2ConfidenceBand: string;
  agree: boolean;
  disagreementSeverity: "none" | "minor" | "major";
  disagreementReasons: string[];
  evidenceCompletenessScore: number;
  evidenceQualityScore: number;
  marketQualityScore: number | null;
  unknownDimensions: string[];
  negativeDimensions: string[];
  // Full per-dimension state/score/evidence -- required so a logged
  // comparison can be audited without re-running the engine.
  v2Dimensions: ShadowDimensionSnapshot[];
  // Populated only when v2Decision is "NO_GO" -- the specific
  // contradicting-evidence strings the engine actually cited to
  // justify rejection (INVARIANT 3: NO_GO always carries explicit
  // negative evidence, never just an evidence gap).
  negativeEvidenceForNoGo: string[];
  // The engine's own structured reasoning, carried through unchanged
  // so the log is a complete, self-contained record of "why".
  reasoning: DecisionV2Result["reasoning"];
  invariants: DecisionV2Result["invariants"];
};

const DECISION_RANK: Record<ExecutiveDecisionCode, number> = {
  GO: 2,
  CONDITIONAL_GO: 1,
  NO_GO: 0,
};

// Exported so the controlled offline comparison script
// (scripts/decision-engine-v2-shadow-comparison.mjs) can reuse the
// exact same severity/explanation logic the live request path uses --
// a comparison run through duplicated logic could silently drift from
// what production actually reports.
export function severityOf(legacy: ExecutiveDecisionCode, v2: DecisionV2Code): "none" | "minor" | "major" {
  if (legacy === v2) return "none";
  const distance = Math.abs(DECISION_RANK[legacy] - DECISION_RANK[v2 as ExecutiveDecisionCode]);
  return distance >= 2 ? "major" : "minor";
}

export function explainDisagreement(
  legacy: ExecutiveDecisionCode,
  v2: DecisionV2Code,
  result: DecisionV2Result
): string[] {
  const reasons: string[] = [];
  const unknowns = result.dimensions.filter((d) => d.state === "unknown");
  const negatives = result.dimensions.filter((d) => d.state === "weak" || d.state === "unfavorable");

  if (DECISION_RANK[legacy] < DECISION_RANK[v2 as ExecutiveDecisionCode]) {
    // Legacy is more negative than V2.
    if (unknowns.length > 0) {
      reasons.push(
        `Legacy engine's blended evidence-coverage confidence was likely lowered by ${unknowns
          .map((d) => d.key)
          .join(", ")} being under-evidenced; V2 treats these as unknown (excluded from market quality) rather than negative.`
      );
    }
    if (negatives.length === 0) {
      reasons.push("V2 found no dimension with actual negative evidence, only evidence gaps.");
    }
  } else if (DECISION_RANK[legacy] > DECISION_RANK[v2 as ExecutiveDecisionCode]) {
    if (negatives.length > 0) {
      reasons.push(
        `V2 found explicit negative evidence in ${negatives.map((d) => d.key).join(", ")} that the legacy engine's evidence-volume-based scoring does not separately weigh.`
      );
    } else {
      reasons.push("V2's evidence completeness/quality gate downgraded an otherwise-qualifying GO signal.");
    }
  }

  return reasons;
}

export function runDecisionEngineV2ShadowMode(input: {
  decisionInput: DecisionEngineV2Input;
  executiveSummaryText: string;
  reportRequestId: string | null;
  userId?: string;
  // Required (not optional/defaulted) so every call site is forced to
  // consciously state whether this is a partial report -- comparing a
  // partial report's V2 read against a legacy decision that itself
  // carries an explicit "partial" caveat would produce a misleading
  // comparison record. The route.ts call site already only invokes
  // this function when !isPartialReport; this is threaded through as
  // defense in depth so buildAbComparisonRecord (ab-readiness.ts) can
  // independently refuse to build a record, rather than relying solely
  // on an external caller-side gate that a future call site could forget.
  isPartialReport: boolean;
}): DecisionV2Result | null {
  // Shadow mode must never affect the production response path -- the
  // ENTIRE computation (including running the engine itself, not just
  // the comparison/logging around it) is inside this try block, so any
  // unexpected input shape degrades to a logged no-op rather than an
  // uncaught exception on the live request path.
  try {
    const result = runDecisionEngineV2(input.decisionInput);

    const legacyBanner = extractExecutiveDecisionFromText(input.executiveSummaryText, "market");
    const legacyDecision = legacyBanner?.code ?? null;
    const legacyConfidence = legacyBanner
      ? extractMarketIntelligenceBannerConfidence(input.executiveSummaryText, legacyBanner.token)
      : null;

    const agree = legacyDecision === result.decision;
    const disagreementReasons =
      legacyDecision && !agree ? explainDisagreement(legacyDecision, result.decision, result) : [];
    const comparison: DecisionEngineShadowComparison = {
      legacyDecision,
      legacyConfidence,
      v2Decision: result.decision,
      v2Confidence: result.confidence,
      v2ConfidenceBand: result.confidenceBand,
      agree,
      disagreementSeverity: legacyDecision ? severityOf(legacyDecision, result.decision) : "none",
      disagreementReasons,
      evidenceCompletenessScore: result.evidenceCompletenessScore,
      evidenceQualityScore: result.evidenceQualityScore,
      marketQualityScore: result.marketQualityScore,
      unknownDimensions: result.dimensions.filter((d) => d.state === "unknown").map((d) => d.key),
      negativeDimensions: result.dimensions
        .filter((d) => d.state === "weak" || d.state === "unfavorable")
        .map((d) => d.key),
      v2Dimensions: result.dimensions.map(snapshotDimension),
      negativeEvidenceForNoGo:
        result.decision === "NO_GO" ? result.reasoning.strongestNegativeEvidence : [],
      reasoning: result.reasoning,
      invariants: result.invariants,
    };

    // Console log kept for continuity/dev-console visibility, but it is
    // NOT the source of truth -- the Next.js dev logger truncates its
    // metadata argument (see shadow-log.ts). recordShadowComparisonToDisk
    // is the reliable sink: a plain JSONL file, unaffected by that
    // truncation, safe to inspect after the fact.
    logOperationalInfo("[decision-engine-v2] shadow comparison", {
      reportRequestId: input.reportRequestId,
      legacyDecision,
      legacyConfidence,
      v2Decision: result.decision,
      v2Confidence: result.confidence,
      agree,
    });
    recordShadowComparisonToDisk({
      reportRequestId: input.reportRequestId,
      status: "ok",
      ...comparison,
    });

    // Controlled A/B Readiness Layer -- a SEPARATE, more restricted sink
    // than the rich local-file log above, designed to be safe against
    // real production traffic (see ab-readiness.ts for why it's a
    // distinct module rather than an extension of the dev-only log).
    // buildAbComparisonRecord independently re-checks isPartialReport
    // (defense in depth, not just relying on this function's own
    // partial-report handling upstream) and recordControlledComparison
    // no-ops entirely unless explicitly enabled.
    recordControlledComparison(
      buildAbComparisonRecord({
        result,
        legacyDecision,
        legacyConfidence,
        disagreementReasons,
        traceId: input.reportRequestId,
        isPartialReport: input.isPartialReport,
      })
    );

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logOperationalInfo("[decision-engine-v2] shadow comparison failed", {
      reportRequestId: input.reportRequestId,
      message,
    });
    recordShadowComparisonToDisk({
      reportRequestId: input.reportRequestId,
      status: "failed",
      message,
    });
    return null;
  }
}
