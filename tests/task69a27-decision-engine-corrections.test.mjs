// TASK #69A-27 -- Fix the decision-engine correctness failures proven
// by #69A-26.
//
// Uses the completed #69A-26 audit as the authoritative defect list.
// Fixes the smallest root causes that allowed mathematically valid
// inputs to produce strategically wrong decisions -- no broad redesign
// of the report, UI, PDF, evidence architecture, or scoring system.
//
// FIX 1 -- hard blockers override aggregate scores. ROOT CAUSE (#69A-26
// P0, proven by direct arithmetic): createRecommendation
// (investment-score.ts) was a pure two-threshold gate on the aggregate
// totalScore/confidence, with no per-category floor -- 7 categories at
// 90% and ONE catastrophic category at 10% still produced totalScore
// 82, clearing the GO threshold outright. Fixed with
// detectFatalBlockers/applyFatalBlockerOverride: checks the 7 named
// Founder Readiness DIMENSION scores (not just the 8 top-level
// categories, since teamFounder's own category score is itself an
// average of 6 sub-signals that would otherwise dilute a catastrophic
// founderEvidenceScore back up) for any dimension scoring below 15% of
// its own maximum, and downgrades a would-be "GO" to "WAIT" whenever
// one exists. Never touches WAIT/PASS, never a prose/keyword scan of
// report text -- reads only already-computed, structured dimension
// scores.
//
// FIX 2 -- unsupported projections must not create GO/ENTER. ROOT
// CAUSE (#69A-26 adversarial finding: "we project $10M ARR within 18
// months... no customers, no revenue, no pilots" reached
// recommendation "GO"): hasValidationEvidence (both the financial-
// model.ts and investment-score.ts copies) and extractLabeledUsdAmount
// (financial-model.ts, feeding MRR/ARR/investment-amount extraction)
// had negation-awareness but no FORWARD-LOOKING-language awareness --
// "we project $10M ARR" still matched the bare "arr" keyword and got
// extracted as if $10M were the company's real, current, achieved
// figure. Fixed by adding a projection/forward-looking-language
// exclusion (project/forecast/expect/target/plan to/aim to/believe/
// will be/etc.) alongside the existing negation exclusion, using the
// same nearby-text-window technique already established for negation
// in both files.
//
// FIX 3 -- Founder Evidence semantics. ROOT CAUSE (#69A-26 P0: a
// fixture explicitly stating the founder has "never operated a
// company... no domain expertise whatsoever" still produced Founder
// Evidence 94/100): founderSignals (investment-score.ts) was a bare
// keyword-presence check with no negation awareness at all. Fixed with
// the same negation-stripping technique plus an explicit,
// higher-priority "founder inexperience disclosed" check that floors
// founderEvidenceScore low regardless of any unrelated positive
// keyword elsewhere in the prompt. ALSO de-collapsed "Evidence
// Confidence" from "Founder Evidence" (#69A-26 P1: both dimensions
// read the identical founderEvidenceScore variable) -- Evidence
// Confidence now reads an independent evidenceConfidenceScore (average
// metric confidence + genuine validation evidence), never a
// founder-specific signal.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanonicalFinancialAssumptions,
  refreshResearchAwareFinancialContext,
} from "../app/lib/ai/financial-assumptions.ts";
import { applyMarketResearchCoverageToContext } from "../app/lib/ai/market-research-coverage.ts";
import {
  createRecommendation,
  detectFatalBlockers,
  applyFatalBlockerOverride,
  FATAL_BLOCKER_SCORE_RATIO,
} from "../app/lib/ai/investment-score.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");
const financialModelSource = readFileSync(join(repoRoot, "app/lib/ai/financial-model.ts"), "utf8");
const financialAssumptionsSource = readFileSync(join(repoRoot, "app/lib/ai/financial-assumptions.ts"), "utf8");
const reportInvestmentScoreSource = readFileSync(join(repoRoot, "app/lib/report-investment-score.ts"), "utf8");
const decisionConfidenceSource = readFileSync(join(repoRoot, "app/lib/ai/decision-confidence.ts"), "utf8");
const marketResearchCoverageSource = readFileSync(join(repoRoot, "app/lib/ai/market-research-coverage.ts"), "utf8");
const competitorStateSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"),
  "utf8"
);
const pdfExportRouteSource = readFileSync(join(repoRoot, "app/api/usage/pdf-export/route.ts"), "utf8");
const benchmarkPanelSource = readFileSync(
  join(repoRoot, "components/planner/BenchmarkIntelligencePanel.tsx"),
  "utf8"
);
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");

