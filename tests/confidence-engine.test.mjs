import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  confidenceFactorValues,
  confidenceEngineResultSchema,
  CONFIDENCE_ENGINE_ENABLED_ENV_VAR,
  isConfidenceEngineEnabled,
  computeConfidence,
} from "../app/lib/ai/confidence-engine.ts";
import { scoreEvidenceQuality } from "../app/lib/ai/evidence-quality-scoring.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/confidence-engine.ts", import.meta.url),
  "utf8"
);

const FIXED_NOW = new Date("2026-01-01T00:00:00Z");

function withEnvFlag(value, fn) {
  const previous = process.env[CONFIDENCE_ENGINE_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[CONFIDENCE_ENGINE_ENABLED_ENV_VAR];
  } else {
    process.env[CONFIDENCE_ENGINE_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[CONFIDENCE_ENGINE_ENABLED_ENV_VAR];
    } else {
      process.env[CONFIDENCE_ENGINE_ENABLED_ENV_VAR] = previous;
    }
  }
}

function strongEvidenceQualityResult() {
  return scoreEvidenceQuality(
    [
      {
        id: "gartner",
        text: "The addressable market for AI accounting software is valued at $4.2 billion with strong momentum.",
        source: { publisher: "Gartner", url: "https://gartner.example.com", publishedDate: "2025-11-01" },
        statedConfidence: 0.9,
      },
      {
        id: "statista",
        text: "The addressable market for AI accounting software is valued at $4.2 billion with strong momentum.",
        source: { publisher: "Statista", url: "https://statista.example.com", publishedDate: "2025-12-01" },
        statedConfidence: 0.85,
      },
    ],
    { enabled: true, now: FIXED_NOW }
  );
}

function weakEvidenceQualityResult() {
  return scoreEvidenceQuality([{ id: "unsourced", text: "Some unattributed claim with no source at all." }], {
    enabled: true,
    now: FIXED_NOW,
  });
}

function conflictingEvidenceQualityResult() {
  return scoreEvidenceQuality(
    [
      {
        id: "low_estimate",
        text: "The addressable market for AI accounting software is valued at $50 million based on research.",
        source: { publisher: "Gartner", url: "https://gartner.example.com", publishedDate: "2025-11-01" },
        statedConfidence: 0.8,
      },
      {
        id: "high_estimate",
        text: "The addressable market for AI accounting software is valued at $80 million based on research.",
        source: { publisher: "Statista", url: "https://statista.example.com", publishedDate: "2025-12-01" },
        statedConfidence: 0.8,
      },
    ],
    { enabled: true, now: FIXED_NOW }
  );
}

test("confidenceFactorValues contains exactly the 10 required factors", () => {
  assert.deepEqual(
    [...confidenceFactorValues].sort(),
    [
      "evidence_quality",
      "independent_sources",
      "source_authority",
      "evidence_agreement",
      "evidence_conflicts",
      "missing_evidence",
      "freshness",
      "traceability",
      "domain_risk",
      "decision_complexity",
    ].sort()
  );
});

