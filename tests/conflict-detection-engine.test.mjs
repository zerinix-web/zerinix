import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  conflictSeverityValues,
  conflictTypeValues,
  conflictDetectionResultSchema,
  CONFLICT_DETECTION_ENGINE_ENABLED_ENV_VAR,
  isConflictDetectionEngineEnabled,
  detectConflicts,
} from "../app/lib/ai/conflict-detection-engine.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/conflict-detection-engine.ts", import.meta.url),
  "utf8"
);

function withEnvFlag(value, fn) {
  const previous = process.env[CONFLICT_DETECTION_ENGINE_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[CONFLICT_DETECTION_ENGINE_ENABLED_ENV_VAR];
  } else {
    process.env[CONFLICT_DETECTION_ENGINE_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[CONFLICT_DETECTION_ENGINE_ENABLED_ENV_VAR];
    } else {
      process.env[CONFLICT_DETECTION_ENGINE_ENABLED_ENV_VAR] = previous;
    }
  }
}

test("conflictSeverityValues contains exactly Low/Medium/High/Critical", () => {
  assert.deepEqual([...conflictSeverityValues].sort(), ["low", "medium", "high", "critical"].sort());
});

test("conflictTypeValues contains exactly numeric_mismatch and directional_mismatch", () => {
  assert.deepEqual([...conflictTypeValues].sort(), ["numeric_mismatch", "directional_mismatch"].sort());
});

test("isConflictDetectionEngineEnabled reads the env var exactly", () => {
  assert.equal(isConflictDetectionEngineEnabled({}), false);
  assert.equal(isConflictDetectionEngineEnabled({ [CONFLICT_DETECTION_ENGINE_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isConflictDetectionEngineEnabled({ [CONFLICT_DETECTION_ENGINE_ENABLED_ENV_VAR]: "true" }), true);
});

test("by default (no env var, no override) detection is disabled and runs nothing", () => {
  withEnvFlag(undefined, () => {
    const result = detectConflicts([{ id: "a", text: "Some evidence." }]);
    assert.equal(conflictDetectionResultSchema.safeParse(result).success, true);
    assert.equal(result.enabled, false);
    assert.deepEqual(result.topicGroups, []);
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.overallSeverity, null);
    assert.equal(result.confidenceImpact, 0);
  });
});

test("an explicit enabled:true overrides the env var", () => {
  withEnvFlag(undefined, () => {
    const result = detectConflicts([{ id: "a", text: "Some evidence." }], { enabled: true });
    assert.equal(result.enabled, true);
  });
});

test("setting the env var to 'true' also enables detection", () => {
  withEnvFlag("true", () => {
    const result = detectConflicts([{ id: "a", text: "Some evidence." }]);
    assert.equal(result.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const result = detectConflicts([{ id: "a", text: "Some evidence." }], { enabled: false });
    assert.equal(result.enabled, false);
  });
});

test("never fabricates a conflict: topically unrelated evidence is never flagged, even if it superficially could be", () => {
  const result = detectConflicts(
    [
      { id: "property", text: "The property is located in a suburban residential zone near public transit.", source: { publisher: "X" } },
      { id: "financials", text: "Quarterly gross margin improved due to reduced manufacturing costs.", source: { publisher: "Y" } },
    ],
    { enabled: true }
  );

  assert.equal(result.topicGroups.length, 2);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.disagreeingSources, []);
  assert.equal(result.overallSeverity, null);
  assert.equal(result.confidenceImpact, 0);
  assert.equal(result.additionalResearchRecommended, false);
});

test("topically overlapping, non-conflicting, differently-sourced evidence is grouped together and counted as agreement, not a conflict", () => {
  const result = detectConflicts(
    [
      {
        id: "gartner",
        text: "The addressable market for AI accounting software shows strong momentum among enterprise buyers.",
        source: { publisher: "Gartner" },
      },
      {
        id: "statista",
        text: "The addressable market for AI accounting software demonstrates strong momentum among enterprise buyers.",
        source: { publisher: "Statista" },
      },
    ],
    { enabled: true }
  );

  assert.equal(result.topicGroups.length, 1);
  assert.equal(result.topicGroups[0].agreementCount, 1);
  assert.equal(result.topicGroups[0].disagreementCount, 0);
  assert.equal(result.topicGroups[0].severity, null);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.overallSeverity, null);
});

test("a numeric mismatch between topically-overlapping evidence is detected as a conflict, naming both disagreeing sources", () => {
  const result = detectConflicts(
    [
      {
        id: "low_estimate",
        text: "The addressable market for AI accounting software is valued at $50 million based on research.",
        source: { publisher: "Gartner" },
      },
      {
        id: "high_estimate",
        text: "The addressable market for AI accounting software is valued at $80 million based on research.",
        source: { publisher: "Statista" },
      },
    ],
    { enabled: true }
  );

  assert.equal(result.conflicts.length, 1);
  const conflict = result.conflicts[0];
  assert.equal(conflict.conflictType, "numeric_mismatch");
  assert.deepEqual([conflict.a, conflict.b].sort(), ["high_estimate", "low_estimate"]);
  assert.deepEqual([conflict.sourceA, conflict.sourceB].sort(), ["Gartner", "Statista"]);
  assert.deepEqual(result.disagreeingSources.sort(), ["Gartner", "Statista"]);
  assert.equal(result.overallSeverity, "critical");
  assert.equal(result.confidenceImpact, 90);
});

test("a keyword-only counter-signal (no numbers involved) between overlapping evidence is detected as a directional mismatch", () => {
  const result = detectConflicts(
    [
      { id: "growth", text: "Enterprise demand for AI accounting software continues to grow steadily among mid-market buyers.", source: { publisher: "A" } },
      { id: "risk", text: "However, there is significant risk that enterprise demand for AI accounting software may decline among mid-market buyers.", source: { publisher: "B" } },
    ],
    { enabled: true }
  );

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].conflictType, "directional_mismatch");
});

