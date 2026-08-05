import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  decisionImpactValues,
  prioritizationFactorValues,
  RESEARCH_PRIORITIZATION_ENGINE_ENABLED_ENV_VAR,
  isResearchPrioritizationEngineEnabled,
  researchPrioritizationResultSchema,
  prioritizeResearchTasks,
} from "../app/lib/ai/research-prioritization-engine.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/research-prioritization-engine.ts", import.meta.url),
  "utf8"
);

function withEnvFlag(value, fn) {
  const previous = process.env[RESEARCH_PRIORITIZATION_ENGINE_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[RESEARCH_PRIORITIZATION_ENGINE_ENABLED_ENV_VAR];
  } else {
    process.env[RESEARCH_PRIORITIZATION_ENGINE_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[RESEARCH_PRIORITIZATION_ENGINE_ENABLED_ENV_VAR];
    } else {
      process.env[RESEARCH_PRIORITIZATION_ENGINE_ENABLED_ENV_VAR] = previous;
    }
  }
}

test("decisionImpactValues contains exactly the 4 required impact levels", () => {
  assert.deepEqual([...decisionImpactValues].sort(), ["low", "medium", "high", "critical"].sort());
});

test("prioritizationFactorValues contains exactly the 4 required factors", () => {
  assert.deepEqual(
    [...prioritizationFactorValues].sort(),
    ["expected_decision_impact", "uncertainty_reduction", "execution_cost", "execution_time"].sort()
  );
});

test("isResearchPrioritizationEngineEnabled reads the env var exactly", () => {
  assert.equal(isResearchPrioritizationEngineEnabled({}), false);
  assert.equal(
    isResearchPrioritizationEngineEnabled({ [RESEARCH_PRIORITIZATION_ENGINE_ENABLED_ENV_VAR]: "false" }),
    false
  );
  assert.equal(
    isResearchPrioritizationEngineEnabled({ [RESEARCH_PRIORITIZATION_ENGINE_ENABLED_ENV_VAR]: "true" }),
    true
  );
});

test("by default (no env var, no override) prioritization is disabled and computes nothing", () => {
  withEnvFlag(undefined, () => {
    const result = prioritizeResearchTasks({ tasks: [{ topic: "Market size" }] });
    assert.equal(researchPrioritizationResultSchema.safeParse(result).success, true);
    assert.equal(result.enabled, false);
    assert.deepEqual(result.prioritizedTasks, []);
    assert.deepEqual(result.recommendedOrder, []);
    assert.ok(result.scoringTrace.length > 0);
  });
});

test("an explicit enabled:true overrides the env var", () => {
  withEnvFlag(undefined, () => {
    const result = prioritizeResearchTasks({ tasks: [{ topic: "Market size" }], enabled: true });
    assert.equal(result.enabled, true);
    assert.equal(result.prioritizedTasks.length, 1);
  });
});

