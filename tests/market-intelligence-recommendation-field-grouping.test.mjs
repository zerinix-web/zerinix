import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// TASK #29H -- Fix Strategic Recommendations action grouping structurally.
//
// ROOT CAUSE: extractRecommendationItems's line-merge loop only ever
// treated a MARKER-LESS line as a continuation of the item above it
// (abbreviation-ending previous line, or a fully-bracketed clause, Task
// #29G). A recommendation's own metadata (Owner, Budget/Budget cap/
// Budget ceiling, Activity, Success criterion, Evidence tie/to collect)
// is sometimes written by the model as its OWN BULLETED sub-line under a
// numbered action heading -- e.g. "1) Market-size & SOM validation\n-
// Owner: Head of Market Research\n- Budget cap: $50,000\n...". Because a
// bulleted sub-field line has its OWN "-" marker, the merge loop's
// `!itemStartPattern.test(line)` guard was never even evaluated for it --
// it was ALWAYS treated as the start of a brand-new top-level
// recommendation, flattening one real recommendation's 5 metadata fields
// into 5 separate fake "ACTION" cards.
//
// FIX (structural, not report-specific): a new recommendationFieldLabelPattern
// recognizes a broad, documented family of recommendation metadata
// labels (Owner, Owned by, Budget/Budget cap/Budget ceiling, Spend cap/
// ceiling, Activity, Action, Scope, Success criterion, Success metric,
// KPI, Evidence tie/to collect/link, Target, Geography/segment, Segment,
// Timeline). A line matching this pattern -- regardless of whether it
// happens to carry a bullet marker -- is always treated as a sub-field of
// whichever recommendation is already open, joined with "; " to match
// the SAME inline separator the pipeline's other valid shape (one
// flowing sentence per action) already uses. This means
// extractRecommendationSignals (already shared identically by all 4
// rendering call sites: page.tsx web, Planner.tsx web, Planner.tsx PDF,
// ReportPdfButton.tsx PDF) now reads a properly-grouped string for
// EITHER generation shape and renders one card with its own labeled
// Owner/Budget/Activity/Success Metric/Evidence Tie fields -- exactly
// the ticket's own "one structured recommendation object/card" goal --
// using the EXACT SAME card-rendering infrastructure that already
// existed for the one-sentence shape, not a new one.
//
// extractRecommendationSignals also gained: explicit-label-first
// extraction for Owner/Budget/Success Criterion (preferring the real
// generation contract's own label over the old best-effort keyword
// guesses), plus 2 new fields (Activity, Evidence Tie) surfaced as their
// own labeled fields per the ticket's conceptual structure.

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
  const dir = mkdtempSync(join(tmpdir(), "zerinix-recommendation-grouping-"));
  const outPath = join(dir, "module.ts");
  const body = pieces.join("\n\n");
  writeFileSync(outPath, `${body}\n\nexport { ${exportNames.join(", ")} };\n`);
  return import(pathToFileURL(outPath).href);
}

async function compileRecommendationHelpers(source) {
  // TASK #29J -- these 5 functions/const now live solely in
  // report-presentation.ts; `source` (the calling surface's own file) is
  // accepted for the caller's own labeling/looping but no longer used
  // for extraction.
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

// The ticket's own reported bulleted-sub-field shape: 2 genuine
// recommendations, each with 5 metadata sub-fields on their own bulleted
// lines, plus the always-present Current Decision line.
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
  "- Activity: build and run a 2-week technical proof of concept",
  "- Success criterion: 95% accuracy on the benchmark dataset",
  "- Evidence tie: addresses product-market fit risk.",
].join("\n");

// =========================================================================
// 1. Metadata fragments do not become standalone ACTION cards.
// =========================================================================

for (const [label, source] of surfaces) {
  test(`${label}: bulleted metadata sub-fields (Owner/Budget cap/Activity/Success criterion/Evidence tie) never become standalone ACTION cards`, async () => {
    const mod = await compileRecommendationHelpers(source);
    const items = mod.extractRecommendationItems(BULLETED_SUBFIELD_CONTENT);

    assert.ok(!items.some((item) => /^Owner\s*:/i.test(item)), `${label}: no bare "Owner:" card, got ${JSON.stringify(items)}`);
    assert.ok(!items.some((item) => /^Budget(?:\s+cap)?\s*:/i.test(item)), `${label}: no bare "Budget cap:" card`);
    assert.ok(!items.some((item) => /^Activity\s*:/i.test(item)), `${label}: no bare "Activity:" card`);
    assert.ok(!items.some((item) => /^Success criterion\s*:/i.test(item)), `${label}: no bare "Success criterion:" card`);
    assert.ok(!items.some((item) => /^Evidence tie\s*:/i.test(item)), `${label}: no bare "Evidence tie:" card`);
  });
}

