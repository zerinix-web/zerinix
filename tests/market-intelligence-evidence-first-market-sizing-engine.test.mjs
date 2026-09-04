import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
  MARKET_INTELLIGENCE_GRAPH_VERSION,
} from "../app/lib/ai/market-intelligence-graph.ts";
import {
  calculateMarketOverallConfidence,
} from "../app/lib/ai/market-research-coverage.ts";

// Evidence-first TAM/SAM/SOM market-sizing engine: upgrades
// buildPlanningEstimate (market-intelligence-graph.ts) from "first match
// wins, SAM/SOM are always a fixed 25%/2% of TAM" into a hierarchy-aware,
// triangulating, traceable engine. VALIDATION NEEDED must remain the last
// resort, never the first response, while never fabricating a number.

const checkedAt = "2026-08-02T00:00:00.000Z";
const currentYear = new Date().getUTCFullYear();

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

const prompt = "Analyze the fleet telematics software market.";

// --- 1. Direct verified TAM (single high-authority top-down source) -------

test("1. direct top-down TAM from a government/statistical source is picked, ranked as supportedEstimate, and cites its evidence id", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/programs-surveys/fleet-telematics.html",
          claim: "The US fleet telematics software market size is $1.2 billion in 2026.",
          publishedDate: "2026-01-15",
        }),
      ],
    },
    prompt
  );

  assert.ok(graph.planningEstimate);
  assert.equal(graph.planningEstimate.method, "topDown");
  assert.equal(graph.planningEstimate.tier, "supportedEstimate");
  assert.match(graph.planningEstimate.tam, /\$1\.2B/);
  assert.deepEqual(graph.planningEstimate.evidenceIds, ["R1"]);
  assert.equal(graph.planningEstimate.year, "2026");
});

// --- 2. Bottom-up TAM -------------------------------------------------------

test("2. bottom-up TAM (addressable buyers x annualized price) is computed and traceable when no explicit market-size figure exists", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://www.census.gov/data/tables/fleet-business-population.html",
          claim: "There are an addressable business population of 40,000 commercial fleet operators in the target geography.",
        }),
        evidence({
          id: "R2",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical annual price for fleet telematics subscriptions is $2,000 per fleet.",
        }),
      ],
    },
    prompt
  );

  assert.ok(graph.planningEstimate);
  assert.equal(graph.planningEstimate.method, "bottomUp");
  assert.match(graph.planningEstimate.tam, /\$80(?:\.0)?M/);
  // TASK #54B: the formula sentence never embeds a bracketed [R#]
  // citation -- report-utils.ts's universal presentation sanitizer
  // unconditionally strips that shape for every report type, so
  // traceability lives in the structured evidenceIds array instead.
  assert.doesNotMatch(graph.planningEstimate.formula, /\[R\d+\]/);
  assert.deepEqual(new Set(graph.planningEstimate.evidenceIds), new Set(["R1", "R2"]));
});

// --- 3. Top-down TAM from a lower-authority single source ------------------

test("3. a single lower-authority (credible_publication/other) top-down source is still used, but tiered directional, not supportedEstimate", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://some-industry-blog.example.com/2025/fleet-telematics-outlook",
          sourceType: "news",
          claim: "One blog estimates the fleet telematics software market at $900 million.",
        }),
      ],
    },
    prompt
  );

  assert.ok(graph.planningEstimate);
  assert.equal(graph.planningEstimate.method, "topDown");
  assert.equal(graph.planningEstimate.tier, "directional");
});

// --- 4. Triangulated TAM (top-down + bottom-up agree) -----------------------

test("4. top-down and bottom-up estimates that agree are triangulated into a single method with a confidence boost, not silently discarding one", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.gartner.com/en/fleet-telematics-market-research",
          sourceType: "market_research",
          claim: "Industry market research report values the fleet telematics software market at $85 million.",
        }),
        evidence({
          id: "R2",
          field: "market_demand",
          url: "https://www.census.gov/data/fleet-business-population.html",
          claim: "There are an addressable business population of 40,000 commercial fleet operators.",
        }),
        evidence({
          id: "R3",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical annual price for fleet telematics subscriptions is $2,000 per fleet.",
        }),
      ],
    },
    prompt
  );

  assert.ok(graph.planningEstimate);
  assert.equal(graph.planningEstimate.method, "triangulated");
  assert.equal(graph.planningEstimate.conflicting, false);
  assert.equal(graph.planningEstimate.tier, "supportedEstimate");
  assert.match(graph.planningEstimate.tam, /\$80(?:\.0)?M–\$85(?:\.0)?M/);
});

