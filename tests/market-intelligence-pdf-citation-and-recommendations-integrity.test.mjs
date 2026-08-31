import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  sanitizeCitationBracketSyntax,
  collapseAdjacentDuplicateCitationMarkers,
  neutralizeUnverifiableEvidenceReferences,
  assertNoOrphanEvidenceReferences,
} from "../app/lib/report-engine/evidence-reference-integrity.ts";
import { normalizePdfText } from "../app/lib/pdf-normalization.mjs";
import { buildMarketIntelligenceGraph } from "../app/lib/ai/market-intelligence-graph.ts";
import { SENTENCE_ABBREVIATIONS } from "../app/lib/report-presentation.ts";
import {
  buildMarketIntelligenceCanonicalState,
  resolveMarketIntelligenceExecutiveDecisionWithCanonicalState,
} from "../app/lib/report-engine/market-intelligence-canonical-state.ts";

// TASK #25 -- Harden Market Intelligence PDF citation integrity and
// recommendation completeness.
//
// ROOT CAUSE 1 (citation integrity): confirmed live across 14+ real
// persisted reports' own "barriers" field, and one real report's
// strategicRecommendations field:
//  (a) The model itself sometimes writes a malformed citation bracket
//      like "[, R12]" -- a leading empty entry before a real reference
//      number. evidenceReferencePattern/bibliographyReferencePattern
//      both require "[R<digits>]" with nothing else inside the brackets,
//      so this was completely invisible to every existing citation-
//      integrity check (orphan detection, bibliography linking) -- not
//      merely a display glitch, a structural blind spot.
//  (b) neutralizeUnverifiableEvidenceReferences (Task #22) replaced each
//      [R#] independently, so a claim that originally cited multiple
//      references adjacently (e.g. "...[R5][R6].") produced
//      "[Unverified reference][Unverified reference]" for what a reader
//      experiences as ONE evidentiary gap, not two.
//
// ROOT CAUSE 2 (recommendation completeness): ReportPdfButton.tsx and
// Planner.tsx both additionally capped Strategic Recommendations'
// visual-card rendering at `.slice(0, 4)`, on top of
// extractRecommendationItems' own already-shared, already-generous
// 8-item ceiling (identical between web and PDF). Since
// strategicRecommendations is registered in pdfCompleteVisualFields, the
// section's raw prose is NEVER also drawn as a fallback -- the capped
// card grid was the ONLY rendering of this section's content the PDF
// ever produced, so items 5+ were not merely unstyled, they were
// completely absent from the PDF while the web view (with no such
// second cap) correctly showed all of them.

const checkedAt = "2026-08-15T00:00:00.000Z";

