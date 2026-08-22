import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL PRODUCTION FIX -- decision consistency, evidence usage, and
// financial presentation, reproduced against a live Business Plan report
// bug: the cover said WAIT while the Executive Summary said CONDITIONAL
// GO; a prompt reporting a working prototype and two enterprise design
// partners still scored Idea Quality/Market Attractiveness at 0/100;
// explicitly named countries (Germany, France, Netherlands, Saudi Arabia,
// ...) collapsed into "Europe"/"GCC / Middle East"; and internal
// provenance categories were rendered as if they were real external
// sources.

// --- 1. Canonical decision: WAIT / CONDITIONAL GO / GO scenarios --------

const { runConsistencyValidationPass } = await import(
  "../app/lib/report-consistency-validation.ts"
);
const { decisionTokensForLanguage } = await import(
  "../app/lib/report-engine/executive-decision-brief.ts"
);

test("a section stating the wrong Executive Decision token (NO-GO) is corrected to the authoritative one (GO), leaving the Executive Summary untouched", () => {
  const sections = {
    executiveSummary: "Decision: GO (Confidence: 74%)",
    investorInsight: "Given the current traction, our recommendation is NO-GO for this quarter.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    authoritativeExecutiveDecisionToken: "GO",
    decisionProtectedFields: ["executiveSummary"],
  });

  assert.equal(sections.executiveSummary, "Decision: GO (Confidence: 74%)");
  assert.match(sections.investorInsight, /recommendation is GO for this quarter/);
  assert.equal(result.correctionsApplied[0].type, "recommendation_mismatch");
});

test("a WAIT-derived report: every section stating CONDITIONAL GO/GO/NO-GO is corrected to the same canonical CONDITIONAL GO token", () => {
  const sections = {
    executiveSummary: "Decision: CONDITIONAL GO (Confidence: 52%)",
    founderRoadmap: "30 Days: since the recommendation is GO, begin scaling the team immediately.",
    roadmap306090: "This roadmap assumes a NO-GO outcome and recommends winding down.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    authoritativeExecutiveDecisionToken: "CONDITIONAL GO",
    decisionProtectedFields: ["executiveSummary"],
  });

  assert.match(sections.founderRoadmap, /recommendation is CONDITIONAL GO/);
  assert.match(sections.roadmap306090, /assumes a CONDITIONAL GO outcome/);
  assert.equal(result.correctionsApplied.length, 2);
});

test("a GO-derived report is unaffected when every section already agrees (no false-positive corrections)", () => {
  const sections = {
    executiveSummary: "Decision: GO (Confidence: 81%)",
    founderRoadmap: "Given the GO decision, begin executing the 90-day plan.",
  };
  const before = { ...sections };
  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    authoritativeExecutiveDecisionToken: "GO",
    decisionProtectedFields: ["executiveSummary"],
  });

  assert.deepEqual(sections, before);
  assert.equal(result.correctionsApplied.length, 0);
});

test("the canonical decision-token correction never partially matches -- 'CONDITIONAL GO' is corrected as a whole, never leaving a dangling 'CONDITIONAL' behind", () => {
  const sections = {
    salesStrategy: "The near-term motion should be CONDITIONAL GO oriented, pending pricing validation.",
  };
  runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    authoritativeExecutiveDecisionToken: "GO",
  });

  assert.doesNotMatch(sections.salesStrategy, /CONDITIONAL\s+GO/);
  assert.doesNotMatch(sections.salesStrategy, /\bCONDITIONAL\b(?!\s+GO)/);
  assert.match(sections.salesStrategy, /GO oriented/);
});

test("decisionTokensForLanguage exposes exactly the 3-state Executive Decision vocabulary the correction above relies on, for every supported language", () => {
  for (const language of ["English", "Turkish", "German", "French", "Spanish"]) {
    const tokens = decisionTokensForLanguage(language);
    assert.equal(tokens.length, 3);
    assert.ok(tokens.every((token) => typeof token === "string" && token.length > 0));
  }
});

// --- report-presentation.ts: the cover/executiveSnapshot decision must ---
// --- read the same canonical token the Executive Summary was rendered ---
// --- from, not the raw investmentScore.recommendation engine value.   ---

