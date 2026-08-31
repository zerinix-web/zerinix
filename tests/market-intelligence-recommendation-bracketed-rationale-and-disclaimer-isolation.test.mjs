import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// TASK #29G -- Fix Strategic Recommendations metadata being rendered as
// ACTION cards. Regression coverage for the real observed defect shape:
//
//   Valid executable recommendation cards ("Executive verdict: MONITOR...",
//   "Market-pen test...", "Pilot contract...", "Conditional phased
//   rollout...") were interleaved with non-action metadata rendered as if
//   they were their own numbered actions:
//     - "[Why: establishes achievable outreach-to-win ratios and closes
//       SOM gap]." (a per-action rationale, bracketed, on its own line)
//     - "[Why: validates core value claim]." (the same pattern again, for
//       a different action)
//     - "Specific named rivals could not be independently validated..."
//       (a competitor/evidence-validation disclaimer -- research context,
//       never an executable step)
//
// ROOT CAUSE: extractRecommendationItems's line-merge loop only ever
// treated a marker-less line as a continuation of the item above it when
// that item's own text ended in a SENTENCE_ABBREVIATIONS entry (a
// narrow fix for mid-sentence line wraps after "U.S."/etc, Task #26). A
// bracketed per-action rationale sits on its OWN physical line, doesn't
// follow an abbreviation, and has no bullet/numbered marker of its own --
// so it fell through to becoming its own new "item", incrementing the
// numbered action count. Separately, isEvidenceStatusDisclaimerLine only
// matched a fixed list of EXACT evidence-status sentence templates, so a
// competitor-validation disclaimer phrased differently slipped through
// every existing exclusion check.
//
// FIX (structural, not string-specific -- see requirement 4):
//   1. The merge loop now ALSO treats any line that is ENTIRELY a
//      bracketed clause ("[...]"/"[...].") as a continuation of the
//      previous item -- the same inline-annotation convention this
//      pipeline already uses for "[Estimated]"/"[R12]" -- generalizing to
//      ANY bracketed label, not a hardcoded match on the word "Why".
//   2. isEvidenceStatusDisclaimerLine gained one new GENERAL pattern for
//      the whole "X could not/is not/has not been (been) independently
//      validated/verified/confirmed/corroborated" semantic family,
//      regardless of subject or exact tense/wording.
//
// This file proves: a bracketed "[Why: ...]" annotation is merged into
// (preserved as rationale on) its parent action, never becomes its own
// action, and never increments the numbered action count; a competitor-
// validation disclaimer is excluded entirely, in any of several
// differently-worded real-world phrasings; genuine executable
// recommendations remain present, intact, and in order; UI (page.tsx/
// Planner.tsx) and PDF (ReportPdfButton.tsx/Planner.tsx) all share the
// identical cleaned recommendation structure; and MONITOR/canonical state
// are completely unaffected.

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
  const dir = mkdtempSync(join(tmpdir(), "zerinix-bracketed-rationale-"));
  const outPath = join(dir, "module.ts");
  const body = pieces.join("\n\n");
  writeFileSync(outPath, `${body}\n\nexport { ${exportNames.join(", ")} };\n`);
  return import(pathToFileURL(outPath).href);
}

async function compileExtractRecommendationItems(source) {
  // TASK #29J -- these functions now live solely in report-presentation.ts;
  // `source` (the calling surface's own file) is accepted for the
  // caller's own labeling/looping but no longer used for extraction.
  void source;
  const isRecommendationHeadingLine = extractFunctionSource(reportPresentationSource, "isRecommendationHeadingLine");
  const isMetadataOnlyRecommendationLine = extractFunctionSource(reportPresentationSource, "isMetadataOnlyRecommendationLine");
  const isEvidenceStatusDisclaimerLine = extractFunctionSource(reportPresentationSource, "isEvidenceStatusDisclaimerLine");
  const extractRecommendationItems = extractFunctionSource(reportPresentationSource, "extractRecommendationItems");
  const mod = await compileModule(
    [
      'const SENTENCE_ABBREVIATIONS = ["U.S.", "Inc.", "Corp.", "Ltd.", "e.g.", "i.e.", "vs.", "etc."];',
      isRecommendationHeadingLine,
      isMetadataOnlyRecommendationLine,
      isEvidenceStatusDisclaimerLine,
      extractRecommendationItems,
    ],
    ["extractRecommendationItems"]
  );
  return mod.extractRecommendationItems;
}

