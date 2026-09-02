import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// TASK #44 -- Make Market Intelligence numeric claims provenance-safe
// and structurally authoritative.
//
// This is a full-pipeline AUDIT ticket (no single reported defect),
// asking for every decision-relevant numeric claim across Market
// Intelligence to be either evidence-backed with preserved provenance,
// explicitly classified as an assumption/validation target, or
// withheld -- never displayed with invented precision or made
// indistinguishable from an independently verified figure.
//
// AUDIT FINDING: the canonical evidence/provenance architecture for
// this is already extensive and pre-dates this ticket (Tasks #10-#40):
//   - EvidenceLevel ("verified" > "derived" > "benchmarkDerived" >
//     "planningAssumption" > "validationRequired", app/lib/report-
//     evidence.ts) is the single classification vocabulary every
//     numeric-metric surface reads from.
//   - deriveMarketSizeMetricEvidenceLevel / resolveMarketSizingCascade /
//     resolveCagrHeadlinePresentation (app/lib/report-presentation.ts,
//     all exported, all shared by web AND PDF) are the canonical,
//     single-source-of-truth implementations for Market Size/CAGR/TAM-
//     SAM-SOM classification and nesting -- confirmed via source they
//     already: return "validationRequired" for a missing value (never
//     invented precision), return "planningAssumption" for a value with
//     no isolated evidence line of its own (never the more-confident
//     "benchmarkDerived" a whole-content re-scan could wrongly imply),
//     and never resolve a layer as verified/nested unless every parent
//     layer above it is also resolved and numerically consistent
//     (TAM >= SAM >= SOM).
//   - assessMarketEntryConfidence / capConfidenceForEvidenceGap (Task
//     #40) is the single confidence-scoring formula, structurally
//     incapable of exceeding a cap when a decision-critical evidence
//     pillar is unresolved -- unaffected by this ticket.
//   - extractRecommendationSignals' numericAssumptionSuffix (Task #38,
//     wired into page.tsx/Planner.tsx/ReportPdfButton.tsx identically)
//     already appends a localized provenance tag to every Timeline/
//     Budget/Success Metric value drawn from a recommendation, so a
//     planning figure ("USD 75,000 (Assumption)") is never visually
//     indistinguishable from independently verified evidence.
//
// REAL DEFECT FOUND: Task #43B's own recent field-boundary fix (the
// SAME extractRecommendationSignals function) added an em/en-dash stop
// condition to correctly separate "Owner: X -- Budget: Y" clauses --
// but an em/en dash is ALSO the conventional separator inside a compact
// numeric RANGE written with no surrounding spaces ("$50,000--$75,000",
// "USD 2.1--2.8M"), which is exactly the kind of value this ticket's
// own numeric-integrity concern (never invent/lose precision) protects.
// The bare dash stop silently cut such a range in half (budget
// "$50,000--$75,000" resolved to just "$50,000", discarding the real
// upper bound). FIX: recommendationFieldClauseDashStop now only stops
// at an em/en dash when it has whitespace on at least one side -- a
// clause-separating dash always does in normal prose; a compact
// range's own internal dash never does.
//
// SECOND REAL DEFECT FOUND: app/lib/report-evidence.ts's inferEvidenceLevel
// / normalizeEvidenceLevel (the shared classifier deriveMarketSizeMetricEvidenceLevel
// itself calls, and every other evidence badge across Business Plan/
// Acquisition/Market Intelligence ultimately routes through) matched the
// bare word "verified" ANYWHERE in a metric's evidence text, with no
// concept of negation. market-intelligence-graph.ts's own real generated
// gap-explanation text ("...the requested market's own addressable size
// has not been independently verified") therefore classified as
// "verified" -- the exact opposite of a sentence that explicitly says a
// figure is NOT verified. This is precisely the ticket's own core
// concern ("a numeric claim must never appear as a verified market fact"
// when it explicitly is not one). FIX: a shared negatedVerifiedPattern,
// checked before both the "derived from" and bare "verified" checks in
// each function, routes a negated claim to validationRequired instead.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const reportPresentationSource = readFileSync(new URL("../app/lib/report-presentation.ts", import.meta.url), "utf8");

// --- 1. THE REAL DEFECT FOUND BY THIS AUDIT --------------------------

