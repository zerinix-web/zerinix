import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildMarketIntelligenceGraph } from "../app/lib/ai/market-intelligence-graph.ts";

// TASK #54A -- Trace and fix suspicious Market Intelligence TAM numeric
// provenance.
//
// ROOT CAUSE #1 (numeric): parseNumberMatch's unit multiplier for the
// single-letter "k" (thousand) abbreviation was nested inside an
// `unit.startsWith("t")` branch -- unreachable for "k", which does not
// start with "t". "$18k" parsed to amount 18 instead of 18,000, a 1000x
// unit-normalization error. "m"/"million" and "b"/"billion" were
// unaffected (their own startsWith branches happened to work), which is
// exactly the shape of defect that can produce an implausibly small,
// yet still round-looking, "$18K" TAM from otherwise-real evidence.
//
// ROOT CAUSE #2 (provenance text): every basis/formula sentence built
// its citation clause via raw string interpolation of `[${item.id}]`
// with no guard for `item.id` being empty. An evidence item can reach
// buildPlanningEstimate (verified, confidence >= 48) without ever
// appearing in the citable Sources registry (buildMarketIntelligenceGraph's
// own sanitizeResearchPublisher/valid-URL check, which buildPlanningEstimate's
// own sourceBacked filter does not apply) -- when such an item anchors
// the calculation, the empty-id interpolation produced a literal empty
// "[]", later swept away by report-presentation-sanitizer.ts's
// emptyBracketGroupPattern along with its surrounding "from " token,
// producing exactly "addressable buyers from (other) × annualized price
// from." confirmed live.
//
// FIX: NUMBER_UNIT_MULTIPLIERS replaces the broken nested ternary with
// explicit, unambiguous per-unit lookups. formatMarketSizingSourceClause/
// formatMarketSizingBareCitation replace every raw `[${item.id}]`
// interpolation in this file's TAM/SAM/SOM basis/formula construction --
// both omit the ENTIRE citation fragment (word "from" included) as one
// unit when an id is missing, so a downstream sanitizer never has
// residue to clean up in the first place.

const graphSource = readFileSync(
  new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
  "utf8"
);

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
    sourceTitle: `${id || "unknown"} source`,
    publisher: `${id || "unknown"} publisher`,
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

// --- A. valid buyer count + valid annualized price -> correct numeric TAM ---

test("TASK #54A-A: valid addressable-buyer count and valid annualized price produce a correct, traceable bottom-up TAM", () => {
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
  assert.match(graph.planningEstimate.tam, /\$80(?:\.0)?M/, "40,000 x $2,000 = $80,000,000");
  // TASK #54B: traceability lives in the structured evidenceIds array,
  // never as a bracketed [R#] citation embedded in the formula sentence
  // itself (see this file's own Task #54B section below for why).
  assert.deepEqual(new Set(graph.planningEstimate.evidenceIds), new Set(["R1", "R2"]));
});

// --- B. missing buyer count -> no fabricated TAM ----------------------------

test("TASK #54A-B: pricing evidence alone, with no addressable-buyer-population evidence at all, never fabricates a TAM", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical annual price for fleet telematics subscriptions is $2,000 per fleet.",
        }),
      ],
    },
    prompt
  );

  assert.equal(graph.planningEstimate, null);
  assert.ok(graph.sizingGap, "a gap explanation must exist instead of a bare null");
});

// --- C. missing/unsupported price -> no fabricated TAM ----------------------

test("TASK #54A-C: addressable-buyer-population evidence alone, with no pricing evidence (direct or proxy) at all, never fabricates a TAM", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://www.census.gov/data/tables/fleet-business-population.html",
          claim: "There are an addressable business population of 40,000 commercial fleet operators in the target geography.",
        }),
      ],
    },
    prompt
  );

  assert.equal(graph.planningEstimate, null);
  assert.ok(graph.sizingGap);
  assert.equal(graph.sizingGap.missingIngredient, "pricing");
});

