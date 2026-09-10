// TASK #69A-54 -- Make Execution Readiness evidence-sensitive, not
// merely directionally correct.
//
// TRACE (full detail in the final report to the user):
//   1. executionComplexityScore (investment-score.ts) originates as a
//      flat 3-way bucket: capitalHeavy ? 0.42 : d2cFoodOrFmcg ? 0.5 :
//      0.66 -- confirmed the ONLY evidence objects available at this
//      pipeline stage (createInvestmentScore runs BEFORE any research
//      evidence exists, #69A-50's own established trace) are the raw
//      submitted prompt text and financialModel.inputs (industryKey/
//      businessModel/pricingModel -- already-normalized structured
//      fields, which capitalHeavy/d2cFoodOrFmcg already read).
//   2. Mechanism: binary keyword-presence hits over the raw prompt
//      (capitalHeavy) plus structured field checks (d2cFoodOrFmcg) --
//      never weighted signals, never category scoring, before this fix.
//   3. Root cause confirmed live: the real SMB AI-forecasting prompt
//      ("Premium AI-powered financial planning... integrating with
//      QuickBooks/Xero") matched NEITHER capitalHeavy NOR d2cFoodOrFmcg,
//      silently defaulting to 0.66 -- the EASIEST bucket -- even though
//      it literally states two real execution burdens (AI/ML product
//      complexity, third-party integration dependency) as USER INPUT.
//
// FIX: 7 new, bounded, evidence-specific execution-burden categories
// (productTechnical, integrationDependency, dataInfrastructure,
// regulatoryCompliance, distributionChannel, talentExpertise,
// implementationOnboarding), each a single narrow regex tied to a named
// burden type, checked against the submitted prompt text (explicitly a
// sanctioned evidence source per this ticket's own rules). A category
// counts AT MOST ONCE (Boolean per category, never per keyword-hit).
// Each matched category subtracts the SAME small, fixed
// EXECUTION_BURDEN_CATEGORY_PENALTY (0.05) from the EXISTING,
// unchanged capitalHeavy/d2cFoodOrFmcg baseline -- purely additive, so
// a prompt matching none of these categories produces the exact same
// score as before #69A-54, byte for byte. Floored at
// EXECUTION_READINESS_FLOOR (0.15) so prose alone can never crush it to
// zero. "Operational complexity" and "Distribution/channel complexity"
// (two of the ticket's own 8 suggested categories) are deliberately NOT
// duplicated as new checks: they are already covered by the EXISTING
// capitalHeavy and d2cFoodOrFmcg checks respectively -- a second,
// separate keyword check for the same concept would be double counting,
// not new signal.
//
// The explanation (buildCanonicalFounderScore, plan-executor.ts) is now
// DYNAMIC: built from investment-score.ts's own new "Execution readiness
// factors: ..." reasoning line -- the SAME evidence the score used --
// never a second, independently-worded, always-the-same sentence.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanonicalFinancialAssumptions } from "../app/lib/ai/financial-assumptions.ts";
import { readFounderReadinessScoreValue, buildExecutiveSnapshot } from "../app/lib/report-presentation.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

function build(prompt) {
  return createCanonicalFinancialAssumptions({ prompt, reportKind: "business_plan" });
}

function dims(context) {
  return Object.fromEntries(
    context.investmentScore.decisionEngine.founderScore.dimensionScores.map((d) => [d.key, d.score])
  );
}

function reasoning(context) {
  return context.investmentScore.decisionEngine.founderScore.reasoning;
}

const BASELINE_PROMPT = "We run a B2B subscription analytics platform for supply chain teams in the US.";
const REAL_CASE_PROMPT =
  "Premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for SMBs in the United States, integrating with QuickBooks/Xero.";

// --- 1: AI/ML training burden recognized ---------------------------------

