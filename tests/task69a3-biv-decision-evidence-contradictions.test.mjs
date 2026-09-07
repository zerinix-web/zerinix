import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { evaluateMarketResearchCoverage } from "../app/lib/ai/market-research-coverage.ts";
import { createCanonicalFinancialAssumptions } from "../app/lib/ai/financial-assumptions.ts";
import { runConsistencyValidationPass } from "../app/lib/report-consistency-validation.ts";

// TASK #69A-3 -- Audit and fix real Business Idea Validation decision/
// evidence contradictions, found on a real, fresh, successfully-completed
// report (id 3f4cacf6-189a-414a-8ebb-94bc51b91897) generated immediately
// after Task #69A-2's fix.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const pdfNormalizationSource = readFileSync(new URL("../app/lib/pdf-normalization.mjs", import.meta.url), "utf8");
const benchmarkPanelSource = readFileSync(
  new URL("../components/planner/BenchmarkIntelligencePanel.tsx", import.meta.url),
  "utf8"
);

// Real evidence extracted from the real report's own persisted
// ai_response_cache research bundle (bare-domain-free, genuinely
// "Verified from external source" competitor citations).
const REAL_COMPETITOR_EVIDENCE = [
  {
    id: "R56", url: "https://www.floatapp.com/blog/compare-cash-flow-forecasting-tools",
    claim: "Float targets finance teams in SMBs, offers scenario planning, integrates with Xero/QuickBooks/FreeAgent.",
    field: "executive_assessment", label: "Verified from external source", value: "Float product and comparison pages describe target customers, features, and integrations.",
    impact: "favorable", provider: "openai_web_search", publisher: "Float", confidence: 88, sourceType: "webpage",
    lastChecked: "2026-09-05T20:54:24.240Z", proposition: "Float targets finance teams in SMBs.",
    sourceTitle: "Float — Compare & blogs", impactReason: "Shows established competitor and product-market fit in finance-team segment.",
    jurisdiction: "United States", qualityScore: 45, publishedDate: "2026-08-01", researchStage: "authoritative_public",
    authorityLevel: "secondary", supportedIssue: "", supportingData: ["Float describes finance-team positioning and integrations."],
    qualityRationale: "authority=16; specificity=6; provenance=15; content=3; date=5",
  },
  {
    id: "R57", url: "https://cashflowfrog.com/compare",
    claim: "Cash Flow Frog is built for small businesses and integrates with QuickBooks Desktop, QBO, Xero, Plaid.",
    field: "executive_assessment", label: "Verified from external source", value: "Cash Flow Frog product pages describe target customers and integrations.",
    impact: "favorable", provider: "openai_web_search", publisher: "Cash Flow Frog", confidence: 85, sourceType: "webpage",
    lastChecked: "2026-09-05T20:54:24.240Z", proposition: "Cash Flow Frog targets small businesses.",
    sourceTitle: "Cash Flow Frog — Compare/Products", impactReason: "Indicates available low-price competition targeted at very small SMBs.",
    jurisdiction: "United States", qualityScore: 44, publishedDate: "2026-08-01", researchStage: "authoritative_public",
    authorityLevel: "secondary", supportedIssue: "", supportingData: ["Cash Flow Frog describes SMB positioning and integrations."],
    qualityRationale: "authority=16; specificity=6; provenance=14; content=3; date=5",
  },
  {
    id: "R59", url: "https://www.floatapp.com/blog/best-cash-flow-forecasting-software-finance-teams",
    claim: "SMB pain points include spreadsheet reliance, poor short-term cash visibility, and integration gaps.",
    field: "analysis", label: "Verified from external source", value: "Roundup describes common SMB finance pain points.",
    impact: "neutral", provider: "openai_web_search", publisher: "Float; Eightx; Quicken", confidence: 80, sourceType: "webpage",
    lastChecked: "2026-09-05T20:54:24.240Z", proposition: "SMB pain points are well documented.",
    sourceTitle: "Float blog, Eightx, Quicken roundup", impactReason: "Validates customer pain to be solved by product.",
    jurisdiction: "United States", qualityScore: 42, publishedDate: "2026-08-01", researchStage: "authoritative_public",
    authorityLevel: "secondary", supportedIssue: "", supportingData: ["Roundup names common SMB pain points."],
    qualityRationale: "authority=15; specificity=5; provenance=14; content=3; date=5",
  },
];

