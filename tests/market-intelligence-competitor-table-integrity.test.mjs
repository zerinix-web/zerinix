import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import {
  extractVendorCandidateMentions,
  isImplausibleCompetitorName,
} from "../app/lib/ai/vendor-discovery.ts";
import { classifyOrganizationEntity } from "../app/lib/ai/commercial-vendor-intelligence.ts";

// Reproduces a real production report exactly as observed: the Competitive
// Landscape table contained "Conduct a comprehensive Intelligence analysis
// for...", "viewpointanalysis", "iaiest", "mdpi", and "sciencedirect" instead
// of real competitors -- prompt fragments and evidence-provider/academic
// domain labels, not vendors.

const checkedAt = "2026-08-15T00:00:00.000Z";

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

function vendorEvidence({ id, name, domain }) {
  const claim = `${name} provides workflow automation software with pricing and product documentation for enterprise and SMB customers.`;
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

test("classifyOrganizationEntity recognizes academic-paper publishers on commercial TLDs by hostname alone", () => {
  for (const url of [
    "https://mdpi.com/2071-1050/13/some-article",
    "https://sciencedirect.com/science/article/pii/some-id",
    "https://www.sciencedirect.com/science/article/pii/some-id",
    "https://springer.com/some-journal-article",
    "https://ieeexplore.ieee.org/document/12345",
  ]) {
    const result = classifyOrganizationEntity({ name: "", url });
    assert.equal(
      result.entityType,
      "academic",
      `expected ${url} to classify as academic, got ${result.entityType}`
    );
  }
});

test("domain-fallback path (Path C) never mints a vendor from a bare mdpi.com/sciencedirect.com citation", () => {
  for (const url of [
    "https://mdpi.com/2071-1050/13/some-article",
    "https://sciencedirect.com/science/article/pii/some-id",
  ]) {
    const mentions = extractVendorCandidateMentions([thinEvidence({ id: "e1", url })], null);
    assert.equal(
      mentions.length,
      0,
      `expected no vendor mention from a bare academic-publisher citation on ${url}, got ${JSON.stringify(mentions)}`
    );
  }
});

test("isImplausibleCompetitorName rejects prompt/instruction-fragment shaped values observed in production", () => {
  for (const badName of [
    "Conduct a comprehensive Intelligence analysis for the cybersecurity market",
    "Conduct a comprehensive Intelligence analysis for...",
    "Analyze the competitive landscape for named vendors in this sector",
  ]) {
    assert.equal(
      isImplausibleCompetitorName(badName),
      true,
      `expected "${badName}" to be rejected as an implausible competitor name`
    );
  }
});

test("a domain-fallback name with no other structural red flag (e.g. \"Viewpointanalysis\", \"Iaiest\") is not rejected by shape alone -- it is rejected downstream because it can never clear validation without an official page (see the end-to-end tests below)", () => {
  // Documents *why* these two literal production examples are not asserted
  // against isImplausibleCompetitorName directly: a single capitalized word
  // is structurally indistinguishable from a real one-word brand name
  // (Salesforce, Zendesk) without knowing the source domain, which was not
  // available for this fix. They are still provably blocked -- just one
  // layer later, by the validation-strength fix below.
  assert.equal(isImplausibleCompetitorName("Viewpointanalysis"), false);
  assert.equal(isImplausibleCompetitorName("Iaiest"), false);
});

test("isImplausibleCompetitorName never rejects a real, ordinary company/product name", () => {
  for (const goodName of [
    "Salesforce",
    "Zendesk",
    "Intuit (QuickBooks)",
    "Acme Widget Supply",
    "ISTOBAL",
    "WashTec",
  ]) {
    assert.equal(
      isImplausibleCompetitorName(goodName),
      false,
      `expected "${goodName}" to be accepted as a plausible competitor name`
    );
  }
});

test("end-to-end: a competitive landscape built from real vendor evidence plus contaminated academic/thin-domain evidence renders only the real vendor, never mdpi/sciencedirect", () => {
  const prompt = "Market Intelligence report on the workflow automation software market.";
  const fixture = [
    vendorEvidence({ id: "R1", name: "Acme Flowworks", domain: "acmeflowworks.com" }),
    thinEvidence({ id: "R2", url: "https://mdpi.com/2071-1050/13/some-article" }),
    thinEvidence({ id: "R3", url: "https://sciencedirect.com/science/article/pii/some-id" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence: fixture }, prompt);
  const projection = projectMarketIntelligenceGraphToReport(graph);
  const vendorNames = graph.vendorIntelligence.vendors.map((vendor) => vendor.name);

  assert.ok(
    vendorNames.some((name) => /acme ?flowworks/i.test(name)),
    `expected the real vendor to survive, got ${JSON.stringify(vendorNames)}`
  );
  for (const bad of ["mdpi", "sciencedirect"]) {
    assert.ok(
      !vendorNames.some((name) => name.toLowerCase() === bad),
      `expected no vendor literally named "${bad}", got ${JSON.stringify(vendorNames)}`
    );
    assert.ok(
      !new RegExp(`\\b${bad}\\b`, "i").test(projection.competitiveLandscape || ""),
      `expected competitiveLandscape to never mention "${bad}"`
    );
    assert.ok(
      !new RegExp(`\\b${bad}\\b`, "i").test(projection.majorPlayers || ""),
      `expected majorPlayers to never mention "${bad}"`
    );
  }
});

test("end-to-end: when every candidate is filtered out, the report renders the honest insufficient-evidence message, never an empty or fabricated table", () => {
  const prompt = "Market Intelligence report on an obscure niche market.";
  const fixture = [
    thinEvidence({ id: "R1", url: "https://mdpi.com/some-article" }),
    thinEvidence({ id: "R2", url: "https://sciencedirect.com/some-article" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence: fixture }, prompt);
  const projection = projectMarketIntelligenceGraphToReport(graph);

  assert.equal(graph.vendorIntelligence.vendors.length, 0);
  assert.ok(projection.competitiveLandscape, "expected a non-empty fallback message");
  assert.doesNotMatch(projection.competitiveLandscape, /\|.*\|/, "expected no table syntax when there are zero validated competitors");
  assert.doesNotMatch(projection.competitiveLandscape.toLowerCase(), /\bmdpi\b|\bsciencedirect\b/);
});

test("end-to-end: a domain-fallback name backed by nothing but a single bare, uncorroborated citation (the exact shape of \"Viewpointanalysis\"/\"Iaiest\" -- an unrecognized, non-academic-listed domain with zero real evidence) never becomes a validated vendor", () => {
  const prompt = "Market Intelligence report on the workflow automation software market.";
  const fixture = [
    vendorEvidence({ id: "R1", name: "Acme Flowworks", domain: "acmeflowworks.com" }),
    // A domain not on any exclusion list, cited only as a bare URL with no
    // supporting text and no official-page path signal -- structurally
    // identical to how "viewpointanalysis.com"/"iaiest.com" evidence would
    // have looked, since their real source is unknown.
    thinEvidence({ id: "R2", url: "https://viewpointanalysis.example/report" }),
    thinEvidence({ id: "R3", url: "https://iaiest.example/index" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence: fixture }, prompt);
  const vendorNames = graph.vendorIntelligence.vendors.map((vendor) => vendor.name);

  assert.ok(
    vendorNames.some((name) => /acme ?flowworks/i.test(name)),
    `expected the real vendor to survive, got ${JSON.stringify(vendorNames)}`
  );
  assert.ok(
    !vendorNames.some((name) => /viewpointanalysis|iaiest/i.test(name)),
    `expected no domain-fallback-only, uncorroborated name to validate as a vendor, got ${JSON.stringify(vendorNames)}`
  );
});
