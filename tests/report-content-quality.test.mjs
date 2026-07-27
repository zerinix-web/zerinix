import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  auditExecutiveReportContent,
  dedupeReportParagraphsAcrossSections,
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
  const planRoute = readFileSync("app/api/plan/route.ts", "utf8");
  const marketRoute = readFileSync("app/api/market-analysis/route.ts", "utf8");

  assert.match(directives, /Decision Spine/);
  assert.match(directives, /SWOT, Porter, and Risks mutually exclusive/);
  assert.match(directives, /Executive Summary states the verdict and evidence gap/);
  assert.match(directives, /Never reuse a complete narrative paragraph/);
  assert.match(planPrompts, /responsible actor, target customer or operating object/);
  assert.match(marketPrompts, /responsible actor, beachhead customer or channel/);
  assert.match(planRoute, /dedupeReportParagraphsAcrossSections\(normalized\)/);
  assert.match(marketRoute, /dedupeReportParagraphsAcrossSections\(normalized\)/);
});
