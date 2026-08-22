import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL SCORING ENGINE FIX -- propagate lifecycle awareness into
// evidence, KPI, and scoring systems.
//
// Follow-up to company-lifecycle-scoring-fixes.test.mjs: lifecycle
// detection itself was already correct, but three real, live-tested
// downstream gaps remained:
//   1. Evidence Confidence's lifecycle boost was dampened (* 0.7), so a
//      $4M+ ARR, paying-enterprise-customer company still read as barely
//      distinguishable from a pre-revenue idea (34% vs 49%).
//   2. Business Model Quality / Evidence Confidence / Validation
//      Confidence / Founder Readiness could show CONFLICTING values
//      across report sections: applyMarketResearchCoverageToContext
//      (market-research-coverage.ts) overwrote the founderScore
//      reasoning block with unrelated external-research-coverage
//      dimensions instead of preserving the already-lifecycle-aware
//      original values.
//   3. The KPI Dashboard and recommendation text could still leak
//      pre-revenue validation language ("validate demand", "find first
//      customers") for a company that already has verified revenue.

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

const { createFinancialModel } = await importFinancialModel();
const { createInvestmentScore, refreshInvestmentNarrativeFromResearchCoverage } =
  await importInvestmentScore();
// market-research-coverage.ts is type-only-imported by every real
// dependency, so it can be imported directly with no path rewriting.
const { applyMarketResearchCoverageToContext } = await import(
  "../app/lib/ai/market-research-coverage.ts"
);
const { runConsistencyValidationPass } = await import(
  "../app/lib/report-consistency-validation.ts"
);

const scenarioPrompts = {
  idea: "I want to build an AI-powered scheduling platform. This is just an idea I want to validate. No product, no customers, no revenue yet.",
  pilot: "We have a working MVP and are running pilots with 3 design partners, no paid contracts yet.",
  revenue50kMrr: "We are a B2B SaaS company. We currently have $50,000 MRR.",
  enterpriseArr: "Enterprise software company with 37 paying enterprise customers and $4.8M ARR, production stage, 82% gross margin.",
  internationalExpansion: "We have $2M ARR and 15 enterprise customers, and are planning international expansion into new markets.",
};

function scoreFor(prompt) {
  const model = createFinancialModel({ prompt, reportKind: "business_plan" });
  return { model, score: createInvestmentScore({ prompt, financialModel: model }) };
}

// --- Requirement 1: Evidence Confidence must clearly separate a mature, --
// --- revenue/growth-stage company from a pre-revenue one.               --

test("Evidence Confidence (teamFounder reasoning) for a $4.8M ARR, paying-enterprise-customer company is meaningfully higher than a pre-revenue idea, not just marginally", () => {
  const readEvidenceConfidence = (score) => {
    const line = score.categories.teamFounder.reasoning.find((entry) => entry.startsWith("Evidence confidence:"));
    return Number(line?.match(/(\d+)%/)?.[1] ?? 0);
  };

  const idea = scoreFor(scenarioPrompts.idea).score;
  const enterprise = scoreFor(scenarioPrompts.enterpriseArr).score;

  const ideaConfidence = readEvidenceConfidence(idea);
  const enterpriseConfidence = readEvidenceConfidence(enterprise);

  assert.ok(
    enterpriseConfidence - ideaConfidence >= 15,
    `expected at least a 15-point Evidence Confidence gap between idea (${ideaConfidence}%) and a $4.8M ARR company (${enterpriseConfidence}%), got a ${enterpriseConfidence - ideaConfidence}-point gap`
  );
});

test("Evidence Confidence strictly increases across idea -> pilot -> revenue -> growth for otherwise-equivalent evidence signals", () => {
  const readEvidenceConfidence = (prompt) => {
    const { score } = scoreFor(prompt);
    const line = score.categories.teamFounder.reasoning.find((entry) => entry.startsWith("Evidence confidence:"));
    return Number(line?.match(/(\d+)%/)?.[1] ?? 0);
  };

  const idea = readEvidenceConfidence(scenarioPrompts.idea);
  const pilot = readEvidenceConfidence(scenarioPrompts.pilot);
  const revenue = readEvidenceConfidence(scenarioPrompts.revenue50kMrr);
  const growth = readEvidenceConfidence(scenarioPrompts.enterpriseArr);

  assert.ok(pilot >= idea, `pilot (${pilot}%) should be >= idea (${idea}%)`);
  assert.ok(revenue > pilot, `revenue (${revenue}%) should exceed pilot (${pilot}%)`);
  assert.ok(growth > revenue, `growth (${growth}%) should exceed revenue (${revenue}%)`);
});

