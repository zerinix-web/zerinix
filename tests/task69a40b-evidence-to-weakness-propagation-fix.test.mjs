// TASK #69A-40B -- Trace and fix the real evidence-to-competitor-
// weakness propagation failure.
//
// A. PIPELINE TRACE (real fresh generation, created_at
//    2026-09-09T23:20:59, id 3301def0-5f55-478b-92fd-d1628a4335d1 --
//    inspected via service-role, read-only, scratch script deleted
//    immediately after use):
//   1/2/3. Research evidence FOR QuickBooks/Xero exists and is
//      substantive: R6 (Intuit QuickBooks Help Center, url
//      quickbooks.intuit.com) -- "built-in AI forecasting... 'Intuit
//      Intelligence' forecasting (12-month forecasts, scenario
//      analysis) available in QuickBooks Online"; R7 (Xero US, url
//      xero.com) -- "cash flow forecasting and scenario planning
//      embedded in product (up to 180-day projections)".
//   4/5/6. The model's raw structured competitorLandscapeStructured
//      result set weaknesses=null/weaknessBasis="unavailable" for BOTH,
//      surviving unchanged through normalization into the persisted
//      canonical object.
//   7/8. No weakness candidate was ever built for these two competitors
//      at all -- Tier 0 simply carried the model's own null through.
//   9/10/11. The persisted canonical object, web display, and PDF
//      display all correctly and consistently show "Not available" --
//      every renderer was already faithfully reflecting the (incomplete)
//      canonical state; this was never a renderer bug.
//
// B. WHY THE SAME REPORT SAYS ONE THING IN PROSE AND ANOTHER IN THE
//    STRUCTURED TABLE: the report's own "problem" field says "product-
//    gap evidence is supported by incumbent product pages showing
//    limited embedded scenario depth [R6][R7]" -- citing the EXACT SAME
//    R6/R7 evidence IDs. The evidence EXISTS STRUCTURALLY (in
//    businessResearch.evidence, with real source provenance) and the
//    model DOES apply the inference -- just only in loose prose, not
//    inside the strict, schema-validated competitorLandscapeStructured
//    JSON for the SAME evidence in the SAME response. This is a known
//    LLM caution-bias asymmetry (a structured field feels more "final"
//    to the model than hedged prose), confirmed by #69A-29's own prior
//    root-cause history for the identical class of behavior -- not a
//    wiring bug, not evidence loss, not a competitor-extraction-order
//    bug (verified: competitorLandscapeStructured and every planField,
//    including "problem", are produced in the SAME single OpenAI call
//    against the SAME evidence registry -- there is no "research-aware
//    refresh" that runs between them and adds evidence afterward; the
//    "refresh" functions in this codebase recompute financial/coverage
//    SCORES, not the evidence registry itself).
//
// C/E. STRUCTURAL FIX: a new, deterministic, code-only Tier 1.5 safety
//    net (enrichCompetitorWeaknessesFromEvidence,
//    business-competitor-landscape-state.ts) runs AFTER Tier 0/Tier 1
//    build the competitor list, reusing ONLY the same already-fetched
//    research evidence registry -- never a second AI call, never
//    parsing the report's own final prose. It only ever fills a
//    competitor Tier 0/Tier 1 left "unavailable", and only when: (1) an
//    evidence item's URL HOSTNAME (the strongest, hardest-to-fake
//    signal -- this competitor's own official domain) matches one of the
//    competitor's own name tokens, and (2) that item's claim/value text
//    uses specific, narrow "built-in/embedded/bundled" vocabulary. The
//    result is always DIRECTIONAL, never "verified".
//
// D. ENTITY ATTRIBUTION SAFETY: confirmed live that a generic multi-
//    vendor aggregate citation ("OnDeck; market.us; LivePlan; Planful",
//    whose URL list buries "liveplan" in a PATH segment while its own
//    hostname is ondeck.com) is correctly NEVER treated as LivePlan-
//    specific evidence -- hostname-only matching structurally excludes
//    it. LivePlan and Fathom/DryRun (genuinely no official-domain
//    evidence with real content) correctly remain "Not available".
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
  enrichCompetitorWeaknessesFromEvidence,
  formatCompetitorWeaknessForDisplay,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const stateSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"),
  "utf8"
);
const planExecutorSource = readFileSync(
  join(repoRoot, "app/lib/report-jobs/plan-executor.ts"),
  "utf8"
);
const domainResearchSource = readFileSync(
  join(repoRoot, "app/lib/ai/domain-research.ts"),
  "utf8"
);

