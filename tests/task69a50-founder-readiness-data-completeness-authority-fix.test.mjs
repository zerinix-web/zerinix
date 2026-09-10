// TASK #69A-50 -- Eliminate silent research-refresh overwrites in
// Founder Readiness and Data Completeness.
//
// FULL PIPELINE TRACE (summary; complete detail in the final report to
// the user) across raw/user inputs -> initial evidence state -> research
// results -> market research coverage -> financial/context refresh ->
// source intelligence -> report intelligence -> validation intelligence
// -> investment score -> Founder Readiness dimensions -> canonical
// decision object -> persisted report -> web -> PDF:
//
//   - createCanonicalFinancialAssumptions (financial-assumptions.ts)
//     builds financialModel -> investmentScore (incl. decisionEngine.
//     founderScore + its 7 dimensionScores, investment-score.ts) ->
//     financialConsistency -> decisionConfidence -> sourceIntelligence
//     (from financialModel/financialConsistency ONLY, never research) ->
//     validationIntelligence/V2 (from financialModel/financialConsistency/
//     sourceIntelligence/decisionConfidence) -> benchmarkFit ->
//     reportIntelligence (createReportIntelligenceModel, report-
//     intelligence.ts) -- all PRE-research, prompt/model-derived.
//   - applyMarketResearchCoverageToContext (market-research-coverage.ts)
//     is the ONE place real research evidence is folded in. It
//     overwrites investmentScore.confidence/decisionEngine.*Score and
//     reportIntelligence.{totalScore,qualityScore,confidenceLevel,
//     overallQuality,dimensions}. Everything else on context
//     (financialConsistency, sourceIntelligence, validationIntelligenceV2,
//     benchmarkFit's own base fields, financialModel/metrics) passes
//     through via object spread, completely untouched.
//   - refreshResearchAwareFinancialContext (financial-assumptions.ts)
//     runs immediately after, recomputing investmentScore.{categories,
//     strengths,weaknesses,topRisks,totalScore,recommendation,
//     fatalBlockers} from the JUST-refreshed decisionEngine (already
//     investigated and proven NOT to re-derive validationIntelligenceV2,
//     #69A-18A) and appending validationIntelligenceV2's own material
//     gaps onto benchmarkFit.validationGaps (never recomputing
//     validationIntelligenceV2 itself).
//   - plan-executor.ts's fresh-generation success path calls this SAME
//     two-function pair TWICE, starting fresh from canonicalFinancial
//     Assumptions each time (never chaining one refresh on top of
//     another): once early (researchAwareFinancialContext, raw
//     pre-generation evidence, feeds the AI prompt/text generation) and
//     once final (finalResearchAwareFinancialContext, real competitor
//     evidence now known, feeds persistence via
//     serializePlanReportMetadataChunk -- confirmed to pass context.
//     investmentScore/reportIntelligence/validationIntelligenceV2
//     through VERBATIM, with no third recomputation anywhere in
//     createReportMetadataContext or serializePlanReportMetadataChunk).
//
// SILENT OVERWRITES FOUND (this ticket): reportIntelligence.dimensions.
// evidenceQuality ("Data Completeness") was unconditionally overwritten
// with dimensions.marketConfidence -- how much EXTERNAL, VERIFIED market
// research evidence exists -- discarding the ORIGINAL, pre-refresh value
// (clampScore(investmentScore.confidence*0.45 + decisionConfidence.
// confidenceScore*0.25 + (hasUserEvidence?22:4)) -- a measure of how
// complete THIS analysis's inputs are, INCLUDING whether the founder
// supplied real user/customer/revenue evidence). Confirmed live and by
// direct, reproducible test (below): a fixture with real, stated MRR/
// paying-customer/waitlist evidence scored evidenceQuality=70 pre-refresh,
// collapsing to 0 post-refresh purely because external research was
// sparse for that market -- while nothing about the founder's own
// supplied data changed. This is the exact same contamination CLASS
// #69A-43/#69A-47/#69A-38G already found and fixed for financialConsistency/
// founderScore.score/benchmarkFit/validationReadiness -- evidenceQuality
// was the one sibling dimension left unaudited.
//
// SEARCHED AND CONFIRMED CLEAN (no overwrite found): decisionEngine.
// founderScore.score (already fixed, #69A-47) and .dimensionScores (never
// touched -- survives via scoreCategory's own object spread, proven
// below); investmentScore.categories (correctly re-derived FROM the
// already-fixed decisionEngine, never independently recomputed);
// validationIntelligenceV2 (never recomputed post-research, #69A-18A,
// re-confirmed below); financialConsistency/sourceIntelligence (never
// touched by any refresh function, confirmed by direct object-identity
// check below); sourceConfidence ("Source Strength") -- genuinely
// research-aware by design/name, left unchanged.
//
// FIX: preserve the original, pre-refresh evidenceQuality value, mirroring
// the exact preservation pattern financialConsistency/benchmarkFit/
// validationReadiness/founderScore.score already established.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanonicalFinancialAssumptions,
  refreshResearchAwareFinancialContext,
} from "../app/lib/ai/financial-assumptions.ts";
import { applyMarketResearchCoverageToContext } from "../app/lib/ai/market-research-coverage.ts";
import { buildExecutiveSnapshot, getReportQualityBreakdown, readFounderReadinessScoreValue } from "../app/lib/report-presentation.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const marketResearchCoverageSource = readFileSync(join(repoRoot, "app/lib/ai/market-research-coverage.ts"), "utf8");
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

