import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL PRODUCTION FIX -- 2 real, confirmed issues found in a live
// Business Plan PDF for the maritime/shipping fleet-operations prompt:
//
// 1. "Validation Required" (the internal evidence-classification tag) was
//    still customer-visible in the PDF, independent of the report TEXT
//    sanitization fixed in an earlier turn -- because ReportPdfButton.tsx
//    (and its duplicate on-screen counterpart, components/Planner.tsx)
//    have their OWN separate KPI-value/target extraction and Sources
//    citation-metadata logic, which hardcoded "Validation Required" as
//    the fallback for an unclassified source type/confidence and an
//    unresolved KPI value/target -- reintroducing the exact tag the
//    report-text-level fix already removed, at a completely different
//    layer.
// 2. Financial Assumptions (and every other section) lost the prompt's
//    detected geography ("Singapore, Greece, Norway, and the United Arab
//    Emirates" all fell back to the generic "global markets" default),
//    because none of those four countries were recognized by
//    inferFinancialModelingInputs's region-detection patterns at all.

const pdfSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");

async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  const benchmarksPath = join(repoRoot, "app/lib/ai/industry-benchmarks.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(benchmarksPath).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-financial-model-"));
  const outPath = join(dir, "financial-model.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { inferFinancialModelingInputs } = await importFinancialModel();

// Strips // line comments so a drift-check regex only matches real code --
// several of the fixes below intentionally document the old, now-removed
// "Validation Required" string in explanatory prose.
function stripLineComments(code) {
  return code.replace(/\/\/.*$/gm, "");
}

// --- Issue 1: PDF-level "Validation Required" leakage --------------------

for (const [name, source] of [
  ["ReportPdfButton.tsx", pdfSource],
  ["Planner.tsx", plannerSource],
]) {
  test(`${name}: KPI value/target extraction no longer falls back to the literal "Validation Required" tag (drift check)`, () => {
    const kpiFnNames = ["extractKpiValueFromSnippet", "extractKpiObjectField", "extractKpiTargetFromSnippet"];
    for (const fnName of kpiFnNames) {
      const fnMatch = new RegExp(`function ${fnName}\\([\\s\\S]*?\\n\\}`).exec(source);
      assert.ok(fnMatch, `${fnName} not found in ${name}`);
      assert.doesNotMatch(
        stripLineComments(fnMatch[0]),
        /"Validation Required"/,
        `${fnName} in ${name} still falls back to "Validation Required"`
      );
    }
  });
}

test("ReportPdfButton.tsx: Sources citation type/confidence labels are omitted (not shown as 'Validation Required') when genuinely unclassified", () => {
  const sourceTypeFnMatch = /function getPdfCitationSourceTypeLabel\([\s\S]*?\n\}/.exec(pdfSource);
  const trustLabelFnMatch = /function getPdfCitationTrustLabel\([\s\S]*?\n\}/.exec(pdfSource);
  assert.ok(sourceTypeFnMatch, "getPdfCitationSourceTypeLabel not found");
  assert.ok(trustLabelFnMatch, "getPdfCitationTrustLabel not found");
  assert.doesNotMatch(stripLineComments(sourceTypeFnMatch[0]), /"Validation Required"/);
  assert.doesNotMatch(stripLineComments(trustLabelFnMatch[0]), /"Validation Required"/);
  assert.match(sourceTypeFnMatch[0], /return "";/);
  assert.match(trustLabelFnMatch[0], /return "";/);
});

test("ReportPdfButton.tsx: the Source type / Confidence lines are only rendered when the source actually has a classified value (drift check)", () => {
  assert.match(
    pdfSource,
    /\.\.\.\(source\.sourceType \? \[`  Source type: \$\{source\.sourceType\}`\] : \[\]\)/
  );
  assert.match(
    pdfSource,
    /\.\.\.\(source\.trustLabel \? \[`  Confidence: \$\{source\.trustLabel\}`\] : \[\]\)/
  );
});

test("ReportPdfButton.tsx: the zero-citations fallback category list no longer uses 'Validation Required' as a bullet heading (drift check)", () => {
  assert.doesNotMatch(pdfSource, /"• Validation Required"/);
  assert.match(pdfSource, /"• Primary Research"/);
});

test("ReportPdfButton.tsx: the Business Plan confidence-radar fallback (executiveSnapshot.confidenceRadar) no longer shows 'Validation Required' for a null score (drift check)", () => {
  assert.match(
    pdfSource,
    /dimension\.score === null \? "Not yet measured" : `\$\{dimension\.score\}%`/
  );
});

test("simulated PDF Sources block: a citation with an unclassified source type/confidence shows its real title/publisher/year with no 'Validation Required' anywhere", () => {
  function getPdfCitationSourceTypeLabel(level) {
    if (level === "verified") return "Verified Source";
    if (level === "benchmarkDerived") return "Benchmark Derived";
    if (level === "planningAssumption") return "Planning Assumption";
    return "";
  }
  function getPdfCitationTrustLabel(level) {
    if (level === "verified") return "Verified";
    if (level === "benchmarkDerived") return "Benchmark Derived";
    if (level === "planningAssumption") return "Planning Assumption";
    return "";
  }

  const source = {
    sourceName: "Maritime and Port Authority of Singapore Fleet Compliance Report",
    sourceType: getPdfCitationSourceTypeLabel("unclassified"),
    trustLabel: getPdfCitationTrustLabel("unclassified"),
    publisher: "Maritime and Port Authority of Singapore",
    publicationYear: "2024",
    url: "",
    referenceTag: "",
    accessDate: "",
  };

  const lines = [
    `• ${source.sourceName}`,
    ...(source.sourceType ? [`  Source type: ${source.sourceType}`] : []),
    ...(source.publisher ? [`  Publisher: ${source.publisher}`] : []),
    ...(source.publicationYear ? [`  Year: ${source.publicationYear}`] : []),
    ...(source.trustLabel ? [`  Confidence: ${source.trustLabel}`] : []),
  ].join("\n");

  assert.doesNotMatch(lines, /Validation Required/);
  assert.match(lines, /Maritime and Port Authority of Singapore Fleet Compliance Report/);
  assert.match(lines, /Publisher: Maritime and Port Authority of Singapore/);
  assert.match(lines, /Year: 2024/);
});

test("simulated KPI dashboard card: an unresolved value/target renders professional user-facing text, never the internal tag", () => {
  function isMissingKpiText(value) {
    const trimmed = value.trim();
    return !trimmed || /^1$/.test(trimmed) || /\b1\s*\/\s*(?:target\s*[:\-–—]?\s*)?1\b/i.test(value);
  }
  function extractKpiValueFromSnippet(explicitValue) {
    const value = explicitValue || "";
    return !value || isMissingKpiText(value) ? "Not yet measured" : value;
  }
  function extractKpiTargetFromSnippet(target) {
    return isMissingKpiText(target) ? "To be defined" : target;
  }

  assert.equal(extractKpiValueFromSnippet(""), "Not yet measured");
  assert.equal(extractKpiValueFromSnippet("1"), "Not yet measured");
  assert.equal(extractKpiTargetFromSnippet(""), "To be defined");
  assert.equal(extractKpiTargetFromSnippet("1/1"), "To be defined");
});

// --- Issue 2: preserve detected geography ---------------------------------

const maritimePrompt =
  "I want to build a B2B SaaS platform that helps commercial shipping companies optimize fleet operations using AI. The platform predicts vessel maintenance, optimizes fuel consumption, automates voyage planning, monitors regulatory compliance, and integrates with existing maritime ERP systems. The target customers are medium and large shipping companies operating across Singapore, Greece, Norway, and the United Arab Emirates. Revenue will come from annual enterprise subscriptions and usage-based analytics.";

test("the exact live maritime prompt (Singapore, Greece, Norway, UAE) no longer falls back to the generic 'global markets' default (the exact live bug)", () => {
  const geography = inferFinancialModelingInputs(maritimePrompt).geography;

  assert.notEqual(geography, "global markets");
  assert.notEqual(geography, "global");
  const regions = new Set(geography.split(" + "));
  assert.ok(regions.has("Singapore"), `Singapore missing from "${geography}"`);
  assert.ok(regions.has("Europe"), `Europe (Greece/Norway) missing from "${geography}"`);
  assert.ok(regions.has("GCC / Middle East"), `GCC / Middle East (UAE) missing from "${geography}"`);
});

test("'United Arab Emirates' (full name, not just the 'UAE' abbreviation) resolves to GCC / Middle East", () => {
  assert.equal(
    inferFinancialModelingInputs("A logistics platform for the United Arab Emirates market.").geography,
    "GCC / Middle East"
  );
});

test("Greece and Norway individually resolve to Europe, matching this list's existing country-to-region granularity", () => {
  assert.equal(inferFinancialModelingInputs("A SaaS platform for clinics in Greece.").geography, "Europe");
  assert.equal(inferFinancialModelingInputs("A SaaS platform for clinics in Norway.").geography, "Europe");
});

test("Singapore alone resolves to its own 'Singapore' region", () => {
  assert.equal(
    inferFinancialModelingInputs("A fintech platform for small businesses in Singapore.").geography,
    "Singapore"
  );
});

test("previously-fixed multi-region behavior (North America + Europe) is unaffected by the new region patterns (no regression)", () => {
  const inputs = inferFinancialModelingInputs(
    "I am building a veterinary AI platform for clinics across North America and Europe."
  );
  const regions = new Set(inputs.geography.split(" + "));
  assert.deepEqual(regions, new Set(["North America", "Europe"]));
});

test("a prompt naming no region still falls back to the unspecified default, unchanged", () => {
  assert.equal(
    inferFinancialModelingInputs(
      "I am building a warehouse automation software platform for mid-sized logistics companies."
    ).geography,
    "global markets"
  );
});

test("financial-model.ts's sharedAssumptions interpolates the same inputs.geography value directly, not a separately re-derived one (drift check, propagation into Financial Assumptions)", () => {
  const financialModelSource = readFileSync(join(repoRoot, "app/lib/ai/financial-model.ts"), "utf8");
  assert.match(financialModelSource, /`Geography: \$\{inputs\.geography\}`/);
});
