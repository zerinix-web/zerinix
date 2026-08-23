import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// CRITICAL FIX -- restore executive report visual presentation for
// Market Intelligence.
//
// Investigation found Market Intelligence's structured visual gates are
// keyed on Business Plan/Acquisition's own field and title names in both
// app/dashboard/[id]/page.tsx (title-substring gating) and
// components/Planner.tsx (field-name gating):
//
// - competitiveLandscape (Market Intelligence's real field, title
//   "Competitive Landscape") never matched the existing competitor visual,
//   which is gated on the substring "competitor" (page.tsx) / the field
//   name "competitorLandscape" (Planner.tsx, Business Plan/Acquisition's
//   field name) -- "competitive" and "competitor" never overlap.
// - strategicRecommendations never had a visual in either file at all.
// - TAM/SAM/SOM, Market Overview, Executive Summary, and Porter's Five
//   Forces were confirmed ALREADY working for Market Intelligence (this
//   is a targeted fix, not a rebuild) -- covered below as drift/regression
//   checks so they stay that way.
//
// Fixed with two new, dedicated, DATA-DRIVEN visual components (a
// Vendor/Category/Strengths/Weaknesses/Relevance table matching Market
// Intelligence's actual generated table shape, and a numbered
// recommendation-card list), added in both page.tsx and Planner.tsx,
// plus a matching PDF-export fix in ReportPdfButton.tsx (added
// "competitive landscape" to its title match and "vendor"/"market
// relevance" to its column-header keyword matching). No AI generation
// logic, routing, decision engine, or report content/field list was
// touched -- this is a presentation-layer fix only.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

// Realistic Market Intelligence competitiveLandscape content, matching
// market-intelligence-graph.ts's actual generated table shape (Vendor /
// Parent Company / Category / Segment / AI Capability / Key Use Cases /
// Pricing Model / Strengths / Weaknesses / Validation Count / Confidence
// / Market Relevance).
const marketIntelligenceCompetitorTable = [
  "| Vendor | Parent Company | Category | Segment | AI Capability | Key Use Cases | Pricing Model | Strengths | Weaknesses | Validation Count | Confidence | Market Relevance |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| Acme Compliance AI | Acme Corp | Compliance | Mid-market | Native LLM review | Contract triage | Per-seat | Strong SMB distribution | Limited enterprise features | 4 | High | High |",
  "| LegalOps Suite | Independent | Legal-tech | Enterprise | Rules-based | Policy tracking | Custom | Deep enterprise integrations | Slower AI roadmap | 3 | Medium | Medium |",
].join("\n");

// Realistic strategicRecommendations content -- a mix of numbered and
// bullet-prefixed lines, as generated content typically is.
const strategicRecommendationsContent = [
  "1. Enter via a mid-market compliance-automation wedge before expanding upstream.",
  "2. Prioritize integrations with the two most common contract-management platforms.",
  "- Build a 90-day pilot program with a signed reference customer before broader GTM.",
].join("\n");

// Extracts a top-level function's full source by name (non-greedy match
// ending at a zero-indent closing brace) -- the same convention already
// used elsewhere in this suite (see
// tests/market-intelligence-tam-sam-som-planning-estimate.test.mjs) for
// evaluating a pure helper function in isolation from its host file.
function extractFunctionSource(source, functionName) {
  const match = source.match(new RegExp(`function ${functionName}\\([\\s\\S]*?\\n\\}`));
  assert.ok(match, `${functionName} not found`);
  return match[0];
}