test("topic grouping is transitive: A overlapping B and B overlapping C puts all three in one group even if A and C do not directly overlap", () => {
  const result = detectConflicts(
    [
      { id: "a", text: "The addressable market for accounting software is large and growing steadily.", source: { publisher: "P1" } },
      { id: "b", text: "The accounting software market shows strong momentum among small business buyers.", source: { publisher: "P2" } },
      { id: "c", text: "Small business buyers demonstrate strong momentum and increasingly adopt cloud-based tools for daily operations.", source: { publisher: "P3" } },
    ],
    { enabled: true }
  );

  assert.equal(result.topicGroups.length, 1);
  assert.deepEqual(result.topicGroups[0].memberIds.sort(), ["a", "b", "c"]);
});

test("severity bucketing: a 4-member topic with a 0.5 disagreement ratio (3 agree, 1 outlier) is Medium", () => {
  const result = detectConflicts(
    [
      { id: "m1", text: "The addressable market for accounting software is valued at $100 million.", source: { publisher: "P1" } },
      { id: "m2", text: "The addressable market for accounting software is valued at $100 million.", source: { publisher: "P2" } },
      { id: "m3", text: "The addressable market for accounting software is valued at $100 million.", source: { publisher: "P3" } },
      { id: "m4", text: "The addressable market for accounting software is valued at $200 million.", source: { publisher: "P4" } },
    ],
    { enabled: true }
  );

  assert.equal(result.topicGroups.length, 1);
  const group = result.topicGroups[0];
  assert.equal(group.disagreementCount, 3);
  assert.equal(group.agreementCount, 3);
  assert.equal(group.agreementRatio, 0.5);
  assert.equal(group.severity, "medium");
  assert.equal(result.overallSeverity, "medium");
  assert.equal(result.confidenceImpact, 35);
});