function evidenceItem(overrides) {
  return {
    id: overrides.id,
    field: overrides.field || "market_size",
    claim: overrides.claim,
    value: overrides.value || overrides.claim,
    label: "Verified from external source",
    sourceTitle: overrides.sourceTitle,
    publisher: overrides.publisher,
    url: overrides.url,
    sourceType: "webpage",
    authorityLevel: "secondary",
    confidence: overrides.confidence ?? 85,
    publishedDate: "2026-06-01",
    lastChecked: "2026-09-01",
    supportingData: [overrides.claim],
    impact: overrides.impact || "favorable",
    impactReason: overrides.impactReason || "",
    qualityScore: overrides.qualityScore ?? 70,
    researchStage: "authoritative_public",
    jurisdiction: "United States",
  };
}

function strongEvidenceSet() {
  return [
    evidenceItem({ id: "R1", field: "market_size", claim: "US enterprise logistics SaaS TAM estimated at $18B, growing 14% CAGR.", url: "https://www.gartner.com/en/reports/logistics-saas-market", sourceTitle: "Gartner logistics SaaS market report", publisher: "Gartner" }),
    evidenceItem({ id: "R2", field: "market_size", claim: "Enterprise logistics software SAM in North America estimated at $4.2B.", url: "https://www.statista.com/logistics-software-market", sourceTitle: "Statista logistics software market", publisher: "Statista" }),
    evidenceItem({ id: "R3", field: "competitors", claim: "Project44 is a leading competitor offering real-time supply chain visibility to enterprise logistics customers.", url: "https://www.project44.com/platform", sourceTitle: "Project44 platform overview", publisher: "Project44" }),
    evidenceItem({ id: "R4", field: "competitors", claim: "FourKites competes in the logistics visibility space with a large enterprise customer base.", url: "https://www.fourkites.com/platform", sourceTitle: "FourKites platform overview", publisher: "FourKites" }),
    evidenceItem({ id: "R5", field: "competitors", claim: "Flexport offers freight forwarding and visibility software to enterprise shippers.", url: "https://www.flexport.com/platform", sourceTitle: "Flexport platform", publisher: "Flexport" }),
    evidenceItem({ id: "R6", field: "financial", claim: "Enterprise logistics SaaS companies typically report 80-90% gross margins.", url: "https://www.crunchbase.com/logistics-saas-benchmarks", sourceTitle: "Crunchbase logistics SaaS benchmarks", publisher: "Crunchbase" }),
    evidenceItem({ id: "R7", field: "product_evidence", claim: "Enterprise logistics buyers cite integration depth and reliability as primary purchase drivers.", url: "https://www.g2.com/categories/supply-chain-visibility", sourceTitle: "G2 supply chain visibility category", publisher: "G2" }),
  ];
}

function runFullPipeline(prompt, evidence = []) {
  const context = createCanonicalFinancialAssumptions({ prompt, reportKind: "business_plan" });
  const coverageResult = applyMarketResearchCoverageToContext(context, { evidence }, prompt);
  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);
  return refreshed;
}

const STRONG_LOGISTICS_PROMPT_FOR_GO =
  "We run a B2B enterprise SaaS subscription platform for logistics companies in the US, UK, and Europe. We have 900 paying enterprise customers generating $9.5M ARR with 94% gross margin. Our monthly churn is 0.6% and net revenue retention is 132%. CAC is $1,200 with a 3-month payback, validated over 24 months of paid acquisition spend across enterprise sales channels with cohort-level retention tracking. We have an experienced founding team of former logistics executives, engineers, and domain experts with 15+ years of industry experience. Our SAM is estimated at $1.2B with a defensible proprietary data moat, network effects, and enterprise compliance certifications.";

const CRITICAL_FOUNDER_BLOCKER_PROMPT =
  "We run a B2B SaaS subscription platform for enterprise healthcare compliance software in the US. We have 300 paying enterprise customers generating $4M ARR with 90% gross margin, 1% monthly churn, and validated CAC of $1,500 with a 3-month payback confirmed over 18 months. We have proprietary technology and enterprise compliance certifications and a large defensible market. However, we have no founder or team with any healthcare, compliance, or software domain experience -- the founder has never operated a company, has no technical background, and has no domain expertise whatsoever.";

const UNSUPPORTED_PROJECTION_PROMPT =
  "We project $10M ARR within 18 months for our new enterprise SaaS subscription platform in the US. We have no customers, no revenue, no pilots, and no validated demand yet, but our financial model shows strong growth.";

const PROMISING_UNVALIDATED_PROMPT =
  "We are building a B2B subscription platform for small restaurant inventory management in the US. The market for restaurant software is large and growing. We have not yet run any paid pilots and have no confirmed paying customers. We do not have validated CAC or retention data yet, and willingness to pay has not been tested.";

