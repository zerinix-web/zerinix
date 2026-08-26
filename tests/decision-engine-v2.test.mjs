import assert from "node:assert/strict";
import test from "node:test";
import { runDecisionEngineV2 } from "../app/lib/decision-engine-v2/engine.ts";
import { evidence, buildInput } from "./fixtures/decision-engine-v2-scenarios.mjs";

// Decision Engine V2 -- realistic decision-quality regression suite.
//
// These tests assert on DECISION BEHAVIOR (does the right code and
// invariant fire for a realistic evidence picture), not implementation
// details. Every fixture builds REAL MarketIntelligenceGraph/
// MarketResearchCoverage objects from crafted DomainResearchEvidence,
// the same way the live pipeline does, so these tests exercise the
// actual structured-data shape V2 consumes in production, not a
// hand-rolled mock that could drift from it.
//
// Fixtures A-J and the construction-AI scenario live in
// tests/fixtures/decision-engine-v2-scenarios.mjs, shared with
// scripts/decision-engine-v2-shadow-comparison.mjs so the regression
// suite and the controlled Legacy-vs-V2 comparison run against
// identical inputs.

// --- A. Strong opportunity + strong evidence --------------------------

test("A. strong opportunity with strong evidence across the board -> GO or a strongly supported CONDITIONAL_GO, never NO_GO", () => {
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "market_size",
        url: "https://www.census.gov/market-size",
        sourceType: "official_statistics",
        claim: "The market size is $2 billion.",
      }),
      evidence({
        id: "R2",
        field: "competitors",
        url: "https://competitor-a.example.com",
        claim: "Competitor A is a small vendor in a fragmented market with no clear dominant player.",
      }),
      evidence({
        id: "R3",
        field: "pricing_models",
        url: "https://competitor-a.example.com/pricing",
        claim: "Competitor A charges $500/month per seat.",
      }),
    ],
    "Evaluate this market.",
    {
      marketOverview: "Demand is growing rapidly, with strong adoption across the segment.",
      marketDrivers: "Structural demand growth in the category continues to accelerate.",
      customerSegments:
        "The target buyer is a mid-market operations team [R1] validated through direct interviews [R2].",
      competitiveLandscape: "The market is fragmented with no clear dominant player [R2].",
      opportunities: "A clear, defensible whitespace exists for a differentiated offering.",
      strategicRecommendations: "Pursue the identified whitespace with a focused go-to-market.",
      marketSegmentation: "Vendors report healthy margins and attractive pricing for this category.",
      barriers: "Sales cycles are short and integration is straightforward for target buyers.",
      threats: "No material regulatory exposure was identified for this category.",
      industryTrends: "No regulatory or compliance blocker applies to this category.",
    }
  );

  const result = runDecisionEngineV2(input);
  assert.notEqual(result.decision, "NO_GO");
  if (result.decision === "CONDITIONAL_GO") {
    assert.ok(result.confidence >= 40, "a strongly-evidenced CONDITIONAL_GO should still carry reasonable confidence");
  }
  assert.ok(result.marketQualityScore !== null && result.marketQualityScore >= 60);
});

// --- B. Strong opportunity + incomplete TAM ----------------------------

test("B. strong qualitative opportunity with incomplete/unverified TAM -> NOT automatic NO_GO", () => {
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "competitors",
        url: "https://competitor-a.example.com",
        claim: "Competitor A is a small vendor in a fragmented, underserved segment with no clear dominant player.",
      }),
    ],
    "Evaluate this market.",
    {
      marketOverview: "Demand is growing rapidly and the segment is underserved today.",
      marketDrivers: "Structural demand growth continues to accelerate in this category.",
      customerSegments: "Buyers report a clear, unmet need for this exact capability [R1].",
      competitiveLandscape: "The market is fragmented with no clear dominant player [R1].",
      opportunities: "A clear, defensible whitespace exists for a differentiated offering.",
      tamSamSom:
        "A verified market-size figure (TAM / SAM / SOM) could not be established for this market.",
      marketSize: "A defensible aggregate market-size figure could not be established for this market.",
    }
  );

  const result = runDecisionEngineV2(input);
  assert.notEqual(result.decision, "NO_GO");
  const marketAttractiveness = result.dimensions.find((d) => d.key === "marketAttractiveness");
  assert.equal(marketAttractiveness.state, "favorable", "qualitative demand evidence should still register as favorable despite missing TAM");
  assert.notEqual(marketAttractiveness.state, "unfavorable");
  assert.notEqual(marketAttractiveness.state, "weak");
});

