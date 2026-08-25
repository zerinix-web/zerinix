import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
  sanitizeMarketProseCompetitorClaims,
} from "../app/lib/ai/market-intelligence-graph.ts";

// Final semantic-consistency hardening pass: the report must never
// structurally establish one competitive reality (Competitive Landscape /
// Major Players, via the canonical vendor-discovery graph) while free-form
// model prose in Porter's Five Forces / market drivers / barriers /
// opportunities / threats / strategic recommendations communicates a
// contradictory one -- e.g. "Competition from Procore and Autodesk is
// intense" when those companies are only evidenced as adjacent/platform
// players, or "Leading competitors include X, Y, and Z" when no
// competitor evidence exists at all.
//
// Root cause: projectMarketIntelligenceGraphToReport already made
// competitiveLandscape/majorPlayers canonical, but every OTHER free-text
// field (opportunities, threats, portersFiveForces, marketDrivers,
// barriers, strategicRecommendations) is raw, ungated model prose that can
// independently assert a stronger competitive claim than the graph
// supports -- and that prose also feeds
// buildMarketExecutiveDecisionBrief's Top 3 Risks/Reasons (via
// biggestRisk/topSubstantiveLines reading sections.threats/.opportunities),
// so an unsanitized claim there could resurface in the deterministic
// Executive Decision banner and final verdict too.
//
// Fix: sanitizeMarketProseCompetitorClaims (market-intelligence-graph.ts)
// -- deterministic, sentence-scoped, and only ever acts on (a) the same
// "include/such as/like/named" list shape already established for Major
// Players' own prose-list fallback, or (b) bare rivalry language
// co-occurring with a name already on the graph's own KNOWN adjacent-
// player list. It never scans for arbitrary proper nouns and never
// invents a name to flag. Wired into app/api/market-analysis/route.ts's
// applySharedMarketGraph, which runs BEFORE buildMarketExecutiveDecisionBrief
// consumes these fields -- so one fix protects the whole downstream
// executive-decision chain, and because it runs once server-side on the
// canonical report object, web dashboard, Planner, and the exported PDF
// all read the identical, already-sanitized text (no separate PDF path).

const checkedAt = "2026-08-15T00:00:00.000Z";
let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `E${idCounter}`;
}

function baseEvidence(overrides) {
  return {
    id: nextId(),
    field: "vendor_discovery",
    claim: "",
    value: "",
    label: "Verified from external source",
    sourceTitle: "",
    publisher: "",
    url: "",
    sourceType: "credible_market_data",
    authorityLevel: "secondary",
    confidence: 80,
    publishedDate: "2026-01-10",
    lastChecked: checkedAt,
    supportingData: [],
    impact: "neutral",
    impactReason: "Supports vendor discovery coverage.",
    qualityScore: 74,
    qualityRationale: "Independently sourced vendor mention.",
    searchQuery: "",
    ...overrides,
  };
}

function singleListicleMention({ name, domain }) {
  return baseEvidence({
    claim: `${name} is named in an industry roundup as active in this market.`,
    value: `${name} roundup mention`,
    sourceTitle: `${name} roundup listicle`,
    publisher: domain,
    url: `https://${domain}/blog/roundup`,
    sourceType: "credible_market_data",
    searchQuery: `${name} best software`,
  });
}

function officialMention({ name, domain }) {
  return baseEvidence({
    claim: `${name} provides subscription software with product and integration features for enterprise and SMB customers.`,
    value: `${name} subscription pricing and product feature evidence`,
    sourceTitle: `${name} official product and pricing page`,
    publisher: name,
    url: `https://${domain}/pricing`,
    sourceType: "company_source",
    authorityLevel: "primary",
  });
}

function reviewMention({ name, domain }) {
  return baseEvidence({
    claim: `${name} offers a highly rated platform used by buyers researching this category.`,
    value: `${name} customer review summary`,
    sourceTitle: `${name} reviews and ratings`,
    publisher: domain,
    url: `https://${domain}/reviews/${encodeURIComponent(name.toLowerCase())}`,
  });
}

