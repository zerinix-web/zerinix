import test from "node:test";
import assert from "node:assert/strict";
import { readExecutiveDecisionIntelligenceSummary } from "../app/lib/report-engine/executive-decision-intelligence-presentation.ts";
import { runExecutiveDecisionSystem } from "../app/lib/ai/executive-decision-system.ts";
import { buildStrategicDecisionMemo } from "../app/lib/ai/strategic-decision-memo.ts";
import { generateExecutiveBrief } from "../app/lib/ai/executive-brief-generator.ts";
import { validateExecutiveReportQuality } from "../app/lib/report-engine/executive-report-quality-validator.ts";
import { checkReportConsistency } from "../app/lib/report-engine/report-consistency-checker.ts";
import { generateReportAuditTrail } from "../app/lib/report-engine/report-audit-trail.ts";
import { generateExplainabilityReport } from "../app/lib/report-engine/explainability-engine.ts";
import { generateReproducibilityRecord } from "../app/lib/report-engine/decision-reproducibility-engine.ts";
import { generateReportVersionManifest } from "../app/lib/report-engine/report-versioning-engine.ts";

const STRONG_BUSINESS_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds 50,000,000 dollars based on our own analysis.`;

function buildFullMetadataFixture() {
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
    pkg,
    memo,
    brief,
    metadata: {
      reportQualityValidation,
      reportConsistencyCheck,
      reportAuditTrail,
      reportExplainability,
      reportReproducibility,
      reportVersion,
    },
  };
}

test("returns null when metadata is undefined", () => {
  assert.equal(readExecutiveDecisionIntelligenceSummary(undefined), null);
});

test("returns null when metadata carries only legacy (pre-ZERINIX) fields, with none of the six EDS fields present", () => {
  const summary = readExecutiveDecisionIntelligenceSummary({
    reportLanguage: "en",
    investmentScore: { totalScore: 80, confidence: 70, recommendation: "GO" },
  });
  assert.equal(summary, null);
});

test("returns null when every EDS field is present but disabled (validated/checked/generated all false)", () => {
  const summary = readExecutiveDecisionIntelligenceSummary({
    reportQualityValidation: { enabled: false, validated: false, passed: true, issues: [], validationTrace: [] },
    reportConsistencyCheck: { enabled: false, checked: false, consistent: true, issues: [], checkTrace: [] },
    reportAuditTrail: {
      enabled: false,
      generated: false,
      generatedAt: new Date().toISOString(),
      pipelineVersion: "report-audit-trail@1",
      sections: [],
      auditTrace: [],
    },
  });
  assert.equal(summary, null);
});

test("a fully populated real scenario reports recommendation, verdict, confidence, quality/consistency status, and every module's presence and version, without exposing the raw 64-char fingerprint", () => {
  const fixture = buildFullMetadataFixture();
  const summary = readExecutiveDecisionIntelligenceSummary(fixture.metadata);

  assert.ok(summary);
  assert.equal(summary.qualityPassed, fixture.metadata.reportQualityValidation.passed);
  assert.equal(summary.consistencyPassed, fixture.metadata.reportConsistencyCheck.consistent);
  assert.equal(summary.aggregateConfidence, fixture.memo.confidence.aggregateConfidence);

  assert.equal(summary.auditTrail.present, true);
  assert.equal(summary.auditTrail.pipelineVersion, fixture.metadata.reportAuditTrail.pipelineVersion);
  assert.equal(summary.explainability.present, true);
  assert.equal(summary.explainability.explanationCount, fixture.metadata.reportExplainability.explanations.length);
  assert.equal(summary.reproducibility.present, true);
  assert.equal(summary.reproducibility.status, "fingerprinted");
  assert.equal(summary.reproducibility.selfCheckPassed, true);
  assert.equal(summary.version.present, true);
  assert.equal(summary.version.reportSchemaVersion, fixture.metadata.reportVersion.reportSchemaVersion);
  assert.equal(summary.version.executiveDecisionSystemVersion, "executive-decision-system@1");

  const rawFingerprint = fixture.metadata.reportReproducibility.fingerprint;
  assert.ok(summary.reproducibility.fingerprintExcerpt.length < rawFingerprint.length);
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(rawFingerprint));
  assert.equal(summary.reproducibility.fingerprintExcerpt, `${rawFingerprint.slice(0, 12)}…`);
});

test("recommendation/verdict statements are read verbatim from the real explainability explanations, never re-derived", () => {
  const fixture = buildFullMetadataFixture();
  const summary = readExecutiveDecisionIntelligenceSummary(fixture.metadata);
  const recommendationExplanation = fixture.metadata.reportExplainability.explanations.find((item) => item.type === "recommendation");
  const verdictExplanation = fixture.metadata.reportExplainability.explanations.find((item) => item.type === "verdict");

  assert.equal(summary.recommendation, recommendationExplanation ? recommendationExplanation.statement : null);
  assert.equal(summary.verdict, verdictExplanation ? verdictExplanation.statement : null);
});

test("a partially populated scenario (only reportQualityValidation, matching independently-toggled flags) is non-null but every other sub-field is honestly absent/null", () => {
  const summary = readExecutiveDecisionIntelligenceSummary({
    reportQualityValidation: { enabled: true, validated: true, passed: false, issues: [], validationTrace: [] },
  });

  assert.ok(summary);
  assert.equal(summary.qualityPassed, false);
  assert.equal(summary.consistencyPassed, null);
  assert.equal(summary.recommendation, null);
  assert.equal(summary.verdict, null);
  assert.equal(summary.aggregateConfidence, null);
  assert.equal(summary.auditTrail.present, false);
  assert.equal(summary.auditTrail.generatedAt, null);
  assert.equal(summary.auditTrail.pipelineVersion, null);
  assert.equal(summary.explainability.present, false);
  assert.equal(summary.explainability.explanationCount, 0);
  assert.equal(summary.reproducibility.present, false);
  assert.equal(summary.reproducibility.status, null);
  assert.equal(summary.reproducibility.fingerprintExcerpt, null);
  assert.equal(summary.version.present, false);
});

test("never surfaces a real pipelineVersion/reportSchemaVersion for a module that is present-but-disabled -- only for one that actually generated", () => {
  const summary = readExecutiveDecisionIntelligenceSummary({
    reportQualityValidation: { enabled: true, validated: true, passed: true, issues: [], validationTrace: [] },
    reportAuditTrail: {
      enabled: false,
      generated: false,
      generatedAt: new Date().toISOString(),
      pipelineVersion: "report-audit-trail@1",
      sections: [],
      auditTrace: [],
    },
    reportVersion: {
      enabled: false,
      generated: false,
      generatedAt: new Date().toISOString(),
      reportSchemaVersion: "1.6.0",
      executiveDecisionSystemVersion: null,
      engineVersions: [],
      validationVersion: null,
      consistencyCheckVersion: null,
      explainabilityVersion: null,
      auditTrailVersion: null,
      reproducibilityVersion: null,
      compatibility: {
        currentSchemaVersion: "1.6.0",
        detectedSchemaVersion: "1.0.0",
        isCurrent: false,
        missingGenerations: [],
        backwardCompatible: true,
      },
      versioningTrace: [],
    },
  });

  assert.ok(summary);
  assert.equal(summary.auditTrail.present, false);
  assert.equal(summary.auditTrail.pipelineVersion, null, "a disabled audit trail's own always-populated pipelineVersion must not leak through as if it had run");
  assert.equal(summary.version.present, false);
  assert.equal(summary.version.reportSchemaVersion, null, "a disabled version manifest's own always-populated reportSchemaVersion must not leak through as if it had run");
});
