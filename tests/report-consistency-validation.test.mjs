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
  const returnDedupedIndex = marketSource.indexOf("return deduped;", lastPassIndex);
  assert.ok(lastPassIndex > 0 && returnDedupedIndex > lastPassIndex);
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