test("TASK #44: a Strategic Recommendation budget expressed as a compact en-dash range ('$50,000–$75,000', no surrounding spaces) is preserved in FULL -- the upper bound is never silently dropped", async () => {
  const { extractRecommendationSignals } = await import("../app/lib/report-presentation.ts");
  const signals = extractRecommendationSignals("Owner: Head of Sales; Budget cap: $50,000–$75,000.");
  assert.match(signals.budget, /^\$50,000–\$75,000/);
  assert.doesNotMatch(signals.budget, /^\$50,000$/, "the range's upper bound must not be silently dropped");
});

test("TASK #44: the same compact-range protection applies to a hyphen range and a currency-code range (not just the one reported en-dash shape)", async () => {
  const { extractRecommendationSignals } = await import("../app/lib/report-presentation.ts");
  const hyphenRange = extractRecommendationSignals("Owner: Head of Sales; Budget cap: $50,000-$75,000.");
  assert.match(hyphenRange.budget, /^\$50,000-\$75,000/);

  const currencyCodeRange = extractRecommendationSignals("Owner: Head of BD; Budget cap: USD 2.1-2.8M.");
  assert.match(currencyCodeRange.budget, /^USD 2\.1-2\.8M/);
});

test("TASK #44 (no regression): a clause-separating em/en dash ('Owner: X -- Budget: Y', Task #43B's own reported shape) still correctly ends the Owner value -- the range fix does not reopen the Task #43B defect", async () => {
  const { extractRecommendationSignals } = await import("../app/lib/report-presentation.ts");
  const reported = extractRecommendationSignals(
    "U.S. Mid-Market Pilot (Owner: Head of Partnerships) — Budget ceiling USD 75,000 (Assumption)."
  );
  assert.equal(reported.owner, "Head of Partnerships");

  const noParens = extractRecommendationSignals("Owner: Head of Revenue — Budget cap: USD 40,000 — Success criterion: 20% lift.");
  assert.equal(noParens.owner, "Head of Revenue");
  assert.equal(noParens.budget, "USD 40,000");
  assert.equal(noParens.metric, "20% lift");
});

// --- 1b. THE SECOND REAL DEFECT FOUND BY THIS AUDIT ------------------

test("TASK #44: the exact real generated gap-explanation sentence ('...has not been independently verified') classifies as validationRequired, never 'verified' -- a figure explicitly described as NOT verified must never display as if it were", async () => {
  const { inferEvidenceLevel } = await import("../app/lib/report-evidence.ts");
  const level = inferEvidenceLevel({
    label: "TAM",
    value: "",
    context:
      "This figure's own evidence is specifically scoped to a different geography, not the geography requested in this report -- it cannot be promoted to TAM here, since the requested market's own addressable size has not been independently verified.",
  });
  assert.equal(level, "validationRequired");
});

test("TASK #44: a shorter negated-verified phrasing ('not independently verified', 'has not been verified', 'cannot be verified') is equally caught, not just the one exact reported sentence", async () => {
  const { inferEvidenceLevel } = await import("../app/lib/report-evidence.ts");
  for (const phrase of [
    "not independently verified",
    "has not been verified by a third party",
    "this figure cannot be verified at this time",
  ]) {
    const level = inferEvidenceLevel({ label: "SAM", value: "$50M", context: phrase });
    assert.equal(level, "validationRequired", `expected "${phrase}" to classify as validationRequired`);
  }
});

test("TASK #44 (no regression): a genuinely POSITIVE use of 'verified' (no negation nearby) still classifies as verified -- the negation fix does not over-trigger on ordinary verified evidence", async () => {
  const { inferEvidenceLevel } = await import("../app/lib/report-evidence.ts");
  const level = inferEvidenceLevel({
    label: "Market Size",
    value: "$1.5B",
    context: "Market Size: $1.5B, verified against the vendor's own audited 2024 annual filing.",
  });
  assert.equal(level, "verified");
});

test("TASK #44 (no regression): 'derived from the verified X figure' still classifies as derived, unaffected by the negation fix", async () => {
  const { inferEvidenceLevel } = await import("../app/lib/report-evidence.ts");
  const level = inferEvidenceLevel({
    label: "SAM",
    value: "$375M",
    context: "SAM: $375M, derived from the verified TAM figure using a disclosed 25% obtainable-share assumption.",
  });
  assert.equal(level, "derived");
});

