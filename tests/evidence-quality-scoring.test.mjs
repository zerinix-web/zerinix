import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  evidenceQualityDimensionValues,
  evidenceQualityFlagValues,
  evidenceQualityScoringResultSchema,
  EVIDENCE_QUALITY_SCORING_ENABLED_ENV_VAR,
  isEvidenceQualityScoringEnabled,
  scoreEvidenceQuality,
  scoreEvidenceAcquisitionResult,
} from "../app/lib/ai/evidence-quality-scoring.ts";
import { runEvidenceAcquisitionEngine } from "../app/lib/ai/evidence-acquisition-engine.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/evidence-quality-scoring.ts", import.meta.url),
  "utf8"
);

const FIXED_NOW = new Date("2026-01-01T00:00:00Z");

function withEnvFlag(value, fn) {
  const previous = process.env[EVIDENCE_QUALITY_SCORING_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[EVIDENCE_QUALITY_SCORING_ENABLED_ENV_VAR];
  } else {
    process.env[EVIDENCE_QUALITY_SCORING_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[EVIDENCE_QUALITY_SCORING_ENABLED_ENV_VAR];
    } else {
      process.env[EVIDENCE_QUALITY_SCORING_ENABLED_ENV_VAR] = previous;
    }
  }
}

test("evidenceQualityDimensionValues contains exactly the 8 required dimensions", () => {
  assert.deepEqual(
    [...evidenceQualityDimensionValues].sort(),
    [
      "source_authority",
      "source_freshness",
      "evidence_completeness",
      "relevance_to_decision",
      "independent_confirmation",
      "conflict_detection",
      "traceability",
      "confidence",
    ].sort()
  );
});

test("evidenceQualityFlagValues contains the required flags", () => {
  assert.deepEqual(
    [...evidenceQualityFlagValues].sort(),
    ["low_quality", "missing_source", "stale", "unverifiable", "irrelevant", "contradicted"].sort()
  );
});

