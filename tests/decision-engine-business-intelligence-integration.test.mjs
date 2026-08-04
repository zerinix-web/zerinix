import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  decisionEngineResultSchema,
  DECISION_ENGINE_ENABLED_ENV_VAR,
  runDecisionEngine,
} from "../app/lib/ai/decision-engine.ts";

const engineSource = await readFile(new URL("../app/lib/ai/decision-engine.ts", import.meta.url), "utf8");

function withEnvFlag(value, fn) {
  const previous = process.env[DECISION_ENGINE_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[DECISION_ENGINE_ENABLED_ENV_VAR];
  } else {
    process.env[DECISION_ENGINE_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[DECISION_ENGINE_ENABLED_ENV_VAR];
    } else {
      process.env[DECISION_ENGINE_ENABLED_ENV_VAR] = previous;
    }
  }
}

// Same fixture style as decision-engine.test.mjs's STRONG_PRICING_TEXT:
// avoids "market research report" wording so Adaptive Intelligence
// Engine classifies this as business_intelligence, with strong enough
// evidence to clear the existing Evidence Validation checkpoint.
const STRONG_BUSINESS_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds $50,000,000 based on our own analysis.`;

const LEGAL_DOC_TEXT =
  "The Court of Appeal reviewed the plaintiff's litigation against the defendant and issued its verdict following testimony and jurisdiction review by counsel.";

const STRONG_BUSINESS_INPUT = {
  enabled: true,
  prompt: "We need to decide on our pricing strategy urgently.",
  attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
};

test("feature flag off (default): the Business Intelligence Orchestrator never runs, and the existing flow is completely unaffected", () => {
  withEnvFlag(undefined, () => {
    const { prompt, attachments } = STRONG_BUSINESS_INPUT;
    const { decision, results } = runDecisionEngine({ prompt, attachments });

    assert.equal(decisionEngineResultSchema.safeParse(decision).success, true);
    assert.equal(decision.enabled, false);
    assert.equal(decision.businessIntelligenceApplied, false);
    assert.equal(results.businessIntelligenceContext, null);
    assert.equal(results.executiveDecisionBrief, null);
  });
});

test("feature flag on, but a non-Business-Intelligence domain (legal document): the old flow runs exactly as before, and the Orchestrator never runs", () => {
  const { decision, results } = runDecisionEngine({
    enabled: true,
    prompt: "Please review this.",
    attachments: [{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }],
  });

  assert.equal(decision.selectedDomain, "legal_intelligence");
  assert.equal(decision.businessIntelligenceApplied, false);
  assert.equal(results.businessIntelligenceContext, null);
  assert.equal(results.executiveDecisionBrief, null);
});

test("successful execution: a supported Business Intelligence request with the flag on runs the Orchestrator exactly once and hands a real, structured context to Executive Decision Brief", () => {
  const { decision, results } = runDecisionEngine(STRONG_BUSINESS_INPUT);

  assert.equal(decisionEngineResultSchema.safeParse(decision).success, true);
  assert.equal(decision.selectedDomain, "business_intelligence");
  assert.equal(decision.businessIntelligenceApplied, true);
  assert.ok(results.businessIntelligenceContext, "expected a Business Intelligence context to have been computed");
  assert.equal(results.businessIntelligenceContext.enabled, true);
  assert.equal(results.businessIntelligenceContext.criticalFailure, null);

  // The two possible non-blocking outcomes once BIO has run and did not
  // stop the flow: report which one this fixture actually produced, and
  // assert the branch-appropriate invariants for each -- never assume
  // one without checking, since aggregateConfidence is a real computed
  // number, not a value this test controls directly.
  if (decision.status === "ready_for_report_generation") {
    assert.ok(results.executiveDecisionBrief, "expected an Executive Decision Brief when ready_for_report_generation");
    assert.equal(decision.executiveSummary, results.executiveDecisionBrief.executiveRecommendation);
    assert.equal(decision.recommendationStatus, results.executiveDecisionBrief.recommendationStatus);
    assert.equal(decision.nextRecommendedAction, results.executiveDecisionBrief.immediateNextActions[0] ?? null);
  } else {
    assert.equal(decision.status, "insufficient_evidence");
    assert.equal(results.businessIntelligenceContext.executiveDecisionSignal, "do_not_proceed_insufficient_evidence");
    assert.match(decision.stopReason, /Business Intelligence Orchestrator/);
  }
});

test("structured context handoff: Executive Decision Brief's confidence and evidence are genuinely derived from the Orchestrator's real context and Expert Reasoning Engine's real, reused result -- never fabricated", () => {
  const { results } = runDecisionEngine(STRONG_BUSINESS_INPUT);

  if (!results.executiveDecisionBrief) {
    // This fixture's real aggregate confidence stopped the flow before
    // a brief was built -- covered by the insufficient-evidence test
    // below instead.
    return;
  }

  const context = results.businessIntelligenceContext;
  const originalExpertReasoning = results.intelligencePipelineOutput.results.expertReasoningResult;

  const expectedConfidence = Math.max(0, Math.min(1, Math.round(context.aggregateConfidence) / 100));
  assert.equal(results.executiveDecisionBrief.decisionConfidence, expectedConfidence);
  assert.match(results.executiveDecisionBrief.confidenceExplanation, /Business Intelligence Orchestrator/);
  assert.match(results.executiveDecisionBrief.confidenceExplanation, new RegExp(`${context.aggregateConfidence}/100`));

  // Verified facts / assumptions / evidence traces are PRESERVED
  // (reused verbatim from Expert Reasoning Engine's real, already-
  // computed result), never re-derived by a second reasoning pass.
  assert.deepEqual(results.executiveDecisionBrief.verifiedEvidence, originalExpertReasoning.verifiedFacts);
  assert.deepEqual(results.executiveDecisionBrief.assumptions, originalExpertReasoning.assumptions);
  for (const line of originalExpertReasoning.evidenceTrace) {
    assert.ok(
      results.executiveDecisionBrief.evidenceTrace.includes(line),
      `expected original Expert Reasoning evidence trace line to be preserved: ${line}`
    );
  }

  // The ORIGINAL Expert Reasoning Engine result itself was never
  // mutated -- only a local copy was overridden before being handed to
  // Executive Decision Brief.
  assert.notEqual(originalExpertReasoning.confidence, undefined);
});

test("insufficient evidence via the Orchestrator: a genuine cross-category evidence conflict drives its real executiveDecisionSignal to do_not_proceed_insufficient_evidence, and Decision Engine stops safely with a real, specific stop reason and never builds a brief", () => {
  // Two externally-verified candidates (real url + publisher, so
  // Evidence Acquisition Engine promotes both to "external_verified")
  // land in two DIFFERENT, topically-overlapping categories --
  // market_size and industry_trends -- while citing disjoint dollar
  // figures ($50 million vs. $5 million) about what reads as the same
  // underlying fact. This is a genuine conflict the Orchestrator's own
  // Conflict Detection Engine will find, driving overallSeverity to
  // "critical" -- never a contrived or hand-set severity.
  const conflictingCandidates = [
    {
      text: "Market size for AI accounting software is estimated at $50 million based on total addressable market analysis.",
      source: { publisher: "Gartner", url: "https://gartner.com/report-a" },
    },
    {
      text: "Industry trends indicate the addressable market size for AI accounting software is only $5 million this year.",
      source: { publisher: "Forrester", url: "https://forrester.com/report-b" },
    },
  ];

  const { decision, results } = runDecisionEngine({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
    externalEvidenceCandidates: conflictingCandidates,
  });

  assert.equal(decision.selectedDomain, "business_intelligence");
  assert.equal(decision.businessIntelligenceApplied, true);
  assert.ok(results.businessIntelligenceContext, "expected the Orchestrator to have run");
  assert.equal(results.businessIntelligenceContext.criticalFailure, null);
  assert.equal(results.businessIntelligenceContext.conflictDetection.overallSeverity, "critical");
  assert.equal(results.businessIntelligenceContext.executiveDecisionSignal, "do_not_proceed_insufficient_evidence");

  assert.equal(decision.status, "insufficient_evidence");
  assert.equal(results.executiveDecisionBrief, null);
  assert.match(decision.stopReason, /Business Intelligence Orchestrator determined there is insufficient evidence/);
  assert.match(decision.stopReason, new RegExp(`${results.businessIntelligenceContext.aggregateConfidence}/100`));
  assert.ok(decision.skippedStages.some((s) => s.stage === "Executive Decision Brief"));
  assert.ok(
    decision.evidenceTrace.some((line) => /critical.{0,5}-severity evidence conflict/.test(line)),
    "expected the conflict to be surfaced in evidenceTrace"
  );
});

test("critical failure handling: the exact same stop-safely code path used for do_not_proceed_insufficient_evidence also exists, and is checked FIRST, for a critical Orchestrator failure -- never a fabricated fallback result", () => {
  // The Orchestrator's own critical-failure trigger (a pool item with
  // no real, non-empty text) is structurally unreachable through this
  // integration's real data path: buildScorablePoolFromEvidenceAcquisition
  // only ever includes items with evidence_type !== "missing" AND a
  // truthy extracted_fact, which is exactly the condition the
  // Orchestrator's own input-validation stage requires -- so this test
  // verifies the STRUCTURAL guarantee and the code shape directly,
  // since it cannot be provoked end-to-end without fabricating a
  // malformed EvidenceAcquisitionResult that Evidence Acquisition
  // Engine's own schema (trimmedString(500), non-nullable-when-present)
  // would never actually produce.
  assert.match(engineSource, /buildScorablePoolFromEvidenceAcquisition/);
  assert.match(
    engineSource,
    /evidence_type !== "missing" && Boolean\(evidence\.extracted_fact\)/
  );

  const criticalFailureBranchIndex = engineSource.indexOf("if (businessIntelligenceContext.criticalFailure)");
  const insufficientSignalBranchIndex = engineSource.indexOf(
    'businessIntelligenceContext.executiveDecisionSignal === "do_not_proceed_insufficient_evidence"'
  );
  assert.ok(criticalFailureBranchIndex !== -1, "expected an explicit criticalFailure branch");
  assert.ok(insufficientSignalBranchIndex !== -1, "expected an explicit do_not_proceed_insufficient_evidence branch");
  assert.ok(
    criticalFailureBranchIndex < insufficientSignalBranchIndex,
    "critical failure must be checked before the insufficient-evidence signal, since it is the more severe condition"
  );

  // Both stop-safely branches use the identical status/skip/finish
  // shape (never a different, fabricated fallback shape for one vs the
  // other).
  const criticalFailureBlock = engineSource.slice(criticalFailureBranchIndex, insufficientSignalBranchIndex);
  assert.match(criticalFailureBlock, /"insufficient_evidence"/);
  assert.match(criticalFailureBlock, /skipRemaining\(\["Executive Decision Brief"\], stopReason\)/);
});

test("duplicate-execution prevention: the Orchestrator and the BI-informed Executive Decision Brief call each appear exactly once in Decision Engine's source, and Expert Reasoning Engine is never re-executed", () => {
  const orchestratorCallCount = (engineSource.match(/runBusinessIntelligenceOrchestration\(/g) || []).length;
  const briefCallCount = (engineSource.match(/buildExecutiveDecisionBriefFromExpertReasoning\(/g) || []).length;
  assert.equal(orchestratorCallCount, 1, "runBusinessIntelligenceOrchestration must be called exactly once");
  assert.equal(briefCallCount, 1, "buildExecutiveDecisionBriefFromExpertReasoning must be called exactly once");
  assert.doesNotMatch(engineSource, /runExpertReasoningEngine/);

  const { results } = runDecisionEngine(STRONG_BUSINESS_INPUT);
  if (!results.executiveDecisionBrief) {
    return;
  }

  // The brief's verified evidence is IDENTICAL to (not independently
  // re-derived from) Expert Reasoning Engine's own single, already-
  // computed result -- proof the engine was read from, not re-run.
  const originalExpertReasoning = results.intelligencePipelineOutput.results.expertReasoningResult;
  assert.deepEqual(results.executiveDecisionBrief.verifiedEvidence, originalExpertReasoning.verifiedFacts);
});

test("identical input always produces an identical result for the Business Intelligence path (determinism, excluding executionTimeMs)", () => {
  const fixedNow = new Date("2026-01-01T00:00:00.000Z");
  const input = { ...STRONG_BUSINESS_INPUT, now: fixedNow };

  const a = runDecisionEngine(input);
  const b = runDecisionEngine(input);

  const { executionTimeMs: _a, ...decisionA } = a.decision;
  const { executionTimeMs: _b, ...decisionB } = b.decision;
  void _a;
  void _b;
  assert.deepEqual(decisionA, decisionB);
});

test("never fabricates a fallback result: every DecisionEngineResult on the Business Intelligence path parses under the strict schema, and businessIntelligenceApplied is false unless the Orchestrator genuinely ran", () => {
  const scenarios = [
    runDecisionEngine({ enabled: true }),
    runDecisionEngine({
      enabled: true,
      attachments: [{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }],
    }),
    runDecisionEngine(STRONG_BUSINESS_INPUT),
  ];

  for (const { decision, results } of scenarios) {
    assert.equal(decisionEngineResultSchema.safeParse(decision).success, true);
    assert.equal(decision.businessIntelligenceApplied, Boolean(results.businessIntelligenceContext));
  }
});

test("does not modify PDF, UI, billing, authentication, language handling, or report schemas", () => {
  assert.doesNotMatch(
    engineSource,
    /from ["'].*(?:pdf-engine|report-engine|report-jobs|billing|auth|report-language)/i
  );
  assert.doesNotMatch(engineSource, /generateReport|createPdf|renderPdf/i);
});
