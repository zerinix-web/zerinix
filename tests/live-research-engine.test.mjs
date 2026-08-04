import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  researchGapValues,
  liveResearchPriorityValues,
  decisionImpactValues,
  liveResearchEngineResultSchema,
  LIVE_RESEARCH_ENGINE_ENABLED_ENV_VAR,
  isLiveResearchEngineEnabled,
  detectLiveResearchNeed,
} from "../app/lib/ai/live-research-engine.ts";
import { runEvidenceAcquisitionEngine } from "../app/lib/ai/evidence-acquisition-engine.ts";
import { scoreEvidenceQuality } from "../app/lib/ai/evidence-quality-scoring.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/live-research-engine.ts", import.meta.url),
  "utf8"
);

const FULL_CANDIDATES = [
  { category: "market_size", text: "The addressable market for AI accounting software is valued at $4.2 billion.", publisher: "Gartner" },
  { category: "cagr", text: "Analysts project a CAGR of 18.4% for this segment through 2030.", publisher: "Statista" },
  { category: "competitors", text: "Direct competitors include QuickBooks and Xero.", publisher: "IDC" },
  { category: "pricing_benchmarks", text: "Pricing benchmarks average $49 per seat per month.", publisher: "Forrester" },
  { category: "customer_segments", text: "Target customer segments include small businesses and freelance accountants.", publisher: "IDC" },
  { category: "industry_trends", text: "Industry trend data shows rapid AI adoption across accounting firms.", publisher: "Gartner" },
  { category: "unit_economics_benchmarks", text: "Unit economics benchmarks show a CAC under $200 and strong gross margin.", publisher: "Statista" },
  { category: "regulatory_considerations", text: "Regulatory considerations include SOC 2 compliance requirements.", publisher: "IDC" },
  { category: "technology_trends", text: "Technology trend data shows growing automation adoption.", publisher: "Gartner" },
];

function fullyVerifiedAcquisitionResult() {
  return runEvidenceAcquisitionEngine({
    externalEvidenceCandidates: FULL_CANDIDATES.map((c) => ({
      text: c.text,
      source: { publisher: c.publisher, url: `https://${c.publisher.toLowerCase()}.example.com`, confidence: 0.85 },
    })),
  });
}

function acquisitionResultMissingOnly(missingCategories) {
  const candidates = FULL_CANDIDATES.filter((c) => !missingCategories.includes(c.category)).map((c) => ({
    text: c.text,
    source: { publisher: c.publisher, url: `https://${c.publisher.toLowerCase()}.example.com`, confidence: 0.85 },
  }));
  return runEvidenceAcquisitionEngine({ externalEvidenceCandidates: candidates });
}

function highQualityEvidenceResult(now = new Date("2026-01-01T00:00:00Z")) {
  return scoreEvidenceQuality(
    [
      {
        id: "a",
        text: "The addressable market is valued at $4.2 billion.",
        source: { publisher: "Gartner", url: "https://gartner.example.com", publishedDate: "2025-11-01" },
        statedConfidence: 0.9,
      },
    ],
    { enabled: true, now }
  );
}

function lowQualityEvidenceResult(score, now = new Date("2026-01-01T00:00:00Z")) {
  // An unsourced item scores 0 on most dimensions; used as a controlled
  // low-quality fixture. We only rely on overallPoolScore being low, not
  // an exact value, so we assert on ranges rather than a hand-derived number.
  void score;
  return scoreEvidenceQuality([{ id: "a", text: "Some unattributed claim." }], { enabled: true, now });
}

function withEnvFlag(value, fn) {
  const previous = process.env[LIVE_RESEARCH_ENGINE_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[LIVE_RESEARCH_ENGINE_ENABLED_ENV_VAR];
  } else {
    process.env[LIVE_RESEARCH_ENGINE_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[LIVE_RESEARCH_ENGINE_ENABLED_ENV_VAR];
    } else {
      process.env[LIVE_RESEARCH_ENGINE_ENABLED_ENV_VAR] = previous;
    }
  }
}

test("researchGapValues contains exactly the 5 required gaps", () => {
  assert.deepEqual(
    [...researchGapValues].sort(),
    [
      "insufficient_evidence",
      "outdated_evidence",
      "missing_market_data",
      "missing_competitor_intelligence",
      "missing_financial_evidence",
    ].sort()
  );
});