test("TASK #44: normalizeEvidenceLevel (the sibling classifier used elsewhere in the report engine) is equally protected against negated 'verified' phrasing", async () => {
  const { normalizeEvidenceLevel } = await import("../app/lib/report-evidence.ts");
  assert.equal(normalizeEvidenceLevel("has not been independently verified"), "validationRequired");
  assert.equal(normalizeEvidenceLevel("verified"), "verified");
});

// --- 2. Required test matrix: evidence classification (canonical) ---

test("TASK #44: verified numeric evidence -- a value with an evidence line naming a real verification signal classifies as 'verified', not a lower tier", async () => {
  const { deriveMarketSizeMetricEvidenceLevel } = await import("../app/lib/report-presentation.ts");
  const level = deriveMarketSizeMetricEvidenceLevel(
    "Market Size",
    "$1.5B",
    "Market Size: $1.5B, verified against the vendor's own audited 2024 annual filing."
  );
  assert.equal(level, "verified");
});

test("TASK #44: unsupported percentage -- a percentage figure with NO isolated evidence line of its own is never classified as verified or even benchmark-derived; it is a bare planning assumption", async () => {
  const { deriveMarketSizeMetricEvidenceLevel } = await import("../app/lib/report-presentation.ts");
  const level = deriveMarketSizeMetricEvidenceLevel("CAGR", "24%", "This report discusses market dynamics broadly.");
  assert.equal(level, "planningAssumption");
});

test("TASK #44: missing CAGR -- an empty/absent CAGR value is Validation Required, never invented precision", async () => {
  const { deriveMarketSizeMetricEvidenceLevel } = await import("../app/lib/report-presentation.ts");
  const level = deriveMarketSizeMetricEvidenceLevel("CAGR", "", "No growth-rate figure is available for this market.");
  assert.equal(level, "validationRequired");
});

test("TASK #44: derived numeric value -- a figure explicitly described as derived/calculated from a verified source is classified 'derived', distinct from (and never promoted to) 'verified'", async () => {
  const { deriveMarketSizeMetricEvidenceLevel } = await import("../app/lib/report-presentation.ts");
  const level = deriveMarketSizeMetricEvidenceLevel(
    "SAM",
    "$375M",
    "SAM: $375M, derived from the verified TAM figure using a disclosed 25% obtainable-share assumption."
  );
  assert.equal(level, "derived");
  assert.notEqual(level, "verified");
});

test("TASK #44: planning assumption -- an explicit '[Estimated]'/'Planning Estimate' tag is preserved as a non-verified classification", async () => {
  const { deriveMarketSizeMetricEvidenceLevel } = await import("../app/lib/report-presentation.ts");
  const level = deriveMarketSizeMetricEvidenceLevel(
    "TAM",
    "$1.5B",
    "TAM: $1.5B [Estimated] based on a bottom-up benchmark comparison, not independently verified."
  );
  assert.notEqual(level, "verified");
});

test("TASK #44: validation target -- a value whose own evidence line explicitly says validation is required resolves to validationRequired, never a more confident tier", async () => {
  const { deriveMarketSizeMetricEvidenceLevel } = await import("../app/lib/report-presentation.ts");
  const level = deriveMarketSizeMetricEvidenceLevel(
    "SOM",
    "$50M",
    "SOM: $50M -- validation required before this figure can inform a go/no-go decision."
  );
  assert.equal(level, "validationRequired");
});

// --- 3. Required test matrix: TAM/SAM/SOM cascade (unresolved SAM/SOM) ---

test("TASK #44: unresolved SAM/SOM -- resolveMarketSizingCascade (the single canonical nesting rule shared by web and PDF) never marks SAM/SOM resolved when TAM itself is missing, and never fabricates a numeric relationship", async () => {
  const { resolveMarketSizingCascade } = await import("../app/lib/report-presentation.ts");
  const cascade = resolveMarketSizingCascade([null, 375_000_000, 50_000_000]);
  assert.equal(cascade.tamResolved, false);
  assert.equal(cascade.samResolved, false, "SAM must not resolve when its parent TAM is missing, even though SAM's own number parsed fine");
  assert.equal(cascade.somResolved, false);
  assert.equal(cascade.allResolved, false);
});

test("TASK #44: an out-of-order SAM (greater than TAM) is rejected -- a numerically-present value is not treated as resolved just because a number exists", async () => {
  const { resolveMarketSizingCascade } = await import("../app/lib/report-presentation.ts");
  const cascade = resolveMarketSizingCascade([1_000_000_000, 2_000_000_000, 50_000_000]);
  assert.equal(cascade.tamResolved, true);
  assert.equal(cascade.samResolved, false, "SAM > TAM must never resolve as valid nesting");
  assert.equal(cascade.somResolved, false);
});

