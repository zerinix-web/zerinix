import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #43B -- Fix Strategic Recommendation metadata field-boundary
// parsing in the real Market Intelligence PDF.
//
// Task #43A fixed Porter's Five Forces clipping. Real Download PDF
// verification then exposed a DIFFERENT defect in the same
// extractRecommendationSignals function Task #43A had just touched:
// not a wrapping/height problem (Task #43's class) and not an
// abbreviation-period problem (Task #43A's own class), but a
// structural field-BOUNDARY problem -- OWNER (and, by the same
// mechanism, Budget/Success Metric/Activity/Evidence Tie) kept
// capturing text well past its own real end, absorbing whatever field
// came after it.
//
// EXACT REPORTED DEFECT:
//   "U.S. Mid-Market Pilot (Owner: Head of Partnerships) -- Budget
//   ceiling USD 75,000 (Assumption)."
// rendered OWNER as:
//   "Head of Partnerships) -- Budget ceiling USD 75,000 (Assumption)"
// instead of:
//   "Head of Partnerships"
//
// ROOT CAUSE: the terminator these 5 fields shared, `(?:;|\.\s|\.$|$)`,
// only recognized a semicolon or a genuine sentence-ending period as
// "this field's own end". It had no concept of: a closing parenthesis
// (the "(Owner: X) -- ..." shape used here), an em/en dash introducing
// the next clause, or simply running straight into the NEXT recognized
// label with no punctuation at all between them. With none of those
// present in this exact sentence, the lazy capture grew all the way to
// the sentence's own final period.
//
// FIX: recommendationFieldBoundaryPattern (report-presentation.ts) is
// a single, shared "stop here" rule now reused by all 5 fields:
// semicolon, a genuine (non-decimal) period, a closing parenthesis, an
// em/en dash, or the START of any of these 5 labels' own keyword --
// whichever comes first. A `(...)` pair that closes WITHIN the value
// itself (Task #43A's own real fixture, "Head of BD (U.S. mid-market)")
// is matched as one atomic balanced unit first, so a legitimate
// parenthetical descriptor that is part of the value is never mistaken
// for the field's own closing boundary -- only an unmatched closing
// paren (one that closes a group wrapping the field from OUTSIDE) ends
// the match. Budget's own label now also accepts an absent colon (the
// real reported "Budget ceiling USD 75,000" shape), gated by a
// lookahead requiring what follows to actually look like a monetary
// figure, so ordinary prose merely containing the word "budget" still
// never fires.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const reportPresentationSource = readFileSync(new URL("../app/lib/report-presentation.ts", import.meta.url), "utf8");

// --- 1. THE EXACT REPORTED DEFECT ------------------------------------

test("TASK #43B: the exact reported sentence resolves OWNER to the complete value, never absorbing the Budget clause after it", () => {
  const signals = extractRecommendationSignals(
    "U.S. Mid-Market Pilot (Owner: Head of Partnerships) — Budget ceiling USD 75,000 (Assumption)."
  );
  assert.equal(signals.owner, "Head of Partnerships");
  assert.doesNotMatch(signals.owner, /Budget/);
  assert.doesNotMatch(signals.owner, /\)/);
});

test("TASK #43B: the ticket's own minimal example -- '(Owner: Head of Partnerships) — Budget ceiling USD 75,000' -- resolves BOTH owner and budget correctly (requirement 4's literal expected output)", () => {
  const signals = extractRecommendationSignals("(Owner: Head of Partnerships) — Budget ceiling USD 75,000");
  assert.equal(signals.owner, "Head of Partnerships");
  assert.equal(signals.budget, "USD 75,000");
});

test("TASK #43B: the same defect class reproduces for other real owner names ('Head of Sales Ops', 'Head of Revenue') and is equally fixed", () => {
  const salesOps = extractRecommendationSignals("(Owner: Head of Sales Ops) — Budget ceiling USD 30,000.");
  assert.equal(salesOps.owner, "Head of Sales Ops");

  const revenue = extractRecommendationSignals("(Owner: Head of Revenue) — Budget ceiling USD 45,000.");
  assert.equal(revenue.owner, "Head of Revenue");
});

// --- 2. Task #43A's own fixture must remain fixed (no regression) ---

test("TASK #43B (no regression on Task #43A): a legitimate parenthetical descriptor that is PART of the owner value ('Head of BD (U.S. mid-market)') still survives whole -- the balanced-paren unit is consumed before the bare-')' stop is ever checked", () => {
  const signals = extractRecommendationSignals(
    "Owner: Head of BD (U.S. mid-market); Budget cap: USD 60,000; Success criterion: 3 signed pilot LOIs within 90 days."
  );
  assert.equal(signals.owner, "Head of BD (U.S. mid-market)");
  assert.equal(signals.budget, "USD 60,000");
});

// --- 3. Required test matrix (ticket requirement 8) ------------------

