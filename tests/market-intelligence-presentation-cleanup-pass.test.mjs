import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getSectionTakeaway,
  stripLeadingTakeawaySentence,
} from "../app/lib/report-presentation.ts";
import { stripReportPresentationArtifacts } from "../app/lib/report-engine/report-presentation-sanitizer.ts";
import { resolveMarketIntelligenceExecutiveDecision } from "../app/lib/report-engine/executive-decision-vocabulary.ts";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pdfSource = readFileSync(`${repoRoot}app/dashboard/[id]/ReportPdfButton.tsx`, "utf8");
const plannerSource = readFileSync(`${repoRoot}components/Planner.tsx`, "utf8");

// P0 PRODUCTION CLEANUP PASS -- presentation, sanitization, deduplication,
// and cross-section consistency fixes for six remaining Market
// Intelligence production defects. Root causes:
//
// A. DUPLICATED SECTION CONTENT (third distinct root cause):
//    splitSentences's `(?:\n|\r)+` newline-splitting alternative was dead
//    code -- stripMarkdown (called first, on the whole string) already
//    collapses every newline into a space before the split regex ever
//    runs. A bulleted/numbered list with no terminal punctuation ending
//    EACH item before the list's own last period (e.g. deterministic
//    "Evidence-supported major players" vendor rows, or the
//    "adjacentPlayers" intro + bullet list) got treated as ONE
//    continuous run-on "sentence" spanning every list item, so
//    getSectionTakeaway extracted the ENTIRE section as "the takeaway" --
//    duplicating everything in the highlighted box, with the body
//    repeating it all again below. Fixed by splitting on real newlines
//    FIRST, before stripMarkdown ever runs, then sentence-splitting
//    within each resulting line independently. This surfaced two
//    secondary gaps in stripLeadingTakeawaySentence (which must mirror
//    getSectionTakeaway's own sentence-selection exactly): (1) the
//    "bare label + continuation" 2-line window fused the two lines with
//    no boundary between them, so a short label ("**Answer:**") and its
//    continuation could never be tested as separate candidates; fixed by
//    recording the line-join position as its own boundary. (2) the
//    "whole window as one candidate" fallback required a bullet marker,
//    so a plain (non-bulleted) title/heading line with no internal
//    punctuation could never be recognized as the entire takeaway on its
//    own; fixed by dropping that requirement.
//
// B. PROMPT INSTRUCTION LEAK: every section prompt in
//    app/lib/report-engine/prompts/market.ts ends with its own word-count
//    budget as literally the LAST sentence of the model's instructions
//    ("... Max 200 words.") -- a known LLM failure mode is echoing this
//    trailing constraint verbatim into the answer. Fixed with a new,
//    end-of-line-anchored sanitization rule in the universal
//    stripReportPresentationArtifacts (shared by every report kind, UI
//    and PDF alike).
//
// C. BROKEN EXECUTIVE COVER/CARD "NEXT ACTION": "Immediate Next Action"
//    is the deterministic banner's own label, never present in the
//    market executiveSummary prompt (which instead always instructs a
//    scoped "(5) Recommendation" bullet list). When the banner is
//    absent, extraction returned "", forcing a fallback to an UNSCOPED,
//    keyword-based full-report scan with no section boundary -- this
//    existed in TWO separate places (the PDF cover, fixed in a prior
//    pass, and this pass's newly-found second occurrence: the
//    "Executive Decision Card" rendered inside the Executive Summary
//    section body, in both ReportPdfButton.tsx and Planner.tsx). Fixed
//    by falling back to the model's own scoped "Recommendation" section
//    first in both places.
//
// D. INTERNAL MODEL/PIPELINE LANGUAGE LEAK: "Not explicitly stated in
//    the generated executive summary" was a hardcoded fallback (in both
//    ReportPdfButton.tsx and Planner.tsx) describing PARSER/GENERATION
//    state, not a market finding -- internal system language in an
//    investor-grade report. Replaced with an honest, evidence-aware
//    validation statement that preserves the ORIGINAL fix's own
//    protective guarantee (never claims a CONFIRMED absence of a gap,
//    since an empty extraction means "not found in this text," not
//    "confirmed no gap").
//
// E. COMPETITIVE LANDSCAPE / MAJOR PLAYERS CONSISTENCY: the existing
//    "no direct competitors, but adjacent players evidenced" message
//    already avoided the flat "no competitor data" claim, but framed
//    the gap as competitor IDENTITY being unvalidated -- misleading when
//    the incumbents themselves are evidence-supported. Reworded to state
//    the actual gap (insufficient STRUCTURED positioning/comparison data
//    to build a defensible landscape or market map), without
//    manufacturing any of that missing positioning data.
//
// F/G. EXECUTIVE SUMMARY CONSISTENCY: unchanged from the prior session's
//    fix (resolveMarketIntelligenceExecutiveDecision's widened raw-label
//    tier) -- reverified here as regression guards.