// --- C. Weak opportunity + excellent evidence --------------------------

test("C. weak/declining opportunity, even with excellent evidence quality, can justify NO_GO", () => {
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "market_size",
        url: "https://www.census.gov/market-size",
        sourceType: "official_statistics",
        claim: "The market size is $2 billion.",
        confidence: 92,
        qualityScore: 88,
      }),
      evidence({
        id: "R2",
        field: "competitors",
        url: "https://dominant-incumbent.example.com",
        claim: "The dominant incumbent controls the majority of the market through high switching costs and network effects.",
        confidence: 92,
        qualityScore: 88,
      }),
    ],
    "Evaluate this market.",
    {
      marketOverview: "The overall category is well documented and mature.",
      marketDrivers: "Demand is declining as the category matures and shrinks.",
      competitiveLandscape:
        "A dominant incumbent controls this market through high switching costs and network effects [R2].",
      majorPlayers: "The dominant incumbent has an entrenched position with high switching costs [R2].",
      opportunities: "The offering would be commoditized and easily replicated by the incumbent.",
      threats: "Thin margins and price-sensitive buyers characterize this declining category.",
    }
  );

  const result = runDecisionEngineV2(input);
  assert.equal(result.decision, "NO_GO");
  // Excellent evidence quality should translate into HIGH confidence in
  // this NO_GO, not low confidence -- confidence tracks certainty in the
  // decision, not how attractive the market looks (INVARIANT 6).
  assert.ok(result.confidence >= 55, `expected reasonably high confidence given strong evidence quality, got ${result.confidence}`);
});

// --- D. Attractive market + severe competitive disadvantage -------------

test("D. attractive market with a severe competitive disadvantage -> CONDITIONAL_GO or NO_GO, never a clean GO", () => {
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
        url: "https://dominant-incumbent.example.com",
        claim: "A dominant incumbent controls this market with strong network effects.",
      }),
    ],
    "Evaluate this market.",
    {
      marketOverview: "Demand is growing rapidly across this large category.",
      marketDrivers: "Structural demand growth continues to accelerate.",
      competitiveLandscape: "A dominant incumbent controls this market with strong network effects [R2].",
      majorPlayers: "The incumbent's network effects create high switching costs for buyers.",
      opportunities: "The category itself is attractive despite the competitive structure.",
    }
  );

  const result = runDecisionEngineV2(input);
  assert.notEqual(result.decision, "GO");
});

// --- E. Large TAM + weak customer problem --------------------------------

test("E. large TAM alone, with a weak/undifferentiated customer-problem signal, must not create GO", () => {
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "market_size",
        url: "https://www.census.gov/market-size",
        sourceType: "official_statistics",
        claim: "The market size is $50 billion.",
      }),
    ],
    "Evaluate this market.",
    {
      marketOverview: "This is simply a large, generic category.",
      opportunities: "The offering would be commoditized and easily replicated.",
      customerSegments: "",
    }
  );

  const result = runDecisionEngineV2(input);
  assert.notEqual(result.decision, "GO", "a large TAM alone must never be sufficient for GO");
});

// --- F. Small/niche market + strong economics ----------------------------

test("F. a small/niche market with strong economics must not automatically become NO_GO", () => {
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "pricing_models",
        url: "https://niche-vendor.example.com/pricing",
        claim: "Niche Vendor charges a premium annual contract value with healthy margins.",
      }),
      evidence({
        id: "R2",
        field: "competitors",
        url: "https://niche-vendor.example.com",
        claim: "The niche segment is underserved with no clear dominant player.",
      }),
    ],
    "Evaluate this market.",
    {
      marketOverview: "This is a small, specialized niche category.",
      marketSegmentation: "Vendors report healthy margins and attractive pricing for this niche.",
      competitiveLandscape: "The niche segment is underserved with no clear dominant player [R2].",
      opportunities: "A clear whitespace exists within this specialized niche.",
    }
  );

  const result = runDecisionEngineV2(input);
  assert.notEqual(result.decision, "NO_GO", "no dimension here carries negative evidence -- a niche size alone must not trigger NO_GO");
});

