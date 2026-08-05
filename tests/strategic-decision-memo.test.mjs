import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  STRATEGIC_DECISION_MEMO_ENABLED_ENV_VAR,
  isStrategicDecisionMemoEnabled,
  strategicDecisionMemoSchema,
  recommendedActionSourceValues,
  buildStrategicDecisionMemo,
} from "../app/lib/ai/strategic-decision-memo.ts";
import {
  runExecutiveDecisionSystem,
  executiveDecisionPackageSchema,
} from "../app/lib/ai/executive-decision-system.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/strategic-decision-memo.ts", import.meta.url),
  "utf8"
);

function withEnvFlag(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
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
  assert.ok(pkg.businessIntelligence && pkg.executiveDecisionBrief);
  return pkg;
}

function clonedValidPackage(mutate) {
  const base = structuredClone(realSuccessfulPackage());
  const mutated = mutate(base);
  const check = executiveDecisionPackageSchema.safeParse(mutated);
  assert.equal(check.success, true, `mutated fixture must remain schema-valid: ${JSON.stringify(check.error?.issues)}`);
  return check.data;
}

test("isStrategicDecisionMemoEnabled reads the env var exactly", () => {
  assert.equal(isStrategicDecisionMemoEnabled({}), false);
  assert.equal(isStrategicDecisionMemoEnabled({ [STRATEGIC_DECISION_MEMO_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isStrategicDecisionMemoEnabled({ [STRATEGIC_DECISION_MEMO_ENABLED_ENV_VAR]: "true" }), true);
});

test("recommendedActionSourceValues contains exactly the 2 required sources", () => {
  assert.deepEqual([...recommendedActionSourceValues].sort(), ["brief_next_action", "top_research_priority"].sort());
});

test("by default (no env var, no override) the memo is disabled and nothing is generated, even with a real package supplied", () => {
  withEnvFlag(STRATEGIC_DECISION_MEMO_ENABLED_ENV_VAR, undefined, () => {
    const pkg = realSuccessfulPackage();
    const memo = buildStrategicDecisionMemo({ executiveDecisionPackage: pkg });
    assert.equal(strategicDecisionMemoSchema.safeParse(memo).success, true);
    assert.equal(memo.enabled, false);
    assert.equal(memo.generated, false);
    assert.deepEqual(memo.verifiedFacts, []);
    assert.deepEqual(memo.recommendedActions, []);
  });
});

test("an explicit enabled:true overrides the env var", () => {
  withEnvFlag(STRATEGIC_DECISION_MEMO_ENABLED_ENV_VAR, undefined, () => {
    const pkg = realSuccessfulPackage();
    const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });
    assert.equal(memo.enabled, true);
    assert.equal(memo.generated, true);
  });
});

test("setting the env var to 'true' also enables generation", () => {
  withEnvFlag(STRATEGIC_DECISION_MEMO_ENABLED_ENV_VAR, "true", () => {
    const pkg = realSuccessfulPackage();
    const memo = buildStrategicDecisionMemo({ executiveDecisionPackage: pkg });
    assert.equal(memo.enabled, true);
    assert.equal(memo.generated, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag(STRATEGIC_DECISION_MEMO_ENABLED_ENV_VAR, "true", () => {
    const pkg = realSuccessfulPackage();
    const memo = buildStrategicDecisionMemo({ enabled: false, executiveDecisionPackage: pkg });
    assert.equal(memo.enabled, false);
    assert.equal(memo.generated, false);
  });
});

test("calling with the default argument (no input at all) is safe and returns a disabled, schema-valid memo", () => {
  const memo = buildStrategicDecisionMemo();
  assert.equal(strategicDecisionMemoSchema.safeParse(memo).success, true);
  assert.equal(memo.enabled, false);
});

test("enabled but no package supplied: nothing is generated, never a fabricated placeholder memo", () => {
  const memo = buildStrategicDecisionMemo({ enabled: true });
  assert.equal(strategicDecisionMemoSchema.safeParse(memo).success, true);
  assert.equal(memo.generated, false);
  assert.match(memo.reasonNotGenerated, /No valid Executive Decision System package/);
  assert.equal(memo.status, "not_started");
});

test("enabled with malformed input: nothing is generated", () => {
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: { status: "not-a-real-status" } });
  assert.equal(memo.generated, false);
});

test("enabled with a valid package that never computed Business Intelligence / Executive Decision Brief data: honestly reports the real status, generates nothing fabricated", () => {
  const pkg = clonedValidPackage((base) => ({
    ...base,
    businessIntelligenceApplied: false,
    businessIntelligence: null,
    executiveDecisionBrief: null,
  }));
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });
  assert.equal(memo.generated, false);
  assert.equal(memo.status, pkg.status);
  assert.match(memo.reasonNotGenerated, /did not compute Business Intelligence/);
});

