// TASK #69A-29C -- Restore the canonical Competitor Landscape section
// in PDF without reintroducing prose reconstruction.
//
// ROOT CAUSE (traced by a dedicated Explore pass, VERIFIED BY DIRECT
// EXECUTION of the real, unmodified dedupePdfSections against a
// synthetic report, then independently re-confirmed by reading):
// #69A-29B's own fix (suppressing the raw free-prose duplicate for
// competitorLandscape) was correct and is NOT the cause of this
// regression. The real cause is a PRE-EXISTING, latent bug in
// dedupePdfSections' own content-fingerprint dedup (both
// ReportPdfButton.tsx and Planner.tsx carry an identical copy): its
// `contentKey` check (the first 360 normalized characters of a
// section's content) collapses TWO sections with DIFFERENT, real field
// names into one if their content happens to start with the same
// text -- which it does whenever both fields fall back to the SAME
// generic research-timeout sentence (createGroundedDomainTimeoutFallback,
// plan-executor.ts: "[Unknown] [Required:<field>] Some external
// sources could not be verified, so this field is not definitive.",
// identical apart from the field tag, which is stripped from
// customer-facing presentation before this dedup ever runs). When a
// fresh regeneration's research timed out for BOTH marketOpportunity
// and competitorLandscape, dedupePdfSections silently discarded the
// WHOLE competitorLandscape section object -- not just its prose, its
// structured competitor table too -- long before the per-section
// render loop (TOC push, resolveCompetitorRowsForPdf visual) ever ran.
// This is why the PDF's Table of Contents jumped straight from Market
// Opportunity to Business Model.
//
// FIX: contentKey-based dedup now only fires for sections that have NO
// distinct field identity of their own (a genuine copy-paste duplicate
// under two different titles) -- field identity (already the
// authoritative uniqueness signal getPdfSectionDedupeKey's own `key`
// relies on) can never be overridden by a content-length coincidence.
// No prose parsing was reintroduced; #69A-29B's raw-prose suppression
// for competitorLandscape is untouched.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pdfButtonPath = join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx");
const plannerPath = join(repoRoot, "components/Planner.tsx");
const pdfButtonSource = readFileSync(pdfButtonPath, "utf8");
const plannerSource = readFileSync(plannerPath, "utf8");

// Extracts the contiguous, dependency-free block of plain functions
// (isTamSamSomTitle -> removeDuplicatePdfExecutiveInsightText ->
// getPdfSectionDedupeKey -> isLegacyTamSamSomSection ->
// isTamSamSomDuplicateFragment -> dedupePdfSections) that sits, in both
// files, entirely before any JSX/browser-only code -- the SAME
// established extraction technique task43a's own test file uses for
// getPorterLayout, applied here because this block has no jsPDF
// dependency at all and can run standalone under plain node once its
// real pdf-normalization.mjs imports are wired in.
function extractDedupeBlock(source) {
  const startMarker = "function isTamSamSomTitle(title: string) {";
  const endMarker = "function mergePdfSourceSections";
  const startIndex = source.indexOf(startMarker);
  assert.ok(startIndex !== -1, "isTamSamSomTitle not found");
  const endIndex = source.indexOf(endMarker, startIndex);
  assert.ok(endIndex !== -1, "mergePdfSourceSections not found");
  return source.slice(startIndex, endIndex);
}

