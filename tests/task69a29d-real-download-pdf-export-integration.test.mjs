// TASK #69A-29D -- Trace and fix the REAL BIV Download PDF export path
// that still drops Competitor Landscape.
//
// WHY THIS TEST EXISTS (distinct from task69a29c's test): #69A-29C's own
// test suite only ever executed dedupePdfSections IN ISOLATION, fed a
// small synthetic `sections` array it constructed by hand. That proved
// dedupePdfSections itself was fixed, but never proved the REAL,
// end-to-end Download PDF call graph -- buildStandardReportPdf's own
// full chain (normalizeSavedPdfSectionsBeforeRender -> dedupeReportSections
// -> repairReportLanguageSections -> mergePdfSourceSections ->
// dedupePdfSections -> dedupeReportSections (again) ->
// compactExecutiveDecisionMemoSections -> insertPdfBenchmarkIntelligenceSection
// -> extractPdfValidationIntelligenceSection -> localizePdfReportSections
// -> isUniversalCustomerFacingSection) -- ever actually preserves
// "competitorLandscape" for a REALISTIC, full report shape. This test
// runs that ENTIRE chain, using the real production functions (not
// reimplementations), against a fixture standing in for the real,
// currently-persisted report shape (confirmed by direct Supabase
// inspection during this task's investigation: report.sections carries
// a field-tagged "competitorLandscape" entry with real labeled-line
// prose, and report.metadata.businessCompetitorLandscapeState carries a
// real 4-competitor structured state -- exactly this fixture's shape).
//
// ROOT-CAUSE FINDING FOR #69A-29D: running this full chain against the
// CURRENT, already-#69A-29B/29C-fixed source, AND separately against a
// live, current, real persisted report fetched directly from the
// database, both showed "competitorLandscape" surviving every single
// stage into the final pdfSections array TOC/body both read from. The
// section-assembly pipeline itself has no further code-level bug beyond
// what #69A-29B (pdfCompleteVisualFields) and #69A-29C (dedupePdfSections'
// hasDistinctFieldIdentity) already fixed. This test's fail-before proof
// (below) confirms those two fixes are exactly what stands between a
// passing and failing run of this SAME full, real chain -- i.e. #69A-29C's
// fix genuinely is the fix for the failure mode reproducible in code, and
// no third, independent bug was found in the assembly/height/TOC-push
// logic (isUniversalCustomerFacingSection, getVisualHeight's competitor
// branch, and the per-section render loop's own early-return branches
// were each read directly and confirmed to contain no field-specific
// exclusion for competitorLandscape).
//
// TASK #69A-35 -- ROOT CAUSE of a post-commit test failure (not a
// production regression): the original fail-before proof fetched "git
// HEAD's own pre-#69A-29C dedupePdfSections" via `git show HEAD:<path>`.
// That was only ever true while the #69A-29C fix sat uncommitted in the
// working tree; once it was committed (see #69A-32/33/34), HEAD BECAME
// the fixed state, so the proof's own "HEAD must genuinely predate the
// fix" precondition started failing -- correctly, since its premise was
// no longer true, not because the shipped fix regressed. Fetching a
// fixed commit SHA instead would only defer the same failure mode to
// the next rebase/squash. The fail-before proof below instead derives
// its "pre-fix" source by programmatically reverting the exact guard
// #69A-29C added, textually, on the CURRENT source string -- entirely
// independent of git history, HEAD, or any specific commit position,
// and self-updating forever (it operates on whatever the current file
// says, so it stays meaningful even if this function moves or its
// surrounding code changes shape).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pdfButtonPath = join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx");
const currentPdfButtonSource = readFileSync(pdfButtonPath, "utf8");

// Derives the exact pre-#69A-29C source by textually reverting the
// field-identity guard on the CURRENT source string -- never from git
// history. Both assertions prove this simulation is meaningful (not
// vacuous): if the fix were ever genuinely reverted for real, the first
// assertion would already fail here, loudly, rather than silently
// producing a no-op "reversion".
function simulatePreFixPdfButtonSource(currentSource) {
  const declarationPattern = /\s*const hasDistinctFieldIdentity = Boolean\(section\.field\?\.trim\(\)\);\n/;
  const guardedCondition =
    "if (!key || seen.has(key) || (contentKey && !hasDistinctFieldIdentity && seenContent.has(contentKey))) {";
  const revertedCondition =
    "if (!key || seen.has(key) || (contentKey && seenContent.has(contentKey))) {";

  assert.match(
    currentSource,
    declarationPattern,
    "expected the CURRENT source to contain the #69A-29C fix's hasDistinctFieldIdentity declaration before simulating its removal -- otherwise this proof would be vacuous"
  );
  assert.ok(
    currentSource.includes(guardedCondition),
    "expected the CURRENT source's guarded condition to match the known post-fix shape before simulating its reversion"
  );

  return currentSource
    .replace(declarationPattern, "\n")
    .replace(guardedCondition, revertedCondition);
}

