import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
} from "../app/lib/ai/market-intelligence-graph.ts";
import {
  buildMarketIntelligenceCanonicalState,
  readMarketIntelligenceCanonicalState,
  resolveMarketIntelligenceSourcesForDisplay,
  isKnownCitationId,
  classifyStrategicRecommendationAction,
} from "../app/lib/report-engine/market-intelligence-canonical-state.ts";
import { stripReportPresentationArtifacts } from "../app/lib/report-engine/report-presentation-sanitizer.ts";

// TASK #34 -- Make Market Intelligence Sources & Citation Integrity
// production-grade and user-visible.
//
// ROOT CAUSE (confirmed via full trace of the citation-stripping
// pipeline): the sanitizer (stripReportPresentationArtifacts) already
// correctly strips every [R#] marker from report SECTION content, on
// all 4 render sites. But MarketIntelligenceCanonicalState's own
// narrative fields -- topRisks, topReasons, why, missingEvidence,
// whatWouldChangeThisDecision, immediateNextAction -- are persisted
// VERBATIM from the generation-time decision brief and are read
// DIRECTLY from report.metadata by every render site (Executive
// Summary's "Main Risk" tile, the PDF's Executive Decision card's "Top
// Risk"/"Immediate Next Action" fields, the cover page) -- completely
// bypassing the section sanitizer, since this text was never a
// "section". A real report's own topRisks legitimately contains
// "...models alone [R5][R39]." verbatim, so a raw "[R5][R39]"-shaped
// token could reach a rendered PDF even though every actual report
// SECTION was already clean.
//
// FIX: readMarketIntelligenceCanonicalState -- the single funnel every
// render site already goes through -- now sanitizes those narrative
// fields with the SAME stripReportPresentationArtifacts function, so a
// single fix retroactively cleans already-persisted reports on all 4
// surfaces at once. Structured, machine-readable data (decision,
// decisionCriticalEvidence, marketSizing.evidenceIds, cagr, competitors,
// citationSources) is untouched -- this never weakens or reconstructs
// provenance, since none of those structured fields ever held a
// rendered [R#] token to begin with. Separately, a real, structured
// Sources UI (resolveMarketIntelligenceSourcesForDisplay) now reads
// citationSources directly on all 4 surfaces -- deduplicated by real URL
// identity, an internal reference id never used as a display name --
// closing the "Sources section must become genuinely useful" gap.

const checkedAt = "2026-08-15T00:00:00.000Z";

function evidenceItem({ id, name, url, claim, label = "Verified from external source" }) {
  return {
    id,
    field: "market_size",
    claim: claim || `${name} evidence relevant to this market analysis.`,
    value: "supporting evidence",
    label,
    sourceTitle: `${name} source`,
    publisher: name,
    url,
    sourceType: "market research",
    authorityLevel: "secondary",
    confidence: 78,
    qualityScore: 78,
    publishedDate: "2026-02-10",
    lastChecked: checkedAt,
    supportingData: ["figures"],
  };
}

function decisionBriefFixture(overrides = {}) {
  return {
    decision: "CONDITIONAL_GO",
    confidence: 50,
    confidenceDirection: "reduced",
    confidenceFactors: ["verified market size unavailable"],
    why: "Evidence supports conditional entry pending SOM validation.",
    topReasons: ["Active vendor landscape", "Growing category"],
    topRisks: ["Incumbent concentration", "Procurement cycle length"],
    missingEvidence: ["Independent win-rate data"],
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
    immediateNextAction: "Run a mid-market pilot before committing budget.",
    ...overrides,
  };
}

function realGraphFixture() {
  const evidence = [
    evidenceItem({ id: "R3", name: "DocuSign", url: "https://procurement.sc.gov/docusign-clm" }),
    evidenceItem({ id: "R4", name: "Ironclad", url: "https://ironclad.com/pricing" }),
    evidenceItem({ id: "R5", name: "Evisort", url: "https://evisort.com/ai-engine" }),
    evidenceItem({
      id: "R12",
      name: "Emergen Research",
      url: "https://emergenresearch.com/clm-market",
      claim: "Market research report values the U.S. CLM software market at $1.5 billion.",
    }),
  ];
  return buildMarketIntelligenceGraph({ evidence }, "AI compliance & contract intelligence SaaS");
}

