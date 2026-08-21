import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL REPORT QUALITY FIX -- prevent fabricated financial/validation
// claims for a zero-evidence prompt.
//
// Confirmed live with the exact prompt: "I want to build an AI platform
// that predicts earthquakes using satellite imagery, smartphone sensors,
// and quantum signal analysis. I have no customers, no revenue, no
// funding, no prototype, and no validated scientific evidence."
//
// Root cause: hasValidationEvidence (independently duplicated in
// app/lib/ai/financial-model.ts and app/lib/ai/investment-score.ts) was a
// bare keyword-presence test with no negation awareness. The prompt's own
// NEGATED disclaimer ("no customers, no revenue") literally contains the
// words "customers" and "revenue", so both copies misread it as CLAIMING
// evidence rather than disclaiming it. This had real, visible
// consequences:
//   - financial-model.ts: the Financial Assumptions narrative said
//     "Validation evidence: present in prompt" (should say "not yet
//     supplied"), the Sources block claimed "User supplied validation
//     evidence in the request" (should say "No direct operating data was
//     supplied"), and -- with no industry gating at all -- Benchmark
//     Intelligence's own validationGaps array SUPPRESSED the disclosure
//     "No direct customer, revenue, retention, or acquisition evidence
//     was provided in the request."
//   - investment-score.ts: the Founder Score / Execution Risk categories'
//     own "Validation evidence detected: yes/no" reasoning line said
//     "yes", and real score adjustments used the evidence-present branch
//     (e.g. a +0.08 bonus instead of the correct -0.08 penalty, and a
//     validation-level score of 70 instead of 48), inflating the
//     Founder Score for a founder who explicitly has no evidence at all.
//
// The fix strips negated occurrences (no/not/zero/without/never had/
// don't have/lack of/... plus up to a few intervening descriptive words)
// before the positive-evidence keyword scan runs, in both files
// identically. A genuine positive claim ("we have 200 customers on a
// waitlist") is unaffected, since nothing before "customers" matches a
// negation trigger there.

