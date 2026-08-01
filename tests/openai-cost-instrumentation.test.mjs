import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  estimateOpenAiCostBreakdown,
  extractOpenAiTokenUsageDetails,
  summarizeOpenAiCostEvents,
} from "../app/lib/ai/cost-metrics.ts";

function read(path) {
  return readFileSync(path, "utf8");
}

function event(overrides = {}) {
  return {
    operationName: "understanding",
    model: "gpt-5-nano",
    inputTokens: 1_000,
    cachedInputTokens: 200,
    outputTokens: 100,
    reasoningTokens: 20,
    totalTokens: 1_100,
    webSearchCalls: 0,
    inputCostUsd: 0.000041,
    outputCostUsd: 0.00004,
    toolCostUsd: 0,
    totalCostUsd: 0.000081,
    durationMs: 125,
    retryCount: 0,
    cacheStatus: "provider_cached",
    duplicateFingerprint: "understanding-a",
    ...overrides,
  };
}

test("Responses API usage captures cached input and reasoning tokens", () => {
  const usage = extractOpenAiTokenUsageDetails({
    usage: {
      input_tokens: 1_200,
      output_tokens: 350,
      total_tokens: 1_550,
      input_tokens_details: { cached_tokens: 400 },
      output_tokens_details: { reasoning_tokens: 120 },
    },
    output: [{ type: "web_search_call" }, { type: "message" }],
  });

  assert.deepEqual(usage, {
    inputTokens: 1_200,
    cachedInputTokens: 400,
    outputTokens: 350,
    reasoningTokens: 120,
    totalTokens: 1_550,
    webSearchCalls: 1,
  });
});

test("cost calculation separates cached input, output, and web-search fees", () => {
  const cost = estimateOpenAiCostBreakdown("gpt-5-mini", {
    inputTokens: 1_200,
    cachedInputTokens: 400,
    outputTokens: 350,
    reasoningTokens: 120,
    totalTokens: 1_550,
    webSearchCalls: 1,
  });

  assert.deepEqual(cost, {
    inputCostUsd: 0.00021,
    outputCostUsd: 0.0007,
    toolCostUsd: 0.01,
    totalCostUsd: 0.01091,
  });
});

test("request summary reports models, stages, duplicates, retries, and cache savings", () => {
  const summary = summarizeOpenAiCostEvents([
    event(),
    event({
      operationName: "research:official_primary",
      model: "gpt-5.5",
      totalTokens: 2_000,
      totalCostUsd: 0.025,
      retryCount: 1,
      duplicateFingerprint: "research-a",
    }),
    event({
      operationName: "research:authoritative_public",
      model: "gpt-5.5",
      totalTokens: 2_000,
      totalCostUsd: 0.02,
      duplicateFingerprint: "research-a",
    }),
    event({
      operationName: "application_cache",
      cacheStatus: "hit",
      totalTokens: 5_000,
      totalCostUsd: 0,
      cacheSavingsUsd: 0.018,
      duplicateFingerprint: "",
    }),
  ]);

  assert.equal(summary.totalOpenAiCalls, 3);
  assert.equal(summary.totalTokens, 5_100);
  assert.equal(summary.duplicatedCalls, 1);
  assert.equal(summary.retryCostUsd, 0.025);
  assert.ok(summary.cacheSavingsUsd > 0.018);
  assert.equal(summary.costByPipelineStage.research.calls, 2);
  assert.equal(summary.costByPipelineStage.validation.calls, 0);
  assert.equal(summary.mostExpensiveStep.operationName, "research:official_primary");
});

test("all Responses API calls use the centrally instrumented OpenAI client", () => {
  const runtime = read("app/lib/ai/runtime.ts");
  const instrumentation = read("app/lib/ai/cost-instrumentation.ts");
  const planner = read("components/Planner.tsx");
  const worker = read("app/lib/report-jobs/worker.ts");
  const understandingRoute = read("app/api/understanding/route.ts");
  const chatRoute = read("app/api/chat/route.ts");
  const planExecutor = read("app/lib/report-jobs/plan-executor.ts");

  assert.match(runtime, /instrumentOpenAiClient\(/);
  assert.match(runtime, /instrumentOpenAiTransportFetch/);
  assert.match(instrumentation, /client\.responses\.create\s*=/);
  assert.match(instrumentation, /cached_input_tokens/);
  assert.match(instrumentation, /reasoning_tokens/);
  assert.match(planner, /X-Zerinix-AI-Request-Id/);
  assert.match(worker, /X-Zerinix-AI-Request-Id/);
  assert.match(understandingRoute, /runWithOpenAiCostContext/);
  assert.match(chatRoute, /finalizeOpenAiCostResponse/);
  assert.match(planExecutor, /finalizeOpenAiCostResponse/);
  assert.match(planExecutor, /report_generation:real_estate/);
});

test("cost persistence schema is private, correlated, and complete", () => {
  const migration = read(
    "supabase/migrations/20260801150000_create_openai_cost_instrumentation.sql"
  );
  for (const required of [
    "request_id text not null",
    "parent_request_id text",
    "user_id uuid",
    "input_tokens integer",
    "cached_input_tokens integer",
    "output_tokens integer",
    "reasoning_tokens integer",
    "estimated_total_cost_usd",
    "duration_ms integer",
    "retry_count integer",
    "cache_status text",
    "cost_by_model jsonb",
    "cost_by_pipeline_stage jsonb",
    "cost_by_operation jsonb",
  ]) {
    assert.ok(migration.includes(required), `missing migration field: ${required}`);
  }
  assert.match(migration, /enable row level security/);
  assert.match(migration, /auth\.uid\(\) = user_id/);
  assert.doesNotMatch(migration, /for insert to authenticated/i);
});
