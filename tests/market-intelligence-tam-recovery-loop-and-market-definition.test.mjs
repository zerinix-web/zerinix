import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";

// Evidence-first market sizing engine, second pass: upgrades the engine
// from "give up as soon as the strict direct search fails" into an
// active recovery loop -- proxy pricing recovery, adjacent-market
// top-down recovery via a real evidence-derived narrowing ratio, a
// canonical market definition with a geography-mismatch guard, an
// explicit TAM confidence threshold gating SAM, and specific "why
// VALIDATION NEEDED" explanations instead of a generic notice. Keeps the
// existing anti-hallucination guarantees: a smaller defensible number
// (or an honest gap) is always preferred over a larger speculative one.

const checkedAt = "2026-08-02T00:00:00.000Z";

function evidence({
  id,
  field,
  claim,
  value = claim,
  url,
  sourceType = "official company source",
  authorityLevel = "secondary",
  confidence = 76,
  qualityScore = 58,
  publishedDate = "2025-06-01",
  label = "Verified from external source",
}) {
  return {
    id,
    field,
    claim,
    value,
    label,
    sourceTitle: `${id} source`,
    publisher: `${id} publisher`,
    url,
    sourceType,
    authorityLevel,
    confidence,
    publishedDate,
    lastChecked: checkedAt,
    supportingData: [claim],
    impact: "neutral",
    impactReason: "Supports market-sizing coverage.",
    qualityScore,
    qualityRationale: "Directly relevant public source with valid provenance.",
  };
}

const prompt =
  "Evaluate whether launching an AI-powered construction risk intelligence SaaS for small and mid-sized general contractors in the United States is commercially attractive.";

// --- E. Buyer count exists, pricing missing: specific gap explanation ------

test("E. buyer count exists but pricing is missing everywhere (including proxy search) -- the gap explanation cites the real number found, not a generic notice", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://www.census.gov/data/construction-establishments.html",
          claim: "There are 212,178 employer establishments in NAICS 23611 (Residential Building Construction).",
        }),
      ],
    },
    prompt
  );

  assert.equal(graph.planningEstimate, null);
  assert.ok(graph.sizingGap);
  assert.equal(graph.sizingGap.missingIngredient, "pricing");
  assert.ok(graph.sizingGap.partialQuantity);
  assert.equal(graph.sizingGap.partialQuantity.amount, 212178);
  assert.match(graph.sizingGap.explanation, /212,178/);
  assert.match(graph.sizingGap.explanation, /pending pricing validation/i);
  assert.doesNotMatch(graph.sizingGap.explanation, /\$\d/, "must never invent a spend figure");
});

// --- F. Pricing exists, buyer population missing ---------------------------

test("F. pricing/spend evidence exists but no buyer-population count is found -- withheld, never guesses a population", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical annual subscription pricing for construction risk software is $12,000 per year.",
        }),
      ],
    },
    prompt
  );

  assert.equal(graph.planningEstimate, null);
  assert.ok(graph.sizingGap);
  // Real pricing evidence exists, so the gap correctly names the buyer
  // population as the specific missing ingredient rather than the fully
  // generic "everything" -- a real price without a population to apply
  // it to still cannot become a market size.
  assert.equal(graph.sizingGap.missingIngredient, "buyerPopulation");
  assert.doesNotMatch(graph.sizingGap.explanation, /\$\d/, "must never invent a market figure from price alone");
});

test("F2. pricing (direct) + a real population count that fails geography consistency -- population is not silently borrowed from a different country", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://example-uk-stats.gov.uk/construction-firms",
          claim: "There are 45,000 small construction firms in the United Kingdom.",
        }),
        evidence({
          id: "R2",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical annual subscription pricing for construction risk software is $12,000 per year.",
        }),
      ],
    },
    prompt // requests "the United States"
  );

  // The UK population figure must not be used as if it were the
  // requested (US) market's own buyer population.
  assert.equal(graph.planningEstimate, null);
  assert.ok(graph.sizingGap);
  assert.equal(graph.sizingGap.partialQuantity, null);
});

// --- G. Adjacent-market evidence only: proxy pricing recovery unlocks ------