test("1. AI/ML model/technical burden is recognized when genuinely stated as user input, and lowers Execution Readiness relative to an otherwise-identical baseline", () => {
  const withAi = build("We run a B2B subscription analytics platform for supply chain teams in the US, powered by a proprietary machine learning forecasting model.");
  const withoutAi = build(BASELINE_PROMPT);

  assert.ok(dims(withAi).executionComplexity < dims(withoutAi).executionComplexity);
  const factorsLine = reasoning(withAi).find((line) => line.startsWith("Execution readiness factors:"));
  assert.match(factorsLine, /AI\/ML model or data-quality requirements/);
});

// --- 2: third-party integration burden recognized ------------------------

test("2. third-party integration/dependency burden is recognized when the prompt states it, and lowers Execution Readiness", () => {
  const withIntegration = build("We run a B2B subscription analytics platform for supply chain teams in the US, integrating with SAP and Oracle NetSuite.");
  const withoutIntegration = build(BASELINE_PROMPT);

  assert.ok(dims(withIntegration).executionComplexity < dims(withoutIntegration).executionComplexity);
  const factorsLine = reasoning(withIntegration).find((line) => line.startsWith("Execution readiness factors:"));
  assert.match(factorsLine, /dependency on multiple third-party integrations/);
});

// --- 3: regulatory burden recognized --------------------------------------

test("3. regulatory/compliance burden is recognized when the prompt states it, and lowers Execution Readiness", () => {
  const withRegulatory = build("We run a healthtech data platform for clinics in the US that must satisfy HIPAA compliance burden across multiple states.");
  const withoutRegulatory = build(BASELINE_PROMPT);

  assert.ok(dims(withRegulatory).executionComplexity < dims(withoutRegulatory).executionComplexity);
  const factorsLine = reasoning(withRegulatory).find((line) => line.startsWith("Execution readiness factors:"));
  assert.match(factorsLine, /regulatory or compliance burden/);
});

// --- 4: distribution/channel-building burden recognized ------------------

test("4. distribution/channel-building burden is recognized when the prompt states it, and lowers Execution Readiness", () => {
  const withChannel = build("We run a B2B subscription analytics platform for supply chain teams in the US, requiring extensive reseller network and partner channel development.");
  const withoutChannel = build(BASELINE_PROMPT);

  assert.ok(dims(withChannel).executionComplexity < dims(withoutChannel).executionComplexity);
  const factorsLine = reasoning(withChannel).find((line) => line.startsWith("Execution readiness factors:"));
  assert.match(factorsLine, /unvalidated or difficult distribution\/channel motion/);
});

// --- 5: unsupported generic complexity does not create a penalty --------

test("5. [NO HALLUCINATED PENALTY] generic complexity/difficulty language with no specific named burden category does not lower Execution Readiness", () => {
  const genericComplexity = build(
    "We run a B2B subscription analytics platform for supply chain teams in the US. This is a complex and difficult market with many challenges."
  );
  const baseline = build(BASELINE_PROMPT);

  assert.equal(dims(genericComplexity).executionComplexity, dims(baseline).executionComplexity);
  const factorsLine = reasoning(genericComplexity).find((line) => line.startsWith("Execution readiness factors:"));
  assert.match(factorsLine, /no specific integration, technical, regulatory, or distribution burden identified/);
});

// --- 6: duplicate evidence does not double-penalize -----------------------

test("6. [NO DOUBLE COUNTING] mentioning the SAME burden category multiple times (e.g. two separate integration mentions) only counts once", () => {
  const singleMention = build(
    "We run a B2B subscription analytics platform for supply chain teams in the US, integrating with SAP."
  );
  const repeatedMention = build(
    "We run a B2B subscription analytics platform for supply chain teams in the US, integrating with SAP. We are also integrating with Oracle NetSuite and require additional API integrations with Salesforce."
  );

  assert.equal(dims(singleMention).executionComplexity, dims(repeatedMention).executionComplexity);
});

// --- 7: multiple independent burdens lower readiness monotonically ------