const adjacentOnlyPrompt = "Analyze the Construction ERP market for AI-powered construction operations.";
function buildAdjacentOnlyGraph() {
  const evidence = [
    singleListicleMention({ name: "Procore", domain: "constructiontechroundup.example.com" }),
    singleListicleMention({ name: "Autodesk Construction Cloud", domain: "constructiontechroundup.example.com" }),
  ];
  return buildMarketIntelligenceGraph({ evidence }, adjacentOnlyPrompt);
}

function buildDirectCompetitorGraph() {
  const evidence = [
    officialMention({ name: "SiteLedger", domain: "siteledger.example.com" }),
    reviewMention({ name: "SiteLedger", domain: "g2.example.com" }),
  ];
  return buildMarketIntelligenceGraph({ evidence }, adjacentOnlyPrompt);
}

function buildEmptyGraph() {
  const evidence = [
    baseEvidence({
      claim: "General commentary about the market with no numeric size figure or named vendor.",
      value: "",
      sourceTitle: "General overview",
      publisher: "Some Site",
      url: "https://somesite.example.com/overview",
    }),
  ];
  return buildMarketIntelligenceGraph({ evidence }, "Analyze an obscure niche market.");
}

// ---------------------------------------------------------------------------
// A) Adjacent players exist, no direct competitors
// ---------------------------------------------------------------------------

test("A) list-shaped claim naming only adjacent players ('Competition from Procore and Autodesk...') is downgraded to an accurate adjacent/platform framing, never left asserting direct rivalry", () => {
  const graph = buildAdjacentOnlyGraph();
  assert.equal(graph.vendorIntelligence.vendors.length, 0);
  const adjacentNames = graph.vendorIntelligence.adjacentPlayers.map((p) => p.name).sort();
  assert.deepEqual(adjacentNames, ["Autodesk Construction Cloud", "Procore"]);

  const threats =
    "Competition from established players such as Procore and Autodesk Construction Cloud is intense, and switching costs are low. Regulatory conditions remain stable in the near term.";
  const sanitized = sanitizeMarketProseCompetitorClaims(threats, graph, "English");

  assert.match(sanitized, /adjacent\/platform presence/i);
  assert.match(sanitized, /not independently validated as a direct, head-to-head competitor/i);
  assert.doesNotMatch(sanitized, /Competition from established players such as Procore/);
  // The unrelated second sentence is preserved verbatim -- smallest
  // deterministic correction, not a wholesale field replacement.
  assert.match(sanitized, /Regulatory conditions remain stable in the near term\./);
});

test("A) bare rivalry framing naming a single known adjacent player without list-shape ('Competition from Procore is intense') is also downgraded", () => {
  const graph = buildAdjacentOnlyGraph();
  const opportunities =
    "Competition from Procore is intense given its enterprise footprint. A greenfield opportunity exists in the SMB segment where incumbents are thin.";
  const sanitized = sanitizeMarketProseCompetitorClaims(opportunities, graph, "English");

  assert.match(sanitized, /adjacent\/platform presence/i);
  assert.doesNotMatch(sanitized, /Competition from Procore is intense/);
  assert.match(sanitized, /A greenfield opportunity exists in the SMB segment/);
});

test("A) Competitive Landscape explicitly states direct competition is unestablished while adjacent players are evidenced -- never the flat 'no competitor data' phrasing -- and Major Players uses the identical classification", () => {
  const graph = buildAdjacentOnlyGraph();
  const projection = projectMarketIntelligenceGraphToReport(graph, "English");

  assert.match(projection.competitiveLandscape, /Direct, head-to-head competitors could not be independently validated/i);
  assert.match(projection.competitiveLandscape, /Adjacent\/platform players/i);
  assert.doesNotMatch(projection.competitiveLandscape, /^Independent, publicly available information.*was limited during research/i);

  assert.match(projection.majorPlayers, /Procore/);
  assert.match(projection.majorPlayers, /Not Independently Validated as Direct Competitors/i);
});

// ---------------------------------------------------------------------------
// B) Validated direct competitor exists
// ---------------------------------------------------------------------------