function evidenceItem({ id, name, url, claim }) {
  return {
    id,
    field: "market_size",
    claim: claim || `${name} evidence relevant to this market analysis.`,
    value: "supporting evidence",
    label: "Verified from external source",
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

// --- A1. malformed "[, R12]" cleanup ----------------------------------------

test("A1a. sanitizeCitationBracketSyntax normalizes the exact confirmed real defect '[, R12]' to the standard '[R12]'", () => {
  const realBarriersExcerpt =
    "1) SOM / penetration uncertainty — no defensible obtainable-share evidence in registry; this is the single largest strategic barrier to confident go/no-go [, R12].";
  const result = sanitizeCitationBracketSyntax(realBarriersExcerpt);
  assert.doesNotMatch(result, /\[,\s*R12\]/);
  assert.match(result, /\[R12\]/);
  assert.match(result, /confident go\/no-go \[R12\]\.$/);
});

test("A1b. normalizePdfText (the render-time counterpart) fixes the same defect for already-persisted reports", () => {
  const result = normalizePdfText("confident go/no-go [, R12].");
  assert.equal(result, "confident go/no-go [R12].");
});

test("A1c. a multi-reference malformed bracket normalizes to standard one-reference-per-bracket tags", () => {
  assert.equal(sanitizeCitationBracketSyntax("see [R3, R12] for detail."), "see [R3][R12] for detail.");
  assert.equal(sanitizeCitationBracketSyntax("double comma [R3,, R12]."), "double comma [R3][R12].");
  assert.equal(sanitizeCitationBracketSyntax("trailing comma [R12, ]."), "trailing comma [R12].");
});

test("A1d. a genuinely empty citation group (comma/whitespace only, no reference at all) is removed entirely, never fabricated", () => {
  assert.equal(sanitizeCitationBracketSyntax("empty group [,] end."), "empty group end.");
  assert.equal(sanitizeCitationBracketSyntax("empty group [ , ] end."), "empty group end.");
  assert.equal(normalizePdfText("empty group [,] end."), "empty group end.");
});

test("A1e. a bracket with 'R' but no valid R<digits> token resolves to nothing real, so it is removed -- never guessed or fabricated into a reference that was never written", () => {
  assert.equal(sanitizeCitationBracketSyntax("odd bracket [R] end."), "odd bracket end.");
  assert.doesNotMatch(sanitizeCitationBracketSyntax("odd bracket [R] end.") || "", /\[R\]/);
});

test("A1f. unrelated non-citation brackets are never touched", () => {
  assert.equal(sanitizeCitationBracketSyntax("tagged [Estimated] figure."), "tagged [Estimated] figure.");
  assert.equal(sanitizeCitationBracketSyntax("tagged [Verified from official source] figure."), "tagged [Verified from official source] figure.");
  assert.equal(sanitizeCitationBracketSyntax("a bare number [12] reference."), "a bare number [12] reference.");
  assert.equal(sanitizeCitationBracketSyntax(undefined), undefined);
  assert.equal(sanitizeCitationBracketSyntax(""), "");
});

// --- A2. repeated "[Unverified reference]" cleanup --------------------------

test("A2a. neutralizeUnverifiableEvidenceReferences (root cause) never creates adjacent duplicates for a claim that cited multiple references", () => {
  const sections = {
    strategicRecommendations:
      "Success criterion: third-party report demonstrating extraction accuracy (requirement driven by buyer expectations in vendor docs) [R5][R6].",
  };
  const result = neutralizeUnverifiableEvidenceReferences(sections, "English");
  const tokens = result.strategicRecommendations.match(/\(unverified\)/g) || [];
  assert.equal(tokens.length, 1, "one claim citing 2 references must produce exactly ONE unverified marker, not two");
  assert.doesNotMatch(result.strategicRecommendations, /\[R\d+\]/);
  // TASK #25C -- the label itself must never reach the reader as raw
  // bracketed technical placeholder syntax.
  assert.doesNotMatch(result.strategicRecommendations, /\[Unverified reference\]/);
});

test("A2b. collapseAdjacentDuplicateCitationMarkers (render-time counterpart) cleans up an already-persisted report's existing duplicate", () => {
  const realExcerpt =
    "Success criterion: third-party Market sources demonstrating ≥90% extraction F1 or equivalent within 90 days (requirement driven by buyer expectations in vendor docs) [Unverified reference][Unverified reference].";
  const result = collapseAdjacentDuplicateCitationMarkers(realExcerpt);
  const tokens = result.match(/\[Unverified reference\]/g) || [];
  assert.equal(tokens.length, 1);
});

test("A2c. normalizePdfText also collapses the duplicate at PDF render time, for any language's label, and for a whitespace-separated duplicate too -- then restyles the surviving marker into its clean, professional, unbracketed investor-facing form (TASK #27B: no asterisk/footnote, one self-contained inline label)", () => {
  assert.match(
    normalizePdfText("gap noted [Unverified reference][Unverified reference]."),
    /^gap noted \(Evidence status: Unverified\)\.$/
  );
  assert.match(
    normalizePdfText("gap noted [Doğrulanamayan referans][Doğrulanamayan referans]."),
    /^gap noted \(Kanıt durumu: Doğrulanmamış\)\.$/
  );
  assert.match(
    normalizePdfText("gap noted [Unverified reference] [Unverified reference]."),
    /^gap noted \(Evidence status: Unverified\)\.$/
  );
  assert.match(
    normalizePdfText("triple [Unverified reference][Unverified reference][Unverified reference]."),
    /^triple \(Evidence status: Unverified\)\.$/
  );
});

test("A2d. non-adjacent mentions of the same label (genuinely two separate evidentiary gaps) are NOT merged into one claim's text -- TASK #27B: no asterisk, no dangling mark; TASK #28: with no citation anywhere, both collapse into one section-level disclosure instead of two identical inline copies", () => {
  const result = normalizePdfText(
    "First gap [Unverified reference]. Unrelated sentence in between. Second gap [Unverified reference]."
  );
  // Two textually-separated evidentiary gaps are two DIFFERENT claims and
  // their own TEXT must never be merged into one sentence -- confirmed by
  // "First gap" and "Second gap" surviving as distinct, unmodified
  // sentences. Task #27's first attempt at deduplicating this shape
  // produced a "dangling" bare "*" in real reports (see Task #27B); this
  // field has no [R#]/bare-R#/[Verified] citation anywhere, so Task #28's
  // consolidation now applies -- the repeated label is replaced by one
  // freestanding, self-contained section-level sentence (not a mark
  // referring back to either claim), so that defect cannot recur either.
  assert.match(result, /First gap\. Unrelated sentence in between\. Second gap\./, "both claims survive as distinct, unmerged sentences");
  assert.equal(
    (result.match(/\(Evidence status: Unverified\)/g) || []).length,
    0,
    "no per-claim label survives once consolidated"
  );
  assert.match(result, /Evidence note: Some claims require independent validation\.$/);
  assert.doesNotMatch(result, /\*/, "no asterisk/reference-mark mechanism may be used");
  assert.doesNotMatch(result, /\(unverified\)/i, "the raw lowercase label text must not survive");
  assert.doesNotMatch(result, /\[Unverified reference\]/);
});

test("A2d2. non-adjacent mentions of the same label, WITH a citation present in the field, each keep their own complete inline label", () => {
  const result = normalizePdfText(
    "First gap [Unverified reference]. A cited claim [R9]. Second gap [Unverified reference]."
  );
  const labelOccurrences = result.match(/\(Evidence status: Unverified\)/g) || [];
  assert.equal(labelOccurrences.length, 2, "two textually-separated evidentiary gaps must each keep their own complete inline label when the field also cites a real source");
  assert.match(result, /First gap \(Evidence status: Unverified\)\./, "the first claim's own label must stay attached to it");
  assert.match(result, /Second gap \(Evidence status: Unverified\)\./, "the second claim's own label must stay attached to it");
  assert.match(result, /\[R9\]/);
  assert.doesNotMatch(result, /\*/, "no asterisk/reference-mark mechanism may be used");
  assert.doesNotMatch(result, /\(unverified\)/i, "the raw lowercase label text must not survive");
});

// --- A5. "[Unverified reference]" investor-facing epistemic treatment -------

test("A5a. normalizePdfText restyles every language's raw bracketed unverified-reference label into a clean, professional, self-contained inline label (TASK #27B), without touching valid [R#] references", () => {
  assert.equal(normalizePdfText("driven by vendor docs [Unverified reference]."), "driven by vendor docs (Evidence status: Unverified).");
  assert.equal(normalizePdfText("bir bulgu [Doğrulanamayan referans]."), "bir bulgu (Kanıt durumu: Doğrulanmamış).");
  assert.equal(normalizePdfText("ein Befund [Nicht verifizierbarer Verweis]."), "ein Befund (Evidenzstatus: Nicht verifiziert).");
  assert.equal(normalizePdfText("un constat [Référence non vérifiable]."), "un constat (État des preuves : non vérifié).");
  assert.equal(normalizePdfText("un hallazgo [Referencia no verificable]."), "un hallazgo (Estado de la evidencia: no verificado).");
  assert.equal(normalizePdfText("named vendors [R4][R5]."), "named vendors [R4][R5].");
});

test("A5b. neutralizeUnverifiableEvidenceReferences (generation time) now writes the clean, unbracketed form directly for every supported language", () => {
  const sections = { barriers: "a claim with no source [R7]." };
  assert.equal(neutralizeUnverifiableEvidenceReferences(sections, "English").barriers, "a claim with no source (unverified).");
  assert.equal(neutralizeUnverifiableEvidenceReferences(sections, "Turkish").barriers, "a claim with no source (doğrulanmamış).");
});

// --- A3. valid citation preservation -----------------------------------------

test("A3a. valid, distinct, adjacent citations are never collapsed or altered", () => {
  assert.equal(sanitizeCitationBracketSyntax("named vendors [R4][R5][R39]."), "named vendors [R4][R5][R39].");
  assert.equal(collapseAdjacentDuplicateCitationMarkers("named vendors [R4][R5][R39]."), "named vendors [R4][R5][R39].");
  assert.equal(normalizePdfText("named vendors [R4][R5][R39]."), "named vendors [R4][R5][R39].");
});

test("A3b. a genuine, intentional double-citation of the SAME real reference number is treated like any other identical-token duplicate (collapsed), never mistaken for a malformed group", () => {
  // Distinct from the "[R3, R12]" malformed-multi-ref case: two SEPARATE,
  // already-well-formed [R12] tags placed adjacently.
  assert.equal(collapseAdjacentDuplicateCitationMarkers("see it twice [R12][R12]."), "see it twice [R12].");
});

test("A3c. the real graph's orphan-reference check still fires correctly on already-sanitized text -- Task #22's protections are not weakened", () => {
  const graph = realGraphFixture();
  const sanitized = sanitizeCitationBracketSyntax("confident go/no-go [, R12].");
  // R12 is a real, citable evidence id in this fixture -- must NOT be
  // flagged as an orphan once normalized to the standard shape.
  assert.doesNotThrow(() =>
    assertNoOrphanEvidenceReferences({ barriers: sanitized }, graph.citableEvidenceIds)
  );
  // A genuinely hallucinated id, even after normalization, is still
  // correctly caught as an orphan -- sanitizing syntax never launders a
  // fabricated reference into a trusted one.
  const sanitizedHallucination = sanitizeCitationBracketSyntax("unsupported claim [, R999].");
  assert.throws(() =>
    assertNoOrphanEvidenceReferences({ barriers: sanitizedHallucination }, graph.citableEvidenceIds)
  );
});

// --- A4. no fabricated references --------------------------------------------

test("A4a. sanitizeCitationBracketSyntax never invents a reference number that was not actually written", () => {
  assert.doesNotMatch(sanitizeCitationBracketSyntax("odd bracket [R] end.") || "", /\[R\d*\]/);
  assert.equal(sanitizeCitationBracketSyntax("just a comma [,]."), "just a comma .");
});

test("A4b. neutralization + sanitization together never produce a fabricated, resolvable-looking citation from a genuinely empty group", () => {
  const sections = { barriers: "no evidence at all [,]." };
  const sanitized = sanitizeCitationBracketSyntax(sections.barriers);
  const neutralized = neutralizeUnverifiableEvidenceReferences({ barriers: sanitized }, "English");
  assert.doesNotMatch(neutralized.barriers, /\[R\d+\]/);
  assert.doesNotMatch(neutralized.barriers, /\(unverified\)/, "an empty group was never a citation attempt at all -- it must not gain an unverified marker either");
});

// --- B. Strategic Recommendations completeness ------------------------------

function extractFunctionSource(source, functionName) {
  const startMatch = source.match(new RegExp(`function ${functionName}\\(`));
  assert.ok(startMatch, `${functionName} not found`);
  const start = startMatch.index;
  let i = start + startMatch[0].length - 1;
  let parenDepth = 1;
  while (parenDepth > 0) {
    i += 1;
    if (source[i] === "(") parenDepth += 1;
    else if (source[i] === ")") parenDepth -= 1;
  }
  while (source[i] !== "{") i += 1;
  let braceDepth = 0;
  do {
    if (source[i] === "{") braceDepth += 1;
    else if (source[i] === "}") braceDepth -= 1;
    i += 1;
  } while (braceDepth > 0);
  return source.slice(start, i);
}

async function compileExtractRecommendationItems(source) {
  // TASK #29J -- these functions now live solely in report-presentation.ts;
  // `source` (the calling surface's own file) is accepted for the
  // caller's own labeling/looping but no longer used for extraction.
  void source;
  const pieces = [
    `const SENTENCE_ABBREVIATIONS = ${JSON.stringify(SENTENCE_ABBREVIATIONS)};`,
    extractFunctionSource(reportPresentationSource, "isRecommendationHeadingLine"),
    extractFunctionSource(reportPresentationSource, "isMetadataOnlyRecommendationLine"),
    extractFunctionSource(reportPresentationSource, "isEvidenceStatusDisclaimerLine"),
    `export ${extractFunctionSource(reportPresentationSource, "extractRecommendationItems")}`,
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "zerinix-recommendation-items-"));
  const outPath = join(dir, "extractRecommendationItems.ts");
  writeFileSync(outPath, pieces);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractRecommendationItems;
}

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
// TASK #29J -- isRecommendationHeadingLine/isMetadataOnlyRecommendationLine/
// isEvidenceStatusDisclaimerLine/extractRecommendationItems were
// consolidated into this single shared module.
const reportPresentationSource = readFileSync(new URL("../app/lib/report-presentation.ts", import.meta.url), "utf8");

function sixActionRecommendations() {
  return [
    "Recommendation: Enter (evidence supports entering with a validated mid-market penetration plan).",
    "Conviction: Supported by growth forecasts and active vendor productization.",
    "Trade-offs: Invest early in accuracy benchmarking.",
    "First 90 Days (six concrete actions): 1) Market-access validation — Owner: Head of Sales, Budget ceiling: USD 80,000; KPI: qualified procurement channels; Success criterion: one listing signed within 90 days.",
    "2) Accuracy benchmarking engagement — Owner: Head of Product, Budget ceiling: USD 60,000; KPI: independent accuracy report; Success criterion: 90% extraction F1 within 90 days.",
    "3) 6-account pilot commitments — Owner: Head of Commercial, Budget ceiling: USD 60,000; KPI: signed pilot contracts; Success criterion: 3 pilots convert within 6 months.",
    "4) Channel partnership exploration — Owner: Head of BD, Budget ceiling: USD 40,000; KPI: signed reseller agreements; Success criterion: 1 reseller signed within 90 days.",
    "5) Compliance certification pursuit — Owner: Head of Legal, Budget ceiling: USD 30,000; KPI: certification progress; Success criterion: audit scheduled within 90 days.",
    "6) Customer advisory board formation — Owner: Head of Product, Budget ceiling: USD 20,000; KPI: board members recruited; Success criterion: 5 members onboarded within 90 days.",
  ].join("\n");
}

test("B1. all 3 files' extractRecommendationItems returns exactly 6 items for a real 6-action persisted report -- none dropped", async () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(sixActionRecommendations());
    assert.equal(items.length, 6, `${name}: expected all 6 actions to survive extraction`);
    assert.match(items[0], /Market-access validation/);
    assert.match(items[5], /Customer advisory board formation/);
  }
});