test("severity bucketing: a 4-member topic with a ~0.667 disagreement ratio (two agreeing pairs, cross-conflicting) is High", () => {
  const result = detectConflicts(
    [
      { id: "h1", text: "The addressable market for accounting software is valued at $100 million.", source: { publisher: "P1" } },
      { id: "h2", text: "The addressable market for accounting software is valued at $100 million.", source: { publisher: "P2" } },
      { id: "h3", text: "The addressable market for accounting software is valued at $200 million.", source: { publisher: "P3" } },
      { id: "h4", text: "The addressable market for accounting software is valued at $200 million.", source: { publisher: "P4" } },
    ],
    { enabled: true }
  );

  const group = result.topicGroups[0];
  assert.equal(group.disagreementCount, 4);
  assert.equal(group.agreementCount, 2);
  assert.equal(group.severity, "high");
  assert.equal(result.confidenceImpact, 60);
});

test("severity bucketing: a single isolated conflicting pair within a much larger, otherwise-agreeing topic group is Low", () => {
  const result = detectConflicts(
    [
      { id: "l1", text: "The addressable market for accounting software is valued at $100 million.", source: { publisher: "P1" } },
      { id: "l2", text: "The addressable market for accounting software is valued at $200 million.", source: { publisher: "P2" } },
      { id: "l3", text: "The addressable market for accounting software shows strong enterprise adoption.", source: { publisher: "P3" } },
      { id: "l4", text: "The addressable market for accounting software shows strong small-business adoption.", source: { publisher: "P4" } },
      { id: "l5", text: "The addressable market for accounting software shows strong mid-market adoption.", source: { publisher: "P5" } },
      { id: "l6", text: "The addressable market for accounting software shows strong international adoption.", source: { publisher: "P6" } },
    ],
    { enabled: true }
  );

  const group = result.topicGroups[0];
  assert.equal(group.disagreementCount, 1);
  assert.ok(group.agreementRatio > 0.75, `expected a high agreement ratio, got ${group.agreementRatio}`);
  assert.equal(group.severity, "low");
  assert.equal(result.confidenceImpact, 15);
});

test("additionalResearchRecommended is true for medium/high/critical severity, and false for low or no conflicts", () => {
  const noConflict = detectConflicts(
    [{ id: "a", text: "Unrelated fact one." }, { id: "b", text: "Completely different fact two about something else." }],
    { enabled: true }
  );
  assert.equal(noConflict.additionalResearchRecommended, false);
  assert.deepEqual(noConflict.researchRecommendations, []);

  const critical = detectConflicts(
    [
      { id: "low_estimate", text: "The addressable market for accounting software is valued at $50 million.", source: { publisher: "Gartner" } },
      { id: "high_estimate", text: "The addressable market for accounting software is valued at $80 million.", source: { publisher: "Statista" } },
    ],
    { enabled: true }
  );
  assert.equal(critical.additionalResearchRecommended, true);
  assert.equal(critical.researchRecommendations.length, 1);
  assert.match(critical.researchRecommendations[0], /Gartner/);
  assert.match(critical.researchRecommendations[0], /Statista/);
});

test("never ignores conflicting evidence: every conflicting pair within a topic is included in the conflicts array, none dropped", () => {
  const result = detectConflicts(
    [
      { id: "h1", text: "The addressable market for accounting software is valued at $100 million.", source: { publisher: "P1" } },
      { id: "h2", text: "The addressable market for accounting software is valued at $100 million.", source: { publisher: "P2" } },
      { id: "h3", text: "The addressable market for accounting software is valued at $200 million.", source: { publisher: "P3" } },
      { id: "h4", text: "The addressable market for accounting software is valued at $200 million.", source: { publisher: "P4" } },
    ],
    { enabled: true }
  );

  // h1/h2 vs h3/h4 cross-conflicts: (h1,h3) (h1,h4) (h2,h3) (h2,h4) = 4 pairs.
  const pairKeys = result.conflicts.map((c) => [c.a, c.b].sort().join("|")).sort();
  assert.deepEqual(pairKeys, [
    ["h1", "h3"].sort().join("|"),
    ["h1", "h4"].sort().join("|"),
    ["h2", "h3"].sort().join("|"),
    ["h2", "h4"].sort().join("|"),
  ].sort());
});

