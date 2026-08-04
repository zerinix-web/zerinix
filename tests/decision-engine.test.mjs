import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  decisionEngineStageValues,
  decisionEngineStatusValues,
  decisionEngineResultSchema,
  DECISION_ENGINE_ENABLED_ENV_VAR,
  isDecisionEngineEnabled,
  runDecisionEngine,
} from "../app/lib/ai/decision-engine.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/decision-engine.ts", import.meta.url),
  "utf8"
);

// Deliberately avoids "market research report" wording -- Adaptive
// Intelligence Engine's own market_intelligence refinement would
// otherwise correctly reclassify this as market_intelligence instead of
// business_intelligence (proven separately in
// adaptive-intelligence-engine.test.mjs); this fixture is meant to stay a
// business_intelligence case with strong evidence.
const STRONG_PRICING_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds $50,000,000 based on our own analysis.`;

// Contains a business_intelligence-triggering phrase ("business idea") so
// Adaptive Intelligence Engine can identify the domain, while remaining
// evidence-weak (no concrete demand figures) so Evidence Validation
// should still catch it downstream.
const WEAK_TEXT =
  "Subject: Pricing thoughts\n\nThis is a business idea we might think about pricing for at some point, without much evidence yet.";

const LEGAL_DOC_TEXT =
  "The Court of Appeal reviewed the plaintiff's litigation against the defendant and issued its verdict following testimony and jurisdiction review by counsel.";

const MEDICAL_TEXT =
  "This medical report covers the patient's diagnosis from a recent clinical trial, includes the treatment plan, contraindication warnings, medical guideline references, and symptom history.";

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

function withoutTiming(decision) {
  const { executionTimeMs, ...rest } = decision;
  void executionTimeMs;
  return rest;
}

function withoutResultsTiming(results) {
  if (!results.intelligencePipelineOutput) {
    return results;
  }
  const { pipeline, ...restOutput } = results.intelligencePipelineOutput;
  const { executionTimeMs, ...restPipeline } = pipeline;
  void executionTimeMs;
  return { ...results, intelligencePipelineOutput: { ...restOutput, pipeline: restPipeline } };
}

test("decisionEngineStageValues contains exactly the 5 requested stages, in the exact requested order", () => {
  assert.deepEqual(decisionEngineStageValues, [
    "Adaptive Intelligence Engine",
    "Intelligence Pipeline",
    "Evidence Validation",
    "Expert Reasoning",
    "Executive Decision Brief",
  ]);
});

test("decisionEngineStatusValues contains exactly the 4 required statuses", () => {
  assert.deepEqual(
    [...decisionEngineStatusValues].sort(),
    ["not_started", "ready_for_report_generation", "insufficient_evidence", "failed"].sort()
  );
});

test("isDecisionEngineEnabled reads the ZERINIX_DECISION_ENGINE_ENABLED env var exactly", () => {
  assert.equal(isDecisionEngineEnabled({}), false);
  assert.equal(isDecisionEngineEnabled({ [DECISION_ENGINE_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isDecisionEngineEnabled({ [DECISION_ENGINE_ENABLED_ENV_VAR]: "true" }), true);
});

test("by default (no env var, no override) the engine is disabled and executes nothing, leaving the existing flow unaffected", () => {
  withEnvFlag(undefined, () => {
    const { decision, results } = runDecisionEngine({
      prompt: "We need to decide on our pricing strategy urgently.",
      attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    });

    assert.equal(decisionEngineResultSchema.safeParse(decision).success, true);
    assert.equal(decision.enabled, false);
    assert.equal(decision.status, "not_started");
    assert.deepEqual(decision.executedStages, []);
    assert.equal(decision.skippedStages.length, decisionEngineStageValues.length);
    assert.equal(results.adaptiveIntelligenceResult, null);
    assert.equal(results.intelligencePipelineOutput, null);
  });
});

test("an explicit enabled:true input overrides the env var and runs the engine", () => {
  withEnvFlag(undefined, () => {
    const { decision } = runDecisionEngine({
      enabled: true,
      prompt: "We need to decide on our pricing strategy urgently.",
      attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    });
    assert.equal(decision.enabled, true);
    assert.ok(decision.executedStages.length > 0);
  });
});

test("setting the env var to 'true' (no explicit override) also runs the engine", () => {
  withEnvFlag("true", () => {
    const { decision } = runDecisionEngine({
      prompt: "We need to decide on our pricing strategy urgently.",
      attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    });
    assert.equal(decision.enabled, true);
  });
});

test("an explicit enabled:false input overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const { decision } = runDecisionEngine({ enabled: false, prompt: "anything" });
    assert.equal(decision.enabled, false);
    assert.deepEqual(decision.executedStages, []);
  });
});

test("with no signal at all, Adaptive Intelligence Engine cannot determine a domain, so the engine stops immediately after stage 1", () => {
  const { decision, results } = runDecisionEngine({ enabled: true });

  assert.equal(decisionEngineResultSchema.safeParse(decision).success, true);
  assert.deepEqual(decision.executedStages, ["Adaptive Intelligence Engine"]);
  assert.deepEqual(
    decision.skippedStages.map((s) => s.stage).sort(),
    ["Intelligence Pipeline", "Evidence Validation", "Expert Reasoning", "Executive Decision Brief"].sort()
  );
  assert.equal(decision.status, "insufficient_evidence");
  assert.match(decision.stopReason, /Adaptive Intelligence Engine/);
  assert.equal(results.adaptiveIntelligenceResult.selectedDomain, null);
  assert.equal(results.intelligencePipelineOutput, null);
});

test("a confidently classified legal document stops at Intelligence Pipeline; Evidence Validation, Expert Reasoning, and Executive Decision Brief never run", () => {
  const { decision, results } = runDecisionEngine({
    enabled: true,
    prompt: "Please review this.",
    attachments: [{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }],
  });

  assert.deepEqual(decision.executedStages, ["Adaptive Intelligence Engine", "Intelligence Pipeline"]);
  assert.deepEqual(
    decision.skippedStages.map((s) => s.stage).sort(),
    ["Evidence Validation", "Expert Reasoning", "Executive Decision Brief"].sort()
  );
  assert.equal(decision.status, "insufficient_evidence");
  assert.match(decision.stopReason, /Intelligence Pipeline stopped/);
  assert.equal(decision.selectedDomain, "legal_intelligence");
  assert.ok(results.intelligencePipelineOutput.results.legalCaseAnalysis);
});

test("strong, verified business evidence runs all 5 stages and reaches ready_for_report_generation with a populated executive summary", () => {
  const { decision, results } = runDecisionEngine({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
  });

  assert.equal(decisionEngineResultSchema.safeParse(decision).success, true);
  assert.deepEqual(decision.executedStages, [...decisionEngineStageValues]);
  assert.deepEqual(decision.skippedStages, []);
  assert.equal(decision.status, "ready_for_report_generation");
  assert.equal(decision.stopReason, null);
  assert.equal(decision.evidenceValidation.status, "sufficient");
  assert.ok(decision.executiveSummary);
  assert.ok(decision.recommendationStatus);
  assert.ok(decision.nextRecommendedAction);
  assert.equal(decision.selectedDomain, "business_intelligence");
  assert.ok(results.intelligencePipelineOutput.results.decisionStrategyResult);
});

test("weak, unverified evidence is caught by Evidence Validation: Expert Reasoning and Executive Decision Brief are skipped as stages, even though the pipeline computed them", () => {
  const { decision } = runDecisionEngine({
    enabled: true,
    prompt: "This is a business idea; we might think about pricing at some point.",
    attachments: [{ name: "note.txt", textContent: WEAK_TEXT }],
  });

  assert.deepEqual(decision.executedStages, [
    "Adaptive Intelligence Engine",
    "Intelligence Pipeline",
    "Evidence Validation",
  ]);
  assert.deepEqual(
    decision.skippedStages.map((s) => s.stage).sort(),
    ["Expert Reasoning", "Executive Decision Brief"].sort()
  );
  assert.equal(decision.status, "insufficient_evidence");
  assert.equal(decision.evidenceValidation.status, "insufficient");
});

test("a medical document still runs the full pipeline, but Evidence Validation correctly reports insufficient_evidence, since Intelligence Pipeline's business-reasoning engines hard-block non-business domains -- this is intentional, not a bug", () => {
  const { decision, results } = runDecisionEngine({
    enabled: true,
    prompt: "Please review this patient's case.",
    attachments: [{ name: "medical_report.pdf", textContent: MEDICAL_TEXT }],
  });

  assert.equal(decision.selectedDomain, "medical_intelligence");
  assert.equal(decision.status, "insufficient_evidence");
  assert.equal(results.intelligencePipelineOutput.results.expertReasoningResult.detectedBusinessContext, "unsupported");
});

test("every one of the 5 stages is accounted for exactly once, either in executedStages or skippedStages, across every scenario", () => {
  const scenarios = [
    runDecisionEngine({ enabled: true }),
    runDecisionEngine({
      enabled: true,
      attachments: [{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }],
    }),
    runDecisionEngine({
      enabled: true,
      prompt: "This is a business idea; we might think about pricing at some point.",
      attachments: [{ name: "note.txt", textContent: WEAK_TEXT }],
    }),
    runDecisionEngine({
      enabled: true,
      prompt: "We need to decide on our pricing strategy urgently.",
      attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    }),
  ];

  for (const { decision } of scenarios) {
    const accounted = [...decision.executedStages, ...decision.skippedStages.map((s) => s.stage)].sort();
    assert.deepEqual(accounted, [...decisionEngineStageValues].sort());
  }
});

test("identical input always produces an identical result (determinism, excluding executionTimeMs)", () => {
  const input = {
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
  };

  const a = runDecisionEngine(input);
  const b = runDecisionEngine(input);

  assert.deepEqual(withoutTiming(a.decision), withoutTiming(b.decision));
  assert.deepEqual(withoutResultsTiming(a.results), withoutResultsTiming(b.results));
  assert.ok(a.decision.executionTimeMs >= 0);
});

test("never fabricates data: no dollar amounts appear unless copied verbatim from source evidence", () => {
  const { decision } = runDecisionEngine({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
  });

  const serialized = JSON.stringify(decision);
  const dollarMatches = serialized.match(/\$[\d,]+/g) || [];
  for (const match of dollarMatches) {
    assert.ok(STRONG_PRICING_TEXT.includes(match), `unexpected monetary figure "${match}"`);
  }
});

test("does not itself touch report generation, PDF generation, billing, or UI, and does not call any report generator", () => {
  assert.doesNotMatch(
    engineSource,
    /from ["'].*(?:pdf-engine|report-engine|report-jobs|billing|auth)/i
  );
  assert.doesNotMatch(engineSource, /generateReport|createPdf|renderPdf/i);
});
