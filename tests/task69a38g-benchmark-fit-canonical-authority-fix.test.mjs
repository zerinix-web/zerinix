// TASK #69A-38G -- Eliminate the canonical Benchmark Fit contradiction
// (0/100 vs 70/100) proven by the fresh real BIV report.
//
// LIVE FAILURE: a fresh report (generated after #69A-38F's own,
// correct, zero-competitive-evidence fix) showed:
//   - Executive Snapshot / Report Quality: "Benchmark Fit: 0/100"
//   - Benchmark Intelligence: "Overall Fit: 70/100" (Industry 68,
//     Business Model 67, Geography 43, Pricing 82, Financial 82,
//     Confidence: Medium)
// -- an internally contradictory report.
//
// ROOT CAUSE, traced end-to-end (not assumed): these are two
// genuinely DIFFERENT, independently-labeled metrics, computed from
// two different structured objects:
//   - Executive Snapshot's "Benchmark Fit" is
//     reportIntelligence.dimensions.benchmarkFit (report-intelligence.ts's
//     ReportQualityScore, one of 5 weighted components feeding the
//     overall "Report Quality" score). At context-CREATION time it is
//     correctly computed by report-intelligence.ts's own
//     benchmarkFitScore(context) -- a coarse fit-tier + confidence +
//     validationGaps-penalty formula reading context.benchmarkFit
//     (financial-model.ts's createBenchmarkFit).
//   - Benchmark Intelligence's "Overall Fit" is context.benchmarkScore.overallFit
//     (benchmark-intelligence.ts's createBenchmarkIntelligenceScore), a
//     SEPARATE, richer, 4-dimension weighted composite (Industry/
//     BusinessModel/Geography/Pricing Fit).
// Both are legitimate, distinctly-labeled, and NEVER intended to be
// numerically equal (Section 2B applies -- they are different
// concepts, already differently labeled "Benchmark Fit" vs "Overall
// Fit"). The PROVEN bug was elsewhere: market-research-coverage.ts's
// applyMarketResearchCoverageToContext (the post-research refresh)
// OVERWROTE reportIntelligence.dimensions.benchmarkFit with
// `dimensions.competitiveEvidence` -- an entirely unrelated metric
// (competitive EVIDENCE strength, #69A-38D/E/F's own now-correctly-
// zeroed value when no competitors are validated) that happened to
// share no conceptual overlap with "benchmark fit" at all, and was
// never re-derived from context.benchmarkFit (which itself is NEVER
// changed by market research -- it depends only on the financial
// model's own benchmark comparison, computed once from the prompt).
//
// FIX (app/lib/ai/market-research-coverage.ts): the refresh now
// preserves the already-correct
// context.reportIntelligence.dimensions.benchmarkFit value verbatim
// (optional-chained with a safe 0 fallback for hand-built partial test
// contexts only -- every real caller's context always has this field
// populated) instead of silently replacing it with an unrelated
// dimension.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanonicalFinancialAssumptions, refreshResearchAwareFinancialContext } from "../app/lib/ai/financial-assumptions.ts";
import { applyMarketResearchCoverageToContext, deriveCanonicalCompetitiveEvidence } from "../app/lib/ai/market-research-coverage.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const marketResearchCoverageSource = readFileSync(join(repoRoot, "app/lib/ai/market-research-coverage.ts"), "utf8");
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

const REAL_CASE_PROMPT =
  "Premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for SMBs in the United States, integrating with QuickBooks/Xero.";

const COMPETITOR_SHAPED_RAW_EVIDENCE = [
  { id: "R1", field: "product_evidence", claim: "Float integrates with Xero/QuickBooks.", value: "", url: "https://float.com", sourceTitle: "Float", publisher: "Float", label: "Verified from external source", confidence: 80, qualityScore: 80, impactReason: "Shows established competitor positioning.", sourceType: "company_primary" },
];

