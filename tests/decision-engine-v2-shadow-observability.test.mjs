import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, rmSync } from "node:fs";
import {
  recordShadowComparisonToDisk,
  readShadowComparisonLog,
  shadowComparisonLogPath,
} from "../app/lib/decision-engine-v2/shadow-log.ts";
import { runDecisionEngineV2ShadowMode } from "../app/lib/decision-engine-v2/shadow-mode.ts";
import { buildMarketIntelligenceGraph } from "../app/lib/ai/market-intelligence-graph.ts";
import { evaluateMarketResearchCoverage } from "../app/lib/ai/market-research-coverage.ts";

// This suite verifies the OBSERVABILITY fix itself: the previous
// shadow-mode implementation only logged via logOperationalInfo, whose
// metadata argument the Next.js dev logger silently drops when writing
// to disk (confirmed live: "[decision-engine-v2] shadow comparison
// {}"). recordShadowComparisonToDisk is the reliable replacement sink
// -- these tests assert it actually persists a complete, parseable
// structured record, never throws, and never fabricates fields.
//
// PRE-COMMIT AUDIT FIX: this file used to `resetLog()` (delete the
// shared JSONL log) and then assert on the file's RAW total entry
// count. `node --test` runs test FILES concurrently by default, and
// tests/decision-engine-v2-ab-readiness.test.mjs also calls
// runDecisionEngineV2ShadowMode (which appends to the SAME shared
// file) -- so a concurrent write from that file could land in the
// window between this file's reset and its own read, inflating the
// count and producing a genuinely flaky (non-deterministic) failure.
// Confirmed reproducible: `npm test` failed intermittently across
// repeated runs with the same fixture. Every assertion below now
// FILTERS the shared log by the specific reportRequestId each test
// used, rather than trusting the file's raw total length -- correct
// regardless of what else concurrently writes to the same file.
function resetLog() {
  const path = shadowComparisonLogPath();
  if (existsSync(path)) rmSync(path);
}

function entriesFor(reportRequestId) {
  return readShadowComparisonLog().filter((e) => e.reportRequestId === reportRequestId);
}

test("recordShadowComparisonToDisk writes a complete, parseable JSON line", () => {
  recordShadowComparisonToDisk({ reportRequestId: "req-write-1", v2Decision: "GO", v2Confidence: 80 });
  const entries = entriesFor("req-write-1");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].v2Decision, "GO");
  assert.equal(entries[0].v2Confidence, 80);
  assert.equal(typeof entries[0].loggedAt, "string");
});

test("recordShadowComparisonToDisk appends -- multiple entries are all individually readable", () => {
  recordShadowComparisonToDisk({ reportRequestId: "req-append-1", v2Decision: "GO" });
  recordShadowComparisonToDisk({ reportRequestId: "req-append-2", v2Decision: "NO_GO" });
  assert.equal(entriesFor("req-append-1").length, 1);
  assert.equal(entriesFor("req-append-1")[0].v2Decision, "GO");
  assert.equal(entriesFor("req-append-2").length, 1);
  assert.equal(entriesFor("req-append-2")[0].v2Decision, "NO_GO");
});

test("recordShadowComparisonToDisk redacts sensitive-looking keys the same way logOperationalInfo does", () => {
  recordShadowComparisonToDisk({ reportRequestId: "req-redact-1", sessionToken: "sk-abcdefghijklmnopqrstuvwxyz" });
  const entries = entriesFor("req-redact-1");
  assert.equal(entries.length, 1);
  assert.notEqual(entries[0].sessionToken, "sk-abcdefghijklmnopqrstuvwxyz");
});

test("recordShadowComparisonToDisk never throws even if given circular-unsafe input shapes", () => {
  assert.doesNotThrow(() => {
    recordShadowComparisonToDisk({ reportRequestId: "req-circular-1", value: undefined });
  });
});

test("readShadowComparisonLog never throws and returns no entries for an id that was never written (also covers the file-does-not-exist-yet path)", () => {
  resetLog();
  // A random, never-reused id -- unlike asserting the WHOLE shared file
  // is empty, this can never be invalidated by another test FILE
  // concurrently appending its own (differently-id'd) entries, while
  // still exercising the exact same "no matching data" return-empty-
  // array behavior, including the file-not-found case in the common
  // case immediately after resetLog().
  const neverWrittenId = `never-written-${Math.random()}`;
  assert.deepEqual(entriesFor(neverWrittenId), []);
});