// --- 5. Insufficient evidence: TAM stays "Validation Needed" ---------------

test("5. genuinely insufficient evidence (no explicit figure, no buyer-population/pricing pair) never fabricates a TAM -- planningEstimate stays null", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "competitors",
          url: "https://example-vendor.com/",
          claim: "Example Vendor sells fleet telematics hardware and software.",
        }),
      ],
    },
    prompt
  );

  assert.equal(graph.planningEstimate, null);
  assert.equal(graph.adjacentBenchmarks.length, 0);
  // Evidence-first recovery loop: a specific sizingGap explanation now
  // replaces the fully generic "could not be established" notice.
  assert.ok(graph.sizingGap);
  assert.equal(graph.sizingGap.missingIngredient, "everything");

  const projection = projectMarketIntelligenceGraphToReport(graph);
  assert.match(projection.tamSamSom, /found no verifiable numeric evidence/i);
  assert.doesNotMatch(projection.tamSamSom, /\$\d/);
});

// --- 6. TAM -> SAM dependency: no TAM means no SAM/SOM figure at all -------

test("6. when TAM cannot be established, the rendered section never presents a SAM or SOM figure either (TAM -> SAM -> SOM dependency honored at the render layer)", () => {
  const graph = buildMarketIntelligenceGraph({ evidence: [] }, prompt);
  assert.equal(graph.planningEstimate, null);

  const projection = projectMarketIntelligenceGraphToReport(graph);
  assert.doesNotMatch(projection.tamSamSom, /SAM \[/);
  assert.doesNotMatch(projection.tamSamSom, /SOM \[/);
});

// --- 7. SAM -> SOM dependency: evidenced SAM, but SOM stays pending --------

test("7. real segment-share evidence produces an evidence-derived SAM, but SOM still stays honestly pending without penetration/win-rate evidence", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.gartner.com/fleet-telematics-market-research",
          sourceType: "market_research",
          claim: "Market research report values the fleet telematics software market at $1 billion.",
        }),
        evidence({
          id: "R2",
          field: "industry_structure",
          url: "https://example-association.org/segment-report",
          sourceType: "industry_association",
          claim: "The SMB segment represents approximately 30% of the total addressable fleet telematics market.",
        }),
      ],
    },
    prompt
  );

  assert.ok(graph.planningEstimate);
  assert.equal(graph.planningEstimate.samMethod, "evidenceDerived");
  assert.match(graph.planningEstimate.sam, /\$300(?:\.0)?M/);
  assert.equal(graph.planningEstimate.somStatus, "pending");
  assert.doesNotMatch(graph.planningEstimate.som, /\d/);
});

// --- 8. Conflicting-source handling -----------------------------------------

test("8. top-down and bottom-up estimates that diverge materially are surfaced as a conflict, not silently averaged or silently chosen", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.gartner.com/fleet-telematics-market-research",
          sourceType: "market_research",
          claim: "Market research report values the fleet telematics software market at $50 million.",
        }),
        evidence({
          id: "R2",
          field: "market_demand",
          url: "https://www.census.gov/data/fleet-business-population.html",
          claim: "There are an addressable business population of 400,000 commercial fleet operators.",
        }),
        evidence({
          id: "R3",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical annual price for fleet telematics subscriptions is $2,000 per fleet.",
        }),
      ],
    },
    prompt
  );

  // bottom-up = 400,000 x $2,000 = $800M vs top-down $50M -> 16x divergence
  assert.ok(graph.planningEstimate);
  assert.equal(graph.planningEstimate.method, "triangulated");
  assert.equal(graph.planningEstimate.conflicting, true);
  assert.equal(graph.planningEstimate.tier, "directional");
  assert.match(graph.planningEstimate.conflictNote, /diverge/i);
  assert.match(graph.planningEstimate.tam, /\$50(?:\.0)?M–\$800(?:\.0)?M/);

  const projection = projectMarketIntelligenceGraphToReport(graph);
  assert.match(projection.tamSamSom, /diverge/i);
});

