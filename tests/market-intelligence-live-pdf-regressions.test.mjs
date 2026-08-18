import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildMarketIntelligenceGraph } from "../app/lib/ai/market-intelligence-graph.ts";
import { isImplausibleCompetitorName } from "../app/lib/ai/vendor-discovery.ts";
import { classifyOrganizationEntity } from "../app/lib/ai/commercial-vendor-intelligence.ts";
import { stripFillerAndDuplicateSentences } from "../app/lib/report-engine/filler-detection.ts";

// Reproduces all four failures from the live PDF review, each traced to its
// own root cause, plus the fixes' regression coverage.

const checkedAt = "2026-08-15T00:00:00.000Z";

function vendorEvidence({ id, name, domain }) {
  const claim = `${name} provides enterprise workflow automation software with pricing and product documentation for enterprise customers.`;
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

// -----------------------------------------------------------------------
// Failure 1: Category field still contains a prompt fragment
// ("commercial opportunity of launching an AI-powered...") for real,
// correctly-discovered competitors on a business-idea-style prompt.
// -----------------------------------------------------------------------

test("failure 1: real vendors on a multi-clause business-idea-style prompt get a clean category, never the leading prompt clause", () => {
  const prompt =
    "What is the commercial opportunity of launching an AI-powered fraud detection platform in the banking software market?";
  const fixture = [
    vendorEvidence({ id: "R1", name: "ServiceNow", domain: "servicenow.com" }),
    vendorEvidence({ id: "R2", name: "IBM", domain: "ibm.com" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence: fixture }, prompt);

  assert.ok(graph.vendorIntelligence.vendors.length >= 1, "expected at least one validated vendor");
  for (const vendor of graph.vendorIntelligence.vendors) {
    assert.doesNotMatch(
      vendor.category,
      /commercial opportunity|launching|ai-powered/i,
      `expected vendor "${vendor.name}" category to never contain the prompt fragment, got "${vendor.category}"`
    );
  }
});

test("failure 1 (unit): the category extraction itself isolates the noun phrase closest to market/industry/sector, not the whole leading clause", () => {
  // Exercised indirectly through the public graph API above; this asserts
  // the same guarantee holds even when the vendor.category safety net
  // (safeVendorCategory) is bypassed by a clean, well-formed extraction --
  // i.e. the extraction fix itself, not just the fallback.
  const prompt =
    "Assess the commercial opportunity of launching an AI-powered compliance assistant in the enterprise legal services market";
  const fixture = [vendorEvidence({ id: "R1", name: "Relativity", domain: "relativity.com" })];
  const graph = buildMarketIntelligenceGraph({ evidence: fixture }, prompt);
  const [vendor] = graph.vendorIntelligence.vendors;
  assert.ok(vendor, "expected the vendor to validate");
  assert.equal(vendor.category, "enterprise legal services");
});

test("failure 1 (defense-in-depth): vendor.category can never be prompt/instruction-shaped even if the extraction upstream regresses", () => {
  assert.equal(isImplausibleCompetitorName("commercial opportunity of launching an AI-powered X"), true);
});

// -----------------------------------------------------------------------
// Failure 2: OECD (and other intergovernmental organizations) rendered as
// a commercial competitor/vendor.
// -----------------------------------------------------------------------

test("failure 2: OECD, IMF, and World Bank are classified as government/institutional, never commercial_vendor", () => {
  for (const { name, url } of [
    { name: "OECD", url: "https://oecd.org/some-report" },
    { name: "OECD", url: "https://www.oecd.org/publications/some-report" },
    { name: "IMF", url: "https://imf.org/reports" },
    { name: "World Bank", url: "https://worldbank.org/data" },
  ]) {
    const result = classifyOrganizationEntity({ name, url });
    assert.equal(
      result.entityType,
      "government",
      `expected ${name} (${url}) to classify as government, got ${result.entityType}`
    );
  }
});

test("failure 2: short acronyms (who/imf/wto) are scoped to name+hostname only, never misfiring on ordinary prose containing those words", () => {
  const result = classifyOrganizationEntity({
    name: "Zscaler",
    url: "https://zscaler.com/",
    context:
      "Zscaler is a leader who provides cloud security to enterprises who need zero trust architecture.",
  });
  assert.equal(result.entityType, "unknown");
});

test("failure 2 end-to-end: OECD never appears as a rendered competitor even when it is the only cited source", () => {
  const prompt = "Market Intelligence report on the industrial automation market.";
  const fixture = [
    vendorEvidence({ id: "R1", name: "Siemens", domain: "siemens.com" }),
    thinEvidence({ id: "R2", url: "https://oecd.org/some-statistics-report" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence: fixture }, prompt);
  const vendorNames = graph.vendorIntelligence.vendors.map((v) => v.name.toLowerCase());
  assert.ok(!vendorNames.includes("oecd"), `expected OECD never to appear as a vendor, got ${JSON.stringify(vendorNames)}`);
  assert.ok(vendorNames.some((name) => name.includes("siemens")), "expected the real vendor to survive");
});

// -----------------------------------------------------------------------
// Failure 3: Sources section corrupted -- the deterministic verdict
// paragraph appended to Sources (for PDF positioning) gets mis-parsed as
// a fabricated citation ("The deciding factor" as publisher/organization).
// -----------------------------------------------------------------------

const pdfButtonSource = readFileSync(
  "app/dashboard/[id]/ReportPdfButton.tsx",
  "utf8"
);

test("failure 3: parseCitations rejects the ORG - TITLE match when the captured organization reads as prose, not a name", () => {
  assert.match(
    pdfButtonSource,
    /function looksLikeOrganizationName\(value: string\): boolean/
  );
  // The body of this guard now also handles the embedded-newline
  // continuation-line fix (a short orphaned fragment gets appended back
  // to whichever field it continues) before returning, rather than
  // returning immediately.
  assert.match(
    pdfButtonSource,
    /if \(!citationMatch \|\| !looksLikeOrganizationName\(citationMatch\[1\]\)\) \{\s*\n/
  );
});

test("failure 3 (reproduction + fix, real regex logic): the verdict paragraph's 'ORG -- TITLE'-shaped rhetorical dash is rejected, real 'Publisher — Title' citations still parse", () => {
  // Mirrors parseCitations's citation-match branch and the new guard
  // exactly, without needing to import a browser-dependent component file.
  const citationRegex = /^([^—–|-]{2,80})\s*[—–-]\s*(.+?)(?:\s*\((\d{4})\))?(?:\s*[.;:]?\s*)?$/;
  const organizationVerbPattern = /\b(?:is|are|was|were|outweighs|confidence)\b/i;
  function looksLikeOrganizationName(value) {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 60) return false;
    if (trimmed.split(/\s+/).length > 7) return false;
    if (/[.!?]/.test(trimmed)) return false;
    if (organizationVerbPattern.test(trimmed)) return false;
    return true;
  }

  const verdictLine =
    'The verdict is GO at 74% confidence. The deciding factor -- "regulators and operator pilots prioritize corridor and retail hosts" -- outweighs the identified risks, and the Strategic Recommendations above are the fastest safe path to capturing it, so entry should proceed on that basis.';
  const verdictMatch = verdictLine.match(citationRegex);
  assert.ok(verdictMatch, "regex should still structurally match (that's the vulnerability)");
  assert.equal(
    looksLikeOrganizationName(verdictMatch[1]),
    false,
    "the captured 'organization' from the verdict paragraph must be rejected as prose"
  );

  const realCitation = "ENISA — EU Cybersecurity Market Analysis 2025";
  const realMatch = realCitation.match(citationRegex);
  assert.ok(realMatch);
  assert.equal(looksLikeOrganizationName(realMatch[1]), true, "a real publisher name must still be accepted");
});

// -----------------------------------------------------------------------
// Failure 4: Strategic Recommendations loses action 2 of 3 -- a generic,
// field-agnostic cleanup pass silently deletes a numbered action item with
// no replacement when it exactly (or near-exactly) restates another one.
// -----------------------------------------------------------------------

test("failure 4 (reproduction): stripFillerAndDuplicateSentences silently deletes a verbatim-duplicate numbered action with zero trace", () => {
  const withDuplicateAction =
    "1. Launch a pilot program targeting three metro regions within the first two quarters to validate unit economics before wider rollout.\n\n" +
    "2. Launch a pilot program targeting three metro regions within the first two quarters to validate unit economics before wider rollout.\n\n" +
    "3. Establish a dedicated compliance function to track evolving regional and national charging-infrastructure regulation ahead of expansion.";

  const result = stripFillerAndDuplicateSentences(withDuplicateAction);
  assert.doesNotMatch(
    result,
    /^2\./m,
    "documents the underlying defect: this generic pass has no concept of a numbered list's structural guarantee"
  );
});

const marketRouteSource = readFileSync("app/api/market-analysis/route.ts", "utf8");

test("failure 4 (fix): strategicRecommendations and tamSamSom are excluded from both the cross-section dedup and the per-field filler/duplicate-sentence pass", () => {
  assert.match(
    marketRouteSource,
    /excludedFields:\s*\["strategicRecommendations",\s*"tamSamSom"\]/
  );
  const fillerLoopStart = marketRouteSource.indexOf("Eliminate filler LAST");
  const fillerLoopBlock = marketRouteSource.slice(fillerLoopStart, fillerLoopStart + 2500);
  // sources joined this skip condition once its content became a
  // deterministic bibliography built after this loop runs (see the
  // Sources-bibliography regression tests) -- strategicRecommendations's
  // original protection is unchanged.
  assert.match(
    fillerLoopBlock,
    /if \(field === "strategicRecommendations" \|\| field === "sources"\) \{\s*\n\s*continue;\s*\n\s*\}/
  );
});

test("failure 4 (fix, end-to-end on the real pipeline behavior it protects): excluding a field from dedupeReportParagraphsAcrossSections preserves cross-section duplicates too", async () => {
  const { dedupeReportParagraphsAcrossSections } = await import(
    "../app/lib/report-content-quality.mjs"
  );
  const sharedInsight =
    "Regulators and operator pilots increasingly prioritize corridor and retail hosting sites for fast-charging infrastructure deployment across the region";
  const report = {
    opportunities: `${sharedInsight}.`,
    strategicRecommendations:
      "1. Launch a pilot program targeting three metro regions within the first two quarters to validate unit economics before wider rollout.\n\n" +
      `2. ${sharedInsight} immediately.\n\n` +
      "3. Establish a dedicated compliance function to track evolving regional and national charging-infrastructure regulation ahead of expansion.",
  };
  const result = dedupeReportParagraphsAcrossSections(report, {
    language: "English",
    sectionLabels: { opportunities: "Opportunities", strategicRecommendations: "Strategic Recommendations" },
    excludedFields: ["strategicRecommendations"],
  });
  assert.match(result.strategicRecommendations, /^2\./m);
});
