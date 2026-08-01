import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildLegalReportSections,
  isLegalRenderableReport,
} from "../app/lib/report-engine/legal-report-rendering.ts";

const californiaEmploymentQuery = [
  "I work in California and was employed for four years.",
  "I was terminated for alleged poor performance, with no written warning and no opportunity to respond.",
  "My final salary and unused vacation remain unpaid.",
  "My stock options and vesting status are uncertain.",
  "What employment claims should I consider?",
].join(" ");

test("the production PDF mapping routes a California employment report through the legal payload", () => {
  const sections = [
    {
      field: "subjectIdentification",
      title: "Subject Identification",
      content: "Employment termination and unpaid compensation dispute.",
    },
    {
      field: "extractedFacts",
      title: "Extracted Facts",
      content: [
        "California jurisdiction was not supplied.",
        "Employment duration was not supplied.",
        "Stock options were not supplied.",
      ].join("\n"),
    },
    {
      field: "domainFindings",
      title: "Domain Findings",
      content: [
        "If the account is accurate, the lack of warning and an opportunity to respond may weaken the performance rationale.",
        "Investor-grade: Yes",
        "Investor Ready: Yes",
        "Strategy Model: Generic",
        "Customer validation: Required",
        "CAC: Unknown",
        "Capital efficiency: Unknown",
        "Competition: Unknown",
        "Market: Unknown",
        "Product: Unknown",
        "Market sizing: Unknown",
        "Financial projections: Unknown",
        "KPI estimates: Unknown",
      ].join("\n"),
    },
    {
      field: "regulatoryCompliance",
      title: "Regulatory Compliance",
      content: "Mandatory mediation must be completed before filing. Filing deadlines require jurisdiction-specific review.",
    },
    {
      field: "decisionAssessment",
      title: "Decision Assessment",
      content: "The supplied facts support a directional employment-law assessment, subject to documentary verification.",
    },
    {
      field: "recommendedActions",
      title: "Recommended Actions",
      content: "1. Preserve payroll and termination records.\n2. Confirm filing deadlines.\n3. Obtain jurisdiction-specific legal advice.",
    },
    {
      field: "finalRecommendation",
      title: "Final Recommendation",
      content: "Proceed promptly with evidence preservation and a California deadline review.",
    },
    {
      field: "sources",
      title: "Sources",
      content: [
        "• Official title: California Labor Code",
        "  Publisher: California Legislative Information",
        "  URL: https://leginfo.legislature.ca.gov/faces/codes.xhtml",
        "  Access date: 2026-07-31",
        "  Source type: Official legislation",
        "",
        "• Official title: Validation Required",
        "  Publisher: Not provided",
        "  URL: Not provided",
        "  Access date: access.date.2026",
        "  Source type: internal_source_key",
      ].join("\n"),
    },
  ];
  const report = {
    type: "Business Plan",
    title: "Business Idea Validation",
    prompt: californiaEmploymentQuery,
    sections,
  };

  assert.equal(isLegalRenderableReport(report), true);

  const renderedSections = buildLegalReportSections(
    sections,
    "en",
    californiaEmploymentQuery
  );
  const payload = renderedSections
    .map((section) => `${section.title}\n${section.content}`)
    .join("\n\n");

  for (const suppliedFact of [
    "California",
    "four years",
    "poor performance",
    "no written warning",
    "no opportunity to respond",
    "final salary",
    "unused vacation",
    "stock options",
    "vesting",
  ]) {
    assert.match(payload, new RegExp(suppliedFact, "i"));
  }

  assert.doesNotMatch(
    payload,
    /Investor-grade|Investor Ready|Strategy Model|Customer validation|\bCAC\b|Capital efficiency|Competition|Competitor Analysis|Financial Plan|Brand Strategy|Business Idea Validation|Market sizing|Financial projections|KPI estimates|^Market:|^Product:/im
  );
  assert.doesNotMatch(
    payload,
    /URL:\s*Not provided|Validation Required|access\.date|internal_source_key/i
  );
  assert.doesNotMatch(
    payload,
    /California jurisdiction was not supplied|Employment duration was not supplied|Stock options were not supplied/i
  );
  assert.doesNotMatch(payload, /mandatory mediation/i);
  assert.match(payload, /https:\/\/leginfo\.legislature\.ca\.gov\/faces\/codes\.xhtml/);

  const plannerPdfPath = readFileSync("components/Planner.tsx", "utf8");
  const savedPdfPath = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
  assert.match(plannerPdfPath, /buildLegalReportSections\(/);
  assert.match(savedPdfPath, /buildLegalReportSections\(normalizedSections, pdfLocale, report\.prompt\)/);
});
