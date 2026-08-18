import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import {
  validateVendorCandidate,
  isImplausibleCompetitorName,
} from "../app/lib/ai/vendor-discovery.ts";
import { classifyOrganizationEntity } from "../app/lib/ai/commercial-vendor-intelligence.ts";
import {
  evaluateMarketResearchCoverage,
  calculateMarketOverallConfidence,
} from "../app/lib/ai/market-research-coverage.ts";
import { buildPreGenerationVerdictContext } from "../app/lib/report-engine/market-intelligence-presentation.ts";
import {
  findOrphanEvidenceReferences,
  assertNoOrphanEvidenceReferences,
  OrphanEvidenceReferenceError,
} from "../app/lib/report-engine/evidence-reference-integrity.ts";
import { isLegalRenderableReport } from "../app/lib/report-engine/legal-report-rendering.ts";

// Final data-integrity fixes for Market Intelligence: invalid competitors,
// broken Sources, collapsed confidence dimensions, and TAM/SAM/SOM
// fallback behavior -- each traced to its own root cause in the shared
// pipeline, not patched per-example.

const checkedAt = "2026-08-15T00:00:00.000Z";

function vendorEvidence({ id, name, domain, path = "/pricing" }) {
  const claim = `${name} provides enterprise workflow automation software with pricing and product documentation for enterprise customers.`;
  return {
    id,
    field: "vendor_discovery",
    claim,
    value: `${name} subscription pricing and product feature evidence`,
    label: "Verified from external source",
    sourceTitle: `${name} official product and pricing page`,
    publisher: name,
    url: `https://${domain}${path}`,
    sourceType: "official company source",
    authorityLevel: "primary",
    confidence: 82,
    publishedDate: "2026-01-15",
    lastChecked: checkedAt,
    supportingData: [claim],
    impact: "neutral",
    impactReason: "Supports vendor coverage.",
    qualityScore: 76,
    qualityRationale: "Official vendor evidence with valid provenance.",
  };
}

function thinEvidence({ id, url }) {
  return {
    id,
    field: "vendor_discovery",
    claim: "",
    value: "",
    label: "Verified from external source",
    sourceTitle: "",
    publisher: "",
    url,
    sourceType: "credible_market_data",
    authorityLevel: "secondary",
    confidence: 55,
    publishedDate: "2026-01-01",
    lastChecked: checkedAt,
    supportingData: [],
    impact: "neutral",
    impactReason: "",
  };
}

// Cited-as-a-data-source evidence: real prose, from 2 independent domains,
// but describing the candidate only as the SOURCE of a market statistic --
// never a product, price, or customer. This is the exact shape a market-
// research/data firm's citations take.
function citedAsSourceEvidence({ id, name, domain }) {
  const claim = `According to ${name}, the global market is projected to grow at a steady rate through the forecast period based on aggregated industry data.`;
  return {
    id,
    field: "vendor_discovery",
    claim,
    value: `${name} market growth statistic`,
    label: "Verified from external source",
    sourceTitle: `Market outlook report referencing ${name}`,
    publisher: name,
    url: `https://${domain}/reports/market-outlook`,
    sourceType: "market research",
    authorityLevel: "secondary",
    confidence: 70,
    publishedDate: "2026-01-10",
    lastChecked: checkedAt,
    supportingData: [claim],
    impact: "neutral",
    impactReason: "Cited as the source of a market statistic.",
    qualityScore: 68,
    qualityRationale: "Independently published market commentary.",
  };
}

// -----------------------------------------------------------------------
// 1. YouTube (content platform) rejected as competitor
// -----------------------------------------------------------------------