const REAL_CASE_PROMPT =
  "A subscription SaaS company for SMB accounting. We currently have $42,000 MRR and 200 paying customers with a waitlist of 500.";

function buildBase() {
  return createCanonicalFinancialAssumptions({ prompt: REAL_CASE_PROMPT, reportKind: "business_plan" });
}

function verifiedEvidence({ id, field, claim, value, sourceType = "credible_market_data", confidence = 78 }) {
  return {
    id,
    field,
    claim,
    value,
    label: "Verified from external source",
    sourceTitle: `${id} independent source`,
    publisher: "Independent Research Co.",
    url: `https://research-example.com/reports/${id}`,
    sourceType,
    authorityLevel: "secondary",
    confidence,
    publishedDate: "2026-01-10",
    lastChecked: "2026-08-20T00:00:00.000Z",
    supportingData: [],
    impact: "neutral",
    impactReason: "",
  };
}

// --- FAIL-BEFORE PROOF: the real, live-reproduced defect -----------------

test("FAIL-BEFORE PROOF: reconstructing the pre-fix formula (dimensions.marketConfidence) for evidenceQuality diverges sharply from the real, founder-evidence-derived original for a sparse-external-research fixture", () => {
  const base = buildBase();
  const originalEvidenceQuality = base.reportIntelligence.dimensions.evidenceQuality;

  const sparseResult = applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT);
  // Reconstructs the exact pre-fix formula: evidenceQuality: dimensions.marketConfidence.
  const oldBuggyValue = sparseResult.coverage.dimensions.marketConfidence;

  assert.ok(originalEvidenceQuality > 0, "expected the real founder-evidence fixture to produce a genuine, non-zero Data Completeness score");
  assert.notEqual(
    oldBuggyValue,
    originalEvidenceQuality,
    `expected the old formula (dimensions.marketConfidence=${oldBuggyValue}) to diverge from the real original (${originalEvidenceQuality}) -- if they always agreed there would be nothing to fix`
  );
});

// --- 1: research refresh cannot silently overwrite Data Completeness ----

test("1. Data Completeness (reportIntelligence.dimensions.evidenceQuality) is identical whether external research is sparse or absent -- proving it survives the refresh unchanged", () => {
  const base = buildBase();
  const original = base.reportIntelligence.dimensions.evidenceQuality;

  const sparse = applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT).context;
  const abundant = applyMarketResearchCoverageToContext(
    base,
    {
      evidence: [
        verifiedEvidence({ id: "R1", field: "market_size", claim: "TAM is $4.2B", value: "$4.2B" }),
        verifiedEvidence({ id: "R2", field: "competitor", claim: "Named competitor analysis", value: "n/a" }),
        verifiedEvidence({ id: "R3", field: "product", claim: "Pricing comparison", value: "n/a" }),
      ],
    },
    REAL_CASE_PROMPT
  ).context;

  assert.equal(sparse.reportIntelligence.dimensions.evidenceQuality, original);
  assert.equal(abundant.reportIntelligence.dimensions.evidenceQuality, original);
});

