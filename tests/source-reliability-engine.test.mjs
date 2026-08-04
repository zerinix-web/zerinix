import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  sourceTypeValues,
  sourceReliabilityDimensionValues,
  sourceReliabilityFlagValues,
  sourceReliabilityResultSchema,
  SOURCE_RELIABILITY_ENGINE_ENABLED_ENV_VAR,
  isSourceReliabilityEngineEnabled,
  scoreSourceReliability,
  scoreSourceReliabilityBatch,
} from "../app/lib/ai/source-reliability-engine.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/source-reliability-engine.ts", import.meta.url),
  "utf8"
);

function withEnvFlag(value, fn) {
  const previous = process.env[SOURCE_RELIABILITY_ENGINE_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[SOURCE_RELIABILITY_ENGINE_ENABLED_ENV_VAR];
  } else {
    process.env[SOURCE_RELIABILITY_ENGINE_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[SOURCE_RELIABILITY_ENGINE_ENABLED_ENV_VAR];
    } else {
      process.env[SOURCE_RELIABILITY_ENGINE_ENABLED_ENV_VAR] = previous;
    }
  }
}

test("sourceTypeValues contains exactly the 9 required source types", () => {
  assert.deepEqual(
    [...sourceTypeValues].sort(),
    [
      "government",
      "regulatory_body",
      "academic_journal",
      "industry_analyst",
      "news_media",
      "blog",
      "social_media",
      "user_generated",
      "unknown",
    ].sort()
  );
});

test("sourceReliabilityDimensionValues contains exactly the 5 required dimensions", () => {
  assert.deepEqual(
    [...sourceReliabilityDimensionValues].sort(),
    ["authority", "expertise", "publication_quality", "source_consistency", "historical_reliability"].sort()
  );
});

test("sourceReliabilityFlagValues contains the required flags", () => {
  assert.deepEqual(
    [...sourceReliabilityFlagValues].sort(),
    ["anonymous", "weak_source", "low_authority", "low_expertise", "inconsistent", "no_track_record", "highly_trusted"].sort()
  );
});

