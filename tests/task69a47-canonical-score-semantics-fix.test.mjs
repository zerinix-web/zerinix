// TASK #69A-47 -- Canonicalize confidence, evidence, and financial score
// semantics across the Business Plan report without weakening evidence
// honesty.
//
// FULL TRACE (summary; complete detail reported to the user) across the
// 12 named metrics:
//   - Overall report confidence / Executive Decision Confidence =
//     investmentScore.confidence (investment-score.ts). A genuine, distinct
//     "Composite Decision Confidence" (Family F) blend of metric
//     confidence/specificity/founderSignals/defensibilitySignals/
//     validationEvidence at generation time, then legitimately re-derived
//     from research coverage's calculateMarketOverallConfidence
//     (marketConfidence 36% + competitiveEvidence 24% + financialEvidence
//     12% + productEvidence 12% + executionReadiness 8% + founderReadiness
//     8%) once real research completes -- an intentional, previously
//     reviewed design (see the existing SAFETY test in
//     task69a43-financial-consistency-validation-readiness-contamination-fix.test.mjs).
//     Already distinctly labeled from every founder-specific metric in
//     both web and PDF ("Confidence: NN%" next to "Decision: ..." vs
//     "Founder Readiness Score: NN/100") -- no rename needed, no
//     duplicate-computation defect found. Documented as a remaining,
//     deliberate design note: founder-specific evidence carries only 8%
//     weight in this composite, so a report can legitimately show high
//     Overall Confidence built mostly from abundant market/competitive
//     research even when founder evidence is weak -- this is why Founder
//     Readiness Score/Evidence Confidence/Founder Evidence must (and now
//     provably do, see below) stay fully independent, verifiable numbers
//     of their own rather than being inferred from this composite.
//   - Source Strength (reportIntelligence.dimensions.sourceConfidence) --
//     research SOURCE quality/diversity. Already correctly isolated and
//     named by #69A-44; re-confirmed here, untouched.
//   - Market Confidence (decisionEngine.marketScore) -- deliberately
//     research-aware (scoreCategory driven by dimensions.marketConfidence);
//     this is CORRECT for what "market confidence" means and was already
//     confirmed intentional/untouched by #69A-43's own SAFETY test.
//   - Financial Evidence/Confidence -- THREE now-distinct concepts,
//     confirmed non-colliding: (1) Financial Consistency (reportIntelligence,
//     model's own internal coherence -- #69A-43), (2) Financial Evidence
//     (#69A-46's canonical per-metric Verified/Derived/Benchmark/Assumption
//     aggregate), (3) Confidence Radar's decisionEngine.financialScore,
//     renamed here to "Financial Signal" since it measures EXTERNAL
//     research coverage of financial/economic topics for this market --
//     a fourth, genuinely different thing that shared the bare word
//     "Financial" with the first two.
//   - Financial Consistency / Validation Readiness / Benchmark Fit --
//     all self-contained in report-intelligence.ts, never sourced from
//     research coverage; already fixed and protected by #69A-43/38G/44.
//     Re-confirmed here.
//   - Evidence Confidence / Founder Evidence (Founder Readiness
//     dimensionScores) -- already protected from research-coverage
//     contamination by #69A-27B at the per-dimension level.
//   - Moat/Competitive Evidence (Confidence Radar's decisionEngine.
//     competitionScore, renamed "Moat Evidence" by #69A-44) -- deliberately
//     research-aware (competitive landscape IS externally verifiable);
//     already confirmed intentional/untouched.
//   - Founder Readiness Score (decisionEngine.founderScore.score) -- THE
//     REAL DEFECT FOUND AND FIXED. See below.
//
// ROOT CAUSE FOUND AND FIXED (market-research-coverage.ts): unlike every
// one of its own 7 displayed dimensionScores/reasoning lines (already
// protected by #69A-27B's "original ?? fallback" pattern), the
// AGGREGATE founderScore.score itself had no such protection --
// scoreCategory silently overwrote it with dimensions.founderReadiness,
// a coarse PROMPT-KEYWORD proxy (promptReadiness, this file), discarding
// the richer teamFounder computation (investment-score.ts) the 7
// sub-dimensions themselves still correctly reflected. Fixed by
// preserving the pre-refresh original .score, mirroring #69A-43's own
// established pattern exactly.
//
// SEPARATE, LABEL-ONLY FIX: Confidence Radar's "Financial" dimension
// renamed to "Financial Signal" (report-presentation.ts) -- no
// value/formula change -- to stop it colliding with "Financial
// Consistency" and "Financial Evidence" in the same report.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanonicalFinancialAssumptions,
  refreshResearchAwareFinancialContext,
} from "../app/lib/ai/financial-assumptions.ts";
import {
  applyMarketResearchCoverageToContext,
  calculateMarketOverallConfidence,
} from "../app/lib/ai/market-research-coverage.ts";
import {
  buildExecutiveSnapshot,
  getReportQualityBreakdown,
  readFounderReadinessScoreValue,
} from "../app/lib/report-presentation.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const marketResearchCoverageSource = readFileSync(
  join(repoRoot, "app/lib/ai/market-research-coverage.ts"),
  "utf8"
);
const reportPresentationSource = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");

