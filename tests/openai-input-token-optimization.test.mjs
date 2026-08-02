import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  dedupeExactPromptBlocks,
  omitTrailingDuplicateUserPrompt,
} from "../app/lib/ai/token-optimization-core.ts";

const chatRoute = readFileSync("app/api/chat/route.ts", "utf8");
const analysisAssets = readFileSync("app/lib/ai/analysis-assets.ts", "utf8");
const tokenOptimization = readFileSync(
  "app/lib/ai/token-optimization.ts",
  "utf8"
);

test("exact duplicate prompt blocks are removed without changing unique report content", () => {
  const evidence = "Completed research:\n[R1] Market size — https://example.gov/data";
  const schema = "Report schema:\n- summary\n- sources";
  const before = `Business context\n\n${evidence}\n\n${schema}\n\n${evidence}`;
  const after = dedupeExactPromptBlocks(before);

  assert.equal(after, `Business context\n\n${evidence}\n\n${schema}`);
  assert.match(after, /\[R1\]/);
  assert.match(after, /https:\/\/example\.gov\/data/);
  assert.match(after, /summary[\s\S]*sources/);
});

test("the current user prompt is not resent when already present in history", () => {
  const history = [
    { role: "user", content: "I run an accounting SaaS." },
    { role: "assistant", content: "How can I help?" },
    { role: "user", content: "How should I price it?" },
  ];
  const optimized = omitTrailingDuplicateUserPrompt(
    history,
    "How should I price it?"
  );

  assert.deepEqual(optimized, history.slice(0, -1));
  assert.deepEqual(
    omitTrailingDuplicateUserPrompt(history, "Estimate market size"),
    history
  );
});

test("all shared asset-backed OpenAI inputs receive lossless prompt compaction", () => {
  assert.match(analysisAssets, /const compactPrompt = dedupeExactPromptBlocks\(prompt\)/);
  assert.match(analysisAssets, /text: compactPrompt/);
  assert.match(chatRoute, /omitTrailingDuplicateUserPrompt\([\s\S]*messages,[\s\S]*prompt/);
});

test("input optimization records before after tokens and estimated USD savings", () => {
  for (const field of [
    "estimated_input_tokens_before",
    "estimated_input_tokens_after",
    "estimated_input_token_savings",
    "estimated_input_cost_savings_usd",
  ]) {
    assert.match(tokenOptimization, new RegExp(field));
  }
  assert.match(chatRoute, /estimatedInputCostSavingsUsd/);
});

test("the repository OpenAI call inventory remains explicit and bounded", () => {
  const files = [
    "app/api/market-analysis/route.ts",
    "app/api/understanding/route.ts",
    "app/admin/actions.ts",
    "app/api/chat/route.ts",
    "app/lib/report-jobs/plan-executor.ts",
    "app/lib/ai/domain-research.ts",
    "app/lib/ai/research-entity-extraction.ts",
  ];
  const callCount = files.reduce((count, file) => {
    const source = readFileSync(file, "utf8");
    return count + (source.match(/\.responses\.create\(/g) || []).length;
  }, 0);

  assert.equal(callCount, 10);
});
