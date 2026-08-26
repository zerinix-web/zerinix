import assert from "node:assert/strict";
import test from "node:test";
import { runDecisionEngineV2 } from "../app/lib/decision-engine-v2/engine.ts";
import { assessRegulatoryLegalExposure } from "../app/lib/decision-engine-v2/dimensions.ts";
import { evidence, buildInput } from "./fixtures/decision-engine-v2-scenarios.mjs";

// Regulatory/legal severity tiering -- fixes the weakness identified in
// the prior Legacy-vs-V2 comparison report: a genuine regulatory
// PROHIBITION and a throwaway "licensing requirements may apply" line
// both used to feed the SAME single-tier "blocker" pattern list, and
// even a genuine prohibition only ever carried the dimension's ordinary
// 0.05 blend weight -- so a strong topline market could mathematically
// dilute an actual "this business cannot legally operate" finding down
// to CONDITIONAL_GO. These tests exercise the five distinguishable
// severity levels this fix introduces (REQUIREMENT 4) and the
// invariant that only a genuine hard blocker can bypass the weighted
// blend (REQUIREMENT 7/8), while everything below that tier still
// respects "missing/weak evidence != negative evidence" (REQUIREMENT
// 3/5/6).

function regulatoryDimension(sectionText) {
  const input = buildInput([], "Evaluate this market.", {
    barriers: sectionText,
  });
  return assessRegulatoryLegalExposure(input);
}

test("Tier 1 (unknown/insufficient): silence produces neutral, not unknown or negative -- unchanged baseline behavior", () => {
  const d = regulatoryDimension("");
  assert.equal(d.state, "neutral");
  assert.equal(d.score, 50);
  assert.equal(d.isHardBlocker, undefined);
});

test("Tier 1 (unknown/insufficient): an explicit statement that regulatory status is unresolved reads as unknown, not negative", () => {
  const d = regulatoryDimension(
    "The regulatory status of this category is unclear and requires further legal review to determine applicability."
  );
  assert.equal(d.state, "unknown");
  assert.equal(d.score, null);
  assert.notEqual(d.isHardBlocker, true);
});

test("Tier 2 (minor/manageable): a generic, routine compliance mention is NOT treated as a blocker or a negative finding", () => {
  // REQUIREMENT 6's literal example.
  const d = regulatoryDimension("Standard business licensing requirements may apply, as with most companies in this category.");
  assert.equal(d.state, "neutral");
  assert.equal(d.score, 50);
  assert.equal(d.isHardBlocker, undefined);
});

test("Tier 2 (minor/manageable): a bare 'licensing requirement' mention with no severity language stays neutral", () => {
  const d = regulatoryDimension("This category has a licensing requirement typical of the industry.");
  assert.equal(d.state, "neutral");
  assert.notEqual(d.state, "weak");
  assert.notEqual(d.state, "unfavorable");
});

test("Tier 3 (meaningful regulatory risk): a specific, named regulatory risk is real but does NOT set the hard-blocker flag", () => {
  const d = regulatoryDimension(
    "This category requires FDA approval and is heavily regulated with significant compliance risk."
  );
  assert.ok(d.state === "weak" || d.state === "unfavorable");
  assert.notEqual(d.isHardBlocker, true, "a material risk is not by itself evidence the business cannot operate");
  assert.ok(d.contradictingEvidence.length > 0);
});

test("PRE-COMMIT AUDIT FIX: a partial/regional restriction ('not permitted to operate in some states') is NOT a hard blocker, even though it uses prohibition-tier vocabulary", () => {
  const d = regulatoryDimension(
    "This service is not permitted to operate in some states due to local licensing rules, though it operates legally elsewhere."
  );
  assert.notEqual(d.isHardBlocker, true, "a regionally-qualified restriction must not bypass every other dimension the way a categorical prohibition does");
  assert.ok(d.state === "weak" || d.state === "unfavorable", "it is still real, material regulatory risk -- just not a categorical blocker");
  assert.ok(d.contradictingEvidence.length > 0);
});

test("PRE-COMMIT AUDIT FIX: a categorical prohibition still sets the hard-blocker flag even when the pattern list also matches partial-scope language elsewhere in a DIFFERENT sentence", () => {
  const input = buildInput([], "Evaluate this market.", {
    barriers:
      "This business model is currently illegal in this jurisdiction and cannot legally operate. A related service is not permitted to operate in some neighboring states.",
  });
  const d = assessRegulatoryLegalExposure(input);
  assert.equal(d.isHardBlocker, true, "a genuine categorical prohibition elsewhere in the prose must still fire regardless of an unrelated partial-scope sentence");
});

test("Tier 4 (explicit blocker/prohibition): an explicit statement the business cannot legally operate sets the hard-blocker flag", () => {
  const d = regulatoryDimension(
    "This business model is currently illegal in the target jurisdiction and cannot legally operate."
  );
  assert.equal(d.state, "weak");
  assert.equal(d.isHardBlocker, true);
  assert.ok(d.score !== null && d.score <= 10, "a genuine prohibition should score at the very bottom of the range");
  assert.ok(d.contradictingEvidence.length > 0);
});