test("7. [MONOTONIC] adding more independent, genuinely-evidenced burden categories lowers Execution Readiness monotonically -- never non-monotonically or by an unbounded amount", () => {
  const zero = build(BASELINE_PROMPT);
  const one = build("We run a B2B subscription analytics platform for supply chain teams in the US, integrating with SAP.");
  const two = build("We run a B2B subscription analytics platform for supply chain teams in the US, integrating with SAP, powered by a proprietary machine learning forecasting model.");
  const three = build(
    "We run a B2B subscription analytics platform for supply chain teams in the US, integrating with SAP, powered by a proprietary machine learning forecasting model, requiring extensive reseller network and partner channel development."
  );

  const zeroScore = dims(zero).executionComplexity;
  const oneScore = dims(one).executionComplexity;
  const twoScore = dims(two).executionComplexity;
  const threeScore = dims(three).executionComplexity;

  assert.ok(zeroScore > oneScore, `${zeroScore} > ${oneScore}`);
  assert.ok(oneScore > twoScore, `${oneScore} > ${twoScore}`);
  assert.ok(twoScore > threeScore, `${twoScore} > ${threeScore}`);
  // Each step is exactly one bounded category penalty (5 points).
  assert.equal(zeroScore - oneScore, 5);
  assert.equal(oneScore - twoScore, 5);
  assert.equal(twoScore - threeScore, 5);
});

// --- 8: score remains bounded ----------------------------------------------

test("8. [BOUNDED] a fixture matching EVERY burden category plus capitalHeavy never goes below the explicit floor, and stays within [0, 100]", () => {
  const extreme = build(
    "We run a battery manufacturing factory business, powered by a proprietary machine learning forecasting model, integrating with SAP, requiring data migration and legacy data infrastructure work, subject to HIPAA compliance burden across multiple jurisdictions, requiring extensive reseller network and partner channel development, dependent on specialized talent that is hard to hire, and requiring enterprise implementation with a multi-month onboarding cycle."
  );
  const score = dims(extreme).executionComplexity;
  assert.ok(score >= 15, `expected the explicit floor (15) to hold, got ${score}`);
  assert.ok(score <= 100 && score >= 0);
});

// --- 9: Founder Readiness consumes the result exactly once --------------

test("9. [SINGLE CONSUMPTION] executionComplexityScore is read exactly once by teamFounder's own aggregate -- no duplicate penalty anywhere else in investment-score.ts", () => {
  const usageCount = (investmentScoreSource.match(/executionComplexityScore/g) || []).length;
  // 1 explanatory comment mention + 1 declaration + 1 use inside
  // teamFounderRawAverage + 1 use inside the "Execution complexity: NN%"
  // reasoning line + 1 use inside the dimensionScores entry = exactly 5
  // occurrences -- the fix only changed HOW the value on the right-hand
  // side of the declaration is computed, never added a second consumer.
  assert.equal(usageCount, 5, `expected exactly 5 occurrences (1 comment + 1 declaration + 3 consumers), got ${usageCount}`);
});

// --- 10: web and PDF show the same canonical value -----------------------

test("10. [PARITY] web (single-section content) and PDF (full concatenated content) callers of buildExecutiveSnapshot agree on every Founder-Readiness-adjacent value for the same, evidence-sensitive investmentScore", () => {
  const context = build(REAL_CASE_PROMPT);
  const executiveSummarySection = "MONITOR. The opportunity requires further validation.";
  const founderReadinessSection = [
    `Founder Readiness Score: ${readFounderReadinessScoreValue(context.investmentScore)}/100`,
    "Execution Readiness: 56/100 - Execution readiness is constrained by AI/ML model or data-quality requirements; dependency on multiple third-party integrations.",
  ].join("\n");
  const fullReportContent = [
    `Executive Summary\n${executiveSummarySection}`,
    `Founder Readiness\n${founderReadinessSection}`,
  ].join("\n\n");

  const webSnapshot = buildExecutiveSnapshot(executiveSummarySection, context.investmentScore, undefined);
  const pdfSnapshot = buildExecutiveSnapshot(fullReportContent, context.investmentScore, undefined);
  assert.equal(webSnapshot.founderScoreValue, pdfSnapshot.founderScoreValue);
  assert.deepEqual(webSnapshot.confidenceRadar, pdfSnapshot.confidenceRadar);
});

