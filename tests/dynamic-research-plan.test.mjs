import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createDynamicResearchPlanFallback,
  dynamicResearchPlanSchema,
  dynamicResearchPlanToDecisionTasks,
  formatDynamicResearchPlanForContext,
  resolveDynamicResearchPlan,
} from "../app/lib/ai/dynamic-research-plan.ts";
import { createDynamicReportPlanFallback } from "../app/lib/ai/dynamic-report-plan.ts";
import { createExpertiseProfileFallback } from "../app/lib/ai/expertise-profile.ts";
import { createUnderstandingFallback } from "../app/lib/ai/understanding.ts";

const executorSource = await readFile(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const researchSource = await readFile(
  new URL("../app/lib/ai/domain-research.ts", import.meta.url),
  "utf8"
);

function makeContext(prompt, selectedMode, assets = []) {
  const expertiseProfile = createExpertiseProfileFallback({
    prompt,
    selectedMode,
    assets,
  });
  const reportPlan = createDynamicReportPlanFallback({
    expertiseProfile,
    selectedMode,
    prompt,
  });
  const researchPlan = createDynamicResearchPlanFallback({
    expertiseProfile,
    reportPlan,
    selectedMode,
    prompt,
  });
  return { expertiseProfile, reportPlan, researchPlan };
}

test("California employment case creates focused legal research tasks", () => {
  const context = makeContext(
    "I worked in California and was terminated after reporting unpaid overtime while classified as exempt.",
    "chat"
  );
  const fields = context.researchPlan.tasks.map((task) => task.evidenceField);

  assert.equal(context.researchPlan.domain, "legal");
  assert.deepEqual(fields.toSorted(), [
    "legal_overtime",
    "legal_exempt_status",
    "legal_retaliation",
    "legal_limitation_deadlines",
    "legal_evidence_preservation",
    "legal_filing_routes",
    "legal_final_pay",
    "legal_case_law",
  ].toSorted());
  assert.ok(
    context.researchPlan.tasks.every(
      (task) =>
        task.reportSectionId &&
        task.decisionCriterion &&
        task.queries.length <= 3 &&
        task.queries.every((query) => query.length <= 220)
    )
  );
  assert.doesNotMatch(
    context.researchPlan.tasks.map((task) => `${task.topic} ${task.purpose} ${task.queries.join(" ")}`).join(" "),
    /CAC|product-market fit|startup funding|market size/i
  );
});

test("property investment creates zoning hazard infrastructure and market tasks", () => {
  const assets = [{
    name: "parcel.png",
    mimeType: "image/png",
    textContent: "Hatay Defne Dursunlu Ada 1517 Parsel 1",
  }];
  const { expertiseProfile, reportPlan } = makeContext(
    "Bu arsaya yatırım yapmak istiyorum",
    "plan",
    assets
  );
  const researchPlan = createDynamicResearchPlanFallback({
    expertiseProfile,
    reportPlan,
    selectedMode: "plan",
    prompt: "Bu arsaya yatırım yapmak istiyorum",
    extractedFacts: [
      { field: "province", label: "İl", value: "Hatay" },
      { field: "district", label: "İlçe", value: "Defne" },
      { field: "neighborhood", label: "Mahalle", value: "Dursunlu" },
      { field: "block", label: "Ada", value: "1517" },
      { field: "parcel", label: "Parsel", value: "1" },
    ],
  });
  const fields = researchPlan.tasks.map((task) => task.evidenceField);

  assert.equal(researchPlan.domain, "real_estate");
  assert.ok(fields.includes("zoning"));
  assert.ok(fields.includes("hazards"));
  assert.ok(fields.includes("access"));
  assert.ok(fields.includes("comparables"));
  assert.ok(fields.includes("liquidity"));
  assert.match(researchPlan.tasks.map((task) => task.queries.join(" ")).join(" "), /Hatay|Defne|Dursunlu/);
  assert.doesNotMatch(
    researchPlan.tasks.map((task) => `${task.topic} ${task.purpose}`).join(" "),
    /SaaS|startup growth|employee retaliation/i
  );
});

test("financial statement creates finance-specific research tasks", () => {
  const context = makeContext(
    "Analyze the balance sheet, income statement, cash flow and financial health.",
    "market",
    [{ name: "statements.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }]
  );
  const fields = context.researchPlan.tasks.map((task) => task.evidenceField);

  assert.equal(context.researchPlan.domain, "finance");
  assert.deepEqual(fields, [
    "company_financials",
    "industry_benchmarks",
    "macro_inputs",
  ]);
  assert.doesNotMatch(context.researchPlan.tasks.map((task) => task.topic).join(" "), /zoning|title deed/i);
});

test("retail spreadsheet creates externally relevant demand product and inventory tasks", () => {
  const context = makeContext(
    "Analyze retail branch sales, product margin, demand and inventory turnover.",
    "market",
    [{ name: "retail.csv", mimeType: "text/csv", textContent: "Branch,SKU,Sales,Cost,Inventory" }]
  );
  const fields = context.researchPlan.tasks.map((task) => task.evidenceField);

  assert.equal(context.researchPlan.domain, "retail");
  assert.deepEqual(fields, [
    "market_demand",
    "competitors",
    "company_evidence",
    "industry_benchmarks",
  ]);
});

test("duplicate tasks and semantically identical queries are removed", () => {
  const context = makeContext(
    "Bu arsaya yatırım yapmak istiyorum",
    "plan",
    [{ name: "parcel.png", mimeType: "image/png", textContent: "Hatay Defne Dursunlu Ada 1517 Parsel 1" }]
  );
  const original = context.researchPlan.tasks[0];
  const duplicate = {
    ...original,
    id: `${original.id}_duplicate`,
    queries: [original.queries[0], original.queries[0].toUpperCase()],
  };
  const resolved = resolveDynamicResearchPlan({
    value: { ...context.researchPlan, tasks: [original, duplicate] },
    fallback: context.researchPlan,
    expertiseProfile: context.expertiseProfile,
    reportPlan: context.reportPlan,
    selectedMode: "plan",
  });

  assert.equal(resolved.tasks.length, 1);
  assert.equal(
    new Set(resolved.tasks[0].queries.map((query) => query.toLowerCase())).size,
    resolved.tasks[0].queries.length
  );
});

test("sufficient existing evidence prevents repeated research", () => {
  const context = makeContext(
    "Bu arsaya yatırım yapmak istiyorum",
    "plan",
    [{ name: "parcel.png", mimeType: "image/png", textContent: "Hatay Defne Dursunlu Ada 1517 Parsel 1" }]
  );
  const plan = createDynamicResearchPlanFallback({
    expertiseProfile: context.expertiseProfile,
    reportPlan: context.reportPlan,
    selectedMode: "plan",
    availableEvidence: [{
      field: "zoning",
      url: "https://example.gov/zoning/1517-1",
      confidence: 0.91,
      authorityLevel: "primary",
      label: "Verified from official source",
      supportedIssue: "parcel zoning",
      proposition: "The official plan record identifies the parcel zoning.",
    }],
  });

  assert.equal(plan.tasks.some((task) => task.evidenceField === "zoning"), false);
  assert.match(plan.skippedTopics.join(" "), /already_supported/);
});

test("selected mode is authoritative and invalid planner JSON uses fallback", () => {
  const context = makeContext(
    "Review this California employment dispute.",
    "market"
  );
  const mismatched = resolveDynamicResearchPlan({
    value: { ...context.researchPlan, selectedMode: "chat" },
    fallback: context.researchPlan,
    expertiseProfile: context.expertiseProfile,
    reportPlan: context.reportPlan,
    selectedMode: "market",
  });
  const invalid = resolveDynamicResearchPlan({
    value: { tasks: "invalid" },
    fallback: context.researchPlan,
    expertiseProfile: context.expertiseProfile,
    reportPlan: context.reportPlan,
    selectedMode: "market",
  });

  assert.equal(mismatched.selectedMode, "market");
  assert.deepEqual(mismatched, context.researchPlan);
  assert.deepEqual(invalid, context.researchPlan);
  assert.equal(dynamicResearchPlanSchema.safeParse(invalid).success, true);
});

test("research plan maps into the existing provider task contract", () => {
  const context = makeContext(
    "Review this California employment dispute.",
    "chat"
  );
  const tasks = dynamicResearchPlanToDecisionTasks(context.researchPlan);

  assert.equal(tasks.length, context.researchPlan.tasks.length);
  assert.ok(tasks.every((task) => task.provider === "auto"));
  assert.ok(tasks.every((task) => task.status === "skipped_with_reason"));
  assert.ok(tasks.every((task) => task.queryVariants?.length));
  assert.match(
    researchSource,
    /createDecisionResearchProviderAdapter\(webResearchProvider/
  );
  assert.match(researchSource, /executeResearchPlan\(\{/);
  assert.match(executorSource, /\.\.\.dynamicResearchPlanningInput/);
});

test("provider failure degrades safely instead of failing report generation", () => {
  assert.match(researchSource, /catch \(error\) \{[\s\S]*?recommendedOutput: "preliminary_report"/);
  assert.match(researchSource, /fallbackUsed: true/);
  assert.match(researchSource, /The same report pipeline continued without research augmentation/);
});

test("research plan remains private and existing understanding flow remains compatible", () => {
  const understanding = createUnderstandingFallback({
    prompt: "Bu arsaya yatırım yapmak istiyorum",
    assets: [{ name: "parcel.png", size: 2048, mimeType: "image/png", textContent: "Hatay Defne Dursunlu Ada 1517 Parsel 1" }],
    selectedMode: "plan",
  });
  const visibleText = [
    understanding.detectedIntent,
    ...understanding.suggestedReportTypes,
    ...understanding.clarificationQuestions.map((question) => question.question),
  ].join("\n");
  const privateContext = formatDynamicResearchPlanForContext(
    understanding.researchPlan
  );

  assert.doesNotMatch(visibleText, /researchPlan|skippedTopics|evidenceField/);
  assert.doesNotMatch(privateContext, /\{\s*"tasks"/);
  assert.match(privateContext, /Never render this block/);
});