test("G. no direct pricing evidence, but a comparable-product cost signal exists -- proxy pricing recovery unlocks a disclosed, lower-confidence bottom-up TAM", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://www.census.gov/data/construction-establishments.html",
          claim: "There are 60,635 employer establishments in NAICS 236115 (new single-family housing construction).",
        }),
        evidence({
          id: "R2",
          field: "company_evidence",
          url: "https://example-adjacent-vendor.com/about",
          claim: "A comparable construction-technology platform discloses an average customer contract value of $6,000.",
        }),
      ],
    },
    prompt
  );

  assert.ok(graph.planningEstimate, "proxy pricing recovery should have unlocked a bottom-up estimate");
  assert.equal(graph.planningEstimate.method, "bottomUp");
  assert.equal(graph.planningEstimate.pricingSource, "proxy");
  assert.ok(graph.planningEstimate.proxyDisclosure.length > 0);
  assert.match(graph.planningEstimate.proxyDisclosure, /proxy/i);
  assert.match(graph.planningEstimate.proxyDisclosure, /uncertainty/i);
  assert.match(graph.planningEstimate.tam, /\$363(?:\.\d)?M/);
  assert.equal(graph.planningEstimate.tier, "directional", "a proxy-priced estimate must never be tiered as fully supported");
});

test("G2. adjacent-market top-down recovery: a broader-category benchmark scaled by a real, evidence-derived population ratio produces a disclosed, directional TAM", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "global_benchmark",
          url: "https://www.marketresearchfirm.example/construction-technology-market",
          sourceType: "market_research",
          claim: "The broader construction technology software market is valued at $10 billion globally.",
        }),
        evidence({
          id: "R2",
          field: "market_demand",
          url: "https://www.census.gov/data/construction-establishments.html",
          claim: "There are 900,000 employer establishments across all construction sub-sectors (NAICS 23).",
        }),
        evidence({
          id: "R3",
          field: "market_demand",
          url: "https://www.census.gov/data/construction-risk-establishments.html",
          claim: "There are 90,000 employer establishments in the specific construction-risk-relevant sub-segment.",
        }),
      ],
    },
    prompt
  );

  assert.ok(graph.planningEstimate, "adjacent proxy top-down should have produced a bounded estimate");
  assert.equal(graph.planningEstimate.method, "adjacentProxy");
  assert.equal(graph.planningEstimate.tier, "directional");
  assert.match(graph.planningEstimate.tam, /\$1(?:\.0)?B/);
  assert.match(graph.planningEstimate.proxyDisclosure, /broader\/parent-category/i);
  assert.match(graph.planningEstimate.proxyDisclosure, /may not hold/i);
  assert.deepEqual(
    new Set(graph.planningEstimate.evidenceIds),
    new Set(["R1", "R2", "R3"])
  );
});

// --- K. SAM fails (blocked by low TAM confidence) -> SOM blocked -----------

test("K. a TAM that stacks multiple uncertainty penalties below the confidence threshold blocks SAM, which in turn blocks SOM -- the dependency chain holds even though TAM itself still renders", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        // adjacentProxy method (-18) + stale evidence (-10) stacks enough
        // penalty to push a moderate base confidence below the 20/100
        // unlock threshold.
        evidence({
          id: "R1",
          field: "global_benchmark",
          url: "https://www.marketresearchfirm.example/construction-technology-market",
          sourceType: "market_research",
          claim: "The broader construction technology software market was valued at $10 billion globally.",
          publishedDate: "2017-01-01",
          confidence: 50,
          qualityScore: 42,
        }),
        evidence({
          id: "R2",
          field: "market_demand",
          url: "https://www.census.gov/data/construction-establishments.html",
          claim: "There are 900,000 employer establishments across all construction sub-sectors (NAICS 23).",
          publishedDate: "2017-01-01",
          confidence: 50,
          qualityScore: 42,
        }),
        evidence({
          id: "R3",
          field: "market_demand",
          url: "https://www.census.gov/data/construction-risk-establishments.html",
          claim: "There are 90,000 employer establishments in the specific construction-risk-relevant sub-segment.",
          publishedDate: "2017-01-01",
          confidence: 50,
          qualityScore: 42,
        }),
      ],
    },
    prompt
  );

  assert.ok(graph.planningEstimate);
  assert.equal(graph.planningEstimate.method, "adjacentProxy");
  assert.ok(graph.planningEstimate.confidence < 20, `expected confidence below the unlock threshold, got ${graph.planningEstimate.confidence}`);
  assert.equal(graph.planningEstimate.samMethod, "blocked");
  assert.equal(graph.planningEstimate.somStatus, "pending");
  assert.doesNotMatch(graph.planningEstimate.sam, /\d/, "a blocked SAM must never carry a numeric figure");
  assert.doesNotMatch(graph.planningEstimate.som, /\d/, "SOM must stay blocked, never a numeric figure, when SAM is blocked");
  assert.match(graph.planningEstimate.formula, /SAM withheld/i);
});

// --- N. Geography mismatch guard --------------------------------------------

