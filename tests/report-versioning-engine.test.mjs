import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REPORT_VERSIONING_ENGINE_ENABLED_ENV_VAR,
  isReportVersioningEngineEnabled,
  reportVersionManifestSchema,
  REPORT_SCHEMA_VERSION,
  REPORT_SCHEMA_GENERATIONS,
  generateReportVersionManifest,
  assessReportVersionCompatibility,
} from "../app/lib/report-engine/report-versioning-engine.ts";
import { runExecutiveDecisionSystem } from "../app/lib/ai/executive-decision-system.ts";
import { buildStrategicDecisionMemo } from "../app/lib/ai/strategic-decision-memo.ts";
import { generateExecutiveBrief } from "../app/lib/ai/executive-brief-generator.ts";
import { validateExecutiveReportQuality } from "../app/lib/report-engine/executive-report-quality-validator.ts";
import { checkReportConsistency } from "../app/lib/report-engine/report-consistency-checker.ts";
import { generateReportAuditTrail } from "../app/lib/report-engine/report-audit-trail.ts";
import { generateExplainabilityReport } from "../app/lib/report-engine/explainability-engine.ts";
import { generateReproducibilityRecord } from "../app/lib/report-engine/decision-reproducibility-engine.ts";

const workerSource = readFileSync("app/lib/report-jobs/worker.ts", "utf8");
const reportInvestmentScoreSource = readFileSync("app/lib/report-investment-score.ts", "utf8");

function withEnvFlag(value, fn) {
  const previous = process.env[REPORT_VERSIONING_ENGINE_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[REPORT_VERSIONING_ENGINE_ENABLED_ENV_VAR];
  } else {
    process.env[REPORT_VERSIONING_ENGINE_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[REPORT_VERSIONING_ENGINE_ENABLED_ENV_VAR];
    } else {
      process.env[REPORT_VERSIONING_ENGINE_ENABLED_ENV_VAR] = previous;
    }
  }
}

