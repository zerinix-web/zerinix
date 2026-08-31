import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
  buildMarketIntelligenceBibliography,
} from "../app/lib/ai/market-intelligence-graph.ts";
import { buildVendorIntelligenceGraph } from "../app/lib/ai/vendor-intelligence.ts";
import {
  assertNoOrphanEvidenceReferences,
  neutralizeUnverifiableEvidenceReferences,
  findDuplicateCitationSources,
  assertNoDuplicateCitationSources,
  DuplicateCitationSourceError,
  findCitationsUnresolvedInBibliography,
  assertCitationsResolveInBibliography,
  UnresolvedBibliographyCitationError,
} from "../app/lib/report-engine/evidence-reference-integrity.ts";

// TASK #22 -- Market Intelligence citation-to-claim integrity.
//
// ROOT CAUSE (confirmed against a real persisted report reconstructed from
// a graph-less cache hit, id bb36e409-0d5a-490f-a5ba-32243d6054f6):
// route.ts's ensureMarketReportQuality only ever validated [R#] citations
// against the verified evidence registry `if (graph)` -- when graph was
// unavailable (a real, currently-occurring cache-reconstruction state, not
// hypothetical), NOTHING checked the model's freeform [R#] citations at
// all. The report body cited six distinct references
// ([R3][R4][R5][R6][R12][R39]) across executiveSummary, majorPlayers,
// competitiveLandscape and strategicRecommendations, while the Sources
// field had independently degraded to a generic category+count summary
// ("Evidence Summary / Verified against: / - Government data / 1 verified
// source used.") with no relationship to any of those six numbers -- every
// one was an unresolvable dead end for the reader, in both the web
// dashboard and the PDF (both render the exact same persisted section
// text). FIX: neutralizeUnverifiableEvidenceReferences (evidence-
// reference-integrity.ts) runs in the `else` branch of that same `if
// (graph)` gate in route.ts, replacing every [R#] marker with an explicit,
// localized "unverified reference" label instead of letting it ride along
// looking resolvable.

const checkedAt = "2026-08-15T00:00:00.000Z";

function evidenceItem({ id, name = "Acme Corp", domain = "acme.com", url, claim }) {
  return {
    id,
    field: "market_size",
    claim: claim || `${name} reports figures relevant to this market analysis.`,
    value: "supporting evidence",
    label: "Verified from external source",
    sourceTitle: `${name} market report`,
    publisher: name,
    url: url ?? `https://${domain}/report`,
    sourceType: "market research",
    authorityLevel: "secondary",
    confidence: 78,
    qualityScore: 78,
    publishedDate: "2026-02-10",
    lastChecked: checkedAt,
    supportingData: ["figures"],
  };
}

// --- F. No duplicate/orphan citation references -----------------------------

test("F1. graph unavailable: every [R#] marker is neutralized instead of shipping unresolvable", () => {
  const sections = {
    executiveSummary:
      "Bottom Line -- Decision: ENTER (evidence-backed growth signal; see R12, R4, R5).",
    majorPlayers:
      "Ironclad -- product pages indicate CLM positioning [R4]. Evisort -- AI-first CLM [R5][R39].",
    strategicRecommendations: "Recommendation: Enter; see R12, R4, R5, R3.",
    sources: "Evidence Summary\nVerified against:\n• Government data\n\n1 verified source used.",
  };

  const result = neutralizeUnverifiableEvidenceReferences(sections, "English");

  assert.doesNotMatch(result.majorPlayers, /\[R\d+\]/);
  // TASK #25C -- the label itself must never reach the reader as raw
  // bracketed technical placeholder syntax; a clean, unbracketed
  // parenthetical preserves the exact same epistemic meaning.
  assert.match(result.majorPlayers, /\(unverified\)/);
  assert.doesNotMatch(result.majorPlayers, /\[Unverified reference\]/);
  // A field with no bracketed citation at all (loose "see R12, R4" prose
  // without brackets) is untouched -- the pattern only ever matches the
  // bracketed [R#] shape, matching findOrphanEvidenceReferences' own scope.
  assert.match(result.executiveSummary, /see R12, R4, R5/);
  // sources itself carries no [R#] markers in this fixture and must be
  // left byte-for-byte unchanged.
  assert.equal(result.sources, sections.sources);
});

