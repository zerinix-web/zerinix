import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

// Incident context (2026-08-08): report cost regressed ~25x
// (~$0.012/report -> ~$0.30/report) with a matching latency increase.
// Root cause (already fixed, pinned by tests/ai-cost-optimization-pass.test.mjs):
// domain-research.ts's 4 parallel research-stage calls were hardcoded to
// gpt-5.5 (introduced 2026-08-01, fixed 2026-08-08) -- ~20x/15x pricier
// than gpt-5-mini, run 4x per report. The tests below cover the two
// real, still-open secondary bugs this incident's investigation
// surfaced, neither of which was the primary driver but both of which
// are real duplicate/excess-cost risks worth closing.

test("the business-plan usage-write is awaited, closing the once-per-report duplicate-call race", () => {
  // Regression guard: this write sets actual_ai_call: true, which
  // countAiCallsForReport relies on to block a second real generation
  // call for the same reportRequestId. Previously fire-and-forget
  // (`void withReportTimeout(...)`), it left a race window where a
  // retry's guard check could run before this write landed and see zero
  // recorded calls -- allowing a duplicate, full-price generation.
  // market-analysis/route.ts already awaits the equivalent write; this
  // pins plan-executor.ts matching that pattern.
  const source = read("app/lib/report-jobs/plan-executor.ts");

  assert.match(
    source,
    /await withReportTimeout\(\s*\n\s*\(async \(\) => \{\s*\n\s*if \(!isReportGenerationFailureText\(cacheResponseText\)\)/,
    "the cache-write + usage-write block must be awaited, not fire-and-forget"
  );
  assert.doesNotMatch(
    source,
    /void withReportTimeout\(\s*\n\s*\(async \(\) => \{\s*\n\s*if \(!isReportGenerationFailureText/,
    "must not regress back to the fire-and-forget void form"
  );

  // market-analysis/route.ts's equivalent write is the pattern this was
  // brought in line with -- confirm it's still awaited too, so a future
  // edit to one side doesn't silently reintroduce the asymmetry.
  const marketSource = read("app/api/market-analysis/route.ts");
  assert.match(marketSource, /await withReportTimeout\(\s*\n\s*\(async \(\) => \{/);
});

test("a missing or non-string report field defaults to the cheap full-report path, not the expensive per-field legacy path", () => {
  // Regression guard: previously `typeof field === "string" ? field :
  // "executiveSummary"` -- a malformed/missing field silently routed
  // into the legacy per-field branch, which runs its own live web
  // search per field (the single most expensive path in this file).
  // Every real caller always sends field: "fullReport" explicitly, so
  // this only changes behavior for a request that was already
  // malformed -- from "silently expensive" to "safe and cheap".
  const source = read("app/lib/report-jobs/plan-executor.ts");

  assert.match(
    source,
    /const requestedField = typeof field === "string" \? field : FULL_REPORT_FIELD;/
  );
  assert.doesNotMatch(
    source,
    /const requestedField = typeof field === "string" \? field : "executiveSummary";/
  );

  // market-analysis/route.ts takes a different, already-safe shape here
  // (requestedField can end up undefined, but isMarketReportField(...)
  // rejects it with a 400 immediately after) -- confirm that guard is
  // still present so this file doesn't need the same fix.
  const marketSource = read("app/api/market-analysis/route.ts");
  assert.match(marketSource, /if \(!isMarketReportField\(reportField\)\) \{/);
});

test("the request-understanding classifier sets an explicit, minimal reasoning effort", () => {
  // This call gates every chat/plan/market-analysis request (it runs
  // first, before any report-specific pipeline). It previously omitted
  // `reasoning` entirely, unlike every sibling classification/extraction
  // call in the codebase, risking unnecessary reasoning-token latency on
  // a task its own instructions describe as conservative, schema-only
  // classification.
  const source = read("app/api/understanding/route.ts");

  assert.match(source, /reasoning: \{ effort: "minimal" \},\s*\n\s*text: \{ format: createUnderstandingJsonSchema\(\) \}/);
});

test("no user-facing report-generation call site uses a premium-tier model (gpt-5.5 / gpt-5.6-sol / gpt-5.6-terra)", () => {
  // Broad regression guard for the actual root cause of this incident:
  // a hardcoded premium-model literal bypassing the router. Scans every
  // real call site file for a bare premium-model string assigned to a
  // model variable (not inside a pricing-table object literal, which is
  // expected and fine).
  const filesToCheck = [
    "app/lib/ai/domain-research.ts",
    "app/lib/report-jobs/plan-executor.ts",
    "app/api/market-analysis/route.ts",
    "app/api/chat/route.ts",
    "app/api/understanding/route.ts",
    "app/lib/ai/research-entity-extraction.ts",
  ];
  const premiumModelAssignment = /(?:const|let)\s+\w*[Mm]odel\w*\s*=\s*["'](gpt-5\.5|gpt-5\.6-sol|gpt-5\.6-terra)["']/;

  for (const file of filesToCheck) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      premiumModelAssignment,
      `${file} must not hardcode a premium-tier model as a call-site model variable`
    );
  }
});

test("EDS/Decision Engine/Brain Orchestrator remain off by default and structurally cannot duplicate the real generation call", () => {
  // Regression guard for a hypothesis this incident's investigation
  // ruled out, so a future change can't silently reintroduce it: these
  // three systems must stay strictly `=== "true"` gated (no inverted or
  // unsafe-default check), and must never run additionally alongside
  // (only ever gate or annotate) the one real report-generation call.
  const routeSource = read("app/api/plan/route.ts");

  assert.match(routeSource, /ZERINIX_BRAIN_ORCHESTRATOR_ENABLED === "true"/);

  const edsSource = read("app/lib/ai/executive-decision-system.ts");
  assert.match(edsSource, /=== "true"/);

  const decisionEngineSource = read("app/lib/ai/decision-engine.ts");
  assert.match(decisionEngineSource, /=== "true"/);
});
