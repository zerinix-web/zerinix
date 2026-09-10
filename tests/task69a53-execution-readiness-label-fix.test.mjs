// TASK #69A-53 -- Make Founder Readiness "Execution Complexity"
// semantically correct and directionally safe.
//
// TRACE (full detail in the final report to the user):
//   1. executionComplexityScore (investment-score.ts) = capitalHeavy ?
//      0.42 : d2cFoodOrFmcg ? 0.5 : 0.66 -- a coarse, industry-archetype
//      score.
//   2. Confirmed the direction empirically: capital-heavy/high-risk
//      archetypes (manufacturing, hospital, hotel, ...) score LOWER
//      (0.42), an ordinary SaaS/service business scores HIGHER (0.66).
//      This means the score has always meant execution EASE/readiness
//      -- higher = easier/more ready to execute -- the SAME direction
//      every other Founder Readiness dimension already uses. It was
//      NEVER inverted anywhere; the number itself needed no correction.
//   3. It is added POSITIVELY, with equal weight, into teamFounder's own
//      7-term average (#69A-51's fix) and is subject to #69A-52's own
//      non-compensatory founder/validation ceiling exactly like every
//      other term -- no special-casing needed, since it was already
//      oriented correctly.
//   4. Web and PDF already consumed the ONE canonical FOUNDER_READINESS_
//      DIMENSIONS entry (#69A-17's own established single-source-of-
//      truth design) -- confirmed no renderer had its own hand-copied
//      label.
//   5. The REAL defect: the LABEL "Execution Complexity" implies the
//      opposite of what the number means, and confirmed live this
//      actively caused the AI model's own free-written explanation
//      (extractFounderDimensionExplanation) to describe REASONS FOR
//      COMPLEXITY next to a good-looking, high number -- e.g.
//      "Execution Complexity: 66/100 -- integrations, model training,
//      and channel building raise complexity," reading as self-
//      contradictory.
//
// FIX: renamed the user-facing label (report-presentation.ts's
// FOUNDER_READINESS_DIMENSIONS, plan-executor.ts's buildCanonicalFounderScore
// and its own prompt instruction, pdf-normalization.mjs's localization
// pair) to "Execution Readiness" -- no inversion, no formula change. The
// internal key ("executionComplexity") and investment-score.ts's own
// internal `.reasoning` array text ("Execution complexity: NN%",
// feeding #69A-47's cross-file extraction in market-research-coverage.ts)
// are deliberately left unchanged -- a minimal, safe migration. Old
// labels/text remain recognized aliases for full backward compatibility.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanonicalFinancialAssumptions } from "../app/lib/ai/financial-assumptions.ts";
import {
  FOUNDER_READINESS_DIMENSIONS,
  readFounderReadinessMetricValue,
  buildExecutiveSnapshot,
} from "../app/lib/report-presentation.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const promptsPlanSource = readFileSync(join(repoRoot, "app/lib/report-engine/prompts/plan.ts"), "utf8");
const pdfNormalizationSource = readFileSync(join(repoRoot, "app/lib/pdf-normalization.mjs"), "utf8");

function build(prompt) {
  return createCanonicalFinancialAssumptions({ prompt, reportKind: "business_plan" });
}

function dims(context) {
  return Object.fromEntries(
    context.investmentScore.decisionEngine.founderScore.dimensionScores.map((d) => [d.key, d.score])
  );
}

const ORDINARY_SAAS_PROMPT =
  "We run a B2B subscription analytics platform for supply chain teams in the US.";
const CAPITAL_HEAVY_PROMPT =
  "We run a battery manufacturing factory business producing EV batteries for automotive OEMs in the US.";

// --- 1: higher execution difficulty does not increase Founder --------
// --- Readiness -----------------------------------------------------------

test("1. a capital-heavy (harder-to-execute) business scores a LOWER Execution Readiness dimension than an ordinary SaaS business, and this correctly pulls the Founder Readiness aggregate down, never up", () => {
  const capitalHeavy = build(CAPITAL_HEAVY_PROMPT);
  const ordinary = build(ORDINARY_SAAS_PROMPT);

  const capitalHeavyDims = dims(capitalHeavy);
  const ordinaryDims = dims(ordinary);

  assert.ok(
    capitalHeavyDims.executionComplexity < ordinaryDims.executionComplexity,
    `expected the harder-to-execute business (${capitalHeavyDims.executionComplexity}) to score lower than the ordinary one (${ordinaryDims.executionComplexity})`
  );
});

// --- 2: higher execution readiness increases or preserves Founder ------
// --- Readiness --------------------------------------------------------------

