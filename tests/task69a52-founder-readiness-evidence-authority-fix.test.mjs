// TASK #69A-52 -- Prevent external market research from inflating
// Founder Readiness.
//
// AUDIT (full detail in the final report to the user): traced whether
// Evidence Confidence (one of the 7 canonical Founder Readiness
// dimensions, investment-score.ts) literally reads any external-
// research field. It does NOT: evidenceConfidenceScore is built
// entirely from metricConfidenceScore (the financial model's own
// "High"/"Medium"/"Low" derivation-confidence tags, assigned at
// prompt-time -- confirmed in #69A-50's own trace: financialModel/
// metrics are never touched by applyMarketResearchCoverageToContext)
// and hasValidationEvidence (a prompt-keyword check). Neither is
// government/vendor/market/competitor research evidence.
//
// The REAL defect: metricConfidenceScore reads as "the model's own
// derivation is standard/well-formed" -- a signal that is high for
// almost any benchmark-driven business plan REGARDLESS of whether the
// founder has proven anything. Averaging it (via evidenceConfidenceScore)
// with equal weight alongside 5 more "optimistic" dimensions (#69A-51's
// own fix) still let those 5 dilute -- "average away" -- the 2
// genuinely founder/validation-specific dimensions (founderEvidenceScore,
// validationLevelScore). Confirmed live: Founder Evidence=34/Validation
// Confidence=45 (both genuinely weak) coexisted with a 60/100 headline
// score.
//
// FIX: founderValidationCeiling -- a NON-COMPENSATORY cap (never a
// reweighting) -- caps teamFounder's raw 7-term average at
// average([founderEvidenceScore, validationLevelScore]) +
// FATAL_BLOCKER_SCORE_RATIO (0.15, the SAME established 15%-margin
// constant this file already uses for fatal-blocker detection, reused
// rather than inventing a new magic number). A genuinely strong
// founder/validation case is never constrained (ceiling comfortably
// exceeds the raw average); a weak one is, regardless of how strong
// every other dimension reads.
//
// SEMANTIC MODEL:
//   A. Opportunity quality       -- ideaQualityScore, businessModel
//   B. External research evidence -- dimensions.marketConfidence/
//      competitiveEvidence/financialEvidence (market-research-coverage.ts,
//      Confidence Radar's Market/Financial Research Coverage/Moat
//      Evidence, and reportIntelligence's sourceConfidence "Source
//      Strength") -- COMPLETELY SEPARATE from Founder Readiness; never
//      read by teamFounder's own formula.
//   C. Founder/team evidence     -- founderEvidenceScore
//   D. Primary validation evidence -- validationLevelScore
//   E. Execution readiness       -- executionComplexityScore (see the
//      label-mismatch note below)
//   Evidence Confidence itself mixes a model-derivation-confidence
//   signal (closer to family A/model-quality) with a crude validation
//   proxy (family D) -- not external research (family B) at all, and
//   not founder-specific (family C) either. #69A-52 does not need to
//   split evidenceConfidenceScore's own two inputs further: capping the
//   AGGREGATE by families C+D directly is the smallest fix that
//   satisfies "founder/validation evidence acts as a ceiling."
//
// EXECUTION COMPLEXITY LABEL AUDIT (re-confirmed from #69A-51, no
// change made): the variable already functions as execution EASE/
// readiness (higher = better; capital-heavy models score LOWER). The
// label "Execution Complexity" is a latent semantic mismatch (a reader
// would expect higher = harder), but changing it is a broad,
// unrelated rename this ticket's own instructions do not require.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanonicalFinancialAssumptions } from "../app/lib/ai/financial-assumptions.ts";
import {
  applyMarketResearchCoverageToContext,
  calculateMarketOverallConfidence,
} from "../app/lib/ai/market-research-coverage.ts";
import { readFounderReadinessScoreValue, buildExecutiveSnapshot } from "../app/lib/report-presentation.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