function canonicalStateWithMetadata(metadataOverrides = {}) {
  return {
    marketIntelligenceCanonicalState: buildMarketIntelligenceCanonicalState({
      graph: realGraphFixture(),
      decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
      decisionBrief: decisionBriefFixture(metadataOverrides),
    }),
  };
}

function readSourceFile(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const dashboardReportSource = readSourceFile("../app/dashboard/[id]/page.tsx");
const plannerSource = readSourceFile("../components/Planner.tsx");
const pdfButtonSource = readSourceFile("../app/dashboard/[id]/ReportPdfButton.tsx");

// --- A. Raw [R#] tokens never reach visible prose --------------------------

test("A. 'Major vendors are adding AI features [R21][R5]' -- visible prose contains no [R21] or [R5]", () => {
  const raw = "Major vendors are adding AI features [R21][R5].";
  const cleaned = stripReportPresentationArtifacts(raw);
  assert.doesNotMatch(cleaned, /\[R21\]/);
  assert.doesNotMatch(cleaned, /\[R5\]/);
  assert.doesNotMatch(cleaned, /\[R\d+\]/);
  // The residue-cleanup pass must also close the gap the bracket removal
  // itself opens (a lone space before the period), never leaving a
  // malformed fragment like "features ." behind.
  assert.doesNotMatch(cleaned, / \./);
  assert.match(cleaned, /Major vendors are adding AI features\.?/);
});

test("A2. the canonical-state read boundary strips [R#] from topRisks/topReasons/why/missingEvidence/whatWouldChangeThisDecision/immediateNextAction, on every render surface at once", () => {
  const metadata = canonicalStateWithMetadata({
    why: "Demand is increasing [R5].",
    topRisks: ["Incumbents may respond [R21][R5]."],
    topReasons: ["Active vendor landscape [R4]."],
    missingEvidence: ["Independent win-rate data [R999]."],
    whatWouldChangeThisDecision: "Validated SOM above 5% [R12] would upgrade this.",
    immediateNextAction: "Run a mid-market pilot [R3] before committing budget.",
  });
  const canonicalState = readMarketIntelligenceCanonicalState(metadata);
  assert.ok(canonicalState);

  for (const value of [
    canonicalState.why,
    ...canonicalState.topRisks,
    ...canonicalState.topReasons,
    ...canonicalState.missingEvidence,
    canonicalState.whatWouldChangeThisDecision,
    canonicalState.immediateNextAction,
  ]) {
    assert.doesNotMatch(value, /\[R\d+\]/, `raw citation marker leaked in: "${value}"`);
  }
});

// --- B. R21/R5 resolve to real sources -- structured provenance survives ---

test("B. when R4/R5 resolve to real sources, the structured claim -> source relationship survives even though the visible text no longer shows the marker", () => {
  const metadata = canonicalStateWithMetadata({
    topRisks: ["Incumbents may respond quickly to new entrants [R4][R5]."],
  });
  const canonicalState = readMarketIntelligenceCanonicalState(metadata);
  assert.ok(canonicalState);

  // Visible text is clean.
  assert.doesNotMatch(canonicalState.topRisks[0], /\[R4\]|\[R5\]/);

  // The underlying claim -> source relationship is still machine-readable:
  // R4 and R5 both genuinely resolve in the SAME canonical citation
  // registry this report persists -- the sanitizer only ever touched the
  // narrative TEXT, never citationSources itself.
  assert.equal(isKnownCitationId(canonicalState, "R4"), true);
  assert.equal(isKnownCitationId(canonicalState, "R5"), true);
  assert.ok(canonicalState.citationSources.some((source) => source.evidenceId === "R4"));
  assert.ok(canonicalState.citationSources.some((source) => source.evidenceId === "R5"));
});

// --- C. Unknown/dangling reference [R999] -----------------------------------

test("C. an unknown reference [R999] never appears as a raw token and never fabricates a source", () => {
  const metadata = canonicalStateWithMetadata({
    topRisks: ["An unresolved dependency creates risk [R999]."],
  });
  const canonicalState = readMarketIntelligenceCanonicalState(metadata);
  assert.ok(canonicalState);

  assert.doesNotMatch(canonicalState.topRisks[0], /\[R999\]/);
  assert.doesNotMatch(canonicalState.topRisks[0], /\[R\d+\]/);
  // No fabricated source was created for the dangling reference -- the
  // registry only ever contains the real sources this fixture built.
  assert.equal(isKnownCitationId(canonicalState, "R999"), false);
  assert.equal(canonicalState.citationSources.length, 4, "citationSources must be exactly the real, generated sources -- nothing invented");
});

// --- D. Executive Summary inherits a cited claim ----------------------------

test("D. Executive Summary's Main Risk tile (topRisks[0]) inherits a cited claim with the citation stripped, while the claim's OWN text/meaning is preserved", () => {
  const originalClaim = "Commoditization of core extraction features as LLM capability spreads [R5][R39].";
  const metadata = canonicalStateWithMetadata({ topRisks: [originalClaim] });
  const canonicalState = readMarketIntelligenceCanonicalState(metadata);
  assert.ok(canonicalState);

  const mainRisk = canonicalState.topRisks[0];
  assert.doesNotMatch(mainRisk, /\[R\d+\]/);
  // The claim's substantive content survives -- only the internal
  // reference tokens (and the whitespace they leave behind) are removed.
  assert.match(mainRisk, /Commoditization of core extraction features as LLM capability spreads/);
});

// --- E. PDF and web use the same citation/provenance source ----------------

test("E. web and PDF resolve the identical Sources list for the same canonical state -- the same pure function, never independent reconstruction", () => {
  const metadata = canonicalStateWithMetadata();
  const canonicalState = readMarketIntelligenceCanonicalState(metadata);
  const webSources = resolveMarketIntelligenceSourcesForDisplay(canonicalState);
  const pdfSources = resolveMarketIntelligenceSourcesForDisplay(canonicalState);
  assert.deepEqual(webSources, pdfSources);
  assert.ok(webSources.length > 0, "sanity check: this fixture must produce real sources");
});

// TASK #34 FOLLOW-UP -- Hide Sources from presentation while preserving
// provenance internally. Sources is now, once again, never rendered on
// any surface for any report kind (including Market Intelligence) --
// exactly the pre-Task-34 behavior, and exactly like every other report
// kind's Sources section, which was already filtered out everywhere via
// universalInternalOnlyFields. The structured citationSources registry
// and resolveMarketIntelligenceSourcesForDisplay itself are NOT deleted
// -- they remain fully defined, exported, and independently correct (see
// tests B, E, F, F2, F3 above, which call the function directly) -- only
// its render-site call sites are gone.

test("STRUCTURAL AUDIT (FOLLOW-UP): none of the 4 render sites call resolveMarketIntelligenceSourcesForDisplay -- Sources is not rendered anywhere", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    // No functional call site anywhere. A prose comment mentioning the
    // function's name (to explain why it was removed) never has an
    // opening paren immediately after the identifier, so this regex
    // only matches a real call expression.
    assert.doesNotMatch(
      source,
      /resolveMarketIntelligenceSourcesForDisplay\(/,
      `${name}: must not call resolveMarketIntelligenceSourcesForDisplay -- Sources must not be rendered`
    );
  }
});

