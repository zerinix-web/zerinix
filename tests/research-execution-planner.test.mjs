import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  complexityTierValues,
  executionStepTypeValues,
  dataSourceTypeValues,
  taskDependencyStatusValues,
  RESEARCH_EXECUTION_PLANNER_ENABLED_ENV_VAR,
  isResearchExecutionPlannerEnabled,
  researchExecutionPlanSchema,
  planResearchExecution,
} from "../app/lib/ai/research-execution-planner.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/research-execution-planner.ts", import.meta.url),
  "utf8"
);

function withEnvFlag(value, fn) {
  const previous = process.env[RESEARCH_EXECUTION_PLANNER_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[RESEARCH_EXECUTION_PLANNER_ENABLED_ENV_VAR];
  } else {
    process.env[RESEARCH_EXECUTION_PLANNER_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[RESEARCH_EXECUTION_PLANNER_ENABLED_ENV_VAR];
    } else {
      process.env[RESEARCH_EXECUTION_PLANNER_ENABLED_ENV_VAR] = previous;
    }
  }
}

test("complexityTierValues contains exactly the 3 required tiers", () => {
  assert.deepEqual([...complexityTierValues].sort(), ["simple", "standard", "complex"].sort());
});

test("executionStepTypeValues contains exactly the 6 required step types", () => {
  assert.deepEqual(
    [...executionStepTypeValues].sort(),
    [
      "define_scope",
      "identify_sources",
      "collect_evidence",
      "cross_verify",
      "synthesize_findings",
      "validate_against_decision",
    ].sort()
  );
});

test("dataSourceTypeValues contains exactly the 7 required data source categories", () => {
  assert.deepEqual(
    [...dataSourceTypeValues].sort(),
    [
      "market_research",
      "financial_data",
      "competitor_intelligence",
      "regulatory_filings",
      "customer_data",
      "technical_documentation",
      "general_web",
    ].sort()
  );
});

test("taskDependencyStatusValues contains exactly the 2 required statuses", () => {
  assert.deepEqual([...taskDependencyStatusValues].sort(), ["enforced", "cyclic_not_enforced"].sort());
});

test("isResearchExecutionPlannerEnabled reads the env var exactly", () => {
  assert.equal(isResearchExecutionPlannerEnabled({}), false);
  assert.equal(
    isResearchExecutionPlannerEnabled({ [RESEARCH_EXECUTION_PLANNER_ENABLED_ENV_VAR]: "false" }),
    false
  );
  assert.equal(
    isResearchExecutionPlannerEnabled({ [RESEARCH_EXECUTION_PLANNER_ENABLED_ENV_VAR]: "true" }),
    true
  );
});

test("by default (no env var, no override) planning is disabled and computes nothing", () => {
  withEnvFlag(undefined, () => {
    const result = planResearchExecution({ tasks: [{ topic: "Market size" }] });
    assert.equal(researchExecutionPlanSchema.safeParse(result).success, true);
    assert.equal(result.enabled, false);
    assert.deepEqual(result.plannedTasks, []);
    assert.deepEqual(result.executionSequence, []);
    assert.deepEqual(result.dependencyIssues, []);
    assert.ok(result.planningTrace.length > 0);
  });
});

test("an explicit enabled:true overrides the env var", () => {
  withEnvFlag(undefined, () => {
    const result = planResearchExecution({ tasks: [{ topic: "Market size" }], enabled: true });
    assert.equal(result.enabled, true);
    assert.equal(result.plannedTasks.length, 1);
  });
});

test("setting the env var to 'true' also enables planning", () => {
  withEnvFlag("true", () => {
    const result = planResearchExecution({ tasks: [{ topic: "Market size" }] });
    assert.equal(result.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const result = planResearchExecution({ tasks: [{ topic: "Market size" }], enabled: false });
    assert.equal(result.enabled, false);
  });
});

test("calling with the default argument (no tasks) is safe and returns a disabled, empty, schema-valid result", () => {
  const result = planResearchExecution();
  assert.equal(researchExecutionPlanSchema.safeParse(result).success, true);
  assert.deepEqual(result.plannedTasks, []);
});

test("a task with a short time estimate (<=2h) gets the documented 2-step 'simple' template, in order", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [{ topic: "Quick lookup", estimatedTimeHours: 1 }],
  });
  const task = result.plannedTasks[0];
  assert.equal(task.complexityTier, "simple");
  assert.deepEqual(
    task.executionSteps.map((s) => s.stepType),
    ["identify_sources", "collect_evidence"]
  );
  task.executionSteps.forEach((step, index) => assert.equal(step.order, index + 1));
});

