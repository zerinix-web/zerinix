import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createExpertiseProfileFallback,
  expertiseProfileSchema,
  formatExpertiseProfileForReportContext,
  normalizeSelectedAnalysisMode,
  resolveExpertiseProfile,
} from "../app/lib/ai/expertise-profile.ts";
import {
  createUnderstandingFallback,
  createUniversalReportReadiness,
  enforceUnderstandingPolicy,
  universalUnderstandingSchema,
} from "../app/lib/ai/understanding.ts";

const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);
const executorSource = await readFile(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);

test("California employment dispute resolves the focused legal expertise", () => {
  const profile = createExpertiseProfileFallback({
    prompt:
      "I worked for a software company in California for four years. I was terminated after reporting unpaid overtime. I was classified as exempt and regularly worked 55–65 hours per week.",
    selectedMode: "chat",
  });

  assert.equal(profile.domain, "legal");
  assert.equal(profile.subdomain, "employment_law");
  assert.equal(profile.taskType, "wage_and_retaliation_assessment");
  assert.equal(profile.jurisdiction, "California, United States");
  assert.equal(profile.professionalPerspective, "employment attorney");
  assert.match(profile.requiredAnalyses.join(" "), /overtime/i);
  assert.match(profile.requiredAnalyses.join(" "), /retaliation/i);
  assert.match(profile.forbiddenTopics.join(" "), /CAC/);
});

test("property evidence resolves real-estate acquisition due diligence", () => {
  const profile = createExpertiseProfileFallback({
    prompt: "Bu arsaya yatırım yapmak istiyorum",
    assets: [
      {
        name: "tapu-parsel.png",
        mimeType: "image/png",
        textContent:
          "Hatay Defne Dursunlu 1517 Ada 1 Parsel Ağaçlı Tarla 6.364,62 m²",
      },
    ],
    selectedMode: "plan",
  });

  assert.equal(profile.domain, "real_estate");
  assert.equal(profile.subdomain, "investment_due_diligence");
  assert.equal(profile.taskType, "acquisition_assessment");
  assert.match(profile.requiredAnalyses.join(" "), /title verification/i);
  assert.match(profile.requiredAnalyses.join(" "), /zoning/i);
  assert.match(profile.forbiddenTopics.join(" "), /SaaS metrics/i);
});

test("financial statement resolves financial-health analysis", () => {
  const profile = createExpertiseProfileFallback({
    prompt: "Analyze the attached financial statements and financial health.",
    assets: [
      {
        name: "financial-statements.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        textContent: "Balance Sheet Income Statement Cash Flow",
      },
    ],
    selectedMode: "market",
  });

  assert.equal(profile.domain, "finance");
  assert.equal(profile.subdomain, "financial_health");
  assert.equal(profile.taskType, "financial_statement_analysis");
  assert.match(profile.requiredAnalyses.join(" "), /cash flow/i);
  assert.match(profile.requiredAnalyses.join(" "), /leverage/i);
});

test("retail spreadsheet resolves branch and product performance", () => {
  const profile = createExpertiseProfileFallback({
    prompt:
      "Analyze retail branch sales, product profitability and inventory turnover.",
    assets: [
      {
        name: "retail-sales.csv",
        mimeType: "text/csv",
        textContent: "Branch,SKU,Sales,Cost,Inventory",
      },
    ],
    selectedMode: "market",
  });

  assert.equal(profile.domain, "retail");
  assert.equal(profile.subdomain, "sales_and_inventory");
  assert.equal(profile.taskType, "branch_and_product_performance");
  assert.match(profile.requiredAnalyses.join(" "), /branch performance/i);
  assert.match(profile.requiredAnalyses.join(" "), /stock turnover/i);
});

test("selected top-level mode remains authoritative", () => {
  const selectedMode = normalizeSelectedAnalysisMode("market");
  const profile = createExpertiseProfileFallback({
    prompt: "Review this California employment dispute.",
    selectedMode,
  });
  const context = formatExpertiseProfileForReportContext(profile, selectedMode);

  assert.equal(selectedMode, "market");
  assert.match(context, /Authoritative user-selected mode: Market Intelligence/);
  assert.match(context, /Do not switch it/);
  assert.match(planRouteSource, /\.\.\.body,/);
  assert.match(executorSource, /normalizeSelectedAnalysisMode\(body\?\.analysisMode\)/);
});

test("invalid model JSON uses a schema-valid conservative fallback", () => {
  const fallback = createExpertiseProfileFallback({
    prompt: "Review this California employment dispute.",
    selectedMode: "chat",
  });
  const resolved = resolveExpertiseProfile(
    { domain: "legal", confidence: 4 },
    fallback
  );
  const understandingFallback = createUnderstandingFallback({
    prompt: "Review this California employment dispute.",
    selectedMode: "chat",
  });
  const understanding = enforceUnderstandingPolicy(
    {
      ...understandingFallback,
      expertiseProfile: { domain: "legal", confidence: 4 },
    },
    understandingFallback
  );

  assert.deepEqual(resolved, fallback);
  assert.deepEqual(understanding, understandingFallback);
  assert.equal(expertiseProfileSchema.safeParse(resolved).success, true);
});

test("existing report readiness remains valid and internal profile JSON is not visible", () => {
  const understanding = createUnderstandingFallback({
    prompt: "Hatay Defne'deki bu parsele yatırım yapmak istiyorum",
    assets: [
      {
        name: "parcel.png",
        size: 2_048,
        mimeType: "image/png",
        textContent: "Hatay Defne Dursunlu 1517 Ada 1 Parsel",
      },
    ],
    selectedMode: "plan",
  });
  const readiness = createUniversalReportReadiness(understanding, {});
  const visibleUnderstandingText = [
    understanding.detectedIntent,
    ...understanding.suggestedReportTypes,
    ...understanding.clarificationQuestions.map((item) => item.question),
  ].join("\n");
  const privateContext = formatExpertiseProfileForReportContext(
    understanding.expertiseProfile,
    "plan"
  );

  assert.equal(universalUnderstandingSchema.safeParse(understanding).success, true);
  assert.ok(readiness);
  assert.deepEqual(readiness.expertiseProfile, understanding.expertiseProfile);
  assert.doesNotMatch(visibleUnderstandingText, /expertiseProfile|taskType|forbiddenTopics/);
  assert.doesNotMatch(privateContext, /\{\s*"domain"/);
});