// --- G. Contradictory evidence ------------------------------------------

test("G. contradictory evidence across dimensions lowers confidence and is surfaced explicitly, never silently averaged away", () => {
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
        url: "https://dominant-incumbent.example.com",
        claim: "A dominant incumbent controls this market with high switching costs and network effects.",
      }),
    ],
    "Evaluate this market.",
    {
      marketOverview: "Demand is growing rapidly with strong structural tailwinds.",
      marketDrivers: "Structural demand growth continues to accelerate significantly.",
      competitiveLandscape: "A dominant incumbent controls this market with high switching costs and network effects [R2].",
      opportunities: "Despite strong demand, the competitive position is difficult.",
    }
  );

  const result = runDecisionEngineV2(input);
  assert.ok(
    result.reasoning.criticalUncertainties.some((u) => /disagree/i.test(u)),
    "a contradiction between strong demand and severe competitive disadvantage should be surfaced explicitly"
  );
});

// --- H. Very poor evidence coverage --------------------------------------

test("H. very poor evidence coverage -> a validation requirement (CONDITIONAL_GO, low confidence), never fabricated certainty in either direction", () => {
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "market_overview",
        url: "https://example.com/general",
        claim: "General commentary about the market with no specific numeric or qualitative findings.",
      }),
    ],
    "Evaluate this obscure market.",
    {
      marketOverview: "General commentary about the market with no specific numeric findings.",
    }
  );

  const result = runDecisionEngineV2(input);
  assert.notEqual(result.decision, "GO");
  assert.notEqual(result.decision, "NO_GO");
  assert.equal(result.decision, "CONDITIONAL_GO");
  assert.ok(result.confidence < 55, `expected low confidence given how little evidence exists, got ${result.confidence}`);
  assert.ok(result.dimensions.filter((d) => d.state === "unknown").length >= 5);
});

// --- I. Serious regulatory/economic blocker ------------------------------

test("I. a serious, explicitly evidenced regulatory blocker can justify NO_GO", () => {
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "market_size",
        url: "https://www.census.gov/market-size",
        sourceType: "official_statistics",
        claim: "The market size is $3 billion.",
      }),
      evidence({
        id: "R2",
        field: "industry_structure",
        url: "https://regulator.example.gov",
        sourceType: "official_statistics",
        claim: "This category requires FDA approval and is heavily regulated with significant compliance risk.",
      }),
    ],
    "Evaluate this market.",
    {
      marketOverview: "Demand is growing rapidly across this category.",
      marketDrivers: "Structural demand growth continues to accelerate.",
      barriers: "This category requires FDA approval and is heavily regulated with significant compliance risk.",
      threats: "Regulatory uncertainty and pending litigation affect several incumbents.",
      competitiveLandscape: "A dominant incumbent controls this market with high switching costs.",
    }
  );

  const result = runDecisionEngineV2(input);
  assert.notEqual(result.decision, "GO");
  const regulatory = result.dimensions.find((d) => d.key === "regulatoryLegalExposure");
  assert.notEqual(regulatory.state, "unknown", "an explicitly evidenced regulatory blocker must never read as unknown");
});

// --- J. Missing competitor data -------------------------------------------

test("J. missing competitor data produces uncertainty, never an automatic negative competitive judgment", () => {
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "market_size",
        url: "https://www.census.gov/market-size",
        sourceType: "official_statistics",
        claim: "The market size is $1 billion.",
      }),
    ],
    "Evaluate this market.",
    {
      marketOverview: "Demand is growing rapidly across this category.",
      marketDrivers: "Structural demand growth continues to accelerate.",
      competitiveLandscape: "Independent, publicly available information on named competitors was limited during research.",
    }
  );

  const result = runDecisionEngineV2(input);
  const competitive = result.dimensions.find((d) => d.key === "competitiveIntensity");
  assert.equal(competitive.state, "unknown");
  assert.notEqual(result.decision, "NO_GO", "missing competitor data alone must never justify NO_GO");
});

