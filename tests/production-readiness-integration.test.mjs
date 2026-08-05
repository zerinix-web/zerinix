import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runExecutiveDecisionSystem } from "../app/lib/ai/executive-decision-system.ts";
import { buildStrategicDecisionMemo } from "../app/lib/ai/strategic-decision-memo.ts";
import { generateExecutiveBrief } from "../app/lib/ai/executive-brief-generator.ts";
import { validateExecutiveReportQuality } from "../app/lib/report-engine/executive-report-quality-validator.ts";
import { checkReportConsistency } from "../app/lib/report-engine/report-consistency-checker.ts";
import { generateReportAuditTrail, reportAuditTrailResultSchema } from "../app/lib/report-engine/report-audit-trail.ts";
import { generateExplainabilityReport, explainabilityEngineResultSchema } from "../app/lib/report-engine/explainability-engine.ts";
import { generateReproducibilityRecord, reproducibilityRecordSchema } from "../app/lib/report-engine/decision-reproducibility-engine.ts";
import {
  generateReportVersionManifest,
  reportVersionManifestSchema,
  assessReportVersionCompatibility,
} from "../app/lib/report-engine/report-versioning-engine.ts";

// This file is the FINAL production-readiness verification for the
// whole Executive Decision System pipeline (all 9 components: EDS,
// Strategic Decision Memo, Executive Brief, Executive Report Quality
// Validator, Report Consistency Checker, Report Audit Trail
// Generator, Explainability Engine, Decision Reproducibility Engine,
// Report Versioning Engine). It is deliberately separate from -- and
// does not duplicate -- each module's own dedicated test file; this
// one only asserts things that can ONLY be verified by looking at the
// WHOLE chain together: end-to-end wiring order across two real
// production files (app/api/plan/route.ts and
// app/lib/report-jobs/worker.ts), exactly-once execution across the
// entire real pipeline, a real end-to-end run with zero placeholder
// output anywhere in the combined result, and backward compatibility
// for report rows that predate some or all of these modules.

const routeSource = readFileSync("app/api/plan/route.ts", "utf8");
const workerSource = readFileSync("app/lib/report-jobs/worker.ts", "utf8");
const planExecutorSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
const reportInvestmentScoreSource = readFileSync("app/lib/report-investment-score.ts", "utf8");
const pdfButtonSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
const plannerSource = readFileSync("components/Planner.tsx", "utf8");

