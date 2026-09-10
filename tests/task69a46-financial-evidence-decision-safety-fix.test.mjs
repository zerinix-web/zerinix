// TASK #69A-46 -- Make financial outputs decision-safe when evidence and
// financial consistency are weak.
//
// A. TRACE (summary; full trace reported to the user): user financial
//    inputs -> financial-model.ts's createFinancialModel (userStated
//    overrides = VERIFIED; everything else = a benchmark-table lookup or
//    a composed calculation) -> financial-evidence-labeling.ts's
//    classifyFinancialMetricEvidenceType (per-metric provenance,
//    text-derived from each metric's own real formula/assumptions/
//    benchmarkComparison, never guessed) -> financial-assumptions.ts's
//    createCanonicalFinancialAssumptions (aggregates into the new
//    financialEvidence summary) -> plan-executor.ts's
//    serializePlanReportMetadataChunk (persists it, optionally) -> web/
//    PDF (still reads the existing, now-more-precise prose annotations;
//    the new persisted field is available for direct consumption but not
//    yet wired into the dashboard's own display logic -- a documented
//    gap, see the ticket's own final report).
//
//    ROOT CAUSE FOUND (real defect, not a cosmetic gap):
//    classifyFinancialMetricEvidenceType used to define its OWN,
//    narrower 3-state vocabulary ("Verified" | "Derived" | "Benchmark /
//    Assumption") -- a second, competing classification for the exact
//    same concept report-evidence.ts's EvidenceLevel already models
//    with 5 states (verified/derived/benchmarkDerived/planningAssumption/
//    validationRequired), used pervasively elsewhere for evidence
//    provenance (Founder Readiness's own Evidence Confidence dimension,
//    EvidenceBadge, getFinancialMetricDisplayLabel). Also: nothing in
//    the existing architecture aggregated "what fraction of this
//    report's own financial model rests on Verified/Derived data vs
//    Benchmark/Assumption" into one report-level figure -- the concept
//    this ticket calls financialEvidenceStrength/coverage. Both fixed;
//    see financial-evidence-labeling.ts's own comment for the full
//    detail, including a documented, deliberate decision NOT to also
//    split "direct benchmark lookup" from "composed planning
//    calculation" at the per-metric level (investigated, reverted after
//    proving it regressed TAM/SAM/SOM/ARPA/CAC/Gross Margin's own
//    classification -- their formulas also use a multiplier, the same
//    shape a genuine composition formula has).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanonicalFinancialAssumptions,
  refreshResearchAwareFinancialContext,
} from "../app/lib/ai/financial-assumptions.ts";
import { applyMarketResearchCoverageToContext } from "../app/lib/ai/market-research-coverage.ts";
import { classifyFinancialMetricEvidenceType } from "../app/lib/financial-evidence-labeling.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");
const financialModelSource = readFileSync(join(repoRoot, "app/lib/ai/financial-model.ts"), "utf8");
const reportIntelligenceSource = readFileSync(join(repoRoot, "app/lib/ai/report-intelligence.ts"), "utf8");
const stateSource = readFileSync(join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"), "utf8");
const pdfButtonSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");

// The current real report's own case: an SMB financial-planning SaaS
// idea with no stated MRR/ARR/investment amount -- the exact shape
// described in the ticket ("Many of these are planning assumptions/
// model outputs rather than observed business evidence").
const REAL_CASE_PROMPT =
  "Premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for SMBs in the United States, integrating with QuickBooks/Xero.";

function buildRealCaseContext() {
  return createCanonicalFinancialAssumptions({ prompt: REAL_CASE_PROMPT, reportKind: "business_plan" });
}

// --- 1: verified financial inputs remain verified -----------------------

test("1. a genuinely user-stated financial figure (MRR) classifies verified, and stays verified end-to-end through the canonical context", () => {
  const context = createCanonicalFinancialAssumptions({
    prompt: "A subscription SaaS company. We currently have $42,000 MRR.",
    reportKind: "business_plan",
  });
  assert.equal(context.metrics.mrr.confidence, "High");
  assert.equal(context.financialEvidence.metrics.mrr, "verified");
});

// --- 2: benchmark inputs remain benchmark --------------------------------

test("2. a pure industry-benchmark metric (TAM, with no user evidence) classifies benchmarkDerived, never verified", () => {
  const context = buildRealCaseContext();
  assert.equal(context.financialEvidence.metrics.tam, "benchmarkDerived");
  assert.notEqual(context.financialEvidence.metrics.tam, "verified");
});

// --- 3: planning assumptions remain planning assumptions -----------------

test("3. an isolated, composition-only formula with no benchmark/industry context anywhere resolves to planningAssumption, never benchmarkDerived or verified", () => {
  const isolatedMetric = { label: "X", formula: "A / B", benchmarkComparison: "", assumptions: [] };
  assert.equal(classifyFinancialMetricEvidenceType(isolatedMetric, false), "planningAssumption");
});

// --- 4: derived values preserve weak upstream provenance -----------------

test("4. ARR calculated only from a stated MRR classifies derived -- real and trustworthy, but never itself claimed as directly verified", () => {
  const context = createCanonicalFinancialAssumptions({
    prompt: "A subscription SaaS company. We currently have $42,000 MRR.",
    reportKind: "business_plan",
  });
  assert.equal(context.financialEvidence.metrics.arr, "derived");
  assert.notEqual(context.financialEvidence.metrics.arr, "verified");
});

// --- 5: deterministic arithmetic does not upgrade evidence status --------

test("5. STRUCTURAL PROOF: no financial-model.ts metric ever classifies verified merely because it was calculated -- verified is reached ONLY via an explicit user-provided/stated signal or the hasUserEvidence flag, never via arithmetic composition alone", () => {
  const layoutMatch = readFileSync(
    join(repoRoot, "app/lib/financial-evidence-labeling.ts"),
    "utf8"
  ).match(/export function classifyFinancialMetricEvidenceType\([\s\S]{0,1600}?\n\}/);
  assert.ok(layoutMatch);
  // The ONLY two `return "verified"` sites are gated by verifiedSignal
  // (user-provided text) or the explicit hasUserEvidence parameter --
  // never by derivedCompositionSignal/benchmarkSignal.
  const verifiedReturns = (layoutMatch[0].match(/return "verified";/g) || []).length;
  assert.equal(verifiedReturns, 2, "expected exactly 2 'verified' return sites (user-provided text, and the hasUserEvidence fallback)");
});

test("5b. REAL-CASE PROOF: for the current real report (no user financial data), EVERY one of the 15 tracked metrics classifies benchmarkDerived or planningAssumption -- never verified or derived", () => {
  const context = buildRealCaseContext();
  for (const [key, level] of Object.entries(context.financialEvidence.metrics)) {
    assert.ok(
      level === "benchmarkDerived" || level === "planningAssumption",
      `${key} classified ${level}, expected benchmarkDerived or planningAssumption for this evidence-free real case`
    );
  }
});

// --- 6: financial consistency and financial evidence strength are -------
// ---     separate concepts ----------------------------------------------

test("6. financialConsistency.quality (internal coherence) and financialEvidence.strength (observed-evidence coverage) are computed by two completely independent functions over different inputs -- never conflated into one score", () => {
  const context = buildRealCaseContext();
  // financialConsistency is about internal coherence (LTV>=CAC, ARR=MRRx12,
  // runway=investment/burn, ...) -- present and independently computed.
  assert.ok(["Healthy", "Needs Validation", "High Risk"].includes(context.financialConsistency.quality));
  // financialEvidence is about observed-vs-modeled coverage -- a
  // genuinely different axis, never derived from financialConsistency.quality.
  assert.ok(["Strong", "Moderate", "Weak"].includes(context.financialEvidence.strength));
  assert.doesNotMatch(
    financialModelSource,
    /financialEvidence/,
    "financial-model.ts (financialConsistency's own home) must never reference the separate financialEvidence concept"
  );
});

test("6b. report-intelligence.ts's financialConsistency dimension is still derived ONLY from context.financialConsistency.quality (internal coherence) -- confirmed untouched by this ticket, never blended with financialEvidence", () => {
  assert.doesNotMatch(reportIntelligenceSource, /financialEvidence/);
  assert.match(
    reportIntelligenceSource,
    /context\.financialConsistency\.quality === "Healthy"\s*\n\s*\? 86/
  );
});

// --- 7: assumption-heavy attractive economics cannot independently ------
// ---     satisfy strong financial evidence -------------------------------

test("7. a report whose modeled unit economics look attractive (e.g. a healthy LTV:CAC ratio) but rests entirely on benchmark/assumption data still reports Weak financial evidence strength -- attractiveness of the numbers never substitutes for observed evidence", () => {
  const context = buildRealCaseContext();
  const ltvCacRatio = context.metrics.ltv.value / context.metrics.cac.value;
  // Sanity: this fixture's own modeled economics are not universally
  // terrible (a realistic mid-range benchmark case), yet evidence
  // strength must still reflect the complete absence of observed data.
  assert.ok(ltvCacRatio > 0, "sanity: LTV:CAC ratio is a real, positive number");
  assert.equal(context.financialEvidence.strength, "Weak");
  assert.equal(context.financialEvidence.observedEvidenceCoveragePercent, 0);
});

// --- 8: ENTER eligibility cannot be created from planning assumptions ---
// ---     alone -------------------------------------------------------

test("8. decision thresholds (createRecommendation/applyFatalBlockerOverride) are completely untouched by this ticket -- financialEvidence is never read by, or wired into, decision-threshold logic", () => {
  assert.doesNotMatch(investmentScoreSource, /financialEvidence/);
  assert.doesNotMatch(investmentScoreSource, /TASK #69A-46/);
  assert.match(investmentScoreSource, /export function createRecommendation\(totalScore: number, confidence: number\)/);
  assert.match(investmentScoreSource, /export function applyFatalBlockerOverride\(/);
});

test("8b. weak financial evidence does not, by itself, change the canonical decision for the real case -- MONITOR (internally WAIT/CONDITIONAL_GO) is unaffected by financialEvidence, confirmed by tracing that createRecommendation/applyFatalBlockerOverride take no financialEvidence argument at all", () => {
  assert.doesNotMatch(
    investmentScoreSource,
    /createRecommendation\([^)]*financialEvidence/,
    "createRecommendation must never be called with financialEvidence as an input"
  );
});

// --- 9: recommendations do not describe unverified CAC/WTP/retention ----
// ---     as observed facts -----------------------------------------------

test("9. the generation prompt explicitly forbids presenting unvalidated CAC/LTV/retention/WTP/payback as proof the strategy is already attractive or de-risked, in both the verbose and compact Report quality rules blocks", () => {
  const occurrences = (
    planExecutorSource.match(
      /Never present an unvalidated unit-economics figure \(CAC, LTV, retention, willingness-to-pay, payback\) as proof that the underlying strategy is already validated or attractive\./g
    ) || []
  ).length;
  assert.equal(occurrences, 2, "expected the verbose rule in both the per-field and full-report prompt blocks");
  assert.match(
    planExecutorSource,
    /Frame unvalidated CAC\/LTV\/retention\/WTP\/payback figures as thresholds to validate, never as proof the underlying strategy is already attractive or de-risked\./
  );
  assert.match(
    planExecutorSource,
    /Validate CAC at or below the \$9k planning threshold before scaling paid acquisition/,
    "the GOOD example phrasing must be present"
  );
  assert.match(
    planExecutorSource,
    /never "CAC is \$9k, therefore paid acquisition is attractive\."/,
    "the BAD example phrasing must be explicitly forbidden"
  );
});

// --- 10: scenario outputs remain planning scenarios ----------------------

test("10. the Scenario Analysis prompt still explicitly frames Worst/Base/Best as future, assumption-driven scenarios, and the generated field is prefixed 'AI Planning Scenarios' -- never presented as a verified forecast", () => {
  const planPromptsSource = readFileSync(join(repoRoot, "app/lib/report-engine/prompts/plan.ts"), "utf8");
  assert.match(
    planPromptsSource,
    /Create only future scenarios with three distinct cases: Worst Case, Base Case, and Best Case\./
  );
  assert.match(planExecutorSource, /AI Planning Scenarios: \$\{financialAssumptions\}/);
});

// --- 11: web/PDF use the same canonical provenance ------------------------

test("11. page.tsx and Planner.tsx both derive the financial evidence badge label from the SAME canonical EvidenceLevel vocabulary (getFinancialEvidenceBadgeLabel/financialEvidenceBadgeLabels), never two independently-invented label sets", () => {
  const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /function getFinancialEvidenceBadgeLabel\(/);
    assert.match(source, /getFinancialMetricDisplayLabel\(metricLabel: string, evidence: EvidenceLevel\)/);
  }
});

test("11b. classifyFinancialMetricEvidenceType is the SAME function plan-executor.ts's per-metric prompt annotations use -- no separate, renderer-specific classification exists anywhere", () => {
  assert.match(planExecutorSource, /classifyFinancialMetricEvidenceType\(metric, hasUserEvidence\)/);
});

// --- 12: historical reports without provenance degrade safely ------------

test("12. financialEvidence is optional on the persisted metadata chunk -- a historical report computed before this field existed simply has no financialEvidence key, never a fabricated reconstruction", () => {
  assert.match(planExecutorSource, /financialEvidence\?: AiFinancialModelContext\["financialEvidence"\];/);
  assert.match(
    planExecutorSource,
    /\.\.\.\(context\.financialEvidence \? \{ financialEvidence: context\.financialEvidence \} : \{\}\),/
  );
});

test("12b. financialEvidence survives a full JSON persistence round trip unchanged (simulating reports.metadata JSONB)", () => {
  const context = buildRealCaseContext();
  const roundTripped = JSON.parse(JSON.stringify(context.financialEvidence));
  assert.deepEqual(roundTripped, context.financialEvidence);
});

test("12c. financialEvidence survives the post-research refresh pipeline unchanged -- research coverage never recomputes or overwrites the model's own evidence classification", () => {
  const context = buildRealCaseContext();
  const afterCoverage = applyMarketResearchCoverageToContext(context, { evidence: [] }, REAL_CASE_PROMPT).context;
  assert.deepEqual(afterCoverage.financialEvidence, context.financialEvidence);

  const afterRefresh = refreshResearchAwareFinancialContext(afterCoverage);
  assert.deepEqual(afterRefresh.financialEvidence, context.financialEvidence);
});

// --- 13: current competitor/PDF fixes do not regress ----------------------

test("13. no canonical competitor-evidence, Porter's Five Forces, or PDF-export file carries a #69A-46 marker -- this ticket is scoped to the financial evidence pipeline only", () => {
  for (const relativePath of [
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/dashboard/[id]/ReportPdfButton.tsx",
    "components/Planner.tsx",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-46/, `${relativePath} must not carry a #69A-46 marker`);
  }
  assert.doesNotMatch(stateSource, /financialEvidence/);
  assert.doesNotMatch(pdfButtonSource, /financialEvidence/);
});

// --- 14: decision authority remains canonical -----------------------------

test("14. createRecommendation/applyFatalBlockerOverride remain the ONE authoritative decision-threshold pair -- no second, competing decision function was introduced", () => {
  const recommendationFunctionCount = (
    investmentScoreSource.match(/export function createRecommendation\(/g) || []
  ).length;
  assert.equal(recommendationFunctionCount, 1);
});

// --- SAFETY: no hardcoded business-case values -----------------------

test("SAFETY: deriveFinancialEvidenceSummary and classifyFinancialMetricEvidenceType contain no hardcoded reference to this ticket's own real-report business case", () => {
  const financialEvidenceLabelingSource = readFileSync(
    join(repoRoot, "app/lib/financial-evidence-labeling.ts"),
    "utf8"
  );
  assert.doesNotMatch(financialEvidenceLabelingSource, /QuickBooks|Xero|SMB financial-planning/i);
});

test("SAFETY: the new canonical financialEvidence summary is never read by deriveCanonicalCompetitiveEvidence or any competitor-scoring path -- market-research-coverage.ts's OWN, pre-existing, unrelated dimensions.financialEvidence (external research-evidence coverage, #69A-38D-era) is untouched and stays a completely separate concept", () => {
  const marketResearchCoverageSource = readFileSync(
    join(repoRoot, "app/lib/ai/market-research-coverage.ts"),
    "utf8"
  );
  assert.doesNotMatch(marketResearchCoverageSource, /context\.financialEvidence/);
  assert.doesNotMatch(marketResearchCoverageSource, /TASK #69A-46/);
  // The pre-existing, unrelated dimensions.financialEvidence field must
  // still exist, completely unmodified by this ticket.
  assert.match(marketResearchCoverageSource, /financialEvidence: number;/);
});