// --- Construction AI market fixture (matches the live-tested scenario) --

test("Construction AI risk-intelligence SaaS fixture: real buyer population + no pricing evidence -> CONDITIONAL_GO or GO, never NO_GO purely from missing pricing", () => {
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "market_demand",
        url: "https://www.census.gov/data/construction-establishments.html",
        sourceType: "official_statistics",
        claim: "There are 212,178 employer establishments in NAICS 23611 (Residential Building Construction).",
      }),
      evidence({
        id: "R2",
        field: "competitors",
        url: "https://www.prnewswire.com/news/shepherd-brickeye",
        claim: "Shepherd and Brickeye partner to bring IoT risk intelligence into autonomous underwriting for construction sites.",
      }),
      evidence({
        id: "R3",
        field: "competitors",
        url: "https://support.procore.com/integrations/procore-analytics",
        claim: "Procore offers an analytics risk-report feature for construction project management.",
      }),
    ],
    "Evaluate whether launching an AI-powered construction risk intelligence SaaS for small and mid-sized general contractors in the United States is commercially attractive.",
    {
      marketOverview: "The construction technology category shows growing adoption of risk and safety analytics tools.",
      marketDrivers: "Insurers and general contractors show growing demand for jobsite risk intelligence.",
      customerSegments:
        "Small and mid-sized general contractors represent a large addressable buyer population [R1].",
      competitiveLandscape:
        "Procore and IoT-risk specialists like Brickeye/Shepherd are active in this fragmented category [R2] [R3].",
      tamSamSom:
        "ZERINIX identified approximately 212,178 qualifying buyers/establishments from [R1], but could not establish a sufficiently reliable annual spend, subscription, or contract-value benchmark for this product category.",
      opportunities: "Selling validated jobsite risk signals to insurers is an emerging opportunity.",
    }
  );

  const result = runDecisionEngineV2(input);
  assert.notEqual(
    result.decision,
    "NO_GO",
    `expected a real buyer population + real named competitors to avoid automatic NO_GO from missing pricing alone, got ${result.decision}`
  );
  const marketAttractiveness = result.dimensions.find((d) => d.key === "marketAttractiveness");
  assert.notEqual(marketAttractiveness.state, "unfavorable");
  assert.notEqual(marketAttractiveness.state, "weak");
  const competitive = result.dimensions.find((d) => d.key === "competitiveIntensity");
  assert.notEqual(competitive.state, "unknown", "two named, evidenced competitors should register competitive intensity as assessable");
});

// --- Invariant-level checks -----------------------------------------------

test("INVARIANT 1/2: missing evidence alone can never constitute negative evidence or justify NO_GO", () => {
  const input = buildInput([], "Evaluate an obscure, poorly documented market.", {});
  const result = runDecisionEngineV2(input);
  assert.notEqual(result.decision, "NO_GO");
  assert.ok(result.dimensions.every((d) => d.state !== "weak" && d.state !== "unfavorable"));
});

test("INVARIANT 4: a GO-quality market picture with dangerously low evidence completeness is downgraded to a provisional CONDITIONAL_GO, not a full GO", () => {
  // Only one of seven dimensions is assessable (marketAttractiveness),
  // even though it happens to look very strong -- evidence completeness
  // must block a full GO here.
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "market_size",
        url: "https://www.census.gov/market-size",
        sourceType: "official_statistics",
        claim: "The market size is $10 billion.",
      }),
    ],
    "Evaluate this market.",
    {
      marketOverview: "Demand is growing rapidly with strong structural tailwinds.",
      marketDrivers: "Structural demand growth continues to accelerate significantly.",
    }
  );

  const result = runDecisionEngineV2(input);
  assert.notEqual(result.decision, "GO");
  if (result.invariants.goDowngradedToConditional) {
    assert.equal(result.decision, "CONDITIONAL_GO");
    assert.ok(result.invariants.provisional);
  }
});

