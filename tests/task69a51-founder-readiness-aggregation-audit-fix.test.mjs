// TASK #69A-51 -- Audit Founder Readiness aggregation and prevent
// low-evidence readiness inflation.
//
// TRACE (full detail in the final report to the user): the headline
// "Founder Readiness Score" (decisionEngine.founderScore.score,
// investment-score.ts's createInvestmentScore) is
// round(teamFounder.normalizedScore * 100), where teamFounder is one of
// 8 top-level decisionEngine categories. The 7 DISPLAYED Founder
// Readiness dimensions (founderReadinessDimensionScores, same file) are:
// Idea Quality/Market Attractiveness (both = ideaQualityScore),
// Business Model Quality (= businessModel.score/businessModel.
// maximumScore, a SEPARATE top-level category), Validation Confidence
// (= validationLevelScore), Execution Complexity (= executionComplexityScore),
// Evidence Confidence (= evidenceConfidenceScore), Founder Evidence
// (= founderEvidenceScore).
//
// TWO REAL DEFECTS FOUND AND FIXED:
//
// DEFECT 1 (the ticket's own named concern) -- teamFounder's own
// normalizedScore average used to be:
//   average([ideaQualityScore, ideaQualityScore, validationLevelScore,
//     founderEvidenceScore, executionComplexityScore,
//     Math.max(metricConfidenceScore, 0.55)])
// Two of the 7 DISPLAYED dimensions -- Business Model Quality and
// Evidence Confidence -- had ZERO weight in this average, even though
// the category's OWN reasoning text already described both as part of
// "Founder readiness." In their place sat a 6th term, never displayed
// as any Founder Readiness dimension at all, ARTIFICIALLY FLOORED at
// 55% (Math.max(metricConfidenceScore, 0.55)) -- so real metric
// confidence could never pull the aggregate down, no matter how weak
// it actually was. Net effect: "Evidence Confidence" (how much genuine
// evidence backs this analysis) had NO influence on the headline score
// a reader sees directly above it.
//
// FIX: the average now uses exactly the same 7 sub-signals already
// displayed as this report's own Founder Readiness dimensions (idea
// Quality counted twice because it legitimately backs two displayed
// dimensions, #69A-17's own established, unchanged design) -- no hidden,
// undisplayed, artificially-floored term remains.
//
// DEFECT 2 (found while auditing DEFECT 1's own fix for correctness) --
// evidenceConfidenceScore's own formula divided metricConfidenceScore by
// 100, even though metricConfidenceScore is ALREADY a normalizeHigherBetter
// result (a 0-1 fraction, exactly like every other *Score variable in
// this file) -- a unit-conversion bug that crushed a genuinely strong
// metric-confidence signal (e.g. 1.0, every financial metric at "High"
// derivation confidence) down to 0.01 before averaging. This bug predates
// #69A-51 (from #69A-27) and was invisible while evidenceConfidenceScore
// had zero weight in the aggregate (DEFECT 1) -- fixing DEFECT 1 is what
// surfaced DEFECT 2's real impact, and DEFECT 2 had to be fixed for
// DEFECT 1's own fix to behave correctly (a genuinely well-evidenced
// report must not have its Evidence Confidence artificially crushed).
//
// EXECUTION COMPLEXITY DIRECTIONALITY (audited, no bug found):
// executionComplexityScore = capitalHeavy ? 0.42 : d2cFoodOrFmcg ? 0.5 : 0.66
// -- despite its "complexity" name, the variable already functions as an
// EXECUTION-EASE/READINESS score (higher = easier/more ready to execute;
// capital-heavy/high-risk models score LOWER, not higher). It is already
// correctly added POSITIVELY into the readiness average -- no inversion
// needed. The variable/label name is a latent (pre-existing, out of this
// ticket's minimal-fix scope) source of confusion, documented below, but
// not a mathematical directionality bug.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanonicalFinancialAssumptions } from "../app/lib/ai/financial-assumptions.ts";
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