function build(prompt) {
  return createCanonicalFinancialAssumptions({ prompt, reportKind: "business_plan" });
}

function dims(context) {
  return Object.fromEntries(
    context.investmentScore.decisionEngine.founderScore.dimensionScores.map((d) => [d.key, d.score])
  );
}

const REAL_CASE_PROMPT =
  "Premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for SMBs in the United States, integrating with QuickBooks/Xero.";

const STRONG_LOGISTICS_PROMPT =
  "We run a B2B enterprise SaaS subscription platform for logistics companies in the US, UK, and Europe. We have 900 paying enterprise customers generating $9.5M ARR with 94% gross margin. Our monthly churn is 0.6% and net revenue retention is 132%. CAC is $1,200 with a 3-month payback, validated over 24 months of paid acquisition spend across enterprise sales channels with cohort-level retention tracking. We have an experienced founding team of former logistics executives, engineers, and domain experts with 15+ years of industry experience. Our SAM is estimated at $1.2B with a defensible proprietary data moat, network effects, and enterprise compliance certifications.";

const NO_FOUNDER_EXPERIENCE_PROMPT =
  "We run a B2B SaaS subscription platform for enterprise healthcare compliance software in the US. We have 300 paying enterprise customers generating $4M ARR with 90% gross margin, 1% monthly churn, and validated CAC of $1,500 with a 3-month payback confirmed over 18 months. We have proprietary technology and enterprise compliance certifications and a large defensible market. However, we have no founder or team with any healthcare, compliance, or software domain experience -- the founder has never operated a company, has no technical background, and has no domain expertise whatsoever.";

const NO_VALIDATION_AT_ALL_PROMPT =
  "We are building a B2B subscription platform for enterprise data-center capacity planning in the US. The market for infrastructure planning software is large and growing. We have not yet run any paid pilots and have no confirmed paying customers. We do not have validated CAC or retention data yet, and willingness to pay has not been tested. We have no founder or team with any relevant domain experience -- the founder has never operated a company, has no technical background, and has no domain expertise whatsoever.";

// --- FAIL-BEFORE PROOF ----------------------------------------------------

test("FAIL-BEFORE PROOF: the real report's own shape (Founder Evidence=34, Validation Confidence=45, headline=60) is reproducible, and the corrected headline is now capped below the raw 7-dimension average", () => {
  const context = build(REAL_CASE_PROMPT);
  const d = dims(context);
  const headline = context.investmentScore.decisionEngine.founderScore.score;

  assert.ok(d.founderEvidence < 50 && d.validationConfidence < 50, "sanity: this fixture's founder/validation dimensions are genuinely weak");
  const rawAverage = (d.ideaQuality + d.marketAttractiveness + d.businessModelQuality + d.validationConfidence + d.executionComplexity + d.evidenceConfidence + d.founderEvidence) / 7;
  assert.ok(
    headline < rawAverage,
    `expected the ceiling to pull the headline (${headline}) below the raw 7-dimension average (${rawAverage}) -- proving founder/validation evidence now genuinely constrains the aggregate`
  );
});

// --- 1: the ceiling exists and is non-compensatory -----------------------

