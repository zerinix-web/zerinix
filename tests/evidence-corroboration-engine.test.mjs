import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  decisionImpactValues,
  corroborationStatusValues,
  corroborationRequirementValues,
  evidenceCorroborationResultSchema,
  EVIDENCE_CORROBORATION_ENGINE_ENABLED_ENV_VAR,
  isEvidenceCorroborationEngineEnabled,
  checkEvidenceCorroboration,
} from "../app/lib/ai/evidence-corroboration-engine.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/evidence-corroboration-engine.ts", import.meta.url),
  "utf8"
);

const CONCLUSION = "The addressable market for AI accounting software exceeds $4 billion.";

const GARTNER_EVIDENCE = {
  id: "gartner",
  text: "The addressable market for AI accounting software is valued at $4.2 billion based on primary research.",
  source: { publisher: "Gartner" },
};
const STATISTA_EVIDENCE = {
  id: "statista",
  text: "Statista estimates the addressable market for accounting software at $4.5 billion this year.",
  source: { publisher: "Statista" },
};
const IDC_EVIDENCE = {
  id: "idc",
  text: "IDC reports the addressable market for accounting software reaching $4.8 billion.",
  source: { publisher: "IDC" },
};
const FORRESTER_EVIDENCE = {
  id: "forrester",
  text: "Forrester finds the addressable market for accounting software near $5 billion.",
  source: { publisher: "Forrester" },
};
const UNATTRIBUTED_EVIDENCE = {
  id: "anon",
  text: "Many analysts believe the addressable market for accounting software could reach several billion.",
};
const UNRELATED_EVIDENCE = {
  id: "unrelated",
  text: "Quarterly gross margin improved due to reduced manufacturing costs.",
  source: { publisher: "SomeCo" },
};

function withEnvFlag(value, fn) {
  const previous = process.env[EVIDENCE_CORROBORATION_ENGINE_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[EVIDENCE_CORROBORATION_ENGINE_ENABLED_ENV_VAR];
  } else {
    process.env[EVIDENCE_CORROBORATION_ENGINE_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[EVIDENCE_CORROBORATION_ENGINE_ENABLED_ENV_VAR];
    } else {
      process.env[EVIDENCE_CORROBORATION_ENGINE_ENABLED_ENV_VAR] = previous;
    }
  }
}

test("decisionImpactValues contains exactly low/medium/high/critical", () => {
  assert.deepEqual([...decisionImpactValues].sort(), ["low", "medium", "high", "critical"].sort());
});

test("corroborationStatusValues contains exactly the 4 required statuses", () => {
  assert.deepEqual(
    [...corroborationStatusValues].sort(),
    ["unsupported", "unattributed_only", "single_source", "multi_source_corroborated"].sort()
  );
});

test("corroborationRequirementValues contains exactly the 3 required values", () => {
  assert.deepEqual(
    [...corroborationRequirementValues].sort(),
    ["not_required", "required_and_met", "required_and_not_met"].sort()
  );
});

test("isEvidenceCorroborationEngineEnabled reads the env var exactly", () => {
  assert.equal(isEvidenceCorroborationEngineEnabled({}), false);
  assert.equal(isEvidenceCorroborationEngineEnabled({ [EVIDENCE_CORROBORATION_ENGINE_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isEvidenceCorroborationEngineEnabled({ [EVIDENCE_CORROBORATION_ENGINE_ENABLED_ENV_VAR]: "true" }), true);
});

test("by default (no env var, no override) corroboration checking is disabled and runs nothing", () => {
  withEnvFlag(undefined, () => {
    const result = checkEvidenceCorroboration({
      conclusions: [{ id: "c1", statement: CONCLUSION }],
      evidence: [GARTNER_EVIDENCE],
    });
    assert.equal(evidenceCorroborationResultSchema.safeParse(result).success, true);
    assert.equal(result.enabled, false);
    assert.deepEqual(result.conclusions, []);
  });
});

test("an explicit enabled:true overrides the env var", () => {
  withEnvFlag(undefined, () => {
    const result = checkEvidenceCorroboration({
      enabled: true,
      conclusions: [{ id: "c1", statement: CONCLUSION }],
      evidence: [GARTNER_EVIDENCE],
    });
    assert.equal(result.enabled, true);
  });
});

test("setting the env var to 'true' also enables checking", () => {
  withEnvFlag("true", () => {
    const result = checkEvidenceCorroboration({ conclusions: [], evidence: [] });
    assert.equal(result.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const result = checkEvidenceCorroboration({ enabled: false, conclusions: [], evidence: [] });
    assert.equal(result.enabled, false);
  });
});

test("a conclusion with no matching evidence at all is unsupported, penalized to zero confidence", () => {
  const result = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION }],
    evidence: [UNRELATED_EVIDENCE],
  });

  const conclusion = result.conclusions[0];
  assert.equal(conclusion.status, "unsupported");
  assert.equal(conclusion.confidence, 0);
  assert.equal(conclusion.independentSourceCount, 0);
  assert.deepEqual(result.unsupportedConclusionIds, ["c1"]);
  assert.match(conclusion.explanation, /No evidence was found/);
});

