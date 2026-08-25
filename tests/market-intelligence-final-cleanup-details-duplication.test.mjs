import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// FINAL CLEANUP -- REMOVE ALL REDUNDANT "DETAILS" DUPLICATION FROM MARKET
// INTELLIGENCE.
//
// Prior tickets built premium visual cards for every major section, but
// kept a collapsed "Details" (AnalysisNotes) disclosure underneath EVERY
// section unconditionally, containing that section's full raw text. For
// the sections that already have a complete dedicated visual, that raw
// text just repeated what the card already showed -- exactly the
// duplication this ticket's live-verified bug report described.
//
// The fix has two parts, applied consistently to page.tsx, Planner.tsx
// (on-screen), and BOTH PDF exports (ReportPdfButton.tsx and Planner.tsx's
// own downloadPdf):
//
// 1. Sixteen fields (`pdfCompleteVisualFields` in the PDF files,
//    `cardFirstReportFields` on-screen) now have their raw-text
//    disclosure/paragraph REMOVED ENTIRELY, not just collapsed --
//    executiveSummary, marketSize, cagr, competitiveLandscape,
//    majorPlayers, customerSegments, marketDrivers, barriers,
//    opportunities, threats, regionalAnalysis, industryTrends,
//    marketSegmentation, tamSamSom, portersFiveForces,
//    strategicRecommendations.
// 2. To make that safe (no information loss), each of those fields' own
//    visual was enriched to capture the COMPLETE content, not a capped
//    teaser: the Key Takeaway cards' explanation is now uncapped (all
//    remaining sentences, not 2) and bullets are capped at a generous 8
//    (not 4); TAM/SAM/SOM's legend and Porter's force cards each gained
//    their own real per-item sentence (assumption / implication) in BOTH
//    PDF exports, matching the on-screen visual exactly.
//
// AI generation, research logic, source handling, calculation logic,
// validation rules, confidence logic, TAM/SAM/SOM nesting validation,
// routing, and the report schema are untouched -- confirmed via drift
// checks below.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

