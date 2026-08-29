import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runConsistencyValidationPass } from "../app/lib/report-consistency-validation.ts";

// --- Scenario: Executive Summary recommends A while another section ---
// --- recommends/states B. ---

test("a contradicting recommendation keyword elsewhere in the report is silently corrected to the authoritative decision", () => {
  const sections = {
    executiveSummary: "Bottom Line: HOLD on this opportunity.",
    problem: "Given the strong signals, we recommend VALIDATE immediately.",
    executiveRecommendation: "Decision: HOLD",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    authoritativeDecision: "HOLD",
    decisionProtectedFields: ["executiveSummary", "executiveRecommendation"],
  });

  assert.equal(sections.problem, "Given the strong signals, we recommend HOLD immediately.");
  assert.equal(result.correctionsApplied.length, 1);
  assert.equal(result.correctionsApplied[0].type, "recommendation_mismatch");
});

test("protected fields (the ones the decision was itself built from) are never rewritten", () => {
  const sections = {
    executiveSummary: "Bottom Line: HOLD.",
    executiveRecommendation: "Decision: HOLD",
  };
  const before = { ...sections };
  runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    authoritativeDecision: "HOLD",
    decisionProtectedFields: ["executiveSummary", "executiveRecommendation"],
  });

  assert.deepEqual(sections, before);
});

test("a report with no contradiction is left byte-for-byte unchanged and scores 100", () => {
  const sections = {
    executiveSummary: "Bottom Line: VALIDATE.",
    risks: "Execution risk remains the primary concern.",
  };
  const before = { ...sections };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    authoritativeDecision: "VALIDATE",
    decisionProtectedFields: ["executiveSummary"],
  });

  assert.deepEqual(sections, before);
  assert.equal(result.score, 100);
  assert.deepEqual(result.correctionsApplied, []);
});

// --- Scenario: Risks contradict opportunities ---

test("a statement listed as both a risk and an opportunity is removed from the opportunities side only", () => {
  const sections = {
    risks: "- Competitive response could erode margins quickly.\n- Customer acquisition cost may rise faster than expected.",
    swotAnalysis:
      "Strengths:\n- Strong team.\nWeaknesses:\n- Limited runway.\nOpportunities:\n- Customer acquisition cost may rise faster than expected.\n- Expansion into new geographies.\nThreats:\n- New entrants.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    riskOpportunity: { risksField: "risks", opportunitiesHostField: "swotAnalysis", opportunitiesHeading: "Opportunities" },
  });

  assert.doesNotMatch(sections.swotAnalysis, /Customer acquisition cost may rise faster than expected/);
  assert.match(sections.swotAnalysis, /Expansion into new geographies/);
  assert.match(sections.risks, /Customer acquisition cost may rise faster than expected/); // risks stays authoritative, untouched
  assert.equal(result.correctionsApplied[0].type, "risk_opportunity_duplicate");
});

test("Market Intelligence's separate opportunities/threats fields (no sub-heading) are compared directly", () => {
  const sections = {
    threats: "- Incumbent players dominate distribution channels.",
    opportunities: "- Incumbent players dominate distribution channels.\n- Underserved SMB segment remains open.",
  };
  runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    riskOpportunity: { risksField: "threats", opportunitiesHostField: "opportunities" },
  });

  assert.doesNotMatch(sections.opportunities, /Incumbent players dominate distribution channels/);
  assert.match(sections.opportunities, /Underserved SMB segment remains open/);
});

test("short, generic overlapping phrases are never treated as a contradiction (avoids false positives)", () => {
  const sections = {
    risks: "- Risk.",
    opportunities: "Opportunities:\n- Risk.\n- Real distinct opportunity here.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    riskOpportunity: { risksField: "risks", opportunitiesHostField: "opportunities", opportunitiesHeading: "Opportunities" },
  });

  assert.equal(result.correctionsApplied.length, 0);
});

// --- Scenario: Market size differs significantly between sections ---

test("a market-size (TAM) figure that disagrees with the canonical value is corrected", () => {
  const sections = {
    tamSamSom: "TAM: $500,000 | evidence=Industry benchmark | confidence=High",
    marketOpportunity: "The overall TAM is $2.1M and growing fast, which is very promising.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    metricTargets: [{ labelPattern: "TAM", canonicalDisplayValue: "$500,000", type: "market_size_mismatch" }],
    metricProtectedFields: ["tamSamSom"],
  });

  assert.equal(sections.marketOpportunity, "The overall TAM is $500,000 and growing fast, which is very promising.");
  assert.equal(sections.tamSamSom, "TAM: $500,000 | evidence=Industry benchmark | confidence=High"); // protected, untouched
  assert.equal(result.correctionsApplied[0].type, "market_size_mismatch");
});

