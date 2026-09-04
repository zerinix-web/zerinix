import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  extractMarketSizingLayerValue,
  getSectionTakeaway,
  parseMarketSizingMagnitude,
  resolveMarketSizingCascade,
  stripLeadingTakeawaySentence,
} from "../app/lib/report-presentation.ts";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import { extractVendorCandidateMentions } from "../app/lib/ai/vendor-discovery.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pageSource = readFileSync(`${repoRoot}app/dashboard/[id]/page.tsx`, "utf8");
const pdfSource = readFileSync(`${repoRoot}app/dashboard/[id]/ReportPdfButton.tsx`, "utf8");

// P0 PRODUCTION FIX -- targeted root-cause investigation and fix for three
// remaining Market Intelligence production consistency defects observed in
// a real production report for a mature U.S. commercial real estate
// services market:
//
// 1. UI <-> PDF CANONICAL DATA INCONSISTENCY: the web report correctly
//    showed TAM = $131.6B, SAM = $32.9B, SOM = Validation Needed -- a
//    genuinely partial, correctly-nested result -- while the exported PDF
//    for the SAME report collapsed the whole section to "Additional
//    market validation is required," losing the valid TAM and SAM.
//    ROOT CAUSE: page.tsx and ReportPdfButton.tsx each hand-rolled their
//    OWN regex pair for extracting a TAM/SAM/SOM layer's raw value text
//    out of the shared tamSamSom content string -- the production TAM
//    line's phrasing matched the web's permissive, boundary-aware
//    extractor but not the PDF's stricter, self-anchored one, so
//    tamResolved was true on the web and false in the PDF for the exact
//    same figure, which then cascaded (via the correct, unchanged
//    TAM-first nesting rule) to mark an independently-valid SAM
//    unresolved in the PDF too. FIXED by extracting
//    extractMarketSizingLayerValue/parseMarketSizingMagnitude as the
//    single canonical implementation in report-presentation.ts, with
//    both page.tsx and ReportPdfButton.tsx now calling it directly
//    instead of maintaining independent copies.
//
// 2. COMPETITOR EVIDENCE PROPAGATION FAILURE: a report explicitly used
//    CBRE/JLL as evidence in Top Risk/threats/incumbent-concentration
//    prose (generated from the full evidence corpus with no field gate),
//    yet Competitive Landscape was empty and Major Players said named
//    competitor information was limited. ROOT CAUSE (two compounding
//    gaps): (a) vendor-discovery.ts's isVendorDiscoveryRelevant field
//    allowlist was missing "industry_structure" (feeds
//    industry_trends/porters_five_forces/barriers) and "news_evidence"
//    (feeds market_drivers/threats/opportunities) -- the exact two
//    research fields evidence supporting incumbent-concentration/risk
//    narrative would live under -- so that evidence was invisible to
//    mention extraction entirely, even though the free-text risk-prose
//    generator had no such gate. (b) vendor-intelligence.ts's
//    adjacentPlayers ("Major Players", the tier explicitly designed to
//    honestly hold real-but-not-fully-corroborated companies) required
//    the exact same qualifyingItems bar (label + confidence >= 48) used
//    to validate a full DIRECT competitor, defeating its own purpose as
//    a lower, honest tier. FIXED by (a) widening the field allowlist
//    (industry-agnostic, does not touch any validation threshold) and
//    (b) admitting a candidate into adjacentPlayers when it has
//    substantive (non-thin, non-"Unknown"-labeled) named evidence even
//    when it falls short of the strict qualifying bar -- explicitly
//    labeled "directional" in that case. The strict `vendors`/
//    Competitive Landscape bar (validateVendorCandidate,
//    isQualifyingVendorEvidence, assessMarketRelevance) is completely
//    unchanged; no pricing/market-share/positioning/strength/weakness is
//    ever populated for this tier.
//
// 3. DUPLICATE CONTENT ROOT CAUSE: the PDF still duplicated the Key
//    Takeaway/opening sentence inside several sections' bodies despite
//    the field-based wiring being present and correctly scoped. ROOT
//    CAUSE: getSectionTakeaway (via splitSentences/stripMarkdown)
//    collapses ALL whitespace -- including newlines -- before scanning
//    for a sentence boundary, so a short label-only first line
//    ("**Answer:**", no sentence-ending punctuation of its own) gets
//    silently fused with the NEXT line, correctly producing a takeaway
//    spanning both lines -- but stripLeadingTakeawaySentence only ever
//    searched for a boundary within that single first physical line,
//    found none, and returned the content completely unchanged, leaving
//    the real duplicate sentence sitting untouched on the very next
//    line. FIXED by extending stripLeadingTakeawaySentence to also check
//    a bounded, exactly-one-line lookahead when the first line alone has
//    no sentence boundary of its own.