test("a conclusion supported only by unattributed text cannot be counted as an independent source, and is distinguished from a single named source", () => {
  const result = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION }],
    evidence: [UNATTRIBUTED_EVIDENCE],
  });

  const conclusion = result.conclusions[0];
  assert.equal(conclusion.status, "unattributed_only");
  assert.equal(conclusion.independentSourceCount, 0);
  assert.deepEqual(conclusion.independentSources, []);
  assert.deepEqual(result.unattributedOnlyConclusionIds, ["c1"]);
  assert.deepEqual(result.singleSourceConclusionIds, []);
});

test("detects single-source conclusions: exactly one identifiable source supporting a conclusion", () => {
  const result = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION }],
    evidence: [GARTNER_EVIDENCE],
  });

  const conclusion = result.conclusions[0];
  assert.equal(conclusion.status, "single_source");
  assert.equal(conclusion.independentSourceCount, 1);
  assert.deepEqual(conclusion.independentSources, ["Gartner"]);
  assert.deepEqual(result.singleSourceConclusionIds, ["c1"]);
});

test("detects multi-source confirmation: two distinct identifiable sources supporting a conclusion", () => {
  const result = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION }],
    evidence: [GARTNER_EVIDENCE, STATISTA_EVIDENCE],
  });

  const conclusion = result.conclusions[0];
  assert.equal(conclusion.status, "multi_source_corroborated");
  assert.equal(conclusion.independentSourceCount, 2);
  assert.deepEqual([...conclusion.independentSources].sort(), ["Gartner", "Statista"]);
  assert.deepEqual(result.multiSourceConclusionIds, ["c1"]);
  assert.match(conclusion.explanation, /Gartner/);
  assert.match(conclusion.explanation, /Statista/);
});

test("never fabricates corroboration: repeated mentions from the SAME publisher never count as more than one independent source", () => {
  const repeatedGartner = { id: "gartner_2", text: GARTNER_EVIDENCE.text, source: { publisher: "Gartner" } };
  const result = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION }],
    evidence: [GARTNER_EVIDENCE, repeatedGartner],
  });

  const conclusion = result.conclusions[0];
  assert.equal(conclusion.status, "single_source");
  assert.equal(conclusion.independentSourceCount, 1);
  assert.equal(conclusion.supportingEvidenceIds.length, 2);
});

test("confidence increases only as real, distinct independent source count increases, capped at 100 for 4 or more sources", () => {
  const two = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION }],
    evidence: [GARTNER_EVIDENCE, STATISTA_EVIDENCE],
  }).conclusions[0];
  const three = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION }],
    evidence: [GARTNER_EVIDENCE, STATISTA_EVIDENCE, IDC_EVIDENCE],
  }).conclusions[0];
  const four = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION }],
    evidence: [GARTNER_EVIDENCE, STATISTA_EVIDENCE, IDC_EVIDENCE, FORRESTER_EVIDENCE],
  }).conclusions[0];

  assert.equal(two.confidence, 70);
  assert.equal(three.confidence, 85);
  assert.equal(four.confidence, 100);
  assert.ok(two.confidence < three.confidence);
  assert.ok(three.confidence < four.confidence);
});

