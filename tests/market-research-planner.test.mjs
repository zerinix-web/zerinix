import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMarketResearchTasks,
  REQUIRED_MARKET_RESEARCH_FIELDS,
} from "../app/lib/ai/market-research-planner.ts";
import { createDynamicReportPlanFallback } from "../app/lib/ai/dynamic-report-plan.ts";
import { createExpertiseProfileFallback } from "../app/lib/ai/expertise-profile.ts";

function planFor(prompt) {
  const expertiseProfile = createExpertiseProfileFallback({
    prompt,
    selectedMode: "market",
  });
  const reportPlan = createDynamicReportPlanFallback({
    expertiseProfile,
    selectedMode: "market",
    prompt,
  });
  return buildMarketResearchTasks({ expertiseProfile, reportPlan, prompt });
}

test("every Market Intelligence request schedules the full fixed capability set, including both benchmark tasks", () => {
  const tasks = planFor(
    "Market Intelligence report on the premium automatic car wash market in Turkey."
  );
  const fields = tasks.map((task) => task.field).toSorted();

  assert.deepEqual(fields, [...REQUIRED_MARKET_RESEARCH_FIELDS].toSorted());
  assert.ok(fields.includes("regional_benchmark"));
  assert.ok(fields.includes("global_benchmark"));
});

test("benchmark tasks are scheduled regardless of how many report sections exist", () => {
  // A short, narrow prompt tends to produce a report plan with few critical
  // sections -- exactly the shape that used to interact badly with the old
  // planner's unresolvedCriticalSections-driven budget (limit 8 instead of
  // 12), which could slice the benchmark tasks out entirely. The new
  // planner takes no reportPlan-derived limit at all.
  const narrowTasks = planFor("AI SaaS market");
  const broadTasks = planFor(
    "Comprehensive Market Intelligence report on the legaltech market: competitive landscape, pricing, market sizing, regional and global benchmarks, industry structure, and demand drivers."
  );

  for (const tasks of [narrowTasks, broadTasks]) {
    const fields = new Set(tasks.map((task) => task.field));
    assert.ok(fields.has("regional_benchmark"), "regional_benchmark must always be scheduled");
    assert.ok(fields.has("global_benchmark"), "global_benchmark must always be scheduled");
    assert.equal(tasks.length, REQUIRED_MARKET_RESEARCH_FIELDS.length);
  }
});

test("planner output is deterministic for the same input", () => {
  const prompt = "Market Intelligence report on the Turkish e-commerce logistics market.";
  const first = planFor(prompt);
  const second = planFor(prompt);

  assert.deepEqual(
    first.map((task) => ({ id: task.id, query: task.query, queryVariants: task.queryVariants })),
    second.map((task) => ({ id: task.id, query: task.query, queryVariants: task.queryVariants }))
  );
});

test("every task is directly compatible with the research executor's expected shape", () => {
  const tasks = planFor("Market Intelligence report on the German solar panel installation market.");

  assert.equal(tasks.length, 12);
  const ids = new Set();
  for (const task of tasks) {
    assert.ok(!ids.has(task.id), `duplicate task id: ${task.id}`);
    ids.add(task.id);

    assert.equal(typeof task.id, "string");
    assert.equal(typeof task.field, "string");
    assert.ok(["critical", "high", "medium"].includes(task.priority));
    assert.equal(task.provider, "auto");
    assert.equal(task.status, "skipped_with_reason");
    assert.equal(task.confidence, 0);
    assert.equal(typeof task.required, "boolean");
    assert.ok(task.query.length > 0);
    assert.ok(task.queryVariants.length >= 1 && task.queryVariants.length <= 3);
    assert.ok(Array.isArray(task.preferredSources) && task.preferredSources.length > 0);
    assert.ok(task.reason.length > 0);
  }
});

test("vendor discovery, competitor landscape, and official demand remain required; benchmarks remain non-blocking but present", () => {
  const tasks = planFor("Market Intelligence report on the Istanbul boutique gym market.");
  const byField = Object.fromEntries(tasks.map((task) => [task.field, task]));

  assert.equal(byField.vendor_discovery.required, true);
  assert.equal(byField.competitors.required, true);
  assert.equal(byField.market_demand.required, true);
  assert.equal(byField.regional_benchmark.required, false);
  assert.equal(byField.global_benchmark.required, false);
  assert.ok(byField.regional_benchmark);
  assert.ok(byField.global_benchmark);
});