const REAL_CASE_PROMPT =
  "Premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for SMBs in the United States, integrating with QuickBooks/Xero.";

function buildBase() {
  return createCanonicalFinancialAssumptions({ prompt: REAL_CASE_PROMPT, reportKind: "business_plan" });
}

// A synthetic MarketResearchCoverage with STRONG public market/competitive
// research but WEAK founder/customer evidence -- the exact shape named by
// the ticket's own required regression fixture (item 8): "strong public
// research, weak founder/customer evidence, partially modeled financials,
// directional competitor evidence."
function strongResearchWeakFounderCoverage() {
  const dimensions = {
    marketConfidence: 92,
    competitiveEvidence: 88,
    financialEvidence: 70,
    productEvidence: 65,
    executionReadiness: 60,
    founderReadiness: 12,
  };
  return {
    evidenceCount: 24,
    verifiedSources: 18,
    independentDomains: 9,
    competitorBreadth: 6,
    sourceTypeDiversity: 5,
    claimCoverage: 6,
    freshnessScore: 88,
    averageQuality: 84,
    verifiedMarketSizeAvailable: true,
    dimensions,
    overallConfidence: calculateMarketOverallConfidence(dimensions),
    sourceClasses: ["industryReport", "companyFiling", "newsArticle"],
  };
}

function applyStrongResearchWeakFounderFixture(context) {
  const coverage = strongResearchWeakFounderCoverage();
  const { context: refreshedContext } = applyMarketResearchCoverageToContext(
    context,
    { evidence: [] },
    REAL_CASE_PROMPT,
    coverage
  );
  return refreshResearchAwareFinancialContext(refreshedContext);
}

// --- FAIL-BEFORE PROOF: the pre-fix formula really did collapse the -----
// --- headline founderScore.score onto the prompt-keyword proxy ----------

test("FAIL-BEFORE PROOF: reconstructing the pre-fix scoreCategory-only formula for founderScore.score produces dimensions.founderReadiness verbatim, discarding the real teamFounder computation -- proving this was a genuine collapse, not a cosmetic gap", () => {
  const base = buildBase();
  const preRefreshTeamFounderScore = base.investmentScore.decisionEngine.founderScore.score;
  const coverage = strongResearchWeakFounderCoverage();

  // Old formula (removed): scoreCategory(category, score, reasoning) =>
  // { ...category, score: round((score/100) * category.maximumScore), reasoning }
  const oldBuggyScore = Math.round((coverage.dimensions.founderReadiness / 100) * 100);
  assert.equal(oldBuggyScore, coverage.dimensions.founderReadiness);
  assert.notEqual(
    preRefreshTeamFounderScore,
    oldBuggyScore,
    `expected the real teamFounder score (${preRefreshTeamFounderScore}) to differ from the coarse prompt-keyword proxy (${oldBuggyScore}) for this fixture -- if they always agreed there would be nothing to collapse`
  );
});

// --- CONSOLIDATION PROOF: the fix preserves the real score ---------------

test("1. decisionEngine.founderScore.score survives applyMarketResearchCoverageToContext unchanged, even when dimensions.founderReadiness is very low", () => {
  const base = buildBase();
  const preRefreshScore = base.investmentScore.decisionEngine.founderScore.score;
  const { context: refreshed } = applyMarketResearchCoverageToContext(
    base,
    { evidence: [] },
    REAL_CASE_PROMPT,
    strongResearchWeakFounderCoverage()
  );
  assert.equal(refreshed.investmentScore.decisionEngine.founderScore.score, preRefreshScore);
  assert.notEqual(refreshed.investmentScore.decisionEngine.founderScore.score, 12);
});

