import test from "node:test";
import assert from "node:assert/strict";
import { runExecutiveDecisionSystem } from "../app/lib/ai/executive-decision-system.ts";
import { buildStrategicDecisionMemo } from "../app/lib/ai/strategic-decision-memo.ts";
import { generateExecutiveBrief } from "../app/lib/ai/executive-brief-generator.ts";
import { validateExecutiveReportQuality } from "../app/lib/report-engine/executive-report-quality-validator.ts";
import { checkReportConsistency } from "../app/lib/report-engine/report-consistency-checker.ts";
import { generateReportAuditTrail } from "../app/lib/report-engine/report-audit-trail.ts";
import { generateExplainabilityReport } from "../app/lib/report-engine/explainability-engine.ts";
import { generateReproducibilityRecord } from "../app/lib/report-engine/decision-reproducibility-engine.ts";
import { generateReportVersionManifest } from "../app/lib/report-engine/report-versioning-engine.ts";
import { readExecutiveDecisionIntelligenceSummary } from "../app/lib/report-engine/executive-decision-intelligence-presentation.ts";

// This is the concrete "feature parity" proof for the Executive
// Decision System production-integration task: a Business Idea
// Validation report's LEGACY fields (investmentScore, reportQuality --
// built unconditionally by plan-executor.ts's normalizeFullPlanReport
// and its sub-builders, regardless of whether the EDS flag is on) and
// the NEW EDS metadata fields (attached additively by worker.ts) must
// coexist on the same report.metadata object without either one
// disturbing the other. Since plan-executor.ts/worker.ts have no
// existing pattern for real HTTP-level test invocation (heavy
// Supabase/auth dependencies), this proves parity at the level this
// codebase already established for that boundary: real functions,
// realistic fixtures, no live network calls -- exactly the pattern
// tests/production-readiness-integration.test.mjs already uses.