test("liveResearchPriorityValues contains exactly critical/high/medium/low", () => {
  assert.deepEqual([...liveResearchPriorityValues].sort(), ["critical", "high", "medium", "low"].sort());
});

test("decisionImpactValues contains exactly low/medium/high/critical", () => {
  assert.deepEqual([...decisionImpactValues].sort(), ["low", "medium", "high", "critical"].sort());
});

test("isLiveResearchEngineEnabled reads the env var exactly", () => {
  assert.equal(isLiveResearchEngineEnabled({}), false);
  assert.equal(isLiveResearchEngineEnabled({ [LIVE_RESEARCH_ENGINE_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isLiveResearchEngineEnabled({ [LIVE_RESEARCH_ENGINE_ENABLED_ENV_VAR]: "true" }), true);
});

test("by default (no env var, no override) detection is disabled and runs nothing", () => {
  withEnvFlag(undefined, () => {
    const result = detectLiveResearchNeed();
    assert.equal(liveResearchEngineResultSchema.safeParse(result).success, true);
    assert.equal(result.enabled, false);
    assert.deepEqual(result.tasks, []);
    assert.equal(result.liveResearchRequired, false);
  });
});

test("an explicit enabled:true overrides the env var", () => {
  withEnvFlag(undefined, () => {
    const result = detectLiveResearchNeed({ enabled: true });
    assert.equal(result.enabled, true);
  });
});

test("setting the env var to 'true' also enables detection", () => {
  withEnvFlag("true", () => {
    const result = detectLiveResearchNeed();
    assert.equal(result.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const result = detectLiveResearchNeed({ enabled: false });
    assert.equal(result.enabled, false);
  });
});

test("with no evidence supplied at all, every gap is honestly detected (not fabricated -- a truly empty evidence base really is insufficient)", () => {
  const result = detectLiveResearchNeed({ enabled: true });

  assert.equal(liveResearchEngineResultSchema.safeParse(result).success, true);
  assert.equal(result.liveResearchRequired, true);
  assert.deepEqual([...result.detectedGaps].sort(), [...researchGapValues].sort());
  assert.equal(result.tasks.length, researchGapValues.length);
  assert.equal(result.overallExpectedDecisionImpact, "critical");
});

test("with a fully verified, high-quality, fresh evidence base, no gaps are detected", () => {
  const result = detectLiveResearchNeed({
    enabled: true,
    evidenceAcquisitionResult: fullyVerifiedAcquisitionResult(),
    evidenceQualityResult: highQualityEvidenceResult(),
  });

  assert.equal(result.liveResearchRequired, false);
  assert.deepEqual(result.detectedGaps, []);
  assert.deepEqual(result.tasks, []);
  assert.equal(result.overallExpectedDecisionImpact, null);
  assert.match(result.explanation, /No additional live research is required/);
});

test("detects missing market data when all 3 market-flavored categories are missing, with High impact", () => {
  const result = detectLiveResearchNeed({
    enabled: true,
    evidenceAcquisitionResult: acquisitionResultMissingOnly(["market_size", "cagr", "industry_trends"]),
  });

  assert.ok(result.detectedGaps.includes("missing_market_data"));
  const task = result.tasks.find((t) => t.gap === "missing_market_data");
  assert.equal(task.expectedDecisionImpact, "high");
  assert.match(task.rationale, /market_size/);
});

test("detects missing market data even when only one of the 3 sub-categories is missing, but with a lower (Medium) impact", () => {
  const result = detectLiveResearchNeed({
    enabled: true,
    evidenceAcquisitionResult: acquisitionResultMissingOnly(["market_size"]),
  });

  const task = result.tasks.find((t) => t.gap === "missing_market_data");
  assert.ok(task);
  assert.equal(task.expectedDecisionImpact, "medium");
});

test("detects missing competitor intelligence specifically, with Medium priority", () => {
  const result = detectLiveResearchNeed({
    enabled: true,
    evidenceAcquisitionResult: acquisitionResultMissingOnly(["competitors"]),
  });

  const task = result.tasks.find((t) => t.gap === "missing_competitor_intelligence");
  assert.ok(task);
  assert.equal(task.priority, "medium");
});

test("detects missing financial evidence specifically, with High priority", () => {
  const result = detectLiveResearchNeed({
    enabled: true,
    evidenceAcquisitionResult: acquisitionResultMissingOnly(["unit_economics_benchmarks"]),
  });

  const task = result.tasks.find((t) => t.gap === "missing_financial_evidence");
  assert.ok(task);
  assert.equal(task.priority, "high");
});

test("detects insufficient evidence from a low overall pool score, citing the real score in the rationale", () => {
  const lowQuality = lowQualityEvidenceResult();
  const result = detectLiveResearchNeed({ enabled: true, evidenceQualityResult: lowQuality });

  const task = result.tasks.find((t) => t.gap === "insufficient_evidence");
  assert.ok(task);
  assert.match(task.rationale, new RegExp(String(lowQuality.overallPoolScore)));
});

test("detects outdated evidence from a low mean freshness score, and does not detect it when freshness is high", () => {
  const stale = scoreEvidenceQuality(
    [{ id: "a", text: "Old market data.", source: { publisher: "P", url: "https://example.com", publishedDate: "2018-01-01" } }],
    { enabled: true, now: new Date("2026-01-01T00:00:00Z") }
  );
  const fresh = highQualityEvidenceResult();

  const staleResult = detectLiveResearchNeed({ enabled: true, evidenceQualityResult: stale });
  const freshResult = detectLiveResearchNeed({ enabled: true, evidenceQualityResult: fresh });

  assert.ok(staleResult.detectedGaps.includes("outdated_evidence"));
  assert.ok(!freshResult.detectedGaps.includes("outdated_evidence"));
});

test("tasks are always ordered by priority, critical first", () => {
  const result = detectLiveResearchNeed({
    enabled: true,
    evidenceAcquisitionResult: acquisitionResultMissingOnly(["competitors", "unit_economics_benchmarks"]),
    evidenceQualityResult: lowQualityEvidenceResult(),
  });

  const priorities = result.tasks.map((t) => t.priority);
  const rank = { critical: 4, high: 3, medium: 2, low: 1 };
  for (let i = 0; i < priorities.length - 1; i += 1) {
    assert.ok(rank[priorities[i]] >= rank[priorities[i + 1]]);
  }
  assert.equal(priorities[0], "critical");
});

test("overallExpectedDecisionImpact always reports the WORST impact across all detected gaps, never averaged down", () => {
  const result = detectLiveResearchNeed({
    enabled: true,
    evidenceAcquisitionResult: acquisitionResultMissingOnly(["competitors"]),
    evidenceQualityResult: lowQualityEvidenceResult(),
  });

  // insufficient_evidence (from a low-but-not-critical overall pool
  // score) lands at "high"; missing_competitor_intelligence is always
  // "medium" -- the overall result must report the worse of the two.
  const impacts = result.tasks.map((t) => t.expectedDecisionImpact);
  assert.ok(impacts.includes("medium"));
  assert.ok(impacts.includes("high"));
  assert.equal(result.overallExpectedDecisionImpact, "high");
});

test("never fabricates a research result: every task's requiredEvidence is methodology text, not a claim about specific findings", () => {
  const result = detectLiveResearchNeed({ enabled: true });
  for (const task of result.tasks) {
    assert.ok(task.requiredEvidence.length > 0);
    for (const item of task.requiredEvidence) {
      assert.doesNotMatch(item, /\$[\d,]+/);
    }
  }
});

test("the explanation cites the actual detected gap count and names when research is required", () => {
  const result = detectLiveResearchNeed({
    enabled: true,
    evidenceAcquisitionResult: acquisitionResultMissingOnly(["competitors"]),
  });

  assert.match(result.explanation, new RegExp(`${result.detectedGaps.length} gap`));
  for (const gap of result.detectedGaps) {
    assert.ok(result.explanation.includes(gap));
  }
});

test("identical input always produces an identical result (determinism)", () => {
  const input = {
    enabled: true,
    evidenceAcquisitionResult: acquisitionResultMissingOnly(["competitors"]),
    evidenceQualityResult: highQualityEvidenceResult(),
  };
  const a = detectLiveResearchNeed(input);
  const b = detectLiveResearchNeed(input);
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
  assert.doesNotMatch(planRouteSource, /live-research-engine|detectLiveResearchNeed/);

  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (
      file === "live-research-engine.ts" ||
      // ZERINIX Business Intelligence Orchestrator v1 legitimately
      // coordinates Live Research Engine as one of its 8 stages.
      file === "business-intelligence-orchestrator.ts" ||
      !file.endsWith(".ts")
    ) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /live-research-engine|detectLiveResearchNeed/,
      `expected ${file} to not yet reference the new standalone live research engine`
    );
  }
});