test("isConfidenceEngineEnabled reads the env var exactly", () => {
  assert.equal(isConfidenceEngineEnabled({}), false);
  assert.equal(isConfidenceEngineEnabled({ [CONFIDENCE_ENGINE_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isConfidenceEngineEnabled({ [CONFIDENCE_ENGINE_ENABLED_ENV_VAR]: "true" }), true);
});

test("by default (no env var, no override) the engine is disabled and computes nothing", () => {
  withEnvFlag(undefined, () => {
    const result = computeConfidence({ evidenceQualityResult: strongEvidenceQualityResult() });
    assert.equal(confidenceEngineResultSchema.safeParse(result).success, true);
    assert.equal(result.enabled, false);
    assert.equal(result.confidence, 0);
    assert.deepEqual(result.factorScores, []);
  });
});

test("an explicit enabled:true overrides the env var", () => {
  withEnvFlag(undefined, () => {
    const result = computeConfidence({ enabled: true });
    assert.equal(result.enabled, true);
    assert.equal(result.factorScores.length, 10);
  });
});

test("setting the env var to 'true' also enables computation", () => {
  withEnvFlag("true", () => {
    const result = computeConfidence({});
    assert.equal(result.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const result = computeConfidence({ enabled: false });
    assert.equal(result.enabled, false);
  });
});

test("with no evidence, domain, or complexity supplied, every factor defaults conservatively -- never a fabricated mid-point for evidence-derived factors", () => {
  const result = computeConfidence({ enabled: true });

  const byFactor = Object.fromEntries(result.factorScores.map((f) => [f.factor, f.score]));
  assert.equal(byFactor.evidence_quality, 0);
  assert.equal(byFactor.independent_sources, 0);
  assert.equal(byFactor.source_authority, 0);
  assert.equal(byFactor.evidence_agreement, 0);
  assert.equal(byFactor.evidence_conflicts, 0);
  assert.equal(byFactor.missing_evidence, 0);
  assert.equal(byFactor.freshness, 0);
  assert.equal(byFactor.traceability, 0);
  assert.equal(byFactor.domain_risk, 50);
  assert.equal(byFactor.decision_complexity, 50);
  assert.equal(result.confidence, 10);
});

test("strong, corroborated, fresh, low-risk-domain evidence produces meaningfully higher confidence than the fully-unknown baseline", () => {
  const strong = computeConfidence({
    enabled: true,
    evidenceQualityResult: strongEvidenceQualityResult(),
    domain: "business",
    decisionComplexity: "low",
  });
  const baseline = computeConfidence({ enabled: true });

  assert.ok(strong.confidence > baseline.confidence, `expected ${strong.confidence} > ${baseline.confidence}`);
  assert.ok(strong.confidence >= 70, `expected a high confidence, got ${strong.confidence}`);
});

test("weak, unsourced evidence produces lower confidence than strong, corroborated evidence", () => {
  const weak = computeConfidence({ enabled: true, evidenceQualityResult: weakEvidenceQualityResult() });
  const strong = computeConfidence({ enabled: true, evidenceQualityResult: strongEvidenceQualityResult() });

  assert.ok(weak.confidence < strong.confidence);
});

test("confidence must increase only with verified evidence: adding a second, independently corroborating source strictly increases confidence over a single unconfirmed source", () => {
  const singleSource = scoreEvidenceQuality(
    [
      {
        id: "solo",
        text: "The addressable market for AI accounting software is valued at $4.2 billion with strong momentum.",
        source: { publisher: "Gartner", url: "https://gartner.example.com", publishedDate: "2025-11-01" },
        statedConfidence: 0.9,
      },
    ],
    { enabled: true, now: FIXED_NOW }
  );
  const corroborated = strongEvidenceQualityResult();

  const soloConfidence = computeConfidence({ enabled: true, evidenceQualityResult: singleSource });
  const corroboratedConfidence = computeConfidence({ enabled: true, evidenceQualityResult: corroborated });

  assert.ok(
    corroboratedConfidence.confidence > soloConfidence.confidence,
    `expected ${corroboratedConfidence.confidence} > ${soloConfidence.confidence}`
  );
});

test("confidence must decrease when evidence is weak: introducing a contradiction strictly decreases confidence versus the same evidence without the contradiction", () => {
  const withoutConflict = computeConfidence({ enabled: true, evidenceQualityResult: strongEvidenceQualityResult() });
  const withConflict = computeConfidence({ enabled: true, evidenceQualityResult: conflictingEvidenceQualityResult() });

  assert.ok(
    withConflict.confidence < withoutConflict.confidence,
    `expected ${withConflict.confidence} < ${withoutConflict.confidence}`
  );
  assert.ok(withConflict.confidencePenalties.some((p) => p.factor === "evidence_conflicts"));
});

test("missing evidence reduces confidence: supplying an expectedItemCount penalty on Evidence Quality Scoring lowers this engine's missing_evidence factor and overall confidence", () => {
  const pool = [
    {
      id: "one",
      text: "The addressable market for AI accounting software is valued at $4.2 billion.",
      source: { publisher: "Gartner", url: "https://gartner.example.com", publishedDate: "2025-11-01" },
      statedConfidence: 0.9,
    },
  ];
  const withoutExpectation = scoreEvidenceQuality(pool, { enabled: true, now: FIXED_NOW });
  const withExpectation = scoreEvidenceQuality(pool, { enabled: true, now: FIXED_NOW, expectedItemCount: 9 });

  const confidenceWithout = computeConfidence({ enabled: true, evidenceQualityResult: withoutExpectation });
  const confidenceWith = computeConfidence({ enabled: true, evidenceQualityResult: withExpectation });

  assert.ok(confidenceWith.confidence < confidenceWithout.confidence);
});

test("domain risk: legal, healthcare, and engineering require stronger evidence than business to reach the same confidence -- all else equal, they score lower", () => {
  const evidenceQualityResult = strongEvidenceQualityResult();
  const business = computeConfidence({ enabled: true, evidenceQualityResult, domain: "business" });

  for (const domain of ["legal", "healthcare", "engineering"]) {
    const result = computeConfidence({ enabled: true, evidenceQualityResult, domain });
    assert.ok(result.confidence < business.confidence, `expected ${domain} confidence < business confidence`);
  }
});

test("decision complexity: a high-complexity decision scores lower confidence than a low-complexity decision, all else equal", () => {
  const evidenceQualityResult = strongEvidenceQualityResult();
  const low = computeConfidence({ enabled: true, evidenceQualityResult, decisionComplexity: "low" });
  const high = computeConfidence({ enabled: true, evidenceQualityResult, decisionComplexity: "high" });

  assert.ok(high.confidence < low.confidence);
});

test("an explicit independentSourceCount overrides the derived lower-bound from Evidence Quality Scoring", () => {
  const evidenceQualityResult = strongEvidenceQualityResult();
  const derived = computeConfidence({ enabled: true, evidenceQualityResult });
  const overridden = computeConfidence({ enabled: true, evidenceQualityResult, independentSourceCount: 1 });

  const derivedFactor = derived.factorScores.find((f) => f.factor === "independent_sources").score;
  const overriddenFactor = overridden.factorScores.find((f) => f.factor === "independent_sources").score;

  assert.notEqual(derivedFactor, overriddenFactor);
  assert.equal(overriddenFactor, 30);
});

test("confidenceDrivers only include factors scoring >= 70, and confidencePenalties only include factors scoring < 50, with impact = 100 - score", () => {
  const result = computeConfidence({ enabled: true, evidenceQualityResult: weakEvidenceQualityResult(), domain: "business" });

  for (const driver of result.confidenceDrivers) {
    const factor = result.factorScores.find((f) => f.factor === driver.factor);
    assert.ok(factor.score >= 70);
  }
  for (const penalty of result.confidencePenalties) {
    const factor = result.factorScores.find((f) => f.factor === penalty.factor);
    assert.ok(factor.score < 50);
    assert.equal(penalty.impact, 100 - factor.score);
  }
});

test("confidenceExplanation cites the actual computed confidence number", () => {
  const result = computeConfidence({ enabled: true, evidenceQualityResult: strongEvidenceQualityResult(), domain: "business" });
  assert.match(result.confidenceExplanation, new RegExp(`${result.confidence}/100`));
});

test("factorScores always has exactly 10 entries, each weighted equally at 10%", () => {
  const result = computeConfidence({ enabled: true, evidenceQualityResult: strongEvidenceQualityResult() });
  assert.equal(result.factorScores.length, 10);
  for (const entry of result.factorScores) {
    assert.equal(entry.weight, 0.1);
  }
});

test("never hardcodes the final percentage: confidence always equals the weighted sum of the actually-returned factor scores, recomputed independently", () => {
  const result = computeConfidence({ enabled: true, evidenceQualityResult: strongEvidenceQualityResult(), domain: "finance", decisionComplexity: "medium" });
  const recomputed = Math.round(result.factorScores.reduce((sum, entry) => sum + entry.score * entry.weight, 0));
  assert.equal(result.confidence, recomputed);
});

test("identical input always produces an identical result (determinism)", () => {
  const evidenceQualityResult = strongEvidenceQualityResult();
  const input = { enabled: true, evidenceQualityResult, domain: "business", decisionComplexity: "medium" };

  const a = computeConfidence(input);
  const b = computeConfidence(input);
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
  assert.doesNotMatch(planRouteSource, /confidence-engine|computeConfidence/);

  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (
      file === "confidence-engine.ts" ||
      // ZERINIX Business Intelligence Orchestrator v1 legitimately
      // coordinates Confidence Engine as one of its 8 stages.
      file === "business-intelligence-orchestrator.ts" ||
      !file.endsWith(".ts")
    ) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /confidence-engine|computeConfidence/,
      `expected ${file} to not yet reference the new standalone confidence engine`
    );
  }
});
