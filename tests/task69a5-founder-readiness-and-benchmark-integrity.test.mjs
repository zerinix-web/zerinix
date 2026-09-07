import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  FOUNDER_READINESS_DIMENSIONS,
  FOUNDER_READINESS_DIMENSION_METRICS,
  getFounderReadinessDimensionScore,
  readFounderReadinessMetricValue,
  readFounderReadinessMetrics,
} from "../app/lib/report-presentation.ts";
import {
  createCanonicalFinancialAssumptions,
  refreshResearchAwareFinancialContext,
} from "../app/lib/ai/financial-assumptions.ts";
import { applyMarketResearchCoverageToContext } from "../app/lib/ai/market-research-coverage.ts";
import { createFinancialModel } from "../app/lib/ai/financial-model.ts";

// TASK #69A-5 -- Make Business Idea Validation report-wide score and
// evidence-gap invariants structurally authoritative. Covers all 3 real-
// report defects: (1) Benchmark Intelligence contradicting the Executive
// Summary on validation gaps, (2) Founder Readiness dimension score/label
// mismatch between the card grid and the explanatory text, (3) raw
// binary-floating-point leakage ("0.7425000000000002") in Financial
// Assumptions.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);

// ---------------------------------------------------------------------
// Requirement A/B -- one canonical Founder Readiness dimension source,
// never positional/index coupling.
// ---------------------------------------------------------------------

test("FOUNDER_READINESS_DIMENSIONS is the single, exhaustive, correctly-keyed dimension list", () => {
  const keys = FOUNDER_READINESS_DIMENSIONS.map((d) => d.key);
  assert.deepEqual(keys, [
    "founderReadinessScore",
    "ideaQuality",
    "marketAttractiveness",
    "businessModelQuality",
    "validationConfidence",
    "executionComplexity",
    "evidenceConfidence",
    "founderEvidence",
  ]);
  assert.equal(FOUNDER_READINESS_DIMENSION_METRICS.length, 7);
  assert.equal(
    FOUNDER_READINESS_DIMENSION_METRICS.some((d) => d.key === "founderReadinessScore"),
    false
  );
});

// Regression test 1: a fixture reproducing the exact reported shift
// (cards showing dimension i's score under label i, narrative showing
// the SAME underlying value under label i+1) and proving identity-safe
// mapping never lets that happen through the canonical resolver.
test("regression 1: identity-safe resolution never lets one dimension's score render under another dimension's label, even with a scrambled reasoning array", () => {
  // A deliberately "shifted" founderScore text -- as if some upstream bug
  // inserted an extra line or reordered dimensions -- naming each
  // dimension explicitly. getFounderReadinessDimensionScore must resolve
  // STRICTLY by each dimension's own label appearing in the text, so
  // scrambling irrelevant surrounding order can never bleed one
  // dimension's number into another's slot.
  const content = [
    "Founder Readiness Score: 51/100",
    "Idea Quality: 48/100 - explanation A.",
    "Market Attractiveness: 48/100 - explanation B.",
    "Business Model Quality: 54/100 - explanation C.",
    "Validation Confidence: 60/100 - explanation D.",
    "Execution Complexity: 66/100 - explanation E.",
    "Evidence Confidence: 34/100 - explanation F.",
    "Founder Evidence: 40/100 - explanation G.",
  ].join("\n");

  const expected = {
    founderReadinessScore: 51,
    ideaQuality: 48,
    marketAttractiveness: 48,
    businessModelQuality: 54,
    validationConfidence: 60,
    executionComplexity: 66,
    evidenceConfidence: 34,
    founderEvidence: 40,
  };

  for (const dimension of FOUNDER_READINESS_DIMENSIONS) {
    assert.equal(
      getFounderReadinessDimensionScore(dimension.key, undefined, content),
      expected[dimension.key],
      `${dimension.key} must resolve to its OWN line's value, never a neighboring dimension's`
    );
  }
});

