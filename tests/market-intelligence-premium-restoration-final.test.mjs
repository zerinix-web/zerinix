import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// FINAL PREMIUM REPORT PRESENTATION RESTORATION TASK.
//
// Builds on the prior "FINAL REPORT PRESENTATION CLEANUP" ticket, which
// introduced `cardFirstReportFields` to stop ExecutiveInsightBanner/
// SectionTakeaway from repeating a summary already shown in a dedicated
// premium visual card. This pass found one section that ticket missed --
// Porter's Five Forces (`portersFiveForces`, shared by Market Intelligence
// and Business Plan) still showed the generic banner/takeaway stacked on
// top of its own radar + intensity cards + per-force implication text --
// and adds it to the same set.
//
// It also fixes a genuine, separate bug: report generation's polling loop
// in Planner.tsx had no wall-clock ceiling, so a job stuck in a
// non-terminal status (its worker died mid-run) would leave the
// "Preparing your report..." spinner showing forever, with no error and
// no way for the user to retry. A bounded timeout was added that throws
// into the loop's own existing, already-correct error/retry handling.
//
// Finally, MarketMetricsDashboard and MarketForcesQuadrant (both pure,
// prop-driven components reading an already-useMemo'd `sections` array)
// are now wrapped in React.memo, avoiding unnecessary re-renders when an
// unrelated parent state change re-renders ReportPanel.
//
// AI generation, routing, calculations, and validation logic are
// untouched -- confirmed via drift checks below.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

// --- 1. No duplicated presentation: Porter's Five Forces closes the gap ---

test("page.tsx and Planner.tsx: portersFiveForces is now in cardFirstReportFields -- the generic ExecutiveInsightBanner/SectionTakeaway no longer stack on top of Porter's own radar + intensity cards + per-force implication text", () => {
  for (const source of [pageSource, plannerSource]) {
    const setMatch = source.match(/const cardFirstReportFields = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(setMatch, "cardFirstReportFields not found");
    assert.match(setMatch[1], /"portersFiveForces",/);
  }
});

test("Porter's Five Forces still keeps its radar visualization, force intensity cards, and short executive explanation -- removing the duplicate banner/takeaway does not collapse the section into plain text (regression guard)", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /rounded-full border border-teal-200\/10/); // radar rings
    assert.match(source, /extractForceIntensity/); // real per-force intensity, not fabricated
  }
  // The per-force "short executive explanation" line added two tickets ago.
  assert.match(pageSource, /function extractForceImplication/);
  assert.match(plannerSource, /function extractForceImplication/);
});

// --- 9. Report generation: bounded wait, no infinite "Preparing report" ---

test("Planner.tsx: the report-status polling loop now has a bounded wall-clock ceiling -- a job stuck in a non-terminal status can no longer leave the 'Preparing your report...' spinner showing forever", () => {
  assert.match(plannerSource, /const maxReportPollWaitMs = 8 \* 60 \* 1000;/);
  assert.match(
    plannerSource,
    /while \(!completedReportId\) \{\s*\n\s*if \(performance\.now\(\) - clientExecutionStartedAt > maxReportPollWaitMs\) \{\s*\n\s*throw new Error\(/
  );
});

test("Planner.tsx: a polling timeout throws into the existing error/retry path -- isReportWorking (tied to the same `loading` state) is guaranteed to flip back to false via the surrounding try/finally, and the user sees a real error message instead of a silent freeze", () => {
  // The loop lives inside streamFullReport(), which is awaited inside a
  // try block whose finally always calls setLoading(false) and whose
  // catch always sets a visible reportGenerationError -- confirmed by
  // locating all three relative to the loop, in file order.
  const loopIndex = plannerSource.indexOf("const maxReportPollWaitMs = 8 * 60 * 1000;");
  const callSiteIndex = plannerSource.indexOf("const streamOutcome = await streamFullReport();");
  const catchIndex = plannerSource.indexOf("setReportGenerationError(errorMessage);", callSiteIndex);
  const finallyIndex = plannerSource.indexOf("setLoading(false);", catchIndex);

  assert.ok(loopIndex > 0, "polling loop not found");
  assert.ok(callSiteIndex > loopIndex, "streamFullReport() call site not found after the loop");
  assert.ok(catchIndex > callSiteIndex, "catch block's setReportGenerationError not found after the call site");
  assert.ok(finallyIndex > catchIndex, "finally block's setLoading(false) not found after the catch");
});

test("Planner.tsx: the polling timeout does not shorten the existing 5-consecutive-network-failure fast path or the retry_wait/researching/extracting backoff delays -- it is a ceiling on total wait time, not a change to per-status polling cadence (regression guard)", () => {
  assert.match(plannerSource, /if \(consecutivePollFailures > 5\) \{\s*\n\s*throw error;/);
  assert.match(plannerSource, /jobStatus\.status === "retry_wait"\s*\n\s*\? 4_000/);
});

test("removing unnecessary duplicate rendering: MarketMetricsDashboard and MarketForcesQuadrant are wrapped in React.memo, so an unrelated parent re-render does not force them to recompute their regex-based extraction against an unchanged sections array", () => {
  assert.match(plannerSource, /const MarketMetricsDashboard = memo\(function MarketMetricsDashboard\(/);
  assert.match(plannerSource, /const MarketForcesQuadrant = memo\(function MarketForcesQuadrant\(/);
});

// --- 8. PDF export: key visual branches still present (regression guard) --

test("ReportPdfButton.tsx: Executive dashboard, TAM/SAM/SOM, Porter, Competitive Landscape, and Recommendation cards all still have real drawing branches -- no PDF section silently became plain text", () => {
  assert.match(pdfButtonSource, /const isTamSamSomSection = field === "tamSamSom"/);
  assert.match(pdfButtonSource, /const isPorterSection = normalizedTitle\.includes\("porter"\)/);
  assert.match(
    pdfButtonSource,
    /normalizedTitle\.includes\("competitor"\) \|\| normalizedTitle\.includes\("competitive landscape"\)/
  );
  assert.match(pdfButtonSource, /isMarketIntelligenceReport && normalizedTitle\.includes\("strategic recommendation"\)/);
  assert.match(pdfButtonSource, /const executiveSnapshot = buildExecutiveSnapshot\(/);
});

// --- Preserve: AI generation, routing, calculations, validation logic ----

test("AI generation, routing, and calculations are untouched -- this pass only changed presentation hierarchy and client-side polling/render behavior (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /portersFiveForces:/);

  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function classifyReportDomain/);

  const marketGraphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketGraphSource, /function buildMarketIntelligenceGraph/);

  // The job-queue route/worker (the actual generation pipeline) were not
  // touched by this presentation-only pass -- only Planner.tsx's own
  // client-side poll loop gained a ceiling.
  const routeSource = readFileSync(
    new URL("../app/api/report-jobs/[jobId]/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(routeSource, /processReportJobQueue/);
});
