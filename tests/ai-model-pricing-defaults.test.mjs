import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  defaultAiModelPricing,
  resolveModelPricing,
} from "../app/lib/ai/model-pricing-defaults.ts";

test("every model actually used by the app has a real, non-zero default price", () => {
  for (const model of [
    "gpt-5.5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
  ]) {
    const pricing = defaultAiModelPricing[model];
    assert.ok(pricing, `missing default pricing for ${model}`);
    assert.ok(pricing.input > 0, `${model} input price should be positive`);
    assert.ok(pricing.output > 0, `${model} output price should be positive`);
  }
});

test("resolveModelPricing falls back to real defaults when unconfigured", () => {
  assert.deepEqual(resolveModelPricing("gpt-5-mini", undefined), {
    input: 0.25,
    output: 2,
  });
  assert.deepEqual(resolveModelPricing("gpt-5-mini", {}), {
    input: 0.25,
    output: 2,
  });
});

test("resolveModelPricing prefers AI_COST_CONFIG overrides over defaults", () => {
  assert.deepEqual(
    resolveModelPricing("gpt-5-mini", { "gpt-5-mini": { input: 0, output: 0 } }),
    { input: 0, output: 0 }
  );
  assert.deepEqual(
    resolveModelPricing("gpt-5-mini", { "gpt-5-mini": { input: 1.5, output: 9 } }),
    { input: 1.5, output: 9 }
  );
});

test("resolveModelPricing returns null for a genuinely unpriced model", () => {
  assert.equal(resolveModelPricing("some-future-model", undefined), null);
});

test("pricing.ts wires getModelPricing through resolveModelPricing, not a hardcoded zero", () => {
  const source = readFileSync("app/lib/ai/pricing.ts", "utf8");
  assert.match(source, /resolveModelPricing\(model, getAiCostConfig\(\)\.pricing\)/);
  assert.match(source, /from "@\/app\/lib\/ai\/model-pricing-defaults"/);
});
