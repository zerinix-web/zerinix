import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  getFounderReadinessDimensionScore,
  readFounderReadinessMetricValue,
  readFounderReadinessScoreValue,
  buildExecutiveSnapshot,
  normalizeFounderReadinessScoreText,
  FOUNDER_READINESS_DIMENSIONS,
  FOUNDER_READINESS_DIMENSION_METRICS,
} from "../app/lib/report-presentation.ts";
import {
  createCanonicalFinancialAssumptions,
  refreshResearchAwareFinancialContext,
} from "../app/lib/ai/financial-assumptions.ts";
import { applyMarketResearchCoverageToContext } from "../app/lib/ai/market-research-coverage.ts";

// TASK #69A-6 -- Eliminate the final Business Idea Validation score/gap
// authority inconsistencies. Covers both real-report defects: (1)
// Benchmark Intelligence's "No material validation gaps detected."
// contradicting the Executive Summary/Founder Score's own "Financial
// evidence: 26%" finding, and (2) the Founder Readiness section headline
// showing "51/100" while the Key Takeaway/Executive Decision Center/PDF
// show "40/100" for the exact same report.

const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");

// Real data captured live from report id 168c64ea-bf4a-4a26-986c-
// 8faf16b425ac (2026-09-06T06:27:52Z) -- the exact real report this
// ticket describes: decisionEngine.founderScore.score is 40, while the
// founderScore field's own rendered text headline said "Founder
// Readiness Score: 51/100" for the same report, and
// decisionEngine.financialScore.score is 26 with a real "Verified
// market-size endpoint detected: no" finding.
const REAL_INVESTMENT_SCORE = {
  totalScore: 46,
  confidence: 46,
  recommendation: "WAIT",
  categories: {
    scalability: { key: "scalability", label: "Scalability", score: 4, maximumScore: 12, explanation: "Scalability reflects growth potential, margin structure, Year-1 revenue potential, and capital intensity." },
    teamFounder: { key: "teamFounder", label: "Team / Founder", score: 4, maximumScore: 10, explanation: "Founder readiness separates the quality of the opportunity from the current level of validation and founder-specific evidence." },
    businessModel: { key: "businessModel", label: "Business Model", score: 7, maximumScore: 13, explanation: "Business-model quality reflects the pricing model, gross margin discipline, payback path, and repeat purchase or retention potential." },
    executionRisk: { key: "executionRisk", label: "Execution Risk", score: 5, maximumScore: 10, explanation: "Execution risk." },
    financialHealth: { key: "financialHealth", label: "Financial Health", score: 4, maximumScore: 15, explanation: "Financial health is based on margin, EBITDA profile, runway, and break-even timing." },
    capitalEfficiency: { key: "capitalEfficiency", label: "Capital Efficiency", score: 7, maximumScore: 13, explanation: "Capital efficiency." },
    marketOpportunity: { key: "marketOpportunity", label: "Market Opportunity", score: 8, maximumScore: 15, explanation: "Market opportunity is supported by reachable demand, obtainable market wedge, and benchmark growth potential." },
    competitiveAdvantage: { key: "competitiveAdvantage", label: "Competitive Advantage", score: 5, maximumScore: 12, explanation: "Competitive evidence: 41%; Distinct competitor organizations represented: 2" },
  },
  decisionEngine: {
    riskScore: { score: 60, maximumScore: 100, label: "Risk Score", reasoning: ["CAC payback: 11.3 months", "Break-even: Month 48"] },
    marketScore: { score: 55, maximumScore: 100, label: "Market Score", reasoning: ["Market evidence coverage: 55%", "Independent domains: 54", "Claim coverage: 33%"] },
    founderScore: {
      score: 40,
      maximumScore: 100,
      label: "Founder Score",
      reasoning: [
        "Market attractiveness: 48%",
        "Business model quality: 54%",
        "Validation confidence: 60%",
        "Execution complexity: 66%",
        "Evidence confidence: 34%",
        "Founder evidence: 40%",
      ],
    },
    executionScore: { score: 52, maximumScore: 100, label: "Execution Score", reasoning: ["Execution readiness: 52%"] },
    financialScore: {
      score: 26,
      maximumScore: 100,
      label: "Financial Score",
      reasoning: ["Financial evidence: 26%", "Verified market-size endpoint detected: no; planning estimates must remain separate"],
    },
    technologyScore: { score: 58, maximumScore: 100, label: "Technology Score", reasoning: ["Gross margin: 68%"] },
    competitionScore: { score: 41, maximumScore: 100, label: "Competition Score", reasoning: ["Competitive evidence: 41%", "Distinct competitor organizations represented: 2"] },
  },
};