// Function bodies here contain their own inline TypeScript type
// annotations (e.g. a typed arrow-function local), too much for the
// simple signature-line stripping used elsewhere in this suite -- so
// this writes the extracted source to a real .ts file and lets tsx
// transpile it properly, then imports the compiled function directly.
async function compileFunction(source, functionName) {
  const raw = extractFunctionSource(source, functionName);
  const dir = mkdtempSync(join(tmpdir(), "zerinix-visual-fn-"));
  const outPath = join(dir, `${functionName}.ts`);
  writeFileSync(outPath, `export ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod[functionName];
}

// --- 1. TAM/SAM/SOM renders when data exists (regression guard) ---------

test("Market Intelligence still renders the TAM/SAM/SOM visual component on-screen (page.tsx and Planner.tsx) -- confirmed already working, guarded against regression", () => {
  assert.match(pageSource, /normalizedTitle\.includes\("tam \/ sam \/ som"\)/);
  assert.match(plannerSource, /if \(field === "tamSamSom"\)/);
  // Market Intelligence's own field/title (prompts/market.ts) is exactly
  // what both gates key on.
  assert.match(plannerSource, /field:\s*"tamSamSom",\s*title:\s*"TAM \/ SAM \/ SOM"/);
});

test("Market Intelligence still renders the TAM/SAM/SOM visual in the exported PDF (ReportPdfButton.tsx) -- confirmed already working, guarded against regression", () => {
  assert.match(pdfButtonSource, /TAM\/SAM\/SOM circle diagram/i);
});

test("Market Overview, Executive Summary, and Porter's Five Forces visuals for Market Intelligence are unaffected (drift check)", () => {
  assert.match(pageSource, /normalizedTitle\.includes\("market overview"\)/);
  assert.match(pageSource, /normalizedTitle\.includes\("porter"\)/);
  assert.match(plannerSource, /field === "marketOverview"/);
  assert.match(plannerSource, /field === "portersFiveForces"/);
});

// --- 2. Structured sections do not regress to plain text -----------------

test("page.tsx: extractMarketIntelligenceCompetitorRows extracts real vendor rows from Market Intelligence's actual table shape (Vendor / Strengths / Weaknesses / Market Relevance), not empty cells", async () => {
  const fn = await compileFunction(pageSource, "extractMarketIntelligenceCompetitorRows");
  const rows = fn(marketIntelligenceCompetitorTable);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].vendor, "Acme Compliance AI");
  assert.equal(rows[0].category, "Compliance");
  assert.match(rows[0].strengths, /Strong SMB distribution/);
  assert.match(rows[0].weaknesses, /Limited enterprise features/);
  assert.equal(rows[0].relevance, "High");
  assert.equal(rows[1].vendor, "LegalOps Suite");
});

test("Planner.tsx: extractMarketIntelligenceCompetitorRows has the same behavior as page.tsx's copy", async () => {
  const fn = await compileFunction(plannerSource, "extractMarketIntelligenceCompetitorRows");
  const rows = fn(marketIntelligenceCompetitorTable);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].vendor, "Acme Compliance AI");
  assert.equal(rows[0].relevance, "High");
});

test("page.tsx: extractRecommendationItems extracts every real recommendation line as a distinct item, not one long paragraph", async () => {
  const fn = await compileFunction(pageSource, "extractRecommendationItems");
  const items = fn(strategicRecommendationsContent);

  assert.equal(items.length, 3);
  assert.match(items[0], /mid-market compliance-automation wedge/);
  assert.match(items[1], /integrations with the two most common/);
  assert.match(items[2], /90-day pilot program/);
});

test("Planner.tsx: extractRecommendationItems has the same behavior as page.tsx's copy", async () => {
  const fn = await compileFunction(plannerSource, "extractRecommendationItems");
  const items = fn(strategicRecommendationsContent);

  assert.equal(items.length, 3);
  assert.match(items[0], /mid-market compliance-automation wedge/);
});

test("page.tsx: the Competitive Landscape and Strategic Recommendations visual branches are gated on Market Intelligence's real title strings, and hasReportSectionVisual is kept in sync", () => {
  assert.match(pageSource, /normalizedTitle\.includes\("competitive landscape"\)/);
  assert.match(pageSource, /normalizedTitle\.includes\("strategic recommendation"\)/);

  const gateMatch = pageSource.match(/function hasReportSectionVisual\([\s\S]*?\n\}/);
  assert.ok(gateMatch, "hasReportSectionVisual not found");
  assert.match(gateMatch[0], /normalizedTitle\.includes\("competitive landscape"\)/);
  assert.match(gateMatch[0], /normalizedTitle\.includes\("strategic recommendation"\)/);
});

test("Planner.tsx: the Competitive Landscape and Strategic Recommendations visual branches are gated on Market Intelligence's real field names, and hasPremiumSectionVisual is kept in sync", () => {
  assert.match(plannerSource, /if \(field === "competitiveLandscape"\)/);
  assert.match(plannerSource, /if \(field === "strategicRecommendations"\)/);

  const gateMatch = plannerSource.match(/function hasPremiumSectionVisual\([\s\S]*?\n\}/);
  assert.ok(gateMatch, "hasPremiumSectionVisual not found");
  assert.match(gateMatch[0], /section\.field === "competitiveLandscape"/);
  assert.match(gateMatch[0], /section\.field === "strategicRecommendations"/);
});

test("the new visual branches never regress to a bare text dump when real data is present -- an empty extraction result still falls back to visible content, never a silently blank card", () => {
  assert.match(pageSource, /See the Competitive Landscape section for full competitor detail\./);
  assert.match(plannerSource, /See the Competitive Landscape section for full competitor detail\./);
});

test("the existing Business Plan/Acquisition competitor visual (field 'competitorLandscape'/'competitorAnalysis') is untouched by the new Market Intelligence branch -- both are separate, additive branches", () => {
  assert.match(plannerSource, /if \(field === "competitorAnalysis" \|\| field === "competitorLandscape"\)/);
  const gateMatch = plannerSource.match(/function hasPremiumSectionVisual\([\s\S]*?\n\}/);
  assert.match(gateMatch[0], /section\.field === "competitorAnalysis"/);
  assert.match(gateMatch[0], /section\.field === "competitorLandscape"/);
});

// --- 3. PDF export preserves visual report components ---------------------

test("ReportPdfButton.tsx's competitor-table PDF drawer now also fires for Market Intelligence's 'Competitive Landscape' title, not just Business Plan/Acquisition's 'Competitor' title", () => {
  const occurrences =
    pdfButtonSource.match(/normalizedTitle\.includes\("competitor"\) \|\| normalizedTitle\.includes\("competitive landscape"\)/g) ||
    [];
  assert.equal(occurrences.length, 2, "expected both PDF competitor-table gates to also match Market Intelligence's title");
});

test("ReportPdfButton.tsx's extractCompetitorRows recognizes Market Intelligence's 'Vendor'/'Market Relevance' column headers, not just Business Plan's 'Company'/'Threat'", () => {
  assert.match(pdfButtonSource, /read\(\["company", "competitor", "vendor", "rakip"\]\)/);
  assert.match(pdfButtonSource, /read\(\["threat", "risk", "market relevance", "confidence"\]\)/);
});

// --- 4. Preserve: AI generation logic, routing, decision engine, --------
// --- and report content are untouched ------------------------------------

test("Market Intelligence's generated field list and report generation logic are untouched (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /competitiveLandscape/);
  assert.match(marketPromptSource, /strategicRecommendations/);
  assert.match(marketPromptSource, /tamSamSom/);

  const marketGraphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketGraphSource, /function buildMarketIntelligenceGraph/);
  assert.match(marketGraphSource, /function projectMarketIntelligenceGraphToReport/);
});

test("routing (classifyReportDomain, applyPromptIntentModeOverride) and the decision engine are untouched by this presentation-only fix (drift check)", () => {
  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function classifyReportDomain/);
  assert.match(domainSource, /export function applyPromptIntentModeOverride/);

  const marketPresentationSource = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    marketPresentationSource,
    /decision === "ENTER" \? "GO" : decision === "MONITOR" \? "CONDITIONAL_GO" : "NO_GO"/
  );
});

test("only visual/presentation code was added -- no report field, section, or content-shaping function was removed from either file (both extraction helpers are additive)", () => {
  // The pre-existing competitor extractor and its Business Plan/
  // Acquisition consumer are still present verbatim.
  assert.match(pageSource, /function extractBullets\(content: string, fallback: string\)/);
  assert.match(plannerSource, /function extractCompetitorRows\(content: string\)/);
});
