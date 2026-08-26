#!/usr/bin/env node
// Controlled Legacy-vs-V2 comparison over representative, deterministic
// fixtures (Phase 7's A-J scenarios plus the construction-AI
// risk-intelligence scenario that originally exposed the legacy
// engine's false-NO_GO-from-missing-evidence behavior).
//
// COST: makes ZERO AI, search, or network calls. Every fixture already
// exists in tests/fixtures/decision-engine-v2-scenarios.mjs (the same
// ones the regression suite runs) -- this script only runs the two
// ALREADY-DETERMINISTIC decision functions (legacy's
// assessMarketEntryConfidence and V2's runDecisionEngineV2) over that
// existing structured evidence and records both outputs.
//
// Legacy decision is computed by calling assessMarketEntryConfidence
// DIRECTLY on the fixture's MarketResearchCoverage -- the real,
// authoritative legacy scoring function -- rather than trying to
// fabricate a believable rendered "Executive Decision: TOKEN
// (Confidence: NN%)" banner string the way shadow-mode.ts does for a
// live, model-generated report. Both approaches reach the same legacy
// number; this one is more direct for an offline fixture run.
//
// Usage: node scripts/decision-engine-v2-shadow-comparison.mjs

import { runDecisionEngineV2 } from "../app/lib/decision-engine-v2/engine.ts";
import { assessMarketEntryConfidence } from "../app/lib/report-engine/market-intelligence-presentation.ts";
import { severityOf, explainDisagreement } from "../app/lib/decision-engine-v2/shadow-mode.ts";
import { recordShadowComparisonToDisk, shadowComparisonLogPath } from "../app/lib/decision-engine-v2/shadow-log.ts";
import { scenarios } from "../tests/fixtures/decision-engine-v2-scenarios.mjs";

const LEGACY_TO_EXECUTIVE_CODE = {
  ENTER: "GO",
  MONITOR: "CONDITIONAL_GO",
  AVOID: "NO_GO",
};

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

console.log(`Writing structured comparison entries to: ${shadowComparisonLogPath()}\n`);

const rows = [];

for (const scenario of scenarios) {
  const { confidence: legacyConfidence, decision: legacyMarketEntryDecision } =
    assessMarketEntryConfidence(scenario.input.coverage);
  const legacyDecision = LEGACY_TO_EXECUTIVE_CODE[legacyMarketEntryDecision];

  const v2Result = runDecisionEngineV2(scenario.input);

  const agree = legacyDecision === v2Result.decision;
  const disagreementSeverity = severityOf(legacyDecision, v2Result.decision);
  const disagreementReasons = agree ? [] : explainDisagreement(legacyDecision, v2Result.decision, v2Result);

  const comparison = {
    source: "controlled-comparison-script",
    scenario: scenario.name,
    legacyDecision,
    legacyConfidence,
    v2Decision: v2Result.decision,
    v2Confidence: v2Result.confidence,
    v2ConfidenceBand: v2Result.confidenceBand,
    agree,
    disagreementSeverity,
    disagreementReasons,
    evidenceCompletenessScore: v2Result.evidenceCompletenessScore,
    evidenceQualityScore: v2Result.evidenceQualityScore,
    marketQualityScore: v2Result.marketQualityScore,
    unknownDimensions: v2Result.dimensions.filter((d) => d.state === "unknown").map((d) => d.key),
    negativeDimensions: v2Result.dimensions
      .filter((d) => d.state === "weak" || d.state === "unfavorable")
      .map((d) => d.key),
    v2Dimensions: v2Result.dimensions.map((d) => ({
      dimensionName: d.key,
      state: d.state,
      score: d.score,
      uncertainty: d.uncertainty,
      supportingEvidence: d.supportingEvidence,
      contradictingEvidence: d.contradictingEvidence,
      rationale: d.rationale,
      isHardBlocker: d.isHardBlocker === true,
    })),
    negativeEvidenceForNoGo: v2Result.decision === "NO_GO" ? v2Result.reasoning.strongestNegativeEvidence : [],
    reasoning: v2Result.reasoning,
    invariants: v2Result.invariants,
  };

  recordShadowComparisonToDisk({ status: "ok", ...comparison });
  rows.push(comparison);
}

console.log(
  pad("Scenario", 52) +
    pad("Legacy", 14) +
    pad("V2", 16) +
    pad("Agree?", 8) +
    "Severity"
);
console.log("-".repeat(100));
for (const row of rows) {
  console.log(
    pad(row.scenario.slice(0, 50), 52) +
      pad(`${row.legacyDecision} (${row.legacyConfidence})`, 14) +
      pad(`${row.v2Decision} (${row.v2Confidence})`, 16) +
      pad(row.agree ? "yes" : "NO", 8) +
      (row.agree ? "-" : row.disagreementSeverity)
  );
}

console.log("\nDisagreements:\n");
for (const row of rows.filter((r) => !r.agree)) {
  console.log(`- ${row.scenario}`);
  console.log(`    legacy=${row.legacyDecision} (${row.legacyConfidence}) vs v2=${row.v2Decision} (${row.v2Confidence}), severity=${row.disagreementSeverity}`);
  for (const reason of row.disagreementReasons) {
    console.log(`    reason: ${reason}`);
  }
  if (row.v2Decision === "NO_GO" && row.negativeEvidenceForNoGo.length > 0) {
    console.log(`    v2 negative evidence: ${row.negativeEvidenceForNoGo.join(" | ")}`);
  }
  console.log("");
}

const agreeCount = rows.filter((r) => r.agree).length;
console.log(`\nSummary: ${agreeCount}/${rows.length} scenarios agree, ${rows.length - agreeCount} disagree.`);