test("STRUCTURAL AUDIT (FOLLOW-UP): none of the 4 render sites import resolveMarketIntelligenceSourcesForDisplay from the canonical-state module", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const importBlockMatch = source.match(
      /import\s*{([^}]*)}\s*from\s*"@\/app\/lib\/report-engine\/market-intelligence-canonical-state"/
    );
    assert.ok(importBlockMatch, `${name}: expected an import from market-intelligence-canonical-state`);
    assert.doesNotMatch(
      importBlockMatch[1],
      /resolveMarketIntelligenceSourcesForDisplay/,
      `${name}: must not import resolveMarketIntelligenceSourcesForDisplay`
    );
  }
});

test("STRUCTURAL AUDIT (FOLLOW-UP): no render site computes a Market-Intelligence-specific Sources display list any more", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(
      source,
      /marketIntelligenceDisplaySources|marketIntelligenceSourcesForPdf/,
      `${name}: must not compute a Market-Intelligence-specific Sources display list`
    );
  }
});

test("STRUCTURAL AUDIT (FOLLOW-UP): the underlying resolveMarketIntelligenceSourcesForDisplay function itself is still defined and exported -- only its render-site usage was removed, not the provenance architecture", () => {
  const canonicalStateSource = readSourceFile("../app/lib/report-engine/market-intelligence-canonical-state.ts");
  assert.match(canonicalStateSource, /export function resolveMarketIntelligenceSourcesForDisplay/);
});