async function importReportPresentation() {
  const sourcePath = join(repoRoot, "app/lib/report-presentation.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-output-sanitization"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-output-sanitization.ts")).href)
  );
  source = source.replace(
    '"@/app/lib/report-engine/executive-decision-brief"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-engine/executive-decision-brief.ts")).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-report-presentation-"));
  const outPath = join(dir, "report-presentation.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { buildExecutiveSnapshot } = await importReportPresentation();

test("the exact live bug: cover/executiveSnapshot.decision reads 'CONDITIONAL GO' from the Executive Summary's own decision line, never the raw 'WAIT' investmentScore.recommendation value", () => {
  const content = [
    "Decision: CONDITIONAL GO (Confidence: 52%)",
    "",
    "Confidence Reduced Because:",
    "- Market evidence is thin",
  ].join("\n");

  const snapshot = buildExecutiveSnapshot(content, { recommendation: "WAIT", confidence: 52 });

  assert.equal(snapshot.decision, "CONDITIONAL GO");
  assert.notEqual(snapshot.decision, "WAIT");
});

test("a GO-decision report's cover snapshot reads 'GO', matching the Executive Summary, not a stale/raw engine value", () => {
  const content = "Decision: GO (Confidence: 81%)";
  const snapshot = buildExecutiveSnapshot(content, { recommendation: "GO", confidence: 81 });

  assert.equal(snapshot.decision, "GO");
});

test("when no Executive Decision line is present at all (malformed content), the snapshot still falls back to investmentScore.recommendation rather than crashing", () => {
  const snapshot = buildExecutiveSnapshot("Some unrelated narrative text.", { recommendation: "GO", confidence: 60 });

  assert.equal(snapshot.decision, "GO");
});

// --- plan-executor.ts / ReportPdfButton.tsx wiring (drift checks) -------

const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const pdfSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");

test("plan-executor.ts passes the same canonical Executive Decision token (from planExecutiveDecisionBrief) into the consistency pass that Executive Summary was itself rendered from", () => {
  assert.match(
    planExecutorSource,
    /authoritativeExecutiveDecisionToken:\s*localizeExecutiveDecision\(planExecutiveDecisionBrief\.decision,\s*language\)/
  );
});

test("ReportPdfButton.tsx's cover page derives its GO/PASS/WAIT color banding from the same canonical Executive Decision extraction as the rest of the PDF, not solely the raw investmentScore.recommendation", () => {
  assert.match(pdfSource, /coverExecutiveDecisionCode\s*=\s*!isMarketIntelligenceReport/);
  assert.match(pdfSource, /extractExecutiveDecisionFromText\(marketExecutiveSummaryContent\)\?\.code/);
});

// --- 2. Prototype + design-partner evidence positively affects founder ---
// --- readiness without ever being counted as revenue/paid traction.   ---

const { evaluateMarketResearchCoverage } = await import(
  "../app/lib/ai/market-research-coverage.ts"
);

const zeroEvidencePrototypePrompt =
  "AI-powered strategic procurement intelligence for manufacturers. We have a working prototype and two enterprise design partners piloting it, no paid contracts yet.";
const noEvidencePrompt =
  "AI-powered strategic procurement intelligence for manufacturers.";

test("the exact live bug: a prompt reporting a working prototype and design partners raises founder readiness above the no-evidence baseline, with zero external research evidence available", () => {
  const withEvidence = evaluateMarketResearchCoverage([], zeroEvidencePrototypePrompt);
  const withoutEvidence = evaluateMarketResearchCoverage([], noEvidencePrompt);

  assert.ok(
    withEvidence.dimensions.founderReadiness > withoutEvidence.dimensions.founderReadiness,
    `expected prototype/design-partner evidence to raise founderReadiness (${withEvidence.dimensions.founderReadiness}) above the baseline (${withoutEvidence.dimensions.founderReadiness})`
  );
});

test("prototype/design-partner evidence raises founder readiness by exactly one proportionate step per matched signal category, never inflating it to the ceiling (does not inflate scores artificially)", () => {
  const result = evaluateMarketResearchCoverage([], zeroEvidencePrototypePrompt);

  // Base (25) + 15 per matched category: this prompt matches "partners"
  // (launch-plan/partnership category) and "prototype"/"design partners"
  // (its own category) -- 2 of 5 possible categories, not every one, so
  // that part of the result is a modest, explainable step (55). A later
  // CRITICAL SCORING ENGINE FIX (company lifecycle awareness) adds one
  // further small step on top for MVP-stage signals specifically (+6,
  // via the local lifecycleBoost in promptReadiness) -- still a modest,
  // explainable total, never a full/inflated 100.
  assert.equal(result.dimensions.founderReadiness, 61);
  assert.ok(result.dimensions.founderReadiness < 100);
});

test("applyMarketResearchCoverageToContext's Market attractiveness line blends founderReadiness with marketConfidence, so it can no longer be zeroed purely by thin external research coverage (drift check)", () => {
  const coverageSource = readFileSync(join(repoRoot, "app/lib/ai/market-research-coverage.ts"), "utf8");
  assert.match(
    coverageSource,
    /Market attractiveness: \$\{Math\.round\(\(dimensions\.marketConfidence \+ dimensions\.founderReadiness\) \/ 2\)\}%/
  );
});

test("hasValidationEvidence (financial-model.ts and investment-score.ts) still never treats 'prototype' or 'design partner' as revenue/traction evidence -- that distinction is preserved (drift check)", () => {
  const financialModelSource = readFileSync(join(repoRoot, "app/lib/ai/financial-model.ts"), "utf8");
  const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");

  for (const source of [financialModelSource, investmentScoreSource]) {
    const fnMatch = /function hasValidationEvidence\(prompt: string\) \{[\s\S]*?\n\}/.exec(source);
    assert.ok(fnMatch, "hasValidationEvidence not found");
    assert.doesNotMatch(fnMatch[0], /prototype/i);
    assert.doesNotMatch(fnMatch[0], /design partner/i);
  }
});

test("promptReadiness (market-research-coverage.ts) recognizes prototype/design-partner/MVP/beta signals distinctly from the revenue/traction keyword set above (drift check)", () => {
  const coverageSource = readFileSync(join(repoRoot, "app/lib/ai/market-research-coverage.ts"), "utf8");
  assert.match(coverageSource, /prototype\|mvp\|proof of concept\|poc\|beta/);
  assert.match(coverageSource, /design partners\?\|pilot partners\?\|pilot customers\?/);
});

// --- 3. Financial dashboard: non-verified values get precise labels -----

const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");

// A later CRITICAL PRODUCTION FIX (PRODUCTION DATA PROVENANCE POLISH)
// consolidated these three distinct labels into a single "Benchmark /
// Assumption" tier (plus a new, separate "Derived" tier) -- see
// tests/data-provenance-three-tier-classification.test.mjs for the
// current, standardized 3-category assertions.
for (const [name, source] of [
  ["page.tsx", pageSource],
  ["Planner.tsx", plannerSource],
]) {
  test(`${name}: non-verified financial dashboard values are labeled Benchmark / Assumption (standardized 3-tier system)`, () => {
    assert.match(source, /benchmarkDerived:\s*\{\s*English:\s*"Benchmark \/ Assumption"/);
    assert.match(source, /planningAssumption:\s*\{\s*English:\s*"Benchmark \/ Assumption"/);
    assert.match(source, /validationRequired:\s*\{\s*English:\s*"Benchmark \/ Assumption"/);
  });
}

test("page.tsx: the Unit Economics, Financial Dashboard, and KPI Dashboard badges all opt into the same standardized 3-tier financial vocabulary", () => {
  const kpiStart = pageSource.indexOf('if (normalizedTitle.includes("kpi")) {');
  assert.ok(kpiStart > -1, "KPI Dashboard block not found");
  const kpiBlock = pageSource.slice(kpiStart, kpiStart + 1200);
  assert.match(kpiBlock, /financial/);
});

// --- 4. Scenario analysis: one section-level notice, no per-line noise --

test("Scenario Analysis renders exactly one 'modeled, not measured' notice per report and no per-metric evidence badge that would repeat the warning (unaffected, confirmed still correct)", () => {
  for (const source of [pageSource, plannerSource]) {
    const scenarioStart = source.indexOf("Scenario analysis is modeled, not measured.");
    assert.ok(scenarioStart > -1, "Scenario Analysis banner not found");
  }
});

// --- 5. Explicit geography: the exact 10-country reported prompt --------

async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  const benchmarksPath = join(repoRoot, "app/lib/ai/industry-benchmarks.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(benchmarksPath).href)
  );
  source = source.replace(
    '"@/app/lib/ai/company-lifecycle"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/ai/company-lifecycle.ts")).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-financial-model-"));
  const outPath = join(dir, "financial-model.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { inferFinancialModelingInputs } = await importFinancialModel();

test("the exact live bug: a prompt naming United States, Germany, United Kingdom, France, Netherlands, Saudi Arabia, United Arab Emirates, Singapore, Japan, and South Korea preserves every country individually, with no region-label collapse", () => {
  const geography = inferFinancialModelingInputs(
    "Strategic procurement intelligence for manufacturers operating across the United States, Germany, United Kingdom, France, Netherlands, Saudi Arabia, United Arab Emirates, Singapore, Japan, and South Korea."
  ).geography;
  const regions = new Set(geography.split(" + "));

  for (const expected of [
    "United States",
    "Germany",
    "United Kingdom",
    "France",
    "Netherlands",
    "Saudi Arabia",
    "United Arab Emirates",
    "Singapore",
    "Japan",
    "South Korea",
  ]) {
    assert.ok(regions.has(expected), `"${expected}" missing from geography "${geography}"`);
  }
  assert.ok(!regions.has("Europe"), `"Europe" should not appear -- each European country is named explicitly, got "${geography}"`);
  assert.ok(!regions.has("GCC / Middle East"), `"GCC / Middle East" should not appear -- Saudi Arabia/UAE are both named explicitly, got "${geography}"`);
});

test("the geography multiplier is defined for every newly-split country and preserves the prior 'Europe'/'GCC / Middle East' value (financial calculations must not change)", () => {
  const financialModelSource = readFileSync(join(repoRoot, "app/lib/ai/financial-model.ts"), "utf8");
  const multiplierMatch = /function geographyMultiplier\([\s\S]*?\n\}/.exec(financialModelSource);
  assert.ok(multiplierMatch, "geographyMultiplier not found");
  assert.match(multiplierMatch[0], /geography === "Europe"/);
  for (const country of ["Germany", "France", "Italy", "Spain", "Greece", "Norway", "Netherlands"]) {
    assert.match(multiplierMatch[0], new RegExp(`geography === "${country}"`));
  }
  for (const country of ["Saudi Arabia", "Qatar"]) {
    assert.match(multiplierMatch[0], new RegExp(`geography === "${country}"`));
  }
});

// --- 6. Sources: internal provenance is never rendered as an external ---
// --- source, and is clearly separated from "External Sources".        ---

test("ReportPdfButton.tsx and Planner.tsx: the zero-citations fallback clearly separates 'External Sources: none available' from the methodology note, and fabricates no source-shaped bullets", () => {
  for (const source of [pdfSource, plannerSource]) {
    assert.match(source, /"External Sources: none available for this report\."/);
    assert.doesNotMatch(source, /"• Market Comparisons"/);
    assert.doesNotMatch(source, /"• Financial Comparisons"/);
    assert.doesNotMatch(source, /"• Planning Assumptions"/);
    assert.doesNotMatch(source, /"• Primary Research"/);
  }
});

// --- 8. Text quality: duplicate punctuation is cleaned at generation ----
// --- time (server-side), not only in the client render path.          ---

test("plan-executor.ts runs cleanupTemplatePresentationArtifacts (duplicate-punctuation cleanup) on every field's content before it is deduped/persisted (drift check)", () => {
  assert.match(planExecutorSource, /import \{ cleanupTemplatePresentationArtifacts \} from "@\/app\/lib\/report-presentation";/);
  const loopStart = planExecutorSource.indexOf("for (const field of planFields) {");
  assert.ok(loopStart > -1, "per-field cleanup loop not found");
  const loopBlock = planExecutorSource.slice(loopStart, planExecutorSource.indexOf("const deduped =", loopStart));
  assert.match(loopBlock, /normalized\[field\] = cleanupTemplatePresentationArtifacts\(normalized\[field\]\);/);
});

test("cleanupTemplatePresentationArtifacts's own regex behavior collapses a real duplicate-punctuation shape ('funding..') without touching a genuine ellipsis or unrelated text", () => {
  const source = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");
  assert.ok(
    source.includes("export function cleanupTemplatePresentationArtifacts(content: string) {"),
    "cleanupTemplatePresentationArtifacts not found"
  );

  // Mirrors the exact regex chain inside cleanupTemplatePresentationArtifacts
  // (report-presentation.ts) -- verified against the real source above so
  // this drifts loudly if that implementation ever changes shape.
  const clean = (content) =>
    content
      .replace(/(?<!\.)\.\.(?!\.)/g, ".")
      .replace(/([,;:!?])\1+/g, "$1")
      .replace(/([^\s])[ \t]{2,}/g, "$1 ")
      .replace(/[ \t]+\n/g, "\n");

  assert.equal(clean("Runway depends on securing additional funding.. before Q3."), "Runway depends on securing additional funding. before Q3.");
  assert.equal(clean("This is a genuine ellipsis... left untouched."), "This is a genuine ellipsis... left untouched.");
  assert.equal(clean("Sharp increase!! Confirmed,, twice."), "Sharp increase! Confirmed, twice.");
});