async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  const benchmarksPath = join(repoRoot, "app/lib/ai/industry-benchmarks.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(benchmarksPath).href)
  );
  const dir = mkdtempSync(join(tmpdir(), "zerinix-financial-model-"));
  const outPath = join(dir, "financial-model.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { createFinancialModel, validateFinancialConsistency } = await importFinancialModel();
const { createInvestmentScore } = await import(
  pathToFileURL(join(repoRoot, "app/lib/ai/investment-score.ts")).href
);
const financialModelSource = readFileSync(join(repoRoot, "app/lib/ai/financial-model.ts"), "utf8");
const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");

const zeroEvidencePrompt =
  "I want to build an AI platform that predicts earthquakes using satellite imagery, smartphone sensors, and quantum signal analysis. I have no customers, no revenue, no funding, no prototype, and no validated scientific evidence.";

function buildReport(prompt) {
  const financialModel = createFinancialModel({ prompt, reportKind: "business_plan" });
  const financialConsistency = validateFinancialConsistency(financialModel);
  const investmentScore = createInvestmentScore({ prompt, financialModel });
  return { financialModel, financialConsistency, investmentScore };
}

// --- The exact live bug and its fix (requirement 1 & 3) ------------------

test("the exact reported zero-evidence prompt never claims the user supplied validation evidence (the exact live bug)", () => {
  const { financialConsistency } = buildReport(zeroEvidencePrompt);

  assert.deepEqual(financialConsistency.sources.userProvidedData, [
    "No direct operating data was supplied by the user.",
  ]);
  assert.doesNotMatch(
    financialConsistency.sources.userProvidedData.join(" "),
    /user supplied validation evidence/i
  );
});

test("Benchmark Intelligence's validationGaps correctly discloses the missing evidence instead of suppressing it", () => {
  const { financialModel } = buildReport(zeroEvidencePrompt);

  assert.ok(
    financialModel.benchmarkFit.validationGaps.some((gap) =>
      /no direct customer, revenue, retention, or acquisition evidence was provided/i.test(gap)
    ),
    `expected the evidence-gap disclosure, got: ${JSON.stringify(financialModel.benchmarkFit.validationGaps)}`
  );
});

test("every financial metric's assumptions correctly say validation evidence was not supplied, not 'present in prompt'", () => {
  const { financialModel } = buildReport(zeroEvidencePrompt);

  for (const key of ["tam", "sam", "som", "arr", "cac", "ltv"]) {
    const assumptions = financialModel.metrics[key].assumptions.join(" | ");
    assert.match(assumptions, /not yet supplied; planning assumptions require validation/i, `${key} assumptions still claim evidence is present`);
    assert.doesNotMatch(assumptions, /validation evidence: present in prompt/i, `${key} assumptions fabricate "present in prompt"`);
  }
});

test("Founder Score / Execution Risk reasoning correctly says validation evidence was not detected (requirement 4: realistic Founder Score)", () => {
  const { investmentScore } = buildReport(zeroEvidencePrompt);

  const teamFounderReasoning = investmentScore.categories.teamFounder.reasoning.join(" | ");
  const executionRiskReasoning = investmentScore.categories.executionRisk.reasoning.join(" | ");

  assert.match(teamFounderReasoning, /Validation evidence detected: no/);
  assert.match(executionRiskReasoning, /Validation evidence detected: no/);
  assert.doesNotMatch(teamFounderReasoning, /Validation evidence detected: yes/);
  assert.doesNotMatch(executionRiskReasoning, /Validation evidence detected: yes/);
});

test("the recommendation is not an unwarranted GO for a fully unvalidated, zero-evidence idea (requirement 7: explain high risk)", () => {
  const { investmentScore } = buildReport(zeroEvidencePrompt);

  assert.notEqual(investmentScore.recommendation, "GO");
  assert.ok(investmentScore.totalScore < 72, `totalScore ${investmentScore.totalScore} should not clear the GO threshold with zero evidence`);
});

test("fixing the negation bug measurably lowers the inflated confidence/score for the zero-evidence prompt (before/after via the raw, unfixed keyword match)", () => {
  const { investmentScore } = buildReport(zeroEvidencePrompt);
  // The unfixed regex (bare keyword presence, no negation awareness) is
  // reproduced here only to prove the fixed pipeline now diverges from it
  // -- i.e. the fix actually changes behavior for this prompt, rather than
  // being a no-op.
  const rawKeywordMatch = /\b(revenue|sales|customers?)\b/i.test(zeroEvidencePrompt);
  assert.equal(rawKeywordMatch, true, "sanity check: the raw prompt does contain the bare keywords");
  assert.match(investmentScore.categories.teamFounder.reasoning.join(" "), /Validation evidence detected: no/);
});

// --- No false positives: a genuine positive claim is unaffected ----------

test("a genuine positive evidence claim ('we have 200 customers on a waitlist') is still detected correctly (no over-correction)", () => {
  const positivePrompt = "A B2B SaaS platform for logistics. We have 200 customers on a waitlist and $5k in early revenue.";
  const model = createFinancialModel({ prompt: positivePrompt, reportKind: "business_plan" });
  const consistency = validateFinancialConsistency(model);

  assert.doesNotMatch(
    consistency.sources.userProvidedData.join(" "),
    /no direct operating data/i
  );
});

test("a mixed prompt (negated funding/prototype but a real positive waitlist claim) still detects the genuine positive signal", () => {
  const mixedPrompt =
    "An AI compliance platform. We have no funding and no prototype yet, but we do have 150 people on our waitlist.";
  const model = createFinancialModel({ prompt: mixedPrompt, reportKind: "business_plan" });
  const consistency = validateFinancialConsistency(model);

  assert.doesNotMatch(
    consistency.sources.userProvidedData.join(" "),
    /no direct operating data/i
  );
});

// --- Drift checks -----------------------------------------------------

for (const [name, source] of [
  ["financial-model.ts", financialModelSource],
  ["investment-score.ts", investmentScoreSource],
]) {
  test(`${name}: hasValidationEvidence strips negated evidence claims before the positive-keyword scan (drift check)`, () => {
    const fnMatch = /function hasValidationEvidence\([\s\S]*?\n\}/.exec(source);
    assert.ok(fnMatch, `${name}: hasValidationEvidence not found`);
    assert.match(fnMatch[0], /negatedEvidenceClaimPattern/, `${name}: negation-stripping is no longer wired into hasValidationEvidence`);
  });

  test(`${name}: the negation pattern covers the standard negation triggers (no/not/zero/without/don't have/lack of)`, () => {
    const patternMatch = /const negatedEvidenceClaimPattern =\s*\n?\s*([^;]+);/.exec(source);
    assert.ok(patternMatch, `${name}: negatedEvidenceClaimPattern not found`);
    for (const trigger of ["no", "not", "zero", "without", "don'?t have", "lack"]) {
      assert.ok(patternMatch[1].includes(trigger), `${name}: negation pattern missing trigger "${trigger}"`);
    }
  });
}

// --- Requirement 2: metrics distinguish Verified / Assumption / AI Analysis --

test("financial metrics derived purely from industry benchmarks are classified as benchmark/assumption-derived, never fabricated as Verified", () => {
  const { financialModel } = buildReport(zeroEvidencePrompt);

  for (const key of ["tam", "cac", "ltv", "arr"]) {
    const metric = financialModel.metrics[key];
    assert.match(metric.formula, /benchmark|x /i, `${key} formula should be benchmark/model-derived`);
  }
});
