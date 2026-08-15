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