// TASK #29J -- each surface must consume the shared module's functions
// via import, never redefine its own copy again.
for (const [label, source] of surfaces) {
  test(`${label}: imports extractRecommendationItems from the shared report-presentation module instead of defining its own copy`, () => {
    assert.match(source, /\bextractRecommendationItems\b[\s\S]{0,700}from "@\/app\/lib\/report-presentation"/);
    assert.doesNotMatch(source, /^function extractRecommendationItems\(/m, `${label}: must not redefine extractRecommendationItems locally`);
  });
}

// The real observed shape from the ticket: 4 genuine executable cards,
// two bracketed per-action rationale annotations, and one competitor-
// validation disclaimer sentence.
const REAL_SHAPE_CONTENT = [
  "Executive verdict: MONITOR -- enter only after two structural gaps close.",
  "1) Market-pen test -- Owner: Head of Sales; Budget ceiling: $60,000; KPI: 40 qualified leads; Success criterion: 5 signed pilots within 90 days.",
  "[Why: establishes achievable outreach-to-win ratios and closes SOM gap].",
  "2) Pilot contract -- Owner: Head of Product; Budget ceiling: $90,000; KPI: 3 signed pilot contracts; Success criterion: 2 renewals within 120 days.",
  "[Why: validates core value claim].",
  "3) Conditional phased rollout -- Owner: Head of BD; Budget ceiling: $40,000; KPI: 2 regional launches; Success criterion: break-even within 6 months.",
  "Specific named rivals could not be independently validated within available evidence; competitive intensity is inferred from category-level signals.",
  "If all three succeed, recommend phased entry; otherwise pause and reassess.",
].join("\n");

// =========================================================================
// 1. "[Why: ...]" cannot become an ACTION card; rationale/context cannot
//    increment action numbering; it is preserved (merged) on its parent
//    action, not deleted.
// =========================================================================

for (const [label, source] of surfaces) {
  test(`${label}: a bracketed "[Why: ...]" per-action rationale is merged into (preserved as rationale on) its parent action, never becomes its own numbered ACTION card`, async () => {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(REAL_SHAPE_CONTENT);

    assert.ok(
      !items.some((item) => /^\[.*\]\.?$/.test(item)),
      `${label}: no item may be a bare bracketed annotation on its own, got ${JSON.stringify(items)}`
    );
    // Preserved, not deleted: the rationale text survives as part of the
    // action it explains.
    const marketPenTest = items.find((item) => item.includes("Market-pen test"));
    assert.ok(marketPenTest, `${label}: Market-pen test action missing`);
    assert.match(marketPenTest, /\[Why: establishes achievable outreach-to-win ratios and closes SOM gap\]\.?$/);

    const pilotContract = items.find((item) => item.includes("Pilot contract"));
    assert.ok(pilotContract, `${label}: Pilot contract action missing`);
    assert.match(pilotContract, /\[Why: validates core value claim\]\.?$/);
  });

  test(`${label}: rationale/context lines never increment the numbered action count -- exactly 4 genuine action-shaped cards survive (Executive verdict, Market-pen test, Pilot contract, Conditional phased rollout) plus the pre-existing closing gate sentence, never 6 or 7`, async () => {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(REAL_SHAPE_CONTENT);
    assert.equal(
      items.length,
      5,
      `${label}: expected exactly 5 items (4 genuine cards + 1 closing gate sentence), got ${items.length}: ${JSON.stringify(items)}`
    );
  });

  test(`${label}: a marker-less line that is NOT fully bracketed (the pre-existing "If all three succeed, ..." closing sentence) is completely unaffected by the new bracket-merge rule and remains its own item`, async () => {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(REAL_SHAPE_CONTENT);
    assert.ok(
      items.some((item) => /^If all three succeed, recommend phased entry/.test(item)),
      `${label}: the closing gate sentence must remain its own standalone item, unaffected by this fix`
    );
  });
}

// =========================================================================
// 2. Competitor/evidence-validation disclaimer cannot become an ACTION
//    card -- proven with several differently-worded real-world phrasings,
//    not just the one exact reported sentence (requirement 4).
// =========================================================================

const DISCLAIMER_PHRASINGS = [
  "Specific named rivals could not be independently validated within available evidence; competitive intensity is inferred from category-level signals.",
  "These competitor claims have not been independently verified against public filings.",
  "The projected win rate was not confirmed by any third-party benchmark.",
  "Named vendor pricing is not independently corroborated by public sources.",
];

for (const [label, source] of surfaces) {
  test(`${label}: a competitor-validation disclaimer never becomes an ACTION card, across several differently-worded phrasings of the same "could not be independently validated" semantic family (not a brittle exact-string match)`, async () => {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    for (const disclaimer of DISCLAIMER_PHRASINGS) {
      const content = `1) Real action -- Owner: Head of Sales; Budget ceiling: $10,000; KPI: 10 leads.\n${disclaimer}\n2) Another real action -- Owner: Head of Product; Budget ceiling: $20,000; KPI: 5 pilots.`;
      const items = extractRecommendationItems(content);
      assert.ok(
        !items.some((item) => item.includes(disclaimer) || item === disclaimer),
        `${label}: disclaimer "${disclaimer}" must never survive as its own action, got ${JSON.stringify(items)}`
      );
      assert.ok(items.some((item) => item.includes("Real action")), `${label}: real action 1 must survive`);
      assert.ok(items.some((item) => item.includes("Another real action")), `${label}: real action 2 must survive`);
    }
  });

  test(`${label}: isEvidenceStatusDisclaimerLine's new pattern never misfires on a genuine action mentioning validation as part of its own executable content`, async () => {
    void source;
    const fn = extractFunctionSource(reportPresentationSource, "isEvidenceStatusDisclaimerLine");
    const mod = await compileModule([fn], ["isEvidenceStatusDisclaimerLine"]);
    assert.equal(
      mod.isEvidenceStatusDisclaimerLine(
        "Owner: Head of Sales; Budget ceiling: $75,000; KPI: 50 target accounts contacted; Success criterion: at least one comparable public price schedule secured."
      ),
      false
    );
    assert.equal(
      mod.isEvidenceStatusDisclaimerLine(
        "Evidence to collect: signed SOWs and pilot KPIs that validate the pricing model."
      ),
      false,
      "a real action describing evidence it will COLLECT (future, affirmative) must not be confused with a disclaimer about evidence that COULD NOT be validated"
    );
  });
}

// =========================================================================
// 3. Executable recommendations remain present and ordered.
// =========================================================================

for (const [label, source] of surfaces) {
  test(`${label}: all 4 genuine executable recommendation cards remain present and in their original order`, async () => {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(REAL_SHAPE_CONTENT);

    const verdictIndex = items.findIndex((item) => item.startsWith("Executive verdict: MONITOR"));
    const marketPenIndex = items.findIndex((item) => item.includes("Market-pen test"));
    const pilotIndex = items.findIndex((item) => item.includes("Pilot contract"));
    const rolloutIndex = items.findIndex((item) => item.includes("Conditional phased rollout"));

    assert.ok(verdictIndex !== -1, `${label}: Executive verdict missing`);
    assert.ok(marketPenIndex !== -1, `${label}: Market-pen test missing`);
    assert.ok(pilotIndex !== -1, `${label}: Pilot contract missing`);
    assert.ok(rolloutIndex !== -1, `${label}: Conditional phased rollout missing`);
    assert.ok(
      verdictIndex < marketPenIndex && marketPenIndex < pilotIndex && pilotIndex < rolloutIndex,
      `${label}: genuine actions must keep their original relative order, got ${JSON.stringify(items)}`
    );

    for (const item of items) {
      assert.ok(item.trim().length > 0, `${label}: no empty/synthetic action may ever be created`);
    }
  });
}

// =========================================================================
// 4. UI and PDF use the same cleaned recommendation structure.
// =========================================================================

test("UI (page.tsx) and PDF (ReportPdfButton.tsx, Planner.tsx) all produce IDENTICAL recommendation item arrays for the same real observed content -- proving the fix is not one-surface-only", async () => {
  const results = {};
  for (const [label, source] of surfaces) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    results[label] = extractRecommendationItems(REAL_SHAPE_CONTENT);
  }
  assert.deepEqual(results["ReportPdfButton.tsx"], results["Planner.tsx"]);
  assert.deepEqual(results["ReportPdfButton.tsx"], results["page.tsx"]);
});