// --- Scenario: Different CAGR/TAM values for the same market ---

test("a CAGR/growth-rate figure that disagrees with the canonical value is corrected", () => {
  const sections = {
    cagr: "The market is expected to grow at a CAGR of 8% through 2030.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    metricTargets: [{ labelPattern: "CAGR", canonicalDisplayValue: "14%", type: "growth_rate_mismatch" }],
  });

  assert.match(sections.cagr, /CAGR of 14%/);
  assert.equal(result.correctionsApplied[0].type, "growth_rate_mismatch");
});

// --- Scenario: Financial assumptions conflict with financial projections ---

test("a CAC figure quoted differently in prose than the canonical model value is corrected", () => {
  const sections = {
    businessModel: "With a CAC of $80, the unit economics work well at this price point.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    metricTargets: [{ labelPattern: "CAC", canonicalDisplayValue: "$45", type: "financial_metric_mismatch" }],
  });

  assert.match(sections.businessModel, /CAC of \$45/);
  assert.equal(result.correctionsApplied[0].type, "financial_metric_mismatch");
});

test("a bare metric label 'CAC' is never matched inside a compound label like 'CAC Payback'", () => {
  const sections = {
    unitEconomics: "CAC Payback: 7.2 months",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    metricTargets: [{ labelPattern: "CAC", canonicalDisplayValue: "$999,999", type: "financial_metric_mismatch" }],
  });

  assert.equal(sections.unitEconomics, "CAC Payback: 7.2 months");
  assert.equal(result.correctionsApplied.length, 0);
});

// --- Scenario: Timeline conflicts (e.g. 6 months vs 18 months) ---

test("a runway figure stated differently elsewhere (with a hedging word like 'only') is corrected without mangling the surrounding text", () => {
  const sections = {
    risks: "The main risk is running out of cash; runway is only 6 months at this burn rate.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    metricTargets: [{ labelPattern: "runway", canonicalDisplayValue: "18 months", type: "timeline_mismatch" }],
  });

  assert.equal(
    sections.risks,
    "The main risk is running out of cash; runway is only 18 months at this burn rate."
  );
  assert.equal(result.correctionsApplied[0].type, "timeline_mismatch");
});

// Regression: caught while building this feature -- regex alternation
// order previously let the bare "m" branch match before "months?",
// truncating "6 months" to "6 m" and leaving "onths" dangling after
// substitution (producing "18 monthsonths").
test("regression: a duration value ending in a multi-letter unit is never truncated mid-word by the substitution", () => {
  const sections = { risks: "Break-even is 6 months away, which is a concern." };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    metricTargets: [{ labelPattern: "Break-even", canonicalDisplayValue: "24 months", type: "timeline_mismatch" }],
  });

  assert.equal(result.correctionsApplied.length, 1);
  assert.equal(sections.risks, "Break-even is 24 months away, which is a concern.");
  assert.doesNotMatch(sections.risks, /monthsonths/);
  assert.doesNotMatch(sections.risks, /months\s*away away/);
});

// --- Requirement 3: prefer the latest structured value, log ---
// --- internally, never expose validation messages to the user. ---

test("the result never carries a user-facing message field -- only structural before/after/type data for internal logging", () => {
  const sections = { problem: "We recommend VALIDATE." };
  const result = runConsistencyValidationPass({
    sections,
    fields: ["problem"],
    language: "English",
    authoritativeDecision: "HOLD",
  });

  for (const correction of result.correctionsApplied) {
    assert.deepEqual(Object.keys(correction).sort(), ["after", "before", "field", "type"]);
  }
});

// --- Requirement 4: an internal 0-100 consistency score. ---

test("the consistency score decreases as more corrections are applied, floored at 0, and is a plain number never embedded in any section text", () => {
  const sections = {
    a: "VALIDATE here.",
    b: "VALIDATE here too.",
    c: "VALIDATE again.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    authoritativeDecision: "HOLD",
  });

  assert.equal(typeof result.score, "number");
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(result.score < 100);
  for (const content of Object.values(sections)) {
    assert.doesNotMatch(content, /\bscore\b/i);
    assert.doesNotMatch(content, /\bconsistency\b/i);
  }
});