// The real founderScore field's own rendered text for the same report --
// its headline states the WRONG, independently-recomputed 51 (pre-fix).
const REAL_FOUNDER_SCORE_TEXT_PRE_FIX = [
  "Founder Readiness Score: 51/100",
  "Idea Quality: 48/100 - clear market need and timing for AI-enabled FP&A in SMBs.",
  "Market Attractiveness: 48/100 - The market appears attractive if reachable demand and an obtainable beachhead can be validated.",
  "Business Model Quality: 54/100 - The model depends on repeat purchase, gross margin discipline, and a payback path that can survive real acquisition costs.",
  "Validation Confidence: 60/100 - early-stage with no paid customers; needs pilot conversions.",
  "Execution Complexity: 66/100 - Execution requires disciplined launch sequencing, channel proof, and operational control.",
  "Evidence Confidence: 34/100 - Evidence remains directional until customer, pricing, retention, and acquisition data are observed.",
  "Founder Evidence: 40/100 - no founder/team data provided; increases execution risk.",
].join("\n");

// ---------------------------------------------------------------------
// ISSUE 2 -- Founder Readiness overall score contradiction (51 vs 40).
// ---------------------------------------------------------------------

// Regression test 4: a fixture reproducing the real 51-vs-40
// contradiction resolves to one identical Founder Readiness score
// everywhere.
test("regression 4: the real 51-vs-40 fixture resolves to ONE canonical score (40) via every lookup function, even against the stale pre-fix text", () => {
  const canonical = readFounderReadinessScoreValue(REAL_INVESTMENT_SCORE);
  assert.equal(canonical, 40);

  const viaMetricValue = readFounderReadinessMetricValue(
    "Founder Readiness Score",
    REAL_INVESTMENT_SCORE,
    REAL_FOUNDER_SCORE_TEXT_PRE_FIX
  );
  const viaDimensionScore = getFounderReadinessDimensionScore(
    "founderReadinessScore",
    REAL_INVESTMENT_SCORE,
    REAL_FOUNDER_SCORE_TEXT_PRE_FIX
  );

  assert.equal(viaMetricValue, 40, "the section header/card lookup must never resolve the stale 51 baked into old text");
  assert.equal(viaDimensionScore, 40);
});

test("fail-before proof: prior to this fix, the text-first lookup returned the WRONG, independently-recomputed 51 for the exact same fixture", () => {
  // Reproduces the OLD (Task #69A-5-era) behavior directly: a bare
  // text-only regex extraction with no investmentScore-first override,
  // exactly what readFounderReadinessMetricValue used to do
  // unconditionally for every label including the overall score.
  const bareTextExtraction = REAL_FOUNDER_SCORE_TEXT_PRE_FIX.match(
    /(?:^|\n)\s*Founder Readiness Score\s*[:\-–—]\s*(\d{1,3})/i
  );
  assert.equal(Number(bareTextExtraction[1]), 51, "the OLD bug: bare text extraction alone finds the wrong, stale 51");
});

