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

const requiredScorecardLabels = [
  "Overall Recommendation",
  "Confidence Score",
  "Opportunity Level",
  "Risk Level",
  "Estimated Time to Market",
  "Investment Readiness",
  "Decision Summary",
];

const requiredInsightLabels = [
  "Key Insight",
  "Why It Matters",
  "Recommended Executive Action",
  "Expected Business Impact",
];

const requiredCeoSummaryLabels = [
  "Biggest Opportunity",
  "Biggest Risk",
  "First 90 Days",
  "Critical KPIs",
  "Final Recommendation",
];

test("executive presentation contract contains every decision-grade block without expanding field budgets", () => {
  const contract = buildExecutivePresentationDirectives("business_plan").join("\n");

  for (const label of [
    ...requiredScorecardLabels,
    ...requiredInsightLabels,
    ...requiredCeoSummaryLabels,
  ]) {
    assert.match(contract, new RegExp(label, "i"));
  }

  assert.match(contract, /Confidence: High, Medium, or Low/i);
  assert.match(contract, /3-5 concrete actions/i);
  assert.match(contract, /\[Verified\].*\[Estimated\].*\[Assumption\]/i);
  assert.match(contract, /inside the existing field word budgets/i);
  assert.match(contract, /do not increase total report length/i);
});

test("all full-report families consume the shared executive presentation contract", () => {
  const reports = [
    buildPlanFullReportInstructions("English"),
    buildMarketLanguageInstructions("English"),
    buildRealEstateInstructions("English"),
    buildDomainAnalysisInstructions("finance", "English"),
  ];

  for (const instructions of reports) {
    assert.match(instructions, /Executive Scorecard/);
    assert.match(instructions, /AI Executive Insight/);
    assert.match(instructions, /Next Actions/);
    assert.match(instructions, /CEO Summary/);
    assert.match(instructions, /new section-owned analysis|new implication/i);
  }
});

test("scorecard and CEO summary remain embedded in existing schemas", () => {
  for (const fields of [
    planFields,
    marketReportFields,
    realEstateFields,
    domainAnalysisFields,
  ]) {
    assert.equal(fields.includes("executiveScorecard"), false);
    assert.equal(fields.includes("ceoSummary"), false);
  }

  const planSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
  const marketSource = readFileSync("app/api/market-analysis/route.ts", "utf8");

  assert.match(planSource, /normalized\.executiveSummary = buildExecutiveScorecard/);
  assert.match(planSource, /"CEO Summary", "CEO Özeti"/);
  assert.match(marketSource, /buildMarketExecutiveScorecard/);
  assert.match(marketSource, /buildMarketCeoSummary/);
  assert.match(planSource, /serializePlanChunk\(field, report\[field\]\)/);
  assert.match(marketSource, /serializeReportChunk\(field, report\[field\]\)/);
});

test("deterministic executive blocks preserve provenance and calibrated confidence language", () => {
  const planSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
  const marketSource = readFileSync("app/api/market-analysis/route.ts", "utf8");

  for (const source of [planSource, marketSource]) {
    assert.match(source, /\[Estimated\] Overall Recommendation/);
    assert.match(source, /\[Assumption\] Estimated Time to Market/);
    assert.match(source, /Confidence Score:.*evidence|Confidence Score:.*source/s);
    assert.match(source, /Biggest Opportunity/);
    assert.match(source, /Biggest Risk/);
    assert.match(source, /First 90 Days/);
    assert.match(source, /Critical KPIs/);
    assert.match(source, /Final Recommendation/);
  }
});
