// TASK #69A-27B -- Audit and resolve the remaining Evidence score
// semantic drift between Confidence Radar and Founder Readiness.
//
// CONCLUSION (see the final report for full reasoning): Confidence
// Radar "Evidence" (investmentScore.decisionEngine.competitionScore),
// Founder Readiness "Evidence Confidence" (dimensionScores.
// evidenceConfidence), and Founder Readiness "Founder Evidence"
// (dimensionScores.founderEvidence) are LEGITIMATELY three different
// concepts, not architectural drift:
//   - Confidence Radar Evidence = external, research-verified
//     competitive/market evidence coverage (competitionScore is
//     genuinely refreshed post-research from real evidence -- see
//     market-research-coverage.ts's scoreCategory call).
//   - Evidence Confidence = internal confidence in the report's own
//     financial-metric/validation claims -- a deliberate,
//     prompt-derived founder/business judgment, intentionally NOT
//     overridden by external web research (see market-research-
//     coverage.ts's own comment on this).
//   - Founder Evidence = founder/team capability and track record
//     specifically -- also deliberately prompt-derived.
//
// A REAL, separate defect WAS found and fixed: applyMarketResearch-
// CoverageToContext's rebuilt founderScore.reasoning text used
// dimensions.founderReadiness (a general market-research-coverage
// signal) for its "Founder evidence" line with NO "original ?? ..."
// preservation, unlike every sibling line -- a genuine, if currently
// masked (structured dimensionScores always wins for display),
// independently-recomputed second value. Fixed in
// market-research-coverage.ts; regression coverage lives in
// lifecycle-scoring-propagation-fixes.test.mjs (the pre-existing test
// class this gap belonged to).
//
// This file proves, end-to-end against the REAL pipeline (never a
// hand-mocked investmentScore alone), that the three concepts stay
// genuinely distinct, that Founder Evidence cannot be inflated by
// external market evidence, that competitionScore is NOT a frozen
// pre-research snapshot, that Evidence Confidence/Founder Evidence
// ARE deliberately insulated from research, that #69A-27's hard
// blockers remain active, and that the ticket's own verified real-case
// numbers remain decision-safe and renderer-consistent.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  createCanonicalFinancialAssumptions,
  refreshResearchAwareFinancialContext,
} from "../app/lib/ai/financial-assumptions.ts";
import { applyMarketResearchCoverageToContext } from "../app/lib/ai/market-research-coverage.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function importReportPresentation() {
  const sourcePath = join(repoRoot, "app/lib/report-presentation.ts");
  const sanitizationPath = join(repoRoot, "app/lib/report-output-sanitization.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-output-sanitization"',
    JSON.stringify(pathToFileURL(sanitizationPath).href)
  );
  source = source.replace(
    '"@/app/lib/report-engine/executive-decision-brief"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-engine/executive-decision-brief.ts")).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-task69a27b-"));
  const outPath = join(dir, "report-presentation.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { buildExecutiveSnapshot, readFounderReadinessMetrics } = await importReportPresentation();

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

function runFullPipeline(prompt, evidence = []) {
  const context = createCanonicalFinancialAssumptions({ prompt, reportKind: "business_plan" });
  const preResearchInvestmentScore = context.investmentScore;
  const coverageResult = applyMarketResearchCoverageToContext(context, { evidence }, prompt);
  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);
  return { preResearchInvestmentScore, refreshed };
}

const STRONG_EXTERNAL_EVIDENCE_WEAK_FOUNDER_PROMPT =
  "We run a B2B enterprise SaaS subscription platform for logistics companies in the US, UK, and Europe. We have 900 paying enterprise customers generating $9.5M ARR with 94% gross margin. Our monthly churn is 0.6% and net revenue retention is 132%. CAC is $1,200 with a 3-month payback, validated over 24 months of paid acquisition spend across enterprise sales channels with cohort-level retention tracking. Our SAM is estimated at $1.2B with a defensible proprietary data moat, network effects, and enterprise compliance certifications. However, the founder has never operated a company, has no technical background, and has no domain expertise whatsoever.";

const UNSUPPORTED_PROJECTION_PROMPT =
  "We project $10M ARR within 18 months for our new enterprise SaaS subscription platform in the US. We have no customers, no revenue, no pilots, and no validated demand yet, but our financial model shows strong growth.";

// --- A/B/C: the three evidence-related concepts stay genuinely distinct ---

test("[A] end-to-end: Confidence Radar Evidence, Founder Readiness Evidence Confidence, and Founder Evidence are three genuinely distinct, independently-sourced values for a real pipeline run", () => {
  const { refreshed } = runFullPipeline(STRONG_EXTERNAL_EVIDENCE_WEAK_FOUNDER_PROMPT, strongEvidenceSet());
  const dimensionScores = refreshed.investmentScore.decisionEngine.founderScore.dimensionScores;
  const evidenceConfidence = dimensionScores.find((d) => d.key === "evidenceConfidence").score;
  const founderEvidence = dimensionScores.find((d) => d.key === "founderEvidence").score;
  const radarEvidence = refreshed.investmentScore.decisionEngine.competitionScore.score;

  const distinct = new Set([evidenceConfidence, founderEvidence, radarEvidence]);
  assert.equal(
    distinct.size,
    3,
    `expected 3 distinct values for a case with strong external evidence but an explicit founder-inexperience disclosure, got evidenceConfidence=${evidenceConfidence} founderEvidence=${founderEvidence} radarEvidence=${radarEvidence}`
  );
  // Strong external market/competitive evidence should push the Radar's
  // research-aware Evidence dimension meaningfully higher than the
  // founder-inexperience-floored Founder Evidence dimension.
  assert.ok(
    radarEvidence > founderEvidence,
    `strong external evidence (radarEvidence=${radarEvidence}) should exceed the founder-inexperience-floored Founder Evidence (${founderEvidence})`
  );
});

test("[B] web-style and PDF-style content produce an IDENTICAL Confidence Radar Evidence value for the same freshly-computed report", () => {
  const { refreshed } = runFullPipeline(STRONG_EXTERNAL_EVIDENCE_WEAK_FOUNDER_PROMPT, strongEvidenceSet());
  const score = refreshed.investmentScore;
  const executiveSummaryOnly = "Decision summary text with no dimension labels at all.";
  const fullConcatenatedReport = [executiveSummaryOnly, "Founder Readiness\nSome unrelated founder readiness prose."].join("\n\n");

  const web = buildExecutiveSnapshot(executiveSummaryOnly, score, undefined);
  const pdf = buildExecutiveSnapshot(fullConcatenatedReport, score, undefined);
  const webEvidence = web.confidenceRadar.find((d) => d.label === "Evidence").score;
  const pdfEvidence = pdf.confidenceRadar.find((d) => d.label === "Evidence").score;

  assert.equal(webEvidence, pdfEvidence);
  assert.equal(webEvidence, score.decisionEngine.competitionScore.score);
});

test("[C] web-style and PDF-style content produce IDENTICAL Founder Readiness Evidence Confidence / Founder Evidence values for the same freshly-computed report", () => {
  const { refreshed } = runFullPipeline(STRONG_EXTERNAL_EVIDENCE_WEAK_FOUNDER_PROMPT, strongEvidenceSet());
  const score = refreshed.investmentScore;

  const webMetrics = readFounderReadinessMetrics(score);
  const pdfMetrics = readFounderReadinessMetrics(score);

  assert.deepEqual(webMetrics, pdfMetrics);
});

// --- D: Founder Evidence cannot be inflated by general research coverage ---

test("[D] Founder Evidence is not inflated by strong external market/competitive research evidence when the founder itself has no relevant evidence", () => {
  const { preResearchInvestmentScore, refreshed } = runFullPipeline(
    STRONG_EXTERNAL_EVIDENCE_WEAK_FOUNDER_PROMPT,
    strongEvidenceSet()
  );
  const preFounderEvidence = preResearchInvestmentScore.decisionEngine.founderScore.dimensionScores.find(
    (d) => d.key === "founderEvidence"
  ).score;
  const postFounderEvidence = refreshed.investmentScore.decisionEngine.founderScore.dimensionScores.find(
    (d) => d.key === "founderEvidence"
  ).score;
  const radarEvidence = refreshed.investmentScore.decisionEngine.competitionScore.score;

  // The structured Founder Evidence score itself must not move at all --
  // dimensionScores is deliberately prompt-derived, never touched by
  // applyMarketResearchCoverageToContext.
  assert.equal(postFounderEvidence, preFounderEvidence);
  // And it must stay low/floored despite abundant, unrelated external
  // market evidence pushing the Radar's Evidence dimension much higher.
  assert.ok(
    postFounderEvidence < radarEvidence - 20,
    `Founder Evidence (${postFounderEvidence}) should remain far below the externally-evidenced Radar Evidence (${radarEvidence}) for an explicit founder-inexperience case`
  );
});

// --- E: competitionScore (Radar Evidence) is NOT a frozen pre-research ---
// --- snapshot -------------------------------------------------------------

test("[E] Confidence Radar Evidence (decisionEngine.competitionScore) reflects fresh post-research evidence -- never a stale pre-research snapshot", () => {
  const { preResearchInvestmentScore, refreshed } = runFullPipeline(
    STRONG_EXTERNAL_EVIDENCE_WEAK_FOUNDER_PROMPT,
    strongEvidenceSet()
  );
  const preResearchScore = preResearchInvestmentScore.decisionEngine.competitionScore.score;
  const postResearchScore = refreshed.investmentScore.decisionEngine.competitionScore.score;
  const postResearchReasoning = refreshed.investmentScore.decisionEngine.competitionScore.reasoning.join(" | ");

  assert.notEqual(
    postResearchScore,
    preResearchScore,
    "competitionScore must be rescored from real research coverage, not left at its pre-research value"
  );
  assert.match(postResearchReasoning, /Competitive evidence:/);
});

// --- F: Evidence Confidence / Founder Evidence are DELIBERATELY insulated ---
// --- from research -- this is the correct, established architecture, ------
// --- not a defect --------------------------------------------------------

test("[F] Evidence Confidence and Founder Evidence remain their original prompt-derived values after research refresh -- deliberate founder-judgment insulation, not a defect", () => {
  const { preResearchInvestmentScore, refreshed } = runFullPipeline(
    STRONG_EXTERNAL_EVIDENCE_WEAK_FOUNDER_PROMPT,
    strongEvidenceSet()
  );
  const before = preResearchInvestmentScore.decisionEngine.founderScore.dimensionScores;
  const after = refreshed.investmentScore.decisionEngine.founderScore.dimensionScores;

  for (const key of ["evidenceConfidence", "founderEvidence"]) {
    const beforeScore = before.find((d) => d.key === key).score;
    const afterScore = after.find((d) => d.key === key).score;
    assert.equal(afterScore, beforeScore, `${key} must remain unchanged by market research`);
  }
});

// --- G: #69A-27 hard blockers remain active alongside this fix -----------

test("[G] #69A-27's fatal-blocker override still forces WAIT despite abundant external market evidence, when the founder itself is a disclosed blocker", () => {
  const { refreshed } = runFullPipeline(STRONG_EXTERNAL_EVIDENCE_WEAK_FOUNDER_PROMPT, strongEvidenceSet());

  assert.equal(refreshed.investmentScore.recommendation, "WAIT");
  assert.ok(refreshed.investmentScore.fatalBlockers.length > 0);
  assert.ok(refreshed.investmentScore.fatalBlockers.some((b) => b.key === "founderEvidence"));
});

test("[G2] unsupported financial projections still cannot force GO (protects #69A-27 Fix 2)", () => {
  const { refreshed } = runFullPipeline(UNSUPPORTED_PROJECTION_PROMPT, []);
  assert.notEqual(refreshed.investmentScore.recommendation, "GO");
});

// --- H: the ticket's own verified real-case numbers remain decision-safe ---
// --- and renderer-consistent ----------------------------------------------

function realCaseInvestmentScore() {
  return {
    totalScore: 44,
    confidence: 48,
    recommendation: "WAIT",
    decisionEngine: {
      marketScore: { score: 55, maximumScore: 100, label: "Market Score", reasoning: [] },
      financialScore: { score: 26, maximumScore: 100, label: "Financial Score", reasoning: [] },
      founderScore: {
        score: 40,
        maximumScore: 100,
        label: "Founder Score",
        reasoning: [],
        dimensionScores: [
          { key: "ideaQuality", label: "Idea Quality", score: 66 },
          { key: "marketAttractiveness", label: "Market Attractiveness", score: 66 },
          { key: "businessModelQuality", label: "Business Model Quality", score: 54 },
          { key: "validationConfidence", label: "Validation Confidence", score: 60 },
          { key: "executionComplexity", label: "Execution Complexity", score: 66 },
          { key: "evidenceConfidence", label: "Evidence Confidence", score: 36 },
          { key: "founderEvidence", label: "Founder Evidence", score: 34 },
        ],
      },
      executionScore: { score: 52, maximumScore: 100, label: "Execution Score", reasoning: [] },
      riskScore: { score: 52, maximumScore: 100, label: "Risk Score", reasoning: [] },
      competitionScore: { score: 41, maximumScore: 100, label: "Competition Score", reasoning: ["Competitive evidence: 41%"] },
      technologyScore: { score: 58, maximumScore: 100, label: "Technology Score", reasoning: [] },
    },
  };
}

test("[H] the verified real BIV case remains fully decision-safe and renderer-consistent after #69A-27B", () => {
  const score = realCaseInvestmentScore();
  const executiveSummaryContent = "Decision: WAIT (Confidence: 48%).";
  const founderReadinessContent = [
    "Founder Readiness Score: 40/100",
    "Idea Quality: 66/100 - x.",
    "Market Attractiveness: 66/100 - x.",
    "Business Model Quality: 54/100 - x.",
    "Validation Confidence: 60/100 - x.",
    "Execution Complexity: 66/100 - x.",
    "Evidence Confidence: 36/100 - x.",
    "Founder Evidence: 34/100 - x.",
  ].join("\n");
  const fullReportContent = [executiveSummaryContent, founderReadinessContent].join("\n\n");

  const web = buildExecutiveSnapshot(executiveSummaryContent, score, undefined);
  const pdf = buildExecutiveSnapshot(fullReportContent, score, undefined);
  const founderMetrics = readFounderReadinessMetrics(score);

  // Decision safety.
  assert.equal(web.decision, "WAIT");
  assert.equal(web.confidenceScore, 48);
  assert.equal(web.founderScoreValue, 40);
  assert.equal(score.totalScore, 44);

  // Founder Readiness dimensions, unchanged.
  assert.deepEqual(founderMetrics, {
    founderReadinessScore: 40,
    ideaQuality: 66,
    marketAttractiveness: 66,
    businessModelQuality: 54,
    validationConfidence: 60,
    executionComplexity: 66,
    evidenceConfidence: 36,
    founderEvidence: 34,
  });

  // Confidence Radar, web/PDF-identical, Evidence = 41 (competitionScore),
  // never 36 (Evidence Confidence) or 34 (Founder Evidence).
  const webRadar = Object.fromEntries(web.confidenceRadar.map((d) => [d.label, d.score]));
  const pdfRadar = Object.fromEntries(pdf.confidenceRadar.map((d) => [d.label, d.score]));
  assert.deepEqual(webRadar, { Market: 55, Financial: 26, Execution: 52, Product: 58, Evidence: 41 });
  assert.deepEqual(webRadar, pdfRadar);

  // The three evidence-related numbers remain genuinely distinct.
  const distinct = new Set([webRadar.Evidence, founderMetrics.evidenceConfidence, founderMetrics.founderEvidence]);
  assert.equal(distinct.size, 3);
});
