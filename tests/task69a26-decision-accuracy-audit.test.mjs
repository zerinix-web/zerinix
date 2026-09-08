// TASK #69A-26 -- ZERINIX Decision Accuracy Audit.
//
// This is an AUDIT test file, not a correctness-guard test file. Its
// purpose is to make confirmed architectural findings reproducible and
// falsifiable, not to guard already-correct behavior. Per the ticket's
// own explicit instruction ("Tests should expose incorrect behavior
// rather than 'fixing' expected values to match current
// implementation"), several tests below assert the CORRECT expected
// behavior and were, AT THE TIME #69A-26 WAS WRITTEN, EXPECTED TO FAIL
// against the (then-current) implementation -- a failing test here was
// the deliverable, not a defect in the test. Each test is labeled
// [CONFIRMED DEFECT] (documents a real bug found by #69A-26) or
// [STRUCTURAL FINDING] (documents a real architectural fact, not
// necessarily a bug on its own). No production decision logic was
// modified to produce this file originally. See the #69A-26 final
// report for full analysis, severity ranking, and recommended fixes --
// this file exists to make every claim in that report independently
// reproducible by anyone, not to replace it.
//
// TASK #69A-27 -- FOLLOW-UP, applied fixes for the P0/P1 findings
// above. Three assertions in this file described the PRE-#69A-27
// state and are now updated to describe the POST-fix state instead of
// being silently left red or deleted -- each is marked below with
// exactly what changed and why. Every other test in this file is
// UNCHANGED and still passes, confirming the underlying facts they
// documented remain true after the fix.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanonicalFinancialAssumptions,
  refreshResearchAwareFinancialContext,
} from "../app/lib/ai/financial-assumptions.ts";
import { applyMarketResearchCoverageToContext } from "../app/lib/ai/market-research-coverage.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");
const decisionConfidenceSource = readFileSync(join(repoRoot, "app/lib/ai/decision-confidence.ts"), "utf8");
const financialAssumptionsSource = readFileSync(join(repoRoot, "app/lib/ai/financial-assumptions.ts"), "utf8");
const marketResearchCoverageSource = readFileSync(join(repoRoot, "app/lib/ai/market-research-coverage.ts"), "utf8");

function evidenceItem(overrides) {
  return {
    id: overrides.id,
    field: overrides.field || "market_size",
    claim: overrides.claim,
    value: overrides.value || overrides.claim,
    label: "Verified from external source",
    sourceTitle: overrides.sourceTitle,
    publisher: overrides.publisher,
    url: overrides.url,
    sourceType: "webpage",
    authorityLevel: "secondary",
    confidence: overrides.confidence ?? 85,
    publishedDate: "2026-06-01",
    lastChecked: "2026-09-01",
    supportingData: [overrides.claim],
    impact: overrides.impact || "favorable",
    impactReason: overrides.impactReason || "",
    qualityScore: overrides.qualityScore ?? 70,
    researchStage: "authoritative_public",
    jurisdiction: "United States",
  };
}

// A real, structurally valid research-evidence set (same shape this
// codebase's own #69A-3/#69A-16 tests use) -- market-size claims,
// named competitors, and a financial benchmark, all from distinct
// domains, so evaluateMarketResearchCoverage scores it as genuine,
// well-sourced external evidence rather than an evidence-free report.
function strongEvidenceSet() {
  return [
    evidenceItem({ id: "R1", field: "market_size", claim: "US enterprise logistics SaaS TAM estimated at $18B, growing 14% CAGR.", url: "https://www.gartner.com/en/reports/logistics-saas-market", sourceTitle: "Gartner logistics SaaS market report", publisher: "Gartner" }),
    evidenceItem({ id: "R2", field: "market_size", claim: "Enterprise logistics software SAM in North America estimated at $4.2B.", url: "https://www.statista.com/logistics-software-market", sourceTitle: "Statista logistics software market", publisher: "Statista" }),
    evidenceItem({ id: "R3", field: "competitors", claim: "Project44 is a leading competitor offering real-time supply chain visibility to enterprise logistics customers.", url: "https://www.project44.com/platform", sourceTitle: "Project44 platform overview", publisher: "Project44" }),
    evidenceItem({ id: "R4", field: "competitors", claim: "FourKites competes in the logistics visibility space with a large enterprise customer base.", url: "https://www.fourkites.com/platform", sourceTitle: "FourKites platform overview", publisher: "FourKites" }),
    evidenceItem({ id: "R5", field: "competitors", claim: "Flexport offers freight forwarding and visibility software to enterprise shippers.", url: "https://www.flexport.com/platform", sourceTitle: "Flexport platform", publisher: "Flexport" }),
    evidenceItem({ id: "R6", field: "financial", claim: "Enterprise logistics SaaS companies typically report 80-90% gross margins.", url: "https://www.crunchbase.com/logistics-saas-benchmarks", sourceTitle: "Crunchbase logistics SaaS benchmarks", publisher: "Crunchbase" }),
    evidenceItem({ id: "R7", field: "product_evidence", claim: "Enterprise logistics buyers cite integration depth and reliability as primary purchase drivers.", url: "https://www.g2.com/categories/supply-chain-visibility", sourceTitle: "G2 supply chain visibility category", publisher: "G2" }),
  ];
}

