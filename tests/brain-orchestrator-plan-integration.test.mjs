import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runBrainOrchestrator } from "../app/lib/ai/brain-orchestrator.ts";
import { classifyAttachmentDocument, applyDocumentAwareModeOverride } from "../app/lib/ai/document-intelligence.ts";
import { createUniversalDocumentIntelligenceFallback } from "../app/lib/ai/universal-document-intelligence.ts";
import { buildDecisionPlan } from "../app/lib/ai/intelligence-router.ts";

const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

const STRONG_PRICING_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

Evidence supporting demand is attached, including signed letters of intent from three customers. According to the attached market research report, addressable demand exceeds $50,000,000.`;

const LEGAL_DOC_TEXT =
  "The Court of Appeal reviewed the plaintiff's litigation against the defendant and issued its verdict following testimony and jurisdiction review by counsel.";

function orchestratorBlockSource() {
  const start = planRouteSource.indexOf("ZERINIX Brain Orchestrator v1 integration");
  const marketIndex = planRouteSource.indexOf("const isMarketIntelligenceRequest =");
  assert.ok(start >= 0, "expected the Brain Orchestrator integration comment to exist");
  assert.ok(marketIndex > start, "expected isMarketIntelligenceRequest to follow the integration block");
  return planRouteSource.slice(start, marketIndex);
}

test("the /api/plan route wires Brain Orchestrator behind a feature flag, gated to non-chat (supported business) analysis modes", () => {
  const block = orchestratorBlockSource();

  assert.match(block, /process\.env\.ZERINIX_BRAIN_ORCHESTRATOR_ENABLED === "true"/);
  assert.match(block, /normalizeSelectedAnalysisMode\(body\.analysisMode\) !== "chat"/);
  assert.match(block, /if \(brainOrchestratorEnabled && isSupportedBrainOrchestratorContext\)/);
  assert.match(block, /runBrainOrchestrator\(/);

  // Only one call site exists, and it lives inside the flag-gated block --
  // proves there's no second, unconditional invocation anywhere else in
  // the route.
  const allOccurrences = planRouteSource.match(/runBrainOrchestrator\(/g) || [];
  assert.equal(allOccurrences.length, 1);
});

test("supported business requests (plan/market analysisMode) run through Brain Orchestrator and can reach a usable, non-fabricated recommendation", () => {
  const { execution } = runBrainOrchestrator({
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
  });

  assert.ok(execution.executedModules.includes("Document Intelligence"));
  assert.ok(execution.executedModules.includes("Decision Strategy Engine"));
  assert.notEqual(execution.finalDecisionState.status, "not_started");
});

test("unsupported inputs (legal documents, forced into chat mode) keep the safe existing behavior: the orchestrator gate excludes them, matching Layer 1's own override", () => {
  const documentClassification = classifyAttachmentDocument({
    assets: [{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }],
  });
  const documentRouting = applyDocumentAwareModeOverride({
    selectedMode: "plan",
    classification: documentClassification,
  });

  assert.equal(documentRouting.selectedMode, "chat");

  const block = orchestratorBlockSource();
  assert.match(block, /!== "chat"/);
});

test("insufficient evidence stops before report generation: the 422 response is returned before requestPayload/job creation, and before body.brainExecutionResult is attached", () => {
  const block = orchestratorBlockSource();
  const stopCheckIndex = block.indexOf('status === "insufficient_evidence"');
  const returnIndex = block.indexOf("return NextResponse.json(", stopCheckIndex);
  const attachIndex = block.indexOf("body.brainExecutionResult = brainExecution;");
  const requestPayloadIndex = planRouteSource.indexOf("const requestPayload = {");
  const insertIndex = planRouteSource.indexOf(".insert({");

  assert.ok(stopCheckIndex >= 0);
  assert.ok(returnIndex > stopCheckIndex);
  assert.ok(returnIndex < attachIndex, "the insufficient-evidence return must precede attaching brainExecutionResult");
  assert.match(block, /BRAIN_INSUFFICIENT_EVIDENCE/);
  assert.match(block, /status: 422/);
  assert.ok(planRouteSource.indexOf(block) < requestPayloadIndex);
  assert.ok(planRouteSource.indexOf(block) < insertIndex);
});

test("successful orchestration attaches BrainExecutionResult to body before requestPayload spreads it downstream", () => {
  const block = orchestratorBlockSource();
  assert.match(block, /body\.brainExecutionResult = brainExecution;/);

  const attachIndexAbsolute = planRouteSource.indexOf("body.brainExecutionResult = brainExecution;");
  const requestPayloadIndex = planRouteSource.indexOf("const requestPayload = {");
  const spreadIndex = planRouteSource.indexOf("...body,", requestPayloadIndex);

  assert.ok(attachIndexAbsolute < requestPayloadIndex);
  assert.ok(spreadIndex > requestPayloadIndex);
});

test("disabling the feature flag restores the previous flow exactly: the entire block (including the insufficient-evidence short-circuit) is gated by brainOrchestratorEnabled, and nothing after it depends on it", () => {
  const block = orchestratorBlockSource();
  const ifIndex = block.indexOf("if (brainOrchestratorEnabled && isSupportedBrainOrchestratorContext) {");
  const returnIndex = block.indexOf("return NextResponse.json(", block.indexOf('status === "insufficient_evidence"'));
  const attachIndex = block.indexOf("body.brainExecutionResult = brainExecution;");

  assert.ok(ifIndex >= 0);
  assert.ok(returnIndex > ifIndex, "the insufficient-evidence return must be inside the flag-gated if-block");
  assert.ok(attachIndex > ifIndex, "the brainExecutionResult attachment must be inside the flag-gated if-block");

  // The pre-existing dispatch this integration must never disturb starts
  // immediately after the block, unconditionally.
  assert.match(planRouteSource, /const isMarketIntelligenceRequest =\s*\n\s*normalizeSelectedAnalysisMode\(body\.analysisMode\) === "market";/);
});

test("no duplicate intelligence modules execute: the route passes already-computed Document Intelligence, Universal Document Intelligence, and Intelligence Router results as `precomputed` instead of recomputing them", () => {
  const block = orchestratorBlockSource();

  assert.doesNotMatch(block, /classifyAttachmentDocument\(/);
  assert.doesNotMatch(block, /createUniversalDocumentIntelligenceFallback\(/);
  assert.doesNotMatch(block, /buildDecisionPlan\(/);
  assert.match(block, /precomputed:\s*\{/);
  assert.match(block, /documentClassification,/);
  assert.match(block, /documentRouting: documentAwareRouting,/);
  assert.match(block, /universalDocumentIntelligence,/);
  assert.match(block, /decisionPlan,/);
});

test("no duplicate intelligence modules execute (behavioral): runBrainOrchestrator reuses precomputed results verbatim rather than recomputing them from the raw attachment text", () => {
  const precomputedDocumentClassification = classifyAttachmentDocument({
    assets: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
  });
  const precomputedDocumentRouting = applyDocumentAwareModeOverride({
    selectedMode: "plan",
    classification: precomputedDocumentClassification,
  });
  const precomputedUniversalDocumentIntelligence = createUniversalDocumentIntelligenceFallback({
    assets: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
  });
  const precomputedDecisionPlan = buildDecisionPlan({
    prompt: "We need to decide on our pricing strategy urgently.",
    documentIntelligence: precomputedUniversalDocumentIntelligence,
  });

  // Deliberately supply NO attachments/prompt of its own -- if the
  // orchestrator ignored `precomputed` and recomputed from the (empty)
  // input, it would produce different, "no signal" results instead of the
  // strong-pricing-derived ones supplied here.
  const { execution, results } = runBrainOrchestrator({
    precomputed: {
      documentClassification: precomputedDocumentClassification,
      documentRouting: precomputedDocumentRouting,
      universalDocumentIntelligence: precomputedUniversalDocumentIntelligence,
      decisionPlan: precomputedDecisionPlan,
    },
  });

  assert.deepEqual(results.documentIntelligence, precomputedDocumentClassification);
  assert.deepEqual(results.universalDocumentIntelligence, precomputedUniversalDocumentIntelligence);
  assert.deepEqual(results.decisionPlan, precomputedDecisionPlan);
  assert.ok(execution.executionTrace.some((line) => line.includes("Reusing precomputed Document Intelligence")));
  assert.ok(execution.executionTrace.some((line) => line.includes("Reusing precomputed Universal Document Intelligence")));
  assert.ok(execution.executionTrace.some((line) => line.includes("Reusing precomputed Intelligence Router")));
  assert.doesNotMatch(execution.executionTrace.join("\n"), /Running Document Intelligence\./);
  assert.doesNotMatch(execution.executionTrace.join("\n"), /Running Universal Document Intelligence\./);
  assert.doesNotMatch(execution.executionTrace.join("\n"), /Running Intelligence Router\./);
});

test("logging only records safe metadata (executed/skipped modules, stop reason, execution time), never evidencePipeline/confidencePipeline/results, which may contain raw document content", () => {
  const block = orchestratorBlockSource();
  const logCallStart = block.indexOf("logOperationalInfo(");
  const logCallEnd = block.indexOf(");", logCallStart) + 2;
  const logCall = block.slice(logCallStart, logCallEnd);

  assert.match(logCall, /executedModules/);
  assert.match(logCall, /skippedModules/);
  assert.match(logCall, /stopReason/);
  assert.match(logCall, /executionTimeMs/);
  assert.doesNotMatch(logCall, /evidencePipeline/);
  assert.doesNotMatch(logCall, /confidencePipeline/);
  assert.doesNotMatch(logCall, /brainOutput\.results/);
});

test("existing plan and market regression surfaces remain unchanged: every pre-existing assignment and check this integration sits between is still present verbatim", () => {
  assert.match(planRouteSource, /body\.decisionPlan = buildDecisionPlan/);
  assert.match(planRouteSource, /const decisionPlan = body\.decisionPlan as DecisionPlan;/);
  assert.match(planRouteSource, /body\.documentIntelligence = \{/);
  assert.match(planRouteSource, /body\.universalDocumentIntelligence = universalDocumentIntelligence;/);
  assert.match(planRouteSource, /existingJob\.status === "queued" \|\| existingJob\.status === "retry_wait"/);
  assert.match(planRouteSource, /resolveMarketIntelligenceLanguage\(/);
  assert.match(planRouteSource, /resolveReportLanguage\(/);
  assert.match(planRouteSource, /getSelectedModeMismatchMessage/);

  // The idempotency short-circuit still runs before the new integration
  // block, so retried/duplicate requests never reach Brain Orchestrator.
  const existingJobReturnIndex = planRouteSource.indexOf("return queuedResponse(existingJob, true);");
  const orchestratorIndex = planRouteSource.indexOf("ZERINIX Brain Orchestrator v1 integration");
  assert.ok(existingJobReturnIndex < orchestratorIndex);
});
