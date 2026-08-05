import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { z } from "zod";
import {
  orchestratorStageValues,
  executiveDecisionSignalValues,
  BUSINESS_INTELLIGENCE_ORCHESTRATOR_ENABLED_ENV_VAR,
  isBusinessIntelligenceOrchestratorEnabled,
  businessIntelligenceContextSchema,
  validateStageOutput,
  runBusinessIntelligenceOrchestration,
} from "../app/lib/ai/business-intelligence-orchestrator.ts";
import { evidenceQualityScoringResultSchema } from "../app/lib/ai/evidence-quality-scoring.ts";
import { evidenceCategoryValues } from "../app/lib/ai/evidence-acquisition-engine.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/business-intelligence-orchestrator.ts", import.meta.url),
  "utf8"
);

function withEnvFlag(value, fn) {
  const previous = process.env[BUSINESS_INTELLIGENCE_ORCHESTRATOR_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[BUSINESS_INTELLIGENCE_ORCHESTRATOR_ENABLED_ENV_VAR];
  } else {
    process.env[BUSINESS_INTELLIGENCE_ORCHESTRATOR_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[BUSINESS_INTELLIGENCE_ORCHESTRATOR_ENABLED_ENV_VAR];
    } else {
      process.env[BUSINESS_INTELLIGENCE_ORCHESTRATOR_ENABLED_ENV_VAR] = previous;
    }
  }
}

const FIXED_NOW = new Date("2026-08-01T00:00:00.000Z");

