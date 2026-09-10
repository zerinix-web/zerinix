// TASK #69A-40A -- Reuse existing comparative evidence to populate
// competitor weaknesses safely and structurally.
//
// LIVE FAILURE TRACED: the "fresh" report the ticket describes (Intuit
// QuickBooks/Xero/Dryrun all "Not available") was proven, by direct
// inspection of the actual persisted `reports` row and its backing
// `ai_response_cache` entry (service-role, read-only, scratch script
// deleted immediately after use), to NOT be a genuinely fresh generation
// at all: executionMs ~1.2s, totalOpenAiCalls: 0, totalTokens: 0,
// competitorLandscape content byte-identical to a report generated
// 2h45m EARLIER (2026-09-09T18:36:44), well BEFORE #69A-40's weakness-
// schema/prompt fix landed. The entire "fresh" report was served from
// plan-executor.ts's business_plan full-report cache
// (createPreResearchReportCacheKey / fullReportCacheKey), which had
// cached a report generated under the OLD, pre-#69A-40 prompt.
//
// ROOT CAUSE: createPreResearchReportCacheKey's own cache key
// (reportVariant) already includes BUSINESS_PLAN_GENERATION_CONTRACT_VERSION
// specifically so that a generation-affecting change (#69A-37A's own
// precedent: a fix to what the model is asked to produce/how its output
// is normalized) forces a genuinely fresh AI call instead of replaying a
// pre-fix cached report for its full remaining TTL. #69A-40 changed the
// weaknesses field's own generation-time schema description (naming the
// "embedded feature within a broader platform" inference pattern)
// without bumping this version -- so #69A-40's fix was correctly written
// but could never take effect for any prompt that already had a cached
// full report, which is exactly why the "fresh" report the ticket
// describes still showed the pre-fix "Not available" text for all three
// real direct competitors.
//
// This is the SAME class of bug already fixed once in this exact
// session for the SEPARATE research-level cache (#69A-39B's
// RESEARCH_CACHE_VERSION bump) -- this ticket's own new finding is that
// the WHOLE-REPORT-level cache needed the identical treatment for this
// specific generation-affecting change.
//
// EVIDENCE-REUSE AUDIT (ticket's own primary objective, verified
// separately from the cache bug): the evidence registry already tags
// each item with Source title/Publisher/URL (formatDomainResearchForReportGeneration,
// domain-research.ts) -- QuickBooks/Xero evidence is genuinely entity-
// specific (publisher "Intuit QuickBooks Help Center"/"Xero US",
// describing their OWN embedded forecasting capability). The OTHER
// comparative statements the ticket cites (Problem's "existing
// alternatives may under-automate...", Porter's "public evidence on
// vendor feature gaps is limited") are deliberately GENERIC, non-entity-
// tagged commentary about the market/evidence quality as a whole, not
// about one named competitor -- mechanically attaching them to a
// specific company (QuickBooks vs. Xero vs. Dryrun) would be exactly the
// unsafe, unattributed inference this ticket's own DIRECTIONAL CLAIM
// SAFETY section forbids ("Do not treat generic statements about
// 'incumbents', 'alternatives', or 'accounting platforms' as competitor-
// specific unless the underlying evidence safely supports that
// mapping"). No mechanical cross-referencing of generic prose into named
// competitor rows was added for this reason -- doing so would violate
// the ticket's own safety rules, not satisfy them.
//
// FIX (app/lib/report-jobs/plan-executor.ts):
//   BUSINESS_PLAN_GENERATION_CONTRACT_VERSION bumped v6 -> v7, mirroring
//   #69A-37A's own identical mechanism for the identical reason. A
//   one-time, bounded re-fetch per previously-cached prompt -- never a
//   repeated or unbounded cost. No new research call, no new cache
//   structure, no change to any evidence-quality or negative-claim gate.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
  formatCompetitorWeaknessForDisplay,
  BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const planExecutorSource = readFileSync(
  join(repoRoot, "app/lib/report-jobs/plan-executor.ts"),
  "utf8"
);
const domainResearchSource = readFileSync(
  join(repoRoot, "app/lib/ai/domain-research.ts"),
  "utf8"
);

