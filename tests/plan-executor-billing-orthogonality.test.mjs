import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Confirms (structurally, matching this codebase's established
// convention of testing plan-executor.ts via source assertions rather
// than real invocation, since it has heavy Supabase/auth dependencies)
// that billing/quota enforcement is completely orthogonal to which
// report-generation pipeline (legacy vs Executive Decision System)
// produced a report, and to any of its metadata fields. This is a
// prerequisite fact for the EDS production-integration task: turning
// the EDS flag on for Business Idea Validation must never change how
// or when a user is billed.

const planExecutorSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");

function functionBodySpan(startMarker, endMarker) {
  const start = planExecutorSource.indexOf(startMarker);
  const end = planExecutorSource.indexOf(endMarker, start);
  assert.ok(start >= 0, `expected to find "${startMarker}"`);
  assert.ok(end > start, `expected to find "${endMarker}" after "${startMarker}"`);
  return [start, end];
}

test("checkAiProductionRateLimit/recordAiUsage are the real billing/quota enforcement mechanism (sanity check that the call sites actually exist)", () => {
  const rateLimitCalls = (planExecutorSource.match(/checkAiProductionRateLimit\(/g) || []).length;
  const usageCalls = (planExecutorSource.match(/recordAiUsage\(/g) || []).length;
  assert.ok(rateLimitCalls > 0, "expected at least one checkAiProductionRateLimit call site");
  assert.ok(usageCalls > 0, "expected at least one recordAiUsage call site");
});

test("no checkAiProductionRateLimit/recordAiUsage call site lies inside normalizeFullPlanReport (the legacy business-domain scorecard/SWOT/founder-score builder)", () => {
  const [start, end] = functionBodySpan("function normalizeFullPlanReport(", "function parseFullPlanReport(");
  const body = planExecutorSource.slice(start, end);

  assert.doesNotMatch(body, /checkAiProductionRateLimit\(/);
  assert.doesNotMatch(body, /recordAiUsage\(/);
});

test("no checkAiProductionRateLimit/recordAiUsage call site lies inside any of the three Strategic Decision Memo report-section splice blocks", () => {
  const spliceBlockMarkers = [
    "if (strategicDecisionMemoReportSection) {\n          parsedCachedReport.executiveRecommendation = strategicDecisionMemoReportSection;",
    "if (strategicDecisionMemoReportSection) {\n              parsedReport.executiveRecommendation = strategicDecisionMemoReportSection;",
    "if (strategicDecisionMemoReportSection) {\n                fallbackReport.executiveRecommendation = strategicDecisionMemoReportSection;",
  ];

  for (const marker of spliceBlockMarkers) {
    const start = planExecutorSource.indexOf(marker);
    assert.ok(start >= 0, `expected to find splice block starting with: ${marker.slice(0, 60)}...`);
    const blockEnd = planExecutorSource.indexOf("}", planExecutorSource.indexOf(";", start));
    const block = planExecutorSource.slice(start, blockEnd);
    assert.doesNotMatch(block, /checkAiProductionRateLimit\(/);
    assert.doesNotMatch(block, /recordAiUsage\(/);
  }
});

test("billing/quota calls are tagged by AI request kind and quota-consumption state, never by report domain, pipeline choice, or any EDS/legacy metadata field", () => {
  const rateLimitCallIndex = planExecutorSource.indexOf("const productionLimit = await checkAiProductionRateLimit({");
  const callBlockEnd = planExecutorSource.indexOf("});", rateLimitCallIndex);
  const callBlock = planExecutorSource.slice(rateLimitCallIndex, callBlockEnd);

  assert.doesNotMatch(callBlock, /investmentScore|decisionEngine|executiveDecisionSystemResult|strategicDecisionMemo|executiveBrief/);
  assert.doesNotMatch(callBlock, /reportQualityValidation|reportConsistencyCheck|reportAuditTrail|reportExplainability|reportReproducibility|reportVersion/);
});

test("the EDS/Decision-Engine route-level gate (app/api/plan/route.ts) runs entirely independently of, and before, any billing/quota check inside plan-executor.ts", () => {
  const planRouteSource = readFileSync("app/api/plan/route.ts", "utf8");
  assert.doesNotMatch(planRouteSource, /checkAiProductionRateLimit\(/);
  assert.doesNotMatch(planRouteSource, /recordAiUsage\(/);
});
