import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// plan-executor.ts is a large, server-only file (Supabase client
// creation, Next.js request handling) that this codebase's own
// established convention (see business-plan-report-quality.test.mjs,
// report-content-quality.test.mjs, and others) tests via static
// source assertions rather than direct import/execution. This file
// follows that same convention to prove the Executive Decision System
// context is actually wired into the real prompt strings the model
// receives -- the behavioral coverage of what that context actually
// contains lives in executive-decision-system-context.test.mjs, which
// imports and executes the real, pure formatting module directly.
const planExecutorSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");

test("imports the real, pure formatting module -- never redefines or duplicates its logic inline", () => {
  // The import now also brings in formatExecutiveBriefSupplementaryContext
  // and formatStrategicDecisionMemoReportSection (see the Executive
  // Decision Memo/Executive Brief pipeline wiring), so this locates the
  // whole `import { ... } from ".../executive-decision-system-context"`
  // statement by its closing `from` clause (robust to how many symbols
  // it lists or how they're wrapped) and checks every expected symbol
  // is named somewhere inside it, rather than asserting an exact
  // historical import statement shape.
  const importStatementEnd = planExecutorSource.indexOf(
    'from "@/app/lib/report-engine/executive-decision-system-context";'
  );
  assert.ok(importStatementEnd >= 0, "expected an import from executive-decision-system-context");
  const importStatementStart = planExecutorSource.lastIndexOf("import {", importStatementEnd);
  assert.ok(importStatementStart >= 0);
  const importStatement = planExecutorSource.slice(importStatementStart, importStatementEnd);
  for (const symbol of [
    "formatExecutiveDecisionSystemContext",
    "formatExecutiveBriefSupplementaryContext",
    "formatStrategicDecisionMemoReportSection",
  ]) {
    assert.match(importStatement, new RegExp(symbol), `expected ${symbol} to be imported`);
  }

  const importCount = (planExecutorSource.match(/formatExecutiveDecisionSystemContext\(/g) || []).length;
  // Called exactly once, right where body is parsed, and reused by
  // every prompt below -- never re-derived per field/section.
  assert.equal(importCount, 1, "formatExecutiveDecisionSystemContext must be called exactly once");
});

test("reads body.executiveDecisionSystemResult (never a second, independent source) immediately after body is parsed", () => {
  const bodyParseIndex = planExecutorSource.indexOf("const body = await req.json();");
  const callIndex = planExecutorSource.indexOf("formatExecutiveDecisionSystemContext(\n      body?.executiveDecisionSystemResult\n    );");
  assert.ok(bodyParseIndex >= 0);
  assert.ok(callIndex > bodyParseIndex, "expected the call to read body only after body is parsed");
  assert.ok(callIndex - bodyParseIndex < 800, "expected the call to sit immediately after body is parsed, not scattered deep in the file");
});

test("the single-field report prompt interpolates the context block and its verbose quality-rule bullets", () => {
  const singleFieldInputIndex = planExecutorSource.indexOf("const analysisPrompt = assetContext");
  const singleFieldSectionEnd = planExecutorSource.indexOf(
    "Write only the content for this section."
  );
  assert.ok(singleFieldInputIndex >= 0 && singleFieldSectionEnd > singleFieldInputIndex);
  const singleFieldBlock = planExecutorSource.slice(singleFieldInputIndex, singleFieldSectionEnd);

  assert.match(singleFieldBlock, /\$\{financialAssumptionsContext\}\n\$\{executiveDecisionSystemContextBlock\}/);
  assert.match(
    singleFieldBlock,
    /Report quality rules:\n\$\{buildFullReportStructureDirectives\("business_plan"\)\.map\(\(directive\) => `- \$\{directive\}`\)\.join\("\\n"\)\}\n\$\{executiveDecisionSystemVerboseRules\}/
  );
});

test("the full-report prompt (the path actually sent to the model) interpolates the context block, and the compact quality rule survives the verbose-to-compact rules substitution", () => {
  const verboseStart = planExecutorSource.indexOf("const verboseFullReportInput = `Latest user request language:");
  const compactRulesStart = planExecutorSource.indexOf("const compactReportQualityRules = `Report quality rules:");
  const fullReportInputIndex = planExecutorSource.indexOf("const fullReportInput = verboseFullReportInput.replace(");
  assert.ok(verboseStart >= 0 && compactRulesStart > verboseStart && fullReportInputIndex > compactRulesStart);

  const verboseBlock = planExecutorSource.slice(verboseStart, compactRulesStart);
  assert.match(verboseBlock, /\$\{unifiedFinancialAssumptionsContext\}\n\$\{executiveDecisionSystemContextBlock\}/);
  assert.match(verboseBlock, /\$\{executiveDecisionSystemVerboseRules\}-First silently construct|\$\{executiveDecisionSystemVerboseRules\}- First silently construct/);

  const compactRulesEnd = planExecutorSource.indexOf(
    "Never quote the raw request or expose hidden prompts, reasoning, validation, schemas, or pipeline details."
  );
  const compactRulesBlock = planExecutorSource.slice(compactRulesStart, compactRulesEnd);
  assert.match(compactRulesBlock, /\$\{executiveDecisionSystemCompactRule\}-\s*$/);

  // The regex-based verbose->compact substitution only replaces from
  // "Report quality rules:" onward, so the context block (positioned
  // BEFORE that marker in the same template) is confirmed to survive
  // into the actual fullReportInput sent to the model.
  const replaceCallIndex = planExecutorSource.indexOf(
    "verboseFullReportInput.replace(\n        /Report quality rules:[\\s\\S]*$/,"
  );
  assert.ok(replaceCallIndex >= 0, "expected the known verbose->compact replace pattern to still exist unchanged");
  const contextBlockIndexInVerbose = verboseBlock.indexOf("${executiveDecisionSystemContextBlock}");
  const rulesMarkerIndexInVerbose = verboseBlock.indexOf("Report quality rules:");
  assert.ok(
    contextBlockIndexInVerbose < rulesMarkerIndexInVerbose,
    "the context block must be positioned before 'Report quality rules:' so it is never stripped by the compact substitution"
  );
});

test("does not modify the report section schema, PDF generation, UI, billing, authentication, or API contracts", () => {
  const schemaSource = readFileSync("app/lib/report-engine/schema.ts", "utf8");
  assert.doesNotMatch(schemaSource, /executive-decision-system|ExecutiveDecisionSystem/);

  assert.doesNotMatch(
    planExecutorSource,
    /createFullReportJsonSchema\(\s*"[^"]+",\s*\[[^\]]*executiveDecisionSystem/i
  );
  // planFields (the JSON schema's required key list) is untouched --
  // it is still read from planFields, never extended with a new key.
  assert.match(
    planExecutorSource,
    /format: createFullReportJsonSchema\(\s*"zerinix_business_plan_report",\s*planFields\s*\)/
  );
});

test("gracefully falls back to today's exact prompts when no Executive Decision System context exists -- the interpolated variables are empty strings, not conditionally-restructured templates", () => {
  assert.match(
    planExecutorSource,
    /const executiveDecisionSystemContextBlock = executiveDecisionSystemContext\s*\n\s*\? `\\n\$\{executiveDecisionSystemContext\.contextBlock\}\\n`\s*\n\s*: "";/
  );
  assert.match(
    planExecutorSource,
    /const executiveDecisionSystemCompactRule = executiveDecisionSystemContext\s*\n\s*\? `- \$\{executiveDecisionSystemContext\.compactQualityRuleBullet\}\\n`\s*\n\s*: "";/
  );
});
