import assert from "node:assert/strict";
import test from "node:test";
import {
  findReportIsolationViolations,
  getForbiddenTermLabels,
} from "../app/lib/report-engine/report-isolation-validator.ts";
import { buildMarketLanguageInstructions } from "../app/lib/report-engine/prompts/market.ts";

// The Report Isolation guard correctly rejected a live Market Intelligence
// report that used the word "Runway" -- a Business Idea Validation
// (founder/investment) term. Root cause: the Market Intelligence generation
// prompt's own "never generate X" exclusion list never named "Runway" (or
// several of the isolation validator's other forbidden terms), so nothing
// told the model to avoid it, even though the validator has always
// rejected it. Fixed by generating the prompt's forbidden-vocabulary
// instruction FROM the validator's own term list (report-isolation-validator.ts's
// getForbiddenTermLabels) instead of a separately hand-maintained copy, so
// the two can never drift apart again. The validator itself is unchanged
// and unweakened -- these tests confirm both sides of that.

test("the isolation validator still rejects 'Runway' in Market Intelligence content (not weakened)", () => {
  const violations = findReportIsolationViolations("market_intelligence", {
    threats: "New entrants may face a limited cash runway before profitability.",
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].term, "Runway");
});

test("getForbiddenTermLabels('market_intelligence') includes Runway and the other founder/investment terms", () => {
  const labels = getForbiddenTermLabels("market_intelligence");
  assert.ok(labels.includes("Runway"));
  assert.ok(labels.includes("EBITDA"));
  assert.ok(labels.includes("Founder Readiness"));
});

test("the Market Intelligence generation prompt now explicitly forbids Runway/EBITDA and every other isolation-validator term, generated from the same list", () => {
  const instructions = buildMarketLanguageInstructions("English");
  for (const label of getForbiddenTermLabels("market_intelligence")) {
    assert.ok(
      instructions.includes(label),
      `expected the generation prompt to name "${label}" as forbidden vocabulary`
    );
  }
});

test("ordinary market-research financial language (capital position, funding history) is never flagged -- the fix does not weaken or broaden the validator", () => {
  const violations = findReportIsolationViolations("market_intelligence", {
    threats:
      "A well-capitalized incumbent's strong capital position and funding history give it room to undercut pricing during a downturn.",
  });
  assert.equal(violations.length, 0);
});

// ---------------------------------------------------------------------------
// ROUND 2 -- Task #10.1: the exact reported production failure.
//
// ROOT CAUSE: unlike every other entry in founderInvestmentTerms (a
// multi-word compound, a canonical acronym, or a word already requiring a
// specific following term), "Runway" was a completely bare, context-free
// `\brunway\b` match. "Runway" is an ordinary English word/metaphor
// ("the fastest adoption runway", "a long runway for growth") with no
// connection to the Business-Plan cash-runway concept -- the validator
// rejected a live Market Intelligence report for exactly this reason:
// found 1 foreign-report term(s): [marketSegmentation] "Runway".
//
// FIX: "Runway" and "Fundraising" (the same class of ordinary-word/
// legitimate-market-category false positive -- a report analyzing the
// crowdfunding/fundraising-platforms market needs the word "fundraising"
// as its actual subject) now require genuine cash/startup-financing
// context nearby (cash, burn rate, capital, profitability, months of
// runway, seed/angel/VC/investor/founder, etc.) rather than a bare-word
// match. Every genuinely foreign Business-Plan usage from BEFORE this fix
// (see the "not weakened" tests above, and the exact production bug
// report's own phrasing below) is still rejected identically.
// ---------------------------------------------------------------------------

test("ROUND 2 (the exact reported false positive): ordinary market-adoption/growth-speed 'runway' language is no longer flagged in a Market Intelligence report", () => {
  const violations = findReportIsolationViolations("market_intelligence", {
    marketSegmentation:
      "This segment shows the fastest adoption runway among comparable buyer categories, driven by low switching costs and clear ROI.",
  });
  assert.equal(violations.length, 0, "an adoption-speed metaphor must never be treated as a Business-Plan cash-runway leak");
});

test("ROUND 2: other ordinary 'runway' metaphors (long runway ahead, runway for growth, runway to scale) are never flagged", () => {
  const samples = [
    "Incumbents have a long runway ahead before saturation sets in.",
    "The segment offers a healthy runway for growth over the next decade.",
    "New entrants have a short runway to scale before incumbents react.",
  ];
  for (const marketSegmentation of samples) {
    const violations = findReportIsolationViolations("market_intelligence", { marketSegmentation });
    assert.equal(violations.length, 0, `expected no violation for: "${marketSegmentation}"`);
  }
});