test("the score never goes below 0 even with many corrections", () => {
  const sections = Object.fromEntries(
    Array.from({ length: 30 }, (_, index) => [`field${index}`, "VALIDATE"])
  );
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    authoritativeDecision: "HOLD",
  });

  assert.equal(result.score, 0);
});

// --- Requirement 5/6: preserve schema, no formatting changes beyond ---
// --- the corrected value itself. ---

test("a correction changes only the contradicting token, never surrounding punctuation/whitespace/structure", () => {
  const sections = {
    marketOpportunity: "Line one stays.\nThe overall TAM is $2.1M and growing fast.\nLine three stays too.",
  };
  runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    metricTargets: [{ labelPattern: "TAM", canonicalDisplayValue: "$500,000", type: "market_size_mismatch" }],
  });

  const lines = sections.marketOpportunity.split("\n");
  assert.equal(lines[0], "Line one stays.");
  assert.equal(lines[2], "Line three stays too.");
  assert.equal(lines[1], "The overall TAM is $500,000 and growing fast.");
});

// --- Wiring: a final pass, run last, in both report families. ---

const planSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
const marketSource = readFileSync("app/api/market-analysis/route.ts", "utf8");

test("plan-executor.ts runs the consistency validation pass as the last step before returning the finalized report", () => {
  assert.match(planSource, /runConsistencyValidationPass/);
  const lastPassIndex = planSource.indexOf("runConsistencyValidationPass(");
  const returnDedupedIndex = planSource.indexOf("return deduped;", lastPassIndex);
  assert.ok(lastPassIndex > 0 && returnDedupedIndex > lastPassIndex);
});

test("market-analysis route.ts runs the consistency validation pass as the last step before returning the finalized report", () => {
  assert.match(marketSource, /runConsistencyValidationPass/);
  const lastPassIndex = marketSource.indexOf("runConsistencyValidationPass(");
  // TASK #23 (+follow-up) -- ensureMarketReportQuality's final return was
  // extended twice: first from a bare `return deduped;` to also carry the
  // persisted canonical-state snapshot, then again to also carry the
  // always-populated canonicalStateStatus marker (see
  // market-intelligence-canonical-state.ts) -- the literal return
  // statement has changed shape twice now, but the ordering guarantee
  // this test protects (consistency validation runs before the function
  // returns) is unaffected: `deduped` is still the exact same, fully-
  // validated sections object, now just one property of the returned
  // object instead of the object itself. Matched by regex rather than an
  // exact literal so a future additive field on this same return doesn't
  // require updating this test a third time.
  const returnMatch = marketSource
    .slice(lastPassIndex)
    .match(/return \{\s*sections: deduped,\s*canonicalState: marketIntelligenceCanonicalState,\s*canonicalStateStatus: marketIntelligenceCanonicalStateStatus,\s*\};/);
  assert.ok(lastPassIndex > 0 && returnMatch, "expected the final return (carrying deduped) after the consistency pass");
});