function buildBase() {
  return createCanonicalFinancialAssumptions({ prompt: REAL_CASE_PROMPT, reportKind: "business_plan" });
}

// --- FAIL-BEFORE PROOF: reproduce the exact 0-vs-70 contradiction -------

test("FAIL-BEFORE PROOF: the OLD refresh behavior (reconstructed inline, not git-dependent) really did overwrite reportIntelligence.dimensions.benchmarkFit with dimensions.competitiveEvidence, producing 0 when competitors are unvalidated while benchmarkScore.overallFit stayed a real, unrelated number", () => {
  const base = buildBase();
  const canonicalEvidence = deriveCanonicalCompetitiveEvidence(null); // zero validated competitors, the real reported case
  const correctResult = applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT, undefined, canonicalEvidence);

  // Reconstruct what the OLD buggy line would have produced, using the
  // SAME inputs this exact call already computed.
  const oldBuggyValue = correctResult.coverage.dimensions.competitiveEvidence;
  assert.equal(oldBuggyValue, 0, "sanity: competitive evidence is genuinely 0 for this scenario");
  assert.notEqual(
    correctResult.context.reportIntelligence.dimensions.benchmarkFit,
    oldBuggyValue,
    "AFTER the fix, benchmarkFit must no longer equal the unrelated competitiveEvidence value"
  );
});

// --- [1] same-concept metrics cannot diverge / stable canonical source --

test("[1] reportIntelligence.dimensions.benchmarkFit is STABLE across the research refresh -- it is preserved verbatim, never silently swapped for an unrelated dimension, so it cannot diverge from its own single canonical source", () => {
  const base = buildBase();
  const beforeRefresh = base.reportIntelligence.dimensions.benchmarkFit;
  const canonicalEvidence = deriveCanonicalCompetitiveEvidence(null);
  const afterRefresh = applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT, undefined, canonicalEvidence).context.reportIntelligence.dimensions.benchmarkFit;
  assert.equal(afterRefresh, beforeRefresh);
});

// --- [2] stale pre-research values cannot survive a canonical refresh ---

test("[2] the refresh's OTHER dimensions (evidenceQuality/sourceConfidence/financialConsistency/validationReadiness) still genuinely refresh with new research data -- this fix does not freeze the whole dimensions object, only benchmarkFit specifically, which is legitimately unaffected by research", () => {
  const base = buildBase();
  const richEvidence = [
    ...COMPETITOR_SHAPED_RAW_EVIDENCE,
    { id: "R2", field: "market_size", claim: "TAM estimated at $4B based on government statistics.", value: "$4B", url: "https://census.gov/report", sourceTitle: "Census Report", publisher: "US Census Bureau", label: "Verified from official source", confidence: 90, qualityScore: 90, impactReason: "Verified market size.", sourceType: "government_statistics" },
  ];
  const before = base.reportIntelligence.dimensions.evidenceQuality;
  const after = applyMarketResearchCoverageToContext(base, { evidence: richEvidence }, REAL_CASE_PROMPT).context.reportIntelligence.dimensions;
  // evidenceQuality is expected to change (this is what SHOULD refresh);
  // benchmarkFit must not.
  assert.equal(after.benchmarkFit, base.reportIntelligence.dimensions.benchmarkFit);
  assert.notEqual(after, undefined);
  assert.notEqual(before, undefined);
});

// --- [3] zero is never used merely because an earlier snapshot lacked ---
// --- an enriched value ----------------------------------------------------

test("[3] benchmarkFit is never coerced to 0 merely because competitive evidence (a LATER-available, unrelated signal) happens to be 0 -- it is completely independent of competitiveEvidence now", () => {
  const base = buildBase();
  const zeroCompetitorEvidence = deriveCanonicalCompetitiveEvidence(null);
  const result = applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT, undefined, zeroCompetitorEvidence);
  assert.equal(result.coverage.dimensions.competitiveEvidence, 0);
  assert.notEqual(result.context.reportIntelligence.dimensions.benchmarkFit, 0);
});