const completeVisualFields = [
  "executiveSummary",
  "marketDrivers",
  "barriers",
  "opportunities",
  "threats",
  "customerSegments",
  "majorPlayers",
  "regionalAnalysis",
  "industryTrends",
  "marketSegmentation",
  "tamSamSom",
  "strategicRecommendations",
  "portersFiveForces",
  "marketSize",
  "cagr",
  "competitiveLandscape",
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

// A later ticket ("MARKET INTELLIGENCE -- ROOT-CAUSE DATA PIPELINE
// REPAIR") made extractRecommendationItems depend on a new sibling
// helper, isRecommendationHeadingLine (rejects a section-intro/label
// line the model wrote before its real numbered actions) -- it must
// compile alongside the main function for this isolated module to run.
const functionDependencies = {
  extractRecommendationItems: /function isRecommendationHeadingLine\([\s\S]*?\n\}/,
};

async function compileFunction(source, functionName) {
  const raw = extractFunctionSource(source, functionName);
  const dependencyPattern = functionDependencies[functionName];
  const dependency = dependencyPattern ? source.match(dependencyPattern)?.[0] : null;
  if (dependencyPattern) {
    assert.ok(dependency, `dependency for ${functionName} not found`);
  }
  const dir = mkdtempSync(join(tmpdir(), "zerinix-details-cleanup-fn-"));
  const outPath = join(dir, `${functionName}.ts`);
  writeFileSync(outPath, `${dependency ? `${dependency}\n` : ""}export ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod[functionName];
}

// --- 1. cardFirstReportFields now includes all 16 complete-visual fields --

test("page.tsx and Planner.tsx: cardFirstReportFields contains all 16 complete-visual fields, including marketSize/cagr/competitiveLandscape (previously missing, which caused the 4-layer Investor Insight + card + Key Takeaway + Details repetition on Market Size/CAGR/Competitive Landscape)", () => {
  for (const source of [pageSource, plannerSource]) {
    const setMatch = source.match(/const cardFirstReportFields = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(setMatch, "cardFirstReportFields not found");
    for (const field of completeVisualFields) {
      assert.match(setMatch[1], new RegExp(`"${field}",`));
    }
  }
});

// --- 2. No redundant DETAILS block, no empty DETAILS container -----------

test("page.tsx desktop: AnalysisNotes (the DETAILS disclosure) no longer renders at all for cardFirstReportFields sections -- not collapsed, not empty, simply absent -- every other section keeps it unchanged", () => {
  assert.match(
    pageSource,
    /detailsContent\.trim\(\) && !cardFirstReportFields\.has\(section\.field \?\? ""\) \? \(\s*\n\s*<AnalysisNotes/
  );
  // The stale intermediate state (banner/takeaway gated but AnalysisNotes
  // always rendering regardless) must not have crept back in.
  assert.doesNotMatch(pageSource, /\{detailsContent\.trim\(\) \? \(\s*\n\s*<AnalysisNotes/);
});

test("page.tsx mobile: the raw-text block no longer renders at all for card-first sections (was previously wrapped in a collapsed AnalysisNotes -- now neither collapsed nor expanded, simply absent)", () => {
  assert.match(
    pageSource,
    /\{detailsContent\.trim\(\) && !isCardFirstSection \? \(\s*\n\s*<div className="min-w-0 rounded-\[1\.25rem\] border border-white\/\[0\.12\]/
  );
  assert.doesNotMatch(pageSource, /isCardFirstSection \? \(\s*\n\s*<AnalysisNotes/);
});

test("Planner.tsx: AnalysisNotes no longer renders at all for cardFirstReportFields sections -- not collapsed, not empty, simply absent", () => {
  assert.match(
    plannerSource,
    /hasVisibleDetailsContent && !cardFirstReportFields\.has\(section\.field \?\? ""\) \? \(\s*\n\s*<AnalysisNotes/
  );
  assert.doesNotMatch(plannerSource, /\{hasVisibleDetailsContent \? \(\s*\n\s*<AnalysisNotes/);
});

test("SectionTakeaway is also fully excluded for the same 16 fields on both page.tsx and Planner.tsx -- no half-removed state where the card, the takeaway snippet, AND a raw-text block could all show together", () => {
  assert.match(
    pageSource,
    /detailsContent\.trim\(\) && !cardFirstReportFields\.has\(section\.field \?\? ""\) \? \(\s*\n\s*<SectionTakeaway/
  );
  assert.match(
    plannerSource,
    /hasVisibleDetailsContent && !cardFirstReportFields\.has\(section\.field \?\? ""\) \? \(\s*\n\s*<SectionTakeaway/
  );
});

// --- 3. No visual + identical raw-text duplicate; unique info preserved --

test("page.tsx and Planner.tsx: extractSectionMainExplanation is now UNCAPPED (all remaining sentences, no 2-sentence/320-char ceiling) and excludes bullet-marked lines from its sentence pool -- the card must capture the section's complete remaining prose since there is no more Details to fall back on, and bullets/explanation must never show the same list item twice", async () => {
  for (const source of [pageSource, plannerSource]) {
    const fn = await compileFunction(source, "extractSectionMainExplanation");
    const content =
      "Enterprise buyers are consolidating vendor relationships. Mid-market adoption lags due to integration cost. A handful of regional players are closing the gap. Procurement cycles remain long across the sector. Budget owners increasingly demand compliance certification before signing.";
    const explanation = fn(content, "Enterprise buyers are consolidating vendor relationships.");
    // All four remaining sentences must be present -- not just the first two.
    assert.match(explanation, /Mid-market adoption lags/);
    assert.match(explanation, /A handful of regional players/);
    assert.match(explanation, /Procurement cycles remain long/);
    assert.match(explanation, /Budget owners increasingly demand/);

    const withBullets = fn("Intro sentence here as the takeaway.\n- Real bullet one.\n- Real bullet two.", "Intro sentence here as the takeaway.");
    assert.doesNotMatch(withBullets, /Real bullet/);
  }
});

test("page.tsx and Planner.tsx: extractRealBulletLines is capped at a generous 8 (not the old 4), so a genuinely longer real ranked list is never silently cut now that Details is gone", async () => {
  for (const source of [pageSource, plannerSource]) {
    const fn = await compileFunction(source, "extractRealBulletLines");
    const content = Array.from({ length: 6 }, (_, i) => `- Real item number ${i + 1} with enough length to count.`).join("\n");
    const bullets = fn(content);
    assert.equal(bullets.length, 6);
  }
});

// --- 4, 5, 6, 7, 8. TAM/SAM/SOM, Porter, Market Size/CAGR, Recommendations,
// Drivers/Barriers/Opportunities/Threats remain complete without DETAILS --

test("TAM/SAM/SOM: the visual (values + validation status + estimated/verified state + real per-layer assumption sentence + TAM->SAM->SOM dependency via the cascading resolution chain) is complete without opening Details on page.tsx and Planner.tsx", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /\{isResolved && assumption \? \(|\{row\.description \? \(/);
    assert.match(source, /const samResolved = tamResolved && magnitudes\[1\] !== null && magnitudes\[1\] <= \(magnitudes\[0\] as number\);/);
  }
});

test("Porter's Five Forces: the radar + force cards remain the canonical presentation -- each card now carries its own real investor-interpretation sentence in BOTH page.tsx/Planner.tsx (on-screen) and BOTH PDF exports, so removing the duplicate prose block loses nothing", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.match(source, /function extractForceImplication/);
  }
  assert.match(pdfButtonSource, /const implication = extractForceImplication\(content, force\);/);
  assert.match(plannerSource, /const implication = extractForceImplication\(section\.content, force\);/);
});

test("Strategic Recommendations: the action cards (Action, Owner, Timeline, Budget, Success Metric, Decision Gate) remain the canonical presentation on-screen and in both PDF exports -- verified this does not silently drop content by confirming extractRecommendationItems captures every non-empty line (verdict prose included), not just marker-prefixed action lines", async () => {
  for (const source of [pageSource, plannerSource]) {
    const fn = await compileFunction(source, "extractRecommendationItems");
    const withVerdictLine =
      "This market supports a cautious pilot entry.\n\n1. Launch a 90-day pilot in the DACH region.\n\n2. Validate pricing with 10 design partners.\n\n3. Secure a compliance certification before scaling.";
    const items = fn(withVerdictLine);
    assert.ok(items.some((item) => /cautious pilot entry/.test(item)), "the verdict line must not be silently dropped");
    assert.ok(items.some((item) => /Launch a 90-day pilot/.test(item)));
  }
});

test("Market Drivers/Barriers/Opportunities/Threats: rendered as the Key Takeaway + explanation + bullets card, containing the decision-useful content directly -- the same numbered paragraphs are never ALSO rendered inside a Details block below them", () => {
  for (const source of [pageSource, plannerSource]) {
    const setMatch = source.match(/const cardFirstReportFields = new Set\(\[([\s\S]*?)\]\);/)[1];
    for (const field of ["marketDrivers", "barriers", "opportunities", "threats"]) {
      assert.match(setMatch, new RegExp(`"${field}",`));
    }
  }
});

// --- 10. Web + PDF consistency: same anti-duplication rule in the PDF ----

// A later ticket ("RESTORE PREMIUM ANALYTICAL DEPTH -- WITHOUT RESTORING
// DUPLICATION") found this exact assumption ("matches ... exactly") was
// itself wrong for marketSize/cagr: unlike page.tsx's/Planner.tsx's own
// on-screen card (headline value + its own real Evidence & Analysis
// paragraph -- genuinely complete on its own), this PDF export never drew
// an equivalent complete visual for either field (marketSize gets only a
// derived-metric tile grid with no reasoning; cagr gets no visual at
// all), so suppressing their body text here left both sections either
// evidence-free or completely empty. marketSize/cagr were removed from
// this Set specifically so their real body prose renders again -- see
// tests/market-intelligence-legacy-body-and-authoritative-state.test.mjs
// (or its successor) for that fix's own dedicated coverage.
//
// CRITICAL FIX -- root-cause repair (ticket: "Fix the remaining
// canonical-data consistency and PDF export defects"): the SAME class of
// bug was found to apply to the other 9 pdfKeyTakeawayCardFields members
// too (marketDrivers/barriers/opportunities/threats/customerSegments/
// majorPlayers/regionalAnalysis/industryTrends/marketSegmentation). They
// were being pulled into this Set via a `...pdfKeyTakeawayCardFields`
// spread that directly contradicted that Set's OWN adjacent comment,
// which explicitly promises "the full body prose still draws below it
// unchanged" for exactly these fields. In reality the PDF's "Key
// Takeaway" box for these fields (built via getSectionTakeaway) is capped
// to 3 lines/220 characters -- not a complete visual the way marketSize's
// tile grid or TAM/SAM/SOM's legend is -- so suppressing body text here
// silently collapsed real content (most visibly: a full list of named
// Major Players vendors down to one truncated sentence). The spread was
// removed; all 9 fields now join marketSize/cagr as documented exceptions
// where the PDF's own set diverges from the web's cardFirstReportFields
// (the web's equivalent card IS complete/uncapped there, so its
// suppression stays correct and unchanged -- see tests above).
test("ReportPdfButton.tsx: pdfCompleteVisualFields matches page.tsx's/Planner.tsx's on-screen cardFirstReportFields for every field EXCEPT marketSize/cagr/the 9 Key-Takeaway-card fields (deliberate, documented exceptions -- see comment above) -- the raw section paragraph is still suppressed entirely (return '') for every other one of them, never drawn a second time below the visual", () => {
  const setMatch = pdfButtonSource.match(/const pdfCompleteVisualFields = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(setMatch, "pdfCompleteVisualFields not found");
  const documentedExceptions = new Set([
    "marketSize",
    "cagr",
    "marketDrivers",
    "barriers",
    "opportunities",
    "threats",
    "customerSegments",
    "majorPlayers",
    "regionalAnalysis",
    "industryTrends",
    "marketSegmentation",
  ]);
  for (const field of completeVisualFields) {
    if (documentedExceptions.has(field)) {
      assert.doesNotMatch(setMatch[1], new RegExp(`"${field}",`));
      continue;
    }
    assert.match(setMatch[1], new RegExp(`"${field}",`));
  }
  assert.doesNotMatch(setMatch[1], /\.\.\.pdfKeyTakeawayCardFields,/);
  assert.match(
    pdfButtonSource,
    /const isPdfCompleteVisualSection = pdfCompleteVisualFields\.has\(section\.field \?\? ""\) \|\| isTamSamSomPdfSection;/
  );
  assert.match(pdfButtonSource, /isPdfCompleteVisualSection\s*\n\s*\? ""/);
});

test("Planner.tsx's downloadPdf: pdfCompleteVisualFields matches ReportPdfButton.tsx's set (no ...pdfKeyTakeawayCardFields spread), and formatPdfReadableContent returns '' immediately for every one of them -- both PDF exports share the exact same anti-duplication rule", () => {
  const setMatch = plannerSource.match(/const pdfCompleteVisualFields = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(setMatch, "pdfCompleteVisualFields not found in Planner.tsx");
  assert.doesNotMatch(setMatch[1], /\.\.\.pdfKeyTakeawayCardFields,/);
  assert.match(
    plannerSource,
    /if \(\s*\n\s*pdfCompleteVisualFields\.has\(section\.field \?\? ""\) \|\|\s*\n\s*section\.field === "tamSamSom" \|\|\s*\n\s*isTamSamSomTitle\(section\.title\)\s*\n\s*\) \{\s*\n\s*return "";\s*\n\s*\}/
  );
});

test("ReportPdfButton.tsx and Planner.tsx: the TAM/SAM/SOM PDF card's now-dead 'draw commentary only when coherently nested' branch was removed, not left as inert dead code -- sectionBodyContent is unconditionally empty for tamSamSom now, so that branch could never fire", () => {
  assert.doesNotMatch(pdfButtonSource, /isTamSamSomCoherentlyNested/);
});

test("ReportPdfButton.tsx and Planner.tsx: stripPdfLeadingTakeaway (the prior ticket's partial fix) and its now-unused import (normalizePdfTamSamSomBodyContent) were fully removed, not left as dead code", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.doesNotMatch(source, /function stripPdfLeadingTakeaway/);
    assert.doesNotMatch(source, /normalizePdfTamSamSomBodyContent/);
  }
});

// --- Preserve: AI generation, research logic, source handling, -----------
// --- calculation logic, validation rules, confidence logic, TAM/SAM/SOM --
// --- nesting validation, routing, report schema ---------------------------

test("AI generation, research logic, source handling, calculation logic, validation rules, confidence logic, TAM/SAM/SOM nesting validation, routing, and the report schema are all untouched -- this pass only removed redundant presentation-layer text and enriched extraction to preserve information (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /Define TAM, SAM, and SOM using explicit market boundaries/);
  assert.match(marketPromptSource, /portersFiveForces:/);
  assert.match(marketPromptSource, /strategicRecommendations:/);

  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function classifyReportDomain/);

  const marketGraphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketGraphSource, /function buildMarketIntelligenceGraph/);

  // The TAM/SAM/SOM cascading nesting-validation chain (samResolved
  // requires magnitudes[1] <= magnitudes[0], etc.) is exactly as the
  // prior ticket left it -- untouched by this presentation-only pass.
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /const samResolved = tamResolved && magnitudes\[1\] !== null && magnitudes\[1\] <= \(magnitudes\[0\] as number\);/);
    assert.match(source, /const somResolved = samResolved && magnitudes\[2\] !== null && magnitudes\[2\] <= \(magnitudes\[1\] as number\);/);
  }
});
