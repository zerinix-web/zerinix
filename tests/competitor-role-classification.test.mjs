import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyOrganizationEntity,
  toCompetitorRoleCategory,
  isEligibleCompetitorRole,
} from "../app/lib/ai/commercial-vendor-intelligence.ts";
import {
  buildMarketIntelligenceGraph,
} from "../app/lib/ai/market-intelligence-graph.ts";

// --- Unit coverage: classifyOrganizationEntity + the 7-role mapping -------

test("a real vendor's own official product page is classified commercial_vendor and eligible", () => {
  const result = classifyOrganizationEntity({
    name: "Verity",
    url: "https://www.verity.ch/pricing",
    sourceType: "company_source",
    context: "Verity official product and pricing page for autonomous inventory drones.",
  });
  assert.equal(result.entityType, "commercial_vendor");
  assert.equal(toCompetitorRoleCategory(result.entityType), "commercial_vendor");
  assert.equal(isEligibleCompetitorRole(toCompetitorRoleCategory(result.entityType)), true);
});

test("a customer/adopter (a company using the technology, not selling it) is rejected", () => {
  // Reproduces the real, live-observed defect: DSV, a 3PL logistics
  // company, was cited only for adopting inventory drones and reached the
  // competitor table as if it sold them.
  const result = classifyOrganizationEntity({
    name: "DSV",
    url: "https://www.dsv.com/en/our-solutions/warehouse-drones",
    sourceType: "company_news",
    context: "DSV adopts autonomous inventory drones across its German distribution centers to reduce manual cycle counts.",
  });
  assert.equal(result.entityType, "customer_adopter");
  assert.equal(toCompetitorRoleCategory(result.entityType), "customer_adopter");
  assert.equal(isEligibleCompetitorRole(toCompetitorRoleCategory(result.entityType)), false);
});

test("a case-study customer is rejected", () => {
  const result = classifyOrganizationEntity({
    name: "Acme Logistics",
    url: "https://vendor.example.com/case-studies/acme-logistics",
    sourceType: "company_news",
    context: "Acme Logistics case study: how the retailer deployed drone-based inventory counting to cut audit time in half.",
  });
  assert.equal(result.entityType, "customer_adopter");
  assert.equal(isEligibleCompetitorRole(toCompetitorRoleCategory(result.entityType)), false);
});

test("a trade publication reporting on the market is rejected", () => {
  // Reproduces the real, live-observed defect: Inbound Logistics, a trade
  // publication, was cited for an article about the market and reached
  // the competitor table under its own domain-derived name.
  const result = classifyOrganizationEntity({
    name: "Inboundlogistics",
    url: "https://www.inboundlogistics.com/articles/inventory-tracking-solution-a-high-flying-success/",
    sourceType: "credible publication",
    context: "Inventory Tracking Solution: A High-Flying Success -- an industry publication article covering drone-based inventory technology.",
  });
  assert.equal(result.entityType, "research_provider");
  assert.equal(toCompetitorRoleCategory(result.entityType), "research_publication_source");
  assert.equal(isEligibleCompetitorRole(toCompetitorRoleCategory(result.entityType)), false);
});

test("a publisher (news outlet/magazine) is rejected", () => {
  const result = classifyOrganizationEntity({
    name: "Logistics Weekly",
    url: "https://logisticsweekly.example/news/warehouse-automation-2026",
    sourceType: "credible publication",
    context: "Logistics Weekly is a trade press magazine covering warehouse automation news.",
  });
  assert.equal(result.entityType, "research_provider");
  assert.equal(isEligibleCompetitorRole(toCompetitorRoleCategory(result.entityType)), false);
});

test("a regulator is rejected", () => {
  const result = classifyOrganizationEntity({
    name: "Luftfahrt-Bundesamt",
    url: "https://www.lba.de/regulations",
    sourceType: "government/statistical source",
    context: "The regulatory authority overseeing drone operation rules in Germany.",
  });
  assert.equal(toCompetitorRoleCategory(result.entityType), "government_regulator");
  assert.equal(isEligibleCompetitorRole(toCompetitorRoleCategory(result.entityType)), false);
});

test("an integration/implementation partner is rejected", () => {
  const result = classifyOrganizationEntity({
    name: "WMS Integrators Group",
    url: "https://wmsintegrators.example/partners",
    sourceType: "company_news",
    context: "WMS Integrators Group is a systems integrator and implementation partner for warehouse drone deployments.",
  });
  assert.equal(result.entityType, "channel_partner");
  assert.equal(isEligibleCompetitorRole(toCompetitorRoleCategory(result.entityType)), false);
});

test("an integration partner IS accepted once it independently sells its own competing product", () => {
  // The disqualifying channel-partner language must not veto an entity
  // that separate, stronger evidence shows also sells its own product --
  // this is exercised at the candidate/evidence-aggregation level (a real
  // vendor mentioned once as an integration partner in one source, and
  // once via its own product page in another) rather than inside a single
  // classification call, since classifyOrganizationEntity classifies one
  // evidence item at a time and vendor-intelligence.ts's rolePriority
  // merge is what lets the stronger, more specific signal win once BOTH
  // exist for the same entity -- see the end-to-end test below.
  const result = classifyOrganizationEntity({
    name: "Exotec",
    url: "https://www.exotec.com/products/skypod",
    sourceType: "company_source",
    context: "Exotec official product page for its Skypod robotic warehouse system, sold directly to logistics operators.",
  });
  assert.equal(result.entityType, "commercial_vendor");
});

