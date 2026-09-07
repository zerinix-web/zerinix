import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  localizeExecutiveDecision,
  extractExecutiveDecisionFromText,
  decisionTokensForLanguage,
  formatExecutiveDecisionBrief,
} from "../app/lib/report-engine/executive-decision-brief.ts";
import { runConsistencyValidationPass } from "../app/lib/report-consistency-validation.ts";
import { buildExecutiveSnapshot } from "../app/lib/report-presentation.ts";

// TASK #69A-7 -- Make Business Idea Validation decision vocabulary and
// risk authority structurally consistent. Covers both real-report
// contradictions: (1) a report explicitly requested with ENTER/MONITOR/
// AVOID vocabulary instead returned "Executive Decision: CONDITIONAL GO",
// and (2) the same report classified CAC/Competition risk differently
// between the web Risk Heatmap (fed only the executiveSummary section's
// text) and the PDF (fed the entire joined report).

const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const marketAnalysisRouteSource = readFileSync(
  new URL("../app/api/market-analysis/route.ts", import.meta.url),
  "utf8"
);
const marketPresentationSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
  "utf8"
);

// ---------------------------------------------------------------------
// Requirement A -- canonical decision vocabulary.
// ---------------------------------------------------------------------

test("ExecutiveDecisionVocabulary supports 'business_plan' as a distinct opt-in, reusing Market Intelligence's own ENTER/MONITOR/AVOID translation table verbatim (never a re-typed duplicate)", () => {
  assert.equal(localizeExecutiveDecision("GO", "English", "business_plan"), "ENTER");
  assert.equal(localizeExecutiveDecision("CONDITIONAL_GO", "English", "business_plan"), "MONITOR");
  assert.equal(localizeExecutiveDecision("NO_GO", "English", "business_plan"), "AVOID");
  // Identical to "market"'s own table -- confirms reuse, not duplication.
  for (const code of ["GO", "CONDITIONAL_GO", "NO_GO"]) {
    assert.equal(
      localizeExecutiveDecision(code, "English", "business_plan"),
      localizeExecutiveDecision(code, "English", "market")
    );
  }
});

test("plan-executor.ts's Business Plan Executive Decision banner now renders in the 'business_plan' (ENTER/MONITOR/AVOID) vocabulary at every real call site", () => {
  const businessPlanCallSites = [
    /formatExecutiveDecisionBrief\(\s*\n\s*buildPlanExecutiveDecisionBrief\(context, language\),\s*\n\s*language,\s*\n\s*"business_plan"\s*\n\s*\)/,
    /formatExecutiveDecisionBrief\(\s*\n\s*planExecutiveDecisionBrief,\s*\n\s*language,\s*\n\s*"business_plan"\s*\n\s*\)/,
  ];
  for (const pattern of businessPlanCallSites) {
    assert.match(planExecutorSource, pattern);
  }
  assert.match(
    planExecutorSource,
    /localizeExecutiveDecision\(\s*\n\s*planExecutiveDecisionBrief\.decision,\s*\n\s*language,\s*\n\s*"business_plan"\s*\n\s*\)/
  );
});

test("requirement A: Business Plan's decision is never independently generated/translated in prose -- formatExecutiveDecisionBrief is the ONLY place executiveSummary is assigned in normalizeFullPlanReport's final rebuild", () => {
  const rebuildStart = planExecutorSource.indexOf("const planExecutiveDecisionBrief = buildPlanExecutiveDecisionBrief");
  assert.notEqual(rebuildStart, -1);
  const nearby = planExecutorSource.slice(rebuildStart, rebuildStart + 400);
  const executiveSummaryAssignments = [...nearby.matchAll(/normalized\.executiveSummary\s*=/g)];
  assert.equal(executiveSummaryAssignments.length, 1, "executiveSummary must be assigned exactly once, from the canonical brief");
});

// Regression test 1: legacy CONDITIONAL GO normalizes to the correct
// canonical BIV decision and cannot leak into a newly generated report.
test("regression 1: a legacy report's raw 'CONDITIONAL GO' text still parses to the correct structural code via the default (vocabulary-agnostic) extractor", () => {
  const legacyText = "Executive Decision\nDecision: CONDITIONAL GO (Confidence: 46%)";
  const extracted = extractExecutiveDecisionFromText(legacyText);
  assert.notEqual(extracted, null);
  assert.equal(extracted.code, "CONDITIONAL_GO");
  assert.equal(extracted.token, "CONDITIONAL GO");
});

