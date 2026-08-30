import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  normalizePdfText,
  presentUnverifiedEvidenceStatus,
} from "../app/lib/pdf-normalization.mjs";

// TASK #27 -- Replace noisy "(unverified)" text with a premium
// decision-intelligence evidence-status presentation in the Market
// Intelligence PDF.
//
// TASK #27B -- Task #27's first implementation (replace 2+ repeated
// occurrences with a "*" reference mark per claim plus one shared
// footnote appended at the end of the text block) created two NEW real
// defects, both confirmed live in the same real persisted report:
//
// DEFECT 1: a text block with only ONE occurrence (Strategic
// Recommendations action 2) was left completely untouched by the old
// "only act on 2+" gate, so the raw literal "(unverified)" still reached
// the PDF -- violating Task #27's own unconditional acceptance criterion
// ("no raw '(unverified)' artifact remains in normal investor-facing
// prose"), not just its "avoid repetition" goal.
//
// DEFECT 2: across 9 real sections (Market Overview, Market Segmentation,
// Regional Analysis, Industry Trends, Major Players, Customer Segments,
// Market Drivers, Barriers, Threats), the bare "*" reference mark read as
// a disconnected, "dangling" artifact -- nothing about a lone asterisk
// mid-sentence visually ties it to an explanation that could be a full
// paragraph away, unlike a real footnote convention (which needs a
// visible, consistently-styled marker system to read as intentional).
//
// FIX: presentUnverifiedEvidenceStatus (pdf-normalization.mjs, the final
// step of normalizePdfText) replaces the split "mark + separate footnote"
// design entirely. Every occurrence of the label, in every supported
// language, is replaced IN PLACE, unconditionally (whether it's the only
// occurrence or one of many), with the SAME self-contained, professional
// phrase Task #27 introduced: "(Evidence status: Unverified)". No
// asterisk, no footnote, nothing that can ever end up looking
// "dangling" -- and no special-casing based on how many times the label
// appears, so both Task #27B defects are eliminated by construction, not
// by patching each symptom separately.

// --- G1. no raw "(unverified)" ever remains, regardless of occurrence count

test("G1a. a SINGLE occurrence (the exact Task #27B defect 1 shape -- Strategic Recommendations action 2) is fully replaced, not left as raw '(unverified)'", () => {
  const action =
    "Accuracy benchmarking engagement — Owner: Head of Product, Budget ceiling: USD 60,000; KPI: independent accuracy Market sources report (clause extraction & risk scoring) across 500 representative contracts; Success criterion: third-party Market sources demonstrating extraction quality (unverified).";
  const result = normalizePdfText(action);
  assert.doesNotMatch(result, /\(unverified\)/, "no raw '(unverified)' may survive, even for a lone occurrence");
  assert.match(result, /\(Evidence status: Unverified\)\.$/, "the single occurrence must still receive the professional inline label");
  assert.match(result, /Owner: Head of Product, Budget ceiling: USD 60,000/, "the complete action text must survive, untruncated");
});

test("G1b. multiple occurrences in the same text block each get their own inline label, unconditionally", () => {
  const content = "a (unverified). b (unverified). c (unverified). d clean.";
  const result = normalizePdfText(content);
  assert.doesNotMatch(result, /\(unverified\)/);
  const labelOccurrences = result.match(/\(Evidence status: Unverified\)/g) || [];
  assert.equal(labelOccurrences.length, 3, "all three original claims must each get their own label");
  assert.match(result, /^a \(Evidence status: Unverified\)\. b \(Evidence status: Unverified\)\. c \(Evidence status: Unverified\)\. d clean\.$/);
});

test("G1c. every supported report language is fully replaced, for a single occurrence too", () => {
  assert.equal(normalizePdfText("bir bulgu (doğrulanmamış)."), "bir bulgu (Kanıt durumu: Doğrulanmamış).");
  assert.equal(normalizePdfText("ein Befund (nicht verifiziert)."), "ein Befund (Evidenzstatus: Nicht verifiziert).");
  assert.equal(normalizePdfText("un constat (non vérifié)."), "un constat (État des preuves : non vérifié).");
  assert.equal(normalizePdfText("un hallazgo (no verificado)."), "un hallazgo (Estado de la evidencia: no verificado).");
});

// --- G2. no dangling standalone "*" markers can ever be produced ---------