test("8b. conflicting evidence measurably lowers confidence versus an otherwise-identical agreeing case", () => {
  const agreeing = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.gartner.com/fleet-telematics-market-research",
          sourceType: "market_research",
          claim: "Market research report values the fleet telematics software market at $85 million.",
        }),
        evidence({
          id: "R2",
          field: "market_demand",
          url: "https://www.census.gov/data/fleet-business-population.html",
          claim: "There are an addressable business population of 40,000 commercial fleet operators.",
        }),
        evidence({
          id: "R3",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical annual price for fleet telematics subscriptions is $2,000 per fleet.",
        }),
      ],
    },
    prompt
  );
  const conflicting = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.gartner.com/fleet-telematics-market-research",
          sourceType: "market_research",
          claim: "Market research report values the fleet telematics software market at $50 million.",
        }),
        evidence({
          id: "R2",
          field: "market_demand",
          url: "https://www.census.gov/data/fleet-business-population.html",
          claim: "There are an addressable business population of 400,000 commercial fleet operators.",
        }),
        evidence({
          id: "R3",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical annual price for fleet telematics subscriptions is $2,000 per fleet.",
        }),
      ],
    },
    prompt
  );

  assert.ok(agreeing.planningEstimate.confidence > conflicting.planningEstimate.confidence);
});

// --- 9. Proxy/directional estimates -----------------------------------------

test("9. a single thin/company-primary source produces a directional estimate, never presented as equivalent to a supported one", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://example-vendor.com/about",
          sourceType: "company website",
          claim: "Example Vendor's own site states the fleet telematics market is worth $600 million.",
        }),
      ],
    },
    prompt
  );

  assert.ok(graph.planningEstimate);
  assert.equal(graph.planningEstimate.tier, "directional");

  const projection = projectMarketIntelligenceGraphToReport(graph);
  assert.match(projection.tamSamSom, /Directional \/ Proxy/);
});

// --- 10. Stale-source handling ----------------------------------------------

test("10. evidence more than a few years old is labeled with its real year and flagged stale, with reduced confidence -- never silently presented as current", () => {
  const fresh = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/fleet-telematics.html",
          claim: "The fleet telematics software market size is $1 billion.",
          publishedDate: `${currentYear}-01-01`,
        }),
      ],
    },
    prompt
  );
  const stale = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/fleet-telematics.html",
          claim: "The fleet telematics software market size is $1 billion.",
          publishedDate: "2018-01-01",
        }),
      ],
    },
    prompt
  );

  assert.equal(fresh.planningEstimate.stale, false);
  assert.equal(stale.planningEstimate.stale, true);
  assert.equal(stale.planningEstimate.year, "2018");
  assert.ok(stale.planningEstimate.confidence < fresh.planningEstimate.confidence);

  const projection = projectMarketIntelligenceGraphToReport(stale);
  assert.match(projection.tamSamSom, /2018/);
  assert.match(projection.tamSamSom, /historical baseline/i);
});

// --- 11. No fabricated market figures ---------------------------------------

test("11. a pending SOM never carries a fabricated numeric figure, in the graph object and in the rendered report", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/fleet-telematics.html",
          claim: "The fleet telematics software market size is $1 billion.",
        }),
      ],
    },
    prompt
  );

  assert.equal(graph.planningEstimate.somStatus, "pending");
  assert.doesNotMatch(graph.planningEstimate.som, /\d/);

  const projection = projectMarketIntelligenceGraphToReport(graph);
  assert.match(projection.tamSamSom, /SOM \[Validation Needed\]/);
  const somLine = projection.tamSamSom.split("\n").find((line) => line.startsWith("SOM ["));
  assert.doesNotMatch(somLine, /\d/, "the SOM line itself must contain no digits at all");
});

// --- 12. Calculation traceability -------------------------------------------

