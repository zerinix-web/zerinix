import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import { getMarketTaxonomyProfile } from "../app/lib/ai/market-taxonomy.ts";

// Regression coverage for the Commercial Vendor Discovery Engine. Each
// fixture deliberately mimics the reported production bug: evidence is
// dominated by government/regulatory noise, only a couple of items are
// genuine official vendor pages, and most real commercial signal comes from
// review/directory-style independent mentions of vendors that are NOT all
// registered in the static per-vertical taxonomy catalog. The assertions
// verify discovery now surfaces multiple validated vendors from that mix
// instead of collapsing to a single company, while still rejecting
// institutions, single-source listicles, and market-irrelevant entities.

const checkedAt = "2026-08-02T00:00:00.000Z";
let counter = 0;
function nextId(prefix) {
  counter += 1;
  return `${prefix}${counter}`;
}

function baseEvidence(overrides) {
  return {
    id: nextId("E"),
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

// Two independent review/directory mentions of a vendor that is not in the
// hardcoded taxonomy catalog -- this is the path that lets any market (not
// just the 6 pre-baked verticals) discover real vendors.
function reviewMention({ name, domain, searchQuery }) {
  return baseEvidence({
    claim: `${name} offers a highly rated platform used by buyers researching this category.`,
    value: `${name} customer review summary`,
    sourceTitle: `${name} reviews and ratings`,
    publisher: domain.split(".")[0],
    url: `https://${domain}/reviews/${encodeURIComponent(name.toLowerCase())}`,
    sourceType: "credible_market_data",
    searchQuery: searchQuery || `${name} reviews`,
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
    searchQuery: `${name} pricing`,
  });
}

function govNoise(domain, publisher, claim) {
  return baseEvidence({
    claim,
    value: claim,
    sourceTitle: `${publisher} official statistics`,
    publisher,
    url: `https://${domain}/data`,
    sourceType: "official_statistics",
    authorityLevel: "primary",
    searchQuery: "industry demand official statistics",
  });
}

function singleListicleMention({ name, domain }) {
  return baseEvidence({
    claim: `${name} offers a niche tool mentioned once in a roundup article.`,
    value: `${name} roundup mention`,
    sourceTitle: `${name} roundup listicle`,
    publisher: domain,
    url: `https://${domain}/blog/roundup`,
    sourceType: "credible_market_data",
    searchQuery: `${name} best software`,
  });
}

function implementationPartnerMention({ name, domain }) {
  return baseEvidence({
    claim: `${name} offers implementation partner services and systems integrator consulting for enterprise rollouts.`,
    value: `${name} implementation partner services`,
    sourceTitle: `${name} implementation partner directory listing`,
    publisher: domain,
    url: `https://${domain}/directory/${encodeURIComponent(name.toLowerCase())}`,
    sourceType: "credible_market_data",
    searchQuery: `${name} implementation partner`,
  });
}

const scenarios = [
  {
    label: "US AI accounting software",
    prompt: "Analyze the US AI accounting software market.",
    govDomains: ["bea.gov", "irs.gov", "sec.gov"],
    govPublishers: ["Bureau of Economic Analysis", "IRS", "SEC"],
    newVendorA: "Ledger Pilot",
    newVendorB: "Campfire Close",
    singleSourceVendor: "Obscure Booksy",
    partnerEntity: "Apex Accounting Advisors",
  },
  {
    label: "AI legal software",
    prompt: "Analyze the AI legal software market.",
    govDomains: ["justice.gov", "uscourts.gov", "ftc.gov"],
    govPublishers: ["Department of Justice", "U.S. Courts", "FTC"],
    newVendorA: "Contract Scout",
    newVendorB: "Docket Sense",
    singleSourceVendor: "Obscure Clause AI",
    partnerEntity: "Meridian Legal Consulting",
  },
  {
    label: "Construction ERP",
    prompt: "Analyze the Construction ERP market.",
    govDomains: ["osha.gov", "census.gov", "dol.gov"],
    govPublishers: ["OSHA", "Census Bureau", "Department of Labor"],
    newVendorA: "SiteLedger",
    newVendorB: "CrewStack",
    singleSourceVendor: "Obscure Buildsoft",
    partnerEntity: "Ironframe Implementation Partners",
  },
  {
    label: "CRM platforms",
    prompt: "Analyze CRM platforms.",
    govDomains: ["ftc.gov", "census.gov", "sba.gov"],
    govPublishers: ["FTC", "Census Bureau", "SBA"],
    newVendorA: "Pipeline Forge",
    newVendorB: "Clientwave",
    singleSourceVendor: "Obscure Contactly",
    partnerEntity: "Northbridge CRM Integrators",
  },
  {
    label: "Cybersecurity MDR",
    prompt: "Analyze Cybersecurity MDR.",
    govDomains: ["cisa.gov", "nist.gov", "ftc.gov"],
    govPublishers: ["CISA", "NIST", "FTC"],
    newVendorA: "ThreatShield Ops",
    newVendorB: "SentryLoop",
    singleSourceVendor: "Obscure Watchtower",
    partnerEntity: "Vantage MSSP Integrators",
  },
  {
    label: "Healthcare AI",
    prompt: "Analyze Healthcare AI.",
    govDomains: ["hhs.gov", "fda.gov", "cms.gov"],
    govPublishers: ["HHS", "FDA", "CMS"],
    newVendorA: "ClinicalPulse AI",
    newVendorB: "RoundsCopilot",
    singleSourceVendor: "Obscure Diagnosee",
    partnerEntity: "Meridian Health IT Integrators",
  },
];

for (const scenario of scenarios) {
  test(`${scenario.label}: discovers multiple validated vendors from gov-dominated, mixed-quality evidence`, () => {
    const taxonomy = getMarketTaxonomyProfile(scenario.prompt);
    const knownVendor = taxonomy.vendors[0];
    assert.ok(knownVendor, `${scenario.label} taxonomy must have at least one catalog vendor`);

    const evidence = [
      // Government/regulatory noise dominates volume, exactly like the
      // reported bug ("source coverage was dominated by government and
      // regulatory domains").
      ...scenario.govDomains.map((domain, index) =>
        govNoise(
          domain,
          scenario.govPublishers[index],
          `${scenario.govPublishers[index]} publishes official statistics relevant to this market's demand and structure.`
        )
      ),
      // A known taxonomy vendor discovered the traditional way: one official
      // page plus one independent review mention.
      officialMention({ name: knownVendor.name, domain: knownVendor.domains[0] }),
      reviewMention({ name: knownVendor.name, domain: "g2.com" }),
      // Two brand-new vendors -- not in any taxonomy catalog -- discovered
      // purely through two independent review/directory mentions each. This
      // is the mechanism that generalizes discovery beyond the hardcoded 6
      // verticals.
      reviewMention({ name: scenario.newVendorA, domain: "g2.com" }),
      reviewMention({ name: scenario.newVendorA, domain: "capterra.com" }),
      reviewMention({ name: scenario.newVendorB, domain: "capterra.com" }),
      reviewMention({ name: scenario.newVendorB, domain: "trustradius.com" }),
      // A vendor mentioned in exactly one low-quality listicle must not be
      // validated on its own.
      singleListicleMention({ name: scenario.singleSourceVendor, domain: "randomblog.example" }),
      // An implementation partner / systems integrator must be excluded as
      // not market-relevant even though it reads like a vendor mention.
      implementationPartnerMention({ name: scenario.partnerEntity, domain: "partnerdirectory.example" }),
    ];

    const graph = buildMarketIntelligenceGraph({ evidence }, scenario.prompt);
    const projection = projectMarketIntelligenceGraphToReport(graph);
    const vendors = graph.vendorIntelligence.vendors;
    const names = vendors.map((vendor) => vendor.name);
    const evidenceIds = new Set(evidence.map((item) => item.id));

    // Multiple commercial vendors reach the report, not just one.
    assert.ok(
      names.length >= 3,
      `expected at least 3 validated vendors, got ${names.length}: ${names.join(", ")}`
    );
    assert.ok(names.includes(knownVendor.name));
    assert.ok(names.includes(scenario.newVendorA));
    assert.ok(names.includes(scenario.newVendorB));

    // Government and regulatory organizations never enter the vendor list.
    for (const publisher of scenario.govPublishers) {
      assert.ok(!names.includes(publisher));
    }
    assert.ok(
      graph.vendorIntelligence.marketInfrastructure.length >= scenario.govPublishers.length,
      "government/regulatory entities must be captured as market infrastructure"
    );

    // A single low-quality listicle mention is rejected.
    assert.ok(!names.includes(scenario.singleSourceVendor));

    // An implementation partner is excluded for lacking market relevance.
    assert.ok(!names.includes(scenario.partnerEntity));

    // No hallucinated vendor: every reported vendor traces back to real
    // evidence ids from this fixture.
    for (const vendor of vendors) {
      assert.ok(vendor.evidenceSources.length > 0);
      assert.ok(vendor.evidenceSources.every((id) => evidenceIds.has(id)));
      assert.ok(vendor.marketRelevance.length > 0);
    }

    // Pricing is never fabricated: the two-review-only vendors have no
    // pricing evidence and must say so rather than inventing a figure.
    const newVendorARecord = vendors.find((vendor) => vendor.name === scenario.newVendorA);
    assert.equal(newVendorARecord.pricingModels.length, 0);
    assert.equal(newVendorARecord.pricingEvidence, "No validated public pricing evidence");

    // The known vendor (official page + review) has pricing evidence
    // reflecting the official page.
    const knownVendorRecord = vendors.find((vendor) => vendor.name === knownVendor.name);
    assert.ok(knownVendorRecord.pricingModels.length > 0);
    assert.ok(knownVendorRecord.website.startsWith("https://"));

    // Major Players is populated when evidence supports it.
    assert.ok(vendors.some((vendor) => vendor.eligibleForMajorPlayers));
    assert.doesNotMatch(projection.majorPlayers, /No competitive evidence/i);
    assert.match(projection.majorPlayers, /Market Leader|Established Challenger|Emerging Vendor|Niche Specialist|Vertical Specialist/);

    // Source metadata (domains) survives into the vendor record.
    assert.ok(newVendorARecord.evidenceDomains.includes("g2.com"));
    assert.ok(newVendorARecord.evidenceDomains.includes("capterra.com"));

    // Coverage explains itself precisely either way.
    assert.ok(graph.vendorIntelligence.coverage.reason.length > 0);
    assert.ok(graph.vendorIntelligence.discoveryLog.candidatesDiscovered >= names.length);
  });
}

test("aliases of a known vendor merge into one canonical entity even when mentioned via review sites", () => {
  const prompt = "Analyze the US AI accounting software market.";
  const evidence = [
    reviewMention({ name: "QuickBooks", domain: "g2.com" }),
    reviewMention({ name: "Intuit Assist", domain: "capterra.com" }),
    officialMention({ name: "Intuit (QuickBooks)", domain: "quickbooks.intuit.com" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  const matches = graph.vendorIntelligence.vendors.filter(
    (vendor) => vendor.name === "Intuit (QuickBooks)"
  );

  assert.equal(matches.length, 1);
  assert.equal(graph.vendorIntelligence.vendors.length, 1);
  assert.equal(matches[0].evidenceCount, 3);
});

test("a vendor with no research-provider or regulator role never appears as market infrastructure", () => {
  const prompt = "Analyze the US AI accounting software market.";
  const evidence = [
    officialMention({ name: "Ledger Pilot", domain: "ledgerpilot.example" }),
    reviewMention({ name: "Ledger Pilot", domain: "g2.com" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);

  assert.ok(graph.vendorIntelligence.vendors.some((vendor) => vendor.name === "Ledger Pilot"));
  assert.ok(!graph.vendorIntelligence.marketInfrastructure.some((entity) => entity.name === "Ledger Pilot"));
  assert.ok(!graph.vendorIntelligence.evidenceProviders.some((entity) => entity.name === "Ledger Pilot"));
});