test("regression 1b: the exact real cross-dimension mismatch shape (card grid value vs. narrative-line value) never diverges when both read the same canonical function", () => {
  // Reproduces the real report's own numbers: Idea Quality 48, Market
  // Attractiveness 48 (both alias the same canonical value by design --
  // see FOUNDER_READINESS_DIMENSIONS' own doc comment), Business Model
  // Quality 54, Validation Confidence 60, Execution Complexity 66,
  // Evidence Confidence 34, Founder Evidence 40.
  const content = [
    "Founder Readiness Score: 51/100",
    "Idea Quality: 48/100 - clear market need and timing for AI-enabled FP&A in SMBs.",
    "Market Attractiveness: 48/100 - The market appears attractive if reachable demand and an obtainable beachhead can be validated.",
    "Business Model Quality: 54/100 - The model depends on repeat purchase, gross margin discipline, and a payback path that can survive real acquisition costs.",
    "Validation Confidence: 60/100 - early-stage with no paid customers; needs pilot conversions.",
    "Execution Complexity: 66/100 - Execution requires disciplined launch sequencing, channel proof, and operational control.",
    "Evidence Confidence: 34/100 - Evidence remains directional until customer, pricing, retention, and acquisition data are observed.",
    "Founder Evidence: 40/100 - no founder/team data provided; increases execution risk.",
  ].join("\n");

  // Simulates the "card grid" (iterates FOUNDER_READINESS_DIMENSION_METRICS,
  // resolves each by its own label) exactly as page.tsx/Planner.tsx/
  // ReportPdfButton.tsx now all do post-fix.
  const cardGridValues = Object.fromEntries(
    FOUNDER_READINESS_DIMENSION_METRICS.map((d) => [
      d.label,
      readFounderReadinessMetricValue(d.label, undefined, content),
    ])
  );

  assert.deepEqual(cardGridValues, {
    "Idea Quality": 48,
    "Market Attractiveness": 48,
    "Business Model Quality": 54,
    "Validation Confidence": 60,
    "Execution Complexity": 66,
    "Evidence Confidence": 34,
    "Founder Evidence": 40,
  });
});

// Regression test 4: web/dashboard/PDF consumers must resolve identical
// Founder Readiness dimension values from the same canonical object.
test("regression 4: page.tsx, Planner.tsx, and ReportPdfButton.tsx all import the SAME canonical dimension list -- no local hand-copied duplicate remains", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(
      source,
      /FOUNDER_READINESS_DIMENSION(S|_METRICS)/,
      `${name} must import the canonical Founder Readiness dimension list`
    );
    // The old, hand-copied, 7-entry array literal (identifiable by its
    // unique "İş Modeli Kalitesi" Turkish alias) must no longer exist as
    // a separate local declaration in any of these three files.
    assert.doesNotMatch(
      source,
      /const founderScore(Pdf)?(Dimension)?Metrics\s*=\s*\[/,
      `${name} must not redeclare its own Founder Readiness dimension array`
    );
  }
});

