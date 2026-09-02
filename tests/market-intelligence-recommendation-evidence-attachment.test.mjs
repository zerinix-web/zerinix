import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// TASK #29I -- Attach Evidence metadata to its parent Strategic
// Recommendation instead of rendering it as a separate ACTION card.
//
// ROOT CAUSE: Task #29H's recommendationFieldLabelPattern (the merge
// rule that keeps a recommendation's own bulleted/marker-less metadata
// sub-lines attached to whichever recommendation is already open)
// covered "Evidence tie:"/"Evidence to collect:"/"Evidence link:" but
// NOT a bare "Evidence:" label (or "Evidence basis:"/"Supporting
// evidence:", the same semantic field under other real wordings). A line
// like "Evidence: vendor AI claims and buyer concern over accuracy."
// therefore fell through the field-label check, was treated as the
// start of a brand-new top-level recommendation, and was promoted to its
// own numbered "ACTION" card immediately after the real recommendation
// it was actually evidence FOR.
//
// FIX (structural, not the observed exact sentences): extended
// recommendationFieldLabelPattern (the merge-loop classifier) and
// extractRecommendationSignals's evidenceTie extraction to recognize the
// whole "Evidence" label family generically -- a bare "Evidence:", or
// "Evidence" followed by "tie"/"to collect"/"link"/"basis", plus
// "Supporting evidence:" as a wholly separate alternative. Neither
// change can ever re-capture the separate, already-excluded "Evidence
// cited:"/"Evidence collected:" citation-footer shape (Task #29E),
// which has a non-whitespace word ("cited"/"collected") directly after
// "Evidence " that satisfies neither the bare-colon form nor any of the
// four recognized suffixes.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
// TASK #29J -- isRecommendationHeadingLine/isMetadataOnlyRecommendationLine/
// isEvidenceStatusDisclaimerLine/extractRecommendationItems/
// extractRecommendationSignals/recommendationOwnerRolePattern were
// consolidated into this single shared module; all three surfaces above
// now import them rather than defining their own copies.
const reportPresentationSource = readFileSync(
  new URL("../app/lib/report-presentation.ts", import.meta.url),
  "utf8"
);

const surfaces = [
  ["ReportPdfButton.tsx", pdfButtonSource],
  ["Planner.tsx", plannerSource],
  ["page.tsx", pageSource],
];

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
  while (source[i] !== "{") {
    i += 1;
  }

  let braceDepth = 0;
  do {
    if (source[i] === "{") braceDepth += 1;
    else if (source[i] === "}") braceDepth -= 1;
    i += 1;
  } while (braceDepth > 0);

  return source.slice(start, i);
}

async function compileModule(pieces, exportNames) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-recommendation-evidence-"));
  const outPath = join(dir, "module.ts");
  const body = pieces.join("\n\n");
  writeFileSync(outPath, `${body}\n\nexport { ${exportNames.join(", ")} };\n`);
  return import(pathToFileURL(outPath).href);
}

async function compileRecommendationHelpers(source) {
  // TASK #29J -- these 5 functions/const now live solely in
  // report-presentation.ts (see reportPresentationSource above); `source`
  // (the calling surface's own file) is accepted for the caller's own
  // labeling/looping but no longer used for extraction -- it's asserted
  // elsewhere that each surface actually imports these names rather than
  // redefining them.
  void source;
  const recommendationOwnerRolePatternMatch = reportPresentationSource.match(/export const recommendationOwnerRolePattern =\s*\n[\s\S]*?;/);
  assert.ok(recommendationOwnerRolePatternMatch, "recommendationOwnerRolePattern not found");
  const isRecommendationHeadingLine = extractFunctionSource(reportPresentationSource, "isRecommendationHeadingLine");
  const isMetadataOnlyRecommendationLine = extractFunctionSource(reportPresentationSource, "isMetadataOnlyRecommendationLine");
  const isEvidenceStatusDisclaimerLine = extractFunctionSource(reportPresentationSource, "isEvidenceStatusDisclaimerLine");
  const extractRecommendationItems = extractFunctionSource(reportPresentationSource, "extractRecommendationItems");
  const extractRecommendationSignals = extractFunctionSource(reportPresentationSource, "extractRecommendationSignals");
  // TASK #43A -- extractRecommendationSignals now protects each
  // label-based field's own known abbreviations (protect/restore-
  // SentenceAbbreviations, both module-private to report-presentation.ts)
  // before applying its `\.\s`-based terminator, so this isolated
  // harness must provide the same two real helpers.
  const protectSentenceAbbreviations = extractFunctionSource(reportPresentationSource, "protectSentenceAbbreviations");
  const restoreSentenceAbbreviations = extractFunctionSource(reportPresentationSource, "restoreSentenceAbbreviations");
  return compileModule(
    [
      'const SENTENCE_ABBREVIATIONS = ["U.S.", "Inc.", "Corp.", "Ltd.", "e.g.", "i.e.", "vs.", "etc."];',
      recommendationOwnerRolePatternMatch[0],
      isRecommendationHeadingLine,
      isMetadataOnlyRecommendationLine,
      isEvidenceStatusDisclaimerLine,
      extractRecommendationItems,
      protectSentenceAbbreviations,
      restoreSentenceAbbreviations,
      extractRecommendationSignals,
    ],
    ["extractRecommendationItems", "extractRecommendationSignals"]
  );
}

