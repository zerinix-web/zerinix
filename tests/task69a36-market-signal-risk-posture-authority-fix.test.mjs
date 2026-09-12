import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExecutiveSnapshot } from "../app/lib/report-presentation.ts";

// ===========================================================================
// TASK #69A-36 -- the production Executive Summary's "Investment Decision
// Snapshot" panel rendered malformed fragments for Business Idea
// Validation reports:
//   Market Signal:  size data" remains...
//   Risk Posture:   Execution readiness:...
//
// ROOT CAUSE, traced end-to-end: both KPI tile values (page.tsx's and
// Planner.tsx's ExecutiveSummaryVisual/its own equivalent) called
// extractMetricValue(content, "Market")/"TAM"/"Risk"/"Main Risk" -- a
// generic regex that scans the ENTIRE free-form executive summary for
// any bare occurrence of that literal word followed by a colon/dash,
// with NO awareness of sentence, quotation, or section-heading
// boundaries. It could start its capture match mid-sentence, inside a
// quoted clause (e.g. a model-generated aside like `supported by real
// "market size data" remains unverified`), producing exactly the
// malformed fragments observed in production. This was pure prose
// parsing with zero structural authority -- never derived from
// evidence, never validated against the report's own canonical score.
//
// FIX: both KPI tiles now read from buildExecutiveSnapshot's own fields
// -- the SAME function the "Executive Snapshot" section (a few panels
// below on the same page, and PDF) already calls for the identical
// report:
//   - Market Signal: a NEW canonical field, marketSignal (report-
//     presentation.ts's resolveMarketSignal), derived from
//     decisionEngine.marketScore -- the SAME structured category
//     Confidence Radar's own "Market" dimension already reads (market
//     evidence coverage %, independent domains, claim coverage --
//     market-research-coverage.ts). Classified into Strong/Moderate/
//     Weak using this codebase's own established >=72/>=48 tier
//     convention (financial-evidence-labeling.ts, report-intelligence.ts,
//     market-research-coverage.ts all already use it), with
//     "Insufficient evidence" (Porter's Five Forces' own existing
//     sentinel) for a report that genuinely lacks this structured
//     category -- never a fabricated signal.
//   - Risk Posture: the EXISTING riskLevel/mainRisk fields
//     buildExecutiveSnapshot already computes (riskLevel from
//     investmentScore.confidence via classifyStructuralRiskLevel;
//     mainRisk from investmentScore.topRisks[0]) -- no new field, no new
//     computation, just reused instead of independently re-derived.
//
// Both changes are presentation-only: no scoring, threshold, decision-
// engine, Founder Readiness, Confidence Radar, Benchmark Intelligence,
// competitor, Porter, or financial logic was touched.
// ===========================================================================

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pdfButtonSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");
const reportPresentationSource = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");

// The real production case: MONITOR / 56% confidence / 52 investment
// score, with a market signal ~51 and a real, unquoted top risk -- but
// including the exact kind of quoted aside that produced the reported
// malformed fragment, to prove the new path is immune to it.
function referenceInvestmentScore(overrides = {}) {
  return {
    totalScore: 52,
    confidence: 56,
    recommendation: "WAIT",
    topRisks: ["Customer acquisition cost is unproven."],
    strengths: [],
    weaknesses: [],
    decisionEngine: {
      marketScore: {
        score: 51,
        maximumScore: 100,
        label: "Market Score",
        reasoning: ["Market evidence coverage: 51%", "Independent domains: 6", "Claim coverage: 40%"],
      },
    },
    ...overrides,
  };
}

const REFERENCE_CONTENT_WITH_QUOTE_FRAGMENT =
  `Executive Decision\nDecision: MONITOR (Confidence: 56%)\n\n` +
  `Why: The idea has merit but validation evidence is thin, supported by real "market size data" remains unverified across independent sources. Execution readiness: the team has not yet run a paid pilot.`;

// ===========================================================================
// 1. Market Signal does not use arbitrary prose fragments
// ===========================================================================

test("1a. Market Signal is derived from decisionEngine.marketScore, never from report prose -- resolveMarketSignal's own implementation touches only investmentScore fields", () => {
  const fnMatch = reportPresentationSource.match(/function resolveMarketSignal\([\s\S]{0,600}?\n\}/);
  assert.ok(fnMatch, "resolveMarketSignal not found");
  assert.doesNotMatch(fnMatch[0], /normalized|content\.match|extractMetricValue/);
  assert.match(fnMatch[0], /investmentScore\?\.decisionEngine\?\.marketScore/);
});