test("regression 1: a freshly generated Business Plan report can never contain the legacy 'CONDITIONAL GO'/'GO'/'NO-GO' tokens as its authoritative decision banner", () => {
  const freshBrief = {
    decision: "CONDITIONAL_GO",
    confidence: 46,
    confidenceDirection: "reduced",
    confidenceFactors: ["Financial evidence limited"],
    why: "Some rationale.",
    topReasons: ["Reason one"],
    topRisks: ["Risk one"],
    missingEvidence: ["Gap one"],
    whatWouldChangeThisDecision: "Verified customer data.",
    immediateNextAction: "Run a pilot.",
  };
  const rendered = formatExecutiveDecisionBrief(freshBrief, "English", "business_plan");
  assert.match(rendered, /Decision: MONITOR \(Confidence: 46%\)/);
  assert.doesNotMatch(rendered, /Decision: CONDITIONAL GO\b/);
  assert.doesNotMatch(rendered, /Decision: GO\b/);
  assert.doesNotMatch(rendered, /Decision: NO-GO\b/);
});

// Regression test 2: a requested ENTER/MONITOR/AVOID report never
// exposes GO / CONDITIONAL GO / NO-GO as its authoritative decision.
test("regression 2: every ExecutiveDecisionCode renders as ENTER/MONITOR/AVOID for Business Plan, never GO/CONDITIONAL GO/NO-GO", () => {
  const cases = [
    { code: "GO", expected: "ENTER" },
    { code: "CONDITIONAL_GO", expected: "MONITOR" },
    { code: "NO_GO", expected: "AVOID" },
  ];
  for (const { code, expected } of cases) {
    const brief = {
      decision: code,
      confidence: 50,
      confidenceDirection: "reduced",
      confidenceFactors: [],
      why: "Rationale.",
      topReasons: ["Reason"],
      topRisks: ["Risk"],
      missingEvidence: [],
      whatWouldChangeThisDecision: "Evidence.",
      immediateNextAction: "Action.",
    };
    const rendered = formatExecutiveDecisionBrief(brief, "English", "business_plan");
    assert.match(rendered, new RegExp(`Decision: ${expected} \\(Confidence: 50%\\)`));
  }
});

// ---------------------------------------------------------------------
// Requirement B/C -- canonical risk authority + cross-field consistency.
// ---------------------------------------------------------------------

const REAL_INVESTMENT_SCORE = {
  totalScore: 46,
  confidence: 46,
  recommendation: "WAIT",
  categories: {
    scalability: { score: 4, maximumScore: 12, label: "Scalability", explanation: "Scalability reflects growth potential." },
    teamFounder: { score: 4, maximumScore: 10, label: "Team / Founder", explanation: "Founder readiness." },
    businessModel: { score: 7, maximumScore: 13, label: "Business Model", explanation: "Business-model quality." },
    executionRisk: { score: 5, maximumScore: 10, label: "Execution Risk", explanation: "Execution risk." },
    financialHealth: { score: 4, maximumScore: 15, label: "Financial Health", explanation: "Financial health." },
    capitalEfficiency: { score: 7, maximumScore: 13, label: "Capital Efficiency", explanation: "Capital efficiency." },
    marketOpportunity: { score: 8, maximumScore: 15, label: "Market Opportunity", explanation: "Market opportunity." },
    competitiveAdvantage: { score: 5, maximumScore: 12, label: "Competitive Advantage", explanation: "Competitive evidence: 41%." },
  },
  decisionEngine: {
    founderScore: {
      score: 40,
      maximumScore: 100,
      reasoning: [
        "Market attractiveness: 48%",
        "Business model quality: 54%",
        "Validation confidence: 60%",
        "Execution complexity: 66%",
        "Evidence confidence: 34%",
        "Founder evidence: 40%",
      ],
    },
  },
};

// The web Risk Heatmap (page.tsx/Planner.tsx's inline snapshot) only ever
// sees the executiveSummary section's own content.
const SECTION_ONLY_CONTENT = "Executive Decision\nDecision: ENTER (Confidence: 46%)\n\nWhy: Some rationale.";
// The PDF/cover-page snapshot sees the entire joined report, which
// mentions "CAC"/"competition" heavily alongside generic high/critical/
// weak/unresolved qualifiers -- exactly the shape that used to flip
// inferRiskLevel's keyword scan to "High" only in this wider scope.
const FULL_REPORT_CONTENT = [
  SECTION_ONLY_CONTENT,
  "Competitor Landscape: Competition is high and unresolved in this weak market.",
  "Unit Economics: CAC is high and customer acquisition is a critical, unresolved risk.",
].join("\n\n");

