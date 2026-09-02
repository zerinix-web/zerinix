import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// CRITICAL FIX -- restore true investor-grade visual report components
// for Market Intelligence (round 2).
//
// The prior two "restore" tickets added real cards for Market Intelligence
// (Competitive Landscape table, Strategic Recommendation cards, Market
// Metrics cards, a Market Forces four-quadrant view) but this
// investigation found the two flagship visuals SHARED with Business Plan
// -- TAM/SAM/SOM and Porter's Five Forces -- were themselves still
// showing old fake-data behavior for EVERY report, Market Intelligence
// included:
//
// - TAM/SAM/SOM's bar widths were a static [100%, 62%, 28%] array,
//   never derived from the actual extracted TAM/SAM/SOM figures.
//   Planner.tsx's own downloadPdf function already had a correct,
//   real-data implementation (parseMarketSizeMagnitude + a TAM>=SAM>=SOM
//   coherence check) for the exported PDF -- the on-screen visual had
//   simply drifted out of sync with it. Both page.tsx and Planner.tsx's
//   on-screen visuals now compute real proportional widths from the
//   report's own figures, show a premium "Not established" state for any
//   single missing layer, and a premium "Validation Needed" state for
//   the whole component when no coherent figures exist at all -- plus a
//   real market-size explanation excerpt (previously computed as
//   row.description in Planner.tsx but never actually rendered).
// - Porter's Five Forces' intensity bars were a static [72, 54, 66, 48,
//   60] array, identical for every report, even though the section's own
//   prompt requires "a qualitative assessment ... for each force". Each
//   force's real intensity (high/moderate/low) is now read back out of
//   the generated text near that force's own name, with a "Not
//   specified" state (never a guessed number) when no signal is present.
// - Competitive Landscape's table gained a Position column (from the
//   Segment/AI Capability data already generated), and Strategic
//   Recommendation cards now show a real, best-effort Action/Owner/
//   Timeline/Success Metric breakdown (never a fabricated Owner when the
//   text doesn't name one).
//
// Nothing here touches AI generation logic, routing, validation rules,
// or uncertainty handling -- confirmed below via drift checks. The radar
// positioning of Porter's Five Forces, the quadrant layout of the SWOT
// equivalent, and the four-column competitor table shape are unchanged;
// only their DATA is now real.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
// TASK #29J -- extractRecommendationSignals (and recommendationOwnerRolePattern,
// its dependency) was consolidated into this single shared module.
const reportPresentationSource = readFileSync(
  new URL("../app/lib/report-presentation.ts", import.meta.url),
  "utf8"
);

function extractFunctionSource(source, functionName) {
  const match = source.match(new RegExp(`function ${functionName}\\([\\s\\S]*?\\n\\}`));
  assert.ok(match, `${functionName} not found`);
  return match[0];
}