// --- End-to-end: shadow-mode now persists the FULL comparison required
// by the observability ticket (legacy decision/confidence, V2
// decision/confidence, full V2 dimension states/scores, evidence
// completeness, evidence quality, disagreement reasons, unknown
// dimensions, and explicit negative evidence for any NO_GO). ---

const checkedAt = "2026-08-02T00:00:00.000Z";

function evidence({ id, field, claim, url, confidence = 76, qualityScore = 62 }) {
  return {
    id,
    field,
    claim,
    value: claim,
    label: "Verified from external source",
    sourceTitle: `${id} source`,
    publisher: `${id} publisher`,
    url,
    sourceType: "official company source",
    authorityLevel: "secondary",
    confidence,
    publishedDate: "2025-06-01",
    lastChecked: checkedAt,
    supportingData: [claim],
    impact: "neutral",
    impactReason: "x",
    qualityScore,
    qualityRationale: "x",
  };
}

test("runDecisionEngineV2ShadowMode persists a complete structured comparison record with every required field", () => {
  resetLog();

  const evidenceItems = [
    evidence({
      id: "R1",
      field: "market_size",
      url: "https://www.census.gov/market-size",
      claim: "The market size is $2 billion.",
    }),
    evidence({
      id: "R2",
      field: "competitors",
      url: "https://competitor-a.example.com",
      claim: "Competitor A is a dominant incumbent with high switching costs and entrenched competitors.",
    }),
  ];
  const prompt = "Evaluate this market.";
  const graph = buildMarketIntelligenceGraph({ evidence: evidenceItems }, prompt);
  const coverage = evaluateMarketResearchCoverage(evidenceItems, prompt);
  const sections = {
    marketOverview: "Demand is declining as the category matures and shrinks.",
    competitiveLandscape:
      "A dominant incumbent controls the category with high switching costs and entrenched competitors.",
  };

  const result = runDecisionEngineV2ShadowMode({
    decisionInput: { sections, coverage, graph },
    executiveSummaryText: "Executive Decision: ENTER (Confidence: 70%)",
    reportRequestId: "shadow-observability-test-1",
    isPartialReport: false,
  });

  assert.ok(result, "shadow mode should return a real result for a well-formed input");

  const entries = entriesFor("shadow-observability-test-1");
  assert.equal(entries.length, 1);
  const entry = entries[0];

  for (const key of [
    "legacyDecision",
    "legacyConfidence",
    "v2Decision",
    "v2Confidence",
    "v2Dimensions",
    "evidenceCompletenessScore",
    "evidenceQualityScore",
    "disagreementReasons",
    "unknownDimensions",
    "negativeEvidenceForNoGo",
  ]) {
    assert.ok(key in entry, `expected shadow log entry to contain "${key}"`);
  }

  assert.equal(entry.legacyDecision, "GO");
  assert.equal(entry.status, "ok");
  assert.ok(Array.isArray(entry.v2Dimensions) && entry.v2Dimensions.length > 0);
  // The fixture describes an explicitly declining/shrinking market with
  // a dominant, entrenched incumbent -- real negative evidence, not a
  // gap. If V2 reaches NO_GO here, invariant 3 requires the specific
  // negative evidence to be captured, not just the code.
  if (entry.v2Decision === "NO_GO") {
    assert.ok(
      Array.isArray(entry.negativeEvidenceForNoGo) && entry.negativeEvidenceForNoGo.length > 0,
      "a logged NO_GO must carry explicit negative evidence in the observability record"
    );
  }

  resetLog();
});

test("runDecisionEngineV2ShadowMode logs a 'failed' status entry (not silence, not a thrown error) on invalid input", () => {
  resetLog();
  const result = runDecisionEngineV2ShadowMode({
    // Missing coverage/graph entirely -- exercises the catch branch.
    decisionInput: /** @type {any} */ ({ sections: {} }),
    executiveSummaryText: "",
    reportRequestId: "shadow-observability-test-2",
    isPartialReport: false,
  });
  assert.equal(result, null);
  const entries = entriesFor("shadow-observability-test-2");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, "failed");
  assert.equal(typeof entries[0].message, "string");
  resetLog();
});
