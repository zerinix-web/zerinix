import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyAiTask,
  estimateModelRoutingCost,
  routeAiModel,
} from "../app/lib/ai/model-router-core.ts";

const models = {
  FAST: "gpt-5-nano",
  BALANCED: "gpt-5-mini",
  HIGH_QUALITY: "gpt-5.5",
};

test("lightweight prompts are classified automatically", () => {
  assert.equal(classifyAiTask("Hello"), "greeting");
  assert.equal(classifyAiTask("Rename this report"), "rename");
  assert.equal(classifyAiTask("Summarize these notes"), "summarization");
  assert.equal(classifyAiTask("Translate this into Turkish"), "translation");
  assert.equal(classifyAiTask("Format this as a table"), "formatting");
});

test("high-value reasoning never leaves its current premium model", () => {
  for (const category of [
    "research",
    "report_generation",
    "strategic_advisory",
    "market_intelligence",
    "business_planning",
    "decision_intelligence",
  ]) {
    const decision = routeAiModel({
      category,
      previousModel: "gpt-5.5",
      models,
    });
    assert.equal(decision.routedModel, "gpt-5.5");
    assert.equal(decision.modelChanged, false);
    assert.equal(decision.qualityProtected, true);
  }
});

test("bounded extraction downgrades from premium to balanced", () => {
  const decision = routeAiModel({
    category: "extraction",
    previousModel: "gpt-5.5",
    models,
  });
  assert.equal(decision.routedModel, "gpt-5-mini");
  assert.equal(decision.modelChanged, true);
});

test("routing never upgrades an already cheaper model", () => {
  const decision = routeAiModel({
    category: "summarization",
    previousModel: "gpt-5-nano",
    models,
  });
  assert.equal(decision.routedModel, "gpt-5-nano");
  assert.equal(decision.modelChanged, false);
});

test("cost report includes before after and monthly savings", () => {
  const cost = estimateModelRoutingCost({
    previousModel: "gpt-5.5",
    routedModel: "gpt-5-mini",
    inputTokens: 4_000,
    outputTokens: 1_000,
    monthlyRequests: 1_000,
  });
  assert.deepEqual(cost, {
    estimatedRequestCostBefore: 0.05,
    estimatedRequestCostAfter: 0.003,
    estimatedRequestSavings: 0.047,
    estimatedMonthlySavings: 47,
  });
});

test("all ten OpenAI calls are covered by centralized routing", () => {
  const rateLimit = readFileSync("app/lib/ai/rate-limit.ts", "utf8");
  const directSites = [
    "app/api/understanding/route.ts",
    "app/admin/actions.ts",
    "app/lib/ai/domain-research.ts",
    "app/lib/ai/research-entity-extraction.ts",
  ].map((file) => readFileSync(file, "utf8"));
  const providerSources = [
    "app/api/chat/route.ts",
    "app/api/market-analysis/route.ts",
    "app/lib/report-jobs/plan-executor.ts",
    ...[
      "app/api/understanding/route.ts",
      "app/admin/actions.ts",
      "app/lib/ai/domain-research.ts",
      "app/lib/ai/research-entity-extraction.ts",
    ],
  ].map((file) => readFileSync(file, "utf8"));
  const callCount = providerSources.reduce(
    (count, source) => count + (source.match(/\.responses\.create\(/g) || []).length,
    0
  );

  assert.equal(callCount, 10);
  assert.match(rateLimit, /resolveAiModelRoutingDecision/);
  for (const source of directSites) {
    assert.match(source, /resolveAiModelRoutingDecision/);
    assert.match(source, /routedModel/);
  }
});