test("investment-score.ts's founderEvidenceScore applies the full lifecycle boost weight, not a dampened fraction (drift check)", () => {
  const source = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");
  const fnMatch = /const founderEvidenceScore = clamp\(\s*\n?\s*([^;]+);/.exec(source);
  assert.ok(fnMatch, "founderEvidenceScore computation not found");
  assert.doesNotMatch(fnMatch[1], /lifecycleConfidenceBoost\(lifecycleStage\)\s*\*\s*0\.\d/, "founderEvidenceScore still dampens the lifecycle boost");
  assert.match(fnMatch[1], /lifecycleConfidenceBoost\(lifecycleStage\)/);
});

// --- Requirement 3: one canonical score source -- Business Model        --
// --- Quality, Evidence Confidence, Market Attractiveness, Validation    --
// --- Confidence, and Founder Readiness must never diverge across        --
// --- sections, including after market-research-coverage rescoring.     --

function readFounderMetric(reasoning, label) {
  const line = reasoning.find((entry) => entry.startsWith(`${label}:`));
  return line?.match(/(\d+)%/)?.[1] ?? null;
}

test("applyMarketResearchCoverageToContext + refreshInvestmentNarrativeFromResearchCoverage never overwrite Business Model Quality, Validation Confidence, Execution Complexity, or Evidence Confidence with an unrelated research-coverage value", () => {
  const { model, score } = scoreFor(scenarioPrompts.enterpriseArr);
  const originalReasoning = score.categories.teamFounder.reasoning;
  const originalValues = {
    businessModelQuality: readFounderMetric(originalReasoning, "Business model quality"),
    validationConfidence: readFounderMetric(originalReasoning, "Validation confidence"),
    executionComplexity: readFounderMetric(originalReasoning, "Execution complexity"),
    evidenceConfidence: readFounderMetric(originalReasoning, "Evidence confidence"),
  };

  for (const [label, value] of Object.entries(originalValues)) {
    assert.ok(value !== null, `expected an original ${label} value to be present`);
  }

  const context = { ...model, investmentScore: score, reportIntelligence: {} };
  const { context: appliedContext } = applyMarketResearchCoverageToContext(
    context,
    { evidence: [] },
    scenarioPrompts.enterpriseArr
  );
  const refreshed = refreshInvestmentNarrativeFromResearchCoverage(
    appliedContext.investmentScore,
    appliedContext
  );

  const decisionEngineReasoning = appliedContext.investmentScore.decisionEngine.founderScore.reasoning;
  const categoryReasoning = refreshed.categories.teamFounder.reasoning;

  // Single canonical source: the re-synced category must read back exactly
  // what decisionEngine now holds -- never a second, independently
  // computed value.
  assert.deepEqual(categoryReasoning, decisionEngineReasoning);

  assert.equal(readFounderMetric(decisionEngineReasoning, "Business model quality"), originalValues.businessModelQuality);
  assert.equal(readFounderMetric(decisionEngineReasoning, "Validation confidence"), originalValues.validationConfidence);
  assert.equal(readFounderMetric(decisionEngineReasoning, "Execution complexity"), originalValues.executionComplexity);
  assert.equal(readFounderMetric(decisionEngineReasoning, "Evidence confidence"), originalValues.evidenceConfidence);
});

test("Founder Readiness (teamFounder category score) is identical whether read before or after the market-research-coverage refresh, for a research bundle with zero external evidence", () => {
  const { model, score } = scoreFor(scenarioPrompts.revenue50kMrr);
  const context = { ...model, investmentScore: score, reportIntelligence: {} };
  const { context: appliedContext } = applyMarketResearchCoverageToContext(
    context,
    { evidence: [] },
    scenarioPrompts.revenue50kMrr
  );
  const refreshed = refreshInvestmentNarrativeFromResearchCoverage(
    appliedContext.investmentScore,
    appliedContext
  );

  // decisionEngine.founderScore.score is now itself derived purely from
  // founderReadiness (an evidence-blended value), so the re-synced
  // category score must track it 1:1 -- never a stale, independently
  // computed number.
  const expectedCategoryScore = Math.round(
    (appliedContext.investmentScore.decisionEngine.founderScore.score / 100) * 10
  );
  assert.equal(refreshed.categories.teamFounder.score, expectedCategoryScore);
});

// --- Requirement 2: KPI Dashboard adapts to lifecycle stage, uses      --
// --- "Not provided" instead of "Not yet measured" for revenue-stage    --
// --- KPIs without live data.                                           --

const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

test("buildRevenueStageKpiDashboard includes ARR growth, MRR growth, Net Revenue Retention, Gross Retention, Expansion Revenue, Customer Expansion, Sales Efficiency, CAC Payback, and Enterprise Pipeline", () => {
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

test("revenue-stage KPI rows without live data say 'Not provided', never 'Not yet measured' or 'Not yet reported'", () => {
  const fnStart = planExecutorSource.indexOf("function buildRevenueStageKpiDashboard(");
  const fnEnd = planExecutorSource.indexOf("\nfunction ", fnStart + 10);
  const fnBody = planExecutorSource.slice(fnStart, fnEnd);

  assert.doesNotMatch(fnBody, /Not yet measured|Not yet reported|Henüz ölçülmedi|Henüz raporlanmadı/);
  assert.match(fnBody, /Not provided/);
  assert.match(fnBody, /Sağlanmadı/);
});

test("validation-stage KPI Dashboard (idea/mvp) keeps 'Validate demand'-equivalent framing: Acquisition, WTP (willingness to pay), and pending-validation language, unaffected by the revenue-stage rewrite", () => {
  const fnStart = planExecutorSource.indexOf("function buildValidationStageKpiDashboard(");
  const fnEnd = planExecutorSource.indexOf("\nfunction ", fnStart + 10);
  const fnBody = planExecutorSource.slice(fnStart, fnEnd);

  assert.match(fnBody, /validate willingness to pay with signed pilots or paid commitments/i);
  assert.match(fnBody, /Pending validation/);
});

// --- Requirement 4: lifecycle-aware recommendations -- mature companies -
// --- get retention/expansion/CAC-efficiency/distribution/margin        --
// --- language, never validate-demand/find-first-customers language.    --

test("createNextCriticalAction (investment-score.ts) uses the exact requested replacement vocabulary for revenue/growth-stage companies", () => {
  const revenue = scoreFor(scenarioPrompts.revenue50kMrr).score;
  const growth = scoreFor(scenarioPrompts.internationalExpansion).score;

  assert.match(revenue.nextCriticalAction.toLowerCase(), /improve retention|expand enterprise accounts|optimize cac efficiency/);
  assert.match(growth.nextCriticalAction.toLowerCase(), /scale distribution|protecting margins|expanding enterprise accounts|optimize cac efficiency/);

  for (const action of [revenue.nextCriticalAction, growth.nextCriticalAction]) {
    assert.doesNotMatch(action.toLowerCase(), /validate demand|validate.*willingness to pay|find.*first customers?|get.*first customers?/);
  }
});

test("idea-stage createNextCriticalAction still legitimately uses validation language (no over-correction)", () => {
  const idea = scoreFor(scenarioPrompts.idea).score;
  assert.doesNotMatch(idea.nextCriticalAction.toLowerCase(), /improve retention|expand enterprise accounts|optimize cac efficiency|scale distribution|protecting margins/);
});

test("report-quality-directives.ts's lifecycle directive names all 5 canonical replacement phrases (drift check)", () => {
  const source = readFileSync(join(repoRoot, "app/lib/ai/report-quality-directives.ts"), "utf8");
  const directive = /"Match every recommendation to the company's detected lifecycle stage[\s\S]*?",/.exec(source)?.[0] ?? "";
  for (const phrase of ["improve retention", "expand enterprise accounts", "optimize CAC efficiency", "scale distribution", "protect margins"]) {
    assert.ok(directive.includes(phrase), `directive missing phrase: ${phrase}`);
  }
});

// --- Requirement 4 (deterministic backstop): report-consistency-        --
// --- validation.ts corrects any leftover validation-stage phrase for a --
// --- revenue/growth-stage company, in any freeform AI-generated field. --

test("resolveLifecycleRecommendationMismatches corrects 'validate willingness to pay' and 'find first customers' to canonical revenue-stage language when lifecycleStage is 'revenue'", () => {
  const sections = {
    risks: "The biggest risk is that we still need to validate willingness to pay before scaling spend.",
    swotAnalysis: "Weaknesses: the team must find first customers in the new segment.",
  };

  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    lifecycleStage: "revenue",
  });

  assert.doesNotMatch(sections.risks, /validate willingness to pay/i);
  assert.match(sections.risks, /improve retention and expand enterprise accounts/i);
  assert.doesNotMatch(sections.swotAnalysis, /find first customers/i);
  assert.match(sections.swotAnalysis, /expand enterprise accounts/i);
  assert.ok(result.correctionsApplied.some((c) => c.type === "lifecycle_recommendation_mismatch"));
});

test("resolveLifecycleRecommendationMismatches never touches idea/mvp/pilot-stage sections (no over-correction)", () => {
  for (const stage of [undefined, "idea", "mvp", "pilot"]) {
    const sections = {
      risks: "The biggest risk is that we still need to validate willingness to pay before scaling spend.",
    };
    const before = sections.risks;

    const result = runConsistencyValidationPass({
      sections,
      fields: Object.keys(sections),
      language: "English",
      lifecycleStage: stage,
    });

    assert.equal(sections.risks, before, `stage ${stage} should not trigger a correction`);
    assert.ok(!result.correctionsApplied.some((c) => c.type === "lifecycle_recommendation_mismatch"));
  }
});

test("plan-executor.ts passes context.inputs.lifecycleStage into runConsistencyValidationPass (drift check)", () => {
  assert.match(planExecutorSource, /lifecycleStage:\s*context\.inputs\.lifecycleStage,?\s*\n\s*\}\);/);
});