const STRONG_LOGISTICS_PROMPT =
  "We run a B2B SaaS subscription platform for enterprise logistics companies in the US. We have 420 paying enterprise customers generating $3.2M ARR with 92% gross margin. Our monthly churn is 1.2% and net revenue retention is 118%. CAC is $1,800 with a 4-month payback, validated over 18 months of paid acquisition spend across enterprise sales channels. We have an experienced founding team of former logistics executives and engineers with deep domain expertise. Our SAM is estimated at $800M with a defensible data moat and enterprise compliance certifications.";

function runFullPipeline(prompt, evidence = []) {
  const context = createCanonicalFinancialAssumptions({ prompt, reportKind: "business_plan" });
  const coverageResult = applyMarketResearchCoverageToContext(context, { evidence }, prompt);
  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);
  return { context, coverageResult, refreshed };
}

// --- [STRUCTURAL FINDING] No hard gate / blocker override exists -------

test("[STRUCTURAL FINDING, UPDATED BY #69A-27] createRecommendation itself remains an unmodified pure two-threshold aggregate gate -- but its result is now wrapped by a narrow, structural fatal-blocker override", () => {
  // createRecommendation's own formula is byte-for-byte unchanged --
  // #69A-27 did not touch the aggregate gate itself, only exported it
  // and added a separate, additive override on top of its result.
  assert.match(
    investmentScoreSource,
    /export function createRecommendation\(totalScore: number, confidence: number\) \{\s*\n\s*if \(totalScore >= 72 && confidence >= 60\) return "GO";\s*\n\s*if \(totalScore < 35 && confidence < 35\) return "PASS";\s*\n\s*return "WAIT";\s*\n\s*\}/
  );
  // #69A-27's fix: a genuine per-dimension floor/override now exists,
  // reversing this test's original finding. See
  // tests/task69a27-decision-engine-corrections.test.mjs for the full
  // fix-proof and behavioral regression tests.
  assert.match(investmentScoreSource, /export function detectFatalBlockers\(/);
  assert.match(investmentScoreSource, /export function applyFatalBlockerOverride\(/);
});

test("[STRUCTURAL FINDING] arithmetic proof: 7 categories at 90% and ONE catastrophic category (teamFounder) at 10% still clears the GO threshold", () => {
  const CATEGORY_WEIGHTS = {
    marketOpportunity: 15, competitiveAdvantage: 12, businessModel: 13,
    financialHealth: 15, scalability: 12, teamFounder: 10,
    capitalEfficiency: 13, executionRisk: 10,
  };
  const totalScore = Object.entries(CATEGORY_WEIGHTS).reduce((sum, [key, weight]) => {
    const normalizedScore = key === "teamFounder" ? 0.10 : 0.90;
    return sum + Math.round(normalizedScore * weight);
  }, 0);
  // Confirmed: a single catastrophically-weak category (even a genuine
  // fatal founder/execution blocker) is mathematically diluted into an
  // aggregate that still clears createRecommendation's totalScore >= 72
  // bar -- proving Case F ("high score, critical blocker") is a real,
  // unmitigated architectural gap, not a hypothetical concern.
  assert.ok(totalScore >= 72, `expected the diluted aggregate (${totalScore}) to still clear the GO totalScore threshold, proving no per-category gate exists`);
});

// --- [CONFIRMED DEFECT] totalScore frozen pre-research ------------------

test("[STRUCTURAL FINDING] refreshInvestmentNarrativeFromResearchCoverage's return type explicitly excludes recommendation/confidence/totalScore", () => {
  assert.match(
    investmentScoreSource,
    /export function refreshInvestmentNarrativeFromResearchCoverage\(\s*\n\s*score: InvestmentScore,\s*\n\s*model: FinancialModel\s*\n\s*\): Pick<InvestmentScore, "categories" \| "strengths" \| "weaknesses" \| "topRisks"> \{/
  );
});

test("[CONFIRMED DEFECT] investmentScore.totalScore does not match the sum of the CURRENTLY DISPLAYED (post-research-refresh) category scores once real research evidence exists -- the decision is computed from a number the report's own visible breakdown does not support", () => {
  const { refreshed } = runFullPipeline(STRONG_LOGISTICS_PROMPT, strongEvidenceSet());
  const sumOfDisplayedCategories = Object.values(refreshed.investmentScore.categories).reduce(
    (sum, category) => sum + category.score,
    0
  );
  // EXPECTED (correct behavior): the totalScore used for the
  // recommendation should equal what a reader can independently verify
  // by summing the report's own displayed category breakdown --
  // otherwise the decision cannot be reconstructed from the report's
  // own structured data (ticket section 7's provenance requirement).
  // ACTUAL (confirmed live, this run): totalScore is frozen at its
  // pre-research value while 5 of the 8 displayed categories were
  // overwritten with post-research values -- they now disagree.
  assert.equal(
    refreshed.investmentScore.totalScore,
    sumOfDisplayedCategories,
    `totalScore (${refreshed.investmentScore.totalScore}) is frozen at its pre-research value and no longer matches the sum of the currently-displayed, post-research category scores (${sumOfDisplayedCategories}) -- confirmed defect, see #69A-26 report`
  );
});

// --- [CONFIRMED DEFECT] founder/defensibility signal keyword-presence --
// --- checks have no negation handling (unlike hasValidationEvidence) ---

test("[CONFIRMED DEFECT] a prompt that explicitly states the founder has ZERO relevant experience still produces a HIGH founder-evidence score, because founderSignals has no negation handling", () => {
  const noFounderExperiencePrompt =
    "We run a B2B SaaS subscription platform for enterprise healthcare compliance software in the US. We have 300 paying enterprise customers generating $4M ARR with 90% gross margin. However, we have no founder or team with any healthcare, compliance, or software domain experience -- the founder has never operated a company, has no technical background, and has no domain expertise whatsoever.";
  const { refreshed } = runFullPipeline(noFounderExperiencePrompt, strongEvidenceSet());
  const founderEvidenceDimension = refreshed.investmentScore.decisionEngine.founderScore.dimensionScores?.find(
    (dimension) => dimension.key === "founderEvidence"
  );

  assert.ok(founderEvidenceDimension, "expected a founderEvidence dimension to exist");
  // EXPECTED (correct behavior): a prompt explicitly disclaiming all
  // founder/domain experience should score LOW on Founder Evidence,
  // matching the same negation-awareness hasValidationEvidence already
  // has (financial-model.ts / investment-score.ts's own copy).
  // ACTUAL (confirmed live): founderSignals = hasAny(normalizedPrompt,
  // [/\b(founder|team|operator|doctor|engineer|expert|experienced|domain)\b/])
  // has NO negation stripping at all -- the negated sentence itself
  // contains "founder", "domain", "technical", "expert"-adjacent words,
  // so founderSignals evaluates true and founderEvidenceScore uses the
  // HIGH (0.72+) branch instead of the LOW (0.34) branch.
  assert.ok(
    founderEvidenceDimension.score < 50,
    `Founder Evidence scored ${founderEvidenceDimension.score}/100 despite the prompt explicitly disclaiming ALL founder/domain experience -- confirmed defect: founderSignals (investment-score.ts) has no negation handling, unlike hasValidationEvidence`
  );
});

test("[STRUCTURAL FINDING] root cause confirmed: founderSignals has no negation-stripping step, unlike the adjacent hasValidationEvidence in the same file", () => {
  const founderSignalsBlock = investmentScoreSource.slice(
    investmentScoreSource.indexOf("const founderSignals = hasAny("),
    investmentScoreSource.indexOf("const founderSignals = hasAny(") + 200
  );
  assert.doesNotMatch(founderSignalsBlock, /negat/i);
  assert.match(investmentScoreSource, /negatedEvidenceClaimPattern/);
});

// --- [STRUCTURAL FINDING] Founder Readiness dimension collapse ---------

test("[STRUCTURAL FINDING, FIXED BY #69A-27] 'Evidence Confidence' and 'Founder Evidence' are no longer forced to be identical -- each now derives from its own independent signal", () => {
  // #69A-27 de-collapsed these: Founder Evidence still reads
  // founderEvidenceScore (founder/team-capability signals only);
  // Evidence Confidence now reads a separate evidenceConfidenceScore
  // (average metric confidence + genuine, non-projected validation
  // evidence -- never founder-specific). They are STRUCTURALLY
  // independent now, even though they may occasionally coincide by
  // arithmetic coincidence for a specific prompt.
  assert.match(investmentScoreSource, /\{ key: "evidenceConfidence", label: "Evidence Confidence", score: roundScore\(evidenceConfidenceScore \* 100\) \}/);
  assert.match(investmentScoreSource, /\{ key: "founderEvidence", label: "Founder Evidence", score: roundScore\(founderEvidenceScore \* 100\) \}/);
  assert.doesNotMatch(investmentScoreSource, /\{ key: "evidenceConfidence".*score: roundScore\(founderEvidenceScore \* 100\) \}/);

  // Concrete proof with the #69A-27 founder-inexperience fixture: an
  // explicit founder-inexperience disclosure now drags DOWN Founder
  // Evidence specifically, without dragging down Evidence Confidence
  // (which reflects the report's overall metric/validation evidence,
  // unrelated to founder capability).
  const noFounderExperiencePrompt =
    "We run a B2B SaaS subscription platform for enterprise healthcare compliance software in the US. We have 300 paying enterprise customers generating $4M ARR with 90% gross margin. However, we have no founder or team with any healthcare, compliance, or software domain experience -- the founder has never operated a company, has no technical background, and has no domain expertise whatsoever.";
  const { refreshed } = runFullPipeline(noFounderExperiencePrompt, strongEvidenceSet());
  const dims = refreshed.investmentScore.decisionEngine.founderScore.dimensionScores;
  const evidenceConfidence = dims.find((d) => d.key === "evidenceConfidence").score;
  const founderEvidence = dims.find((d) => d.key === "founderEvidence").score;
  assert.notEqual(evidenceConfidence, founderEvidence, "the two dimensions must no longer be forced identical");
  assert.ok(founderEvidence < 20, "Founder Evidence must correctly reflect the explicit inexperience disclosure");
});

test("[STRUCTURAL FINDING] 'Idea Quality' and 'Market Attractiveness' are ALSO always the identical value, for the same reason", () => {
  const { refreshed } = runFullPipeline(STRONG_LOGISTICS_PROMPT, strongEvidenceSet());
  const dims = refreshed.investmentScore.decisionEngine.founderScore.dimensionScores;
  const ideaQuality = dims.find((d) => d.key === "ideaQuality").score;
  const marketAttractiveness = dims.find((d) => d.key === "marketAttractiveness").score;
  assert.equal(ideaQuality, marketAttractiveness);
});

// --- [STRUCTURAL FINDING] validationIntelligenceV2/decisionConfidence --
// --- can never reflect real post-research evidence within one run -----

test("[STRUCTURAL FINDING] applyMarketResearchCoverageToContext never touches financialConsistency, sourceIntelligence, or decisionConfidence -- confirmed directly, not on faith", () => {
  const { context, coverageResult } = runFullPipeline(STRONG_LOGISTICS_PROMPT, strongEvidenceSet());
  assert.deepEqual(coverageResult.context.financialConsistency, context.financialConsistency);
  assert.deepEqual(coverageResult.context.sourceIntelligence, context.sourceIntelligence);
  assert.deepEqual(coverageResult.context.decisionConfidence, context.decisionConfidence);
});

test("[STRUCTURAL FINDING] createDecisionConfidenceModel is called exactly once in the whole codebase (pre-research only)", () => {
  const callSites = [
    ...financialAssumptionsSource.matchAll(/createDecisionConfidenceModel\(/g),
  ];
  // One import/usage site inside createCanonicalFinancialAssumptions;
  // refreshResearchAwareFinancialContext never calls it again.
  assert.equal(callSites.length, 1);
});

test("[STRUCTURAL FINDING] decisionConfidence.decision is a pure relabeling of investmentScore.recommendation -- it adds no independent decision information", () => {
  assert.match(
    decisionConfidenceSource,
    /function mapDecision\(score: InvestmentScore\): DecisionConfidenceDecision \{\s*\n\s*if \(score\.recommendation === "GO"\) \{\s*\n\s*return "GO";\s*\n\s*\}\s*\n\s*\n\s*if \(score\.recommendation === "PASS"\) \{\s*\n\s*return "NO-GO";\s*\n\s*\}\s*\n\s*\n\s*return "WAIT";\s*\n\s*\}/
  );
});

// --- [STRUCTURAL FINDING] research-evidence-coverage REPLACES, never ---
// --- blends with, the user's own stated market/competitive facts -------

test("[STRUCTURAL FINDING] marketOpportunity/competitiveAdvantage category scores are FULLY REPLACED by research-coverage percentage post-refresh, discarding the pre-research (user-stated) signal entirely rather than blending with it", () => {
  const { refreshed: withoutEvidence } = runFullPipeline(STRONG_LOGISTICS_PROMPT, []);
  const { refreshed: withEvidence } = runFullPipeline(STRONG_LOGISTICS_PROMPT, strongEvidenceSet());

  // Same prompt (same user-stated SAM/margin/business-model facts) --
  // only the research evidence differs. If the category genuinely
  // blended the user's own stated facts with research coverage, an
  // empty evidence array would still show SOME residual signal from
  // the strong prompt. It does not: it goes to exactly 0.
  assert.equal(withoutEvidence.investmentScore.categories.marketOpportunity.score, 0);
  assert.equal(withoutEvidence.investmentScore.categories.competitiveAdvantage.score, 0);
  assert.ok(withEvidence.investmentScore.categories.marketOpportunity.score > 0);
  assert.ok(withEvidence.investmentScore.categories.competitiveAdvantage.score > 0);
  // Root cause: scoreCategory (market-research-coverage.ts) assigns
  // `score: Math.round((clamp(score)/100) * category.maximumScore)` --
  // a REPLACEMENT, never `...baseCategory, score: ...` blended with the
  // original normalizedScore-derived value.
  assert.match(
    marketResearchCoverageSource,
    /function scoreCategory<T extends \{ score: number; maximumScore: number; reasoning: string\[\] \}>\(\s*\n\s*category: T,\s*\n\s*score: number,\s*\n\s*reasoning: string\[\]\s*\n\s*\): T \{\s*\n\s*return \{\s*\n\s*\.\.\.category,\s*\n\s*score: Math\.round\(\(clamp\(score\) \/ 100\) \* category\.maximumScore\),/
  );
});

// --- #69A-27 fixed the defects this audit found ------------------------
// --- (superseding the original "no #69A-26 marker" no-op-audit check) --

test("[UPDATED BY #69A-27/#69A-27B] production decision-logic files now carry #69A-27 fix markers that explicitly cite this audit (#69A-26) as their root-cause source -- the ORIGINAL audit itself still made no implementation changes on its own", () => {
  for (const source of [investmentScoreSource, financialAssumptionsSource]) {
    assert.match(source, /#69A-27\b/, "expected the #69A-27 fix to be present, citing this audit's own findings");
  }
  // decisionConfidence.ts was correctly left untouched by #69A-27 (see
  // #69A-27's own final report, item K) -- its #69A-26 findings were
  // structural observations, not defects requiring a code change.
  // market-research-coverage.ts was ALSO untouched by #69A-27 itself,
  // but #69A-27B (a distinct, later, separately-ticketed audit) found
  // and fixed a genuine, unrelated defect there (the "Founder evidence"
  // reasoning line silently substituting a general research-coverage
  // signal for the founder-specific score) -- so it now legitimately
  // carries a "#69A-27B" marker. The exclusion below only proves #69A-27
  // itself never touched either file; it does not claim market-research-
  // coverage.ts is untouched by every later ticket forever.
  assert.doesNotMatch(decisionConfidenceSource, /#69A-27\b/);
  assert.doesNotMatch(marketResearchCoverageSource, /#69A-27(?![A-Z])/);
});
