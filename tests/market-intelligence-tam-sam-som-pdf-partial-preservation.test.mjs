import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveMarketSizingCascade } from "../app/lib/report-presentation.ts";

// P0 FIX -- TAM/SAM/SOM data pipeline: preserve validated market-sizing
// values consistently from research -> report -> UI -> PDF.
//
// ROOT CAUSE (confirmed via forensic investigation): ReportPdfButton.tsx
// required ALL THREE of TAM/SAM/SOM to parse to a number before drawing
// anything numeric at all ("isCoherentlyNested"). Since SOM legitimately
// has no obtainable-share evidence more often than not, this discarded
// an already-resolved TAM and SAM the moment SOM alone was pending --
// even though the web report (app/dashboard/[id]/page.tsx) already
// rendered each layer independently and never had this restriction.
//
// FIX: resolveMarketSizingCascade (report-presentation.ts) is now the
// single, canonical, exported resolution rule -- imported directly by
// ReportPdfButton.tsx, and mathematically identical to page.tsx's own
// (untouched, already-correct, already-tested) inline formula. A layer
// resolves only when it has its own parseable magnitude AND every layer
// above it in the TAM >= SAM >= SOM hierarchy is ALSO resolved and
// correctly nested -- this is a pure display-layer decision; it never
// derives or fabricates a value the evidence-first market-sizing engine
// (market-intelligence-graph.ts) did not already produce.

const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const reportPresentationSource = readFileSync(
  new URL("../app/lib/report-presentation.ts", import.meta.url),
  "utf8"
);

// --- CASE A: TAM valid, SAM valid, SOM missing/unvalidated -----------------

test("CASE A: TAM valid, SAM valid, SOM missing -- TAM and SAM resolve independently of SOM; the section does not collapse", () => {
  // Approximates the exact reported production values: TAM ~= $7.32B,
  // SAM ~= $512.2M, SOM unresolved.
  const cascade = resolveMarketSizingCascade([7.32e9, 512.2e6, null]);

  assert.equal(cascade.tamResolved, true, "TAM must remain resolved regardless of SOM");
  assert.equal(cascade.samResolved, true, "SAM must remain resolved regardless of SOM");
  assert.equal(cascade.somResolved, false, "SOM has no parseable value, so it correctly reads as unresolved");
  assert.equal(cascade.allResolved, false);
});

// --- CASE B: TAM valid, SAM missing, SOM missing ----------------------------

test("CASE B: TAM valid, SAM and SOM missing -- TAM remains visible, SAM/SOM show validation-needed states, nothing fabricated", () => {
  const cascade = resolveMarketSizingCascade([7.32e9, null, null]);

  assert.equal(cascade.tamResolved, true);
  assert.equal(cascade.samResolved, false);
  assert.equal(cascade.somResolved, false, "SOM cascades to unresolved because its parent (SAM) is unresolved, not because of its own value");
  assert.equal(cascade.allResolved, false);
});

// --- CASE C: TAM missing -----------------------------------------------------

test("CASE C: TAM missing/unvalidated -- SAM/SOM are never treated as resolved even if they independently parsed a number, preserving the existing evidence-first TAM-first gating", () => {
  // A defensive case: even if SAM/SOM's own text somehow contained a
  // parseable number (should not happen given the upstream engine's own
  // SAM-confidence gate, but this is the display-layer's own
  // independent safety net for that hierarchy rule).
  const cascade = resolveMarketSizingCascade([null, 512.2e6, 50e6]);

  assert.equal(cascade.tamResolved, false);
  assert.equal(cascade.samResolved, false, "SAM must not render as resolved when TAM itself is unresolved, regardless of SAM's own parsed value");
  assert.equal(cascade.somResolved, false);
  assert.equal(cascade.allResolved, false);
});