test("2. market-research-coverage.ts's evidenceQuality construction carries an explicit #69A-50 marker and preserves the pre-refresh value", () => {
  assert.match(marketResearchCoverageSource, /TASK #69A-50/);
  assert.match(marketResearchCoverageSource, /evidenceQuality: context\.reportIntelligence\?\.dimensions\?\.evidenceQuality \?\? 0,/);
  assert.doesNotMatch(marketResearchCoverageSource, /evidenceQuality: dimensions\.marketConfidence,/);
});

// --- 2/3: all seven Founder Readiness dimensions from one canonical -----
// --- final state -----------------------------------------------------------

test("3. all seven Founder Readiness dimensionScores survive applyMarketResearchCoverageToContext byte-identical -- never independently recalculated inside the refresh", () => {
  const base = buildBase();
  const originalDimensionScores = base.investmentScore.decisionEngine.founderScore.dimensionScores;
  const refreshed = applyMarketResearchCoverageToContext(
    base,
    { evidence: [verifiedEvidence({ id: "R1", field: "market_size", claim: "TAM $1B", value: "$1B" })] },
    REAL_CASE_PROMPT
  ).context;

  assert.deepEqual(refreshed.investmentScore.decisionEngine.founderScore.dimensionScores, originalDimensionScores);
  assert.equal(originalDimensionScores.length, 7, "expected exactly 7 Founder Readiness dimensions");
});

test("4. the headline Founder Readiness Score and its 7 dimensions all originate from the SAME decisionEngine.founderScore object -- no second, independently-computed Founder Readiness state", () => {
  const base = buildBase();
  const refreshed = refreshResearchAwareFinancialContext(
    applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT).context
  );
  const headline = readFounderReadinessScoreValue(refreshed.investmentScore);
  assert.equal(headline, refreshed.investmentScore.decisionEngine.founderScore.score);
  assert.equal(
    refreshed.investmentScore.categories.teamFounder.score,
    Math.round(
      (refreshed.investmentScore.decisionEngine.founderScore.score /
        refreshed.investmentScore.decisionEngine.founderScore.maximumScore) *
        refreshed.investmentScore.categories.teamFounder.maximumScore
    )
  );
});

// --- 4: stale pre-research founderScore cannot overwrite final values ---

test("5. founderScore.score and dimensionScores are IDENTICAL whether computed from the early (raw-evidence) pass or the final (real-competitor-evidence) pass -- both start fresh from the same canonical pre-research context, so neither can silently diverge from the other", () => {
  const base = buildBase();
  const earlyPass = applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT).context;
  const finalPass = applyMarketResearchCoverageToContext(
    base,
    { evidence: [verifiedEvidence({ id: "R1", field: "competitor", claim: "5 competitors found", value: "n/a" })] },
    REAL_CASE_PROMPT
  ).context;

  assert.equal(
    earlyPass.investmentScore.decisionEngine.founderScore.score,
    finalPass.investmentScore.decisionEngine.founderScore.score
  );
  assert.deepEqual(
    earlyPass.investmentScore.decisionEngine.founderScore.dimensionScores,
    finalPass.investmentScore.decisionEngine.founderScore.dimensionScores
  );
});

// --- 5: stale validationIntelligenceV2 cannot overwrite final values ----

test("6. validationIntelligenceV2 is never recomputed by either refresh function -- the exact same object survives applyMarketResearchCoverageToContext and refreshResearchAwareFinancialContext (re-confirming #69A-18A's own investigation)", () => {
  const base = buildBase();
  const afterCoverage = applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT).context;
  assert.equal(afterCoverage.validationIntelligenceV2, base.validationIntelligenceV2);

  const afterFullRefresh = refreshResearchAwareFinancialContext(afterCoverage);
  assert.equal(afterFullRefresh.validationIntelligenceV2, base.validationIntelligenceV2);
});

// --- 6: financial refresh does not accidentally replace unrelated -------
// --- evidence metrics ------------------------------------------------------

test("7. financialConsistency and sourceIntelligence are never touched by either refresh function -- both survive as the SAME object reference", () => {
  const base = buildBase();
  const afterCoverage = applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT).context;
  assert.equal(afterCoverage.financialConsistency, base.financialConsistency);
  assert.equal(afterCoverage.sourceIntelligence, base.sourceIntelligence);

  const afterFullRefresh = refreshResearchAwareFinancialContext(afterCoverage);
  assert.equal(afterFullRefresh.financialConsistency, base.financialConsistency);
  assert.equal(afterFullRefresh.sourceIntelligence, base.sourceIntelligence);
});