test("a task with no time estimate at all defaults to the neutral 'standard' 4-step template, never guessed as simple or complex", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [{ topic: "Unspecified complexity task" }],
  });
  const task = result.plannedTasks[0];
  assert.equal(task.complexityTier, "standard");
  assert.deepEqual(
    task.executionSteps.map((s) => s.stepType),
    ["define_scope", "identify_sources", "collect_evidence", "synthesize_findings"]
  );
});

test("a task with a long time estimate (>8h) gets the documented 6-step 'complex' template, in order", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [{ topic: "Deep dive", estimatedTimeHours: 40 }],
  });
  const task = result.plannedTasks[0];
  assert.equal(task.complexityTier, "complex");
  assert.deepEqual(
    task.executionSteps.map((s) => s.stepType),
    ["define_scope", "identify_sources", "collect_evidence", "cross_verify", "synthesize_findings", "validate_against_decision"]
  );
});

test("complexity tier resolution follows the documented time bucket boundaries exactly", () => {
  const tierFor = (hours) => {
    const result = planResearchExecution({ enabled: true, tasks: [{ topic: "x", estimatedTimeHours: hours }] });
    return result.plannedTasks[0].complexityTier;
  };
  assert.equal(tierFor(2), "simple");
  assert.equal(tierFor(2.01), "standard");
  assert.equal(tierFor(8), "standard");
  assert.equal(tierFor(8.01), "complex");
});

test("every executionStep description and expectedOutput comes from the fixed per-step template -- never task-specific fabricated text", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [{ topic: "Some very specific and unusual research topic nobody has ever seen", estimatedTimeHours: 40 }],
  });
  const task = result.plannedTasks[0];
  for (const step of task.executionSteps) {
    assert.doesNotMatch(step.description, /unusual|nobody|specific and unusual/i);
    assert.doesNotMatch(step.expectedOutput, /unusual|nobody|specific and unusual/i);
  }
});

test("requiredDataSourceTypes is derived from real keyword matches in the topic, and defaults honestly to 'general_web' when nothing matches", () => {
  const marketResult = planResearchExecution({
    enabled: true,
    tasks: [{ topic: "Total addressable market size for accounting software" }],
  });
  assert.ok(marketResult.plannedTasks[0].requiredDataSourceTypes.includes("market_research"));

  const noKeywordResult = planResearchExecution({
    enabled: true,
    tasks: [{ topic: "Zxq blorptastic flibber" }],
  });
  assert.deepEqual(noKeywordResult.plannedTasks[0].requiredDataSourceTypes, ["general_web"]);

  const multiResult = planResearchExecution({
    enabled: true,
    tasks: [{ topic: "Competitor pricing and financial margin comparison" }],
  });
  assert.ok(multiResult.plannedTasks[0].requiredDataSourceTypes.includes("competitor_intelligence"));
  assert.ok(multiResult.plannedTasks[0].requiredDataSourceTypes.includes("financial_data"));
});

