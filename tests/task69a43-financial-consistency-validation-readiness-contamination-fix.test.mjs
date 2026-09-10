// TASK #69A-43 -- Audit and resolve the unexpected canonical scoring
// shift after the recent BIV evidence/reload fixes.
//
// LIVE OBSERVATION: after #69A-39B/#69A-39C (which finally let real
// research execute end-to-end instead of replaying stale/empty/wrong-
// domain data), a fresh report's canonical scores shifted materially:
//   Financial Consistency: 26 -> 67
//   Confidence Radar Financial: 26 -> 67 (investmentScore.decisionEngine.financialScore.score)
//   Executive confidence: 48% -> 64%
//
// ROOT CAUSE (for Financial Consistency specifically -- PROVEN, not
// inferred): app/lib/ai/market-research-coverage.ts's
// applyMarketResearchCoverageToContext (the post-research refresh) was
// overwriting reportIntelligence.dimensions.financialConsistency with
// `dimensions.financialEvidence` -- how much EXTERNAL market/industry
// research evidence exists (Census/BLS/GAO-style macro data; #69A-40B's
// own investigation traced exactly this kind of evidence for this exact
// prompt) -- a completely unrelated concept from "Financial
// Consistency" (whether THIS business's OWN financial model -- ARPA,
// CAC, LTV, gross margin, burn, runway, investment need -- is
// internally coherent). Having many external sources about the
// industry does not validate this business's own CAC/LTV/burn
// assumptions. The SAME unaudited overwrite pattern also applied to
// `validationReadiness` (silently replaced by `dimensions.executionReadiness`,
// an unrelated business-model/capital/team signal). Both are the exact
// same bug class #69A-38G already fixed once for `benchmarkFit`
// (immediately adjacent in the same object literal) -- just never
// audited for these two sibling dimensions at the time.
//
// WHY THIS WAS NEVER VISIBLE BEFORE: before #69A-39B/#69A-39C, research
// for this exact prompt was either served from a stale, wrong-domain
// ("accounting") cache or fell through to the empty-JSON grounded
// fallback -- `dimensions.financialEvidence`/`executionReadiness` were
// both near-zero in that state, so the contamination's numeric effect
// was small and easy to miss. Once research genuinely started returning
// abundant real evidence, the SAME wrong mapping produced a large,
// clearly-wrong jump -- a pre-existing architectural defect made newly
// visible by an unrelated, correct fix, not a regression introduced by
// #69A-40/#69A-41/#69A-42 themselves (neither file was touched by any
// of those three tickets).
//
// WHAT WAS DETERMINED TO BE LEGITIMATE (left unchanged, verified
// below): investmentScore.confidence, decisionEngine.marketScore/
// competitionScore/financialScore, and reportIntelligence.totalScore/
// qualityScore/sourceConfidence are ALL intentional,
// historically-justified "research-aware" designs from earlier tickets
// ([UPDATED BY #69A-50] evidenceQuality was later found NOT to belong on
// this list -- see market-research-coverage.ts's own #69A-50 comment)
// (#69A-27's own comment: "5 of the 8 displayed categories AND
// investmentScore.confidence were already research-aware", by design;
// #69A-38F's own comment on competitionScore's deliberate competitive-
// evidence-strength semantics) -- changing them would contradict
// multiple established architectural decisions this ticket's own
// instructions explicitly protect ("preserve unrelated verified
// improvements... canonical MONITOR decision architecture"). Founder
// Readiness's own Validation Confidence (60->45) and Evidence
// Confidence (36->18) dimensions are computed by investment-score.ts
// purely from prompt-derived booleans and per-metric confidence
// averages (never from market-research-coverage.ts at all) and moved in
// the HONEST direction (lower, more conservative) once research
// stopped masking genuine validation gaps -- the opposite signature
// from contamination (which inflates), so no fix was made there.
//
// FIX (app/lib/ai/market-research-coverage.ts): financialConsistency and
// validationReadiness now preserve their already-correct,
// already-computed values (report-intelligence.ts's own
// createReportIntelligenceModel, derived from context.financialConsistency.quality
// and context.validationIntelligence respectively -- both confirmed
// untouched by this refresh) instead of being silently replaced by
// unrelated research-coverage dimensions. Mirrors #69A-38G's exact
// remediation pattern for benchmarkFit.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanonicalFinancialAssumptions,
} from "../app/lib/ai/financial-assumptions.ts";
import {
  applyMarketResearchCoverageToContext,
  deriveCanonicalCompetitiveEvidence,
} from "../app/lib/ai/market-research-coverage.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const marketResearchCoverageSource = readFileSync(
  join(repoRoot, "app/lib/ai/market-research-coverage.ts"),
  "utf8"
);