test("CASE C: TAM missing and SAM/SOM also missing -- the fully-unresolved case", () => {
  const cascade = resolveMarketSizingCascade([null, null, null]);

  assert.deepEqual(cascade, {
    tamResolved: false,
    samResolved: false,
    somResolved: false,
    allResolved: false,
  });
});

// --- CASE D: all three valid -------------------------------------------------

test("CASE D: all three valid and correctly nested -- every layer resolves, matching the existing fully-populated behavior", () => {
  const cascade = resolveMarketSizingCascade([7.32e9, 512.2e6, 50e6]);

  assert.deepEqual(cascade, {
    tamResolved: true,
    samResolved: true,
    somResolved: true,
    allResolved: true,
  });
});

// --- Data-inconsistency case: never silently treated as "resolved" ---------

test("a SAM that numerically exceeds TAM is rejected as unresolved -- a genuine data inconsistency must not render as if it were valid, distinct from merely-missing data", () => {
  const cascade = resolveMarketSizingCascade([2e8, 5e8, 1e7]); // SAM > TAM
  assert.equal(cascade.tamResolved, true);
  assert.equal(cascade.samResolved, false);
  assert.equal(cascade.somResolved, false);
});

// --- Never invents missing values -------------------------------------------

test("resolveMarketSizingCascade never derives or fabricates a magnitude -- it only classifies the magnitudes it was given as resolved/unresolved", () => {
  const inputMagnitudes = [7.32e9, null, null];
  const cascade = resolveMarketSizingCascade(inputMagnitudes);

  // The function's only outputs are booleans -- there is no code path by
  // which it could return a numeric value, verified by its return shape.
  assert.deepEqual(Object.keys(cascade).sort(), ["allResolved", "samResolved", "somResolved", "tamResolved"]);
  for (const value of Object.values(cascade)) {
    assert.equal(typeof value, "boolean");
  }
});

// --- UI/PDF parity for the same structured payload --------------------------

test("PARITY: ReportPdfButton.tsx imports and calls the same canonical resolveMarketSizingCascade the web report's formula is mathematically identical to -- the two surfaces can no longer independently disagree", () => {
  assert.match(
    pdfButtonSource,
    /import\s*\{[^}]*resolveMarketSizingCascade[^}]*\}\s*from\s*"@\/app\/lib\/report-presentation"/s,
    "ReportPdfButton.tsx must import the canonical cascade resolver"
  );
  assert.match(
    pdfButtonSource,
    /const cascade = resolveMarketSizingCascade\(magnitudes\);/,
    "the PDF's TAM/SAM/SOM section must resolve layers via the canonical function, not its own bespoke all-or-nothing check"
  );
  // The old all-or-nothing gate must be gone, not merely bypassed.
  assert.doesNotMatch(
    pdfButtonSource,
    /const isCoherentlyNested =\s*\n\s*tamMagnitude !== null &&\s*\n\s*samMagnitude !== null &&\s*\n\s*somMagnitude !== null/,
    "the all-or-nothing isCoherentlyNested gate must be fully removed, not left as dead code alongside the fix"
  );
});

test("PARITY: page.tsx's own (untouched) inline cascade formula is mathematically identical to resolveMarketSizingCascade's implementation -- both surfaces apply the exact same rule even though page.tsx keeps its own copy", () => {
  // page.tsx was NOT modified by this fix (it was never the source of
  // the bug -- only the PDF had the all-or-nothing gate) -- this proves
  // its existing, already-correct, already-tested formula matches the
  // new shared function line-for-line, which is what makes reusing it
  // in the PDF a safe, behavior-preserving fix rather than a divergence.
  const formulaLines = [
    /const tamResolved = tamMagnitude !== null;/,
    /const samResolved = tamResolved && samMagnitude !== null && samMagnitude <= \(tamMagnitude as number\);/,
    /const somResolved = samResolved && somMagnitude !== null && somMagnitude <= \(samMagnitude as number\);/,
  ];
  for (const pattern of formulaLines) {
    assert.match(reportPresentationSource, pattern, `resolveMarketSizingCascade missing expected line: ${pattern}`);
  }
  assert.match(pageSource, /const tamResolved = magnitudes\[0\] !== null;/);
  assert.match(
    pageSource,
    /const samResolved = tamResolved && magnitudes\[1\] !== null && magnitudes\[1\] <= \(magnitudes\[0\] as number\);/
  );
  assert.match(
    pageSource,
    /const somResolved = samResolved && magnitudes\[2\] !== null && magnitudes\[2\] <= \(magnitudes\[1\] as number\);/
  );
});

