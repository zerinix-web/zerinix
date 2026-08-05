import test from "node:test";
import assert from "node:assert/strict";
import { formatExecutiveDecisionSystemContext } from "../app/lib/report-engine/executive-decision-system-context.ts";
import {
  runExecutiveDecisionSystem,
  executiveDecisionPackageSchema,
} from "../app/lib/ai/executive-decision-system.ts";

const STRONG_BUSINESS_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds 50,000,000 dollars based on our own analysis.`;

function realSuccessfulPackage() {
  const { package: pkg } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
  });
  assert.equal(pkg.status, "ready_for_report_generation", "fixture must reach ready_for_report_generation");
  assert.ok(pkg.businessIntelligence && pkg.executiveDecisionBrief, "fixture must have real BI + brief data");
  return pkg;
}

function clonedValidPackage(mutate) {
  const base = structuredClone(realSuccessfulPackage());
  const mutated = mutate(base);
  const check = executiveDecisionPackageSchema.safeParse(mutated);
  assert.equal(check.success, true, `mutated fixture must remain schema-valid: ${JSON.stringify(check.error?.issues)}`);
  return check.data;
}

test("returns null for missing/undefined input -- never fabricates a context block from nothing", () => {
  assert.equal(formatExecutiveDecisionSystemContext(undefined), null);
  assert.equal(formatExecutiveDecisionSystemContext(null), null);
});

test("returns null for malformed input that does not conform to the real executiveDecisionPackageSchema", () => {
  assert.equal(formatExecutiveDecisionSystemContext({ status: "not-a-real-status" }), null);
  assert.equal(formatExecutiveDecisionSystemContext("just a string"), null);
  assert.equal(formatExecutiveDecisionSystemContext(42), null);
});

test("returns null when the package is valid but never actually computed Business Intelligence / Executive Decision Brief data -- never adds a block with nothing real to say", () => {
  const pkg = clonedValidPackage((base) => ({
    ...base,
    businessIntelligenceApplied: false,
    businessIntelligence: null,
    executiveDecisionBrief: null,
  }));
  assert.equal(formatExecutiveDecisionSystemContext(pkg), null);
});

test("a real, successful package produces a context block that cites the real aggregate confidence, evidence quality, and executive decision signal", () => {
  const pkg = realSuccessfulPackage();
  const result = formatExecutiveDecisionSystemContext(pkg);

  assert.ok(result, "expected a real context to be produced");
  assert.match(result.contextBlock, new RegExp(`Aggregate confidence: ${pkg.businessIntelligence.aggregateConfidence}/100`));
  assert.match(
    result.contextBlock,
    new RegExp(`Aggregate evidence quality: ${pkg.businessIntelligence.aggregateEvidenceQuality}/100`)
  );
  assert.match(result.contextBlock, new RegExp(`Executive decision signal: "${pkg.businessIntelligence.executiveDecisionSignal}"`));
  assert.match(result.contextBlock, new RegExp(`Decision status: ${pkg.status}`));
  assert.match(result.contextBlock, new RegExp(`Recommendation status: ${pkg.executiveDecisionBrief.recommendationStatus}`));
});

test("every verified fact, assumption, and rationale line in the context block is a real, unmodified value from the package -- never invented", () => {
  const pkg = realSuccessfulPackage();
  const result = formatExecutiveDecisionSystemContext(pkg);

  for (const fact of pkg.executiveDecisionBrief.verifiedEvidence) {
    assert.ok(result.contextBlock.includes(fact), `expected verified fact to appear verbatim: ${fact}`);
  }
  for (const assumption of pkg.executiveDecisionBrief.assumptions) {
    assert.ok(result.contextBlock.includes(assumption), `expected assumption to appear verbatim: ${assumption}`);
  }
  for (const reason of pkg.executiveDecisionBrief.decisionRationale) {
    assert.ok(result.contextBlock.includes(reason), `expected rationale line to appear verbatim: ${reason}`);
  }
  for (const action of pkg.executiveDecisionBrief.immediateNextActions) {
    assert.ok(result.contextBlock.includes(action), `expected next action to appear verbatim: ${action}`);
  }
});

test("distinguishes verified facts, assumptions, inferred/directional conclusions, and unknowns as separate, clearly labeled sections", () => {
  const pkg = realSuccessfulPackage();
  const result = formatExecutiveDecisionSystemContext(pkg);

  assert.match(result.contextBlock, /Verified facts \(cite as established, sourced facts\):/);
  assert.match(result.contextBlock, /Assumptions \(state explicitly as assumptions, never as facts\):/);
  assert.match(result.contextBlock, /Inferred \/ directional conclusions \(present as interpretation, not certainty\):/);
  assert.match(result.contextBlock, /Unknowns \/ missing evidence \(name explicitly wherever relevant/);
});

test("an empty category is rendered honestly as 'none identified', never a fabricated placeholder item", () => {
  const pkg = realSuccessfulPackage();
  // This exact fixture is verified (see the research behind this task)
  // to produce zero real directional signals.
  assert.deepEqual(pkg.executiveDecisionBrief.directionalSignals, []);
  const result = formatExecutiveDecisionSystemContext(pkg);
  assert.match(result.contextBlock, /Inferred \/ directional conclusions \(present as interpretation, not certainty\): none identified\./);
});

test("surfaces detected conflicts with real severity and reason text when they exist, and reports 'None detected' honestly when they do not", () => {
  const noConflictPkg = realSuccessfulPackage();
  assert.equal(noConflictPkg.businessIntelligence.conflictDetection.conflicts.length, 0);
  const noConflictResult = formatExecutiveDecisionSystemContext(noConflictPkg);
  assert.match(noConflictResult.contextBlock, /Detected evidence conflicts \(none detected\):\n- None detected\./);

  const conflictPkg = clonedValidPackage((base) => ({
    ...base,
    businessIntelligence: {
      ...base.businessIntelligence,
      conflictDetection: {
        ...base.businessIntelligence.conflictDetection,
        overallSeverity: "medium",
        confidenceImpact: 35,
        additionalResearchRecommended: true,
        disagreeingSources: ["Gartner", "Forrester"],
        conflicts: [
          {
            topicId: "topic_0",
            a: "item_0",
            b: "item_1",
            sourceA: "Gartner",
            sourceB: "Forrester",
            reason: "Both items discuss the same topic but cite different figures.",
            conflictType: "numeric_mismatch",
            severity: "medium",
          },
        ],
      },
    },
  }));
  const conflictResult = formatExecutiveDecisionSystemContext(conflictPkg);
  assert.match(conflictResult.contextBlock, /Detected evidence conflicts \(overall severity: medium\):/);
  assert.match(conflictResult.contextBlock, /- \[medium\] Both items discuss the same topic but cite different figures\. \(sources: Gartner vs\. Forrester\)/);
});

test("includes the highest-priority next research action from Research Prioritization, alongside the brief's own next actions", () => {
  const pkg = realSuccessfulPackage();
  const topTask = pkg.businessIntelligence.researchPrioritization.prioritizedTasks[0];
  assert.ok(topTask, "fixture must have a real prioritized research task");

  const result = formatExecutiveDecisionSystemContext(pkg);
  assert.match(result.contextBlock, /Highest-priority next actions:/);
  assert.ok(
    result.contextBlock.includes(topTask.topic) && result.contextBlock.includes(topTask.explanation),
    "expected the real top-ranked research task's topic and explanation to appear"
  );
});

test("confidence drivers and penalties are rendered from the real Confidence Engine output", () => {
  const pkg = realSuccessfulPackage();
  const drivers = pkg.businessIntelligence.confidence.confidenceDrivers;
  const penalties = pkg.businessIntelligence.confidence.confidencePenalties;
  assert.ok(drivers.length > 0 && penalties.length > 0, "fixture must have real drivers and penalties");

  const result = formatExecutiveDecisionSystemContext(pkg);
  for (const driver of drivers) {
    assert.ok(result.contextBlock.includes(driver.description));
  }
  for (const penalty of penalties) {
    assert.ok(result.contextBlock.includes(`${penalty.factor} (-${penalty.impact}):`));
  }
});

test("long lists are truncated to a bounded number of items -- never an unbounded prompt, but never silently dropped without limit", () => {
  const manyFacts = Array.from({ length: 20 }, (_, index) => `Synthetic verified fact number ${index + 1} for truncation testing.`);
  const pkg = clonedValidPackage((base) => ({
    ...base,
    executiveDecisionBrief: {
      ...base.executiveDecisionBrief,
      verifiedEvidence: manyFacts,
    },
  }));

  const result = formatExecutiveDecisionSystemContext(pkg);
  const renderedCount = manyFacts.filter((fact) => result.contextBlock.includes(fact)).length;
  assert.ok(renderedCount > 0, "expected at least some facts to render");
  assert.ok(renderedCount < manyFacts.length, "expected the list to be truncated, not fully included");
});

test("returns both a verbose rule set and a compact single-bullet rule for the two prompt variants plan-executor.ts actually uses", () => {
  const pkg = realSuccessfulPackage();
  const result = formatExecutiveDecisionSystemContext(pkg);

  assert.ok(Array.isArray(result.qualityRuleBullets) && result.qualityRuleBullets.length > 0);
  assert.equal(typeof result.compactQualityRuleBullet, "string");
  assert.ok(result.compactQualityRuleBullet.length > 0);
  for (const keyword of ["confidence", "conflict", "assumption", "rationale", "next action"]) {
    assert.match(result.compactQualityRuleBullet.toLowerCase(), new RegExp(keyword));
  }
});

test("identical input always produces an identical result (determinism)", () => {
  const pkg = realSuccessfulPackage();
  const a = formatExecutiveDecisionSystemContext(structuredClone(pkg));
  const b = formatExecutiveDecisionSystemContext(structuredClone(pkg));
  assert.deepEqual(a, b);
});