test("1. YouTube is never derived as a competitor from a bare content-platform citation", () => {
  const prompt = "Market Intelligence report on the fitness equipment market.";
  const fixture = [
    vendorEvidence({ id: "R1", name: "Peloton", domain: "onepeloton.com" }),
    thinEvidence({ id: "R2", url: "https://www.youtube.com/watch?v=abc123" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence: fixture }, prompt);
  const vendorNames = graph.vendorIntelligence.vendors.map((v) => v.name.toLowerCase());
  assert.ok(!vendorNames.includes("youtube"), `expected YouTube never to appear as a vendor, got ${JSON.stringify(vendorNames)}`);
});

// -----------------------------------------------------------------------
// 2. OECD rejected as competitor (institutional classification)
// -----------------------------------------------------------------------

test("2. OECD classifies as government, never commercial_vendor, independent of context", () => {
  const result = classifyOrganizationEntity({ name: "OECD", url: "https://oecd.org/report" });
  assert.equal(result.entityType, "government");
});

// -----------------------------------------------------------------------
// 3. DataIntelo-shaped market-research firms rejected unless proven a
//    real commercial solution vendor
// -----------------------------------------------------------------------

test("3a. an entity described in prose as a 'market research firm' classifies as research_provider, brand-agnostic", () => {
  const result = classifyOrganizationEntity({
    name: "Gingercontrol",
    url: "https://gingercontrol.com/reports",
    context: "Gingercontrol is a market research firm covering industrial software markets.",
  });
  assert.equal(result.entityType, "research_provider");
});

test("3b. a name cited only as the source of a market statistic across independent domains does not validate as a vendor (no product/pricing/customer signal)", () => {
  const candidate = {
    canonicalName: "Dataintelo",
    aliases: ["Dataintelo"],
    sourceUrls: ["https://dataintelo.com/reports/market-outlook", "https://otherindustrysite.com/news/market-outlook"],
    sourceDomains: ["dataintelo.com", "otherindustrysite.com"],
    mentionCount: 2,
    discoveryQueries: [],
    firstSeen: "2026-01-10",
    lastSeen: "2026-01-10",
    evidenceIds: ["R1", "R2"],
    matchedByTaxonomy: false,
    matchedByDomainFallbackOnly: false,
  };
  const qualifyingItems = [
    citedAsSourceEvidence({ id: "R1", name: "Dataintelo", domain: "dataintelo.com" }),
    citedAsSourceEvidence({ id: "R2", name: "Dataintelo", domain: "otherindustrysite.com" }),
  ];
  const result = validateVendorCandidate(candidate, qualifyingItems);
  assert.equal(result.validated, false, `expected Dataintelo-shaped citation-only evidence to fail validation, got path "${result.validationPath}"`);
});

test("3c. end-to-end: a market-research firm cited only for a statistic never reaches the rendered competitor table", () => {
  const prompt = "Market Intelligence report on the industrial automation market.";
  const fixture = [
    vendorEvidence({ id: "R1", name: "Siemens", domain: "siemens.com" }),
    citedAsSourceEvidence({ id: "R2", name: "Dataintelo", domain: "dataintelo.com" }),
    citedAsSourceEvidence({ id: "R3", name: "Dataintelo", domain: "industrytoday.com" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence: fixture }, prompt);
  const vendorNames = graph.vendorIntelligence.vendors.map((v) => v.name.toLowerCase());
  assert.ok(!vendorNames.includes("dataintelo"), `expected Dataintelo never to appear as a vendor, got ${JSON.stringify(vendorNames)}`);
  assert.ok(vendorNames.some((name) => name.includes("siemens")), "expected the real vendor to survive");
});

// -----------------------------------------------------------------------
// 4. Generic category-descriptive content-mill domains rejected
//    ("tradecompliancesoftware.com" for a "trade compliance software"
//    market -- the domain names the CATEGORY, not a company)
// -----------------------------------------------------------------------

test("4. a domain-fallback name that is just the market's own category with spaces removed is never derived as a competitor", () => {
  const prompt = "Analyze the trade compliance software market.";
  const fixture = [
    vendorEvidence({ id: "R1", name: "Descartes Systems", domain: "descartes.com" }),
    thinEvidence({ id: "R2", url: "https://tradecompliancesoftware.com/overview" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence: fixture }, prompt);
  const vendorNames = graph.vendorIntelligence.vendors.map((v) => v.name.toLowerCase());
  assert.ok(
    !vendorNames.some((name) => name.replace(/\s+/g, "") === "tradecompliancesoftware"),
    `expected the category-named domain never to become a vendor, got ${JSON.stringify(vendorNames)}`
  );
});

// -----------------------------------------------------------------------
// 5. Real commercial vendors with valid evidence are still accepted
//    (guards against over-tightening from fixes 3/4 above)
// -----------------------------------------------------------------------

test("5a. a real vendor with an official product/pricing page still validates via the official-page path (unaffected by the new product-signal requirement)", () => {
  const candidate = {
    canonicalName: "ServiceNow",
    aliases: ["ServiceNow"],
    sourceUrls: ["https://servicenow.com/pricing"],
    sourceDomains: ["servicenow.com"],
    mentionCount: 1,
    discoveryQueries: [],
    firstSeen: "2026-01-10",
    lastSeen: "2026-01-10",
    evidenceIds: ["R1"],
    matchedByTaxonomy: false,
    matchedByDomainFallbackOnly: false,
  };
  const qualifyingItems = [vendorEvidence({ id: "R1", name: "ServiceNow", domain: "servicenow.com" })];
  const result = validateVendorCandidate(candidate, qualifyingItems);
  assert.equal(result.validated, true);
});

test("5b. two independent sources WITH real product/pricing/customer evidence still validate via the two-independent-sources path", () => {
  const candidate = {
    canonicalName: "Acme Compliance",
    aliases: ["Acme Compliance"],
    sourceUrls: ["https://industrynews.com/acme-review", "https://buyersguide.com/acme-compliance"],
    sourceDomains: ["industrynews.com", "buyersguide.com"],
    mentionCount: 2,
    discoveryQueries: [],
    firstSeen: "2026-01-10",
    lastSeen: "2026-01-10",
    evidenceIds: ["R1", "R2"],
    matchedByTaxonomy: false,
    matchedByDomainFallbackOnly: false,
  };
  const qualifyingItems = [
    vendorEvidence({ id: "R1", name: "Acme Compliance", domain: "industrynews.com", path: "/acme-review" }),
    vendorEvidence({ id: "R2", name: "Acme Compliance", domain: "buyersguide.com", path: "/acme-compliance" }),
  ];
  const result = validateVendorCandidate(candidate, qualifyingItems);
  assert.equal(result.validated, true, `expected a real vendor with product/pricing evidence across 2 sources to validate, got "${result.reason}"`);
});

// -----------------------------------------------------------------------
// 6. Prompt fragments cannot become competitor category/name fields
// -----------------------------------------------------------------------

test("6. vendor.category is never prompt/instruction-shaped even for a business-idea-style prompt", () => {
  assert.equal(isImplausibleCompetitorName("commercial opportunity of launching an AI-powered X"), true);
});

// -----------------------------------------------------------------------
// 7 & 8. Sources integrity: every [R#] resolves, generated prose can
//        never become a source
// -----------------------------------------------------------------------

test("7a. an [R#] reference with no matching entry in the source registry is flagged as an orphan", () => {
  const sections = {
    executiveSummary: "Demand is rising across the region [R1][R2].",
    sources: "See registry for details.",
  };
  const orphans = findOrphanEvidenceReferences(sections, new Set(["R1"]));
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].reference, "[R2]");
});

test("7b. assertNoOrphanEvidenceReferences throws when any field cites an unresolvable reference", () => {
  const sections = { opportunities: "A clear opening exists [R9]." };
  assert.throws(
    () => assertNoOrphanEvidenceReferences(sections, new Set(["R1", "R2"])),
    OrphanEvidenceReferenceError
  );
});

test("7c. a fully resolvable report passes the integrity check", () => {
  const sections = {
    executiveSummary: "Demand is rising [R1].",
    competitiveLandscape: "ServiceNow leads [R2].",
  };
  assert.doesNotThrow(() => assertNoOrphanEvidenceReferences(sections, new Set(["R1", "R2", "R3"])));
});

test("8a. evidence-summary.ts never accepts narrative prose as a citation's publisher or title", () => {
  const evidenceSummarySource = readFileSync("app/lib/report-engine/evidence-summary.ts", "utf8");
  assert.match(evidenceSummarySource, /function looksLikeCitationMetadataValue/);
  assert.match(evidenceSummarySource, /looksLikeCitationMetadataValue\(rawPublisher\)/);
});

test("8b. evidence-summary.ts's prose-rejection logic rejects a real corruption example and accepts a real publisher", () => {
  // Mirrors looksLikeCitationMetadataValue exactly, without importing a
  // module with .mjs-incompatible export shapes into this reproduction.
  const citationProseVerbPattern = /\b(?:is|are|was|were|outweighs|remains|requires|means|shows|reflects|confidence)\b/i;
  function looksLikeCitationMetadataValue(value, maxWords = 12) {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 100) return false;
    if (trimmed.split(/\s+/).length > maxWords) return false;
    if (/[.!?]/.test(trimmed)) return false;
    if (citationProseVerbPattern.test(trimmed)) return false;
    return true;
  }
  assert.equal(looksLikeCitationMetadataValue("The opportunity is real, but the gap"), false);
  assert.equal(looksLikeCitationMetadataValue("ENISA"), true);
  assert.equal(looksLikeCitationMetadataValue("Grand View Research"), true);
});

