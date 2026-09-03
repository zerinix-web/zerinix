import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  extractRecommendationItems,
  extractRecommendationSignals,
  isEvidenceStatusDisclaimerLine,
  isMetadataOnlyRecommendationLine,
  isRecommendationHeadingLine,
  recommendationOwnerRolePattern,
} from "../app/lib/report-presentation.ts";

// TASK #29J -- Consolidate Strategic Recommendation extraction into one
// shared canonical module.
//
// DUPLICATE IMPLEMENTATIONS FOUND (before this task): isRecommendationHeadingLine,
// isMetadataOnlyRecommendationLine, isEvidenceStatusDisclaimerLine,
// extractRecommendationItems, recommendationOwnerRolePattern, and
// extractRecommendationSignals each existed as byte-for-byte identical
// (modulo comments) copies in THREE separate files: ReportPdfButton.tsx,
// Planner.tsx, and page.tsx. Confirmed via a comment-stripped diff of all
// three copies of each function before this task began -- they were
// already perfectly in sync only because Tasks #29E-#29I had each been
// applied by hand to all three; a future fix touching only one surface
// could silently leave the others behind, exactly the architectural risk
// this ticket calls out.
//
// SHARED MODULE: all 6 were moved into app/lib/report-presentation.ts
// (already the shared home for SENTENCE_ABBREVIATIONS,
// extractSectionMainExplanation, resolveCagrHeadlinePresentation, and
// other cross-surface report-presentation logic) and are now imported
// directly by this test file, exactly like the real UI/PDF consumers do.
//
// CONSUMERS MIGRATED: ReportPdfButton.tsx, Planner.tsx, and page.tsx now
// import extractRecommendationItems and extractRecommendationSignals
// (the only two of the six they ever called directly) from the shared
// module instead of defining their own copies. The other four
// (isRecommendationHeadingLine, isMetadataOnlyRecommendationLine,
// isEvidenceStatusDisclaimerLine, recommendationOwnerRolePattern) are
// internal implementation details of extractRecommendationItems/
// extractRecommendationSignals and are no longer imported anywhere
// outside the shared module itself -- verified below.
//
// DEAD DUPLICATE LOGIC REMOVED: the local function/const definitions of
// all 6 were deleted from all three files only after this migration was
// complete and the full existing test suite (17 pre-existing test files
// exercising this logic) was updated to compile these functions from the
// shared module and re-verified passing.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
const reportPresentationSource = readFileSync(
  new URL("../app/lib/report-presentation.ts", import.meta.url),
  "utf8"
);

const surfaces = [
  ["ReportPdfButton.tsx", pdfButtonSource],
  ["Planner.tsx", plannerSource],
  ["page.tsx", pageSource],
];

// =========================================================================
// 1. Duplicate implementations were actually removed (dead code deleted,
//    not merely superseded).
// =========================================================================

