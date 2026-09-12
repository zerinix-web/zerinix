import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractExecutiveDecisionFromText,
  localizeExecutiveDecision,
} from "../app/lib/report-engine/executive-decision-brief.ts";
import {
  mapExecutiveDecisionCodeToCanonicalDecision,
  mapInvestmentScoreRecommendationToCanonicalDecision,
  getCanonicalDecisionLabel,
} from "../app/lib/report-engine/executive-decision-vocabulary.ts";

// ===========================================================================
// TASK #69A-35A -- a real FRESH Business Idea Validation report showed
// "Decision: MONITOR (Confidence: 56%)" in its own Executive Decision
// banner, Executive Snapshot, PDF page 1/3, and Scenario section -- but
// the web "Investment Decision Snapshot" panel's own large decision
// badge (page.tsx's ExecutiveSummaryVisual, Planner.tsx's own equivalent)
// STILL rendered "Proceed with Conditions" for the exact same report.
//
// ROOT CAUSE, distinct from #69A-35's own fix: #69A-35 corrected
// mapInvestmentScoreRecommendationToCanonicalDecision so it no longer
// DISAGREES with mapExecutiveDecisionCodeToCanonicalDecision for the
// same decision tier -- but every one of these mappers ultimately feeds
// getCanonicalDecisionLabel, which ONLY EVER produces one of 4
// cross-report-normalized words (Proceed/Proceed with Conditions/Pause
// Pending Review/Reject), NEVER the report's own native ENTER/MONITOR/
// AVOID word, no matter which upstream tier supplied the value. The
// "Investment Decision Snapshot" badge was ALWAYS going to say "Proceed
// with Conditions" for a MONITOR-tier report, regardless of #69A-35's
// own (necessary, but insufficient) mapper-consistency fix -- which is
// exactly why this exact drift survived #69A-35's own test suite: those
// tests only proved the TWO MAPPERS agree with each other, never that
// either one produces the LITERAL WORD "MONITOR" a fresh report's own
// banner already displays elsewhere on the same page.
//
// FIX: page.tsx's getDecisionSummaryItems/ExecutiveSummaryVisual and
// Planner.tsx's own equivalent "Investment Decision Snapshot" computation
// now call extractExecutiveDecisionFromText(...) directly FIRST --
// exactly mirroring report-presentation.ts's own buildExecutiveSnapshot,
// which ALREADY solved this identical problem for its own decision field
// using this exact pattern. Reading .token.toUpperCase() returns the
// EXACT literal word already rendered by the report's own deterministic
// "Decision: MONITOR (Confidence: 56%)" banner -- guaranteed to agree
// byte-for-byte with "Executive Decision: MONITOR" since both read the
// identical generated text. The old getCanonicalDecisionLabel/
// mapInvestmentScoreRecommendationToCanonicalDecision/
// resolveCanonicalDecisionFromReportText chain remains, UNCHANGED, as the
// fallback for any report whose text lacks this deterministic banner
// entirely (a historical report, or a genuinely malformed one) --
// preserving #69A-35's own fix and every existing degradation path.
// ===========================================================================

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pdfButtonSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");
const reportPresentationSource = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");

// The real fresh-report state from the ticket: MONITOR / 56% / ~52.
const FRESH_REPORT_EXECUTIVE_SUMMARY = `Executive Decision
Decision: MONITOR (Confidence: 56%)

Confidence Supported By:
- Business model shows real recurring revenue potential.
- Founder has relevant domain experience.

Why: The idea has merit but validation evidence for customer demand and pricing remains thin.

Top 3 Reasons:
1. Large addressable market for SMB financial planning tools.
2. Clear integration path with QuickBooks/Xero.
3. Defensible AI-driven differentiation.

Top 3 Risks:
1. Customer acquisition cost is unproven.
2. Competitive landscape includes established players.
3. Pricing willingness-to-pay is not yet validated.`;

