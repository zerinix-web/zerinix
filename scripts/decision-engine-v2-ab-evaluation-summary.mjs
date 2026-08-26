#!/usr/bin/env node
// Offline evaluation summary for Decision Engine V2's Controlled A/B
// Readiness Layer. Reads already-captured comparison records -- by
// default the local rich JSONL log shadow-log.ts already writes
// (app/lib/decision-engine-v2/shadow-log.ts, produced today by running
// the unit/fixture suite or scripts/decision-engine-v2-shadow-comparison.mjs;
// in the future, the same shape would come from exporting real
// production ab-readiness log lines) -- and computes the aggregate
// statistics needed to evaluate Legacy vs V2 decision quality:
//
//   - disagreement rate
//   - Legacy vs V2 decision distribution
//   - disagreement categories (direction x severity)
//   - false-NO_GO risk (Legacy rejected with no real negative evidence)
//   - false-GO risk (Legacy accepted despite V2 finding real negative evidence)
//   - confidence calibration differences
//   - which dimensions cause the most disagreements
//
// COST: zero. Pure offline aggregation over already-captured JSONL
// records -- no AI, search, or database call of any kind.
//
// Usage:
//   node scripts/decision-engine-v2-ab-evaluation-summary.mjs
//   node scripts/decision-engine-v2-ab-evaluation-summary.mjs --file path/to/export.jsonl

import { readFileSync } from "node:fs";
import { readShadowComparisonLog, shadowComparisonLogPath } from "../app/lib/decision-engine-v2/shadow-log.ts";

function parseArgs(argv) {
  const fileFlagIndex = argv.indexOf("--file");
  return { filePath: fileFlagIndex >= 0 ? argv[fileFlagIndex + 1] : null };
}