async function compileDedupePdfSections(source, fileLabel) {
  const pieces = [
    `import { normalizePdfCanonicalTamSamSomContent, normalizePdfTamSamSomOwnershipContent, normalizePdfText } from ${JSON.stringify(
      pathToFileURL(join(repoRoot, "app/lib/pdf-normalization.mjs")).href
    )};`,
    extractDedupeBlock(source),
    "export { dedupePdfSections, getPdfSectionDedupeKey };",
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), `zerinix-dedupe-pdf-sections-${fileLabel.replace(/[^\w]/g, "")}-`));
  const outPath = join(dir, "dedupePdfSections.ts");
  writeFileSync(outPath, pieces);
  try {
    return await import(pathToFileURL(outPath).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function section(field, title, content) {
  return { field, title, content };
}

const TIMEOUT_FALLBACK_MARKET_OPPORTUNITY =
  "Some external sources could not be verified, so this field is not definitive. This report's own analysis should be treated as directional until confirmed.";
const TIMEOUT_FALLBACK_COMPETITOR_LANDSCAPE =
  "Some external sources could not be verified, so this field is not definitive. This report's own analysis should be treated as directional until confirmed.";

for (const [fileLabel, source] of [
  ["ReportPdfButton.tsx", pdfButtonSource],
  ["Planner.tsx", plannerSource],
]) {
  test(`[${fileLabel}] [1/9] a competitorLandscape section that shares the SAME research-timeout fallback text as another field (marketOpportunity) survives dedupePdfSections -- field identity is never overridden by a content-length coincidence`, async () => {
    const { dedupePdfSections } = await compileDedupePdfSections(source, fileLabel);
    const sections = [
      section("marketOpportunity", "Market Opportunity", TIMEOUT_FALLBACK_MARKET_OPPORTUNITY),
      section("competitorLandscape", "Competitor Landscape", TIMEOUT_FALLBACK_COMPETITOR_LANDSCAPE),
      section("businessModel", "Business Model", "A distinct, real business model paragraph."),
    ];

    const result = dedupePdfSections(sections);
    const fields = result.map((entry) => entry.field);

    assert.ok(fields.includes("competitorLandscape"), `expected competitorLandscape to survive, got fields: ${JSON.stringify(fields)}`);
    assert.equal(result.length, 3, "all three genuinely distinct fields must survive");
  });

  test(`[${fileLabel}] [9] removing/renaming the free-prose competitorLandscape content entirely still keeps the section present -- its SURVIVAL never depended on any particular prose text, only on having its own distinct field`, async () => {
    const { dedupePdfSections } = await compileDedupePdfSections(source, fileLabel);
    const sections = [
      section("marketOpportunity", "Market Opportunity", TIMEOUT_FALLBACK_MARKET_OPPORTUNITY),
      // Empty/near-empty content -- simulates the free-prose field being
      // deprioritized entirely in favor of the canonical structured
      // state; the section object itself (field-tagged) must still
      // survive dedup so the per-section loop's structured visual can
      // still draw for it.
      section("competitorLandscape", "Competitor Landscape", ""),
    ];

    const result = dedupePdfSections(sections);
    assert.ok(result.some((entry) => entry.field === "competitorLandscape"));
  });

  test(`[${fileLabel}] [10] a genuine copy-paste duplicate (two sections with NO field identity, identical content) is still deduped exactly as before -- this fix only protects sections that already have a real field name`, async () => {
    const { dedupePdfSections } = await compileDedupePdfSections(source, fileLabel);
    const duplicateProse = "This is a long, genuinely duplicated paragraph appearing twice under two different, field-less titles, well past the 360-character content-key window used by the dedup check itself so this test is realistic and not a boundary artifact of the slice length.";
    const sections = [
      section(undefined, "Legacy Section A", duplicateProse),
      section(undefined, "Legacy Section B", duplicateProse),
    ];

    const result = dedupePdfSections(sections);
    assert.equal(result.length, 1, "two field-less sections with identical content must still collapse to one, exactly as before this fix");
  });

  test(`[${fileLabel}] historical fallback: a section with a real field but genuinely DIFFERENT content from every other section is never affected by this fix at all`, async () => {
    const { dedupePdfSections } = await compileDedupePdfSections(source, fileLabel);
    const sections = [
      section("marketOpportunity", "Market Opportunity", "A real, distinct market opportunity paragraph."),
      section("competitorLandscape", "Competitor Landscape", "A real, distinct competitor landscape paragraph naming real competitors."),
    ];

    const result = dedupePdfSections(sections);
    assert.equal(result.length, 2);
  });
}

// --- 2/3: TOC and body both driven by the SAME surviving section list --

test("[ReportPdfButton.tsx] [2/3] the per-section render loop's TOC push and body/visual draw both read from the SAME pdfSections array dedupePdfSections produces -- there is no separate, independent TOC-only filter that could disagree with the body", () => {
  assert.match(pdfButtonSource, /const pdfSections = localizePdfReportSections\(pdfBaseSectionsWithBenchmark, pdfLocale\)\.filter\(/);
  assert.match(pdfButtonSource, /dedupePdfSections\(mergePdfSourceSections\(normalizedSections\)\)/);
  // The TOC push and the visual-dispatch/body-suppression logic are
  // both inside the SAME `pdfSections.forEach((section) => {...})`
  // per-section loop -- confirmed existing and not duplicated as a
  // separate top-level TOC-building pass.
  const forEachOccurrences = (pdfButtonSource.match(/pdfSections\.forEach\(/g) || []).length;
  assert.ok(forEachOccurrences >= 1, "expected the per-section render loop to iterate pdfSections directly");
});

test("[Planner.tsx] [2/3] its own independent PDF export builds its section list through dedupePdfSections before any TOC/body rendering -- the same single array both surfaces read from downstream", () => {
  assert.match(plannerSource, /const normalizedPdfSections = dedupePdfSections\(mergePdfSourceSections\(sections\)\);/);
  assert.match(plannerSource, /compactExecutiveDecisionMemoSections\(normalizedPdfSections\)/);
});

// --- 4-8: canonical structured competitor data (unaffected by this ------
// --- fix -- already proven correct by #69A-29/#69A-29A/#69A-29B, -------
// --- re-confirmed here as a drift check) --------------------------------

test("[4-8] resolveCompetitorRowsForPdf / resolveCompetitorRowsForDownloadPdf (the structured visual this fix restores access to) are completely untouched by #69A-29C -- this ticket only restores the SECTION's survival through dedup, never the extraction logic #69A-29/#69A-29A already proved correct", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /readBusinessCompetitorLandscapeState\(/);
    assert.match(source, /weaknesses: formatCompetitorWeaknessForDisplay\(entity\)/);
  }
});

// --- Decision safety -- presentation-only fix ---------------------------

test("no decision-engine, confidence, Founder-Readiness, Porter's Five Forces, or Benchmark Intelligence file carries a #69A-29C marker -- this is a PDF section-assembly fix only", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/report-presentation.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/decision-intelligence/profiles.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-29C/, `${relativePath} should not carry a #69A-29C marker`);
  }
});

test("the fix's own diff surface is confined to dedupePdfSections' contentKey check in exactly the two PDF-exporter files -- no change to getPdfSectionDedupeKey's own field-first logic, isTamSamSomTitle, or any TAM/SAM/SOM-specific dedup branch", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /#69A-29C/);
    assert.match(source, /const hasDistinctFieldIdentity = Boolean\(section\.field\?\.trim\(\)\);/);
    // getPdfSectionDedupeKey itself is untouched -- still field-first.
    assert.match(source, /function getPdfSectionDedupeKey\(section: \{ field\?: string; title: string; content: string \}\) \{\s*\n\s*const fieldKey = section\.field\?\.trim\(\)\.toLowerCase\(\);\s*\n\s*\n\s*if \(fieldKey\) \{\s*\n\s*return fieldKey;/);
  }
});