test("B2. STRUCTURAL AUDIT: no PDF-only '.slice(0, 4)' cap remains on top of extractRecommendationItems in either PDF-drawing file", () => {
  for (const [name, source] of [
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(
      source,
      /extractRecommendationItems\([^)]*\)\.slice\(0,\s*4\)/,
      `${name}: a PDF-only 4-item cap must not be reintroduced on top of extractRecommendationItems`
    );
  }
});

test("B3. the height-prediction pass and the actual drawing pass count the SAME item list in both PDF files (no cap mismatch that would corrupt pagination)", () => {
  // TASK #25C -- Strategic Recommendations' height-prediction and drawing
  // logic were merged into ONE dedicated, self-contained pagination
  // branch per file (see that branch's own comment for why), so there is
  // now exactly ONE extractRecommendationItems(...) call site for PDF
  // purposes: ReportPdfButton.tsx (PDF-only) has just that one; Planner.tsx
  // has that one plus its pre-existing, legitimate, never-capped web card
  // grid call site (PremiumSectionVisual) -- both must read the full,
  // uncapped extractRecommendationItems(...) result directly, with zero
  // `.slice` suffix anywhere, and there is no longer a separate
  // height-prediction call site to duplicate/drift from the drawing one.
  const expectedCallSiteCount = { "Planner.tsx": 2, "ReportPdfButton.tsx": 1 };
  for (const [name, source] of [
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const occurrences = source.match(/const items = extractRecommendationItems\([^)]*\);/g) || [];
    assert.equal(occurrences.length, expectedCallSiteCount[name], `${name}: unexpected call-site count`);
  }
});

