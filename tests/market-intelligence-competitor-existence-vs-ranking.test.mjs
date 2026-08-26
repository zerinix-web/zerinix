import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import { assessMarketRelevance } from "../app/lib/ai/vendor-discovery.ts";

// P0 FIX #3 -- Competitive Landscape / Major Players evidence-to-report
// pipeline repair.
//
// ROOT CAUSES (confirmed via forensic trace, research -> vendor discovery ->
// graph -> report projection):
//
// 1. COMPETITOR EXISTENCE vs MAJOR PLAYER RANKING were conflated at the
//    projection layer. graph.vendorIntelligence already computes two
//    genuinely distinct tiers -- `vendors` (existence: cleared
//    validateVendorCandidate's multi-path corroboration bar) and
//    `adjacentPlayers` (relevant, evidence-named, but did not clear that
//    bar) -- plus a THIRD, stronger `eligibleForMajorPlayers` flag on each
//    vendor (ranking: evidenceCount>=2 && independentEvidenceCount>=2 &&
//    rankingScore>=40). But projectMarketIntelligenceGraphToReport
//    (market-intelligence-graph.ts) only ever read `adjacentPlayers` inside
//    the `else` branch -- i.e. only when ZERO candidates cleared the
//    existence bar. The moment even ONE candidate validated, every other
//    real, evidence-named, relevant company that didn't clear that same bar
//    was silently discarded from the ENTIRE report (not in Competitive
//    Landscape, not in Major Players, not anywhere) -- even though the
//    underlying evidence was identical to what the `else` branch already
//    surfaces honestly when it's the only evidence available.
//
// 2. assessMarketRelevance (vendor-discovery.ts)'s nonVendorRolePattern
//    included "law firm"/"accounting firm"/"cpa firm"/"consulting firm"/
//    "advisory firm"/"consultancy" as hard exclusion terms -- but these are
//    also extremely common CUSTOMER-SEGMENT descriptors for a B2B SaaS
//    vendor that sells TO that profession (an evidence sentence like
//    "practice management software for law firms" or "bookkeeping
//    services to accounting firms" names WHO BUYS the product, not what the
//    candidate itself is). A real, otherwise-fully-corroborated vendor was
//    excluded outright as though it WERE a law/accounting firm, purely
//    because its own evidence text described its target customer using
//    this phrase -- rejected before it could reach EITHER tier.
//
// FIX:
// 1. market-intelligence-graph.ts: the `if (renderableVendors.length > 0)`
//    branch now also appends graph.vendorIntelligence.adjacentPlayers to
//    projection.competitiveLandscape (existence tier), honestly labeled and
//    clearly distinct from the validated-vendor table -- never merged into
//    it, never promoted into majorPlayers (which stays exclusively
//    eligibleForMajorPlayers-gated, completely unchanged).
// 2. vendor-discovery.ts: assessMarketRelevance now only excludes on a
//    professional-services-firm term when it does NOT read as a customer-
//    segment description (i.e. it is not immediately preceded by an
//    explicit customer-targeting preposition). A genuine self-description
//    ("is a boutique law firm") is still excluded; the hard-exclusion terms
//    (implementation partner, marketplace, distributor, media, analyst
//    firm, etc.) are completely unchanged and still always exclude.

const checkedAt = "2026-08-22T00:00:00.000Z";
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