test("F2. neutralization is localized for every supported report language", () => {
  // TASK #25C -- these are now the clean, unbracketed investor-facing
  // forms (see unverifiableReferenceLabel's own comment for why the raw
  // bracketed form was replaced).
  const localizedLabel = {
    English: "(unverified)",
    Turkish: "(doğrulanmamış)",
    German: "(nicht verifiziert)",
    French: "(non vérifié)",
    Spanish: "(no verificado)",
  };
  for (const [language, label] of Object.entries(localizedLabel)) {
    const result = neutralizeUnverifiableEvidenceReferences(
      { competitiveLandscape: "Feature parity is increasing [R6]." },
      language
    );
    assert.equal(result.competitiveLandscape, `Feature parity is increasing ${label}.`);
  }
});

test("F3. neutralization never fabricates content for an undefined section", () => {
  const result = neutralizeUnverifiableEvidenceReferences(
    { barriers: undefined, opportunities: "Entry barrier evidence [R2]." },
    "English"
  );
  assert.equal(result.barriers, undefined);
  assert.equal(result.opportunities, "Entry barrier evidence (unverified).");
});

test("F4. graph available: orphan detection still throws exactly as before (no regression from the new fallback)", () => {
  const evidence = [evidenceItem({ id: "R1" })];
  const graph = buildMarketIntelligenceGraph({ evidence }, "market report");
  assert.throws(() =>
    assertNoOrphanEvidenceReferences(
      { majorPlayers: "A claim citing a never-gathered source [R99]." },
      graph.citableEvidenceIds
    )
  );
  // The real, gathered source must NOT be flagged.
  assert.doesNotThrow(() =>
    assertNoOrphanEvidenceReferences(
      { majorPlayers: "A claim citing the real source [R1]." },
      graph.citableEvidenceIds
    )
  );
});

test("F5. two evidence IDs resolving to the same canonical URL still merge into one bibliography entry, never a duplicate", () => {
  const evidence = [
    evidenceItem({ id: "R1", url: "https://acme.com/report?utm_source=x" }),
    evidenceItem({ id: "R7", url: "https://acme.com/report" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "market report");
  const bibliography = buildMarketIntelligenceBibliography(
    { executiveSummary: "First [R1].", opportunities: "Second [R7]." },
    graph,
    "English"
  );
  const referenceLines = bibliography.split("\n").filter((line) => line.startsWith("Reference:"));
  assert.equal(referenceLines.length, 1, "same underlying document must never produce two bibliography entries");
});

test("F6. route.ts wires the graph-unavailable fallback into the same gate that guards orphan detection", () => {
  const source = readFileSync(
    new URL("../app/api/market-analysis/route.ts", import.meta.url),
    "utf8"
  );
  const gateMatch = source.match(
    /if \(graph\) \{[\s\S]*?assertNoOrphanEvidenceReferences\(deduped, graph\.citableEvidenceIds\);[\s\S]*?\} else \{\s*Object\.assign\(deduped, neutralizeUnverifiableEvidenceReferences\(deduped, language\)\);\s*\}/
  );
  assert.ok(gateMatch, "expected the else branch of the orphan-check gate to call neutralizeUnverifiableEvidenceReferences");
  assert.ok(
    source.includes("neutralizeUnverifiableEvidenceReferences") &&
      /import\s*\{[^}]*neutralizeUnverifiableEvidenceReferences[^}]*\}\s*from\s*"@\/app\/lib\/report-engine\/evidence-reference-integrity"/s.test(
        source
      ),
    "neutralizeUnverifiableEvidenceReferences must be imported from evidence-reference-integrity"
  );
});

test("F8. route.ts wires assertNoDuplicateCitationSources and assertCitationsResolveInBibliography into the SAME graph-available gate as the orphan check", () => {
  const source = readFileSync(
    new URL("../app/api/market-analysis/route.ts", import.meta.url),
    "utf8"
  );
  const gateBlockMatch = source.match(/if \(graph\) \{([\s\S]*?)\} else \{/);
  assert.ok(gateBlockMatch, "expected a single if (graph) { ... } else { ... } gate");
  const gateBlock = gateBlockMatch[1];
  assert.match(gateBlock, /assertNoOrphanEvidenceReferences\(deduped, graph\.citableEvidenceIds\);/);
  assert.match(gateBlock, /assertNoDuplicateCitationSources\(graph\.sources\);/);
  assert.match(gateBlock, /assertCitationsResolveInBibliography\(deduped, deduped\.sources\);/);
  assert.ok(
    /import\s*\{[^}]*assertNoDuplicateCitationSources[^}]*assertCitationsResolveInBibliography[^}]*\}\s*from\s*"@\/app\/lib\/report-engine\/evidence-reference-integrity"/s.test(
      source
    ) ||
      /import\s*\{[^}]*assertCitationsResolveInBibliography[^}]*assertNoDuplicateCitationSources[^}]*\}\s*from\s*"@\/app\/lib\/report-engine\/evidence-reference-integrity"/s.test(
        source
      ),
    "both new assertions must be imported from evidence-reference-integrity"
  );
});