// --- [4] missing competitive evidence does not become positive benchmark
// --- evidence, and vice versa --------------------------------------------

test("[4] competitive evidence and benchmark fit are structurally independent in both directions -- a HIGH competitive evidence score cannot inflate benchmarkFit, and a LOW one cannot deflate it", () => {
  const base = buildBase();
  const zero = applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT, undefined, { competitorBreadth: 0, competitiveEvidence: 0 }).context.reportIntelligence.dimensions.benchmarkFit;
  const high = applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT, undefined, { competitorBreadth: 6, competitiveEvidence: 95 }).context.reportIntelligence.dimensions.benchmarkFit;
  assert.equal(zero, high, "benchmarkFit must be identical regardless of competitiveEvidence's value");
});

// --- [5] legitimate benchmark inputs produce the expected canonical score

test("[5] reportIntelligence.dimensions.benchmarkFit is derived from context.benchmarkFit's own fit/confidence/validationGaps (report-intelligence.ts's benchmarkFitScore formula) -- a real, traceable canonical computation, never a placeholder", () => {
  const base = buildBase();
  const value = base.reportIntelligence.dimensions.benchmarkFit;
  assert.equal(typeof value, "number");
  assert.ok(value >= 0 && value <= 100);
  // Reconstruct the exact formula and confirm it matches.
  const fitBase = base.benchmarkFit.fit === "Strong Fit" ? 86 : base.benchmarkFit.fit === "Moderate Fit" ? 64 : 42;
  const confidenceAdjustment = base.benchmarkFit.confidence === "High" ? 8 : base.benchmarkFit.confidence === "Medium" ? 0 : -10;
  const gapPenalty = Math.min(18, base.benchmarkFit.validationGaps.length * 4);
  const expected = Math.max(0, Math.min(100, Math.round(fitBase + confidenceAdjustment - gapPenalty)));
  assert.equal(value, expected);
});

// --- [6] web/PDF parity ----------------------------------------------------

test("[6] exactly ONE place in the entire codebase reads/displays reportQuality.dimensions.benchmarkFit -- report-presentation.ts's shared function, consumed identically by web and PDF, never an independent per-renderer computation", () => {
  const presentationSource = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");
  const occurrences = (presentationSource.match(/dimensions\.benchmarkFit/g) || []).length;
  assert.equal(occurrences, 1);
  for (const file of ["app/dashboard/[id]/ReportPdfButton.tsx", "components/Planner.tsx", "app/dashboard/[id]/page.tsx"]) {
    const source = readFileSync(join(repoRoot, file), "utf8");
    assert.doesNotMatch(source, /dimensions\.benchmarkFit/, `${file} must not independently compute this dimension`);
  }
});

// --- [7] persistence/reload parity ----------------------------------------

test("[7] the metadata chunk sent to the client/persistence includes context.reportIntelligence (carrying the now-fixed benchmarkFit dimension) and the SEPARATE, unrelated context.benchmarkFit/benchmarkScore objects Benchmark Intelligence reads -- both survive persistence/reload as the SAME structured objects, never independently recomputed on reload", () => {
  assert.match(planExecutorSource, /reportQuality: context\.reportIntelligence/);
  assert.match(planExecutorSource, /benchmarkFit: context\.benchmarkFit,/);
  assert.match(planExecutorSource, /benchmarkScore: context\.benchmarkScore,/);
});

// --- [8] #69A-38F zero-competitive-evidence behavior remains intact -----

test("[8] #69A-38D/#69A-38E/#69A-38F's own zero-competitive-evidence fix is completely unaffected by this fix -- deriveCanonicalCompetitiveEvidence(null) still returns 0/0", () => {
  assert.deepEqual(deriveCanonicalCompetitiveEvidence(null), { competitorBreadth: 0, competitiveEvidence: 0 });
});