// --- FAIL-BEFORE PROOF: the old, buggy formula structurally excluded ----
// --- two displayed dimensions and included a hidden, floored one --------
//
// TASK #69A-56 -- ROOT CAUSE of a post-commit test failure (not a
// production regression): both proofs below originally fetched "the
// pre-fix source" via `git show HEAD:app/lib/ai/investment-score.ts`.
// That was only ever true while the #69A-51 fix sat uncommitted in the
// working tree; once it was packaged into a real commit (#69A-56),
// HEAD became the FIXED state, so the proofs' own "HEAD must genuinely
// predate the fix" precondition started failing -- correctly, since its
// premise was no longer true, not because the shipped fix regressed.
// This repo already established the fix for this exact anti-pattern
// once before (see 9c0b0cf's own "test(pdf): make export regression
// tests independent of git HEAD"): never re-derive "the pre-fix state"
// from git history/HEAD/any commit position. These two literals are the
// exact, byte-verified pre-#69A-51 formulas (confirmed against this
// repo's own pre-session baseline commit, 9c0b0cf) frozen here as fixed
// historical references -- they never change and never need to change,
// regardless of any future rebase, squash, or commit reordering.
const HISTORICAL_PRE_69A51_TEAM_FOUNDER_SNIPPET = `
  const teamFounder = makeCategory({
    key: "teamFounder",
    label: "Team / Founder",
    normalizedScore: average([
      ideaQualityScore,
      ideaQualityScore,
      validationLevelScore,
      founderEvidenceScore,
      executionComplexityScore,
      Math.max(metricConfidenceScore, 0.55),
    ]),
`;
const HISTORICAL_PRE_69A51_EVIDENCE_CONFIDENCE_LINE = "      metricConfidenceScore / 100,";

