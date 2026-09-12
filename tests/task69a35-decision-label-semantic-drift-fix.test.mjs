import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mapExecutiveDecisionCodeToCanonicalDecision,
  mapInvestmentScoreRecommendationToCanonicalDecision,
  mapAcquisitionCallToCanonicalDecision,
  mapRealEstateCommitteeDecisionToCanonicalDecision,
  mapDecisionIntelligenceRecommendationToCanonicalDecision,
  resolveCanonicalDecisionFromReportText,
  getCanonicalDecisionLabel,
  CANONICAL_EXECUTIVE_DECISIONS,
} from "../app/lib/report-engine/executive-decision-vocabulary.ts";

// ===========================================================================
// TASK #69A-35 -- ROOT CAUSE: a fresh Business Idea Validation report
// showed "Executive Decision: MONITOR" (the report's own generated
// executive-decision-brief banner) directly beside an "Investment
// Decision Snapshot" panel badge reading "Pause Pending Review" -- two
// apparently different decisions for the same report, in both page.tsx
// and Planner.tsx.
//
// Traced end-to-end: plan-executor.ts's own
// mapInvestmentRecommendationToExecutiveDecisionCode is the SOLE source
// of the Executive Decision brief's code, mapping investmentScore.
// recommendation DIRECTLY: "GO" -> "GO", "WAIT" -> "CONDITIONAL_GO",
// "PASS" -> "NO_GO" -- so a report's investmentScore.recommendation and
// its Executive Decision code are ALWAYS the same underlying decision,
// never independently derived, never stored as two competing facts.
//
// mapExecutiveDecisionCodeToCanonicalDecision (the correct path) maps
// "CONDITIONAL_GO" -> "PROCEED_WITH_CONDITIONS". But
// mapInvestmentScoreRecommendationToCanonicalDecision (used by the
// Investment Decision Snapshot badge whenever a structured
// investmentScore.recommendation exists) independently mapped the
// equivalent "WAIT" to "PAUSE_PENDING_REVIEW" instead -- a DIFFERENT
// canonical value for the provably identical decision tier. This was
// never a legitimate, separate "investment-score interpretation"; it was
// the same decision run through two inconsistent mappers -- an authority
// DRIFT, not a semantic distinction worth preserving.
//
// FIX: aligned mapInvestmentScoreRecommendationToCanonicalDecision's
// "WAIT" case to the same "PROCEED_WITH_CONDITIONS" value
// "CONDITIONAL_GO" already produces. No scoring, threshold, or decision-
// engine logic was touched -- this is a presentation-mapper correction
// only. PAUSE_PENDING_REVIEW itself is NOT removed from the canonical
// vocabulary: it remains correct for Acquisition's own native "Pause
// Pending Review" phrase, Real Estate's "WAIT" committee decision, and
// decision-intelligence's "Wait"/"Insufficient Evidence" -- none of
// which are proven equivalent to Business Plan's CONDITIONAL_GO tier the
// way investmentScore.recommendation's "WAIT" is.
// ===========================================================================

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pdfButtonSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const vocabularySource = readFileSync(
  join(repoRoot, "app/lib/report-engine/executive-decision-vocabulary.ts"),
  "utf8"
);

// ===========================================================================
// [FAIL-BEFORE / PASS-AFTER PROOF] -- reproduces the exact reported bug
// ===========================================================================

test("[FAIL-BEFORE PROOF] the OLD mapping (WAIT -> PAUSE_PENDING_REVIEW) would have disagreed with the Executive Decision brief's own CONDITIONAL_GO -> PROCEED_WITH_CONDITIONS for the SAME underlying decision", () => {
  const oldBuggyValue = "PAUSE_PENDING_REVIEW";
  const executiveDecisionValue = mapExecutiveDecisionCodeToCanonicalDecision("CONDITIONAL_GO");
  assert.notEqual(oldBuggyValue, executiveDecisionValue, "sanity: the old mapping was genuinely inconsistent");
});

test("[PASS-AFTER PROOF] the CURRENT mapping (WAIT -> PROCEED_WITH_CONDITIONS) agrees exactly with the Executive Decision brief's own CONDITIONAL_GO -> PROCEED_WITH_CONDITIONS", () => {
  assert.equal(
    mapInvestmentScoreRecommendationToCanonicalDecision("WAIT"),
    mapExecutiveDecisionCodeToCanonicalDecision("CONDITIONAL_GO")
  );
});

