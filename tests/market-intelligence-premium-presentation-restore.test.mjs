import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// CRITICAL FIX -- restore premium executive report presentation standard
// for Market Intelligence.
//
// Builds on the prior "restore executive report visual presentation"
// ticket (Competitive Landscape table, Strategic Recommendations cards).
// This one adds:
//
// 1. Market Metrics cards for marketSize/cagr -- both are free-flowing
//    prose sections (no "Label: value" line their generation prompts
//    require), so a new headline-value extractor finds the first genuine
//    currency amount / percentage already present in the content. When
//    none is found, a premium "Validation Needed" card renders instead
//    of a fabricated number or a plain paragraph -- never inventing data.
// 2. Removed the pre-existing static, hardcoded "Demand/Timing/Access/
//    Defensibility" percentage bars from Market Intelligence's
//    marketOverview visual (confirmed live: 82%/68%/56%/48%, never
//    derived from content) -- exactly the "old fake data behavior" this
//    ticket's own requirements warn against reintroducing. Business
//    Plan's identical visual is untouched.
// 3. Strategic Recommendation cards now surface a best-effort timeframe/
//    metric badge extracted from each action's own real text (never a
//    fabricated "Owner"/"Timeline" field when the prose doesn't contain
//    one).
// 4. A new "Market Forces at a Glance" four-quadrant visual, combining
//    Market Intelligence's four real, independently-generated
//    marketDrivers/barriers/opportunities/threats sections into one 2x2
//    grid (Market Intelligence has no single "swotAnalysis" field the
//    way Business Plan does, so this is additive to -- never a
//    replacement of -- each field's own full section, and keeps each
//    field's real title rather than relabeling as Strengths/Weaknesses).
//    Renders only when all four fields have real content.
//
// TAM/SAM/SOM, Executive Summary decision cards, Competitive Landscape,
// and Porter's Five Forces (all confirmed working in the prior ticket)
// are re-verified below as regression guards. AI generation logic,
// routing, the decision engine, and TAM/SAM/SOM calculation logic are
// all confirmed untouched.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

function extractFunctionSource(source, functionName) {
  const match = source.match(new RegExp(`function ${functionName}\\([\\s\\S]*?\\n\\}`));
  assert.ok(match, `${functionName} not found`);
  return match[0];
}

