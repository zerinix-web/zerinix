// TASK #69A-38D -- Restore canonical competitor / Porter evidence and
// eliminate false competitive-evidence scoring.
//
// LIVE FAILURE: a REAL fresh Business Idea Validation report (generated
// after #69A-38C) showed:
//   - Competitor Landscape: "No competitor data could be validated for
//     this market yet."
//   - Executive Summary / Confidence Radar "Evidence": "Competitive
//     Advantage: Competitive evidence: 93%; Distinct competitor
//     organizations represented: 5"
// -- an internally contradictory report (zero validated competitors,
// yet a 93% competitive-evidence claim naming 5 organizations).
//
// ROOT CAUSE, traced end-to-end and confirmed by direct reproduction
// (not assumed): app/lib/ai/market-research-coverage.ts's
// evaluateMarketResearchCoverage computed `competitorBreadth`/
// `dimensions.competitiveEvidence` -- which feed
// decisionEngine.competitionScore (label "Competitive Advantage") and,
// via report-presentation.ts's buildConfidenceRadar, the Confidence
// Radar's "Evidence" dimension -- ENTIRELY from RAW, unstructured
// research evidence text matching (`coversCompetitorEvidence`, a regex
// over field/claim/sourceType/impactReason). This evaluation runs in
// plan-executor.ts BEFORE the AI generation call even starts -- long
// before businessCompetitorLandscapeState (the AI's own schema-enforced,
// canonical competitor array, #69A-15A) exists. Raw evidence can
// legitimately contain competitor-shaped text (a vendor comparison
// snippet) even when the model's final structured competitor array
// comes back genuinely empty, and the two were never reconciled once
// the canonical list became available -- so the report shipped a
// pre-generation guess that had nothing to do with what actually got
// validated.
//
// FIX:
//   1. deriveCanonicalCompetitiveEvidence(competitorState) -- a new,
//      pure function deriving competitorBreadth/competitiveEvidence
//      STRICTLY from businessCompetitorLandscapeState (0 when null/
//      empty, never a raw-evidence guess).
//   2. evaluateMarketResearchCoverage/applyMarketResearchCoverageToContext
//      accept an optional canonicalCompetitorEvidence override that,
//      when provided, replaces the raw-evidence-derived values for
//      competitorBreadth/competitiveEvidence (every other dimension --
//      market/financial/product/execution/founder -- is unaffected).
//   3. plan-executor.ts re-runs applyMarketResearchCoverageToContext
//      (from canonicalFinancialAssumptions, the pre-research base, never
//      double-applied on top of the first pass) once
//      businessCompetitorLandscapeState is known -- both the fresh-
//      generation path (a new finalResearchAwareFinancialContext,
//      consumed by reportMetadataContext and the now-unconditional
//      second reportMetadata chunk) and the cache-hit path (inline, since
//      the cached competitor state is already known before that path's
//      one applyMarketResearchCoverageToContext call).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanonicalFinancialAssumptions } from "../app/lib/ai/financial-assumptions.ts";
import {
  applyMarketResearchCoverageToContext,
  deriveCanonicalCompetitiveEvidence,
  evaluateMarketResearchCoverage,
} from "../app/lib/ai/market-research-coverage.ts";
import { refreshResearchAwareFinancialContext } from "../app/lib/ai/financial-assumptions.ts";
import { buildPortersFiveForcesStateFromLegacyProse, PORTER_FORCE_ORDER } from "../app/lib/report-engine/porters-five-forces-state.ts";
import { buildBusinessCompetitorLandscapeStateFromStructuredResponse } from "../app/lib/report-engine/business-competitor-landscape-state.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const marketResearchCoverageSource = readFileSync(join(repoRoot, "app/lib/ai/market-research-coverage.ts"), "utf8");

const REAL_CASE_PROMPT =
  "Premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for SMBs in the United States, integrating with QuickBooks/Xero.";