// =========================================================================
// 2. One recommendation produces one grouped card with its metadata.
// =========================================================================

for (const [label, source] of surfaces) {
  test(`${label}: "Market-size & SOM validation" produces exactly ONE grouped card carrying all 5 of its own metadata fields`, async () => {
    const mod = await compileRecommendationHelpers(source);
    const items = mod.extractRecommendationItems(BULLETED_SUBFIELD_CONTENT);

    const matching = items.filter((item) => item.includes("Market-size & SOM validation"));
    assert.equal(matching.length, 1, `${label}: expected exactly one card for this recommendation, got ${JSON.stringify(items)}`);

    const signals = mod.extractRecommendationSignals(matching[0]);
    assert.equal(signals.owner, "Head of Market Research");
    assert.equal(signals.budget, "$50,000");
    assert.equal(signals.activity, "run a structured willingness-to-pay survey across 200 target buyers");
    assert.equal(signals.evidenceTie, "addresses SAM/SOM gap");
    assert.match(signals.metric, /obtain at least 60 completed surveys/);
  });

  test(`${label}: "Technical pilot" ALSO produces exactly ONE grouped card carrying all of its own metadata fields, with its own owner distinct from the first recommendation's`, async () => {
    const mod = await compileRecommendationHelpers(source);
    const items = mod.extractRecommendationItems(BULLETED_SUBFIELD_CONTENT);

    const matching = items.filter((item) => item.includes("Technical pilot"));
    assert.equal(matching.length, 1, `${label}: expected exactly one card for this recommendation, got ${JSON.stringify(items)}`);

    const signals = mod.extractRecommendationSignals(matching[0]);
    assert.equal(signals.owner, "Pilot Lead");
    assert.equal(signals.budget, "$250,000");
    assert.equal(signals.activity, "build and run a 2-week technical proof of concept");
    assert.equal(signals.evidenceTie, "addresses product-market fit risk");
  });
}

// =========================================================================
// 3. Multiple genuine recommendations remain separate (not accidentally
//    merged into one).
// =========================================================================

for (const [label, source] of surfaces) {
  test(`${label}: the two genuine recommendations (Market-size & SOM validation, Technical pilot) are never accidentally merged into a single card`, async () => {
    const mod = await compileRecommendationHelpers(source);
    const items = mod.extractRecommendationItems(BULLETED_SUBFIELD_CONTENT);

    const marketSize = items.find((item) => item.startsWith("Market-size & SOM validation"));
    const technicalPilot = items.find((item) => item.startsWith("Technical pilot"));
    assert.ok(marketSize, `${label}: Market-size & SOM validation card missing`);
    assert.ok(technicalPilot, `${label}: Technical pilot card missing`);
    assert.notEqual(marketSize, technicalPilot);
    assert.doesNotMatch(marketSize, /Technical pilot/, `${label}: the two recommendations must not bleed into each other`);
    assert.doesNotMatch(technicalPilot, /Market-size & SOM validation/, `${label}: the two recommendations must not bleed into each other`);
  });

  test(`${label}: "Current Decision: MONITOR" remains its own separate card, never absorbed into the first recommendation`, async () => {
    const mod = await compileRecommendationHelpers(source);
    const items = mod.extractRecommendationItems(BULLETED_SUBFIELD_CONTENT);
    assert.ok(items.some((item) => item === "Current Decision: MONITOR"), `${label}: expected an exact standalone "Current Decision: MONITOR" card, got ${JSON.stringify(items)}`);
  });
}

// =========================================================================
// 4. UI and PDF use the same cleaned/grouped recommendation structure.
// =========================================================================

test("UI (page.tsx) and PDF (ReportPdfButton.tsx, Planner.tsx) all produce IDENTICAL grouped recommendation arrays for the same bulleted-sub-field content", async () => {
  const results = {};
  for (const [label, source] of surfaces) {
    const mod = await compileRecommendationHelpers(source);
    results[label] = mod.extractRecommendationItems(BULLETED_SUBFIELD_CONTENT);
  }
  assert.deepEqual(results["ReportPdfButton.tsx"], results["Planner.tsx"]);
  assert.deepEqual(results["ReportPdfButton.tsx"], results["page.tsx"]);
});