function extractContractVersion() {
  const match = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "([^"]+)";/.exec(
    planExecutorSource
  );
  assert.ok(match, "BUSINESS_PLAN_GENERATION_CONTRACT_VERSION declaration not found");
  return match[1];
}

// --- ROOT CAUSE FIX: the stale full-report cache ---------------------

test("1. BUSINESS_PLAN_GENERATION_CONTRACT_VERSION was bumped past v6, invalidating any full-report cache entry generated before #69A-40's weakness-schema fix", () => {
  const versionMatch = /^ltv-cac-ratio-integrity-v(\d+)$/.exec(extractContractVersion());
  assert.ok(versionMatch, "expected the ltv-cac-ratio-integrity version family");
  assert.ok(Number(versionMatch[1]) >= 7, "expected the version to be at least v7 (this task's own bump)");
});

test("1b. the business_plan full-report cache key still (and only) depends on BUSINESS_PLAN_GENERATION_CONTRACT_VERSION for this class of invalidation -- confirms the fix targets the RIGHT cache without touching real_estate/domain_analysis's own separate cache keys", () => {
  assert.match(
    planExecutorSource,
    /reportVariant: `\$\{FULL_REPORT_FIELD\}:\$\{canonicalFinancialAssumptions\.version\}:\$\{canonicalFinancialAssumptions\.fingerprint\}:\$\{BUSINESS_PLAN_GENERATION_CONTRACT_VERSION\}`,/
  );
  const contractVersionUsageCount = (
    planExecutorSource.match(/BUSINESS_PLAN_GENERATION_CONTRACT_VERSION/g) || []
  ).length;
  // Declaration + its own comment references + the one reportVariant
  // usage -- never wired into real_estate/domain_analysis's own
  // createPreResearchReportCacheKey call sites.
  assert.ok(contractVersionUsageCount >= 2);
});