test("ROUND 2 (regression guard, not weakened): the exact production bug-report phrasing for a genuine cash-runway leak is still rejected", () => {
  const violations = findReportIsolationViolations("market_intelligence", {
    tamSamSom: "Runway is 14 months and EBITDA margin is healthy.",
  });
  const terms = violations.map((v) => v.term);
  assert.ok(terms.includes("Runway"), "a genuine numeric cash-runway statement must still be rejected");
  assert.ok(terms.includes("EBITDA"));
});

test("ROUND 2 (regression guard, not weakened): 'months of runway', 'runway of N-M months', and runway near burn-rate language are all still rejected", () => {
  const samples = [
    "The typical challenger has only 8 months of runway remaining.",
    "Runway of 12-18 months is typical for seed-stage entrants in this space.",
    "A high burn rate can shorten runway considerably for new entrants.",
    "Runway remaining: 14 months.",
  ];
  for (const threats of samples) {
    const violations = findReportIsolationViolations("market_intelligence", { threats });
    assert.ok(
      violations.some((v) => v.term === "Runway"),
      `expected a genuine cash-runway statement to still be rejected: "${threats}"`
    );
  }
});

test("ROUND 2 (adversarial, regression guard): an adoption-runway sentence that happens to also mention an unrelated time period ('the coming months') is still never flagged -- 'months' near 'runway' alone is not enough, only genuine financial context is", () => {
  const violations = findReportIsolationViolations("market_intelligence", {
    marketSegmentation: "Incumbents have a long runway ahead before saturation sets in over the coming months.",
  });
  assert.equal(violations.length, 0);
});

test("ROUND 2: a Market Intelligence report legitimately analyzing the crowdfunding/fundraising-platforms market is never flagged for using its own subject's name", () => {
  const samples = [
    "The global fundraising platforms market is projected to grow as donation-based and reward-based fundraising software adoption increases.",
    "Nonprofit fundraising trends show a shift toward peer-to-peer campaigns.",
  ];
  for (const majorPlayers of samples) {
    const violations = findReportIsolationViolations("market_intelligence", { majorPlayers });
    assert.equal(violations.length, 0, `expected no violation for: "${majorPlayers}"`);
  }
});

test("ROUND 2 (regression guard, not weakened): genuine startup-fundraising leaks (seed round, funding round, Series A, founder's own fundraising timeline) are still rejected in Market Intelligence content", () => {
  const samples = [
    "The founder's fundraising timeline includes a seed round planned for Q3.",
    "The company closed a funding round of $5M last year.",
    "The company closed a seed round last quarter.",
    "The company raised a Series A round of $10M.",
  ];
  for (const executiveSummary of samples) {
    const violations = findReportIsolationViolations("market_intelligence", { executiveSummary });
    assert.ok(
      violations.some((v) => v.term === "Fundraising"),
      `expected a genuine startup-fundraising statement to still be rejected: "${executiveSummary}"`
    );
  }
});

test("ROUND 2 (parity): the identical Runway/Fundraising fix applies to strategic_advisory too, since it reuses founderInvestmentTerms", () => {
  const ordinary = findReportIsolationViolations("strategic_advisory", {
    marketSegmentation: "This segment shows the fastest adoption runway among comparable buyer categories.",
  });
  assert.equal(ordinary.length, 0);

  const genuine = findReportIsolationViolations("strategic_advisory", {
    threats: "New entrants may face a limited cash runway before profitability.",
  });
  assert.ok(genuine.some((v) => v.term === "Runway"));
});

test("ROUND 2 (parity): acquisition_due_diligence's own Fundraising fix (startupValidationEngineTerms) behaves identically -- ordinary fundraising-market language passes, genuine startup fundraising is still rejected", () => {
  const ordinary = findReportIsolationViolations("acquisition_due_diligence", {
    marketSegmentation: "The global fundraising platforms market is a key comparable for this target.",
  });
  assert.equal(ordinary.length, 0);

  const genuine = findReportIsolationViolations("acquisition_due_diligence", {
    executiveSummary: "The target's founder is currently mid-way through a seed round.",
  });
  assert.ok(genuine.some((v) => v.term === "Fundraising"));
});

test("ROUND 2 (documented, deliberately unweakened): LTV/ARR are reviewed for the same false-positive class (Loan-to-Value in mortgage markets; market-level SaaS ARR) but intentionally left as a strict bare-acronym match -- no safe, clean discriminator exists yet, so genuine unit-economics leaks must still be rejected", () => {
  const violations = findReportIsolationViolations("market_intelligence", {
    financialAssumptions: "Our CAC is $50 and LTV is $2,000, giving an LTV:CAC ratio of 40x.",
  });
  assert.ok(violations.some((v) => v.term === "Unit economics (CAC/LTV/ARR/MRR)"));
});