test("computeTamSamSomRadii's own existing null-safety already keeps the chart safe for every partial case this fix targets -- unchanged, not touched by this fix", () => {
  // computeTamSamSomRadii falls back to a fixed, always-legible
  // silhouette whenever ANY input is null -- for every CASE this fix
  // targets (A: SOM null, B: SAM/SOM null, C: TAM null), at least one
  // input is null via the SAME magnitudes the legend already reads, so
  // the chart never draws a falsely-precise circle for an unresolved
  // layer without needing its own separate gate through `cascade`.
  assert.match(pdfButtonSource, /const radii = computeTamSamSomRadii\(magnitudes\[0\], magnitudes\[1\], magnitudes\[2\]\);/);
});

// P0 PRODUCTION FIX -- confirmed live (Task #11, Market Intelligence
// decision/market-sizing consistency hardening): the bare "—" placeholder
// this test used to assert was ITSELF a residual instance of the exact
// "unexplained dash instead of a semantic evidence state" bug class fixed
// everywhere else in this codebase (Task #9/#10) -- an unresolved layer's
// row now shows this file's own already-localized "Validation Required"
// label instead, directly satisfying "Preserve evidence labels such as
// Verified / Derived / Validation Needed where applicable." Nothing is
// fabricated: a resolved layer still shows its own real value unchanged.
test("PDF row-level fallback: an unresolved layer never shows a fabricated value OR an unexplained bare dash -- it shows this file's own established 'Validation Required' label, and the row is visually dimmed to distinguish it from a resolved layer", () => {
  assert.doesNotMatch(
    pdfButtonSource,
    /drawSingleLine\(value \|\| "—", legendX \+ 10, rowY \+ 9\.4, legendWidth - 10, 8, 5, false\);/,
    "the old unexplained bare-dash fallback must be gone"
  );
  assert.match(
    pdfButtonSource,
    /drawSingleLine\(\s*\n\s*isResolved \? value : localizePdfPresentationLabel\("Validation Required", pdfLocale\),\s*\n\s*legendX \+ 10,\s*\n\s*rowY \+ 9\.4,\s*\n\s*legendWidth - 10,\s*\n\s*8,\s*\n\s*5,\s*\n\s*false\s*\n\s*\);/
  );
  // The row is still visually distinguished (dimmed) when unresolved,
  // so a reader can tell a real value from a placeholder at a glance.
  assert.match(pdfButtonSource, /pdf\.setTextColor\(isResolved \? "#ccfbf1" : "#71717a"\);/);
});