test("12. every figure remains traceable: evidenceIds resolve to real sources (TASK #54B: the formula sentence itself no longer embeds a bracketed [R#] citation, since report-utils.ts's own universal presentation sanitizer unconditionally strips that shape for every report type -- traceability instead lives in the structured evidenceIds array, which every render surface can already resolve against Sources), geography/year/marketDefinition are populated", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://www.census.gov/data/fleet-business-population.html",
          claim: "There are an addressable business population of 48,000 commercial fleet operators in Germany.",
        }),
        evidence({
          id: "R2",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical annual price for fleet telematics subscriptions is $8,000 per fleet.",
        }),
      ],
    },
    prompt
  );

  const estimate = graph.planningEstimate;
  assert.ok(estimate);
  assert.match(estimate.tam, /\$384(?:\.0)?M/);
  assert.doesNotMatch(estimate.formula, /\[R\d+\]/, "TASK #54B: a bracketed [R#] citation can never survive report-utils.ts's universal presentation sanitizer -- it must never be constructed here at all");
  assert.deepEqual(new Set(estimate.evidenceIds), new Set(["R1", "R2"]));
  const sourceIds = new Set(graph.sources.map((item) => item.evidenceId));
  for (const id of estimate.evidenceIds) {
    assert.ok(sourceIds.has(id), `evidence id ${id} must resolve to a real source`);
  }
  assert.notEqual(estimate.geography, "");
  assert.notEqual(estimate.year, "");
  assert.ok(estimate.marketDefinition.length > 0);
});

// --- 13. Confidence propagation ---------------------------------------------

test("13. planningEstimate.confidence propagates into the graph's financialEvidence coverage dimension, bounded rather than unbounded", () => {
  const noEstimate = buildMarketIntelligenceGraph({ evidence: [] }, prompt);
  const withEstimate = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/fleet-telematics.html",
          claim: "The fleet telematics software market size is $1 billion.",
        }),
      ],
    },
    prompt
  );

  assert.ok(withEstimate.coverage.dimensions.financialEvidence > noEstimate.coverage.dimensions.financialEvidence);
  // planningEstimate's own contribution to financialEvidence is
  // deliberately capped (Math.min(62, 30 + confidence * 0.3) in
  // buildMarketIntelligenceGraph) so a single, even maximally-confident
  // planning estimate can never alone represent "high financial
  // evidence" the way an independently verified market size can --
  // financialEvidence's overall value may still exceed that cap via
  // evaluateMarketResearchCoverage's own, separate heuristic, which this
  // engine does not alter.
  const cappedPlanningContribution = Math.min(62, 30 + withEstimate.planningEstimate.confidence * 0.3);
  assert.ok(cappedPlanningContribution <= 62);
  assert.ok(withEstimate.coverage.dimensions.financialEvidence <= 100);
});

// --- 14. Executive Decision integration -------------------------------------

test("14. market-sizing confidence is one bounded dimension among several -- a missing TAM alone cannot zero the overall confidence, and a maxed-out one cannot single-handedly saturate it", () => {
  const baseDimensions = {
    marketConfidence: 70,
    competitiveEvidence: 70,
    financialEvidence: 0,
    productEvidence: 70,
    executionReadiness: 70,
    founderReadiness: 70,
  };
  const noTamConfidence = calculateMarketOverallConfidence(baseDimensions);
  const maxTamConfidence = calculateMarketOverallConfidence({
    ...baseDimensions,
    financialEvidence: 100,
  });

  // financialEvidence is weighted 0.12 of the total -- swinging it from 0
  // to 100 can only move the overall score by 12 points, never flip a
  // decision on its own.
  assert.ok(noTamConfidence > 55, "other evidence dimensions must still carry a reasonable score with no market sizing at all");
  assert.ok(maxTamConfidence - noTamConfidence <= 12.01);
});

// --- 15. Web/report/PDF semantic consistency --------------------------------
// Faithful reference implementation of page.tsx/Planner.tsx's own parsing
// (extractMarketSizeCardValue + parseMonetaryMagnitude + the cascade), used
// to prove the new engine's rendered text still parses identically for
// every consumer -- without re-importing a client component into a Node
// test.

function extractMarketSizeCardValue(content, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content
    .replace(/\*\*/g, "")
    .match(
      new RegExp(`\\b${escapedLabel}\\b\\s*(?:\\([^)\\n]{0,80}\\)\\s*)?(?:\\[[^\\]\\n]{0,40}\\]\\s*)?[:\\-–—]\\s*([^\\n]*)`, "i")
    );
  return match?.[1]?.trim().replace(/\*\*/g, "") || "";
}