test("successful generation: the memo clearly distinguishes all 6 required categories as separate, independently inspectable fields", () => {
  const pkg = realSuccessfulPackage();
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });

  assert.equal(strategicDecisionMemoSchema.safeParse(memo).success, true);
  assert.equal(memo.generated, true);
  for (const category of ["verifiedFacts", "assumptions", "risks", "opportunities", "recommendedActions", "confidence"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(memo, category), `expected a distinct ${category} field`);
  }
  assert.ok(Array.isArray(memo.verifiedFacts));
  assert.ok(Array.isArray(memo.assumptions));
  assert.ok(Array.isArray(memo.risks));
  assert.ok(Array.isArray(memo.opportunities));
  assert.ok(Array.isArray(memo.recommendedActions));
  assert.equal(typeof memo.confidence, "object");
});

test("verified facts and assumptions are real, unmodified reads of Executive Decision Brief's own fields -- never invented", () => {
  const pkg = realSuccessfulPackage();
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });

  assert.deepEqual(memo.verifiedFacts, pkg.executiveDecisionBrief.verifiedEvidence);
  assert.deepEqual(memo.assumptions, pkg.executiveDecisionBrief.assumptions);
  assert.deepEqual(memo.decisionRationale, pkg.executiveDecisionBrief.decisionRationale);
});

test("every recommended action references its own supporting evidence internally, and that evidence is a real, verbatim-quoted string -- never a fabricated citation", () => {
  const pkg = realSuccessfulPackage();
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });

  assert.ok(memo.recommendedActions.length > 0, "expected at least one recommended action for this fixture");

  const realEvidencePool = [
    ...pkg.executiveDecisionBrief.verifiedEvidence,
    ...pkg.executiveDecisionBrief.assumptions,
    ...pkg.executiveDecisionBrief.missingCriticalEvidence,
    ...pkg.executiveDecisionBrief.keyRisks,
    ...pkg.executiveDecisionBrief.immediateNextActions,
    ...(pkg.businessIntelligence.researchPrioritization?.prioritizedTasks.map((t) => t.explanation) ?? []),
  ];

  for (const recommendedAction of memo.recommendedActions) {
    assert.ok(recommendedAction.supportingEvidence.length >= 1, "every recommendation must cite at least one piece of evidence");
    for (const citation of recommendedAction.supportingEvidence) {
      assert.ok(
        realEvidencePool.some((real) => real.includes(citation) || citation === recommendedAction.action),
        `expected citation to be real, verbatim evidence, got: ${citation}`
      );
    }
  }
});

test("recommended actions include the brief's own next actions and the Business Intelligence Orchestrator's highest-priority next research action", () => {
  const pkg = realSuccessfulPackage();
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });

  for (const action of pkg.executiveDecisionBrief.immediateNextActions) {
    assert.ok(
      memo.recommendedActions.some((entry) => entry.action === action && entry.source === "brief_next_action")
    );
  }

  const topTask = pkg.businessIntelligence.researchPrioritization.prioritizedTasks[0];
  const topResearchAction = memo.recommendedActions.find((entry) => entry.source === "top_research_priority");
  assert.ok(topResearchAction, "expected the top-ranked research task to appear as a recommended action");
  assert.equal(topResearchAction.action, topTask.topic);
  assert.deepEqual(topResearchAction.supportingEvidence, [topTask.explanation]);
});

test("confidence surfaces the real aggregate confidence, decision confidence, and Confidence Engine's own drivers/penalties", () => {
  const pkg = realSuccessfulPackage();
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });

  assert.equal(memo.confidence.aggregateConfidence, pkg.businessIntelligence.aggregateConfidence);
  assert.equal(memo.confidence.decisionConfidence, pkg.executiveDecisionBrief.decisionConfidence);
  assert.deepEqual(memo.confidence.drivers, pkg.businessIntelligence.confidence.confidenceDrivers);
  assert.deepEqual(memo.confidence.penalties, pkg.businessIntelligence.confidence.confidencePenalties);
});

test("an empty category (no real conflicts, no advisory data) is honestly empty, never a fabricated placeholder entry", () => {
  const pkg = realSuccessfulPackage();
  assert.deepEqual(pkg.businessIntelligence.conflictDetection.conflicts, []);
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });
  assert.deepEqual(memo.detectedConflicts, []);
  assert.deepEqual(memo.opportunities, []);
});