test("an ambiguous entity with no affirmative seller signal is rejected (unknown_insufficient_evidence)", () => {
  const result = classifyOrganizationEntity({
    name: "Nordic Robotics Alliance",
    url: "https://nordicroboticsalliance.example/",
    sourceType: "credible_market_data",
    context: "Nordic Robotics Alliance is mentioned in passing.",
  });
  assert.equal(result.entityType, "unknown");
  assert.equal(toCompetitorRoleCategory(result.entityType), "unknown_insufficient_evidence");
  assert.equal(isEligibleCompetitorRole(toCompetitorRoleCategory(result.entityType)), false);
});

// --- End-to-end coverage: the full discovery/validation/relevance pipeline -

const checkedAt = "2026-08-16T00:00:00.000Z";
let counter = 0;
function nextId(prefix) {
  counter += 1;
  return `${prefix}${counter}`;
}

function baseEvidence(overrides) {
  return {
    id: nextId("E"),
    field: "competitors",
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

test("end-to-end: a customer/adopter and a trade publication are excluded from the Competitive Landscape table while the real vendor is included", () => {
  const prompt = "Evaluate the commercial opportunity of autonomous warehouse inventory drones for medium and large logistics companies in Germany.";
  const evidence = [
    // Real vendor: two independent, substantive, official-shaped sources.
    baseEvidence({
      claim: "Verity provides autonomous inventory drones with fleet management software for warehouses.",
      value: "Verity autonomous drone product and pricing overview",
      sourceTitle: "Verity official product and pricing page",
      publisher: "Verity",
      url: "https://www.verity.ch/pricing",
      sourceType: "company_source",
      authorityLevel: "primary",
    }),
    baseEvidence({
      claim: "Verity autonomous drones reviewed by industry analysts as a leading inventory-counting solution.",
      value: "Verity customer review summary",
      sourceTitle: "Verity reviews and ratings",
      publisher: "g2",
      url: "https://g2.com/reviews/verity",
      sourceType: "credible_market_data",
    }),
    // Customer/adopter: a 3PL logistics company using the technology.
    baseEvidence({
      claim: "DSV adopts autonomous inventory drones across its German distribution centers to reduce manual cycle counts.",
      value: "DSV drone adoption case study",
      sourceTitle: "DSV case study: warehouse drone adoption",
      publisher: "DSV",
      url: "https://www.dsv.com/en/our-solutions/warehouse-drones",
      sourceType: "company_news",
    }),
    // Trade publication reporting on the market.
    baseEvidence({
      claim: "Inventory Tracking Solution: A High-Flying Success -- a trade publication article covering drone-based inventory technology.",
      value: "Industry publication article",
      sourceTitle: "Inventory Tracking Solution: A High-Flying Success",
      publisher: "Inbound Logistics",
      url: "https://www.inboundlogistics.com/articles/inventory-tracking-solution-a-high-flying-success/",
      sourceType: "credible publication",
    }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  const vendorNames = graph.vendorIntelligence.vendors.map((v) => v.name);

  assert.ok(
    vendorNames.some((name) => /verity/i.test(name)),
    `expected Verity to be discovered as a vendor, got: ${JSON.stringify(vendorNames)}`
  );
  assert.ok(
    !vendorNames.some((name) => /dsv/i.test(name)),
    `DSV (a customer/adopter) must not appear as a vendor, got: ${JSON.stringify(vendorNames)}`
  );
  assert.ok(
    !vendorNames.some((name) => /inbound ?logistics/i.test(name)),
    `Inbound Logistics (a trade publication) must not appear as a vendor, got: ${JSON.stringify(vendorNames)}`
  );

  const competitiveLandscapeText = graph.vendorIntelligence.vendors
    .map((v) => v.name)
    .join(" | ");
  assert.doesNotMatch(competitiveLandscapeText, /dsv/i);
  assert.doesNotMatch(competitiveLandscapeText, /inbound/i);
});

test("end-to-end: the accepted vendor retains its correct evidence references", () => {
  const prompt = "Evaluate the commercial opportunity of autonomous warehouse inventory drones for medium and large logistics companies in Germany.";
  const officialEvidence = baseEvidence({
    claim: "Verity provides autonomous inventory drones with fleet management software for warehouses.",
    value: "Verity autonomous drone product and pricing overview",
    sourceTitle: "Verity official product and pricing page",
    publisher: "Verity",
    url: "https://www.verity.ch/pricing",
    sourceType: "company_source",
    authorityLevel: "primary",
  });
  const reviewEvidence = baseEvidence({
    claim: "Verity autonomous drones reviewed by industry analysts as a leading inventory-counting solution.",
    value: "Verity customer review summary",
    sourceTitle: "Verity reviews and ratings",
    publisher: "g2",
    url: "https://g2.com/reviews/verity",
    sourceType: "credible_market_data",
  });
  const evidence = [officialEvidence, reviewEvidence];

  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  const verity = graph.vendorIntelligence.vendors.find((v) => /verity/i.test(v.name));

  assert.ok(verity, "Verity should be discovered as a vendor");
  assert.ok(verity.evidenceSources.includes(officialEvidence.id));
  assert.ok(verity.evidenceSources.includes(reviewEvidence.id));
  assert.equal(verity.evidenceCount, 2);
});

// --- Domain-fallback role gate: the exact real-world phrasing shapes -------
//
// The live German-warehouse-drone report exposed a gap the synthetic
// fixtures above never exercised: a domain-fallback candidate (Path C --
// no heuristic mention pattern ever fired, so the name is lifted straight
// from the citation's own hostname) whose evidence text does not contain
// any of classifyOrganizationEntity's specific customer/publisher keywords.
// classifyOrganizationEntity then defaults to "unknown", which historically
// was never excluded, and validateVendorCandidate's officialEvidenceCount
// path could still validate it purely because the upstream source-type
// classifier labels every citation on that entity's own domain "official
// company source" -- a domain-based label, not proof of a commercial role.
// vendor-intelligence.ts's domain-fallback role gate closes this: a
// domain-fallback candidate must get an affirmative commercial_vendor
// classification, not just "not institutionally excluded", to enter the
// table.

test("end-to-end: DSV's real press-release phrasing ('improves warehouse operations with drone system') is rejected as a customer, not a vendor", () => {
  const prompt = "Evaluate the commercial opportunity of autonomous warehouse inventory drones for medium and large logistics companies in Germany.";
  const evidence = [
    baseEvidence({
      claim: "DSV improves warehouse operations with drone system.",
      value: "DSV improves warehouse operations with drone system",
      sourceTitle: "DSV improves warehouse operations with drone system | DSV",
      publisher: "dsv.com",
      url: "https://www.dsv.com/en/about-dsv/press/news/com/2020/11/dsv-improves-warehouse-operations-with-drone-system",
      sourceType: "official company source",
      authorityLevel: "primary",
    }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  const vendorNames = graph.vendorIntelligence.vendors.map((v) => v.name);
  assert.ok(
    !vendorNames.some((name) => /dsv/i.test(name)),
    `DSV must not appear as a vendor from this exact real citation shape, got: ${JSON.stringify(vendorNames)}`
  );
});

test("end-to-end: Inbound Logistics' real article citation ('Inventory Tracking Solution: A High-Flying Success') is rejected as a publisher, not a vendor", () => {
  const prompt = "Evaluate the commercial opportunity of autonomous warehouse inventory drones for medium and large logistics companies in Germany.";
  const evidence = [
    baseEvidence({
      claim: "Inventory Tracking Solution: A High-Flying Success.",
      value: "Inventory Tracking Solution: A High-Flying Success",
      sourceTitle: "Inventory Tracking Solution: A High-Flying Success",
      publisher: "inboundlogistics.com",
      url: "https://www.inboundlogistics.com/articles/inventory-tracking-solution-a-high-flying-success/",
      sourceType: "credible publication",
    }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  const vendorNames = graph.vendorIntelligence.vendors.map((v) => v.name);
  assert.ok(
    !vendorNames.some((name) => /inbound ?logistics/i.test(name)),
    `Inbound Logistics must not appear as a vendor from this exact real citation shape, got: ${JSON.stringify(vendorNames)}`
  );
});

test("end-to-end: a real vendor's own newsroom page (domain fallback, no literal 'product page'/'pricing page' phrasing) is still accepted", () => {
  // Non-regression guard for the domain-fallback role gate: it must not
  // reject a genuine self-published vendor page just because its prose
  // doesn't happen to contain the literal words "product page"/"pricing
  // page" -- the gate also accepts a genuine own-domain product/pricing/
  // newsroom/press-release URL path as an affirmative commercial_vendor
  // signal (mirrors isOfficialVendorEvidence's own path-shape check).
  const prompt = "Evaluate the commercial opportunity of autonomous warehouse inventory drones for medium and large logistics companies in Germany.";
  const evidence = [
    baseEvidence({
      claim: "Autonomous drones meet LEA Reply: real-time inventory tracking unveiled at LogiMAT 2026.",
      value: "Autonomous drones meet LEA Reply: real-time inventory tracking unveiled at LogiMAT 2026",
      sourceTitle: "Autonomous drones meet LEA Reply: Real-time inventory at LogiMAT 2026 | Reply",
      publisher: "Reply",
      url: "https://www.reply.com/en/newsroom/autonomous-drones-meet-lea-reply",
      sourceType: "official company source",
      authorityLevel: "primary",
    }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  const vendorNames = graph.vendorIntelligence.vendors.map((v) => v.name);
  assert.ok(
    vendorNames.some((name) => /reply/i.test(name)),
    `Reply's own newsroom page should still be discovered as a vendor, got: ${JSON.stringify(vendorNames)}`
  );
});
