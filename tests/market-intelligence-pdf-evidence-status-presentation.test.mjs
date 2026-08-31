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

test("G1a. a SINGLE occurrence (the exact Task #27B defect 1 shape -- Strategic Recommendations action 2) is fully replaced, not left as raw '(unverified)' (TASK #28B: recommendation prose now moves even a single occurrence to the compact note, per the exact live Action 2 defect)", () => {
  const action =
    "Accuracy benchmarking engagement — Owner: Head of Product, Budget ceiling: USD 60,000; KPI: independent accuracy Market sources report (clause extraction & risk scoring) across 500 representative contracts; Success criterion: third-party Market sources demonstrating extraction quality (unverified).";
  const result = normalizePdfText(action);
  assert.doesNotMatch(result, /\(unverified\)/i, "no raw '(unverified)' may survive, even for a lone occurrence");
  assert.doesNotMatch(result, /\(Evidence status: Unverified\)/, "recommendation prose must never carry the inline metadata marker, even for a lone occurrence");
  assert.match(result, /Owner: Head of Product, Budget ceiling: USD 60,000/, "the complete action text must survive, untruncated");
  assert.match(result, /Evidence note: Some claims require independent validation\.$/, "the uncertainty is still disclosed, via the compact shared note");
});

test("G1b. multiple occurrences with no resolved citation anywhere collapse into one section-level disclosure (TASK #28)", () => {
  // TASK #28 -- superseded by consolidateRepeatedEvidenceStatusLabels:
  // a field with 2+ occurrences of the same label and no [R#]/bare-R#/
  // [Verified] citation anywhere has nothing left to distinguish between
  // claims, so the repeated label is collapsed into one disclosure
  // instead of repeating verbatim after every claim. See G4a below for
  // the case where a citation IS present -- there, per-claim labels are
  // still left completely untouched.
  const content = "a (unverified). b (unverified). c (unverified). d clean.";
  const result = normalizePdfText(content);
  assert.doesNotMatch(result, /\(unverified\)/i);
  assert.equal((result.match(/\(Evidence status: Unverified\)/g) || []).length, 0, "no per-claim label survives once consolidated");
  assert.match(result, /^a\. b\. c\. d clean\./, "all four original claims survive, only the repeated label text is removed");
  assert.match(result, /Evidence note: Some claims require independent validation\.$/);
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
  // TASK #28 -- normalizePdfText's return chain now also wraps
  // consolidateRepeatedEvidenceStatusLabels around presentUnverifiedEvidenceStatus's
  // own output; the exact wiring shape changed, but presentUnverifiedEvidenceStatus
  // itself is still the function actually applying the per-marker label.
  assert.match(
    source,
    /return consolidateRepeatedEvidenceStatusLabels\(presentUnverifiedEvidenceStatus\(preservePdfInlineTokens\(/,
    "presentUnverifiedEvidenceStatus must still be wired into normalizePdfText's own return path"
  );
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
  assert.doesNotMatch(rendered, /\(unverified\)/i);
  // TASK #28 -- this field has no [R#]/bare-R#/[Verified] citation
  // anywhere, so its 2 repeated labels now collapse into one
  // section-level disclosure instead of staying inline twice.
  const labelOccurrences = rendered.match(/\(Evidence status: Unverified\)/g) || [];
  assert.equal(labelOccurrences.length, 0, "no per-claim label survives once consolidated");
  assert.match(rendered, /Evidence note: Some claims require independent validation\.$/);
  assert.match(rendered, /procurement transparency via state contracts/, "the real prose must survive intact");
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

test("G5b. Strategic Recommendations action text with 2+ unresolved sub-claims in the SAME action still renders the complete action text, never truncated (TASK #28: consolidated into one card-level disclosure since the action has no citation of its own)", () => {
  const longAction =
    "Accuracy benchmarking engagement — Owner: Head of Product, Budget ceiling: USD 60,000; KPI: independent accuracy report demonstrating extraction quality (unverified); Success criterion: third-party validation confirming buyer-required accuracy thresholds within 90 days (unverified).";
  const result = normalizePdfText(longAction);
  assert.doesNotMatch(result, /\(unverified\)/i);
  assert.match(result, /Owner: Head of Product, Budget ceiling: USD 60,000/, "the complete action text must survive, untruncated");
  assert.match(result, /extraction quality;/, "the sub-claim text survives, only its label is removed");
  assert.match(result, /within 90\sdays\./, "the second sub-claim text survives, only its label is removed");
  assert.equal((result.match(/\(Evidence status: Unverified\)/g) || []).length, 0, "no per-claim label survives once consolidated");
  assert.match(result, /Evidence note: Some claims require independent validation\.$/);
});

test("G5b2. an action mixing an unresolved sub-claim with its OWN citation keeps the per-claim label instead of consolidating", () => {
  const longAction =
    "Accuracy benchmarking engagement — KPI: independent accuracy report demonstrating extraction quality (unverified); Success criterion: confirmed by prior study [R7] and third-party validation within 90 days (unverified).";
  const result = normalizePdfText(longAction);
  assert.equal((result.match(/\(Evidence status: Unverified\)/g) || []).length, 2, "both per-claim labels must remain since the action cites [R7]");
  assert.match(result, /\[R7\]/);
  assert.doesNotMatch(result, /Evidence status: several claims|Evidence note: Some claims require independent validation/);
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
  // TASK #29J -- extractRecommendationItems was consolidated into
  // app/lib/report-presentation.ts (the single shared source of truth);
  // ReportPdfButton.tsx now imports it rather than defining its own copy
  // -- the parsing logic itself is unchanged, only its location moved.
  assert.match(source, /\bextractRecommendationItems\b[\s\S]{0,700}from "@\/app\/lib\/report-presentation"/, "recommendation parsing must be imported from the shared module");
  const reportPresentationSource = readFileSync(new URL("../app/lib/report-presentation.ts", import.meta.url), "utf8");
  assert.match(reportPresentationSource, /function extractRecommendationItems/, "extractRecommendationItems must exist in the shared module");
});

// --- G6. real-persisted-report path verification -------------------------

test("G6. real-report-shaped Strategic Recommendations action 2 (the exact Task #27B defect 1) and the 9 real sections (the exact Task #27B defect 2) modeled on report id 4c0b5786-357c-4927-b7ff-3d38664b6495 both produce clean PDF text end to end", async () => {
  // Action 2 -- the exact single-occurrence shape that was left raw (Task
  // #27B), then left as raw inline metadata inside recommendation prose
  // (the exact Task #28B live defect). TASK #28B: recommendation-shaped
  // prose ("Owner:"/"Budget ceiling:"/"KPI:"/"Success criterion:") moves
  // even a lone occurrence to the compact shared note instead of leaving
  // it embedded mid-sentence.
  const action2 =
    "Accuracy benchmarking engagement — Owner: Head of Product, Budget ceiling: USD 60,000; KPI: independent accuracy Market sources report (clause extraction & risk scoring) across 500 representative contracts; Success criterion: third-party Market sources demonstrating ≥90% extraction F1 or equivalent within 90 days (requirement driven by buyer expectations in vendor docs) (unverified).";
  const renderedAction2 = normalizePdfText(action2);
  assert.doesNotMatch(renderedAction2, /\(unverified\)/i);
  assert.doesNotMatch(renderedAction2, /\*/);
  assert.doesNotMatch(renderedAction2, /\(Evidence status: Unverified\)/, "recommendation prose must never carry the inline metadata marker");
  assert.match(renderedAction2, /Evidence note: Some claims require independent validation\.$/, "the uncertainty is still disclosed, via the compact shared note");

  // Opportunities -- 3 flagged bullets, 1 unflagged, modeled on the real
  // content. TASK #28: no [R#]/bare-R#/[Verified] citation anywhere in
  // this field, so the 3 repeated labels now collapse into one
  // section-level disclosure instead of repeating after each bullet.
  const opportunities =
    "1) Mid-market focused pricing and packaged compliance modules: registry shows enterprise vendors but limited mid-market pricing—opportunity to offer clear, procurement-friendly line-items for mid-sized firms (unverified).\n2) Vertical regulatory templates (healthcare, manufacturing): vendors emphasize use cases but verticalized compliance modules are less visible in public evidence (unverified).\n3) Public-sector supplier listing and buyable pricing: state procurement evidence (DocuSign SC) demonstrates a path to scale via public frameworks (unverified).\n4) Measurable accuracy benchmarking: few vendors publish independent accuracy metrics—providing third-party validated accuracy can be a differentiation.";
  const renderedOpportunities = normalizePdfText(opportunities);
  assert.doesNotMatch(renderedOpportunities, /\(unverified\)/i);
  assert.doesNotMatch(renderedOpportunities, /\*/);
  assert.equal((renderedOpportunities.match(/\(Evidence status: Unverified\)/g) || []).length, 0, "no per-claim label survives once consolidated");
  assert.match(renderedOpportunities, /Evidence note: Some claims require independent validation\.$/);
  const opportunityItems = renderedOpportunities.match(/^\d\)/gm) || [];
  assert.equal(opportunityItems.length, 4, "all 4 numbered opportunities must survive");
  assert.match(renderedOpportunities, /Measurable accuracy benchmarking: few vendors publish independent accuracy metrics/, "the unflagged 4th opportunity must remain fully intact, with no label added");

  // Full recommendation-extraction + rendering path for all 4 real items.
  // TASK #29J -- isRecommendationHeadingLine/isMetadataOnlyRecommendationLine/
  // isEvidenceStatusDisclaimerLine/extractRecommendationItems were
  // consolidated into this single shared module.
  const reportPresentationSource = readFileSync(new URL("../app/lib/report-presentation.ts", import.meta.url), "utf8");
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
    extractFunctionSource(reportPresentationSource, "isRecommendationHeadingLine"),
    extractFunctionSource(reportPresentationSource, "isMetadataOnlyRecommendationLine"),
    extractFunctionSource(reportPresentationSource, "isEvidenceStatusDisclaimerLine"),
    `export ${extractFunctionSource(reportPresentationSource, "extractRecommendationItems")}`,
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
    assert.doesNotMatch(rendered, /\(unverified\)/i);
    assert.doesNotMatch(rendered, /\*/);
    // TASK #28B -- recommendation prose must never carry the raw inline
    // metadata marker at all, in any of the 4 real actions.
    assert.doesNotMatch(rendered, /\(Evidence status: Unverified\)/, "recommendation prose must never carry the inline metadata marker");
  }
  assert.ok(
    renderedItems.some((r) => /Evidence note: Some claims require independent validation\.$/.test(r)),
    "action 2's unresolved sub-claim must still be disclosed, via the compact shared note"
  );
  assert.match(renderedItems[0], /Head of Sales \(U\.S\. mid-market\), Budget ceiling: USD 80,000/, "action 1's boundary merge must remain correct");
  assert.match(renderedItems[2], /6 U\.S\. mid-market customers across two verticals/, "action 3's boundary merge must remain correct");
});
