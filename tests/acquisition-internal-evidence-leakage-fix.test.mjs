import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// CRITICAL FIX -- remove internal evidence leakage from acquisition
// reports.
//
// Acquisition routing/generation/isolation are all already correct (prior
// turns) -- this is a presentation-layer-only fix: the AI (and, for the
// timeout fallback, plan-executor.ts's createGroundedAcquisitionTimeout
// Fallback) is deliberately still asked to populate rich, citation-heavy
// content -- confirmed live, that fallback writes literal
// "[Basis:acquisition evidence registry]" and "[Basis:research task
// registry]" tags into strategicFit/valuationAnalysis/revenueSynergies/
// costSynergies/... and every field carries [Recommendation]/[Unknown]/
// [Required:...]/[Asset:...] classification tags; the externalEvidence
// and sources fields are instructed to cite "[R#]" evidence-registry IDs
// and list publisher/URL detail directly. None of that changed here --
// the stored report row keeps it all, exactly as generated, for internal
// reasoning. This suite proves only that none of it ever reaches the
// customer-facing dashboard viewer or PDF (both read the same
// normalizeReport() output), while the deterministic [Verified]/[Derived]
// deal-fact labels (purchase price, ARR, EV/ARR, financing split) survive
// untouched.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const {
  stripAcquisitionInternalArtifacts,
  sanitizeAcquisitionReportSections,
  isAcquisitionCustomerFacingField,
  acquisitionInternalOnlyFields,
} = await import("../app/lib/report-engine/acquisition-presentation.ts");