test("TASK #44: a fully resolved and correctly nested TAM >= SAM >= SOM cascade resolves all three layers", async () => {
  const { resolveMarketSizingCascade } = await import("../app/lib/report-presentation.ts");
  const cascade = resolveMarketSizingCascade([1_500_000_000, 375_000_000, 50_000_000]);
  assert.equal(cascade.allResolved, true);
});

test("TASK #44: missing CAGR at the section level -- resolveCagrHeadlinePresentation returns an empty display value (never an invented figure) when the content has no percentage at all", async () => {
  const { resolveCagrHeadlinePresentation } = await import("../app/lib/report-presentation.ts");
  const presentation = resolveCagrHeadlinePresentation("This market has no disclosed growth rate at this time.");
  assert.equal(presentation.displayValue, "");
});

test("TASK #44: multiple conflicting CAGR figures in the same content resolve to a range, not a single fabricated average or an arbitrarily chosen one", async () => {
  const { resolveCagrHeadlinePresentation } = await import("../app/lib/report-presentation.ts");
  const presentation = resolveCagrHeadlinePresentation("Estimates range from 18% to 26% depending on the source cited.");
  assert.equal(presentation.isMultiEstimate, true);
  assert.match(presentation.displayValue, /18\.0%–26\.0%/);
});

// --- 4. Required test matrix: recommendation numeric fields ----------

test("TASK #44: recommendation budget/timeline/success metric remain clearly distinguishable from externally verified evidence via the provenance suffix, in all 3 render sites identically", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /numericAssumptionSuffix/, `${name}: expected the provenance suffix to be computed`);
    assert.match(source, /\{ label: "Timeline", value: timeframe \? `\$\{timeframe\}\$\{numericAssumptionSuffix\}` : "" \}|\["Timeline", timeframe \? `\$\{timeframe\}\$\{numericAssumptionSuffix\}` : ""\]/, `${name}: Timeline must carry the provenance suffix`);
    assert.match(source, /\{ label: "Budget", value: budget \? `\$\{budget\}\$\{numericAssumptionSuffix\}` : "" \}|\["Budget", budget \? `\$\{budget\}\$\{numericAssumptionSuffix\}` : ""\]/, `${name}: Budget must carry the provenance suffix`);
    assert.match(source, /\{ label: "Success Metric", value: metric \? `\$\{metric\}\$\{numericAssumptionSuffix\}` : "" \}|\["Success Metric", metric \? `\$\{metric\}\$\{numericAssumptionSuffix\}` : ""\]/, `${name}: Success Metric must carry the provenance suffix`);
  }
});

test("TASK #44: recommendation budget/timeline/success metric never leak into each other, exercised through the real, shared extractRecommendationSignals function", async () => {
  const { extractRecommendationSignals } = await import("../app/lib/report-presentation.ts");
  const signals = extractRecommendationSignals(
    "(Owner: Head of Sales Ops) — Budget ceiling USD 75,000 (Assumption); Timeline: 90 days; Success criterion: 3 signed LOIs; Evidence tie: addresses SAM/SOM gap."
  );
  assert.equal(signals.owner, "Head of Sales Ops");
  assert.match(signals.budget, /^USD 75,000/);
  assert.equal(signals.timeframe, "90 days");
  assert.equal(signals.metric, "3 signed LOIs");
  assert.equal(signals.evidenceTie, "addresses SAM/SOM gap");
});

// --- 5. Required test matrix: numeric format coverage ----------------

test("TASK #44: numeric values containing commas, decimals, %, $, ranges, and >= / <= all survive extraction completely, never partially clipped", async () => {
  const { extractRecommendationSignals } = await import("../app/lib/report-presentation.ts");

  const commaDecimal = extractRecommendationSignals("Owner: Head of Sales; Budget cap: $1,234,567.89.");
  assert.match(commaDecimal.budget, /^\$1,234,567\.89/);

  const geSignal = extractRecommendationSignals("Success criterion: >= 15.5% market penetration; Owner: Head of Sales.");
  assert.match(geSignal.metric, />= 15\.5%/);

  const leSignal = extractRecommendationSignals("Success criterion: churn <= 5%; Owner: Head of Sales.");
  assert.match(leSignal.metric, /<= 5%/);

  const dollarRange = extractRecommendationSignals("Owner: Head of Sales; Budget cap: $2.1M-$2.8M.");
  assert.match(dollarRange.budget, /^\$2\.1M-\$2\.8M/);
});