test("high-impact decisions require independent confirmation: a single-source conclusion is flagged required_and_not_met", () => {
  const result = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION, impact: "high" }],
    evidence: [GARTNER_EVIDENCE],
  });

  const conclusion = result.conclusions[0];
  assert.equal(conclusion.requirement, "required_and_not_met");
  assert.deepEqual(result.highImpactRequirementsNotMet, ["c1"]);
  assert.match(conclusion.explanation, /Independent confirmation.*is required/);
});

test("high-impact decisions with genuine multi-source corroboration meet the requirement", () => {
  const result = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION, impact: "high" }],
    evidence: [GARTNER_EVIDENCE, STATISTA_EVIDENCE],
  });

  const conclusion = result.conclusions[0];
  assert.equal(conclusion.requirement, "required_and_met");
  assert.deepEqual(result.highImpactRequirementsNotMet, []);
});

test("critical-impact decisions also require independent confirmation, same as high", () => {
  const result = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION, impact: "critical" }],
    evidence: [GARTNER_EVIDENCE],
  });

  assert.equal(result.conclusions[0].requirement, "required_and_not_met");
});

test("low and medium-impact decisions do not require independent confirmation, even when single-sourced", () => {
  const low = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION, impact: "low" }],
    evidence: [GARTNER_EVIDENCE],
  }).conclusions[0];
  const medium = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION, impact: "medium" }],
    evidence: [GARTNER_EVIDENCE],
  }).conclusions[0];

  assert.equal(low.requirement, "not_required");
  assert.equal(medium.requirement, "not_required");
});

test("an omitted impact defaults to medium, not the most lenient or most stringent option", () => {
  const result = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION }],
    evidence: [GARTNER_EVIDENCE],
  });

  assert.equal(result.conclusions[0].impact, "medium");
  assert.equal(result.conclusions[0].requirement, "not_required");
});

test("multiple conclusions are each independently classified, and the aggregate lists are mutually exclusive and correct", () => {
  const result = checkEvidenceCorroboration({
    enabled: true,
    conclusions: [
      { id: "unsupported_one", statement: "This has no evidence." },
      { id: "single_one", statement: CONCLUSION },
      { id: "multi_one", statement: "Customer churn for the subscription product has decreased significantly this quarter." },
    ],
    evidence: [
      GARTNER_EVIDENCE,
      { id: "churn_a", text: "Customer churn for the subscription product has decreased due to improved onboarding.", source: { publisher: "A" } },
      { id: "churn_b", text: "Subscription customer churn decreased significantly according to internal cohort analysis this quarter.", source: { publisher: "B" } },
    ],
  });

  assert.deepEqual(result.unsupportedConclusionIds, ["unsupported_one"]);
  assert.deepEqual(result.singleSourceConclusionIds, ["single_one"]);
  assert.deepEqual(result.multiSourceConclusionIds, ["multi_one"]);

  const allIds = [
    ...result.unsupportedConclusionIds,
    ...result.unattributedOnlyConclusionIds,
    ...result.singleSourceConclusionIds,
    ...result.multiSourceConclusionIds,
  ];
  assert.equal(new Set(allIds).size, allIds.length);
  assert.equal(allIds.length, result.conclusions.length);
});

test("identical input always produces an identical result (determinism)", () => {
  const input = {
    enabled: true,
    conclusions: [{ id: "c1", statement: CONCLUSION, impact: "high" }],
    evidence: [GARTNER_EVIDENCE, STATISTA_EVIDENCE],
  };
  const a = checkEvidenceCorroboration(input);
  const b = checkEvidenceCorroboration(input);
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
  assert.doesNotMatch(planRouteSource, /evidence-corroboration-engine|checkEvidenceCorroboration/);

  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (file === "evidence-corroboration-engine.ts" || !file.endsWith(".ts")) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /evidence-corroboration-engine|checkEvidenceCorroboration/,
      `expected ${file} to not yet reference the new standalone corroboration engine`
    );
  }
});