async function importReportUtils() {
  const sourcePath = join(repoRoot, "app/dashboard/report-utils.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-investment-score"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-investment-score.ts")).href)
  );
  source = source.replace(
    '"@/app/lib/report-section-normalization"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-section-normalization.ts")).href)
  );
  source = source.replace(
    '"@/app/lib/report-engine/acquisition-presentation"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-engine/acquisition-presentation.ts")).href)
  );
  const dir = mkdtempSync(join(tmpdir(), "zerinix-report-utils-"));
  const outPath = join(dir, "report-utils.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { normalizeReport } = await importReportUtils();

const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
const acquisitionAnalysisSource = readFileSync(
  new URL("../app/lib/report-engine/prompts/acquisition-analysis.ts", import.meta.url),
  "utf8"
);
const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);

// A realistic acquisition report row, shaped exactly like
// createGroundedAcquisitionTimeoutFallback's actual output (the most
// citation-tag-dense real path in the codebase) plus AI-style inline
// [R#] citations and a leaked decision-intelligence fact line, so this
// suite exercises the worst real-world case, not a synthetic strawman.
function acquisitionReportRow(overrides = {}) {
  return {
    id: "report-1",
    report_type: "acquisition_due_diligence_analysis",
    status: "completed",
    prompt: "We are acquiring a cybersecurity SaaS company. Purchase price is $14M...",
    sections: [
      {
        field: "executiveAcquisitionSummary",
        title: "Executive Acquisition Summary",
        content:
          "[Recommendation] [Basis:decision engine] The synthesis provider reached its deadline; this preliminary report was completed from verified evidence and the existing decision engine.\n[Recommendation] [Basis:decision engine] Proceed conditionally on confirmed financing terms.",
      },
      {
        field: "targetCompanyOverview",
        title: "Target Company Overview",
        content:
          "[Verified from uploaded asset] [Asset:financials.pdf] financials.pdf (application/pdf)\n[Verified] Purchase price: $14M\n[Verified] Target ARR: $2.8M\n[Verified] Enterprise customers: 150\n[Verified] Employees: 18\n[Verified] Buyer available capital: $8M",
      },
      {
        field: "externalEvidence",
        title: "External Evidence",
        content:
          "[Verified] [R1] valuation: SaaS EV/ARR benchmark 4.8x-5.5x https://saas-capital.example.com/benchmarks\n[Verified] [R2] regulatory: BaFin DORA notice requirement https://bafin.de/dora",
      },
      {
        field: "strategicFit",
        title: "Strategic Fit",
        content:
          "[Recommendation] [Basis:acquisition evidence registry] Cross-sell opportunity into existing enterprise base | Expansion into adjacent market segment",
      },
      {
        field: "valuationAnalysis",
        title: "Valuation Analysis (EV/ARR, Purchase Price Fairness)",
        content:
          "[Derived] EV/ARR: 5.0x\n[R1] Comparable SaaS transactions average 4.8x-5.5x EV/ARR per industry data, supporting the $14M purchase price as fair.",
      },
      {
        field: "financingStructure",
        title: "Financing Structure",
        content:
          "[Derived] Equity contribution: $8M\n[Derived] Debt requirement: $6M\n[Derived] Debt share of purchase price: 42.9%\n[Derived] Equity share: 57.1%",
      },
      {
        field: "regulatoryReview",
        title: "Regulatory Review",
        content:
          "Publisher: BaFin\nSource URL: https://bafin.de/dora\nConfidence classification: Verified (92/100)\nThis deal will require a DORA notice to BaFin given the target's role as an ICT third-party service provider to financial entities.",
      },
      {
        field: "missingInformation",
        title: "Missing Information",
        content:
          "[Unknown] [Required:regulatory filings] Some external sources could not be verified, so this field is not definitive.\nlegal_domain: legal\nrequested_decision: Assess legal position and decision options",
      },
      {
        field: "finalInvestmentRecommendation",
        title: "Final Investment Recommendation",
        content:
          "[Recommendation] [Basis:decision engine] Proceed conditionally: financing terms and BaFin notice timeline are the two open items before close.",
      },
      {
        field: "sources",
        title: "Sources",
        content:
          "[Verified from uploaded asset] [Asset:financials.pdf] financials.pdf (application/pdf)\n[Verified] [R1] valuation: SaaS EV/ARR benchmark https://saas-capital.example.com/benchmarks\n[Verified] [R2] regulatory: BaFin DORA notice requirement https://bafin.de/dora",
      },
    ],
    ...overrides,
  };
}

// --- 1. Acquisition PDF/UI contains no internal evidence labels ----------

test("normalizeReport strips every internal citation/provenance bracket tag from an acquisition report's rendered sections", () => {
  const report = normalizeReport(acquisitionReportRow());
  const allContent = report.sections.map((s) => s.content).join("\n");

  assert.doesNotMatch(allContent, /\[R\d+\]/, "raw [R#] citation markers leaked");
  assert.doesNotMatch(allContent, /Verified from (?:official|external|uploaded asset)/i, "'Verified from X source' tags leaked");
  assert.doesNotMatch(allContent, /\[Recommendation\]/, "[Recommendation] classification tag leaked");
  assert.doesNotMatch(allContent, /\[Unknown\]/, "[Unknown] classification tag leaked");
  assert.doesNotMatch(allContent, /\[Required:/, "[Required:...] tag leaked");
  assert.doesNotMatch(allContent, /\[Basis:/, "[Basis:...] tag leaked");
  assert.doesNotMatch(allContent, /\[Asset:/, "[Asset:...] tag leaked");
});

test("normalizeReport strips publisher and URL lists from an acquisition report's rendered sections", () => {
  const report = normalizeReport(acquisitionReportRow());
  const allContent = report.sections.map((s) => s.content).join("\n");

  assert.doesNotMatch(allContent, /https?:\/\//i, "a raw URL leaked");
  assert.doesNotMatch(allContent, /^\s*Publisher\s*[:\-]/im, "a 'Publisher:' line leaked");
  assert.doesNotMatch(allContent, /Confidence classification/i, "an internal confidence-classification label leaked");
  assert.doesNotMatch(allContent, /confidence\s*\d{1,3}\/100/i, "an internal confidence score leaked");
});

test("normalizeReport strips 'evidence registry'/'research task registry'/'executive assessment' internal vocabulary from an acquisition report", () => {
  const report = normalizeReport(acquisitionReportRow());
  const allContent = report.sections.map((s) => s.content).join("\n");

  assert.doesNotMatch(allContent, /evidence registry/i);
  assert.doesNotMatch(allContent, /research task registry/i);
  assert.doesNotMatch(allContent, /executive assessment/i);
});

// --- 2. No Sources / External Evidence section appears --------------------

test("normalizeReport never renders the 'Sources' or 'External Evidence' sections for an acquisition report", () => {
  const report = normalizeReport(acquisitionReportRow());
  const titles = report.sections.map((s) => s.title);
  const fields = report.sections.map((s) => s.field);

  assert.ok(!titles.includes("Sources"));
  assert.ok(!titles.includes("External Evidence"));
  assert.ok(!fields.includes("sources"));
  assert.ok(!fields.includes("externalEvidence"));
});

test("isAcquisitionCustomerFacingField / acquisitionInternalOnlyFields exactly identify sources and externalEvidence as internal-only, nothing else", () => {
  assert.deepEqual([...acquisitionInternalOnlyFields].sort(), ["externalEvidence", "sources"]);
  assert.equal(isAcquisitionCustomerFacingField("sources"), false);
  assert.equal(isAcquisitionCustomerFacingField("externalEvidence"), false);
  for (const field of [
    "executiveAcquisitionSummary",
    "targetCompanyOverview",
    "strategicFit",
    "valuationAnalysis",
    "financingStructure",
    "debtCapacity",
    "roiAnalysis",
    "irrAnalysis",
    "revenueSynergies",
    "costSynergies",
    "integrationRisks",
    "operationalRisks",
    "regulatoryReview",
    "competitivePosition",
    "dealRisks",
    "postMergerIntegrationPlan",
    "missingInformation",
    "finalInvestmentRecommendation",
  ]) {
    assert.equal(isAcquisitionCustomerFacingField(field), true, `${field} should remain customer-facing`);
  }
});

test("a non-acquisition report (e.g. Business Plan) is completely unaffected -- its Sources section still renders", () => {
  const businessRow = {
    id: "r2",
    report_type: "business_plan",
    status: "completed",
    sections: [
      { field: "sources", title: "Sources", content: "Publisher: Statista\nhttps://statista.com/report" },
    ],
  };
  const report = normalizeReport(businessRow);
  assert.equal(report.sections.length, 1);
  assert.equal(report.sections[0].title, "Sources");
});

// --- 3. No legal-domain metadata appears -----------------------------------

test("normalizeReport strips a leaked 'legal_domain: legal' / 'requested_decision: ...' decision-intelligence fact from an acquisition report", () => {
  const report = normalizeReport(acquisitionReportRow());
  const allContent = report.sections.map((s) => s.content).join("\n");

  assert.doesNotMatch(allContent, /legal_domain/i);
  assert.doesNotMatch(allContent, /requested_decision/i);
  assert.doesNotMatch(allContent, /Assess legal position/i);
});

test("acquisition prompts remain classified as Acquisition Due Diligence -- report_type resolves to the correct title, never a legal/generic one (routing untouched by this fix)", () => {
  const report = normalizeReport(acquisitionReportRow());
  assert.equal(report.type, "Acquisition Due Diligence Report");
});

// --- 4. User-facing report remains natural executive language + preserves -
// ---    Purchase price / ARR / EV/ARR / financing calculations ------------

test("normalizeReport preserves the [Verified]/[Derived] deal-fact labels and figures exactly -- purchase price, ARR, EV/ARR, financing split", () => {
  const report = normalizeReport(acquisitionReportRow());
  const targetOverview = report.sections.find((s) => s.field === "targetCompanyOverview")?.content || "";
  const valuation = report.sections.find((s) => s.field === "valuationAnalysis")?.content || "";
  const financing = report.sections.find((s) => s.field === "financingStructure")?.content || "";

  assert.match(targetOverview, /\[Verified\] Purchase price: \$14M/);
  assert.match(targetOverview, /\[Verified\] Target ARR: \$2\.8M/);
  assert.match(valuation, /\[Derived\] EV\/ARR: 5\.0x/);
  assert.match(financing, /\[Derived\] Equity contribution: \$8M/);
  assert.match(financing, /\[Derived\] Debt requirement: \$6M/);
  assert.match(financing, /\[Derived\] Debt share of purchase price: 42\.9%/);
  assert.match(financing, /\[Derived\] Equity share: 57\.1%/);
});

test("normalizeReport leaves natural executive-language sentences intact after stripping internal tags -- the fix removes labels, not analysis", () => {
  const report = normalizeReport(acquisitionReportRow());
  const strategicFit = report.sections.find((s) => s.field === "strategicFit")?.content || "";
  const regulatoryReview = report.sections.find((s) => s.field === "regulatoryReview")?.content || "";
  const finalRecommendation = report.sections.find((s) => s.field === "finalInvestmentRecommendation")?.content || "";

  assert.match(strategicFit, /Cross-sell opportunity into existing enterprise base/);
  assert.match(
    regulatoryReview,
    /This deal will require a DORA notice to BaFin given the target's role as an ICT third-party service provider/
  );
  assert.match(
    finalRecommendation,
    /Proceed conditionally: financing terms and BaFin notice timeline are the two open items before close\./
  );
});

test("stripAcquisitionInternalArtifacts never mangles ordinary acquisition prose that happens to mention 'employees' -- the leaked-fact-line stripper only matches the exact leaked field-name shapes, not ordinary sentences", () => {
  const sanitized = stripAcquisitionInternalArtifacts(
    "The target company has 18 employees and 150 enterprise customers as of the most recent verified count."
  );
  assert.equal(
    sanitized,
    "The target company has 18 employees and 150 enterprise customers as of the most recent verified count."
  );
});

test("sanitizeAcquisitionReportSections drops a section that becomes fully empty after stripping (all internal artifact, no real prose), rather than rendering a blank card", () => {
  const sections = sanitizeAcquisitionReportSections([
    { field: "missingInformation", title: "Missing Information", content: "[Unknown] [Required:x]" },
    { field: "strategicFit", title: "Strategic Fit", content: "Real analysis survives." },
  ]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].field, "strategicFit");
});

// --- 5. Drift checks: the producer/generation side is untouched -----------

test("acquisition-analysis.ts's field schema and prompts are unmodified by this fix -- externalEvidence and sources are still generated (for internal reasoning), only the presentation layer hides them (drift check)", () => {
  assert.match(acquisitionAnalysisSource, /externalEvidence:/);
  assert.match(acquisitionAnalysisSource, /sources:/);
  assert.match(acquisitionAnalysisSource, /evidence registry ID/);
});

test("plan-executor.ts's acquisition timeout fallback is unmodified by this fix -- it still writes the full citation-tag detail internally (drift check, proves this fix is presentation-only)", () => {
  assert.match(planExecutorSource, /\[Basis:acquisition evidence registry\]/);
  assert.match(planExecutorSource, /\[Basis:research task registry\]/);
});

test("report-utils.ts applies the acquisition sanitizer only for report_type acquisition_due_diligence_analysis, not for any other report type (drift check)", () => {
  const reportUtilsSource = readFileSync(
    new URL("../app/dashboard/report-utils.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    reportUtilsSource,
    /reportType === "Acquisition Due Diligence Report"\s*\n\s*\? sanitizeAcquisitionReportSections\(normalizeSections\(row\)\)/
  );
});

test("ReportPdfButton.tsx reads report.sections from the same normalized report object the dashboard viewer uses -- no separate/duplicated section source that could bypass the sanitizer (drift check)", () => {
  assert.doesNotMatch(pdfButtonSource, /from\s+["']@\/app\/lib\/report-engine\/acquisition-presentation["']/);
  assert.match(pdfButtonSource, /report\.sections/);
});
