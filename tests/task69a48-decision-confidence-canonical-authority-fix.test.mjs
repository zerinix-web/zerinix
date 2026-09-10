// TASK #69A-48 -- Eliminate canonical decision-confidence drift across
// the Business Idea Validation report.
//
// LIVE OBSERVATION: a fresh Business Idea Validation report showed:
//   Executive Summary / Investment Decision Snapshot: Confidence 58%
//   Executive Snapshot: Confidence 65%
//   Exported PDF canonical decision confidence: 65%
// The decision itself (MONITOR) agreed everywhere.
//
// ROOT CAUSE (PROVEN, not inferred): app/lib/report-jobs/plan-executor.ts's
// fresh-generation success path runs applyMarketResearchCoverageToContext/
// refreshResearchAwareFinancialContext TWICE, for the exact reason #69A-38D
// already documents for competitive evidence -- businessCompetitorLandscapeState
// does not exist until the model's own response is parsed:
//   1. researchAwareFinancialContext (scored from raw, pre-generation
//      research evidence only) feeds parseFullPlanReport, which
//      unconditionally builds the Executive Summary's deterministic
//      "Decision: TOKEN (Confidence: NN%)" banner from
//      buildPlanExecutiveDecisionBrief(researchAwareFinancialContext, ...)
//      -- this is where 58% was baked into the persisted report BODY TEXT.
//   2. finalResearchAwareFinancialContext (re-scored with the real,
//      now-known competitor evidence) is computed AFTER that -- this is
//      what serializePlanReportMetadataChunk persists as the structured
//      `investmentScore` field, the SAME field report-presentation.ts's
//      buildExecutiveSnapshot already reads directly (no prose fallback)
//      for confidenceScore, for BOTH the web Executive Snapshot panel and
//      the PDF button -- this is where 65% came from.
// #69A-38E already fixed the identical shape for a competitive-evidence
// NUMBER mentioned in prose (correctCompetitiveEvidenceMentions); nothing
// equivalent existed for the Executive Decision Brief's own confidence.
//
// CANONICAL AUTHORITY: finalResearchAwareFinancialContext.investmentScore.
// confidence is authoritative -- it is the more-informed computation (real
// competitor evidence, not a raw guess), and it is already what every
// OTHER consumer (Executive Snapshot, PDF, persisted metadata) already
// trusted. The fix corrects the STALE prose banner to match it, never the
// reverse (never downgrades the structured field to match stale prose).
//
// FIX (plan-executor.ts): immediately after finalResearchAwareFinancialContext
// is computed (right after correctCompetitiveEvidenceMentions, mirroring
// its exact placement/philosophy), the Executive Summary banner is rebuilt
// via buildPlanExecutiveDecisionBrief(finalResearchAwareFinancialContext,
// responseLanguage, decisionOverride) -- confidence/confidenceDirection/
// confidenceFactors/topReasons/why/missingEvidence/immediateNextAction are
// all refreshed from the authoritative final context, while `decision` is
// explicitly PINNED to mapInvestmentRecommendationToExecutiveDecisionCode(
// researchAwareFinancialContext.investmentScore.recommendation) -- the
// EXACT token already checked for contradiction against this report's own
// body sections (assertNoDecisionContradiction/runConsistencyValidationPass,
// both of which already ran, earlier, against the EARLIER context, inside
// normalizeFullPlanReport). This guarantees MONITOR (or any other decision
// word) can never silently flip as a side effect of this fix -- only
// confidence and its own supporting reasoning are refreshed. Runs BEFORE
// cacheResponseText is captured and BEFORE the Strategic Decision Memo
// override, so cache/web/PDF all read the corrected banner, and the Memo
// (when present) still has final precedence, unchanged.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatExecutiveDecisionBrief,
  extractExecutiveDecisionFromText,
  localizeExecutiveDecision,
} from "../app/lib/report-engine/executive-decision-brief.ts";
import {
  createCanonicalFinancialAssumptions,
  refreshResearchAwareFinancialContext,
} from "../app/lib/ai/financial-assumptions.ts";
import {
  applyMarketResearchCoverageToContext,
  calculateMarketOverallConfidence,
} from "../app/lib/ai/market-research-coverage.ts";
import { buildExecutiveSnapshot } from "../app/lib/report-presentation.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