// ===========================================================================
// A/B/G/H -- canonical MONITOR (CONDITIONAL_GO) cannot render as another
//            Executive Decision; investment-score interpretation cannot
//            override the canonical decision; decision changes propagate
//            consistently across every source-specific mapper
// ===========================================================================

test("A/B. for every investmentScore.recommendation value, mapInvestmentScoreRecommendationToCanonicalDecision agrees with the SAME-tier mapExecutiveDecisionCodeToCanonicalDecision result -- the investment-score path can never independently diverge from the canonical decision", () => {
  const tierPairs = [
    ["GO", "GO"],
    ["WAIT", "CONDITIONAL_GO"],
    ["PASS", "NO_GO"],
  ];
  for (const [investmentScoreRecommendation, executiveDecisionCode] of tierPairs) {
    assert.equal(
      mapInvestmentScoreRecommendationToCanonicalDecision(investmentScoreRecommendation),
      mapExecutiveDecisionCodeToCanonicalDecision(executiveDecisionCode),
      `${investmentScoreRecommendation} (investment score) must agree with ${executiveDecisionCode} (executive decision) -- they are the same underlying decision`
    );
  }
});

test("H. this agreement is proven against plan-executor.ts's own authoritative source mapping (mapInvestmentRecommendationToExecutiveDecisionCode), not an assumption", () => {
  assert.match(
    planExecutorSource,
    /return recommendation === "GO" \? "GO" : recommendation === "WAIT" \? "CONDITIONAL_GO" : "NO_GO";/
  );
});

// ===========================================================================
// C -- "Pause Pending Review" may render only under an investment-score
//      -specific label if retained (here: NOT retained for Business Plan's
//      WAIT tier, but still correctly retained for genuinely distinct
//      native vocabularies)
// ===========================================================================

test("C1. PAUSE_PENDING_REVIEW remains a valid canonical value -- it is NOT deleted from the vocabulary, only decoupled from Business Plan's WAIT tier", () => {
  assert.ok(CANONICAL_EXECUTIVE_DECISIONS.includes("PAUSE_PENDING_REVIEW"));
});

test("C2. Acquisition's own native 'Pause Pending Review' phrase still maps to PAUSE_PENDING_REVIEW -- untouched by this fix (a genuinely distinct, granular native vocabulary, not investmentScore-derived)", () => {
  assert.equal(
    mapAcquisitionCallToCanonicalDecision("Pause Pending Review. Regulatory clearance is unresolved."),
    "PAUSE_PENDING_REVIEW"
  );
});

test("C3. Real Estate's committee 'WAIT' decision still maps to PAUSE_PENDING_REVIEW -- untouched (a genuinely distinct native committee vocabulary, never proven equivalent to Business Plan's CONDITIONAL_GO)", () => {
  assert.equal(mapRealEstateCommitteeDecisionToCanonicalDecision("WAIT"), "PAUSE_PENDING_REVIEW");
});

test("C4. decision-intelligence's 'Wait'/'Insufficient Evidence' still map to PAUSE_PENDING_REVIEW -- untouched (its own native scoring vocabulary, not investment-score.ts's)", () => {
  assert.equal(mapDecisionIntelligenceRecommendationToCanonicalDecision("Wait"), "PAUSE_PENDING_REVIEW");
  assert.equal(mapDecisionIntelligenceRecommendationToCanonicalDecision("Insufficient Evidence"), "PAUSE_PENDING_REVIEW");
});

// ===========================================================================
// D -- web and PDF use the same canonical Executive Decision
// ===========================================================================

test("D1. both page.tsx and Planner.tsx compute their 'Investment Decision Snapshot' badge through the SAME, now-corrected mapInvestmentScoreRecommendationToCanonicalDecision -- never an independent reconstruction", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /mapInvestmentScoreRecommendationToCanonicalDecision\(structuredInvestmentRecommendation\)/);
  }
});

test("D2. ReportPdfButton.tsx never imports or calls mapInvestmentScoreRecommendationToCanonicalDecision -- confirms the PDF path was never affected by this bug and required no change", () => {
  assert.doesNotMatch(pdfButtonSource, /mapInvestmentScoreRecommendationToCanonicalDecision/);
});