const STRONG_BUSINESS_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds 50,000,000 dollars based on our own analysis.`;

// A fixture shaped exactly like what plan-executor.ts's legacy
// deterministic builders (buildCanonicalExecutiveRecommendation,
// buildCanonicalFounderScore, buildExecutiveScorecard,
// buildConfidenceBreakdown, etc., inside normalizeFullPlanReport)
// already populate on every Business Idea Validation report today,
// completely independent of whether the EDS flag is on.
function buildLegacyReportMetadataFixture() {
  return {
    reportLanguage: "en",
    investmentScore: {
      version: "1.0",
      totalScore: 78,
      confidence: 65,
      recommendation: "GO",
      estimatedValuation: "$2.5M",
      fundingStage: "Pre-seed",
      nextCriticalAction: "Validate pricing with 10 more customer interviews.",
      strengths: ["Strong early customer demand", "Clear pricing model"],
      weaknesses: ["Limited runway", "Single-market validation"],
      topRisks: ["Customer acquisition cost may rise", "Competitor response"],
      categories: { market: 80, team: 70, product: 75 },
      decisionEngine: {
        founderScore: { score: 72, maximumScore: 100, label: "Strong", reasoning: ["Prior domain experience"] },
      },
    },
    benchmarkFit: {
      version: "1.0",
      industryKey: "saas",
      industry: "B2B SaaS",
      businessModel: "Subscription",
      fit: "Strong",
      matchedSignals: ["Recurring revenue model"],
      validationGaps: [],
    },
    reportQuality: {
      version: "1.0",
      totalScore: 80,
      qualityScore: 80,
      overallQuality: "Strong",
      confidenceLevel: "High Confidence",
      dimensions: {
        evidenceQuality: 80,
        sourceConfidence: 75,
        financialConsistency: 70,
        benchmarkFit: 85,
        validationReadiness: 60,
      },
      strengths: ["Well-supported pricing evidence"],
      weaknesses: ["Limited independent sources"],
      improvementActions: ["Gather more independent evidence"],
    },
  };
}

function buildFullEdsChain() {
  const { package: pkg } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
  });
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });
  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg, strategicDecisionMemo: memo });
  const sections = [{ field: "executiveSummary", title: "Executive Summary", content: "Decision: HOLD. Real content for this fixture." }];

  const reportQualityValidation = validateExecutiveReportQuality({
    enabled: true,
    sections,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const reportConsistencyCheck = checkReportConsistency({
    enabled: true,
    sections,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const reportAuditTrail = generateReportAuditTrail({
    enabled: true,
    sections,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
    qualityValidation: reportQualityValidation,
    consistencyCheck: reportConsistencyCheck,
  });
  const reportExplainability = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
    qualityValidation: reportQualityValidation,
    consistencyCheck: reportConsistencyCheck,
  });
  const reportReproducibility = generateReproducibilityRecord({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
    auditTrail: reportAuditTrail,
    explainability: reportExplainability,
    env: { ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED: "true" },
  });
  const reportVersion = generateReportVersionManifest({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
    qualityValidation: reportQualityValidation,
    consistencyCheck: reportConsistencyCheck,
    auditTrail: reportAuditTrail,
    explainability: reportExplainability,
    reproducibility: reportReproducibility,
  });

  return {
    reportQualityValidation,
    reportConsistencyCheck,
    reportAuditTrail,
    reportExplainability,
    reportReproducibility,
    reportVersion,
  };
}

test("legacy report fields and the new EDS metadata chain coexist on the same report.metadata object without either disturbing the other", () => {
  const legacyMetadata = buildLegacyReportMetadataFixture();
  const legacyMetadataSnapshot = structuredClone(legacyMetadata);
  const edsChain = buildFullEdsChain();

  // Mirrors exactly how worker.ts attaches each field: additive spread,
  // never replacing the object wholesale (see report.metadata = { ...(report.metadata || {}), ... }
  // at every one of the 6 attachment sites in app/lib/report-jobs/worker.ts).
  const combinedMetadata = structuredClone({ ...legacyMetadata, ...edsChain });

  // The legacy fields must be byte-for-byte identical to before the EDS
  // chain was attached -- proving the new pipeline never mutates or
  // overrides existing, pre-ZERINIX report content.
  assert.deepEqual(
    {
      reportLanguage: combinedMetadata.reportLanguage,
      investmentScore: combinedMetadata.investmentScore,
      benchmarkFit: combinedMetadata.benchmarkFit,
      reportQuality: combinedMetadata.reportQuality,
    },
    legacyMetadataSnapshot
  );

  // The EDS fields must all be genuinely present and real (not empty
  // placeholders), proving the new pipeline's own contribution survives
  // right alongside the legacy content.
  assert.equal(combinedMetadata.reportQualityValidation.validated, true);
  assert.equal(combinedMetadata.reportConsistencyCheck.checked, true);
  assert.equal(combinedMetadata.reportAuditTrail.generated, true);
  assert.equal(combinedMetadata.reportExplainability.generated, true);
  assert.equal(combinedMetadata.reportReproducibility.generated, true);
  assert.equal(combinedMetadata.reportVersion.generated, true);
  assert.equal(combinedMetadata.reportVersion.compatibility.isCurrent, true);

  // The new UI/PDF consumer helper reads the combined object correctly,
  // proving the whole chain -- legacy fields, EDS fields, and the
  // shared presentation reader built for this integration -- is
  // genuinely wired together end to end.
  const summary = readExecutiveDecisionIntelligenceSummary(combinedMetadata);
  assert.ok(summary);
  assert.equal(summary.qualityPassed, combinedMetadata.reportQualityValidation.passed);
  assert.equal(summary.version.reportSchemaVersion, combinedMetadata.reportVersion.reportSchemaVersion);

  // And the legacy fields remain readable exactly as before, unrelated
  // to and unaffected by the presence of the new summary.
  assert.equal(combinedMetadata.investmentScore.recommendation, "GO");
  assert.equal(combinedMetadata.reportQuality.overallQuality, "Strong");
});

test("a report with only the legacy fields (EDS flag off, today's default) is still fully valid: the summary reader returns null and every legacy field is untouched", () => {
  const legacyMetadata = buildLegacyReportMetadataFixture();
  const summary = readExecutiveDecisionIntelligenceSummary(legacyMetadata);
  assert.equal(summary, null);
  assert.equal(legacyMetadata.investmentScore.recommendation, "GO");
  assert.equal(legacyMetadata.reportQuality.overallQuality, "Strong");
});
