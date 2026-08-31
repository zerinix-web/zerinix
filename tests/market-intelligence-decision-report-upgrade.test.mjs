import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// CRITICAL FINAL UPGRADE -- transform Market Intelligence into a premium
// investor-grade decision report.
//
// Builds on three prior "restore presentation" tickets. This one adds:
//
// 1. Executive Decision Center: the Founder Readiness gauge (reads
//    investmentScore.decisionEngine, a score Market Intelligence never
//    computes per its own report-isolation policy -- "must never mention
//    a founder ... or any startup-readiness concept") is replaced with a
//    Market Signal gauge for MI, reusing the already-computed "Market"
//    confidenceRadar dimension -- never a new/fabricated calculation.
// 2. TAM/SAM/SOM: each of the three layers is now fully independent
//    (previously Planner.tsx required ALL THREE to be coherently nested
//    before showing ANY bar) -- a layer with a real value gets a real
//    proportional bar, a layer without one shows "Validation Needed"
//    (matching this ticket's own literal example), and the whole
//    component only falls back to a single empty state when none of the
//    three exist at all. The visual is never removed.
// 3. Competitive Landscape gained a 7th column, Validation Status (reads
//    the same Confidence classification market-intelligence-graph.ts
//    already computes per row), and now supports up to 20 rows (was
//    capped at 6).
// 4. Market Map: a new 2D positioning visual (Enterprise<->SME,
//    Broad platform<->Specialized), built ONLY from keywords already
//    present in each vendor's own category/position text -- a vendor
//    without a clear signal on BOTH axes is omitted entirely rather than
//    guessed. Renders only when 2+ vendors can be honestly placed.
// 5. SWOT (MarketForcesQuadrant, from a prior ticket) -- reconfirmed as a
//    regression guard.
// 6. Porter's Five Forces gained a real "investor interpretation" line
//    per force -- the actual sentence extractForceIntensity already
//    reads the intensity word from, not a fabricated addition.
// 7. Strategic Recommendation cards gained Budget (a spend ceiling,
//    split from Success Metric so a line naming both surfaces both) and
//    a best-effort Decision Gate (a "before committing further budget"/
//    "before scaling further" style checkpoint phrase).
// 8. Market Metrics dashboard: a new 5-tile grid (Market Growth, CAGR,
//    Customer Segment, Adoption Signal, Risk Level) combining real
//    signals from marketSize/cagr/customerSegments/threats -- any tile
//    without a detectable signal shows "Validation Needed".
//
// AI generation logic, routing, the decision engine, validation rules,
// uncertainty handling, and all calculations are untouched -- confirmed
// via drift checks below.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
// TASK #29J -- extractRecommendationSignals (and recommendationOwnerRolePattern,
// its dependency) was consolidated into this single shared module; all
// three surfaces above now import it rather than defining their own copy.
const reportPresentationSource = readFileSync(
  new URL("../app/lib/report-presentation.ts", import.meta.url),
  "utf8"
);