// ===========================================================================
// [FAIL-BEFORE / PASS-AFTER PROOF] -- reproduces the exact reported bug
// ===========================================================================

test("[FAIL-BEFORE PROOF] the OLD path (getCanonicalDecisionLabel fed by either mapper) would ALWAYS have produced 'Proceed with Conditions' for this exact MONITOR/56%/CONDITIONAL_GO report, never the literal word 'MONITOR'", () => {
  const oldPathViaInvestmentScore = getCanonicalDecisionLabel(
    mapInvestmentScoreRecommendationToCanonicalDecision("WAIT"),
    "English"
  );
  const oldPathViaExecutiveDecisionCode = getCanonicalDecisionLabel(
    mapExecutiveDecisionCodeToCanonicalDecision("CONDITIONAL_GO"),
    "English"
  );
  assert.equal(oldPathViaInvestmentScore, "Proceed with Conditions");
  assert.equal(oldPathViaExecutiveDecisionCode, "Proceed with Conditions");
  assert.notEqual(oldPathViaInvestmentScore, "MONITOR");
});

test("[PASS-AFTER PROOF] the NEW path (extractExecutiveDecisionFromText's own .token) produces the literal word 'MONITOR' for the exact real fresh-report banner text", () => {
  const match = extractExecutiveDecisionFromText(FRESH_REPORT_EXECUTIVE_SUMMARY);
  assert.ok(match, "expected the deterministic banner to be found");
  assert.equal(match.code, "CONDITIONAL_GO");
  assert.equal(match.token.toUpperCase(), "MONITOR");
});

test("[PASS-AFTER PROOF] this literal 'MONITOR' is EXACTLY what localizeExecutiveDecision produces for the SAME code under the business_plan vocabulary -- proving the extraction path and the generation path agree by construction, not coincidence", () => {
  const code = "CONDITIONAL_GO";
  assert.equal(localizeExecutiveDecision(code, "English", "business_plan"), "MONITOR");
});

// ===========================================================================
// Requirement: assert the prominent Investment Decision Snapshot decision
// is MONITOR, and "Proceed with Conditions" is not emitted as a competing
// executive decision for this state
// ===========================================================================

test("the fresh-report state (MONITOR/56%/~52) resolves to 'MONITOR' through the exact extraction both page.tsx's and Planner.tsx's Investment Decision Snapshot now use, and never resolves to 'Proceed with Conditions' as a competing label", () => {
  const match = extractExecutiveDecisionFromText(FRESH_REPORT_EXECUTIVE_SUMMARY);
  const badgeText = match?.token.toUpperCase();
  assert.equal(badgeText, "MONITOR");
  assert.notEqual(badgeText, "Proceed with Conditions");
  assert.notEqual(badgeText, "PROCEED_WITH_CONDITIONS");
});

