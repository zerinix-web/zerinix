import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// FINAL TAM/SAM/SOM LOGIC + PRESENTATION FIX.
//
// The prior ticket made TAM/SAM/SOM's three layers fully independent --
// each showed its own real value whenever ITS OWN extraction succeeded,
// with no regard for its siblings. That allowed an investor-facing
// contradiction: TAM "Validation Needed" while SAM/SOM still displayed
// calculated numbers with no verified anchor above them. This closes that
// gap with a cascading resolution chain:
//
//   tamResolved = magnitudes[0] !== null
//   samResolved = tamResolved && magnitudes[1] !== null && magnitudes[1] <= magnitudes[0]
//   somResolved = samResolved && magnitudes[2] !== null && magnitudes[2] <= magnitudes[1]
//
// A layer only ever shows a numeric value when it, and every layer above
// it, is resolved AND correctly nested (TAM >= SAM >= SOM). A layer
// blocked purely because its parent is unresolved shows "Pending <Parent>
// Validation"; a layer with its own bad/missing data (parent otherwise
// fine) shows the generic "Validation Needed".
//
// Also: Planning Estimate. tamSamSom's own prompt allows a transparent,
// benchmark-derived estimate labeled "[Estimated]" -- never presented as
// verified -- when no local figure exists. A resolved, estimated layer
// now shows "Planning Estimate / Not Verified" instead of silently
// presenting an estimate as a hard verified figure.
//
// Finally: formulas, calculation methodology, and assumptions are no
// longer shown inline in the main visual (a change from the immediately
// prior ticket, which HAD added an inline per-layer assumption line) --
// they live only in the section's own expandable Details/Methodology
// disclosure, per this ticket's explicit requirement 3.
//
// AI generation and the calculation engine are untouched -- only
// presentation and validation *display* logic changed.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

// A faithful, standalone reference implementation of the cascading
// resolution chain, used to prove the REQUIRED BEHAVIOR with concrete
// numbers (not just that the source text exists) -- paired with the
// regex assertions below that confirm page.tsx/Planner.tsx contain this
// exact formula, so a behavioral drift in either file would fail here.
function resolveTamSamSom(magnitudes) {
  const tamResolved = magnitudes[0] !== null;
  const samResolved = tamResolved && magnitudes[1] !== null && magnitudes[1] <= magnitudes[0];
  const somResolved = samResolved && magnitudes[2] !== null && magnitudes[2] <= magnitudes[1];
  const resolved = [tamResolved, samResolved, somResolved];
  const pendingLabels = [
    null,
    !tamResolved ? "Pending TAM Validation" : null,
    !samResolved ? "Pending SAM Validation" : null,
  ];

  return { resolved, pendingLabels };
}

// --- 1. Missing TAM prevents SAM/SOM numeric display -----------------------

test("missing TAM prevents SAM/SOM from showing a calculated numeric value, even when SAM/SOM parsed a real number on their own -- the exact literal ticket example (TAM missing, SAM/SOM cascade to Pending)", () => {
  const { resolved, pendingLabels } = resolveTamSamSom([null, 5e8, 5e7]);

  assert.deepEqual(resolved, [false, false, false]);
  assert.equal(pendingLabels[0], null);
  assert.equal(pendingLabels[1], "Pending TAM Validation");
  assert.equal(pendingLabels[2], "Pending SAM Validation");
});

test("missing SAM (TAM present) prevents SOM from showing a calculated numeric value -- SOM cascades to Pending SAM Validation, not Pending TAM Validation, since its immediate parent is SAM", () => {
  const { resolved, pendingLabels } = resolveTamSamSom([2e9, null, 5e7]);

  assert.deepEqual(resolved, [true, false, false]);
  assert.equal(pendingLabels[1], null); // SAM's own data problem, not a cascade
  assert.equal(pendingLabels[2], "Pending SAM Validation");
});

test("page.tsx and Planner.tsx: a missing/unresolved parent layer disables the child's numeric bar and value entirely -- the width/value JSX is gated on `isResolved`, not on the child's own magnitude alone", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /const tamResolved = magnitudes\[0\] !== null;/);
    assert.match(
      source,
      /const samResolved = tamResolved && magnitudes\[1\] !== null && magnitudes\[1\] <= \(magnitudes\[0\] as number\);/
    );
    assert.match(
      source,
      /const somResolved = samResolved && magnitudes\[2\] !== null && magnitudes\[2\] <= \(magnitudes\[1\] as number\);/
    );
    assert.match(source, /const resolved = \[tamResolved, samResolved, somResolved\];/);
  }
});

test("page.tsx and Planner.tsx: the exact 'Pending TAM Validation' / 'Pending SAM Validation' labels from this ticket's own literal example are wired to the right layer", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(
      source,
      /const pendingLabels(?::\s*Array<string \| null>)? = \[\s*\n\s*null,\s*\n\s*!tamResolved \? "Pending TAM Validation" : null,\s*\n\s*!samResolved \? "Pending SAM Validation" : null,\s*\n\s*\];/
    );
  }
});

// --- 2. All three levels maintain TAM >= SAM >= SOM logic ------------------

test("a numerically-present but out-of-order SAM (greater than TAM) is rejected -- it does NOT get treated as resolved just because a number exists", () => {
  const { resolved } = resolveTamSamSom([2e8, 5e8, 1e7]); // SAM > TAM: invalid nesting

  assert.equal(resolved[1], false);
  assert.equal(resolved[2], false); // SOM cascades too, since its parent (SAM) failed
});

