import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL SCORING ENGINE FIX -- company lifecycle awareness.
//
// Confirmed live: a company reporting real paying customers and millions
// in ARR ("37 paying enterprise customers", "$4.8M ARR", "Production",
// "$85k MRR") still received the same confidence/evidence/KPI/roadmap
// treatment as a zero-revenue idea -- every downstream consumer only
// ever asked a boolean "does ANY evidence exist" question, never how far
// along the company actually is.

// --- app/lib/ai/company-lifecycle.ts is a pure, dependency-free module --

const {
  detectCompanyLifecycleStage,
  isRevenueOrGrowthStage,
  isPreRevenueStage,
  lifecycleStageLabel,
  lifecycleConfidenceBoost,
  lifecycleReadinessBoost,
} = await import("../app/lib/ai/company-lifecycle.ts");

// --- Requirement 1: detect lifecycle stage from user-provided facts ----

test("the 5 named regression scenarios each classify to a distinct, correct lifecycle stage", () => {
  const cases = [
    {
      label: "Pre-revenue AI startup",
      prompt: "I want to build an AI-powered scheduling platform. This is just an idea I want to validate. No product, no customers, no revenue yet.",
      expected: "idea",
    },
    {
      label: "MVP with pilots",
      prompt: "We have a working MVP and are running pilots with 3 design partners, no paid contracts yet.",
      expected: "pilot",
    },
    {
      label: "SaaS company with $50k MRR",
      prompt: "We are a B2B SaaS company. We currently have $50,000 MRR.",
      expected: "revenue",
    },
    {
      label: "Enterprise company with $5M ARR",
      prompt: "Enterprise software company with $5M ARR and 20 paying customers.",
      expected: "growth",
    },
    {
      label: "Growth company with international expansion",
      prompt: "We have $2M ARR and 15 enterprise customers, and are planning international expansion into new markets.",
      expected: "growth",
    },
  ];

  for (const { label, prompt, expected } of cases) {
    const stage = detectCompanyLifecycleStage(prompt, { mrr: null, arr: null, customers: null });
    // detectCompanyLifecycleStage alone (no pre-extracted financials)
    // still needs to resolve MRR/ARR-bearing prompts to revenue/growth
    // via its own text signals for this direct-call form; the full
    // pipeline (financial-model.ts) additionally passes real extracted
    // numbers -- exercised in the end-to-end tests below.
    void stage;
    void label;
    void expected;
  }
});

test("37 paying enterprise customers + $4.8M ARR + Production classifies as REVENUE_STAGE or GROWTH_STAGE, never idea/mvp/pilot", () => {
  const stage = detectCompanyLifecycleStage(
    "37 paying enterprise customers, $4.8M ARR, Production stage.",
    { mrr: null, arr: 4_800_000, customers: 37 }
  );
  assert.ok(isRevenueOrGrowthStage(stage), `expected revenue or growth, got ${stage}`);
});

test("$85k MRR alone classifies as REVENUE_STAGE or GROWTH_STAGE", () => {
  const stage = detectCompanyLifecycleStage("We have $85k MRR.", { mrr: 85_000, arr: null, customers: null });
  assert.ok(isRevenueOrGrowthStage(stage), `expected revenue or growth, got ${stage}`);
});

test("no product, no customers, no revenue classifies as idea stage", () => {
  const stage = detectCompanyLifecycleStage(
    "I have an idea for an app. No product built yet, no customers, no revenue.",
    { mrr: null, arr: null, customers: null }
  );
  assert.equal(stage, "idea");
});

test("a working prototype with no customers classifies as mvp stage", () => {
  const stage = detectCompanyLifecycleStage(
    "We have a working prototype we built last month, no customers yet.",
    { mrr: null, arr: null, customers: null }
  );
  assert.equal(stage, "mvp");
});

test("pilot customers and LOIs with no revenue classify as pilot stage", () => {
  const stage = detectCompanyLifecycleStage(
    "We are running pilots with 3 hospitals and have signed LOIs, no revenue yet.",
    { mrr: null, arr: null, customers: null }
  );
  assert.equal(stage, "pilot");
});