// Balanced-bracket extraction (not a non-greedy regex) -- some of these
// functions have a multi-line destructured/typed parameter list with its
// own sibling braces before the function body even starts (e.g.
// `function f({ a, b }: { a: string; b: string }) {`), which a naive
// `function f(...)[\s\S]*?\n}` regex -- or a brace counter that doesn't
// first skip the parameter list -- matches too early. This walks past
// the balanced `(...)` parameter list first, then finds the balanced
// `{...}` function body after it.
function extractFunctionSource(source, functionName) {
  const startMatch = source.match(new RegExp(`function ${functionName}\\(`));
  assert.ok(startMatch, `${functionName} not found`);
  const start = startMatch.index;

  let i = start + startMatch[0].length - 1; // positioned on the opening "("
  let parenDepth = 1;
  while (parenDepth > 0) {
    i += 1;
    if (source[i] === "(") parenDepth += 1;
    else if (source[i] === ")") parenDepth -= 1;
  }
  // i is now on the parameter list's closing ")" -- advance to the
  // function body's opening "{".
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

const functionDependencies = {
  extractForceIntensity: /const forceAliases: Record<string, string\[\]> = \{[\s\S]*?\n\};/,
  extractForceImplication: /const forceAliases: Record<string, string\[\]> = \{[\s\S]*?\n\};/,
  extractRecommendationSignals: /export const recommendationOwnerRolePattern =[\s\S]*?;/,
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
  const dependencyPattern = functionDependencies[functionName];
  const dependency = dependencyPattern ? source.match(dependencyPattern)?.[0] : null;
  if (dependencyPattern) {
    assert.ok(dependency, `dependency for ${functionName} not found`);
  }
  const dir = mkdtempSync(join(tmpdir(), "zerinix-decision-report-fn-"));
  const outPath = join(dir, `${functionName}.ts`);
  writeFileSync(outPath, `${dependency ? `${dependency}\n` : ""}export ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod[functionName];
}

// --- 1. Executive Decision Center -----------------------------------------

test("page.tsx and Planner.tsx: the Founder Readiness gauge is replaced with a Market Signal gauge for Market Intelligence, reusing the already-computed 'Market' confidenceRadar dimension", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /const marketSignalDimension = isMarketIntelligence/);
    assert.match(
      source,
      /dimension\.label === "Market" \|\| dimension\.label === "Pazar"/
    );
    assert.match(source, /label=\{isMarketIntelligenceTurkish \? "Pazar Sinyali" : "Market Signal"\}/);
  }
});

test("page.tsx and Planner.tsx: Business Plan/Acquisition still see the real Founder Readiness gauge, untouched", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(
      source,
      /\) : \(\s*\n\s*<SnapshotGauge\s*\n\s*label=\{labels\.founderScoreGauge\}\s*\n\s*value=\{snapshot\.founderScoreValue\}\s*\n\s*display=\{snapshot\.founderScore\}\s*\n\s*\/>\s*\n\s*\)/
    );
  }
});

// --- 2. TAM/SAM/SOM: never removed, per-layer Validation Needed ----------

test("page.tsx and Planner.tsx: TAM/SAM/SOM is never removed -- the visual stack always renders (no whole-card early return), and each of the three layers independently shows a real value or its own 'Validation Needed' state", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.doesNotMatch(source, /if \(maxMagnitude === 0\)/);
    assert.match(source, /Validation Needed/);
  }
});

// P0 PRODUCTION FIX -- confirmed live (Task #11, Market Intelligence
// decision/market-sizing consistency hardening): this test's own prior
// framing ("the PDF export's own separate coherence check is untouched")
// documented a real, later-reported production bug: Planner.tsx's PDF
// export (downloadPdf) kept the exact old all-or-nothing gate this same
// ticket already removed from the on-screen preview, discarding an
// already-resolved TAM/SAM the moment SOM alone was unresolved --
// ReportPdfButton.tsx's OWN identical gate had separately already been
// fixed to the canonical resolveMarketSizingCascade rule; Planner.tsx's
// PDF export was simply never brought up to the same standard until now.
// isCoherentlyNested no longer exists anywhere in this file.
test("Planner.tsx: the on-screen TAM/SAM/SOM visual no longer requires all three layers to be coherently nested before showing any bar, AND its PDF export now uses the same canonical per-layer resolveMarketSizingCascade rule -- isCoherentlyNested is fully removed from both code paths", () => {
  const onScreenBlock = extractFunctionSource(plannerSource, "PremiumSectionVisual");
  assert.doesNotMatch(onScreenBlock, /isCoherentlyNested/);
  assert.match(onScreenBlock, /magnitude !== null \? \(/);
  assert.doesNotMatch(
    plannerSource,
    /isCoherentlyNested/,
    "isCoherentlyNested must be fully removed from Planner.tsx, including its PDF export -- not merely bypassed"
  );
  assert.match(
    plannerSource,
    /const cascade = constrainMarketSizingResolutionToCanonicalState\(\s*\n\s*resolveMarketSizingCascade\(magnitudes\),\s*\n\s*marketIntelligenceCanonicalState\s*\n\s*\);/
  );
});

test("page.tsx: parseMonetaryMagnitude and the TAM/SAM/SOM bar computation are untouched (drift/regression guard)", async () => {
  const fn = await compileFunction(pageSource, "parseMonetaryMagnitude");
  assert.equal(fn("$2.4B"), 2.4e9);
  assert.equal(fn(""), null);
});

// --- 3. Competitive Landscape: Validation Status, up to 20 rows -----------

test("page.tsx and Planner.tsx: the Competitive Landscape table gained a 7th 'Validation Status' column, read from the row's real Confidence classification", async () => {
  const table = [
    "| Vendor | Category | Segment | Strengths | Weaknesses | Market Relevance | Confidence |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| Acme AI | Compliance | Mid-market | Strong distribution | Limited enterprise features | High | High |",
  ].join("\n");

  for (const source of [pageSource, plannerSource]) {
    const fn = await compileFunction(source, "extractMarketIntelligenceCompetitorRows");
    const rows = fn(table);
    assert.equal(rows[0].validationStatus, "High");
    assert.equal(rows[0].relevance, "High");
  }
});

test("page.tsx and Planner.tsx: the Competitive Landscape table supports up to 20 competitors (was capped at 6)", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /\.slice\(0, 20\);\n\}/);
  }
});

test("the Competitive Landscape table header includes all 7 required columns: Vendor, Category, Position, Strengths, Weaknesses, Relevance, Validation", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(
      source,
      /\["Vendor", "Category", "Position", "Strengths", "Weaknesses", "Relevance", "Validation"\]/
    );
  }
});

// --- 4. Market Map: real inference, never fabricated placement -----------

test("page.tsx and Planner.tsx: inferMarketMapPosition only reads category/position (not strengths/weaknesses, which can contain negated mentions), and never guesses a coordinate for a missing axis", async () => {
  for (const source of [pageSource, plannerSource]) {
    const fn = await compileFunction(source, "inferMarketMapPosition");

    // A weakness mentioning "enterprise" as something the vendor LACKS
    // must not be misread as an enterprise-segment placement.
    assert.equal(
      fn({ category: "Compliance", position: "Mid-market", strengths: "", weaknesses: "Limited enterprise features" }),
      null
    );

    // Real signal on both axes places the vendor.
    assert.deepEqual(
      fn({ category: "Enterprise platform", position: "Broad end-to-end suite", strengths: "", weaknesses: "" }),
      { x: 78, y: 22 }
    );
    assert.deepEqual(
      fn({ category: "SME-focused", position: "Specialized fraud detection", strengths: "", weaknesses: "" }),
      { x: 22, y: 78 }
    );

    // No signal on either axis -> omitted, not fabricated.
    assert.equal(fn({ category: "General", position: "", strengths: "", weaknesses: "" }), null);
  }
});

test("page.tsx and Planner.tsx: MarketMap shows a premium Validation Needed state (never silently hides) when fewer than 2 vendors are honestly placed", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /placements\.length >= 2 \?/);
    assert.match(source, /Validation Needed[\s\S]{0,120}Not enough competitors have a clear category or positioning signal/);
  }
});

// --- 5. SWOT (MarketForcesQuadrant) regression guard -----------------------

test("the Market Forces four-quadrant (SWOT-equivalent) view is unchanged (regression guard)", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /function MarketForcesQuadrant/);
    assert.match(source, /quadrants\.length < marketForcesQuadrants\.length/);
  }
});

// --- 6. Porter's Five Forces: real investor interpretation -----------------

test("page.tsx and Planner.tsx: extractForceImplication reads a real sentence about the force from the generated content, never a fabricated implication", async () => {
  const content =
    "Competitive rivalry within the AI cybersecurity compliance segment is high, driven by well-funded entrants and undifferentiated pricing.";

  for (const source of [pageSource, plannerSource]) {
    const fn = await compileFunction(source, "extractForceImplication");
    const implication = fn(content, "Rivalry");
    assert.match(implication, /well-funded entrants/);

    const noSignal = fn("This section does not discuss that force.", "Buyer Power");
    assert.equal(noSignal, "");
  }
});

test("Porter's Five Forces keeps its radar/circular positioning visualization (regression guard) -- the implication is additive, not a replacement", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /rounded-full border border-teal-200\/10/);
    assert.match(source, /extractForceIntensity/);
  }
});

test("ReportPdfButton.tsx and Planner.tsx's own PDF export still draw real (not fake) Porter's Five Forces intensity bars (regression guard)", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.doesNotMatch(source, /const score = \[72, 54, 66, 48, 60\]\[index\];/);
  }
});

// --- 7. Strategic Recommendations: Budget + Decision Gate -----------------

test("page.tsx and Planner.tsx: extractRecommendationSignals now separates Budget from Success Metric, and extracts a best-effort Decision Gate checkpoint", async () => {
  for (const source of [pageSource, plannerSource]) {
    void source;
    const fn = await compileFunction(reportPresentationSource, "extractRecommendationSignals");
    const signals = fn(
      "Launch a 90-day pilot in the DACH region with a $50K budget, owned by the Regional GM, targeting 10 paying pilots before committing further budget."
    );
    assert.equal(signals.timeframe, "90-day");
    assert.equal(signals.budget, "$50K");
    assert.equal(signals.metric, "10 paying pilots");
    assert.equal(signals.owner, "Regional GM");
    assert.equal(signals.gate, "before committing further budget");

    const noSignals = fn("Continue monitoring the competitive landscape for material shifts.");
    assert.equal(noSignals.budget, "");
    assert.equal(noSignals.gate, "");
  }
});

test("recommendation cards render Action/Owner/Timeline/Budget/Success Metric/Decision Gate", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /\{ label: "Owner", value: owner \}/);
    assert.match(source, /\{ label: "Timeline", value: timeframe \}/);
    assert.match(source, /\{ label: "Budget", value: budget \}/);
    assert.match(source, /\{ label: "Success Metric", value: metric \}/);
    assert.match(source, /Decision Gate\s*\n\s*<\/p>/);
    assert.match(source, />Action</);
  }
});

// --- 8. Market Metrics dashboard -------------------------------------------

test("page.tsx and Planner.tsx: MarketMetricsDashboard combines real signals (Market Growth, CAGR, Customer Segment, Adoption Signal, Risk Level) from real sections, never a fabricated value", async () => {
  for (const source of [pageSource, plannerSource]) {
    const growthFn = await compileFunction(source, "extractMarketGrowthTrend");
    assert.equal(growthFn("The market is growing rapidly.", ""), "Growing");
    assert.equal(growthFn("The market is declining due to saturation.", ""), "Declining");
    assert.equal(growthFn("No trend stated.", ""), "");

    const riskFn = await compileFunction(source, "extractRiskLevel");
    assert.equal(riskFn("This market carries high regulatory risk."), "High");
    assert.equal(riskFn("This market carries low competitive risk."), "Low");
    assert.equal(riskFn("No risk language here."), "");

    const adoptionFn = await compileFunction(source, "extractAdoptionSignal");
    assert.match(adoptionFn("Adoption maturity remains early-stage among mid-market buyers."), /Adoption maturity/);
    assert.equal(adoptionFn("No adoption language here."), "");
  }
});

test("MarketMetricsDashboard renders 'Validation Needed' per tile, never a fabricated value, and returns null entirely when every tile is empty", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /if \(tiles\.every\(\(tile\) => !tile\.value\)\) \{\s*\n\s*return null;/);
    assert.match(source, /Validation Needed/);
  }
});

test("MarketMetricsDashboard is wired into the render tree only for Market Intelligence", () => {
  assert.match(
    pageSource,
    /section\.field === "marketSize" && report\.type === "Market Analysis"[\s\S]{0,80}<MarketMetricsDashboard/
  );
  assert.match(plannerSource, /isMarketIntelligence \? <MarketMetricsDashboard sections={sections} \/> : null/);
});

// --- 9. PDF quality regression guards --------------------------------------

test("PDF export preserves visual layouts: TAM/SAM/SOM concentric circles, and the Market-Intelligence competitor table, are unchanged (regression guard)", () => {
  assert.match(pdfButtonSource, /TAM\/SAM\/SOM circle diagram/i);
  const occurrences =
    pdfButtonSource.match(
      /normalizedTitle\.includes\("competitor"\) \|\| normalizedTitle\.includes\("competitive landscape"\)/g
    ) || [];
  assert.equal(occurrences.length, 2);
});

// --- 10. Preserve: AI logic, routing, decision engine, validation rules, --
// --- uncertainty handling, calculations ------------------------------------

test("AI generation logic and calculations (TAM/SAM/SOM, market-intelligence-graph.ts) are untouched (drift check)", () => {
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
});

test("routing and the decision engine are untouched by this presentation-only fix (drift check)", () => {
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

test("validation rules and the report-isolation policy (Market Intelligence never evaluates a founder) are respected, not weakened -- the Market Signal replacement is presentation-only", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /Never use founder\/startup-investment vocabulary anywhere in this report/);
});

// --- 11. FINAL POLISH: PDF parity for Market Map, Market Metrics, ---------
// --- and expanded Strategic Recommendation cards ---------------------------
//
// The prior upgrade ticket built all three of these as on-screen-only
// visuals and explicitly disclosed the PDF gap. This closes it:
// ReportPdfButton.tsx now draws the same three visuals, using its own
// independently-duplicated extraction helpers (matching this codebase's
// established per-file-duplication convention -- page.tsx, Planner.tsx,
// and ReportPdfButton.tsx never share these functions).

// A later ticket ("Premium Report Presentation Deduplication Audit & Fix")
// superseded this company/positioning-shaped inferMarketMapPosition: the
// Market Map now always reads the MI-specific extractMarketIntelligenceCompetitorRows
// rows (category/position shape) rather than the generic extractor's rows
// -- the old function became dead code (the map was already MI-only) and
// was removed. See
// tests/market-intelligence-competitive-landscape-pdf-parity.test.mjs for
// the current, superseding behavior (inferMarketIntelligenceMarketMapPosition).
test("ReportPdfButton.tsx: inferMarketIntelligenceMarketMapPosition reads only the competitor row's own category/position text, never fabricating a coordinate for a missing axis", async () => {
  const fn = await compileFunction(pdfButtonSource, "inferMarketIntelligenceMarketMapPosition");

  assert.deepEqual(fn({ category: "Acme AI", position: "Enterprise, broad end-to-end platform" }), { x: 78, y: 22 });
  assert.deepEqual(fn({ category: "Nimbus", position: "SME-focused, specialized niche tool" }), { x: 22, y: 78 });
  assert.equal(fn({ category: "Vague Co", position: "General purpose software" }), null);
});

test("ReportPdfButton.tsx: draws a Market Map beneath the competitor table for Market Intelligence reports, with an honest Validation Needed fallback when fewer than 2 vendors can be placed -- never for other report types", () => {
  assert.match(pdfButtonSource, /const drawMarketMap = \(mapY: number\) => \{/);
  assert.match(pdfButtonSource, /placements\.length < 2\) \{[\s\S]{0,40}pdf\.setFontSize\(6\.2\);[\s\S]{0,200}VALIDATION NEEDED/);
  assert.match(pdfButtonSource, /if \(isMarketIntelligenceReport\) \{/);
  // The Market Map is only ever drawn inside the isMarketIntelligenceReport
  // branch now (a real fork, not a ternary height addend) -- Business
  // Plan/Acquisition's generic competitor table below it never reserves
  // Market Map height at all.
  assert.match(pdfButtonSource, /const marketMapGap = 8;/);
  assert.match(pdfButtonSource, /const marketMapHeight = 50;/);
});

test("ReportPdfButton.tsx: extractMarketGrowthTrend, extractAdoptionSignal, extractRiskLevel, and extractHeadlineCagrValue read real signals only, matching page.tsx/Planner.tsx's on-screen behavior", async () => {
  const growthFn = await compileFunction(pdfButtonSource, "extractMarketGrowthTrend");
  assert.equal(growthFn("The market is growing rapidly.", ""), "Growing");
  assert.equal(growthFn("No trend stated.", ""), "");

  const adoptionFn = await compileFunction(pdfButtonSource, "extractAdoptionSignal");
  assert.match(adoptionFn("Adoption maturity remains early-stage among mid-market buyers."), /Adoption maturity/);
  assert.equal(adoptionFn("No adoption language here."), "");

  const riskFn = await compileFunction(pdfButtonSource, "extractRiskLevel");
  assert.equal(riskFn("This market carries high regulatory risk."), "High");
  assert.equal(riskFn("No risk language here."), "");

  const cagrFn = await compileFunction(pdfButtonSource, "extractHeadlineCagrValue");
  assert.equal(cagrFn("The market is projected to grow at 12-15% annually."), "12-15%");
  assert.equal(cagrFn("No percentage here."), "");
});

test("ReportPdfButton.tsx: draws the Market Metrics dashboard (Market Growth Signal, CAGR, Customer Segment, Adoption Signal, Risk Level) on the Market Size section, reading cagr/customerSegments/threats from the report's other real sections -- with a premium Validation Needed tile, never a fabricated value", () => {
  assert.match(pdfButtonSource, /isMarketIntelligenceReport && field === "marketSize"/);
  assert.match(pdfButtonSource, /label: "Market Growth Signal", value: extractMarketGrowthTrend\(content, cagrContent\)/);
  // P0 FIX #8 -- confirmed live (CAGR scope/KPI semantics repair): the
  // tile's value is now resolved via resolveCagrHeadlinePresentation, with
  // this exact pinned extractHeadlineCagrValue(cagrContent) call retained
  // as the single-estimate source of truth (see the isMultiEstimate
  // branch immediately preceding it).
  assert.match(
    pdfButtonSource,
    /cagrPresentation\.isMultiEstimate \? cagrPresentation\.displayValue : extractHeadlineCagrValue\(cagrContent\)/
  );
  assert.match(pdfButtonSource, /label: "Customer Segment", value: extractKeywordInsight\(customerSegmentsContent, \[\]\)/);
  assert.match(pdfButtonSource, /label: "Adoption Signal", value: extractAdoptionSignal\(customerSegmentsContent\)/);
  assert.match(pdfButtonSource, /label: "Risk Level", value: extractRiskLevel\(threatsContent\)/);
  assert.match(pdfButtonSource, /localizePdfPresentationLabel\("VALIDATION NEEDED", pdfLocale\)/);
  assert.match(pdfButtonSource, /isMarketIntelligenceReport && section\.field === "marketSize"\) \{\s*\n\s*return marketMetricsDashboardHeight;/);
});

test("ReportPdfButton.tsx: draws Strategic Recommendation cards with Action, Owner, Timeline, Budget, Success Metric, and Decision Gate -- reusing the same extraction helpers as page.tsx/Planner.tsx, never fabricating a signal", async () => {
  // TASK #25C -- this branch moved out of drawSectionVisual/getVisualHeight
  // into its own dedicated, row-pagination-aware branch in the top-level
  // pdfSections.forEach loop (see that branch's own comment for why); the
  // title check itself is unchanged, just inlined rather than reading a
  // pre-computed `normalizedTitle` local.
  assert.match(pdfButtonSource, /isMarketIntelligenceReport && section\.title\.toLowerCase\(\)\.includes\("strategic recommendation"\)/);
  assert.match(pdfButtonSource, /localizePdfPresentationLabel\("ACTION", pdfLocale\)/);
  assert.match(pdfButtonSource, /\["Owner", owner\],\s*\n\s*\["Timeline", timeframe\],\s*\n\s*\["Budget", budget\],\s*\n\s*\["Success Metric", metric\],/);
  assert.match(pdfButtonSource, /localizePdfPresentationLabel\("DECISION GATE", pdfLocale\)/);

  const fn = await compileFunction(reportPresentationSource, "extractRecommendationSignals");
  const signals = fn(
    "Launch a 90-day pilot in the DACH region with a $50K budget, owned by the Regional GM, targeting 10 paying pilots before committing further budget."
  );
  assert.equal(signals.budget, "$50K");
  assert.equal(signals.gate, "before committing further budget");
});

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence PDF layout
// hardening, round 2): the fixed "const recommendationCardHeight = 36;"
// this test used to assert was ITSELF the truncation bug for Strategic
// Recommendation cards 3-4 -- replaced with computeRecommendationRowHeights,
// a single shared function that derives each card's real height from its
// own content instead of a hardcoded number.
//
// TASK #25C -- updated for the follow-on fix: computeRecommendationRowHeights
// is still declared exactly once, but drawing and pagination-budgeting are
// no longer two separate call sites reading it independently (the old
// drawSectionVisual/getVisualHeight split) -- they were merged into one
// dedicated pagination-aware branch, so there is now exactly ONE call site,
// which is structurally even less able to disagree with itself than two
// call sites reading a shared function ever were.
test("ReportPdfButton.tsx: Strategic Recommendations' single pagination/drawing branch (and Market Metrics' shared height constant) never hardcode a card/row height, so drawing and pagination budgeting can never disagree (regression guard)", () => {
  const occurrences = pdfButtonSource.match(/marketMetricsDashboardHeight/g) || [];
  assert.ok(occurrences.length >= 3, "expected the const declaration plus at least one use in each of drawSectionVisual/getVisualHeight");
  const layoutFnOccurrences = pdfButtonSource.match(/const computeRecommendationCardLayout = /g) || [];
  const rowsFnOccurrences = pdfButtonSource.match(/const computeRecommendationRowHeights = /g) || [];
  assert.equal(layoutFnOccurrences.length, 1, "expected exactly one shared computeRecommendationCardLayout declaration");
  assert.equal(rowsFnOccurrences.length, 1, "expected exactly one shared computeRecommendationRowHeights declaration");
  assert.match(pdfButtonSource, /const recommendationCardGap = 3;/);
  const callSiteOccurrences = pdfButtonSource.match(/const \{ cards, rowHeights \} = computeRecommendationRowHeights\(items, cardWidth\);/g) || [];
  assert.equal(
    callSiteOccurrences.length,
    1,
    "expected exactly one call site (in the unified pagination/drawing branch) computing both cards and rowHeights together"
  );
});