test("N. an explicit top-down figure scoped to a different named country is excluded from the direct pool, even though it matches every other pattern", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.gov.uk/construction-risk-software-market",
          sourceType: "official_statistics",
          claim: "The construction risk software market size in the United Kingdom is $200 million.",
        }),
      ],
    },
    prompt // explicitly "the United States"
  );

  assert.equal(graph.planningEstimate, null, "a UK-scoped figure must not be used as the US market's own TAM");
  assert.ok(graph.sizingGap);
});

test("N2. the same figure with no named geography conflict is used normally (regression guard -- the guard must not reject ordinary evidence)", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/construction-risk-software-market",
          sourceType: "official_statistics",
          claim: "The construction risk software market size is $200 million.",
        }),
      ],
    },
    prompt
  );

  assert.ok(graph.planningEstimate);
  assert.match(graph.planningEstimate.tam, /\$200(?:\.0)?M/);
});

// --- O. Market-definition construction (Section 1) --------------------------

test("O. the canonical market definition is built from the prompt and the anchor evidence, with an honest fallback for anything it cannot confidently extract", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/construction-risk-software-market",
          sourceType: "official_statistics",
          claim: "The construction risk software market size is $200 million.",
        }),
      ],
    },
    prompt
  );

  assert.ok(graph.planningEstimate);
  const { definition } = graph.planningEstimate;
  assert.equal(definition.geography, "United States");
  assert.equal(definition.companySize, "Small and mid-sized businesses (SMB/SME)");
  assert.match(definition.category, /construction risk intelligence/i);
  assert.match(definition.buyerSegment, /general contractors/i);
  assert.ok(definition.year.length === 4);
  assert.ok(definition.inclusions.length >= 2);
  assert.ok(definition.exclusions.length >= 2);
});

test("O2. a prompt with no clearly extractable category/buyer shape still produces an honest, non-fabricated definition (fallback path)", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/some-market",
          sourceType: "official_statistics",
          claim: "The widget market size is $50 million.",
        }),
      ],
    },
    "Tell me about widgets."
  );

  assert.ok(graph.planningEstimate);
  const { definition } = graph.planningEstimate;
  assert.equal(definition.buyerSegment, "Not specified in request");
  assert.equal(definition.companySize, "Not specified in request");
  assert.ok(definition.category.length > 0);
});

// --- P. Duplicate source handling --------------------------------------------

test("P. two evidence ids pointing at the same canonical URL never both count as independent corroboration for the planning estimate", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/construction-risk-software-market?utm_source=newsletter",
          sourceType: "official_statistics",
          claim: "The construction risk software market size is $200 million.",
        }),
        evidence({
          id: "R2",
          field: "market_size",
          // Same canonical URL as R1 (only a tracking parameter differs) --
          // a second discovery of the identical source, not independent
          // corroboration.
          url: "https://www.census.gov/construction-risk-software-market?utm_source=social",
          sourceType: "official_statistics",
          claim: "The construction risk software market size is $200 million.",
        }),
      ],
    },
    prompt
  );

  assert.ok(graph.planningEstimate);
  // Both evidence ids are legitimately citable, but the dedup that
  // collapses same-URL sources in graph.sources must still leave exactly
  // one representative row -- proving R1/R2 were never treated as two
  // independent sources when ranking/triangulating.
  const canonicalUrls = new Set(graph.sources.map((source) => source.url.split("?")[0]));
  assert.equal(graph.sources.filter((source) => source.url.includes("construction-risk-software-market")).length, 1);
  assert.ok(canonicalUrls.size >= 1);
});

// --- Confidence-state descriptor (Section 7) --------------------------------

test("confidenceState maps tier + confidenceLevel into the required VERIFIED/HIGH/MODERATE/DIRECTIONAL vocabulary without claiming false precision", () => {
  const highConfidenceGraph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/construction-risk-software-market",
          sourceType: "official_statistics",
          claim: "The construction risk software market size is $200 million.",
          confidence: 95,
          qualityScore: 90,
        }),
      ],
    },
    prompt
  );
  assert.ok(["highConfidence", "moderateConfidence"].includes(highConfidenceGraph.planningEstimate.confidenceState));

  const directionalGraph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://some-blog.example.com/construction-risk-software-market",
          sourceType: "news",
          claim: "One blog estimates the construction risk software market at $200 million.",
        }),
      ],
    },
    prompt
  );
  assert.equal(directionalGraph.planningEstimate.tier, "directional");
  assert.equal(directionalGraph.planningEstimate.confidenceState, "directional");
});

// --- Presentation: proxy disclosure and blocked-SAM text stay parseable -----

