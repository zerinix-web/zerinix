import assert from "node:assert/strict";
import test from "node:test";
import { runDecisionEngineV2 } from "../app/lib/decision-engine-v2/engine.ts";
import { assessEconomicViability } from "../app/lib/decision-engine-v2/dimensions.ts";
import { evidence, buildInput } from "./fixtures/decision-engine-v2-scenarios.mjs";

// economicViability -- fixes the weakness identified in the prior
// Legacy-vs-V2 comparison report: the dimension required BOTH
// graph-validated pricing evidence AND explicit positive economic text
// before ever returning "favorable" -- so a report with clear, specific
// positive economic language but no independently validated pricing
// evidence fell through every branch and landed on "unknown", silently
// discarding real evidence (confirmed live: Scenario A's "healthy
// margins and attractive pricing" text never registered because
// graph.pricingModels stayed empty). A second bug: the negative branch
// only fired when there was ZERO positive text, so a report containing
// BOTH a positive and a negative economic claim silently resolved
// toward "favorable" whenever pricing evidence happened to exist,
// discarding a genuine contradiction.

function economicDimension(sections, evidenceItems = []) {
  const input = buildInput(evidenceItems, "Evaluate this market.", sections);
  return assessEconomicViability(input);
}

// --- Adversarial scenario 1: strong pricing evidence, no textual sentiment

test("1. strong graph-validated pricing evidence with NO textual sentiment -> neutral (real evidence, no verdict either way), never negative", () => {
  const d = economicDimension(
    { marketSegmentation: "Vendors in this category charge on a per-seat monthly basis." },
    [
      evidence({
        id: "R1",
        field: "pricing_models",
        url: "https://vendor-a.example.com/pricing",
        claim: "Vendor A charges $500/month per seat.",
      }),
    ]
  );
  assert.equal(d.state, "neutral");
  assert.notEqual(d.state, "unfavorable");
  assert.notEqual(d.state, "weak");
});

// --- Adversarial scenario 2: strong textual evidence, incomplete graph pricing (THE FIX)

test("2. strong positive economic text with NO graph-validated pricing evidence -> favorable, not unknown (the fix)", () => {
  const d = economicDimension({
    marketSegmentation: "Vendors report healthy margins and attractive pricing for this category.",
  });
  assert.equal(d.state, "favorable");
  assert.notEqual(d.state, "unknown", "a real, specific positive economic claim must not be discarded just because pricing wasn't graph-validated");
  assert.ok(d.supportingEvidence.length > 0);
});

// --- Adversarial scenario 3: missing economic evidence entirely

test("3. no pricing evidence and no economic text anywhere -> unknown, never a negative score", () => {
  const d = economicDimension({});
  assert.equal(d.state, "unknown");
  assert.equal(d.score, null);
});

test("3b. a market-size estimate alone (no pricing, no economic text) -> neutral, not unknown and not negative", () => {
  const d = economicDimension({}, [
    evidence({
      id: "R1",
      field: "market_size",
      url: "https://www.census.gov/market-size",
      sourceType: "official_statistics",
      claim: "The market size is $2 billion.",
    }),
  ]);
  assert.equal(d.state, "neutral");
  assert.notEqual(d.state, "unfavorable");
});

// --- Adversarial scenario 4: contradictory pricing/economic evidence

test("4. contradictory economic text (both positive and negative claims present) -> neutral with high uncertainty, not silently favorable", () => {
  const d = economicDimension(
    {
      marketSegmentation: "Vendors report healthy margins and attractive pricing for this category.",
      competitiveLandscape: "However, buyers in this category are highly price-sensitive and margins are thin.",
    },
    [
      evidence({
        id: "R1",
        field: "pricing_models",
        url: "https://vendor-a.example.com/pricing",
        claim: "Vendor A charges $500/month per seat.",
      }),
    ]
  );
  assert.equal(d.state, "neutral");
  assert.equal(d.uncertainty, "high");
  assert.ok(d.supportingEvidence.length > 0 && d.contradictingEvidence.length > 0);
});

test("4b. contradiction is recognized even when NO pricing evidence exists at all", () => {
  const d = economicDimension({
    marketSegmentation: "Vendors report healthy margins and attractive pricing for this category.",
    competitiveLandscape: "Buyers are highly price-sensitive and margins are thin across the category.",
  });
  assert.equal(d.state, "neutral");
  assert.equal(d.uncertainty, "high");
});

// --- Adversarial scenario 5: strong positive economics (both channels agree)

test("5. graph-validated pricing evidence AND explicit positive economic text together -> strong, low uncertainty (independent evidence converges)", () => {
  const d = economicDimension(
    { marketSegmentation: "Vendors report healthy margins and attractive pricing for this category." },
    [
      evidence({
        id: "R1",
        field: "pricing_models",
        url: "https://vendor-a.example.com/pricing",
        claim: "Vendor A charges $500/month per seat.",
      }),
    ]
  );
  assert.equal(d.state, "strong");
  assert.equal(d.uncertainty, "low");
});

test("5b. real negative text alone (no pricing, no positive) is still unfavorable -- unchanged, safety not weakened", () => {
  const d = economicDimension({
    marketSegmentation: "Buyers in this category are highly price-sensitive and margins are thin.",
  });
  assert.equal(d.state, "unfavorable");
  assert.ok(d.contradictingEvidence.length > 0);
});

test("pricing evidence plus a calculated market-size estimate (no explicit sentiment) -> favorable, not merely neutral", () => {
  const d = economicDimension({}, [
    evidence({
      id: "R1",
      field: "market_size",
      url: "https://www.census.gov/market-size",
      sourceType: "official_statistics",
      claim: "The market size is $2 billion.",
    }),
    evidence({
      id: "R2",
      field: "pricing_models",
      url: "https://vendor-a.example.com/pricing",
      claim: "Vendor A charges $500/month per seat.",
    }),
  ]);
  assert.equal(d.state, "favorable");
});

// --- Adversarial scenario 6: sparse economic evidence mixed with strong evidence elsewhere

test("6. sparse/unknown economic evidence alongside strong market attractiveness and competitive position must not create NO_GO or drag down an otherwise-good decision", () => {
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
      // No marketSegmentation/tamSamSom economic text and no pricing
      // evidence anywhere -- economicViability should read "unknown".
    }
  );

  const result = runDecisionEngineV2(input);
  const economic = result.dimensions.find((d) => d.key === "economicViability");
  // The fixture's market-size evidence gives economicViability a
  // calculated-TAM-only signal (tier 7 -> "neutral"), not total
  // silence -- either way, the safety property under test is that this
  // sparse economic picture never becomes negative or blocks the
  // decision.
  assert.ok(economic.state === "neutral" || economic.state === "unknown");
  assert.notEqual(economic.state, "unfavorable");
  assert.notEqual(economic.state, "weak");
  assert.notEqual(result.decision, "NO_GO", "sparse economic evidence alone, alongside an otherwise strong market, must never justify NO_GO");
});

test("PDF/dashboard consumers: economicViability's new 'strong' state is a first-class DimensionState, not an ad hoc value", () => {
  const d = economicDimension(
    { marketSegmentation: "Vendors report healthy margins and attractive pricing for this category." },
    [
      evidence({
        id: "R1",
        field: "pricing_models",
        url: "https://vendor-a.example.com/pricing",
        claim: "Vendor A charges $500/month per seat.",
      }),
    ]
  );
  assert.ok(["strong", "favorable", "neutral", "unfavorable", "weak", "unknown"].includes(d.state));
});