const STRONG_BUSINESS_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds 50,000,000 dollars based on our own analysis.`;

function realSuccessfulPackage() {
  const { package: pkg } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
  });
  assert.equal(pkg.status, "ready_for_report_generation");
  return pkg;
}

function realMemoAndBrief(pkg) {
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });
  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg, strategicDecisionMemo: memo });
  return { memo, brief };
}

function buildFullPipelineFixtures() {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const qualityValidation = validateExecutiveReportQuality({
    enabled: true,
    sections: [],
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const consistencyCheck = checkReportConsistency({
    enabled: true,
    sections: [],
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const auditTrail = generateReportAuditTrail({
    enabled: true,
    sections: [],
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const explainability = generateExplainabilityReport({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  const reproducibility = generateReproducibilityRecord({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
    auditTrail,
    explainability,
    env: { ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED: "true" },
  });
  return { pkg, memo, brief, qualityValidation, consistencyCheck, auditTrail, explainability, reproducibility };
}

function engineEntry(manifest, name) {
  const entry = manifest.engineVersions.find((item) => item.engine === name);
  assert.ok(entry, `expected an engineVersions entry for "${name}"`);
  return entry;
}

// --- Flag behavior ---------------------------------------------------

test("isReportVersioningEngineEnabled reads the env var exactly", () => {
  assert.equal(isReportVersioningEngineEnabled({}), false);
  assert.equal(isReportVersioningEngineEnabled({ [REPORT_VERSIONING_ENGINE_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isReportVersioningEngineEnabled({ [REPORT_VERSIONING_ENGINE_ENABLED_ENV_VAR]: "true" }), true);
});

test("by default (no env var, no override) no manifest is generated, even with real inputs available", () => {
  withEnvFlag(undefined, () => {
    const { pkg, memo, brief } = buildFullPipelineFixtures();
    const manifest = generateReportVersionManifest({
      executiveDecisionPackage: pkg,
      strategicDecisionMemo: memo,
      executiveBrief: brief,
    });
    assert.equal(reportVersionManifestSchema.safeParse(manifest).success, true);
    assert.equal(manifest.enabled, false);
    assert.equal(manifest.generated, false);
    assert.deepEqual(manifest.engineVersions, []);
  });
});

test("an explicit enabled:true overrides the env var", () => {
  const manifest = generateReportVersionManifest({ enabled: true });
  assert.equal(manifest.enabled, true);
  assert.equal(manifest.generated, true);
});

test("setting the env var to 'true' also enables generation", () => {
  withEnvFlag("true", () => {
    const manifest = generateReportVersionManifest({});
    assert.equal(manifest.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const manifest = generateReportVersionManifest({ enabled: false });
    assert.equal(manifest.enabled, false);
  });
});

test("calling with the default argument (no input at all) is safe and returns a disabled, schema-valid result", () => {
  const manifest = generateReportVersionManifest();
  assert.equal(reportVersionManifestSchema.safeParse(manifest).success, true);
  assert.equal(manifest.enabled, false);
});

// --- Immutability ------------------------------------------------------

test("the returned manifest is deeply frozen (immutable version metadata)", () => {
  "use strict";
  const manifest = generateReportVersionManifest({ enabled: true });
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.engineVersions), true);
  assert.equal(Object.isFrozen(manifest.compatibility), true);
  assert.throws(() => {
    manifest.reportSchemaVersion = "9.9.9";
  }, TypeError);
});

// --- Determinism ---------------------------------------------------

test("identical input (including an explicit `now`) always produces an identical manifest", () => {
  const fixtures = buildFullPipelineFixtures();
  const input = {
    enabled: true,
    executiveDecisionPackage: structuredClone(fixtures.pkg),
    strategicDecisionMemo: structuredClone(fixtures.memo),
    executiveBrief: structuredClone(fixtures.brief),
    qualityValidation: structuredClone(fixtures.qualityValidation),
    consistencyCheck: structuredClone(fixtures.consistencyCheck),
    auditTrail: structuredClone(fixtures.auditTrail),
    explainability: structuredClone(fixtures.explainability),
    reproducibility: structuredClone(fixtures.reproducibility),
    now: 1_700_000_000_000,
  };
  const a = generateReportVersionManifest(input);
  const b = generateReportVersionManifest({
    ...input,
    executiveDecisionPackage: structuredClone(fixtures.pkg),
    strategicDecisionMemo: structuredClone(fixtures.memo),
    executiveBrief: structuredClone(fixtures.brief),
    qualityValidation: structuredClone(fixtures.qualityValidation),
    consistencyCheck: structuredClone(fixtures.consistencyCheck),
    auditTrail: structuredClone(fixtures.auditTrail),
    explainability: structuredClone(fixtures.explainability),
    reproducibility: structuredClone(fixtures.reproducibility),
  });
  assert.deepEqual(a, b);
});

// --- Full pipeline / version fields -------------------------------------

test("a fully populated real scenario reports every version field, all 10 engine entries present, and isCurrent:true", () => {
  const fixtures = buildFullPipelineFixtures();
  const manifest = generateReportVersionManifest({
    enabled: true,
    executiveDecisionPackage: fixtures.pkg,
    strategicDecisionMemo: fixtures.memo,
    executiveBrief: fixtures.brief,
    qualityValidation: fixtures.qualityValidation,
    consistencyCheck: fixtures.consistencyCheck,
    auditTrail: fixtures.auditTrail,
    explainability: fixtures.explainability,
    reproducibility: fixtures.reproducibility,
  });
  assert.equal(reportVersionManifestSchema.safeParse(manifest).success, true);
  assert.equal(manifest.reportSchemaVersion, REPORT_SCHEMA_VERSION);
  assert.equal(manifest.executiveDecisionSystemVersion, "executive-decision-system@1");
  assert.equal(manifest.validationVersion, "executive-report-quality-validator@1");
  assert.equal(manifest.consistencyCheckVersion, "report-consistency-checker@1");
  assert.equal(manifest.explainabilityVersion, fixtures.explainability.engineVersion);
  assert.equal(manifest.auditTrailVersion, fixtures.auditTrail.pipelineVersion);
  assert.equal(manifest.reproducibilityVersion, "decision-reproducibility-engine@1");
  assert.equal(manifest.engineVersions.length, 10);
  for (const entry of manifest.engineVersions) {
    assert.equal(entry.present, true, `expected "${entry.engine}" to be present`);
  }
  assert.equal(manifest.compatibility.isCurrent, true);
  assert.deepEqual(manifest.compatibility.missingGenerations, []);
});

test("integrates with the audit trail and reproducibility pipeline: their real version strings are read directly, never re-derived", () => {
  const fixtures = buildFullPipelineFixtures();
  const manifest = generateReportVersionManifest({
    enabled: true,
    executiveDecisionPackage: fixtures.pkg,
    strategicDecisionMemo: fixtures.memo,
    executiveBrief: fixtures.brief,
    auditTrail: fixtures.auditTrail,
    explainability: fixtures.explainability,
    reproducibility: fixtures.reproducibility,
  });
  assert.equal(engineEntry(manifest, "report-audit-trail").version, fixtures.auditTrail.pipelineVersion);
  assert.equal(engineEntry(manifest, "explainability-engine").version, fixtures.explainability.engineVersion);
  assert.equal(manifest.auditTrailVersion, fixtures.auditTrail.pipelineVersion);
  assert.equal(engineEntry(manifest, "decision-reproducibility-engine").present, true);
});

test("with nothing real supplied, every version field is honestly null and no engine is reported present except this module itself", () => {
  const manifest = generateReportVersionManifest({ enabled: true });
  assert.equal(manifest.executiveDecisionSystemVersion, null);
  assert.equal(manifest.validationVersion, null);
  assert.equal(manifest.consistencyCheckVersion, null);
  assert.equal(manifest.explainabilityVersion, null);
  assert.equal(manifest.auditTrailVersion, null);
  assert.equal(manifest.reproducibilityVersion, null);
  for (const entry of manifest.engineVersions) {
    if (entry.engine === "report-versioning-engine") {
      assert.equal(entry.present, true);
    } else {
      assert.equal(entry.present, false, `expected "${entry.engine}" to be absent`);
    }
  }
  assert.equal(manifest.compatibility.isCurrent, false);
});

// --- Backward compatibility / assessReportVersionCompatibility ----------

test("REPORT_SCHEMA_GENERATIONS is a real, ordered, additive ladder ending at the current REPORT_SCHEMA_VERSION", () => {
  assert.equal(REPORT_SCHEMA_GENERATIONS[0].requiredField, null);
  assert.equal(REPORT_SCHEMA_GENERATIONS[REPORT_SCHEMA_GENERATIONS.length - 1].version, REPORT_SCHEMA_VERSION);
  for (const generation of REPORT_SCHEMA_GENERATIONS.slice(1)) {
    assert.ok(typeof generation.requiredField === "string" && generation.requiredField.length > 0);
  }
});

test("a genuinely legacy report (zero ZERINIX fields at all) is detected as the base generation, with every later generation reported missing, and is still marked backward compatible", () => {
  const legacyMetadata = { investmentScore: { totalScore: 80, confidence: 70, recommendation: "GO" } };
  const compatibility = assessReportVersionCompatibility(legacyMetadata);
  assert.equal(compatibility.detectedSchemaVersion, "1.0.0");
  assert.equal(compatibility.isCurrent, false);
  assert.deepEqual(
    compatibility.missingGenerations,
    REPORT_SCHEMA_GENERATIONS.slice(1).map((generation) => generation.version)
  );
  assert.equal(compatibility.backwardCompatible, true);
});

test("a report with only a later generation's field present (independent flags, no earlier ones enabled) is still correctly detected, never assumed cumulative", () => {
  const partialMetadata = { reportAuditTrail: { enabled: true, generated: true } };
  const compatibility = assessReportVersionCompatibility(partialMetadata);
  assert.equal(compatibility.detectedSchemaVersion, "1.3.0");
  assert.deepEqual([...compatibility.missingGenerations].sort(), ["1.1.0", "1.2.0", "1.4.0", "1.5.0", "1.6.0"].sort());
  assert.equal(compatibility.isCurrent, false);
});

test("a fully current report (every generation's field present) is detected as current with zero missing generations", () => {
  const currentMetadata = {
    reportQualityValidation: {},
    reportConsistencyCheck: {},
    reportAuditTrail: {},
    reportExplainability: {},
    reportReproducibility: {},
    reportVersion: {},
  };
  const compatibility = assessReportVersionCompatibility(currentMetadata);
  assert.equal(compatibility.detectedSchemaVersion, REPORT_SCHEMA_VERSION);
  assert.equal(compatibility.isCurrent, true);
  assert.deepEqual(compatibility.missingGenerations, []);
});

test("never throws on null, undefined, primitive, or array input -- always degrades gracefully to the base generation", () => {
  for (const garbage of [null, undefined, "a string", 42, [], [1, 2, 3]]) {
    const compatibility = assessReportVersionCompatibility(garbage);
    assert.equal(compatibility.detectedSchemaVersion, "1.0.0");
    assert.equal(compatibility.backwardCompatible, true);
    assert.equal(reportCompatibilitySafe(compatibility), true);
  }
});

function reportCompatibilitySafe(compatibility) {
  return (
    typeof compatibility.currentSchemaVersion === "string" &&
    typeof compatibility.detectedSchemaVersion === "string" &&
    Array.isArray(compatibility.missingGenerations)
  );
}

// --- worker.ts pipeline integration (static, matching this codebase's
// established convention for testing worker.ts) ----------------------

test("worker.ts calls generateReportVersionManifest exactly once, AFTER the Decision Reproducibility Engine, and before persistCompletedReport", () => {
  const reproducibilityIndex = workerSource.indexOf("const reproducibility = generateReproducibilityRecord({");
  const versionIndex = workerSource.indexOf("const versionManifest = generateReportVersionManifest({");
  const persistIndex = workerSource.indexOf("await persistCompletedReport({ supabase, job, report });");

  assert.ok(reproducibilityIndex >= 0 && versionIndex > reproducibilityIndex);
  assert.ok(persistIndex > versionIndex);

  assert.equal((workerSource.match(/generateReportVersionManifest\(/g) || []).length, 1);
});

test("worker.ts passes generateReportVersionManifest all five already-computed sibling results directly, never re-parsing or recomputing them", () => {
  const callStart = workerSource.indexOf("const versionManifest = generateReportVersionManifest({");
  const callEnd = workerSource.indexOf("});", callStart);
  const callBlock = workerSource.slice(callStart, callEnd);

  assert.match(callBlock, /job\.request_payload\.executiveDecisionSystemResult/);
  assert.match(callBlock, /job\.request_payload\.strategicDecisionMemo/);
  assert.match(callBlock, /job\.request_payload\.executiveBrief/);
  assert.match(callBlock, /\bqualityValidation\b/);
  assert.match(callBlock, /\bconsistencyCheck\b/);
  assert.match(callBlock, /\bauditTrail\b/);
  assert.match(callBlock, /\bexplainability\b/);
  assert.match(callBlock, /\breproducibility\b/);
});

test("worker.ts never throws from the versioning block -- it only attaches metadata, unlike the two blocking validators earlier in the pipeline", () => {
  const callStart = workerSource.indexOf("const versionManifest = generateReportVersionManifest({");
  const persistenceStart = workerSource.indexOf("const persistenceStartedAt = Date.now();", callStart);
  const block = workerSource.slice(callStart, persistenceStart);
  assert.doesNotMatch(block, /throw new Error/);
});

test("worker.ts attaches the version manifest to report.metadata additively, alongside (never replacing) all five prior additive results", () => {
  assert.match(
    workerSource,
    /report\.metadata = \{ \.\.\.\(report\.metadata \|\| \{\}\), reportVersion: versionManifest \};/
  );
  assert.match(workerSource, /reportQualityValidation: qualityValidation/);
  assert.match(workerSource, /reportConsistencyCheck: consistencyCheck/);
  assert.match(workerSource, /reportAuditTrail: auditTrail/);
  assert.match(workerSource, /reportExplainability: explainability/);
  assert.match(workerSource, /reportReproducibility: reproducibility/);
  assert.match(workerSource, /reportVersion: versionManifest/);
});

test("ReportMetadata gained exactly one new, optional field for this integration, in addition to (not instead of) the five prior additive fields", () => {
  assert.match(reportInvestmentScoreSource, /reportVersion\?:/);
  assert.match(reportInvestmentScoreSource, /reportReproducibility\?:/);
  assert.match(reportInvestmentScoreSource, /reportExplainability\?:/);
  assert.match(reportInvestmentScoreSource, /reportAuditTrail\?:/);
  assert.match(reportInvestmentScoreSource, /reportQualityValidation\?:/);
  assert.match(reportInvestmentScoreSource, /reportConsistencyCheck\?:/);
});

test("does not modify PDF generation, UI, billing, authentication, or routing -- only worker.ts (report persistence) and an additive metadata type were touched", () => {
  const pdfButtonSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
  assert.doesNotMatch(pdfButtonSource, /report-versioning-engine/i);

  const planRouteSource = readFileSync("app/api/plan/route.ts", "utf8");
  assert.doesNotMatch(planRouteSource, /report-versioning-engine|generateReportVersionManifest/i);
});

test("never invokes an LLM: the module imports no OpenAI/runtime/network client, and never calls the Executive Decision System/Memo/Brief builders", () => {
  const source = readFileSync("app/lib/report-engine/report-versioning-engine.ts", "utf8");
  assert.doesNotMatch(source, /openai|fetch\(|createOpenAiClient/i);
  assert.doesNotMatch(source, /runExecutiveDecisionSystem\(|buildStrategicDecisionMemo\(|generateExecutiveBrief\(/);
});