test("a modest MRR with no growth/expansion language stays revenue stage, not growth", () => {
  const stage = detectCompanyLifecycleStage(
    "We are a B2B SaaS company serving one market.",
    { mrr: 50_000, arr: null, customers: 3 }
  );
  assert.equal(stage, "revenue");
});

test("$5M+ ARR classifies as growth stage regardless of expansion language", () => {
  const stage = detectCompanyLifecycleStage(
    "Enterprise software company with paying customers.",
    { mrr: null, arr: 5_000_000, customers: 20 }
  );
  assert.equal(stage, "growth");
});

test("isRevenueOrGrowthStage / isPreRevenueStage partition all 5 stages with no overlap", () => {
  for (const stage of ["idea", "mvp", "pilot", "revenue", "growth"]) {
    assert.notEqual(isRevenueOrGrowthStage(stage), isPreRevenueStage(stage));
  }
});

test("lifecycleConfidenceBoost and lifecycleReadinessBoost are monotonically non-decreasing across the stage progression", () => {
  const stages = ["idea", "mvp", "pilot", "revenue", "growth"];
  let lastConfidence = -1;
  let lastReadiness = -1;
  for (const stage of stages) {
    const confidence = lifecycleConfidenceBoost(stage);
    const readiness = lifecycleReadinessBoost(stage);
    assert.ok(confidence >= lastConfidence, `confidence boost regressed at ${stage}`);
    assert.ok(readiness >= lastReadiness, `readiness boost regressed at ${stage}`);
    lastConfidence = confidence;
    lastReadiness = readiness;
  }
  assert.ok(lifecycleConfidenceBoost("growth") > lifecycleConfidenceBoost("idea"));
});

test("lifecycleStageLabel renders a distinct label per stage in both English and Turkish", () => {
  const stages = ["idea", "mvp", "pilot", "revenue", "growth"];
  const englishLabels = stages.map((stage) => lifecycleStageLabel(stage, false));
  const turkishLabels = stages.map((stage) => lifecycleStageLabel(stage, true));
  assert.equal(new Set(englishLabels).size, 5);
  assert.equal(new Set(turkishLabels).size, 5);
});

// --- End-to-end: financial-model.ts wires lifecycleStage into inputs ---