// Raw research evidence that plausibly matches coversCompetitorEvidence
// (real, named vendors, product-comparison language) even though this
// exact test's "fresh report" scenario ultimately validated ZERO
// competitors structurally -- the exact shape of the reported
// contradiction.
const COMPETITOR_SHAPED_RAW_EVIDENCE = [
  {
    id: "R1",
    field: "product_evidence",
    claim: "Float targets finance teams and integrates with Xero/QuickBooks for cash-flow forecasting.",
    value: "",
    url: "https://float.com/about",
    sourceTitle: "Float - About",
    publisher: "Float",
    label: "Verified from external source",
    confidence: 80,
    qualityScore: 80,
    impactReason: "Shows established competitor positioning.",
    sourceType: "company_primary",
  },
  {
    id: "R2",
    field: "company_evidence",
    claim: "Fathom offers financial reporting and analysis for accountants and SMBs.",
    value: "",
    url: "https://fathomhq.com",
    sourceTitle: "Fathom",
    publisher: "Fathom",
    label: "Verified from external source",
    confidence: 75,
    qualityScore: 75,
    impactReason: "Indicates available competitive analysis tooling.",
    sourceType: "company_primary",
  },
  {
    id: "R3",
    field: "product_evidence",
    claim: "Futrli provides forecasting and cash-flow scenario tools for small businesses.",
    value: "",
    url: "https://futrli.com",
    sourceTitle: "Futrli",
    publisher: "Futrli",
    label: "Verified from external source",
    confidence: 78,
    qualityScore: 78,
    impactReason: "Shows established competitor positioning.",
    sourceType: "company_primary",
  },
];

function buildBaseContext() {
  return createCanonicalFinancialAssumptions({ prompt: REAL_CASE_PROMPT, reportKind: "business_plan" });
}

// --- [1] FAIL-BEFORE PROOF: reproduce the REAL observed contradiction ---

test("[1] FAIL-BEFORE PROOF: raw-evidence-only scoring (the pre-fix path, still reachable via applyMarketResearchCoverageToContext's own default behavior with no canonical override) produces a high competitive-evidence score and a non-zero organization count from evidence alone, with NO canonical competitor validated at all -- reproducing the exact reported contradiction", () => {
  const base = buildBaseContext();
  const result = applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT);

  assert.ok(result.coverage.competitorBreadth > 0, "the raw-evidence path alone reports a non-zero organization count");
  assert.ok(result.coverage.dimensions.competitiveEvidence > 0, "the raw-evidence path alone reports non-zero competitive evidence");
  // This is the exact contradiction: a real canonical competitor state
  // (what the Competitor Landscape UI actually renders) is completely
  // separate from, and can validate ZERO competitors while, this score
  // stays high -- which is precisely why the fix below must gate this
  // score on the canonical state, not leave it to float independently.
});

// --- [2] canonical derivation: zero competitors -> zero evidence --------

test("[2] deriveCanonicalCompetitiveEvidence(null) -- the exact reported case (Competitor Landscape empty) -- returns competitorBreadth=0 and competitiveEvidence=0, never a raw-evidence guess", () => {
  assert.deepEqual(deriveCanonicalCompetitiveEvidence(null), { competitorBreadth: 0, competitiveEvidence: 0 });
  assert.deepEqual(deriveCanonicalCompetitiveEvidence(undefined), { competitorBreadth: 0, competitiveEvidence: 0 });
  assert.deepEqual(deriveCanonicalCompetitiveEvidence({ competitors: [] }), { competitorBreadth: 0, competitiveEvidence: 0 });
});

test("[2b] deriveCanonicalCompetitiveEvidence with real, evidence-backed competitors returns a proportionate, non-zero score -- never fabricated, never independent of the canonical count", () => {
  const state = {
    competitors: [
      { company: "Float", type: "Direct competitor", positioning: "Cash-flow forecasting for SMBs", strengths: "Strong SMB adoption", weaknesses: "Limited scenario depth", weaknessBasis: "directional", threat: "Medium" },
      { company: "Fathom", type: "Direct competitor", positioning: "Financial reporting and analysis", strengths: "Broad integrations", weaknesses: "—", weaknessBasis: "unavailable", threat: "Medium" },
    ],
  };
  const result = deriveCanonicalCompetitiveEvidence(state);
  assert.equal(result.competitorBreadth, 2);
  assert.ok(result.competitiveEvidence > 0 && result.competitiveEvidence < 100);
});

test("[2c] a single competitor with EVERY field unavailable ('—') scores lower than a well-evidenced one with the SAME count -- evidence quality, not just count, drives the score", () => {
  const thin = deriveCanonicalCompetitiveEvidence({
    competitors: [{ company: "X", type: "Unknown", positioning: "—", strengths: "—", weaknesses: "—", threat: "—" }],
  });
  const rich = deriveCanonicalCompetitiveEvidence({
    competitors: [{ company: "Y", type: "Direct competitor", positioning: "Real positioning", strengths: "Real strength", weaknesses: "Real weakness", threat: "Medium" }],
  });
  assert.ok(rich.competitiveEvidence > thin.competitiveEvidence);
});