test("F7. end-to-end simulation against the real defect: six distinct [R#] citations with a 1-source Evidence Summary all resolve to an honest label", () => {
  // Verbatim shape of the real persisted report (id
  // bb36e409-0d5a-490f-a5ba-32243d6054f6) that exposed this defect.
  const sections = {
    executiveSummary:
      "Bottom Line — Decision: ENTER the U.S. mid‑market AI compliance & contract intelligence SaaS market for 2027 (evidence-backed growth signal and commercially active vendor landscape; see R12, R4, R5).",
    majorPlayers:
      "Ironclad — product pages and pricing plan page indicate CLM + AI assistant + eSignature positioning [R4]. Evisort — publishes an AI engine and contract LLM [R5][R39]. DocuSign CLM — appears in state procurement pricing (South Carolina) [R3]. LawGeex — advertises AI contract-review capabilities [R6].",
    strategicRecommendations:
      "Recommendation: Enter (evidence supports entering with a validated mid-market penetration plan and procurement readiness; see R12, R4, R5, R3).",
    sources: "Evidence Summary\nVerified against:\n• Government data\n\n1 verified source used.",
  };

  const result = neutralizeUnverifiableEvidenceReferences(sections, "English");

  for (const field of ["majorPlayers"]) {
    assert.doesNotMatch(result[field], /\[R\d+\]/, `${field} must have no resolvable-looking [R#] marker left`);
  }
  // Every reference is now the same honest, clean (unbracketed -- TASK
  // #25C) label, never a number a reader could mistake for something
  // Sources should (but doesn't) list, and never left as raw bracketed
  // technical placeholder syntax.
  assert.doesNotMatch(result.majorPlayers, /\[[^\]]+\]/);
  const unverifiedTokens = result.majorPlayers.match(/\(unverified\)/g) || [];
  assert.ok(unverifiedTokens.length > 0);
});

// --- G. Regeneration preserves claim-to-source provenance --------------------

test("G1. buildMarketIntelligenceGraph is a pure function of its evidence: identical input always yields identical evidenceId -> source mapping", () => {
  const evidence = [
    evidenceItem({ id: "R1", name: "Ironclad", domain: "ironclad.com" }),
    evidenceItem({ id: "R2", name: "Evisort", domain: "evisort.com" }),
    evidenceItem({ id: "R3", name: "DocuSign", domain: "docusign.com" }),
  ];
  const first = buildMarketIntelligenceGraph({ evidence }, "CLM market");
  const second = buildMarketIntelligenceGraph({ evidence }, "CLM market");

  assert.deepEqual([...first.citableEvidenceIds].sort(), [...second.citableEvidenceIds].sort());
  for (const id of first.citableEvidenceIds) {
    assert.deepEqual(first.sourceRecordByEvidenceId[id], second.sourceRecordByEvidenceId[id]);
  }
});

test("G2. re-running the graph builder on the same evidence array in a different order still resolves every original citation, but flags this as the real drift risk regeneration must avoid", () => {
  const evidence = [
    evidenceItem({ id: "R1", name: "Ironclad", domain: "ironclad.com" }),
    evidenceItem({ id: "R2", name: "Evisort", domain: "evisort.com" }),
  ];
  const reordered = [evidence[1], evidence[0]];

  const original = buildMarketIntelligenceGraph({ evidence }, "CLM market");
  const rebuilt = buildMarketIntelligenceGraph({ evidence: reordered }, "CLM market");

  // Evidence IDs in this pipeline are assigned upstream (domain-research.ts)
  // and carried through verbatim by buildMarketIntelligenceGraph -- it never
  // reassigns an id based on array position, so reordering the SAME
  // id-tagged evidence must not change which source R1/R2 resolve to. This
  // is what makes a graph rebuilt from a cached research bundle (route.ts's
  // graph-less fallback path) safe: as long as the cached evidence array
  // itself is unchanged, id resolution is unaffected by ordering.
  assert.equal(original.sourceRecordByEvidenceId.R1.publisher, rebuilt.sourceRecordByEvidenceId.R1.publisher);
  assert.equal(original.sourceRecordByEvidenceId.R2.publisher, rebuilt.sourceRecordByEvidenceId.R2.publisher);
});