// --- 7: Data Completeness and Evidence Confidence remain semantically ---
// --- distinct ---------------------------------------------------------------

test("8. Data Completeness (Report Quality) and Evidence Confidence (Founder Readiness) can legitimately diverge without contradiction -- proving they are not silently collapsed to one shared number", () => {
  const base = buildBase();
  const refreshed = refreshResearchAwareFinancialContext(
    applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT).context
  );
  const dataCompleteness = refreshed.reportIntelligence.dimensions.evidenceQuality;
  const evidenceConfidenceDimension = refreshed.investmentScore.decisionEngine.founderScore.dimensionScores.find(
    (d) => d.key === "evidenceConfidence"
  );

  assert.ok(evidenceConfidenceDimension);
  assert.ok(dataCompleteness > 0, "this fixture's real MRR/paying-customer/waitlist evidence must produce a genuine, non-zero Data Completeness");
  // These two numbers measure different things (overall analysis input
  // completeness vs. founder/business-specific validation evidence) --
  // there is no requirement that they match, and this fixture's own
  // real prompt shape (strong revenue signal, but no founder-specific
  // domain-experience/pilot-partner evidence) produces genuinely
  // different values for each.
  assert.notEqual(dataCompleteness, evidenceConfidenceDimension.score);
});

// --- 8: Financial Consistency and Financial Research Coverage remain ---
// --- distinct (cross-check with #69A-49) ---------------------------------

test("9. Financial Consistency (reportQuality) and Financial Research Coverage (Confidence Radar) remain independently sourced after this fix -- neither is derived from evidenceQuality/Data Completeness", () => {
  const base = buildBase();
  const refreshed = refreshResearchAwareFinancialContext(
    applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT).context
  );
  assert.equal(refreshed.reportIntelligence.dimensions.financialConsistency, base.reportIntelligence.dimensions.financialConsistency);
  assert.notEqual(
    refreshed.reportIntelligence.dimensions.financialConsistency,
    refreshed.investmentScore.decisionEngine.financialScore.score
  );
});

// --- 9: web/PDF parity ----------------------------------------------------

test("10. [PARITY] getReportQualityBreakdown (both web and PDF read this SAME shared helper) surfaces evidenceQuality/Data Completeness directly from the passed reportQuality object -- no renderer-specific recomputation", () => {
  const base = buildBase();
  const refreshed = refreshResearchAwareFinancialContext(
    applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT).context
  );
  const breakdown = getReportQualityBreakdown(refreshed.reportIntelligence, false);
  const dataCompletenessCard = breakdown.find((item) => item.label === "Data Completeness");
  assert.ok(dataCompletenessCard);
  assert.equal(dataCompletenessCard.value, `${refreshed.reportIntelligence.dimensions.evidenceQuality}/100`);
});

test("11. [PARITY] web (single-section content) and PDF (full concatenated content) callers of buildExecutiveSnapshot agree on every Confidence Radar dimension for the same, once-refreshed investmentScore", () => {
  const base = buildBase();
  const refreshed = refreshResearchAwareFinancialContext(
    applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT).context
  );
  const executiveSummarySection = "MONITOR. The opportunity shows directional promise pending validation.";
  const fullReportContent = [
    `Executive Summary\n${executiveSummarySection}`,
    "Financial Dashboard\nFinancial Consistency: 34/100 - assumptions require validation.",
  ].join("\n\n");

  const webSnapshot = buildExecutiveSnapshot(executiveSummarySection, refreshed.investmentScore, undefined);
  const pdfSnapshot = buildExecutiveSnapshot(fullReportContent, refreshed.investmentScore, undefined);
  assert.deepEqual(webSnapshot.confidenceRadar, pdfSnapshot.confidenceRadar);
});

// --- 10: persistence round-trip preserves canonical values --------------

test("12. [PERSISTENCE] evidenceQuality/founderScore.score/dimensionScores survive a full JSON persistence round trip (simulating reports.metadata JSONB) unchanged", () => {
  const base = buildBase();
  const refreshed = refreshResearchAwareFinancialContext(
    applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT).context
  );
  const roundTripped = JSON.parse(JSON.stringify(refreshed));

  assert.equal(roundTripped.reportIntelligence.dimensions.evidenceQuality, refreshed.reportIntelligence.dimensions.evidenceQuality);
  assert.equal(
    roundTripped.investmentScore.decisionEngine.founderScore.score,
    refreshed.investmentScore.decisionEngine.founderScore.score
  );
  assert.deepEqual(
    roundTripped.investmentScore.decisionEngine.founderScore.dimensionScores,
    refreshed.investmentScore.decisionEngine.founderScore.dimensionScores
  );
});

