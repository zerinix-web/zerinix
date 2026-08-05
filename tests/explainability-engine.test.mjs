import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXPLAINABILITY_ENGINE_ENABLED_ENV_VAR,
  isExplainabilityEngineEnabled,
  explainabilityEngineResultSchema,
  explanationItemTypeValues,
  generateExplainabilityReport,
} from "../app/lib/report-engine/explainability-engine.ts";
import {
  runExecutiveDecisionSystem,
  executiveDecisionPackageSchema,
} from "../app/lib/ai/executive-decision-system.ts";
import { buildStrategicDecisionMemo, strategicDecisionMemoSchema } from "../app/lib/ai/strategic-decision-memo.ts";
import { generateExecutiveBrief, executiveBriefSchema } from "../app/lib/ai/executive-brief-generator.ts";
import { validateExecutiveReportQuality } from "../app/lib/report-engine/executive-report-quality-validator.ts";
import { checkReportConsistency } from "../app/lib/report-engine/report-consistency-checker.ts";

const explainabilityEngineSource = readFileSync("app/lib/report-engine/explainability-engine.ts", "utf8");
const workerSource = readFileSync("app/lib/report-jobs/worker.ts", "utf8");
const reportInvestmentScoreSource = readFileSync("app/lib/report-investment-score.ts", "utf8");

function withEnvFlag(value, fn) {
  const previous = process.env[EXPLAINABILITY_ENGINE_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[EXPLAINABILITY_ENGINE_ENABLED_ENV_VAR];
  } else {
    process.env[EXPLAINABILITY_ENGINE_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[EXPLAINABILITY_ENGINE_ENABLED_ENV_VAR];
    } else {
      process.env[EXPLAINABILITY_ENGINE_ENABLED_ENV_VAR] = previous;
    }
  }
}