// --- B. A product page cannot prove market share -----------------------------

test("B1. VendorIntelligence and AdjacentMarketPlayer never expose a market-share field for any vendor to populate", () => {
  const source = readFileSync(
    new URL("../app/lib/ai/vendor-intelligence.ts", import.meta.url),
    "utf8"
  );
  const vendorIntelligenceType = source.match(/export type VendorIntelligence = \{[\s\S]*?\n\};/)?.[0];
  const adjacentPlayerType = source.match(/export type AdjacentMarketPlayer = \{[\s\S]*?\n\};/)?.[0];
  assert.ok(vendorIntelligenceType && adjacentPlayerType, "expected both type definitions to be found");
  assert.doesNotMatch(vendorIntelligenceType, /marketShare/i);
  assert.doesNotMatch(adjacentPlayerType, /marketShare/i);
});

// --- A. A source mentioning a vendor cannot prove a pricing claim -----------

test("A1. a vendor named only in a generic mention (no pricing-model language anywhere in its evidence) gets no fabricated pricingModels/pricingEvidence", () => {
  const vendorName = "ClauseWorks";
  const domain = "clauseworks.example.com";
  const evidence = [
    {
      id: "R1",
      field: "vendor_discovery",
      claim: `${vendorName} is a contract lifecycle management platform used by legal teams.`,
      value: `${vendorName} product mention`,
      label: "Verified from external source",
      sourceTitle: `${vendorName} official product page`,
      publisher: vendorName,
      url: `https://${domain}/product`,
      sourceType: "company_source",
      authorityLevel: "primary",
      confidence: 82,
      publishedDate: "2026-01-15",
      lastChecked: checkedAt,
      supportingData: [`${vendorName} product mention`],
      impact: "neutral",
      impactReason: "Names a vendor.",
      qualityScore: 76,
      qualityRationale: "Official vendor evidence.",
    },
    {
      id: "R2",
      field: "vendor_discovery",
      claim: `Independent market coverage identifies ${vendorName} as a contract lifecycle management vendor serving enterprise customers.`,
      value: `${vendorName} independent vendor mention`,
      label: "Verified from external source",
      sourceTitle: "CLM vendor landscape 2026",
      publisher: "Gartner",
      url: "https://www.gartner.com/en/research/clm-landscape-2026",
      sourceType: "credible_market_data",
      authorityLevel: "secondary",
      confidence: 80,
      publishedDate: "2026-01-20",
      lastChecked: checkedAt,
      supportingData: [`${vendorName} independent vendor mention`],
      impact: "neutral",
      impactReason: "Independently corroborates the vendor.",
      qualityScore: 74,
      qualityRationale: "Independent analyst coverage.",
    },
  ];

  const graph = buildVendorIntelligenceGraph(evidence, "Analyze the contract lifecycle management market.");
  const vendor = graph.vendors.find((item) => item.name.toLowerCase().includes("clauseworks"));

  if (vendor) {
    assert.deepEqual(vendor.pricingModels, [], "no pricing-model language exists anywhere in this vendor's evidence");
    assert.equal(
      vendor.pricingEvidenceCount,
      0,
      "a bare product-category mention must never count as pricing evidence"
    );
  }
});