test("neither plan-executor.ts nor market-analysis route.ts writes the consistency score/corrections into report content", () => {
  assert.doesNotMatch(planSource, /deduped\.\w+\s*=[^;]*consistencyResult/);
  assert.doesNotMatch(marketSource, /deduped\.\w+\s*=[^;]*consistencyResult/);
  assert.match(planSource, /logOperationalInfo\("\[api:plan\] consistency validation applied corrections"/);
  assert.match(marketSource, /logOperationalInfo\("\[api:market-analysis\] consistency validation applied corrections"/);
});

test("neither plan-executor.ts nor market-analysis route.ts declares a new report schema field for consistency validation", () => {
  assert.doesNotMatch(planSource, /consistencyScore:\s*\{/);
  assert.doesNotMatch(marketSource, /consistencyScore:\s*\{/);
});

// --- CRITICAL REPORT QUALITY TEST: contradictory strategic recommendations ---
//
// A report can pass every check above (same decision everywhere, same
// metric values, no risk/opportunity duplicate) while still pairing a
// weak, already-computed underlying signal in one section with an
// unqualified aggressive recommendation in a completely different
// section that never accounts for it. Each test below reproduces one of
// the 8 intentionally-contradictory scenarios from the report-quality
// audit and confirms the pass appends a deterministic, non-fabricating
// caution sentence rather than rewriting the AI's own sentence (grammar
// safety) or silently dropping the aggressive claim (would hide the
// model's actual output).

test("high competition / weak differentiation + unjustified premium pricing claim is flagged with a caveat, original sentence untouched", () => {
  const sections = {
    pricingStrategy: "Given strong pricing power, we recommend premium pricing above market rate.",
  };
  const before = sections.pricingStrategy;
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    strategicSignals: {
      weakCompetitiveAdvantage: true,
      weakMarketOpportunity: false,
      negativeUnitEconomics: false,
      lowRunway: false,
      lowValidationConfidence: false,
    },
  });

  assert.match(sections.pricingStrategy, new RegExp(before.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(sections.pricingStrategy, /competitive differentiation has not been established/);
  assert.equal(result.correctionsApplied[0].type, "strategic_signal_contradiction");
});

test("low market demand + aggressive hiring recommendation is flagged", () => {
  const sections = {
    founderRoadmap: "Demand signals are still forming. In 90 days, hire aggressively to capture the market.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    strategicSignals: {
      weakCompetitiveAdvantage: false,
      weakMarketOpportunity: true,
      negativeUnitEconomics: false,
      lowRunway: false,
      lowValidationConfidence: false,
    },
  });

  assert.match(sections.founderRoadmap, /hiring should stay lean until demand signals strengthen/);
  assert.equal(result.correctionsApplied[0].type, "strategic_signal_contradiction");
});

test("negative unit economics (LTV below CAC) + rapid scaling recommendation is flagged", () => {
  const sections = {
    scenarioAnalysis: "Best Case: scale rapidly once the funnel is proven.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    strategicSignals: {
      weakCompetitiveAdvantage: false,
      weakMarketOpportunity: false,
      negativeUnitEconomics: true,
      lowRunway: false,
      lowValidationConfidence: false,
    },
  });

  assert.match(sections.scenarioAnalysis, /LTV\/CAC needs to clear a healthy threshold/);
  assert.equal(result.correctionsApplied[0].type, "strategic_signal_contradiction");
});

test("cash constraints (thin runway) + recommendation to increase burn rate is flagged", () => {
  const sections = {
    financialAssumptions: "To hit the growth target, increase the burn rate over the next two quarters.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    strategicSignals: {
      weakCompetitiveAdvantage: false,
      weakMarketOpportunity: false,
      negativeUnitEconomics: false,
      lowRunway: true,
      lowValidationConfidence: false,
    },
  });

  assert.match(sections.financialAssumptions, /any increase in burn should be conditioned on a funding plan/);
  assert.equal(result.correctionsApplied[0].type, "strategic_signal_contradiction");
});

test("weak PMF / low validation confidence + immediate international expansion recommendation is flagged", () => {
  const sections = {
    goToMarketPlan: "Product-market fit is still being tested locally. Prioritize international expansion next quarter.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    strategicSignals: {
      weakCompetitiveAdvantage: false,
      weakMarketOpportunity: false,
      negativeUnitEconomics: false,
      lowRunway: false,
      lowValidationConfidence: true,
    },
  });

  assert.match(sections.goToMarketPlan, /should follow evidence of repeatable demand rather than precede it/);
  assert.equal(result.correctionsApplied[0].type, "strategic_signal_contradiction");
});

test("low customer validation + large marketing spend recommendation is flagged", () => {
  const sections = {
    salesStrategy: "Customer validation is limited to a handful of early conversations. Commit to a large marketing spend to accelerate pipeline.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    strategicSignals: {
      weakCompetitiveAdvantage: false,
      weakMarketOpportunity: false,
      negativeUnitEconomics: false,
      lowRunway: false,
      lowValidationConfidence: true,
    },
  });

  assert.match(sections.salesStrategy, /should follow evidence of repeatable demand rather than precede it/);
  assert.equal(result.correctionsApplied[0].type, "strategic_signal_contradiction");
});

test("high regulatory risk in the Risks section contradicting a 'low overall risk' conclusion elsewhere is flagged (RULE G)", () => {
  const sections = {
    risks: "Regulatory risk is high in this jurisdiction and licensing approval is not guaranteed.",
    executiveSummary: "Overall risk for this venture is low given the founder's track record.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    regulatoryRiskField: "risks",
  });

  assert.match(sections.executiveSummary, /flags high regulatory\/compliance exposure/);
  // The Risks section itself, which is the one carrying the actual
  // finding, is never watered down or rewritten -- only the contradicting
  // sentence elsewhere gets the caveat appended.
  assert.equal(sections.risks, "Regulatory risk is high in this jurisdiction and licensing approval is not guaranteed.");
  assert.equal(result.correctionsApplied[0].type, "strategic_signal_contradiction");
});