test("STRUCTURAL AUDIT (FOLLOW-UP): Sources remains in the universal internal-only field list, so it is filtered out of every report kind's rendered sections identically to before Task #34", () => {
  const sanitizerSource = readSourceFile("../app/lib/report-engine/report-presentation-sanitizer.ts");
  const listMatch = sanitizerSource.match(
    /export const universalInternalOnlyFields: readonly string\[\] = \[([^\]]*)\]/
  );
  assert.ok(listMatch, "expected universalInternalOnlyFields to be defined");
  assert.match(listMatch[1], /"sources"/);
});

test("FOLLOW-UP: resolveMarketIntelligenceSourcesForDisplay still resolves the full, correct structured Sources list when called directly -- the provenance architecture works, it is simply not rendered", () => {
  const metadata = canonicalStateWithMetadata();
  const canonicalState = readMarketIntelligenceCanonicalState(metadata);
  const displaySources = resolveMarketIntelligenceSourcesForDisplay(canonicalState);
  assert.ok(displaySources.length > 0, "the function must still produce real, structured sources when invoked directly");
  for (const source of displaySources) {
    assert.ok(source.evidenceId, "each resolved source must retain its evidenceId internally");
    assert.doesNotMatch(source.displayName, /^R\d+$/, "internal reference ids must never become the display name");
  }
});

test("FOLLOW-UP: citationSources, decisionCriticalEvidence, and evidence classification remain fully populated on the canonical state even though Sources is not rendered", () => {
  const metadata = canonicalStateWithMetadata();
  const canonicalState = readMarketIntelligenceCanonicalState(metadata);
  assert.ok(canonicalState);
  assert.ok(canonicalState.citationSources.length > 0, "citationSources must remain populated internally");
  assert.ok(canonicalState.decisionCriticalEvidence, "decisionCriticalEvidence must remain populated internally");
  for (const source of canonicalState.citationSources) {
    assert.ok(source.evidenceId);
    assert.ok(source.url || source.sourceType, "each source must retain enough provenance to be independently auditable");
  }
});

test("FOLLOW-UP: isKnownCitationId and evidence-tie validation still work against the internal citationSources registry -- Executive Summary and Strategic Recommendations retain their internal evidence relationships", () => {
  const metadata = canonicalStateWithMetadata({
    topRisks: ["Incumbents may respond quickly to new entrants [R4][R5]."],
  });
  const canonicalState = readMarketIntelligenceCanonicalState(metadata);
  assert.equal(isKnownCitationId(canonicalState, "R4"), true);
  assert.equal(isKnownCitationId(canonicalState, "R5"), true);
  assert.equal(isKnownCitationId(canonicalState, "R999"), false);

  const evidenceTiedResult = classifyStrategicRecommendationAction({
    item: "Account Validation Sprint -- Owner: Head of Sales; Budget ceiling: $75,000.",
    signals: {
      budget: "$75,000",
      metric: "",
      timeframe: "",
      owner: "",
      gate: "",
      activity: "",
      evidenceTie: "Confirmed by [R4].",
    },
    canonicalState,
  });
  assert.equal(evidenceTiedResult.numericBasis, "evidence");
});