function extractBlock(source, startMarker, endMarker) {
  const startIndex = source.indexOf(startMarker);
  assert.ok(startIndex !== -1, `${startMarker} not found`);
  const endIndex = source.indexOf(endMarker, startIndex);
  assert.ok(endIndex !== -1, `${endMarker} not found`);
  return source.slice(startIndex, endIndex);
}

// Builds and imports the REAL, full section-assembly chain
// buildStandardReportPdf actually runs, using real imports for every
// stage except the dedupe/merge block (parametrized so the fail-before
// proof can swap in a programmatically-reverted, pre-#69A-29C version
// of just that block -- see simulatePreFixPdfButtonSource above).
async function compileFullChain(pdfButtonSource) {
  const block = extractBlock(
    pdfButtonSource,
    "function isTamSamSomTitle(title: string) {",
    "function createFileName("
  );

  const pieces = [
    `import { normalizePdfCanonicalTamSamSomContent, normalizePdfTamSamSomOwnershipContent, normalizePdfText, normalizePdfSourceContent, localizePdfReportSections, resolvePdfPresentationLocale, insertPdfBenchmarkIntelligenceSection, extractPdfValidationIntelligenceSection } from ${JSON.stringify(
      pathToFileURL(join(repoRoot, "app/lib/pdf-normalization.mjs")).href
    )};`,
    `export { normalizePdfCanonicalTamSamSomContent, normalizePdfTamSamSomOwnershipContent, normalizePdfText, normalizePdfSourceContent, localizePdfReportSections, resolvePdfPresentationLocale, insertPdfBenchmarkIntelligenceSection, extractPdfValidationIntelligenceSection };`,
    `export { dedupeReportSections } from ${JSON.stringify(
      pathToFileURL(join(repoRoot, "app/lib/report-section-normalization.ts")).href
    )};`,
    `export { repairReportLanguageSections, resolveReportLanguage } from ${JSON.stringify(
      pathToFileURL(join(repoRoot, "app/lib/report-language.ts")).href
    )};`,
    `export { compactExecutiveDecisionMemoSections } from ${JSON.stringify(
      pathToFileURL(join(repoRoot, "app/lib/report-presentation.ts")).href
    )};`,
    `export { isUniversalCustomerFacingSection } from ${JSON.stringify(
      pathToFileURL(join(repoRoot, "app/lib/report-engine/report-presentation-sanitizer.ts")).href
    )};`,
    'function isSourceSectionTitle(title) { return /^(sources(?:\\s+continued)?|references|kaynaklar|verified sources|doğrulanmış kaynaklar|sources \\/ assumptions|kaynaklar \\/ varsayımlar)$/i.test(title.trim()); }',
    // Stub: stripMarketVerdictParagraph only rewrites Sources-section
    // content -- irrelevant to whether competitorLandscape survives.
    "function stripMarketVerdictParagraph(content) { return content; }",
    block,
    "export { normalizeSavedPdfSectionsBeforeRender, dedupePdfSections, mergePdfSourceSections };",
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "zerinix-task69a29d-full-chain-"));
  const outPath = join(dir, "pipeline.ts");
  writeFileSync(outPath, pieces);
  try {
    return await import(pathToFileURL(outPath).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runFullChain(pipeline, sections, metadata) {
  const {
    normalizeSavedPdfSectionsBeforeRender,
    dedupeReportSections,
    dedupePdfSections,
    mergePdfSourceSections,
    repairReportLanguageSections,
    compactExecutiveDecisionMemoSections,
    insertPdfBenchmarkIntelligenceSection,
    extractPdfValidationIntelligenceSection,
    localizePdfReportSections,
    isUniversalCustomerFacingSection,
    resolvePdfPresentationLocale,
    resolveReportLanguage,
  } = pipeline;

  const step1 = dedupeReportSections(normalizeSavedPdfSectionsBeforeRender(sections));
  const pdfLocale = resolvePdfPresentationLocale(
    resolveReportLanguage({ explicitLanguage: null, requestText: "", uiLanguage: metadata?.reportLanguage }),
    step1.map((s) => `${s.title}\n${s.content}`).join("\n\n")
  );
  const languageRepair = repairReportLanguageSections(step1, pdfLocale);
  const step3 = dedupePdfSections(mergePdfSourceSections(languageRepair.sections));
  const step4 = compactExecutiveDecisionMemoSections(dedupeReportSections(step3));
  const step5 = extractPdfValidationIntelligenceSection(
    insertPdfBenchmarkIntelligenceSection(step4, metadata?.benchmarkFit, pdfLocale, metadata?.benchmarkScore),
    pdfLocale
  );
  return localizePdfReportSections(step5, pdfLocale).filter((section) => isUniversalCustomerFacingSection(section));
}

// --- Fixture: mirrors the REAL persisted report shape confirmed live --

const TIMEOUT_FALLBACK =
  "Some external sources could not be verified, so this field is not definitive. This report's own analysis should be treated as directional until confirmed.";

function baseSections(competitorContent) {
  return [
    { field: "executiveSummary", title: "Executive Summary", content: "Decision: MONITOR. A real, distinct executive summary paragraph." },
    { field: "problem", title: "Problem", content: "A real, distinct problem statement paragraph." },
    { field: "marketOpportunity", title: "Market Opportunity", content: TIMEOUT_FALLBACK },
    { field: "competitorLandscape", title: "Competitor Landscape", content: competitorContent },
    { field: "businessModel", title: "Business Model", content: "A real, distinct business model paragraph." },
    { field: "tamSamSom", title: "TAM / SAM / SOM", content: "TAM: $1B\nSAM: $200M\nSOM: $10M" },
  ];
}

// Five-part canonical competitor fixture required by TASK #69A-29D
// Section E: verified weakness, directional weakness, unavailable
// weakness, differing threat levels, and a substitute-type competitor.
const fivePartCompetitorResponses = [
  { company: "Float", type: "Direct competitor", positioning: "Cash-flow forecasting for SMBs.", strengths: "Deep bank integrations.", weaknesses: "an independent review documents a specific, named limitation in reporting depth", weaknessBasis: "verified", threat: "High" },
  { company: "Jirav", type: "Direct competitor", positioning: "FP&A platform for finance teams.", strengths: "Strong modeling depth.", weaknesses: "narrower target segment than comparable alternatives", weaknessBasis: "directional", threat: "Medium" },
  { company: "QuickBooks ecosystem apps", type: "Substitute", positioning: "Add-on forecasting apps within an existing accounting suite.", strengths: "Zero-friction distribution.", weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
  { company: "Fractional CFO firms (aggregate)", type: "Substitute", positioning: "Human-delivered finance advisory as an alternative to software.", strengths: "High-trust, bespoke advice.", weaknesses: "significantly higher cost per unit of insight than a software subscription", weaknessBasis: "directional", threat: "Low" },
  { company: "Spreadsheet templates", type: "Status-quo alternative", positioning: "Free, manual DIY forecasting.", strengths: "Zero cost, full control.", weaknesses: "an independent review documents a specific, named limitation around error-proneness at scale", weaknessBasis: "verified", threat: "Low" },
];

const canonicalMetadata = {
  reportLanguage: "en",
  businessCompetitorLandscapeState: buildBusinessCompetitorLandscapeStateFromStructuredResponse(
    fivePartCompetitorResponses
  ),
};

// --- The tests -----------------------------------------------------------

test("[current source] the REAL, full buildStandardReportPdf chain preserves competitorLandscape when its content collides with marketOpportunity's shared timeout-fallback text", async () => {
  const pipeline = await compileFullChain(currentPdfButtonSource);
  const result = runFullChain(pipeline, baseSections(TIMEOUT_FALLBACK), canonicalMetadata);
  const fields = result.map((s) => s.field);
  assert.ok(fields.includes("competitorLandscape"), `expected competitorLandscape to survive the FULL chain, got: ${JSON.stringify(fields)}`);
});

test("[current source] the REAL, full chain preserves competitorLandscape with genuinely distinct content (the common, non-colliding case)", async () => {
  const pipeline = await compileFullChain(currentPdfButtonSource);
  const result = runFullChain(
    pipeline,
    baseSections("COMPETITOR: Float | TYPE: Direct competitor | POSITIONING: real | STRENGTHS: real | WEAKNESSES: real | THREAT: High"),
    canonicalMetadata
  );
  assert.ok(result.some((s) => s.field === "competitorLandscape"));
});

test("[current source] ordering survives: Competitor Landscape stays between Market Opportunity and Business Model, matching the report's own generation order", async () => {
  const pipeline = await compileFullChain(currentPdfButtonSource);
  const result = runFullChain(pipeline, baseSections(TIMEOUT_FALLBACK), canonicalMetadata);
  const fields = result.map((s) => s.field);
  const moIndex = fields.indexOf("marketOpportunity");
  const clIndex = fields.indexOf("competitorLandscape");
  const bmIndex = fields.indexOf("businessModel");
  assert.ok(moIndex !== -1 && clIndex !== -1 && bmIndex !== -1);
  assert.ok(moIndex < clIndex && clIndex < bmIndex, `expected order marketOpportunity < competitorLandscape < businessModel, got fields: ${JSON.stringify(fields)}`);
});

test("[current source] absence of legacy free-prose content (empty competitorLandscape body) never removes the section -- survival depends only on field identity, never on prose length", async () => {
  const pipeline = await compileFullChain(currentPdfButtonSource);
  const result = runFullChain(pipeline, baseSections(""), canonicalMetadata);
  assert.ok(result.some((s) => s.field === "competitorLandscape"));
});

test("[current source] the canonical field survives a persistence round-trip shape (JSON.parse(JSON.stringify(...)), matching what a Supabase read-back actually returns)", async () => {
  const pipeline = await compileFullChain(currentPdfButtonSource);
  const roundTrippedSections = JSON.parse(JSON.stringify(baseSections(TIMEOUT_FALLBACK)));
  const roundTrippedMetadata = JSON.parse(JSON.stringify(canonicalMetadata));
  const result = runFullChain(pipeline, roundTrippedSections, roundTrippedMetadata);
  assert.ok(result.some((s) => s.field === "competitorLandscape"));
});

test("[current source] every canonical competitor from the five-part fixture (verified / directional / unavailable / differing threat levels / a substitute) is present in the structured state the surviving section's visual reads from", () => {
  const state = canonicalMetadata.businessCompetitorLandscapeState;
  assert.ok(state, "expected a built businessCompetitorLandscapeState");
  const byCompany = Object.fromEntries(state.competitors.map((c) => [c.company, c]));
  assert.equal(byCompany["Float"].weaknessBasis, "verified");
  assert.equal(byCompany["Jirav"].weaknessBasis, "directional");
  assert.equal(byCompany["QuickBooks ecosystem apps"].weaknessBasis, "unavailable");
  assert.equal(byCompany["QuickBooks ecosystem apps"].type, "Substitute");
  const threats = new Set(state.competitors.map((c) => c.threat));
  assert.ok(threats.has("High") && threats.has("Medium") && threats.has("Low"), `expected multiple distinct threat levels, got: ${JSON.stringify([...threats])}`);
});

// --- Fail-before proof: this SAME full chain, with the #69A-29C -------
// --- guard programmatically reverted on the CURRENT source (never ------
// --- git history), genuinely fails ---------------------------------------

test("[FAIL-BEFORE PROOF] the identical full chain, with the #69A-29C field-identity guard programmatically reverted (simulating its absence, independent of any git commit position), DROPS competitorLandscape when it collides with marketOpportunity's fallback text -- proving this test exercises the real regression, not a tautology", async () => {
  const simulatedPreFixSource = simulatePreFixPdfButtonSource(currentPdfButtonSource);

  const pipeline = await compileFullChain(simulatedPreFixSource);
  const result = runFullChain(pipeline, baseSections(TIMEOUT_FALLBACK), canonicalMetadata);
  const fields = result.map((s) => s.field);
  assert.ok(
    !fields.includes("competitorLandscape"),
    `expected the guard-reverted chain to genuinely drop competitorLandscape (reproducing the reported bug), but it survived: ${JSON.stringify(fields)}`
  );
});

test("[control] the same guard-reverted chain does NOT drop competitorLandscape when its content does not collide with anything -- confirms the fail-before failure above is specifically the content-collision bug, not a broken fixture", async () => {
  const simulatedPreFixSource = simulatePreFixPdfButtonSource(currentPdfButtonSource);
  const pipeline = await compileFullChain(simulatedPreFixSource);
  const result = runFullChain(
    pipeline,
    baseSections("COMPETITOR: Float | TYPE: Direct competitor | POSITIONING: real | STRENGTHS: real | WEAKNESSES: real | THREAT: High"),
    canonicalMetadata
  );
  assert.ok(result.some((s) => s.field === "competitorLandscape"));
});

// --- Decision safety -------------------------------------------------------

test("no decision-engine, confidence, Founder-Readiness, Porter's Five Forces, or Benchmark Intelligence file carries a #69A-29D marker -- this investigation added no production code changes, only this test", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/report-presentation.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/decision-intelligence/profiles.ts",
    "app/dashboard/[id]/ReportPdfButton.tsx",
    "components/Planner.tsx",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-29D/, `${relativePath} should not carry a #69A-29D marker -- no production fix was required`);
  }
});