test("isEvidenceQualityScoringEnabled reads the env var exactly", () => {
  assert.equal(isEvidenceQualityScoringEnabled({}), false);
  assert.equal(isEvidenceQualityScoringEnabled({ [EVIDENCE_QUALITY_SCORING_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isEvidenceQualityScoringEnabled({ [EVIDENCE_QUALITY_SCORING_ENABLED_ENV_VAR]: "true" }), true);
});

test("by default (no env var, no override) scoring is disabled and computes nothing", () => {
  withEnvFlag(undefined, () => {
    const result = scoreEvidenceQuality([{ text: "Some evidence." }]);
    assert.equal(evidenceQualityScoringResultSchema.safeParse(result).success, true);
    assert.equal(result.enabled, false);
    assert.deepEqual(result.itemScores, []);
    assert.equal(result.overallPoolScore, 0);
  });
});

test("an explicit enabled:true context overrides the env var", () => {
  withEnvFlag(undefined, () => {
    const result = scoreEvidenceQuality([{ text: "Some evidence." }], { enabled: true });
    assert.equal(result.enabled, true);
    assert.equal(result.itemScores.length, 1);
  });
});

test("setting the env var to 'true' also enables scoring", () => {
  withEnvFlag("true", () => {
    const result = scoreEvidenceQuality([{ text: "Some evidence." }]);
    assert.equal(result.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const result = scoreEvidenceQuality([{ text: "Some evidence." }], { enabled: false });
    assert.equal(result.enabled, false);
  });
});

test("a fully-sourced, fresh, complete, confident item scores highly with no low-quality flags", () => {
  const result = scoreEvidenceQuality(
    [
      {
        id: "market_size",
        text: "The addressable market is valued at $4.2 billion according to primary research.",
        source: {
          publisher: "U.S. Bureau of Labor Statistics",
          url: "https://www.bls.gov/data/market-size",
          publishedDate: "2025-11-01",
        },
        statedConfidence: 0.9,
      },
    ],
    { enabled: true, now: FIXED_NOW }
  );

  const item = result.itemScores[0];
  assert.ok(item.overallScore >= 80, `expected a high score, got ${item.overallScore}`);
  assert.equal(item.isLowQuality, false);
  assert.ok(!item.flags.includes("low_quality"));
  assert.ok(!item.flags.includes("missing_source"));
  assert.ok(!item.flags.includes("stale"));
  assert.ok(!item.flags.includes("unverifiable"));
});

test("an item with no source at all is flagged low_quality, missing_source, and unverifiable", () => {
  const result = scoreEvidenceQuality([{ id: "unsourced", text: "Some unattributed claim." }], {
    enabled: true,
    now: FIXED_NOW,
  });

  const item = result.itemScores[0];
  assert.ok(item.overallScore < 50, `expected a low score, got ${item.overallScore}`);
  assert.equal(item.isLowQuality, true);
  assert.ok(item.flags.includes("low_quality"));
  assert.ok(item.flags.includes("missing_source"));
  assert.ok(item.flags.includes("unverifiable"));
});

test("a stale item (published years ago) is flagged stale, and freshness never exceeds a fresh item's", () => {
  const result = scoreEvidenceQuality(
    [
      {
        id: "old",
        text: "Old market data.",
        source: { publisher: "Old Publisher", url: "https://example.com/old", publishedDate: "2018-01-01" },
      },
      {
        id: "fresh",
        text: "Fresh market data.",
        source: { publisher: "Fresh Publisher", url: "https://example.com/fresh", publishedDate: "2025-11-01" },
      },
    ],
    { enabled: true, now: FIXED_NOW }
  );

  const old = result.itemScores.find((s) => s.id === "old");
  const fresh = result.itemScores.find((s) => s.id === "fresh");
  const oldFreshness = old.dimensionScores.find((d) => d.dimension === "source_freshness").score;
  const freshFreshness = fresh.dimensionScores.find((d) => d.dimension === "source_freshness").score;

  assert.ok(old.flags.includes("stale"));
  assert.ok(!fresh.flags.includes("stale"));
  assert.ok(oldFreshness < freshFreshness);
});

test("a missing or unparseable date never fabricates freshness -- it scores the same low value as fully unknown", () => {
  const missingDate = scoreEvidenceQuality(
    [{ id: "no_date", text: "Claim.", source: { publisher: "P", url: "https://example.com" } }],
    { enabled: true, now: FIXED_NOW }
  );
  const badDate = scoreEvidenceQuality(
    [{ id: "bad_date", text: "Claim.", source: { publisher: "P", url: "https://example.com", publishedDate: "not-a-date" } }],
    { enabled: true, now: FIXED_NOW }
  );

  const missingScore = missingDate.itemScores[0].dimensionScores.find((d) => d.dimension === "source_freshness").score;
  const badScore = badDate.itemScores[0].dimensionScores.find((d) => d.dimension === "source_freshness").score;
  assert.equal(missingScore, 30);
  assert.equal(badScore, 30);
});

test("evidence_completeness reflects exactly how many of the 5 expected fields are populated", () => {
  const full = scoreEvidenceQuality(
    [
      {
        id: "full",
        text: "Claim.",
        source: { publisher: "P", url: "https://example.com", publishedDate: "2025-01-01" },
        statedConfidence: 0.8,
      },
    ],
    { enabled: true, now: FIXED_NOW }
  );
  const minimal = scoreEvidenceQuality([{ id: "minimal", text: "Claim." }], { enabled: true, now: FIXED_NOW });

  assert.equal(full.itemScores[0].dimensionScores.find((d) => d.dimension === "evidence_completeness").score, 100);
  assert.equal(minimal.itemScores[0].dimensionScores.find((d) => d.dimension === "evidence_completeness").score, 20);
});

test("relevance_to_decision defaults to a stated neutral score when no decision objective is supplied, never a guess", () => {
  const result = scoreEvidenceQuality([{ id: "x", text: "Anything at all." }], { enabled: true, now: FIXED_NOW });
  const relevance = result.itemScores[0].dimensionScores.find((d) => d.dimension === "relevance_to_decision");
  assert.equal(relevance.score, 50);
  assert.match(relevance.rationale, /no decision objective/i);
});

test("relevance_to_decision is higher for evidence that overlaps the decision objective than for evidence that does not, and flags irrelevant when very low", () => {
  const relevant = scoreEvidenceQuality(
    [{ id: "relevant", text: "The pricing strategy for our subscription product targets small businesses." }],
    { enabled: true, now: FIXED_NOW, decisionObjective: "We need to decide on our pricing strategy for the subscription product." }
  );
  const irrelevant = scoreEvidenceQuality(
    [{ id: "irrelevant", text: "The weather in Antarctica is extremely cold in winter." }],
    { enabled: true, now: FIXED_NOW, decisionObjective: "We need to decide on our pricing strategy for the subscription product." }
  );

  const relevantScore = relevant.itemScores[0].dimensionScores.find((d) => d.dimension === "relevance_to_decision").score;
  const irrelevantScore = irrelevant.itemScores[0].dimensionScores.find((d) => d.dimension === "relevance_to_decision").score;

  assert.ok(relevantScore > irrelevantScore);
  assert.ok(irrelevant.itemScores[0].flags.includes("irrelevant"));
});

test("independent confirmation: two topically-overlapping items from different, non-conflicting publishers confirm each other", () => {
  const result = scoreEvidenceQuality(
    [
      {
        id: "gartner",
        text: "The addressable market for AI accounting software shows strong momentum among enterprise buyers.",
        source: { publisher: "Gartner", url: "https://gartner.example.com" },
      },
      {
        id: "statista",
        text: "The addressable market for AI accounting software demonstrates strong momentum among enterprise buyers.",
        source: { publisher: "Statista", url: "https://statista.example.com" },
      },
    ],
    { enabled: true, now: FIXED_NOW }
  );

  const gartner = result.itemScores.find((s) => s.id === "gartner");
  const statista = result.itemScores.find((s) => s.id === "statista");

  assert.deepEqual(gartner.confirmedBy, ["statista"]);
  assert.deepEqual(statista.confirmedBy, ["gartner"]);
  assert.equal(gartner.dimensionScores.find((d) => d.dimension === "independent_confirmation").score, 60);
  assert.deepEqual(result.contradictions, []);
});

test("conflict detection: two topically-overlapping items citing different figures for the same claim are flagged as contradicting each other", () => {
  const result = scoreEvidenceQuality(
    [
      {
        id: "low_estimate",
        text: "The addressable market for AI accounting software is valued at $50 million based on Gartner research.",
        source: { publisher: "Gartner", url: "https://gartner.example.com" },
      },
      {
        id: "high_estimate",
        text: "The addressable market for AI accounting software is valued at $80 million based on Statista research.",
        source: { publisher: "Statista", url: "https://statista.example.com" },
      },
    ],
    { enabled: true, now: FIXED_NOW }
  );

  const low = result.itemScores.find((s) => s.id === "low_estimate");
  const high = result.itemScores.find((s) => s.id === "high_estimate");

  assert.deepEqual(low.contradictedBy, ["high_estimate"]);
  assert.deepEqual(high.contradictedBy, ["low_estimate"]);
  assert.ok(low.flags.includes("contradicted"));
  assert.equal(result.contradictions.length, 1);
  assert.equal(low.dimensionScores.find((d) => d.dimension === "conflict_detection").score, 60);
});

test("conflict detection also catches a keyword-only counter-signal (no numbers involved) between overlapping items", () => {
  const result = scoreEvidenceQuality(
    [
      {
        id: "growth",
        text: "Enterprise demand for AI accounting software continues to grow steadily among mid-market buyers.",
        source: { publisher: "A", url: "https://a.example.com" },
      },
      {
        id: "risk",
        text: "However, there is significant risk that enterprise demand for AI accounting software may decline among mid-market buyers.",
        source: { publisher: "B", url: "https://b.example.com" },
      },
    ],
    { enabled: true, now: FIXED_NOW }
  );

  const growth = result.itemScores.find((s) => s.id === "growth");
  assert.deepEqual(growth.contradictedBy, ["risk"]);
  assert.equal(result.contradictions.length, 1);
});

test("items on completely unrelated topics neither confirm nor contradict each other", () => {
  const result = scoreEvidenceQuality(
    [
      {
        id: "property",
        text: "The property is located in a suburban residential zone near public transit.",
        source: { publisher: "X", url: "https://x.example.com" },
      },
      {
        id: "financials",
        text: "Quarterly gross margin improved due to reduced manufacturing costs.",
        source: { publisher: "Y", url: "https://y.example.com" },
      },
    ],
    { enabled: true, now: FIXED_NOW }
  );

  for (const item of result.itemScores) {
    assert.deepEqual(item.confirmedBy, []);
    assert.deepEqual(item.contradictedBy, []);
  }
  assert.deepEqual(result.contradictions, []);
});

test("the confidence dimension is a direct, scaled pass-through of statedConfidence when present, and a source-aware default otherwise", () => {
  const stated = scoreEvidenceQuality([{ id: "a", text: "Claim.", statedConfidence: 0.73 }], {
    enabled: true,
    now: FIXED_NOW,
  });
  const unstatedWithSource = scoreEvidenceQuality(
    [{ id: "b", text: "Claim.", source: { publisher: "P" } }],
    { enabled: true, now: FIXED_NOW }
  );
  const unstatedNoSource = scoreEvidenceQuality([{ id: "c", text: "Claim." }], { enabled: true, now: FIXED_NOW });

  assert.equal(stated.itemScores[0].dimensionScores.find((d) => d.dimension === "confidence").score, 73);
  assert.equal(unstatedWithSource.itemScores[0].dimensionScores.find((d) => d.dimension === "confidence").score, 50);
  assert.equal(unstatedNoSource.itemScores[0].dimensionScores.find((d) => d.dimension === "confidence").score, 20);
});

test("overallScore is always exactly the mean of the 8 dimension scores, rounded", () => {
  const result = scoreEvidenceQuality(
    [
      {
        id: "x",
        text: "The pricing strategy targets small businesses with strong upside.",
        source: { publisher: "P", url: "https://example.com", publishedDate: "2025-06-01" },
        statedConfidence: 0.65,
      },
    ],
    { enabled: true, now: FIXED_NOW, decisionObjective: "We need to decide on our pricing strategy." }
  );

  const item = result.itemScores[0];
  const expected = Math.round(item.dimensionScores.reduce((sum, d) => sum + d.score, 0) / 8);
  assert.equal(item.overallScore, expected);
});

test("missing evidence reduces the pool's overall confidence proportionally to expectedItemCount", () => {
  const pool = Array.from({ length: 6 }, (_, i) => ({
    id: `item_${i}`,
    text: `Evidence statement number ${i} about the topic.`,
    source: { publisher: `Publisher ${i}`, url: `https://example.com/${i}`, publishedDate: "2025-06-01" },
    statedConfidence: 0.8,
  }));

  const withExpectation = scoreEvidenceQuality(pool, { enabled: true, now: FIXED_NOW, expectedItemCount: 9 });
  const withoutExpectation = scoreEvidenceQuality(pool, { enabled: true, now: FIXED_NOW });

  const meanItemScore = Math.round(
    withoutExpectation.itemScores.reduce((sum, s) => sum + s.overallScore, 0) / withoutExpectation.itemScores.length
  );

  assert.equal(withoutExpectation.missingEvidencePenalty, 0);
  assert.equal(withoutExpectation.overallPoolScore, meanItemScore);

  assert.equal(withExpectation.missingEvidencePenalty, 33);
  assert.ok(withExpectation.overallPoolScore < withoutExpectation.overallPoolScore);
});

test("an empty pool never fabricates a score: overallPoolScore is 0, not a neutral guess", () => {
  const result = scoreEvidenceQuality([], { enabled: true, now: FIXED_NOW });
  assert.equal(evidenceQualityScoringResultSchema.safeParse(result).success, true);
  assert.deepEqual(result.itemScores, []);
  assert.equal(result.overallPoolScore, 0);
});

test("scoreEvidenceAcquisitionResult scores only real evidence categories, excludes 'Missing Verified Evidence' entries from scoring, but still applies the missing-evidence penalty for all 9 categories", () => {
  const acquisitionResult = runEvidenceAcquisitionEngine({
    externalEvidenceCandidates: [
      {
        text: "The global AI accounting software market size was valued at $4.2 billion in 2024.",
        source: {
          publisher: "Gartner",
          url: "https://www.gartner.com/en/research/ai-accounting-market",
          publishedDate: "2024-11-01",
          confidence: 0.9,
        },
      },
    ],
  });

  assert.equal(acquisitionResult.externalVerifiedCount, 1);
  assert.equal(acquisitionResult.missingEvidenceCount, 8);

  const result = scoreEvidenceAcquisitionResult(acquisitionResult, { enabled: true, now: FIXED_NOW });

  assert.equal(evidenceQualityScoringResultSchema.safeParse(result).success, true);
  assert.equal(result.itemScores.length, 1);
  assert.equal(result.itemScores[0].id, "market_size");
  assert.equal(result.missingEvidencePenalty, Math.round((8 / 9) * 100));
});

test("identical input and a fixed clock always produce an identical result (determinism)", () => {
  const pool = [
    {
      id: "a",
      text: "The addressable market is valued at $4.2 billion.",
      source: { publisher: "Gartner", url: "https://gartner.example.com", publishedDate: "2025-06-01" },
      statedConfidence: 0.8,
    },
  ];
  const context = { enabled: true, now: FIXED_NOW, decisionObjective: "Market sizing decision." };

  const a = scoreEvidenceQuality(pool, context);
  const b = scoreEvidenceQuality(pool, context);
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
  assert.doesNotMatch(planRouteSource, /evidence-quality-scoring|scoreEvidenceQuality/);

  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (file === "evidence-quality-scoring.ts" || !file.endsWith(".ts")) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /evidence-quality-scoring|scoreEvidenceQuality/,
      `expected ${file} to not yet reference the new standalone scoring module`
    );
  }
});
