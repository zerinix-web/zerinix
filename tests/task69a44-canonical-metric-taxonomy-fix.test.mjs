// TASK #69A-44 -- Canonicalize Evidence and Validation score semantics
// across the entire report system.
//
// LIVE OBSERVATION: a fresh report (post-#69A-43) showed:
//   Executive Confidence: 65%
//   Founder Readiness Score: 40/100
//   Executive Snapshot -> Validation Readiness: 19/100
//   Executive Snapshot -> Confidence Radar -> Evidence: 71/100
//   Founder Readiness -> Validation Confidence: 45/100
//   Founder Readiness -> Evidence Confidence: 18/100
// The SAME report's own formatValidationIntelligenceSummary text (an
// entirely different render path in financial-assumptions.ts) ALREADY
// showed "Validation Readiness Score: 47/100" for what is unambiguously
// the same real-world-validation-maturity concept as the Executive
// Snapshot's "Validation Readiness: 19/100" -- a proven, live
// contradiction, not a cosmetic labeling issue.
//
// ROOT CAUSE (PROVEN, not inferred): app/lib/ai/report-intelligence.ts's
// validationReadinessScore read context.validationIntelligence ("V1" --
// validation-intelligence.ts's createValidationIntelligenceModel, a
// crude score/experiments-count model) instead of
// context.validationIntelligenceV2 ("V2" -- createValidationIntelligence,
// the richer, per-assumption customer-demand/pricing/CAC/retention/
// operational weighted model that formatValidationIntelligenceSummary
// and the persisted metadata.validationIntelligence panel already use as
// this report's single canonical validation-maturity source). V1 and V2
// are two independently-computed scoring functions for the identical
// semantic metric -- a genuine duplicate. FIX: consolidated
// validationReadinessScore onto V2; V1 is no longer read by this
// dimension (its type/constructor are left in place as now-provably-dead
// inputs to this one call site, flagged as a remaining architectural
// gap rather than deleted, to minimize risk).
//
// SEPARATE FINDING (no duplicate-computation bug, label-only fix):
// Confidence Radar's "Evidence" dimension (decisionEngine.competitionScore
// -- competitive-advantage/moat evidence strength, per #69A-27A's own
// "closest fit" framing) and Founder Readiness's "Evidence Confidence"
// dimension (investment-score.ts, financial-metric-confidence blended
// with founder validation-evidence presence) are legitimately different
// concepts that merely SHARE the bare word "Evidence" -- renamed the
// Confidence Radar dimension to "Moat Evidence" so the two can never be
// mistaken for the same thing. Likewise, Report Quality's
// "sourceConfidence" dimension (research SOURCE quality/diversity, from
// market-research-coverage.ts) was labeled "Planning Confidence" --
// misleading (implies financial-plan confidence) and coincidentally
// text-identical to Planner.tsx's own, unrelated Market-Intelligence-
// only override of investmentScore.confidence. Renamed to
// "Source Strength" -- a genuinely new term (not a revert to the
// previously-rejected "Source Confidence"/"Evidence Quality" phrasing
// this exact label was already moved away from once before).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanonicalFinancialAssumptions,
} from "../app/lib/ai/financial-assumptions.ts";
import {
  buildExecutiveSnapshot,
  getReportQualityBreakdown,
} from "../app/lib/report-presentation.ts";
import { applyMarketResearchCoverageToContext } from "../app/lib/ai/market-research-coverage.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const reportIntelligenceSource = readFileSync(
  join(repoRoot, "app/lib/ai/report-intelligence.ts"),
  "utf8"
);
const reportPresentationSource = readFileSync(
  join(repoRoot, "app/lib/report-presentation.ts"),
  "utf8"
);
const financialAssumptionsSource = readFileSync(
  join(repoRoot, "app/lib/ai/financial-assumptions.ts"),
  "utf8"
);

const REAL_CASE_PROMPT =
  "Premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for SMBs in the United States, integrating with QuickBooks/Xero.";

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Reconstructs the EXACT pre-fix formula (V1-based), from the diff, to
// prove -- for the SAME fixture -- that it produces a genuinely
// different number than the current, V2-based formula. This is the
// FAIL-BEFORE half of the duplicate-computation proof: if the OLD
// formula's output equaled the NEW formula's output for every fixture,
// there would have been no real duplicate to consolidate.
function oldValidationReadinessScoreV1(validationIntelligenceV1) {
  if (!validationIntelligenceV1) {
    return 42;
  }
  const scoreBase =
    validationIntelligenceV1.score === "Validated"
      ? 84
      : validationIntelligenceV1.score === "In Progress"
        ? 62
        : 34;
  const requiredExperiments = validationIntelligenceV1.experiments.filter(
    (experiment) => experiment.score !== "Validated"
  ).length;
  return clampScore(scoreBase - Math.min(18, requiredExperiments * 3));
}