const REAL_PROMPT =
  "I'm considering launching a premium AI-powered financial planning and decision-support platform for small and mid-sized businesses in the United States. The product would combine cash-flow forecasting, scenario planning, budgeting, financial risk alerts, and executive recommendations in one SaaS platform. Analyze whether this is a strong business idea, including customer pain points, target segments, market opportunity, TAM/SAM/SOM, competitors, pricing, business model, unit economics, go-to-market strategy, key risks, validation plan, and financial assumptions. Based on the evidence, give me a clear ENTER, MONITOR, or AVOID decision with confidence level and explain what evidence would be required to change that decision.";

function loadIsMarketSizeEstimated(source) {
  const startIndex = source.indexOf("function extractMarketSizeAssumption(");
  const endMarker = "function isMarketSizeEstimated(content: string, label: string) {";
  const endStart = source.indexOf(endMarker, startIndex);
  assert.notEqual(startIndex, -1);
  assert.notEqual(endStart, -1);
  // Find the closing brace of isMarketSizeEstimated by scanning brace depth
  // from the function's own opening brace.
  let depth = 0;
  let i = source.indexOf("{", endStart);
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const blob = source
    .slice(startIndex, i + 1)
    .replace(/\bcontent: string, label: string\b/g, "content, label")
    .replace(/: string \| null/g, "");
  const fn = new Function(`${blob}\nreturn isMarketSizeEstimated;`);
  return fn();
}

const isMarketSizeEstimatedPage = loadIsMarketSizeEstimated(pageSource);
const isMarketSizeEstimatedPlanner = loadIsMarketSizeEstimated(plannerSource);
const isMarketSizeEstimatedPdf = loadIsMarketSizeEstimated(pdfButtonSource);

// -----------------------------------------------------------------------
// ISSUE 1 -- Decision vocabulary: confirmed intentional, not a bug.
// -----------------------------------------------------------------------

// TASK #69A-7 -- superseded this test's own original finding. At the time
// Task #69A-3 audited this, Business Idea Validation's GO/CONDITIONAL GO/
// NO-GO vocabulary (vs. Market Intelligence's ENTER/MONITOR/AVOID) was a
// deliberate, structurally-separate design choice, not a bug. Task #69A-7
// then found a real report where the user explicitly requested an ENTER/
// MONITOR/AVOID decision but got "CONDITIONAL GO" back -- so Business
// Plan now ALSO opts into the shared formatter's ENTER/MONITOR/AVOID
// wording (a new "business_plan" vocabulary reusing Market Intelligence's
// own translation table verbatim, never a re-typed duplicate) via the
// exact same opt-in mechanism Market Intelligence already established.
test("ISSUE 1 (superseded by Task #69A-7): the shared formatter now supports 'standard' (GO/CONDITIONAL GO/NO-GO), 'market', and 'business_plan' (both ENTER/MONITOR/AVOID) vocabularies, and Business Plan explicitly opts into 'business_plan'", () => {
  const briefSource = readFileSync(
    new URL("../app/lib/report-engine/executive-decision-brief.ts", import.meta.url),
    "utf8"
  );
  assert.match(briefSource, /export type ExecutiveDecisionVocabulary = "standard" \| "market" \| "business_plan";/);
});

test("ISSUE 1 (structural authority, real report): Business Idea Validation's ONE canonical decision statement is written once, into executiveSummary only, by formatExecutiveDecisionBrief, using the 'business_plan' vocabulary -- confirmed against the real report's own content: every other section's 'go'/'avoid' mention (salesStrategy's 'Avoid next payroll shortfall', financialDashboard's 'go-to-market load', risks' 'Go-to-Market/CAC Risk', founderRoadmap's 'avoid large hires') is ordinary business prose, never a restated decision verdict", () => {
  const planExecutorSource = readFileSync(new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url), "utf8");
  assert.match(
    planExecutorSource,
    /normalized\.executiveSummary = formatExecutiveDecisionBrief\(\s*\n\s*planExecutiveDecisionBrief,\s*\n\s*language,\s*\n\s*"business_plan"\s*\n\s*\);/
  );
  // Real report content: confirm each non-executiveSummary "go"/"avoid"
  // mention is ordinary prose, not a decision restatement.
  const realOrdinaryMentions = [
    "Outreach angle: 'Avoid next payroll shortfall'",
    "go-to-market load",
    "Go-to-Market/CAC Risk",
    "avoid large hires",
  ];
  for (const mention of realOrdinaryMentions) {
    assert.ok(!/^(?:GO|CONDITIONAL GO|NO-GO|ENTER|MONITOR|AVOID)$/i.test(mention.trim()));
  }
});