// ===========================================================================
// 1. TAM/SAM/SOM canonical UI/PDF data consistency
// ===========================================================================

test("TAM1: the exact reported production shape (TAM $131.6B, SAM $32.9B, SOM unavailable) resolves TAM and SAM independently of SOM via the canonical extractor -- the section must not collapse", () => {
  const content = [
    "TAM [Estimated]: $131.6B",
    "SAM [Estimated]: $32.9B",
    "SOM: realistic obtainable-share evidence for this market was not found.",
  ].join("\n");

  const tamValue = extractMarketSizingLayerValue(content, "TAM");
  const samValue = extractMarketSizingLayerValue(content, "SAM");
  const somValue = extractMarketSizingLayerValue(content, "SOM");

  const magnitudes = [
    parseMarketSizingMagnitude(tamValue),
    parseMarketSizingMagnitude(samValue),
    parseMarketSizingMagnitude(somValue),
  ];

  assert.equal(magnitudes[0], 131.6e9);
  assert.equal(magnitudes[1], 32.9e9);
  assert.equal(magnitudes[2], null, "SOM must never be fabricated when the evidence genuinely was not found");

  const cascade = resolveMarketSizingCascade(magnitudes);
  assert.equal(cascade.tamResolved, true);
  assert.equal(cascade.samResolved, true);
  assert.equal(cascade.somResolved, false);
  assert.equal(cascade.allResolved, false);
});

test("TAM2: a value shape the PDF's OLD stricter anchored regex used to reject ('≈' as the label/value separator, plus a parenthetical context tag) is still correctly extracted by the shared canonical function", () => {
  const content =
    "Resulting Planning Estimate: TAM (Germany, 2026) ≈ EUR200-800 million [Estimated]; SAM (serviceable inventory-drone market) ≈ EUR40-160 million [Estimated]; SOM near-term obtainable share over 18 months is not established.";

  const tamValue = extractMarketSizingLayerValue(content, "TAM");
  const samValue = extractMarketSizingLayerValue(content, "SAM");

  assert.ok(parseMarketSizingMagnitude(tamValue) !== null, `TAM must parse a real magnitude from: "${tamValue}"`);
  assert.ok(parseMarketSizingMagnitude(samValue) !== null, `SAM must parse a real magnitude from: "${samValue}"`);
});

test("TAM3: resolveMarketSizingCascade still never fabricates a magnitude -- an empty/unavailable layer stays null through the canonical extractor and parser", () => {
  const content = "TAM: $131.6B\nSAM [Estimated]: $32.9B\nSOM: obtainable-share evidence was not found.";
  const somValue = extractMarketSizingLayerValue(content, "SOM");
  assert.equal(parseMarketSizingMagnitude(somValue), null);
});

test("TAM4: a SAM that numerically exceeds TAM is still rejected as unresolved through the canonical pipeline -- a genuine data inconsistency must not render as valid", () => {
  const magnitudes = [50e9, 90e9, null];
  const cascade = resolveMarketSizingCascade(magnitudes);
  assert.equal(cascade.tamResolved, true);
  assert.equal(cascade.samResolved, false, "SAM exceeding its own TAM is a data inconsistency, not merely missing data");
});

// TASK #58 -- page.tsx's own tag-tolerant extraction fallback (a second,
// independently-maintained copy of extractMarketSizingLayerValue's logic)
// is now removed entirely: extractMarketSizeCardValue delegates directly
// to the canonical function, so there is no longer a second regex
// fragment to keep in lockstep by hand. Updated from a source-fragment
// comparison to a delegation proof, mirroring the ReportPdfButton.tsx
// PARITY test immediately below.
test("PARITY: page.tsx's extractMarketSizeCardValue delegates directly to the canonical extractMarketSizingLayerValue -- no independent copy of this extraction rule is left to silently diverge", () => {
  assert.match(
    pageSource,
    /import\s*\{[^}]*extractMarketSizingLayerValue[^}]*\}\s*from\s*"@\/app\/lib\/report-presentation"/s,
    "page.tsx must import the canonical extractor"
  );
  assert.match(
    pageSource,
    /function extractMarketSizeCardValue\(content: string, label: "TAM" \| "SAM" \| "SOM"\) \{\s*return extractMarketSizingLayerValue\(content, label\);\s*\}/,
    "page.tsx's extractMarketSizeCardValue must be a pure delegation to the canonical extractor, not maintain its own copy"
  );
});

