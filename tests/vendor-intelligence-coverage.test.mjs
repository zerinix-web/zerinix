import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import {
  expandMarketTaxonomyTerms,
  getMarketTaxonomyProfile,
} from "../app/lib/ai/market-taxonomy.ts";
import { classifyOrganizationEntity } from "../app/lib/ai/commercial-vendor-intelligence.ts";

const checkedAt = "2026-08-02T00:00:00.000Z";

function vendorEvidence({ id, name, domain, category }) {
  const claim = `${name} provides ${category} subscription software with workflow features for enterprise and SMB customers.`;
  return {
    id,
    field: "vendor_discovery",
    claim,
    value: `${name} subscription pricing and product feature evidence`,
    label: "Verified from external source",
    sourceTitle: `${name} official product and pricing page`,
    publisher: name,
    url: `https://${domain}/pricing`,
    sourceType: "company_source",
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

function analystEvidence({ id, name, category, index }) {
  return {
    ...vendorEvidence({
      id,
      name: "Gartner",
      domain: "gartner.com",
      category,
    }),
    claim: `Independent market coverage identifies ${name} as a ${category} vendor with product, customer, and market evidence.`,
    value: `${name} vendor market mention`,
    sourceTitle: `${category} vendor landscape ${index + 1}`,
    publisher: "Gartner",
    url: `https://www.gartner.com/en/research/vendor-landscape-${index + 1}`,
    sourceType: "credible_market_data",
    authorityLevel: "secondary",
  };
}

function infrastructureEvidence(id, publisher, domain, sourceType, claim) {
  return {
    ...vendorEvidence({ id, name: publisher, domain, category: "market infrastructure" }),
    publisher,
    sourceTitle: `${publisher} official market infrastructure data`,
    url: `https://${domain}/data`,
    sourceType,
    claim,
    value: claim,
  };
}

const markets = [
  "Analyze the US AI accounting software market.",
  "Analyze the AI legal software market.",
  "Analyze the Construction ERP market.",
  "Analyze CRM platforms.",
  "Analyze Cybersecurity MDR.",
  "Analyze Healthcare AI.",
];

for (const prompt of markets) {
  test(`${prompt} expands taxonomy and produces evidence-first vendor coverage`, () => {
    const taxonomy = getMarketTaxonomyProfile(prompt);
    const terms = expandMarketTaxonomyTerms(prompt);
    const fixture = [
      ...taxonomy.vendors.slice(0, 10).flatMap((vendor, index) => [
        vendorEvidence({
          id: `R${index + 1}`,
          name: vendor.name,
          domain: vendor.domains[0],
          category: taxonomy.productCategory,
        }),
        analystEvidence({
          id: `A${index + 1}`,
          name: vendor.name,
          category: taxonomy.productCategory,
          index,
        }),
      ]),
      infrastructureEvidence("I1", "Bureau of Economic Analysis", "bea.gov", "official_statistics", "BEA provides official economic statistics."),
      infrastructureEvidence("I2", "SEC", "sec.gov", "official_filing", "SEC EDGAR provides regulated company filings."),
      infrastructureEvidence("I3", "FASB", "fasb.org", "standards", "FASB maintains accounting standards."),
    ];
    const graph = buildMarketIntelligenceGraph({ evidence: fixture }, prompt);
    const projection = projectMarketIntelligenceGraphToReport(graph);
    const evidenceIds = new Set(fixture.map((item) => item.id));

    assert.ok(terms.length >= 2);
    assert.ok(taxonomy.productCategory);
    assert.ok(taxonomy.industry);
    assert.ok(graph.vendorIntelligence.vendors.length >= 10);
    assert.ok(graph.vendorIntelligence.vendors.length <= 30);
    assert.equal(
      graph.coverage.competitorBreadth,
      graph.vendorIntelligence.vendors.length
    );
    assert.ok(graph.vendorIntelligence.coverage.sufficient);
    assert.ok(
      graph.vendorIntelligence.coverage.competitiveCoverageScore >= 60
    );
    assert.ok(
      graph.vendorIntelligence.coverage.vendorsWithPricingEvidence >= 10
    );
    assert.ok(
      graph.vendorIntelligence.coverage.vendorsWithFeatureEvidence >= 10
    );
    assert.ok(
      graph.vendorIntelligence.coverage.vendorsWithCustomerEvidence >= 10
    );

    for (const vendor of graph.vendorIntelligence.vendors) {
      assert.ok(vendor.name);
      assert.equal(vendor.category, taxonomy.productCategory);
      assert.ok(vendor.website.startsWith("https://"));
      assert.ok(vendor.pricingModels.includes("Subscription"));
      assert.ok(vendor.classifications.includes("Enterprise"));
      assert.ok(vendor.classifications.includes("SMB"));
      assert.ok(vendor.evidenceSources.every((id) => evidenceIds.has(id)));
      assert.ok(vendor.confidence > 0);
      assert.ok(vendor.rankingScore >= 40);
    }
    const majorPlayers = graph.vendorIntelligence.vendors.filter(
      (vendor) => vendor.eligibleForMajorPlayers
    );
    assert.ok(majorPlayers.length >= 8);
    assert.ok(majorPlayers.every((vendor) =>
      vendor.evidenceCount >= 2 && vendor.independentEvidenceCount >= 2
    ));

    assert.ok(graph.vendorIntelligence.entities.every((entity) => entity.entityType));
    assert.ok(graph.vendorIntelligence.marketInfrastructure.some((entity) => entity.name === "SEC"));
    assert.ok(graph.vendorIntelligence.marketInfrastructure.some((entity) => entity.name === "FASB"));
    assert.ok(graph.vendorIntelligence.evidenceProviders.some((entity) => entity.name === "Gartner"));
    assert.doesNotMatch(projection.competitiveLandscape, /\bSEC\b|\bFASB\b|Bureau of Economic Analysis/);
    assert.match(projection.marketInfrastructure, /SEC/);

    // Natural-language coverage explanation, not an internal-diagnostics
    // dump (candidate counts, packed discovery queries, "no vendor
    // mentions passed validation") -- see describeCompetitiveCoverage in
    // market-intelligence-graph.ts.
    assert.match(projection.competitiveLandscape, /confirmed by independent, publicly available sources/i);
    assert.match(projection.competitiveLandscape, /\| Vendor \| Parent Company \| Category \| Segment \|/);
    assert.doesNotMatch(projection.competitiveLandscape, /packed discovery queries|candidates? discovered|earlyStopReason/i);
    assert.doesNotMatch(projection.majorPlayers, /No competitive evidence/i);
    assert.equal(graph.planningEstimate, null);
    assert.match(projection.tamSamSom, /Verified TAM \/ SAM \/ SOM is unavailable/);
  });
}

test("vendor aliases deduplicate into one canonical Intuit (QuickBooks) entity", () => {
  const prompt = markets[0];
  const aliases = [
    "QuickBooks",
    "QuickBooks AI",
    "Intuit Assist",
    "Intuit Accounting AI",
  ];
  const evidence = aliases.map((name, index) =>
    vendorEvidence({
      id: `Q${index + 1}`,
      name,
      domain: index === 0 ? "quickbooks.intuit.com" : "intuit.com",
      category: "AI accounting software",
    })
  );
  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  const quickBooks = graph.vendorIntelligence.vendors.filter(
    (vendor) => vendor.name === "Intuit (QuickBooks)"
  );

  assert.equal(quickBooks.length, 1);
  assert.equal(quickBooks[0].evidenceCount, 4);
  assert.deepEqual(quickBooks[0].evidenceSources.sort(), ["Q1", "Q2", "Q3", "Q4"]);
  assert.equal(graph.vendorIntelligence.vendors.length, 1);
});

test("benchmark institutions can support discovery but never become vendors, and a single mention is not enough to validate a vendor", () => {
  const prompt = markets[0];
  const evidence = [
    {
      ...vendorEvidence({
        id: "B1",
        name: "Gartner",
        domain: "gartner.com",
        category: "AI accounting software",
      }),
      sourceType: "credible_market_data",
      sourceTitle: "Independent analyst coverage of accounting software",
      url: "https://gartner.com/research/vendor-landscape",
      claim: "Gartner coverage names QuickBooks, Xero, Sage, and NetSuite as accounting software vendors.",
      value: "QuickBooks, Xero, Sage, NetSuite",
    },
    {
      // A second, independent commercial source naming the same four
      // vendors. Requirement: two independent sources is one of the valid
      // corroboration paths, but neither Gartner nor Capterra becomes a
      // vendor itself.
      ...vendorEvidence({
        id: "B1b",
        name: "Capterra",
        domain: "capterra.com",
        category: "AI accounting software",
      }),
      sourceType: "credible_market_data",
      sourceTitle: "Independent directory coverage of accounting solutions",
      url: "https://capterra.com/directory/accounting-software",
      claim: "Capterra directory listings include QuickBooks, Xero, Sage, and NetSuite as accounting solutions.",
      value: "QuickBooks, Xero, Sage, NetSuite",
    },
    {
      // A single low-quality, unverified mention must not validate a vendor
      // on its own even though it looks like an official page.
      ...vendorEvidence({
        id: "B2",
        name: "Fabricated Vendor",
        domain: "fabricated-vendor.example",
        category: "AI accounting software",
      }),
      label: "Estimate",
      confidence: 20,
      qualityScore: 10,
    },
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  const names = graph.vendorIntelligence.vendors.map((vendor) => vendor.name);

  assert.deepEqual(names.sort(), ["Intuit (QuickBooks)", "Oracle NetSuite", "Sage", "Xero"]);
  assert.ok(!names.includes("Gartner"));
  assert.ok(!names.includes("Capterra"));
  assert.ok(!names.includes("Fabricated Vendor"));
  assert.equal(graph.vendorIntelligence.coverage.independentProviderSources, 2);
  assert.equal(graph.vendorIntelligence.coverage.sufficient, false);
  assert.equal(graph.vendorIntelligence.evidenceProviders[0].entityType, "analyst_firm");
  for (const vendor of graph.vendorIntelligence.vendors) {
    assert.ok(vendor.independentEvidenceCount >= 2);
    assert.equal(vendor.validationPath, "two_independent_commercial_or_industry_sources");
  }
});

test("organization classifier assigns one exclusive infrastructure or evidence role", () => {
  const cases = [
    ["SEC", "https://sec.gov", "regulator"],
    ["BEA", "https://bea.gov", "government"],
    ["FASB", "https://fasb.org", "standards_body"],
    ["Gartner", "https://gartner.com", "analyst_firm"],
    ["PitchBook", "https://pitchbook.com", "research_provider"],
    ["McKinsey", "https://mckinsey.com", "consultancy"],
    ["Harvard University", "https://harvard.edu", "academic"],
    ["Apache Software Foundation", "https://apache.org", "open_source"],
    ["Developer community", "https://community.example.org", "community"],
    ["Unclassified Organization", "https://unclassified.org", "unknown"],
  ];

  for (const [name, url, entityType] of cases) {
    assert.equal(classifyOrganizationEntity({ name, url }).entityType, entityType);
  }
});