test("ISSUE 1 (no renderer-side vocabulary inference): neither page.tsx, Planner.tsx, nor ReportPdfButton.tsx contains logic that reinterprets a Business Idea Validation GO/CONDITIONAL_GO/NO_GO decision into ENTER/MONITOR/AVOID (or vice versa) based on prompt content -- the vocabulary is chosen once, structurally, at generation time via ExecutiveDecisionVocabulary, never guessed per-render", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.doesNotMatch(source, /ENTER.*MONITOR.*AVOID.*localizeExecutiveDecision|localizeExecutiveDecision.*prompt\.(?:includes|match)/is);
  }
});

// -----------------------------------------------------------------------
// ISSUE 2 -- TAM/SAM/SOM evidence classification.
// -----------------------------------------------------------------------

const REAL_TAM_SAM_SOM_CONTENT =
  "TAM: $21.8B | evidence=Benchmark / Assumption | confidence=High\nSAM: $983.0M | evidence=Benchmark / Assumption | confidence=High\nSOM: $9.8M | evidence=Benchmark / Assumption | confidence=High\nCommentary: Treat the sizing as a directional planning model until category boundaries, reachable customer segments, and obtainable share are verified with current market evidence.";

test("ISSUE 2: the real report's TAM/SAM/SOM canonical 'evidence=Benchmark / Assumption' lines are now correctly classified as estimated (not Verified), in all three renderer copies", () => {
  for (const [label, fn] of [
    ["page.tsx", isMarketSizeEstimatedPage],
    ["Planner.tsx", isMarketSizeEstimatedPlanner],
    ["ReportPdfButton.tsx", isMarketSizeEstimatedPdf],
  ]) {
    assert.equal(fn(REAL_TAM_SAM_SOM_CONTENT, "TAM"), true, `${label}: TAM`);
    assert.equal(fn(REAL_TAM_SAM_SOM_CONTENT, "SAM"), true, `${label}: SAM`);
    assert.equal(fn(REAL_TAM_SAM_SOM_CONTENT, "SOM"), true, `${label}: SOM`);
  }
});

test("ISSUE 2: a genuinely 'evidence=Verified' layer is NOT flagged as estimated -- verified source input still renders as Verified, no over-correction", () => {
  const content = "TAM: $5.0B | evidence=Verified | confidence=High\nSAM: $500M | evidence=Verified | confidence=High\nSOM: $50M | evidence=Verified | confidence=High";
  for (const fn of [isMarketSizeEstimatedPage, isMarketSizeEstimatedPlanner, isMarketSizeEstimatedPdf]) {
    assert.equal(fn(content, "TAM"), false);
  }
});

test("ISSUE 2: a mixed report -- verified source input for one layer, planning assumption for another -- classifies EACH layer independently (verified source input + planning assumption != fully Verified output for the assumption-derived layer, while the genuinely verified layer is unaffected)", () => {
  const content = "TAM: $5.0B | evidence=Verified | confidence=High\nSAM: $500M | evidence=Derived | confidence=Medium\nSOM: $10M | evidence=Benchmark / Assumption | confidence=Low";
  for (const fn of [isMarketSizeEstimatedPage, isMarketSizeEstimatedPlanner, isMarketSizeEstimatedPdf]) {
    assert.equal(fn(content, "TAM"), false, "TAM (Verified) must not be flagged");
    assert.equal(fn(content, "SAM"), true, "SAM (Derived) must be flagged as estimated");
    assert.equal(fn(content, "SOM"), true, "SOM (Benchmark / Assumption) must be flagged as estimated");
  }
});

test("ISSUE 2 (Market Intelligence unaffected): the pre-existing '[Estimated]'/'Planning Estimate' free-prose convention still works exactly as before, in all three files", () => {
  const bracketContent = "TAM (Germany, 2026) ~= EUR200-800 million [Estimated], based on population share of the OECD benchmark.";
  const planningEstimateContent = "TAM ~= $500M Planning Estimate based on category benchmarks.";
  for (const fn of [isMarketSizeEstimatedPage, isMarketSizeEstimatedPlanner, isMarketSizeEstimatedPdf]) {
    assert.equal(fn(bracketContent, "TAM"), true);
    assert.equal(fn(planningEstimateContent, "TAM"), true);
  }
});