test("TASK #43B: owner followed by budget (semicolon-separated, the pre-existing common shape) still resolves correctly", () => {
  const signals = extractRecommendationSignals("Owner: Head of Partnerships; Budget cap: USD 75,000.");
  assert.equal(signals.owner, "Head of Partnerships");
  assert.equal(signals.budget, "USD 75,000");
});

test("TASK #43B: owner followed by an em dash (no parentheses at all) stops cleanly at the dash, never absorbing the next clause", () => {
  const signals = extractRecommendationSignals("Owner: Head of Revenue — Budget cap: USD 40,000 — Success criterion: 20% lift.");
  assert.equal(signals.owner, "Head of Revenue");
  assert.equal(signals.budget, "USD 40,000");
  assert.equal(signals.metric, "20% lift");
});

test("TASK #43B: a multi-word owner value is preserved completely, not cut at the first word", () => {
  const signals = extractRecommendationSignals("Owner: Head of Partnerships and Business Development; Budget cap: USD 75,000.");
  assert.equal(signals.owner, "Head of Partnerships and Business Development");
});

test("TASK #43B: a parenthesized owner clause ('(Owner: X)') resolves to just X, the exact reported shape", () => {
  const signals = extractRecommendationSignals("Pilot expansion (Owner: Head of Partnerships) requires board sign-off.");
  assert.equal(signals.owner, "Head of Partnerships");
});

test("TASK #43B: budget never leaks into owner, and owner never leaks into budget, for a real fully-populated recommendation line", () => {
  const signals = extractRecommendationSignals(
    "(Owner: Head of Sales Ops) — Budget ceiling USD 75,000 (Assumption); Timeline: 90 days; Success criterion: 3 signed LOIs; Evidence tie: addresses SAM/SOM gap."
  );
  assert.equal(signals.owner, "Head of Sales Ops");
  assert.doesNotMatch(signals.owner, /Budget|USD/);
  assert.match(signals.budget, /^USD 75,000/);
  assert.doesNotMatch(signals.budget, /Timeline|Success|Evidence/);
});

test("TASK #43B: timeline does not leak into another field (extracted via its own self-terminating duration pattern, unaffected by the label-boundary fix)", () => {
  const signals = extractRecommendationSignals(
    "(Owner: Head of Revenue) — Budget ceiling USD 50,000; Timeline: 90 days; Success criterion: 3 signed LOIs."
  );
  assert.equal(signals.timeframe, "90 days");
  assert.doesNotMatch(signals.timeframe, /Success|LOIs|Owner|Revenue/);
});

test("TASK #43B: evidence tie remains complete when it is the LAST field on the line (no trailing separator to rely on)", () => {
  const signals = extractRecommendationSignals(
    "Owner: Head of Partnerships; Budget cap: USD 75,000; Evidence tie: addresses SAM/SOM validation gap identified in Strategic Recommendations."
  );
  assert.match(signals.evidenceTie, /addresses SAM\/SOM validation gap identified in Strategic Recommendations$/);
});

test("TASK #43B: evidence tie does not leak into a following owner/budget field when it comes FIRST on the line", () => {
  const signals = extractRecommendationSignals(
    "Evidence tie: addresses competitive-differentiation gap; Owner: Head of Partnerships; Budget cap: USD 20,000."
  );
  assert.equal(signals.evidenceTie, "addresses competitive-differentiation gap");
  assert.equal(signals.owner, "Head of Partnerships");
  assert.equal(signals.budget, "USD 20,000");
});

test("TASK #43B: activity does not leak into a following evidence tie field", () => {
  const signals = extractRecommendationSignals(
    "Activity: run a structured willingness-to-pay survey across 200 target buyers; Evidence tie: addresses SAM/SOM gap."
  );
  assert.equal(signals.activity, "run a structured willingness-to-pay survey across 200 target buyers");
  assert.equal(signals.evidenceTie, "addresses SAM/SOM gap");
});

test("TASK #43B: success metric does not leak into a following field, and survives a real, longer sentence", () => {
  const signals = extractRecommendationSignals(
    "Success criterion: at least one signed U.S. mid-market reference customer within 6 months; Owner: Head of Sales."
  );
  assert.equal(signals.metric, "at least one signed U.S. mid-market reference customer within 6 months");
  assert.equal(signals.owner, "Head of Sales");
});

test("TASK #43B: Budget's now-optional colon still refuses to fire on ordinary prose that merely contains the word 'budget' -- never fabricates a value", () => {
  const signals = extractRecommendationSignals("The pilot's Budget is a concern for leadership; Owner: Head of Sales.");
  assert.equal(signals.budget, "");
  assert.equal(signals.owner, "Head of Sales");
});

test("TASK #43B (no regression): Budget with its pre-existing colon-and-symbol shape ('Budget cap: $75,000') is unaffected by making the colon optional", () => {
  const signals = extractRecommendationSignals("Budget cap: $75,000.");
  assert.equal(signals.budget, "$75,000");
});