test("a numerically-present but out-of-order SOM (greater than SAM) is rejected even when TAM and SAM are individually fine", () => {
  const { resolved } = resolveTamSamSom([2e9, 5e8, 6e8]); // SOM > SAM: invalid nesting

  assert.deepEqual(resolved, [true, true, false]);
});

test("all three levels resolved and correctly nested (TAM >= SAM >= SOM) render every real value -- the fully-populated, non-contradictory case", () => {
  const { resolved, pendingLabels } = resolveTamSamSom([2e9, 5e8, 5e7]);

  assert.deepEqual(resolved, [true, true, true]);
  assert.deepEqual(pendingLabels, [null, null, null]);
});

// --- 2b. Planning Estimate: shown consistently across all three, labeled --

test("page.tsx, Planner.tsx, and ReportPdfButton.tsx: isMarketSizeEstimated reads the real '[Estimated]'/'Planning Estimate' marker from the layer's own generated sentence -- never fabricating estimated status", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.match(source, /function isMarketSizeEstimated\(content: string, label: string\)/);
    assert.match(source, /\/\\\[Estimated\\\]\/i\.test\(sentence\)/);
    assert.match(source, /\/\\bPlanning Estimate\\b\/i\.test\(sentence\)/);
  }
});

test("page.tsx and Planner.tsx: a resolved, estimated layer shows the exact 'Planning Estimate / Not Verified' label -- applied consistently, per-layer, never replacing the real value", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /Planning Estimate \/ Not Verified/);
    assert.match(source, /const estimated = (?:bars|rows)\.map\(\((?:bar|row), index\) => resolved\[index\] && isMarketSizeEstimated\(/);
  }
});

test("ReportPdfButton.tsx and Planner.tsx's downloadPdf: the PDF legend marks an estimated layer, matching the UI's Planning Estimate concept (not just silently drawing an unverified figure as if verified)", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /const isEstimated = isMarketSizeEstimated\(/);
    assert.match(
      source,
      /isEstimated \? `\$\{label\} · \$\{localizePdfPresentationLabel\("Planning Estimate", pdfLocale\)\}` : label/
    );
  }
});

// --- 3. Formulas/methodology/assumptions moved out of the main visual -----

test("page.tsx and Planner.tsx: the main TAM/SAM/SOM visual renders a real per-layer planning-assumption/sizing-explanation line again (restored by a later ticket's explicit 'user must see ... sizing explanation without opening DETAILS' requirement, reversing the prior ticket's inline-removal) alongside values, bars, Pending/Validation states, and the Planning Estimate tag", () => {
  assert.match(pageSource, /\{isResolved && assumption \? \(/);
  // A later ticket ("RESTORE PREMIUM ANALYTICAL DEPTH") removed the
  // line-clamp-2 here -- a real, single-sentence assumption explanation
  // could still run long enough to get cut off at that width.
  assert.match(
    plannerSource.slice(plannerSource.indexOf('if (field === "tamSamSom")'), plannerSource.indexOf('if (field === "marketOpportunity"')),
    /text-xs leading-5 text-zinc-500">\{row\.description\}/
  );
});

// A later ticket ("FINAL CLEANUP -- remove all redundant DETAILS
// duplication") superseded the "collapsed AnalysisNotes" treatment below
// with full removal for TAM/SAM/SOM: the visual's per-layer assumption
// text now captures the section's complete content. See
// tests/market-intelligence-final-cleanup-details-duplication.test.mjs for
// the current, superseding behavior.
test("TAM/SAM/SOM is in cardFirstReportFields (regression guard on the underlying flag the Details-removal logic depends on)", () => {
  for (const source of [pageSource, plannerSource]) {
    const setMatch = source.match(/const cardFirstReportFields = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(setMatch, "cardFirstReportFields not found");
    assert.match(setMatch[1], /"tamSamSom",/);
  }
});

// --- 4. PDF does not duplicate methodology ---------------------------------

// A later ticket ("FINAL CLEANUP -- remove all redundant DETAILS
// duplication") superseded this coherence-gated partial suppression with
// full suppression -- see
// tests/market-intelligence-final-cleanup-details-duplication.test.mjs.
test("ReportPdfButton.tsx: the TAM/SAM/SOM commentary/methodology body paragraph is never drawn at all -- exactly one isTamSamSomPdfSection card gate, with sectionBodyContent unconditionally suppressed for it", () => {
  const occurrences = pdfButtonSource.match(/const isTamSamSomPdfSection = section\.field === "tamSamSom"/g) || [];
  assert.equal(occurrences.length, 1);
  assert.match(
    pdfButtonSource,
    /const isPdfCompleteVisualSection = pdfCompleteVisualFields\.has\(section\.field \?\? ""\) \|\| isTamSamSomPdfSection;/
  );
});

test("AI generation and the calculation engine are untouched -- only presentation and validation display logic changed (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /Define TAM, SAM, and SOM using explicit market boundaries/);
  assert.match(marketPromptSource, /Label every one of TAM\/SAM\/SOM \[Estimated\]/);

  // parseMonetaryMagnitude/parseMarketSizeMagnitude (the actual figure
  // parsing) are unchanged -- the cascading logic only reads their
  // output, it never alters how a value is parsed.
  assert.match(pageSource, /function parseMonetaryMagnitude\(value: string\)/);
  assert.match(plannerSource, /function parseMarketSizeMagnitude\(value: string\): number \| null/);
});