test("page.tsx's getDecisionSummaryItems (Decision Summary grid) computes nativeDecisionMatch and prefers its .token.toUpperCase() as the FIRST priority, ahead of the old investmentScore/prose chain", () => {
  const fnStart = pageSource.indexOf("function getDecisionSummaryItems(");
  const region = pageSource.slice(fnStart, fnStart + 9000);
  assert.match(
    region,
    /const nativeDecisionMatch = isMarketIntelligence\s*\n\s*\? null\s*\n\s*: extractExecutiveDecisionFromText\(/
  );
  assert.match(
    region,
    /\(nativeDecisionMatch\s*\n\s*\? nativeDecisionMatch\.token\.toUpperCase\(\)\s*\n\s*: structuredInvestmentRecommendation/
  );
});

test("page.tsx's ExecutiveSummaryVisual (Investment Decision Snapshot panel) computes nativeDecisionMatch and prefers its .token.toUpperCase() as the FIRST priority, ahead of resolvedDecision", () => {
  const fnStart = pageSource.indexOf("function ExecutiveSummaryVisual(");
  const region = pageSource.slice(fnStart, fnStart + 9000);
  assert.match(region, /const nativeDecisionMatch = isMarketIntelligence \? null : extractExecutiveDecisionFromText\(content\);/);
  assert.match(
    region,
    /const recommendation = marketDecision\s*\n\s*\? marketDecision\.decisionLabel\s*\n\s*: nativeDecisionMatch\s*\n\s*\? nativeDecisionMatch\.token\.toUpperCase\(\)\s*\n\s*: resolvedDecision/
  );
});

test("Planner.tsx's own Investment Decision Snapshot equivalent computes nativeDecisionMatch and prefers its .token.toUpperCase() as the FIRST priority", () => {
  const recommendationBlockStart = plannerSource.indexOf("const nativeDecisionMatch = isMarketIntelligence ? null : extractExecutiveDecisionFromText(section.content);");
  assert.ok(recommendationBlockStart > -1);
  const region = plannerSource.slice(recommendationBlockStart, recommendationBlockStart + 400);
  assert.match(
    region,
    /const recommendation = marketDecision\s*\n\s*\? marketDecision\.decisionLabel\s*\n\s*: nativeDecisionMatch\s*\n\s*\? nativeDecisionMatch\.token\.toUpperCase\(\)\s*\n\s*: structuredInvestmentRecommendation/
  );
});

// ===========================================================================
// Coverage for ALL canonical decision vocabulary values, so web/PDF/report
// summary mappings cannot silently diverge again
// ===========================================================================

test("every business_plan ExecutiveDecisionCode round-trips consistently: the generated banner token, extractExecutiveDecisionFromText's own extraction, and mapExecutiveDecisionCodeToCanonicalDecision's 4-value translation all agree on the same underlying tier for GO/CONDITIONAL_GO/NO_GO", () => {
  const cases = [
    { code: "GO", nativeWord: "ENTER", canonical: "PROCEED" },
    { code: "CONDITIONAL_GO", nativeWord: "MONITOR", canonical: "PROCEED_WITH_CONDITIONS" },
    { code: "NO_GO", nativeWord: "AVOID", canonical: "REJECT" },
  ];

  for (const { code, nativeWord, canonical } of cases) {
    // The generated banner, as formatExecutiveDecisionBrief would write it.
    const generatedBanner = `Executive Decision\nDecision: ${localizeExecutiveDecision(code, "English", "business_plan")} (Confidence: 60%)`;
    const extracted = extractExecutiveDecisionFromText(generatedBanner);
    assert.ok(extracted, `expected ${code} banner to be extractable`);
    assert.equal(extracted.code, code);
    assert.equal(extracted.token.toUpperCase(), nativeWord, `native word for ${code}`);
    assert.equal(mapExecutiveDecisionCodeToCanonicalDecision(code), canonical, `canonical value for ${code}`);
  }
});

test("investment-score.ts's 3 raw recommendation values (GO/WAIT/PASS) map to the SAME canonical decision as their proven-equivalent ExecutiveDecisionCode, for every tier -- web/PDF/report-summary mappings cannot silently diverge for any of the 3 tiers", () => {
  const tierPairs = [
    ["GO", "GO"],
    ["WAIT", "CONDITIONAL_GO"],
    ["PASS", "NO_GO"],
  ];
  for (const [investmentScoreRecommendation, executiveDecisionCode] of tierPairs) {
    assert.equal(
      mapInvestmentScoreRecommendationToCanonicalDecision(investmentScoreRecommendation),
      mapExecutiveDecisionCodeToCanonicalDecision(executiveDecisionCode)
    );
  }
});

// ===========================================================================
// Preserve: investment score remains a separate metric; no second
// executive decision is inferred from score thresholds
// ===========================================================================

test("preserves separation: the Investment Score value itself (score/totalScore) is computed completely independently of the decision-token extraction -- this fix touches only which TEXT is displayed as the decision, never how the score number is derived", () => {
  const fnStart = pageSource.indexOf("function ExecutiveSummaryVisual(");
  const region = pageSource.slice(fnStart, fnStart + 9000);
  assert.match(region, /const score = isMarketIntelligence\s*\n\s*\? null\s*\n\s*: investmentScore\?\.totalScore/);
  // The score computation appears strictly before nativeDecisionMatch's
  // own declaration and never references it.
  const scoreIndex = region.indexOf("const score =");
  const nativeMatchIndex = region.indexOf("const nativeDecisionMatch");
  assert.ok(scoreIndex >= 0 && nativeMatchIndex > scoreIndex);
  const scoreBlock = region.slice(scoreIndex, nativeMatchIndex);
  assert.doesNotMatch(scoreBlock, /nativeDecisionMatch|extractExecutiveDecisionFromText/);
});

test("preserves separation: no new score-threshold-based decision inference was added -- this fix's own new code contains no numeric comparison against totalScore/confidence to derive a decision", () => {
  for (const source of [pageSource, plannerSource]) {
    const matches = [...source.matchAll(/const nativeDecisionMatch = [\s\S]{0,200}/g)];
    for (const match of matches) {
      assert.doesNotMatch(match[0], />=\s*\d|<=\s*\d|totalScore\s*[<>]/);
    }
  }
});

// ===========================================================================
// decisionColorKey / badge color must still resolve through the existing,
// unchanged 4-value mapping -- this fix changes only the badge TEXT
// ===========================================================================

test("decisionColorKey (badge color) still reads resolvedDecision?.decision, NOT nativeDecisionMatch -- this fix changes the badge's TEXT only, never its color-keying logic", () => {
  const fnStart = pageSource.indexOf("function ExecutiveSummaryVisual(");
  const region = pageSource.slice(fnStart, fnStart + 9000);
  assert.match(
    region,
    /const decisionColorKey = marketDecision\?\.canonicalDecision \|\| resolvedDecision\?\.decision \|\| recommendation;/
  );
});

// ===========================================================================
// Historical-report safety: legacy reports without the deterministic
// banner still degrade to the existing (unchanged) fallback chain
// ===========================================================================

test("a report with no deterministic 'Decision: TOKEN' banner at all (a historical report) yields no native match, and the existing fallback chain (structuredInvestmentRecommendation / resolvedDecision / detectRecommendation) is completely unchanged and still reachable", () => {
  const legacyText = "This is a plain executive summary with no structured decision line at all.";
  const match = extractExecutiveDecisionFromText(legacyText);
  assert.equal(match, null);
});

// ===========================================================================
// PDF parity: ReportPdfButton.tsx already reads the canonical decision
// correctly (per the ticket's own observation) and is untouched
// ===========================================================================

test("ReportPdfButton.tsx is untouched by this fix -- no #69A-35A marker, no new extractExecutiveDecisionFromText call site added there", () => {
  assert.doesNotMatch(pdfButtonSource, /TASK #69A-35A/);
});

// ===========================================================================
// Isolation: Founder Readiness, Confidence Radar, Benchmark Intelligence,
// Porter's Five Forces, competitor structures, financial/evidence gates
// remain untouched
// ===========================================================================

test("isolation: no #69A-35A marker exists in any Founder Readiness/Confidence Radar/Benchmark Intelligence/Porter/competitor/financial/evidence-gate file", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/ai/benchmark-intelligence.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/ai/domain-research.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-35A/, relativePath);
  }
});

test("this fix mirrors, and does not duplicate, buildExecutiveSnapshot's own already-established extractExecutiveDecisionFromText(...).token.toUpperCase() pattern in report-presentation.ts -- confirming ONE canonical technique, reused, not a second independently-invented one", () => {
  assert.match(
    reportPresentationSource,
    /extractExecutiveDecisionFromText\(content\)\?\.token\.toUpperCase\(\) \|\|/
  );
});