const LARGE_TAM_BAD_BUSINESS_PROMPT =
  "We are entering the global e-commerce market, which is enormous and growing rapidly worldwide. Our business is a direct-to-consumer low-margin commodity goods reseller with thin gross margins after shipping and returns. We have no customers, no revenue, no pilots, and no validated demand, and our customer acquisition cost is expected to be very high relative to lifetime value with no clear differentiation from existing large e-commerce players.";

// --- A: strong evidence / no blockers -> ENTER can be eligible ----------

test("A: a genuinely strong, well-evidenced, unblocked case CAN reach recommendation GO", () => {
  const refreshed = runFullPipeline(STRONG_LOGISTICS_PROMPT_FOR_GO, strongEvidenceSet());
  assert.equal(refreshed.investmentScore.recommendation, "GO");
  assert.ok(refreshed.investmentScore.totalScore >= 72);
  assert.ok(refreshed.investmentScore.confidence >= 60);
  assert.deepEqual(refreshed.investmentScore.fatalBlockers, []);
  // totalScore must match the currently-displayed categories exactly
  // -- the #69A-26 P0 provenance defect this same fix corrects.
  const sumOfDisplayedCategories = Object.values(refreshed.investmentScore.categories).reduce(
    (sum, category) => sum + category.score,
    0
  );
  assert.equal(refreshed.investmentScore.totalScore, sumOfDisplayedCategories);
});

// --- B: promising but materially unvalidated -> MONITOR (WAIT) ----------

test("B: a promising market with missing WTP/CAC/retention/pilot evidence resolves to WAIT, not GO", () => {
  const refreshed = runFullPipeline(PROMISING_UNVALIDATED_PROMPT, []);
  assert.equal(refreshed.investmentScore.recommendation, "WAIT");
  assert.ok(refreshed.benchmarkFit.materialValidationGaps.length > 0);
});

// --- C: authoritative fatal blocker + otherwise high scores -> MUST -----
// --- NOT ENTER -------------------------------------------------------------

test("C: an otherwise-strong, well-evidenced business with an explicit, total founder-experience blocker must not reach GO", () => {
  const refreshed = runFullPipeline(CRITICAL_FOUNDER_BLOCKER_PROMPT, strongEvidenceSet());
  assert.notEqual(refreshed.investmentScore.recommendation, "GO");
  assert.ok(refreshed.investmentScore.fatalBlockers.length > 0);
  assert.ok(refreshed.investmentScore.fatalBlockers.some((blocker) => blocker.key === "founderEvidence"));
  const founderEvidenceDimension = refreshed.investmentScore.decisionEngine.founderScore.dimensionScores.find(
    (dimension) => dimension.key === "founderEvidence"
  );
  assert.ok(founderEvidenceDimension.score < FATAL_BLOCKER_SCORE_RATIO * 100);
});

// --- D: unsupported revenue/financial projections -> MUST NOT create ----
// --- ENTER/GO ---------------------------------------------------------------

test("D: an unsupported revenue projection with explicitly zero real customers/revenue/pilots must not reach GO", () => {
  const refreshed = runFullPipeline(UNSUPPORTED_PROJECTION_PROMPT, []);
  assert.notEqual(refreshed.investmentScore.recommendation, "GO");
  // Confirmed root-cause fix: confidence must not be inflated by the
  // bare mention of "ARR" in a forward-looking projection.
  assert.ok(refreshed.investmentScore.confidence < 60);
});

// --- E: zero founder experience -> cannot produce artificially high -----
// --- Founder Evidence -------------------------------------------------------

test("E: a prompt explicitly disclaiming ALL founder/domain experience produces a LOW Founder Evidence score, not an inflated one", () => {
  const refreshed = runFullPipeline(CRITICAL_FOUNDER_BLOCKER_PROMPT, strongEvidenceSet());
  const founderEvidenceDimension = refreshed.investmentScore.decisionEngine.founderScore.dimensionScores.find(
    (dimension) => dimension.key === "founderEvidence"
  );
  assert.ok(founderEvidenceDimension.score < 20, `expected a low Founder Evidence score, got ${founderEvidenceDimension.score}`);
});