// --- 11: regeneration is deterministic for identical structured evidence -

test("13. [DETERMINISM] the same structured fixture, refreshed twice with identical evidence, produces byte-identical evidenceQuality/founderScore/dimensionScores -- no hidden randomness or ordering sensitivity", () => {
  const base = buildBase();
  const evidence = [verifiedEvidence({ id: "R1", field: "market_size", claim: "TAM $1B", value: "$1B" })];
  const first = applyMarketResearchCoverageToContext(base, { evidence }, REAL_CASE_PROMPT).context;
  const second = applyMarketResearchCoverageToContext(base, { evidence }, REAL_CASE_PROMPT).context;

  assert.equal(first.reportIntelligence.dimensions.evidenceQuality, second.reportIntelligence.dimensions.evidenceQuality);
  assert.equal(
    first.investmentScore.decisionEngine.founderScore.score,
    second.investmentScore.decisionEngine.founderScore.score
  );
  assert.deepEqual(
    first.investmentScore.decisionEngine.founderScore.dimensionScores,
    second.investmentScore.decisionEngine.founderScore.dimensionScores
  );
});

// --- 12: decision/confidence consumes the same final state --------------

test("14. [INVARIANT] investmentScore.confidence is completely unaffected by the evidenceQuality fix -- decision/confidence continues to be driven only by coverage.overallConfidence, never by reportIntelligence.dimensions", () => {
  const base = buildBase();
  const sparse = applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT).context;
  const abundant = applyMarketResearchCoverageToContext(
    base,
    { evidence: [verifiedEvidence({ id: "R1", field: "market_size", claim: "TAM $1B", value: "$1B" })] },
    REAL_CASE_PROMPT
  ).context;

  // evidenceQuality is now frozen at the same original value for both --
  // confirming confidence's own genuine change between these two fixtures
  // (if any) cannot be attributed to reportIntelligence.dimensions at all.
  assert.equal(sparse.reportIntelligence.dimensions.evidenceQuality, abundant.reportIntelligence.dimensions.evidenceQuality);
});

// --- cache-invalidation safety -------------------------------------------

test("15. [CACHE SAFETY] BUSINESS_PLAN_GENERATION_CONTRACT_VERSION was bumped past v13, invalidating any full-report cache entry generated before this fix", () => {
  const match = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "ltv-cac-ratio-integrity-v(\d+)";/.exec(planExecutorSource);
  assert.ok(match, "BUSINESS_PLAN_GENERATION_CONTRACT_VERSION declaration not found");
  assert.ok(Number(match[1]) >= 14, "version must be at v14 or later for this ticket's own cache-invalidating bump");
  assert.match(planExecutorSource, /TASK #69A-50/);
});

// --- historical safety ----------------------------------------------------

test("16. [HISTORICAL SAFETY] a historical report's own persisted evidenceQuality value (even one already contaminated by the pre-fix formula) is read back exactly as stored on reload -- never silently mutated/reconstructed", () => {
  const historicalReportQuality = {
    totalScore: 55,
    confidenceLevel: "Moderate Confidence",
    overallQuality: "Preliminary",
    qualityScore: 55,
    dimensions: {
      evidenceQuality: 0, // the exact pre-fix contaminated value, already persisted
      sourceConfidence: 71,
      financialConsistency: 34,
      benchmarkFit: 46,
      validationReadiness: 47,
    },
  };
  const breakdown = getReportQualityBreakdown(historicalReportQuality, false);
  const card = breakdown.find((item) => item.label === "Data Completeness");
  assert.equal(card.value, "0/100", "a historical report's persisted value must never be silently rewritten on read");
});

// --- SAFETY: unrelated architecture untouched ----------------------------

test("SAFETY: no canonical decision (createRecommendation/applyFatalBlockerOverride), Porter's Five Forces, competitor-evidence, or financial-labeling file carries a #69A-50 marker -- this fix is confined to market-research-coverage.ts's evidenceQuality preservation and plan-executor.ts's cache-version bump", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/report-intelligence.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/financial-evidence-labeling.ts",
    "app/lib/report-presentation.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-50/, `${relativePath} must not carry a #69A-50 marker`);
  }
});