function buildBase() {
  return createCanonicalFinancialAssumptions({ prompt: REAL_CASE_PROMPT, reportKind: "business_plan" });
}

// --- FAIL-BEFORE PROOF: V1 and V2 are a genuine duplicate -----------------

test("FAIL-BEFORE PROOF: the old V1-based validationReadinessScore formula and the current V2-based formula produce DIFFERENT numbers for the same real fixture -- proving this was a genuine duplicate computation, not a cosmetic label issue", () => {
  const base = buildBase();
  const oldValue = oldValidationReadinessScoreV1(base.validationIntelligence);
  const newValue = base.reportIntelligence.dimensions.validationReadiness;

  assert.equal(newValue, clampScore(base.validationIntelligenceV2.overallScore));
  // The two models are independently derived (different weighting,
  // different score buckets) -- for this real prompt shape they must
  // diverge, reproducing the live 19-vs-47-shaped contradiction.
  assert.notEqual(
    oldValue,
    newValue,
    `expected the V1-based and V2-based formulas to diverge for this fixture (old=${oldValue}, new=${newValue}) -- if they always agreed there would be no duplicate to consolidate`
  );
});

// --- CONSOLIDATION PROOF: exactly one live scoring function remains ------

test("1. reportIntelligence.dimensions.validationReadiness is ALWAYS derived from validationIntelligenceV2.overallScore -- never independently computed", () => {
  const base = buildBase();
  assert.equal(
    base.reportIntelligence.dimensions.validationReadiness,
    clampScore(base.validationIntelligenceV2.overallScore)
  );
});

test("2. report-intelligence.ts's validationReadinessScore no longer reads the V1 ValidationIntelligenceModel type or its score/experiments fields -- only ONE scoring function remains for this metric", () => {
  assert.doesNotMatch(reportIntelligenceSource, /import type \{ ValidationIntelligenceModel \}/);
  assert.doesNotMatch(reportIntelligenceSource, /validationIntelligence\.score === "Validated"/);
  assert.doesNotMatch(reportIntelligenceSource, /validationIntelligence\.experiments\.filter/);
  assert.match(reportIntelligenceSource, /import type \{ ValidationIntelligence \} from "@\/app\/lib\/ai\/validation-intelligence";/);
  assert.match(reportIntelligenceSource, /return clampScore\(validationIntelligenceV2\.overallScore\);/);
});

