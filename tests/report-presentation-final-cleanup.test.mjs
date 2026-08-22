import test from "node:test";
import assert from "node:assert/strict";

// FINAL CLEANUP -- remove remaining internal reasoning language from
// customer reports.
//
// The presentation sanitizer (report-presentation-sanitizer.ts, built
// across three prior turns) already removed Sources/External Evidence
// sections, [R#] identifiers, and URLs -- but several internal-reasoning
// phrases still survived it:
//
//   - Bare [Verified]/[Derived] bracket labels: a prior turn deliberately
//     PRESERVED these (the deal-facts pipeline's own evidence-tier
//     labels). Confirmed live, they still read as internal notation to a
//     customer ("[Verified] Purchase price: $40M"). This turn reverses
//     that decision: the label is removed, the figure stays
//     ("Purchase price: $40M").
//   - "Verified Deal Facts:" / "Derived Valuation Metric:" / "Derived
//     Financing Metrics:" -- the heading each deal-facts block is
//     prepended under (acquisition-deal-facts.ts) -- now stripped as a
//     whole line, the same reasoning as the bracket labels themselves.
//   - The [Unknown][Required:field] rewrite (built two turns ago) used
//     the humanized field IDENTIFIER as its own sentence subject
//     ("Valuation purchase price requires additional verification
//     before this can be finalized.") -- still an internal research-task
//     field name in lightly-cleaned form, not natural language. Now
//     genericized to one fixed sentence, never naming the field.
//   - decision-intelligence/risk-engine.ts's own deterministic sentence
//     "Critical decision evidence remains unresolved: ${field}." was
//     never handled at all before this turn.
//   - plan-executor.ts's timeout-fallback disclosure sentence ("The
//     synthesis provider reached its deadline; ... the existing decision
//     engine.") was only partially covered (the bracket tags around it,
//     not the sentence's own prose).
//   - Raw snake_case research-task/section-plan identifiers
//     (target_financials, purchase_price, valuation_purchase_price,
//     integration_operational_risk, and any other, not-yet-seen one) had
//     no general safety net.
//
// None of generation, routing, or reasoning changed -- every fixture
// below is exactly the citation/label-heavy content plan-executor.ts's
// generators and their timeout fallbacks are still deliberately asked to
// produce internally (report-presentation-sanitizer.test.mjs's drift
// checks already prove that source is untouched); this suite proves only
// that none of the newly-named phrases reach the customer-facing report,
// while the underlying figures and analysis survive exactly.

const {
  stripReportPresentationArtifacts,
  sanitizeReportSectionsForPresentation,
} = await import("../app/lib/report-engine/report-presentation-sanitizer.ts");
const {
  extractAcquisitionDealFacts,
  computeAcquisitionDerivedMetrics,
  formatVerifiedDealFactsBlock,
  formatDerivedValuationBlock,
  formatDerivedFinancingBlock,
} = await import("../app/lib/ai/acquisition-deal-facts.ts");

// --- 1. Bare [Verified]/[Derived] labels are removed, figures survive ----

test("[Verified] is removed from customer-facing output, the figure survives -- exact BAD/GOOD example from the fix", () => {
  const rewritten = stripReportPresentationArtifacts("[Verified] Purchase price: $40M");
  assert.equal(rewritten, "Purchase price: $40M");
});

test("[Derived] is removed from customer-facing output for consistency with [Verified], the figure survives", () => {
  const rewritten = stripReportPresentationArtifacts("[Derived] EV/ARR: 4.0x");
  assert.equal(rewritten, "EV/ARR: 4.0x");
});