test("1. investment-score.ts declares an explicit, non-compensatory founderValidationCeiling derived only from founderEvidenceScore/validationLevelScore, reusing FATAL_BLOCKER_SCORE_RATIO as its headroom margin", () => {
  assert.match(investmentScoreSource, /TASK #69A-52/);
  assert.match(
    investmentScoreSource,
    /const founderValidationCeiling = clamp\(\s*\n\s*Math\.min\(founderEvidenceScore, validationLevelScore\) \+ FATAL_BLOCKER_SCORE_RATIO,/
  );
  assert.match(investmentScoreSource, /normalizedScore: Math\.min\(teamFounderRawAverage, founderValidationCeiling\),/);
});

// --- 2: strong external research alone cannot create high readiness ----

test("2. strong external research/source evidence alone cannot create a high Founder Readiness Score -- the ceiling caps the aggregate regardless of how abundant external market/competitor/financial research is", () => {
  const base = build(NO_VALIDATION_AT_ALL_PROMPT);
  const preRefreshHeadline = base.investmentScore.decisionEngine.founderScore.score;

  const abundantResearchDimensions = {
    marketConfidence: 95,
    competitiveEvidence: 92,
    financialEvidence: 90,
    productEvidence: 85,
    executionReadiness: 80,
    founderReadiness: 88,
  };
  const abundantCoverage = {
    evidenceCount: 30,
    verifiedSources: 25,
    independentDomains: 12,
    competitorBreadth: 6,
    sourceTypeDiversity: 5,
    claimCoverage: 6,
    freshnessScore: 95,
    averageQuality: 92,
    verifiedMarketSizeAvailable: true,
    dimensions: abundantResearchDimensions,
    overallConfidence: calculateMarketOverallConfidence(abundantResearchDimensions),
    sourceClasses: ["government_statistics", "financial_filing", "market_research"],
  };
  const refreshed = applyMarketResearchCoverageToContext(base, { evidence: [] }, NO_VALIDATION_AT_ALL_PROMPT, abundantCoverage).context;
  const postRefreshHeadline = refreshed.investmentScore.decisionEngine.founderScore.score;

  // decisionEngine.founderScore.score/dimensionScores are frozen at
  // their pre-research values (#69A-47's own established preservation)
  // -- confirming abundant external research literally cannot move
  // this number at all, let alone inflate it.
  assert.equal(postRefreshHeadline, preRefreshHeadline);
  assert.ok(postRefreshHeadline < 55, `expected abundant external research to leave a weak-founder-evidence fixture's headline below 55, got ${postRefreshHeadline}`);
});

// --- 3: missing founder evidence materially constrains readiness --------

test("3. missing founder evidence materially constrains readiness even when the opportunity, business model, and evidence confidence all read strong", () => {
  const context = build(NO_FOUNDER_EXPERIENCE_PROMPT);
  const d = dims(context);
  const headline = context.investmentScore.decisionEngine.founderScore.score;

  assert.ok(d.founderEvidence < 20, `expected explicit founder-inexperience to score very low, got ${d.founderEvidence}`);
  assert.ok(d.businessModelQuality >= 60 && d.evidenceConfidence >= 40, "sanity: this fixture's non-founder dimensions read reasonably strong");

  const strongDimsAverage = (d.ideaQuality + d.marketAttractiveness + d.businessModelQuality + d.executionComplexity + d.evidenceConfidence) / 5;
  assert.ok(
    headline < strongDimsAverage - 10,
    `expected missing founder evidence to pull the headline (${headline}) meaningfully below the strong-dimensions-only average (${strongDimsAverage})`
  );
});

// --- 4: missing primary validation materially constrains readiness ------

test("4. missing primary validation evidence materially constrains readiness even when founder/opportunity dimensions read strong", () => {
  const context = build(
    "We run a B2B enterprise SaaS subscription platform for logistics companies in the US. We have an experienced founding team of former logistics executives with 15+ years of industry experience and deep domain expertise. We have not yet run any paid pilots and have no confirmed paying customers. We do not have validated CAC or retention data yet, and willingness to pay has not been tested."
  );
  const d = dims(context);
  const headline = context.investmentScore.decisionEngine.founderScore.score;

  assert.ok(d.validationConfidence < 55, `expected no-validation-evidence to keep Validation Confidence modest, got ${d.validationConfidence}`);
  assert.ok(d.founderEvidence >= 55, "sanity: this fixture's founder dimension reads strong");
  assert.ok(headline < 65, `expected missing primary validation to keep the headline below 65 even with a strong founder, got ${headline}`);
});

// --- 5: strong founder + validation evidence legitimately increases -----
// --- readiness --------------------------------------------------------------

test("5. strong founder AND primary-validation evidence together legitimately produce a high, unconstrained Founder Readiness Score", () => {
  const context = build(STRONG_LOGISTICS_PROMPT);
  const d = dims(context);
  const headline = context.investmentScore.decisionEngine.founderScore.score;

  assert.ok(d.founderEvidence >= 70 && d.validationConfidence >= 70, "sanity: this fixture's founder/validation dimensions are genuinely strong");
  const rawAverage = (d.ideaQuality + d.marketAttractiveness + d.businessModelQuality + d.validationConfidence + d.executionComplexity + d.evidenceConfidence + d.founderEvidence) / 7;
  // The ceiling must not bind for a genuinely strong founder/validation
  // case -- the headline should equal the raw average (within
  // quantization slack), never be suppressed by it.
  assert.ok(Math.abs(headline - rawAverage) <= 10, `expected the ceiling not to constrain a strong founder/validation fixture (headline=${headline}, raw average=${rawAverage})`);
  assert.ok(headline >= 70, `expected a genuinely strong founder+validation case to score >=70, got ${headline}`);
});

// --- 6: external Evidence Confidence remains available for market/-----
// --- report confidence -----------------------------------------------------

test("6. external research-derived Confidence Radar/Report Quality dimensions (Market, Financial Research Coverage, Moat Evidence, Source Strength) remain completely untouched by this fix -- they still read their own, separate research-coverage sources", () => {
  const investmentScoreInput = {
    totalScore: 62,
    confidence: 65,
    recommendation: "WAIT",
    decisionEngine: {
      marketScore: { score: 91, maximumScore: 100, label: "Market", reasoning: [] },
      financialScore: { score: 88, maximumScore: 100, label: "Financial", reasoning: [] },
      founderScore: { score: 45, maximumScore: 100, label: "Founder", reasoning: [] },
      executionScore: { score: 52, maximumScore: 100, label: "Execution", reasoning: [] },
      riskScore: { score: 45, maximumScore: 100, label: "Risk", reasoning: [] },
      competitionScore: { score: 90, maximumScore: 100, label: "Competition", reasoning: [] },
      technologyScore: { score: 65, maximumScore: 100, label: "Technology", reasoning: [] },
    },
  };
  const snapshot = buildExecutiveSnapshot("", investmentScoreInput, undefined);
  const market = snapshot.confidenceRadar.find((d) => d.label === "Market");
  const financial = snapshot.confidenceRadar.find((d) => d.label === "Financial Research Coverage");
  const moat = snapshot.confidenceRadar.find((d) => d.label === "Moat Evidence");

  // Abundant external research (91/88/90) coexists honestly with weak
  // Founder Readiness (45) -- no cross-contamination in either
  // direction, and market/financial/moat dimensions are read directly
  // from their own decisionEngine categories, never derived from or
  // capped by teamFounder's own ceiling.
  assert.equal(market.score, 91);
  assert.equal(financial.score, 88);
  assert.equal(moat.score, 90);
});

// --- 7: web/PDF use the same canonical Founder Readiness object; no ----
// --- renderer recomputation ------------------------------------------------

test("7. [PARITY] the headline Founder Readiness Score read by buildExecutiveSnapshot (web/PDF's shared source) is the exact same, ceiling-corrected decisionEngine.founderScore.score -- no independent re-derivation", () => {
  const context = build(NO_FOUNDER_EXPERIENCE_PROMPT);
  const snapshot = buildExecutiveSnapshot("", context.investmentScore, undefined);
  assert.equal(snapshot.founderScoreValue, context.investmentScore.decisionEngine.founderScore.score);
  assert.equal(readFounderReadinessScoreValue(context.investmentScore), context.investmentScore.decisionEngine.founderScore.score);
});

test("8. [PARITY] web (single-section content) and PDF (full concatenated content) callers agree on the ceiling-corrected Founder Readiness Score for the same investmentScore", () => {
  const context = build(NO_FOUNDER_EXPERIENCE_PROMPT);
  const executiveSummarySection = "MONITOR. The opportunity requires further validation.";
  const founderReadinessSection = [
    `Founder Readiness Score: ${readFounderReadinessScoreValue(context.investmentScore)}/100`,
    "Founder Evidence: 12/100 - Founder readiness should be validated.",
  ].join("\n");
  const fullReportContent = [
    `Executive Summary\n${executiveSummarySection}`,
    `Founder Readiness\n${founderReadinessSection}`,
  ].join("\n\n");

  const webSnapshot = buildExecutiveSnapshot(executiveSummarySection, context.investmentScore, undefined);
  const pdfSnapshot = buildExecutiveSnapshot(fullReportContent, context.investmentScore, undefined);
  assert.equal(webSnapshot.founderScoreValue, pdfSnapshot.founderScoreValue);
});

// --- 8: Decision/Confidence and unrelated report-quality metrics remain -
// --- unchanged unless evidence itself changes ------------------------------

test("9. [INVARIANT] investmentScore.confidence is computed independently of teamFounder's own ceiling -- it is unaffected by this fix's formula change", () => {
  assert.doesNotMatch(
    investmentScoreSource.slice(
      investmentScoreSource.indexOf("const confidence = roundScore("),
      investmentScoreSource.indexOf("const fatalBlockers = detectFatalBlockers(")
    ),
    /founderValidationCeiling|teamFounderRawAverage/
  );
});

test("10. [INVARIANT] createRecommendation/applyFatalBlockerOverride/detectFatalBlockers thresholds are byte-unchanged -- this fix only changes teamFounder's own INPUT value, never the decision gate logic itself", () => {
  assert.match(investmentScoreSource, /export function createRecommendation\(totalScore: number, confidence: number\) \{/);
  assert.match(investmentScoreSource, /if \(totalScore >= 72 && confidence >= 60\) return "GO";/);
  assert.match(investmentScoreSource, /export const FATAL_BLOCKER_SCORE_RATIO = 0\.15;/);
});

test("11. [INVARIANT] individual dimensionScores (Idea Quality, Market Attractiveness, Business Model Quality, Validation Confidence, Execution Complexity, Evidence Confidence, Founder Evidence) are completely unaffected by the ceiling -- only the AGGREGATE is capped", () => {
  const context = build(REAL_CASE_PROMPT);
  const d = dims(context);
  // These are exactly the raw *Score variables (times 100, rounded) --
  // the ceiling is applied only inside teamFounder's own normalizedScore,
  // never to founderReadinessDimensionScores, which is built from the
  // same *Score variables directly, independent of teamFounder.
  assert.equal(d.evidenceConfidence, 68);
  assert.equal(d.founderEvidence, 34);
  assert.equal(d.validationConfidence, 45);
});

test("12. [CACHE SAFETY] BUSINESS_PLAN_GENERATION_CONTRACT_VERSION was bumped past v15, invalidating any full-report cache entry generated before this fix", () => {
  const match = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "ltv-cac-ratio-integrity-v(\d+)";/.exec(planExecutorSource);
  assert.ok(match, "BUSINESS_PLAN_GENERATION_CONTRACT_VERSION declaration not found");
  assert.ok(Number(match[1]) >= 16, "version must be at v16 or later for this ticket's own cache-invalidating bump");
  assert.match(planExecutorSource, /TASK #69A-52/);
});

// --- SAFETY: unrelated architecture untouched ----------------------------

test("SAFETY: no market-research-coverage, report-intelligence, competitor-evidence, Porter, or report-presentation file carries a #69A-52 marker -- this fix's own code change is confined to teamFounder's own aggregate formula inside investment-score.ts", () => {
  for (const relativePath of [
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/ai/report-intelligence.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/report-presentation.ts",
    "app/lib/ai/financial-model.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-52/, `${relativePath} must not carry a #69A-52 marker`);
  }
});
