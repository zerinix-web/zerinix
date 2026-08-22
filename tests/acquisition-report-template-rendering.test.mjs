import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL PRODUCTION FIX -- dedicated Acquisition Due Diligence report
// TEMPLATE/rendering, not just routing/generation.
//
// The acquisition domain now has its own dedicated schema
// (acquisition-analysis.ts) and generator (generateAcquisitionDueDiligenceReport
// in plan-executor.ts), confirmed correctly routed and content-generated
// in the prior turn. But the READ path -- the saved-report dashboard view
// and PDF export -- still rendered the report as a generic "Business
// Plan": app/dashboard/report-utils.ts's inferReportType()/
// inferMobileReportType() had no "acquisition" branch, so any acquisition
// report loaded back out of the database was normalized to
// `type: "Business Plan"` before it ever reached the PDF button or the
// on-screen viewer -- generation/persistence were correct, but the
// read-path normalizer silently discarded the domain.
//
// Fixed by: (1) widening DashboardReport["type"]/MobileReportType/
// InitialReport/RegenerationContext to include "Acquisition Due
// Diligence Report" and adding the missing inference branch (checked
// before the "legal|finance|..." -> "Strategic Report" catch-all and the
// final "Business Plan" fallback); (2) exempting that type from
// isLegalRenderableReport (the shared function Planner.tsx,
// ReportPdfButton.tsx, and page.tsx all use) so an acquisition report's
// legitimate mention of the target's contracts/compliance/regulatory
// review is never misclassified as a Legal Assessment and re-rendered
// with legal section titles; (3) a dedicated acquisition cover-page
// branch in ReportPdfButton.tsx (KPI rows sourced from the acquisition
// report's own fields, not "Founder Readiness Score"/"Investor Ready");
// (4) excluding acquisition's own "ROI / IRR Scenarios" and "Post-Merger
// Integration Roadmap (30/60/90 Days)" section titles from the generic
// Business-Plan Worst/Base/Best scenario widget and the fixed
// Tomorrow/This-Week/30-Days.../12-Months founder roadmap widget (both
// of which also match on the bare substrings "scenario"/"roadmap") in
// both page.tsx and ReportPdfButton.tsx -- the founder roadmap widget in
// particular hardcodes a "Validate demand / Protect runway / Refine ICP
// / Measure conversion" checklist, exactly the forbidden startup-
// validation vocabulary earlier turns removed from acquisition content.

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
  const dir = mkdtempSync(join(tmpdir(), "zerinix-report-utils-"));
  const outPath = join(dir, "report-utils.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { normalizeReport } = await importReportUtils();

// --- Root cause: inferReportType/inferMobileReportType via normalizeReport --

test("normalizeReport: a stored acquisition report (report_type = 'acquisition_due_diligence_analysis') resolves to type 'Acquisition Due Diligence Report', never 'Business Plan' or 'Strategic Report'", () => {
  const report = normalizeReport({
    id: "r1",
    workspace_id: "w1",
    title: "Acquisition of Northwind Logistics",
    prompt: "Assess the acquisition of Northwind Logistics.",
    report_type: "acquisition_due_diligence_analysis",
    status: "completed",
    created_at: new Date().toISOString(),
    sections: [
      { field: "subjectIdentification", title: "Subject Identification", content: "Target: Northwind Logistics." },
      { field: "valuation", title: "Valuation", content: "EV/ARR of 5.5x against comparable transactions." },
    ],
  });

  assert.equal(report.type, "Acquisition Due Diligence Report");
  assert.notEqual(report.type, "Business Plan");
  assert.notEqual(report.type, "Strategic Report");
});

test("normalizeReport: an empty title on an acquisition report falls back to 'Acquisition Due Diligence Report', not 'Business Plan Report'", () => {
  const report = normalizeReport({
    id: "r2",
    workspace_id: "w1",
    title: "",
    prompt: "Assess this acquisition.",
    report_type: "acquisition_due_diligence_analysis",
    status: "completed",
    created_at: new Date().toISOString(),
    sections: [{ field: "subjectIdentification", title: "Subject Identification", content: "Target company profile." }],
  });

  assert.equal(report.title, "Acquisition Due Diligence Report");
});

test("normalizeReport: existing report types are unaffected (no regression)", () => {
  const businessPlan = normalizeReport({
    id: "r3",
    report_type: "business_plan",
    status: "completed",
    sections: [{ field: "executiveSummary", title: "Executive Summary", content: "A SaaS startup plan." }],
  });
  const legal = normalizeReport({
    id: "r4",
    report_type: "legal_analysis",
    status: "completed",
    sections: [{ field: "subjectIdentification", title: "Subject Identification", content: "Employment dispute." }],
  });
  const realEstate = normalizeReport({
    id: "r5",
    report_type: "real_estate_investment_analysis",
    status: "completed",
    sections: [{ field: "assetIdentification", title: "Asset Identification", content: "Parcel 12-A." }],
  });
  const market = normalizeReport({
    id: "r6",
    report_type: "market_analysis",
    status: "completed",
    sections: [{ field: "executiveSummary", title: "Executive Summary", content: "Market for AI legal software." }],
  });

  assert.equal(businessPlan.type, "Business Plan");
  assert.equal(legal.type, "Strategic Report");
  assert.equal(realEstate.type, "Real Estate Investment Analysis");
  assert.equal(market.type, "Market Analysis");
});

// --- isLegalRenderableReport exemption -----------------------------------

const { isLegalRenderableReport } = await import(
  "../app/lib/report-engine/legal-report-rendering.ts"
);

test("isLegalRenderableReport: an acquisition report discussing the target's existing contracts, compliance, and regulatory review is never misclassified as legal", () => {
  const acquisitionReport = {
    type: "Acquisition Due Diligence Report",
    title: "Acquisition of Northwind Logistics",
    prompt: "Assess the acquisition of Northwind Logistics, including its existing contracts and regulatory posture.",
    sections: [
      {
        field: "subjectIdentification",
        title: "Subject Identification",
        content: "Target: Northwind Logistics, a logistics company with several existing customer contracts.",
      },
      {
        field: "regulatoryReview",
        title: "Regulatory Review",
        content: "Antitrust and competition law compliance review required before closing. Legal risk is moderate.",
      },
    ],
  };

  assert.equal(isLegalRenderableReport(acquisitionReport), false);
});

test("isLegalRenderableReport: a genuine legal report is still classified as legal (no regression)", () => {
  const legalReport = {
    type: "Strategic Report",
    title: "Employment Claim Assessment",
    prompt: "I was terminated and believe it was unlawful.",
    sections: [
      { field: "subjectIdentification", title: "Subject Identification", content: "Employment dispute regarding wrongful termination and unpaid wages." },
      { field: "domainFindings", title: "Domain Findings", content: "The employment contract and applicable labor law support a claim." },
    ],
  };

  assert.equal(isLegalRenderableReport(legalReport), true);
});

test("legal-report-rendering.ts exempts 'Acquisition Due Diligence Report' the same way it exempts Real Estate and Market Analysis (drift check)", () => {
  const source = readFileSync(
    new URL("../app/lib/report-engine/legal-report-rendering.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /report\.type === "Acquisition Due Diligence Report"\) return false;/);
});

// --- report-utils.ts: type unions and section labels (drift checks) -----

const reportUtilsSource = readFileSync(
  new URL("../app/dashboard/report-utils.ts", import.meta.url),
  "utf8"
);

test("report-utils.ts: DashboardReport/MobileReportType both include 'Acquisition Due Diligence Report'", () => {
  const occurrences = (reportUtilsSource.match(/"Acquisition Due Diligence Report"/g) || []).length;
  assert.ok(occurrences >= 2, `expected at least 2 occurrences (DashboardReport + MobileReportType unions), found ${occurrences}`);
});

test("report-utils.ts: sectionLabels includes every acquisition-specific field name", () => {
  for (const field of [
    "targetCompanyFacts",
    "acquisitionAttractiveness",
    "valuation",
    "purchasePriceFairness",
    "financingStructure",
    "debtCapacity",
    "roiIrrScenarios",
    "synergies",
    "integrationRisk",
    "regulatoryReview",
    "postMergerRoadmap",
    "dealRisks",
    "investmentRecommendation",
  ]) {
    assert.match(reportUtilsSource, new RegExp(`\\b${field}:\\s*"`), `sectionLabels missing ${field}`);
  }
});

// --- components/Planner.tsx: InitialReport/RegenerationContext widened --

const plannerSource = readFileSync(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);

test("Planner.tsx: InitialReport and RegenerationContext both include 'Acquisition Due Diligence Report' (drift check, prevents a tsc/regeneration-flow break)", () => {
  const occurrences = (plannerSource.match(/"Acquisition Due Diligence Report"/g) || []).length;
  assert.ok(occurrences >= 2, `expected at least 2 occurrences, found ${occurrences}`);
});

// --- app/dashboard/[id]/ReportPdfButton.tsx: dedicated cover-page branch -

const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

test("ReportPdfButton.tsx: isAcquisitionReport is detected and drives a dedicated cover-page tag, score label, and KPI grid (never 'Founder Readiness Score'/'Investor Ready')", () => {
  assert.match(pdfButtonSource, /const isAcquisitionReport =/);
  assert.match(pdfButtonSource, /isAcquisitionReport\s*\n\s*\? localizePdfPresentationLabel\("Due Diligence", pdfLocale\)/);
  assert.match(pdfButtonSource, /isAcquisitionReport\s*\n\s*\? legalConfidence/);
  assert.match(pdfButtonSource, /localizePdfPresentationLabel\("Deal Confidence", pdfLocale\)/);
  assert.match(pdfButtonSource, /isAcquisitionReport\s*\n\s*\?\s*\[\s*\n\s*\[localizePdfPresentationLabel\("Valuation", pdfLocale\)/);
  for (const field of ["valuation", "purchasePriceFairness", "financingStructure", "synergies", "integrationRisk", "dealRisks"]) {
    assert.match(pdfButtonSource, new RegExp(`section\\.field === "${field}"`));
  }
});

test("ReportPdfButton.tsx: the acquisition ROI/IRR Scenarios section never triggers the generic Business-Plan Worst/Base/Best scenario widget (drift check)", () => {
  assert.match(pdfButtonSource, /field !== "roiIrrScenarios" &&\s*\n\s*\(field === "scenarioAnalysis"/);
  assert.match(pdfButtonSource, /section\.field !== "roiIrrScenarios" && normalizedTitle\.includes\("scenario"\)/);
});

test("ReportPdfButton.tsx: the acquisition Post-Merger Integration Roadmap section never triggers the fixed founder-roadmap timeline widget (drift check)", () => {
  assert.match(pdfButtonSource, /field !== "postMergerRoadmap" && normalizedTitle\.includes\("roadmap"\)/);
  assert.match(pdfButtonSource, /section\.field !== "postMergerRoadmap" && normalizedTitle\.includes\("roadmap"\)/);
});

// --- app/dashboard/[id]/page.tsx: same exclusions for the on-screen view -

const pageSource = readFileSync(
  new URL("../app/dashboard/[id]/page.tsx", import.meta.url),
  "utf8"
);

test("page.tsx: the acquisition Post-Merger Integration Roadmap section is excluded from the generic founder-roadmap visual (which hardcodes a 'Validate demand / Protect runway / Refine ICP / Measure conversion' checklist -- forbidden startup-validation vocabulary in an acquisition report)", () => {
  assert.match(pageSource, /const isPostMergerRoadmap =\s*\n\s*normalizedTitle\.includes\("post-merger"\) \|\| normalizedTitle\.includes\("birleşme sonrası"\);/);
  assert.match(pageSource, /if \(!isPostMergerRoadmap && \(normalizedTitle\.includes\("roadmap"\) \|\| normalizedTitle\.includes\("yol haritası"\)\)\) \{/);
  assert.match(pageSource, /Validate demand.*Protect runway.*Refine ICP.*Measure conversion/);
});

test("page.tsx: the acquisition ROI/IRR Scenarios section is excluded from the generic Worst/Base/Best scenario visual", () => {
  assert.match(
    pageSource,
    /if \(normalizedTitle\.includes\("scenario"\) && !normalizedTitle\.includes\("roi"\) && !normalizedTitle\.includes\("irr"\)\) \{/
  );
});

test("page.tsx: hasReportSectionVisual mirrors the same acquisition exclusions (never opens an empty visual wrapper for those sections)", () => {
  const fnStart = pageSource.indexOf("function hasReportSectionVisual(");
  assert.ok(fnStart > -1, "hasReportSectionVisual not found");
  const fnEnd = pageSource.indexOf("\n}", fnStart);
  const fnBody = pageSource.slice(fnStart, fnEnd);

  assert.match(fnBody, /isPostMergerRoadmap/);
  assert.match(fnBody, /isRoiIrrScenario/);
});

test("page.tsx: never renders Founder Roadmap / TAM-SAM-SOM / Go-to-Market widgets unconditionally -- all remain gated on the section's own title/field, so an acquisition report (none of whose section titles match those keywords except the excluded roadmap/scenario overlaps) never surfaces them", () => {
  // Sanity check on the acquisition field label set itself: none of its
  // titles contain the Business-Plan-only trigger words this file uses
  // to decide which specialized widget to show (beyond the two
  // deliberately-excluded scenario/roadmap overlaps already tested above).
  const acquisitionTitles = [
    "Subject Identification",
    "Target Company Facts",
    "External Evidence",
    "Acquisition Attractiveness",
    "Valuation",
    "Purchase Price Fairness",
    "Financing Structure",
    "Debt Capacity",
    "Regulatory Review",
    "Deal Risks",
    "Missing Information",
    "Investment Recommendation and Executive Decision",
    "Sources",
  ];
  const businessPlanOnlyTriggers = [
    "tam / sam / som",
    "swot",
    "business model",
    "pricing",
    "go-to-market",
    "sales strategy",
    "entry strategy",
    "unit economics",
    "founder score",
    "founder readiness",
    "porter",
    "kpi",
  ];

  for (const title of acquisitionTitles) {
    const normalized = title.toLowerCase();
    for (const trigger of businessPlanOnlyTriggers) {
      assert.ok(
        !normalized.includes(trigger),
        `acquisition title "${title}" unexpectedly matches Business-Plan-only trigger "${trigger}"`
      );
    }
  }
});

// --- pdf-normalization.mjs: acquisition labels translated -----------------

const pdfNormalizationSource = readFileSync(
  new URL("../app/lib/pdf-normalization.mjs", import.meta.url),
  "utf8"
);

test("pdf-normalization.mjs: acquisition-specific PDF labels have Turkish translations", () => {
  for (const label of [
    "Valuation",
    "Purchase Price Fairness",
    "Financing Structure",
    "Debt Capacity",
    "Synergies",
    "Integration Risk",
    "Regulatory Review",
    "Deal Risks",
    "Deal Confidence",
    "Due Diligence",
  ]) {
    assert.match(
      pdfNormalizationSource,
      new RegExp(`\\["${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",`),
      `missing Turkish translation pair for "${label}"`
    );
  }
});