test("B4. variable-length recommendation arrays (3, 5, 7 actions) are not truncated, up to the shared ceiling -- no hardcoded '6'", async () => {
  const extractRecommendationItems = await compileExtractRecommendationItems(pdfButtonSource);
  for (const count of [3, 5, 7]) {
    const lines = Array.from({ length: count }, (_, i) => `${i + 1}) Action number ${i + 1} — Owner: Team ${i + 1}, Budget ceiling: USD 10,000; KPI: metric ${i + 1}; Success criterion: done within 90 days.`);
    const content = ["Recommendation: Enter.", "First days:", ...lines].join("\n");
    const items = extractRecommendationItems(content);
    assert.equal(items.length, count, `expected exactly ${count} items to survive, none dropped, none duplicated`);
  }
});

test("B5. an 8-item recommendation list (at the shared, pre-existing ceiling) still returns all 8 -- the ceiling is unchanged, not raised or hidden", async () => {
  const extractRecommendationItems = await compileExtractRecommendationItems(pdfButtonSource);
  const lines = Array.from({ length: 8 }, (_, i) => `${i + 1}) Action number ${i + 1} — Owner: Team ${i + 1}, Budget ceiling: USD 10,000; KPI: metric ${i + 1}; Success criterion: done within 90 days.`);
  const content = ["Recommendation: Enter.", "First days:", ...lines].join("\n");
  const items = extractRecommendationItems(content);
  assert.equal(items.length, 8);
});