test("B) a genuinely validated direct competitor mentioned with rivalry language is left completely untouched -- the claim is actually supported", () => {
  const graph = buildDirectCompetitorGraph();
  assert.deepEqual(
    graph.vendorIntelligence.vendors.map((v) => v.name),
    ["SiteLedger"]
  );

  const threats = "Competition from SiteLedger is intense given its strong reviews. Overall regulatory risk is low.";
  const sanitized = sanitizeMarketProseCompetitorClaims(threats, graph, "English");

  assert.equal(sanitized, threats);
});

test("B) a list-shaped claim naming only validated direct competitors is untouched", () => {
  const graph = buildDirectCompetitorGraph();
  const porters = "Rivalry is elevated: competitors include SiteLedger, which has strong review coverage.";
  const sanitized = sanitizeMarketProseCompetitorClaims(porters, graph, "English");

  assert.equal(sanitized, porters);
});

test("B) a mixed sentence naming both a validated direct competitor and an adjacent player is left untouched (conservative -- a surgical partial edit risks breaking a partly-true claim)", () => {
  const graph = buildDirectCompetitorGraph();
  const withMixedNames = "Competition from SiteLedger and Procore is intense across this category.";
  const sanitized = sanitizeMarketProseCompetitorClaims(withMixedNames, graph, "English");

  assert.equal(sanitized, withMixedNames);
});

// ---------------------------------------------------------------------------
// C) No competitor evidence at all
// ---------------------------------------------------------------------------

test("C) 'Leading competitors include X, Y, and Z' with zero graph evidence for any of them is downgraded to a generic, honest structural-pressure statement -- never resurrecting invented names as validated facts", () => {
  const graph = buildEmptyGraph();
  assert.equal(graph.vendorIntelligence.vendors.length, 0);
  assert.equal(graph.vendorIntelligence.adjacentPlayers.length, 0);

  const portersFiveForces =
    "Leading competitors include Zephyra, Nordwing, and Alta Systems. Overall market growth remains uncertain given limited public data.";
  const sanitized = sanitizeMarketProseCompetitorClaims(portersFiveForces, graph, "English");

  assert.doesNotMatch(sanitized, /Zephyra|Nordwing|Alta Systems/);
  assert.match(sanitized, /could not be independently validated/i);
  assert.match(sanitized, /Overall market growth remains uncertain given limited public data\./);
});

// ---------------------------------------------------------------------------
// D) Free-form model prose contradicts canonical competitor state ->
//    canonical state wins deterministically.
// ---------------------------------------------------------------------------

test("D) the exact reported contradiction shape: raw model prose claims strong validated competition while the canonical graph has none -- sanitized prose agrees with the canonical Competitive Landscape/Major Players state, not the other way around", () => {
  const graph = buildAdjacentOnlyGraph();
  const projection = projectMarketIntelligenceGraphToReport(graph, "English");

  const rawStrategicRecommendations =
    "1. Differentiate against direct rivals such as Procore and Autodesk Construction Cloud through faster onboarding.\n2. Expand into adjacent verticals within 12 months.";
  const sanitized = sanitizeMarketProseCompetitorClaims(rawStrategicRecommendations, graph, "English");

  // The canonical Competitive Landscape state (no validated direct
  // competitor) and the sanitized prose must agree: neither claims Procore
  // or Autodesk as validated direct rivals.
  assert.doesNotMatch(projection.competitiveLandscape, /Procore is a validated (?:direct )?competitor/i);
  assert.doesNotMatch(sanitized, /direct rivals such as Procore and Autodesk Construction Cloud/);
  assert.match(sanitized, /adjacent\/platform presence/i);
  // The unrelated second recommendation line survives untouched.
  assert.match(sanitized, /2\. Expand into adjacent verticals within 12 months\./);
});

// ---------------------------------------------------------------------------
// E) Porter's structural rivalry analysis without validated direct
//    competitor names remains allowed, properly framed.
// ---------------------------------------------------------------------------

