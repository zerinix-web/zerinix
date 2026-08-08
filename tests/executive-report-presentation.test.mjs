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

test("all full-report families consume the shared executive presentation contract, each with its own report-native summary heading", () => {
  // CEO Summary is investor/founder-executive framing that belongs to
  // Business Idea Validation and real estate (both genuine investment
  // decisions) -- Market Intelligence and Strategic Advisory get their own
  // report-native heading instead of inheriting it. See
  // report-quality-directives.ts's summaryHeadingByKind.
  const reportsAndHeadings = [
    [buildPlanFullReportInstructions("English"), "CEO Summary"],
    [buildMarketLanguageInstructions("English"), "Market Diligence Summary"],
    [buildRealEstateInstructions("English"), "CEO Summary"],
    [buildDomainAnalysisInstructions("finance", "English"), "Executive Decision Summary"],
  ];

  for (const [instructions, summaryHeading] of reportsAndHeadings) {
    assert.match(instructions, /Executive Scorecard/);
    assert.match(instructions, /AI Executive Insight/);
    assert.match(instructions, /Next Actions/);
    assert.match(instructions, new RegExp(summaryHeading));
    assert.match(instructions, /new section-owned analysis|new implication/i);
  }

  // Market Intelligence and Strategic Advisory must never receive the
  // other reports' summary heading.
  assert.doesNotMatch(buildMarketLanguageInstructions("English"), /CEO Summary/);
  assert.doesNotMatch(buildDomainAnalysisInstructions("finance", "English"), /CEO Summary/);
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
  // Market Intelligence's deterministic executive-summary/entry-recommendation
  // synthesis is isolated in its own module rather than living inline in
  // market-analysis/route.ts, and is built from market-native evidence
  // coverage, never from Business Idea Validation's investment-score engine.
  assert.match(marketSource, /buildMarketExecutiveSummary\(/);
  assert.match(marketSource, /buildMarketEntryRecommendation\(/);
  assert.match(marketSource, /from "@\/app\/lib\/report-engine\/market-intelligence-presentation"/);
  assert.doesNotMatch(marketSource, /buildMarketExecutiveScorecard\(/);
  assert.doesNotMatch(marketSource, /buildMarketCeoSummary\(/);
  assert.match(planSource, /serializePlanChunk\(field, report\[field\]\)/);
  assert.match(marketSource, /serializeNormalizedReportChunk\(field, report\[field\]\)/);
});

test("deterministic executive blocks preserve provenance and calibrated confidence language", () => {
  const planSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
  const marketSource = readFileSync("app/api/market-analysis/route.ts", "utf8");
  const presentationSource = readFileSync(
    "app/lib/report-engine/market-intelligence-presentation.ts",
    "utf8"
  );

  // Business Idea Validation: Bottom Line / Key Findings / Biggest
  // Opportunity / Biggest Risk / Recommendation, synthesized from real,
  // already-computed investment-score data rather than a per-field
  // bracket-tagged data dump. This is the one report type where that
  // engine is the legitimate source of truth.
  assert.match(planSource, /Bottom Line:/);
  assert.match(planSource, /Key Findings:/);
  assert.match(planSource, /Biggest Opportunity:/);
  assert.match(planSource, /Biggest Risk:/);
  assert.match(planSource, /rankInvestmentScoreFindingsByImpact/);

  // Market Intelligence: same Bottom Line / Key Findings / Biggest
  // Opportunity / Biggest Risk shape, but isolated in its own module and
  // synthesized from the report's own market-native sections and evidence
  // coverage -- never from investmentScore.
  assert.match(marketSource, /buildMarketExecutiveSummary\(/);
  assert.doesNotMatch(marketSource, /rankInvestmentScoreFindingsByImpact/);
  assert.match(presentationSource, /Bottom Line:/);
  assert.match(presentationSource, /Key Findings:/);
  assert.match(presentationSource, /Biggest Opportunity:/);
  assert.match(presentationSource, /Biggest Risk:/);
  assert.doesNotMatch(presentationSource, /investmentScore/);

  // The CEO Summary block (a separate, unrelated field) keeps its own
  // existing labels untouched.
  assert.match(planSource, /Biggest Opportunity/);
  assert.match(planSource, /Biggest Risk/);
  assert.match(planSource, /First 90 Days/);
  assert.match(planSource, /Critical KPIs/);
  assert.match(planSource, /Final Recommendation/);

  // Market Intelligence's own entry-recommendation block keeps its
  // Should-Enter/Why/Where/When/How shape instead of inheriting CEO
  // Summary's First 90 Days / Critical KPIs / Final Recommendation labels.
  assert.match(presentationSource, /Should this market be entered/);
  assert.match(presentationSource, /Why:/);
  assert.match(presentationSource, /Where:/);
  assert.match(presentationSource, /When:/);
  assert.match(presentationSource, /How:/);
});