// --- Decision-level invariants -------------------------------------------

test("INVARIANT (fix target): a genuine regulatory prohibition forces NO_GO even when every other dimension is strong/favorable -- not diluted by an attractive market", () => {
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "market_size",
        url: "https://www.census.gov/market-size",
        sourceType: "official_statistics",
        claim: "The market size is $5 billion.",
      }),
      evidence({
        id: "R2",
        field: "competitors",
        url: "https://competitor-a.example.com",
        claim: "The market is fragmented with no clear dominant player.",
      }),
      evidence({
        id: "R3",
        field: "pricing_models",
        url: "https://competitor-a.example.com/pricing",
        claim: "Vendors charge $500/month per seat with healthy margins.",
      }),
    ],
    "Evaluate this market.",
    {
      marketOverview: "Demand is growing rapidly, with strong adoption across the segment.",
      marketDrivers: "Structural demand growth in the category continues to accelerate.",
      competitiveLandscape: "The market is fragmented with no clear dominant player.",
      marketSegmentation: "Vendors report healthy margins and attractive pricing for this category.",
      opportunities: "A clear, defensible whitespace exists for a differentiated offering.",
      barriers:
        "This business model is currently illegal in this jurisdiction and cannot legally operate.",
    }
  );

  const result = runDecisionEngineV2(input);
  assert.equal(result.decision, "NO_GO", "a genuine legal prohibition must win over an otherwise strong market");
  assert.equal(result.invariants.noGoJustifiedByHardBlocker, true);
  const regulatory = result.dimensions.find((d) => d.key === "regulatoryLegalExposure");
  assert.equal(regulatory.isHardBlocker, true);
  assert.ok(result.reasoning.executiveRationale.toLowerCase().includes("cannot legally"));
});

test("REQUIREMENT 7: a material (non-prohibition) regulatory risk alone does not force NO_GO when the rest of the market is strong", () => {
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "market_size",
        url: "https://www.census.gov/market-size",
        sourceType: "official_statistics",
        claim: "The market size is $5 billion.",
      }),
      evidence({
        id: "R2",
        field: "competitors",
        url: "https://competitor-a.example.com",
        claim: "The market is fragmented with no clear dominant player.",
      }),
    ],
    "Evaluate this market.",
    {
      marketOverview: "Demand is growing rapidly, with strong adoption across the segment.",
      marketDrivers: "Structural demand growth in the category continues to accelerate.",
      competitiveLandscape: "The market is fragmented with no clear dominant player.",
      opportunities: "A clear, defensible whitespace exists for a differentiated offering.",
      barriers: "This category requires FDA approval and is heavily regulated with significant compliance risk.",
    }
  );

  const result = runDecisionEngineV2(input);
  assert.notEqual(result.decision, "NO_GO", "a real but non-prohibitive regulatory risk must not unilaterally force NO_GO");
  assert.equal(result.invariants.noGoJustifiedByHardBlocker, false);
});

test("REQUIREMENT 8: a genuine prohibition still produces NO_GO even with sparse/unknown evidence elsewhere (not conditioned on other dimensions being assessed)", () => {
  const input = buildInput([], "Evaluate this market.", {
    barriers: "This activity is prohibited under current law and cannot legally operate in this market.",
  });

  const result = runDecisionEngineV2(input);
  assert.equal(result.decision, "NO_GO");
  assert.equal(result.invariants.noGoJustifiedByHardBlocker, true);
});

test("missing regulatory evidence never contributes a negative score to the blend (REQUIREMENT 5, drift check against the fix)", () => {
  const input = buildInput([], "Evaluate an obscure market.", {});
  const result = runDecisionEngineV2(input);
  const regulatory = result.dimensions.find((d) => d.key === "regulatoryLegalExposure");
  assert.equal(regulatory.state, "neutral");
  assert.equal(regulatory.score, 50);
  assert.notEqual(regulatory.isHardBlocker, true);
});

test("a confidently-identified prohibition scores high confidence, consistent with 'confidence measures certainty, not attractiveness' (REQUIREMENT 3)", () => {
  const prohibitionInput = buildInput(
    [
      evidence({
        id: "R1",
        field: "market_size",
        url: "https://www.census.gov/market-size",
        sourceType: "official_statistics",
        claim: "The market size is $5 billion.",
        confidence: 95,
        qualityScore: 90,
      }),
    ],
    "Evaluate this market.",
    {
      marketOverview: "Demand is growing rapidly across this large category.",
      barriers: "This business model is currently illegal in this jurisdiction and cannot legally operate.",
    }
  );

  const result = runDecisionEngineV2(prohibitionInput);
  assert.equal(result.decision, "NO_GO");
  // The regulatory finding itself is read with low uncertainty (a direct,
  // unhedged statement) -- confidence should not collapse just because
  // this NO_GO was reached via the hard-blocker path rather than the
  // ordinary blended path.
  assert.ok(result.confidence >= 40, `expected a directly-evidenced prohibition to still carry reasonable confidence, got ${result.confidence}`);
});
