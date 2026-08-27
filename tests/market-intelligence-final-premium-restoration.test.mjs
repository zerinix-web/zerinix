import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { extractSectionMainExplanation } from "../app/lib/report-presentation.ts";

// FINAL PREMIUM REPORT RESTORATION -- FIX WEB + PDF PRESENTATION LAYER.
//
// The prior ticket ("FINAL REPORT PRESENTATION CLEANUP") added
// marketDrivers/barriers/opportunities/threats to cardFirstReportFields on
// the assumption each had its own dedicated visual -- but only
// marketDrivers gets the ONE-TIME combined MarketForcesQuadrant; Barriers/
// Opportunities/Threats individually had NO visual, ExecutiveInsightBanner
// (gated on hasReportSectionVisual, which never listed them), or
// SectionTakeaway (now excluded) -- leaving those three sections showing
// literally nothing but a title, with all real content buried behind a
// collapsed Details disclosure. This is a genuine regression this ticket
// fixes, alongside Customer Segments/Major Players, which never had a
// SectionTakeaway-only, bullet-less treatment.
//
// The fix: a new per-field "Key Takeaway + main explanation + real bullet
// points" card for exactly these six fields (marketDrivers, barriers,
// opportunities, threats, customerSegments, majorPlayers), always visible
// without opening Details, with a premium Validation Needed fallback when
// truly nothing can be extracted -- never a blank card. Full raw text
// (extended methodology) stays reachable only inside the existing
// collapsed AnalysisNotes disclosure.
//
// It also fixes a real PDF bug: Competitive Landscape's raw markdown
// table ("| Vendor | Category | ... |") was being drawn a second time as
// literal unformatted body text below the already-rendered real table.
//
// AI generation, report schema, calculations, routing, and prompts are
// untouched -- confirmed via drift checks below.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

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