// --- 4. Real PDF presentation path (requirement 8's own explicit item) ---

test("TASK #43B: the real Download PDF path (buildStandardReportPdf, ReportPdfButton.tsx) and Planner.tsx's own downloadPdf both import extractRecommendationSignals from the single shared module -- the fix applies identically everywhere it is drawn, not just in an isolated unit test", () => {
  for (const [name, source] of [
    ["ReportPdfButton.tsx", pdfButtonSource],
    ["Planner.tsx", plannerSource],
    ["page.tsx", pageSource],
  ]) {
    assert.match(source, /\bextractRecommendationSignals\b[\s\S]{0,700}from "@\/app\/lib\/report-presentation"/, `${name}: must import the real, shared extractRecommendationSignals`);
    assert.doesNotMatch(source, /^function extractRecommendationSignals\(/m, `${name}: must not define its own local copy`);
  }
});

// --- STRUCTURAL AUDIT ---

test("STRUCTURAL AUDIT: the old unbounded terminator ([^;]+?...) no longer appears anywhere in extractRecommendationSignals", () => {
  const fnMatch = reportPresentationSource.match(/export function extractRecommendationSignals\([\s\S]*?\n\}/);
  assert.ok(fnMatch, "expected to find extractRecommendationSignals's own function body");
  assert.doesNotMatch(fnMatch[0], /\(\[\^;\]\+\?\)/, "the old unbounded [^;]+? capture must be gone");
});

test("STRUCTURAL AUDIT: all 5 label-based fields (Owner/Budget/Success Metric/Activity/Evidence Tie) share the SAME recommendationFieldBoundaryPattern -- a fix to the boundary rule can never accidentally apply to only some fields", () => {
  const fnMatch = reportPresentationSource.match(/export function extractRecommendationSignals\([\s\S]*?\n\}/);
  // Counts only actual CODE usages (the interpolated `${...}` form),
  // not the plain-English comment above the declaration that also
  // names this constant.
  const usages = (fnMatch[0].match(/\$\{recommendationFieldBoundaryPattern\}/g) || []).length;
  assert.equal(usages, 5, `expected all 5 fields (Budget, Success Metric, Owner, Activity, Evidence Tie) to interpolate recommendationFieldBoundaryPattern, found ${usages} usages`);
});

test("STRUCTURAL AUDIT: the boundary pattern's stop-list includes a closing parenthesis, an em/en dash, and the label alternation -- not just punctuation this one ticket's example happened to use", () => {
  const fnMatch = reportPresentationSource.match(/export function extractRecommendationSignals\([\s\S]*?\n\}/)[0];
  assert.match(fnMatch, /\\\)/, "expected a closing-parenthesis stop condition");
  assert.match(fnMatch, /\[—–\]/, "expected an em/en dash stop condition");
  assert.match(fnMatch, /recommendationFieldLabelAlternation/, "expected the shared label-alternation stop condition");
});

// --- DRIFT CHECK (requirement 9 & 10) ---

test("DRIFT CHECK: Task #43A's Porter's Five Forces dynamic-height fix (getPorterLayout) is untouched by this ticket", () => {
  for (const [name, source] of [
    ["ReportPdfButton.tsx", pdfButtonSource],
    ["Planner.tsx", plannerSource],
  ]) {
    assert.match(source, /const getPorterLayout = \(content: string, width: number\) => \{/, `${name}: getPorterLayout must still exist`);
    assert.match(source, /const porterImplicationLineHeight = 3\.2;/, `${name}: Porter line-height constant must be unchanged`);
  }
});

test("DRIFT CHECK: Task #43's Strategic Recommendations dynamic card-height fix (computeRecommendationCardLayout, wrapLineHeight) is untouched by this ticket", () => {
  for (const [name, source] of [
    ["ReportPdfButton.tsx", pdfButtonSource],
    ["Planner.tsx", plannerSource],
  ]) {
    assert.match(source, /const wrapLineHeight = 3;/, `${name}: Task #43's wrapLineHeight constant must be unchanged`);
    assert.doesNotMatch(source, /drawRecommendationFieldValue\s*\(/, `${name}: the removed single-line truncation helper must not have returned`);
  }
});

test("DRIFT CHECK: decision/evidence/confidence/threshold/TAM-SAM-SOM methodology is untouched -- this fix only changes where a field's own VALUE stops being captured, never how any of those are calculated", () => {
  assert.match(reportPresentationSource, /export function extractRecommendationSignals\(line: string\)/);
  // gate (Decision Gate) uses its own, separately-fixed (Task #42)
  // decimal-safe pattern and must remain untouched by this ticket.
  const fnMatch = reportPresentationSource.match(/export function extractRecommendationSignals\([\s\S]*?\n\}/)[0];
  assert.match(fnMatch, /\(\?:\[\^\.\]\|\(\?<=\\d\)\\\.\(\?=\\d\)\)\*/, "the gate field's own Task #42 decimal-safe pattern must be unchanged");
});