test("rendered tamSamSom never leaks the proxy disclosure or blocked-SAM text into a false numeric TAM/SAM/SOM parse for the existing web/PDF cascade", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://www.census.gov/data/construction-establishments.html",
          claim: "There are 60,635 employer establishments in NAICS 236115.",
        }),
        evidence({
          id: "R2",
          field: "company_evidence",
          url: "https://example-adjacent-vendor.com/about",
          claim: "A comparable construction-technology platform discloses an average customer contract value of $6,000.",
        }),
      ],
    },
    prompt
  );
  const projection = projectMarketIntelligenceGraphToReport(graph);

  function extractLine(content, label) {
    const match = content.match(new RegExp(`\\b${label}\\b\\s*\\[[^\\]]*\\]:\\s*([^\\n]*)`, "i"));
    return match ? match[1] : "";
  }
  function parseMagnitude(value) {
    // Faithful copy of page.tsx's real parseMonetaryMagnitude, including
    // its known quirk: a bare trailing "." or "," in ordinary prose (no
    // digits at all) satisfies [\d.,]+ and parses to NaN. In the real
    // cascade this is harmless -- `NaN <= x` is always false, so the
    // layer still correctly reads as unresolved -- but a NaN must be
    // normalized to null here to assert that behavior correctly rather
    // than treating NaN as "some real magnitude".
    const matches = [...(value || "").matchAll(/([\d.,]+)\s*(thousand|million|billion|trillion|[kKmMbBtT])?/g)];
    const last = matches.filter((c) => c[1]).at(-1);
    if (!last) return null;
    const num = parseFloat(last[1].replace(/,/g, ""));
    if (!Number.isFinite(num)) return null;
    const unit = (last[2] || "").toLowerCase();
    const multiplier = unit.startsWith("b") ? 1e9 : unit.startsWith("m") ? 1e6 : unit.startsWith("k") || unit === "thousand" ? 1e3 : 1;
    return num * multiplier;
  }

  const tamValue = extractLine(projection.tamSamSom, "TAM");
  const samValue = extractLine(projection.tamSamSom, "SAM");
  const somValue = extractLine(projection.tamSamSom, "SOM");
  const tamMagnitude = parseMagnitude(tamValue);
  const samMagnitude = parseMagnitude(samValue);
  const somMagnitude = parseMagnitude(somValue);

  assert.ok(tamMagnitude !== null, "TAM must resolve to a real parseable magnitude");
  if (samMagnitude !== null) {
    assert.ok(samMagnitude <= tamMagnitude, "SAM must never parse as larger than TAM");
  }
  if (somMagnitude !== null && samMagnitude !== null) {
    assert.ok(somMagnitude <= samMagnitude, "SOM must never parse as larger than SAM");
  }
});

// --- Regression: classification-code false positive in population extraction

test("REGRESSION (confirmed live E2E): a methodology note describing WHERE population data lives, not the data point itself, is never mistaken for a real buyer-population count", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://www.census.gov/programs-surveys/cbp.html",
          sourceType: "official_statistics",
          claim:
            "CBP (County Business Patterns) tables provide number of employer establishments by NAICS for construction (sector 23) and specific 4-6 digit codes (including NAICS 236 series).",
        }),
      ],
    },
    prompt
  );

  // Confirmed live: the naive first-number extraction grabbed "23" from
  // "(sector 23)" and reported it as "23 qualifying buyers/establishments"
  // -- a real-looking but entirely wrong population count, since this
  // claim never actually states a count at all.
  assert.equal(graph.planningEstimate, null);
  assert.ok(graph.sizingGap);
  assert.equal(graph.sizingGap.partialQuantity, null, "no plausible population count should have been extracted from a methodology note");
  assert.doesNotMatch(graph.sizingGap.explanation, /\b23\b/, "the NAICS sector code must never be reported as a buyer count");
});

test("REGRESSION companion: the SAME claim shape, but with a real count stated (not just a code), is still correctly used", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://www.census.gov/programs-surveys/cbp.html",
          sourceType: "official_statistics",
          claim:
            "CBP data for NAICS sector 23 (construction) reports 750,000 employer establishments nationally.",
        }),
      ],
    },
    prompt
  );

  assert.equal(graph.planningEstimate, null);
  assert.ok(graph.sizingGap);
  assert.ok(graph.sizingGap.partialQuantity, "a real, noun-adjacent count in the same sentence as a code reference must still be found");
  assert.equal(graph.sizingGap.partialQuantity.amount, 750000);
  assert.match(graph.sizingGap.explanation, /750,000/);
});
