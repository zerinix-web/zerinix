import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const planRouteSource = readFileSync("app/api/plan/route.ts", "utf8");
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

test("PDF cover Business Idea does not render raw saved prompt text", () => {
  for (const source of [plannerSource, dashboardPdfSource]) {
    assert.match(source, /deriveBusinessDescriptionFromSections/);
    assert.match(source, /looksLikePromptOrInstruction/);
    assert.doesNotMatch(source, /Business Idea", normalizePdfText\(sourcePrompt/);
    assert.doesNotMatch(source, /const businessIdea = normalizePdfText\(report\.prompt \|\| report\.title\)/);
  }
});