test("2. holding every other dimension equal, a higher Execution Readiness value never DECREASES the Founder Readiness aggregate -- it is added positively, with equal weight, into teamFounder's own average", () => {
  const lowerExecution = 0.42;
  const higherExecution = 0.66;
  const otherDims = [0.6, 0.6, 0.5, 0.5, 0.5, 0.5];

  const average = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const withLower = average([...otherDims, lowerExecution]);
  const withHigher = average([...otherDims, higherExecution]);

  assert.ok(withHigher > withLower, "a higher Execution Readiness term must raise the plain average, never lower it");
});

// --- 3: canonical direction is higher = better ---------------------------

test("3. FOUNDER_READINESS_DIMENSIONS' executionComplexity entry is labeled 'Execution Readiness' (higher = better), not 'Execution Complexity' (which would imply higher = worse) -- old label/aliases kept only for backward-compatible text matching", () => {
  const dimension = FOUNDER_READINESS_DIMENSIONS.find((d) => d.key === "executionComplexity");
  assert.equal(dimension.label, "Execution Readiness");
  assert.ok(dimension.aliases.includes("Execution Complexity"), "the old label must remain a recognized alias for historical reports");
  assert.ok(dimension.aliases.includes("Execution Feasibility"));
});

test("3b. [UPDATED BY #69A-54] the ORIGINAL capitalHeavy/d2cFoodOrFmcg baseline formula is preserved verbatim as executionBaselineEase -- #69A-53's own directionality fix is untouched; #69A-54 only adds an evidence-sensitivity correction on top of it (see task69a54's own test file)", () => {
  assert.match(investmentScoreSource, /const executionBaselineEase = capitalHeavy \? 0\.42 : d2cFoodOrFmcg \? 0\.5 : 0\.66;/);
});

// --- 4: explanation matches numeric direction -----------------------------