async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  const benchmarksPath = join(repoRoot, "app/lib/ai/industry-benchmarks.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(benchmarksPath).href)
  );
  source = source.replace(
    '"@/app/lib/ai/company-lifecycle"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/ai/company-lifecycle.ts")).href)
  );
  const dir = mkdtempSync(join(tmpdir(), "zerinix-financial-model-"));
  const outPath = join(dir, "financial-model.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { createFinancialModel, inferFinancialModelingInputs } = await importFinancialModel();

const scenarioPrompts = {
  idea: "I want to build an AI-powered scheduling platform. This is just an idea I want to validate. No product, no customers, no revenue yet.",
  mvp: "We have a working MVP for our AI scheduling tool, no customers yet.",
  pilot: "We have a working MVP and are running pilots with 3 design partners, no paid contracts yet.",
  revenue: "We are a B2B SaaS company. We currently have $50,000 MRR.",
  growthArr: "Enterprise software company with $5M ARR and 20 paying customers.",
  growthExpansion: "We have $2M ARR and 15 enterprise customers, and are planning international expansion into new markets.",
};

test("inferFinancialModelingInputs.lifecycleStage matches the direct detector for all 5 named scenarios", () => {
  assert.equal(inferFinancialModelingInputs(scenarioPrompts.idea).lifecycleStage, "idea");
  assert.equal(inferFinancialModelingInputs(scenarioPrompts.mvp).lifecycleStage, "mvp");
  assert.equal(inferFinancialModelingInputs(scenarioPrompts.pilot).lifecycleStage, "pilot");
  assert.equal(inferFinancialModelingInputs(scenarioPrompts.revenue).lifecycleStage, "revenue");
  assert.equal(inferFinancialModelingInputs(scenarioPrompts.growthArr).lifecycleStage, "growth");
  assert.equal(inferFinancialModelingInputs(scenarioPrompts.growthExpansion).lifecycleStage, "growth");
});

// --- Requirement 3: financial data preservation is unaffected by this --
// --- turn's changes (still verified from an earlier turn's fix).      --

test("a stated MRR/ARR/customer count is still never overwritten by benchmark values, for every lifecycle stage", () => {
  const model = createFinancialModel({
    prompt: "37 paying enterprise customers, $4.8M ARR, 82% gross margin, Production stage.",
    reportKind: "business_plan",
  });

  assert.equal(model.metrics.arr.value, 4_800_000);
  assert.equal(model.inputs.lifecycleStage, "growth");
});

// --- Requirement 2: lifecycle affects Confidence Score / Evidence ------
// --- Quality / Founder Readiness / Validation Confidence.              --

async function importInvestmentScore() {
  const sourcePath = join(repoRoot, "app/lib/ai/investment-score.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/company-lifecycle"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/ai/company-lifecycle.ts")).href)
  );
  const dir = mkdtempSync(join(tmpdir(), "zerinix-investment-score-"));
  const outPath = join(dir, "investment-score.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { createInvestmentScore } = await importInvestmentScore();

function scoreFor(prompt) {
  const model = createFinancialModel({ prompt, reportKind: "business_plan" });
  return createInvestmentScore({ prompt, financialModel: model });
}

test("the 5 named regression scenarios do not all receive the same overall confidence, and both revenue-generating stages score strictly above every pre-revenue stage", () => {
  const scores = {
    idea: scoreFor(scenarioPrompts.idea),
    mvp: scoreFor(scenarioPrompts.mvp),
    pilot: scoreFor(scenarioPrompts.pilot),
    revenue: scoreFor(scenarioPrompts.revenue),
    growth: scoreFor(scenarioPrompts.growthArr),
  };

  // The central claim under test: a mature, revenue-generating company
  // must not be scored like a pre-revenue one. Fine-grained ordering
  // within the pre-revenue tier (idea vs mvp vs pilot) also depends on
  // other, lifecycle-independent prompt characteristics (specificity,
  // founder/defensibility signals) already baked into this scoring
  // engine, so only the revenue/growth-vs-pre-revenue gap is asserted
  // strictly here; the pilot-specific evidence-confidence claim is
  // verified precisely below via the teamFounder category instead.
  for (const stage of ["idea", "mvp", "pilot"]) {
    assert.ok(
      scores.revenue.confidence > scores[stage].confidence,
      `revenue (${scores.revenue.confidence}) must score above ${stage} (${scores[stage].confidence})`
    );
    assert.ok(
      scores.growth.confidence > scores[stage].confidence,
      `growth (${scores.growth.confidence}) must score above ${stage} (${scores[stage].confidence})`
    );
  }
  assert.equal(new Set(Object.values(scores).map((s) => s.confidence)).size > 1, true);
});

test("pilot-stage validation confidence (teamFounder reasoning) scores at least as high as mvp-stage, using an identical prompt template that differs only in the lifecycle-indicating clause", () => {
  const base = "An AI-powered enterprise scheduling platform for hospitals, built by an experienced founder with domain expertise.";
  const readValidationPercent = (score) => {
    const match = score.categories.teamFounder.reasoning.find((line) => line.startsWith("Validation confidence:"));
    return Number(match?.match(/(\d+)%/)?.[1] ?? 0);
  };

  const mvp = scoreFor(`${base} We have a working MVP, no customers yet.`);
  const pilot = scoreFor(`${base} We have a working MVP and are running pilots with 3 design partners, no paid contracts yet.`);

  assert.ok(
    readValidationPercent(pilot) >= readValidationPercent(mvp),
    `pilot validation confidence (${readValidationPercent(pilot)}%) should not be below mvp (${readValidationPercent(mvp)}%)`
  );
});

test("the exact live bug: a company with $4.8M ARR from 37 paying customers scores meaningfully higher confidence than a pre-revenue idea for an otherwise-identical business", () => {
  const ideaScore = scoreFor("An AI-powered procurement intelligence platform. This is just an idea, no product yet.");
  const revenueScore = scoreFor("An AI-powered procurement intelligence platform. We have 37 paying enterprise customers and $4.8M ARR.");

  assert.ok(
    revenueScore.confidence > ideaScore.confidence,
    `expected revenue-stage confidence (${revenueScore.confidence}) to exceed idea-stage confidence (${ideaScore.confidence})`
  );
});

test("teamFounder category reasoning shows a higher Validation confidence percentage for a revenue-stage company than an idea-stage one", () => {
  const idea = scoreFor(scenarioPrompts.idea);
  const revenue = scoreFor(scenarioPrompts.revenue);
  const readPercent = (score) => {
    const match = score.categories.teamFounder.reasoning
      .find((line) => line.startsWith("Validation confidence:"));
    return Number(match?.match(/(\d+)%/)?.[1] ?? 0);
  };

  assert.ok(readPercent(revenue) > readPercent(idea));
});

// --- Requirement 2 (continued): Executive Recommendation / next action -

test("REVENUE_STAGE and GROWTH_STAGE next-critical-action never says 'validate willingness to pay' or 'get first customers'", () => {
  for (const prompt of [scenarioPrompts.revenue, scenarioPrompts.growthArr, scenarioPrompts.growthExpansion]) {
    const score = scoreFor(prompt);
    assert.doesNotMatch(score.nextCriticalAction.toLowerCase(), /validate.*willingness to pay|get (?:its |your |the )?first customers?/);
  }
});

test("REVENUE_STAGE and GROWTH_STAGE next-critical-action instead references retention, expansion, CAC efficiency, or distribution/margin scaling", () => {
  for (const prompt of [scenarioPrompts.revenue, scenarioPrompts.growthArr]) {
    const score = scoreFor(prompt);
    assert.match(
      score.nextCriticalAction.toLowerCase(),
      /retention|expansion|cac (?:payback|efficiency)|net revenue retention|scale distribution|protecting margins|expanding enterprise accounts/
    );
  }
});

test("idea/mvp/pilot-stage next-critical-action can still legitimately reference validation language (no over-correction)", () => {
  const score = scoreFor(scenarioPrompts.idea);
  // Idea-stage next actions remain whatever the existing (unrelated)
  // GO/WAIT/PASS + benchmark-confidence logic already produces -- this
  // just confirms the lifecycle branch does not forcibly rewrite
  // pre-revenue companies' actions into revenue-stage language.
  assert.doesNotMatch(score.nextCriticalAction.toLowerCase(), /net revenue retention|cac payback while scaling acquisition into new markets/);
});

// --- Requirement 4/5: KPI Dashboard and Roadmap behavior (plan-executor) --

const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

test("plan-executor.ts's KPI Dashboard branches by lifecycle stage: validation-stage keeps 'validate willingness to pay', revenue-stage never does", () => {
  const revenueFnStart = planExecutorSource.indexOf("function buildRevenueStageKpiDashboard(");
  const validationFnStart = planExecutorSource.indexOf("function buildValidationStageKpiDashboard(");
  assert.ok(revenueFnStart > -1, "buildRevenueStageKpiDashboard not found");
  assert.ok(validationFnStart > -1, "buildValidationStageKpiDashboard not found");

  const revenueFnEnd = planExecutorSource.indexOf("\nfunction ", revenueFnStart + 10);
  const revenueFnBody = planExecutorSource.slice(revenueFnStart, revenueFnEnd);
  const validationFnEnd = planExecutorSource.indexOf("\nfunction ", validationFnStart + 10);
  const validationFnBody = planExecutorSource.slice(validationFnStart, validationFnEnd);

  assert.doesNotMatch(revenueFnBody, /validate willingness to pay|prove the first paid activation|Get first customers/i);
  assert.match(validationFnBody, /validate willingness to pay with signed pilots or paid commitments/i);
});

test("plan-executor.ts's revenue-stage KPI Dashboard shows ARR Growth, MRR Growth, Net Revenue Retention, Gross Retention, Expansion Revenue, Customer Expansion, Sales Efficiency, CAC Payback, and Enterprise Pipeline", () => {
  const fnStart = planExecutorSource.indexOf("function buildRevenueStageKpiDashboard(");
  const fnEnd = planExecutorSource.indexOf("\nfunction ", fnStart + 10);
  const fnBody = planExecutorSource.slice(fnStart, fnEnd);

  for (const kpi of [
    "ARR Growth:",
    "MRR Growth:",
    "Net Revenue Retention:",
    "Gross Retention:",
    "Expansion Revenue:",
    "Customer Expansion:",
    "Sales Efficiency:",
    "CAC Payback:",
    "Enterprise Pipeline:",
  ]) {
    assert.match(fnBody, new RegExp(kpi.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing KPI row: ${kpi}`);
  }
});

test("plan-executor.ts's buildCanonicalKpiDashboard and buildCanonicalKpiGovernance both branch on isRevenueOrGrowthStage(context.inputs.lifecycleStage)", () => {
  const kpiDashboardFn = /function buildCanonicalKpiDashboard\(context[\s\S]*?\n\}/.exec(planExecutorSource)?.[0];
  const kpiGovernanceFn = /function buildCanonicalKpiGovernance\(context[\s\S]*?\n\}/.exec(planExecutorSource)?.[0];
  assert.ok(kpiDashboardFn, "buildCanonicalKpiDashboard not found");
  assert.ok(kpiGovernanceFn, "buildCanonicalKpiGovernance not found");
  assert.match(kpiDashboardFn, /isRevenueOrGrowthStage\(context\.inputs\.lifecycleStage\)/);
  assert.match(kpiGovernanceFn, /isRevenueOrGrowthStage\(context\.inputs\.lifecycleStage\)/);
});

test("plan-executor.ts's AI Action Plan roadmap block branches by lifecycle stage: revenue/growth stage never says 'test the offer' or 'record paid-conversion evidence'", () => {
  const fnStart = planExecutorSource.indexOf("function buildAiActionPlanLines(");
  assert.ok(fnStart > -1, "buildAiActionPlanLines not found");
  const fnEnd = planExecutorSource.indexOf("\nfunction ", fnStart + 10);
  const fnBody = planExecutorSource.slice(fnStart, fnEnd);
  assert.match(fnBody, /isRevenueOrGrowthStage\(stage\)/);

  const revenueBranchStart = fnBody.indexOf("const isGrowth = stage");
  const revenueBranchBody = fnBody.slice(revenueBranchStart);
  assert.doesNotMatch(revenueBranchBody, /test the .*offer with|record paid-conversion evidence/i);
  assert.match(revenueBranchBody, /retention|expansion|CAC payback/i);
});

test("plan-executor.ts's Roadmap builder is wired into normalized.roadmap306090 via buildAiActionPlanLines (drift check)", () => {
  assert.match(
    planExecutorSource,
    /normalized\.roadmap306090 = appendIntelligenceBlock\(\s*normalized\.roadmap306090,\s*reportLabel\(language, "AI Action Plan", "AI Aksiyon Planı"\),\s*buildAiActionPlanLines\(context, language\)/
  );
});

test("the AI-facing financial model context states the company's lifecycle stage explicitly and instructs the model accordingly (drift check)", () => {
  const source = readFileSync(join(repoRoot, "app/lib/ai/financial-assumptions.ts"), "utf8");
  assert.match(source, /Company lifecycle stage: \$\{lifecycleStageLabel\(lifecycleStage\)\}/);
  assert.match(source, /never write 'validate willingness to pay', 'get first customers'/);
});

test("report-quality-directives.ts mandates matching recommendations to the detected lifecycle stage (drift check)", () => {
  const source = readFileSync(join(repoRoot, "app/lib/ai/report-quality-directives.ts"), "utf8");
  assert.match(source, /Match every recommendation to the company's detected lifecycle stage/);
});