test("B6. computeRecommendationRowHeights (the row-layout function feeding both height-prediction and drawing) is generic over item count -- Math.ceil-based row count, not a hardcoded row limit", () => {
  for (const [name, source] of [
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(
      source,
      /Math\.ceil\(cards\.length \/ 2\)/,
      `${name}: computeRecommendationRowHeights must compute row count generically from the real item count`
    );
  }
});

// --- C. canonical MONITOR decision from Task #24 remains unchanged ---------

test("C1. canonical MONITOR decision resolution is completely untouched by Task #25's citation/recommendation fixes", () => {
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: {
      decision: "CONDITIONAL_GO",
      confidence: 58,
      confidenceDirection: "reduced",
      confidenceFactors: ["obtainable share not evidence-derived"],
      why: "Evidence supports conditional entry pending SOM validation.",
      topReasons: ["Active vendor landscape"],
      topRisks: ["Incumbent concentration"],
      missingEvidence: ["Independent win-rate data"],
      whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
      immediateNextAction: "Run a mid-market pilot before committing budget.",
    },
  });

  const conflictingProse = "Bottom Line — Decision: ENTER the U.S. market (Confidence: 95%).";
  const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(canonicalState, conflictingProse, "English");

  assert.equal(resolved.decisionLabel, "MONITOR");
  assert.equal(resolved.decisionSource, "canonical-state");
  assert.equal(resolved.confidenceScore, 58);
});

