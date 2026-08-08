import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  auditExecutiveReportContent,
  dedupeReportParagraphsAcrossSections,
  measureReportTokenReduction,
} from "../app/lib/report-content-quality.mjs";

const planFields = [
  "executiveSummary",
  "problem",
  "solution",
  "targetCustomer",
  "marketOpportunity",
  "competitorLandscape",
  "businessModel",
  "tamSamSom",
  "swotAnalysis",
  "portersFiveForces",
  "pricingStrategy",
  "goToMarketPlan",
  "salesStrategy",
  "unitEconomics",
  "financialDashboard",
  "scenarioAnalysis",
  "kpiDashboard",
  "executiveRecommendation",
  "risks",
  "kpis",
  "founderRoadmap",
  "roadmap306090",
  "financialAssumptions",
  "founderScore",
  "sourcesAssumptions",
];

const industries = [
  {
    business: "LedgerPilot",
    industry: "AI accounting SaaS",
    customer: "mid-market CFO teams",
    recommendation:
      "VALIDATE LedgerPilot through paid close-automation pilots with mid-market CFO teams before expanding integrations.",
  },
  {
    business: "Anatolia Roast",
    industry: "specialty coffee D2C",
    customer: "urban subscription buyers",
    recommendation:
      "HOLD broad retail expansion until Anatolia Roast proves repeat orders and contribution margin with urban subscription buyers.",
  },
  {
    business: "VoltRoute",
    industry: "commercial EV charging",
    customer: "regional delivery fleets",
    recommendation:
      "VALIDATE VoltRoute with depot-utilization contracts from regional delivery fleets before financing additional charging sites.",
  },
  {
    business: "CareFlow",
    industry: "outpatient healthcare operations",
    customer: "independent clinic groups",
    recommendation:
      "VALIDATE CareFlow through scheduling and reimbursement pilots with independent clinic groups before scaling implementation teams.",
  },
  {
    business: "ForgeSight",
    industry: "manufacturing robotics",
    customer: "tier-two automotive suppliers",
    recommendation:
      "HOLD factory expansion until ForgeSight proves downtime reduction and payback with tier-two automotive suppliers.",
  },
];

function generateIndustryReport(fixture) {
  const duplicateParagraph =
    "The company should validate demand before scaling capital because early evidence remains incomplete and expansion would otherwise amplify execution risk without proving repeatable economics.";

  return Object.fromEntries(
    planFields.map((field) => {
      if (field === "executiveRecommendation") {
        return [
          field,
          `${fixture.recommendation}\n\nPrimary risk and capital sequencing are specific to the ${fixture.industry} buying cycle and ${fixture.customer}.`,
        ];
      }

      const ownedInsight =
        `${fixture.business} ${field} analysis focuses exclusively on the ${fixture.industry} decision owned by this section, using ${fixture.customer} as the operating reference rather than generic startup advice.`;
      const content =
        field === "problem" || field === "solution"
          ? `${ownedInsight}\n\n${duplicateParagraph}`
          : ownedInsight;

      return [field, content];
    })
  );
}

for (const fixture of industries) {
  test(`${fixture.industry} report keeps every section, removes duplicate paragraphs, and preserves business-specific recommendations`, () => {
    const generated = generateIndustryReport(fixture);
    const cleaned = dedupeReportParagraphsAcrossSections(generated);
    const audit = auditExecutiveReportContent(cleaned, planFields, [
      fixture.business,
      fixture.customer,
      fixture.industry,
    ]);

    assert.deepEqual(Object.keys(cleaned), planFields);
    assert.deepEqual(audit.missingFields, []);
    assert.deepEqual(audit.duplicateParagraphs, []);
    assert.equal(audit.recommendationMatchesBusiness, true);
  });
}

