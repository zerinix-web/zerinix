import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DECISION_REPRODUCIBILITY_ENGINE_ENABLED_ENV_VAR,
  isDecisionReproducibilityEngineEnabled,
  reproducibilityRecordSchema,
  reproducibilityDivergenceReportSchema,
  reproducibilityComponentNameValues,
  generateReproducibilityRecord,
  compareReproducibilityRecords,
} from "../app/lib/report-engine/decision-reproducibility-engine.ts";
import {
  runExecutiveDecisionSystem,
  executiveDecisionPackageSchema,
} from "../app/lib/ai/executive-decision-system.ts";
import { buildStrategicDecisionMemo, strategicDecisionMemoSchema } from "../app/lib/ai/strategic-decision-memo.ts";
import { generateExecutiveBrief } from "../app/lib/ai/executive-brief-generator.ts";
import { generateReportAuditTrail } from "../app/lib/report-engine/report-audit-trail.ts";
import { generateExplainabilityReport } from "../app/lib/report-engine/explainability-engine.ts";

const workerSource = readFileSync("app/lib/report-jobs/worker.ts", "utf8");
const reportInvestmentScoreSource = readFileSync("app/lib/report-investment-score.ts", "utf8");

function withEnvFlag(value, fn) {
  const previous = process.env[DECISION_REPRODUCIBILITY_ENGINE_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[DECISION_REPRODUCIBILITY_ENGINE_ENABLED_ENV_VAR];
  } else {
    process.env[DECISION_REPRODUCIBILITY_ENGINE_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[DECISION_REPRODUCIBILITY_ENGINE_ENABLED_ENV_VAR];
    } else {
      process.env[DECISION_REPRODUCIBILITY_ENGINE_ENABLED_ENV_VAR] = previous;
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

function componentHash(record, name) {
  const entry = record.componentHashes.find((component) => component.component === name);
  assert.ok(entry, `expected a "${name}" component hash`);
  return entry.hash;
}

const BASE_ENV = { ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED: "true" };

// --- Flag behavior ---------------------------------------------------

test("isDecisionReproducibilityEngineEnabled reads the env var exactly", () => {
  assert.equal(isDecisionReproducibilityEngineEnabled({}), false);
  assert.equal(isDecisionReproducibilityEngineEnabled({ [DECISION_REPRODUCIBILITY_ENGINE_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isDecisionReproducibilityEngineEnabled({ [DECISION_REPRODUCIBILITY_ENGINE_ENABLED_ENV_VAR]: "true" }), true);
});

test("by default (no env var, no override) no fingerprint is generated, even with real inputs available", () => {
  withEnvFlag(undefined, () => {
    const pkg = realSuccessfulPackage();
    const { memo, brief } = realMemoAndBrief(pkg);
    const record = generateReproducibilityRecord({
      executiveDecisionPackage: pkg,
      strategicDecisionMemo: memo,
      executiveBrief: brief,
    });
    assert.equal(reproducibilityRecordSchema.safeParse(record).success, true);
    assert.equal(record.enabled, false);
    assert.equal(record.generated, false);
    assert.equal(record.fingerprint, null);
    assert.equal(record.status, null);
  });
});

test("an explicit enabled:true overrides the env var", () => {
  const record = generateReproducibilityRecord({ enabled: true, env: BASE_ENV });
  assert.equal(record.enabled, true);
  assert.equal(record.generated, true);
});

test("setting the env var to 'true' also enables generation", () => {
  withEnvFlag("true", () => {
    const record = generateReproducibilityRecord({ env: BASE_ENV });
    assert.equal(record.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const record = generateReproducibilityRecord({ enabled: false, env: BASE_ENV });
    assert.equal(record.enabled, false);
  });
});

test("calling with the default argument (no input at all) is safe and returns a disabled, schema-valid result", () => {
  const record = generateReproducibilityRecord();
  assert.equal(reproducibilityRecordSchema.safeParse(record).success, true);
  assert.equal(record.enabled, false);
});

// --- insufficient_data --------------------------------------------------

test("status is 'insufficient_data' (never a fabricated fingerprint) when enabled with no real Executive Decision System output at all", () => {
  const record = generateReproducibilityRecord({ enabled: true, env: BASE_ENV });
  assert.equal(record.generated, true);
  assert.equal(record.status, "insufficient_data");
  assert.equal(record.fingerprint, null);
  assert.deepEqual(record.componentHashes, []);
  assert.equal(record.selfCheckPassed, null);
  assert.equal(record.executionMetadata, null);
});

// --- Structured result shape / self-check -----------------------------

test("reproducibilityComponentNameValues contains exactly the 4 documented components", () => {
  assert.deepEqual([...reproducibilityComponentNameValues].sort(), ["inputs", "engineVersions", "configuration", "output"].sort());
});

test("a fully populated real scenario is schema-valid, has all 4 real component hashes, and a passing self-check", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
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
  const record = generateReproducibilityRecord({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
    auditTrail,
    explainability,
    env: BASE_ENV,
  });
  assert.equal(reproducibilityRecordSchema.safeParse(record).success, true);
  assert.equal(record.status, "fingerprinted");
  assert.equal(record.componentHashes.length, 4);
  assert.equal(record.selfCheckPassed, true);
  assert.match(record.fingerprint, /^[0-9a-f]{64}$/);
  for (const component of record.componentHashes) {
    assert.match(component.hash, /^[0-9a-f]{64}$/);
  }
});

test("integrates with the audit trail and explainability pipeline: their real pipelineVersion/engineVersion are folded into executionMetadata and the engineVersions component", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const auditTrail = generateReportAuditTrail({ enabled: true, sections: [], executiveDecisionPackage: pkg, strategicDecisionMemo: memo, executiveBrief: brief });
  const explainability = generateExplainabilityReport({ enabled: true, executiveDecisionPackage: pkg, strategicDecisionMemo: memo, executiveBrief: brief });

  const withBoth = generateReproducibilityRecord({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
    auditTrail,
    explainability,
    env: BASE_ENV,
  });
  assert.equal(withBoth.executionMetadata.auditTrailVersion, auditTrail.pipelineVersion);
  assert.equal(withBoth.executionMetadata.explainabilityEngineVersion, explainability.engineVersion);
  assert.ok(withBoth.executionMetadata.engineVersions.includes(auditTrail.pipelineVersion));
  assert.ok(withBoth.executionMetadata.engineVersions.includes(explainability.engineVersion));

  const withoutEither = generateReproducibilityRecord({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
    env: BASE_ENV,
  });
  assert.equal(withoutEither.executionMetadata.auditTrailVersion, null);
  assert.equal(withoutEither.executionMetadata.explainabilityEngineVersion, null);
  assert.notEqual(componentHash(withBoth, "engineVersions"), componentHash(withoutEither, "engineVersions"));
});

// --- Determinism ---------------------------------------------------

test("identical input always produces an identical record, byte for byte", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const auditTrail = generateReportAuditTrail({ enabled: true, sections: [], executiveDecisionPackage: pkg, strategicDecisionMemo: memo, executiveBrief: brief });
  const explainability = generateExplainabilityReport({ enabled: true, executiveDecisionPackage: pkg, strategicDecisionMemo: memo, executiveBrief: brief });
  const input = {
    enabled: true,
    executiveDecisionPackage: structuredClone(pkg),
    strategicDecisionMemo: structuredClone(memo),
    executiveBrief: structuredClone(brief),
    auditTrail: structuredClone(auditTrail),
    explainability: structuredClone(explainability),
    env: BASE_ENV,
    now: 1_700_000_000_000,
  };
  const a = generateReproducibilityRecord(input);
  const b = generateReproducibilityRecord({
    ...input,
    executiveDecisionPackage: structuredClone(pkg),
    strategicDecisionMemo: structuredClone(memo),
    executiveBrief: structuredClone(brief),
    auditTrail: structuredClone(auditTrail),
    explainability: structuredClone(explainability),
  });
  assert.deepEqual(a, b);
  assert.equal(a.fingerprint, b.fingerprint);
});

// --- Component sensitivity ---------------------------------------------

test("output component (and only it) changes when a real conclusion (risks) changes; inputs/engineVersions/configuration stay identical", () => {
  const pkg = realSuccessfulPackage();
  const { memo: baseMemo, brief } = realMemoAndBrief(pkg);
  const baseline = generateReproducibilityRecord({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: baseMemo,
    executiveBrief: brief,
    env: BASE_ENV,
    now: 1,
  });

  const mutatedMemo = structuredClone(baseMemo);
  mutatedMemo.risks = ["A brand new risk that changes only the decision output."];
  assert.equal(strategicDecisionMemoSchema.safeParse(mutatedMemo).success, true);
  const mutated = generateReproducibilityRecord({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: mutatedMemo,
    executiveBrief: brief,
    env: BASE_ENV,
    now: 1,
  });

  assert.notEqual(componentHash(baseline, "output"), componentHash(mutated, "output"));
  assert.equal(componentHash(baseline, "inputs"), componentHash(mutated, "inputs"));
  assert.equal(componentHash(baseline, "engineVersions"), componentHash(mutated, "engineVersions"));
  assert.equal(componentHash(baseline, "configuration"), componentHash(mutated, "configuration"));
  assert.notEqual(baseline.fingerprint, mutated.fingerprint);
});

test("configuration component (and only it) changes when the active feature flag set changes", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const a = generateReproducibilityRecord({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
    env: { ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED: "true" },
    now: 1,
  });
  const b = generateReproducibilityRecord({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
    env: { ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED: "true", ZERINIX_STRATEGIC_DECISION_MEMO_ENABLED: "true" },
    now: 1,
  });
  assert.notEqual(componentHash(a, "configuration"), componentHash(b, "configuration"));
  assert.equal(componentHash(a, "output"), componentHash(b, "output"));
  assert.equal(componentHash(a, "inputs"), componentHash(b, "inputs"));
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test("inputs component treats the real evidence set as an unordered set: reordering evidenceTrace never changes the hash", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const forward = structuredClone(pkg);
  forward.decision.evidenceTrace = ["alpha evidence", "beta evidence", "gamma evidence"];
  const forwardCheck = executiveDecisionPackageSchema.safeParse(forward);
  assert.equal(forwardCheck.success, true);

  const reversed = structuredClone(pkg);
  reversed.decision.evidenceTrace = ["gamma evidence", "beta evidence", "alpha evidence"];
  const reversedCheck = executiveDecisionPackageSchema.safeParse(reversed);
  assert.equal(reversedCheck.success, true);

  const a = generateReproducibilityRecord({
    enabled: true,
    executiveDecisionPackage: forwardCheck.data,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
    env: BASE_ENV,
    now: 1,
  });
  const b = generateReproducibilityRecord({
    enabled: true,
    executiveDecisionPackage: reversedCheck.data,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
    env: BASE_ENV,
    now: 1,
  });
  assert.equal(componentHash(a, "inputs"), componentHash(b, "inputs"));
});

test("output component treats real conclusion order as meaningful content: reordering risks changes the hash", () => {
  const pkg = realSuccessfulPackage();
  const { memo: baseMemo, brief } = realMemoAndBrief(pkg);
  const forwardMemo = structuredClone(baseMemo);
  forwardMemo.risks = ["Risk A statement text here for ordering test purposes.", "Risk B statement text here for ordering test."];
  assert.equal(strategicDecisionMemoSchema.safeParse(forwardMemo).success, true);

  const reversedMemo = structuredClone(baseMemo);
  reversedMemo.risks = ["Risk B statement text here for ordering test.", "Risk A statement text here for ordering test purposes."];
  assert.equal(strategicDecisionMemoSchema.safeParse(reversedMemo).success, true);

  const a = generateReproducibilityRecord({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: forwardMemo,
    executiveBrief: brief,
    env: BASE_ENV,
    now: 1,
  });
  const b = generateReproducibilityRecord({
    enabled: true,
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: reversedMemo,
    executiveBrief: brief,
    env: BASE_ENV,
    now: 1,
  });
  assert.notEqual(componentHash(a, "output"), componentHash(b, "output"));
});

// --- compareReproducibilityRecords --------------------------------------

test("compareReproducibilityRecords: two records from the same real inputs are reported reproducible with no divergent components", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const a = generateReproducibilityRecord({ enabled: true, executiveDecisionPackage: pkg, strategicDecisionMemo: memo, executiveBrief: brief, env: BASE_ENV, now: 1 });
  const b = generateReproducibilityRecord({ enabled: true, executiveDecisionPackage: structuredClone(pkg), strategicDecisionMemo: structuredClone(memo), executiveBrief: structuredClone(brief), env: BASE_ENV, now: 2 });
  const comparison = compareReproducibilityRecords(a, b);
  assert.equal(reproducibilityDivergenceReportSchema.safeParse(comparison).success, true);
  assert.equal(comparison.compared, true);
  assert.equal(comparison.reproducible, true);
  assert.deepEqual(comparison.divergentComponents, []);
});

test("compareReproducibilityRecords: detects and reports exactly which real component diverged, plus the top-level fingerprint", () => {
  const pkg = realSuccessfulPackage();
  const { memo: baseMemo, brief } = realMemoAndBrief(pkg);
  const a = generateReproducibilityRecord({ enabled: true, executiveDecisionPackage: pkg, strategicDecisionMemo: baseMemo, executiveBrief: brief, env: BASE_ENV, now: 1 });

  const mutatedMemo = structuredClone(baseMemo);
  mutatedMemo.risks = ["A brand new risk that changes only the decision output."];
  assert.equal(strategicDecisionMemoSchema.safeParse(mutatedMemo).success, true);
  const b = generateReproducibilityRecord({ enabled: true, executiveDecisionPackage: pkg, strategicDecisionMemo: mutatedMemo, executiveBrief: brief, env: BASE_ENV, now: 1 });

  const comparison = compareReproducibilityRecords(a, b);
  assert.equal(comparison.compared, true);
  assert.equal(comparison.reproducible, false);
  assert.deepEqual([...comparison.divergentComponents].sort(), ["fingerprint", "output"].sort());
});

test("compareReproducibilityRecords: reports compared:false (never a guess) when either record has no real fingerprint", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const real = generateReproducibilityRecord({ enabled: true, executiveDecisionPackage: pkg, strategicDecisionMemo: memo, executiveBrief: brief, env: BASE_ENV });
  const disabled = generateReproducibilityRecord();
  const insufficient = generateReproducibilityRecord({ enabled: true, env: BASE_ENV });

  for (const other of [disabled, insufficient]) {
    const comparison = compareReproducibilityRecords(real, other);
    assert.equal(comparison.compared, false);
    assert.equal(comparison.reproducible, false);
    assert.deepEqual(comparison.divergentComponents, []);
  }
});

// --- worker.ts pipeline integration (static, matching this codebase's
// established convention for testing worker.ts) ----------------------

test("worker.ts calls generateReproducibilityRecord exactly once, AFTER the Explainability Engine, and before persistCompletedReport", () => {
  const explainabilityIndex = workerSource.indexOf("const explainability = generateExplainabilityReport({");
  const reproducibilityIndex = workerSource.indexOf("const reproducibility = generateReproducibilityRecord({");
  const persistIndex = workerSource.indexOf("await persistCompletedReport({ supabase, job, report });");

  assert.ok(explainabilityIndex >= 0 && reproducibilityIndex > explainabilityIndex);
  assert.ok(persistIndex > reproducibilityIndex);

  assert.equal((workerSource.match(/generateReproducibilityRecord\(/g) || []).length, 1);
});

test("worker.ts passes generateReproducibilityRecord the already-computed auditTrail and explainability variables directly, and the already-computed request_payload fields -- never re-parsing or recomputing them", () => {
  const callStart = workerSource.indexOf("const reproducibility = generateReproducibilityRecord({");
  const callEnd = workerSource.indexOf("});", callStart);
  const callBlock = workerSource.slice(callStart, callEnd);

  assert.match(callBlock, /job\.request_payload\.executiveDecisionSystemResult/);
  assert.match(callBlock, /job\.request_payload\.strategicDecisionMemo/);
  assert.match(callBlock, /job\.request_payload\.executiveBrief/);
  assert.match(callBlock, /\bauditTrail\b/);
  assert.match(callBlock, /\bexplainability\b/);

  assert.equal((workerSource.match(/generateReportAuditTrail\(/g) || []).length, 1);
  assert.equal((workerSource.match(/generateExplainabilityReport\(/g) || []).length, 1);
});

test("worker.ts never throws from the reproducibility block -- it only records, unlike the two blocking validators earlier in the pipeline", () => {
  const callStart = workerSource.indexOf("const reproducibility = generateReproducibilityRecord({");
  const persistenceStart = workerSource.indexOf("const persistenceStartedAt = Date.now();", callStart);
  const block = workerSource.slice(callStart, persistenceStart);
  assert.doesNotMatch(block, /throw new Error/);
});

test("worker.ts attaches the reproducibility record to report.metadata additively, alongside (never replacing) the quality validation, consistency check, audit trail, and explainability results", () => {
  assert.match(
    workerSource,
    /report\.metadata = \{ \.\.\.\(report\.metadata \|\| \{\}\), reportReproducibility: reproducibility \};/
  );
  assert.match(workerSource, /reportQualityValidation: qualityValidation/);
  assert.match(workerSource, /reportConsistencyCheck: consistencyCheck/);
  assert.match(workerSource, /reportAuditTrail: auditTrail/);
  assert.match(workerSource, /reportExplainability: explainability/);
  assert.match(workerSource, /reportReproducibility: reproducibility/);
});

test("ReportMetadata gained exactly one new, optional field for this integration, in addition to (not instead of) the four prior additive fields", () => {
  assert.match(reportInvestmentScoreSource, /reportReproducibility\?:/);
  assert.match(reportInvestmentScoreSource, /reportExplainability\?:/);
  assert.match(reportInvestmentScoreSource, /reportAuditTrail\?:/);
  assert.match(reportInvestmentScoreSource, /reportQualityValidation\?:/);
  assert.match(reportInvestmentScoreSource, /reportConsistencyCheck\?:/);
});

test("does not modify PDF generation, UI, billing, authentication, or routing -- only worker.ts (report persistence) and an additive metadata type were touched", () => {
  const pdfButtonSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
  assert.doesNotMatch(pdfButtonSource, /decision-reproducibility-engine/i);

  const planRouteSource = readFileSync("app/api/plan/route.ts", "utf8");
  assert.doesNotMatch(planRouteSource, /decision-reproducibility-engine|generateReproducibilityRecord/i);
});

test("never invokes an LLM: the module imports no OpenAI/runtime/network client, and never calls the Executive Decision System/Memo/Brief builders", () => {
  const source = readFileSync("app/lib/report-engine/decision-reproducibility-engine.ts", "utf8");
  assert.doesNotMatch(source, /openai|fetch\(|createOpenAiClient/i);
  assert.doesNotMatch(source, /runExecutiveDecisionSystem\(|buildStrategicDecisionMemo\(|generateExecutiveBrief\(/);
});