// extractForceIntensity depends on the preceding `forceAliases` const,
// and extractRecommendationSignals depends on the preceding
// `recommendationOwnerRolePattern` const -- both extracted alongside the
// function itself so the compiled module has everything it references.
const functionDependencies = {
  extractForceIntensity: /const forceAliases: Record<string, string\[\]> = \{[\s\S]*?\n\};/,
  // TASK #43A -- extractRecommendationSignals now also protects each
  // label-based field's own known abbreviations (protectSentenceAbbreviations/
  // restoreSentenceAbbreviations, both module-private, and the
  // SENTENCE_ABBREVIATIONS list they read) before applying its
  // `\.\s`-based terminator, so this isolated module needs all three
  // alongside the pre-existing recommendationOwnerRolePattern dependency.
  extractRecommendationSignals: [
    /export const SENTENCE_ABBREVIATIONS = \[[\s\S]*?\n\];/,
    /(?:export )?function protectSentenceAbbreviations\([\s\S]*?\n\}\n\n(?:export )?function restoreSentenceAbbreviations\([\s\S]*?\n\}/,
    /export const recommendationOwnerRolePattern =[\s\S]*?;/,
  ],
  // A later ticket ("RESTORE PREMIUM ANALYTICAL DEPTH") split
  // extractMarketIntelligenceCompetitorRows into a 3-tier fallback chain
  // (table -> flattened bullets -> Major Players' own bullets), each its
  // own helper function; a still-later ticket ("MARKET INTELLIGENCE --
  // ROOT-CAUSE DATA PIPELINE REPAIR") added isImplausibleCompetitorName
  // OnScreen/...Pdf right before this chain (each tier now calls it) --
  // all of these must compile alongside the main function for this
  // isolated module to run.
  extractMarketIntelligenceCompetitorRows:
    /function isImplausibleCompetitorName(?:OnScreen|Pdf)\([\s\S]*?\nfunction extractMarketIntelligenceCompetitorRowsFromTable\([\s\S]*?\n\}/,
};

async function compileFunction(source, functionName) {
  const raw = extractFunctionSource(source, functionName);
  const dependencyPatterns = functionDependencies[functionName];
  const patterns = Array.isArray(dependencyPatterns)
    ? dependencyPatterns
    : dependencyPatterns
      ? [dependencyPatterns]
      : [];
  const dependencyPieces = patterns.map((pattern) => {
    const match = source.match(pattern)?.[0];
    assert.ok(match, `dependency for ${functionName} not found (pattern: ${pattern})`);
    return match;
  });
  const dependency = dependencyPieces.length > 0 ? dependencyPieces.join("\n\n") : null;
  const dir = mkdtempSync(join(tmpdir(), "zerinix-investor-grade-fn-"));
  const outPath = join(dir, `${functionName}.ts`);
  writeFileSync(outPath, `${dependency ? `${dependency}\n` : ""}export ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod[functionName];
}

// --- 1. TAM/SAM/SOM: real proportions, real empty states ------------------

test("page.tsx and Planner.tsx no longer hardcode TAM/SAM/SOM bar widths as a static [100, 62, 28] / [100%, 62%, 28%] array", () => {
  assert.doesNotMatch(pageSource, /width: "100%".*width: "62%".*width: "28%"/s);
  assert.doesNotMatch(plannerSource, /\[100, 68, 36\]\[index\]/);
});

test("page.tsx: parseMonetaryMagnitude correctly parses real currency figures, including units and ranges", async () => {
  const fn = await compileFunction(pageSource, "parseMonetaryMagnitude");
  assert.equal(fn("$2.4B"), 2.4e9);
  assert.equal(fn("$800 million"), 8e8);
  assert.equal(fn("€150K"), 1.5e5);
  assert.equal(fn(""), null);
  assert.equal(fn("no figure here"), null);
});

test("page.tsx: TAM/SAM/SOM renders a premium 'Validation Needed' empty state per layer (not fake bars) when no figures can be established -- the visual stack itself is never replaced by a combined empty card", () => {
  assert.doesNotMatch(pageSource, /if \(maxMagnitude === 0\)/);
  assert.match(pageSource, /Additional market validation is required before sizing can be confirmed\./);
});

test("page.tsx: a single missing TAM/SAM/SOM layer shows 'Validation Needed', not a fabricated bar width -- and a layer is now only resolved when its whole parent chain is also resolved and nested", () => {
  assert.match(
    pageSource,
    /const width = isResolved && magnitude !== null \? `\$\{Math\.max\(8, \(magnitude \/ maxMagnitude\) \* 100\)\}%` : null;/
  );
  assert.match(pageSource, /const samResolved = tamResolved && magnitudes\[1\] !== null && magnitudes\[1\] <= \(magnitudes\[0\] as number\);/);
  assert.match(pageSource, /const somResolved = samResolved && magnitudes\[2\] !== null && magnitudes\[2\] <= \(magnitudes\[1\] as number\);/);
});

test("page.tsx: TAM/SAM/SOM no longer shows a per-layer assumption excerpt inline in the main visual -- methodology/assumptions live only in the section's own expandable Details disclosure", async () => {
  assert.doesNotMatch(pageSource, /const assumptions = bars\.map\(\(bar\) => extractMarketSizeAssumption\(content, bar\.label\)\);/);
  assert.doesNotMatch(pageSource, /\{value && assumption \? \(/);
});

test("Planner.tsx: the on-screen TAM/SAM/SOM visual reuses parseMarketSizeMagnitude (already correct in the PDF export) instead of a static bar-width array, with a per-layer cascading nesting check -- row.description (the real planning-assumption/sizing-explanation text) is rendered inline again per the later 'user must immediately see ... sizing explanation without opening DETAILS' requirement", () => {
  // Task #11 fix: this line's PDF-export counterpart now carries an
  // explicit tuple type-cast (needed for resolveMarketSizingCascade's
  // stricter parameter type) -- the underlying computation is unchanged.
  assert.match(plannerSource, /const magnitudes = rows\.map\(\(row\) => parseMarketSizeMagnitude\(row\.value\)\)/);
  assert.match(plannerSource, /const samResolved = tamResolved && magnitudes\[1\] !== null && magnitudes\[1\] <= \(magnitudes\[0\] as number\);/);
  assert.match(plannerSource, /const somResolved = samResolved && magnitudes\[2\] !== null && magnitudes\[2\] <= \(magnitudes\[1\] as number\);/);
  // A later ticket ("RESTORE PREMIUM ANALYTICAL DEPTH") removed the
  // line-clamp-2 here -- a real, single-sentence methodology/assumption
  // explanation could still run long enough to get cut off at that width.
  assert.match(plannerSource, /<p className="mt-3 text-xs leading-5 text-zinc-500">\{row\.description\}<\/p>/);
});

// --- 2. Porter's Five Forces: real intensity, keeps the radar -------------

test("page.tsx and Planner.tsx no longer hardcode Porter's Five Forces intensity as a static [72, 54, 66, 48, 60] array", () => {
  assert.doesNotMatch(pageSource, /\[72, 54, 66, 48, 60\]\[index\]/);
  assert.doesNotMatch(plannerSource, /\[72, 54, 66, 48, 60\]\[index\]/);
});

test("page.tsx and Planner.tsx: extractForceIntensity reads a real qualitative assessment (high/moderate/low) out of the generated text near each force's own name", async () => {
  const content = [
    "Competitive rivalry within the AI cybersecurity compliance segment is high, driven by well-funded entrants.",
    "The threat of new entrants remains moderate, given the technical expertise required.",
    "Buyer power is significant, as mid-market buyers can readily switch vendors.",
    "Supplier power is low, since most AI infrastructure providers are commoditized.",
    "The threat of substitutes is limited, as manual review remains a weak alternative.",
  ].join("\n\n");

  for (const source of [pageSource, plannerSource]) {
    const fn = await compileFunction(source, "extractForceIntensity");
    assert.deepEqual(fn(content, "Rivalry"), { level: "High", width: 82 });
    assert.deepEqual(fn(content, "Entrants"), { level: "Moderate", width: 55 });
    assert.deepEqual(fn(content, "Buyer Power"), { level: "High", width: 82 });
    assert.deepEqual(fn(content, "Supplier Power"), { level: "Low", width: 28 });
    assert.deepEqual(fn(content, "Substitutes"), { level: "Low", width: 28 });
  }
});

test("page.tsx and Planner.tsx: extractForceIntensity returns null (never a guessed number) when no intensity signal is present for that force", async () => {
  for (const source of [pageSource, plannerSource]) {
    const fn = await compileFunction(source, "extractForceIntensity");
    assert.equal(fn("This section does not discuss rivalry at all.", "Buyer Power"), null);
  }
});

test("Porter's Five Forces keeps its radar/circular positioning visualization unchanged (regression guard) -- only the intensity bars became data-driven", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /rounded-full border border-teal-200\/10/);
    assert.match(source, /Not specified/);
  }
});

test("ReportPdfButton.tsx still draws the TAM\\/SAM\\/SOM concentric circle diagram in the exported PDF (regression guard)", () => {
  assert.match(pdfButtonSource, /TAM\/SAM\/SOM circle diagram/i);
});

// --- 3. Competitive Landscape: Vendor/Category/Position/Strengths/ --------
// --- Weaknesses/Market Relevance, not markdown tables ----------------------

test("page.tsx and Planner.tsx: the Competitive Landscape table now includes a Position column (from Segment/AI Capability data), separate from Category", async () => {
  const table = [
    "| Vendor | Parent Company | Category | Segment | AI Capability | Key Use Cases | Pricing Model | Strengths | Weaknesses | Validation Count | Confidence | Market Relevance |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    "| Acme Compliance AI | Acme Corp | Compliance | Mid-market | Native LLM review | Contract triage | Per-seat | Strong SMB distribution | Limited enterprise features | 4 | High | High |",
  ].join("\n");

  for (const source of [pageSource, plannerSource]) {
    const fn = await compileFunction(source, "extractMarketIntelligenceCompetitorRows");
    const rows = fn(table);
    assert.equal(rows[0].vendor, "Acme Compliance AI");
    assert.equal(rows[0].category, "Compliance");
    assert.equal(rows[0].position, "Mid-market");
    assert.equal(rows[0].relevance, "High");
  }
});

test("page.tsx and Planner.tsx: the Competitive Landscape visual renders a real structured table/card component, not raw markdown pipe syntax", () => {
  // TASK #32 -- "Validation" renamed to "Vendor Confidence" -- see
  // tests/market-intelligence-decision-report-upgrade.test.mjs for that
  // fix's own dedicated coverage.
  for (const source of [pageSource, plannerSource]) {
    assert.match(
      source,
      /\["Vendor", "Category", "Position", "Strengths", "Weaknesses", "Relevance", "Vendor Confidence"\]/
    );
    assert.doesNotMatch(source, /\{row\.vendor\}\s*\|\s*\{row\.category\}/);
  }
});

// --- 4. Strategic Recommendations: Action/Owner/Timeline/Success Metric ---

test("page.tsx and Planner.tsx: extractRecommendationSignals now extracts a best-effort Owner role/title from real prose, never fabricating one when absent", async () => {
  for (const source of [pageSource, plannerSource]) {
    void source;
    const fn = await compileFunction(reportPresentationSource, "extractRecommendationSignals");
    const withOwner = fn(
      "Launch a 90-day pilot in the DACH region, owned by the Regional GM, targeting a 15% trial-to-paid conversion rate."
    );
    assert.equal(withOwner.owner, "Regional GM");
    assert.equal(withOwner.timeframe, "90-day");
    assert.equal(withOwner.metric, "15%");

    const withoutOwner = fn("Continue monitoring the competitive landscape for material shifts.");
    assert.equal(withoutOwner.owner, "");
  }
});

test("page.tsx and Planner.tsx: recommendation cards render an explicit Action/Owner/Timeline/Success Metric structure", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /\{ label: "Owner", value: owner \}/);
    // TASK #31 -- see market-intelligence-decision-report-upgrade.test.mjs
    // for the full comment on the planning-assumption suffix these two
    // values now carry.
    assert.match(source, /\{ label: "Timeline", value: timeframe \? `\$\{timeframe\}\$\{numericAssumptionSuffix\}` : "" \}/);
    assert.match(source, /\{ label: "Success Metric", value: metric \? `\$\{metric\}\$\{numericAssumptionSuffix\}` : "" \}/);
    assert.match(source, />Action</);
  }
});

// --- 5. Regression guards: SWOT-equivalent, Market Metrics, PDF -----------

test("the Market Forces four-quadrant (SWOT-equivalent) view from the prior ticket is unchanged (regression guard)", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /function MarketForcesQuadrant/);
    assert.match(source, /quadrants\.length < marketForcesQuadrants\.length/);
  }
});

test("Market Size / CAGR cards from the prior ticket are unchanged (regression guard)", () => {
  assert.match(pageSource, /normalizedTitle\.includes\("market size"\)/);
  assert.match(plannerSource, /field === "marketSize" \|\| field === "cagr"/);
  assert.match(pageSource, /Validation Needed/);
});

test("PDF export preserves visual layouts: the Market-Intelligence-specific competitor table match in ReportPdfButton.tsx is unchanged (regression guard)", () => {
  const occurrences =
    pdfButtonSource.match(
      /normalizedTitle\.includes\("competitor"\) \|\| normalizedTitle\.includes\("competitive landscape"\)/g
    ) || [];
  assert.equal(occurrences.length, 2);
});

test("PDF export preserves visual layouts: Porter's Five Forces' PDF-drawn intensity bars (ReportPdfButton.tsx and Planner.tsx's own downloadPdf) are also real, not the old static array", async () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.doesNotMatch(source, /const score = \[72, 54, 66, 48, 60\]\[index\];/);
    assert.match(source, /const score = extractForceIntensity\(.*?, force\)\?\.width \?\? 0;/);
  }

  const fn = await compileFunction(pdfButtonSource, "extractForceIntensity");
  assert.deepEqual(
    fn("Buyer power is significant, as mid-market buyers can readily switch vendors.", "Buyer"),
    { level: "High", width: 82 }
  );
});

// --- 6. Preserve: AI logic, routing, validation rules, uncertainty -------
// --- handling --------------------------------------------------------------

test("AI generation logic and TAM/SAM/SOM calculation logic are untouched (drift check)", () => {
  const marketGraphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketGraphSource, /function buildMarketIntelligenceGraph/);
  assert.match(marketGraphSource, /function projectMarketIntelligenceGraphToReport/);

  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /Never invent a value/);
  assert.match(marketPromptSource, /portersFiveForces/);
});

test("routing is untouched by this presentation-only fix (drift check)", () => {
  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function classifyReportDomain/);
  assert.match(domainSource, /export function applyPromptIntentModeOverride/);
});

test("validation rules and uncertainty handling (evidence badges, [Estimated] tags) are untouched -- the new extractors read these signals rather than suppressing or replacing them", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /getDashboardMetricEvidence|getSectionEvidenceLevel/);
    assert.match(source, /EvidenceBadge/);
  }
});
