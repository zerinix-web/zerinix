import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// financial-model.ts has one REAL (non-type-only) "@/"-aliased import
// (industry-benchmarks), so plain `node --test` can't resolve it
// directly -- same established pattern as
// report-presentation-confidence-radar.test.mjs's importReportPresentation.
async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  const benchmarksPath = join(repoRoot, "app/lib/ai/industry-benchmarks.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(benchmarksPath).href)
  );
  source = source.replace(
    '"@/app/lib/ai/company-lifecycle"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/ai/company-lifecycle.ts")).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-financial-model-"));
  const outPath = join(dir, "financial-model.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { inferFinancialModelingInputs, createFinancialModel } = await importFinancialModel();
const planExecutorSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");

// Reproduces a real production bug: "global / unspecified" -- the
// geography default used whenever a prompt names no explicit country --
// read as a raw internal placeholder wherever it was interpolated: as a
// labeled "Geography: global / unspecified" bullet in Financial
// Assumptions, and, un-labeled, directly inside narrative sentences (the
// 12-month Action Plan: "...scale beyond the beachhead only after those
// proof gates hold in global / unspecified."). "global markets" is the
// same honest default (no specific region was named) phrased as a plain
// noun phrase that reads naturally in both places.

test("an English prompt with no explicit country defaults geography to a clean noun phrase, not a placeholder-sounding string", () => {
  const inputs = inferFinancialModelingInputs(
    "I'm building a warehouse automation software platform for mid-sized logistics companies."
  );

  assert.equal(inputs.geography, "global markets");
  assert.doesNotMatch(inputs.geography, /unspecified/i);
});

test("a Turkish-language prompt with no explicit country defaults geography to Turkey, not the generic global default", () => {
  const inputs = inferFinancialModelingInputs(
    "Diş klinikleri için hasta randevu yönetimi sunan bir SaaS platformu geliştiriyorum."
  );

  assert.equal(inputs.geography, "Turkey");
});

test("an explicit 'global'/'worldwide' mention is preserved as its own honest value, not conflated with the unspecified default", () => {
  const inputs = inferFinancialModelingInputs(
    "I'm building a global SaaS platform for remote teams."
  );

  assert.equal(inputs.geography, "global");
});

test("the geography default reads naturally when embedded directly in narrative prose (no separate label prefix)", () => {
  const model = createFinancialModel({
    prompt: "I'm building a warehouse automation software platform for mid-sized logistics companies.",
    reportKind: "business_plan",
  });
  const sentence = `Expand the ${model.inputs.industry} model beyond the beachhead only after those proof gates hold in ${model.inputs.geography}.`;

  assert.doesNotMatch(sentence, /unspecified/i);
  assert.match(sentence, /hold in global markets\.$/);
});

test("plan-executor.ts's Turkish translation table still matches the new geography default (drift check)", () => {
  assert.match(
    planExecutorSource,
    /\\bGeography: global markets\\b/,
    "the labeled 'Geography: global markets' translation pair has diverged from plan-executor.ts"
  );
  assert.match(
    planExecutorSource,
    /\\bglobal markets\\b/,
    "the standalone (unlabeled, narrative-embedded) 'global markets' translation pair has diverged from plan-executor.ts"
  );
  assert.doesNotMatch(
    planExecutorSource,
    /global \\\/ unspecified/,
    "a stale 'global / unspecified' translation pair still references the old placeholder default"
  );
});