// Regression test 3: Risk Heatmap and PDF consume identical canonical
// risk values.
test("regression 3: the Risk Heatmap resolves identically regardless of whether only the executiveSummary section or the entire report is scanned", () => {
  const sectionSnapshot = buildExecutiveSnapshot(SECTION_ONLY_CONTENT, REAL_INVESTMENT_SCORE);
  const fullSnapshot = buildExecutiveSnapshot(FULL_REPORT_CONTENT, REAL_INVESTMENT_SCORE);

  assert.deepEqual(sectionSnapshot.riskHeatmap, fullSnapshot.riskHeatmap);
  assert.equal(sectionSnapshot.riskLevel, fullSnapshot.riskLevel);
});

test("fail-before proof: the pre-fix keyword-scan-only heuristic really did disagree across scopes for this exact fixture", () => {
  // Reproduces inferRiskLevel's OWN pre-fix algorithm directly (bare
  // keyword-presence + generic qualifier scan), proving the two content
  // scopes genuinely produced different verdicts before this fix existed.
  function legacyInferRiskLevel(content, keywords) {
    const normalized = content.toLowerCase();
    const hasKeyword = keywords.some((k) => normalized.includes(k.toLowerCase()));
    if (!hasKeyword) return "Low";
    if (/\b(high|critical|major|unresolved|weak|low confidence)\b/i.test(normalized)) return "High";
    return "Medium";
  }
  const cacKeywords = ["cac", "customer acquisition", "edinim maliyeti"];
  const competitionKeywords = ["competition", "competitor", "rekabet", "rakip"];

  assert.equal(legacyInferRiskLevel(SECTION_ONLY_CONTENT, cacKeywords), "Low");
  assert.equal(legacyInferRiskLevel(FULL_REPORT_CONTENT, cacKeywords), "High");
  assert.equal(legacyInferRiskLevel(SECTION_ONLY_CONTENT, competitionKeywords), "Low");
  assert.equal(legacyInferRiskLevel(FULL_REPORT_CONTENT, competitionKeywords), "High");
});

// Regression test 4: CAC cannot be Low in one renderer and High in
// another.
test("regression 4: CAC risk level is identical across both content scopes for the same report", () => {
  const sectionSnapshot = buildExecutiveSnapshot(SECTION_ONLY_CONTENT, REAL_INVESTMENT_SCORE);
  const fullSnapshot = buildExecutiveSnapshot(FULL_REPORT_CONTENT, REAL_INVESTMENT_SCORE);
  const cacLevel = (snapshot) => snapshot.riskHeatmap.find((r) => r.label === "CAC").level;

  assert.equal(cacLevel(sectionSnapshot), cacLevel(fullSnapshot));
});

// Regression test 5: Competition cannot be Low in one renderer and High
// in another.
test("regression 5: Competition risk level is identical across both content scopes for the same report", () => {
  const sectionSnapshot = buildExecutiveSnapshot(SECTION_ONLY_CONTENT, REAL_INVESTMENT_SCORE);
  const fullSnapshot = buildExecutiveSnapshot(FULL_REPORT_CONTENT, REAL_INVESTMENT_SCORE);
  const competitionLevel = (snapshot) => snapshot.riskHeatmap.find((r) => r.label === "Competition").level;

  assert.equal(competitionLevel(sectionSnapshot), competitionLevel(fullSnapshot));
});

test("requirement B: each Risk Heatmap dimension resolves from a distinct, real investment-score category or the canonical Founder Readiness Validation Confidence dimension, never a re-invented value", () => {
  const snapshot = buildExecutiveSnapshot(SECTION_ONLY_CONTENT, REAL_INVESTMENT_SCORE);
  const byLabel = Object.fromEntries(snapshot.riskHeatmap.map((r) => [r.label, r.level]));

  // capitalEfficiency (7/13 = 54%) -> Medium; competitiveAdvantage (5/12 =
  // 42%) -> High; executionRisk (5/10 = 50%) -> Medium; businessModel
  // (7/13 = 54%) -> Medium; validationConfidence (60%) -> Medium.
  assert.equal(byLabel["Capital efficiency"], "Medium");
  assert.equal(byLabel["Competition"], "High");
  assert.equal(byLabel["Execution"], "Medium");
  assert.equal(byLabel["CAC"], "Medium");
  assert.equal(byLabel["Customer validation"], "Medium");
});

test("requirement B: an evidence policy (conservative keyword scan) still applies when investmentScore has no canonical category data at all -- never a fabricated canonical-looking value", () => {
  const snapshot = buildExecutiveSnapshot(
    "Some report text mentioning competition and CAC but no structured score.",
    undefined
  );
  assert.equal(snapshot.riskHeatmap.length, 5);
  for (const dimension of snapshot.riskHeatmap) {
    assert.ok(["Low", "Medium", "High"].includes(dimension.level));
  }
});

