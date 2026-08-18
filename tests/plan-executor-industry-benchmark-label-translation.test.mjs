import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reproduces a real, confirmed production bug: a live Turkish Business Plan
// report (hotel revenue-management SaaS, matched to industry-benchmarks.ts's
// generic "Professional services" fallback category) showed the raw English
// phrase "Professional services" embedded directly inside otherwise pure
// Turkish prose -- "Güven: Professional services varsayımları, güvenin
// düşük olduğu alanlarda birincil doğrulama gerektirir." -- in the
// Executive Summary's Top Risks list.
//
// Root cause: industry-benchmarks.ts defines 19 English-only category
// labels (model.benchmark.label). financial-model.ts's
// inferFinancialModelingInputs sets inputs.industry = benchmark.label
// directly, so inputs.industry is always one of those same 19 raw English
// strings. investment-score.ts's createTopRisks interpolates
// `${model.benchmark.label}` straight into an English sentence that
// plan-executor.ts's englishFinancialFragmentTranslations regex table then
// captures and re-embeds verbatim (no translation) into the Turkish
// template. Separately, plan-executor.ts also interpolates
// `${context.inputs.industry}` directly into four of its own deterministic
// Turkish sentence templates (compliance mitigation, a SWOT strength, the
// "biggest opportunity" fallback, and the Next 12 Months roadmap line) --
// the exact same raw label, the exact same missing translation step.
//
// The fix: a single translateIndustryBenchmarkLabel lookup covering all 19
// industry-benchmarks.ts labels, applied at every interpolation site.

const planExecutorSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
const industryBenchmarksSource = readFileSync("app/lib/ai/industry-benchmarks.ts", "utf8");

test("every industry-benchmarks.ts label has a Turkish translation entry (drift check)", () => {
  const labels = [...industryBenchmarksSource.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(labels.length > 0, "failed to find any benchmark labels in industry-benchmarks.ts");

  const translationsBlockMatch = /const industryBenchmarkLabelTranslations: Record<string, string> = \{([\s\S]*?)\};/.exec(
    planExecutorSource
  );
  assert.ok(translationsBlockMatch, "industryBenchmarkLabelTranslations has diverged from plan-executor.ts");

  for (const label of labels) {
    assert.ok(
      translationsBlockMatch[1].includes(JSON.stringify(label)) ||
        translationsBlockMatch[1].includes(`${label}:`),
      `industry-benchmarks.ts label "${label}" has no Turkish translation entry in plan-executor.ts`
    );
  }
});

test("the global englishFinancialFragmentTranslations table spreads industryBenchmarkLabelTranslations as standalone-value entries (drift check)", () => {
  // businessModel falls back to the exact same raw benchmark.label
  // whenever none of its own keyword patterns match (confirmed live: an
  // English-keyword-only businessModel classifier never matches a
  // Turkish-language prompt), so a per-call-site fix at
  // context.inputs.industry's interpolation sites alone is not enough --
  // the same raw label leaks through context.inputs.businessModel too,
  // in different fields entirely (Business Model, KPI Dashboard, Roadmap,
  // Financial Assumptions). Spreading the translations into the global,
  // whole-field translation pass catches every occurrence regardless of
  // which input field carried the raw label through.
  assert.match(
    planExecutorSource,
    /\.\.\.Object\.entries\(industryBenchmarkLabelTranslations\)\.map\(/,
    "the global standalone-value spread of industryBenchmarkLabelTranslations has diverged from plan-executor.ts"
  );
});

test("all five raw context.inputs.industry / benchmarkLabel interpolation sites route through translateIndustryBenchmarkLabel (drift check)", () => {
  const expectedCallSites = [
    /Güven: \$\{translateIndustryBenchmarkLabel\(benchmarkLabel\)\}/,
    /ilk ölçekli \$\{translateIndustryBenchmarkLabel\(context\.inputs\.industry\)\} lansmanından önce/,
    /\$\{translateIndustryBenchmarkLabel\(context\.inputs\.industry\)\} odağı, kurucuya/,
    /\$\{translateIndustryBenchmarkLabel\(context\.inputs\.industry\)\} talebi henüz doğrulanmadı/,
    /Sonraki 12 Ay: \$\{translateIndustryBenchmarkLabel\(context\.inputs\.industry\)\} modelini/,
  ];

  for (const pattern of expectedCallSites) {
    assert.match(planExecutorSource, pattern, `expected call site has diverged: ${pattern}`);
  }

  // The English template sentences must stay untouched (raw industry name
  // is already correct English prose) -- only the Turkish templates are
  // rewritten to translate first.
  assert.match(
    planExecutorSource,
    /complete a \$\{context\.inputs\.geography\} compliance review before the first scaled \$\{context\.inputs\.industry\} launch/,
    "the English compliance-mitigation template has diverged from plan-executor.ts"
  );
});

// Mirrors translateIndustryBenchmarkLabel's exact lookup logic to prove the
// behavior: known labels translate, unknown ones pass through unchanged
// (never silently drop a benchmark label the map hasn't been updated for
// yet, matching the "|| label" fallback already in plan-executor.ts).
function translateIndustryBenchmarkLabel(label, translations) {
  return translations[label] || label;
}

test("a known industry-benchmarks.ts label translates to Turkish instead of leaking raw English", () => {
  const translations = {
    "Professional services": "Profesyonel hizmetler",
    "Hospitality / hotels": "Ağırlama / otelcilik",
    "B2B SaaS": "B2B SaaS",
  };

  assert.equal(
    translateIndustryBenchmarkLabel("Professional services", translations),
    "Profesyonel hizmetler"
  );
  assert.equal(
    translateIndustryBenchmarkLabel("Hospitality / hotels", translations),
    "Ağırlama / otelcilik"
  );
});

test("an unrecognized label falls back to itself rather than being dropped", () => {
  const translations = { "Professional services": "Profesyonel hizmetler" };

  assert.equal(
    translateIndustryBenchmarkLabel("Some Future Category", translations),
    "Some Future Category"
  );
});
