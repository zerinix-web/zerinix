import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveReportQualityConfidence } from "../app/lib/report-confidence-quality.mjs";
import { normalizeReportSourceSection } from "../app/lib/report-source-normalization.mjs";

const industryProfiles = [
  {
    industry: "AI accounting SaaS",
    evidence: {
      weightedScore: 86,
      assumptionCount: 1,
      missingMarketData: false,
      weakCompetitiveEvidence: false,
      uncertainFinancialMetricCount: 1,
      authoritativeSourceCount: 4,
      userProvidedValueCount: 3,
    },
    expected: 91,
  },
  {
    industry: "specialty coffee D2C",
    evidence: {
      weightedScore: 76,
      assumptionCount: 3,
      missingMarketData: false,
      weakCompetitiveEvidence: true,
      uncertainFinancialMetricCount: 2,
      authoritativeSourceCount: 2,
      userProvidedValueCount: 1,
    },
    expected: 62,
  },
  {
    industry: "commercial EV charging",
    evidence: {
      weightedScore: 78,
      assumptionCount: 4,
      missingMarketData: true,
      weakCompetitiveEvidence: false,
      uncertainFinancialMetricCount: 3,
      authoritativeSourceCount: 3,
      userProvidedValueCount: 2,
    },
    expected: 61,
  },
  {
    industry: "outpatient healthcare operations",
    evidence: {
      weightedScore: 82,
      assumptionCount: 2,
      missingMarketData: false,
      weakCompetitiveEvidence: false,
      uncertainFinancialMetricCount: 2,
      authoritativeSourceCount: 4,
      userProvidedValueCount: 2,
    },
    expected: 82,
  },
  {
    industry: "manufacturing robotics",
    evidence: {
      weightedScore: 72,
      assumptionCount: 6,
      missingMarketData: true,
      weakCompetitiveEvidence: true,
      uncertainFinancialMetricCount: 5,
      authoritativeSourceCount: 1,
      userProvidedValueCount: 0,
    },
    expected: 29,
  },
];

for (const profile of industryProfiles) {
  test(`${profile.industry} confidence reflects its evidence quality`, () => {
    assert.equal(
      deriveReportQualityConfidence(profile.evidence),
      profile.expected
    );
  });
}

test("confidence falls as assumptions and evidence gaps increase", () => {
  const scores = industryProfiles.map((profile) =>
    deriveReportQualityConfidence(profile.evidence)
  );

  assert.ok(scores[0] > scores[1]);
  assert.ok(scores[3] > scores[2]);
  assert.ok(scores[2] > scores[4]);
});

test("source normalization merges repeated domains and rejects unavailable citations", () => {
  const normalized = normalizeReportSourceSection(
    [
      "Verified — World Bank: https://www.worldbank.org/data",
      "Verified — World Bank Data Catalog (2025): https://worldbank.org/data/catalog",
      "Verified — Placeholder: https://example.com/fake-report",
      "Assumption — founder pricing input",
      "Assumption — founder pricing input",
    ].join("\n"),
    { language: "English", allowExternalCitations: true }
  );

  assert.equal((normalized.match(/worldbank\.org/g) || []).length, 1);
  assert.doesNotMatch(normalized, /example\.com/);
  assert.equal(
    (normalized.match(/AI-derived analysis \(not externally verified\)/g) || []).length,
    1
  );
  assert.equal((normalized.match(/founder pricing input/g) || []).length, 1);
});

test("business-plan normalization rejects external URLs because that flow has no verified web-source context", () => {
  const normalized = normalizeReportSourceSection(
    "Verified — Research report: https://research.example.edu/report",
    { language: "English", allowExternalCitations: false }
  );

  assert.equal(normalized, "AI-derived analysis (not externally verified)");
});

test("generation and normalization expose the exact public evidence taxonomy", () => {
  const evidence = readFileSync("app/lib/report-evidence.ts", "utf8");
  const financial = readFileSync("app/lib/ai/financial-assumptions.ts", "utf8");
  const planPrompt = readFileSync("app/lib/report-engine/prompts/plan.ts", "utf8");

  for (const label of ["Verified", "Estimated", "Assumption", "AI Analysis"]) {
    assert.match(evidence, new RegExp(`"${label}"`));
    assert.match(financial, new RegExp(label));
    assert.match(planPrompt, new RegExp(label));
  }
});
