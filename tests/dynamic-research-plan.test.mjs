import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createDynamicResearchPlanFallback,
  dynamicResearchPlanSchema,
  dynamicResearchPlanToDecisionTasks,
  filterMarketOnlyForbiddenTasks,
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
    undefined
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

test("a public market research question with no uploaded company data never requires company-specific financial evidence", () => {
  const context = makeContext(
    "What are the top 10 AI accounting software platforms in the United States?",
    "market"
  );
  const fields = context.researchPlan.tasks.map((task) => task.evidenceField);

  assert.doesNotMatch(fields.join(" "), /company_financials|industry_benchmarks|macro_inputs/);
  assert.ok(fields.includes("vendor_discovery"));
  assert.ok(fields.includes("competitors"));
  assert.ok(fields.includes("market_demand"));
  assert.ok(
    context.researchPlan.tasks.every((task) =>
      task.evidenceField !== "company_financials" ? true : !task.required
    )
  );
});

test("the same public market question still resolves to Market Intelligence even if the domain classifier tags it finance/accounting", () => {
  // detectDecisionDomain/classifyReportDomain classify this exact prompt as
  // "accounting" purely from the word "accounting" -- this reproduces that
  // forced classification to prove the market-intent keyword check (not
  // domain precedence) is what protects public market questions.
  const prompt = "What are the top 10 AI accounting software platforms in the United States?";
  const expertiseProfile = createExpertiseProfileFallback({
    prompt,
    selectedMode: "market",
    assets: [],
    detectedDomain: "accounting",
  });
  const reportPlan = createDynamicReportPlanFallback({
    expertiseProfile,
    selectedMode: "market",
    prompt,
  });
  const researchPlan = createDynamicResearchPlanFallback({
    expertiseProfile,
    reportPlan,
    selectedMode: "market",
    prompt,
  });
  const fields = researchPlan.tasks.map((task) => task.evidenceField);

  assert.doesNotMatch(fields.join(" "), /company_financials|industry_benchmarks|macro_inputs/);
  assert.ok(fields.includes("vendor_discovery"));
  assert.ok(fields.includes("competitors"));
});

test("filterMarketOnlyForbiddenTasks strips company-specific fields only under market mode", () => {
  const tasks = [
    { field: "company_financials" },
    { field: "industry_benchmarks" },
    { field: "macro_inputs" },
    { field: "vendor_discovery" },
    { field: "competitors" },
  ];

  const filteredForMarket = filterMarketOnlyForbiddenTasks(tasks, "market");
  assert.deepEqual(
    filteredForMarket.map((task) => task.field),
    ["vendor_discovery", "competitors"]
  );

  const untouchedForPlan = filterMarketOnlyForbiddenTasks(tasks, "plan");
  assert.deepEqual(untouchedForPlan, tasks);

  const untouchedForChat = filterMarketOnlyForbiddenTasks(tasks, "chat");
  assert.deepEqual(untouchedForChat, tasks);

  const untouchedForUndefined = filterMarketOnlyForbiddenTasks(
    tasks,
    undefined
  );
  assert.deepEqual(untouchedForUndefined, tasks);
});

test("filterMarketOnlyForbiddenTasks strips forbidden fields even when they originate from a validated AI-generated plan under market mode", () => {
  // This reproduces the exact bypass mechanism that caused the reported
  // regression: resolveDynamicResearchPlan() trusts a validated
  // AI-generated `value` whenever its domain/subdomain/taskType/selectedMode
  // match the expertise profile, regardless of which evidence fields the
  // model chose to include. filterMarketOnlyForbiddenTasks() is applied
  // after that resolution, at the single convergence point in
  // domain-research.ts, so it protects market reports even when the
  // forbidden fields come from a "trusted" AI plan rather than the
  // deterministic fallback.
  const expertiseProfile = createExpertiseProfileFallback({
    prompt: "What are the top 10 AI accounting software platforms in the United States?",
    selectedMode: "market",
    assets: [],
    detectedDomain: "finance",
  });
  const reportPlan = createDynamicReportPlanFallback({
    expertiseProfile,
    selectedMode: "market",
    prompt: "What are the top 10 AI accounting software platforms in the United States?",
  });
  const fallback = createDynamicResearchPlanFallback({
    expertiseProfile,
    reportPlan,
    selectedMode: "market",
    prompt: "What are the top 10 AI accounting software platforms in the United States?",
  });
  const aiGeneratedValue = {
    domain: fallback.domain,
    subdomain: fallback.subdomain,
    taskType: fallback.taskType,
    selectedMode: fallback.selectedMode,
    skippedTopics: fallback.skippedTopics,
    confidence: fallback.confidence,
    tasks: [
      {
        id: "market_vendor_discovery_ai",
        topic: fallback.tasks[0].topic,
        purpose: fallback.tasks[0].purpose,
        evidenceField: fallback.tasks[0].evidenceField,
        reportSectionId: fallback.tasks[0].reportSectionId,
        decisionCriterion: fallback.tasks[0].decisionCriterion,
        queries: fallback.tasks[0].queries,
        preferredSourceTypes: fallback.tasks[0].preferredSourceTypes,
        required: fallback.tasks[0].required,
        priority: fallback.tasks[0].priority,
        jurisdiction: fallback.tasks[0].jurisdiction,
      },
      {
        id: "finance_company_financials",
        topic: "Company financials",
        purpose: "Assess reported revenue and margins.",
        evidenceField: "company_financials",
        reportSectionId: fallback.tasks[0].reportSectionId,
        decisionCriterion: fallback.tasks[0].decisionCriterion,
        queries: ["company financials"],
        preferredSourceTypes: ["audited_statement"],
        required: true,
        priority: "critical",
        jurisdiction: "",
      },
    ],
  };
  const resolved = resolveDynamicResearchPlan({
    value: aiGeneratedValue,
    fallback,
    expertiseProfile,
    reportPlan,
    selectedMode: "market",
  });

  assert.ok(
    resolved.tasks.some((task) => task.evidenceField === "company_financials"),
    "resolveDynamicResearchPlan should trust the validated AI-generated task before the safety-net filter runs"
  );

  const decisionTasks = dynamicResearchPlanToDecisionTasks(resolved);
  const filtered = filterMarketOnlyForbiddenTasks(decisionTasks, "market");

  assert.doesNotMatch(
    filtered.map((task) => task.field).join(" "),
    /company_financials|industry_benchmarks|macro_inputs/
  );
});

test("domain-research.ts applies filterMarketOnlyForbiddenTasks to the final merged task list", () => {
  assert.match(
    researchSource,
    /filterMarketOnlyForbiddenTasks\(\s*\n?\s*dynamicResearchPlanToDecisionTasks\(dynamicResearchPlan\),\s*\n?\s*selectedMode/
  );
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