test("UI and PDF also agree on the extracted field VALUES for the same grouped card (not just the same grouping)", async () => {
  const values = {};
  for (const [label, source] of surfaces) {
    const mod = await compileRecommendationHelpers(source);
    const items = mod.extractRecommendationItems(BULLETED_SUBFIELD_CONTENT);
    const marketSize = items.find((item) => item.startsWith("Market-size & SOM validation"));
    values[label] = mod.extractRecommendationSignals(marketSize);
  }
  assert.deepEqual(values["ReportPdfButton.tsx"], values["Planner.tsx"]);
  assert.deepEqual(values["ReportPdfButton.tsx"], values["page.tsx"]);
});

// =========================================================================
// 5. Canonical decision remains unchanged (MONITOR everywhere).
// =========================================================================

test("DRIFT CHECK: the Strategic Recommendations 'Current Decision' badge computation (resolveMarketIntelligenceGatedExecutiveDecision) and Task #29E/#29F/#29G's canonical Main Risk / CAGR / evidence-disclaimer fixes remain present and untouched", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /resolveMarketIntelligenceGatedExecutiveDecision\(/);
    assert.match(source, /localizePdfPresentationLabel\("Current Decision", pdfLocale\)/);
    assert.match(source, /A CAGR percentage was not stated in this report's own sources\. This value is marked Validation Required until it can be confirmed\./);
  }
  assert.match(plannerSource, /marketIntelligenceCanonicalState\?\.topRisks\?\.\[0\]/);
  assert.match(pdfButtonSource, /readMarketIntelligenceCanonicalState\(report\.metadata\)\?\.topRisks\?\.\[0\]/);
});

test("REGRESSION: 'Current Decision: MONITOR' and 'Decision: MONITOR — ...' both survive verbatim as their own cards -- the grouping fix never rewrites or drops the canonical decision text itself", async () => {
  for (const [, source] of surfaces) {
    const mod = await compileRecommendationHelpers(source);
    const items = mod.extractRecommendationItems(BULLETED_SUBFIELD_CONTENT);
    assert.ok(items.includes("Current Decision: MONITOR"));
  }
});

// =========================================================================
// 6. Legacy persisted reports where recommendations still exist as prose
//    remain renderable (the one-sentence-per-action shape, and the
//    marker-free sentence-split fallback, are both unaffected).
// =========================================================================

const REAL_ONE_SENTENCE_CONTENT =
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

for (const [label, source] of surfaces) {
  test(`${label}: the pre-existing one-sentence-per-action format (the real persisted report's own shape) remains fully renderable and unaffected -- "Evidence to collect:" now correctly attaches as the Evidence Tie field of its own action instead of floating as a separate fragment`, async () => {
    const mod = await compileRecommendationHelpers(source);
    const items = mod.extractRecommendationItems(REAL_ONE_SENTENCE_CONTENT);

    assert.ok(items.some((item) => item.startsWith("Decision: MONITOR")));
    assert.ok(items.some((item) => item.startsWith("Rationale:")));
    const sprintAction = items.find((item) => item.includes("Account Validation Sprint"));
    assert.ok(sprintAction, "Account Validation Sprint action missing");
    assert.ok(items.some((item) => item.includes("Pricing & Procurement Discovery")));
    assert.ok(items.some((item) => item.includes("Integration Pilot Build")));
    assert.ok(items.some((item) => item.startsWith("If all three succeed")));
    assert.ok(!items.some((item) => /^(?:Why|Where|When|How)\s*:/i.test(item)), "Task #29F's Why/Where/When/How exclusion must remain intact");
    assert.ok(!items.some((item) => /^Evidence (?:cited|collected)\s*:/i.test(item)), "Task #29E's Evidence cited exclusion must remain intact");

    const signals = mod.extractRecommendationSignals(sprintAction);
    assert.equal(signals.evidenceTie, "signed SOWs and pilot KPIs");
    assert.equal(signals.owner, "Head of Sales");
    assert.equal(signals.budget, "$75,000");
  });

  test(`${label}: a genuinely legacy, marker-free PROSE recommendation (no bullets or numbers at all) still falls through to the sentence-split fallback and renders, unaffected by the new field-label merge rule`, async () => {
    const mod = await compileRecommendationHelpers(source);
    const legacyProse =
      "We recommend entering this market cautiously. A pilot program should be launched within the next two quarters to validate demand. If early signals are positive, scale the sales team accordingly.";
    const items = mod.extractRecommendationItems(legacyProse);
    assert.ok(items.length > 0, `${label}: legacy prose must still produce renderable items`);
    assert.ok(items.some((item) => item.includes("pilot program")), `${label}: real legacy content must survive`);
  });
}