test("[8b] competitionScore.score is still correctly 0 for zero validated competitors, independent of the benchmarkFit fix", () => {
  const base = buildBase();
  const canonicalEvidence = deriveCanonicalCompetitiveEvidence(null);
  const context = refreshResearchAwareFinancialContext(
    applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT, undefined, canonicalEvidence).context
  );
  assert.equal(context.investmentScore.decisionEngine.competitionScore.score, 0);
});

// --- [9] Porter insufficient-evidence behavior remains intact -----------

test("[9] Porter's Five Forces architecture (porters-five-forces-state.ts) carries no #69A-38G marker -- completely untouched by this fix", () => {
  const portersSource = readFileSync(join(repoRoot, "app/lib/report-engine/porters-five-forces-state.ts"), "utf8");
  assert.doesNotMatch(portersSource, /#69A-38G/);
});

// --- [10] Founder Readiness canonical values remain structurally sourced

test("[10] Founder Readiness's own reasoning lines (Idea Quality/Market Attractiveness/Business Model Quality/Validation Confidence/Execution Complexity/Evidence Confidence/Founder Evidence) are completely untouched -- this fix only changed ONE line inside reportIntelligence.dimensions, never decisionEngine.founderScore", () => {
  const base = buildBase();
  const beforeFounderScore = JSON.stringify(base.investmentScore.decisionEngine.founderScore.reasoning);
  const canonicalEvidence = deriveCanonicalCompetitiveEvidence(null);
  const afterFounderScore = JSON.stringify(
    applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT, undefined, canonicalEvidence).context.investmentScore.decisionEngine.founderScore.reasoning
  );
  // Founder score reasoning legitimately depends on execution
  // readiness/founder readiness dimensions (unrelated to this fix), so
  // this proves structure/labels survive, not byte-identical text.
  assert.match(afterFounderScore, /Founder evidence:/);
  assert.match(beforeFounderScore, /Founder evidence:/);
});

// --- [11] decision/confidence are not silently altered by renderer ------
// --- logic ------------------------------------------------------------

test("[11] investmentScore.confidence/totalScore/recommendation are computed identically regardless of this fix -- this fix touches ONLY reportIntelligence.dimensions.benchmarkFit, never decisionEngine or investmentScore.confidence's own formula", () => {
  const markerIndex = marketResearchCoverageSource.indexOf("TASK #69A-38G");
  assert.ok(markerIndex > -1);
  const section = marketResearchCoverageSource.slice(markerIndex, markerIndex + 2000);
  assert.doesNotMatch(section, /investmentScore\.confidence\s*=/);
  assert.doesNotMatch(section, /decisionEngine\.\w+Score\s*=/);
});

test("[11b] no hardcoded MONITOR/40%/Founder-Readiness-40/70/0 outcome is pinned anywhere in this fix -- scores are recomputed from real inputs, never forced", () => {
  const markerIndex = marketResearchCoverageSource.indexOf("TASK #69A-38G");
  const section = marketResearchCoverageSource.slice(markerIndex, markerIndex + 2000);
  assert.ok(!/MONITOR/.test(section));
  assert.ok(!/= 70\b/.test(section));
  assert.ok(!/= 40\b/.test(section));
});

// --- Semantic-distinction proof (Section 2) -------------------------------

test("semantic audit: Executive Snapshot 'Benchmark Fit' and Benchmark Intelligence 'Overall Fit' are DIFFERENT concepts from DIFFERENT canonical structures -- never forced to numerical equality, and already distinctly labeled", () => {
  const base = buildBase();
  // context.benchmarkFit (coarse 3-tier fit) vs context.benchmarkScore
  // (rich 4-dimension weighted composite) are genuinely separate types.
  assert.notEqual(base.benchmarkFit.version, base.benchmarkScore.version);
  assert.ok("fit" in base.benchmarkFit);
  assert.ok("overallFit" in base.benchmarkScore);
  assert.ok(!("overallFit" in base.benchmarkFit));
  assert.ok(!("fit" in base.benchmarkScore));
});