test("A2. a vendor with genuine pricing-model language in its evidence is credited with real pricing evidence, distinct from a bare mention", () => {
  const vendorName = "TermSuite";
  const domain = "termsuite.example.com";
  const evidence = [
    {
      id: "R1",
      field: "vendor_discovery",
      claim: `${vendorName} offers per-seat subscription pricing for its contract lifecycle management platform, billed monthly per user.`,
      value: `${vendorName} pricing page`,
      label: "Verified from external source",
      sourceTitle: `${vendorName} pricing page`,
      publisher: vendorName,
      url: `https://${domain}/pricing`,
      sourceType: "company_source",
      authorityLevel: "primary",
      confidence: 82,
      publishedDate: "2026-01-15",
      lastChecked: checkedAt,
      supportingData: [`${vendorName} pricing page`],
      impact: "neutral",
      impactReason: "Names pricing.",
      qualityScore: 76,
      qualityRationale: "Official vendor pricing evidence.",
    },
    {
      id: "R2",
      field: "vendor_discovery",
      claim: `Independent market coverage identifies ${vendorName} as a contract lifecycle management vendor serving enterprise customers.`,
      value: `${vendorName} independent vendor mention`,
      label: "Verified from external source",
      sourceTitle: "CLM vendor landscape 2026",
      publisher: "Gartner",
      url: "https://www.gartner.com/en/research/clm-landscape-2026-b",
      sourceType: "credible_market_data",
      authorityLevel: "secondary",
      confidence: 80,
      publishedDate: "2026-01-20",
      lastChecked: checkedAt,
      supportingData: [`${vendorName} independent vendor mention`],
      impact: "neutral",
      impactReason: "Independently corroborates the vendor.",
      qualityScore: 74,
      qualityRationale: "Independent analyst coverage.",
    },
  ];

  const graph = buildVendorIntelligenceGraph(evidence, "Analyze the contract lifecycle management market.");
  const vendor = graph.vendors.find((item) => item.name.toLowerCase().includes("termsuite"));

  assert.ok(vendor, "expected TermSuite to be discovered as a vendor");
  assert.ok(vendor.pricingModels.length > 0, "explicit per-seat/subscription pricing language must be recognized");
  assert.ok(vendor.pricingEvidenceCount > 0);
  assert.notEqual(vendor.pricingEvidence, "", "real pricing evidence must be surfaced, not left blank");
});

// --- E. UI and PDF citation IDs resolve to the same source -----------------

test("E1. none of the three presentation surfaces independently renumber or reassign [R#] citation ids", () => {
  const files = [
    "../app/dashboard/[id]/page.tsx",
    "../components/Planner.tsx",
    "../app/dashboard/[id]/ReportPdfButton.tsx",
  ];
  const renumberingPattern = /\[R\d+\]\s*,?\s*(?:i|idx|index)\s*\+\+|citationIndex\+\+|citationCounter\+\+/;

  for (const relativePath of files) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      renumberingPattern,
      `${relativePath} must never derive a new sequential number for a [R#] citation -- all three surfaces render the same persisted section text verbatim`
    );
  }
});

test("E2. ReportPdfButton's CitationData.referenceTag is documented as sourced only from the deterministic bibliography, never independently computed", () => {
  const source = readFileSync(
    new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /referenceTag\?:\s*string/);
  assert.match(source, /Only ever populated by the Market Intelligence\s*\n\s*\/\/ deterministic bibliography \(buildMarketIntelligenceBibliography\)/);
});

// --- F (follow-up). Deterministic duplicate-citation detection --------------
//
// Different evidence ids that resolve to the same underlying document
// (the exact same canonical URL, or a protocol/www/trailing-slash/
// tracking-parameter variant of it) must be DETECTED, never silently
// merged. TASK #29D -- superseded the original title+publisher match key:
// confirmed live, a real generation failure showed two GENUINELY DIFFERENT
// Reddit threads (different URLs, real distinct documents) both falling
// back to the same generic "reddit.com"/"reddit.com" title+publisher pair
// and being incorrectly flagged as duplicates of each other. Identity is
// now keyed on the normalized URL alone -- title/publisher no longer
// factor into whether two sources are considered the same document at
// all, so two sources can share any title/publisher, however generic or
// identical, and still coexist as long as their URLs genuinely differ.

function citationSource({ evidenceId, title, publisher, url }) {
  return { evidenceId, title, publisher, url };
}

test("F9. two different evidence ids that share an identical, generic title and publisher (the real Reddit-shaped failure) are NOT flagged as duplicates when their URLs are genuinely different documents", () => {
  const sources = [
    citationSource({
      evidenceId: "R40",
      title: "reddit.com",
      publisher: "reddit.com",
      url: "https://www.reddit.com/r/legaltech/comments/abc123/clm_vendor_comparison/",
    }),
    citationSource({
      evidenceId: "R87",
      title: "reddit.com",
      publisher: "reddit.com",
      url: "https://www.reddit.com/r/saas/comments/xyz789/ai_contract_review_pricing/",
    }),
  ];

  assert.equal(findDuplicateCitationSources(sources).length, 0, "genuinely distinct threads on the same domain, same generic title/publisher, must never be flagged");
  assert.doesNotThrow(() => assertNoDuplicateCitationSources(sources));
});

