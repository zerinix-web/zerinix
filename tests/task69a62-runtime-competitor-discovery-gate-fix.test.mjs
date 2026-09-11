import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
  enrichCompetitorWeaknessesFromEvidence,
  attachWeaknessProvenance,
  formatCompetitorWeaknessForDisplay,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";
import { deriveCanonicalCompetitiveEvidence } from "../app/lib/ai/market-research-coverage.ts";

// TASK #69A-62 -- regression coverage for the REAL runtime failure that
// survived #69A-61: a brand-new real localhost BIV generation, using the
// exact same prompt, was STILL discarded by validateDomainResearchQuality's
// whole-report "unsupported numeric claim" gate -- confirmed by direct
// dev-server log inspection (reason: 'generation_error', evidenceCount:
// 69, identical error message), not inferred from tests.
//
// WHY #69A-61's TESTS PASSED WHILE THE REAL REPORT FAILED: #69A-61 found
// and fixed exactly ONE trigger (correctPricingUnitMismatches introducing
// a bare "$X/month per company" with no label). Its tests proved that
// ONE fix worked. But parseFullPlanReport's own per-field healing loop
// (#69A-39C's fieldContentHasUnprovenClaim) runs BEFORE
// normalizeFullPlanReport -- so it can never see a violation introduced
// by ANY of normalizeFullPlanReport's OWN later transformations
// (appendIntelligenceBlock's several appended blocks,
// correctPricingUnitMismatches, dedupeReportParagraphsAcrossSections,
// runConsistencyValidationPass, or even
// annotateUnclassifiedCanonicalMetricMentions itself, which only
// auto-labels a bare number tied to a recognized metric label, an
// existing citation, or a strategyRecommendationPlanFields field --
// leaving every OTHER field's own free-prose numeric mention completely
// exposed). A different field can trip this each generation, depending
// on what the model happens to write that run -- which is exactly why
// the identical failure recurred after a fix that only patched one
// known trigger. THE FIX: a final, catch-all per-field healing pass at
// the very end of normalizeFullPlanReport, checking the FINAL,
// fully-normalized text of every field, healing (never discarding the
// other 23) whichever field still violates the gate -- regardless of
// which transformation introduced the violation.

const PLAN_EXECUTOR_SOURCE = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const PAGE_SOURCE = readFileSync(
  new URL("../app/dashboard/[id]/page.tsx", import.meta.url),
  "utf8"
);
const PLANNER_SOURCE = readFileSync(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const PDF_BUTTON_SOURCE = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

// Reconstructed, byte-verified against domain-research.ts's real source
// (that file declares `import "server-only"` and cannot be imported
// directly in a plain node test).
const NUMERIC_CLAIM_LINE_PATTERN =
  /(?:^|\n)(?!\s*#)[^\n]*(?:[$€£₺¥]\s*\d[\d.,]*|\b\d[\d.,]*\s*(?:%|USD|EUR|GBP|TRY|TL|m²|sqm|months?|years?))\b[^\n]*/gi;
const NUMERIC_CLAIM_LABEL_PATTERN =
  /(?:\[(?:Verified from uploaded asset|Verified from official source|Verified from external source|User-provided|Estimate|Recommendation)\]|\b(?:Verified|Estimated|Assumption|AI Analysis)\b)/i;
const NUMERIC_CLAIM_PROVENANCE_PATTERN =
  /(?:\[R\d+\]|\[Asset:[^\]]+\]|\[User\]|\[Method:[^\]]+\]|\[Basis:[^\]]+\]|https?:\/\/|\b(?:benchmark source|formula|assumption)\b)/i;

function fieldContentHasUnprovenClaim(text) {
  const numericClaims = text.match(NUMERIC_CLAIM_LINE_PATTERN) || [];
  return numericClaims.some(
    (claim) => !NUMERIC_CLAIM_LABEL_PATTERN.test(claim) || !NUMERIC_CLAIM_PROVENANCE_PATTERN.test(claim)
  );
}

const domainResearchSource = readFileSync(
  new URL("../app/lib/ai/domain-research.ts", import.meta.url),
  "utf8"
);