test("STRUCTURAL AUDIT: ReportPdfButton.tsx now also calls sanitizeMarketIntelligencePresentationText, closing the prior web/PDF asymmetry", () => {
  assert.match(pdfButtonSource, /sanitizeMarketIntelligencePresentationText,/);
  assert.match(pdfButtonSource, /sanitizeMarketIntelligencePresentationText\(rawSectionBodyContent\)/);
});

// --- F. Duplicate references to the same URL/source are deduplicated ------

test("F. two citationSources entries pointing to the same (normalized) URL are deduplicated into one display entry", () => {
  const graph = realGraphFixture();
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph: {
      ...graph,
      sources: [
        ...graph.sources,
        {
          evidenceId: "R50",
          title: "Ironclad Pricing (duplicate)",
          publisher: "Ironclad",
          url: "https://www.ironclad.com/pricing/", // same document as R4's https://ironclad.com/pricing, just www + trailing slash
          publishedDate: "2026-02-10",
          accessedAt: "2026-08-15T00:00:00.000Z",
          sourceType: "market research",
          confidenceClassification: "Verified",
          confidenceScore: 78,
          confidenceLevel: "High",
          claim: "Duplicate pricing evidence.",
        },
      ],
    },
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture(),
  });

  const ironcladEntries = canonicalState.citationSources.filter((source) => source.url.includes("ironclad.com/pricing"));
  assert.equal(ironcladEntries.length, 2, "sanity check: the persisted registry itself keeps both raw entries");

  const displaySources = resolveMarketIntelligenceSourcesForDisplay(canonicalState);
  const displayedIroncladEntries = displaySources.filter((source) => source.url.includes("ironclad.com/pricing"));
  assert.equal(displayedIroncladEntries.length, 1, "the DISPLAY list must deduplicate the same document to one entry");
});

test("F2. a source with no parseable URL is never deduplicated away just because another source also has no URL", () => {
  const graph = realGraphFixture();
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph: {
      ...graph,
      sources: [
        ...graph.sources,
        {
          evidenceId: "R60",
          title: "Internal Analyst Note A",
          publisher: "",
          url: "",
          publishedDate: "",
          accessedAt: "",
          sourceType: "internal_estimate",
          confidenceClassification: "Estimated",
          confidenceScore: 50,
          confidenceLevel: "Medium",
          claim: "First no-URL note.",
        },
        {
          evidenceId: "R61",
          title: "Internal Analyst Note B",
          publisher: "",
          url: "",
          publishedDate: "",
          accessedAt: "",
          sourceType: "internal_estimate",
          confidenceClassification: "Estimated",
          confidenceScore: 50,
          confidenceLevel: "Medium",
          claim: "Second no-URL note.",
        },
      ],
    },
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture(),
  });

  const displaySources = resolveMarketIntelligenceSourcesForDisplay(canonicalState);
  assert.ok(displaySources.some((source) => source.evidenceId === "R60"));
  assert.ok(displaySources.some((source) => source.evidenceId === "R61"));
});

test("F3. a source's display name never uses the internal reference id (\"R21\"-shaped) as the primary name -- falls back through title/publisher/domain", () => {
  const graph = realGraphFixture();
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph: {
      ...graph,
      sources: [
        ...graph.sources,
        {
          evidenceId: "R70",
          title: "",
          publisher: "",
          url: "https://example-research.com/report",
          publishedDate: "",
          accessedAt: "",
          sourceType: "market research",
          confidenceClassification: "Estimated",
          confidenceScore: 55,
          confidenceLevel: "Medium",
          claim: "No title or publisher, only a URL.",
        },
      ],
    },
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture(),
  });

  const displaySources = resolveMarketIntelligenceSourcesForDisplay(canonicalState);
  const entry = displaySources.find((source) => source.evidenceId === "R70");
  assert.ok(entry);
  assert.notEqual(entry.displayName, "R70");
  assert.doesNotMatch(entry.displayName, /^R\d+$/);
  assert.equal(entry.displayName, "example-research.com");
});