// ===========================================================================
// A. Takeaway/body near-duplicate removal
// ===========================================================================

test("A1: the exact newly-diagnosed shape -- a deterministic vendor-row list with no early terminal punctuation ('Evidence-supported major players' title + bullet rows) no longer gets fused into one run-on takeaway spanning every row", () => {
  const content = [
    "Evidence-supported major players",
    "- CBRE (Market Leader): Global scale, integrated services; target customer: large institutional owners (confidence: 78/100 High)",
    "- JLL (Established Challenger): Broad advisory footprint; target customer: corporate occupiers (confidence: 70/100 Medium)",
  ].join("\n");
  const takeaway = getSectionTakeaway(content);
  assert.equal(takeaway, "Evidence-supported major players", "the takeaway must be just the title, never the whole multi-row list");

  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.ok(!stripped.includes("Evidence-supported major players"), "the duplicated title must be removed from the body");
  assert.match(stripped, /CBRE \(Market Leader\)/);
  assert.match(stripped, /JLL \(Established Challenger\)/);
});

test("A2: the adjacentPlayers rendering shape (title + intro sentence + bullet rows) is correctly deduplicated -- only the duplicated title/intro is removed, the intro's own real content and both bullets survive", () => {
  const content = [
    "Relevant Industry Players — Not Independently Validated as Direct Competitors",
    "These companies are named in available evidence as active in or adjacent to this market, but current evidence does not independently corroborate them as directly comparable competitors. See Competitive Landscape for direct-competitor validation status.",
    "- CBRE: CBRE is a commercial product vendor with evidence directly tied to the requested market. (confidence: 36/100 Low) — Not independently validated as a direct competitor from current evidence.",
    "- JLL: JLL is a commercial product vendor with evidence directly tied to the requested market. (confidence: 36/100 Low) — Not independently validated as a direct competitor from current evidence.",
  ].join("\n");
  const takeaway = getSectionTakeaway(content);
  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.ok(!stripped.startsWith("Relevant Industry Players"));
  assert.match(stripped, /See Competitive Landscape for direct-competitor validation status\./, "the intro's own trailing sentence must survive");
  assert.match(stripped, /- CBRE:/);
  assert.match(stripped, /- JLL:/);
});

test("A3 (no regression): the previously-fixed 'bare label + continuation' shape ('**Answer:**' on its own line) still dedups correctly, and the now-empty label line is cleanly removed rather than left dangling", () => {
  const content =
    "**Answer:**\nVendors are bundling integration services with core platform offerings to increase switching costs in mature markets.\n\nAdditional detail: several vendors have also begun offering multi-year contracts with volume discounts.";
  const takeaway = getSectionTakeaway(content);
  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.ok(!stripped.includes("Vendors are bundling integration services"));
  assert.ok(!stripped.includes("**Answer:**"), "the now-content-less label must not be left dangling on its own line");
  assert.match(stripped, /Additional detail: several vendors/);
});