test("INVARIANT 6/7: confidence reflects certainty, not attractiveness -- a confidently-reached NO_GO can score higher confidence than an uncertain CONDITIONAL_GO", () => {
  const confidentNoGo = buildInput(
    [
      evidence({
        id: "R1",
        field: "market_size",
        url: "https://www.census.gov/market-size",
        sourceType: "official_statistics",
        claim: "The market size is $2 billion.",
        confidence: 95,
        qualityScore: 90,
      }),
      evidence({
        id: "R2",
        field: "competitors",
        url: "https://dominant-incumbent.example.com",
        claim: "A dominant incumbent controls this market with high switching costs and network effects.",
        confidence: 95,
        qualityScore: 90,
      }),
    ],
    "Evaluate this market.",
    {
      marketDrivers: "Demand is declining as the category shrinks.",
      competitiveLandscape: "A dominant incumbent controls this market with high switching costs and network effects [R2].",
      opportunities: "The offering would be commoditized and easily replicated.",
    }
  );
  const uncertainConditional = buildInput(
    [],
    "Evaluate this obscure market.",
    {}
  );

  const noGoResult = runDecisionEngineV2(confidentNoGo);
  const conditionalResult = runDecisionEngineV2(uncertainConditional);

  assert.equal(noGoResult.decision, "NO_GO");
  assert.equal(conditionalResult.decision, "CONDITIONAL_GO");
  assert.ok(
    noGoResult.confidence > conditionalResult.confidence,
    `expected the well-evidenced NO_GO (${noGoResult.confidence}) to score higher confidence than the evidence-starved CONDITIONAL_GO (${conditionalResult.confidence})`
  );
});

test("INVARIANT 3: NO_GO always carries at least one dimension with explicit negative evidence in its result", () => {
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "competitors",
        url: "https://dominant-incumbent.example.com",
        claim: "A dominant incumbent controls this market with high switching costs and network effects.",
      }),
      evidence({
        id: "R2",
        field: "industry_structure",
        url: "https://regulator.example.gov",
        sourceType: "official_statistics",
        claim: "This category requires FDA approval and is heavily regulated with significant compliance risk.",
      }),
    ],
    "Evaluate this market.",
    {
      marketDrivers: "Demand is declining and the category is shrinking.",
      competitiveLandscape: "A dominant incumbent controls this market with high switching costs and network effects [R1].",
      barriers: "This category requires FDA approval and is heavily regulated with significant compliance risk.",
      opportunities: "The offering would be commoditized and easily replicated.",
    }
  );

  const result = runDecisionEngineV2(input);
  if (result.decision === "NO_GO") {
    const negativeDimensions = result.dimensions.filter((d) => d.state === "weak" || d.state === "unfavorable");
    assert.ok(negativeDimensions.length > 0);
    assert.ok(result.reasoning.strongestNegativeEvidence.length > 0);
  }
});

test("PDF/dashboard consumers read the same canonical result: DecisionV2Result is a single, self-contained object with no field requiring re-derivation from prose", () => {
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "market_size",
        url: "https://www.census.gov/market-size",
        sourceType: "official_statistics",
        claim: "The market size is $2 billion.",
      }),
    ],
    "Evaluate this market.",
    { marketDrivers: "Structural demand growth continues to accelerate." }
  );
  const result = runDecisionEngineV2(input);

  assert.ok(["GO", "CONDITIONAL_GO", "NO_GO"].includes(result.decision));
  assert.ok(typeof result.confidence === "number" && result.confidence >= 0 && result.confidence <= 100);
  assert.ok(["high", "moderate", "low", "very_low"].includes(result.confidenceBand));
  assert.equal(result.dimensions.length, 7);
  assert.ok(result.reasoning.executiveRationale.length > 0);
  assert.doesNotMatch(result.reasoning.executiveRationale, /\d{2,}(?:\.\d+)?\s*(?:million|billion)/i, "reasoning must never fabricate a number not already present in the dimension data");
});