function recentDate(daysAgo) {
  return new Date(FIXED_NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function fullEvidenceAcquisitionResult() {
  const evidence = {};
  for (const category of evidenceCategoryValues) {
    evidence[category] = {
      category,
      source: "https://example.com/source",
      url: "https://example.com/source",
      publisher: "Example Research Co",
      evidence_type: "external_verified",
      confidence: 0.85,
      extracted_fact: `Verified fact about ${category}.`,
      date: recentDate(30),
    };
  }
  return {
    evidence,
    verifiedEvidence: Object.values(evidence),
    externalVerifiedCount: evidenceCategoryValues.length,
    userProvidedCount: 0,
    missingEvidenceCount: 0,
    missingCategories: [],
    evidenceTrace: evidenceCategoryValues.map((category) => `${category}: verified.`),
  };
}

function richEvidencePool() {
  return [
    {
      id: "market-1",
      text: "The total addressable market for AI accounting software is estimated at $12 billion with strong growth potential across North America and Europe.",
      source: { publisher: "Gartner", url: "https://gartner.com/report", publishedDate: recentDate(30) },
      statedConfidence: 0.9,
    },
    {
      id: "market-2",
      text: "Industry analysts estimate the AI accounting software market at $12 billion, driven by growing demand for automation solutions.",
      source: { publisher: "Forrester", url: "https://forrester.com/report", publishedDate: recentDate(45) },
      statedConfidence: 0.85,
    },
    {
      id: "competitor-1",
      text: "Leading competitors in the AI accounting software space include established vendors offering distinct automation features.",
      source: { publisher: "TechCrunch", url: "https://techcrunch.com/article", publishedDate: recentDate(20) },
      statedConfidence: 0.8,
    },
  ];
}

test("orchestratorStageValues contains exactly the 9 required stages, in real dependency order", () => {
  assert.deepEqual(
    [...orchestratorStageValues],
    [
      "input_validation",
      "evidence_quality_scoring",
      "source_reliability",
      "conflict_detection",
      "evidence_corroboration",
      "confidence_engine",
      "live_research",
      "research_prioritization",
      "research_execution_planning",
    ]
  );
});

test("executiveDecisionSignalValues contains exactly the 3 required signals", () => {
  assert.deepEqual(
    [...executiveDecisionSignalValues].sort(),
    ["proceed", "proceed_with_caution", "do_not_proceed_insufficient_evidence"].sort()
  );
});

test("isBusinessIntelligenceOrchestratorEnabled reads the env var exactly", () => {
  assert.equal(isBusinessIntelligenceOrchestratorEnabled({}), false);
  assert.equal(
    isBusinessIntelligenceOrchestratorEnabled({ [BUSINESS_INTELLIGENCE_ORCHESTRATOR_ENABLED_ENV_VAR]: "false" }),
    false
  );
  assert.equal(
    isBusinessIntelligenceOrchestratorEnabled({ [BUSINESS_INTELLIGENCE_ORCHESTRATOR_ENABLED_ENV_VAR]: "true" }),
    true
  );
});

test("by default (no env var, no override) orchestration is disabled and every stage is null, never a fabricated look-alike result", () => {
  withEnvFlag(undefined, () => {
    const result = runBusinessIntelligenceOrchestration({ evidence: richEvidencePool() });
    assert.equal(businessIntelligenceContextSchema.safeParse(result).success, true);
    assert.equal(result.enabled, false);
    assert.deepEqual(result.stagesExecuted, []);
    assert.equal(result.criticalFailure, null);
    for (const stageKey of [
      "evidenceQuality",
      "sourceReliability",
      "conflictDetection",
      "evidenceCorroboration",
      "confidence",
      "liveResearch",
      "researchPrioritization",
      "researchExecutionPlan",
    ]) {
      assert.equal(result[stageKey], null, `expected ${stageKey} to be null when disabled`);
    }
  });
});

test("an explicit enabled:true overrides the env var", () => {
  withEnvFlag(undefined, () => {
    const result = runBusinessIntelligenceOrchestration({ enabled: true });
    assert.equal(result.enabled, true);
  });
});

test("setting the env var to 'true' also enables orchestration", () => {
  withEnvFlag("true", () => {
    const result = runBusinessIntelligenceOrchestration({});
    assert.equal(result.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const result = runBusinessIntelligenceOrchestration({ enabled: false });
    assert.equal(result.enabled, false);
  });
});

test("calling with the default argument (no input at all) is safe and returns a disabled, schema-valid context", () => {
  const result = runBusinessIntelligenceOrchestration();
  assert.equal(businessIntelligenceContextSchema.safeParse(result).success, true);
  assert.equal(result.enabled, false);
});

test("an evidence item missing real text is a critical failure at input_validation, and halts every later stage -- never a fabricated partial result", () => {
  const result = runBusinessIntelligenceOrchestration({
    enabled: true,
    evidence: [{ id: "bad", text: "" }],
  });

  assert.equal(businessIntelligenceContextSchema.safeParse(result).success, true);
  assert.equal(result.enabled, true);
  assert.deepEqual(result.stagesExecuted, []);
  assert.equal(result.criticalFailure.stage, "input_validation");
  assert.match(result.criticalFailure.reason, /evidence\[0\]/);
  for (const stageKey of [
    "evidenceQuality",
    "sourceReliability",
    "conflictDetection",
    "evidenceCorroboration",
    "confidence",
    "liveResearch",
    "researchPrioritization",
    "researchExecutionPlan",
  ]) {
    assert.equal(result[stageKey], null, `expected ${stageKey} to be null after a critical failure`);
  }
  assert.equal(result.aggregateConfidence, 0);
  assert.equal(result.aggregateEvidenceQuality, 0);
  assert.equal(result.executiveDecisionSignal, "do_not_proceed_insufficient_evidence");
});

test("a conclusion missing a real statement is a critical failure at input_validation", () => {
  const result = runBusinessIntelligenceOrchestration({
    enabled: true,
    conclusions: [{ id: "bad", statement: "   " }],
  });

  assert.equal(result.criticalFailure.stage, "input_validation");
  assert.match(result.criticalFailure.reason, /conclusions\[0\]/);
  assert.equal(result.executiveDecisionSignal, "do_not_proceed_insufficient_evidence");
});

test("an entirely empty pipeline (no evidence, sources, or conclusions) runs every stage honestly, with no fabricated confidence", () => {
  const result = runBusinessIntelligenceOrchestration({ enabled: true, now: FIXED_NOW });

  assert.equal(businessIntelligenceContextSchema.safeParse(result).success, true);
  assert.equal(result.criticalFailure, null);
  assert.deepEqual(result.stagesExecuted, [...orchestratorStageValues]);
  assert.equal(result.evidenceQuality.overallPoolScore, 0);
  // Confidence Engine's own score is genuinely low with zero evidence
  // to point to -- the blended orchestrator-level aggregate is higher
  // only because "no conflicts were found" (conflictDetection has
  // nothing to disagree about) is itself a real, non-fabricated
  // signal, not a neutral default standing in for missing data.
  assert.ok(result.confidence.confidence < 30, `expected a low Confidence Engine score, got ${result.confidence.confidence}`);
  assert.equal(result.liveResearch.liveResearchRequired, true);
  assert.deepEqual([...result.liveResearch.detectedGaps].sort(), [
    "insufficient_evidence",
    "missing_competitor_intelligence",
    "missing_financial_evidence",
    "missing_market_data",
    "outdated_evidence",
  ]);
  assert.equal(result.executiveDecisionSignal, "proceed_with_caution");
});

test("live research gaps flow into research prioritization tasks 1:1 by gap id, and into the execution plan 1:1 by task id", () => {
  const result = runBusinessIntelligenceOrchestration({ enabled: true, now: FIXED_NOW });

  const gapIds = result.liveResearch.tasks.map((task) => task.gap);
  const prioritizedIds = result.researchPrioritization.prioritizedTasks.map((task) => task.taskId).sort();
  assert.deepEqual(prioritizedIds, [...gapIds].sort());

  for (const task of result.researchPrioritization.prioritizedTasks) {
    const sourceGap = result.liveResearch.tasks.find((t) => t.gap === task.taskId);
    assert.equal(task.expectedDecisionImpact, sourceGap.expectedDecisionImpact);
  }

  const planIds = result.researchExecutionPlan.plannedTasks.map((task) => task.taskId).sort();
  assert.deepEqual(planIds, prioritizedIds);

  for (const plannedTask of result.researchExecutionPlan.plannedTasks) {
    const prioritized = result.researchPrioritization.prioritizedTasks.find((t) => t.taskId === plannedTask.taskId);
    assert.ok(prioritized);
  }
});

test("Confidence Engine's evidence_quality factor is wired directly to Evidence Quality Scoring's own pool score -- real cross-stage data flow, not independent re-computation", () => {
  const result = runBusinessIntelligenceOrchestration({
    enabled: true,
    now: FIXED_NOW,
    evidence: richEvidencePool(),
  });

  const evidenceQualityFactor = result.confidence.factorScores.find((f) => f.factor === "evidence_quality");
  assert.equal(evidenceQualityFactor.score, result.evidenceQuality.overallPoolScore);
});

test("aggregateEvidenceQuality is exactly the documented mean of evidence_quality_pool_score and mean_source_reliability_score", () => {
  const result = runBusinessIntelligenceOrchestration({
    enabled: true,
    now: FIXED_NOW,
    evidence: richEvidencePool(),
    sources: [
      { name: "Gartner", sourceType: "industry_analyst", url: "https://gartner.com" },
      { name: "Forrester", sourceType: "industry_analyst", url: "https://forrester.com" },
    ],
  });

  const meanReliability =
    result.sourceReliability.sources.reduce((sum, s) => sum + s.reliabilityScore, 0) /
    result.sourceReliability.sources.length;
  const expected = Math.round((result.evidenceQuality.overallPoolScore + meanReliability) / 2);
  assert.equal(result.aggregateEvidenceQuality, expected);
});

test("aggregateConfidence is exactly the documented mean of the 4 real cross-engine components", () => {
  const result = runBusinessIntelligenceOrchestration({
    enabled: true,
    now: FIXED_NOW,
    evidence: richEvidencePool(),
    sources: [{ name: "Gartner", sourceType: "industry_analyst", url: "https://gartner.com" }],
    conclusions: [{ id: "c1", statement: "The AI accounting software market is large and growing.", impact: "medium" }],
    domain: "business",
    decisionComplexity: "low",
  });

  const meanReliability =
    result.sourceReliability.sources.reduce((sum, s) => sum + s.reliabilityScore, 0) /
    result.sourceReliability.sources.length;
  const conflictHealth = 100 - result.conflictDetection.confidenceImpact;
  const meanCorroboration =
    result.evidenceCorroboration.conclusions.reduce((sum, c) => sum + c.confidence, 0) /
    result.evidenceCorroboration.conclusions.length;

  const expected = Math.round(
    (result.confidence.confidence + meanReliability + conflictHealth + meanCorroboration) / 4
  );
  assert.equal(result.aggregateConfidence, expected);
});

test("a critical conflict forces do_not_proceed_insufficient_evidence regardless of how strong confidence otherwise looks", () => {
  const result = runBusinessIntelligenceOrchestration({
    enabled: true,
    now: FIXED_NOW,
    evidence: [
      {
        id: "a",
        text: "Market research shows the accounting software market grew by 40% last year according to verified data.",
        source: { publisher: "Gartner", url: "https://gartner.com", publishedDate: recentDate(10) },
        statedConfidence: 0.9,
      },
      {
        id: "b",
        text: "Market research shows the accounting software market grew by 5% last year, however this contradicts other verified data.",
        source: { publisher: "Forrester", url: "https://forrester.com", publishedDate: recentDate(10) },
        statedConfidence: 0.9,
      },
    ],
  });

  assert.equal(result.conflictDetection.overallSeverity, "critical");
  assert.equal(result.executiveDecisionSignal, "do_not_proceed_insufficient_evidence");
});

test("an unmet high-impact corroboration requirement forces do_not_proceed_insufficient_evidence", () => {
  const result = runBusinessIntelligenceOrchestration({
    enabled: true,
    now: FIXED_NOW,
    evidence: richEvidencePool(),
    conclusions: [
      {
        id: "critical-claim",
        statement: "The AI accounting software market size is a critical factor for this investment decision.",
        impact: "critical",
      },
    ],
  });

  const conclusion = result.evidenceCorroboration.conclusions.find((c) => c.conclusionId === "critical-claim");
  assert.notEqual(conclusion.status, "multi_source_corroborated");
  assert.ok(result.evidenceCorroboration.highImpactRequirementsNotMet.includes("critical-claim"));
  assert.equal(result.executiveDecisionSignal, "do_not_proceed_insufficient_evidence");
});

test("liveResearchRequired=true with otherwise healthy evidence yields proceed_with_caution, never an outright proceed", () => {
  const result = runBusinessIntelligenceOrchestration({
    enabled: true,
    now: FIXED_NOW,
    evidence: richEvidencePool(),
    domain: "business",
    decisionComplexity: "low",
    // No evidenceAcquisitionResult supplied -> missing_market_data /
    // missing_competitor_intelligence / missing_financial_evidence
    // are honestly detected, forcing liveResearchRequired=true.
  });

  assert.equal(result.aggregatedResearchRequirements.liveResearchRequired, true);
  assert.notEqual(result.conflictDetection.overallSeverity, "critical");
  assert.equal(result.evidenceCorroboration.highImpactRequirementsNotMet.length, 0);
  assert.equal(result.executiveDecisionSignal, "proceed_with_caution");
});

test("a fully healthy pipeline (strong evidence, no gaps, no conflicts, no unmet requirements) yields proceed", () => {
  const result = runBusinessIntelligenceOrchestration({
    enabled: true,
    now: FIXED_NOW,
    evidence: richEvidencePool(),
    sources: [
      { name: "Gartner", sourceType: "industry_analyst", url: "https://gartner.com", confirmationCount: 5, contradictionCount: 0 },
      { name: "Forrester", sourceType: "industry_analyst", url: "https://forrester.com", confirmationCount: 5, contradictionCount: 0 },
    ],
    conclusions: [{ id: "c1", statement: "The AI accounting software market is large and growing.", impact: "low" }],
    evidenceAcquisitionResult: fullEvidenceAcquisitionResult(),
    domain: "business",
    decisionComplexity: "low",
    independentSourceCount: 3,
  });

  assert.equal(
    result.aggregatedResearchRequirements.liveResearchRequired,
    false,
    `expected no live research required, got gaps: ${result.liveResearch.detectedGaps.join(", ")}`
  );
  assert.equal(result.conflictDetection.overallSeverity, null);
  assert.equal(result.evidenceCorroboration.highImpactRequirementsNotMet.length, 0);
  assert.ok(result.aggregateConfidence >= 70, `expected aggregateConfidence >= 70, got ${result.aggregateConfidence}`);
  assert.equal(result.executiveDecisionSignal, "proceed");
});

test("validateStageOutput reports success for output that matches its schema", () => {
  const validEmptyResult = {
    enabled: false,
    itemScores: [],
    overallPoolScore: 0,
    lowQualityItemIds: [],
    contradictions: [],
    missingEvidencePenalty: 0,
    scoringTrace: ["disabled"],
  };
  const check = validateStageOutput(evidenceQualityScoringResultSchema, validEmptyResult);
  assert.equal(check.success, true);
});

test("validateStageOutput reports a descriptive failure for output that does not match its schema", () => {
  const check = validateStageOutput(evidenceQualityScoringResultSchema, { enabled: "not-a-boolean" });
  assert.equal(check.success, false);
  assert.match(check.reason, /schema validation/i);
});

test("validateStageOutput works against any zod schema, not just one hardcoded shape", () => {
  const schema = z.object({ ok: z.boolean() }).strict();
  assert.equal(validateStageOutput(schema, { ok: true }).success, true);
  assert.equal(validateStageOutput(schema, { ok: "nope" }).success, false);
});

test("identical input always produces an identical result (determinism)", () => {
  const input = {
    enabled: true,
    now: FIXED_NOW,
    evidence: richEvidencePool(),
    sources: [{ name: "Gartner", sourceType: "industry_analyst", url: "https://gartner.com" }],
    conclusions: [{ id: "c1", statement: "The AI accounting software market is large and growing.", impact: "medium" }],
    domain: "business",
    decisionComplexity: "low",
  };
  const first = runBusinessIntelligenceOrchestration(input);
  const second = runBusinessIntelligenceOrchestration(input);
  assert.deepEqual(first, second);
});

test("every enum-typed field in the result is drawn only from its documented enum -- never fabricated", () => {
  const result = runBusinessIntelligenceOrchestration({ enabled: true, now: FIXED_NOW, evidence: richEvidencePool() });
  for (const stage of result.stagesExecuted) {
    assert.ok(orchestratorStageValues.includes(stage));
  }
  assert.ok(executiveDecisionSignalValues.includes(result.executiveDecisionSignal));
});

test("does not modify report generation, PDF generation, billing, or UI, and is only referenced by its Decision Engine v1 integration -- no other module or production route", async () => {
  assert.doesNotMatch(engineSource, /from ["'].*(?:pdf-engine|report-engine|report-jobs|billing|auth)/i);

  // decision-engine.ts is NOT itself a route -- it is only wired into
  // app/api/plan/route.ts behind its own, separate, still-disabled-by-
  // default DECISION_ENGINE_ENABLED_ENV_VAR flag (see
  // decision-engine.test.mjs / decision-engine-plan-integration.test.mjs).
  // route.ts itself must still never reference the Orchestrator directly.
  const planRouteSource = await readFile(new URL("../app/api/plan/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(planRouteSource, /business-intelligence-orchestrator|runBusinessIntelligenceOrchestration/);

  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (
      file === "business-intelligence-orchestrator.ts" ||
      // ZERINIX Decision Engine v1's Business Intelligence Orchestrator
      // integration (see decision-engine.ts's file header) legitimately
      // calls runBusinessIntelligenceOrchestration exactly once, for
      // supported Business Intelligence requests only.
      file === "decision-engine.ts" ||
      // ZERINIX Executive Decision System v1 legitimately type-imports
      // businessIntelligenceContextSchema to validate the Orchestrator
      // context it passes through unmodified from Decision Engine's own
      // output -- it never calls runBusinessIntelligenceOrchestration
      // itself.
      file === "executive-decision-system.ts" ||
      !file.endsWith(".ts")
    ) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /business-intelligence-orchestrator|runBusinessIntelligenceOrchestration/,
      `expected ${file} to not yet reference the new Business Intelligence Orchestrator`
    );
  }
});