test("the 'Verified Deal Facts:' / 'Derived Valuation Metric:' / 'Derived Financing Metrics:' block headings are removed as whole lines, the figures beneath them survive -- exercised against the exact per-block formatters applyAcquisitionDeterministicOverrides prepends into a real acquisition report", () => {
  const facts = extractAcquisitionDealFacts(
    "We are acquiring a cybersecurity SaaS company. Purchase price is $40M, target ARR is $10M, and buyer available capital is $10M."
  );
  const derived = computeAcquisitionDerivedMetrics(facts);

  const verifiedBlock = formatVerifiedDealFactsBlock(facts);
  const valuationBlock = formatDerivedValuationBlock(derived);
  const financingBlock = formatDerivedFinancingBlock(derived);

  const rewrittenVerified = stripReportPresentationArtifacts(verifiedBlock);
  const rewrittenValuation = stripReportPresentationArtifacts(valuationBlock);
  const rewrittenFinancing = stripReportPresentationArtifacts(financingBlock);

  assert.doesNotMatch(rewrittenVerified, /Verified Deal Facts/);
  assert.doesNotMatch(rewrittenValuation, /Derived Valuation Metric/);
  assert.doesNotMatch(rewrittenFinancing, /Derived Financing Metrics/);
  assert.doesNotMatch(rewrittenVerified, /\[Verified\]/);
  assert.doesNotMatch(rewrittenValuation, /\[Derived\]/);
  assert.doesNotMatch(rewrittenFinancing, /\[Derived\]/);

  assert.match(rewrittenVerified, /Purchase price: \$40M/);
  assert.match(rewrittenVerified, /Target ARR: \$10M/);
  assert.match(rewrittenValuation, /EV\/ARR: 4x/);
  assert.match(rewrittenFinancing, /Equity contribution: \$10M/);
  assert.match(rewrittenFinancing, /Debt requirement: \$30M/);
});

// --- 2. "deadline" / "synthesis provider" / "existing decision engine" ---
// ---    are removed as the internal timeout-disclosure sentence, not ----
// ---    stripped as bare words (so a legitimate business mention of -----
// ---    'deadline' elsewhere is never damaged) ---------------------------

test("plan-executor.ts's timeout-fallback disclosure sentence ('The synthesis provider reached its deadline...the existing decision engine.') is removed entirely, leaving the real analysis intact", () => {
  const rewritten = stripReportPresentationArtifacts(
    "[Recommendation] [Basis:decision engine] The synthesis provider reached its deadline; this preliminary report was completed from verified evidence and the existing decision engine.\n[Recommendation] [Basis:decision engine] Proceed conditionally on confirmed financing terms."
  );

  assert.doesNotMatch(rewritten, /synthesis provider/i);
  assert.doesNotMatch(rewritten, /deadline/i);
  assert.doesNotMatch(rewritten, /decision engine/i);
  assert.equal(rewritten, "Proceed conditionally on confirmed financing terms.");
});

test("a legitimate business mention of 'deadline' survives untouched -- 'deadline' is never stripped as a bare word, only as part of the specific internal disclosure sentence", () => {
  const legitimate =
    "The regulatory filing deadline is 60 days after signing, which should be reflected in the closing timeline.";
  assert.equal(stripReportPresentationArtifacts(legitimate), legitimate);
});

// --- 3. "authoritative source" / generic evidence-gap rewrite ------------

test("'[Unknown] [Required:authoritative source] ...' is rewritten into the fix's own required generic GOOD sentence, never naming 'authoritative source'", () => {
  const rewritten = stripReportPresentationArtifacts(
    "[Unknown] [Required:authoritative source] No usable external evidence returned within the time budget."
  );
  assert.doesNotMatch(rewritten, /authoritative source/i);
  assert.equal(rewritten, "Additional financial and operational information is needed before making a final decision.");
});

// --- 4. "critical decision evidence remains unresolved" -------------------

test("'Critical decision evidence remains unresolved: valuation.' is rewritten into the fix's own required GOOD sentence, keeping the real topic in natural language", () => {
  const rewritten = stripReportPresentationArtifacts("Critical decision evidence remains unresolved: valuation.");
  assert.equal(rewritten, "The valuation should be reviewed further before closing.");
});