// --- D. monthly price input -> annualization occurs exactly once -----------

test("TASK #54A-D: a monthly price figure is annualized exactly once (x12), never left as a raw monthly figure and never double-annualized", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://www.census.gov/data/tables/fleet-business-population.html",
          claim: "There are an addressable business population of 100 commercial fleet operators in the target geography.",
        }),
        evidence({
          id: "R2",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical price for fleet telematics subscriptions is $100 per month per fleet.",
        }),
      ],
    },
    prompt
  );

  assert.ok(graph.planningEstimate);
  assert.equal(graph.planningEstimate.method, "bottomUp");
  // 100 buyers x ($100/month x 12 = $1,200/year) = $120,000 -- NOT
  // $10,000 (unannualized) and NOT $1,440,000 (double-annualized).
  assert.match(graph.planningEstimate.tam, /\$120(?:\.0)?K|\$0\.12M/);
});

// --- E. currency/unit normalization -> no 1K/1M scale corruption -----------

test("TASK #54A-E: a price expressed with the single-letter 'k' abbreviation parses to the correct magnitude, not a 1000x-too-small figure", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://www.census.gov/data/tables/fleet-business-population.html",
          claim: "There are an addressable business population of 100 commercial fleet operators in the target geography.",
        }),
        evidence({
          id: "R2",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical annual price for fleet telematics subscriptions is $2k per fleet.",
        }),
      ],
    },
    prompt
  );

  assert.ok(graph.planningEstimate);
  // 100 buyers x $2,000/year (NOT $2) = $200,000 -- confirms the "k"
  // suffix was correctly scaled x1,000, not silently treated as x1.
  assert.match(graph.planningEstimate.tam, /\$200(?:\.0)?K|\$0\.2M/);
  assert.doesNotMatch(graph.planningEstimate.tam, /\$200(?:\.00)?\b(?!K)/);
});

test("TASK #54A-E (drift check): the multiplier lookup is a single, explicit, unambiguous table -- confirmed via source, never a startsWith chain that could silently miss a unit", () => {
  const tableSource = graphSource.match(/const NUMBER_UNIT_MULTIPLIERS: Record<string, number> = \{[\s\S]*?\};/)[0];
  for (const [unit, expected] of [
    ["k", 1_000],
    ["thousand", 1_000],
    ["m", 1_000_000],
    ["million", 1_000_000],
    ["b", 1_000_000_000],
    ["billion", 1_000_000_000],
    ["t", 1_000_000_000_000],
    ["trillion", 1_000_000_000_000],
  ]) {
    assert.match(tableSource, new RegExp(`\\b${unit}:\\s*${expected.toLocaleString("en-US").replace(/,/g, "_")}`));
  }
  const parseNumberMatchSource = graphSource.match(/function parseNumberMatch\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(parseNumberMatchSource, /unit\.startsWith\("t"\)/, "the broken nested startsWith chain must be fully removed from the executable code");
});

// --- F. supportedEstimate cannot silently masquerade as stronger evidence ---

test("TASK #54A-F: a low-authority (blog/other) buyer-population source is tiered 'directional', never 'supportedEstimate', even with a fully valid direct price", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://some-industry-blog.com/2025/fleet-outlook",
          sourceType: "news",
          claim: "One blog estimates an addressable business population of 40,000 commercial fleet operators.",
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
  assert.equal(
    graph.planningEstimate.tier,
    "directional",
    "a low-authority buyer-population source must never be tiered as strongly as a government/statistical one"
  );
});

test("TASK #54A-F (continued): a government-statistics buyer-population source with direct (non-proxy) pricing IS correctly tiered 'supportedEstimate' -- this task never weakens genuinely strong evidence", () => {
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
  assert.equal(graph.planningEstimate.tier, "supportedEstimate");
});

// --- G. formula/provenance rendering never produces broken artifacts -------