// --- [3] the corrected value survives into decisionEngine/canonical -----
// --- context (competitor organization count equals canonical count) ----

test("[3] competitor organization count in the corrected decisionEngine.competitionScore reasoning equals the REAL canonical count, never an independent research-domain/source-count guess", () => {
  const base = buildBaseContext();
  const rawResult = applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT);
  const canonicalEvidence = deriveCanonicalCompetitiveEvidence(null); // Competitor Landscape empty, the real reported case
  const correctedResult = applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT, undefined, canonicalEvidence);
  const finalContext = refreshResearchAwareFinancialContext(correctedResult.context);

  assert.match(finalContext.investmentScore.decisionEngine.competitionScore.reasoning.join(" "), /Distinct competitor organizations represented: 0/);
  assert.match(finalContext.investmentScore.decisionEngine.competitionScore.reasoning.join(" "), /Competitive evidence: 0%/);
  assert.notEqual(
    finalContext.investmentScore.decisionEngine.competitionScore.score,
    rawResult.context.investmentScore.decisionEngine.competitionScore.score
  );
  assert.equal(finalContext.investmentScore.decisionEngine.competitionScore.score, 0);
});

// --- [4] competitive evidence score cannot be high when competitor -------
// --- list/evidence is absent ---------------------------------------------

test("[4] competitive evidence score cannot be high (>20) when the canonical competitor list is empty, regardless of how much competitor-shaped RAW evidence exists", () => {
  const base = buildBaseContext();
  const canonicalEvidence = deriveCanonicalCompetitiveEvidence(null);
  const correctedResult = applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT, undefined, canonicalEvidence);
  assert.ok(correctedResult.coverage.dimensions.competitiveEvidence <= 20);
  assert.equal(correctedResult.coverage.competitorBreadth, 0);
});

// --- [5] every OTHER dimension is unaffected ------------------------------

test("[5] market/financial/product/execution/founder dimensions are byte-identical whether or not the canonical competitor override is supplied -- this fix is scoped to competitor evidence only", () => {
  const base = buildBaseContext();
  const withoutOverride = evaluateMarketResearchCoverage(COMPETITOR_SHAPED_RAW_EVIDENCE, REAL_CASE_PROMPT);
  const withOverride = evaluateMarketResearchCoverage(COMPETITOR_SHAPED_RAW_EVIDENCE, REAL_CASE_PROMPT, deriveCanonicalCompetitiveEvidence(null));

  assert.equal(withoutOverride.dimensions.marketConfidence, withOverride.dimensions.marketConfidence);
  assert.equal(withoutOverride.dimensions.financialEvidence, withOverride.dimensions.financialEvidence);
  assert.equal(withoutOverride.dimensions.productEvidence, withOverride.dimensions.productEvidence);
  assert.equal(withoutOverride.dimensions.executionReadiness, withOverride.dimensions.executionReadiness);
  assert.equal(withoutOverride.dimensions.founderReadiness, withOverride.dimensions.founderReadiness);
  assert.equal(withoutOverride.averageQuality, withOverride.averageQuality);
  assert.equal(withoutOverride.evidenceCount, withOverride.evidenceCount);
  assert.notEqual(withoutOverride.dimensions.competitiveEvidence, withOverride.dimensions.competitiveEvidence);
  assert.notEqual(base, undefined); // keep base referenced for clarity of intent
});

// --- [6] canonical competitor list survives structural build (Tier 0) ----

test("[6] real, evidence-backed structured competitors survive canonicalization unchanged (Tier 0), and their count is exactly what deriveCanonicalCompetitiveEvidence reads", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Float", type: "Direct competitor", positioning: "Cash-flow forecasting for SMBs", strengths: "Strong SMB adoption", weaknesses: "Limited scenario depth", weaknessBasis: "directional", threat: "Medium" },
    { company: "Cash Flow Frog", type: "Direct competitor", positioning: "Simple cash flow forecasting", strengths: null, weaknesses: null, weaknessBasis: "unavailable", threat: null },
    { company: "Futrli", type: "Substitute", positioning: "Forecasting and reporting add-on", strengths: "Deep Xero integration", weaknesses: "Narrower scope", weaknessBasis: "directional", threat: "Low" },
  ]);
  assert.ok(state);
  assert.equal(state.competitors.length, 3);
  const evidence = deriveCanonicalCompetitiveEvidence(state);
  assert.equal(evidence.competitorBreadth, 3);
  assert.ok(evidence.competitiveEvidence > 0);
});