test("ISSUE 2 (values unchanged): the fix touches only evidence classification, never the numeric TAM/SAM/SOM values themselves", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.doesNotMatch(source, /extractMarketSizeEvidenceLabel[\s\S]{0,200}(?:21\.8|983\.0|9\.8)/);
  }
});

// -----------------------------------------------------------------------
// ISSUE 3 -- Competitor evidence contradiction.
// -----------------------------------------------------------------------

test("ISSUE 3: the real report's genuinely 'Verified from external source' competitor evidence (Float, Cash Flow Frog) is now counted as distinct competitor organizations -- was 0, now correctly non-zero", () => {
  const coverage = evaluateMarketResearchCoverage(REAL_COMPETITOR_EVIDENCE, REAL_PROMPT);
  assert.equal(coverage.competitorBreadth, 2);
  assert.ok(coverage.dimensions.competitiveEvidence > 7, "competitiveEvidence dimension must reflect the real evidence, not the old 7%");
});

test("ISSUE 3: competitor evidence counting is based on authoritative evidence records (label + impactReason), never on prose parsed from the generated Competitor Landscape section -- an evidence item with NO 'Verified from external source' label is never counted regardless of how competitor-like its claim text reads", () => {
  const unsupportedItem = {
    ...REAL_COMPETITOR_EVIDENCE[0],
    id: "R999",
    label: "Estimate",
    publisher: "FakeCompetitor Inc",
    impactReason: "Shows an established competitor.",
  };
  const coverage = evaluateMarketResearchCoverage([unsupportedItem], REAL_PROMPT);
  assert.equal(coverage.competitorBreadth, 0, "an unverified/estimated item must never inflate competitor breadth");
});

test("ISSUE 3: an evidence item with genuinely no competitor-topical signal at all (field/claim/sourceType/impactReason) is correctly excluded, even if verified", () => {
  const unrelatedItem = {
    ...REAL_COMPETITOR_EVIDENCE[0],
    id: "R998",
    field: "material_facts",
    claim: "United States GDP grew 2.1% in the most recent quarter.",
    impactReason: "Provides macroeconomic context.",
    publisher: "BEA",
  };
  const coverage = evaluateMarketResearchCoverage([unrelatedItem], REAL_PROMPT);
  assert.equal(coverage.competitorBreadth, 0);
});

test("ISSUE 3 (structural, scoped fix): the widened competitor-evidence check is a dedicated function, never a change to the shared coversField helper 5 other, unrelated coverage dimensions also depend on", () => {
  const marketCoverageSource = readFileSync(
    new URL("../app/lib/ai/market-research-coverage.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketCoverageSource, /function coversCompetitorEvidence\(item: DomainResearchEvidence\)/);
  assert.match(marketCoverageSource, /\$\{item\.field\} \$\{item\.claim\} \$\{item\.sourceType\} \$\{item\.impactReason\}/);
  assert.match(marketCoverageSource, /function coversField\(item: DomainResearchEvidence, pattern: RegExp\) \{\s*\n\s*return pattern\.test\(`\$\{item\.field\} \$\{item\.claim\} \$\{item\.sourceType\}`\);/);
});

// -----------------------------------------------------------------------
// ISSUE 4 -- Benchmark Intelligence validation-gap contradiction.
// -----------------------------------------------------------------------

test("ISSUE 4: Benchmark Intelligence's validationGaps now reflects investmentScore's own material (below-50%) category weaknesses -- no longer independently empty while decision-critical evidence is genuinely limited", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: REAL_PROMPT, reportKind: "business_plan" });
  const materialCategories = Object.values(context.investmentScore.categories).filter(
    (category) => category.score / category.maximumScore < 0.5
  );
  if (materialCategories.length > 0) {
    assert.ok(
      context.benchmarkFit.validationGaps.length > 0,
      "validationGaps must be non-empty whenever a material (<50%) category gap genuinely exists"
    );
    for (const category of materialCategories) {
      assert.ok(
        context.benchmarkFit.validationGaps.some((gap) => gap.startsWith(category.label)),
        `expected a validation gap entry for ${category.label}`
      );
    }
  }
});