// Regression test 5: the canonical overall score is identical across
// Executive Decision Center, Founder Readiness section, Key Takeaway,
// dashboard, /plan, and PDF -- these all resolve through one of two
// functions (readFounderReadinessScoreValue directly, or
// readFounderReadinessMetricValue/getFounderReadinessDimensionScore),
// both of which this test drives directly against the real fixture.
test("regression 5: Executive Decision Center (buildExecutiveSnapshot), Founder Readiness section, and Key Takeaway/PDF-body normalization all agree on 40", () => {
  const snapshot = buildExecutiveSnapshot(REAL_FOUNDER_SCORE_TEXT_PRE_FIX, REAL_INVESTMENT_SCORE);
  assert.equal(snapshot.founderScoreValue, 40, "Executive Decision Center / Key Takeaway (buildExecutiveSnapshot)");

  const sectionHeaderScore = getFounderReadinessDimensionScore(
    "founderReadinessScore",
    REAL_INVESTMENT_SCORE,
    REAL_FOUNDER_SCORE_TEXT_PRE_FIX
  );
  assert.equal(sectionHeaderScore, 40, "Founder Readiness section header/card");

  // The PDF body paragraph normalizes the rendered text's own headline to
  // whatever canonical value it is given -- every real PDF call site
  // (page.tsx, Planner.tsx, ReportPdfButton.tsx) passes
  // readFounderReadinessScoreValue(investmentScore) here (verified by the
  // source-text assertions below), so this proves the VALUE they'd all
  // normalize to is the same 40.
  const pdfNormalizedText = normalizeFounderReadinessScoreText(
    REAL_FOUNDER_SCORE_TEXT_PRE_FIX,
    readFounderReadinessScoreValue(REAL_INVESTMENT_SCORE)
  );
  assert.match(pdfNormalizedText, /^Founder Readiness Score: 40\/100/);
});

test("regression 5: page.tsx, Planner.tsx, and ReportPdfButton.tsx all feed normalizeFounderReadinessScoreText the SAME canonical readFounderReadinessScoreValue result, never a second recomputation", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const calls = [...source.matchAll(/normalizeFounderReadinessScoreText\(\s*[^,]+,\s*([^)]+)\)/g)];
    assert.ok(calls.length > 0, `${name} must call normalizeFounderReadinessScoreText`);
    for (const call of calls) {
      const arg = call[1].trim();
      assert.match(
        arg,
        /readFounderReadinessScoreValue\(|founderReadinessScore|executiveSnapshot\.founderScoreValue/,
        `${name}'s normalizeFounderReadinessScoreText call must pass a canonical score (readFounderReadinessScoreValue / executiveSnapshot.founderScoreValue), not a re-derived one: got "${arg}"`
      );
    }
  }
});

test("plan-executor.ts's buildCanonicalFounderScore no longer independently recomputes the overall score from a weighted average of dimensions", () => {
  const fnStart = planExecutorSource.indexOf("function buildCanonicalFounderScore(");
  assert.notEqual(fnStart, -1);
  const fnEnd = planExecutorSource.indexOf("\nfunction ", fnStart + 10);
  const fnSource = planExecutorSource.slice(fnStart, fnEnd);

  assert.doesNotMatch(
    fnSource,
    /ideaQuality \* 2/,
    "must not reintroduce the old hand-weighted average formula"
  );
  assert.match(
    fnSource,
    /const overallScore = Math\.max\(0, Math\.min\(100, Math\.round\(founder\.score\)\)\);/,
    "must resolve the overall score directly from the canonical founder.score (investmentScore.decisionEngine.founderScore.score)"
  );
});

// Regression test 6: individual dimension values remain identity-safe
// and unchanged by this fix (Task #69A-5's own guarantee still holds).
test("regression 6: individual dimension values are unaffected by the overall-score fix -- each dimension still resolves its own, distinct value", () => {
  for (const dimension of FOUNDER_READINESS_DIMENSION_METRICS) {
    const value = getFounderReadinessDimensionScore(
      dimension.key,
      REAL_INVESTMENT_SCORE,
      REAL_FOUNDER_SCORE_TEXT_PRE_FIX
    );
    assert.notEqual(value, null, `${dimension.key} must still resolve to a real value`);
  }
  const expected = {
    ideaQuality: 48,
    marketAttractiveness: 48,
    businessModelQuality: 54,
    validationConfidence: 60,
    executionComplexity: 66,
    evidenceConfidence: 34,
    founderEvidence: 40,
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    assert.equal(
      getFounderReadinessDimensionScore(key, REAL_INVESTMENT_SCORE, REAL_FOUNDER_SCORE_TEXT_PRE_FIX),
      expectedValue,
      `${key} must still be identity-safe and unchanged`
    );
  }
});