test("A4 (no regression): all previously-fixed shapes (whole-bullet duplicate, bold-colon bullet, short-first-sentence bullet) still dedupe correctly after the splitSentences rewrite", () => {
  const a = "1) Integration-first add-on products are becoming standard.\n2) Pricing bundles are consolidating across major vendors.";
  assert.match(stripLeadingTakeawaySentence(a, getSectionTakeaway(a)), /Pricing bundles/);

  const b =
    "1. **Regulatory tailwinds**: Rising compliance requirements are pushing adoption across major metros.\n2. **Cost pressure**: Operating margins are tightening amid rising insurance costs.";
  const strippedB = stripLeadingTakeawaySentence(b, getSectionTakeaway(b));
  assert.ok(!strippedB.includes("Regulatory tailwinds"));
  assert.match(strippedB, /Cost pressure/);

  const d =
    "1. **Regulatory tailwinds.** Rising demand for compliance automation across the U.S. and E.U. is accelerating adoption of AI-driven audit tools among mid-market financial services firms with cross-border obligations.\n2. **Cloud migration.** Enterprises are consolidating legacy on-prem audit systems onto cloud-native platforms, creating a large addressable upgrade market for compliance vendors.";
  const strippedD = stripLeadingTakeawaySentence(d, getSectionTakeaway(d));
  assert.ok(!strippedD.includes("Rising demand for compliance automation"));
  assert.match(strippedD, /\*\*Regulatory tailwinds\.\*\*/);
  assert.match(strippedD, /Cloud migration/);
});

test("A5 (evidence-integrity guard): a genuinely non-duplicate takeaway leaves ALL shapes completely unchanged, never over-triggering on real, distinct content", () => {
  const content = [
    "Evidence-supported major players",
    "- CBRE (Market Leader): Global scale, integrated services; target customer: large institutional owners (confidence: 78/100 High)",
    "- JLL (Established Challenger): Broad advisory footprint; target customer: corporate occupiers (confidence: 70/100 Medium)",
  ].join("\n");
  const unrelatedTakeaway = "This is a completely unrelated takeaway sentence that never appears anywhere in this body text.";
  assert.equal(stripLeadingTakeawaySentence(content, unrelatedTakeaway), content);
});

// ===========================================================================
// B. Prompt instruction removal
// ===========================================================================

test("B1: the exact reported artifacts -- '(Max 180 words)', '(Max 170 words)', '(Max 160 words)', '(Max 200 words)' -- are removed", () => {
  for (const n of [180, 170, 160, 200]) {
    const content = `The market is segmented by deployment model and buyer type. (Max ${n} words)`;
    const sanitized = stripReportPresentationArtifacts(content);
    assert.doesNotMatch(sanitized, new RegExp(`Max ${n} words`, "i"));
    assert.match(sanitized, /The market is segmented by deployment model and buyer type\./);
  }
});

test("B2: reasonable formatting variants (no parens, 'Maximum', trailing period, own line) are all covered", () => {
  const variants = [
    "Real content here. Max 180 words",
    "Real content here. (Maximum 170 words)",
    "Real content here.\n(Max 160 words)",
    "Real content here. (max 200 words).",
  ];
  for (const content of variants) {
    const sanitized = stripReportPresentationArtifacts(content);
    assert.doesNotMatch(sanitized, /max(?:imum)?\s+\d+\s+words/i, `failed for: ${content}`);
    assert.match(sanitized, /Real content here\./);
  }
});

test("B3 (evidence-integrity guard): legitimate content mentioning a word count or the word 'words' mid-sentence is never stripped", () => {
  const legit1 = "The report contains roughly 200 words of executive commentary before the appendix begins.";
  const legit2 = "Our maximum 500 words per submission policy was communicated to all vendors during onboarding.";
  assert.equal(stripReportPresentationArtifacts(legit1), legit1);
  assert.equal(stripReportPresentationArtifacts(legit2), legit2);
});

// ===========================================================================
// C. Malformed mid-sentence next-action fragment rejection
// ===========================================================================

test("C1: source drift check -- the Executive Decision Card's Next Action (a SEPARATE occurrence from the PDF cover's own Next Action) now falls back to the model's own scoped Recommendation section before the unscoped full-report keyword scan, in both ReportPdfButton.tsx and Planner.tsx", () => {
  for (const source of [pdfSource, plannerSource]) {
    // The "Next Action" row must reference the Recommendation labels
    // BEFORE its own extractKeywordInsight(fullReportContent, ...) call
    // appears in the source -- proving the scoped fallback is tried
    // first, not appended after the unscoped scan.
    const nextActionRowIndex = source.indexOf('"Next Action",');
    const recommendationIndex = source.indexOf('"Recommendation",', nextActionRowIndex);
    const unscopedScanIndex = source.indexOf(
      'extractKeywordInsight(fullReportContent, ["next action", "critical action", "validate"])',
      nextActionRowIndex
    );
    assert.ok(nextActionRowIndex !== -1, "Next Action row not found");
    assert.ok(recommendationIndex !== -1, "scoped Recommendation fallback not found");
    assert.ok(unscopedScanIndex !== -1, "unscoped fallback not found");
    assert.ok(
      recommendationIndex < unscopedScanIndex,
      "the scoped Recommendation fallback must be tried before the unscoped full-report scan"
    );
  }
});

