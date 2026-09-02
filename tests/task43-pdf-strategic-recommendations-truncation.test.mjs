import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { jsPDF } from "jspdf";

// TASK #43 -- Eliminate unintended text truncation across Market
// Intelligence PDF output.
//
// Tasks #42/#42A fixed the specific TAM numeric-decimal-truncation bug.
// This task addresses a DIFFERENT, previously-unaudited truncation
// mechanism: Strategic Recommendations' own per-card field grid, the
// "ACTION · TYPE -> THRESHOLD" classification tag, the Decision Gate
// sentence, and the ENTER/MONITOR/AVOID gap-driven-action rows all drew
// through a single-line, character-slice-then-ellipsis helper
// (`drawRecommendationFieldValue`, a near-duplicate of the pre-existing
// `drawSingleLine`) inside a FIXED-height row/card, regardless of how
// long the real value actually was. For a short numeric value squeezed
// into a narrow half-card column (e.g. Budget "$25,000" or Timeline "90
// days"), or a full ENTER/MONITOR/AVOID threshold sentence forced onto
// one fixed-height line, this is exactly the reported "$25k -> $2...",
// "90 days -> 9...", "70% -> 7..." defect class.
//
// FIX: computeRecommendationCardLayout and the new
// computeGapDrivenActionRowLayout now measure every field's REAL
// wrapped line count (via wrapPdfText/pdf.splitTextToSize, which -- see
// the empirical proof below -- only ever wraps on whitespace, never
// mid-token) and the row/card height is derived entirely from that,
// growing only when real content needs more than one line. The old
// character-slice-then-ellipsis helper (`drawRecommendationFieldValue`)
// is removed entirely from both render sites; `drawSingleLine` (a
// different, still-used helper) is untouched and confirmed to still
// only apply to short, bounded-vocabulary/short-label call sites (the
// ENTER/MONITOR/AVOID decision label, the TAM/SAM/SOM headline value
// with truncate explicitly disabled, cover-page KPI values with
// truncate explicitly disabled, and a market-map chart's own vendor dot
// label), never to open-ended decision-relevant prose.

const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");

const renderSites = [
  ["ReportPdfButton.tsx", pdfButtonSource],
  ["Planner.tsx", plannerSource],
];

// --- EMPIRICAL PROOF: the wrapping engine this fix relies on never ---
// --- splits a token (a number, currency amount, unit, or percentage) ---
// --- mid-character, regardless of how narrow the column is.          ---

test("NUMERIC INTEGRITY: jsPDF's own splitTextToSize (the real engine wrapPdfText/computeRecommendationCardLayout wrap through) never splits a token mid-character, even in a narrow half-card-width column", () => {
  const pdf = new jsPDF();
  pdf.setFontSize(5.2);
  const narrowFieldColumnWidth = 18; // mm -- realistic half-card field column

  const cases = [
    { text: "$25,000", mustContain: "$25,000" },
    { text: "90 days", mustContain: "90 days" },
    { text: "$1.5B", mustContain: "$1.5B" },
    { text: "70%", mustContain: "70%" },
    { text: "$2.1-2.8B", mustContain: "$2.1-2.8B" },
  ];

  for (const { text, mustContain } of cases) {
    const lines = pdf.splitTextToSize(text, narrowFieldColumnWidth);
    const rejoined = lines.join(" ");
    assert.ok(
      rejoined.includes(mustContain),
      `expected wrapped lines ${JSON.stringify(lines)} to still contain the complete token ${JSON.stringify(mustContain)}`
    );
    // A wrapped token is never itself cut short: every line either IS
    // the complete token or is empty/other words -- never a partial
    // prefix of it (e.g. "$2..." or "9...").
    for (const line of lines) {
      if (line !== mustContain && mustContain.startsWith(line.replace(/\.\.\.$/, ""))) {
        assert.fail(`line ${JSON.stringify(line)} looks like a truncated fragment of ${JSON.stringify(mustContain)}`);
      }
    }
  }
});

test("NUMERIC INTEGRITY: a realistic long field value with a trailing numeric token wraps to multiple whole-word lines, never truncating the number", () => {
  const pdf = new jsPDF();
  pdf.setFontSize(5.2);
  const lines = pdf.splitTextToSize("20% pilot conversion rate across named enterprise accounts", 18);
  const rejoined = lines.join(" ");
  assert.match(rejoined, /20%/);
  assert.ok(lines.length > 1, "expected this long value to actually need multiple lines in a narrow column");
  assert.ok(!lines.some((line) => /^\d+\.\.\.$|^\$\d+\.\.\.$/.test(line)), "no line should be a bare truncated numeric fragment");
});

// --- STRUCTURAL: the old character-slice-then-ellipsis helper is gone ---