test("the critical-decision-evidence rewrite generalizes to any topic, not just 'valuation'", () => {
  assert.equal(
    stripReportPresentationArtifacts("Critical decision evidence remains unresolved: financing structure."),
    "The financing structure should be reviewed further before closing."
  );
});

// --- 5. target_financials / purchase_price / valuation_purchase_price / --
// ---    integration_operational_risk / Required: / Unknown labels --------

test("raw snake_case research-task/section-plan identifiers (target_financials, purchase_price, valuation_purchase_price, integration_operational_risk) are naturalized wherever they appear, never left as raw internal identifiers", () => {
  const rewritten = stripReportPresentationArtifacts(
    "Attempted fields: target_financials, purchase_price, valuation_purchase_price, integration_operational_risk."
  );

  assert.doesNotMatch(rewritten, /target_financials/);
  assert.doesNotMatch(rewritten, /valuation_purchase_price/);
  assert.doesNotMatch(rewritten, /integration_operational_risk/);
  assert.match(rewritten, /target financials/);
  assert.match(rewritten, /valuation purchase price/);
  assert.match(rewritten, /integration operational risk/);
});

test("'purchase_price' alone is naturalized to 'purchase price', a legitimate natural-English phrase -- proves the underscore-based detection never over-fires on real English (which never contains underscores)", () => {
  assert.equal(stripReportPresentationArtifacts("purchase_price"), "purchase price");
});