test("report generation instructions enforce a business-specific decision spine and cross-section ownership", () => {
  const directives = readFileSync("app/lib/ai/report-quality-directives.ts", "utf8");
  const planPrompts = readFileSync("app/lib/report-engine/prompts/plan.ts", "utf8");
  const marketPrompts = readFileSync("app/lib/report-engine/prompts/market.ts", "utf8");
  const planRoute = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
  const marketRoute = readFileSync("app/api/market-analysis/route.ts", "utf8");

  assert.match(directives, /Decision Spine/);
  assert.match(directives, /SWOT, Porter, and Risks mutually exclusive/);
  assert.match(directives, /Executive Summary states the verdict and evidence gap/);
  assert.match(directives, /Never reuse a complete narrative paragraph/);
  assert.match(planPrompts, /responsible actor, target customer or operating object/);
  assert.match(marketPrompts, /requested geography and forecast period/);
  assert.match(marketPrompts, /Produce a market intelligence report, never a business plan/);
  assert.match(planRoute, /dedupeReportParagraphsAcrossSections\(normalized,/);
  assert.match(marketRoute, /dedupeReportParagraphsAcrossSections\(normalized,/);
  // 2026-08-08 cost-optimization pass: the insight-ledger/token-budget
  // rule used to be independently hand-duplicated (with drifting wording)
  // in both plan.ts and market.ts; it's now a single shared constant in
  // report-quality-directives.ts, imported by both.
  assert.match(directives, /internal insight ledger/i);
  assert.match(directives, /20% fewer output tokens/i);
  assert.match(planPrompts, /insightLedgerAndTokenBudgetDirectives/);
  assert.match(marketPrompts, /insightLedgerAndTokenBudgetDirectives/);
  assert.match(planRoute, /serializeRealEstateReportChunks[\s\S]*dedupeReportParagraphsAcrossSections\(report\)/);
  assert.match(planRoute, /serializeDomainAnalysisReportChunks[\s\S]*dedupeReportParagraphsAcrossSections\(report\)/);
});

test("near-duplicate insights become concise owner references while unique analysis remains", () => {
  const report = {
    executiveSummary:
      "LedgerPilot should validate paid demand with mid-market CFO teams before scaling integration investment because repeatable conversion evidence remains incomplete.",
    problem:
      "LedgerPilot must validate paid demand among mid-market CFO teams before it scales integration investment, since repeatable conversion evidence is still incomplete.",
    solution:
      "The close-automation workflow should first target teams spending more than two days per month on reconciliation; a pilot succeeds when close time falls by 30%.",
  };

  const cleaned = dedupeReportParagraphsAcrossSections(report, {
    language: "English",
    sectionLabels: {
      executiveSummary: "Executive Summary",
      problem: "Problem",
      solution: "Solution",
    },
  });

  assert.equal(cleaned.executiveSummary, report.executiveSummary);
  assert.equal(
    cleaned.problem,
    "See the Executive Summary for the consolidated assessment."
  );
  assert.equal(cleaned.solution, report.solution);
});

test("deduplication preserves new numeric analysis and citation provenance", () => {
  const shared =
    "The regulated procurement cycle creates a twelve-month sales constraint, so the company must validate channel access before committing expansion capital.";
  const report = {
    executiveSummary: `${shared} [R1]`,
    risks: `${shared} [R2]`,
    financialDashboard:
      "The regulated procurement cycle creates a nine-month sales constraint, so the company must validate channel access before committing expansion capital.",
    sources: "[R1] Government register — https://example.gov/a\n[R2] Filing — https://example.com/b",
  };

  const cleaned = dedupeReportParagraphsAcrossSections(report);

  assert.match(cleaned.risks, /Executive Summary/);
  assert.match(cleaned.risks, /\[R2\]/);
  assert.equal(cleaned.financialDashboard, report.financialDashboard);
  assert.equal(cleaned.sources, report.sources);
});

test("repeated narrative bullets are removed without changing the remaining list", () => {
  const repeated =
    "Validate procurement access with regional hospital groups before expanding the sales team because the buying cycle is still unproven.";
  const report = {
    executiveSummary: `- ${repeated}\n- Keep the initial decision at VALIDATE until paid evidence exists.`,
    risks: `- ${repeated}\n- Monitor security-review duration as the leading implementation-risk indicator.`,
  };

  const cleaned = dedupeReportParagraphsAcrossSections(report);

  assert.doesNotMatch(cleaned.risks, /expanding the sales team/);
  assert.match(cleaned.risks, /security-review duration/);
  assert.match(cleaned.risks, /Executive Summary/);
});

test("representative repeated report is compressed by at least 20% without changing its schema", () => {
  const premise =
    "LedgerPilot should validate paid close-automation demand with mid-market CFO teams before scaling integration investment because conversion evidence and implementation economics are not yet repeatable.";
  const unique = {
    executiveSummary: "The investment verdict is VALIDATE, with expansion gated by paid-pilot evidence.",
    problem: "CFO teams lose two working days each month to fragmented reconciliation workflows.",
    solution: "The product combines close orchestration, exception review, and audit-ready evidence in one workflow.",
    risks: "The leading risk indicator is implementation time exceeding twenty business days per customer.",
    executiveRecommendation: "Approve only a bounded pilot budget and reassess after three paid deployments.",
    roadmap306090: "Within 30 days, secure three paid design partners and measure close-time reduction.",
  };
  const report = Object.fromEntries(
    Object.entries(unique).map(([field, insight]) => [field, `${premise}\n\n${insight}`])
  );
  const cleaned = dedupeReportParagraphsAcrossSections(report, {
    sectionLabels: { executiveSummary: "Executive Summary" },
  });
  const metrics = measureReportTokenReduction(report, cleaned);

  assert.deepEqual(Object.keys(cleaned), Object.keys(report));
  assert.equal(Object.values(cleaned).every(Boolean), true);
  assert.ok(
    metrics.estimatedOutputTokenReductionPercent >= 20,
    `expected >=20%, received ${metrics.estimatedOutputTokenReductionPercent}%`
  );
});