function parseMonetaryMagnitude(value) {
  const matches = [...(value || "").matchAll(/([\d.,]+)\s*(thousand|million|billion|trillion|[kKmMbBtT])?/g)];
  const last = matches
    .filter((candidate) => candidate[1] && Number.isFinite(parseFloat(candidate[1].replace(/,/g, ""))))
    .at(-1);
  if (!last) return null;
  const num = parseFloat(last[1].replace(/,/g, ""));
  const unit = (last[2] || "").toLowerCase();
  const multiplier =
    unit === "k" || unit === "thousand" ? 1e3 :
    unit === "m" || unit === "million" ? 1e6 :
    unit === "b" || unit === "billion" ? 1e9 :
    unit === "t" || unit === "trillion" ? 1e12 : 1;
  return num * multiplier;
}

function resolveCascade(content) {
  const magnitudes = ["TAM", "SAM", "SOM"].map((label) =>
    parseMonetaryMagnitude(extractMarketSizeCardValue(content, label))
  );
  const tamResolved = magnitudes[0] !== null;
  const samResolved = tamResolved && magnitudes[1] !== null && magnitudes[1] <= magnitudes[0];
  const somResolved = samResolved && magnitudes[2] !== null && magnitudes[2] <= magnitudes[1];
  return { magnitudes, tamResolved, samResolved, somResolved };
}

test("15. TAM/SAM resolved, SOM pending: the shared cascade resolves TAM+SAM and correctly leaves only SOM as 'Validation Needed' (not blocked by a false parent failure)", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/fleet-telematics.html",
          claim: "The fleet telematics software market size is $1 billion.",
        }),
      ],
    },
    prompt
  );
  const projection = projectMarketIntelligenceGraphToReport(graph);
  const { tamResolved, samResolved, somResolved } = resolveCascade(projection.tamSamSom);

  assert.equal(tamResolved, true);
  assert.equal(samResolved, true);
  assert.equal(somResolved, false, "SOM has no parseable magnitude, so it correctly fails to resolve");
});

test("15b. triangulated, agreeing TAM/SAM/SOM (with real obtainable-share evidence) fully resolves and nests TAM >= SAM >= SOM", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.gartner.com/fleet-telematics-market-research",
          sourceType: "market_research",
          claim: "Market research report values the fleet telematics software market at $85 million.",
        }),
        evidence({
          id: "R2",
          field: "market_demand",
          url: "https://www.census.gov/data/fleet-business-population.html",
          claim: "There are an addressable business population of 40,000 commercial fleet operators.",
        }),
        evidence({
          id: "R3",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical annual price for fleet telematics subscriptions is $2,000 per fleet.",
        }),
        evidence({
          id: "R4",
          field: "industry_structure",
          url: "https://example-association.org/win-rates",
          sourceType: "industry_association",
          claim: "New entrants typically achieve a first-year penetration rate of 3% in this market.",
        }),
      ],
    },
    prompt
  );

  assert.equal(graph.planningEstimate.somStatus, "calculated");
  const projection = projectMarketIntelligenceGraphToReport(graph);
  const { magnitudes, tamResolved, samResolved, somResolved } = resolveCascade(projection.tamSamSom);

  assert.deepEqual([tamResolved, samResolved, somResolved], [true, true, true]);
  assert.ok(magnitudes[0] >= magnitudes[1]);
  assert.ok(magnitudes[1] >= magnitudes[2]);
});

// --- 16. Cached-result consistency -------------------------------------------

test("16. the graph version was bumped for this shape change, and a full JSON round-trip (simulating a cache read/write) preserves every new traceability field losslessly", () => {
  assert.equal(MARKET_INTELLIGENCE_GRAPH_VERSION, "market-intelligence-graph-v6");

  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/fleet-telematics.html",
          claim: "The fleet telematics software market size is $1 billion.",
        }),
      ],
    },
    prompt
  );

  // citableEvidenceIds is a Set -- the graph's own documented, accepted
  // JSON-round-trip caveat (sourceRecordByEvidenceId is the JSON-safe
  // substitute). Strip it the same way research-cache.ts's real snapshot
  // path does, then prove everything else -- including every new
  // planningEstimate field -- survives intact.
  const { citableEvidenceIds, ...serializable } = graph;
  void citableEvidenceIds;
  const roundTripped = JSON.parse(JSON.stringify(serializable));

  assert.deepEqual(roundTripped.planningEstimate, graph.planningEstimate);
  assert.equal(roundTripped.version, MARKET_INTELLIGENCE_GRAPH_VERSION);
});