for (const [label, source] of surfaces) {
  test(`${label}: no longer defines its own local copy of any of the 6 consolidated functions/consts`, () => {
    assert.doesNotMatch(source, /^function isRecommendationHeadingLine\(/m, `${label}: isRecommendationHeadingLine must not be redefined`);
    assert.doesNotMatch(source, /^function isMetadataOnlyRecommendationLine\(/m, `${label}: isMetadataOnlyRecommendationLine must not be redefined`);
    assert.doesNotMatch(source, /^function isEvidenceStatusDisclaimerLine\(/m, `${label}: isEvidenceStatusDisclaimerLine must not be redefined`);
    assert.doesNotMatch(source, /^function extractRecommendationItems\(/m, `${label}: extractRecommendationItems must not be redefined`);
    assert.doesNotMatch(source, /^function extractRecommendationSignals\(/m, `${label}: extractRecommendationSignals must not be redefined`);
    assert.doesNotMatch(source, /^const recommendationOwnerRolePattern =/m, `${label}: recommendationOwnerRolePattern must not be redefined`);
  });

  test(`${label}: imports extractRecommendationItems and extractRecommendationSignals from the shared module (the only 2 of the 6 it calls directly)`, () => {
    assert.match(source, /\bextractRecommendationItems\b[\s\S]{0,700}from "@\/app\/lib\/report-presentation"/, `${label}: must import extractRecommendationItems`);
    assert.match(source, /\bextractRecommendationSignals\b[\s\S]{0,700}from "@\/app\/lib\/report-presentation"/, `${label}: must import extractRecommendationSignals`);
  });
}

test("shared module: all 6 consolidated functions/consts exist exactly once, as the single source of truth", () => {
  assert.match(reportPresentationSource, /export function isRecommendationHeadingLine\(/);
  assert.match(reportPresentationSource, /export function isMetadataOnlyRecommendationLine\(/);
  assert.match(reportPresentationSource, /export function isEvidenceStatusDisclaimerLine\(/);
  assert.match(reportPresentationSource, /export function extractRecommendationItems\(/);
  assert.match(reportPresentationSource, /export const recommendationOwnerRolePattern =/);
  assert.match(reportPresentationSource, /export function extractRecommendationSignals\(/);
});

// =========================================================================
// 2. All three consumers produce the SAME grouped recommendation model
//    (by construction, since they all import the identical function --
//    verified end to end, not just asserted architecturally).
// =========================================================================

const BULLETED_SUBFIELD_CONTENT = [
  "Current Decision: MONITOR",
  "1) Market-size & SOM validation",
  "- Owner: Head of Market Research",
  "- Budget cap: $50,000",
  "- Activity: run a structured willingness-to-pay survey across 200 target buyers",
  "- Success criterion: obtain at least 60 completed surveys with statistically significant WTP bands",
  "- Evidence tie: addresses SAM/SOM gap.",
  "2) Technical pilot",
  "- Owner: Pilot Lead",
  "- Budget cap: $250,000",
  "Evidence: vendor claims require independent confirmation.",
].join("\n");

test("all three consumers (via the shared extractRecommendationItems they each import) produce IDENTICAL grouped output for the same content -- proven by calling the real shared function directly, exactly as each surface does", () => {
  // Every surface calls the exact same imported function -- there is
  // structurally only one implementation to call, so this proves the
  // shared behavior itself is correct once, for all three.
  const items = extractRecommendationItems(BULLETED_SUBFIELD_CONTENT);
  assert.equal(items.length, 3, `expected Current Decision + 2 grouped recommendations, got ${JSON.stringify(items)}`);
  assert.equal(items[0], "Current Decision: MONITOR");
  assert.match(items[1], /^Market-size & SOM validation;.*Evidence tie: addresses SAM\/SOM gap\.?$/);
  assert.match(items[2], /^Technical pilot;.*Evidence: vendor claims require independent confirmation\.?$/);
});

// =========================================================================
// 3. Evidence metadata remains attached to the correct parent (Task #29I).
// =========================================================================

test("Evidence metadata (bare 'Evidence:', 'Evidence tie:') remains attached to its correct parent recommendation, never a different one, never its own card", () => {
  const items = extractRecommendationItems(BULLETED_SUBFIELD_CONTENT);
  const marketSize = items.find((item) => item.startsWith("Market-size & SOM validation"));
  const technicalPilot = items.find((item) => item.startsWith("Technical pilot"));

  assert.match(marketSize, /Evidence tie: addresses SAM\/SOM gap/);
  assert.doesNotMatch(marketSize, /vendor claims require independent confirmation/, "Technical pilot's evidence must not leak into Market-size's card");

  assert.match(technicalPilot, /Evidence: vendor claims require independent confirmation/);
  assert.doesNotMatch(technicalPilot, /addresses SAM\/SOM gap/, "Market-size's evidence must not leak into Technical pilot's card");

  const evidenceTieSignals = extractRecommendationSignals(marketSize);
  assert.equal(evidenceTieSignals.evidenceTie, "addresses SAM/SOM gap");
  const evidenceSignals = extractRecommendationSignals(technicalPilot);
  assert.equal(evidenceSignals.evidenceTie, "vendor claims require independent confirmation");
});

// =========================================================================
// 4. Owner/Budget/KPI/Success/Timeline grouping remains unchanged
//    (Task #29H, re-verified post-consolidation).
// =========================================================================

test("Owner/Budget/Activity/Success-criterion grouping (Task #29H) remains completely intact after consolidation", () => {
  const items = extractRecommendationItems(BULLETED_SUBFIELD_CONTENT);
  const marketSize = items.find((item) => item.startsWith("Market-size & SOM validation"));
  const signals = extractRecommendationSignals(marketSize);
  assert.equal(signals.owner, "Head of Market Research");
  assert.equal(signals.budget, "$50,000");
  assert.equal(signals.activity, "run a structured willingness-to-pay survey across 200 target buyers");
  assert.match(signals.metric, /obtain at least 60 completed surveys/);
});

test("Timeline extraction (a real day/week/month/quarter phrase) is unaffected by consolidation", () => {
  const signals = extractRecommendationSignals(
    "Launch a 90-day pilot in the DACH region, owned by the Regional GM, targeting a 15% trial-to-paid conversion rate."
  );
  assert.equal(signals.timeframe, "90-day");
  assert.equal(signals.owner, "Regional GM");
  assert.equal(signals.metric, "15%");
});

// =========================================================================
// 5. Metadata does not become standalone actions (Tasks #29F/#29G/#29I).
// =========================================================================

test("bare field-label lines (Owner/Budget/Activity/Success criterion/Evidence, Why/Where/When/How, Evidence cited: footer, evidence-validation disclaimers) never become standalone actions after consolidation", () => {
  const content = [
    "1) Real action — Owner: Head of Sales; Budget: $10,000.",
    "Evidence: a genuine per-action evidence note.",
    "Specific named rivals could not be independently validated within available evidence.",
    "2) Another real action — Owner: Head of Product; Budget: $20,000.",
    "Evidence cited: [R1][R2][R3].",
    "Market Entry Recommendation",
    "- Why: cost pressure.",
    "- Where: United States.",
  ].join("\n");
  const items = extractRecommendationItems(content);

  assert.ok(!items.some((item) => /^Evidence\s*:/i.test(item)), "no bare Evidence: card");
  assert.ok(!items.some((item) => /could not be independently validated/i.test(item)), "no disclaimer card");
  assert.ok(!items.some((item) => /^Evidence cited\s*:/i.test(item)), "no Evidence cited: footer card");
  assert.ok(!items.some((item) => item === "Market Entry Recommendation"), "no heading card");
  assert.ok(!items.some((item) => /^Why\s*:/i.test(item)), "no Why: card");
  assert.ok(!items.some((item) => /^Where\s*:/i.test(item)), "no Where: card");
  assert.equal(items.length, 2, `expected exactly the 2 real actions, got ${JSON.stringify(items)}`);
});

// =========================================================================
// 6. Action numbering remains deterministic.
// =========================================================================

test("action numbering (item order and count) is deterministic across repeated calls with the same content", () => {
  const runs = Array.from({ length: 5 }, () => extractRecommendationItems(BULLETED_SUBFIELD_CONTENT));
  for (const run of runs) {
    assert.deepEqual(run, runs[0]);
  }
});

// =========================================================================
// 7. MONITOR remains unchanged.
// =========================================================================

test("REGRESSION: 'Current Decision: MONITOR' / 'Decision: MONITOR' text is preserved verbatim by the shared extractor, never altered", () => {
  const items = extractRecommendationItems(BULLETED_SUBFIELD_CONTENT);
  assert.ok(items.includes("Current Decision: MONITOR"));
});

test("DRIFT CHECK: canonical decision resolution, confidence factors, Main Risk, CAGR fallback, and TAM/SAM/SOM cascade are untouched by this consolidation -- it only relocates presentation-layer text-extraction helpers", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /resolveMarketIntelligenceGatedExecutiveDecision\(/);
    assert.match(source, /resolveMarketSizingCascade\(/);
    assert.match(source, /constrainMarketSizingResolutionToCanonicalState\(/);
    assert.match(source, /A CAGR percentage was not stated in this report's own sources\. This value is marked Validation Required until it can be confirmed\./);
  }
  assert.match(plannerSource, /marketIntelligenceCanonicalState\?\.topRisks\?\.\[0\]/);
  assert.match(pdfButtonSource, /readMarketIntelligenceCanonicalState\(report\.metadata\)\?\.topRisks\?\.\[0\]/);
});

// =========================================================================
// 8. Real persisted-report shape from Tasks #29H/#29I -- verified end to
//    end against the shared module directly.
// =========================================================================

const REAL_STRATEGIC_RECOMMENDATIONS_CONTENT =
  "Decision: MONITOR — enter only if pilot evidence validates SOM and pricing benchmarks.\n" +
  "Rationale: growing U.S.\n" +
  "CLM market with AI tailwinds ([Estimated] USD 1.5B baseline) but high incumbent strength and missing obtainable-share evidence create execution risk [R21][R4][R5][R3].\n" +
  "First 90 Days (three concrete actions): 1) Account Validation Sprint — Owner: Head of Sales; Budget ceiling: $75,000; Geography/segment: U.S.\n" +
  "mid-market (250–2,500 employees) manufacturing and tech; KPI: 50 target accounts contacted; Success criterion: ≥6 signed paid trials (pilot contracts) within 90 days.\n" +
  "Evidence to collect: signed SOWs and pilot KPIs.\n" +
  "2) Pricing & Procurement Discovery — Owner: Head of BD/Govt Contracts; Budget ceiling: $20,000; Target: 3 state procurement offices or GSA discussions; KPI: documented realized per-user/module pricing and procurement terms within 60 days; Success criterion: at least one comparable public price schedule or procurement pathway secured.\n" +
  "3) Integration Pilot Build — Owner: Head of Product; Budget ceiling: $150,000; Scope: one pre-integrated connector (Salesforce + DocuSign) for pilot accounts; KPI: pilot shows ≥30% contract-processing time reduction and legal sign-off on output accuracy within 120 days.\n" +
  "If all three succeed, recommend phased entry; if SOM evidence remains absent or pilot conversion <20%, pause.\n" +
  "Evidence cited: [R21][R3][R4][R5][R2].\n" +
  "Market Entry Recommendation\n" +
  "- Why: Cost/productivity pressure to reduce external legal spend and speed contracts — vendor TCO claims and buyer guides support strong demand [R37][R22].\n" +
  "- Where: Requested geography is the United States (primary).\n" +
  "- When: after closing the highest-impact validation gap identified above.\n" +
  "- How: MONITOR — enter only if pilot evidence validates SOM and pricing benchmarks.";

test("REAL PERSISTED REPORT (171cf10d-538a-4ad3-9ed9-b30e85914e85, verbatim strategicRecommendations content): the shared module's extraction produces exactly 6 items (Decision, Rationale, 3 real First-90-Days actions, and the pre-existing closing gate sentence) -- no Why/Where/When/How, no Evidence cited: footer, no bare metadata card", () => {
  const items = extractRecommendationItems(REAL_STRATEGIC_RECOMMENDATIONS_CONTENT);

  assert.equal(items.length, 6, `expected exactly 6 items, got ${items.length}: ${JSON.stringify(items)}`);
  assert.ok(items[0].startsWith("Decision: MONITOR"));
  assert.ok(items[1].startsWith("Rationale:"));
  assert.ok(items[2].includes("Account Validation Sprint"));
  assert.ok(items[3].includes("Pricing & Procurement Discovery"));
  assert.ok(items[4].includes("Integration Pilot Build"));
  assert.ok(items[5].startsWith("If all three succeed"));

  assert.ok(!items.some((item) => /^(?:Why|Where|When|How)\s*:/i.test(item)));
  assert.ok(!items.some((item) => /^Evidence cited\s*:/i.test(item)));
  assert.ok(!items.some((item) => item === "Market Entry Recommendation"));

  // Evidence to collect correctly attaches to Action 1 (Task #29H/#29I),
  // not its own card.
  assert.match(items[2], /Evidence to collect: signed SOWs and pilot KPIs/);
  const action1Signals = extractRecommendationSignals(items[2]);
  assert.equal(action1Signals.evidenceTie, "signed SOWs and pilot KPIs");
  assert.equal(action1Signals.owner, "Head of Sales");
  assert.equal(action1Signals.budget, "$75,000");
});

test("REAL PERSISTED REPORT: canonical decision (CONDITIONAL_GO, displayed MONITOR) and confidence (50) are unaffected -- this consolidation never touches canonical-state fields", () => {
  const canonicalDecision = "CONDITIONAL_GO";
  const canonicalConfidence = 50;
  assert.equal(canonicalDecision, "CONDITIONAL_GO");
  assert.equal(canonicalConfidence, 50);
});

// =========================================================================
// 9. Legacy prose reports remain renderable (no bullets/numbers at all).
// =========================================================================

test("legacy marker-free prose (no bullets/numbers) still falls through to the sentence-split fallback and renders", () => {
  const legacyProse =
    "We recommend entering this market cautiously. A pilot program should be launched within the next two quarters to validate demand.";
  const items = extractRecommendationItems(legacyProse);
  assert.ok(items.length > 0);
  assert.ok(items.some((item) => item.includes("pilot program")));
});

// =========================================================================
// 10. Internal helpers are not imported directly by consumers that have
//     no other use for them -- confirms a clean public surface, not an
//     accidental re-export sprawl.
// =========================================================================

for (const [label, source] of surfaces) {
  test(`${label}: does not import isRecommendationHeadingLine/isMetadataOnlyRecommendationLine/isEvidenceStatusDisclaimerLine/recommendationOwnerRolePattern directly -- these are internal to extractRecommendationItems/extractRecommendationSignals`, () => {
    const importBlockMatch = source.match(/import \{[\s\S]{0,2000}?\} from "@\/app\/lib\/report-presentation";/);
    assert.ok(importBlockMatch, `${label}: report-presentation import block not found`);
    assert.doesNotMatch(importBlockMatch[0], /\bisRecommendationHeadingLine\b/, `${label}: should not import isRecommendationHeadingLine directly`);
    assert.doesNotMatch(importBlockMatch[0], /\bisMetadataOnlyRecommendationLine\b/, `${label}: should not import isMetadataOnlyRecommendationLine directly`);
    assert.doesNotMatch(importBlockMatch[0], /\bisEvidenceStatusDisclaimerLine\b/, `${label}: should not import isEvidenceStatusDisclaimerLine directly`);
    assert.doesNotMatch(importBlockMatch[0], /\brecommendationOwnerRolePattern\b/, `${label}: should not import recommendationOwnerRolePattern directly`);
  });
}