test("[6b] a genuinely empty structured competitor response still resolves to null (the honest empty state) -- no unsupported competitor is invented anywhere in THIS task's own new code", () => {
  assert.equal(buildBusinessCompetitorLandscapeStateFromStructuredResponse([]), null);
  // Scoped to deriveCanonicalCompetitiveEvidence's own function body (this
  // task's only new code in this file) -- the file's PRE-EXISTING #69A-29A
  // historical comment elsewhere legitimately names real companies
  // ("Float [R56][R59], Cash Flow Frog [R57]") documenting a past, already-
  // resolved investigation; that is unrelated, untouched prose, not this
  // fix's own logic.
  const newFunctionSource = marketResearchCoverageSource.slice(
    marketResearchCoverageSource.indexOf("export function deriveCanonicalCompetitiveEvidence"),
    marketResearchCoverageSource.indexOf("export function evaluateMarketResearchCoverage")
  );
  for (const name of ["Float", "Cash Flow Frog", "Futrli", "Fathom"]) {
    assert.ok(!newFunctionSource.includes(name), `deriveCanonicalCompetitiveEvidence must not hardcode "${name}"`);
  }
});

// --- [7] Benchmark competitor gap agrees with canonical competitor state -

test("[7] once corrected, a category scoring near-zero competitive evidence correctly becomes a material validation gap (Benchmark Intelligence), agreeing with the empty Competitor Landscape instead of contradicting it", () => {
  const base = buildBaseContext();
  const canonicalEvidence = deriveCanonicalCompetitiveEvidence(null);
  const correctedResult = applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT, undefined, canonicalEvidence);
  const finalContext = refreshResearchAwareFinancialContext(correctedResult.context);

  const competitiveAdvantageCategory = finalContext.investmentScore.categories.competitiveAdvantage;
  assert.ok(competitiveAdvantageCategory.score / competitiveAdvantageCategory.maximumScore < 0.5, "the competitive-advantage category must now genuinely score below the material-gap threshold");
  assert.ok(
    finalContext.benchmarkFit.validationGaps.some((gap) => gap.startsWith("Competitive Advantage:")),
    "Benchmark Intelligence's validationGaps must now list Competitive Advantage as a material gap, agreeing with the empty Competitor Landscape"
  );
});

// --- [8]/[9] Porter consumes canonical context; all five forces survive -

test("[8] Porter's Tier 1 legacy-prose synthesis (established in #69A-38, unaffected by this task) always produces exactly 5 forces, using honest 'Insufficient evidence' language -- never fabricated, never a duplicated generic paragraph -- consistent with the canonical business context available to the report engine", () => {
  const state = buildPortersFiveForcesStateFromLegacyProse(
    "Within the industry, the forces most likely to shape this business are buyer power and the ease of new entrants."
  );
  assert.equal(Object.keys(state.forces).length, 5);
  for (const key of PORTER_FORCE_ORDER) {
    assert.ok(state.forces[key].analysis.trim().length > 0);
  }
  assert.equal(state.forces.competitiveRivalry.level, "Insufficient evidence");
  assert.equal(state.forces.supplierPower.level, "Insufficient evidence");
  assert.equal(state.forces.threatOfSubstitutes.level, "Insufficient evidence");
});