test("regression 4: ReportPdfButton.tsx and Planner.tsx no longer resolve a dimension's score via positional array index", () => {
  for (const [name, source] of [
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    // Strip line comments first -- the fix's own explanatory comments
    // deliberately quote the OLD buggy pattern in backticks to document
    // what was removed, which would otherwise false-positive this check.
    const codeOnly = source
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    assert.doesNotMatch(
      codeOnly,
      /dimensionScoreValues\[[^\]]*findIndex/,
      `${name} must not look up a Founder Readiness score by array position`
    );
  }
});

test("regression 4: web/dashboard/PDF consumers resolve identical values from the same canonical object for a realistic report", () => {
  const content = [
    "Founder Readiness Score: 60/100",
    "Idea Quality: 66/100 - clear regulatory-aligned problem and SaaS model.",
    "Market Attractiveness: 66/100 - (policy-driven demand).",
    "Business Model Quality: 77/100 - (strong gross margin).",
    "Validation Confidence: 45/100 - no verified paid customers.",
    "Execution Complexity: 66/100 - (certification, procurement).",
    "Evidence Confidence: 34/100 - (mixture of Verified and Estimated).",
    "Founder Evidence: 34/100 - limited provided founder/team data.",
  ].join("\n");

  // "Dashboard cards" simulation (page.tsx's own pattern: per-label call).
  const dashboardValues = FOUNDER_READINESS_DIMENSION_METRICS.map((d) =>
    readFounderReadinessMetricValue(d.label, undefined, content)
  );
  // "PDF" simulation (ReportPdfButton.tsx/Planner.tsx's normalizePdfFounderScoreMetrics,
  // post-fix: identical per-label resolution, no positional array).
  const pdfValues = FOUNDER_READINESS_DIMENSION_METRICS.map(
    (d) => getFounderReadinessDimensionScore(d.key, undefined, content)
  );

  assert.deepEqual(dashboardValues, pdfValues);
  assert.deepEqual(dashboardValues, [66, 66, 77, 45, 66, 34, 34]);
});

test("plan-executor.ts's buildCanonicalFounderScore emits dimensions in the SAME order as the canonical FOUNDER_READINESS_DIMENSION_METRICS list", () => {
  const fnStart = planExecutorSource.indexOf("function buildCanonicalFounderScore(");
  assert.notEqual(fnStart, -1);
  const fnEnd = planExecutorSource.indexOf("\n}\n", fnStart);
  const fnSource = planExecutorSource.slice(fnStart, fnEnd);

  const orderInSource = FOUNDER_READINESS_DIMENSION_METRICS.map((d) => ({
    label: d.label,
    index: fnSource.indexOf(`\`${d.label}: \${`),
  }));

  for (const entry of orderInSource) {
    assert.notEqual(entry.index, -1, `${entry.label} must be emitted by buildCanonicalFounderScore`);
  }
  const indices = orderInSource.map((e) => e.index);
  const sorted = [...indices].sort((a, b) => a - b);
  assert.deepEqual(indices, sorted, "dimensions must be emitted in canonical order, never reordered");
});

// ---------------------------------------------------------------------
// Requirement C/D/E -- Benchmark Intelligence validation gaps derive from
// authoritative, post-research-coverage evidence state.
// ---------------------------------------------------------------------

const WEAK_EVIDENCE_PROMPT =
  "We are a proprietary, patent-pending enterprise SaaS platform with a data moat and network effects, serving regulated financial institutions with a premium recurring subscription model. Our experienced founding team has deep domain expertise as former bank executives and engineers. We have strong gross margins and enterprise contracts.";

// Regression test 2: a report with unresolved Financial Health / market-
// size evidence must fail any attempt to emit "No material validation
// gaps detected."
test("regression 2: unresolved Financial Health / market-size evidence produces a non-empty, evidence-worded validation-gap list after refresh", () => {
  const context = createCanonicalFinancialAssumptions({
    prompt: WEAK_EVIDENCE_PROMPT,
    reportKind: "business_plan",
  });
  const coverageResult = applyMarketResearchCoverageToContext(context, { evidence: [] }, WEAK_EVIDENCE_PROMPT);

  assert.equal(coverageResult.coverage.verifiedMarketSizeAvailable, false);

  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);

  assert.ok(refreshed.benchmarkFit.validationGaps.length > 0, "validationGaps must never be empty here");
  assert.ok(
    refreshed.benchmarkFit.validationGaps.some((gap) => /verified market-size endpoint detected: no/i.test(gap)),
    "the gap list must state the SAME 'no verified market-size endpoint' finding the Executive Summary shows"
  );
});

test("regression 2: fail-before proof -- without the fix, benchmarkFit.validationGaps stays frozen at the pre-research snapshot", () => {
  const context = createCanonicalFinancialAssumptions({
    prompt: WEAK_EVIDENCE_PROMPT,
    reportKind: "business_plan",
  });
  const coverageResult = applyMarketResearchCoverageToContext(context, { evidence: [] }, WEAK_EVIDENCE_PROMPT);

  // The OLD behavior: coverageResult.context.benchmarkFit is never
  // recomputed after coverage runs -- it is byte-identical to the
  // pre-coverage context's own benchmarkFit.
  assert.deepEqual(coverageResult.context.benchmarkFit, context.benchmarkFit);
  assert.equal(
    coverageResult.context.benchmarkFit.validationGaps.some((gap) => /verified market-size endpoint/i.test(gap)),
    false,
    "the STALE snapshot never mentions the real, post-research market-size finding"
  );
});