test("PARITY: ReportPdfButton.tsx imports and calls the SAME canonical extractMarketSizingLayerValue/parseMarketSizingMagnitude the web report uses -- the two surfaces can no longer independently disagree", () => {
  assert.match(
    pdfSource,
    /import\s*\{[^}]*extractMarketSizingLayerValue[^}]*\}\s*from\s*"@\/app\/lib\/report-presentation"/s,
    "ReportPdfButton.tsx must import the canonical extractor"
  );
  assert.match(
    pdfSource,
    /import\s*\{[^}]*parseMarketSizingMagnitude[^}]*\}\s*from\s*"@\/app\/lib\/report-presentation"/s,
    "ReportPdfButton.tsx must import the canonical magnitude parser"
  );
  assert.match(
    pdfSource,
    /extractMarketSizingLayerValue\(normalized,\s*label\)/,
    "ReportPdfButton.tsx must actually delegate raw-value extraction to the canonical function"
  );
  assert.match(
    pdfSource,
    /function parseMarketSizeMagnitude\(value: string\): number \| null \{\s*return parseMarketSizingMagnitude\(value\);\s*\}/,
    "ReportPdfButton.tsx's magnitude parser must delegate to the canonical implementation, not maintain its own copy"
  );
});

// ===========================================================================
// 2. Competitor evidence propagation
// ===========================================================================

const checkedAt = "2026-08-27T00:00:00.000Z";
let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `PC${idCounter}`;
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

const creMarketPrompt = "Evaluate the mature U.S. commercial real estate services market.";

