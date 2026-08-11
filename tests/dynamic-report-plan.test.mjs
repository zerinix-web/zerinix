import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createDynamicReportPlanFallback,
  dynamicReportPlanSchema,
  formatDynamicReportPlanForContext,
  resolveDynamicReportPlan,
} from "../app/lib/ai/dynamic-report-plan.ts";
import { createExpertiseProfileFallback } from "../app/lib/ai/expertise-profile.ts";
import {
  createUnderstandingFallback,
  createUniversalReportReadiness,
} from "../app/lib/ai/understanding.ts";

const executorSource = await readFile(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

function makePlan(prompt, selectedMode, assets = []) {
  const expertiseProfile = createExpertiseProfileFallback({
    prompt,
    selectedMode,
    assets,
  });
  return createDynamicReportPlanFallback({
    expertiseProfile,
    selectedMode,
    prompt,
  });
}

test("California employment report plan is legal-specific and excludes startup artifacts", () => {
  const plan = makePlan(
    "I worked in California and was terminated after reporting unpaid overtime while classified as exempt.",
    undefined
  );
  const sectionTitles = plan.sections.map((item) => item.title);

  assert.equal(plan.domain, "legal");
  assert.equal(plan.subdomain, "employment_law");
  assert.deepEqual(sectionTitles, [
    "Executive Legal Assessment",
    "Material Facts",
    "Claim-by-Claim Analysis",
    "Exempt Status and Misclassification",
    "Unpaid Overtime",
    "Retaliation",
    "Evidence Strength",
    "Filing and Deadline Risks",
    "Employer Defenses",
    "Settlement or Litigation Strategy",
    "Immediate Actions",
    "Final Recommendation",
    "Sources and Limitations",
  ]);
  assert.doesNotMatch(
    plan.sections.concat(plan.dashboardMetrics).map((item) => `${item.id} ${item.title || item.label}`).join(" "),
    /CAC|customer validation|capital efficiency|market size|product metrics|startup/i
  );
  assert.match(plan.forbiddenSections.join(" "), /CAC/);
});

test("property plan contains due-diligence sections and no startup or claim-analysis sections", () => {
  const plan = makePlan(
    "Bu arsaya yatırım yapmak istiyorum",
    "plan",
    [{
      name: "parcel.png",
      mimeType: "image/png",
      textContent: "Hatay Defne Dursunlu Ada 1517 Parsel 1",
    }]
  );

  assert.equal(plan.domain, "real_estate");
  assert.match(plan.sections.map((item) => item.title).join(" "), /Title and Ownership Verification/);
  assert.match(plan.sections.map((item) => item.title).join(" "), /Comparable Market Evidence/);
  assert.doesNotMatch(
    plan.sections.concat(plan.dashboardMetrics).map((item) => `${item.id} ${item.title || item.label}`).join(" "),
    /CAC|product-market fit|SaaS|claim-by-claim/i
  );
});

test("financial statement plan contains finance-specific sections", () => {
  const plan = makePlan(
    "Analyze the balance sheet, income statement, cash flow and financial health.",
    "plan",
    [{ name: "statements.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }]
  );

  assert.equal(plan.domain, "finance");
  assert.match(plan.sections.map((item) => item.title).join(" "), /Revenue Quality/);
  assert.match(plan.sections.map((item) => item.title).join(" "), /Working Capital/);
  assert.doesNotMatch(
    plan.sections.concat(plan.dashboardMetrics).map((item) => `${item.id} ${item.title || item.label}`).join(" "),
    /zoning|title verification/i
  );
});

test("retail spreadsheet plan contains retail performance sections", () => {
  const plan = makePlan(
    "Analyze retail branch sales, product margin and inventory turnover.",
    "plan",
    [{ name: "retail.csv", mimeType: "text/csv", textContent: "Branch,SKU,Sales,Cost,Inventory" }]
  );

  assert.equal(plan.domain, "retail");
  assert.match(plan.sections.map((item) => item.title).join(" "), /Branch Performance/);
  assert.match(plan.sections.map((item) => item.title).join(" "), /Inventory Turnover/);
});

test("Market Intelligence mode never selects the Real Estate template, even when domain is misclassified as real_estate", () => {
  const expertiseProfile = createExpertiseProfileFallback({
    prompt: "Türkiye'de premium otomatik araç yıkama pazarını analiz et.",
    selectedMode: "market",
    detectedDomain: "real_estate",
  });
  assert.equal(expertiseProfile.domain, "real_estate");

  const plan = createDynamicReportPlanFallback({
    expertiseProfile,
    selectedMode: "market",
    prompt: "Türkiye'de premium otomatik araç yıkama pazarını analiz et.",
  });

  assert.notEqual(plan.reportTitle, "Real Estate Investment Due-Diligence Assessment");
  assert.doesNotMatch(
    plan.sections.map((item) => `${item.id} ${item.title}`).join(" "),
    /zoning|comparables|hazards|regional development|liquidity/i
  );
});

test("authoritative selected mode is retained and mismatched model plan falls back", () => {
  const fallback = makePlan(
    "Review this California employment dispute.",
    "market"
  );
  const resolved = resolveDynamicReportPlan({
    value: { ...fallback, selectedMode: "chat" },
    fallback,
    expertiseProfile: createExpertiseProfileFallback({
      prompt: "Review this California employment dispute.",
      selectedMode: "market",
    }),
    selectedMode: "market",
  });

  assert.equal(resolved.selectedMode, "market");
  assert.deepEqual(resolved, fallback);
});

test("invalid report-plan JSON uses a schema-valid conservative fallback", () => {
  const expertiseProfile = createExpertiseProfileFallback({
    prompt: "Review this California employment dispute.",
  });
  const fallback = createDynamicReportPlanFallback({
    expertiseProfile,
    selectedMode: "chat",
  });
  const resolved = resolveDynamicReportPlan({
    value: { reportTitle: "broken", sections: [] },
    fallback,
    expertiseProfile,
    selectedMode: "chat",
  });

  assert.deepEqual(resolved, fallback);
  assert.equal(dynamicReportPlanSchema.safeParse(resolved).success, true);
});

test("compatibility validation removes cross-domain sections and arbitrary metrics", () => {
  const expertiseProfile = createExpertiseProfileFallback({
    prompt: "Review this California employment dispute.",
  });
  const fallback = createDynamicReportPlanFallback({
    expertiseProfile,
    selectedMode: "chat",
  });
  const candidate = {
    ...fallback,
    sections: [
      fallback.sections[0],
      {
        id: "customer_validation",
        title: "Customer Validation",
        purpose: "Calculate CAC and product-market fit.",
        requiredEvidenceTypes: ["external_source"],
        analysisMethod: "startup_metric_review",
        priority: "standard",
      },
    ],
    dashboardMetrics: [
      {
        id: "generic_investment_score",
        label: "Generic Investment Score",
        purpose: "Show an unsupported percentage score.",
        valueType: "qualitative",
        requiredEvidenceTypes: ["user_statement"],
      },
    ],
  };
  const resolved = resolveDynamicReportPlan({
    value: candidate,
    fallback,
    expertiseProfile,
    selectedMode: "chat",
  });

  assert.doesNotMatch(
    resolved.sections.map((item) => `${item.id} ${item.title} ${item.purpose}`).join(" "),
    /customer validation|CAC|product-market fit/i
  );
  assert.doesNotMatch(
    resolved.dashboardMetrics.map((item) => `${item.id} ${item.label}`).join(" "),
    /generic investment score/i
  );
  assert.match(resolved.dashboardMetrics.map((item) => item.label).join(" "), /Jurisdiction/);
});

test("answered and extracted facts do not create repeated clarifications", () => {
  const expertiseProfile = {
    ...createExpertiseProfileFallback({
      prompt: "Assess this parcel.",
      selectedMode: "chat",
      detectedDomain: "real_estate",
    }),
    criticalClarifications: ["What is the parcel location?", "What is the purchase price?"],
  };
  const plan = createDynamicReportPlanFallback({
    expertiseProfile,
    selectedMode: "chat",
    extractedFacts: [{ field: "location", label: "Parcel location", value: "Dursunlu" }],
    clarificationAnswers: { what_is_the_purchase_price: "Not provided" },
  });

  assert.deepEqual(plan.clarificationQuestions, []);
});

test("plan remains private while existing report readiness and generation flow stay compatible", () => {
  const understanding = createUnderstandingFallback({
    prompt: "Bu arsaya yatırım yapmak istiyorum",
    assets: [{
      name: "parcel.png",
      size: 2_048,
      mimeType: "image/png",
      textContent: "Hatay Defne Dursunlu Ada 1517 Parsel 1",
    }],
    selectedMode: "chat",
  });
  const readiness = createUniversalReportReadiness(understanding, {});
  const privateContext = formatDynamicReportPlanForContext(understanding.reportPlan);
  const visibleText = [
    understanding.detectedIntent,
    ...understanding.suggestedReportTypes,
    ...understanding.clarificationQuestions.map((item) => item.question),
  ].join("\n");

  assert.ok(readiness);
  assert.deepEqual(readiness.reportPlan, understanding.reportPlan);
  assert.doesNotMatch(visibleText, /reportPlan|decisionGates|forbiddenSections/);
  assert.doesNotMatch(privateContext, /\{\s*"reportTitle"/);
  assert.match(planRouteSource, /reportPlan,/);
  assert.match(executorSource, /formatDynamicReportPlanForContext\(reportPlan\)/);
  assert.match(executorSource, /generateRealEstateInvestmentReport/);
  assert.match(executorSource, /generateSpecializedDomainReport/);
});