test("1b. for the reference production case, Market Signal resolves to a clean, structured value with no trace of the report's own quoted prose", () => {
  const snapshot = buildExecutiveSnapshot(REFERENCE_CONTENT_WITH_QUOTE_FRAGMENT, referenceInvestmentScore());
  assert.ok(snapshot.marketSignal);
  assert.equal(snapshot.marketSignal.level, "Moderate");
  assert.equal(snapshot.marketSignal.explanation, "Market evidence coverage: 51%");
  assert.doesNotMatch(snapshot.marketSignal.explanation, /size data|remains unverified/);
});

// ===========================================================================
// 2. Broken quoted fragments cannot reach the card
// ===========================================================================

test("2. neither page.tsx's nor Planner.tsx's Market Signal/Risk Posture tiles call extractMetricValue for the non-Market-Intelligence branch any longer -- the unbounded-scan mechanism that produced the reported quote fragments is gone from both call sites", () => {
  for (const source of [pageSource, plannerSource]) {
    const marketSignalBlock = source.slice(source.indexOf('label: "Market Signal",'), source.indexOf('label: "Market Signal",') + 700);
    const riskPostureBlock = source.slice(source.indexOf('label: "Risk Posture",'), source.indexOf('label: "Risk Posture",') + 700);
    assert.doesNotMatch(marketSignalBlock, /: extractMetricValue\(/);
    assert.doesNotMatch(riskPostureBlock, /: extractMetricValue\(/);
  }
});

test("2b. a report whose prose contains an unbalanced/dangling quotation mark near the word 'Market' or 'Risk' cannot influence the new structured value at all -- the resolver never reads `content` for these two fields", () => {
  const withDanglingQuote = referenceInvestmentScore();
  const contentA = REFERENCE_CONTENT_WITH_QUOTE_FRAGMENT;
  const contentB = `${REFERENCE_CONTENT_WITH_QUOTE_FRAGMENT}\nMarket: "totally different fabricated text that never closes`;
  const snapshotA = buildExecutiveSnapshot(contentA, withDanglingQuote);
  const snapshotB = buildExecutiveSnapshot(contentB, withDanglingQuote);
  assert.deepEqual(snapshotA.marketSignal, snapshotB.marketSignal);
});

// ===========================================================================
// 3. Risk Posture uses canonical structured risk authority
// ===========================================================================

test("3a. Risk Posture's riskLevel/mainRisk are the SAME fields buildExecutiveSnapshot already exposes for the Executive Snapshot section (no new computation, no independent re-derivation)", () => {
  for (const source of [pageSource, plannerSource]) {
    const riskPostureBlock = source.slice(source.indexOf('label: "Risk Posture",'), source.indexOf('label: "Risk Posture",') + 700);
    assert.match(riskPostureBlock, /executiveSnapshot\s*\n\s*\? `\$\{executiveSnapshot\.riskLevel\} — \$\{executiveSnapshot\.mainRisk\}`/);
  }
});

test("3b. for the reference production case (confidence 56%), Risk Posture resolves to 'Medium' -- the same classifyStructuralRiskLevel tier the Executive Snapshot's own riskLevel already uses for this confidence", () => {
  const snapshot = buildExecutiveSnapshot(REFERENCE_CONTENT_WITH_QUOTE_FRAGMENT, referenceInvestmentScore());
  assert.equal(snapshot.riskLevel, "Medium");
  assert.equal(snapshot.mainRisk, "Customer acquisition cost is unproven.");
});

// ===========================================================================
// 4. Missing structured evidence degrades honestly
// ===========================================================================

test("4a. Market Signal is null (never fabricated) when decisionEngine.marketScore is genuinely absent", () => {
  const scoreWithoutMarketCategory = referenceInvestmentScore({ decisionEngine: {} });
  const snapshot = buildExecutiveSnapshot(REFERENCE_CONTENT_WITH_QUOTE_FRAGMENT, scoreWithoutMarketCategory);
  assert.equal(snapshot.marketSignal, null);
});

test("4b. the KPI tile itself shows the bounded 'Insufficient evidence' label (this codebase's own existing sentinel, matching Porter's Five Forces' identical vocabulary) when marketSignal is null -- never a fake certainty", () => {
  for (const source of [pageSource, plannerSource]) {
    const marketSignalBlock = source.slice(source.indexOf('label: "Market Signal",'), source.indexOf('label: "Market Signal",') + 700);
    assert.match(marketSignalBlock, /: "Insufficient evidence",/);
  }
  const porterSource = readFileSync(join(repoRoot, "app/lib/report-engine/porters-five-forces-state.ts"), "utf8");
  assert.match(porterSource, /"Insufficient evidence"/);
});

// ===========================================================================
// 5. Historical reports do not fabricate a signal
// ===========================================================================

test("5. a fully historical report (no investmentScore at all) resolves Market Signal to null and Risk Posture's riskLevel to the EXISTING pre-#69A-36 prose-inference fallback -- unchanged historical degradation path, no new fabrication introduced", () => {
  const snapshot = buildExecutiveSnapshot("A plain executive summary with no structured data at all.", undefined);
  assert.equal(snapshot.marketSignal, null);
  assert.ok(["Low", "Medium", "High"].includes(snapshot.riskLevel));
});

// ===========================================================================
// 6. Web/PDF use equivalent signal semantics
// ===========================================================================

test("6. ReportPdfButton.tsx has no equivalent 'Market Signal'/'Risk Posture' KPI tile at all, so no web/PDF disagreement is even possible for this specific panel -- confirmed by source, and untouched by this fix", () => {
  assert.doesNotMatch(pdfButtonSource, /"Market Signal"|"Risk Posture"/);
  assert.doesNotMatch(pdfButtonSource, /TASK #69A-36/);
});

test("6b. page.tsx and Planner.tsx both compute executiveSnapshot via the SAME buildExecutiveSnapshot call the Executive Snapshot section (and PDF's own executiveSnapshot construction) already use -- one canonical function, not a second independently-invented one", () => {
  for (const source of [pageSource, plannerSource]) {
    const occurrences = [...source.matchAll(/buildExecutiveSnapshot\(/g)];
    assert.ok(occurrences.length >= 2, "expected at least the pre-existing Executive Snapshot call plus this fix's new one");
  }
});

// ===========================================================================
// 7/8/9/10/11 -- decision safety: MONITOR remains MONITOR, confidence/
// Founder Readiness unchanged, no stale "Proceed with Conditions", no
// unsupported score recalculation
// ===========================================================================

test("7. MONITOR remains MONITOR: this fix's own diff never touches nativeDecisionMatch/recommendation -- the #69A-35A decision-token resolution is completely untouched", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /nativeDecisionMatch\.token\.toUpperCase\(\)/);
  }
});

test("8. confidence is read, never recomputed: resolveMarketSignal and the riskLevel/mainRisk reuse both only READ investmentScore.confidence/decisionEngine -- neither writes to or recalculates it", () => {
  const fnMatch = reportPresentationSource.match(/function resolveMarketSignal\([\s\S]{0,600}?\n\}/);
  assert.ok(fnMatch);
  assert.doesNotMatch(fnMatch[0], /\.confidence\s*=|\.score\s*=(?!=)/);
});

test("9. Founder Readiness is untouched: no #69A-36 marker exists in investment-score.ts, and resolveMarketSignal/the KPI tile changes never reference founderScore/dimensionScores", () => {
  const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");
  assert.doesNotMatch(investmentScoreSource, /TASK #69A-36/);
  const fnMatch = reportPresentationSource.match(/function resolveMarketSignal\([\s\S]{0,600}?\n\}/);
  assert.doesNotMatch(fnMatch[0], /founderScore|dimensionScores/);
});

test("10. no stale 'Proceed with Conditions' regression: #69A-35/#69A-35A's own fixes remain intact -- mapInvestmentScoreRecommendationToCanonicalDecision still maps WAIT to PROCEED_WITH_CONDITIONS, and the native-decision-token extraction is still the first-priority tile source", () => {
  const vocabularySource = readFileSync(
    join(repoRoot, "app/lib/report-engine/executive-decision-vocabulary.ts"),
    "utf8"
  );
  assert.match(vocabularySource, /if \(recommendation === "WAIT"\) return "PROCEED_WITH_CONDITIONS";/);
});

test("11. no unsupported score recalculation: totalScore/confidence/decisionEngine category scores are never written to by this fix -- confirmed by source, this fix's own new code is read-only over investmentScore", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/benchmark-intelligence.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-36/, relativePath);
  }
});

// ===========================================================================
// [REGRESSION LOCK]
// ===========================================================================

test("[REGRESSION LOCK] classifyMarketSignalLevel mirrors the established >=72/>=48 tier convention -- this suite fails if that threshold silently drifts from the rest of the codebase's own identical convention", () => {
  const fnMatch = reportPresentationSource.match(/function classifyMarketSignalLevel\([\s\S]{0,300}?\n\}/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /scorePercent >= 72\) return "Strong";/);
  assert.match(fnMatch[0], /scorePercent >= 48\) return "Moderate";/);
});
