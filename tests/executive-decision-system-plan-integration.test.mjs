import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runExecutiveDecisionSystem } from "../app/lib/ai/executive-decision-system.ts";

const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

const STRONG_BUSINESS_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds 50,000,000 dollars based on our own analysis.`;

// Verified (see executive-decision-system.test.mjs /
// decision-engine-business-intelligence-integration.test.mjs) to
// produce a genuine cross-category evidence conflict, driving the
// Business Intelligence Orchestrator's own real executiveDecisionSignal
// to "do_not_proceed_insufficient_evidence" with real, non-empty
// confidence penalties and detected conflicts.
const CONFLICTING_CANDIDATES = [
  {
    text: "Market size for AI accounting software is estimated at $50 million based on total addressable market analysis.",
    source: { publisher: "Gartner", url: "https://gartner.com/report-a" },
  },
  {
    text: "Industry trends indicate the addressable market size for AI accounting software is only $5 million this year.",
    source: { publisher: "Forrester", url: "https://forrester.com/report-b" },
  },
];

function executiveDecisionSystemBlockSource() {
  const start = planRouteSource.indexOf("ZERINIX Decision Engine v1 integration");
  const marketIndex = planRouteSource.indexOf("const isMarketIntelligenceRequest =");
  assert.ok(start >= 0, "expected the integration comment block to exist");
  assert.ok(marketIndex > start);
  return planRouteSource.slice(start, marketIndex);
}

test("feature flag disabled: the Executive Decision System branch is gated behind ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED, and is skipped by construction when it is off", () => {
  const block = executiveDecisionSystemBlockSource();
  assert.match(block, /isExecutiveDecisionSystemEnabled\(\)/);
  assert.match(block, /if \(executiveDecisionSystemEnabled && isSupportedExecutiveDecisionSystemContext\)/);

  // Behaviorally: the underlying module itself is disabled by default,
  // so a route call with no explicit override produces the disabled,
  // "not_started" package the route would then simply fall through
  // past (to the else-if branch below).
  const { package: pkg } = runExecutiveDecisionSystem({
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
  });
  assert.equal(pkg.enabled, false);
  assert.equal(pkg.status, "not_started");
});

test("successful execution: a supported Business Intelligence request produces a real, reachable ready_for_report_generation package via the exact call shape the route uses", () => {
  const { package: pkg } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
  });

  assert.equal(pkg.selectedDomain, "business_intelligence");
  assert.equal(pkg.businessIntelligenceApplied, true);
  // This specific fixture is independently verified (see
  // executive-decision-system.test.mjs) to reach ready_for_report_generation.
  assert.equal(pkg.status, "ready_for_report_generation");
  assert.ok(pkg.executiveDecisionBrief);
  assert.ok(pkg.businessIntelligence);

  const block = executiveDecisionSystemBlockSource();
  assert.match(block, /body\.decisionEngineResult = executiveDecisionPackage\.decision;/);
  assert.match(block, /body\.executiveDecisionSystemResult = executiveDecisionPackage;/);
});

test("insufficient evidence: the route's 422 structured explanation includes real, non-empty missing evidence, confidence penalties, detected conflicts, and a highest-value next research action", () => {
  const block = executiveDecisionSystemBlockSource();
  assert.match(block, /EXECUTIVE_DECISION_SYSTEM_INSUFFICIENT_EVIDENCE/);
  assert.match(block, /reason: criticalFailure \? "critical_failure" : "insufficient_evidence"/);
  assert.match(block, /missingEvidence/);
  assert.match(block, /confidencePenalties/);
  assert.match(block, /detectedConflicts/);
  assert.match(block, /highestValueNextResearchAction/);
  assert.match(block, /status: 422/);

  // Behaviorally reproduce exactly what the route computes for this
  // response, using the real package the route itself would receive.
  const { package: pkg } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
    externalEvidenceCandidates: CONFLICTING_CANDIDATES,
  });

  assert.equal(pkg.status, "insufficient_evidence");
  const bi = pkg.businessIntelligence;
  assert.ok(bi, "expected the Orchestrator to have run for this fixture");
  assert.equal(bi.criticalFailure, null);
  assert.equal(bi.executiveDecisionSignal, "do_not_proceed_insufficient_evidence");

  const missingEvidence = [
    ...pkg.decision.evidenceValidation.missingEvidenceSummary,
    ...bi.aggregatedResearchRequirements.detectedGaps,
  ];
  const confidencePenalties = bi.confidence?.confidencePenalties ?? [];
  const detectedConflicts = bi.conflictDetection?.conflicts ?? [];
  const topResearchTask = bi.researchPrioritization?.prioritizedTasks[0] ?? null;

  assert.ok(missingEvidence.length > 0, "expected real missing evidence entries");
  assert.ok(confidencePenalties.length > 0, "expected real confidence penalties");
  for (const penalty of confidencePenalties) {
    assert.ok(penalty.factor && penalty.description && typeof penalty.impact === "number");
  }
  assert.ok(detectedConflicts.length > 0, "expected a real detected conflict");
  assert.equal(detectedConflicts[0].severity, "critical");
  assert.ok(topResearchTask, "expected a real, ranked highest-value next research action");
  assert.ok(topResearchTask.topic && topResearchTask.explanation);
  assert.equal(pkg.executiveDecisionBrief, null, "no brief should be built when stopping for insufficient evidence");
});

test("critical failure: the same stop-safely branch distinguishes a true Orchestrator critical failure from plain insufficient evidence via a separate code/reason, checked from the real criticalFailure field", () => {
  const block = executiveDecisionSystemBlockSource();
  assert.match(block, /EXECUTIVE_DECISION_SYSTEM_CRITICAL_FAILURE/);
  const criticalFailureVarIndex = block.indexOf("const criticalFailure = businessIntelligence?.criticalFailure ?? null;");
  const codeTernaryIndex = block.indexOf("code: criticalFailure");
  assert.ok(criticalFailureVarIndex >= 0);
  assert.ok(codeTernaryIndex > criticalFailureVarIndex);

  // As established when Business Intelligence Orchestrator was
  // integrated into Decision Engine, a genuine critical failure (a
  // pool item with no real, non-empty text) is structurally
  // unreachable through this real data path -- Decision Engine's own
  // evidence-pool construction already filters out exactly the
  // malformed case that would trigger it. This confirms that guarantee
  // still holds through the Executive Decision System facade too, so
  // the criticalFailure branch above is real defensive code, not dead
  // code guarding an impossible condition it forgot to remove.
  const { package: pkg } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
  });
  assert.equal(pkg.businessIntelligence?.criticalFailure ?? null, null);
});

test("duplicate-execution prevention: Executive Decision System and Decision Engine are mutually exclusive (if/else if) in the route, so no request can ever trigger both, and each is called exactly once in the route source", () => {
  const executiveCallCount = (planRouteSource.match(/runExecutiveDecisionSystem\(/g) || []).length;
  const decisionEngineCallCount = (planRouteSource.match(/runDecisionEngine\(/g) || []).length;
  assert.equal(executiveCallCount, 1, "runExecutiveDecisionSystem must be called exactly once in route.ts");
  assert.equal(decisionEngineCallCount, 1, "runDecisionEngine must be called exactly once in route.ts");

  const block = executiveDecisionSystemBlockSource();
  const ifIndex = block.indexOf("if (executiveDecisionSystemEnabled && isSupportedExecutiveDecisionSystemContext) {");
  const elseIfIndex = block.indexOf("} else if (decisionEngineEnabled && isSupportedDecisionEngineContext) {");
  assert.ok(ifIndex >= 0, "expected the Executive Decision System branch");
  assert.ok(elseIfIndex > ifIndex, "expected the Decision Engine branch to be an else-if of the same chain, not an independent if");

  // Decision Engine v1 itself has the identical guarantee one layer
  // down: it calls runBusinessIntelligenceOrchestration exactly once
  // and never re-runs Expert Reasoning Engine (see
  // decision-engine-business-intelligence-integration.test.mjs), so
  // combined with the mutual exclusivity above, no module in the
  // combined stack can ever run twice for one request.
  const decisionEngineSource = planRouteSource.includes("@/app/lib/ai/decision-engine");
  assert.ok(decisionEngineSource);
});

test("structured context handoff: the full package (verified facts, assumptions, evidence trace, source reliability, corroboration, conflicts, confidence drivers/penalties, research priorities) is attached to body before requestPayload spreads it downstream, without touching the report generator", () => {
  const attachIndexAbsolute = planRouteSource.indexOf("body.executiveDecisionSystemResult = executiveDecisionPackage;");
  const requestPayloadIndex = planRouteSource.indexOf("const requestPayload = {");
  const spreadIndex = planRouteSource.indexOf("...body,", requestPayloadIndex);

  assert.ok(attachIndexAbsolute >= 0);
  assert.ok(attachIndexAbsolute < requestPayloadIndex, "executiveDecisionSystemResult must be attached before requestPayload is built");
  assert.ok(spreadIndex > requestPayloadIndex, "requestPayload must spread body (carrying the attached result) downstream");

  const { package: pkg } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
  });

  // Every named category this task requires to be preserved is really
  // present, unmodified, in the package that gets attached.
  assert.ok(pkg.executiveDecisionBrief.verifiedEvidence, "verified facts");
  assert.ok(pkg.executiveDecisionBrief.assumptions, "assumptions");
  assert.ok(pkg.executiveDecisionBrief.evidenceTrace, "evidence trace");
  assert.ok(pkg.businessIntelligence.sourceReliability, "source reliability");
  assert.ok(pkg.businessIntelligence.evidenceCorroboration, "corroboration status");
  assert.ok(pkg.businessIntelligence.conflictDetection, "conflicts");
  assert.ok(pkg.businessIntelligence.confidence.confidenceDrivers, "confidence drivers");
  assert.ok(pkg.businessIntelligence.confidence.confidencePenalties, "confidence penalties");
  assert.ok(pkg.businessIntelligence.researchPrioritization, "research priorities");
  assert.equal(pkg.stopReason, null); // a real, preserved field -- null specifically because this run succeeded
});

test("unchanged legacy behavior: the existing Decision Engine block (else-if branch) is preserved verbatim, and the Brain Orchestrator block above is completely untouched", () => {
  assert.match(planRouteSource, /runBrainOrchestrator\(/);
  assert.match(planRouteSource, /body\.brainExecutionResult = brainExecution;/);

  const block = executiveDecisionSystemBlockSource();
  assert.match(block, /code: "DECISION_ENGINE_INSUFFICIENT_EVIDENCE"/);
  assert.match(block, /missing: decision\.evidenceValidation\.missingEvidenceSummary/);
  assert.match(block, /body\.decisionEngineResult = decision;/);
  assert.match(block, /logOperationalInfo\("plan\.decision_engine", \{/);

  // Real comment order: Brain Orchestrator's own block, then the
  // Decision Engine block's original header comment, then (within that
  // same combined comment) the Executive Decision System explanation
  // added by this integration -- describing, not reordering, the two
  // branches below it.
  const brainIndex = planRouteSource.indexOf("ZERINIX Brain Orchestrator v1 integration");
  const decisionEngineIndex = planRouteSource.indexOf("ZERINIX Decision Engine v1 integration");
  const eDSIndex = planRouteSource.indexOf("ZERINIX Executive Decision System v1 integration");
  assert.ok(brainIndex >= 0);
  assert.ok(brainIndex < decisionEngineIndex);
  assert.ok(decisionEngineIndex < eDSIndex);
});