test("[Unknown] and [Required:...] never appear anywhere in sanitized output, in any content shape", () => {
  const samples = [
    "[Unknown] Some claim.",
    "[Required:x] Some claim.",
    "[Unknown] [Required:target_financials] Some external sources could not be verified.",
  ];
  for (const sample of samples) {
    const rewritten = stripReportPresentationArtifacts(sample);
    assert.doesNotMatch(rewritten, /\[Unknown\]/);
    assert.doesNotMatch(rewritten, /\[Required:/);
  }
});

// --- 6. Regression: reproduce the exact $40M/$10M acquisition case -------
// ---    end to end, across every phrase named in this fix ----------------

function fullAcquisitionFixture40M10M() {
  return [
    {
      field: "executiveAcquisitionSummary",
      title: "Executive Acquisition Summary",
      content:
        "[Recommendation] [Basis:decision engine] The synthesis provider reached its deadline; this preliminary report was completed from verified evidence and the existing decision engine.\n[Recommendation] [Basis:decision engine] Proceed conditionally on confirmed financing terms.",
    },
    {
      field: "targetCompanyOverview",
      title: "Target Company Overview",
      content: "Verified Deal Facts:\n[Verified] Purchase price: $40M\n[Verified] Target ARR: $10M",
    },
    {
      field: "valuationAnalysis",
      title: "Valuation Analysis (EV/ARR, Purchase Price Fairness)",
      content:
        "Derived Valuation Metric:\n[Derived] EV/ARR: 4.0x\nComparable SaaS transactions average 3.5x-4.5x EV/ARR, supporting the $40M purchase price as fair against $10M target ARR.",
    },
    {
      field: "financingStructure",
      title: "Financing Structure",
      content:
        "Derived Financing Metrics:\n[Derived] Equity contribution: $10M\n[Derived] Debt requirement: $30M",
    },
    {
      field: "dealRisks",
      title: "Deal Risks",
      content: "Critical decision evidence remains unresolved: valuation.",
    },
    {
      field: "missingInformation",
      title: "Missing Information",
      content:
        "[Unknown] [Required:valuation_purchase_price] Some external sources could not be verified, so this field is not definitive.\nAttempted fields: target_financials, integration_operational_risk.",
    },
    {
      field: "finalInvestmentRecommendation",
      title: "Final Investment Recommendation",
      content:
        "[Recommendation] [Basis:decision engine] Proceed conditionally: financing terms are the primary open item before close.",
    },
    {
      field: "sources",
      title: "Sources",
      content: "[Verified] [R1] valuation: SaaS EV/ARR benchmark https://saas-capital.example.com/benchmarks",
    },
  ];
}

test("the exact $40M purchase price / $10M target ARR acquisition case: sanitizeReportSectionsForPresentation removes every internal-reasoning phrase named in this fix, end to end", () => {
  const sanitized = sanitizeReportSectionsForPresentation(fullAcquisitionFixture40M10M());
  const allContent = sanitized.map((s) => s.content).join("\n");

  // Sources section removed entirely.
  assert.ok(!sanitized.some((s) => s.field === "sources"));

  // Every phrase this fix names.
  assert.doesNotMatch(allContent, /\[Verified\]/);
  assert.doesNotMatch(allContent, /\[Derived\]/);
  assert.doesNotMatch(allContent, /Verified Deal Facts:/);
  assert.doesNotMatch(allContent, /synthesis provider/i);
  assert.doesNotMatch(allContent, /existing decision engine/i);
  assert.doesNotMatch(allContent, /authoritative source/i);
  assert.doesNotMatch(allContent, /additional verification before this can be finalized/i);
  assert.doesNotMatch(allContent, /critical decision evidence remains unresolved/i);
  assert.doesNotMatch(allContent, /target_financials/);
  assert.doesNotMatch(allContent, /valuation_purchase_price/);
  assert.doesNotMatch(allContent, /integration_operational_risk/);
  assert.doesNotMatch(allContent, /\[Required:/);
  assert.doesNotMatch(allContent, /\[Unknown\]/);
  assert.doesNotMatch(allContent, /\[R\d+\]/);
  assert.doesNotMatch(allContent, /https?:\/\//i);

  // The real figures and analysis survive.
  assert.match(allContent, /Purchase price: \$40M/);
  assert.match(allContent, /Target ARR: \$10M/);
  assert.match(allContent, /EV\/ARR: 4\.0x/);
  assert.match(allContent, /Equity contribution: \$10M/);
  assert.match(allContent, /Debt requirement: \$30M/);
  assert.match(allContent, /The valuation should be reviewed further before closing\./);
  assert.match(
    allContent,
    /Comparable SaaS transactions average 3\.5x-4\.5x EV\/ARR, supporting the \$40M purchase price as fair against \$10M target ARR\./
  );
  assert.match(allContent, /Proceed conditionally on confirmed financing terms\./);
  assert.match(allContent, /Proceed conditionally: financing terms are the primary open item before close\./);
});

test("the exact $40M/$10M acquisition case: computeAcquisitionDerivedMetrics itself produces EV/ARR = 4.0x, $10M equity, $30M debt -- the reasoning/derivation logic is unchanged by this presentation-only fix", () => {
  const facts = extractAcquisitionDealFacts(
    "We are acquiring a cybersecurity SaaS company. Purchase price is $40M, target ARR is $10M, and buyer available capital is $10M."
  );
  assert.equal(facts.purchasePrice, 40_000_000);
  assert.equal(facts.targetArr, 10_000_000);
  assert.equal(facts.buyerAvailableCapital, 10_000_000);

  const derived = computeAcquisitionDerivedMetrics(facts);
  assert.equal(derived.evToArr, 4.0);
  assert.equal(derived.equityContribution, 10_000_000);
  assert.equal(derived.debtRequirement, 30_000_000);
});

// --- 7. Drift check: generation/reasoning engine untouched -----------------

test("plan-executor.ts's timeout-fallback and decision-intelligence's risk-engine.ts are unmodified by this fix -- they still produce the full internal-reasoning text; only presentation strips it (drift check)", async () => {
  const { readFileSync } = await import("node:fs");
  const planExecutorSource = readFileSync(
    new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
    "utf8"
  );
  const riskEngineSource = readFileSync(
    new URL("../app/lib/decision-intelligence/risk-engine.ts", import.meta.url),
    "utf8"
  );

  assert.match(planExecutorSource, /The synthesis provider reached its deadline/);
  assert.match(planExecutorSource, /the existing decision engine/);
  assert.match(riskEngineSource, /Critical decision evidence remains unresolved: \$\{field\}\./);
});