// --- Requirement 5: regression coverage for the 5 named scenarios ------

test("the 5 named regression scenarios each produce a distinct overall investment score confidence", () => {
  const confidences = Object.fromEntries(
    Object.entries(scenarioPrompts).map(([name, prompt]) => [name, scoreFor(prompt).score.confidence])
  );

  assert.ok(
    new Set(Object.values(confidences)).size > 1,
    `expected varying confidence across scenarios, got: ${JSON.stringify(confidences)}`
  );
  assert.ok(confidences.enterpriseArr > confidences.idea, "enterprise ARR company should score above idea stage");
  assert.ok(confidences.revenue50kMrr > confidences.idea, "revenue-stage company should score above idea stage");
});

test("the 5 named regression scenarios each route to the correct KPI dashboard shape (validation-stage vs revenue-stage)", async () => {
  const { detectCompanyLifecycleStage, isRevenueOrGrowthStage } = await import(
    "../app/lib/ai/company-lifecycle.ts"
  );

  const expectations = {
    idea: false,
    pilot: false,
    revenue50kMrr: true,
    enterpriseArr: true,
    internationalExpansion: true,
  };

  for (const [name, prompt] of Object.entries(scenarioPrompts)) {
    const { model } = scoreFor(prompt);
    const stage = model.inputs.lifecycleStage ?? detectCompanyLifecycleStage(prompt, { mrr: null, arr: null, customers: null });
    assert.equal(
      isRevenueOrGrowthStage(stage),
      expectations[name],
      `${name} (detected stage: ${stage}) should route to ${expectations[name] ? "revenue-stage" : "validation-stage"} KPI dashboard`
    );
  }
});