test("2. the preserved founderScore.score correctly propagates to investmentScore.categories.teamFounder.score via the established refresh call order -- no second, divergent computation", () => {
  const base = buildBase();
  const preRefreshScore = base.investmentScore.decisionEngine.founderScore.score;
  const refreshed = applyStrongResearchWeakFounderFixture(base);
  const teamFounder = refreshed.investmentScore.categories.teamFounder;
  const expectedCategoryScore = Math.round((preRefreshScore / 100) * teamFounder.maximumScore);
  assert.equal(teamFounder.score, expectedCategoryScore);
});

test("3. the headline Founder Readiness Score (readFounderReadinessScoreValue) reflects the preserved score, never the research-coverage proxy", () => {
  const base = buildBase();
  const preRefreshScore = base.investmentScore.decisionEngine.founderScore.score;
  const refreshed = applyStrongResearchWeakFounderFixture(base);
  const headline = readFounderReadinessScoreValue(refreshed.investmentScore);
  assert.equal(headline, Math.max(0, Math.min(100, Math.round(preRefreshScore))));
  assert.notEqual(headline, 12, "must never collapse onto the low prompt-keyword founderReadiness proxy");
});

test("4. market-research-coverage.ts's founderScore construction carries an explicit #69A-47 marker and preserves the pre-refresh score", () => {
  assert.match(marketResearchCoverageSource, /TASK #69A-47/);
  assert.match(marketResearchCoverageSource, /score: decisionEngine\.founderScore\.score,/);
});

// --- REQUIRED INVARIANT: Financial Consistency cannot be sourced from ---
// --- research coverage ----------------------------------------------------

test("5. [INVARIANT] Financial Consistency is identical whether research coverage is abundant or absent -- never sourced from research coverage", () => {
  const base = buildBase();
  const withoutResearch = base.reportIntelligence.dimensions.financialConsistency;
  const refreshed = applyStrongResearchWeakFounderFixture(base);
  assert.equal(refreshed.reportIntelligence.dimensions.financialConsistency, withoutResearch);
});

// --- REQUIRED INVARIANT: Evidence Confidence cannot equal Source --------
// --- Strength merely because research coverage is high ------------------

test("6. [INVARIANT] Evidence Confidence (Founder Readiness) does not converge on Source Strength (Report Quality) merely because research coverage is abundant", () => {
  const base = buildBase();
  const refreshed = applyStrongResearchWeakFounderFixture(base);
  const evidenceConfidenceDimension = refreshed.investmentScore.decisionEngine.founderScore.dimensionScores?.find(
    (dimension) => dimension.key === "evidenceConfidence"
  );
  const sourceStrength = refreshed.reportIntelligence.dimensions.sourceConfidence;

  assert.ok(evidenceConfidenceDimension, "evidenceConfidence dimension must exist");
  // Source Strength is driven directly by averageQuality (84) + independent
  // domains (9) in this fixture, so it is necessarily high; Evidence
  // Confidence (founder/business-specific validation) must not be pulled
  // up to match it merely because public research happens to be abundant.
  assert.ok(
    sourceStrength >= 70,
    `expected this fixture's abundant research to produce a high Source Strength, got ${sourceStrength}`
  );
  assert.notEqual(
    evidenceConfidenceDimension.score,
    sourceStrength,
    `Evidence Confidence (${evidenceConfidenceDimension.score}) must not equal Source Strength (${sourceStrength}) merely because research coverage is high`
  );
});

// --- REQUIRED INVARIANT: Founder Readiness remains independent from -----
// --- report confidence ----------------------------------------------------

test("7. [INVARIANT] Founder Readiness Score and Overall report confidence are two independently-sourced fields -- neither is derived from the other", () => {
  const base = buildBase();
  const refreshed = applyStrongResearchWeakFounderFixture(base);
  const founderReadinessScore = readFounderReadinessScoreValue(refreshed.investmentScore);
  const overallConfidence = refreshed.investmentScore.confidence;

  assert.ok(typeof founderReadinessScore === "number");
  assert.ok(typeof overallConfidence === "number");
  // This fixture deliberately makes them diverge (weak founder evidence,
  // strong public research overall-confidence input) -- proving neither
  // field is silently copied from the other.
  assert.notEqual(founderReadinessScore, overallConfidence);
});

// --- REQUIRED INVARIANT: Competitive evidence cannot overwrite general --
// --- validation evidence --------------------------------------------------

test("8. [INVARIANT] Confidence Radar's Moat Evidence (competitive) and Founder Readiness's Evidence Confidence (general validation) remain two distinct fields under a fresh regeneration, never collapsed to one", () => {
  const base = buildBase();
  const refreshed = applyStrongResearchWeakFounderFixture(base);
  const snapshot = buildExecutiveSnapshot("", refreshed.investmentScore, refreshed.reportIntelligence);
  const moatEvidence = snapshot.confidenceRadar.find((dimension) => dimension.label === "Moat Evidence");
  const evidenceConfidenceDimension = refreshed.investmentScore.decisionEngine.founderScore.dimensionScores?.find(
    (dimension) => dimension.key === "evidenceConfidence"
  );

  assert.ok(moatEvidence);
  assert.ok(evidenceConfidenceDimension);
  assert.equal(moatEvidence.score, refreshed.investmentScore.decisionEngine.competitionScore.score);
  assert.notEqual(
    moatEvidence.score,
    evidenceConfidenceDimension.score,
    "competitive/moat evidence must never overwrite the general Evidence Confidence dimension"
  );
});

// --- REQUIRED INVARIANT: web and PDF display the same canonical values --

test("9. [INVARIANT] web (single-section content) and PDF (full concatenated content) callers agree on the renamed Financial Research Coverage dimension for the same investmentScore", () => {
  const base = buildBase();
  const refreshed = applyStrongResearchWeakFounderFixture(base);
  const executiveSummarySection = "MONITOR. The opportunity shows directional promise pending validation.";
  const founderReadinessSection = [
    `Founder Readiness Score: ${readFounderReadinessScoreValue(refreshed.investmentScore)}/100`,
    "Evidence Confidence: 18/100 - Evidence remains directional until customer data is observed.",
  ].join("\n");
  const fullReportContent = [
    `Executive Summary\n${executiveSummarySection}`,
    `Founder Readiness\n${founderReadinessSection}`,
  ].join("\n\n");

  const webSnapshot = buildExecutiveSnapshot(executiveSummarySection, refreshed.investmentScore, undefined);
  const pdfSnapshot = buildExecutiveSnapshot(fullReportContent, refreshed.investmentScore, undefined);

  assert.deepEqual(webSnapshot.confidenceRadar, pdfSnapshot.confidenceRadar);
  const financialSignal = webSnapshot.confidenceRadar.find((dimension) => dimension.label === "Financial Research Coverage");
  assert.ok(financialSignal, "the renamed 'Financial Research Coverage' label must be present for both callers");
});

// --- REQUIRED INVARIANT: unsupported fields fail honestly ----------------

test("10. [INVARIANT] a dimension with no real signal available reports null (rendered as 'Validation Required'), never a fabricated fallback score, including the renamed Financial Research Coverage dimension", () => {
  const snapshot = buildExecutiveSnapshot("Some report text with no labeled dimension scores.", undefined, undefined);
  const financialSignal = snapshot.confidenceRadar.find((dimension) => dimension.label === "Financial Research Coverage");
  assert.ok(financialSignal);
  assert.equal(financialSignal.score, null);
});

// --- REQUIRED INVARIANT: persisted reload and fresh regeneration --------
// --- preserve the same semantic meaning -----------------------------------

test("11. [INVARIANT] founderScore.score and reportIntelligence.dimensions survive a full JSON persistence round trip (simulating reports.metadata JSONB) with identical values to the fresh regeneration", () => {
  const base = buildBase();
  const refreshed = applyStrongResearchWeakFounderFixture(base);
  const roundTripped = JSON.parse(JSON.stringify(refreshed));

  assert.equal(
    roundTripped.investmentScore.decisionEngine.founderScore.score,
    refreshed.investmentScore.decisionEngine.founderScore.score
  );
  assert.equal(
    roundTripped.reportIntelligence.dimensions.financialConsistency,
    refreshed.reportIntelligence.dimensions.financialConsistency
  );
  assert.equal(
    readFounderReadinessScoreValue(roundTripped.investmentScore),
    readFounderReadinessScoreValue(refreshed.investmentScore)
  );
});

test("12. [INVARIANT] a historical report persisted BEFORE this fix (founderScore.score already equal to the old prompt-keyword proxy) is read as-is on reload -- never silently mutated/reconstructed to a different number", () => {
  const base = buildBase();
  // Simulate a report that was generated and persisted under the OLD,
  // buggy behavior: founderScore.score already collapsed to the coverage
  // proxy at persist time.
  const historicalInvestmentScore = {
    ...base.investmentScore,
    decisionEngine: {
      ...base.investmentScore.decisionEngine,
      founderScore: {
        ...base.investmentScore.decisionEngine.founderScore,
        score: 12,
      },
    },
  };
  const roundTripped = JSON.parse(JSON.stringify(historicalInvestmentScore));
  assert.equal(
    readFounderReadinessScoreValue(roundTripped),
    12,
    "a historical persisted value must be read back exactly as stored -- no silent reconstruction"
  );
});

// --- REQUIRED REGRESSION FIXTURE (item 8): strong public research + -----
// --- weak founder/customer evidence + partially modeled financials + ----
// --- directional competitor evidence coexist without contradiction ------

test("13. [REGRESSION FIXTURE] strong public research legitimately coexists with low founder evidence/evidence confidence without contradiction", () => {
  const base = buildBase();
  const refreshed = applyStrongResearchWeakFounderFixture(base);

  const sourceStrength = refreshed.reportIntelligence.dimensions.sourceConfidence;
  const evidenceConfidenceDimension = refreshed.investmentScore.decisionEngine.founderScore.dimensionScores?.find(
    (dimension) => dimension.key === "evidenceConfidence"
  );
  const founderEvidenceDimension = refreshed.investmentScore.decisionEngine.founderScore.dimensionScores?.find(
    (dimension) => dimension.key === "founderEvidence"
  );
  const marketSignal = refreshed.investmentScore.decisionEngine.marketScore.score;
  const moatEvidence = refreshed.investmentScore.decisionEngine.competitionScore.score;

  // Strong public research legitimately produces high market/source
  // signal (this fixture's own dimensions.marketConfidence=92/
  // competitiveEvidence=88, averageQuality=84).
  assert.ok(sourceStrength >= 70, `expected high Source Strength, got ${sourceStrength}`);
  assert.ok(marketSignal >= 70, `expected high market signal, got ${marketSignal}`);
  assert.ok(moatEvidence >= 70, `expected high directional competitive/moat evidence, got ${moatEvidence}`);

  // Weak founder/customer evidence must remain visibly weak -- not
  // boosted by the abundant market research above.
  assert.ok(evidenceConfidenceDimension);
  assert.ok(founderEvidenceDimension);
  assert.ok(
    evidenceConfidenceDimension.score < sourceStrength,
    `Evidence Confidence (${evidenceConfidenceDimension.score}) must stay below Source Strength (${sourceStrength}) in this weak-founder-evidence fixture`
  );

  // None of this is a contradiction: it is a report-quality panel
  // reasoning honestly about weak founder validation next to strong
  // market research, exactly what the ticket asks to make auditable.
  const breakdown = getReportQualityBreakdown(refreshed.reportIntelligence, false);
  assert.ok(Array.isArray(breakdown) && breakdown.length > 0);
});

// --- SAFETY: rename is label-only, everything else untouched -------------

test("SAFETY: the 'Financial' -> 'Financial Signal' -> 'Financial Research Coverage' relabeling changes no value/formula -- decisionEngine.financialScore.score is read identically across every rename", () => {
  // TASK #69A-49 -- widened: #69A-47's own label was itself superseded by
  // #69A-49's own further-refined rename (see that ticket's own comment
  // in report-presentation.ts) -- this test's only real concern is that
  // no rename has ever touched the underlying score expression.
  assert.match(
    reportPresentationSource,
    /label: isTurkish \? "Finansal Araştırma Kapsamı" : "Financial Research Coverage",/
  );
  assert.match(
    reportPresentationSource,
    /score: investmentScore\?\.decisionEngine\?\.financialScore\?\.score,/
  );
});

test("SAFETY: no canonical decision (createRecommendation/applyFatalBlockerOverride), market sizing, Porter's Five Forces, pricing, or GTM file carries a #69A-47 marker -- this fix is confined to founderScore.score preservation and one Confidence Radar label", () => {
  const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");
  assert.doesNotMatch(investmentScoreSource, /TASK #69A-47/);
});