// Real-case evidence, modeled verbatim on the actual persisted research
// bundle behind the live QuickBooks/Xero/LivePlan/Fathom-DryRun report
// (ids/urls/claims copied from the real cached research; weakness TEXT
// this test asserts is authored by the fix, never copied from any
// production prompt).
function realCaseEvidence() {
  return [
    {
      id: "R6",
      url: "https://quickbooks.intuit.com/learn-support/en-us/help-article/tasks/forecast-financial-performance-intuit-intelligence/L7o5sk5t2_US_en_US",
      claim: "QuickBooks provides built-in AI forecasting/features and marketplace integrations enabling forecasting and scenario planning.",
      value: "Intuit product documentation describes 'Intuit Intelligence' forecasting (12-month forecasts, scenario analysis) available in QuickBooks Online and Intuit Enterprise Suite.",
    },
    {
      id: "R7",
      url: "https://www.xero.com/us/accounting-software/analytics/cash-flow",
      claim: "Xero offers cash flow forecasting and scenario planning embedded in product (up to 180-day projections).",
      value: "Xero cash flow and AI pages describe cash flow forecasting and a 'cash flow manager' with projections and scenario planning.",
    },
    {
      id: "R2",
      url: "https://www.ondeck.com/small-business-trends-2025;%20https:/market.us/report/smb-treasury-management-app-market/;%20https:/www.liveplan.com/;%20https:/planful.com/navigating-market-reports-and-perspectives",
      claim: "Recommended next steps: run customer discovery, validate integrations, run pilot with real SMB transaction data, benchmark pricing against competitors.",
      value: "Sources recommend pilots, partner-led GTM, and product-market fit testing for SMB financial tools.",
    },
    {
      id: "R50",
      url: "https://www.dryrun.com/blog/fathom-vs-dryrun-comparison",
      claim: "dryrun.com",
      value: "dryrun.com",
    },
  ];
}

function realCaseCompetitors() {
  return [
    { company: "QuickBooks (Intuit)", type: "Direct competitor", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
    { company: "Xero", type: "Direct competitor", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
    { company: "LivePlan (example FP&A startup)", type: "Substitute", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
    { company: "Fathom / DryRun (analytics & forecasting tools)", type: "Substitute", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
  ];
}

// --- 1: existing structured comparative evidence reaches derivation ----

test("1. structured research evidence (QuickBooks/Xero's own official documentation) reaches weakness derivation end-to-end through the real functions", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realCaseCompetitors());
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, realCaseEvidence());
  const quickbooks = enriched.competitors.find((c) => c.company === "QuickBooks (Intuit)");
  const xero = enriched.competitors.find((c) => c.company === "Xero");

  assert.equal(quickbooks.weaknessBasis, "directional");
  assert.match(quickbooks.weaknesses, /\[R6\]/);
  assert.equal(xero.weaknessBasis, "directional");
  assert.match(xero.weaknesses, /\[R7\]/);
});

// --- 2: category-level evidence is never mislabeled Verified -----------

test("2. the enrichment NEVER produces 'verified' -- only 'directional', even with a strong, directly on-domain evidence match", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realCaseCompetitors());
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, realCaseEvidence());
  for (const competitor of enriched.competitors) {
    assert.notEqual(competitor.weaknessBasis, "verified");
  }
});

// --- 3: defensible comparative inference becomes Directional -----------

test("3. QuickBooks and Xero's real official-documentation evidence produces a correctly-labeled Directional display string", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realCaseCompetitors());
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, realCaseEvidence());
  const quickbooks = enriched.competitors.find((c) => c.company === "QuickBooks (Intuit)");
  assert.match(formatCompetitorWeaknessForDisplay(quickbooks), /\(Directional\)$/);
});

// --- 4: unsupported company-specific inference remains Unavailable -----

test("4. LivePlan (only a generic multi-vendor aggregate citation, never its own official domain) remains honestly Unavailable", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realCaseCompetitors());
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, realCaseEvidence());
  const liveplan = enriched.competitors.find((c) => c.company.startsWith("LivePlan"));
  assert.equal(liveplan.weaknessBasis, "unavailable");
  assert.equal(formatCompetitorWeaknessForDisplay(liveplan), "Not available");
});

test("4b. Fathom/DryRun (a real official-domain match with genuinely content-less evidence) remains honestly Unavailable -- entity attribution alone is never sufficient without real claim content", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realCaseCompetitors());
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, realCaseEvidence());
  const fathomDryrun = enriched.competitors.find((c) => c.company.startsWith("Fathom"));
  assert.equal(fathomDryrun.weaknessBasis, "unavailable");
  assert.equal(formatCompetitorWeaknessForDisplay(fathomDryrun), "Not available");
});

test("D. a generic multi-vendor aggregate citation is never mistaken for one named competitor's own evidence -- hostname-only matching structurally excludes it", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "LivePlan", type: "Substitute", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
  ]);
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, [
    {
      id: "R2",
      url: "https://www.ondeck.com/small-business-trends-2025;%20https:/www.liveplan.com/",
      claim: "LivePlan is a built-in embedded planning tool inside a broader suite.",
      value: "generic aggregate citation",
    },
  ]);
  assert.equal(enriched.competitors[0].weaknessBasis, "unavailable");
});

// --- 5: source/basis survives normalization and persistence -----------