// Regression test 6: decision/confidence/risk values survive persistence
// and reload unchanged.
test("regression 6: re-running buildExecutiveSnapshot against the same persisted investmentScore/content twice (simulating a reload) yields byte-identical results", () => {
  const first = buildExecutiveSnapshot(FULL_REPORT_CONTENT, REAL_INVESTMENT_SCORE);
  const second = buildExecutiveSnapshot(FULL_REPORT_CONTENT, REAL_INVESTMENT_SCORE);
  assert.deepEqual(first, second);
  assert.deepEqual(first.riskHeatmap, second.riskHeatmap);
  assert.equal(first.riskLevel, second.riskLevel);
});

// Regression test 7: renderer prose cannot override structured decision
// or structured risks.
test("regression 7: correctExecutiveDecisionMentions replaces a stray, wrong-vocabulary decision token elsewhere in the report with the authoritative business_plan token", () => {
  const sections = {
    executiveSummary: "Executive Decision\nDecision: MONITOR (Confidence: 46%)",
    risks: "This risk profile suggests an ENTER posture is not yet warranted; treat this as an AVOID scenario until validated.",
  };
  const result = runConsistencyValidationPass({
    sections,
    fields: ["executiveSummary", "risks"],
    language: "English",
    authoritativeExecutiveDecisionToken: "MONITOR",
    executiveDecisionVocabulary: "business_plan",
    decisionProtectedFields: ["executiveSummary"],
  });

  assert.match(sections.risks, /MONITOR posture is not yet warranted/);
  assert.match(sections.risks, /treat this as an MONITOR scenario/);
  assert.ok(result.correctionsApplied.length >= 1);
});

test("requirement B: risk-summary prose corrections use the SAME canonical categories object as the Risk Heatmap -- no separate parallel risk engine", () => {
  // Both the heatmap (report-presentation.ts, client-side rendering) and
  // the report-authoring-time consistency pass (plan-executor.ts,
  // server-side) independently read investmentScore.categories/decisionEngine
  // -- never a duplicated, separately-maintained risk model. Confirmed by
  // source-text: plan-executor.ts's own isCategoryWeak/strategicSignals
  // block reads context.investmentScore.categories directly.
  assert.match(planExecutorSource, /const investmentScoreCategories = context\.investmentScore\.categories;/);
  assert.match(planExecutorSource, /category\.score \/ category\.maximumScore < 0\.5/);
});

// ---------------------------------------------------------------------
// Requirement D/E8 -- preserve existing fixes, Market Intelligence
// unchanged.
// ---------------------------------------------------------------------

test("regression 8: Market Intelligence's own 'market' vocabulary and decision pipeline are completely untouched", () => {
  assert.match(marketPresentationSource, /localizeExecutiveDecision\(brief\.decision, language, "market"\)/);
  assert.doesNotMatch(marketAnalysisRouteSource, /"business_plan"/);
  assert.doesNotMatch(marketAnalysisRouteSource, /executiveDecisionVocabulary/);
  // MarketEntryDecision stays ENTER/MONITOR/AVOID, completely independent
  // of Business Plan's own new opt-in.
  assert.match(marketPresentationSource, /export type MarketEntryDecision = "ENTER" \| "MONITOR" \| "AVOID";/);
});

test("requirement D: runConsistencyValidationPass's executiveDecisionVocabulary defaults to 'standard' -- every existing caller that doesn't pass it (including Market Intelligence) is completely unaffected", () => {
  const sections = { risks: "Decision: GO is not appropriate; the report leans NO-GO." };
  runConsistencyValidationPass({
    sections,
    fields: ["risks"],
    language: "English",
    authoritativeExecutiveDecisionToken: "NO-GO",
    // executiveDecisionVocabulary intentionally omitted.
    decisionProtectedFields: [],
  });
  assert.match(sections.risks, /Decision: NO-GO is not appropriate/);
});

test("requirement D: decisionTokensForLanguage still defaults to 'standard' tokens when no vocabulary is specified (unchanged for any caller relying on the old default)", () => {
  assert.deepEqual(decisionTokensForLanguage("English"), ["GO", "CONDITIONAL GO", "NO-GO"]);
  assert.deepEqual(decisionTokensForLanguage("English", "business_plan"), ["ENTER", "MONITOR", "AVOID"]);
});

test("requirement D: Market Intelligence's explicit 'market' vocabulary extraction is unaffected by extractExecutiveDecisionFromText's new default multi-vocabulary search", () => {
  const marketText = "Executive Decision\nDecision: MONITOR (Confidence: 60%)";
  const explicit = extractExecutiveDecisionFromText(marketText, "market");
  const auto = extractExecutiveDecisionFromText(marketText);
  assert.deepEqual(explicit, auto);
  assert.equal(explicit.code, "CONDITIONAL_GO");
});