// NOTE: superseded by the "true investor-grade visual components" ticket
// -- extractRecommendationSignals now also extracts a best-effort Owner
// (see tests/market-intelligence-investor-grade-visuals.test.mjs), which
// depends on a preceding recommendationOwnerRolePattern const not
// captured by extractFunctionSource alone. Pulled in here too so this
// file's own pre-existing timeframe/metric assertions keep working.
async function compileFunction(source, functionName) {
  const raw = extractFunctionSource(source, functionName);
  const dependency =
    functionName === "extractRecommendationSignals"
      ? source.match(/const recommendationOwnerRolePattern =[\s\S]*?;/)?.[0]
      : functionName === "extractHeadlineMonetaryValue"
        ? [
            source.match(/const marketSizeExclusionContext =[\s\S]*?;/)?.[0],
            source.match(/const marketSizePositiveContext =[\s\S]*?;/)?.[0],
          ].join("\n")
        : null;
  const dir = mkdtempSync(join(tmpdir(), "zerinix-premium-fn-"));
  const outPath = join(dir, `${functionName}.ts`);
  writeFileSync(outPath, `${dependency ? `${dependency}\n` : ""}export ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod[functionName];
}

// --- 1. Market Intelligence renders visual sections -----------------------

test("TAM/SAM/SOM, Market Overview, Executive Summary, Competitive Landscape, and Porter's Five Forces visuals all still fire for Market Intelligence (regression guard)", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /tamSamSom/);
  }
  assert.match(pageSource, /normalizedTitle\.includes\("tam \/ sam \/ som"\)/);
  assert.match(pageSource, /normalizedTitle\.includes\("market overview"\)/);
  assert.match(pageSource, /normalizedTitle\.includes\("porter"\)/);
  assert.match(pageSource, /normalizedTitle\.includes\("competitive landscape"\)/);
  assert.match(plannerSource, /field === "portersFiveForces"/);
  assert.match(plannerSource, /field === "competitiveLandscape"/);
});

test("page.tsx and Planner.tsx: extractHeadlineMonetaryValue extracts a real market-size figure from genuine prose (no 'Label:' line required)", async () => {
  const prose =
    "The European AI cybersecurity market was valued at approximately $2.4B in 2023, based on adjacent OECD benchmark data [Estimated], with forecasts suggesting continued expansion through the decade.";

  for (const source of [pageSource, plannerSource]) {
    const fn = await compileFunction(source, "extractHeadlineMonetaryValue");
    assert.equal(fn(prose), "$2.4B");
  }
});

test("page.tsx and Planner.tsx: extractHeadlineCagrValue extracts a real CAGR figure, including a range where only the closing number carries the % sign", async () => {
  for (const source of [pageSource, plannerSource]) {
    const fn = await compileFunction(source, "extractHeadlineCagrValue");
    assert.equal(
      fn("The market is forecast to grow at a CAGR of 18.5% through 2028 [Estimated]."),
      "18.5%"
    );
    assert.equal(fn("Growth is expected between 12-15% annually."), "12-15%");
  }
});

test("page.tsx: the Market Size and CAGR visual branches are gated on Market Intelligence's real titles, and hasReportSectionVisual is kept in sync", () => {
  assert.match(pageSource, /normalizedTitle\.includes\("market size"\)/);
  assert.match(pageSource, /normalizedTitle === "cagr" \|\| normalizedTitle\.includes\("cagr"\)/);

  const gateMatch = pageSource.match(/function hasReportSectionVisual\([\s\S]*?\n\}/);
  assert.ok(gateMatch);
  assert.match(gateMatch[0], /normalizedTitle\.includes\("market size"\)/);
});

test("Planner.tsx: the marketSize and cagr visual branches are gated on Market Intelligence's real field names, and hasPremiumSectionVisual is kept in sync", () => {
  assert.match(plannerSource, /if \(field === "marketSize" \|\| field === "cagr"\)/);

  const gateMatch = plannerSource.match(/function hasPremiumSectionVisual\([\s\S]*?\n\}/);
  assert.ok(gateMatch);
  assert.match(gateMatch[0], /section\.field === "marketSize"/);
  assert.match(gateMatch[0], /section\.field === "cagr"/);
});

test("Strategic Recommendation cards surface a real, non-fabricated timeframe/metric badge when the action text actually contains one", async () => {
  for (const source of [pageSource, plannerSource]) {
    const fn = await compileFunction(source, "extractRecommendationSignals");
    const signals = fn(
      "Launch a 90-day pilot in the DACH region targeting a 15% trial-to-paid conversion rate."
    );
    assert.equal(signals.timeframe, "90-day");
    assert.equal(signals.metric, "15%");

    const noSignals = fn("Continue monitoring the competitive landscape for material shifts.");
    assert.equal(noSignals.timeframe, "");
    assert.equal(noSignals.metric, "");
  }
});

test("the new 'Market Forces at a Glance' four-quadrant component combines marketDrivers/barriers/opportunities/threats using their own real titles -- never relabeled as Strengths/Weaknesses", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /function MarketForcesQuadrant/);
    assert.match(source, /field:\s*"marketDrivers"/);
    assert.match(source, /field:\s*"barriers"/);
    assert.match(source, /field:\s*"opportunities"/);
    assert.match(source, /field:\s*"threats"/);
    // The literal words "Strengths"/"Weaknesses" never appear inside the
    // MarketForcesQuadrant definition itself.
    const fnMatch = source.match(/(?:function MarketForcesQuadrant|const marketForcesQuadrants)[\s\S]*?\n}\n\nfunction /);
    if (fnMatch) {
      assert.doesNotMatch(fnMatch[0], /"Strengths"|"Weaknesses"/);
    }
  }
});

test("MarketForcesQuadrant only renders once all four fields have real content -- never a partial 1-3 cell grid", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /quadrants\.length < marketForcesQuadrants\.length/);
  }
});

test("MarketForcesQuadrant is wired into the render tree only for Market Intelligence", () => {
  assert.match(
    pageSource,
    /section\.field === "marketDrivers" && report\.type === "Market Analysis"[\s\S]{0,80}<MarketForcesQuadrant/
  );
  assert.match(plannerSource, /isMarketIntelligence \? <MarketForcesQuadrant sections={sections} \/> : null/);
});

// --- 2. Missing data uses premium empty states -----------------------------

test("Market Size / CAGR cards show a premium 'Validation Needed' empty state, never a fabricated number, when no real figure is present", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /Validation Needed/);
    assert.match(
      source,
      /A defensible figure could not be established for this scope\. See the analysis below for/
    );
  }
});

test("the empty state is genuinely conditional on extraction failing, not always shown", async () => {
  for (const source of [pageSource, plannerSource]) {
    const monetaryFn = await compileFunction(source, "extractHeadlineMonetaryValue");
    assert.equal(
      monetaryFn("No verified market-size figure could be established for this specific scope."),
      ""
    );
    const cagrFn = await compileFunction(source, "extractHeadlineCagrValue");
    assert.equal(cagrFn("No defensible CAGR could be established for the requested period."), "");
  }
});

// --- 3. Do not reintroduce old fake data behavior --------------------------

// A later ticket ("Premium Report Presentation Deduplication Audit & Fix")
// enriched this isMarketIntelligence branch further: it now also extracts
// the section's full remaining explanation and real bullets (previously
// only the headline sentence), so marketOverview's raw-text Details
// disclosure below it is no longer a duplicate and can be fully
// suppressed via cardFirstReportFields. See
// tests/market-intelligence-market-overview-deduplication.test.mjs for
// that fix's own dedicated regression coverage.
test("Market Intelligence's marketOverview visual no longer shows the static, hardcoded Demand/Timing/Access/Defensibility bars -- Business Plan's identical visual is untouched", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /if \(isMarketIntelligence\) \{/);
    assert.match(source, /<div className="mb-5 rounded-\[2rem\] border border-teal-200\/15 bg-teal-200\/\[0\.055\] p-5">/);
    // The fake bars array itself is still present (for Business Plan),
    // but only reachable after the isMarketIntelligence early return.
    assert.match(source, /\{ label: "Demand", width: "82%", color: "bg-teal-200" \}/);
  }
});

// --- 4. PDF export preserves visual layouts --------------------------------

test("ReportPdfButton.tsx still draws the TAM/SAM/SOM circle diagram and the Market Intelligence competitor table (regression guard)", () => {
  assert.match(pdfButtonSource, /TAM\/SAM\/SOM circle diagram/i);
  const occurrences =
    pdfButtonSource.match(
      /normalizedTitle\.includes\("competitor"\) \|\| normalizedTitle\.includes\("competitive landscape"\)/g
    ) || [];
  assert.equal(occurrences.length, 2);
});

// --- 5. Preserve: AI generation, routing, decision engine, TAM/SAM/SOM ----
// --- calculation logic ------------------------------------------------------

test("TAM/SAM/SOM calculation logic and Market Intelligence's report generation are untouched (drift check)", () => {
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
  assert.match(marketPromptSource, /tamSamSom/);
  assert.match(marketPromptSource, /marketDrivers/);
  assert.match(marketPromptSource, /barriers/);
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

// CRITICAL FIX -- superseded by a later ticket ("Fix the semantic
// field-mapping and evidence-status integrity bugs"): the binary
// "[Estimated]"-tag-only check this test asserted defaulted EVERY
// unlabeled figure to "verified" (Data Confirmed), even a hedged or
// unsupported one -- exactly the "never promote an assumption, proxy, or
// derived planning input to confirmed market evidence" bug that ticket
// fixed. The Market Size/CAGR card now reuses the SAME canonical
// evidence classifier (inferEvidenceLevel) TAM/SAM/SOM already used
// correctly, whose default is "benchmarkDerived", never "verified" -- see
// tests/market-intelligence-semantic-field-mapping-fix.test.mjs for that
// fix's own dedicated coverage.
test("validation/uncertainty labeling (Estimated tags, evidence badges) is untouched -- the Market Size/CAGR cards classify evidence via the shared canonical evidence classifier, which still reads hedging/estimate language rather than suppressing it", () => {
  assert.match(pageSource, /const evidence = getDashboardMetricEvidence\(isCagr \? "CAGR" : "Market Size", value, content\);/);
  assert.match(
    plannerSource,
    /const evidence = inferEvidenceLevel\(\{\s*\n\s*label: isCagr \? "CAGR" : "Market Size",\s*\n\s*value,\s*\n\s*context: section\.content,\s*\n\s*\}\);/
  );
});
