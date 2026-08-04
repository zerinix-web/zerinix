import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runDecisionEngine } from "../app/lib/ai/decision-engine.ts";

const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

const STRONG_PRICING_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds $50,000,000 based on our own analysis.`;

const LEGAL_DOC_TEXT =
  "The Court of Appeal reviewed the plaintiff's litigation against the defendant and issued its verdict following testimony and jurisdiction review by counsel.";

function decisionEngineBlockSource() {
  const start = planRouteSource.indexOf("ZERINIX Decision Engine v1 integration");
  const marketIndex = planRouteSource.indexOf("const isMarketIntelligenceRequest =");
  assert.ok(start >= 0, "expected the Decision Engine integration comment to exist");
  assert.ok(marketIndex > start, "expected isMarketIntelligenceRequest to follow the integration block");
  return planRouteSource.slice(start, marketIndex);
}

test("the /api/plan route wires Decision Engine behind its own feature flag, gated to non-chat (supported) analysis modes", () => {
  const block = decisionEngineBlockSource();

  assert.match(block, /isDecisionEngineEnabled\(\)/);
  assert.match(block, /normalizeSelectedAnalysisMode\(body\.analysisMode\) !== "chat"/);
  assert.match(block, /if \(decisionEngineEnabled && isSupportedDecisionEngineContext\)/);
  assert.match(block, /runDecisionEngine\(/);

  const allOccurrences = planRouteSource.match(/runDecisionEngine\(/g) || [];
  assert.equal(allOccurrences.length, 1);
});

test("the Decision Engine block is independent of, and does not remove or modify, the existing Brain Orchestrator integration", () => {
  assert.match(planRouteSource, /runBrainOrchestrator\(/);
  assert.match(planRouteSource, /brainOrchestratorEnabled/);
  assert.match(planRouteSource, /body\.brainExecutionResult = brainExecution;/);

  const brainIndex = planRouteSource.indexOf("ZERINIX Brain Orchestrator v1 integration");
  const decisionIndex = planRouteSource.indexOf("ZERINIX Decision Engine v1 integration");
  assert.ok(brainIndex >= 0);
  assert.ok(decisionIndex > brainIndex, "Decision Engine block should follow the Brain Orchestrator block");
});

test("insufficient evidence stops before requestPayload/job creation, returning a 422 with a structured explanation", () => {
  const block = decisionEngineBlockSource();
  const statusCheckIndex = block.indexOf('decision.status !== "ready_for_report_generation"');
  const returnIndex = block.indexOf("return NextResponse.json(", statusCheckIndex);
  const attachIndex = block.indexOf("body.decisionEngineResult = decision;");
  const requestPayloadIndex = planRouteSource.indexOf("const requestPayload = {");
  const insertIndex = planRouteSource.indexOf(".insert({");

  assert.ok(statusCheckIndex >= 0);
  assert.ok(returnIndex > statusCheckIndex);
  assert.ok(returnIndex < attachIndex, "the insufficient-evidence return must precede attaching decisionEngineResult");
  assert.match(block, /DECISION_ENGINE_INSUFFICIENT_EVIDENCE/);
  assert.match(block, /status: 422/);
  const blockAbsoluteIndex = planRouteSource.indexOf(block);
  assert.ok(blockAbsoluteIndex < requestPayloadIndex);
  assert.ok(blockAbsoluteIndex < insertIndex);
});

test("successful orchestration attaches decisionEngineResult to body before requestPayload spreads it downstream", () => {
  const block = decisionEngineBlockSource();
  assert.match(block, /body\.decisionEngineResult = decision;/);

  const attachIndexAbsolute = planRouteSource.indexOf("body.decisionEngineResult = decision;");
  const requestPayloadIndex = planRouteSource.indexOf("const requestPayload = {");
  const spreadIndex = planRouteSource.indexOf("...body,", requestPayloadIndex);

  assert.ok(attachIndexAbsolute < requestPayloadIndex);
  assert.ok(spreadIndex > requestPayloadIndex);
});

test("disabling the feature flag (the default) restores the previous flow exactly: the entire block, including the insufficient-evidence short-circuit, is gated inside the flag check", () => {
  const block = decisionEngineBlockSource();
  const ifIndex = block.indexOf("if (decisionEngineEnabled && isSupportedDecisionEngineContext) {");
  const returnIndex = block.indexOf(
    "return NextResponse.json(",
    block.indexOf('decision.status !== "ready_for_report_generation"')
  );
  const attachIndex = block.indexOf("body.decisionEngineResult = decision;");

  assert.ok(ifIndex >= 0);
  assert.ok(returnIndex > ifIndex, "the insufficient-evidence return must be inside the flag-gated if-block");
  assert.ok(attachIndex > ifIndex, "the decisionEngineResult attachment must be inside the flag-gated if-block");

  assert.match(
    planRouteSource,
    /const isMarketIntelligenceRequest =\s*\n\s*normalizeSelectedAnalysisMode\(body\.analysisMode\) === "market";/
  );
});

test("existing plan and market regression surfaces remain unchanged: every pre-existing assignment and check this integration sits between is still present verbatim", () => {
  assert.match(planRouteSource, /body\.decisionPlan = buildDecisionPlan/);
  assert.match(planRouteSource, /body\.documentIntelligence = \{/);
  assert.match(planRouteSource, /body\.universalDocumentIntelligence = universalDocumentIntelligence;/);
  assert.match(planRouteSource, /existingJob\.status === "queued" \|\| existingJob\.status === "retry_wait"/);
  assert.match(planRouteSource, /resolveMarketIntelligenceLanguage\(/);
  assert.match(planRouteSource, /resolveReportLanguage\(/);
  assert.match(planRouteSource, /getSelectedModeMismatchMessage/);

  const existingJobReturnIndex = planRouteSource.indexOf("return queuedResponse(existingJob, true);");
  const decisionEngineIndex = planRouteSource.indexOf("ZERINIX Decision Engine v1 integration");
  assert.ok(existingJobReturnIndex < decisionEngineIndex);
});

test("logging only records safe metadata (executed/skipped stages, status, stop reason, execution time), never raw evidence/pipeline results", () => {
  const block = decisionEngineBlockSource();
  const logCallStart = block.indexOf("logOperationalInfo(");
  const logCallEnd = block.indexOf(");", logCallStart) + 2;
  const logCall = block.slice(logCallStart, logCallEnd);

  assert.match(logCall, /executedStages/);
  assert.match(logCall, /skippedStages/);
  assert.match(logCall, /status/);
  assert.match(logCall, /stopReason/);
  assert.match(logCall, /executionTimeMs/);
  assert.doesNotMatch(logCall, /decisionEngineOutput\.results/);
});

test("(behavioral) the module the route calls actually reaches ready_for_report_generation for a supported business request, and insufficient_evidence for a legal document -- proving the route's two branches correspond to real, reachable outcomes", () => {
  const business = runDecisionEngine({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
  });
  assert.equal(business.decision.status, "ready_for_report_generation");

  const legal = runDecisionEngine({
    enabled: true,
    prompt: "Please review this.",
    attachments: [{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }],
  });
  assert.equal(legal.decision.status, "insufficient_evidence");
  assert.ok(legal.decision.stopReason);
});