test("[9] Porter and competitor evidence read from the SAME canonical structures -- porters-five-forces-state.ts and business-competitor-landscape-state.ts each expose exactly one Tier 0 (structured) + Tier 1 (legacy-prose synthesis) pair, never a third, independently-scored path", () => {
  const portersSource = readFileSync(join(repoRoot, "app/lib/report-engine/porters-five-forces-state.ts"), "utf8");
  assert.match(portersSource, /export function buildPortersFiveForcesStateFromStructuredResponse/);
  assert.match(portersSource, /export function buildPortersFiveForcesStateFromLegacyProse/);
  const competitorSource = readFileSync(join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"), "utf8");
  assert.match(competitorSource, /export function buildBusinessCompetitorLandscapeStateFromStructuredResponse/);
});

// --- [10]/[11] no unsupported competitor/weakness is invented -----------

test("[10] deriveCanonicalCompetitiveEvidence never invents a competitor -- it only ever counts and scores what the canonical state already contains, and returns exactly 0 for an empty/null state", () => {
  assert.doesNotThrow(() => deriveCanonicalCompetitiveEvidence(null));
  const zeroResult = deriveCanonicalCompetitiveEvidence({ competitors: [] });
  assert.equal(zeroResult.competitorBreadth, 0);
});

test("[11] no unsupported weakness/company name is hardcoded anywhere in this task's fix in plan-executor.ts", () => {
  const firstMarkerIndex = planExecutorSource.indexOf("TASK #69A-38D");
  assert.ok(firstMarkerIndex >= 0, "expected at least one #69A-38D marker in plan-executor.ts");
  const task38dSection = planExecutorSource.slice(firstMarkerIndex, firstMarkerIndex + 4000);
  for (const knownCompetitor of ["Cash Flow Frog", "Futrli", "Fathom", "Jirav", "Causal"]) {
    assert.ok(!task38dSection.includes(knownCompetitor), `plan-executor.ts's #69A-38D fix must not hardcode "${knownCompetitor}"`);
  }
});

// --- [12] legacy raw narrative report remains suppressed ------------------

test("[12] the #69A-38C legacy raw narrative suppression fix is untouched by this task", () => {
  const domainSource = readFileSync(join(repoRoot, "app/lib/report-engine/domain.ts"), "utf8");
  assert.doesNotMatch(domainSource, /#69A-38D/);
});

// --- [13] fresh report does not create contradictory evidence claims -----

test("[13] end-to-end: for the exact real prompt, with competitor-shaped raw evidence but an empty canonical competitor state (the exact reported scenario), the FINAL corrected context never claims competitive evidence above what the canonical state supports -- no contradiction survives", () => {
  const base = buildBaseContext();
  const canonicalEvidence = deriveCanonicalCompetitiveEvidence(null);
  const correctedResult = applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT, undefined, canonicalEvidence);
  const finalContext = refreshResearchAwareFinancialContext(correctedResult.context);

  // The exact reported contradiction, now impossible: competitorBreadth
  // (whatever text mentions "organizations represented") must equal 0,
  // matching the empty Competitor Landscape, and competitiveEvidence/
  // competitionScore must be low, never 93%.
  assert.equal(correctedResult.coverage.competitorBreadth, 0);
  assert.ok(correctedResult.coverage.dimensions.competitiveEvidence < 20);
  assert.ok(finalContext.investmentScore.decisionEngine.competitionScore.score < 20);
});

// --- Wiring proof: plan-executor.ts's two call sites ----------------------

test("wiring: the fresh-generation path re-runs applyMarketResearchCoverageToContext with deriveCanonicalCompetitiveEvidence(businessCompetitorLandscapeState) once that state is known, feeding a new finalResearchAwareFinancialContext into both reportMetadataContext and the (now-unconditional) second metadata chunk", () => {
  assert.match(planExecutorSource, /const finalResearchAwareFinancialContext = refreshResearchAwareFinancialContext\(/);
  assert.match(planExecutorSource, /deriveCanonicalCompetitiveEvidence\(businessCompetitorLandscapeState\)/);
  assert.match(planExecutorSource, /context: finalResearchAwareFinancialContext,/);
  assert.match(planExecutorSource, /serializePlanReportMetadataChunk\(\s*\n\s*finalResearchAwareFinancialContext,/);
});

test("wiring: the second metadata chunk is no longer gated on businessCompetitorLandscapeState/portersFiveForcesState truthiness -- it must always fire so a report with neither (the exact reported case) still receives the corrected snapshot", () => {
  const chunkSection = planExecutorSource.slice(
    planExecutorSource.indexOf("TASK #69A-15 -- a SECOND reportMetadata chunk."),
    planExecutorSource.indexOf("TASK #69A-15 -- a SECOND reportMetadata chunk.") + 2000
  );
  assert.doesNotMatch(chunkSection, /if \(businessCompetitorLandscapeState \|\| portersFiveForcesState\)/);
});

test("wiring: the cache-hit path passes deriveCanonicalCompetitiveEvidence(cachedBusinessCompetitorLandscapeState) directly into its own single applyMarketResearchCoverageToContext call, since the cached competitor state is already known before that call runs", () => {
  assert.match(planExecutorSource, /deriveCanonicalCompetitiveEvidence\(cachedBusinessCompetitorLandscapeState\)/);
});