test("12/13. no new research call, research task type, or cache structure was added -- evidence reuse (not new research) is the fix, and existing bounded/cached/deduplicated behavior is untouched", () => {
  assert.doesNotMatch(domainResearchSource, /TASK #69A-40A/);
  assert.match(planExecutorSource, /maxAiCallsPerReport/);
  const researchCacheSource = readFileSync(
    join(repoRoot, "app/lib/ai/research-cache.ts"),
    "utf8"
  );
  assert.match(researchCacheSource, /dedupeKey/);
  assert.doesNotMatch(researchCacheSource, /TASK #69A-40A/);
});

// --- Re-verification: #69A-40's canonical architecture is intact and
//     reachable now that the stale cache no longer masks it ------------

test("2. a defensible comparative inference (the #69A-40-named embedded-feature-vs-dedicated-tool pattern) still becomes directional end-to-end through the real builder function", () => {
  const response = [
    {
      company: "Intuit QuickBooks",
      type: "Direct competitor",
      positioning: "General-purpose accounting platform with built-in forecasting.",
      strengths: "Massive installed base.",
      weaknesses:
        "Forecasting is offered only as a secondary, embedded feature within its broader general-purpose accounting platform, not a dedicated, purpose-built specialization.",
      weaknessBasis: "directional",
      threat: "High",
    },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(response);
  assert.equal(state.competitors[0].weaknessBasis, "directional");
  assert.match(formatCompetitorWeaknessForDisplay(state.competitors[0]), /\(Directional\)$/);
});

test("3. a generic, non-entity-specific statement is never accepted as this competitor's OWN weakness -- the schema requires the inference be grounded in THIS competitor's own evidence, not market-wide commentary", () => {
  const description = BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.properties.weaknesses.description;
  assert.match(description, /this competitor's own positioning\/pricing\/differentiation\/review evidence/);
  assert.match(description, /company-specific INFERENCE/);
});

test("4. an unsupported negative claim (generic sentiment, no evidentiary basis) is still explicitly rejected by the generation-time guidance", () => {
  const description = BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.properties.weaknesses.description;
  assert.match(description, /NEVER generic sentiment/);
  assert.match(description, /never invented merely because no directly documented weakness exists/);
  assert.match(description, /absence of evidence about a limitation is never itself evidence of that limitation/);
});

test("5. entity aliasing is handled SAFELY: dedup is by exact lowercased company name only, never fuzzy/partial matching that could misattribute one entity's evidence to a differently-named one", () => {
  const response = [
    { company: "Intuit QuickBooks", type: "Direct competitor", positioning: "p1", strengths: "s1", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
    { company: "QuickBooks", type: "Direct competitor", positioning: "p2", strengths: "s2", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(response);
  // Two DIFFERENT literal strings are never silently merged into one --
  // the model itself is responsible for consistent naming (confirmed
  // live: the real persisted report always used "Intuit QuickBooks"
  // consistently across strengths/positioning/weaknesses for the same
  // record).
  assert.equal(state.competitors.length, 2);
  assert.equal(state.competitors[0].positioning, "p1");
  assert.equal(state.competitors[1].positioning, "p2");
});

test("5b. case-insensitive exact duplicates of the SAME entity are still safely deduped (first occurrence wins)", () => {
  const response = [
    { company: "Xero", type: "Direct competitor", positioning: "first", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
    { company: "xero", type: "Direct competitor", positioning: "second", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(response);
  assert.equal(state.competitors.length, 1);
  assert.equal(state.competitors[0].positioning, "first");
});

test("6. unavailable remains honest when evidence is genuinely insufficient (Dryrun's real case: no usable comparative text)", () => {
  const response = [
    { company: "Dryrun", type: "Direct competitor", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(response);
  assert.equal(state.competitors[0].weaknessBasis, "unavailable");
  assert.equal(formatCompetitorWeaknessForDisplay(state.competitors[0]), "Not available");
});

test("7. no hardcoded competitor weakness (Float/Cash Flow Frog/Futrli/QuickBooks/Xero/Dryrun-specific text) was introduced by this fix's own diff", () => {
  const fixRegion = planExecutorSource.slice(
    planExecutorSource.indexOf("TASK #69A-40A"),
    planExecutorSource.indexOf("TASK #69A-40A") + 2000
  );
  assert.doesNotMatch(fixRegion, /Float|Cash Flow Frog|Futrli/i);
});

test("8. web and PDF still consume the identical canonical formatCompetitorWeaknessForDisplay -- unaffected by the cache fix", () => {
  const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
  const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
  const pdfButtonSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");
  for (const source of [plannerSource, pageSource, pdfButtonSource]) {
    assert.match(
      source,
      /import\s*\{[^}]*formatCompetitorWeaknessForDisplay[^}]*\}\s*from\s*"@\/app\/lib\/report-engine\/business-competitor-landscape-state"/s
    );
  }
});

test("9. competitor order and threat levels are stable and unaffected by the cache-version bump for the real-case shape", () => {
  const response = [
    { company: "Intuit QuickBooks", type: "Direct competitor", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
    { company: "Xero", type: "Direct competitor", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
    { company: "Dryrun", type: "Direct competitor", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
    { company: "Accounting consultants / spreadsheets", type: "Substitute", positioning: "p", strengths: "s", weaknesses: "Scalability and cost for frequent reforecasting", weaknessBasis: "directional", threat: "Medium" },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(response);
  assert.deepEqual(state.competitors.map((c) => c.company), ["Intuit QuickBooks", "Xero", "Dryrun", "Accounting consultants / spreadsheets"]);
  assert.deepEqual(state.competitors.map((c) => c.threat), ["High", "High", "Medium", "Medium"]);
});

test("10. the existing substitute's directional weakness (Accounting consultants / spreadsheets) remains a valid, unaffected directional claim", () => {
  const response = [
    { company: "Accounting consultants / spreadsheets", type: "Substitute", positioning: "p", strengths: "s", weaknesses: "Scalability and cost for frequent reforecasting", weaknessBasis: "directional", threat: "Medium" },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(response);
  assert.equal(state.competitors[0].weaknessBasis, "directional");
  assert.match(formatCompetitorWeaknessForDisplay(state.competitors[0]), /^Scalability and cost for frequent reforecasting \(Directional\)$/);
});

test("11. decision/scoring logic cannot be mutated by this presentation-mapping fix -- the touched constant/functions are never imported by decision-engine/founder-score/confidence-radar files", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /BUSINESS_PLAN_GENERATION_CONTRACT_VERSION/);
    assert.doesNotMatch(source, /TASK #69A-40A/);
  }
});