test("completionCriteria requires more independent sources for more complex tiers, and only mentions prerequisites when real enforced dependencies exist", () => {
  const simpleResult = planResearchExecution({
    enabled: true,
    tasks: [{ topic: "x", estimatedTimeHours: 1 }],
  });
  const complexResult = planResearchExecution({
    enabled: true,
    tasks: [{ topic: "x", estimatedTimeHours: 40 }],
  });
  assert.match(simpleResult.plannedTasks[0].completionCriteria[0], /At least 1 independent data source/);
  assert.match(complexResult.plannedTasks[0].completionCriteria[0], /At least 3 independent data source/);

  const noDeps = simpleResult.plannedTasks[0].completionCriteria;
  assert.ok(!noDeps.some((c) => /prerequisite/i.test(c)));

  const withDeps = planResearchExecution({
    enabled: true,
    tasks: [
      { id: "base", topic: "Base research" },
      { id: "follow-up", topic: "Follow-up research", dependsOnTaskIds: ["base"] },
    ],
  });
  const followUpTask = withDeps.plannedTasks.find((t) => t.taskId === "follow-up");
  assert.ok(followUpTask.completionCriteria.some((c) => /prerequisite task\(s\) \(base\)/.test(c)));
});

test("a self-referencing declared dependency is dropped and logged, never treated as a real dependency", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [{ id: "solo", topic: "Solo task", dependsOnTaskIds: ["solo"] }],
  });
  const task = result.plannedTasks[0];
  assert.deepEqual(task.dependencies, []);
  assert.ok(result.dependencyIssues.some((issue) => /declared a dependency on itself/.test(issue)));
});

test("a declared dependency on an unknown task id is dropped and logged, never fabricated into a real task", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [{ id: "solo", topic: "Solo task", dependsOnTaskIds: ["does-not-exist"] }],
  });
  const task = result.plannedTasks[0];
  assert.deepEqual(task.dependencies, []);
  assert.ok(result.dependencyIssues.some((issue) => /unknown task "does-not-exist"/.test(issue)));
});

test("a valid declared dependency is enforced: the prerequisite is scheduled strictly before the dependent task", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [
      { id: "dependent", topic: "Dependent task", dependsOnTaskIds: ["prereq"] },
      { id: "prereq", topic: "Prerequisite task" },
    ],
  });

  const prereqPosition = result.plannedTasks.find((t) => t.taskId === "prereq").sequencePosition;
  const dependentPosition = result.plannedTasks.find((t) => t.taskId === "dependent").sequencePosition;
  assert.ok(prereqPosition < dependentPosition);

  const dependentTask = result.plannedTasks.find((t) => t.taskId === "dependent");
  assert.deepEqual(dependentTask.dependencies, [{ taskId: "prereq", status: "enforced" }]);
});

test("a 3-task chained dependency (C depends on B, B depends on A) is fully respected in the execution sequence", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [
      { id: "c", topic: "C", dependsOnTaskIds: ["b"] },
      { id: "a", topic: "A" },
      { id: "b", topic: "B", dependsOnTaskIds: ["a"] },
    ],
  });

  assert.deepEqual(result.executionSequence, ["a", "b", "c"]);
});

test("when multiple tasks are simultaneously ready, the higher valueScore is scheduled first", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [
      { id: "low", topic: "Low value", valueScore: 20 },
      { id: "high", topic: "High value", valueScore: 90 },
    ],
  });
  assert.deepEqual(result.executionSequence, ["high", "low"]);
});

test("when valueScore is absent for competing ready tasks, a lower priorityRank (1 = highest priority) is scheduled first", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [
      { id: "rank-3", topic: "Rank 3", priorityRank: 3 },
      { id: "rank-1", topic: "Rank 1", priorityRank: 1 },
    ],
  });
  assert.deepEqual(result.executionSequence, ["rank-1", "rank-3"]);
});

test("when no priority signal at all is available for competing ready tasks, original input order is preserved", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [
      { id: "first", topic: "First" },
      { id: "second", topic: "Second" },
      { id: "third", topic: "Third" },
    ],
  });
  assert.deepEqual(result.executionSequence, ["first", "second", "third"]);
});

test("a circular dependency (A depends on B, B depends on A) is detected, reported, not enforced, and both tasks are still scheduled", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [
      { id: "a", topic: "A", dependsOnTaskIds: ["b"] },
      { id: "b", topic: "B", dependsOnTaskIds: ["a"] },
    ],
  });

  assert.equal(result.plannedTasks.length, 2);
  assert.equal(result.executionSequence.length, 2);
  assert.ok(result.dependencyIssues.some((issue) => /circular dependency/i.test(issue)));

  const taskA = result.plannedTasks.find((t) => t.taskId === "a");
  const taskB = result.plannedTasks.find((t) => t.taskId === "b");
  assert.deepEqual(taskA.dependencies, [{ taskId: "b", status: "cyclic_not_enforced" }]);
  assert.deepEqual(taskB.dependencies, [{ taskId: "a", status: "cyclic_not_enforced" }]);
  assert.match(taskA.explanation, /circular dependency/i);
  assert.match(taskB.explanation, /circular dependency/i);
});