test("surfaces a real detected conflict as both a Risk entry (quoting its real severity/reason) and in detectedConflicts", () => {
  const conflictPkg = clonedValidPackage((base) => ({
    ...base,
    businessIntelligence: {
      ...base.businessIntelligence,
      conflictDetection: {
        ...base.businessIntelligence.conflictDetection,
        overallSeverity: "medium",
        confidenceImpact: 35,
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

  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: conflictPkg });
  assert.deepEqual(memo.detectedConflicts, conflictPkg.businessIntelligence.conflictDetection.conflicts);
  assert.ok(
    memo.risks.some((risk) => risk.includes("[medium]") && risk.includes("Both items discuss the same topic but cite different figures.")),
    "expected the real conflict to also appear as a risk entry"
  );
});

test("opportunities are read verbatim from Executive Advisory when available, and stay honestly empty when it is not", () => {
  const opportunityPkg = clonedValidPackage((base) => ({
    ...base,
    executiveDecisionBrief: {
      ...base.executiveDecisionBrief,
      executiveAdvisory: {
        domain: "business",
        executiveRecommendationHeadline: base.executiveDecisionBrief.executiveRecommendation,
        why: base.executiveDecisionBrief.decisionRationale,
        supportingEvidence: base.executiveDecisionBrief.verifiedEvidence,
        contradictoryEvidence: [],
        confidenceNarrative: base.executiveDecisionBrief.confidenceExplanation,
        businessImpact: ["Pricing strategy directly affects near-term revenue."],
        risks: base.executiveDecisionBrief.keyRisks,
        opportunities: ["Signed letters of intent indicate genuine near-term demand."],
        assumptions: base.executiveDecisionBrief.assumptions,
        missingEvidence: base.executiveDecisionBrief.missingCriticalEvidence,
        nextDecisions: base.executiveDecisionBrief.immediateNextActions.length === 3
          ? base.executiveDecisionBrief.immediateNextActions
          : ["Decide A.", "Decide B.", "Decide C."],
        structureNotes: ["Structured using verified-evidence business reasoning for the \"business\" context."],
      },
    },
  }));

  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: opportunityPkg });
  assert.deepEqual(memo.opportunities, ["Signed letters of intent indicate genuine near-term demand."]);
});

test("research priorities are the real, unmodified Research Prioritization Engine output", () => {
  const pkg = realSuccessfulPackage();
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });
  assert.deepEqual(memo.researchPriorities, pkg.businessIntelligence.researchPrioritization.prioritizedTasks);
});

test("evidence trace combines the brief's own trace with Decision Engine's own trace, deduplicated", () => {
  const pkg = realSuccessfulPackage();
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });
  for (const line of pkg.executiveDecisionBrief.evidenceTrace) {
    assert.ok(memo.evidenceTrace.includes(line));
  }
  assert.equal(memo.evidenceTrace.length, new Set(memo.evidenceTrace).size, "expected no duplicate trace lines");
});

test("identical input always produces an identical result (determinism)", () => {
  const pkg = realSuccessfulPackage();
  const a = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: structuredClone(pkg) });
  const b = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: structuredClone(pkg) });
  assert.deepEqual(a, b);
});

test("never fabricates: the whole memo always parses under the strict schema, for every scenario exercised in this file", () => {
  const scenarios = [
    buildStrategicDecisionMemo(),
    buildStrategicDecisionMemo({ enabled: true }),
    buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: realSuccessfulPackage() }),
  ];
  for (const memo of scenarios) {
    assert.equal(strategicDecisionMemoSchema.safeParse(memo).success, true);
  }
});

test("does not modify UI, PDF generation, billing, authentication, routing, or report schemas, and is not wired into any production route or other module yet", async () => {
  assert.doesNotMatch(engineSource, /from ["'].*(?:pdf-engine|report-engine|report-jobs|billing|auth)/i);

  const planRouteSource = await readFile(new URL("../app/api/plan/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(planRouteSource, /strategic-decision-memo|buildStrategicDecisionMemo/);

  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (
      file === "strategic-decision-memo.ts" ||
      // ZERINIX Executive Brief Generator v1 legitimately reuses
      // strategicRecommendedActionSchema/StrategicRecommendedAction for
      // its own Immediate Next Actions section.
      file === "executive-brief-generator.ts" ||
      !file.endsWith(".ts")
    ) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /strategic-decision-memo|buildStrategicDecisionMemo/,
      `expected ${file} to not yet reference the new Strategic Decision Memo module`
    );
  }
});