test("C2. STRUCTURAL AUDIT: no bare resolveMarketIntelligenceExecutiveDecision( call sites were reintroduced by this task in any of the 3 files", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const bareMatches = source.match(/resolveMarketIntelligenceExecutiveDecision\(/g) || [];
    assert.equal(bareMatches.length, 0, `${name}: expected zero bare resolveMarketIntelligenceExecutiveDecision( call sites`);
  }
});

// --- D. TASK #25C -- no ellipsis-based clipping of recommendation action
// text, and row-level pagination for card grids that exceed one page ------

test("D1. STRUCTURAL AUDIT: computeRecommendationCardLayout's action-text line array is never passed through truncatePdfCellLines in either PDF file", () => {
  // Confirmed live (manual PDF inspection): a hardcoded 2-line cap here
  // silently ellipsized real action text whenever a recommendation's
  // actual sentence needed more room -- exactly what Task #25's own
  // requirement forbids ("do not silently truncate content to make it
  // fit"). computeRecommendationCardLayout's own height calculation is
  // already fully derived from actionLines.length, so the ONLY thing
  // that could still clip real text is a leftover truncatePdfCellLines(
  // ..., 2) wrapped around it -- this must never come back.
  for (const [name, source] of [
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const layoutFnSource = extractFunctionSource(
      source.replace(
        /const computeRecommendationCardLayout = \(item: string, cardWidth: number\) => \{/,
        "function computeRecommendationCardLayout(item, cardWidth) {"
      ),
      "computeRecommendationCardLayout"
    );
    assert.doesNotMatch(
      layoutFnSource,
      /truncatePdfCellLines/,
      `${name}: computeRecommendationCardLayout must never truncate/ellipsize its own action-text line array`
    );
    assert.match(
      layoutFnSource,
      /actionLines\.length \* 3\.3/,
      `${name}: card height must still be derived directly from the real (uncapped) actionLines.length`
    );
  }
});

test("D2. STRUCTURAL AUDIT: Strategic Recommendations has its own dedicated row-pagination branch in both PDF files, capable of starting a fresh 'continued' card instead of overflowing a single page", () => {
  for (const [name, source] of [
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(
      source,
      /TASK #25C -- Strategic Recommendations gets its own dedicated/,
      `${name}: expected the dedicated Strategic Recommendations pagination branch`
    );
    assert.match(
      source,
      /rowsInChunk/,
      `${name}: expected row-chunking pagination state (rowsInChunk) for Strategic Recommendations`
    );
    // A single pathologically tall row must still get its own page rather
    // than the loop looping forever trying to find a chunk that fits.
    assert.match(
      source,
      /rowsInChunk > 0 && candidateCardHeight > maxUsableCardHeight/,
      `${name}: expected the "always keep at least one row per chunk" safety guard`
    );
  }
});

test("D3. STRUCTURAL AUDIT: the old single-call, non-paginating Strategic Recommendations branches were removed from the generic visual dispatch (drawSectionVisual/getVisualHeight in ReportPdfButton.tsx, drawPdfVisual/getPdfVisualHeight in Planner.tsx), not merely duplicated alongside the new branch", () => {
  for (const [name, source] of [
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    // The old branches both drew the card grid via a bare
    // `cards.forEach(({ gate, actionLines, fields }, index) => {` with no
    // row-chunk/page-break awareness -- this exact shape must appear
    // exactly once now (inside the new branch only), not twice.
    const oldShapeMatches = source.match(/cards\.forEach\(\(\{ gate, actionLines, fields \}, index\) => \{/g) || [];
    assert.equal(
      oldShapeMatches.length,
      0,
      `${name}: the old non-paginating per-card forEach shape must not remain -- the new branch uses cards.slice(...).forEach with row-chunk-relative indices instead`
    );
  }
});