test("F9b. a syndicated document mirrored on two DIFFERENT domains (a real, different URL host) is not a duplicate -- these are two distinct pages regardless of shared title/publisher", () => {
  const sources = [
    citationSource({
      evidenceId: "R4",
      title: "US Legal AI Market Report 2026",
      publisher: "Grand View Research",
      url: "https://grandviewresearch.com/legal-ai-2026",
    }),
    citationSource({
      evidenceId: "R11",
      title: "US Legal AI Market Report 2026",
      publisher: "Grand View Research",
      url: "https://mirror.grandviewresearch.com/reports/legal-ai-2026-syndicated",
    }),
  ];

  assert.equal(findDuplicateCitationSources(sources).length, 0, "a different host is a genuinely different URL, not the same document, even with identical title/publisher");
  assert.doesNotThrow(() => assertNoDuplicateCitationSources(sources));
});

test("F10. matching is title/publisher-blind -- identical titles never trigger a match on their own, and differing titles never prevent a match when the URL is the same document", () => {
  const sameTitleDifferentUrl = [
    citationSource({ evidenceId: "R1", title: "Legal AI Market Report 2026", publisher: "Gartner", url: "https://a.com/1" }),
    citationSource({ evidenceId: "R2", title: "Legal AI Market Report 2026", publisher: "Gartner", url: "https://a.com/2" }),
  ];
  assert.equal(findDuplicateCitationSources(sameTitleDifferentUrl).length, 0, "identical title/publisher alone must never trigger a match -- the URLs are genuinely different pages");

  const differentTitleSameUrl = [
    citationSource({ evidenceId: "R1", title: "Legal AI Market Report 2026", publisher: "Gartner", url: "https://a.com/report" }),
    citationSource({ evidenceId: "R2", title: "Completely Different Title", publisher: "Someone Else", url: "https://a.com/report" }),
  ];
  assert.equal(findDuplicateCitationSources(differentTitleSameUrl).length, 1, "the exact same URL must be flagged regardless of how different the title/publisher strings are");
  assert.throws(() => assertNoDuplicateCitationSources(differentTitleSameUrl), DuplicateCitationSourceError);
});

test("F11. an empty/unparseable URL is excluded entirely from matching, even when title and publisher are identical", () => {
  const emptyUrls = [
    citationSource({ evidenceId: "R1", title: "CLM Vendor Landscape", publisher: "Gartner", url: "" }),
    citationSource({ evidenceId: "R2", title: "CLM Vendor Landscape", publisher: "Gartner", url: "" }),
  ];
  assert.equal(findDuplicateCitationSources(emptyUrls).length, 0, "no URL means no identity signal to compare -- never flagged, never crashes");
});