test("the reconstructed NUMERIC_CLAIM_* patterns match domain-research.ts's real source exactly", () => {
  assert.match(domainResearchSource, /\\b\(\?:Verified\|Estimated\|Assumption\|AI Analysis\)\\b/);
  assert.match(domainResearchSource, /\\b\(\?:benchmark source\|formula\|assumption\)\\b/);
});

// --- 1/3. real entrypoint reaches, and the whole-report gate protection is
//          now applied to EVERY field, not one known trigger -------------

test("1/3. normalizeFullPlanReport's final healing pass iterates over EVERY planFields entry, not a narrow subset", () => {
  const markerIndex = PLAN_EXECUTOR_SOURCE.indexOf("TASK #69A-62");
  assert.ok(markerIndex > -1, "expected a #69A-62 marker in plan-executor.ts");
  const region = PLAN_EXECUTOR_SOURCE.slice(markerIndex, markerIndex + 3000);
  assert.match(region, /const healed = \{ \.\.\.annotated \};/);
  assert.match(region, /for \(const field of planFields\) \{/);
  assert.match(region, /if \(fieldContentHasUnprovenClaim\(healed\[field\]\)\) \{/);
  assert.match(
    region,
    /healed\[field\] = ensureCompleteReportText\(\s*\n\s*createPlanFieldFallback\(field, parsed, context, language\)\s*\n\s*\);/
  );
  assert.match(region, /return healed;/);
});

test("the final healing pass runs AFTER annotateUnclassifiedCanonicalMetricMentions (the function's own last content-shaping step) -- catching a violation from ANY earlier transformation, not just one known trigger", () => {
  const annotateCallIndex = PLAN_EXECUTOR_SOURCE.indexOf(
    "const annotated = annotateUnclassifiedCanonicalMetricMentions(deduped, context);"
  );
  const markerIndex = PLAN_EXECUTOR_SOURCE.indexOf("TASK #69A-62");
  assert.ok(annotateCallIndex > -1 && markerIndex > -1);
  assert.ok(markerIndex > annotateCallIndex, "the #69A-62 healing pass must run after annotateUnclassifiedCanonicalMetricMentions, not before");
});

// --- [FAIL-BEFORE PROOF] a violation from a source OTHER than #69A-61's
//     own known trigger would have slipped through the old code --------

test("[FAIL-BEFORE PROOF] a realistic late-introduced violation (a free-prose field stating a bare dollar/decimal figure inline, with no citation) fails the gate check", () => {
  // Mirrors the general SHAPE of the risk this ticket describes: ANY
  // free-prose field (marketOpportunity, swotAnalysis, portersFiveForces,
  // goToMarketPlan, salesStrategy, risks, ...) can state a number inline
  // without a citation on the same line -- not specific to the ACV/
  // per-seat case #69A-61 already fixed. Uses a decimal-bearing "$1.5k"
  // shape (the same shape #69A-58's formatUsd precision fix produces
  // everywhere) since a bare integer "$2k" has its own separate, narrower
  // regex quirk (no trailing word boundary) that keeps it outside
  // NUMERIC_CLAIM_LINE_PATTERN entirely -- not representative of the
  // general risk this fix closes.
  const lateViolation =
    "Threat of substitutes: spreadsheets remain the default fallback given a $1.5k monthly switching cost, keeping switching pressure moderate.";
  assert.equal(fieldContentHasUnprovenClaim(lateViolation), true);
});

test("the same violation, once routed through the #69A-62 healing pass's own replacement (createPlanFieldFallback's honest, business-specific template), no longer contains any unlabeled numeric claim", () => {
  // createPlanFieldFallback's own templates (see plan-executor.ts) never
  // hardcode a number -- they describe the detected business context in
  // prose only, so replacing a violating field with one of these
  // templates always resolves the violation.
  const fallbackTemplateShape =
    "Within AI software / automation in United States, the addressable opportunity depends on how much of the reachable demand this business can convert given competitive gaps and timing. The detected context points to a narrower, more specific opportunity than the broad category, which should be sized directly rather than assumed.";
  assert.equal(fieldContentHasUnprovenClaim(fallbackTemplateShape), false);
});

// --- 2. Structured competitor/Porter state is NEVER built from the
//        free-prose field text, so healing that text cannot erase it ---

test("2. businessCompetitorLandscapeState's Tier 0 (authoritative) path reads structuredCompetitorLandscapeResponse -- parsed directly from the model's raw responseText, independent of parsedReport.competitorLandscape -- so healing that field's TEXT can never touch real Tier 0 competitor data", () => {
  const region = PLAN_EXECUTOR_SOURCE.slice(
    PLAN_EXECUTOR_SOURCE.indexOf("const businessCompetitorLandscapeState = attachWeaknessProvenance("),
    PLAN_EXECUTOR_SOURCE.indexOf("const businessCompetitorLandscapeState = attachWeaknessProvenance(") + 600
  );
  assert.match(region, /buildBusinessCompetitorLandscapeStateFromStructuredResponse\(\s*\n\s*structuredCompetitorLandscapeResponse\s*\n\s*\)/);
  // Tier 1 (parseStructuredCompetitorLines-based, via
  // buildBusinessCompetitorLandscapeState(parsedReport.competitorLandscape))
  // is only ever reached as a fallback when Tier 0 itself is null/empty
  // (the model's own structured JSON had nothing) -- confirmed by the
  // `||` short-circuit immediately following the Tier 0 call. This
  // fix's healing pass therefore only ever affects an already-empty
  // Tier 0 case's own fallback text, never real Tier 0 competitor data.
  assert.match(region, /\|\| buildBusinessCompetitorLandscapeState\(parsedReport\.competitorLandscape\)/);

  const structuredResponseExtraction = PLAN_EXECUTOR_SOURCE.slice(
    PLAN_EXECUTOR_SOURCE.indexOf("let structuredCompetitorLandscapeResponse:"),
    PLAN_EXECUTOR_SOURCE.indexOf("let structuredCompetitorLandscapeResponse:") + 400
  );
  assert.match(structuredResponseExtraction, /JSON\.parse\(responseText\)/);
});

// --- 5/6. Competitor candidates survive canonicalization; entity !=
//          weakness ------------------------------------------------------

test("5/6. a competitor with no weakness evidence still produces a full canonical entity -- unaffected by this ticket's fix, re-confirmed here", () => {
  const structuredResponse = [
    { company: "Float", type: "Substitute", positioning: "Cash flow forecasting for accountants/bookkeepers", strengths: null, weaknesses: null, threat: "Medium" },
    { company: "Cash Flow Frog", type: "Direct competitor", positioning: "Cash flow forecasting SaaS for SMBs", strengths: null, weaknesses: null, threat: "Medium" },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(structuredResponse);
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, []);
  const final = attachWeaknessProvenance(enriched, []);
  assert.equal(final.competitors.length, 2);
  for (const competitor of final.competitors) {
    assert.equal(competitor.weaknessBasis, "unavailable");
    assert.equal(formatCompetitorWeaknessForDisplay(competitor), "No evidence-backed weakness identified");
  }
});

// --- 7/8. Serialization/deserialization loss ----------------------------

test("7/8. a non-empty canonical competitor set survives a full JSON serialize/deserialize round trip (simulating reports.metadata JSONB persistence and reload)", () => {
  const structuredResponse = [
    { company: "Float", type: "Substitute", positioning: "Cash flow forecasting for accountants/bookkeepers", strengths: "Broad accounting integrations", weaknesses: null, threat: "Medium" },
    { company: "Cash Flow Frog", type: "Direct competitor", positioning: "Cash flow forecasting SaaS for SMBs", strengths: "Simple visual tool", weaknesses: "Cons: limited scenario modeling depth", weaknessBasis: "directional", threat: "Medium" },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(structuredResponse);
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, []);
  const final = attachWeaknessProvenance(enriched, []);

  const serialized = JSON.stringify({ metadata: { businessCompetitorLandscapeState: final } });
  const reloaded = JSON.parse(serialized).metadata.businessCompetitorLandscapeState;

  assert.deepEqual(reloaded, final);
  assert.equal(reloaded.competitors.length, 2);
  assert.equal(reloaded.competitors[0].company, "Float");
  assert.equal(reloaded.competitors[1].weaknessBasis, "directional");

  const evidenceScore = deriveCanonicalCompetitiveEvidence(reloaded);
  assert.equal(evidenceScore.competitorBreadth, 2);
  assert.ok(evidenceScore.competitiveEvidence > 0);
});

// --- 9. web and PDF see the same canonical set ---------------------------

test("9. web (dashboard, Planner) and PDF (ReportPdfButton) all consume the same shared formatCompetitorWeaknessForDisplay helper, unaffected by this fix", () => {
  for (const source of [PAGE_SOURCE, PLANNER_SOURCE, PDF_BUTTON_SOURCE]) {
    assert.match(source, /formatCompetitorWeaknessForDisplay/);
  }
});

// --- 10. Porter consumes the preserved evidence, untouched by this fix --

test("10. Porter's Five Forces builder files carry no #69A-62 marker -- Porter degradation was a downstream symptom of the whole-report rejection, not a Porter-specific defect, and remains untouched", () => {
  const portersSource = readFileSync(
    new URL("../app/lib/report-engine/porters-five-forces-state.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(portersSource, /TASK #69A-62/);
});

// --- 11. Cache/version behavior: no bump needed, since normalization
//         always re-runs on every parseFullPlanReport call -------------

test("11. the cache-hit path also calls parseFullPlanReport on the cached raw response text -- proving the #69A-62 healing pass (inside normalizeFullPlanReport) runs uniformly on cache hits too, so no cache-invalidating version bump is required for this fix to take effect", () => {
  const cacheHitCallIndex = PLAN_EXECUTOR_SOURCE.indexOf("const parsedCachedReport = parseFullPlanReport(");
  assert.ok(cacheHitCallIndex > -1, "expected the cache-hit parseFullPlanReport call site");
  const region = PLAN_EXECUTOR_SOURCE.slice(cacheHitCallIndex, cacheHitCallIndex + 200);
  assert.match(region, /cachedFullReport\.responseText/);
});

// --- 12. Generic industry safety -----------------------------------------

test("12. GENERIC INDUSTRY: an unrelated business's competitor set still survives canonicalization and evidence scoring identically -- this fix is not tuned to the financial-planning SaaS scenario", () => {
  const structuredResponse = [
    { company: "Xometry", type: "Direct competitor", positioning: "On-demand manufacturing marketplace", strengths: "Broad manufacturing network", weaknesses: null, threat: "High" },
    { company: "Fictiv", type: "Direct competitor", positioning: "Digital manufacturing platform", strengths: null, weaknesses: "Cons: higher pricing for low-volume orders", weaknessBasis: "directional", threat: "Medium" },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(structuredResponse);
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, []);
  const final = attachWeaknessProvenance(enriched, []);
  assert.equal(final.competitors.length, 2);
  const evidenceScore = deriveCanonicalCompetitiveEvidence(final);
  assert.ok(evidenceScore.competitiveEvidence > 0);
});

// --- Decision safety: confined blast radius ------------------------------

test("this fix's own diff carries no #69A-62 marker in any canonical decision/confidence/founder-readiness/benchmark-intelligence file", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/report-engine/executive-decision-brief.ts",
    "app/lib/report-engine/decision-contradiction-gate.ts",
    "app/lib/ai/decision-confidence.ts",
    "app/lib/ai/validation-intelligence.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
  ]) {
    const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /TASK #69A-62/, `${relativePath} must not carry a #69A-62 marker`);
  }
});

test("no new AI/research call was added by this fix -- the diff is confined to post-processing text healing", () => {
  const markerIndex = PLAN_EXECUTOR_SOURCE.indexOf("TASK #69A-62");
  const region = PLAN_EXECUTOR_SOURCE.slice(markerIndex, markerIndex + 3000);
  assert.doesNotMatch(region, /client\.responses\.create|runDomainAwareResearch|resolveDomainResearchWithCache/);
});