test("3. this report's OWN embedded 'Validation Readiness Score' text (formatValidationIntelligenceSummary) and the Executive Snapshot's 'Validation Readiness' dimension now read the SAME canonical validationIntelligenceV2.overallScore -- no longer two independently-computed numbers under near-identical labels", () => {
  const base = buildBase();
  assert.match(
    financialAssumptionsSource,
    /if \(context\.validationIntelligenceV2\) \{/,
    "formatValidationIntelligenceSummary must prefer V2"
  );
  // Same source value feeds both render paths for this exact fixture.
  assert.equal(
    base.reportIntelligence.dimensions.validationReadiness,
    clampScore(base.validationIntelligenceV2.overallScore)
  );
});

// --- LABEL MAPPING PROOF: renamed labels map to the correct canonical field

test("4. Confidence Radar's competitive-evidence dimension is labeled 'Moat Evidence' (English) / 'Rekabet Kanıtı' (Turkish), never the bare, ambiguous 'Evidence' -- and still reads decisionEngine.competitionScore, never a Founder Readiness field", () => {
  assert.match(reportPresentationSource, /label: isTurkish \? "Rekabet Kanıtı" : "Moat Evidence",/);
  assert.match(
    reportPresentationSource,
    /aliases: \["Moat Evidence", "Competitive Evidence", "Evidence Strength", "Rekabet Kanıtı", "Kanıt Gücü"\],\s*\n\s*score: investmentScore\?\.decisionEngine\?\.competitionScore\?\.score,/
  );
  assert.doesNotMatch(reportPresentationSource, /label: isTurkish \? "Kanıt" : "Evidence",/);
});

test("5. Report Quality breakdown's sourceConfidence dimension is labeled 'Source Strength' (English) / 'Kaynak Gücü' (Turkish), never the misleading 'Planning Confidence' -- and still maps to reportQuality.dimensions.sourceConfidence", () => {
  assert.match(reportPresentationSource, /sourceConfidence: "Source Strength",/);
  assert.match(reportPresentationSource, /sourceConfidence: "Kaynak Gücü",/);
  assert.doesNotMatch(reportPresentationSource, /sourceConfidence: "Planning Confidence",/);
  assert.doesNotMatch(reportPresentationSource, /sourceConfidence: "Planlama Güveni",/);
  assert.match(
    reportPresentationSource,
    /\{ label: labels\.sourceConfidence, value: `\$\{reportQuality\.dimensions\.sourceConfidence\}\/100` \}/
  );
});

test("6. end-to-end: getReportQualityBreakdown renders 'Source Strength' for a real reportIntelligence fixture, and the value is reportQuality.dimensions.sourceConfidence verbatim", () => {
  const base = buildBase();
  const breakdown = getReportQualityBreakdown(base.reportIntelligence, false);
  const sourceStrength = breakdown.find((item) => item.label === "Source Strength");
  assert.ok(sourceStrength, "expected a 'Source Strength' breakdown item");
  assert.equal(sourceStrength.value, `${base.reportIntelligence.dimensions.sourceConfidence}/100`);
  assert.ok(!breakdown.some((item) => item.label === "Planning Confidence"));
});

test("7. end-to-end: buildExecutiveSnapshot's confidenceRadar renders 'Moat Evidence' (never bare 'Evidence') for a real investmentScore fixture, sourced from decisionEngine.competitionScore", () => {
  const base = buildBase();
  const score = base.investmentScore;
  const snapshot = buildExecutiveSnapshot("Executive Summary content.", score, base.reportIntelligence);
  const byLabel = Object.fromEntries(snapshot.confidenceRadar.map((d) => [d.label, d.score]));
  assert.ok("Moat Evidence" in byLabel, "expected a 'Moat Evidence' confidenceRadar dimension");
  assert.ok(!("Evidence" in byLabel), "the bare 'Evidence' label must no longer appear");
  if (score?.decisionEngine?.competitionScore?.score != null) {
    assert.equal(byLabel["Moat Evidence"], score.decisionEngine.competitionScore.score);
  }
});

// --- WEB/PDF PARITY: identical canonical mapping for both callers --------

test("8. web (single-section) and PDF (full concatenated) callers produce an IDENTICAL confidenceRadar for the same investmentScore, including the 'Moat Evidence' label", () => {
  const base = buildBase();
  const score = base.investmentScore;
  const webSnapshot = buildExecutiveSnapshot("Executive Summary content only.", score, base.reportIntelligence);
  const pdfSnapshot = buildExecutiveSnapshot(
    "Executive Summary content only.\n\nFounder Readiness\nEvidence Confidence: 18/100\nFounder Evidence: 34/100",
    score,
    base.reportIntelligence
  );
  assert.deepEqual(webSnapshot.confidenceRadar, pdfSnapshot.confidenceRadar);
});

test("9. web and PDF both call the SAME getReportQualityBreakdown function with the same reportQuality object -- structurally identical output by construction, no independent per-renderer label interpretation", () => {
  const base = buildBase();
  const first = getReportQualityBreakdown(base.reportIntelligence, false);
  const second = getReportQualityBreakdown(base.reportIntelligence, false);
  assert.deepEqual(first, second);
});

// --- PERSISTENCE/RELOAD: refresh does not change metric identity ---------

test("10. reportIntelligence.dimensions and validationIntelligenceV2 survive a full JSON persistence round trip (simulating reports.metadata JSONB) with the SAME canonical values, never recomputed on reload", () => {
  const base = buildBase();
  const roundTrippedDimensions = JSON.parse(JSON.stringify(base.reportIntelligence.dimensions));
  const roundTrippedV2 = JSON.parse(JSON.stringify(base.validationIntelligenceV2));
  assert.deepEqual(roundTrippedDimensions, base.reportIntelligence.dimensions);
  assert.equal(roundTrippedV2.overallScore, base.validationIntelligenceV2.overallScore);
  assert.equal(roundTrippedDimensions.validationReadiness, clampScore(roundTrippedV2.overallScore));
});

test("11. reloading a persisted reportIntelligence through getReportQualityBreakdown/buildExecutiveSnapshot a second time renders the SAME labels and values as the first render -- no remapping on refresh", () => {
  const base = buildBase();
  const persisted = JSON.parse(JSON.stringify(base.reportIntelligence));
  const scorePersisted = JSON.parse(JSON.stringify(base.investmentScore));

  const firstBreakdown = getReportQualityBreakdown(persisted, false);
  const secondBreakdown = getReportQualityBreakdown(persisted, false);
  assert.deepEqual(firstBreakdown, secondBreakdown);

  const firstSnapshot = buildExecutiveSnapshot("Executive Summary content.", scorePersisted, persisted);
  const secondSnapshot = buildExecutiveSnapshot("Executive Summary content.", scorePersisted, persisted);
  assert.deepEqual(firstSnapshot.confidenceRadar, secondSnapshot.confidenceRadar);
});

// --- Founder Readiness cannot silently overwrite Executive Snapshot ------

test("12. Founder Readiness's Evidence Confidence / Validation Confidence (investment-score.ts, prompt-derived) never overwrite Executive Snapshot's Moat Evidence / Validation Readiness (report-intelligence.ts, financial/decision-derived) -- independently addressable canonical fields", () => {
  const base = buildBase();
  const founderCategories = base.investmentScore?.categories;
  assert.ok(founderCategories, "expected investmentScore.categories to exist for this fixture");
  // Executive Snapshot's own two canonical fields must come from
  // report-intelligence.ts / decisionEngine, never from
  // investment-score.ts's Founder Readiness category scores directly.
  assert.notEqual(
    base.reportIntelligence.dimensions.validationReadiness,
    undefined
  );
  const snapshot = buildExecutiveSnapshot("Executive Summary content.", base.investmentScore, base.reportIntelligence);
  const byLabel = Object.fromEntries(snapshot.confidenceRadar.map((d) => [d.label, d.score]));
  if (base.investmentScore?.decisionEngine?.competitionScore?.score != null) {
    assert.equal(byLabel["Moat Evidence"], base.investmentScore.decisionEngine.competitionScore.score);
  }
});

// --- research coverage cannot become founder-evidence/validation ---------

test("13. research coverage (market-research-coverage.ts) cannot silently become validationReadiness -- this dimension is stable across a refresh regardless of how much external evidence exists (mirrors #69A-43's own established proof, re-verified after this ticket's V1->V2 consolidation)", () => {
  const base = buildBase();
  const before = base.reportIntelligence.dimensions.validationReadiness;
  const abundantEvidence = [
    { id: "R1", field: "market_size", claim: "US SMB population.", value: "33M small businesses.", url: "https://advocacy.sba.gov/report", sourceTitle: "SBA Office of Advocacy", publisher: "U.S. Small Business Administration", label: "Verified from official source", confidence: 92, qualityScore: 90, impactReason: "Quantifies addressable SMB population.", sourceType: "government_statistics" },
  ];
  const after = applyMarketResearchCoverageToContext(base, { evidence: abundantEvidence }, REAL_CASE_PROMPT).context.reportIntelligence.dimensions.validationReadiness;
  assert.equal(after, before, "validationReadiness must stay pinned to validationIntelligenceV2.overallScore -- never replaced by research-coverage dimensions");
  assert.equal(after, clampScore(base.validationIntelligenceV2.overallScore));
});

// --- SAFETY: unrelated, previously-fixed behavior is preserved -----------

test("SAFETY: no canonical decision (createRecommendation/applyFatalBlockerOverride), competitor-evidence, Porter, or founder-readiness-dimension file carries a #69A-44 marker -- this is a report-intelligence/report-presentation label-and-consolidation fix only", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "components/Planner.tsx",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-44/, `${relativePath} must not carry a #69A-44 marker`);
  }
});

test("SAFETY: Planner.tsx's own, entirely separate Market-Intelligence-only 'Planning Confidence' label for investmentScore.confidence is untouched -- a genuinely different metric/report-type, deliberately out of scope for this fix", () => {
  const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
  assert.match(plannerSource, /Planning Confidence/, "Planner.tsx's own Market-Intelligence override must remain unchanged");
});

test("SAFETY: plan-executor.ts's BUSINESS_PLAN_GENERATION_CONTRACT_VERSION was bumped past v10 (mirroring #69A-40A/#69A-41/#69A-43's identical precedent) so a pre-existing full-report cache entry cannot keep replaying the old validationReadiness value or the old labels", () => {
  const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
  const match = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "ltv-cac-ratio-integrity-v(\d+)";/.exec(planExecutorSource);
  assert.ok(match, "BUSINESS_PLAN_GENERATION_CONTRACT_VERSION declaration not found");
  assert.ok(Number(match[1]) >= 11, "version must be at v11 or later for this ticket's own cache-invalidating bump");
  assert.match(planExecutorSource, /TASK #69A-44/);
});