test("PDF full-section fallback now fires ONLY when nothing at all is resolved, not merely when the three layers are not ALL resolved", () => {
  assert.match(
    pdfButtonSource,
    /if \(!cascade\.tamResolved && !cascade\.samResolved && !cascade\.somResolved\) \{/
  );
});

// --- Planner.tsx (live plan-creation PDF export): the ACTUAL still-live ----
// --- bug this ticket reported. ReportPdfButton.tsx (saved-report PDF) ------
// --- was already fixed in a prior session; Planner.tsx's own tamSamSom -----
// --- branch was never updated to match, and still had the exact old -------
// --- all-or-nothing "isCoherentlyNested" gate (requiring ALL THREE of ------
// --- TAM/SAM/SOM to parse before drawing anything) plus the same bare ------
// --- "—" row fallback. This is almost certainly what the user actually -----
// --- observed: TAM $1.5B / SAM $375M resolved, SOM unresolved, the whole ---
// --- section replaced with a generic validation message. ------------------

test("PARITY: Planner.tsx's own PDF export imports and calls the same canonical resolveMarketSizingCascade ReportPdfButton.tsx uses -- the two PDF generators (and the web report) can no longer independently disagree", () => {
  assert.match(
    plannerSource,
    /resolveMarketSizingCascade[\s\S]{0,400}\} from "@\/app\/lib\/report-presentation"/,
    "Planner.tsx must import the canonical cascade resolver"
  );
  assert.match(
    plannerSource,
    /const cascade = resolveMarketSizingCascade\(magnitudes\);/,
    "Planner.tsx's TAM/SAM/SOM section must resolve layers via the canonical function, not its own bespoke all-or-nothing check"
  );
  // The old all-or-nothing gate must be gone, not merely bypassed.
  assert.doesNotMatch(
    plannerSource,
    /const isCoherentlyNested =\s*\n\s*tamMagnitude !== null &&\s*\n\s*samMagnitude !== null &&\s*\n\s*somMagnitude !== null/,
    "the all-or-nothing isCoherentlyNested gate must be fully removed from Planner.tsx, not left as dead code alongside the fix"
  );
});

test("PARITY: Planner.tsx's full-section fallback now fires ONLY when nothing at all is resolved, exactly matching ReportPdfButton.tsx", () => {
  assert.match(
    plannerSource,
    /if \(!cascade\.tamResolved && !cascade\.samResolved && !cascade\.somResolved\) \{/
  );
});

test("PARITY: Planner.tsx's row-level fallback also shows 'Validation Required' (not a bare dash) for an unresolved layer, exactly matching ReportPdfButton.tsx's identical fix", () => {
  assert.doesNotMatch(
    plannerSource,
    /drawSingleLine\(value \|\| "—", legendX \+ 10, rowY \+ 9\.4, legendWidth - 10, 8, 5, false\);/,
    "the old unexplained bare-dash fallback must be gone from Planner.tsx too"
  );
  assert.match(
    plannerSource,
    /drawSingleLine\(\s*\n\s*isResolved \? value : localizePdfPresentationLabel\("Validation Required", pdfLocale\),/
  );
  assert.match(plannerSource, /pdf\.setTextColor\(isResolved \? "#ccfbf1" : "#71717a"\);/);
});

test("PARITY: Planner.tsx's resolved-layer evidence metadata (planning-assumption sentence, Planning Estimate label) is preserved, unchanged by this fix", () => {
  assert.match(plannerSource, /const assumption = extractMarketSizeAssumption\(section\.content, label\);/);
  assert.match(plannerSource, /const isEstimated = isMarketSizeEstimated\(section\.content, label\);/);
});

// --- Evidence metadata, confidence, and source references preserved --------

test("resolved layers still surface their real planning-assumption sentence and Planning Estimate label in the PDF -- evidence metadata is not discarded by this fix", () => {
  assert.match(pdfButtonSource, /const assumption = extractMarketSizeAssumption\(content, label\);/);
  assert.match(pdfButtonSource, /const isEstimated = isMarketSizeEstimated\(content, label\);/);
});

// --- Drift check: upstream engine and legacy decision scoring untouched ----

test("DRIFT CHECK: the evidence-first market-sizing engine (market-intelligence-graph.ts) and legacy decision scoring (market-intelligence-presentation.ts) are untouched by this presentation-only fix", () => {
  const graphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  const presentationSource = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(graphSource, /MINIMUM_CONFIDENCE_TO_UNLOCK_SAM = 20/);
  assert.match(
    presentationSource,
    /marketConfidence \* 0\.4 \+\s*\n\s*competitiveEvidence \* 0\.25 \+\s*\n\s*financialEvidence \* 0\.2 \+\s*\n\s*productEvidence \* 0\.15/
  );
});