// TASK #29J -- each surface must consume the shared module's functions
// via import, never redefine its own copy again.
for (const [label, source] of surfaces) {
  test(`${label}: imports extractRecommendationItems/extractRecommendationSignals from the shared report-presentation module instead of defining its own copy`, () => {
    assert.match(source, /\bextractRecommendationItems\b[\s\S]{0,700}from "@\/app\/lib\/report-presentation"/);
    assert.match(source, /\bextractRecommendationSignals\b[\s\S]{0,700}from "@\/app\/lib\/report-presentation"/);
    assert.doesNotMatch(source, /^function extractRecommendationItems\(/m, `${label}: must not redefine extractRecommendationItems locally`);
    assert.doesNotMatch(source, /^function extractRecommendationSignals\(/m, `${label}: must not redefine extractRecommendationSignals locally`);
  });
}

// The ticket's exact reported shape: a decision line, then 3 genuine
// recommendations, 2 of which are immediately followed by a bare
// "Evidence: ..." line that must attach to them, not become its own card.
const REAL_SHAPE_CONTENT = [
  "Current Decision: MONITOR",
  "1) Pricing validation sprint — Owner: Head of Sales; Budget: $40,000; KPI: 30 qualified conversations.",
  "2) Pilot validation for accuracy",
  "- Owner: Head of Product",
  "- Budget: $60,000",
  "- KPI: 90% extraction accuracy on benchmark set",
  "Evidence: vendor AI claims and buyer concern over accuracy.",
  "3) Mid-market account mapping",
  "- Owner: Head of BD",
  "- Budget: $15,000",
  "- Success criterion: 200 target accounts mapped with contact data",
  "Evidence: Census establishment counts support target mapping.",
].join("\n");

// =========================================================================
// 1. Evidence metadata attaches to its parent recommendation; 2. never
//    creates a numbered ACTION.
// =========================================================================

for (const [label, source] of surfaces) {
  test(`${label}: a bare "Evidence: ..." line attaches to (is preserved as evidence on) its immediately preceding recommendation, never becomes its own item`, async () => {
    const mod = await compileRecommendationHelpers(source);
    const items = mod.extractRecommendationItems(REAL_SHAPE_CONTENT);

    assert.ok(
      !items.some((item) => /^Evidence\s*:/i.test(item)),
      `${label}: no item may be a bare "Evidence:" line on its own, got ${JSON.stringify(items)}`
    );

    const pilotAction = items.find((item) => item.startsWith("Pilot validation for accuracy"));
    assert.ok(pilotAction, `${label}: Pilot validation for accuracy recommendation missing`);
    assert.match(pilotAction, /Evidence:\s*vendor AI claims and buyer concern over accuracy\.?$/);

    const mappingAction = items.find((item) => item.startsWith("Mid-market account mapping"));
    assert.ok(mappingAction, `${label}: Mid-market account mapping recommendation missing`);
    assert.match(mappingAction, /Evidence:\s*Census establishment counts support target mapping\.?$/);
  });

  test(`${label}: "Evidence basis:" and "Supporting evidence:" (the same semantic field under other real wordings) also attach, never becoming their own ACTION -- not a brittle exact-string fix for only "Evidence:"`, async () => {
    const mod = await compileRecommendationHelpers(source);
    const content = [
      "1) Real action — Owner: Head of Sales; Budget: $10,000.",
      "Evidence basis: three independent vendor case studies.",
      "2) Another real action — Owner: Head of Product; Budget: $20,000.",
      "Supporting evidence: internal pilot data from Q2.",
    ].join("\n");
    const items = mod.extractRecommendationItems(content);

    assert.ok(!items.some((item) => /^Evidence basis\s*:/i.test(item)), `${label}: "Evidence basis:" must never be its own item`);
    assert.ok(!items.some((item) => /^Supporting evidence\s*:/i.test(item)), `${label}: "Supporting evidence:" must never be its own item`);
    assert.equal(items.length, 2, `${label}: expected exactly 2 grouped recommendations, got ${JSON.stringify(items)}`);
    assert.match(items[0], /Evidence basis: three independent vendor case studies\.?$/);
    assert.match(items[1], /Supporting evidence: internal pilot data from Q2\.?$/);
  });
}

// =========================================================================
// 3. Action count is based only on genuine recommendations.
// =========================================================================

for (const [label, source] of surfaces) {
  test(`${label}: action count reflects only the 3 genuine recommendations plus the Current Decision line -- never inflated to 5 by the 2 Evidence lines`, async () => {
    const mod = await compileRecommendationHelpers(source);
    const items = mod.extractRecommendationItems(REAL_SHAPE_CONTENT);
    assert.equal(items.length, 4, `${label}: expected exactly 4 items (Current Decision + 3 recommendations), got ${items.length}: ${JSON.stringify(items)}`);
  });
}

// =========================================================================
// 4. Owner/Budget/KPI/Success/Timeline grouping still works (Task #29H,
//    unaffected by this change).
// =========================================================================

for (const [label, source] of surfaces) {
  test(`${label}: Owner/Budget/KPI grouping from Task #29H remains completely intact alongside the new Evidence attachment`, async () => {
    const mod = await compileRecommendationHelpers(source);
    const items = mod.extractRecommendationItems(REAL_SHAPE_CONTENT);

    const pilotAction = items.find((item) => item.startsWith("Pilot validation for accuracy"));
    const signals = mod.extractRecommendationSignals(pilotAction);
    assert.equal(signals.owner, "Head of Product");
    assert.equal(signals.budget, "$60,000");
    assert.match(signals.metric, /90%/);
    assert.equal(signals.evidenceTie, "vendor AI claims and buyer concern over accuracy");
  });

  test(`${label}: isEvidenceStatusDisclaimerLine's pre-existing "Evidence cited:"/"Evidence collected:" citation-footer exclusion (Task #29E) is never affected by the new Evidence field-label recognition`, async () => {
    const mod = await compileRecommendationHelpers(source);
    const content = [
      "1) Real action — Owner: Head of Sales; Budget: $10,000; KPI: 5 leads.",
      "Evidence: a genuine per-action evidence note.",
      "2) Another action — Owner: Head of Product; Budget: $20,000; KPI: 3 pilots.",
      "Evidence cited: [R1][R2][R3].",
    ].join("\n");
    const items = mod.extractRecommendationItems(content);
    assert.ok(!items.some((item) => /^Evidence cited\s*:/i.test(item)), `${label}: the citation footer must remain excluded, not merged as evidence`);
    assert.ok(items.some((item) => item.includes("Evidence: a genuine per-action evidence note")), `${label}: the real per-action evidence note must still attach`);
  });
}

// =========================================================================
// 5. Multiple recommendations keep the correct evidence association (no
//    cross-attachment).
// =========================================================================

for (const [label, source] of surfaces) {
  test(`${label}: each recommendation's Evidence line attaches to ITS OWN recommendation, never to a different one`, async () => {
    const mod = await compileRecommendationHelpers(source);
    const items = mod.extractRecommendationItems(REAL_SHAPE_CONTENT);

    const pilotAction = items.find((item) => item.startsWith("Pilot validation for accuracy"));
    const mappingAction = items.find((item) => item.startsWith("Mid-market account mapping"));

    assert.doesNotMatch(pilotAction, /Census establishment counts/, `${label}: the mapping recommendation's evidence must not leak into the pilot recommendation`);
    assert.doesNotMatch(mappingAction, /vendor AI claims/, `${label}: the pilot recommendation's evidence must not leak into the mapping recommendation`);

    // The first recommendation (no Evidence line in the source) must not
    // pick up either of the other two's evidence.
    const pricingAction = items.find((item) => item.startsWith("Pricing validation sprint"));
    assert.ok(pricingAction, `${label}: Pricing validation sprint recommendation missing`);
    assert.doesNotMatch(pricingAction, /vendor AI claims|Census establishment counts/, `${label}: a recommendation with no evidence line of its own must not inherit another's`);
  });
}

// =========================================================================
// 6. UI and PDF produce the same recommendation grouping.
// =========================================================================

test("UI (page.tsx) and PDF (ReportPdfButton.tsx, Planner.tsx) all produce IDENTICAL grouped recommendation arrays, including Evidence attachment, for the same real observed content", async () => {
  const results = {};
  for (const [label, source] of surfaces) {
    const mod = await compileRecommendationHelpers(source);
    results[label] = mod.extractRecommendationItems(REAL_SHAPE_CONTENT);
  }
  assert.deepEqual(results["ReportPdfButton.tsx"], results["Planner.tsx"]);
  assert.deepEqual(results["ReportPdfButton.tsx"], results["page.tsx"]);
});

test("UI and PDF also agree on the extracted evidenceTie field VALUE for the same grouped card", async () => {
  const values = {};
  for (const [label, source] of surfaces) {
    const mod = await compileRecommendationHelpers(source);
    const items = mod.extractRecommendationItems(REAL_SHAPE_CONTENT);
    const pilotAction = items.find((item) => item.startsWith("Pilot validation for accuracy"));
    values[label] = mod.extractRecommendationSignals(pilotAction).evidenceTie;
  }
  assert.equal(values["ReportPdfButton.tsx"], "vendor AI claims and buyer concern over accuracy");
  assert.equal(values["ReportPdfButton.tsx"], values["Planner.tsx"]);
  assert.equal(values["ReportPdfButton.tsx"], values["page.tsx"]);
});

// =========================================================================
// 7. MONITOR remains unchanged; canonical state and other sections untouched.
// =========================================================================

test("REGRESSION: 'Current Decision: MONITOR' survives verbatim as its own card, unaffected by the Evidence-attachment fix", async () => {
  for (const [, source] of surfaces) {
    const mod = await compileRecommendationHelpers(source);
    const items = mod.extractRecommendationItems(REAL_SHAPE_CONTENT);
    assert.ok(items.includes("Current Decision: MONITOR"));
  }
});

test("DRIFT CHECK: canonical Main Risk, confidence factors, CAGR fallback, decision derivation, and TAM/SAM/SOM cascade all remain present and untouched by this ticket's changes", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/);
    assert.match(source, /resolveMarketSizingCascade\(/);
    assert.match(source, /constrainMarketSizingResolutionToCanonicalState\(/);
    assert.match(source, /A CAGR percentage was not stated in this report's own sources\. This value is marked Validation Required until it can be confirmed\./);
  }
  assert.match(plannerSource, /marketIntelligenceCanonicalState\?\.topRisks\?\.\[0\]/);
  assert.match(pdfButtonSource, /readMarketIntelligenceCanonicalState\(report\.metadata\)\?\.topRisks\?\.\[0\]/);
});

// =========================================================================
// Legacy prose reports remain safely renderable (unaffected by this
// ticket -- the fallback path for content with no bullet/number markers
// at all is untouched).
// =========================================================================

for (const [label, source] of surfaces) {
  test(`${label}: a genuinely legacy, marker-free PROSE recommendation (no bullets or numbers) still renders via the unaffected sentence-split fallback`, async () => {
    const mod = await compileRecommendationHelpers(source);
    const legacyProse =
      "We recommend entering this market cautiously. A pilot program should be launched within the next two quarters to validate demand.";
    const items = mod.extractRecommendationItems(legacyProse);
    assert.ok(items.length > 0, `${label}: legacy prose must still produce renderable items`);
  });
}
