import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const exporter = readFileSync(
  "app/dashboard/[id]/ReportPdfButton.tsx",
  "utf8"
);
const realEstatePdf = readFileSync(
  "app/lib/pdf-engine/real-estate-report.ts",
  "utf8"
);

test("real-estate reports use the dedicated enterprise PDF before the legacy exporter", () => {
  const branchIndex = exporter.indexOf("isRealEstateDashboardReport(report)");
  const legacyIndex = exporter.indexOf("const pdf = createPdfDocument()", branchIndex);

  assert.ok(branchIndex > 0);
  assert.ok(legacyIndex > branchIndex);
  assert.match(exporter, /createRealEstateReportPdf\(\{\s*report,\s*fontBase64/);
  assert.match(exporter, /deliverPdf\(realEstatePdf, report, setError\)/);
});

test("enterprise real-estate PDF implements the twelve-page decision architecture", () => {
  for (const section of [
    "executiveDecision",
    "dashboard",
    "propertyOverview",
    "locationAnalysis",
    "legalDueDiligence",
    "zoningDevelopment",
    "marketLiquidity",
    "financialAnalysis",
    "riskMatrix",
    "dueDiligence",
    "sourcesMethodology",
  ]) {
    assert.match(realEstatePdf, new RegExp(`copy\\.${section}`));
  }

  assert.match(realEstatePdf, /drawCover\(pdf, report, locale, copy\)/);
  assert.match(realEstatePdf, /pages\.forEach\(\(renderPage, index\)/);
});

test("developer diagnostics and research-provider internals are removed from PDF content", () => {
  for (const diagnosticPattern of [
    "provider_unavailable",
    "completed_no_evidence",
    "request (?:was )?aborted",
    "api|http",
    "openai|tavily|perplexity|firecrawl|serper|exa",
    "execution|pipeline|runtime|stack",
    "json",
  ]) {
    assert.ok(realEstatePdf.toLowerCase().includes(diagnosticPattern));
  }

  assert.match(
    realEstatePdf,
    /developerDiagnosticPatterns\.some\(\(pattern\) => pattern\.test\(line\)\)/
  );
  assert.match(realEstatePdf, /sourceNoisePatterns\.some/);
});

test("real-estate presentation never invents an investment score or valuation", () => {
  assert.match(
    realEstatePdf,
    /typeof value === "number" && Number\.isFinite\(value\)/
  );
  assert.match(realEstatePdf, /score === null \? "--"/);
  assert.match(
    realEstatePdf,
    /Additional evidence required for valuation/
  );
  assert.match(realEstatePdf, /değerleme yapılamadı/);
  assert.doesNotMatch(realEstatePdf, /Math\.random/);
});