const REAL_CASE_PROMPT =
  "Premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for SMBs in the United States, integrating with QuickBooks/Xero.";

// Evidence shaped like the real live case: abundant, real, EXTERNAL
// market/industry research (government macro data, industry reports)
// but nothing that speaks to THIS business's own CAC/LTV/margin/burn
// assumptions being internally consistent.
const ABUNDANT_EXTERNAL_MARKET_EVIDENCE = [
  { id: "R1", field: "market_size", claim: "US SMB population and AI adoption trend.", value: "33M small businesses; 75% use AI regularly.", url: "https://advocacy.sba.gov/report", sourceTitle: "SBA Office of Advocacy", publisher: "U.S. Small Business Administration", label: "Verified from official source", confidence: 92, qualityScore: 90, impactReason: "Quantifies addressable SMB population.", sourceType: "government_statistics" },
  { id: "R2", field: "macro_inputs", claim: "US CPI and interest-rate data.", value: "CPI +3.4% YoY.", url: "https://bls.gov/cpi", sourceTitle: "Bureau of Labor Statistics", publisher: "U.S. Bureau of Labor Statistics", label: "Verified from official source", confidence: 90, qualityScore: 88, impactReason: "Macro inflation context.", sourceType: "government_statistics" },
  { id: "R3", field: "industry_structure", claim: "AI competitiveness policy landscape.", value: "GAO report on AI competitiveness.", url: "https://gao.gov/report", sourceTitle: "Government Accountability Office", publisher: "U.S. GAO", label: "Verified from official source", confidence: 88, qualityScore: 85, impactReason: "Regulatory context, not a financial validation of this business.", sourceType: "government_statistics" },
  { id: "R4", field: "product_evidence", claim: "Incumbent accounting platforms embed forecasting.", value: "QuickBooks/Xero built-in forecasting.", url: "https://quickbooks.intuit.com/help", sourceTitle: "Intuit QuickBooks Help Center", publisher: "Intuit QuickBooks", label: "Verified from official source", confidence: 85, qualityScore: 82, impactReason: "Market/competitive context.", sourceType: "official_company_report" },
];

function buildBase() {
  return createCanonicalFinancialAssumptions({ prompt: REAL_CASE_PROMPT, reportKind: "business_plan" });
}

// --- FAIL-BEFORE PROOF ----------------------------------------------------

test("FAIL-BEFORE PROOF: abundant EXTERNAL market/industry evidence (financialEvidence coverage) is genuinely high while this business's own financial-consistency check has nothing to do with it -- reproducing the exact live 26-vs-67-shaped contradiction", () => {
  const base = buildBase();
  const canonicalEvidence = deriveCanonicalCompetitiveEvidence(null);
  const result = applyMarketResearchCoverageToContext(
    base,
    { evidence: ABUNDANT_EXTERNAL_MARKET_EVIDENCE },
    REAL_CASE_PROMPT,
    undefined,
    canonicalEvidence
  );

  // Sanity: research coverage genuinely is abundant for this fixture
  // (proving the fixture reproduces the real live shape, not a
  // contrived edge case).
  assert.ok(
    result.coverage.dimensions.financialEvidence > 40,
    "sanity: financialEvidence coverage must be genuinely high for this fixture, matching the real live abundant-evidence case"
  );

  // AFTER the fix, financialConsistency must NOT equal the unrelated
  // financialEvidence coverage percentage.
  assert.notEqual(
    result.context.reportIntelligence.dimensions.financialConsistency,
    result.coverage.dimensions.financialEvidence,
    "financialConsistency must never equal the unrelated external-evidence-coverage percentage"
  );
});