function officialMention({ name, domain, targetCustomer = "enterprise and SMB customers" }) {
  return baseEvidence({
    claim: `${name} provides subscription software with product and integration features for ${targetCustomer}.`,
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

// A single low-quality, single-domain mention -- the "NAME is a leading"
// phrasing clears extractHeuristicMentions' heuristic name-discovery
// pattern, and "software vendor" clears classifyOrganizationEntity's
// commercial_vendor bar -- but validateVendorCandidate's stricter
// multi-path corroboration bar still fails (no official page, only one
// independent domain, no review/filing evidence). Lands in adjacentPlayers,
// never in vendors.
function singleListicleMention({ name, domain, note = "active in this market" }) {
  return baseEvidence({
    claim: `${name} is a leading software vendor named in an industry roundup as ${note}.`,
    value: `${name} roundup mention`,
    sourceTitle: `${name} roundup listicle`,
    publisher: domain,
    url: `https://${domain}/blog/roundup`,
    searchQuery: `${name} market roundup`,
  });
}

const legalTechPrompt = "Analyze the U.S. AI-powered LegalTech SaaS market for small law firms.";

// ---------------------------------------------------------------------------
// CASE A: competitor existence validated, ranking evidence insufficient
// ---------------------------------------------------------------------------

test("CASE A: a vendor that clears existence validation but not the stronger ranking bar (eligibleForMajorPlayers=false) appears in Competitive Landscape, is NOT promoted to Major Players, and Major Players honestly says ranking evidence is insufficient", () => {
  // One official page, no second independent domain, no review -- clears
  // "official_page_plus_product_documentation" (existence) but has only
  // evidenceCount=1/independentEvidenceCount=1, below eligibleForMajorPlayers's
  // evidenceCount>=2 && independentEvidenceCount>=2 bar.
  const evidence = [officialMention({ name: "Lexoria", domain: "lexoria.example.com" })];
  const graph = buildMarketIntelligenceGraph({ evidence }, legalTechPrompt);

  const vendor = graph.vendorIntelligence.vendors.find((v) => v.name === "Lexoria");
  assert.ok(vendor, "Lexoria must clear the existence bar");
  assert.equal(vendor.eligibleForMajorPlayers, false, "a single-source vendor must not clear the stronger ranking bar");

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.match(projection.competitiveLandscape, /Lexoria/, "existence-validated competitor must appear in Competitive Landscape");
  assert.doesNotMatch(projection.majorPlayers, /Lexoria/, "must not be promoted to Major Players without ranking evidence");
  assert.match(projection.majorPlayers, /Insufficient independent evidence for Major Players ranking/i);
});

// ---------------------------------------------------------------------------
// CASE B: both existence and ranking evidence sufficient
// ---------------------------------------------------------------------------

test("CASE B: a vendor with two independent, qualifying sources clears BOTH existence and ranking -- appears in Competitive Landscape AND Major Players, with evidence preserved", () => {
  const evidence = [
    officialMention({ name: "Casewell", domain: "casewell.example.com" }),
    reviewMention({ name: "Casewell", domain: "g2.example.com" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, legalTechPrompt);

  const vendor = graph.vendorIntelligence.vendors.find((v) => v.name === "Casewell");
  assert.ok(vendor);
  assert.equal(vendor.eligibleForMajorPlayers, true, "two independent qualifying sources must clear the ranking bar");

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.match(projection.competitiveLandscape, /Casewell/);
  assert.match(projection.majorPlayers, /Casewell/);
  assert.equal(vendor.evidenceCount, 2, "evidence count from both sources must be preserved, not collapsed to one");
});

// ---------------------------------------------------------------------------
// CASE C: only an unsupported/unverifiable vendor claim exists
// ---------------------------------------------------------------------------

test("CASE C: a bare, single-source marketing claim with no independent corroboration is never presented as a validated direct competitor -- it is labeled honestly as an adjacent/relevant player instead", () => {
  const evidence = [singleListicleMention({ name: "Docketly", domain: "legaltechroundup.example.com" })];
  const graph = buildMarketIntelligenceGraph({ evidence }, legalTechPrompt);

  assert.equal(graph.vendorIntelligence.vendors.length, 0, "a single low-quality mention must never validate as a direct competitor");
  assert.ok(graph.vendorIntelligence.adjacentPlayers.some((p) => p.name === "Docketly"));

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.doesNotMatch(projection.competitiveLandscape, /Docketly is a validated (?:direct )?competitor/i);
  assert.match(projection.majorPlayers, /Docketly/);
  assert.match(projection.majorPlayers, /Not Independently Validated as Direct Competitors/i);
});

// ---------------------------------------------------------------------------
// CASE D: no defensible competitors found
// ---------------------------------------------------------------------------

test("CASE D: no vendor-relevant evidence at all -- Competitive Landscape and Major Players both stay Validation Needed, no company is invented", () => {
  const evidence = [
    baseEvidence({
      claim: "General commentary about the market with no numeric size figure or named vendor.",
      sourceTitle: "General overview",
      publisher: "Some Site",
      url: "https://somesite.example.com/overview",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "Analyze an obscure niche market.");
  assert.equal(graph.vendorIntelligence.vendors.length, 0);
  assert.equal(graph.vendorIntelligence.adjacentPlayers.length, 0);

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.equal(projection.competitiveLandscape, projection.majorPlayers);
  assert.doesNotMatch(projection.competitiveLandscape, /\$\d/, "must never fabricate a company or figure");
});

// ---------------------------------------------------------------------------
// CASE E: some competitors valid, others invalid -- one bad entry must not
// collapse the whole section
// ---------------------------------------------------------------------------

test("CASE E: a mix of a fully validated vendor, a ranking-ineligible-but-existence-validated vendor, an adjacent/unsupported mention, and an excluded non-vendor role -- each is classified independently; the whole section never collapses because of the weakest entry", () => {
  const evidence = [
    // Fully validated + ranking-eligible.
    officialMention({ name: "Casewell", domain: "casewell.example.com" }),
    reviewMention({ name: "Casewell", domain: "capterra.example.com" }),
    // Existence-validated only (single official page, no second source).
    officialMention({ name: "Lexoria", domain: "lexoria.example.com" }),
    // Adjacent/unsupported (single roundup mention only).
    singleListicleMention({ name: "Docketly", domain: "legaltechroundup.example.com" }),
    // Excluded entirely: a genuine implementation partner, not a vendor.
    baseEvidence({
      claim: "Bramwell Systems Integrators offers implementation partner services and systems integrator consulting for enterprise legal tech rollouts.",
      value: "Bramwell Systems Integrators implementation partner services",
      sourceTitle: "Bramwell Systems Integrators directory listing",
      publisher: "partnerdirectory.example.com",
      url: "https://partnerdirectory.example.com/directory/bramwell",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, legalTechPrompt);

  const vendorNames = graph.vendorIntelligence.vendors.map((v) => v.name).sort();
  const adjacentNames = graph.vendorIntelligence.adjacentPlayers.map((p) => p.name).sort();
  assert.deepEqual(vendorNames, ["Casewell", "Lexoria"]);
  assert.deepEqual(adjacentNames, ["Docketly"]);
  assert.ok(!adjacentNames.some((n) => n.includes("Bramwell")));
  assert.ok(!vendorNames.some((n) => n.includes("Bramwell")));

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  // All three legitimate entries survive in Competitive Landscape.
  assert.match(projection.competitiveLandscape, /Casewell/);
  assert.match(projection.competitiveLandscape, /Lexoria/);
  assert.match(projection.competitiveLandscape, /Docketly/);
  assert.doesNotMatch(projection.competitiveLandscape, /Bramwell/);
  // Only the ranking-eligible vendor reaches Major Players.
  assert.match(projection.majorPlayers, /Casewell/);
  assert.doesNotMatch(projection.majorPlayers, /Lexoria/);
  assert.doesNotMatch(projection.majorPlayers, /Docketly/);
  assert.doesNotMatch(projection.majorPlayers, /Bramwell/);
});

// ---------------------------------------------------------------------------
// REGRESSION (the actual production defect, bug #1): adjacentPlayers were
// silently dropped from the ENTIRE report the moment any vendor validated.
// ---------------------------------------------------------------------------

test("REGRESSION: an adjacent/relevant player is no longer silently dropped from the whole report merely because a DIFFERENT candidate cleared the stricter direct-competitor bar", () => {
  const evidence = [
    officialMention({ name: "Casewell", domain: "casewell.example.com" }),
    reviewMention({ name: "Casewell", domain: "capterra.example.com" }),
    singleListicleMention({ name: "Docketly", domain: "legaltechroundup.example.com" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, legalTechPrompt);
  assert.ok(graph.vendorIntelligence.vendors.length > 0, "sanity check: at least one vendor validated");
  assert.ok(graph.vendorIntelligence.adjacentPlayers.some((p) => p.name === "Docketly"), "sanity check: Docketly is a real adjacent player");

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.match(
    projection.competitiveLandscape,
    /Docketly/,
    "the adjacent player's evidence must survive into Competitive Landscape, not disappear entirely"
  );
  assert.doesNotMatch(
    projection.majorPlayers,
    /Docketly/,
    "an adjacent player must never be promoted into Major Players just because it was rescued from disappearing"
  );
});

// ---------------------------------------------------------------------------
// REGRESSION (the actual production defect, bug #2): assessMarketRelevance's
// professional-services-firm terms rejected a vendor for describing its own
// customer segment.
// ---------------------------------------------------------------------------

test("REGRESSION: a LegalTech vendor is no longer excluded from relevance merely because its own evidence describes its customer segment as 'law firms' -- customer-targeting framing is distinguished from a genuine self-description", () => {
  const candidate = { canonicalName: "Casewell", sourceDomains: ["casewell.example.com"] };
  const customerFramed = assessMarketRelevance(
    candidate,
    null,
    "Casewell provides cloud-based practice management software for law firms, offering case management, billing, and client communication tools.",
    legalTechPrompt
  );
  assert.equal(customerFramed.relevant, true, "'software for law firms' names a customer segment, not the candidate's own identity");

  const customerFramedAlt = assessMarketRelevance(
    candidate,
    null,
    "Casewell offers AI-assisted bookkeeping-style compliance services to accounting firms and law firms alike.",
    legalTechPrompt
  );
  assert.equal(customerFramedAlt.relevant, true, "'services to accounting firms' is also customer framing, not self-description");
});

test("a genuine self-described law/accounting/consulting firm is still excluded -- the customer-framing exception never rescues an actual professional-services firm", () => {
  const candidate = { canonicalName: "Whitfield & Cross", sourceDomains: ["whitfieldcross.example.com"] };
  const result = assessMarketRelevance(
    candidate,
    null,
    "Whitfield & Cross is a boutique law firm serving corporate clients in New York.",
    legalTechPrompt
  );
  assert.equal(result.relevant, false, "a genuine self-described law firm must remain excluded");
  assert.match(result.reason, /Excluded/i);
});

test("the hard-exclusion terms (implementation partner, marketplace, distributor, media company, analyst firm) are completely unchanged and still always exclude, regardless of customer-framing wording nearby", () => {
  const candidate = { canonicalName: "Bramwell Systems Integrators", sourceDomains: ["bramwell.example.com"] };
  const result = assessMarketRelevance(
    candidate,
    null,
    "Bramwell Systems Integrators offers implementation partner services for law firms adopting new case management software.",
    legalTechPrompt
  );
  assert.equal(result.relevant, false, "an implementation partner must remain excluded even when its own text also mentions a customer-targeting phrase");
});

// ---------------------------------------------------------------------------
// Duplicate representations of the same vendor are safely deduplicated
// ---------------------------------------------------------------------------

test("duplicate representations of the same vendor (different casing, alias mention, multiple review sources) merge into ONE competitor entry -- never deleted entirely, never duplicated as two rows", () => {
  const evidence = [
    officialMention({ name: "Casewell", domain: "casewell.example.com" }),
    reviewMention({ name: "casewell", domain: "g2.example.com" }),
    reviewMention({ name: "Casewell", domain: "capterra.example.com" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, legalTechPrompt);

  const matches = graph.vendorIntelligence.vendors.filter((v) => v.name.toLowerCase() === "casewell");
  assert.equal(matches.length, 1, "three mentions of the same vendor (case-insensitive) must merge into exactly one entry, not zero and not multiple");
  assert.ok(matches[0].evidenceCount >= 2, "evidence from all merged mentions must be preserved, not discarded");

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  const tableRowLines = projection.competitiveLandscape
    .split("\n")
    .filter((line) => line.trim().toLowerCase().startsWith("| casewell |"));
  assert.equal(tableRowLines.length, 1, "the merged vendor must appear as exactly one row in the competitor table, not once per source mention");
});

// ---------------------------------------------------------------------------
// UI/PDF consume the same canonical competitor fields
// ---------------------------------------------------------------------------

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

test("PARITY: both page.tsx and ReportPdfButton.tsx derive their competitor rows from the SAME canonical `competitiveLandscape`/`majorPlayers` report fields (the graph-owned projection this fix modifies) -- neither surface maintains an independent competitor data source", () => {
  assert.match(pageSource, /function extractMarketIntelligenceCompetitorRows\(/);
  assert.match(pdfButtonSource, /function extractMarketIntelligenceCompetitorRows\(/);
});

// ---------------------------------------------------------------------------
// Drift checks: ranking standard and other P0 fixes untouched
// ---------------------------------------------------------------------------

test("DRIFT CHECK: eligibleForMajorPlayers' ranking bar (evidenceCount>=2 && independentEvidenceCount>=2 && rankingScore>=40) is untouched -- this fix never weakens what counts as Major Player ranking evidence", () => {
  const vendorIntelligenceSource = readFileSync("app/lib/ai/vendor-intelligence.ts", "utf8");
  assert.match(
    vendorIntelligenceSource,
    /eligibleForMajorPlayers:\s*\n\s*evidenceCount >= 2 && independentEvidenceCount >= 2 && rankingScore >= 40,/
  );
});

test("DRIFT CHECK: validateVendorCandidate's 5-path existence bar is untouched -- this fix never weakens what counts as a validated direct competitor", () => {
  const vendorDiscoverySource = readFileSync("app/lib/ai/vendor-discovery.ts", "utf8");
  assert.match(vendorDiscoverySource, /official_product_page_plus_independent_source/);
  assert.match(vendorDiscoverySource, /official_page_plus_customer_review_evidence/);
  assert.match(vendorDiscoverySource, /official_page_plus_product_documentation/);
  assert.match(vendorDiscoverySource, /two_independent_commercial_or_industry_sources/);
  assert.match(vendorDiscoverySource, /public_filing_or_investor_material/);
});

test("DRIFT CHECK: P0 FIX #1 (TAM/SAM/SOM) and P0 FIX #2 (CAGR) are untouched by this pass", () => {
  const reportPresentationSource = readFileSync("app/lib/report-presentation.ts", "utf8");
  assert.match(reportPresentationSource, /export function resolveMarketSizingCascade\(/);
  assert.match(pdfButtonSource, /const cascade = resolveMarketSizingCascade\(magnitudes\);/);

  const routeSource = readFileSync("app/api/market-analysis/route.ts", "utf8");
  assert.match(
    routeSource,
    /excludedFields:\s*\[\s*"strategicRecommendations",\s*"tamSamSom",\s*"executiveSummary",\s*"competitiveLandscape",\s*"majorPlayers",\s*"cagr",?\s*\]/
  );
  assert.match(routeSource, /if \(field === "cagr"\) \{/);
});