function loadEntries(filePath) {
  if (!filePath) return readShadowComparisonLog();
  return readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Normalizes either the rich local shadow-log shape (v2Dimensions: array
// of {dimensionName, state, ...}) or the compact ab-readiness shape
// (dimensionStates: {key: state}) into one {key -> state} map, so this
// script can evaluate either source without duplicating logic.
function dimensionStatesOf(entry) {
  if (entry.dimensionStates && typeof entry.dimensionStates === "object") {
    return entry.dimensionStates;
  }
  if (Array.isArray(entry.v2Dimensions)) {
    return Object.fromEntries(entry.v2Dimensions.map((d) => [d.dimensionName, d.state]));
  }
  return {};
}

function hasNegativeEvidenceOf(entry) {
  if (typeof entry.hasNegativeEvidence === "boolean") return entry.hasNegativeEvidence;
  const states = Object.values(dimensionStatesOf(entry));
  return states.some((s) => s === "weak" || s === "unfavorable");
}

const DECISION_RANK = { GO: 2, CONDITIONAL_GO: 1, NO_GO: 0 };

function main() {
  const { filePath } = parseArgs(process.argv.slice(2));
  const allEntries = loadEntries(filePath);
  // Only real, completed comparisons -- exclude "failed" status entries
  // (shadow-mode couldn't run V2 at all) and anything without a legacy
  // decision to compare against (nothing to compare, not a disagreement).
  const entries = allEntries.filter(
    (e) => e.status !== "failed" && e.legacyDecision && e.v2Decision
  );

  if (entries.length === 0) {
    console.log(`No usable comparison entries found${filePath ? ` in ${filePath}` : ` in ${shadowComparisonLogPath()}`}.`);
    console.log("Run scripts/decision-engine-v2-shadow-comparison.mjs first, or point --file at an export.");
    return;
  }

  const total = entries.length;
  const disagreements = entries.filter((e) => e.legacyDecision !== e.v2Decision);
  const disagreementRate = disagreements.length / total;

  const legacyDistribution = { GO: 0, CONDITIONAL_GO: 0, NO_GO: 0 };
  const v2Distribution = { GO: 0, CONDITIONAL_GO: 0, NO_GO: 0 };
  for (const e of entries) {
    legacyDistribution[e.legacyDecision] = (legacyDistribution[e.legacyDecision] || 0) + 1;
    v2Distribution[e.v2Decision] = (v2Distribution[e.v2Decision] || 0) + 1;
  }

  const categories = {};
  for (const e of disagreements) {
    const distance = Math.abs(DECISION_RANK[e.legacyDecision] - DECISION_RANK[e.v2Decision]);
    const severity = distance >= 2 ? "major" : "minor";
    const direction = DECISION_RANK[e.legacyDecision] < DECISION_RANK[e.v2Decision] ? "legacy_more_negative" : "legacy_more_positive";
    const key = `${direction}_${severity}`;
    categories[key] = (categories[key] || 0) + 1;
  }

  // FALSE-NO_GO RISK: Legacy said NO_GO, but V2 -- reasoning directly
  // over the dimension-level evidence -- found NO actual negative
  // evidence anywhere. This is the core failure mode Decision Engine V2
  // was built to catch: a legacy rejection driven by evidence-volume
  // gaps rather than any real negative finding.
  const legacyNoGoEntries = entries.filter((e) => e.legacyDecision === "NO_GO");
  const falseNoGoCases = legacyNoGoEntries.filter((e) => !hasNegativeEvidenceOf(e));
  const falseNoGoRisk = legacyNoGoEntries.length > 0 ? falseNoGoCases.length / legacyNoGoEntries.length : null;

  // FALSE-GO RISK (mirror image): Legacy said GO or CONDITIONAL_GO, but
  // V2 found real negative evidence AND landed on NO_GO -- i.e. Legacy's
  // evidence-volume scoring may have missed a genuine risk.
  const legacyAcceptEntries = entries.filter((e) => e.legacyDecision === "GO" || e.legacyDecision === "CONDITIONAL_GO");
  const falseGoCases = legacyAcceptEntries.filter((e) => e.v2Decision === "NO_GO" && hasNegativeEvidenceOf(e));
  const falseGoRisk = legacyAcceptEntries.length > 0 ? falseGoCases.length / legacyAcceptEntries.length : null;

  // CONFIDENCE CALIBRATION: how far apart the two engines' confidence
  // numbers run, on average, when both are available.
  const withBothConfidences = entries.filter(
    (e) => typeof e.legacyConfidence === "number" && typeof e.v2Confidence === "number"
  );
  const confidenceDiffs = withBothConfidences.map((e) => e.v2Confidence - e.legacyConfidence);
  const meanConfidenceDiff =
    confidenceDiffs.length > 0 ? confidenceDiffs.reduce((a, b) => a + b, 0) / confidenceDiffs.length : null;
  const meanAbsConfidenceDiff =
    confidenceDiffs.length > 0
      ? confidenceDiffs.reduce((a, b) => a + Math.abs(b), 0) / confidenceDiffs.length
      : null;

  // DIMENSIONS DRIVING DISAGREEMENT: for each disagreement, count which
  // V2 dimensions carried real negative evidence OR were unknown --
  // either can be the reason Legacy and V2 diverge (Legacy can't see
  // sentiment at all, so ANY V2 dimension reading is a candidate
  // explanation), ranked separately.
  const negativeDimensionFrequency = {};
  const unknownDimensionFrequency = {};
  for (const e of disagreements) {
    const states = dimensionStatesOf(e);
    for (const [key, state] of Object.entries(states)) {
      if (state === "weak" || state === "unfavorable") {
        negativeDimensionFrequency[key] = (negativeDimensionFrequency[key] || 0) + 1;
      }
      if (state === "unknown") {
        unknownDimensionFrequency[key] = (unknownDimensionFrequency[key] || 0) + 1;
      }
    }
  }

  const rank = (freq) =>
    Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => `${key} (${count})`);

  console.log(`Decision Engine V2 -- Offline A/B Evaluation Summary`);
  console.log(`Source: ${filePath || shadowComparisonLogPath()}`);
  console.log(`Comparisons analyzed: ${total}\n`);

  console.log(`Disagreement rate: ${(disagreementRate * 100).toFixed(1)}% (${disagreements.length}/${total})\n`);

  console.log(`Legacy decision distribution:`, legacyDistribution);
  console.log(`V2 decision distribution:    `, v2Distribution, "\n");

  console.log(`Disagreement categories:`);
  for (const [key, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${count}`);
  }
  console.log("");

  console.log(
    `False-NO_GO risk (Legacy NO_GO with NO actual negative V2 evidence): ${
      falseNoGoRisk === null ? "n/a (no Legacy NO_GO cases)" : `${(falseNoGoRisk * 100).toFixed(1)}% (${falseNoGoCases.length}/${legacyNoGoEntries.length})`
    }`
  );
  console.log(
    `False-GO risk (Legacy GO/CONDITIONAL_GO while V2 finds real negative evidence -> NO_GO): ${
      falseGoRisk === null ? "n/a (no Legacy accept cases)" : `${(falseGoRisk * 100).toFixed(1)}% (${falseGoCases.length}/${legacyAcceptEntries.length})`
    }\n`
  );

  console.log(
    `Confidence calibration (V2 - Legacy): mean diff = ${meanConfidenceDiff === null ? "n/a" : meanConfidenceDiff.toFixed(1)}, mean absolute diff = ${
      meanAbsConfidenceDiff === null ? "n/a" : meanAbsConfidenceDiff.toFixed(1)
    } (n=${confidenceDiffs.length})\n`
  );

  console.log(`Dimensions most often carrying NEGATIVE evidence in a disagreement:`);
  console.log(`  ${rank(negativeDimensionFrequency).join(", ") || "none"}`);
  console.log(`Dimensions most often UNKNOWN in a disagreement:`);
  console.log(`  ${rank(unknownDimensionFrequency).join(", ") || "none"}`);
}

main();