test("executionSequence is exactly the taskIds of plannedTasks, in the same sequence order", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [
      { id: "a", topic: "A", valueScore: 10 },
      { id: "b", topic: "B", valueScore: 90 },
    ],
  });
  assert.deepEqual(result.executionSequence, result.plannedTasks.map((t) => t.taskId));
});

test("a task with no explicit id is assigned a stable, positional fallback id", () => {
  const result = planResearchExecution({ enabled: true, tasks: [{ topic: "No id here" }] });
  assert.equal(result.plannedTasks[0].taskId, "task_0");
});

test("explanation cites real enforced prerequisites when present, and the real priority basis when absent", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [
      { id: "prereq", topic: "Prereq", valueScore: 40 },
      { id: "dependent", topic: "Dependent", dependsOnTaskIds: ["prereq"] },
    ],
  });
  const dependentTask = result.plannedTasks.find((t) => t.taskId === "dependent");
  const prereqTask = result.plannedTasks.find((t) => t.taskId === "prereq");
  assert.match(dependentTask.explanation, /after its prerequisite task\(s\) \(prereq\) complete/);
  assert.match(prereqTask.explanation, /ordered by value score 40/);
});

test("never fabricates: the full result parses under the strict schema and every enum-typed field is drawn only from its documented enum", () => {
  const result = planResearchExecution({
    enabled: true,
    tasks: [
      { id: "t1", topic: "Market and competitor pricing research", estimatedTimeHours: 1 },
      { id: "t2", topic: "Deep financial regulatory investigation", estimatedTimeHours: 20, dependsOnTaskIds: ["t1"] },
    ],
  });

  assert.equal(researchExecutionPlanSchema.safeParse(result).success, true);
  for (const task of result.plannedTasks) {
    assert.ok(complexityTierValues.includes(task.complexityTier));
    for (const step of task.executionSteps) {
      assert.ok(executionStepTypeValues.includes(step.stepType));
    }
    for (const sourceType of task.requiredDataSourceTypes) {
      assert.ok(dataSourceTypeValues.includes(sourceType));
    }
    for (const dependency of task.dependencies) {
      assert.ok(taskDependencyStatusValues.includes(dependency.status));
    }
  }
});

test("identical input always produces an identical result (determinism)", () => {
  const input = {
    enabled: true,
    tasks: [
      { id: "a", topic: "Market research task", estimatedTimeHours: 3, valueScore: 60 },
      { id: "b", topic: "Financial deep dive", estimatedTimeHours: 20, dependsOnTaskIds: ["a"] },
    ],
  };
  const first = planResearchExecution(input);
  const second = planResearchExecution(input);
  assert.deepEqual(first, second);
});

test("an empty task list is handled gracefully with an empty, schema-valid result", () => {
  const result = planResearchExecution({ enabled: true, tasks: [] });
  assert.equal(researchExecutionPlanSchema.safeParse(result).success, true);
  assert.deepEqual(result.plannedTasks, []);
  assert.deepEqual(result.executionSequence, []);
});

test("does not modify report generation, PDF generation, billing, or UI, and is not wired into any production route or other module yet", async () => {
  assert.doesNotMatch(engineSource, /from ["'].*(?:pdf-engine|report-engine|report-jobs|billing|auth)/i);

  const planRouteSource = await readFile(new URL("../app/api/plan/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(planRouteSource, /research-execution-planner|planResearchExecution/);

  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (file === "research-execution-planner.ts" || !file.endsWith(".ts")) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /research-execution-planner|planResearchExecution/,
      `expected ${file} to not yet reference the new standalone research execution planner`
    );
  }
});