const STRONG_BUSINESS_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds 50,000,000 dollars based on our own analysis.`;

function realSuccessfulPackage() {
  const { package: pkg } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
  });
  assert.equal(pkg.status, "ready_for_report_generation");
  return pkg;
}

function realMemoAndBrief(pkg) {
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });
  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg, strategicDecisionMemo: memo });
  return { memo, brief };
}

function itemsOfType(report, type) {
  return report.explanations.filter((item) => item.type === type);
}

// --- Flag behavior ---------------------------------------------------

test("isExplainabilityEngineEnabled reads the env var exactly", () => {
  assert.equal(isExplainabilityEngineEnabled({}), false);
  assert.equal(isExplainabilityEngineEnabled({ [EXPLAINABILITY_ENGINE_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isExplainabilityEngineEnabled({ [EXPLAINABILITY_ENGINE_ENABLED_ENV_VAR]: "true" }), true);
});

test("by default (no env var, no override) no explanations are generated, even with real inputs available", () => {
  withEnvFlag(undefined, () => {
    const pkg = realSuccessfulPackage();
    const { memo, brief } = realMemoAndBrief(pkg);
    const report = generateExplainabilityReport({
      executiveDecisionPackage: pkg,
      strategicDecisionMemo: memo,
      executiveBrief: brief,
    });
    assert.equal(explainabilityEngineResultSchema.safeParse(report).success, true);
    assert.equal(report.enabled, false);
    assert.equal(report.generated, false);
    assert.deepEqual(report.explanations, []);
  });
});

test("an explicit enabled:true overrides the env var", () => {
  const report = generateExplainabilityReport({ enabled: true });
  assert.equal(report.enabled, true);
  assert.equal(report.generated, true);
});

test("setting the env var to 'true' also enables generation", () => {
  withEnvFlag("true", () => {
    const report = generateExplainabilityReport({});
    assert.equal(report.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const report = generateExplainabilityReport({ enabled: false });
    assert.equal(report.enabled, false);
  });
});

test("calling with the default argument (no input at all) is safe and returns a disabled, schema-valid result", () => {
  const report = generateExplainabilityReport();
  assert.equal(explainabilityEngineResultSchema.safeParse(report).success, true);
  assert.equal(report.enabled, false);
});

// --- Never invokes an LLM ---------------------------------------------

test("never invokes an LLM: the module imports no OpenAI/runtime/network client", () => {
  assert.doesNotMatch(explainabilityEngineSource, /openai|fetch\(|createOpenAiClient|runtime\.ts/i);
});

// --- Structured result shape -----------------------------------------

test("explanationItemTypeValues contains exactly the 5 documented conclusion kinds", () => {
  assert.deepEqual(
    [...explanationItemTypeValues].sort(),
    ["recommendation", "verdict", "risk", "opportunity", "confidence"].sort()
  );
});

test("explanations are ordered recommendation, verdict, risk, opportunity, confidence", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const report = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const order = ["recommendation", "verdict", "risk", "opportunity", "confidence"];
  let lastIndex = -1;
  for (const item of report.explanations) {
    const typeIndex = order.indexOf(item.type);
    assert.ok(typeIndex >= lastIndex, `"${item.type}" appeared out of the documented order`);
    lastIndex = typeIndex;
  }
});

test("every explanation carries a statement, reasoning, evidenceIds, engines, assumptions, and validation/consistency outcomes -- schema-valid across a fully populated real scenario", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const qualityValidation = validateExecutiveReportQuality({
    enabled: true,
    sections: [{ field: "executiveSummary", title: "Executive Summary", content: "Decision: HOLD. Real content for this section." }],
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const consistencyCheck = checkReportConsistency({
    enabled: true,
    sections: [],
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const report = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
    qualityValidation,
    consistencyCheck,
  });
  assert.equal(explainabilityEngineResultSchema.safeParse(report).success, true);
  assert.ok(report.explanations.length > 0);
  for (const item of report.explanations) {
    assert.ok(item.statement.length > 0);
    assert.ok(item.reasoning.length > 0);
    assert.ok(item.engines.length > 0);
    assert.equal(item.validation.validated, true);
    assert.equal(item.consistency.checked, true);
  }
});

// --- Determinism ---------------------------------------------------

test("identical input (including an explicit `now`) always produces an identical result", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const input = {
    enabled: true,
    executiveDecisionPackage: structuredClone(pkg),
    strategicDecisionMemo: structuredClone(memo),
    executiveBrief: structuredClone(brief),
    now: 1_700_000_000_000,
  };
  const a = generateExplainabilityReport(input);
  const b = generateExplainabilityReport({
    ...input,
    executiveDecisionPackage: structuredClone(pkg),
    strategicDecisionMemo: structuredClone(memo),
    executiveBrief: structuredClone(brief),
  });
  assert.deepEqual(a, b);
});

// --- recommendation ------------------------------------------------

test("recommendation: a plain 'brief_next_action' recommendation quotes its real statement, has no evidence ID, and never fabricates one", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const report = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const recommendations = itemsOfType(report, "recommendation");
  assert.equal(recommendations.length, memo.recommendedActions.length);
  const briefAction = recommendations.find((_, index) => memo.recommendedActions[index].source === "brief_next_action");
  assert.ok(briefAction);
  const matching = memo.recommendedActions.find((action) => action.action === briefAction.statement);
  assert.ok(matching);
  assert.equal(briefAction.statement, matching.action);
  assert.deepEqual(briefAction.evidenceIds, []);
});

test("recommendation: a 'top_research_priority' recommendation cites the real prioritized task's taskId and the research prioritization engine", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const researchAction = memo.recommendedActions.find((action) => action.source === "top_research_priority");
  assert.ok(researchAction, "fixture must produce a top_research_priority recommendation");
  const topTask = pkg.businessIntelligence.researchPrioritization.prioritizedTasks.find(
    (task) => task.topic === researchAction.action
  );
  assert.ok(topTask);

  const report = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const item = itemsOfType(report, "recommendation").find((entry) => entry.statement === researchAction.action);
  assert.ok(item);
  assert.deepEqual(item.evidenceIds, [topTask.taskId]);
  assert.ok(item.engines.includes("research-prioritization-engine@1"));
});

test("recommendation: assumptions applied are exactly the real intersection of the action's own supportingEvidence with the real assumptions list", () => {
  const pkg = realSuccessfulPackage();
  const { memo: baseMemo, brief } = realMemoAndBrief(pkg);
  const memo = structuredClone(baseMemo);
  const assumptionText = "This is a real assumption embedded verbatim in a recommendation.";
  memo.assumptions = [assumptionText];
  memo.recommendedActions = [
    { action: `Consider: ${assumptionText}`, supportingEvidence: [assumptionText], source: "brief_next_action" },
  ];
  assert.equal(strategicDecisionMemoSchema.safeParse(memo).success, true);

  const report = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const item = itemsOfType(report, "recommendation")[0];
  assert.deepEqual(item.assumptions, [assumptionText]);
});

test("recommendation: absent (empty array) when neither the Memo nor the Brief has any real recommended action", () => {
  const report = generateExplainabilityReport({ enabled: true });
  assert.deepEqual(itemsOfType(report, "recommendation"), []);
});

// --- risk ------------------------------------------------------------

test("risk: a plain key risk has no evidence ID and cites the Executive Decision Brief, never the Conflict Detection Engine", () => {
  const pkg = realSuccessfulPackage();
  const { memo: baseMemo, brief } = realMemoAndBrief(pkg);
  const memo = structuredClone(baseMemo);
  memo.risks = ["Regulatory changes could increase compliance costs substantially next year."];
  assert.equal(strategicDecisionMemoSchema.safeParse(memo).success, true);

  const report = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const item = itemsOfType(report, "risk")[0];
  assert.equal(item.statement, memo.risks[0]);
  assert.deepEqual(item.evidenceIds, []);
  assert.ok(!item.engines.includes("conflict-detection-engine@1"));
});

test("risk: a conflict-derived risk (matching strategic-decision-memo.ts's own formatting) cites the real conflict's evidence item IDs", () => {
  const pkg = realSuccessfulPackage();
  const { memo: baseMemo, brief } = realMemoAndBrief(pkg);

  const conflict = {
    topicId: "topic_0",
    a: "item_0",
    b: "item_1",
    sourceA: "source A",
    sourceB: "source B",
    reason: "Revenue figures disagree by 40%",
    conflictType: "numeric_mismatch",
    severity: "high",
  };
  const mutatedPkg = structuredClone(pkg);
  mutatedPkg.businessIntelligence.conflictDetection = {
    enabled: true,
    topicGroups: [],
    conflicts: [conflict],
    disagreeingSources: [],
    overallSeverity: "high",
    confidenceImpact: 10,
    additionalResearchRecommended: true,
    researchRecommendations: [],
    scoringTrace: [],
  };
  const pkgCheck = executiveDecisionPackageSchema.safeParse(mutatedPkg);
  assert.equal(pkgCheck.success, true);

  const memo = structuredClone(baseMemo);
  memo.risks = ["Unresolved evidence conflict [high]: Revenue figures disagree by 40%"];
  assert.equal(strategicDecisionMemoSchema.safeParse(memo).success, true);

  const report = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkgCheck.data,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const item = itemsOfType(report, "risk")[0];
  assert.deepEqual(item.evidenceIds, ["item_0", "item_1"]);
  assert.ok(item.engines.includes("conflict-detection-engine@1"));
  assert.match(item.reasoning[0], /topic "topic_0"/);
});

test("risk: absent (empty array) when neither the Memo nor the Brief has any real risk", () => {
  const report = generateExplainabilityReport({ enabled: true });
  assert.deepEqual(itemsOfType(report, "risk"), []);
});

// --- opportunity -------------------------------------------------------

test("opportunity: always has an empty evidenceIds array -- no genuine per-opportunity ID exists anywhere upstream, so none is ever invented", () => {
  const pkg = realSuccessfulPackage();
  const { memo: baseMemo, brief } = realMemoAndBrief(pkg);
  const memo = structuredClone(baseMemo);
  memo.opportunities = ["International expansion into new markets offers substantial growth potential."];
  assert.equal(strategicDecisionMemoSchema.safeParse(memo).success, true);

  const report = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const item = itemsOfType(report, "opportunity")[0];
  assert.equal(item.statement, memo.opportunities[0]);
  assert.deepEqual(item.evidenceIds, []);
});

test("opportunity: absent (empty array) when neither the Memo nor the Brief has any real opportunity", () => {
  const report = generateExplainabilityReport({ enabled: true });
  assert.deepEqual(itemsOfType(report, "opportunity"), []);
});

// --- verdict -----------------------------------------------------------

test("verdict: present with the real executive decision signal and recommendation status when Business Intelligence ran", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const report = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const verdict = itemsOfType(report, "verdict")[0];
  assert.ok(verdict);
  assert.match(verdict.statement, new RegExp(`"${pkg.businessIntelligence.executiveDecisionSignal}"`));
  assert.ok(verdict.engines.includes("business-intelligence-orchestrator@1"));
  assert.equal(verdict.assumptions.length, memo.assumptions.length);
});

test("verdict: absent when Business Intelligence never ran", () => {
  const report = generateExplainabilityReport({ enabled: true });
  assert.deepEqual(itemsOfType(report, "verdict"), []);
});

// --- confidence ----------------------------------------------------------

test("confidence: prefers the Memo's aggregate confidence, then the Brief's, then Business Intelligence's own, in that order", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);

  const withMemo = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  assert.match(itemsOfType(withMemo, "confidence")[0].statement, new RegExp(`${memo.confidence.aggregateConfidence}/100`));

  const withBriefOnly = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    executiveBrief: brief,
  });
  assert.match(
    itemsOfType(withBriefOnly, "confidence")[0].statement,
    new RegExp(`${brief.confidenceAssessment.aggregateConfidence}/100`)
  );

  const withPackageOnly = generateExplainabilityReport({ enabled: true, executiveDecisionPackage: pkg });
  assert.match(
    itemsOfType(withPackageOnly, "confidence")[0].statement,
    new RegExp(`${pkg.businessIntelligence.aggregateConfidence}/100`)
  );
});

test("confidence: absent (never a fabricated number) when no real confidence source exists at all", () => {
  const report = generateExplainabilityReport({ enabled: true });
  assert.deepEqual(itemsOfType(report, "confidence"), []);
});

test("confidence: reasoning quotes real confidence drivers/penalties by their real factor name, never an invented explanation", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const report = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const item = itemsOfType(report, "confidence")[0];
  for (const penalty of memo.confidence.penalties.slice(0, 3)) {
    assert.ok(item.reasoning.some((line) => line.includes(`"${penalty.factor}"`) && line.includes(penalty.description)));
  }
});

// --- validationResult / consistencyOutcome attribution -------------------

test("validation: a missing 'risks' section (Quality Validator) is attributed to every real risk item", () => {
  const pkg = realSuccessfulPackage();
  const { memo: baseMemo, brief } = realMemoAndBrief(pkg);
  const memo = structuredClone(baseMemo);
  memo.risks = ["Regulatory changes could increase compliance costs substantially next year."];
  assert.equal(strategicDecisionMemoSchema.safeParse(memo).success, true);

  const qualityValidation = validateExecutiveReportQuality({
    enabled: true,
    sections: [{ field: "executiveSummary", title: "Executive Summary", content: "Decision: HOLD. Real content here." }],
    expectedFields: ["executiveSummary", "risks"],
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  assert.ok(qualityValidation.issues.some((issue) => issue.field === "risks"));

  const report = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
    qualityValidation,
  });
  const riskItem = itemsOfType(report, "risk")[0];
  assert.equal(riskItem.validation.validated, true);
  assert.equal(riskItem.validation.passed, false);
  assert.equal(riskItem.validation.issueCount, 1);

  const recommendationItem = itemsOfType(report, "recommendation")[0];
  assert.equal(recommendationItem.validation.issueCount, 0);
});

test("consistency: a confidence_score_mismatch between Memo and Brief is attributed to the confidence explanation", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief: baseBrief } = realMemoAndBrief(pkg);
  const mismatchedBrief = structuredClone(baseBrief);
  mismatchedBrief.confidenceAssessment.aggregateConfidence = Math.min(
    100,
    baseBrief.confidenceAssessment.aggregateConfidence + 30
  );
  assert.equal(executiveBriefSchema.safeParse(mismatchedBrief).success, true);

  const consistencyCheck = checkReportConsistency({
    enabled: true,
    sections: [],
    strategicDecisionMemo: memo,
    executiveBrief: mismatchedBrief,
  });
  assert.ok(consistencyCheck.issues.some((issue) => issue.type === "confidence_score_mismatch"));

  const report = generateExplainabilityReport({
    enabled: true,
    strategicDecisionMemo: memo,
    executiveBrief: mismatchedBrief,
    consistencyCheck,
  });
  const confidenceItem = itemsOfType(report, "confidence")[0];
  assert.equal(confidenceItem.consistency.checked, true);
  assert.equal(confidenceItem.consistency.consistent, false);
});

test("consistency: a risk/opportunity contradiction is attributed to both the risk and the opportunity explanations", () => {
  const pkg = realSuccessfulPackage();
  const { memo: baseMemo, brief } = realMemoAndBrief(pkg);
  const sentence = "Market saturation is a significant concern for long-term growth potential here.";
  const contradictoryMemo = structuredClone(baseMemo);
  contradictoryMemo.risks = [sentence];
  contradictoryMemo.opportunities = [sentence];
  assert.equal(strategicDecisionMemoSchema.safeParse(contradictoryMemo).success, true);

  const consistencyCheck = checkReportConsistency({
    enabled: true,
    sections: [],
    strategicDecisionMemo: contradictoryMemo,
  });
  assert.ok(consistencyCheck.issues.some((issue) => issue.type === "risk_opportunity_contradiction"));

  const report = generateExplainabilityReport({
    enabled: true,
    strategicDecisionMemo: contradictoryMemo,
    executiveBrief: brief,
    consistencyCheck,
  });
  assert.equal(itemsOfType(report, "risk")[0].consistency.consistent, false);
  assert.equal(itemsOfType(report, "opportunity")[0].consistency.consistent, false);
});

test("consistency: a verdict_recommendation_mismatch is attributed to the verdict explanation only", () => {
  const pkg = realSuccessfulPackage();
  const contradictoryPkg = executiveDecisionPackageSchema.parse(
    (() => {
      const base = structuredClone(pkg);
      base.businessIntelligence.executiveDecisionSignal = "do_not_proceed_insufficient_evidence";
      base.executiveDecisionBrief.recommendationStatus = "proceed";
      return base;
    })()
  );
  const consistencyCheck = checkReportConsistency({
    enabled: true,
    sections: [],
    executiveDecisionPackage: contradictoryPkg,
  });
  assert.ok(consistencyCheck.issues.some((issue) => issue.type === "verdict_recommendation_mismatch"));

  const report = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: contradictoryPkg,
    consistencyCheck,
  });
  const verdict = itemsOfType(report, "verdict")[0];
  assert.equal(verdict.consistency.consistent, false);
});

test("validation/consistency: report 'no data' (null passed/consistent) rather than guessing when the validator/checker result was never supplied", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const report = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  for (const item of report.explanations) {
    assert.equal(item.validation.validated, false);
    assert.equal(item.validation.passed, null);
    assert.equal(item.consistency.checked, false);
    assert.equal(item.consistency.consistent, null);
  }
});

// --- worker.ts pipeline integration (static, matching this codebase's
// established convention for testing worker.ts) ----------------------

test("worker.ts calls generateExplainabilityReport exactly once, AFTER the Report Audit Trail Generator, and before persistCompletedReport", () => {
  const auditTrailIndex = workerSource.indexOf("const auditTrail = generateReportAuditTrail({");
  const explainabilityIndex = workerSource.indexOf("const explainability = generateExplainabilityReport({");
  const persistIndex = workerSource.indexOf("await persistCompletedReport({ supabase, job, report });");

  assert.ok(auditTrailIndex >= 0 && explainabilityIndex > auditTrailIndex);
  assert.ok(persistIndex > explainabilityIndex);

  const callCount = (workerSource.match(/generateExplainabilityReport\(/g) || []).length;
  assert.equal(callCount, 1, "generateExplainabilityReport must be called exactly once");
});

test("worker.ts passes generateExplainabilityReport the already-computed qualityValidation and consistencyCheck results, never recomputing them or the Executive Decision System artifacts", () => {
  const callStart = workerSource.indexOf("const explainability = generateExplainabilityReport({");
  const callEnd = workerSource.indexOf("});", callStart);
  const callBlock = workerSource.slice(callStart, callEnd);

  assert.match(callBlock, /job\.request_payload\.executiveDecisionSystemResult/);
  assert.match(callBlock, /job\.request_payload\.strategicDecisionMemo/);
  assert.match(callBlock, /job\.request_payload\.executiveBrief/);
  assert.match(callBlock, /\bqualityValidation\b/);
  assert.match(callBlock, /\bconsistencyCheck\b/);

  assert.equal((workerSource.match(/validateExecutiveReportQuality\(/g) || []).length, 1);
  assert.equal((workerSource.match(/checkReportConsistency\(/g) || []).length, 1);
  assert.equal((workerSource.match(/runExecutiveDecisionSystem\(/g) || []).length, 0, "worker.ts never runs EDS itself -- it only reads the already-attached request_payload fields");
});

test("worker.ts never throws from the explainability block -- it only explains, unlike the two blocking validators earlier in the pipeline", () => {
  const callStart = workerSource.indexOf("const explainability = generateExplainabilityReport({");
  const persistenceStart = workerSource.indexOf("const persistenceStartedAt = Date.now();", callStart);
  const block = workerSource.slice(callStart, persistenceStart);
  assert.doesNotMatch(block, /throw new Error/);
});

test("worker.ts attaches the explainability report to report.metadata additively, alongside (never replacing) the quality validation, consistency check, and audit trail results", () => {
  assert.match(
    workerSource,
    /report\.metadata = \{ \.\.\.\(report\.metadata \|\| \{\}\), reportExplainability: explainability \};/
  );
  assert.match(workerSource, /reportQualityValidation: qualityValidation/);
  assert.match(workerSource, /reportConsistencyCheck: consistencyCheck/);
  assert.match(workerSource, /reportAuditTrail: auditTrail/);
  assert.match(workerSource, /reportExplainability: explainability/);
});

test("ReportMetadata gained exactly one new, optional field for this integration, in addition to (not instead of) the three prior additive fields", () => {
  assert.match(reportInvestmentScoreSource, /reportExplainability\?:/);
  assert.match(reportInvestmentScoreSource, /reportAuditTrail\?:/);
  assert.match(reportInvestmentScoreSource, /reportQualityValidation\?:/);
  assert.match(reportInvestmentScoreSource, /reportConsistencyCheck\?:/);
});

test("does not modify PDF generation, UI, billing, authentication, or routing -- only worker.ts (report persistence) and an additive metadata type were touched", () => {
  const pdfButtonSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
  assert.doesNotMatch(pdfButtonSource, /explainability-engine/i);

  const planRouteSource = readFileSync("app/api/plan/route.ts", "utf8");
  assert.doesNotMatch(planRouteSource, /explainability-engine|generateExplainabilityReport/i);
});