test("TASK #54A-G: reproduces the REAL malformed-provenance defect and proves the fix -- an addressable-buyer evidence item reaching the calculation with no citable id no longer produces a dangling '(other)'/'from.' artifact", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "",
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
  const formula = graph.planningEstimate.formula;
  assert.doesNotMatch(formula, /\[\]/, "must never leave an empty bracket pair");
  assert.doesNotMatch(formula, /from\.(?:\s|$)/, "must never leave a dangling 'from.' with nothing after it");
  assert.doesNotMatch(formula, /from\s*×/, "must never leave a dangling 'from' immediately before the × operator");
  assert.match(formula, /addressable buyers \(government statistics\)/, "the evidence-class annotation must still be shown even without an id");
  assert.match(formula, /^TAM = addressable buyers \(government statistics\) × annualized price\./, "the TAM clause reads as a clean, neutral, well-formed sentence");
});

test("TASK #54A-G (continued): the same builders are applied to every citation clause in this file's TAM/SAM/SOM construction -- confirmed via source, no raw `[${item.id}]`-style interpolation remains at any call site (TASK #54B: both builders now unconditionally return an empty string, since a bracketed [R#] citation can never survive report-utils.ts's universal presentation sanitizer)", () => {
  const buildPlanningEstimateSource = graphSource.match(/function buildPlanningEstimate\([\s\S]*?\n\}\n\n\/\/ The single/)?.[0] ?? graphSource.match(/function buildPlanningEstimate\([\s\S]*?\n  return \{[\s\S]*?\n  \};\n\}/)[0];
  assert.doesNotMatch(
    buildPlanningEstimateSource,
    /from \[\$\{/,
    "no remaining raw 'from [${...}]' interpolation inside buildPlanningEstimate -- every site must go through formatMarketSizingSourceClause"
  );
  assert.doesNotMatch(
    buildPlanningEstimateSource,
    /\(addressable buyers \[\$\{|annualized price \[\$\{/,
    "no remaining raw bare-bracket interpolation inside buildPlanningEstimate -- every site must go through formatMarketSizingBareCitation"
  );
  const bareCitationCount = (buildPlanningEstimateSource.match(/formatMarketSizingBareCitation\(/g) || []).length;
  const sourceClauseCount = (buildPlanningEstimateSource.match(/formatMarketSizingSourceClause\(/g) || []).length;
  assert.ok(bareCitationCount >= 2, "the triangulated-branch's two bare buyer/price citations must use the safe builder");
  assert.ok(sourceClauseCount >= 6, "every other 'from [id]' citation site (topDown, bottomUp, proxy, conflict note, SAM, SOM) must use the safe builder");
});

// --- H. web and PDF consume the same canonical TAM state --------------------

test("TASK #54A-H: the TAM/SAM/SOM formula/basis text is computed exactly once, in this one module, at generation time -- web and PDF renderers only ever display the SAME already-computed, already-persisted string, never re-deriving their own buyer/price citation text", () => {
  const rendererFiles = [
    ["page.tsx", readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8")],
    ["Planner.tsx", readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8")],
    ["ReportPdfButton.tsx", readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8")],
  ];
  for (const [name, source] of rendererFiles) {
    assert.doesNotMatch(source, /addressable buyers/i, `${name}: must not independently reconstruct TAM formula text`);
    assert.doesNotMatch(source, /function formatMarketSizingSourceClause/, `${name}: must not duplicate the citation builder`);
  }
});

// --- I. decision/confidence/ENTER eligibility remain unchanged -------------

test("TASK #54A-I: this fix touches only TAM/SAM/SOM numeric parsing and citation-clause text -- it does not import or reference the decision/confidence/ENTER-eligibility layer at all", () => {
  assert.doesNotMatch(graphSource, /assessMarketEntryConfidence/);
  assert.doesNotMatch(graphSource, /resolveMarketIntelligenceEnterEligibility/);
  assert.doesNotMatch(graphSource, /decisionCriticalEvidence/);
});