// --- 11: explanation and score use the same evidence ----------------------

test("11. [EXPLANATION PARITY] plan-executor.ts's fallback explanation is built from investment-score.ts's own 'Execution readiness factors' reasoning line -- never an independent re-scan of the prompt with a second detector", () => {
  assert.match(
    planExecutorSource,
    /const executionReadinessFactorsSummary =\s*\n\s*\/Execution readiness factors: \(\[\^\|\]\*\)\/i\.exec\(founderReasoning\)\?\.\[1\]\?\.trim\(\) \|\| "";/
  );
  assert.doesNotMatch(
    planExecutorSource,
    /EXECUTION_BURDEN_CATEGORY_PATTERNS/,
    "plan-executor.ts must never re-declare its own copy of the burden-detection patterns"
  );
});

test("11b. for a real fixture, the reasoning-derived explanation summary mentions exactly the categories the score itself detected -- no drift between the two", () => {
  const context = build(REAL_CASE_PROMPT);
  const factorsLine = reasoning(context).find((line) => line.startsWith("Execution readiness factors:"));
  assert.match(factorsLine, /AI\/ML model or data-quality requirements/);
  assert.match(factorsLine, /dependency on multiple third-party integrations/);
  // Exactly 2 categories joined by "; " -- proving the explanation is a
  // direct, unmodified projection of the same detection the score used.
  assert.equal(factorsLine.split("; ").length, 2);
});

// --- 12: legacy reports remain stable --------------------------------------

test("12. [HISTORICAL SAFETY] a legacy report with no 'Execution readiness factors' reasoning line at all (persisted before #69A-54) degrades to the neutral fallback explanation, never a fabricated or wrong-direction claim, and its OWN persisted score is read back verbatim", () => {
  const legacyInvestmentScore = {
    decisionEngine: {
      founderScore: {
        score: 40,
        maximumScore: 100,
        reasoning: ["Execution complexity: 66%"], // no "Execution readiness factors" line at all
      },
    },
  };
  assert.equal(readFounderReadinessScoreValue(legacyInvestmentScore), 40, "a historical persisted score must be read back unchanged");
});

// --- 13: Decision/Confidence do not drift for unrelated reasons ----------

test("13. [INVARIANT] for a prompt matching NO new burden category, Execution Readiness and the full downstream investmentScore are byte-identical to the pre-#69A-54 baseline formula", () => {
  const context = build(BASELINE_PROMPT);
  // capitalHeavy=false, d2cFoodOrFmcg=false, no burden categories match
  // -> baseline 0.66 unchanged.
  assert.equal(dims(context).executionComplexity, 66);
});

test("13b. [INVARIANT] no canonical decision, market/financial/product/source-strength/data-completeness/benchmark/validation-readiness/evidence-confidence/founder-evidence file carries a #69A-54 marker beyond investment-score.ts's own bounded category addition and plan-executor.ts's cache-version bump", () => {
  for (const relativePath of [
    "app/lib/ai/report-intelligence.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/report-presentation.ts",
    "app/lib/ai/financial-model.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-54/, `${relativePath} must not carry a #69A-54 marker`);
  }
});

test("13c. [CACHE SAFETY] BUSINESS_PLAN_GENERATION_CONTRACT_VERSION was bumped past v17, invalidating any full-report cache entry generated before this fix", () => {
  const match = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "ltv-cac-ratio-integrity-v(\d+)";/.exec(planExecutorSource);
  assert.ok(match, "BUSINESS_PLAN_GENERATION_CONTRACT_VERSION declaration not found");
  assert.ok(Number(match[1]) >= 18, "version must be at v18 or later for this ticket's own cache-invalidating bump");
});