test("isSourceReliabilityEngineEnabled reads the env var exactly", () => {
  assert.equal(isSourceReliabilityEngineEnabled({}), false);
  assert.equal(isSourceReliabilityEngineEnabled({ [SOURCE_RELIABILITY_ENGINE_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isSourceReliabilityEngineEnabled({ [SOURCE_RELIABILITY_ENGINE_ENABLED_ENV_VAR]: "true" }), true);
});

test("by default (no env var, no override) scoring is disabled and computes nothing", () => {
  withEnvFlag(undefined, () => {
    const result = scoreSourceReliability({ name: "Gartner" });
    assert.equal(sourceReliabilityResultSchema.safeParse(result).success, true);
    assert.equal(result.enabled, false);
    assert.equal(result.reliabilityScore, 0);
    assert.deepEqual(result.dimensionScores, []);
  });
});

test("an explicit enabled:true overrides the env var", () => {
  withEnvFlag(undefined, () => {
    const result = scoreSourceReliability({ name: "Gartner", enabled: true });
    assert.equal(result.enabled, true);
    assert.equal(result.dimensionScores.length, 5);
  });
});

test("setting the env var to 'true' also enables scoring", () => {
  withEnvFlag("true", () => {
    const result = scoreSourceReliability({ name: "Gartner" });
    assert.equal(result.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const result = scoreSourceReliability({ name: "Gartner", enabled: false });
    assert.equal(result.enabled, false);
  });
});

test("a source with no name at all is detected as anonymous and scored at the floor across every dimension -- never a fabricated middling guess", () => {
  const result = scoreSourceReliability({ enabled: true, url: "https://example.com" });

  assert.equal(sourceReliabilityResultSchema.safeParse(result).success, true);
  assert.equal(result.sourceName, null);
  assert.equal(result.reliabilityScore, 0);
  assert.deepEqual(result.flags, ["anonymous"]);
  assert.equal(result.isAnonymousOrWeak, true);
  assert.equal(result.isHighlyTrusted, false);
  for (const entry of result.dimensionScores) {
    assert.equal(entry.score, 0);
  }
});

test("a named source with nothing else known is detected as weak, with no fabricated authority or expertise", () => {
  const result = scoreSourceReliability({ enabled: true, name: "Some Guy On The Internet" });

  assert.equal(result.sourceName, "Some Guy On The Internet");
  assert.ok(result.isAnonymousOrWeak);
  assert.ok(result.flags.includes("weak_source"));
  assert.ok(result.flags.includes("low_authority"));
  assert.ok(result.flags.includes("low_expertise"));
  assert.ok(result.flags.includes("no_track_record"));
  assert.ok(!result.flags.includes("highly_trusted"));
});

test("a regulatory body with an official domain, a strong confirmation record, and strong historical scores is highly trusted", () => {
  const result = scoreSourceReliability({
    enabled: true,
    name: "U.S. Securities and Exchange Commission",
    url: "https://www.sec.gov/data",
    sourceType: "regulatory_body",
    confirmationCount: 9,
    contradictionCount: 1,
    historicalEvidenceScores: [90, 85, 95],
  });

  assert.ok(result.isHighlyTrusted, `expected highly trusted, got score ${result.reliabilityScore}`);
  assert.ok(result.flags.includes("highly_trusted"));
  assert.ok(!result.isAnonymousOrWeak);
  assert.ok(result.reliabilityDrivers.length > 0);
});

test("authority scores are ordered by source type from most to least authoritative, per the documented lookup table", () => {
  const order = ["regulatory_body", "government", "academic_journal", "industry_analyst", "news_media", "blog"];
  const scores = order.map(
    (sourceType) =>
      scoreSourceReliability({ enabled: true, name: "X", sourceType }).dimensionScores.find((d) => d.dimension === "authority")
        .score
  );

  for (let i = 0; i < scores.length - 1; i += 1) {
    assert.ok(scores[i] >= scores[i + 1], `expected ${order[i]} (${scores[i]}) >= ${order[i + 1]} (${scores[i + 1]})`);
  }

  const socialMedia = scoreSourceReliability({ enabled: true, name: "X", sourceType: "social_media" }).dimensionScores.find(
    (d) => d.dimension === "authority"
  ).score;
  const userGenerated = scoreSourceReliability({ enabled: true, name: "X", sourceType: "user_generated" }).dimensionScores.find(
    (d) => d.dimension === "authority"
  ).score;
  assert.ok(scores[scores.length - 1] > socialMedia);
  assert.equal(socialMedia, userGenerated);
});

test("expertise is a distinct methodology from authority: government scores lower on expertise than on authority", () => {
  const result = scoreSourceReliability({ enabled: true, name: "X", sourceType: "government" });
  const authority = result.dimensionScores.find((d) => d.dimension === "authority").score;
  const expertise = result.dimensionScores.find((d) => d.dimension === "expertise").score;
  assert.notEqual(authority, expertise);
  assert.ok(authority > expertise);
});

test("publication_quality reflects exactly how many of the 3 identifying fields (name, url, sourceType) are known", () => {
  const nameOnly = scoreSourceReliability({ enabled: true, name: "X" });
  const nameAndUrl = scoreSourceReliability({ enabled: true, name: "X", url: "https://example.com" });
  const allThree = scoreSourceReliability({ enabled: true, name: "X", url: "https://example.com", sourceType: "news_media" });

  assert.equal(nameOnly.dimensionScores.find((d) => d.dimension === "publication_quality").score, 33);
  assert.equal(nameAndUrl.dimensionScores.find((d) => d.dimension === "publication_quality").score, 67);
  assert.equal(allThree.dimensionScores.find((d) => d.dimension === "publication_quality").score, 100);
});

test("source_consistency is a real ratio of confirmations to contradictions when supplied, and a documented neutral default otherwise", () => {
  const withData = scoreSourceReliability({ enabled: true, name: "X", confirmationCount: 8, contradictionCount: 2 });
  const withoutData = scoreSourceReliability({ enabled: true, name: "X" });

  assert.equal(withData.dimensionScores.find((d) => d.dimension === "source_consistency").score, 80);
  assert.equal(withoutData.dimensionScores.find((d) => d.dimension === "source_consistency").score, 50);
});

test("historical_reliability is the real mean of supplied past scores, and a documented neutral default otherwise, never invented", () => {
  const withHistory = scoreSourceReliability({ enabled: true, name: "X", historicalEvidenceScores: [80, 90, 70] });
  const withoutHistory = scoreSourceReliability({ enabled: true, name: "X" });

  assert.equal(withHistory.dimensionScores.find((d) => d.dimension === "historical_reliability").score, 80);
  assert.equal(withoutHistory.dimensionScores.find((d) => d.dimension === "historical_reliability").score, 50);
});

test("the 'inconsistent' flag only fires when real consistency data was supplied and is genuinely low -- never when data is simply absent", () => {
  const genuinelyInconsistent = scoreSourceReliability({ enabled: true, name: "X", confirmationCount: 1, contradictionCount: 9 });
  const noDataAtAll = scoreSourceReliability({ enabled: true, name: "X" });

  assert.ok(genuinelyInconsistent.flags.includes("inconsistent"));
  assert.ok(!noDataAtAll.flags.includes("inconsistent"));
});

test("the 'no_track_record' flag only fires when BOTH consistency and historical data are absent -- supplying either one suppresses it", () => {
  const neitherSupplied = scoreSourceReliability({ enabled: true, name: "X" });
  const onlyConsistencySupplied = scoreSourceReliability({ enabled: true, name: "X", confirmationCount: 5, contradictionCount: 0 });
  const onlyHistorySupplied = scoreSourceReliability({ enabled: true, name: "X", historicalEvidenceScores: [70] });

  assert.ok(neitherSupplied.flags.includes("no_track_record"));
  assert.ok(!onlyConsistencySupplied.flags.includes("no_track_record"));
  assert.ok(!onlyHistorySupplied.flags.includes("no_track_record"));
});

test("reliabilityDrivers only include dimensions scoring >= 70, and reliabilityPenalties only include dimensions scoring < 40, with impact = 100 - score", () => {
  const result = scoreSourceReliability({
    enabled: true,
    name: "Random Blog",
    sourceType: "blog",
    confirmationCount: 1,
    contradictionCount: 9,
  });

  for (const driver of result.reliabilityDrivers) {
    const dimension = result.dimensionScores.find((d) => d.dimension === driver.dimension);
    assert.ok(dimension.score >= 70);
  }
  for (const penalty of result.reliabilityPenalties) {
    const dimension = result.dimensionScores.find((d) => d.dimension === penalty.dimension);
    assert.ok(dimension.score < 40);
    assert.equal(penalty.impact, 100 - dimension.score);
  }
});

test("never fabricates reliability: the final score always equals the weighted sum of the actually-returned dimension scores, recomputed independently", () => {
  const result = scoreSourceReliability({
    enabled: true,
    name: "Statista",
    sourceType: "industry_analyst",
    url: "https://statista.com",
    confirmationCount: 4,
    contradictionCount: 1,
    historicalEvidenceScores: [75, 82],
  });

  const recomputed = Math.round(result.dimensionScores.reduce((sum, entry) => sum + entry.score * entry.weight, 0));
  assert.equal(result.reliabilityScore, recomputed);
});

test("scoreSourceReliabilityBatch scores every source independently and preserves the disabled/enabled state consistently", () => {
  const disabled = scoreSourceReliabilityBatch(
    [{ name: "Gartner", sourceType: "industry_analyst" }, { name: "Random Blog", sourceType: "blog" }],
    { enabled: false }
  );
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.sources.length, 2);
  for (const source of disabled.sources) {
    assert.equal(source.enabled, false);
  }

  const enabled = scoreSourceReliabilityBatch(
    [
      { name: "Gartner", sourceType: "industry_analyst", url: "https://gartner.com" },
      { name: "Random Blog", sourceType: "blog" },
    ],
    { enabled: true }
  );
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.sources.length, 2);
  assert.ok(
    enabled.sources[0].reliabilityScore > enabled.sources[1].reliabilityScore,
    "expected the industry analyst to score higher than the blog"
  );
});

test("identical input always produces an identical result (determinism)", () => {
  const input = {
    enabled: true,
    name: "Gartner",
    sourceType: "industry_analyst",
    url: "https://gartner.com",
    confirmationCount: 5,
    contradictionCount: 1,
    historicalEvidenceScores: [80, 85],
  };
  const a = scoreSourceReliability(input);
  const b = scoreSourceReliability(input);
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
  assert.doesNotMatch(planRouteSource, /source-reliability-engine|scoreSourceReliability/);

  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (file === "source-reliability-engine.ts" || !file.endsWith(".ts")) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /source-reliability-engine|scoreSourceReliability/,
      `expected ${file} to not yet reference the new standalone source reliability engine`
    );
  }
});