test("E (de-collapse proof): Founder Evidence and Evidence Confidence are independently computed -- a founder-inexperience disclosure drags down ONLY Founder Evidence", () => {
  const refreshed = runFullPipeline(CRITICAL_FOUNDER_BLOCKER_PROMPT, strongEvidenceSet());
  const dims = refreshed.investmentScore.decisionEngine.founderScore.dimensionScores;
  const founderEvidence = dims.find((d) => d.key === "founderEvidence").score;
  const evidenceConfidence = dims.find((d) => d.key === "evidenceConfidence").score;
  const executionComplexity = dims.find((d) => d.key === "executionComplexity").score;
  assert.notEqual(founderEvidence, evidenceConfidence);
  // Execution Complexity remains its own, separately-computed
  // dimension -- never collapsed with either of the above.
  assert.notEqual(founderEvidence, executionComplexity);
  assert.match(investmentScoreSource, /\{ key: "evidenceConfidence", label: "Evidence Confidence", score: roundScore\(evidenceConfidenceScore \* 100\) \}/);
  assert.match(investmentScoreSource, /\{ key: "founderEvidence", label: "Founder Evidence", score: roundScore\(founderEvidenceScore \* 100\) \}/);
  assert.match(investmentScoreSource, /\{ key: "executionComplexity", label: "Execution Readiness", score: roundScore\(executionComplexityScore \* 100\) \}/);
});

// --- F: large TAM + poor business economics -> MUST NOT ENTER solely ----
// --- from market attractiveness ---------------------------------------------

test("F: a large, growing TAM attached to a structurally poor business (thin margins, no differentiation, no evidence) must not reach GO", () => {
  const refreshed = runFullPipeline(LARGE_TAM_BAD_BUSINESS_PROMPT, []);
  assert.notEqual(refreshed.investmentScore.recommendation, "GO");
});

// --- G: high aggregate score + critical unresolved blocker -> blocker ---
// --- wins (direct, deterministic unit proof of the override itself) -------

test("G: applyFatalBlockerOverride deterministically converts a would-be GO into WAIT whenever a fatal blocker exists -- direct unit proof, independent of prompt-heuristic noise", () => {
  const cleanDimensions = [
    { key: "ideaQuality", label: "Idea Quality", score: 90 },
    { key: "marketAttractiveness", label: "Market Attractiveness", score: 90 },
    { key: "businessModelQuality", label: "Business Model Quality", score: 90 },
    { key: "validationConfidence", label: "Validation Confidence", score: 90 },
    { key: "executionComplexity", label: "Execution Readiness", score: 90 },
    { key: "evidenceConfidence", label: "Evidence Confidence", score: 90 },
    { key: "founderEvidence", label: "Founder Evidence", score: 12 },
  ];
  const wouldBeGo = createRecommendation(85, 80);
  assert.equal(wouldBeGo, "GO", "sanity: these inputs alone must clear the aggregate GO threshold");
  const blockers = detectFatalBlockers(cleanDimensions);
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].key, "founderEvidence");
  assert.equal(applyFatalBlockerOverride(wouldBeGo, blockers), "WAIT");
  // The override never touches an already-WAIT/PASS result, and never
  // fires when no blocker exists.
  assert.equal(applyFatalBlockerOverride("WAIT", blockers), "WAIT");
  assert.equal(applyFatalBlockerOverride("PASS", blockers), "PASS");
  assert.equal(applyFatalBlockerOverride("GO", []), "GO");
});

// --- H: assumptions are not validation evidence --------------------------