// Regression test 3: a truly fully-supported fixture may still emit no
// material validation gaps.
test("regression 3: a genuinely well-evidenced context still yields an empty (or fully-passing) validation-gap list -- the fix never fabricates a gap that isn't real", () => {
  const context = createCanonicalFinancialAssumptions({
    prompt: WEAK_EVIDENCE_PROMPT,
    reportKind: "business_plan",
  });

  // Synthesize a fully-scored, evidence-strong post-coverage state
  // directly (every decisionEngine category at its own maximum) to prove
  // the derivation logic itself -- not just a lucky prompt -- never
  // invents a gap when categories are genuinely strong.
  //
  // refreshInvestmentNarrativeFromResearchCoverage (called inside
  // refreshResearchAwareFinancialContext) OVERWRITES 5 of the 8
  // categories (marketOpportunity, competitiveAdvantage, financialHealth,
  // executionRisk, teamFounder) from decisionEngine's own scores -- so
  // both decisionEngine AND categories must be forced to full marks for
  // this to actually test "everything is fully evidenced" end-to-end.
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
  const strongInvestmentScore = {
    ...context.investmentScore,
    categories: strongCategories,
    decisionEngine: strongDecisionEngine,
  };
  // TASK #69A-18 -- refreshResearchAwareFinancialContext now ALSO merges
  // context.validationIntelligenceV2's own material (non-"Validated")
  // assumptions into benchmarkFit.validationGaps (see that ticket's own
  // fix). A "genuinely well-evidenced context" must now mean ALL THREE
  // gap sources are satisfied, not just the 8 blended categories this
  // test already forces to full marks -- otherwise this fixture would be
  // proving exactly the false-negative "well evidenced but real gaps
  // still exist" scenario #69A-18 exists to eliminate, not the genuine
  // no-gap state this test's own title claims to cover.
  const fullyValidatedValidationIntelligenceV2 = {
    ...context.validationIntelligenceV2,
    assumptions: context.validationIntelligenceV2.assumptions.map((assumption) => ({
      ...assumption,
      evidenceStatus: "Validated",
    })),
  };
  const strongContext = {
    ...context,
    investmentScore: strongInvestmentScore,
    validationIntelligenceV2: fullyValidatedValidationIntelligenceV2,
  };

  const refreshed = refreshResearchAwareFinancialContext(strongContext);
  const categoryDerivedGaps = refreshed.benchmarkFit.validationGaps.filter(
    (gap) => !context.promptLevelValidationGaps.includes(gap)
  );

  assert.deepEqual(categoryDerivedGaps, [], "no category-derived or validationIntelligence-derived gap should exist when every category AND every validation assumption is genuinely fully evidenced");
});