test("COMP1: a company named ONLY in industry_structure evidence (the field feeding Porter's Five Forces/barriers, previously invisible to vendor discovery) with weak (sub-qualifying) confidence still reaches adjacentPlayers, explicitly labeled directional", () => {
  const evidence = [
    baseEvidence({
      field: "industry_structure",
      sourceType: "credible_market_data",
      claim:
        "Newmark ranked #4 among commercial real estate services firms by market concentration in the latest industry structure analysis.",
      value: "Industry concentration ranking",
      sourceTitle: "Industry structure and buyer concentration report",
      publisher: "Sector Analytics",
      url: "https://www.sectoranalytics.example/cre-structure",
      label: "Verified from external source",
      confidence: 30,
      qualityScore: undefined,
    }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, creMarketPrompt);

  const adjacent = graph.vendorIntelligence.adjacentPlayers.find((p) => p.name === "Newmark");
  assert.ok(
    adjacent,
    `Newmark must survive to adjacentPlayers even with sub-qualifying confidence, got: ${JSON.stringify(graph.vendorIntelligence.adjacentPlayers)}`
  );
  assert.match(adjacent.reason, /directional/i, "weak, sub-qualifying evidence must be explicitly labeled as directional, never presented as fully validated");
  assert.equal(
    graph.vendorIntelligence.vendors.some((v) => v.name === "Newmark"),
    false,
    "the strict Competitive Landscape (vendors) bar must remain completely unaffected by this fix"
  );

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.ok(projection.majorPlayers.includes("Newmark"), "Major Players must honestly surface the company instead of saying named competitor information was limited");
});

test("COMP2 (no evidence-standard weakening, regression guard): a candidate with ONLY thin, content-less domain citations still never reaches adjacentPlayers", () => {
  const evidence = [
    baseEvidence({
      field: "industry_structure",
      claim: "",
      value: "",
      sourceTitle: "",
      url: "https://www.obscureconsultancy.example/",
      label: "Verified from external source",
      confidence: 30,
      qualityScore: undefined,
      supportingData: [],
    }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, creMarketPrompt);
  assert.equal(
    graph.vendorIntelligence.adjacentPlayers.length,
    0,
    "a thin, content-less citation must never be sufficient to populate even the honest adjacentPlayers tier"
  );
});

test("COMP3 (no evidence-standard weakening, regression guard): 'Unknown'-labeled evidence (an explicit missing-information placeholder) never qualifies a candidate for adjacentPlayers either", () => {
  const evidence = [
    baseEvidence({
      field: "news_evidence",
      claim: "Colliers is frequently mentioned as a possible participant, though this could not be confirmed.",
      value: "Unconfirmed mention",
      sourceTitle: "Unverified note",
      publisher: "",
      url: "https://www.example-news.example/cre-note",
      label: "Unknown",
      confidence: 30,
      qualityScore: undefined,
    }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, creMarketPrompt);
  assert.equal(
    graph.vendorIntelligence.adjacentPlayers.some((p) => p.name === "Colliers"),
    false,
    "an explicit 'Unknown'/missing-information placeholder must never be treated as substantive named evidence"
  );
});

test("COMP4: evidence field-gate fix is scoped to the two specific research fields (industry_structure, news_evidence) confirmed missing -- the existing vendor-relevant fields are untouched", () => {
  const source = readFileSync(`${repoRoot}app/lib/ai/vendor-discovery.ts`, "utf8");
  const fieldSetMatch = source.match(/const vendorRelevantFields = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(fieldSetMatch, "vendorRelevantFields set must exist");
  const fieldSetBody = fieldSetMatch[1];
  for (const field of ["vendor_discovery", "competitors", "product_evidence", "pricing_models", "company_evidence", "industry_structure", "news_evidence"]) {
    assert.match(fieldSetBody, new RegExp(`"${field}"`), `vendorRelevantFields must include "${field}"`);
  }
});

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
// consistency verification): discovered while directly re-verifying the
// literal ticket scenario ("CBRE and JLL" named together) end to end --
// enumerationMentionPattern's connector between list items required a
// comma unconditionally, so the single most natural two-company
// enumeration ("the leading commercial real estate services firms are
// CBRE and JLL", no Oxford comma, only two names) never matched at all,
// independent of the field-gate/adjacentPlayers fixes above. Fixed by
// accepting a bare "X and Y" connector alongside the existing
// comma-based one; every 3+-item, comma-separated shape (with or
// without an Oxford comma) is unaffected.
test("COMP5: a bare two-item enumeration with NO comma ('CBRE and JLL', the single most natural way to name exactly two incumbents) is extracted -- previously only 3+-item comma-separated lists matched", () => {
  const evidence = {
    id: "E-comp5",
    field: "industry_structure",
    claim: "The leading commercial real estate services firms are CBRE and JLL, reflecting rising platform concentration among incumbents.",
    value: "Incumbent concentration finding",
    label: "Verified from external source",
    sourceTitle: "Industry structure analysis",
    publisher: "Sector Analytics",
    url: "https://www.sectoranalytics.example/cbre-jll-concentration",
    sourceType: "credible_market_data",
    authorityLevel: "secondary",
    confidence: 28,
    publishedDate: "2026-01-10",
    lastChecked: checkedAt,
    supportingData: [],
    impact: "neutral",
    impactReason: "x",
    searchQuery: "",
  };
  const mentions = extractVendorCandidateMentions([evidence], null);
  const names = mentions.map((m) => m.name);
  assert.ok(names.includes("CBRE"), `CBRE must be extracted from a bare two-item enumeration, got: ${JSON.stringify(names)}`);
  assert.ok(names.includes("JLL"), `JLL must be extracted from a bare two-item enumeration, got: ${JSON.stringify(names)}`);
});

test("COMP6 (no regression): 3+-item comma-separated enumerations (with and without an Oxford comma) still extract every name correctly", () => {
  const base = {
    id: "E-comp6",
    field: "industry_structure",
    label: "Verified from external source",
    sourceType: "credible_market_data",
    authorityLevel: "secondary",
    confidence: 28,
    publishedDate: "2026-01-10",
    lastChecked: checkedAt,
    supportingData: [],
    impact: "neutral",
    impactReason: "x",
    searchQuery: "",
    sourceTitle: "Industry structure analysis",
    publisher: "Sector Analytics",
    url: "https://www.sectoranalytics.example/cre-overview",
  };
  const withOxfordComma = extractVendorCandidateMentions(
    [{ ...base, claim: "The leading commercial real estate services firms are CBRE, JLL, and Cushman & Wakefield.", value: "x" }],
    null
  ).map((m) => m.name);
  assert.deepEqual(withOxfordComma.sort(), ["CBRE", "Cushman & Wakefield", "JLL"].sort());

  const fiveItems = extractVendorCandidateMentions(
    [
      {
        ...base,
        claim: "The leading commercial real estate services firms are CBRE, JLL, Cushman & Wakefield, Colliers, and Newmark.",
        value: "x",
      },
    ],
    null
  ).map((m) => m.name);
  assert.deepEqual(
    fiveItems.sort(),
    ["CBRE", "Cushman & Wakefield", "Colliers", "JLL", "Newmark"].sort()
  );
});

test("COMP7: the end-to-end literal ticket scenario -- CBRE and JLL, named together as incumbents in industry_structure/news_evidence prose with weak confidence -- both survive to Major Players with an explicit directional label, and Competitive Landscape stays honestly unvalidated (no fabricated direct-competitor status)", () => {
  const evidence = [
    baseEvidence({
      field: "industry_structure",
      claim:
        "The leading commercial real estate services firms are CBRE and JLL, reflecting rising platform concentration among incumbents.",
      value: "Incumbent concentration finding",
      sourceTitle: "Industry structure analysis",
      publisher: "Sector Analytics",
      url: "https://www.sectoranalytics.example/cbre-jll-concentration",
      confidence: 28,
      qualityScore: undefined,
    }),
    baseEvidence({
      field: "news_evidence",
      claim: "JLL was cited alongside CBRE as facing increased regulatory scrutiny of data practices in commercial real estate services.",
      value: "Regulatory scrutiny mention",
      sourceTitle: "Industry news coverage",
      publisher: "Trade Press",
      url: "https://www.tradepress.example/jll-scrutiny",
      confidence: 28,
      qualityScore: undefined,
    }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, creMarketPrompt);
  const names = graph.vendorIntelligence.adjacentPlayers.map((p) => p.name);
  assert.ok(names.includes("CBRE"), `CBRE must reach adjacentPlayers, got: ${JSON.stringify(names)}`);
  assert.ok(names.includes("JLL"), `JLL must reach adjacentPlayers, got: ${JSON.stringify(names)}`);
  assert.equal(graph.vendorIntelligence.vendors.length, 0, "the strict Competitive Landscape bar must remain unaffected -- this thin evidence must not fabricate a validated direct competitor");

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.match(projection.majorPlayers, /CBRE/);
  assert.match(projection.majorPlayers, /JLL/);
  assert.doesNotMatch(
    projection.competitiveLandscape,
    /CBRE.*validated|validated.*CBRE/is,
    "Competitive Landscape must never present this thin evidence as a validated direct competitor"
  );
});

// ===========================================================================
// 3. Duplicate content -- newline-spanning takeaway/body duplication
// ===========================================================================

test("DUP1: the exact diagnosed production shape -- a label-only first line ('**Answer:**', no sentence boundary of its own) with the real sentence on the NEXT line -- is now correctly detected and removed as a duplicate of the takeaway", () => {
  const content = [
    "**Answer:**",
    "Vendors are bundling integration services with core platform offerings to increase switching costs in mature markets.",
    "",
    "Additional detail: several vendors have also begun offering multi-year contracts with volume discounts.",
  ].join("\n");

  const takeaway = getSectionTakeaway(content);
  assert.match(takeaway, /Vendors are bundling integration services/, `takeaway must extract the real sentence, got: "${takeaway}"`);

  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.ok(!stripped.includes("**Answer:**"), "the label-only first line must be consumed, not left dangling");
  assert.ok(
    !/^Vendors are bundling integration services/.test(stripped.trim()),
    `the duplicated sentence must not remain as the new first line, got: "${stripped}"`
  );
  assert.match(stripped, /Additional detail: several vendors/, "genuinely different supporting detail must be fully preserved");
});

test("DUP2 (no regression): a label-only first line followed by a genuinely DIFFERENT sentence (not a duplicate of the takeaway) is left completely unchanged", () => {
  const content = [
    "**Note:**",
    "Regulatory filings do not yet reflect the most recent acquisition activity in this market.",
    "",
    "More detail follows in the next paragraph.",
  ].join("\n");
  const unrelatedTakeaway = "This is a completely unrelated takeaway sentence that never appears anywhere in this body text.";

  const stripped = stripLeadingTakeawaySentence(content, unrelatedTakeaway);
  assert.equal(stripped, content, "content must be returned byte-identical when the two-line span is not actually a duplicate");
});

test("DUP3 (no regression): a bulleted/numbered line immediately after a label-only first line is never treated as a continuation -- it begins its own separate list item", () => {
  const content = [
    "**Key Points:**",
    "1) Integration-first add-on products are becoming standard.",
    "2) Pricing bundles are consolidating across major vendors.",
  ].join("\n");
  const takeaway = "Integration-first add-on products are becoming standard.";

  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.equal(stripped, content, "a numbered next line must never be silently fused into the label line above it");
});

test("DUP4 (no regression): the existing single-line duplicate-detection path (unchanged by this fix) still works exactly as before", () => {
  const content =
    "**Integration-first bundling:** Vendors are bundling integration services with core platform offerings to increase switching costs.\n\nSeparately, several vendors have also begun offering multi-year contracts.";
  const takeaway = getSectionTakeaway(content);
  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.ok(!stripped.includes("Integration-first bundling"), "the single-line duplicate case must still be removed");
  assert.match(stripped, /Separately, several vendors/);
});
