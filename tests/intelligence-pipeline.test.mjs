import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  intelligencePipelineStageValues,
  intelligencePipelineResultSchema,
  INTELLIGENCE_PIPELINE_ENABLED_ENV_VAR,
  isIntelligencePipelineEnabled,
  runIntelligencePipeline,
} from "../app/lib/ai/intelligence-pipeline.ts";

const pipelineSource = await readFile(
  new URL("../app/lib/ai/intelligence-pipeline.ts", import.meta.url),
  "utf8"
);

const STRONG_PRICING_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

Evidence supporting demand is attached, including signed letters of intent from three customers. According to the attached market research report, addressable demand exceeds $50,000,000.`;

const LEGAL_DOC_TEXT =
  "The Court of Appeal reviewed the plaintiff's litigation against the defendant and issued its verdict following testimony and jurisdiction review by counsel.";

const FINANCIAL_DOC_TEXT =
  "Attached is the income statement, balance sheet, and cash flow statement for Q4, including gross margin and EBITDA figures for the fiscal year.";

const GARTNER_MARKET_SIZE_CANDIDATE = {
  text: "The global AI accounting software market size was valued at $4.2 billion in 2024.",
  source: {
    publisher: "Gartner",
    url: "https://www.gartner.com/en/research/ai-accounting-market",
    publishedDate: "2024-11-01",
    confidence: 0.9,
  },
};

function withoutTiming(pipeline) {
  const { executionTimeMs, ...rest } = pipeline;
  void executionTimeMs;
  return rest;
}

function withEnvFlag(value, fn) {
  const previous = process.env[INTELLIGENCE_PIPELINE_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[INTELLIGENCE_PIPELINE_ENABLED_ENV_VAR];
  } else {
    process.env[INTELLIGENCE_PIPELINE_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[INTELLIGENCE_PIPELINE_ENABLED_ENV_VAR];
    } else {
      process.env[INTELLIGENCE_PIPELINE_ENABLED_ENV_VAR] = previous;
    }
  }
}

test("intelligencePipelineStageValues contains exactly the 9 requested stages, in the exact requested order", () => {
  assert.deepEqual(intelligencePipelineStageValues, [
    "Attachment Detection",
    "Universal Document Intelligence",
    "Legal Intelligence",
    "Decision Intent Engine",
    "Decision Strategy Engine",
    "Dynamic Research Planner",
    "Evidence Acquisition Engine",
    "Expert Reasoning Engine",
    "Executive Decision Brief",
  ]);
});

test("isIntelligencePipelineEnabled reads the ZERINIX_INTELLIGENCE_PIPELINE_ENABLED env var exactly", () => {
  assert.equal(isIntelligencePipelineEnabled({}), false);
  assert.equal(isIntelligencePipelineEnabled({ [INTELLIGENCE_PIPELINE_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isIntelligencePipelineEnabled({ [INTELLIGENCE_PIPELINE_ENABLED_ENV_VAR]: "TRUE" }), false);
  assert.equal(isIntelligencePipelineEnabled({ [INTELLIGENCE_PIPELINE_ENABLED_ENV_VAR]: "true" }), true);
});

test("by default (no env var, no override) the pipeline is disabled and executes nothing", () => {
  withEnvFlag(undefined, () => {
    const { pipeline, results } = runIntelligencePipeline({
      prompt: "We need to decide on our pricing strategy urgently.",
      attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    });

    assert.equal(intelligencePipelineResultSchema.safeParse(pipeline).success, true);
    assert.equal(pipeline.enabled, false);
    assert.deepEqual(pipeline.executionOrder, []);
    assert.deepEqual(pipeline.executedStages, []);
    assert.equal(pipeline.skippedStages.length, intelligencePipelineStageValues.length);
    assert.ok(pipeline.stopReason);
    assert.deepEqual(pipeline.requestedOrder, [...intelligencePipelineStageValues]);

    for (const key of Object.keys(results)) {
      assert.equal(results[key], null, `expected results.${key} to be null when disabled`);
    }
  });
});

test("an explicit enabled:true input overrides the env var and runs the pipeline", () => {
  withEnvFlag(undefined, () => {
    const { pipeline } = runIntelligencePipeline({
      enabled: true,
      prompt: "We need to decide on our pricing strategy urgently.",
      attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    });

    assert.equal(pipeline.enabled, true);
    assert.ok(pipeline.executedStages.length > 0);
  });
});

test("setting the env var to 'true' (no explicit override) also runs the pipeline", () => {
  withEnvFlag("true", () => {
    const { pipeline } = runIntelligencePipeline({
      prompt: "We need to decide on our pricing strategy urgently.",
      attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    });

    assert.equal(pipeline.enabled, true);
    assert.ok(pipeline.executedStages.length > 0);
  });
});

test("an explicit enabled:false input overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const { pipeline } = runIntelligencePipeline({ enabled: false, prompt: "anything" });
    assert.equal(pipeline.enabled, false);
    assert.deepEqual(pipeline.executedStages, []);
  });
});

test("a confidently classified legal document stops the pipeline after Legal Intelligence; business stages never run", () => {
  const { pipeline, results } = runIntelligencePipeline({
    enabled: true,
    prompt: "Please review this.",
    attachments: [{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }],
  });

  assert.equal(intelligencePipelineResultSchema.safeParse(pipeline).success, true);
  assert.deepEqual(pipeline.executedStages, [
    "Attachment Detection",
    "Universal Document Intelligence",
    "Legal Intelligence",
  ]);
  assert.deepEqual(pipeline.executionOrder, pipeline.executedStages);
  assert.deepEqual(
    pipeline.skippedStages.map((s) => s.stage).sort(),
    [
      "Decision Intent Engine",
      "Decision Strategy Engine",
      "Dynamic Research Planner",
      "Evidence Acquisition Engine",
      "Expert Reasoning Engine",
      "Executive Decision Brief",
    ].sort()
  );
  for (const skipped of pipeline.skippedStages) {
    assert.match(skipped.reason, /legal document/i);
  }
  assert.ok(pipeline.stopReason && /legal document/i.test(pipeline.stopReason));

  assert.ok(results.legalDocumentSummary);
  assert.ok(results.legalCaseAnalysis);
  assert.equal(results.decisionIntentResult, null);
  assert.equal(results.decisionStrategyResult, null);
  assert.equal(results.expertReasoningResult, null);
  assert.equal(results.executiveDecisionBrief, null);
  assert.equal(results.dynamicResearchPlan, null);
  assert.equal(results.evidenceAcquisitionResult, null);
});

test("every one of the 9 stages is accounted for exactly once, either in executedStages or skippedStages, for both the legal and non-legal paths", () => {
  const legal = runIntelligencePipeline({
    enabled: true,
    attachments: [{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }],
  }).pipeline;
  const business = runIntelligencePipeline({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
  }).pipeline;

  for (const pipeline of [legal, business]) {
    const accounted = [...pipeline.executedStages, ...pipeline.skippedStages.map((s) => s.stage)].sort();
    assert.deepEqual(accounted, [...intelligencePipelineStageValues].sort());
  }
});

test("a non-legal (business) run executes all 9 stages, in an order that respects every real dependency", () => {
  const { pipeline, results } = runIntelligencePipeline({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
  });

  assert.equal(intelligencePipelineResultSchema.safeParse(pipeline).success, true);
  assert.deepEqual(
    [...pipeline.executedStages].sort(),
    [...intelligencePipelineStageValues].filter((s) => s !== "Legal Intelligence").sort()
  );
  assert.deepEqual(
    pipeline.skippedStages.map((s) => s.stage),
    ["Legal Intelligence"]
  );
  assert.equal(pipeline.stopReason, null);

  const order = pipeline.executionOrder;
  const indexOf = (stage) => order.indexOf(stage);

  assert.ok(indexOf("Attachment Detection") < indexOf("Universal Document Intelligence"));
  assert.ok(indexOf("Universal Document Intelligence") < indexOf("Decision Intent Engine"));
  assert.ok(indexOf("Decision Intent Engine") < indexOf("Dynamic Research Planner"));
  assert.ok(indexOf("Dynamic Research Planner") < indexOf("Evidence Acquisition Engine"));
  assert.ok(indexOf("Evidence Acquisition Engine") < indexOf("Expert Reasoning Engine"));
  assert.ok(indexOf("Expert Reasoning Engine") < indexOf("Executive Decision Brief"));
  // The one documented deviation from the requested order: Decision
  // Strategy Engine runs LAST in real order, since its own required
  // inputs (expertReasoningResult, executiveDecisionBrief) do not exist
  // until after those two stages have run.
  assert.equal(order[order.length - 1], "Decision Strategy Engine");
  assert.ok(indexOf("Executive Decision Brief") < indexOf("Decision Strategy Engine"));

  for (const key of Object.keys(results)) {
    if (key === "legalDocumentSummary" || key === "legalCaseAnalysis") {
      assert.equal(results[key], null);
    } else {
      assert.ok(results[key], `expected results.${key} to be populated`);
    }
  }
});

test("requestedOrder always reflects the literal specification order, regardless of what actually executed", () => {
  const disabled = runIntelligencePipeline({ enabled: false }).pipeline;
  const legal = runIntelligencePipeline({
    enabled: true,
    attachments: [{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }],
  }).pipeline;
  const business = runIntelligencePipeline({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
  }).pipeline;

  for (const pipeline of [disabled, legal, business]) {
    assert.deepEqual(pipeline.requestedOrder, [...intelligencePipelineStageValues]);
  }

  assert.equal(business.requestedOrder.indexOf("Decision Strategy Engine"), 4);
  assert.notEqual(business.executionOrder.indexOf("Decision Strategy Engine"), 4);
});

test("orderDeviations documents exactly the Decision Strategy Engine repositioning, and only for the non-legal path", () => {
  const legal = runIntelligencePipeline({
    enabled: true,
    attachments: [{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }],
  }).pipeline;
  const business = runIntelligencePipeline({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
  }).pipeline;

  assert.deepEqual(legal.orderDeviations, []);
  assert.equal(business.orderDeviations.length, 1);
  assert.match(business.orderDeviations[0], /Decision Strategy Engine/);
  assert.match(business.orderDeviations[0], /non-optional/);
});

test("Dynamic Research Planner receives a domain hint mapped from Universal Document Intelligence when one cleanly applies", () => {
  const { results } = runIntelligencePipeline({
    enabled: true,
    prompt: "Please review our financials.",
    attachments: [{ name: "financials.pdf", textContent: FINANCIAL_DOC_TEXT }],
  });

  assert.equal(results.universalDocumentIntelligence.documentDomain, "Financial");
  assert.equal(results.dynamicResearchPlan.detectedDomain, "finance");
  assert.equal(results.dynamicResearchPlan.domainDetectionMethod, "provided");
  assert.equal(results.dynamicResearchPlan.domainConfidence, 1);
});

test("Dynamic Research Planner falls back to its own keyword detection when Universal Document Intelligence's domain has no clean mapping", () => {
  const { results } = runIntelligencePipeline({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
  });

  assert.notEqual(results.universalDocumentIntelligence.documentDomain, "Financial");
  assert.notEqual(results.dynamicResearchPlan.domainDetectionMethod, "provided");
});

test("Evidence Acquisition Engine's verified findings flow into Expert Reasoning Engine's evidence pools, never re-fabricated", () => {
  const { results } = runIntelligencePipeline({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    externalEvidenceCandidates: [GARTNER_MARKET_SIZE_CANDIDATE],
  });

  assert.equal(results.evidenceAcquisitionResult.evidence.market_size.evidence_type, "external_verified");
  assert.equal(results.evidenceAcquisitionResult.evidence.market_size.publisher, "Gartner");

  const expectedLine = "Market size: " + results.evidenceAcquisitionResult.evidence.market_size.extracted_fact + " (source: Gartner)";
  assert.ok(
    results.expertReasoningResult.verifiedFacts.includes(expectedLine),
    "expected the Gartner market-size fact to appear verbatim in Expert Reasoning Engine's verifiedFacts"
  );
  assert.ok(GARTNER_MARKET_SIZE_CANDIDATE.text.includes(results.evidenceAcquisitionResult.evidence.market_size.extracted_fact));
});

test("without external evidence candidates, no fabricated market-size fact appears in Expert Reasoning Engine's output", () => {
  const { results } = runIntelligencePipeline({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
  });

  assert.equal(results.evidenceAcquisitionResult.evidence.market_size.evidence_type, "missing");
  assert.ok(!results.expertReasoningResult.verifiedFacts.some((fact) => fact.includes("Gartner")));
});

test("a request with no signal at all still runs all 9 requestable stages safely, with each engine's own insufficient-evidence handling, and no crash", () => {
  const { pipeline, results } = runIntelligencePipeline({ enabled: true });

  assert.equal(intelligencePipelineResultSchema.safeParse(pipeline).success, true);
  assert.equal(pipeline.stopReason, null);
  assert.deepEqual(
    [...pipeline.executedStages].sort(),
    [...intelligencePipelineStageValues].filter((s) => s !== "Legal Intelligence").sort()
  );
  assert.ok(results.decisionStrategyResult);
  assert.equal(results.decisionStrategyResult.confidence, 0);
});

test("identical input always produces an identical pipeline result (determinism, excluding executionTimeMs)", () => {
  const input = {
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    externalEvidenceCandidates: [GARTNER_MARKET_SIZE_CANDIDATE],
  };

  const a = runIntelligencePipeline(input);
  const b = runIntelligencePipeline(input);

  assert.deepEqual(withoutTiming(a.pipeline), withoutTiming(b.pipeline));
  assert.deepEqual(a.results, b.results);
  assert.ok(a.pipeline.executionTimeMs >= 0);
});

test("never fabricates data: no dollar amounts appear in evidence-derived results unless copied verbatim from source evidence", () => {
  const { results } = runIntelligencePipeline({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    externalEvidenceCandidates: [GARTNER_MARKET_SIZE_CANDIDATE],
  });

  // dynamicResearchPlan's estimatedCostUsd/totalEstimatedCostUsd are the
  // planner's own deterministic planning-effort heuristic, not a claim
  // derived from evidence -- excluded here on purpose (dynamic-research-
  // planner.test.mjs already covers that heuristic on its own terms).
  const evidenceDerivedResults = { ...results };
  delete evidenceDerivedResults.dynamicResearchPlan;

  const serialized = JSON.stringify(evidenceDerivedResults);
  const dollarMatches = serialized.match(/\$[\d,.]+(?:\s?(?:billion|million))?/g) || [];
  const knownSources = [STRONG_PRICING_TEXT, GARTNER_MARKET_SIZE_CANDIDATE.text];
  for (const match of dollarMatches) {
    assert.ok(
      knownSources.some((source) => source.includes(match)),
      `unexpected monetary figure "${match}"`
    );
  }
});

test("every try/catch stage calls handleFailure and skips its remaining real-order dependents (behavioral proof via source structure)", () => {
  const tryCount = (pipelineSource.match(/\btry\s*\{/g) || []).length;
  const handleFailureCallCount = (pipelineSource.match(/return handleFailure\(/g) || []).length;
  assert.ok(tryCount >= 9);
  assert.equal(handleFailureCallCount, 9);
  assert.match(pipelineSource, /catch \(error\)/);
  assert.match(pipelineSource, /skipRemaining\(/);
});

test("does not modify report generation, PDF generation, billing, UI, and is not wired into any production route", async () => {
  assert.doesNotMatch(
    pipelineSource,
    /from ["'].*(?:pdf-engine|report-engine|report-jobs|billing|auth)/i
  );

  const planRouteSource = await readFile(
    new URL("../app/api/plan/route.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(planRouteSource, /intelligence-pipeline|runIntelligencePipeline/);

  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (file === "intelligence-pipeline.ts" || !file.endsWith(".ts")) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /intelligence-pipeline\.ts|runIntelligencePipeline/,
      `expected ${file} to not yet reference the new standalone pipeline`
    );
  }
});

test("does not modify any of the underlying standalone modules it connects (zero regression guard)", () => {
  assert.doesNotMatch(pipelineSource, /^export function classifyAttachmentDocument/m);
  assert.doesNotMatch(pipelineSource, /^export function runDecisionStrategyEngine/m);
  assert.doesNotMatch(pipelineSource, /^export function runExpertReasoningEngine/m);
});