// --- research coverage cannot masquerade as financial validation -------

test("1. research coverage cannot masquerade as financial validation: financialConsistency is STABLE across the refresh regardless of how much external market evidence exists", () => {
  const base = buildBase();
  const beforeRefresh = base.reportIntelligence.dimensions.financialConsistency;
  const sparse = applyMarketResearchCoverageToContext(base, { evidence: [] }, REAL_CASE_PROMPT).context.reportIntelligence.dimensions.financialConsistency;
  const abundant = applyMarketResearchCoverageToContext(base, { evidence: ABUNDANT_EXTERNAL_MARKET_EVIDENCE }, REAL_CASE_PROMPT).context.reportIntelligence.dimensions.financialConsistency;

  assert.equal(sparse, beforeRefresh);
  assert.equal(abundant, beforeRefresh);
  assert.equal(sparse, abundant, "financialConsistency must be identical whether external evidence is sparse or abundant");
});

test("2. financialConsistency is derived from context.financialConsistency.quality (this business's own internal-coherence check), never from research-coverage dimensions", () => {
  const base = buildBase();
  const dimensions = applyMarketResearchCoverageToContext(base, { evidence: ABUNDANT_EXTERNAL_MARKET_EVIDENCE }, REAL_CASE_PROMPT).context.reportIntelligence.dimensions;
  assert.equal(dimensions.financialConsistency, base.reportIntelligence.dimensions.financialConsistency);
  assert.ok([34, 58, 86].includes(dimensions.financialConsistency), "must be one of report-intelligence.ts's own three quality-tier values (Poor/Needs Validation/Healthy), never an evidence-coverage percentage");
});

// --- market evidence cannot masquerade as validation readiness ---------

test("3. validationReadiness is STABLE across the refresh -- never silently replaced by the unrelated executionReadiness coverage dimension", () => {
  const base = buildBase();
  const beforeRefresh = base.reportIntelligence.dimensions.validationReadiness;
  const afterRefresh = applyMarketResearchCoverageToContext(base, { evidence: ABUNDANT_EXTERNAL_MARKET_EVIDENCE }, REAL_CASE_PROMPT).context.reportIntelligence.dimensions.validationReadiness;
  assert.equal(afterRefresh, beforeRefresh);
});

test("4. validationReadiness and executionReadiness remain structurally independent -- a high execution-readiness coverage score cannot inflate validationReadiness", () => {
  const base = buildBase();
  const result = applyMarketResearchCoverageToContext(base, { evidence: ABUNDANT_EXTERNAL_MARKET_EVIDENCE }, REAL_CASE_PROMPT);
  assert.notEqual(
    result.context.reportIntelligence.dimensions.validationReadiness,
    result.coverage.dimensions.executionReadiness
  );
});

// --- external sources alone cannot prove WTP/CAC/retention --------------