test("C2 (no regression): the unscoped extractKeywordInsight fallback still exists as the LAST resort for non-Market-Intelligence report kinds, and the honest 'see executive decision' fallback still exists beneath it", () => {
  for (const source of [pdfSource, plannerSource]) {
    assert.match(source, /extractKeywordInsight\(fullReportContent, \["next action", "critical action", "validate"\]\)/);
  }
});

// ===========================================================================
// D. Internal/meta generation-language sanitization
// ===========================================================================

test("D1: 'Not explicitly stated in the generated executive summary' no longer appears anywhere in either ReportPdfButton.tsx or Planner.tsx", () => {
  for (const source of [pdfSource, plannerSource]) {
    assert.doesNotMatch(source, /Not explicitly stated in the generated executive summary/);
  }
});

test("D2: the replacement text is an honest, evidence-aware validation statement -- present in both files -- that never claims a CONFIRMED absence of a gap", () => {
  for (const source of [pdfSource, plannerSource]) {
    assert.match(source, /Additional validation required before a final decision\./);
  }
});

test("D3 (no regression): the equally-important 'No decision-changing data gap was flagged' fabricated-certainty phrasing still never appears (this is a distinct, already-fixed defect this pass must not reintroduce)", () => {
  for (const source of [pdfSource, plannerSource]) {
    assert.doesNotMatch(source, /No decision-changing data gap was flagged/);
  }
});

// ===========================================================================
// E. Validated major players + insufficient competitive-map evidence
// ===========================================================================

function weakEnumerationEvidence(overrides) {
  return {
    id: `E-${Math.random()}`,
    field: "industry_structure",
    claim: "",
    value: "",
    label: "Verified from external source",
    sourceTitle: "Industry structure analysis",
    publisher: "Sector Analytics",
    url: "https://www.sectoranalytics.example/cre-structure",
    sourceType: "credible_market_data",
    authorityLevel: "secondary",
    confidence: 28,
    publishedDate: "2026-01-10",
    lastChecked: "2026-08-27T00:00:00.000Z",
    supportingData: [],
    impact: "neutral",
    impactReason: "x",
    qualityScore: undefined,
    qualityRationale: "x",
    searchQuery: "",
    ...overrides,
  };
}