test("ISSUE 4: a report with no material category gaps (all categories >= 50%) does NOT fabricate a gap -- 'No material validation gaps detected' remains honest for a genuinely strong report", () => {
  const strongCategories = {
    a: { label: "A", explanation: "strong", score: 90, maximumScore: 100 },
    b: { label: "B", explanation: "strong", score: 80, maximumScore: 100 },
  };
  const gaps = Object.values(strongCategories)
    .filter((category) => category.score / category.maximumScore < 0.5)
    .map((category) => `${category.label}: ${category.explanation}`);
  assert.equal(gaps.length, 0);
});

test("ISSUE 4 (structural, same object): the enrichment modifies the SAME benchmarkFit object every surface (web, Planner.tsx live view, PDF) already reads from report.metadata.benchmarkFit -- never a second, competing gap list", () => {
  const financialAssumptionsSource = readFileSync(
    new URL("../app/lib/ai/financial-assumptions.ts", import.meta.url),
    "utf8"
  );
  assert.match(financialAssumptionsSource, /const benchmarkFit: BenchmarkFit = \{\s*\n\s*\.\.\.financialModel\.benchmarkFit,/);
  // TASK #69A-18A -- page.tsx used to carry its own byte-for-byte
  // duplicate of BenchmarkIntelligencePanel (a second copy of exactly
  // this benchmarkFit.validationGaps read); it now imports the one
  // shared, canonical component instead, so the read itself only ever
  // exists in benchmarkPanelSource/pdfNormalizationSource.
  assert.match(
    pageSource,
    /import \{ BenchmarkIntelligencePanel \} from "@\/components\/planner\/BenchmarkIntelligencePanel";/
  );
  for (const source of [benchmarkPanelSource, pdfNormalizationSource]) {
    assert.match(source, /benchmarkFit(?:\?\.)?\.validationGaps/);
  }
});

test("ISSUE 4 (pre-existing gap heuristics preserved): the 3 original prompt-level validation-gap checks are untouched, still contribute their own findings unchanged", () => {
  const financialModelSource = readFileSync(new URL("../app/lib/ai/financial-model.ts", import.meta.url), "utf8");
  assert.match(financialModelSource, /No direct customer, revenue, retention, or acquisition evidence was provided in the request\./);
  assert.match(financialModelSource, /Benchmark confidence is low for this business model and requires primary validation\./);
});

// -----------------------------------------------------------------------
// ISSUE 5 -- Numeric/unit formatting defect ("/month/month").
// -----------------------------------------------------------------------

test("ISSUE 5: the exact reported '$195k/month/month' defect no longer reproduces -- a canonical metric whose displayValue already carries a '/month' suffix is never given a second one when its own mention is re-scanned", () => {
  const sections = { someOtherField: "Planning assumption — - Monthly Burn: $195k/month" };
  runConsistencyValidationPass({
    sections,
    fields: ["someOtherField"],
    language: "English",
    authoritativeDecision: "WAIT",
    authoritativeExecutiveDecisionToken: "CONDITIONAL GO",
    decisionProtectedFields: [],
    metricTargets: [{ labelPattern: "Monthly Burn", canonicalDisplayValue: "$195k/month", type: "financial_metric_mismatch" }],
    metricProtectedFields: [],
  });
  assert.doesNotMatch(sections.someOtherField, /\/month\/month/);
  assert.match(sections.someOtherField, /Monthly Burn: \$195k\/month\b/);
});

test("ISSUE 5: a genuinely DIFFERENT stated value (real mismatch, not a formatting artifact) is still corrected to the canonical value, with exactly one unit suffix -- the fix does not disable real corrections", () => {
  const sections = { someOtherField: "Monthly Burn: $500k/month" };
  runConsistencyValidationPass({
    sections,
    fields: ["someOtherField"],
    language: "English",
    authoritativeDecision: "WAIT",
    authoritativeExecutiveDecisionToken: "CONDITIONAL GO",
    decisionProtectedFields: [],
    metricTargets: [{ labelPattern: "Monthly Burn", canonicalDisplayValue: "$195k/month", type: "financial_metric_mismatch" }],
    metricProtectedFields: [],
  });
  assert.equal(sections.someOtherField, "Monthly Burn: $195k/month");
});

test("ISSUE 5: a value with no rate suffix at all is still corrected cleanly to the canonical (unit-bearing) value, never producing a duplicate", () => {
  const sections = { someOtherField: "Monthly Burn: $500k" };
  runConsistencyValidationPass({
    sections,
    fields: ["someOtherField"],
    language: "English",
    authoritativeDecision: "WAIT",
    authoritativeExecutiveDecisionToken: "CONDITIONAL GO",
    decisionProtectedFields: [],
    metricTargets: [{ labelPattern: "Monthly Burn", canonicalDisplayValue: "$195k/month", type: "financial_metric_mismatch" }],
    metricProtectedFields: [],
  });
  assert.equal(sections.someOtherField, "Monthly Burn: $195k/month");
  assert.doesNotMatch(sections.someOtherField, /\/month\/month/);
});

test("ISSUE 5 (not a special case for '$195k'): the same duplicate-suffix scenario is fixed for a completely different metric/value/label -- ARPA at a different figure", () => {
  const sections = { someOtherField: "ARPA: $2.4k/month is the current average." };
  runConsistencyValidationPass({
    sections,
    fields: ["someOtherField"],
    language: "English",
    authoritativeDecision: "WAIT",
    authoritativeExecutiveDecisionToken: "CONDITIONAL GO",
    decisionProtectedFields: [],
    metricTargets: [{ labelPattern: "ARPA", canonicalDisplayValue: "$2.4k/month", type: "financial_metric_mismatch" }],
    metricProtectedFields: [],
  });
  assert.doesNotMatch(sections.someOtherField, /\/month\/month/);
});

test("ISSUE 5 (structural, belt-and-suspenders): financialAssumptions is now a metricProtectedFields entry in plan-executor.ts, matching financialDashboard/unitEconomics/tamSamSom's own existing self-correction exemption", () => {
  const planExecutorSource = readFileSync(new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url), "utf8");
  assert.match(
    planExecutorSource,
    /metricProtectedFields: \["financialDashboard", "unitEconomics", "tamSamSom", "financialAssumptions"\]/
  );
});