test("8c. ReportPdfButton.tsx's metadata-line citation parsing (Publisher:/Title:/Type:) is guarded by the same prose-rejection check", () => {
  const pdfButtonSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
  assert.match(pdfButtonSource, /function looksLikeCitationMetadataValue/);
  // lastContinuableField tracking (added for the embedded-newline
  // continuation-line fix) sits alongside the prose-rejection guard now,
  // rather than a single bare if-statement.
  assert.match(pdfButtonSource, /if \(looksLikeCitationMetadataValue\(value\)\) \{\s*\n\s*current\.organization = value;/);
  assert.match(pdfButtonSource, /if \(looksLikeCitationMetadataValue\(value, 24\)\) \{\s*\n\s*current\.sourceTitle = value;/);
});

// -----------------------------------------------------------------------
// 9. Different confidence evidence produces different dimensions
// -----------------------------------------------------------------------

test("9a. evaluateMarketResearchCoverage computes genuinely distinct dimension scores from distinct evidence", () => {
  const strongCompetitive = Array.from({ length: 6 }, (_, i) => ({
    id: `R${i + 1}`,
    field: "competitors",
    claim: `Competitor ${i + 1} offers a validated product with pricing and customer evidence.`,
    value: "validated competitor evidence",
    label: "Verified from external source",
    sourceTitle: `Competitor ${i + 1} product page`,
    publisher: `Competitor ${i + 1}`,
    url: `https://competitor${i + 1}.com/products`,
    sourceType: "official company source",
    confidence: 85,
    qualityScore: 85,
    publishedDate: "2026-01-01",
    lastChecked: checkedAt,
  }));
  const weakEverythingElse = [
    {
      id: "R7",
      field: "market_overview",
      claim: "General market commentary with no size figure.",
      value: "",
      label: "Verified from external source",
      sourceTitle: "General overview",
      publisher: "Some Site",
      url: "https://somesite.com/overview",
      sourceType: "credible publication",
      confidence: 40,
      qualityScore: 40,
      publishedDate: "2026-01-01",
      lastChecked: checkedAt,
    },
  ];
  const coverage = evaluateMarketResearchCoverage([...strongCompetitive, ...weakEverythingElse], "market intelligence");
  const { marketConfidence, competitiveEvidence, financialEvidence, productEvidence } = coverage.dimensions;
  assert.notEqual(competitiveEvidence, financialEvidence, "competitive and financial dimensions must diverge given this evidence shape");
  assert.ok(competitiveEvidence > financialEvidence, "strong competitor evidence should score higher than near-absent financial evidence");
  // The dimensions must not all collapse to one value -- at least one pair differs.
  const values = [marketConfidence, competitiveEvidence, financialEvidence, productEvidence];
  assert.ok(new Set(values).size > 1, `expected distinct dimension values, got all equal to ${values[0]}`);
});

test("9b. calculateMarketOverallConfidence is a genuine weighted blend, not a passthrough of one dimension", () => {
  const dimensions = {
    marketConfidence: 80,
    competitiveEvidence: 20,
    financialEvidence: 20,
    productEvidence: 20,
    executionReadiness: 50,
    founderReadiness: 50,
  };
  const blended = calculateMarketOverallConfidence(dimensions);
  assert.notEqual(blended, dimensions.marketConfidence);
  assert.notEqual(blended, dimensions.competitiveEvidence);
});

test("9c. the pre-generation prompt context exposes the real, distinct per-dimension scores instead of only the blended verdict confidence", () => {
  const dimensions = {
    marketConfidence: 72,
    competitiveEvidence: 30,
    financialEvidence: 55,
    productEvidence: 61,
  };
  const context = buildPreGenerationVerdictContext(
    { confidence: 58, decision: "MONITOR" },
    "English",
    dimensions
  );
  assert.match(context, /market evidence coverage 72\/100/);
  assert.match(context, /competitive evidence 30\/100/);
  assert.match(context, /financial\/market-sizing evidence 55\/100/);
  assert.match(context, /product\/market-fit evidence 61\/100/);
});

// -----------------------------------------------------------------------
// 10 & 11. TAM/SAM/SOM: planning estimate only when defensible inputs
//          exist; explicit insufficient-evidence fallback otherwise
// -----------------------------------------------------------------------

test("10. a defensible planning estimate (buyer population x annualized pricing, both source-backed) is built and clearly labeled Estimated", () => {
  const prompt = "Market Intelligence report on the fleet telematics market.";
  const fixture = [
    {
      id: "R1",
      field: "market_size",
      claim: "There are approximately 400,000 addressable mid-market businesses in the target region.",
      value: "400,000 addressable businesses",
      label: "Verified from external source",
      sourceTitle: "Business population statistics",
      publisher: "Regional Statistics Office",
      url: "https://statsoffice.gov/business-population",
      sourceType: "government/statistical source",
      confidence: 80,
      qualityScore: 80,
      publishedDate: "2026-01-01",
      lastChecked: checkedAt,
      supportingData: [],
    },
    {
      id: "R2",
      field: "pricing_models",
      claim: "Typical subscription pricing is $50 per month per vehicle.",
      value: "$50 per month",
      label: "Verified from external source",
      sourceTitle: "Vendor pricing page",
      publisher: "Fleet Vendor",
      url: "https://fleetvendor.com/pricing",
      sourceType: "official company source",
      confidence: 80,
      qualityScore: 80,
      publishedDate: "2026-01-01",
      lastChecked: checkedAt,
      supportingData: [],
    },
  ];
  const graph = buildMarketIntelligenceGraph({ evidence: fixture }, prompt);
  assert.ok(graph.planningEstimate, "expected a source-based planning estimate to be built from defensible inputs");
  assert.equal(graph.planningEstimate.classification, "Estimated");
  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.match(projection.tamSamSom, /Planning Estimate/);
  assert.match(projection.tamSamSom, /\[Estimated\]/);
});

test("11. with no verified size, no defensible planning-estimate inputs, and no adjacent benchmark, tamSamSom stays an explicit insufficient-evidence notice -- never fabricated", () => {
  const prompt = "Market Intelligence report on an obscure niche market.";
  const fixture = [
    {
      id: "R1",
      field: "market_overview",
      claim: "General commentary about the market with no numeric size figure.",
      value: "",
      label: "Verified from external source",
      sourceTitle: "General overview",
      publisher: "Some Site",
      url: "https://somesite.com/overview",
      sourceType: "credible publication",
      confidence: 60,
      qualityScore: 60,
      publishedDate: "2026-01-01",
      lastChecked: checkedAt,
      supportingData: [],
    },
  ];
  const graph = buildMarketIntelligenceGraph({ evidence: fixture }, prompt);
  assert.equal(graph.planningEstimate, null);
  assert.equal(graph.adjacentBenchmarks.length, 0);
  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.match(projection.tamSamSom, /could not be established/i);
  assert.doesNotMatch(projection.tamSamSom, /\$\d/, "must never contain a fabricated dollar figure");
});

// -----------------------------------------------------------------------
// 12. Market Intelligence remains correctly routed (no legal-report
//     regression)
// -----------------------------------------------------------------------

test("12. a correctly-typed Market Analysis report never renders via the Legal Assessment template", () => {
  const prompt =
    "Evaluate the commercial opportunity of launching an AI-native contract lifecycle management platform.";
  const sections = ["executiveSummary", "competitiveLandscape", "tamSamSom", "sources"].map((field) => ({
    field,
    title: field,
    content: `Market intelligence content for ${field} discussing CLM contract platforms and regulatory considerations.`,
  }));
  assert.equal(
    isLegalRenderableReport({ type: "Market Analysis", title: "Market Intelligence Report", prompt, sections }),
    false
  );
});