test("no false positives: aggressive phrasing with no corresponding weak signal is left untouched", () => {
  const sections = {
    pricingStrategy: "Given strong pricing power, we recommend premium pricing above market rate.",
    founderRoadmap: "In 90 days, hire aggressively to capture the market.",
  };
  const before = { ...sections };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    strategicSignals: {
      weakCompetitiveAdvantage: false,
      weakMarketOpportunity: false,
      negativeUnitEconomics: false,
      lowRunway: false,
      lowValidationConfidence: false,
    },
  });

  assert.deepEqual(sections, before);
  assert.equal(result.correctionsApplied.length, 0);
});

test("no false positives: a weak signal with no matching aggressive phrasing anywhere leaves the report untouched", () => {
  const sections = {
    pricingStrategy: "Pricing should be validated directly with early customers before it is finalized.",
  };
  const before = { ...sections };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    strategicSignals: {
      weakCompetitiveAdvantage: true,
      weakMarketOpportunity: true,
      negativeUnitEconomics: true,
      lowRunway: true,
      lowValidationConfidence: true,
    },
  });

  assert.deepEqual(sections, before);
  assert.equal(result.correctionsApplied.length, 0);
});

test("re-running the pass on already-corrected content never stacks a duplicate caveat onto the same sentence", () => {
  const sections = {
    pricingStrategy: "Given strong pricing power, we recommend premium pricing above market rate.",
  };
  const signals = {
    weakCompetitiveAdvantage: true,
    weakMarketOpportunity: false,
    negativeUnitEconomics: false,
    lowRunway: false,
    lowValidationConfidence: false,
  };

  runConsistencyValidationPass({ sections, fields: Object.keys(sections), language: "English", strategicSignals: signals });
  const afterFirstPass = sections.pricingStrategy;
  const result = runConsistencyValidationPass({ sections, fields: Object.keys(sections), language: "English", strategicSignals: signals });

  assert.equal(sections.pricingStrategy, afterFirstPass);
  assert.equal(result.correctionsApplied.length, 0);
  const occurrences = sections.pricingStrategy.split("competitive differentiation has not been established").length - 1;
  assert.equal(occurrences, 1);
});

test("the strategic-signal caveat is localized for Turkish reports", () => {
  const sections = {
    pricingStrategy: "Given strong pricing power, we recommend premium pricing above market rate.",
  };
  runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "Turkish",
    strategicSignals: {
      weakCompetitiveAdvantage: true,
      weakMarketOpportunity: false,
      negativeUnitEconomics: false,
      lowRunway: false,
      lowValidationConfidence: false,
    },
  });

  assert.match(sections.pricingStrategy, /rekabetçi farklılaşma henüz kanıtlanmadığı/);
});

// --- Wiring: plan-executor.ts computes real strategic signals from the ---
// --- report's own investment-score categories and financial metrics. ---

test("plan-executor.ts derives strategicSignals from context.investmentScore.categories and context.metrics, not hardcoded/fabricated values", () => {
  const passIndex = planSource.indexOf("runConsistencyValidationPass({");
  const strategicSignalsIndex = planSource.lastIndexOf("const strategicSignals = {", passIndex);
  assert.ok(strategicSignalsIndex > 0, "strategicSignals computation not found before the consistency pass call");

  const block = planSource.slice(strategicSignalsIndex, passIndex);
  assert.match(block, /investmentScoreCategories\.competitiveAdvantage/);
  assert.match(block, /investmentScoreCategories\.marketOpportunity/);
  assert.match(block, /investmentScoreCategories\.teamFounder/);
  assert.match(block, /context\.metrics\.ltv\.value/);
  assert.match(block, /context\.metrics\.cac\.value/);
  assert.match(block, /context\.metrics\.runway\.value/);

  const passCallBlock = planSource.slice(passIndex, planSource.indexOf("});", passIndex));
  assert.match(passCallBlock, /strategicSignals,/);
  assert.match(passCallBlock, /regulatoryRiskField:\s*"risks"/);
});