// -----------------------------------------------------------------------
// Requirement 7 -- web and PDF resolve the same decision/confidence/
// evidence status/validation gaps (shared, single source objects).
// -----------------------------------------------------------------------

test("requirement 7: TAM/SAM/SOM evidence classification is byte-identical logic in all three renderer surfaces (page.tsx, Planner.tsx, ReportPdfButton.tsx)", () => {
  const marker = "TASK #69A-3 -- see page.tsx's identical isMarketSizeEstimated fix";
  assert.ok(plannerSource.includes(marker));
  assert.ok(pdfButtonSource.includes(marker));
});

test("requirement 7: Benchmark Intelligence's Largest Gaps rendering (web, Planner.tsx, PDF) all read the identical benchmarkFit.materialValidationGaps field, never a renderer-computed copy", () => {
  // TASK #69A-18A -- page.tsx now imports BenchmarkIntelligencePanel
  // from components/planner/ instead of carrying its own duplicate
  // implementation (see the ISSUE 4 structural test above), so the
  // actual gaps-resolution literal only lives in benchmarkPanelSource
  // now; pageSource is checked for the import itself.
  assert.match(
    pageSource,
    /import \{ BenchmarkIntelligencePanel \} from "@\/components\/planner\/BenchmarkIntelligencePanel";/
  );
  // TASK #69A-18B -- both renderers now read materialValidationGaps
  // (the clean, structured, score-free canonical collection), never
  // the mixed validationGaps field (which still carries category-
  // scorecard commentary for other, unrelated consumers/tests).
  assert.match(benchmarkPanelSource, /benchmarkFit\?\.materialValidationGaps\?\.length\s*\n\s*\? benchmarkFit\.materialValidationGaps\s*\n\s*: \[labels\.noGaps\];/);
  assert.match(pdfNormalizationSource, /benchmarkFit\?\.materialValidationGaps\) && benchmarkFit\.materialValidationGaps\.length/);
});

test("requirement 7 (invariant H): Market Intelligence's own decision/evidence resolvers (resolveMarketIntelligenceGatedExecutiveDecision, resolveMarketIntelligenceConfidenceState) are untouched by any Task #69A-3 change", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.match(source, /resolveMarketIntelligenceGatedExecutiveDecision\(/);
  }
});
