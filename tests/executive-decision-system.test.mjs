import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  EXECUTIVE_DECISION_SYSTEM_ENABLED_ENV_VAR,
  isExecutiveDecisionSystemEnabled,
  executiveDecisionPackageSchema,
  runExecutiveDecisionSystem,
} from "../app/lib/ai/executive-decision-system.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/executive-decision-system.ts", import.meta.url),
  "utf8"
);

function withEnvFlag(value, fn) {
  const previous = process.env[EXECUTIVE_DECISION_SYSTEM_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[EXECUTIVE_DECISION_SYSTEM_ENABLED_ENV_VAR];
  } else {
    process.env[EXECUTIVE_DECISION_SYSTEM_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[EXECUTIVE_DECISION_SYSTEM_ENABLED_ENV_VAR];
    } else {
      process.env[EXECUTIVE_DECISION_SYSTEM_ENABLED_ENV_VAR] = previous;
    }
  }
}

// Same fixture style as decision-engine.test.mjs's STRONG_PRICING_TEXT
// / decision-engine-business-intelligence-integration.test.mjs's
// STRONG_BUSINESS_TEXT: triggers Adaptive Intelligence Engine's
// business_intelligence domain with evidence strong enough to clear
// the existing Evidence Validation checkpoint.
const STRONG_BUSINESS_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds 50,000,000 dollars based on our own analysis.`;

const LEGAL_DOC_TEXT =
  "The Court of Appeal reviewed the plaintiff's litigation against the defendant and issued its verdict following testimony and jurisdiction review by counsel.";

const STRONG_BUSINESS_INPUT = {
  prompt: "We need to decide on our pricing strategy urgently.",
  attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
};

// Verified (see decision-engine-business-intelligence-integration.test.mjs)
// to produce a genuine cross-category evidence conflict, driving the
// Business Intelligence Orchestrator's own real executiveDecisionSignal
// to "do_not_proceed_insufficient_evidence".
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

test("isExecutiveDecisionSystemEnabled reads the env var exactly", () => {
  assert.equal(isExecutiveDecisionSystemEnabled({}), false);
  assert.equal(isExecutiveDecisionSystemEnabled({ [EXECUTIVE_DECISION_SYSTEM_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isExecutiveDecisionSystemEnabled({ [EXECUTIVE_DECISION_SYSTEM_ENABLED_ENV_VAR]: "true" }), true);
});

test("by default (no env var, no override) the system is disabled and Decision Engine is forced off too -- no computation runs at all", () => {
  withEnvFlag(undefined, () => {
    const { package: pkg, decisionEngineOutput } = runExecutiveDecisionSystem(STRONG_BUSINESS_INPUT);

    assert.equal(executiveDecisionPackageSchema.safeParse(pkg).success, true);
    assert.equal(pkg.enabled, false);
    assert.equal(pkg.status, "not_started");
    assert.equal(pkg.businessIntelligenceApplied, false);
    assert.equal(pkg.businessIntelligence, null);
    assert.equal(pkg.executiveDecisionBrief, null);
    assert.equal(decisionEngineOutput.decision.enabled, false);
    assert.equal(decisionEngineOutput.results.businessIntelligenceContext, null);
  });
});

test("an explicit enabled:true overrides the env var, and forces Decision Engine's own flag on too", () => {
  withEnvFlag(undefined, () => {
    const { package: pkg } = runExecutiveDecisionSystem({ ...STRONG_BUSINESS_INPUT, enabled: true });
    assert.equal(pkg.enabled, true);
    assert.ok(pkg.status !== "not_started");
  });
});

test("setting the env var to 'true' also enables the system", () => {
  withEnvFlag("true", () => {
    const { package: pkg } = runExecutiveDecisionSystem(STRONG_BUSINESS_INPUT);
    assert.equal(pkg.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const { package: pkg } = runExecutiveDecisionSystem({ ...STRONG_BUSINESS_INPUT, enabled: false });
    assert.equal(pkg.enabled, false);
    assert.equal(pkg.status, "not_started");
  });
});

test("calling with the default argument (no input at all) is safe and returns a disabled, schema-valid package", () => {
  const { package: pkg } = runExecutiveDecisionSystem();
  assert.equal(executiveDecisionPackageSchema.safeParse(pkg).success, true);
  assert.equal(pkg.enabled, false);
});

test("successful execution: a supported Business Intelligence request produces one complete package combining Decision Engine, Business Intelligence Orchestrator, and Executive Decision Brief", () => {
  const { package: pkg, decisionEngineOutput } = runExecutiveDecisionSystem({
    ...STRONG_BUSINESS_INPUT,
    enabled: true,
  });

  assert.equal(executiveDecisionPackageSchema.safeParse(pkg).success, true);
  assert.equal(pkg.selectedDomain, "business_intelligence");
  assert.equal(pkg.businessIntelligenceApplied, true);
  assert.ok(pkg.businessIntelligence, "expected a Business Intelligence context in the package");
  assert.equal(pkg.businessIntelligence.enabled, true);
  assert.equal(pkg.businessIntelligence.criticalFailure, null);

  if (pkg.status === "ready_for_report_generation") {
    assert.ok(pkg.executiveDecisionBrief, "expected an Executive Decision Brief when ready_for_report_generation");
    assert.equal(pkg.executiveSummary, pkg.executiveDecisionBrief.executiveRecommendation);
    assert.equal(pkg.recommendationStatus, pkg.executiveDecisionBrief.recommendationStatus);
    assert.equal(pkg.nextRecommendedAction, pkg.executiveDecisionBrief.immediateNextActions[0] ?? null);
  } else {
    assert.equal(pkg.status, "insufficient_evidence");
    assert.equal(pkg.businessIntelligence.executiveDecisionSignal, "do_not_proceed_insufficient_evidence");
    assert.equal(pkg.executiveDecisionBrief, null);
  }

  // Every field is a real passthrough of decisionEngineOutput's own
  // already-computed data -- never re-derived independently.
  assert.deepEqual(pkg.decision, decisionEngineOutput.decision);
  assert.deepEqual(pkg.businessIntelligence, decisionEngineOutput.results.businessIntelligenceContext);
  assert.deepEqual(pkg.executiveDecisionBrief, decisionEngineOutput.results.executiveDecisionBrief);
});

test("a non-Business-Intelligence domain (legal document) still produces one complete, schema-valid package, with businessIntelligence honestly null (it never ran)", () => {
  const { package: pkg } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "Please review this.",
    attachments: [{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }],
  });

  assert.equal(executiveDecisionPackageSchema.safeParse(pkg).success, true);
  assert.equal(pkg.selectedDomain, "legal_intelligence");
  assert.equal(pkg.status, "insufficient_evidence");
  assert.equal(pkg.businessIntelligenceApplied, false);
  assert.equal(pkg.businessIntelligence, null);
  assert.equal(pkg.executiveDecisionBrief, null);
  assert.match(pkg.stopReason, /Intelligence Pipeline stopped/);
});

test("insufficient evidence via the Business Intelligence Orchestrator: a genuine cross-category conflict stops the package safely, with no fabricated brief", () => {
  const { package: pkg } = runExecutiveDecisionSystem({
    enabled: true,
    ...STRONG_BUSINESS_INPUT,
    externalEvidenceCandidates: CONFLICTING_CANDIDATES,
  });

  assert.equal(pkg.selectedDomain, "business_intelligence");
  assert.equal(pkg.businessIntelligenceApplied, true);
  assert.ok(pkg.businessIntelligence);
  assert.equal(pkg.businessIntelligence.criticalFailure, null);
  assert.equal(pkg.businessIntelligence.conflictDetection.overallSeverity, "critical");
  assert.equal(pkg.businessIntelligence.executiveDecisionSignal, "do_not_proceed_insufficient_evidence");

  assert.equal(pkg.status, "insufficient_evidence");
  assert.equal(pkg.executiveDecisionBrief, null);
  assert.match(pkg.stopReason, /Business Intelligence Orchestrator determined there is insufficient evidence/);
  assert.ok(
    pkg.packageTrace.some((line) => /executiveDecisionSignal="do_not_proceed_insufficient_evidence"/.test(line))
  );
});

test("never fabricates: the package never claims a Business Intelligence context or brief exists unless Decision Engine's own results genuinely contain one", () => {
  const scenarios = [
    runExecutiveDecisionSystem({ enabled: true }),
    runExecutiveDecisionSystem({
      enabled: true,
      prompt: "Please review this.",
      attachments: [{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }],
    }),
    runExecutiveDecisionSystem({ ...STRONG_BUSINESS_INPUT, enabled: true }),
    runExecutiveDecisionSystem({
      enabled: true,
      ...STRONG_BUSINESS_INPUT,
      externalEvidenceCandidates: CONFLICTING_CANDIDATES,
    }),
  ];

  for (const { package: pkg, decisionEngineOutput } of scenarios) {
    assert.equal(executiveDecisionPackageSchema.safeParse(pkg).success, true);
    assert.equal(Boolean(pkg.businessIntelligence), Boolean(decisionEngineOutput.results.businessIntelligenceContext));
    assert.equal(Boolean(pkg.executiveDecisionBrief), Boolean(decisionEngineOutput.results.executiveDecisionBrief));
    assert.equal(pkg.businessIntelligenceApplied, decisionEngineOutput.decision.businessIntelligenceApplied);
  }
});

test("packageTrace cites the real, computed values it summarizes -- never a generic placeholder", () => {
  const { package: pkg } = runExecutiveDecisionSystem({ ...STRONG_BUSINESS_INPUT, enabled: true });

  assert.match(pkg.packageTrace[0], new RegExp(`"${pkg.status}"`));
  if (pkg.businessIntelligence) {
    assert.ok(
      pkg.packageTrace.some((line) =>
        line.includes(`aggregateConfidence=${pkg.businessIntelligence.aggregateConfidence}`)
      )
    );
  }
});

test("orchestrates existing modules only: this file calls runDecisionEngine exactly once and never imports/calls any of the 8 underlying engines' own run/score/detect/build functions directly", () => {
  const orchestratorCallCount = (engineSource.match(/runDecisionEngine\(/g) || []).length;
  assert.equal(orchestratorCallCount, 1, "runDecisionEngine must be called exactly once");

  for (const forbidden of [
    "runBusinessIntelligenceOrchestration(",
    "computeConfidence(",
    "detectConflicts(",
    "scoreEvidenceQuality(",
    "scoreSourceReliability(",
    "checkEvidenceCorroboration(",
    "detectLiveResearchNeed(",
    "prioritizeResearchTasks(",
    "planResearchExecution(",
  ]) {
    assert.doesNotMatch(
      engineSource,
      new RegExp(forbidden.replace(/[()]/g, "\\$&")),
      `expected Executive Decision System to never call ${forbidden} directly -- it must only read Decision Engine's own already-computed output`
    );
  }
});