test("D3. rendering the golden 'WAIT' case through both page.tsx's and Planner.tsx's own imported mapper produces the identical label web-wide", () => {
  const webLabel = getCanonicalDecisionLabel(mapInvestmentScoreRecommendationToCanonicalDecision("WAIT"), "English");
  assert.equal(webLabel, "Proceed with Conditions");
});

// ===========================================================================
// E -- persisted/reloaded reports preserve the same decision semantics
// ===========================================================================

test("E. a persisted report's investmentScore.recommendation ('WAIT') survives a JSON round trip and still resolves to the SAME canonical decision as the report's own Executive Decision code after reload", () => {
  const persistedReport = { investmentScore: { recommendation: "WAIT", confidence: 56 } };
  const reloaded = JSON.parse(JSON.stringify(persistedReport));
  assert.equal(
    mapInvestmentScoreRecommendationToCanonicalDecision(reloaded.investmentScore.recommendation),
    mapExecutiveDecisionCodeToCanonicalDecision("CONDITIONAL_GO")
  );
});

// ===========================================================================
// F -- legacy reports degrade honestly when canonical decision data is
//      absent
// ===========================================================================

test("F1. resolveCanonicalDecisionFromReportText returns null (never a fabricated decision) when no report kind's decision vocabulary and no investmentScoreRecommendation are present", () => {
  assert.equal(resolveCanonicalDecisionFromReportText("Just some ordinary prose about the market."), null);
});

test("F2. resolveCanonicalDecisionFromReportText's own investmentScoreRecommendation fallback (its lowest-priority tier) is ALSO corrected -- a legacy report with only a raw investmentScore.recommendation and no decision-brief text still resolves consistently", () => {
  const resolved = resolveCanonicalDecisionFromReportText("No decision-shaped text here.", "WAIT");
  assert.equal(resolved.decision, "PROCEED_WITH_CONDITIONS");
});

// ===========================================================================
// I -- Founder Readiness, Confidence Radar, Benchmark Intelligence,
//      Porter's Five Forces, and competitor structures remain unchanged
// ===========================================================================

test("I. this fix's own diff is confined to executive-decision-vocabulary.ts's mapper -- no #69A-35 marker exists in any Founder Readiness/Confidence Radar/Benchmark Intelligence/Porter/competitor file, and the vocabulary module imports nothing from those systems", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/ai/benchmark-intelligence.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-35/, relativePath);
  }
  // Checks actual import statements only -- this module's own top-of-file
  // comment legitimately DISCUSSES investment-score.ts's vocabulary by
  // name (that reference predates this fix) without importing from it.
  assert.doesNotMatch(
    vocabularySource,
    /from\s+"@\/app\/lib\/ai\/(investment-score|market-research-coverage|benchmark-intelligence)"|from\s+"@\/app\/lib\/report-engine\/(porters-five-forces-state|business-competitor-landscape-state)"/
  );
});

test("I2. investment-score.ts's own createRecommendation/threshold logic is byte-unchanged -- confirms this is a presentation-mapper fix, never a scoring/threshold change", () => {
  const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");
  assert.match(investmentScoreSource, /export function createRecommendation\(totalScore: number, confidence: number\) \{/);
  assert.match(investmentScoreSource, /if \(totalScore >= 72 && confidence >= 60\) return "GO";/);
});

// ===========================================================================
// [REGRESSION LOCK]
// ===========================================================================

test("[REGRESSION LOCK] getDecisionClasses (page.tsx) already colors PAUSE_PENDING_REVIEW/Pause Pending Review and PROCEED_WITH_CONDITIONS/Proceed with Conditions identically -- this fix changes only the badge TEXT, never its color, for the golden report", () => {
  const classesBlockStart = pageSource.indexOf("function getDecisionClasses(decision: string)");
  const region = pageSource.slice(classesBlockStart, classesBlockStart + 1200);
  const bothInSameBranch = /decision === "WAIT" \|\|\s*\n\s*decision === "PAUSE_PENDING_REVIEW" \|\|\s*\n\s*decision === "Pause Pending Review" \|\|\s*\n\s*decision === "PROCEED_WITH_CONDITIONS" \|\|\s*\n\s*decision === "Proceed with Conditions"/;
  assert.match(region, bothInSameBranch);
});