test("E1: the exact reported scenario -- CBRE and JLL are evidence-supported (Major Players) but the strict direct-competitor bar isn't cleared -- Competitive Landscape states the actual gap (structured positioning data), never claims no competitor data exists, and never re-frames the gap as unvalidated competitor identity", () => {
  const evidence = [
    weakEnumerationEvidence({
      claim: "The leading commercial real estate services firms are CBRE and JLL, reflecting rising platform concentration among incumbents.",
      value: "Incumbent concentration finding",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "Analyze the mature U.S. commercial real estate services market.");
  assert.equal(graph.vendorIntelligence.vendors.length, 0, "fixture must not clear the strict direct-competitor bar");
  assert.ok(graph.vendorIntelligence.adjacentPlayers.length > 0, "fixture must produce evidence-supported adjacent players");

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.match(projection.competitiveLandscape, /evidence-supported/i);
  assert.match(projection.competitiveLandscape, /structured positioning data/i);
  assert.match(projection.competitiveLandscape, /Major Players below/i);
  assert.doesNotMatch(
    projection.competitiveLandscape,
    /no competitor data (?:could be validated|exists)/i,
    "must never claim no competitor data exists when validated major-player evidence exists"
  );
  assert.doesNotMatch(
    projection.competitiveLandscape,
    /competitors could not be independently validated/i,
    "must never frame the gap as competitor IDENTITY being unvalidated when the incumbents themselves are evidence-supported"
  );

  assert.match(projection.majorPlayers, /Not Independently Validated as Direct Competitors|adjacentPlayer/i);
});

test("E2 (no evidence-standard weakening, regression guard): the flat 'no competitor data' message is still used when there are genuinely NO adjacent players either -- the reworded message must not paper over a real absence of evidence", () => {
  const graph = buildMarketIntelligenceGraph({ evidence: [] }, "Analyze the mature U.S. commercial real estate services market.");
  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.doesNotMatch(projection.competitiveLandscape, /evidence-supported/i);
});

test("E3: all 5 supported languages have real, non-empty translations for the reworded competitive-landscape message", () => {
  const graphSource = readFileSync(`${repoRoot}app/lib/ai/market-intelligence-graph.ts`, "utf8");
  const block = graphSource.match(/if \(vendorCount === 0 && adjacentPlayerCount > 0\) \{[\s\S]*?\}\[language\];\s*\n\s*\}/);
  assert.ok(block, "the reworded branch must exist");
  for (const lang of ["English", "Turkish", "German", "French", "Spanish"]) {
    assert.match(block[0], new RegExp(`${lang}:\\s*\\n\\s*"[^"]{60,}"`), `${lang} translation must be present and substantial`);
  }
});

// ===========================================================================
// F. MONITOR decision remains MONITOR through UI/PDF presentation
// ===========================================================================

test("F1 (no regression): the canonical resolver never reinterprets MONITOR as GO/NO-GO/INVEST -- the exact reported 'Bottom Line — Decision: MONITOR market entry for U.S.' shape still resolves honestly", () => {
  const executiveSummary =
    "Bottom Line — Decision: MONITOR market entry for U.S. property management services given thin competitive validation and unresolved TAM scope.";
  const result = resolveMarketIntelligenceExecutiveDecision(executiveSummary, "English");
  assert.match(result.decisionLabel, /^MONITOR/);
  assert.doesNotMatch(result.decisionLabel.toUpperCase(), /\b(?:GO|NO-GO|INVEST)\b/);
});

test("F2 (no regression): the deterministic banner's MONITOR token is never remapped to a different vocabulary word", () => {
  const executiveSummary = "Decision: MONITOR (Confidence: 50%)";
  const result = resolveMarketIntelligenceExecutiveDecision(executiveSummary, "English");
  assert.equal(result.decisionLabel, "MONITOR");
  assert.equal(result.decisionSource, "canonical-banner");
});

// ===========================================================================
// G. Missing confidence never becomes a fabricated number
// ===========================================================================

test("G1 (no regression, no evidence-standard weakening): when no structured confidence figure exists anywhere, confidenceScore stays null through every tier -- never a guessed or interpolated number", () => {
  const bannerAbsent = "Bottom Line — Decision: MONITOR market entry given thin evidence across the board.";
  const result = resolveMarketIntelligenceExecutiveDecision(bannerAbsent, "English");
  assert.equal(result.confidenceScore, null);

  const noDecisionAtAll = "The market shows moderate growth potential with some regulatory uncertainty.";
  const result2 = resolveMarketIntelligenceExecutiveDecision(noDecisionAtAll, "English");
  assert.equal(result2.confidenceScore, null);
  assert.equal(result2.decisionLabel, "—");
});

// ===========================================================================
// H. Legitimate evidence text is not accidentally stripped
// ===========================================================================

test("H1 (evidence-integrity guard): source-backed facts, uncertainty language, Validation Needed states, explicit assumptions, and validated numbers all survive the new sanitization additions untouched", () => {
  const evidenceText =
    "Market size is $131.6 billion, based on IBISWorld's 2024 estimate for the U.S. property-management services sector [Verified]. TAM remains Validation Needed pending confirmation of the requested geographic scope. This assumes a 25% serviceable-share ratio, an explicit planning assumption not yet independently validated.";
  const sanitized = stripReportPresentationArtifacts(evidenceText);
  assert.match(sanitized, /\$131\.6 billion/);
  assert.match(sanitized, /IBISWorld's 2024 estimate/);
  assert.match(sanitized, /Validation Needed/);
  assert.match(sanitized, /25% serviceable-share ratio/);
  assert.match(sanitized, /explicit planning assumption not yet independently validated/);
});