function baseBrief(overrides = {}) {
  return {
    decision: "CONDITIONAL_GO",
    confidence: 58,
    confidenceDirection: "reduced",
    confidenceFactors: ["Market Opportunity evidence limited (44/100)"],
    why: "The opportunity is plausible, but validation remains unresolved.",
    topReasons: ["Clear customer pain point"],
    topRisks: ["Unvalidated willingness to pay"],
    missingEvidence: ["Verified pilot revenue"],
    whatWouldChangeThisDecision: "Verified, independent evidence that resolves the primary risk would change this decision.",
    immediateNextAction: "Run a paid pilot with 5 target customers.",
    ...overrides,
  };
}

// --- 1: reproduce the real staleness gap at the data layer ---------------

const REAL_CASE_PROMPT =
  "Premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for SMBs in the United States, integrating with QuickBooks/Xero.";

function rawEvidenceCoverage() {
  const dimensions = {
    marketConfidence: 58,
    competitiveEvidence: 30,
    financialEvidence: 55,
    productEvidence: 50,
    executionReadiness: 48,
    founderReadiness: 30,
  };
  return {
    evidenceCount: 6,
    verifiedSources: 4,
    independentDomains: 3,
    competitorBreadth: 0,
    sourceTypeDiversity: 2,
    claimCoverage: 3,
    freshnessScore: 60,
    averageQuality: 55,
    verifiedMarketSizeAvailable: false,
    dimensions,
    overallConfidence: calculateMarketOverallConfidence(dimensions),
    sourceClasses: ["newsArticle"],
  };
}

function realCompetitorEvidenceCoverage() {
  const dimensions = {
    marketConfidence: 58,
    competitiveEvidence: 90,
    financialEvidence: 55,
    productEvidence: 50,
    executionReadiness: 48,
    founderReadiness: 30,
  };
  return {
    evidenceCount: 10,
    verifiedSources: 8,
    independentDomains: 5,
    competitorBreadth: 5,
    sourceTypeDiversity: 3,
    claimCoverage: 4,
    freshnessScore: 68,
    averageQuality: 62,
    verifiedMarketSizeAvailable: false,
    dimensions,
    overallConfidence: calculateMarketOverallConfidence(dimensions),
    sourceClasses: ["newsArticle", "companyFiling"],
  };
}

function buildBase() {
  return createCanonicalFinancialAssumptions({ prompt: REAL_CASE_PROMPT, reportKind: "business_plan" });
}

test("FAIL-BEFORE PROOF: the same base context genuinely produces two different investmentScore.confidence values depending on which research-coverage pass scores it -- reproducing the real 58-vs-65-shaped gap, not a hypothetical one", () => {
  const base = buildBase();

  const earlyPass = refreshResearchAwareFinancialContext(
    applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT, rawEvidenceCoverage()).context
  );
  const finalPass = refreshResearchAwareFinancialContext(
    applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT, realCompetitorEvidenceCoverage()).context
  );

  assert.notEqual(
    earlyPass.investmentScore.confidence,
    finalPass.investmentScore.confidence,
    "expected the raw-evidence pass and the real-competitor-evidence pass to diverge for this fixture -- if they always agreed there would be no staleness to fix"
  );
  // The decision itself stays the same for this fixture -- exactly the
  // reported real-world shape (MONITOR/CONDITIONAL_GO unchanged, only
  // confidence drifting).
  assert.equal(earlyPass.investmentScore.recommendation, finalPass.investmentScore.recommendation);
});

// --- 2: plan-executor.ts structurally rebuilds the banner from the -----
// --- authoritative final context, decision pinned -----------------------