test("FAIL-BEFORE PROOF: the historical (pre-#69A-51) teamFounder formula excluded Business Model Quality and Evidence Confidence entirely and included a 6th term, never displayed as any Founder Readiness dimension, artificially floored at 55%", () => {
  // The bug, proven to have existed historically: businessModel/
  // evidenceConfidenceScore were absent from the average, replaced by a
  // hidden, floored term.
  assert.doesNotMatch(HISTORICAL_PRE_69A51_TEAM_FOUNDER_SNIPPET, /businessModel\.score \/ businessModel\.maximumScore/);
  assert.doesNotMatch(HISTORICAL_PRE_69A51_TEAM_FOUNDER_SNIPPET, /evidenceConfidenceScore,/);
  assert.match(HISTORICAL_PRE_69A51_TEAM_FOUNDER_SNIPPET, /Math\.max\(metricConfidenceScore, 0\.55\)/);

  // The fix, proven to be in place now: all 7 displayed dimensions are
  // averaged, with no hidden/floored term remaining. [UPDATED BY #69A-52]
  // the 7-term average now lives in teamFounderRawAverage, computed just
  // above teamFounder's own makeCategory call (which applies #69A-52's
  // own non-compensatory ceiling on top of it) -- see that ticket's own
  // test file for the ceiling's own dedicated coverage.
  const currentSnippet = investmentScoreSource.slice(
    investmentScoreSource.indexOf("const teamFounderRawAverage = average(["),
    investmentScoreSource.indexOf("const teamFounder = makeCategory({")
  );
  assert.match(currentSnippet, /businessModel\.score \/ businessModel\.maximumScore,/);
  assert.match(currentSnippet, /evidenceConfidenceScore,/);
  assert.doesNotMatch(currentSnippet, /Math\.max\(metricConfidenceScore/);
});

test("FAIL-BEFORE PROOF (unit bug): the historical (pre-#69A-51) evidenceConfidenceScore formula divided metricConfidenceScore -- already a 0-1 fraction -- by 100 a second time", () => {
  assert.match(HISTORICAL_PRE_69A51_EVIDENCE_CONFIDENCE_LINE, /metricConfidenceScore \/ 100,/);
  assert.doesNotMatch(investmentScoreSource, /metricConfidenceScore \/ 100,/);
});

// --- 1: current calculation includes exactly the 7 displayed dimensions -

test("1. the corrected Founder Readiness aggregate is at most the plain average of all 7 displayed dimension RAW scores (before rounding) -- confirming no hidden, undisplayed term inflates it above that average, though #69A-52's own non-compensatory ceiling may legitimately pull it BELOW that average when founder/validation evidence is weak", () => {
  const context = build(REAL_CASE_PROMPT);
  const d = dims(context);
  const plainAverage = Math.round(
    ((d.ideaQuality + d.marketAttractiveness + d.businessModelQuality + d.validationConfidence + d.executionComplexity + d.evidenceConfidence + d.founderEvidence) /
      7 /
      100) *
      10
  ) * 10;
  const actual = context.investmentScore.decisionEngine.founderScore.score;
  // [UPDATED BY #69A-52] previously asserted a tight +-10 symmetric
  // band around the plain average; #69A-52's own ceiling can now
  // legitimately pull the aggregate further below the plain average
  // for a weak-founder-evidence fixture like this one, so only the
  // upper bound (never inflated ABOVE the plain average, plus the same
  // +-10 quantization slack) is still asserted here.
  assert.ok(actual <= plainAverage + 10, `expected ${actual} to never exceed the plain 7-dimension average (${plainAverage}) by more than quantization slack`);
});

test("2. investment-score.ts's teamFounder construction carries an explicit #69A-51 marker and averages exactly 7 terms including businessModel and evidenceConfidenceScore", () => {
  assert.match(investmentScoreSource, /TASK #69A-51/);
  // [UPDATED BY #69A-52] the 7-term average now lives in
  // teamFounderRawAverage, computed just above teamFounder's own
  // makeCategory call.
  const teamFounderSnippet = investmentScoreSource.slice(
    investmentScoreSource.indexOf("const teamFounderRawAverage = average(["),
    investmentScoreSource.indexOf("const teamFounder = makeCategory({")
  );
  assert.match(teamFounderSnippet, /ideaQualityScore,\s*\n\s*ideaQualityScore,/);
  assert.match(teamFounderSnippet, /businessModel\.score \/ businessModel\.maximumScore,/);
  assert.match(teamFounderSnippet, /validationLevelScore,/);
  assert.match(teamFounderSnippet, /executionComplexityScore,/);
  assert.match(teamFounderSnippet, /evidenceConfidenceScore,/);
  assert.match(teamFounderSnippet, /founderEvidenceScore,/);
  assert.doesNotMatch(teamFounderSnippet, /Math\.max\(metricConfidenceScore/);
});

test("3. evidenceConfidenceScore no longer divides metricConfidenceScore by 100 -- it is used directly as the 0-1 fraction it already is", () => {
  assert.doesNotMatch(investmentScoreSource, /metricConfidenceScore \/ 100/);
  const snippet = investmentScoreSource.slice(
    investmentScoreSource.indexOf("const evidenceConfidenceScore = clamp("),
    investmentScoreSource.indexOf("const executionComplexityScore =")
  );
  assert.match(snippet, /average\(\[\s*\n\s*metricConfidenceScore,/);
});

// --- 2: low-evidence inflation cases -------------------------------------

test("A. strong idea/market/model but weak founder evidence and no validation evidence: Founder Readiness must not read as strong or misleadingly optimistic", () => {
  const context = build(NO_FOUNDER_EXPERIENCE_PROMPT);
  const d = dims(context);
  const score = context.investmentScore.decisionEngine.founderScore.score;

  // Sanity: this fixture's own opportunity-shaped dimensions ARE
  // genuinely strong (validated CAC/payback/customers feed
  // validationLevelScore/businessModelQuality), while founder-specific
  // evidence is explicitly, catastrophically weak.
  assert.ok(d.founderEvidence < 20, `expected explicit founder-inexperience to score very low, got ${d.founderEvidence}`);

  // The aggregate must be pulled meaningfully below what a naive average
  // of ONLY the strong dimensions would produce -- i.e. the weak founder
  // dimension must have real, visible leverage on the headline score.
  const strongDimsOnlyAverage = (d.ideaQuality + d.marketAttractiveness + d.businessModelQuality + d.validationConfidence + d.executionComplexity) / 5;
  assert.ok(
    score < strongDimsOnlyAverage,
    `expected the headline score (${score}) to be pulled below the strong-dimensions-only average (${strongDimsOnlyAverage}) by weak founder evidence`
  );
  // Also confirmed by the existing, unrelated fatal-blocker gate: this
  // is exactly the shape detectFatalBlockers (#69A-27) already exists to
  // catch, independent of this ticket's own averaging fix.
  assert.ok(context.investmentScore.fatalBlockers.length > 0 || d.founderEvidence < 15, "a catastrophic founder-evidence dimension must be flagged");
});

test("B/C. no founder domain experience AND no customer/CAC/retention validation at all: Founder Readiness must not present a misleadingly optimistic score", () => {
  const context = build(NO_VALIDATION_AT_ALL_PROMPT);
  const d = dims(context);
  const score = context.investmentScore.decisionEngine.founderScore.score;

  assert.ok(d.founderEvidence < 20, `expected explicit founder-inexperience to score very low, got ${d.founderEvidence}`);
  assert.ok(d.validationConfidence < 55, `expected no-validation-evidence to keep Validation Confidence modest, got ${d.validationConfidence}`);

  // The headline score must never round-trip back up to a "strong"
  // reading (arbitrarily defined here as >= 65, the report's own
  // existing Moderate/High confidence threshold family) when both
  // founder-specific dimensions this fixture deliberately zeroes out
  // are this weak.
  assert.ok(score < 65, `expected a low-founder-evidence, no-validation fixture to score below 65, got ${score}`);
});

test("D. strong evidence case (all evidence-related dimensions 70+): Founder Readiness legitimately reads high -- proving the fix does not punish genuinely well-evidenced reports", () => {
  const context = build(STRONG_LOGISTICS_PROMPT);
  const d = dims(context);
  const score = context.investmentScore.decisionEngine.founderScore.score;

  assert.ok(d.evidenceConfidence >= 70, `expected genuinely strong metric confidence + validation evidence to read >=70, got ${d.evidenceConfidence}`);
  assert.ok(d.founderEvidence >= 70, `expected an experienced, domain-expert founding team to read >=70, got ${d.founderEvidence}`);
  assert.ok(d.validationConfidence >= 70, `expected 24 months of validated paid acquisition to read >=70, got ${d.validationConfidence}`);
  assert.ok(score >= 65, `expected a genuinely well-evidenced fixture to score a legitimately high Founder Readiness Score, got ${score}`);
});

// --- 3: Execution Complexity directionality ------------------------------

test("4. [DIRECTIONALITY] executionComplexityScore functions as execution EASE/readiness (higher = better) -- a capital-heavy business scores LOWER than a non-capital-heavy one, confirming it is already correctly added POSITIVELY into the readiness average, no inversion needed", () => {
  const capitalHeavyContext = build(
    "We run a battery manufacturing factory business producing EV batteries for automotive OEMs in the US."
  );
  const ordinaryContext = build(
    "We run a B2B SaaS subscription platform for supply chain analytics in the US."
  );

  const capitalHeavyExecution = dims(capitalHeavyContext).executionComplexity;
  const ordinaryExecution = dims(ordinaryContext).executionComplexity;

  assert.ok(
    capitalHeavyExecution < ordinaryExecution,
    `expected a capital-heavy (harder-to-execute) business to score LOWER on the Execution Complexity dimension (${capitalHeavyExecution}) than an ordinary SaaS business (${ordinaryExecution}) -- confirming the underlying variable already means "execution ease," not "execution difficulty," and is correctly added positively into Founder Readiness`
  );
});

// --- 5: introduced fix stays minimal, other architecture untouched ------

test("SAFETY: no canonical decision (createRecommendation/applyFatalBlockerOverride), Report Quality, Data Completeness, Source Strength, Financial Consistency, Benchmark Fit, Validation Readiness, competitor-evidence, Porter, or TAM/SAM/SOM file carries a #69A-51 marker -- this fix's own code changes are confined to teamFounder's own aggregate formula and evidenceConfidenceScore's unit-conversion bug, both inside investment-score.ts (plan-executor.ts legitimately carries a marker too, but ONLY for its own cache-invalidating version-bump comment -- see test 10 below)", () => {
  for (const relativePath of [
    "app/lib/ai/report-intelligence.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/report-presentation.ts",
    "app/lib/ai/financial-model.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-51/, `${relativePath} must not carry a #69A-51 marker`);
  }
});

test("SAFETY: plan-executor.ts's own #69A-51 marker is confined to the cache-invalidation version bump (mirroring #69A-40A/#69A-41/#69A-43's identical precedent) -- it never touches decisionEngine/totalScore/recommendation logic", () => {
  // [UPDATED BY #69A-52, again by #69A-54] widened from 800, then 2000:
  // each later ticket's own explanatory comment is appended between
  // #69A-51's comment and the constant declaration, pushing it further
  // away -- same "widen when needed" precedent this exact mechanism has
  // followed since #69A-43.
  const markerContext = planExecutorSource.slice(
    planExecutorSource.indexOf("TASK #69A-51"),
    planExecutorSource.indexOf("TASK #69A-51") + 3200
  );
  assert.match(markerContext, /BUSINESS_PLAN_GENERATION_CONTRACT_VERSION/);
  const markerCount = (planExecutorSource.match(/TASK #69A-51/g) || []).length;
  assert.equal(markerCount, 1, "expected exactly one #69A-51 marker in plan-executor.ts, confined to the version-bump comment");
});

test("SAFETY: createRecommendation/applyFatalBlockerOverride/detectFatalBlockers logic itself is byte-unchanged -- this fix only changes the INPUT (teamFounder.score, via its own corrected average), never the decision thresholds or gate logic", () => {
  assert.match(investmentScoreSource, /export function createRecommendation\(totalScore: number, confidence: number\) \{/);
  assert.match(investmentScoreSource, /export const FATAL_BLOCKER_SCORE_RATIO = 0\.15;/);
});

// --- 7: all renderers use the same canonical Founder Readiness value ----

test("6. [PARITY] the headline Founder Readiness Score read by buildExecutiveSnapshot (web/PDF's shared source) is the exact same decisionEngine.founderScore.score this fix corrects -- no independent re-derivation", () => {
  const context = build(NO_VALIDATION_AT_ALL_PROMPT);
  const snapshot = buildExecutiveSnapshot("", context.investmentScore, undefined);
  assert.equal(snapshot.founderScoreValue, context.investmentScore.decisionEngine.founderScore.score);
  assert.equal(readFounderReadinessScoreValue(context.investmentScore), context.investmentScore.decisionEngine.founderScore.score);
});

test("7. [PARITY] web (single-section content) and PDF (full concatenated content) callers agree on the corrected Founder Readiness Score for the same investmentScore", () => {
  const context = build(NO_VALIDATION_AT_ALL_PROMPT);
  const executiveSummarySection = "MONITOR. The opportunity requires further validation.";
  const founderReadinessSection = [
    `Founder Readiness Score: ${readFounderReadinessScoreValue(context.investmentScore)}/100`,
    "Evidence Confidence: 18/100 - Evidence remains directional.",
  ].join("\n");
  const fullReportContent = [
    `Executive Summary\n${executiveSummarySection}`,
    `Founder Readiness\n${founderReadinessSection}`,
  ].join("\n\n");

  const webSnapshot = buildExecutiveSnapshot(executiveSummarySection, context.investmentScore, undefined);
  const pdfSnapshot = buildExecutiveSnapshot(fullReportContent, context.investmentScore, undefined);
  assert.equal(webSnapshot.founderScoreValue, pdfSnapshot.founderScoreValue);
});

// --- persisted/reloaded consistency --------------------------------------

test("8. [PERSISTENCE] the corrected founderScore.score and dimensionScores survive a full JSON persistence round trip (simulating reports.metadata JSONB) unchanged", () => {
  const context = build(REAL_CASE_PROMPT);
  const roundTripped = JSON.parse(JSON.stringify(context.investmentScore));
  assert.equal(roundTripped.decisionEngine.founderScore.score, context.investmentScore.decisionEngine.founderScore.score);
  assert.deepEqual(roundTripped.decisionEngine.founderScore.dimensionScores, context.investmentScore.decisionEngine.founderScore.dimensionScores);
  assert.equal(
    readFounderReadinessScoreValue(roundTripped),
    readFounderReadinessScoreValue(context.investmentScore)
  );
});

test("10. [CACHE SAFETY] BUSINESS_PLAN_GENERATION_CONTRACT_VERSION was bumped past v14, invalidating any full-report cache entry generated before this fix", () => {
  const match = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "ltv-cac-ratio-integrity-v(\d+)";/.exec(planExecutorSource);
  assert.ok(match, "BUSINESS_PLAN_GENERATION_CONTRACT_VERSION declaration not found");
  assert.ok(Number(match[1]) >= 15, "version must be at v15 or later for this ticket's own cache-invalidating bump");
  assert.match(planExecutorSource, /TASK #69A-51/);
});

test("9. [DETERMINISM] the same prompt scored twice produces a byte-identical Founder Readiness Score and dimensionScores", () => {
  const first = build(REAL_CASE_PROMPT);
  const second = build(REAL_CASE_PROMPT);
  assert.equal(first.investmentScore.decisionEngine.founderScore.score, second.investmentScore.decisionEngine.founderScore.score);
  assert.deepEqual(first.investmentScore.decisionEngine.founderScore.dimensionScores, second.investmentScore.decisionEngine.founderScore.dimensionScores);
});