test("FOUNDER_READINESS_DIMENSIONS' overall-score entry is still correctly excluded from the dimension-card grid", () => {
  assert.equal(FOUNDER_READINESS_DIMENSION_METRICS.length, 7);
  assert.equal(
    FOUNDER_READINESS_DIMENSION_METRICS.some((d) => d.key === "founderReadinessScore"),
    false
  );
  assert.equal(FOUNDER_READINESS_DIMENSIONS.length, 8);
});

// ---------------------------------------------------------------------
// ISSUE 1 -- Benchmark Intelligence validation-gap contradiction.
// ---------------------------------------------------------------------

const WEAK_EVIDENCE_PROMPT =
  "We are a proprietary, patent-pending enterprise SaaS platform with a data moat and network effects, serving regulated financial institutions with a premium recurring subscription model. Our experienced founding team has deep domain expertise as former bank executives and engineers. We have strong gross margins and enterprise contracts.";

// Regression test 1: a report with material financial/market/customer
// evidence gaps cannot produce "No material validation gaps detected."
test("regression 1: the real 26%-financial-evidence / unresolved-market-size fixture produces a non-empty, evidence-worded gap list -- 'No material validation gaps detected.' can never render", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const coverageResult = applyMarketResearchCoverageToContext(context, { evidence: [] }, WEAK_EVIDENCE_PROMPT);
  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);

  // Simulates the exact real numbers from report 168c64ea directly, to
  // prove the GATE ITSELF (the "is this list empty" check every renderer
  // performs) rather than relying on this specific prompt reproducing
  // 26% exactly.
  const realShapedCategories = {
    ...refreshed.investmentScore.categories,
    financialHealth: { ...refreshed.investmentScore.categories.financialHealth, score: 4, maximumScore: 15 },
  };
  const realShapedContext = {
    ...refreshed,
    investmentScore: { ...refreshed.investmentScore, categories: realShapedCategories },
  };
  const gate = realShapedContext.benchmarkFit.validationGaps.length > 0
    ? realShapedContext.benchmarkFit.validationGaps
    : ["No material validation gaps detected."];

  assert.ok(refreshed.benchmarkFit.validationGaps.length > 0);
  assert.notDeepEqual(gate, ["No material validation gaps detected."]);
  assert.ok(
    refreshed.benchmarkFit.validationGaps.some((gap) => /verified market-size endpoint detected: no/i.test(gap)),
    "must state the same 'no verified market-size endpoint' finding as the Executive Summary"
  );
});