test("H: a stated financial PROJECTION (not a real, current figure) does not count as validation evidence, in either the financial-model.ts or investment-score.ts extraction path", () => {
  assert.match(financialModelSource, /function hasNearbyProjectionQualifier\(/);
  assert.match(investmentScoreSource, /projectedEvidenceClaimPattern/);
  const refreshed = runFullPipeline(UNSUPPORTED_PROJECTION_PROMPT, []);
  // The canonical customer-demand assumption must not be silently
  // marked Validated purely because a projected ARR figure was stated.
  const customerDemand = refreshed.validationIntelligenceV2.assumptions.find((a) => a.id === "customer-demand");
  assert.notEqual(customerDemand.evidenceStatus, "Validated");
});

// --- I: missing evidence cannot increase confidence -----------------------

test("I: removing all real evidence from an otherwise-identical prompt never increases confidence", () => {
  const withEvidence = runFullPipeline(STRONG_LOGISTICS_PROMPT_FOR_GO, strongEvidenceSet());
  const withoutEvidence = runFullPipeline(STRONG_LOGISTICS_PROMPT_FOR_GO, []);
  assert.ok(withoutEvidence.investmentScore.confidence <= withEvidence.investmentScore.confidence);
});

// --- Decision provenance --------------------------------------------------

test("provenance: fatalBlockers is a structured field on InvestmentScore and ReportInvestmentScore -- the reason GO was blocked is reconstructable from data, never generated prose", () => {
  assert.match(investmentScoreSource, /fatalBlockers: FatalBlocker\[\];/);
  assert.match(reportInvestmentScoreSource, /fatalBlockers\?: Array<\{ key: string; label: string; score: number \}>;/);
  const refreshed = runFullPipeline(CRITICAL_FOUNDER_BLOCKER_PROMPT, strongEvidenceSet());
  assert.ok(Array.isArray(refreshed.investmentScore.fatalBlockers));
  assert.ok(refreshed.investmentScore.fatalBlockers.length > 0);
  assert.ok(refreshed.investmentScore.fatalBlockers[0].label);
  assert.equal(typeof refreshed.investmentScore.fatalBlockers[0].score, "number");
});

// --- Fix proof: one authoritative recommendation formula, never --------
// --- duplicated -------------------------------------------------------------

test("fix proof: refreshResearchAwareFinancialContext reuses createRecommendation/applyFatalBlockerOverride directly -- never a second, duplicated threshold check", () => {
  assert.match(financialAssumptionsSource, /createRecommendation\(refreshedTotalScore, context\.investmentScore\.confidence\)/);
  assert.match(financialAssumptionsSource, /applyFatalBlockerOverride\(/);
  assert.doesNotMatch(financialAssumptionsSource, /totalScore >= 72 && confidence >= 60/);
});

test("fix proof: totalScore is recomputed post-research from the SAME refreshed categories, not a second independent total", () => {
  assert.match(
    financialAssumptionsSource,
    /const refreshedTotalScore = Object\.values\(refreshedNarrative\.categories\)\.reduce\(/
  );
});

// --- Requirement 4: preserve valid current behavior -----------------------

test("preserves MONITOR-forcing structure: confidence strictly between 35 and 60 still forces WAIT regardless of totalScore or blockers -- unchanged by this fix", () => {
  assert.equal(createRecommendation(90, 48), "WAIT");
  assert.equal(createRecommendation(10, 48), "WAIT");
  assert.equal(applyFatalBlockerOverride(createRecommendation(90, 48), []), "WAIT");
});

test("preserves the fatal-blocker override as strictly additive: it can only ever downgrade a would-be GO, never change an already-WAIT/PASS recommendation such as the currently-verified real MONITOR report", () => {
  for (const [totalScore, confidence] of [
    [90, 48], [10, 48], [50, 20], [80, 59],
  ]) {
    const base = createRecommendation(totalScore, confidence);
    assert.notEqual(base, "GO", "sanity: these inputs must not already be GO for this test to prove anything");
    const withBlocker = applyFatalBlockerOverride(base, [{ key: "founderEvidence", label: "Founder Evidence", score: 5 }]);
    assert.equal(withBlocker, base, "a blocker must never change an already-non-GO recommendation");
  }
});

// --- Preserve prior fixes --------------------------------------------------

test("preserves canonical evidence gaps, Benchmark Intelligence parity, competitor intelligence, and admin PDF entitlement: none of those files carry a #69A-27 marker", () => {
  for (const source of [benchmarkPanelSource, competitorStateSource, pdfExportRouteSource]) {
    assert.doesNotMatch(source, /#69A-27/);
  }
});

test("[UPDATED BY #69A-27B] preserves decisionConfidence.ts unchanged, and confirms market-research-coverage.ts's only later touch is the distinct, separately-ticketed #69A-27B fix -- #69A-27's OWN fixes were scoped to investment-score.ts, financial-model.ts, and financial-assumptions.ts only", () => {
  // TASK #69A-27B legitimately added a fix to market-research-coverage.ts
  // (the "Founder evidence" reasoning-line preservation fix, unrelated to
  // any of #69A-27's own 3 fixes) -- a real, later, separately-ticketed
  // change, not a #69A-27 regression. The bare /#69A-27/ regex this test
  // used to run also matches "#69A-27A"/"#69A-27B" as substrings, so it
  // is narrowed here to exclude those distinct ticket numbers rather than
  // asserting a now-false claim about this file.
  assert.doesNotMatch(decisionConfidenceSource, /#69A-27(?![A-Z])/);
  assert.doesNotMatch(marketResearchCoverageSource, /#69A-27(?![A-Z])/);
});

test("preserves #69A-25 performance fixes: Planner.tsx's #69A-25 markers are untouched", () => {
  assert.match(plannerSource, /#69A-25/);
});

test("no security weakening: no service-role client or auth bypass introduced by these fixes", () => {
  for (const source of [investmentScoreSource, financialModelSource, financialAssumptionsSource]) {
    assert.doesNotMatch(source, /createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
  }
});