test("5. external market/industry sources with zero business-specific validation signal still leave financialConsistency/validationReadiness at their prompt-derived baseline, never inflated by source volume alone", () => {
  const base = buildBase();
  const manyGenericSources = Array.from({ length: 20 }, (_, i) => ({
    id: `R${i}`,
    field: "market_size",
    claim: "Generic market-size statistic.",
    value: "Generic value.",
    url: `https://example-authority-${i}.gov/report`,
    sourceTitle: `Authority Source ${i}`,
    publisher: `Authority ${i}`,
    label: "Verified from official source",
    confidence: 90,
    qualityScore: 90,
    impactReason: "Generic market context, not WTP/CAC/retention evidence.",
    sourceType: "government_statistics",
  }));
  const result = applyMarketResearchCoverageToContext(base, { evidence: manyGenericSources }, REAL_CASE_PROMPT);
  assert.equal(
    result.context.reportIntelligence.dimensions.financialConsistency,
    base.reportIntelligence.dimensions.financialConsistency,
    "20 generic external sources must not move financialConsistency at all"
  );
  assert.equal(
    result.context.reportIntelligence.dimensions.validationReadiness,
    base.reportIntelligence.dimensions.validationReadiness,
    "20 generic external sources must not move validationReadiness at all"
  );
});

// --- final scores use the final intended evidence snapshot -------------

test("6. [UPDATED BY #69A-50] sourceConfidence remains the refresh's own genuinely research-aware dimension -- this fix (financialConsistency/validationReadiness/benchmarkFit) never froze the whole dimensions object", () => {
  const base = buildBase();
  const before = base.reportIntelligence.dimensions.sourceConfidence;
  const after = applyMarketResearchCoverageToContext(base, { evidence: ABUNDANT_EXTERNAL_MARKET_EVIDENCE }, REAL_CASE_PROMPT).context.reportIntelligence.dimensions.sourceConfidence;
  assert.notEqual(after, before, "sourceConfidence is expected to refresh with new research -- unlike financialConsistency/validationReadiness/evidenceQuality, it is legitimately research-derived");
});

test("6b. [UPDATED BY #69A-50] evidenceQuality (Data Completeness) no longer changes with new external research -- #69A-50 found and fixed the exact same contamination class this ticket's own fix already established for financialConsistency/validationReadiness/benchmarkFit", () => {
  const base = buildBase();
  const before = base.reportIntelligence.dimensions.evidenceQuality;
  const after = applyMarketResearchCoverageToContext(base, { evidence: ABUNDANT_EXTERNAL_MARKET_EVIDENCE }, REAL_CASE_PROMPT).context.reportIntelligence.dimensions.evidenceQuality;
  assert.equal(after, before, "evidenceQuality (Data Completeness) must not move merely because external market research changed -- see #69A-50's own fix");
});

// --- determinism ----------------------------------------------------------

test("7. deterministic repeated scoring: the SAME structured fixture run twice produces byte-identical financialConsistency/validationReadiness with no new research/model calls", () => {
  const base = buildBase();
  const first = applyMarketResearchCoverageToContext(base, { evidence: ABUNDANT_EXTERNAL_MARKET_EVIDENCE }, REAL_CASE_PROMPT);
  const second = applyMarketResearchCoverageToContext(base, { evidence: ABUNDANT_EXTERNAL_MARKET_EVIDENCE }, REAL_CASE_PROMPT);
  assert.equal(
    first.context.reportIntelligence.dimensions.financialConsistency,
    second.context.reportIntelligence.dimensions.financialConsistency
  );
  assert.equal(
    first.context.reportIntelligence.dimensions.validationReadiness,
    second.context.reportIntelligence.dimensions.validationReadiness
  );
  assert.deepEqual(first.context.reportIntelligence.dimensions, second.context.reportIntelligence.dimensions);
});

// --- persistence/reload preserves scores exactly -------------------------

test("8. financialConsistency/validationReadiness survive a full JSON persistence round trip (simulating reports.metadata JSONB) unchanged", () => {
  const base = buildBase();
  const result = applyMarketResearchCoverageToContext(base, { evidence: ABUNDANT_EXTERNAL_MARKET_EVIDENCE }, REAL_CASE_PROMPT);
  const roundTripped = JSON.parse(JSON.stringify(result.context.reportIntelligence.dimensions));
  assert.equal(roundTripped.financialConsistency, result.context.reportIntelligence.dimensions.financialConsistency);
  assert.equal(roundTripped.validationReadiness, result.context.reportIntelligence.dimensions.validationReadiness);
});