// --- G. Citation cleanup does not change the canonical decision ------------

test("G. citation-marker cleanup never changes the canonical MONITOR/ENTER/AVOID decision or its confidence", () => {
  for (const decision of ["GO", "CONDITIONAL_GO", "NO_GO"]) {
    const metadata = canonicalStateWithMetadata({
      decision,
      confidence: 50,
      topRisks: ["A risk statement with a citation marker [R5][R39]."],
    });
    const canonicalState = readMarketIntelligenceCanonicalState(metadata);
    assert.ok(canonicalState);
    assert.equal(canonicalState.decision, decision);
    assert.equal(canonicalState.confidence, 50);
  }
});

// --- H. Planning assumptions remain assumptions adjacent to a citation ----

test("H. a recommendation's numeric fields remain a planning assumption even when the SAME action text sits adjacent to a genuinely cited claim elsewhere in the report", () => {
  const metadata = canonicalStateWithMetadata({
    why: "Demand is increasing, supported by vendor filings [R4][R5].",
  });
  const canonicalState = readMarketIntelligenceCanonicalState(metadata);
  assert.ok(canonicalState);
  // Sanity: the report DOES have real, cited evidence elsewhere.
  assert.doesNotMatch(canonicalState.why, /\[R\d+\]/);
  assert.ok(canonicalState.citationSources.length > 0);

  // The recommendation's own evidenceTie is purely descriptive
  // (no citation marker at all) -- it must stay a planning assumption
  // regardless of how much real, cited evidence exists elsewhere in the
  // SAME report.
  const result = classifyStrategicRecommendationAction({
    item: "Account Validation Sprint -- Owner: Head of Sales; Budget ceiling: $75,000.",
    signals: {
      budget: "$75,000",
      metric: "",
      timeframe: "",
      owner: "",
      gate: "",
      activity: "",
      evidenceTie: "signed SOWs and pilot KPIs",
    },
    canonicalState,
  });
  assert.equal(result.numericBasis, "planning_assumption");
});

// --- Real report fixture (171cf10d-538a-4ad3-9ed9-b30e85914e85) -----------
// --- verbatim topRisks content, reused from prior tasks' own fixtures -----

const REAL_CANONICAL_TOP_RISKS = [
  "Commoditization of core extraction features as LLM capability spreads, pushing competition to services and integrations rather than models alone [R5][R39].",
  "CRM and signature platforms bundling CLM into ecosystems (DocuSign, Salesforce partners) could marginalize pure-play entrants [R3][R74].",
  "Regulatory scrutiny or requirements for AI explainability could raise compliance costs and slow deployments [R92][R10].",
];

test("REAL PERSISTED REPORT (171cf10d-538a-4ad3-9ed9-b30e85914e85): the report's own real, verbatim topRisks text -- which legitimately carries [R5][R39]/[R3][R74]/[R92][R10] -- is fully clean of raw citation markers once read through the canonical-state boundary", () => {
  const metadata = canonicalStateWithMetadata({
    confidence: 50,
    topRisks: REAL_CANONICAL_TOP_RISKS,
  });
  const canonicalState = readMarketIntelligenceCanonicalState(metadata);
  assert.ok(canonicalState);

  for (const risk of canonicalState.topRisks) {
    assert.doesNotMatch(risk, /\[R\d+\]/, `raw citation marker leaked in real report risk text: "${risk}"`);
  }
  // The real risk statements' own substantive content must still be
  // fully present -- only the bracketed reference tokens are gone.
  assert.match(canonicalState.topRisks[0], /Commoditization of core extraction features/);
  assert.match(canonicalState.topRisks[1], /CRM and signature platforms bundling CLM/);
  assert.match(canonicalState.topRisks[2], /Regulatory scrutiny or requirements for AI explainability/);

  // Canonical decision (MONITOR / CONDITIONAL_GO, confidence 50) is
  // completely unaffected by the citation cleanup.
  assert.equal(canonicalState.decision, "CONDITIONAL_GO");
  assert.equal(canonicalState.confidence, 50);
});
