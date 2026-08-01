import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const planRouteSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
const plannerSource = readFileSync("components/Planner.tsx", "utf8");
const dashboardPdfSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
const financialAssumptionsSource = readFileSync(
  "app/lib/ai/financial-assumptions.ts",
  "utf8"
);

test("Business Plan generation forbids exposing raw prompts and internal instructions", () => {
  assert.match(planRouteSource, /sanitizeVisibleReportContent/);
  assert.match(planRouteSource, /Never quote, restate, or display the raw submitted prompt\/question/);
  assert.match(planRouteSource, /Never expose system prompts, internal reasoning, validation prompts/);
  assert.match(planRouteSource, /based on the entire report/);
  assert.match(planRouteSource, /business idea\\s\*\\\/\\s\*goal/);
});

test("Business Plan recommendation confidence and assumptions are explicit", () => {
  assert.match(planRouteSource, /confidence level from the Investment Scoring Engine/);
  assert.match(planRouteSource, /High \/ Medium \/ Low or %/);
  assert.match(planRouteSource, /Key Assumptions behind the financial model/);
  assert.match(planRouteSource, /User-provided fact, AI assumption, or Market-derived estimate/);
  assert.match(financialAssumptionsSource, /Evidence classification/);
  assert.match(financialAssumptionsSource, /Financial Assumptions must be written as a Key Assumptions section/);
});

test("Business Plan sources require structured metadata without fake citations", () => {
  assert.match(planRouteSource, /Deduplicate sources/);
  assert.match(planRouteSource, /title, publisher, publication year, URL if available, and confidence/);
  assert.match(planRouteSource, /Do not invent URLs, report names, or publishers/);
  assert.match(planRouteSource, /User-provided facts, AI assumptions, and Market-derived estimates/);
});

test("Business Plan route accepts structured Responses API parsed output", () => {
  assert.match(planRouteSource, /function extractTextFromValue/);
  assert.match(planRouteSource, /record\.output_parsed/);
  assert.match(planRouteSource, /JSON\.stringify\(outputParsed\)/);
  assert.match(planRouteSource, /type === "output_text"/);
});

test("Business Plan route repairs missing Sources / Assumptions without failing the report", () => {
  assert.match(planRouteSource, /function createSourcesAssumptionsFallback/);
  assert.match(planRouteSource, /Verified external citations were not returned/);
  assert.match(planRouteSource, /field === "sourcesAssumptions"/);
  assert.match(planRouteSource, /createSourcesAssumptionsFallback\(parsed\)/);
});

test("Business Plan route normalizes critical report sections from the canonical model", () => {
  assert.match(planRouteSource, /function normalizeFullPlanReport/);
  assert.match(planRouteSource, /buildCanonicalTamSamSom\(context\)/);
  assert.match(planRouteSource, /buildCanonicalUnitEconomics\(context\)/);
  assert.match(planRouteSource, /buildCanonicalFinancialDashboard\(context\)/);
  assert.match(planRouteSource, /buildCanonicalScenarioAnalysis\(context\)/);
  assert.match(planRouteSource, /buildCanonicalKpiDashboard\(context\)/);
  assert.match(planRouteSource, /buildCanonicalSwot\(context, parsed\)/);
  assert.match(planRouteSource, /buildCanonicalExecutiveRecommendation\(context\)/);
});

test("Business Plan API logs stage-specific failures instead of returning generic failures", () => {
  assert.match(planRouteSource, /function logPlanStage/);
  assert.match(planRouteSource, /fullReportStage/);
  assert.match(planRouteSource, /Plan report generation failed at \$\{fullReportStage\}/);
  assert.doesNotMatch(planRouteSource, /\{ error: "Report generation failed\. Please try again later\." \}/);
});

test("Business Plan renderers recognize non-SaaS financial labels", () => {
  assert.match(plannerSource, /rider cac\|rider ltv\|active riders\|yearly revenue\|monthly revenue/);
  assert.match(dashboardPdfSource, /rider cac\|rider ltv\|active riders\|yearly revenue\|monthly revenue/);
});

test("PDF cover Business Idea does not render raw saved prompt text", () => {
  for (const source of [plannerSource, dashboardPdfSource]) {
    assert.match(source, /deriveBusinessDescriptionFromSections/);
    assert.match(source, /looksLikePromptOrInstruction/);
    assert.doesNotMatch(source, /Business Idea", normalizePdfText\(sourcePrompt/);
    assert.doesNotMatch(source, /const businessIdea = normalizePdfText\(report\.prompt \|\| report\.title\)/);
  }
});