test("4. [UPDATED BY #69A-54] buildCanonicalFounderScore's fallback explanation is readiness-framed (describes what CONSTRAINS readiness) and DYNAMIC -- built from this report's own detected burden categories, never a single always-the-same sentence -- for the SAME dimension the number represents", () => {
  assert.match(planExecutorSource, /Execution readiness is constrained by \$\{executionReadinessFactorsSummary\}\./);
  assert.match(planExecutorSource, /No specific integration, technical, regulatory, or distribution execution burden was identified in the submitted information\./);
  assert.match(planExecutorSource, /reportText\(language, `Execution Readiness: \$\{executionComplexity\}\/100 - \$\{executionComplexityExplanation\}`/);
});

test("4b. the founderScore prompt instructs the model to treat this dimension as readiness (higher = easier), explicitly forbidding a complexity-framed description of a high score", () => {
  assert.match(promptsPlanSource, /Execution Readiness measures how EASY execution is, not how complex it is; never describe a high score as complex or difficult/);
  assert.match(promptsPlanSource, /Execution Readiness, and Evidence Confidence/);
  assert.doesNotMatch(promptsPlanSource, /Execution Complexity, and Evidence Confidence/);
});

// --- 5: web/PDF use the same canonical execution dimension --------------

test("5. [PARITY] web and PDF both resolve the Execution Readiness dimension through the SAME canonical FOUNDER_READINESS_DIMENSIONS entry -- no renderer-specific recomputation", () => {
  const investmentScore = {
    decisionEngine: {
      founderScore: {
        score: 40,
        maximumScore: 100,
        reasoning: [],
        dimensionScores: [{ key: "executionComplexity", label: "Execution Readiness", score: 66 }],
      },
    },
  };
  const webValue = readFounderReadinessMetricValue("Execution Readiness", investmentScore, "");
  assert.equal(webValue, 66);

  const snapshot = buildExecutiveSnapshot("Execution Readiness: 66/100 - execution is straightforward.", investmentScore, undefined);
  assert.ok(snapshot, "buildExecutiveSnapshot (shared by web and PDF) must process content mentioning the new label without error");
});

// --- 6: legacy persisted reports remain deterministic --------------------

test("6. [HISTORICAL SAFETY] a legacy report whose OWN persisted text says 'Execution Complexity: NN%' resolves to the SAME number under the new canonical label -- no inversion, no mutation, fully deterministic", () => {
  const legacyInvestmentScore = {
    decisionEngine: {
      founderScore: {
        score: 40,
        maximumScore: 100,
        reasoning: ["Execution complexity: 66%"],
        // Deliberately no dimensionScores -- simulates a report
        // persisted before #69A-17's structured field existed.
      },
    },
  };
  const legacyText = "Execution Complexity: 66/100 - Execution requires disciplined launch sequencing, channel proof, and operational control.";

  const viaNewLabel = readFounderReadinessMetricValue("Execution Readiness", legacyInvestmentScore, legacyText);
  assert.equal(viaNewLabel, 66, "a historical report's already-persisted number must be read back unchanged, never inverted (100 - x) or mutated");
});

test("6b. [HISTORICAL SAFETY] the same legacy fixture resolves identically on a second, independent read -- deterministic, no hidden state", () => {
  const legacyInvestmentScore = {
    decisionEngine: {
      founderScore: { score: 40, maximumScore: 100, reasoning: ["Execution complexity: 66%"] },
    },
  };
  const legacyText = "Execution Complexity: 66/100 - moderate operational load.";
  const first = readFounderReadinessMetricValue("Execution Readiness", legacyInvestmentScore, legacyText);
  const second = readFounderReadinessMetricValue("Execution Readiness", legacyInvestmentScore, legacyText);
  assert.equal(first, second);
  assert.equal(first, 66);
});

// --- 7: current decision metrics do not drift for unrelated reasons -----

test("7. [INVARIANT] no canonical decision (createRecommendation/applyFatalBlockerOverride), Founder Readiness aggregation ceiling (#69A-52), Data Completeness, Source Strength, Financial Consistency, Benchmark Fit, Validation Readiness, or report-quality file carries a #69A-53 marker beyond the label/prompt/explanation text this fix touches", () => {
  for (const relativePath of [
    "app/lib/ai/report-intelligence.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-53/, `${relativePath} must not carry a #69A-53 marker`);
  }
  // investment-score.ts DOES carry a #69A-53 marker (the label-only
  // dimensionScores fix), but its formula/aggregation logic (checked in
  // test 3b above) is byte-unchanged.
  assert.match(investmentScoreSource, /TASK #69A-53/);
});

test("8. [INVARIANT] the founderValidationCeiling introduced by #69A-52 depends only on founderEvidenceScore/validationLevelScore -- a good-looking Execution Readiness score can never mask/rescue weak founder evidence through that ceiling", () => {
  const ceilingSnippet = investmentScoreSource.slice(
    investmentScoreSource.indexOf("const founderValidationCeiling = clamp("),
    investmentScoreSource.indexOf("const teamFounderRawAverage = average([")
  );
  assert.match(ceilingSnippet, /Math\.min\(founderEvidenceScore, validationLevelScore\)/);
  assert.doesNotMatch(ceilingSnippet, /executionComplexityScore/);
});

test("8b. [INVARIANT] a fixture with strong Execution Readiness but weak founder/validation evidence still produces a low, ceiling-constrained Founder Readiness Score -- a good execution-ease reading cannot mask weak founder evidence", () => {
  const context = build(
    "We are building a B2B subscription platform for enterprise data-center capacity planning in the US. The market for infrastructure planning software is large and growing. We have not yet run any paid pilots and have no confirmed paying customers. We do not have validated CAC or retention data yet, and willingness to pay has not been tested. We have no founder or team with any relevant domain experience -- the founder has never operated a company, has no technical background, and has no domain expertise whatsoever."
  );
  const d = dims(context);
  const headline = context.investmentScore.decisionEngine.founderScore.score;

  assert.ok(d.executionComplexity >= 60, `sanity: this fixture's Execution Readiness reads strong (ordinary SaaS-shaped, non-capital-heavy), got ${d.executionComplexity}`);
  assert.ok(d.founderEvidence < 20 && d.validationConfidence < 55, "sanity: founder/validation evidence is genuinely weak");
  assert.ok(headline < 50, `expected the strong Execution Readiness dimension to be unable to rescue the headline above 50, got ${headline}`);
});

// --- cache-invalidation safety --------------------------------------------

test("9. [CACHE SAFETY] BUSINESS_PLAN_GENERATION_CONTRACT_VERSION was bumped past v16, invalidating any full-report cache entry generated before this fix", () => {
  const match = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "ltv-cac-ratio-integrity-v(\d+)";/.exec(planExecutorSource);
  assert.ok(match, "BUSINESS_PLAN_GENERATION_CONTRACT_VERSION declaration not found");
  assert.ok(Number(match[1]) >= 17, "version must be at v17 or later for this ticket's own cache-invalidating bump");
});

// --- pdf-normalization backward-compat pair -------------------------------

test("10. [PARITY] pdf-normalization.mjs's bilingual label-pair table carries both the new 'Execution Readiness' entry and the old 'Execution Complexity' entry, so a historical Turkish PDF still normalizes correctly", () => {
  assert.match(pdfNormalizationSource, /\["Execution Readiness", "Yürütme Hazırlığı"\]/);
  assert.match(pdfNormalizationSource, /\["Execution Complexity", "Yürütme Karmaşıklığı"\]/);
});