test("E) generic structural rivalry analysis with no specific named rival is left completely untouched, even with zero validated direct competitors -- Porter's may still discuss competitive pressure analytically", () => {
  const graph = buildAdjacentOnlyGraph();
  const portersFiveForces =
    "Rivalry among existing competitors is assessed as moderate-to-high, driven by low switching costs and fragmented category positioning rather than confirmed head-to-head vendor comparisons. Buyer power is elevated given the availability of substitute workflows.";
  const sanitized = sanitizeMarketProseCompetitorClaims(portersFiveForces, graph, "English");

  assert.equal(sanitized, portersFiveForces, "generic, unnamed rivalry analysis must not be altered");
});

test("E) a rivalry-keyword sentence that happens to share a word with a real threat but names no known entity is untouched (no over-triggering on generic vocabulary)", () => {
  const graph = buildEmptyGraph();
  const threats = "Increased competition intensity across the category could compress margins over the next 18 months.";
  const sanitized = sanitizeMarketProseCompetitorClaims(threats, graph, "English");

  assert.equal(sanitized, threats);
});

// ---------------------------------------------------------------------------
// F) UI and PDF consume the same normalized competitor state -- the
//    sanitizer runs once, server-side, on the canonical report object
//    before it is ever persisted; no separate PDF-only interpretation.
// ---------------------------------------------------------------------------

const routeSource = readFileSync(new URL("../app/api/market-analysis/route.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

test("F) sanitizeMarketProseCompetitorClaims runs exactly once, server-side in applySharedMarketGraph, on the shared report object -- before buildMarketExecutiveDecisionBrief reads these same fields for the deterministic Executive Decision banner", () => {
  assert.match(routeSource, /import \{[\s\S]*?sanitizeMarketProseCompetitorClaims,[\s\S]*?\} from "@\/app\/lib\/ai\/market-intelligence-graph";/);

  const applySharedMarketGraphIndex = routeSource.indexOf("function applySharedMarketGraph(");
  const sanitizeCallIndex = routeSource.indexOf("sanitizeMarketProseCompetitorClaims(merged[field]");
  const buildBriefCallIndex = routeSource.indexOf("marketExecutiveDecisionBrief = buildMarketExecutiveDecisionBrief(");

  assert.ok(applySharedMarketGraphIndex >= 0);
  assert.ok(sanitizeCallIndex > applySharedMarketGraphIndex);
  assert.ok(
    buildBriefCallIndex > sanitizeCallIndex,
    "sanitization must run before buildMarketExecutiveDecisionBrief consumes opportunities/threats"
  );

  const occurrences = routeSource.match(/sanitizeMarketProseCompetitorClaims\(/g) || [];
  assert.equal(occurrences.length, 1, "must be called from exactly one place -- a single canonical normalization pass, not duplicated per surface");
});

test("F) web dashboard, Planner, and the exported PDF have no competing/duplicate competitor-prose sanitization of their own for these fields -- they render the already-sanitized section content as-is", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.doesNotMatch(source, /sanitizeMarketProseCompetitorClaims/);
    assert.doesNotMatch(source, /competitorClaimAdjacentReframeTemplate|competitorClaimUnsupportedReplacement/);
  }
});

test("F) the sanitized fields (marketDrivers/barriers/opportunities/threats/portersFiveForces/strategicRecommendations) are exactly the ones that can carry a competitor claim -- graph-owned fields (competitiveLandscape/majorPlayers/marketSize/tamSamSom/cagr/sources) are not redundantly re-sanitized", () => {
  const arrayMatch = routeSource.match(/const competitorClaimSensitiveFields: MarketReportField\[\] = \[([\s\S]*?)\];/);
  assert.ok(arrayMatch, "competitorClaimSensitiveFields array not found");
  const fields = arrayMatch[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  assert.deepEqual(
    fields.sort(),
    ["barriers", "marketDrivers", "opportunities", "portersFiveForces", "strategicRecommendations", "threats"].sort()
  );
  for (const graphOwnedField of ["competitiveLandscape", "majorPlayers", "marketSize", "tamSamSom", "cagr", "sources"]) {
    assert.ok(!fields.includes(graphOwnedField), `${graphOwnedField} is already graph-owned and must not be re-sanitized`);
  }
});