test("identical input always produces an identical result (determinism)", () => {
  const fixedNow = new Date("2026-01-01T00:00:00.000Z");
  const input = { ...STRONG_BUSINESS_INPUT, enabled: true, now: fixedNow };

  const a = runExecutiveDecisionSystem(input);
  const b = runExecutiveDecisionSystem(input);

  const stripTiming = (output) => {
    const { decision, results } = output.decisionEngineOutput;
    const { executionTimeMs, ...decisionRest } = decision;
    void executionTimeMs;
    let intelligencePipelineOutput = results.intelligencePipelineOutput;
    if (intelligencePipelineOutput) {
      const { pipeline, ...restOutput } = intelligencePipelineOutput;
      const { executionTimeMs: pipelineTimeMs, ...restPipeline } = pipeline;
      void pipelineTimeMs;
      intelligencePipelineOutput = { ...restOutput, pipeline: restPipeline };
    }
    return { decisionRest, results: { ...results, intelligencePipelineOutput } };
  };

  assert.deepEqual(stripTiming(a), stripTiming(b));
});

test("does not modify UI, PDF generation, billing, or authentication", () => {
  assert.doesNotMatch(engineSource, /from ["'].*(?:pdf-engine|report-engine|report-jobs|billing|auth)/i);
  assert.doesNotMatch(engineSource, /generateReport|createPdf|renderPdf/i);
});

test("keeps every existing module independent: this file only reads exported functions/types, never redefines or monkey-patches any of them", () => {
  assert.doesNotMatch(engineSource, /\.prototype\s*=|Object\.assign\(.*Engine/);
  const exportCount =
    (engineSource.match(/^export function/gm) || []).length + (engineSource.match(/^export const/gm) || []).length;
  assert.ok(exportCount >= 2, "expected this facade to export its own flag/schema, not redefine anyone else's");
});

test("is wired into app/api/plan/route.ts behind its own feature flag only, and referenced nowhere else", async () => {
  // ZERINIX Executive Decision System v1's own /api/plan integration
  // (see tests/executive-decision-system-plan-integration.test.mjs)
  // legitimately calls runExecutiveDecisionSystem exactly once, gated
  // behind ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED (default disabled),
  // mutually exclusive with the pre-existing Decision Engine block.
  const planRouteSource = await readFile(new URL("../app/api/plan/route.ts", import.meta.url), "utf8");
  assert.match(planRouteSource, /runExecutiveDecisionSystem\(/);
  assert.match(planRouteSource, /isExecutiveDecisionSystemEnabled\(\)/);

  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (
      file === "executive-decision-system.ts" ||
      // ZERINIX Strategic Decision Memo v1 legitimately validates
      // Executive Decision System output via executiveDecisionPackageSchema.
      file === "strategic-decision-memo.ts" ||
      !file.endsWith(".ts")
    ) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /executive-decision-system|runExecutiveDecisionSystem/,
      `expected ${file} to not yet reference the new Executive Decision System`
    );
  }
});
