import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildExecutivePresentationDirectives } from "../app/lib/ai/report-quality-directives.ts";
import {
  buildPlanFullReportInstructions,
  planFields,
} from "../app/lib/report-engine/prompts/plan.ts";
import {
  buildMarketLanguageInstructions,
  marketReportFields,
} from "../app/lib/report-engine/prompts/market.ts";
import {
  buildRealEstateInstructions,
  realEstateFields,
} from "../app/lib/report-engine/prompts/real-estate.ts";
import {
  buildDomainAnalysisInstructions,
  domainAnalysisFields,
} from "../app/lib/report-engine/prompts/domain-analysis.ts";

// REDESIGN: this whole file used to pin down the "decision-grade block"
// contract -- an Executive Scorecard, a 4-part AI Executive Insight block
// plus a Confidence line plus a 3-5 item Next Actions list after every
// major section, and a report-native CEO Summary/Market Diligence
// Summary/Executive Decision Summary block at the end -- shared by all
// four full-report families. That contract is retired: it was 2-3 more
// places restating the same decision the report's single Executive
// Decision layer (Final Decision, Confidence, Why, Biggest Risks,
// Biggest Opportunity, First 90-Day Action Plan) already states once, at
// the start of the report. These tests now confirm that retirement holds
// for every report kind, not just Business Plan.

const retiredLabels = [
  "Executive Scorecard",
  "AI Executive Insight",
  "Overall Recommendation",
  "Investment Readiness",
  "CEO Summary",
  "Market Diligence Summary",
  "Executive Decision Summary",
];

test("buildExecutivePresentationDirectives is minimal for every report kind: no scorecard, no per-section Insight/Confidence/Next-Actions block, no end-of-report summary block", () => {
  for (const kind of ["business_plan", "market_analysis", "real_estate", "specialized_analysis"]) {
    const contract = buildExecutivePresentationDirectives(kind).join("\n");

    for (const label of retiredLabels) {
      assert.doesNotMatch(contract, new RegExp(label), `${kind} must not mandate "${label}"`);
    }
    assert.doesNotMatch(contract, /Confidence: High, Medium, or Low/i);
    assert.doesNotMatch(contract, /3-5 concrete actions/i);

    // What should remain: a lightweight, per-major-section implication
    // sentence and a narrowed evidence-labeling rule -- nothing that
    // restates a decision, a confidence score, or an action plan.
    assert.match(contract, /one compact sentence explaining why this section moves the decision/i);
    assert.match(contract, /\[Verified\].*\[Estimated\].*\[Assumption\]/i);
  }
});

test("no full-report instruction builder mandates the retired Executive Scorecard / AI Executive Insight / end-of-report summary contract", () => {
  const reports = [
    buildPlanFullReportInstructions("English"),
    buildMarketLanguageInstructions("English"),
    buildRealEstateInstructions("English"),
    buildDomainAnalysisInstructions("finance", "English"),
  ];

  for (const instructions of reports) {
    for (const label of retiredLabels) {
      assert.doesNotMatch(instructions, new RegExp(label));
    }
  }
});

test("no report schema declares a dedicated scorecard or CEO-summary field -- the single Executive Decision layer lives inside the existing first field", () => {
  for (const fields of [planFields, marketReportFields, realEstateFields, domainAnalysisFields]) {
    assert.equal(fields.includes("executiveScorecard"), false);
    assert.equal(fields.includes("ceoSummary"), false);
    assert.equal(fields.includes("executiveRecommendation"), false);
  }
});

test("Business Plan and Market Intelligence build their single Executive Decision layer from real, already-computed data, not a per-field bracket-tagged dump", () => {
  const planSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
  const marketSource = readFileSync("app/api/market-analysis/route.ts", "utf8");
  const presentationSource = readFileSync(
    "app/lib/report-engine/market-intelligence-presentation.ts",
    "utf8"
  );

  // Business Plan: the brief is built from the real investment-score
  // engine (strengths/topRisks/nextCriticalAction), not invented text.
  assert.match(planSource, /function buildPlanExecutiveDecisionBrief/);
  assert.match(planSource, /score\.strengths/);
  assert.match(planSource, /score\.topRisks/);
  assert.match(
    planSource,
    /const planExecutiveDecisionBrief = buildPlanExecutiveDecisionBrief\(context, language\);\s*\n\s*normalized\.executiveSummary = formatExecutiveDecisionBrief\(planExecutiveDecisionBrief, language\);/
  );

  // Market Intelligence: isolated in its own module, built only from the
  // report's own market-native sections and evidence coverage, never
  // from Business Idea Validation's investment-score engine.
  assert.match(presentationSource, /export function buildMarketExecutiveDecisionBrief/);
  assert.doesNotMatch(presentationSource, /investmentScore/);
  assert.match(
    marketSource,
    /marketExecutiveDecisionBrief = buildMarketExecutiveDecisionBrief\(\s*\n\s*normalized,\s*\n\s*language,\s*\n\s*coverage,\s*\n\s*decisionCriticalEvidence\s*\n\s*\);\s*\n(?:.*\n)*?\s*normalized\.executiveSummary = formatExecutiveDecisionBrief\(marketExecutiveDecisionBrief, language, "market"\);/
  );

  // Market Intelligence's own entry-recommendation section supports the
  // decision (why/where/when/how) but must not restate the verdict a
  // second time -- that is now the single Executive Decision layer's job.
  assert.doesNotMatch(presentationSource, /Should this market be entered/);
  assert.match(presentationSource, /- Why: \$\{why\}/);
  assert.match(presentationSource, /- Where: \$\{where\}/);
  assert.match(presentationSource, /- When: \$\{when\}/);
  assert.match(presentationSource, /- How: \$\{how\}/);
});