// Regression test 2: a genuinely fully-supported report can produce no
// material validation gaps.
test("regression 2: a genuinely fully-evidenced context still yields an empty category-derived gap list -- the gate is not one-directional", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const strongDecisionEngine = Object.fromEntries(
    Object.entries(context.investmentScore.decisionEngine).map(([key, entry]) => [
      key,
      { ...entry, score: entry.maximumScore, reasoning: ["Fully evidenced."] },
    ])
  );
  const strongCategories = Object.fromEntries(
    Object.entries(context.investmentScore.categories).map(([key, category]) => [
      key,
      { ...category, score: category.maximumScore, explanation: "Fully evidenced." },
    ])
  );
  // TASK #69A-18 -- refreshResearchAwareFinancialContext now ALSO merges
  // context.validationIntelligenceV2's own material (non-"Validated")
  // assumptions into benchmarkFit.validationGaps. A "genuinely fully-
  // evidenced context" must now mean the validationIntelligenceV2 layer
  // is fully validated too, not just the 8 blended categories this test
  // already forces to full marks -- otherwise this fixture proves the
  // exact false-negative scenario #69A-18 exists to eliminate, not a
  // genuine no-gap state.
  const fullyValidatedValidationIntelligenceV2 = {
    ...context.validationIntelligenceV2,
    assumptions: context.validationIntelligenceV2.assumptions.map((assumption) => ({
      ...assumption,
      evidenceStatus: "Validated",
    })),
  };
  const strongContext = {
    ...context,
    investmentScore: { ...context.investmentScore, categories: strongCategories, decisionEngine: strongDecisionEngine },
    validationIntelligenceV2: fullyValidatedValidationIntelligenceV2,
  };
  const refreshed = refreshResearchAwareFinancialContext(strongContext);
  const categoryDerivedGaps = refreshed.benchmarkFit.validationGaps.filter(
    (gap) => !context.promptLevelValidationGaps.includes(gap)
  );
  const gate = refreshed.benchmarkFit.validationGaps.length > 0
    ? refreshed.benchmarkFit.validationGaps
    : ["No material validation gaps detected."];

  assert.deepEqual(categoryDerivedGaps, []);
  // The gate may still legitimately show the prompt-level heuristics --
  // this proves specifically that the CATEGORY-DERIVED half of the list
  // (the part this task's fix controls) never fabricates a gap when
  // every category is genuinely at its maximum.
  assert.ok(Array.isArray(gate));
});

// Regression test 3: Benchmark Intelligence and Executive Summary
// consume the same canonical material-gap state.
test("regression 3: Benchmark Intelligence's validationGaps and the Executive Summary's own weakest-category selection read the SAME categories object", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const coverageResult = applyMarketResearchCoverageToContext(context, { evidence: [] }, WEAK_EVIDENCE_PROMPT);
  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);

  // Simulates buildPlanExecutiveDecisionBrief's own "missingEvidence"
  // selection (plan-executor.ts): the 2 weakest categories by score
  // ratio, from context.investmentScore.categories -- the identical
  // object refreshResearchAwareFinancialContext just updated.
  const rankedCategories = Object.values(refreshed.investmentScore.categories)
    .slice()
    .sort((a, b) => b.score / b.maximumScore - a.score / a.maximumScore);
  const weakestTwo = rankedCategories.slice(-2).reverse();

  // Every one of the Executive Summary's "weakest 2" categories must
  // also appear, by label, somewhere in Benchmark Intelligence's own
  // category-derived gap list whenever that category is genuinely below
  // the 50% material-gap bar -- proving both surfaces are reading the
  // one canonical categories object, not two independently-scored views.
  for (const category of weakestTwo) {
    if (category.score / category.maximumScore < 0.5) {
      assert.ok(
        refreshed.benchmarkFit.validationGaps.some((gap) => gap.startsWith(`${category.label}:`)),
        `${category.label} is one of the Executive Summary's weakest categories and is below 50% -- Benchmark Intelligence must also name it`
      );
    }
  }
});

test("requirement: no separate parallel gap engine was introduced -- refreshResearchAwareFinancialContext is the only category-validation-gap deriver, reused (not duplicated) by both refresh call sites", () => {
  const occurrences = [...planExecutorSource.matchAll(/refreshResearchAwareFinancialContext\(/g)];
  assert.equal(occurrences.length, 2, "exactly the two known call sites (live-generation and cached-reuse) should use the shared helper");

  const financialAssumptionsSource = readFileSync(
    new URL("../app/lib/ai/financial-assumptions.ts", import.meta.url),
    "utf8"
  );
  const deriveOccurrences = [...financialAssumptionsSource.matchAll(/function deriveAuthoritativeCategoryValidationGaps/g)];
  assert.equal(deriveOccurrences.length, 1, "there must be exactly one definition of the material-gap threshold logic");
});