test("F12. two ids already merged onto the same canonical URL (graph.sources' own pre-existing dedup) are never re-flagged as a NEW duplicate", () => {
  const evidence = [
    evidenceItem({ id: "R1", name: "Acme", url: "https://acme.com/report?utm_source=x" }),
    evidenceItem({ id: "R7", name: "Acme", url: "https://acme.com/report" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "market report");
  // graph.sources is already deduped by canonical URL -- only one row
  // survives for R1/R7, so there is nothing left for the title/publisher
  // detector to find; it must not throw on the graph's own normal output.
  assert.equal(graph.sources.length, 1);
  assert.doesNotThrow(() => assertNoDuplicateCitationSources(graph.sources));
});

test("F13. a report with no duplicates at all never throws", () => {
  const sources = [
    citationSource({ evidenceId: "R1", title: "Ironclad Pricing Page", publisher: "Ironclad", url: "https://ironclad.com/pricing" }),
    citationSource({ evidenceId: "R2", title: "Evisort AI Engine", publisher: "Evisort", url: "https://evisort.com/ai" }),
  ];
  assert.doesNotThrow(() => assertNoDuplicateCitationSources(sources));
});

// --- Runtime invariant: UI/PDF resolve citations from the SAME persisted ---
// --- canonical bibliography, not an independently derived mapping ----------
//
// assertNoOrphanEvidenceReferences proves every [R#] cited in the body is a
// REAL, registry-valid evidence id. It does NOT prove that id has an actual
// "Reference: [R#]" entry in the rendered Sources bibliography text -- the
// one artifact every UI/PDF surface actually reads to resolve a citation.
// findCitationsUnresolvedInBibliography/assertCitationsResolveInBibliography
// close exactly that gap, confirmed live: enforceInlineRawUrlLimit's
// "known source" branch can rewrite a later inline URL into a real,
// registry-valid [R#] AFTER the bibliography was already built from the
// pre-rewrite text, so that id would never get its own bibliography entry.
// Fixed upstream in route.ts by reordering so URL-rewriting runs before the
// bibliography is built; these are the regression tests for that ordering,
// and the general-purpose invariant for any future cause of the same drift.

test("R1. every [R#] cited in the body resolves against the bibliography's own \"Reference: [R#]\" lines", () => {
  const bibliography = [
    "Sources",
    "",
    "Reference: [R4]",
    "Title: Ironclad Pricing Page",
    "Publisher: Ironclad",
    "URL: https://ironclad.com/pricing",
    "Type: company_source",
    "Confidence: Verified",
  ].join("\n");
  const sections = {
    majorPlayers: "Ironclad offers CLM tooling [R4].",
    sources: bibliography,
  };
  assert.deepEqual(findCitationsUnresolvedInBibliography(sections, bibliography), []);
  assert.doesNotThrow(() => assertCitationsResolveInBibliography(sections, bibliography));
});

test("R2. a real, registry-valid [R#] missing its own bibliography entry is caught (the confirmed live defect, reproduced directly)", () => {
  // Reproduces the exact confirmed bug: enforceInlineRawUrlLimit's
  // known-source rewrite (formerly running AFTER the bibliography was
  // built) can introduce [R14] into a body field with no matching
  // "Reference: [R14]" line anywhere in the already-finalized bibliography.
  const bibliography = [
    "Sources",
    "",
    "Reference: [R4]",
    "Title: Ironclad Pricing Page",
    "Publisher: Ironclad",
    "URL: https://ironclad.com/pricing",
    "Type: company_source",
    "Confidence: Verified",
  ].join("\n");
  const sections = {
    majorPlayers: "Ironclad offers CLM tooling [R4].",
    competitiveLandscape: "A second, later-introduced citation appears here [R14].",
    sources: bibliography,
  };

  const unresolved = findCitationsUnresolvedInBibliography(sections, bibliography);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].field, "competitiveLandscape");
  assert.equal(unresolved[0].reference, "[R14]");

  assert.throws(() => assertCitationsResolveInBibliography(sections, bibliography), UnresolvedBibliographyCitationError);
});

test("R3. the sources field itself is never scanned as a body citation (mirrors buildMarketIntelligenceBibliography's own field == \"sources\" exclusion)", () => {
  const bibliography = "Sources\n\nReference: [R4]\nTitle: X\nPublisher: Y\nURL: https://x.com\nType: t\nConfidence: Verified";
  const sections = { sources: `${bibliography} and also mentions [R99] in passing` };
  // [R99] only appears inside the sources field's own text (e.g. a stray
  // mention in the closing verdict paragraph), never in a body section --
  // this must not be treated as an unresolved body citation.
  assert.deepEqual(findCitationsUnresolvedInBibliography(sections, bibliography), []);
});

test("R4. end-to-end: the actual route.ts fix (URL-rewrite before bibliography-build) is what makes real report content self-consistent", () => {
  // Simulates the real report's own shape after the fix: the bibliography
  // is built from `deduped` AFTER inline-URL rewriting has already run, so
  // every citation the rewrite could introduce is already present in the
  // text buildMarketIntelligenceBibliography scans.
  const evidence = [
    evidenceItem({ id: "R4", name: "Ironclad", url: "https://ironclad.com/pricing" }),
    evidenceItem({ id: "R14", name: "Evisort", url: "https://evisort.com/product" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "CLM market");
  const sections = {
    majorPlayers: "Ironclad offers CLM tooling [R4]. See also https://evisort.com/product and https://evisort.com/product/extra for AI capability.",
  };

  // Simulate the fixed ordering: rewrite first, THEN build the bibliography.
  const rewritten = { ...sections, majorPlayers: sections.majorPlayers.replace("https://evisort.com/product/extra", "[R14]") };
  const bibliography = buildMarketIntelligenceBibliography(rewritten, graph, "English");
  const finalSections = { ...rewritten, sources: bibliography };

  assert.doesNotThrow(() => assertCitationsResolveInBibliography(finalSections, bibliography));
  assert.match(bibliography, /Reference: \[R14\]/);
});