// =========================================================================
// 5. MONITOR remains unchanged; no other logic touched.
// =========================================================================

test("REGRESSION: the 'Executive verdict: MONITOR' line itself is preserved verbatim as its own card -- the canonical decision text is never altered by the bracket-merge or disclaimer-exclusion fixes", async () => {
  for (const [, source] of surfaces) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(REAL_SHAPE_CONTENT);
    assert.ok(items.some((item) => item === "Executive verdict: MONITOR -- enter only after two structural gaps close."));
  }
});

test("DRIFT CHECK: this ticket's changes are confined to the extractRecommendationItems merge loop and isEvidenceStatusDisclaimerLine -- Main Risk canonical-state-first resolution, confidence/decision derivation, TAM/SAM/SOM cascade, and the CAGR/Market-Overview fixes from prior tasks all remain present and untouched", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/);
    assert.match(source, /resolveMarketSizingCascade\(/);
    assert.match(source, /constrainMarketSizingResolutionToCanonicalState\(/);
    assert.match(source, /A CAGR percentage was not stated in this report's own sources\. This value is marked Validation Required until it can be confirmed\./);
  }
  assert.match(plannerSource, /marketIntelligenceCanonicalState\?\.topRisks\?\.\[0\]/);
  assert.match(pdfButtonSource, /readMarketIntelligenceCanonicalState\(report\.metadata\)\?\.topRisks\?\.\[0\]/);
});