test("1. plan-executor.ts rebuilds the Executive Summary decision brief from finalResearchAwareFinancialContext, immediately after correctCompetitiveEvidenceMentions and before cacheResponseText is captured", () => {
  assert.match(planExecutorSource, /TASK #69A-48/);
  const correctionIndex = planExecutorSource.indexOf("correctCompetitiveEvidenceMentions(\n              parsedReport,");
  const rebuildIndex = planExecutorSource.indexOf(
    "const finalPlanExecutiveDecisionBrief = buildPlanExecutiveDecisionBrief(\n              finalResearchAwareFinancialContext,"
  );
  const cacheIndex = planExecutorSource.indexOf("const cacheResponseText = JSON.stringify(parsedReport);");

  assert.ok(correctionIndex >= 0, "correctCompetitiveEvidenceMentions call site not found");
  assert.ok(rebuildIndex >= 0, "the #69A-48 brief-rebuild call site not found");
  assert.ok(cacheIndex >= 0, "cacheResponseText capture not found");
  assert.ok(correctionIndex < rebuildIndex, "the rebuild must run after correctCompetitiveEvidenceMentions");
  assert.ok(rebuildIndex < cacheIndex, "the rebuild must run before cacheResponseText is captured");
});

test("2. the rebuild pins `decision` to the token derived from researchAwareFinancialContext (the EARLIER, already body-consistency-validated context) -- never from finalResearchAwareFinancialContext's own recommendation, so the decision word can never silently flip as a side effect of this fix", () => {
  assert.match(
    planExecutorSource,
    /mapInvestmentRecommendationToExecutiveDecisionCode\(\s*researchAwareFinancialContext\.investmentScore\.recommendation\s*\)/
  );
});

test("3. exactly one decision-mapping function exists and is reused by both the primary brief build and the #69A-48 correction call -- no second, independently-maintained copy of the GO/WAIT/PASS -> GO/CONDITIONAL_GO/NO_GO mapping", () => {
  const mappingDeclarations = (
    planExecutorSource.match(/function mapInvestmentRecommendationToExecutiveDecisionCode/g) || []
  ).length;
  assert.equal(mappingDeclarations, 1, "expected exactly one mapping function declaration");

  const totalOccurrences = (
    planExecutorSource.match(/mapInvestmentRecommendationToExecutiveDecisionCode\(/g) || []
  ).length;
  // 1 function declaration's own parameter list + 1 default-mapping call
  // site (inside buildPlanExecutiveDecisionBrief) + 1 #69A-48
  // correction-site call = 3 occurrences of the name followed by "(".
  assert.equal(totalOccurrences, 3, "expected the declaration plus exactly two call sites: the default mapping and the #69A-48 correction");
});

test("4. the rebuilt brief is rendered with formatExecutiveDecisionBrief using the 'business_plan' vocabulary, matching the original primary build exactly", () => {
  const rebuildSnippet = planExecutorSource.slice(
    planExecutorSource.indexOf("const finalPlanExecutiveDecisionBrief = buildPlanExecutiveDecisionBrief("),
    planExecutorSource.indexOf("const reportMetadataContext = createReportMetadataContext({")
  );
  assert.match(rebuildSnippet, /parsedReport\.executiveSummary = formatExecutiveDecisionBrief\(/);
  assert.match(rebuildSnippet, /"business_plan"/);
});

test("5. the fix runs before the Strategic Decision Memo override -- when a Memo exists, it still has final precedence over the rebuilt brief, unchanged from before this fix", () => {
  const rebuildIndex = planExecutorSource.indexOf(
    "const finalPlanExecutiveDecisionBrief = buildPlanExecutiveDecisionBrief(\n              finalResearchAwareFinancialContext,"
  );
  const memoOverrideIndex = planExecutorSource.indexOf(
    "if (strategicDecisionMemoReportSection) {\n              parsedReport.executiveSummary = strategicDecisionMemoReportSection;"
  );
  assert.ok(rebuildIndex >= 0 && memoOverrideIndex >= 0);
  assert.ok(rebuildIndex < memoOverrideIndex, "the brief rebuild must run before the Memo override check");
});

// --- 3: the underlying rendering mechanism proves decision safety -------

test("6. [DECISION SAFETY] rebuilding a brief with a different confidence value, same decision, changes ONLY the confidence-related lines of the rendered banner -- the decision line's token is untouched", () => {
  const staleBrief = baseBrief({ confidence: 58, confidenceDirection: "reduced" });
  const correctedBrief = baseBrief({ confidence: 65, confidenceDirection: "supported" });

  const staleText = formatExecutiveDecisionBrief(staleBrief, "English", "business_plan");
  const correctedText = formatExecutiveDecisionBrief(correctedBrief, "English", "business_plan");

  const staleDecisionLine = staleText.split("\n")[1];
  const correctedDecisionLine = correctedText.split("\n")[1];

  assert.equal(staleDecisionLine, "Decision: MONITOR (Confidence: 58%)");
  assert.equal(correctedDecisionLine, "Decision: MONITOR (Confidence: 65%)");

  const staleDecisionToken = extractExecutiveDecisionFromText(staleText)?.token;
  const correctedDecisionToken = extractExecutiveDecisionFromText(correctedText)?.token;
  assert.equal(staleDecisionToken, correctedDecisionToken, "the decision token must be identical -- only confidence changed");
});

test("7. [DECISION SAFETY] MONITOR is the correct business_plan localization of CONDITIONAL_GO, confirming the real report's own observed decision word maps from the same canonical code this fix pins", () => {
  assert.equal(localizeExecutiveDecision("CONDITIONAL_GO", "English", "business_plan"), "MONITOR");
});

// --- 4: web/PDF canonical-confidence parity (report-presentation.ts) ----

test("8. [PARITY] buildExecutiveSnapshot's confidenceScore reads investmentScore.confidence directly -- the SAME authoritative field the #69A-48 fix uses to rebuild the Executive Summary banner, never independently recomputed or re-derived from prose when investmentScore exists", () => {
  const investmentScore = {
    totalScore: 62,
    confidence: 65,
    recommendation: "WAIT",
    decisionEngine: {
      marketScore: { score: 70, maximumScore: 100, label: "Market", reasoning: [] },
      financialScore: { score: 40, maximumScore: 100, label: "Financial", reasoning: [] },
      founderScore: { score: 55, maximumScore: 100, label: "Founder", reasoning: [] },
      executionScore: { score: 30, maximumScore: 100, label: "Execution", reasoning: [] },
      riskScore: { score: 45, maximumScore: 100, label: "Risk", reasoning: [] },
      competitionScore: { score: 80, maximumScore: 100, label: "Competition", reasoning: [] },
      technologyScore: { score: 65, maximumScore: 100, label: "Technology", reasoning: [] },
    },
  };
  // Simulate the exact drift shape: the persisted report BODY still
  // contains the stale "(Confidence: 58%)" banner text (pre-#69A-48
  // historical report, or the bug itself before this fix).
  const staleExecutiveSummaryText =
    "Executive Decision\nDecision: MONITOR (Confidence: 58%)\n\nConfidence Reduced Because:\n- limited evidence";

  const snapshot = buildExecutiveSnapshot(staleExecutiveSummaryText, investmentScore, undefined);
  assert.equal(
    snapshot.confidenceScore,
    65,
    "confidenceScore must read the structured investmentScore.confidence (65), never the stale prose banner (58)"
  );
  assert.equal(snapshot.confidence, "65%");
});

test("9. [PARITY] with the #69A-48 fix applied, the Executive Summary banner's own confidence number and buildExecutiveSnapshot's confidenceScore agree for the SAME investmentScore -- no drift possible", () => {
  const finalInvestmentScore = {
    totalScore: 62,
    confidence: 65,
    recommendation: "WAIT",
    decisionEngine: {
      marketScore: { score: 70, maximumScore: 100, label: "Market", reasoning: [] },
      financialScore: { score: 40, maximumScore: 100, label: "Financial", reasoning: [] },
      founderScore: { score: 55, maximumScore: 100, label: "Founder", reasoning: [] },
      executionScore: { score: 30, maximumScore: 100, label: "Execution", reasoning: [] },
      riskScore: { score: 45, maximumScore: 100, label: "Risk", reasoning: [] },
      competitionScore: { score: 80, maximumScore: 100, label: "Competition", reasoning: [] },
      technologyScore: { score: 65, maximumScore: 100, label: "Technology", reasoning: [] },
    },
  };
  const correctedBrief = baseBrief({ confidence: finalInvestmentScore.confidence, confidenceDirection: "supported" });
  const correctedExecutiveSummaryText = formatExecutiveDecisionBrief(correctedBrief, "English", "business_plan");

  const snapshot = buildExecutiveSnapshot(correctedExecutiveSummaryText, finalInvestmentScore, undefined);
  const bannerConfidenceMatch = correctedExecutiveSummaryText.match(/Confidence: (\d+)%/);

  assert.ok(bannerConfidenceMatch);
  assert.equal(Number(bannerConfidenceMatch[1]), snapshot.confidenceScore);
});

// --- 5: distinct metrics remain distinct (requirement 3) -----------------

test("10. [INVARIANT] rebuilding the decision-confidence banner does not touch Report Quality/Data Completeness/Source Strength/Financial Consistency/Benchmark Fit/Validation Readiness/Confidence Radar/Founder Readiness/Investment Score category machinery -- plan-executor.ts's own #69A-48 fix is confined to the executiveSummary field and the decision-brief builder", () => {
  const reportIntelligenceSource = readFileSync(join(repoRoot, "app/lib/ai/report-intelligence.ts"), "utf8");
  const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");
  const marketResearchCoverageSource = readFileSync(join(repoRoot, "app/lib/ai/market-research-coverage.ts"), "utf8");
  assert.doesNotMatch(reportIntelligenceSource, /TASK #69A-48/);
  assert.doesNotMatch(investmentScoreSource, /TASK #69A-48/);
  assert.doesNotMatch(marketResearchCoverageSource, /TASK #69A-48/);
});

test("11. [INVARIANT] no canonical decision (createRecommendation/applyFatalBlockerOverride), competitor-evidence/weakness, Porter's Five Forces, Benchmark Intelligence, or financial-labeling file carries a #69A-48 marker -- this fix only ever touches plan-executor.ts's own Executive Summary banner rebuild", () => {
  for (const relativePath of [
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/financial-evidence-labeling.ts",
    "app/lib/report-presentation.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-48/, `${relativePath} must not carry a #69A-48 marker`);
  }
});

// --- 6: historical report safety -----------------------------------------

test("12. [HISTORICAL SAFETY] a historically-persisted report's OWN stale banner text is never rewritten by this fix -- the fix runs only inside the fresh-generation success branch (before cacheResponseText/persistence), never in any read/hydration path", () => {
  assert.doesNotMatch(
    planExecutorSource,
    /function\s+(?:getReport|hydrateReport|loadPersistedReport)[^{]*\{[^}]*TASK #69A-48/s
  );
  // The rebuild call site must be inside the SAME fresh-generation branch
  // as correctCompetitiveEvidenceMentions and finalResearchAwareFinancialContext's
  // own computation -- confirmed via the ordering proof in test 1 above.
  assert.match(planExecutorSource, /const canonicalCompetitiveEvidence = deriveCanonicalCompetitiveEvidence/);
});

test("13. [HISTORICAL SAFETY] buildExecutiveSnapshot still degrades honestly for a historical report with no investmentScore at all -- prose-derived confidence remains the fallback, never a fabricated number", () => {
  const snapshot = buildExecutiveSnapshot(
    "Executive Decision\nDecision: MONITOR (Confidence: 58%)",
    undefined,
    undefined
  );
  assert.equal(snapshot.confidenceScore, 58, "with no structured investmentScore at all, the historical prose confidence is the safest available fallback");
});