const STRONG_BUSINESS_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds 50,000,000 dollars based on our own analysis.`;

function runFullPipeline() {
  const { package: executiveDecisionPackage } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
  });
  assert.equal(executiveDecisionPackage.status, "ready_for_report_generation");

  const strategicDecisionMemo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage });
  const executiveBrief = generateExecutiveBrief({
    enabled: true,
    executiveDecisionPackage,
    strategicDecisionMemo,
  });

  const sections = [
    {
      field: "executiveSummary",
      title: "Executive Summary",
      content:
        "Decision: HOLD. This report covers our pricing decision and next steps for the team, based on the evidence gathered so far.",
    },
  ];

  const qualityValidation = validateExecutiveReportQuality({
    enabled: true,
    sections,
    executiveDecisionPackage,
    strategicDecisionMemo,
    executiveBrief,
  });
  const consistencyCheck = checkReportConsistency({
    enabled: true,
    sections,
    executiveDecisionPackage,
    strategicDecisionMemo,
    executiveBrief,
  });
  const auditTrail = generateReportAuditTrail({
    enabled: true,
    sections,
    executiveDecisionPackage,
    strategicDecisionMemo,
    executiveBrief,
    qualityValidation,
    consistencyCheck,
  });
  const explainability = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage,
    strategicDecisionMemo,
    executiveBrief,
    qualityValidation,
    consistencyCheck,
  });
  const reproducibility = generateReproducibilityRecord({
    enabled: true,
    executiveDecisionPackage,
    strategicDecisionMemo,
    executiveBrief,
    auditTrail,
    explainability,
    env: { ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED: "true" },
  });
  const versionManifest = generateReportVersionManifest({
    enabled: true,
    executiveDecisionPackage,
    strategicDecisionMemo,
    executiveBrief,
    qualityValidation,
    consistencyCheck,
    auditTrail,
    explainability,
    reproducibility,
  });

  return {
    executiveDecisionPackage,
    strategicDecisionMemo,
    executiveBrief,
    sections,
    qualityValidation,
    consistencyCheck,
    auditTrail,
    explainability,
    reproducibility,
    versionManifest,
  };
}

// --- Section 1: static wiring audit across the real production files ---

test("route.ts computes Executive Decision System, Strategic Decision Memo, and Executive Brief exactly once each", () => {
  assert.equal((routeSource.match(/runExecutiveDecisionSystem\(/g) || []).length, 1);
  assert.equal((routeSource.match(/buildStrategicDecisionMemo\(/g) || []).length, 1);
  assert.equal((routeSource.match(/generateExecutiveBrief\(/g) || []).length, 1);
});

test("worker.ts never re-runs Executive Decision System, Strategic Decision Memo, or Executive Brief -- it only reads the already-computed request_payload fields", () => {
  assert.equal((workerSource.match(/runExecutiveDecisionSystem\(/g) || []).length, 0);
  assert.equal((workerSource.match(/buildStrategicDecisionMemo\(/g) || []).length, 0);
  assert.equal((workerSource.match(/generateExecutiveBrief\(/g) || []).length, 0);
});

test("plan-executor.ts never runs Executive Decision System, Strategic Decision Memo, or Executive Brief either -- those three builders run exactly once, in route.ts, before the job is ever queued", () => {
  assert.equal((planExecutorSource.match(/runExecutiveDecisionSystem\(|buildStrategicDecisionMemo\(|generateExecutiveBrief\(/g) || []).length, 0);
});

test("worker.ts calls each of the 6 report validation/metadata modules exactly once", () => {
  const calls = [
    "validateExecutiveReportQuality\\(",
    "checkReportConsistency\\(",
    "generateReportAuditTrail\\(",
    "generateExplainabilityReport\\(",
    "generateReproducibilityRecord\\(",
    "generateReportVersionManifest\\(",
  ];
  for (const pattern of calls) {
    const count = (workerSource.match(new RegExp(pattern, "g")) || []).length;
    assert.equal(count, 1, `expected exactly one call matching ${pattern}`);
  }
});

test("the 6 report validation/metadata modules run in the documented pipeline order, all after readExecutionResponse and all before persistCompletedReport", () => {
  const markers = [
    "const report = await readExecutionResponse(response, job.request_payload);",
    "const qualityValidation = validateExecutiveReportQuality({",
    "const consistencyCheck = checkReportConsistency({",
    "const auditTrail = generateReportAuditTrail({",
    "const explainability = generateExplainabilityReport({",
    "const reproducibility = generateReproducibilityRecord({",
    "const versionManifest = generateReportVersionManifest({",
    "const resultPayload = await persistCompletedReport({ supabase, job, report });",
  ];
  const indices = markers.map((marker) => workerSource.indexOf(marker));
  for (const index of indices) {
    assert.ok(index >= 0, "every pipeline marker must be found in worker.ts");
  }
  for (let i = 1; i < indices.length; i += 1) {
    assert.ok(indices[i] > indices[i - 1], `marker ${i} ("${markers[i]}") must come after marker ${i - 1} ("${markers[i - 1]}")`);
  }
});

test("only the Quality Validator and Consistency Checker can block/throw -- the four later modules (audit trail, explainability, reproducibility, versioning) never throw", () => {
  const qualityStart = workerSource.indexOf("const qualityValidation = validateExecutiveReportQuality({");
  const consistencyStart = workerSource.indexOf("const consistencyCheck = checkReportConsistency({");
  const auditTrailStart = workerSource.indexOf("const auditTrail = generateReportAuditTrail({");
  const persistStart = workerSource.indexOf("const persistenceStartedAt = Date.now();");

  const qualityBlock = workerSource.slice(qualityStart, consistencyStart);
  const consistencyBlock = workerSource.slice(consistencyStart, auditTrailStart);
  const postValidationBlock = workerSource.slice(auditTrailStart, persistStart);

  assert.match(qualityBlock, /throw new Error/);
  assert.match(consistencyBlock, /throw new Error/);
  assert.doesNotMatch(postValidationBlock, /throw new Error/);
});

test("persistCompletedReport always spreads the existing report.metadata rather than replacing it wholesale -- every additive field from every module survives persistence", () => {
  assert.match(workerSource, /metadata: \{\s*\.\.\.\(report\.metadata \|\| \{\}\),/);
});

test("all 6 additive ReportMetadata fields exist, are optional, and none replaced an earlier one", () => {
  const additiveFields = [
    "reportQualityValidation\\?:",
    "reportConsistencyCheck\\?:",
    "reportAuditTrail\\?:",
    "reportExplainability\\?:",
    "reportReproducibility\\?:",
    "reportVersion\\?:",
  ];
  for (const pattern of additiveFields) {
    assert.match(reportInvestmentScoreSource, new RegExp(pattern));
  }
  // Pre-existing, pre-ZERINIX fields must remain completely untouched.
  for (const legacyField of ["reportLanguage\\?:", "investmentScore\\?:", "benchmarkFit\\?:", "reportQuality\\?:"]) {
    assert.match(reportInvestmentScoreSource, new RegExp(legacyField));
  }
});

test("no UI, PDF, or Planner component references any of the 9 pipeline modules -- integration is confined to route.ts and worker.ts", () => {
  const moduleNames = [
    "executive-decision-system",
    "strategic-decision-memo",
    "executive-brief-generator",
    "executive-report-quality-validator",
    "report-consistency-checker",
    "report-audit-trail",
    "explainability-engine",
    "decision-reproducibility-engine",
    "report-versioning-engine",
  ];
  for (const moduleName of moduleNames) {
    assert.doesNotMatch(pdfButtonSource, new RegExp(moduleName, "i"));
    assert.doesNotMatch(plannerSource, new RegExp(moduleName, "i"));
  }
});

// --- Section 2: full real end-to-end run --------------------------------

test("the full 9-component pipeline runs end to end with real data, every result is schema-valid, and nothing blocks the report", () => {
  const pipeline = runFullPipeline();

  assert.equal(pipeline.qualityValidation.validated, true);
  assert.equal(pipeline.qualityValidation.passed, true);
  assert.equal(pipeline.consistencyCheck.checked, true);
  assert.equal(pipeline.consistencyCheck.consistent, true);
  assert.equal(reportAuditTrailResultSchema.safeParse(pipeline.auditTrail).success, true);
  assert.equal(explainabilityEngineResultSchema.safeParse(pipeline.explainability).success, true);
  assert.equal(reproducibilityRecordSchema.safeParse(pipeline.reproducibility).success, true);
  assert.equal(reportVersionManifestSchema.safeParse(pipeline.versionManifest).success, true);

  assert.equal(pipeline.reproducibility.status, "fingerprinted");
  assert.equal(pipeline.reproducibility.selfCheckPassed, true);
  assert.equal(pipeline.versionManifest.compatibility.isCurrent, true);
  assert.deepEqual(pipeline.versionManifest.compatibility.missingGenerations, []);
});

test("immutable outputs (Audit Trail, Version Manifest) stay frozen all the way through the full chain", () => {
  const pipeline = runFullPipeline();
  assert.equal(Object.isFrozen(pipeline.auditTrail), true);
  assert.equal(Object.isFrozen(pipeline.versionManifest), true);
});

test("running the full chain twice from the same real starting inputs produces byte-identical downstream results (no duplicate-execution drift, full determinism end to end)", () => {
  const { package: executiveDecisionPackage } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
  });

  function downstream(pkg, now) {
    const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });
    const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg, strategicDecisionMemo: memo });
    const auditTrail = generateReportAuditTrail({ enabled: true, sections: [], executiveDecisionPackage: pkg, strategicDecisionMemo: memo, executiveBrief: brief, now });
    const explainability = generateExplainabilityReport({ enabled: true, executiveDecisionPackage: pkg, strategicDecisionMemo: memo, executiveBrief: brief, now });
    const reproducibility = generateReproducibilityRecord({
      enabled: true,
      executiveDecisionPackage: pkg,
      strategicDecisionMemo: memo,
      executiveBrief: brief,
      auditTrail,
      explainability,
      env: { ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED: "true" },
      now,
    });
    const versionManifest = generateReportVersionManifest({
      enabled: true,
      executiveDecisionPackage: pkg,
      strategicDecisionMemo: memo,
      executiveBrief: brief,
      auditTrail,
      explainability,
      reproducibility,
      now,
    });
    return { memo, brief, auditTrail, explainability, reproducibility, versionManifest };
  }

  const a = downstream(structuredClone(executiveDecisionPackage), 1_700_000_000_000);
  const b = downstream(structuredClone(executiveDecisionPackage), 1_700_000_000_000);
  assert.deepEqual(a, b);
});

// --- Section 3: zero placeholder output anywhere in the combined result -

test("no placeholder/fabricated marker text appears anywhere in the combined output of all 9 components", () => {
  const pipeline = runFullPipeline();
  const combined = JSON.stringify(pipeline);
  const forbiddenPatterns = [
    /lorem ipsum/i,
    /\btodo\b/i,
    /\btbd\b/i,
    /\bfixme\b/i,
    /\[insert[^\]]*\]/i,
    /\bplaceholder\b/i,
    /\bxxx+\b/i,
    /your company( name)?/i,
    /company name here/i,
  ];
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(combined, pattern);
  }
});

// --- Section 4: backward compatibility for pre-existing report rows -----

test("a report row from before any ZERINIX Intelligence module existed (only the original pre-existing metadata fields) is still fully, gracefully interpretable", () => {
  const legacyReportMetadata = {
    reportLanguage: "en",
    investmentScore: { totalScore: 78, confidence: 65, recommendation: "GO" },
    benchmarkFit: { industryKey: "saas", fit: "Strong" },
    reportQuality: {
      totalScore: 80,
      confidenceLevel: "High Confidence",
      dimensions: { evidenceQuality: 80, sourceConfidence: 75, financialConsistency: 70, benchmarkFit: 85, validationReadiness: 60 },
      strengths: [],
      weaknesses: [],
      improvementActions: [],
    },
  };
  const compatibility = assessReportVersionCompatibility(legacyReportMetadata);
  assert.equal(compatibility.detectedSchemaVersion, "1.0.0");
  assert.equal(compatibility.backwardCompatible, true);
  assert.equal(compatibility.isCurrent, false);
  assert.ok(compatibility.missingGenerations.length > 0);
});

test("a report row upgraded partway through this pipeline's rollout (some but not all of the 6 additive fields) is still gracefully interpretable, without assuming cumulative adoption", () => {
  const partiallyUpgraded = {
    reportLanguage: "en",
    investmentScore: { totalScore: 78, confidence: 65, recommendation: "GO" },
    reportQualityValidation: { enabled: true, validated: true, passed: true, issues: [], validationTrace: [] },
    reportAuditTrail: { enabled: true, generated: true, generatedAt: new Date().toISOString(), pipelineVersion: "report-audit-trail@1", sections: [], auditTrace: [] },
  };
  const compatibility = assessReportVersionCompatibility(partiallyUpgraded);
  assert.equal(compatibility.detectedSchemaVersion, "1.3.0");
  assert.ok(compatibility.missingGenerations.includes("1.2.0"));
  assert.ok(compatibility.missingGenerations.includes("1.4.0"));
  assert.equal(compatibility.backwardCompatible, true);
});

test("a fully current report row (all 6 additive fields present) is detected as fully current with zero missing generations", () => {
  const fullyCurrent = {
    reportLanguage: "en",
    reportQualityValidation: {},
    reportConsistencyCheck: {},
    reportAuditTrail: {},
    reportExplainability: {},
    reportReproducibility: {},
    reportVersion: {},
  };
  const compatibility = assessReportVersionCompatibility(fullyCurrent);
  assert.equal(compatibility.isCurrent, true);
  assert.deepEqual(compatibility.missingGenerations, []);
});

test("compatibility assessment never throws for malformed or missing metadata (null, undefined, empty object)", () => {
  for (const malformed of [null, undefined, {}]) {
    assert.doesNotThrow(() => assessReportVersionCompatibility(malformed));
  }
});