// --- web/PDF parity (structural: both read the SAME canonical field) ----

test("9. web and PDF both read reportQuality.dimensions.financialConsistency from the SAME shared report-presentation.ts helper -- no independent per-renderer recomputation", () => {
  const reportPresentationSource = readFileSync(
    join(repoRoot, "app/lib/report-presentation.ts"),
    "utf8"
  );
  assert.match(
    reportPresentationSource,
    /\{ label: labels\.financialConsistency, value: `\$\{reportQuality\.dimensions\.financialConsistency\}\/100` \}/
  );
});

// --- SAFETY: decision architecture / historically-justified research-
//     aware fields are completely untouched ------------------------------

test("SAFETY: decisionEngine.marketScore/competitionScore/financialScore and investmentScore.confidence (all historically-justified, intentional research-aware designs) are completely untouched by this fix -- still assigned exactly as before", () => {
  assert.match(marketResearchCoverageSource, /confidence: coverage\.overallConfidence,/);
  assert.match(marketResearchCoverageSource, /marketScore,\s*\n\s*competitionScore,\s*\n\s*financialScore,\s*\n\s*executionScore,\s*\n\s*founderScore,/);
});

test("SAFETY: totalScore/qualityScore/overallQuality/confidenceLevel (also historically research-aware) are completely untouched by this fix", () => {
  assert.match(marketResearchCoverageSource, /totalScore: coverage\.overallConfidence,/);
  assert.match(marketResearchCoverageSource, /qualityScore: coverage\.overallConfidence,/);
});

test("[UPDATED BY #69A-50] SAFETY: sourceConfidence (a genuinely research-aware dimension) is completely untouched by this fix -- evidenceQuality was later found by #69A-50 to need the SAME preservation this fix already gave financialConsistency/validationReadiness/benchmarkFit, and is no longer sourced from dimensions.marketConfidence", () => {
  assert.match(
    marketResearchCoverageSource,
    /sourceConfidence: clamp\(\s*\n\s*coverage\.averageQuality \* 0\.55 \+\s*\n\s*Math\.min\(coverage\.independentDomains, 6\) \* 7\.5\s*\n\s*\),/
  );
  assert.doesNotMatch(marketResearchCoverageSource, /evidenceQuality: dimensions\.marketConfidence,/);
});

test("SAFETY: no canonical decision (createRecommendation/applyFatalBlockerOverride), competitor-evidence, Porter, or founder-readiness-dimension file carries a #69A-43 marker -- this is a report-quality-dimension fix only, never touching decisionEngine/totalScore/recommendation", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "components/Planner.tsx",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-43/, `${relativePath} must not carry a #69A-43 marker`);
  }
});

test("SAFETY: plan-executor.ts's own #69A-43 marker is confined to the cache-invalidation version bump (mirroring #69A-40A/#69A-41's identical precedent) -- it never touches decisionEngine/totalScore/recommendation logic", () => {
  const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
  // TASK #69A-44 bumped the same constant again (v10 -> v11) for its own,
  // separate cache-invalidation reason -- assert the version is past v10
  // (never reverted below it) rather than pinning the exact current
  // suffix, so this test doesn't need editing every time the constant is
  // bumped again for an unrelated future fix.
  const match = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "ltv-cac-ratio-integrity-v(\d+)";/.exec(planExecutorSource);
  assert.ok(match, "BUSINESS_PLAN_GENERATION_CONTRACT_VERSION declaration not found");
  assert.ok(Number(match[1]) >= 10, "version must be at v10 or later -- #69A-43's own bump must not have been reverted");
  const markerCount = (planExecutorSource.match(/TASK #69A-43/g) || []).length;
  assert.equal(markerCount, 1, "expected exactly one #69A-43 marker, at the version-bump comment only");
});