test("G2a. STRUCTURAL AUDIT: the asterisk/footnote mechanism from Task #27's first attempt no longer exists in pdf-normalization.mjs", () => {
  const source = readFileSync(new URL("../app/lib/pdf-normalization.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /consolidateRepeatedUnverifiedEvidenceMarkers/, "the old asterisk+footnote function must be fully removed, not left as dead code");
  assert.match(source, /export function presentUnverifiedEvidenceStatus/);
  assert.match(source, /return presentUnverifiedEvidenceStatus\(preservePdfInlineTokens\(/, "the new function must be wired into normalizePdfText's own return path");
});

test("G2b. presentUnverifiedEvidenceStatus never introduces a bare '*' character anywhere in its output, for any input", () => {
  const inputs = [
    "a (unverified).",
    "a (unverified). b (unverified).",
    "a (unverified). b (unverified). c (unverified).",
    "no marker at all here.",
    "(unverified) at the very start of a sentence.",
    "a sentence ending right at the marker (unverified)",
  ];
  for (const input of inputs) {
    const result = presentUnverifiedEvidenceStatus(input);
    assert.doesNotMatch(result, /\*/, `unexpected "*" in output for input ${JSON.stringify(input)}: ${JSON.stringify(result)}`);
  }
});

test("G2c. real-report-shaped multi-claim section content (modeled on the 9 real sections Task #27B reported dangling asterisks in) produces zero '*' characters anywhere in the rendered PDF text", () => {
  const content =
    "Answer: U.S.-focused read only; direct U.S. evidence exists (Emergen Research U.S. CLM report, U.S. procurement price list, U.S. vendor pages) (unverified).\nCompared to Europe: no Europe-specific Market sources in the supplied registry; thus do not substitute.\nRegional strengths in the U.S.: procurement transparency via state contracts (DocuSign SC price list) and active commercial vendors publishing AI CLM features (Ironclad, Evisort, LawGeex) (unverified).\n(105 words)";
  const rendered = normalizePdfText(content);
  assert.doesNotMatch(rendered, /\*/, "no dangling reference mark of any kind may appear");
  assert.doesNotMatch(rendered, /\(unverified\)/);
  const labelOccurrences = rendered.match(/\(Evidence status: Unverified\)/g) || [];
  assert.equal(labelOccurrences.length, 2, "both real evidentiary gaps must each keep their own complete inline label");
});

// --- G3. idempotency (safe under the pipeline's own repeated normalization)

test("G3. re-normalizing already-labeled text (as the render pipeline does per-line during wrapping) is a safe no-op -- never double-labels, never re-triggers", () => {
  const content = "a (unverified). b (unverified).";
  const firstPass = normalizePdfText(content);
  const secondPass = normalizePdfText(firstPass);
  assert.equal(secondPass, firstPass);
  const perLineThirdPass = firstPass.split("\n").map((line) => normalizePdfText(line)).join("\n");
  assert.equal(perLineThirdPass, firstPass);
});

// --- G4. mixed verified/unverified claims: claim-level distinction -------

test("G4a. a section mixing verified (cited) claims and unresolved claims keeps the distinction: only unresolved claims get the evidence-status label, valid [R#] citations are completely unaffected", () => {
  const content =
    "1) Market-access validation is supported by state procurement data [R3].\n2) Accuracy benchmarking has no independent confirmation yet (unverified).\n3) Pilot commitments are backed by signed contracts [R4][R12].\n4) Channel partnership timing has no independent confirmation yet (unverified).";
  const result = normalizePdfText(content);

  assert.match(result, /\[R3\]/);
  assert.match(result, /\[R4\]\[R12\]/);
  assert.match(result, /Accuracy benchmarking has no independent confirmation yet \(Evidence status: Unverified\)\./);
  assert.match(result, /Channel partnership timing has no independent confirmation yet \(Evidence status: Unverified\)\./);
  assert.doesNotMatch(result, /\[R3\]\s*\(Evidence status/, "a verified, cited claim must never be labeled unverified");
  assert.doesNotMatch(result, /\[R4\]\[R12\]\s*\(Evidence status/, "a verified, cited claim must never be labeled unverified");
  const labelOccurrences = result.match(/\(Evidence status: Unverified\)/g) || [];
  assert.equal(labelOccurrences.length, 2, "exactly the two genuinely unresolved claims must be labeled, no more, no fewer");
});

test("G4b. a section with only ONE unresolved claim among several verified ones still gets the full professional label -- not left as raw text just because it is the only one", () => {
  const content =
    "1) Vendor pricing confirmed by public rate cards [R5].\n2) Compliance certification timeline has no independent confirmation yet (unverified).\n3) Deal size confirmed by signed contract [R6].";
  const result = normalizePdfText(content);
  assert.doesNotMatch(result, /\(unverified\)/);
  assert.match(result, /Compliance certification timeline has no independent confirmation yet \(Evidence status: Unverified\)\./);
  assert.match(result, /\[R5\]/);
  assert.match(result, /\[R6\]/);
});

// --- G5. no citation or truncation regressions ---------------------------

test("G5a. malformed citation cleanup (Task #25) and duplicate-adjacent collapse (Task #25/#25C) still run correctly before the new inline-label step", () => {
  const result = normalizePdfText("confident go/no-go [, R12]. a [Unverified reference][Unverified reference]. b [Unverified reference].");
  assert.doesNotMatch(result, /\[,\s*R12\]/, "malformed bracket cleanup must be unaffected");
  assert.match(result, /\[R12\]/);
  assert.doesNotMatch(result, /\[Unverified reference\]/);
  assert.doesNotMatch(result, /\(unverified\)/);
  const labelOccurrences = result.match(/\(Evidence status: Unverified\)/g) || [];
  assert.equal(labelOccurrences.length, 2, "the adjacent duplicate pair collapses to one label; the separate 'b' claim gets its own");
});

test("G5b. Strategic Recommendations action text with 2+ unresolved sub-claims in the SAME action still renders the complete action text, each sub-claim with its own inline label, never truncated", () => {
  const longAction =
    "Accuracy benchmarking engagement — Owner: Head of Product, Budget ceiling: USD 60,000; KPI: independent accuracy report demonstrating extraction quality (unverified); Success criterion: third-party validation confirming buyer-required accuracy thresholds within 90 days (unverified).";
  const result = normalizePdfText(longAction);
  assert.doesNotMatch(result, /\(unverified\)/);
  assert.match(result, /Owner: Head of Product, Budget ceiling: USD 60,000/, "the complete action text must survive, untruncated");
  assert.match(result, /extraction quality \(Evidence status: Unverified\);/);
  assert.match(result, /within 90\sdays \(Evidence status: Unverified\)\.$/);
});

test("G5c. an action with zero unresolved markers is completely unaffected by this task -- Task #26/#26B's boundary and truncation fixes remain in full effect", () => {
  const action =
    "6-account pilot commitments — Owner: Head of Commercial, Budget ceiling: USD 60,000 (sales support); KPI: signed pilot contracts with 6 U.S. mid-market customers across two verticals (target verticals: tech services and manufacturing); Success criterion: at least 3 pilots convert to paid contracts within 6 months or provide per-account annual revenue Market sources to validate SOM assumptions.";
  const result = normalizePdfText(action);
  assert.doesNotMatch(result, /Evidence status/);
  assert.match(result, /^6-account pilot commitments/);
  assert.match(result, /to validate SOM assumptions\.$/);
});

test("G5d. STRUCTURAL AUDIT: extractRecommendationItems' item count is untouched by this presentation-only change (Task #26/#26B parsing logic is not part of this file)", () => {
  const source = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
  assert.match(source, /function extractRecommendationItems/, "recommendation parsing must remain in ReportPdfButton.tsx, untouched by this PDF-presentation-only task");
});

// --- G6. real-persisted-report path verification -------------------------

test("G6. real-report-shaped Strategic Recommendations action 2 (the exact Task #27B defect 1) and the 9 real sections (the exact Task #27B defect 2) modeled on report id 4c0b5786-357c-4927-b7ff-3d38664b6495 both produce clean PDF text end to end", async () => {
  // Action 2 -- the exact single-occurrence shape that was left raw.
  const action2 =
    "Accuracy benchmarking engagement — Owner: Head of Product, Budget ceiling: USD 60,000; KPI: independent accuracy Market sources report (clause extraction & risk scoring) across 500 representative contracts; Success criterion: third-party Market sources demonstrating ≥90% extraction F1 or equivalent within 90 days (requirement driven by buyer expectations in vendor docs) (unverified).";
  const renderedAction2 = normalizePdfText(action2);
  assert.doesNotMatch(renderedAction2, /\(unverified\)/);
  assert.doesNotMatch(renderedAction2, /\*/);
  assert.match(renderedAction2, /\(Evidence status: Unverified\)\.$/);

  // Opportunities -- 3 flagged bullets, 1 unflagged, modeled on the real content.
  const opportunities =
    "1) Mid-market focused pricing and packaged compliance modules: registry shows enterprise vendors but limited mid-market pricing—opportunity to offer clear, procurement-friendly line-items for mid-sized firms (unverified).\n2) Vertical regulatory templates (healthcare, manufacturing): vendors emphasize use cases but verticalized compliance modules are less visible in public evidence (unverified).\n3) Public-sector supplier listing and buyable pricing: state procurement evidence (DocuSign SC) demonstrates a path to scale via public frameworks (unverified).\n4) Measurable accuracy benchmarking: few vendors publish independent accuracy metrics—providing third-party validated accuracy can be a differentiation.";
  const renderedOpportunities = normalizePdfText(opportunities);
  assert.doesNotMatch(renderedOpportunities, /\(unverified\)/);
  assert.doesNotMatch(renderedOpportunities, /\*/);
  assert.equal((renderedOpportunities.match(/\(Evidence status: Unverified\)/g) || []).length, 3);
  assert.match(renderedOpportunities, /Measurable accuracy benchmarking: few vendors publish independent accuracy metrics/, "the unflagged 4th opportunity must remain fully intact, with no label added");

  // Full recommendation-extraction + rendering path for all 4 real items.
  const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
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
  const pieces = [
    `const SENTENCE_ABBREVIATIONS = ${JSON.stringify([
      "U.S.", "U.K.", "U.N.", "E.U.", "U.A.E.", "e.g.", "i.e.", "etc.", "vs.", "cf.",
      "Inc.", "Corp.", "Ltd.", "Co.", "LLC.", "Dr.", "Mr.", "Mrs.", "Ms.", "Jr.", "Sr.",
      "St.", "Prof.", "Ph.D.", "a.m.", "p.m.", "No.", "approx.",
    ])};`,
    extractFunctionSource(pdfButtonSource, "isRecommendationHeadingLine"),
    extractFunctionSource(pdfButtonSource, "isMetadataOnlyRecommendationLine"),
    extractFunctionSource(pdfButtonSource, "isEvidenceStatusDisclaimerLine"),
    `export ${extractFunctionSource(pdfButtonSource, "extractRecommendationItems")}`,
  ].join("\n\n");
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task27b-"));
  const outPath = join(dir, "extractRecommendationItems.ts");
  writeFileSync(outPath, pieces);
  const mod = await import(pathToFileURL(outPath).href);

  const strategicRecommendations =
    "Recommendation: Enter (evidence supports entering with a validated mid-market penetration plan and procurement readiness; see R12, R4, R5, R3).\nConviction: Supported by growth forecasts and active vendor productization; key remaining uncertainty is SOM and realistic win rates.\nTrade-offs: Invest early in accuracy benchmarking and procurement qualification rather than broad enterprise feature parity.\nFirst 90 Days (three concrete actions): 1) Market-access validation — Owner: Head of Sales (U.S.\nmid-market), Budget ceiling: USD 80,000; KPI: number of qualified mid-market procurement channels secured (target = 3 state or national procurement frameworks or reseller agreements); Success criterion: at least one state procurement listing or one reseller agreement signed within 90 days (evidence path: state contract templates like R3).\n2) Accuracy benchmarking engagement — Owner: Head of Product, Budget ceiling: USD 60,000; KPI: independent accuracy Market sources report (clause extraction & risk scoring) across 500 representative contracts; Success criterion: third-party Market sources demonstrating ≥90% extraction F1 or equivalent within 90 days (requirement driven by buyer expectations in vendor docs) (unverified).\n3) 6-account pilot commitments — Owner: Head of Commercial, Budget ceiling: USD 60,000 (sales support); KPI: signed pilot contracts with 6 U.S.\nmid-market customers across two verticals (target verticals: tech services and manufacturing); Success criterion: at least 3 pilots convert to paid contracts within 6 months or provide per-account annual revenue Market sources to validate SOM assumptions.\nIf all three succeed, scale; if accuracy Market sources or procurement listing fails, re-evaluate and monitor instead.\n(174 words)";

  const items = mod.extractRecommendationItems(strategicRecommendations);
  assert.equal(items.length, 4, "Task #26/#26B's boundary fix and item count must remain unaffected by this presentation-only task");

  const renderedItems = items.map((item) => normalizePdfText(item));
  for (const rendered of renderedItems) {
    assert.doesNotMatch(rendered, /\(unverified\)/);
    assert.doesNotMatch(rendered, /\*/);
  }
  assert.ok(renderedItems.some((r) => /\(Evidence status: Unverified\)/.test(r)), "action 2's unresolved sub-claim must still receive the professional label");
  assert.match(renderedItems[0], /Head of Sales \(U\.S\. mid-market\), Budget ceiling: USD 80,000/, "action 1's boundary merge must remain correct");
  assert.match(renderedItems[2], /6 U\.S\. mid-market customers across two verticals/, "action 3's boundary merge must remain correct");
});