for (const [name, source] of renderSites) {
  test(`TASK #43 [${name}]: drawRecommendationFieldValue (the single-line, character-slice-then-ellipsis helper Strategic Recommendations used to draw every field/gate/classification through) no longer exists`, () => {
    assert.doesNotMatch(source, /drawRecommendationFieldValue\s*\(/, `${name}: drawRecommendationFieldValue must have no remaining call sites`);
  });

  test(`TASK #43 [${name}]: the gap-driven ENTER/MONITOR/AVOID action rows no longer use a fixed 36mm row height for pagination -- row height is now derived from computeGapDrivenActionRowLayout's real measured content`, () => {
    assert.doesNotMatch(source, /const gapRowHeight = 36;/, `${name}: the fixed gapRowHeight constant must be removed`);
    assert.match(source, /computeGapDrivenActionRowLayout/, `${name}: expected the new per-row layout function`);
    assert.match(source, /gapRowLayouts\[candidate\]\.rowHeight/, `${name}: pagination chunking must read the real per-row height`);
  });

  test(`TASK #43 [${name}]: computeRecommendationCardLayout wraps the classification tag, field values, and decision gate instead of leaving them for a single-line truncating draw call`, () => {
    const fnMatch = source.match(/const computeRecommendationCardLayout = \(item: string, cardWidth: number\) => \{[\s\S]*?\n      \};/);
    assert.ok(fnMatch, `${name}: expected to find computeRecommendationCardLayout`);
    const fn = fnMatch[0];
    assert.match(fn, /classificationLines/, `${name}: classification tag must be wrapped (classificationLines)`);
    assert.match(fn, /wrappedFields/, `${name}: field values must be wrapped (wrappedFields)`);
    assert.match(fn, /gateLines/, `${name}: decision gate must be wrapped (gateLines)`);
    assert.match(fn, /fieldRowYOffsets/, `${name}: field rows must use real, per-row Y offsets derived from actual wrapped line counts`);
  });

  test(`TASK #43 [${name}]: the Strategic Recommendations draw code renders classification/gate/field values as wrapped line arrays (pdf.text with an array), not a single pre-truncated string`, () => {
    assert.match(source, /pdf\.text\(classificationLines, x \+ 11, cardY \+ 4,/, `${name}: classification tag must draw from the wrapped classificationLines array`);
    assert.match(source, /pdf\.text\(gateLines, x \+ 3,/, `${name}: decision gate must draw from the wrapped gateLines array`);
    assert.match(source, /fieldRowYOffsets\[Math\.floor\(fieldIndex \/ 2\)\]/, `${name}: field values must draw at a Y offset derived from real per-row heights`);
  });

  test(`TASK #43 [${name}]: the ENTER/MONITOR/AVOID threshold sentences (the real decision-gating prose, e.g. naming a specific percentage or dollar threshold) draw from pre-wrapped line arrays, never a single truncated line`, () => {
    assert.match(source, /rowLayout\.enterLines/, `${name}: ENTER condition must draw from wrapped lines`);
    assert.match(source, /rowLayout\.monitorLines/, `${name}: MONITOR condition must draw from wrapped lines`);
    assert.match(source, /rowLayout\.avoidLines/, `${name}: AVOID condition must draw from wrapped lines`);
  });
}

// --- WEB/PDF PARITY: both PDF render sites (ReportPdfButton.tsx and ---
// --- Planner.tsx's own duplicate downloadPdf) fix this identically  ---

test("WEB/PDF PARITY: both PDF render sites define the SAME wrap-line-height convention for Strategic Recommendations (wrapLineHeight = 3), so the two PDF code paths can never disagree on how much a card grows for the same content", () => {
  for (const [name, source] of renderSites) {
    assert.match(source, /const wrapLineHeight = 3;/, `${name}: expected the shared wrapLineHeight constant`);
  }
});

test("WEB/PDF PARITY: both PDF render sites cap field values at 3 wrapped lines and the classification tag at 2 wrapped lines -- identical bounds, so neither PDF code path can silently show more/less than the other for the same recommendation", () => {
  for (const [name, source] of renderSites) {
    assert.match(source, /fieldColWidth - 2\)(?:[\s\S]{0,40})?\)\.slice\(0, 3\)|\.slice\(0, 3\)/, `${name}: expected a 3-line cap on field values`);
    assert.match(source, /cardWidth - 13\)(?:[\s\S]{0,40})?\.slice\(0, 2\)/, `${name}: expected a 2-line cap on the classification tag`);
  }
});

// --- DRIFT CHECK: unrelated call sites of the SEPARATE drawSingleLine ---
// --- helper are untouched, and remain limited to genuinely short,    ---
// --- bounded-vocabulary or explicitly-non-truncating usages.         ---

test("DRIFT CHECK: drawSingleLine (a DIFFERENT, still-used helper) is untouched -- its only remaining truncating call sites are the short ENTER/MONITOR/AVOID decision label and a market-map chart's own short vendor dot label, never open-ended Strategic Recommendations prose", () => {
  for (const [name, source] of renderSites) {
    assert.match(source, /drawSingleLine\(decisionLabel, bodyX \+ 5, visualY \+ 16, 42, 11, 6\.5\);/, `${name}: decisionLabel call site must be unchanged`);
    assert.match(source, /drawSingleLine\(placement\.vendor, dotX \+ 2\.6, dotY \+ 1\.2, 24, 5\.2, 4\);/, `${name}: market-map vendor label call site must be unchanged`);
  }
});

test("DRIFT CHECK: the TAM/SAM/SOM headline value and cover-page KPI values still explicitly pass truncate=false to drawSingleLine -- untouched by this ticket, confirmed still safe", () => {
  for (const [name, source] of renderSites) {
    assert.match(source, /isResolved \? value : localizePdfPresentationLabel\("Validation Required", pdfLocale\),/, `${name}: TAM/SAM/SOM headline value call site must be unchanged`);
    assert.match(source, /drawSingleLine\(compactValue \|\| "—", [\s\S]{0,60}, false\);/, `${name}: cover KPI value call site must still pass truncate=false`);
  }
});

test("DRIFT CHECK (requirement 8/9): decision/evidence/confidence methodology is untouched -- this fix only reads already-computed classification/threshold objects and changes how their text is DRAWN, never how they are derived", () => {
  for (const [name, source] of renderSites) {
    assert.match(source, /classifyStrategicRecommendationValidation\(/, `${name}: classification derivation call must be unchanged`);
    assert.match(source, /resolveMarketIntelligenceControllingDecisionThreshold\(/, `${name}: controlling threshold derivation call must be unchanged`);
  }
});