// --- 6. Web/PDF parity ------------------------------------------------

test("TASK #44 (web/PDF parity): Market Size/CAGR/TAM-SAM-SOM evidence classification is read from the SAME shared, exported functions in report-presentation.ts by every render site -- they cannot structurally diverge", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
  ]) {
    assert.match(
      source,
      /deriveMarketSizeMetricEvidenceLevel/,
      `${name}: expected the canonical, shared evidence-level function to be used`
    );
  }
  assert.match(pdfButtonSource, /resolveMarketSizingCascade|constrainMarketSizingResolutionToCanonicalState/, "ReportPdfButton.tsx: expected the canonical TAM/SAM/SOM cascade to be used");
});

test("TASK #44 (web/PDF parity): all 3 render sites import extractRecommendationSignals from the single shared module -- Owner/Budget/Timeline/Success Metric/Evidence Tie extraction cannot diverge between web and PDF", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /\bextractRecommendationSignals\b[\s\S]{0,700}from "@\/app\/lib\/report-presentation"/, `${name}: must import the real, shared extractRecommendationSignals`);
  }
});

// --- 7. Canonical decision/confidence/evidence-gap methodology unchanged ---

test("TASK #44 (requirement 8, drift check): assessMarketEntryConfidence's blended-decision thresholds and evidence-gap cap are structurally unchanged -- this ticket only touches numeric-field EXTRACTION/classification, never how the decision or confidence score itself is computed", async () => {
  const marketIntelligencePresentationSource = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketIntelligencePresentationSource, /export function assessMarketEntryConfidence\(/);
  assert.match(marketIntelligencePresentationSource, /marketConfidence\s*\*\s*0\.4/);
  assert.match(marketIntelligencePresentationSource, /competitiveEvidence\s*\*\s*0\.25/);
  assert.match(marketIntelligencePresentationSource, /financialEvidence\s*\*\s*0\.2/);
  assert.match(marketIntelligencePresentationSource, /productEvidence\s*\*\s*0\.15/);
});

test("TASK #44 (requirement 8, drift check): resolveMarketIntelligenceConfidenceState and the evidence-gap resolution pipeline remain exported and unmodified in structure", async () => {
  const evidenceGapsSource = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-evidence-gaps.ts", import.meta.url),
    "utf8"
  );
  assert.match(evidenceGapsSource, /export function resolveMarketIntelligenceConfidenceState\(/);
  assert.match(evidenceGapsSource, /export function resolveMarketIntelligenceEvidenceGaps\(/);
  assert.match(evidenceGapsSource, /export function resolveMarketIntelligenceDecisionThresholds\(/);
});

// --- STRUCTURAL AUDIT: canonical field-boundary rule for recommendations ---

test("STRUCTURAL AUDIT: recommendationFieldClauseDashStop (Task #44's own fix) requires whitespace adjacency before treating an em/en dash as a field boundary -- a compact numeric range's own internal dash can never satisfy it", () => {
  const fnMatch = reportPresentationSource.match(/export function extractRecommendationSignals\([\s\S]*?\n\}/);
  assert.ok(fnMatch, "expected to find extractRecommendationSignals's own function body");
  assert.match(fnMatch[0], /recommendationFieldClauseDashStop/);
  assert.ok(
    fnMatch[0].includes("(?<=\\\\s)[—–]") && fnMatch[0].includes("[—–](?=\\\\s)"),
    "expected the dash stop to require whitespace immediately before or after it"
  );
});

test("STRUCTURAL AUDIT: report-evidence.ts's negatedVerifiedPattern (Task #44's second fix) is checked by BOTH inferEvidenceLevel and normalizeEvidenceLevel, so neither classifier can independently regress", () => {
  const reportEvidenceSource = readFileSync(new URL("../app/lib/report-evidence.ts", import.meta.url), "utf8");
  assert.match(reportEvidenceSource, /const negatedVerifiedPattern =/);
  const occurrences = (reportEvidenceSource.match(/negatedVerifiedPattern\.test\(/g) || []).length;
  assert.equal(occurrences, 2, `expected negatedVerifiedPattern.test( to be called from both normalizeEvidenceLevel and inferEvidenceLevel, found ${occurrences}`);
});