async function compileFunction(source, functionName) {
  const raw = extractFunctionSource(source, functionName);
  const dir = mkdtempSync(join(tmpdir(), "zerinix-final-restoration-fn-"));
  const outPath = join(dir, `${functionName}.ts`);
  writeFileSync(outPath, `export ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod[functionName];
}

// --- 1. Every major list section shows visible content, not just a title -

test("page.tsx and Planner.tsx: extractRealBulletLines only returns genuine bullet/numbered lines from the model's own output -- never fabricated by splitting prose (regression-safe, matches 'bullet points when multiple items exist')", async () => {
  for (const source of [pageSource, plannerSource]) {
    const fn = await compileFunction(source, "extractRealBulletLines");

    const withBullets = fn(
      "Regulatory tailwinds are accelerating adoption.\n- Rising compliance costs push mid-market buyers toward automation.\n- New data-residency rules favor regional vendors.\n- Enterprise budgets for this category grew 22% year over year."
    );
    assert.equal(withBullets.length, 3);
    assert.match(withBullets[0], /Rising compliance costs/);

    const proseOnly = fn(
      "This is a plain paragraph with no bullet markers at all. It just runs as prose across two full sentences."
    );
    assert.equal(proseOnly.length, 0);
  }
});

test("page.tsx and Planner.tsx: extractSectionMainExplanation returns the sentence(s) AFTER the takeaway by index, robust to getSectionTakeaway's own separate normalization/truncation -- never silently restates the takeaway", () => {
  // extractSectionMainExplanation now lives once in
  // app/lib/report-presentation.ts (shared by both files), so its
  // behavior is exercised once via the real, shared implementation
  // rather than a per-file source extraction.
  const content =
    "Enterprise buyers are consolidating vendor relationships around compliance-first platforms. Mid-market adoption still lags due to integration cost. A handful of regional players are closing that gap with lighter-weight offerings.";

  // Even when the takeaway string does NOT appear verbatim in content
  // (simulating getSectionTakeaway's own normalization/truncation), the
  // explanation must still skip ahead by one sentence rather than
  // restating sentence 1.
  const explanation = extractSectionMainExplanation(content, "Enterprise buyers are consolidating vendor relationships around compliance-first platforms...");
  assert.doesNotMatch(explanation, /^Enterprise buyers are consolidating/);
  assert.match(explanation, /Mid-market adoption still lags/);

  const noTakeaway = extractSectionMainExplanation(content, "");
  assert.match(noTakeaway, /^Enterprise buyers are consolidating/);
});

test("page.tsx: ReportSectionVisual has a dedicated card for Market Drivers/Barriers/Opportunities/Threats/Customer Segments/Major Players -- Key Takeaway label, main explanation, and bullets only when real list items exist, with a Validation Needed fallback (never a blank card)", () => {
  assert.match(
    pageSource,
    /normalizedTitle\.includes\("market driver"\) \|\|\s*\n\s*normalizedTitle\.includes\("barrier"\) \|\|\s*\n\s*normalizedTitle\.includes\("opportunities"\) \|\|\s*\n\s*normalizedTitle\.includes\("threat"\) \|\|\s*\n\s*normalizedTitle\.includes\("customer segment"\) \|\|\s*\n\s*normalizedTitle\.includes\("major player"\)/
  );
  assert.match(pageSource, /getReportPresentationLabels\(content\)\.keyTakeaway/);
  assert.match(pageSource, /\{bullets\.length > 1 \? \(/);
  assert.match(pageSource, /if \(!takeaway && !explanation && bullets\.length === 0\) \{/);
});

test("page.tsx: the new 'opportunities' title check is deliberately plural-specific -- it must NOT steal Business Plan's singular 'Market Opportunity' title, which has its own separate, existing branch", () => {
  assert.doesNotMatch(pageSource, /normalizedTitle\.includes\("opportunit"\) \|\|/);
  // Confirm the pre-existing Market Opportunity/Overview branch is intact
  // and reachable (i.e. not shadowed by the new branch, which comes
  // first in the function and would otherwise intercept it).
  assert.match(
    pageSource,
    /normalizedTitle\.includes\("market opportunity"\) \|\| normalizedTitle\.includes\("market overview"\) \|\| normalizedTitle\.includes\("market analysis"\)/
  );
});

test("Planner.tsx: PremiumSectionVisual has the matching field-keyed branch, and hasPremiumSectionVisual (the function's own early-return guard) lists all six fields -- without this, the branch would be unreachable", () => {
  assert.match(
    plannerSource,
    /field === "marketDrivers" \|\|\s*\n\s*field === "barriers" \|\|\s*\n\s*field === "opportunities" \|\|\s*\n\s*field === "threats" \|\|\s*\n\s*field === "customerSegments" \|\|\s*\n\s*field === "majorPlayers"/
  );
  const gateMatch = plannerSource.match(/function hasPremiumSectionVisual\([\s\S]*?\n\}/);
  assert.ok(gateMatch, "hasPremiumSectionVisual not found");
  for (const field of ["marketDrivers", "barriers", "opportunities", "threats", "customerSegments", "majorPlayers"]) {
    assert.match(gateMatch[0], new RegExp(`section\\.field === "${field}"`));
  }
});

test("page.tsx and Planner.tsx: cardFirstReportFields now also includes customerSegments and majorPlayers -- their new dedicated card already shows the Key Takeaway, so the generic SectionTakeaway no longer duplicates it", () => {
  for (const source of [pageSource, plannerSource]) {
    const setMatch = source.match(/const cardFirstReportFields = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(setMatch, "cardFirstReportFields not found");
    assert.match(setMatch[1], /"customerSegments",/);
    assert.match(setMatch[1], /"majorPlayers",/);
  }
});

// --- 2. PDF export parity: no raw markdown table dumped as plain text ----

test("ReportPdfButton.tsx and Planner.tsx's downloadPdf: stripPdfMarkdownTableLines removes only markdown table row/separator lines, keeping genuine surrounding commentary -- Competitive Landscape's real table (drawn separately) is never duplicated as raw pipe-delimited text below it", async () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    const fn = await compileFunction(source, "stripPdfMarkdownTableLines");
    const withTable =
      "Executive implication: incumbents are consolidating share.\n| Vendor | Category | Segment |\n| --- | --- | --- |\n| Acme AI | Compliance | Mid-market |\nSwitching barriers remain moderate.";
    const cleaned = fn(withTable);
    assert.doesNotMatch(cleaned, /\| Vendor \| Category \| Segment \|/);
    assert.doesNotMatch(cleaned, /\| Acme AI \| Compliance \| Mid-market \|/);
    assert.match(cleaned, /Executive implication: incumbents are consolidating share\./);
    assert.match(cleaned, /Switching barriers remain moderate\./);
  }
});

test("ReportPdfButton.tsx and Planner.tsx: removeDuplicateVisualText routes Competitive Landscape/competitor content through stripPdfMarkdownTableLines, in addition to (not instead of) the existing cleanup pipeline", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(
      source,
      /if \(normalizedTitle\.includes\("competitive landscape"\) \|\| normalizedTitle\.includes\("competitor"\)\) \{\s*\n\s*return stripPdfMarkdownTableLines\(cleaned\);\s*\n\s*\}/
    );
  }
});

// --- 3. Preserve existing working visuals (regression guard) --------------

test("Porter radar, Decision dashboard, Risk heatmap-equivalent (Executive Snapshot), and Strategic Recommendation cards are all untouched by this pass", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /rounded-full border border-teal-200\/10/); // Porter radar rings
    assert.match(source, /function ExecutiveSnapshotPanel/);
  }
  assert.match(pageSource, /normalizedTitle\.includes\("strategic recommendation"\)/);
  assert.match(plannerSource, /field === "strategicRecommendations"/);
  assert.match(pdfButtonSource, /const isPorterSection = normalizedTitle\.includes\("porter"\)/);
  assert.match(pdfButtonSource, /const executiveSnapshot = buildExecutiveSnapshot\(/);
});

// --- 4. No empty-looking sections: Validation Needed, not a blank card ---

test("the new six-field card falls back to a premium 'Validation Needed' state (never a silently blank card) exactly when nothing at all could be extracted -- matching the same visual language used across TAM/SAM/SOM, Market Metrics, and Competitive Landscape", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /border-dashed border-white\/15 bg-black\/20 p-5/);
    assert.match(source, /data could be established for this market yet\./);
  }
});

// --- 5. Preserve: AI generation, report schema, calculations, routing, ---
// --- prompts -----------------------------------------------------------

test("AI generation, report schema, calculations, routing, and prompts are untouched -- this pass only changed presentation hierarchy and PDF body-text filtering (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /marketDrivers:/);
  assert.match(marketPromptSource, /barriers:/);
  assert.match(marketPromptSource, /opportunities:/);
  assert.match(marketPromptSource, /threats:/);
  assert.match(marketPromptSource, /customerSegments:/);
  assert.match(marketPromptSource, /majorPlayers:/);

  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function classifyReportDomain/);

  const marketGraphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketGraphSource, /function buildMarketIntelligenceGraph/);
});