test("setting the env var to 'true' also enables prioritization", () => {
  withEnvFlag("true", () => {
    const result = prioritizeResearchTasks({ tasks: [{ topic: "Market size" }] });
    assert.equal(result.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const result = prioritizeResearchTasks({ tasks: [{ topic: "Market size" }], enabled: false });
    assert.equal(result.enabled, false);
  });
});

test("calling with the default argument (no tasks) is safe and returns a disabled, empty, schema-valid result", () => {
  const result = prioritizeResearchTasks();
  assert.equal(researchPrioritizationResultSchema.safeParse(result).success, true);
  assert.deepEqual(result.prioritizedTasks, []);
});

test("a task with every factor explicitly supplied uses the real values, never a default, in every rationale", () => {
  const result = prioritizeResearchTasks({
    enabled: true,
    tasks: [
      {
        id: "t1",
        topic: "Competitor pricing survey",
        expectedDecisionImpact: "high",
        uncertaintyReduction: 70,
        estimatedCostUsd: 5,
        estimatedTimeHours: 6,
      },
    ],
  });

  const task = result.prioritizedTasks[0];
  assert.equal(task.expectedDecisionImpact, "high");
  assert.equal(task.uncertaintyReduction, 70);
  assert.equal(task.estimatedCostUsd, 5);
  assert.equal(task.estimatedTimeHours, 6);
  for (const factorScore of task.factorScores) {
    assert.doesNotMatch(factorScore.rationale, /defaulted|baseline|No .* was supplied/i);
  }
});

test("a task with no optional fields at all is scored using documented neutral/baseline defaults, never a fabricated guess, and each default is named in its rationale", () => {
  const result = prioritizeResearchTasks({
    enabled: true,
    tasks: [{ topic: "Unknown research need" }],
  });

  const task = result.prioritizedTasks[0];
  assert.equal(task.expectedDecisionImpact, "medium");
  assert.equal(task.uncertaintyReduction, 50);
  assert.equal(task.estimatedCostUsd, 0.15);
  assert.equal(task.estimatedTimeHours, 2);

  const byFactor = Object.fromEntries(task.factorScores.map((f) => [f.factor, f]));
  assert.match(byFactor.expected_decision_impact.rationale, /No expected decision impact was supplied; defaulted to "medium"/);
  assert.match(byFactor.uncertainty_reduction.rationale, /No uncertainty-reduction estimate was supplied; defaulted to a neutral 50/);
  assert.match(byFactor.execution_cost.rationale, /No cost estimate was supplied; defaulted to the standard per-task baseline of \$0\.15/);
  assert.match(byFactor.execution_time.rationale, /No time estimate was supplied; defaulted to the standard per-task baseline of 2 hour\(s\)/);
});

test("expected_decision_impact factor score follows the documented low < medium < high < critical bucket table exactly", () => {
  const scoreFor = (impact) => {
    const result = prioritizeResearchTasks({
      enabled: true,
      tasks: [{ topic: "x", expectedDecisionImpact: impact }],
    });
    return result.prioritizedTasks[0].factorScores.find((f) => f.factor === "expected_decision_impact").score;
  };

  assert.equal(scoreFor("low"), 25);
  assert.equal(scoreFor("medium"), 50);
  assert.equal(scoreFor("high"), 75);
  assert.equal(scoreFor("critical"), 100);
});

test("execution_cost factor score follows the documented bucket table exactly, including boundary values", () => {
  const scoreFor = (costUsd) => {
    const result = prioritizeResearchTasks({
      enabled: true,
      tasks: [{ topic: "x", estimatedCostUsd: costUsd }],
    });
    return result.prioritizedTasks[0].factorScores.find((f) => f.factor === "execution_cost").score;
  };

  assert.equal(scoreFor(0.1), 100);
  assert.equal(scoreFor(0.11), 80);
  assert.equal(scoreFor(0.5), 80);
  assert.equal(scoreFor(0.51), 60);
  assert.equal(scoreFor(2), 60);
  assert.equal(scoreFor(2.01), 35);
  assert.equal(scoreFor(10), 35);
  assert.equal(scoreFor(10.01), 15);
  assert.equal(scoreFor(500), 15);
});

test("execution_time factor score follows the documented bucket table exactly, including boundary values", () => {
  const scoreFor = (hours) => {
    const result = prioritizeResearchTasks({
      enabled: true,
      tasks: [{ topic: "x", estimatedTimeHours: hours }],
    });
    return result.prioritizedTasks[0].factorScores.find((f) => f.factor === "execution_time").score;
  };

  assert.equal(scoreFor(1), 100);
  assert.equal(scoreFor(1.5), 80);
  assert.equal(scoreFor(4), 80);
  assert.equal(scoreFor(4.5), 60);
  assert.equal(scoreFor(8), 60);
  assert.equal(scoreFor(8.5), 35);
  assert.equal(scoreFor(24), 35);
  assert.equal(scoreFor(24.5), 15);
  assert.equal(scoreFor(200), 15);
});

test("uncertainty_reduction factor score is exactly the supplied 0-100 value, rounded, never reinterpreted", () => {
  const result = prioritizeResearchTasks({
    enabled: true,
    tasks: [{ topic: "x", uncertaintyReduction: 33.4 }],
  });
  assert.equal(result.prioritizedTasks[0].factorScores.find((f) => f.factor === "uncertainty_reduction").score, 33);
});

test("valueScore is always the literal equal-weighted mean of the 4 factor scores for that task, recomputed independently", () => {
  const result = prioritizeResearchTasks({
    enabled: true,
    tasks: [
      { id: "a", topic: "A", expectedDecisionImpact: "critical", uncertaintyReduction: 80, estimatedCostUsd: 0.05, estimatedTimeHours: 0.5 },
      { id: "b", topic: "B", expectedDecisionImpact: "low", uncertaintyReduction: 10, estimatedCostUsd: 900, estimatedTimeHours: 500 },
      { id: "c", topic: "C" },
    ],
  });

  for (const task of result.prioritizedTasks) {
    const recomputed = Math.round(task.factorScores.reduce((sum, f) => sum + f.score, 0) / task.factorScores.length);
    assert.equal(task.valueScore, recomputed, `mismatch for task ${task.taskId}`);
  }
});

test("tasks are ranked strictly by descending valueScore, and rank matches array position", () => {
  const result = prioritizeResearchTasks({
    enabled: true,
    tasks: [
      { id: "low-value", topic: "Low value", expectedDecisionImpact: "low", uncertaintyReduction: 5, estimatedCostUsd: 900, estimatedTimeHours: 500 },
      { id: "high-value", topic: "High value", expectedDecisionImpact: "critical", uncertaintyReduction: 95, estimatedCostUsd: 0.02, estimatedTimeHours: 0.25 },
      { id: "mid-value", topic: "Mid value", expectedDecisionImpact: "medium", uncertaintyReduction: 50, estimatedCostUsd: 1, estimatedTimeHours: 3 },
    ],
  });

  assert.deepEqual(result.prioritizedTasks.map((t) => t.taskId), ["high-value", "mid-value", "low-value"]);
  result.prioritizedTasks.forEach((task, index) => {
    assert.equal(task.rank, index + 1);
  });
  for (let i = 0; i < result.prioritizedTasks.length - 1; i += 1) {
    assert.ok(result.prioritizedTasks[i].valueScore >= result.prioritizedTasks[i + 1].valueScore);
  }
});

test("ties in valueScore preserve original input order (stable sort), never an arbitrary reordering", () => {
  const result = prioritizeResearchTasks({
    enabled: true,
    tasks: [
      { id: "first", topic: "First" },
      { id: "second", topic: "Second" },
      { id: "third", topic: "Third" },
    ],
  });

  assert.deepEqual(result.prioritizedTasks.map((t) => t.taskId), ["first", "second", "third"]);
});

test("recommendedOrder is exactly the taskIds of prioritizedTasks, in the same rank order", () => {
  const result = prioritizeResearchTasks({
    enabled: true,
    tasks: [
      { id: "a", topic: "A", expectedDecisionImpact: "low" },
      { id: "b", topic: "B", expectedDecisionImpact: "critical" },
    ],
  });

  assert.deepEqual(result.recommendedOrder, result.prioritizedTasks.map((t) => t.taskId));
});

test("a task with no explicit id is assigned a stable, positional fallback id", () => {
  const result = prioritizeResearchTasks({
    enabled: true,
    tasks: [{ topic: "No id here" }],
  });
  assert.equal(result.prioritizedTasks[0].taskId, "task_0");
});

test("explanation cites the real value score and the single strongest contributing factor for that task", () => {
  const result = prioritizeResearchTasks({
    enabled: true,
    tasks: [
      { id: "t1", topic: "Fast cheap high-impact task", expectedDecisionImpact: "critical", uncertaintyReduction: 10, estimatedCostUsd: 500, estimatedTimeHours: 300 },
    ],
  });

  const task = result.prioritizedTasks[0];
  assert.match(task.explanation, new RegExp(`Ranked #${task.rank}`));
  assert.match(task.explanation, new RegExp(`value score of ${task.valueScore}/100`));
  assert.match(task.explanation, /expected_decision_impact/);
});

test("scoringTrace records the number of candidate tasks and a rank/valueScore line per task", () => {
  const result = prioritizeResearchTasks({
    enabled: true,
    tasks: [{ id: "only", topic: "Only task" }],
  });

  assert.ok(result.scoringTrace.some((line) => /Prioritizing 1 candidate research task/.test(line)));
  assert.ok(result.scoringTrace.some((line) => /only: rank=1, valueScore=/.test(line)));
});

test("never fabricates priorities: every factor score for every task is schema-valid, bucket-derived, and the whole result parses under strict schema", () => {
  const result = prioritizeResearchTasks({
    enabled: true,
    tasks: [
      { id: "t1", topic: "Topic 1", expectedDecisionImpact: "high", uncertaintyReduction: 60 },
      { id: "t2", topic: "Topic 2", estimatedCostUsd: 3, estimatedTimeHours: 12 },
    ],
  });

  assert.equal(researchPrioritizationResultSchema.safeParse(result).success, true);
  for (const task of result.prioritizedTasks) {
    assert.equal(task.factorScores.length, prioritizationFactorValues.length);
    for (const factorScore of task.factorScores) {
      assert.ok(factorScore.score >= 0 && factorScore.score <= 100);
      assert.ok(decisionImpactValues.includes(task.expectedDecisionImpact));
    }
  }
});

test("identical input always produces an identical result (determinism)", () => {
  const input = {
    enabled: true,
    tasks: [
      { id: "a", topic: "A", expectedDecisionImpact: "high", uncertaintyReduction: 60, estimatedCostUsd: 1, estimatedTimeHours: 3 },
      { id: "b", topic: "B" },
    ],
  };
  const first = prioritizeResearchTasks(input);
  const second = prioritizeResearchTasks(input);
  assert.deepEqual(first, second);
});

test("an empty task list is handled gracefully with an empty, schema-valid result", () => {
  const result = prioritizeResearchTasks({ enabled: true, tasks: [] });
  assert.equal(researchPrioritizationResultSchema.safeParse(result).success, true);
  assert.deepEqual(result.prioritizedTasks, []);
  assert.deepEqual(result.recommendedOrder, []);
});

test("does not modify report generation, PDF generation, billing, or UI, and is not wired into any production route or other module yet", async () => {
  assert.doesNotMatch(engineSource, /from ["'].*(?:pdf-engine|report-engine|report-jobs|billing|auth)/i);

  const planRouteSource = await readFile(new URL("../app/api/plan/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(planRouteSource, /research-prioritization-engine|prioritizeResearchTasks/);

  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (
      file === "research-prioritization-engine.ts" ||
      // ZERINIX Business Intelligence Orchestrator v1 legitimately
      // coordinates Research Prioritization Engine as one of its 8 stages.
      file === "business-intelligence-orchestrator.ts" ||
      // ZERINIX Strategic Decision Memo v1 legitimately reuses
      // prioritizedResearchTaskSchema for its own researchPriorities field.
      file === "strategic-decision-memo.ts" ||
      !file.endsWith(".ts")
    ) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /research-prioritization-engine|prioritizeResearchTasks/,
      `expected ${file} to not yet reference the new standalone research prioritization engine`
    );
  }
});