test("overall severity is always the WORST severity found across all topic groups, never averaged down by an unrelated calmer topic", () => {
  const result = detectConflicts(
    [
      // Low-severity topic: one isolated outlier among many agreeing items.
      { id: "l1", text: "The addressable market for accounting software is valued at $100 million.", source: { publisher: "P1" } },
      { id: "l2", text: "The addressable market for accounting software is valued at $200 million.", source: { publisher: "P2" } },
      { id: "l3", text: "The addressable market for accounting software shows strong enterprise adoption.", source: { publisher: "P3" } },
      { id: "l4", text: "The addressable market for accounting software shows strong small-business adoption.", source: { publisher: "P4" } },
      { id: "l5", text: "The addressable market for accounting software shows strong mid-market adoption.", source: { publisher: "P5" } },
      { id: "l6", text: "The addressable market for accounting software shows strong international adoption.", source: { publisher: "P6" } },
      // Critical-severity topic: a completely unrelated head-to-head conflict.
      { id: "low_estimate", text: "Our unrelated property valuation comes in at $1 million per the appraisal.", source: { publisher: "Appraiser A" } },
      { id: "high_estimate", text: "Our unrelated property valuation comes in at $2 million per the appraisal.", source: { publisher: "Appraiser B" } },
    ],
    { enabled: true }
  );

  assert.equal(result.topicGroups.length, 2);
  const severities = result.topicGroups.map((g) => g.severity);
  assert.ok(severities.includes("low"));
  assert.ok(severities.includes("critical"));
  assert.equal(result.overallSeverity, "critical");
  assert.equal(result.confidenceImpact, 90);
});

test("disagreeingSources is a deduplicated list of every publisher involved in any conflict", () => {
  const result = detectConflicts(
    [
      { id: "h1", text: "The addressable market for accounting software is valued at $100 million.", source: { publisher: "P1" } },
      { id: "h2", text: "The addressable market for accounting software is valued at $100 million.", source: { publisher: "P2" } },
      { id: "h3", text: "The addressable market for accounting software is valued at $200 million.", source: { publisher: "P1" } },
    ],
    { enabled: true }
  );

  assert.deepEqual(result.disagreeingSources.sort(), ["P1", "P2"]);
});

test("identical input always produces an identical result (determinism)", () => {
  const pool = [
    { id: "a", text: "The addressable market for accounting software is valued at $100 million.", source: { publisher: "P1" } },
    { id: "b", text: "The addressable market for accounting software is valued at $200 million.", source: { publisher: "P2" } },
  ];
  const a = detectConflicts(pool, { enabled: true });
  const b = detectConflicts(pool, { enabled: true });
  assert.deepEqual(a, b);
});

test("does not modify report generation, PDF generation, billing, or UI, and is not wired into any production route or other module yet", async () => {
  assert.doesNotMatch(
    engineSource,
    /from ["'].*(?:pdf-engine|report-engine|report-jobs|billing|auth)/i
  );

  const planRouteSource = await readFile(
    new URL("../app/api/plan/route.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(planRouteSource, /conflict-detection-engine|detectConflicts/);

  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (
      file === "conflict-detection-engine.ts" ||
      // ZERINIX Business Intelligence Orchestrator v1 legitimately
      // coordinates Conflict Detection Engine as one of its 8 stages.
      file === "business-intelligence-orchestrator.ts" ||
      // ZERINIX Strategic Decision Memo v1 legitimately reuses
      // detectedConflictSchema for its own detectedConflicts field.
      file === "strategic-decision-memo.ts" ||
      !file.endsWith(".ts")
    ) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /conflict-detection-engine|detectConflicts/,
      `expected ${file} to not yet reference the new standalone conflict detection engine`
    );
  }
});