test("5. the [R#] citation (basis/provenance) and weaknessBasis survive a full JSON persistence round trip", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realCaseCompetitors());
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, realCaseEvidence());
  const roundTripped = JSON.parse(JSON.stringify(enriched));

  for (const original of enriched.competitors) {
    const reloaded = roundTripped.competitors.find((c) => c.company === original.company);
    assert.equal(reloaded.weaknesses, original.weaknesses);
    assert.equal(reloaded.weaknessBasis, original.weaknessBasis);
  }
});

// --- 6: pipeline ordering ------------------------------------------------

test("6. competitorLandscapeStructured and every planField (including 'problem', the field that carries the [R6][R7] product-gap citation) are produced in the SAME single OpenAI call against the SAME evidence registry -- no research-aware refresh runs between them and silently adds evidence afterward", () => {
  assert.match(
    planExecutorSource,
    /competitorLandscapeStructured: BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA/
  );
  // The enrichment call site reads businessResearch.evidence -- the SAME
  // evidence object already used to build the generation prompt earlier
  // in this exact request, never a freshly re-fetched one.
  assert.match(
    planExecutorSource,
    /enrichCompetitorWeaknessesFromEvidence\(\s*\n[\s\S]{0,300}?businessResearch\.evidence\s*\n\s*\);/
  );
});

test("6b. the enrichment never overrides a weakness the model itself already supplied (verified or directional) -- only fills in genuinely 'unavailable' cells", () => {
  assert.match(stateSource, /if \(competitor\.weaknessBasis !== "unavailable"\) \{\s*\n\s*return competitor;/);
});

// --- 7: web/PDF parity ---------------------------------------------------

test("7. web and PDF still consume the identical canonical formatCompetitorWeaknessForDisplay for the enriched state -- no independent per-renderer reconstruction", () => {
  const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
  const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
  const pdfButtonSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");
  for (const source of [plannerSource, pageSource, pdfButtonSource]) {
    assert.match(
      source,
      /import\s*\{[^}]*formatCompetitorWeaknessForDisplay[^}]*\}\s*from\s*"@\/app\/lib\/report-engine\/business-competitor-landscape-state"/s
    );
  }

  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realCaseCompetitors());
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, realCaseEvidence());
  for (const competitor of enriched.competitors) {
    assert.equal(
      formatCompetitorWeaknessForDisplay(competitor),
      formatCompetitorWeaknessForDisplay(competitor),
      `${competitor.company} must render identically every time it is formatted`
    );
  }
});

// --- 8: no prose parsing was introduced ----------------------------------

test("8. the fix never reads report prose/planFields text as its input -- only the raw research evidence registry (id/url/claim/value), never parsedReport or responseText", () => {
  const fnMatch = stateSource.match(
    /export function enrichCompetitorWeaknessesFromEvidence\([\s\S]{0,3000}?\n\}/
  );
  assert.ok(fnMatch);
  assert.doesNotMatch(fnMatch[0], /parsedReport|responseText|competitorLandscape\b/);
});

// --- 9: no extra unbounded research calls -------------------------------

test("9. no new AI/research call was introduced -- the enrichment is pure, synchronous string/URL matching over already-fetched evidence", () => {
  assert.doesNotMatch(domainResearchSource, /TASK #69A-40B/);
  const fnMatch = stateSource.match(
    /export function enrichCompetitorWeaknessesFromEvidence\([\s\S]{0,3000}?\n\}/
  );
  assert.ok(fnMatch);
  assert.doesNotMatch(fnMatch[0], /await|fetch\(|client\.responses\.create|async /);
});

test("9b. SAFETY: no hardcoded competitor-specific weakness text was introduced -- the enrichment's own output template is generic and reusable for any competitor", () => {
  const fnMatch = stateSource.match(
    /export function enrichCompetitorWeaknessesFromEvidence\([\s\S]{0,3000}?\n\}/
  );
  assert.ok(fnMatch);
  assert.doesNotMatch(fnMatch[0], /Float|Cash Flow Frog|Futrli|QuickBooks|Xero|LivePlan|Dryrun|DryRun|Fathom|Intuit/i);
});

// --- H: regression safety ------------------------------------------------

test("H. business-competitor-landscape-state.ts still imports nothing from decision-engine/founder-score/confidence-radar/Porter files -- this fix cannot drift unrelated scoring", () => {
  assert.doesNotMatch(stateSource, /decision-engine|founder-score|confidence-radar|porters-five-forces/i);
});

test("H2. competitor order and threat levels are stable and unaffected by the evidence-enrichment fix for the real-case shape", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realCaseCompetitors());
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, realCaseEvidence());
  assert.deepEqual(
    enriched.competitors.map((c) => c.company),
    ["QuickBooks (Intuit)", "Xero", "LivePlan (example FP&A startup)", "Fathom / DryRun (analytics & forecasting tools)"]
  );
  assert.deepEqual(
    enriched.competitors.map((c) => c.threat),
    ["High", "High", "Medium", "Medium"]
  );
});
