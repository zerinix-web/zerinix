import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const forbiddenDisplayLiterals = [
  "Source unavailable",
  "TBD",
  "Placeholder",
  "Unknown",
  "Confidence unavailable",
  "Unavailable",
];

const reportSurfaceFiles = [
  "components/Planner.tsx",
  "app/dashboard/[id]/page.tsx",
  "app/dashboard/[id]/ReportPdfButton.tsx",
];

test("Market Analysis report surfaces do not render forbidden placeholder strings", () => {
  for (const file of reportSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    for (const forbidden of forbiddenDisplayLiterals) {
      assert.equal(
        source.includes(forbidden),
        false,
        `${file} must not render ${forbidden}`
      );
    }

    assert.equal(
      source.includes('|| "Assumption"'),
      false,
      `${file} must not use Assumption as a visual fallback`
    );
  }
});

test("Market Analysis partial report copy is professional and not debug-facing", () => {
  const source = readFileSync("app/api/market-analysis/route.ts", "utf8");

  assert.equal(source.includes("was missing or incomplete"), false);
  assert.equal(source.includes("sections were missing"), false);
  assert.equal(source.includes("write exactly: Source unavailable"), false);
  assert.equal(source.includes("Yeni analiz geçişi gerekir"), false);
  assert.equal(source.includes("requires a fresh analysis pass to produce"), false);
});

test("Market Analysis supports mobility-specific financial routing", () => {
  const modelSource = readFileSync("app/lib/ai/financial-model.ts", "utf8");
  const benchmarkSource = readFileSync("app/lib/ai/industry-benchmarks.ts", "utf8");
  const assumptionsSource = readFileSync("app/lib/ai/financial-assumptions.ts", "utf8");
  const plannerSource = readFileSync("components/Planner.tsx", "utf8");

  assert.match(modelSource, /scooter\|scooters/);
  assert.match(modelSource, /asset-heavy rental \/ utilization model/);
  assert.match(modelSource, /per-ride rental plus passes/);
  assert.match(modelSource, /Monthly Revenue per Active Rider/);
  assert.match(modelSource, /Rider CAC/);
  assert.match(modelSource, /Rider LTV/);
  assert.match(assumptionsSource, /active riders/);
  assert.match(plannerSource, /mobilityFinancialDashboardMetrics/);
  assert.match(plannerSource, /Yearly Revenue/);
  assert.match(plannerSource, /Monthly Revenue/);
  assert.match(benchmarkSource, /Mobility \/ scooter rental/);
});

test("Market Analysis visuals protect TAM cards, citations, and metric number wrapping", () => {
  const plannerSource = readFileSync("components/Planner.tsx", "utf8");
  const detailSource = readFileSync("app/dashboard/[id]/page.tsx", "utf8");
  const pdfSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");

  for (const source of [plannerSource, detailSource]) {
    assert.match(source, /sm:grid-cols-\[4rem_minmax\(0,1fr\)_minmax\(7rem,auto\)\]/);
    assert.match(source, /whitespace-nowrap/);
    assert.match(source, /Publisher/);
    assert.match(source, /Year/);
    assert.match(source, /Confidence/);
  }

  assert.doesNotMatch(plannerSource, /<span>\{bar\.label\}<\/span>/);
  assert.doesNotMatch(detailSource, /<span>\{bar\.label\}<\/span>/);
  assert.match(plannerSource, /getTamRows/);
  assert.match(pdfSource, /getTamRows/);
  assert.match(plannerSource, /rowY \+= rowHeight \+ 3/);
  assert.match(pdfSource, /rowY \+= rowHeight \+ 3/);
  assert.match(plannerSource, /getSwotLayout/);
  assert.match(pdfSource, /getSwotLayout/);
  assert.match(plannerSource, /getFinancialLayout/);
  assert.match(pdfSource, /getFinancialLayout/);
  assert.match(plannerSource, /drawSingleLine\(value \|\| "—"/);
  assert.match(pdfSource, /drawSingleLine\(value \|\| "—"/);
  assert.doesNotMatch(pdfSource, /splitTextToSize\(value/);
  assert.match(pdfSource, /formatPdfCitationContent/);
  assert.match(pdfSource, /Publisher:/);
  assert.match(pdfSource, /URL:/);
});