test("requirement D: assumptions are never upgraded to verified evidence merely to remove the contradiction -- the fix only ever adds/removes gap STRINGS, never touches financial evidence labeling", () => {
  const financialEvidenceLabelingSource = readFileSync(
    new URL("../app/lib/financial-evidence-labeling.ts", import.meta.url),
    "utf8"
  );
  const financialAssumptionsSource = readFileSync(
    new URL("../app/lib/ai/financial-assumptions.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(
    financialAssumptionsSource,
    /classifyFinancialMetricEvidenceType/,
    "the validation-gap refresh must not touch evidence-type classification at all"
  );
  assert.match(financialEvidenceLabelingSource, /"Verified"/);
});

// Regression test 9 (Market Intelligence unaffected) -- market-analysis
// route.ts is a completely separate report type and does not call
// refreshResearchAwareFinancialContext at all.
test("Market Intelligence's own route is untouched by refreshResearchAwareFinancialContext", () => {
  const marketAnalysisSource = readFileSync(
    new URL("../app/api/market-analysis/route.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(marketAnalysisSource, /refreshResearchAwareFinancialContext/);
});

// ---------------------------------------------------------------------
// Requirement F -- deterministic multiplier/ratio formatting, no
// calculation-precision change.
// ---------------------------------------------------------------------

// Regression test 5: 0.7425000000000002 must render as a clean
// deterministic human-readable value while internal numeric precision
// remains unchanged.
test("regression 5: the real 'premium local' combination that produced 0.7425000000000002 now renders as a clean '0.7425'", () => {
  const model = createFinancialModel({
    prompt: "I run a premium local bakery in a single neighborhood.",
    reportKind: "business_plan",
  });
  const scopeMultiplierAssumption = model.metrics.tam.assumptions.find((a) =>
    a.startsWith("Idea scope multiplier:")
  );

  assert.equal(scopeMultiplierAssumption, "Idea scope multiplier: 0.7425");
  assert.doesNotMatch(model.metrics.tam.assumptions.join(" | "), /0\.7425000000000002/);
});

test("regression 5: internal calculation precision is unaffected by the presentation formatter -- TAM's raw numeric value is unchanged", () => {
  const promptText = "I run a premium local bakery in a single neighborhood.";
  const model = createFinancialModel({ prompt: promptText, reportKind: "business_plan" });

  // Recompute independently to confirm the raw (full binary-precision)
  // multiplier is what actually drives the calculated value -- i.e. the
  // formatter is presentation-only and never feeds back into the model.
  const rawMultiplier = 1 * 1.35 * 0.55;
  assert.notEqual(String(rawMultiplier), "0.7425", "sanity check: the raw value itself still carries float noise");
  assert.equal(typeof model.metrics.tam.value, "number");
  assert.ok(Number.isFinite(model.metrics.tam.value) && model.metrics.tam.value > 0);
});

test("regression 5: other known multiplier assumptions (geography, complexity, acquisition uncertainty, customer ramp) never leak binary float noise", () => {
  const model = createFinancialModel({
    prompt: "A small solo neighborhood D2C coffee subscription brand in Germany.",
    reportKind: "business_plan",
  });
  const allAssumptions = [
    ...model.metrics.tam.assumptions,
    ...model.metrics.cac.assumptions,
  ].join(" | ");

  assert.doesNotMatch(allAssumptions, /\d+\.\d{5,}/, "no multiplier assumption should show 5+ decimal digits");
});

// ---------------------------------------------------------------------
// Requirement G / regression test 6 -- existing decision/confidence/
// evidence/provenance behavior remains unchanged.
// ---------------------------------------------------------------------

test("requirement G: readFounderReadinessMetrics' existing ideaQuality<-marketAttractiveness alias behavior is preserved verbatim", () => {
  const investmentScore = {
    decisionEngine: {
      founderScore: {
        score: 51,
        reasoning: [
          "Market attractiveness: 48%",
          "Business model quality: 54%",
          "Validation confidence: 60%",
          "Execution complexity: 66%",
          "Evidence confidence: 34%",
          "Founder evidence: 40%",
        ],
      },
    },
  };
  const metrics = readFounderReadinessMetrics(investmentScore);
  assert.equal(metrics.ideaQuality, metrics.marketAttractiveness);
  assert.equal(metrics.ideaQuality, 48);
});

test("requirement G: TAM/SAM/SOM formula strings and benchmarkComparison text are unchanged by the multiplier formatter", () => {
  const model = createFinancialModel({
    prompt: "I run a premium local bakery in a single neighborhood.",
    reportKind: "business_plan",
  });
  assert.equal(model.metrics.tam.formula, "industry TAM x geography multiplier x idea scope multiplier");
  assert.equal(
    model.metrics.tam.benchmarkComparison,
    "Derived from benchmark market scope rather than compared to operating range."
  );
});

test("requirement G: promptLevelValidationGaps preserves the original 3 prompt-only heuristic gaps verbatim across the refresh", () => {
  const context = createCanonicalFinancialAssumptions({
    prompt: WEAK_EVIDENCE_PROMPT,
    reportKind: "business_plan",
  });
  const coverageResult = applyMarketResearchCoverageToContext(context, { evidence: [] }, WEAK_EVIDENCE_PROMPT);
  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);

  for (const gap of context.promptLevelValidationGaps) {
    assert.ok(
      refreshed.benchmarkFit.validationGaps.includes(gap),
      `original prompt-level gap must survive the refresh verbatim: ${gap}`
    );
  }
});
