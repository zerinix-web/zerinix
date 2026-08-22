import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// CRITICAL PRODUCT FIX -- convert internal reasoning output into clean
// executive language, across EVERY report type (Business Plan, Market
// Intelligence, Real Estate, Legal/Finance/Accounting/Operations/
// Procurement, Acquisition Due Diligence).
//
// A prior turn built this exact fix scoped to acquisition reports only
// (app/lib/report-engine/acquisition-presentation.ts). This turn widens
// it to every report type, adds "decision engine"/"synthesis provider"/
// "deadline fallback" to the internal-vocabulary list (confirmed live in
// plan-executor.ts's per-domain timeout fallback: "[Basis:verified
// evidence and deadline fallback] The synthesis provider reached its
// deadline ... the existing decision engine."), and adds a genuine
// rewrite -- not just tag-stripping -- for the "[Unknown]
// [Required:field] <template sentence>" shape every domain's timeout
// fallback writes for an unresolved research item, turning it into a
// natural sentence built from the humanized field name. The acquisition-
// only module was superseded and removed; this suite is now the single
// source of truth, exercising the universal sanitizer
// (app/lib/report-engine/report-presentation-sanitizer.ts) across
// multiple report domains so no domain regresses to the old, narrower
// scope.
//
// None of generation, routing, or storage changed -- every fixture below
// is exactly the kind of citation-heavy content plan-executor.ts's
// generators (and their timeout fallbacks) are still deliberately asked
// to produce internally; this suite proves only that none of it reaches
// the customer-facing dashboard viewer or PDF (both read the same
// normalizeReport() output).

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const {
  stripReportPresentationArtifacts,
  sanitizeReportSectionsForPresentation,
  isUniversalCustomerFacingField,
  universalInternalOnlyFields,
} = await import("../app/lib/report-engine/report-presentation-sanitizer.ts");

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
    '"@/app/lib/report-engine/report-presentation-sanitizer"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-engine/report-presentation-sanitizer.ts")).href)
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
const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);

// A realistic acquisition report row, shaped exactly like
// createGroundedAcquisitionTimeoutFallback's actual output plus AI-style
// inline [R#] citations and a leaked decision-intelligence fact line.
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
          "[Verified from uploaded asset] [Asset:financials.pdf] financials.pdf (application/pdf)\n[Verified] Purchase price: $14M\n[Verified] Target ARR: $2.8M",
      },
      {
        field: "externalEvidence",
        title: "External Evidence",
        content:
          "[Verified] [R1] valuation: SaaS EV/ARR benchmark 4.8x-5.5x https://saas-capital.example.com/benchmarks",
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
        content: "[Derived] Equity contribution: $8M\n[Derived] Debt requirement: $6M",
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
          "[Unknown] [Required:valuation_purchase_price] Some external sources could not be verified, so this field is not definitive.\nlegal_domain: legal\nrequested_decision: Assess legal position and decision options",
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
          "[Verified] [R1] valuation: SaaS EV/ARR benchmark https://saas-capital.example.com/benchmarks",
      },
    ],
    ...overrides,
  };
}

// A realistic legal/finance (domain-analysis.ts) report row, shaped like
// createGroundedDomainTimeoutFallback's actual output for a non-
// acquisition specialized domain.
function legalReportRow(overrides = {}) {
  return {
    id: "report-2",
    report_type: "legal_analysis",
    status: "completed",
    sections: [
      {
        field: "subjectIdentification",
        title: "Subject Identification",
        content: "[Verified from uploaded asset] [Asset:contract.pdf] contract.pdf (application/pdf)",
      },
      {
        field: "externalEvidence",
        title: "External Evidence",
        content: "[Verified] [R1] jurisdiction: California employment law https://dir.ca.gov/dlse",
      },
      {
        field: "domainFindings",
        title: "Domain Findings",
        content:
          "[Recommendation] [Basis:verified evidence and deadline fallback] The synthesis provider reached its deadline; this preliminary report was completed from verified evidence and the existing decision engine.\n[Recommendation] [Basis:decision engine] Proceed with a formal wage claim.",
      },
      {
        field: "missingInformation",
        title: "Missing Information",
        content:
          "[Unknown] [Required:employment_records] Some external sources could not be verified, so this field is not definitive.",
      },
      {
        field: "sources",
        title: "Sources",
        content: "[Verified] [R1] jurisdiction: California employment law https://dir.ca.gov/dlse",
      },
    ],
    ...overrides,
  };
}

// --- 1. No internal labels appear in the customer-facing report (any domain)

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

test("normalizeReport strips every internal citation/provenance bracket tag from a legal/finance (non-acquisition) report's rendered sections -- the fix is not acquisition-only", () => {
  const report = normalizeReport(legalReportRow());
  const allContent = report.sections.map((s) => s.content).join("\n");

  assert.doesNotMatch(allContent, /\[R\d+\]/);
  assert.doesNotMatch(allContent, /Verified from (?:official|external|uploaded asset)/i);
  assert.doesNotMatch(allContent, /\[Recommendation\]/);
  assert.doesNotMatch(allContent, /\[Unknown\]/);
  assert.doesNotMatch(allContent, /\[Required:/);
  assert.doesNotMatch(allContent, /\[Basis:/);
  assert.doesNotMatch(allContent, /\[Asset:/);
});

test("normalizeReport strips publisher and URL lists from a report's rendered sections", () => {
  const report = normalizeReport(acquisitionReportRow());
  const allContent = report.sections.map((s) => s.content).join("\n");

  assert.doesNotMatch(allContent, /https?:\/\//i, "a raw URL leaked");
  assert.doesNotMatch(allContent, /^\s*Publisher\s*[:\-]/im, "a 'Publisher:' line leaked");
  assert.doesNotMatch(allContent, /Confidence classification/i, "an internal confidence-classification label leaked");
  assert.doesNotMatch(allContent, /confidence\s*\d{1,3}\/100/i, "an internal confidence score leaked");
});

test("normalizeReport strips 'evidence registry'/'research task registry'/'executive assessment'/'decision engine'/'synthesis provider'/'deadline fallback' internal vocabulary from any report", () => {
  for (const row of [acquisitionReportRow(), legalReportRow()]) {
    const report = normalizeReport(row);
    const allContent = report.sections.map((s) => s.content).join("\n");

    assert.doesNotMatch(allContent, /evidence registry/i);
    assert.doesNotMatch(allContent, /research task registry/i);
    assert.doesNotMatch(allContent, /executive assessment/i);
    assert.doesNotMatch(allContent, /decision engine/i);
    assert.doesNotMatch(allContent, /synthesis provider/i);
    assert.doesNotMatch(allContent, /deadline fallback/i);
  }
});

test("normalizeReport strips a leaked 'legal_domain: legal' / 'requested_decision: ...' decision-intelligence fact from any report", () => {
  const report = normalizeReport(acquisitionReportRow());
  const allContent = report.sections.map((s) => s.content).join("\n");

  assert.doesNotMatch(allContent, /legal_domain/i);
  assert.doesNotMatch(allContent, /requested_decision/i);
  assert.doesNotMatch(allContent, /Assess legal position/i);
});

// --- 2. No Sources section appears (any domain) ----------------------------

test("normalizeReport never renders the 'Sources' or 'External Evidence' sections, for acquisition or legal/finance reports alike", () => {
  for (const row of [acquisitionReportRow(), legalReportRow()]) {
    const report = normalizeReport(row);
    const titles = report.sections.map((s) => s.title);
    const fields = report.sections.map((s) => s.field);

    assert.ok(!titles.includes("Sources"));
    assert.ok(!titles.includes("External Evidence"));
    assert.ok(!fields.includes("sources"));
    assert.ok(!fields.includes("externalEvidence"));
  }
});

test("isUniversalCustomerFacingField / universalInternalOnlyFields exactly identify sources and externalEvidence as internal-only, nothing else", () => {
  assert.deepEqual([...universalInternalOnlyFields].sort(), ["externalEvidence", "sources"]);
  assert.equal(isUniversalCustomerFacingField("sources"), false);
  assert.equal(isUniversalCustomerFacingField("externalEvidence"), false);
  for (const field of ["strategicFit", "valuationAnalysis", "domainFindings", "missingInformation", "finalRecommendation"]) {
    assert.equal(isUniversalCustomerFacingField(field), true, `${field} should remain customer-facing`);
  }
});

test("Business Plan's own 'sourcesAssumptions' field (a different field name from 'sources') is not excluded by the universal field list -- it legitimately mixes assumptions with citations, still content-sanitized like any other field", () => {
  const businessRow = {
    id: "r3",
    report_type: "business_plan",
    status: "completed",
    sections: [
      {
        field: "sourcesAssumptions",
        title: "Sources / Assumptions",
        content: "Publisher: Statista\nhttps://statista.com/report\nAssumption: 15% annual market growth.",
      },
    ],
  };
  const report = normalizeReport(businessRow);
  assert.equal(report.sections.length, 1);
  assert.equal(report.sections[0].field, "sourcesAssumptions");
  assert.doesNotMatch(report.sections[0].content, /Publisher:/);
  assert.doesNotMatch(report.sections[0].content, /https?:\/\//);
  assert.match(report.sections[0].content, /Assumption: 15% annual market growth\./);
});

// --- 3. No R identifiers appear (any domain) -------------------------------

test("stripReportPresentationArtifacts removes every R# identifier shape, regardless of digit count", () => {
  for (const raw of ["[R1] claim text", "[R2] claim text", "[R42] claim text", "[R123] claim text"]) {
    assert.doesNotMatch(stripReportPresentationArtifacts(raw), /\[R\d+\]/);
  }
});

// --- 4. Final report reads like a premium executive advisor ---------------
// ---    (the [Unknown][Required:field] rewrite, not just tag-stripping) ---

test("stripReportPresentationArtifacts rewrites the exact BAD fallback sentence into natural executive language, per the fix's own required example", () => {
  const rewritten = stripReportPresentationArtifacts(
    "[Unknown] [Required:valuation_purchase_price] Some external sources could not be verified."
  );
  assert.doesNotMatch(rewritten, /\[Unknown\]/);
  assert.doesNotMatch(rewritten, /\[Required:/);
  assert.doesNotMatch(rewritten, /Some external sources could not be verified/);
  assert.match(rewritten, /^Valuation purchase price requires additional verification before this can be finalized\.$/);
});

test("stripReportPresentationArtifacts's rewrite works for any humanized field identifier, not just the one named example", () => {
  const rewritten = stripReportPresentationArtifacts(
    "[Unknown] [Required:employment_records] Some external sources could not be verified, so this field is not definitive."
  );
  assert.match(rewritten, /^Employment records requires additional verification before this can be finalized\.$/);
});

test("normalizeReport's rewritten sentence never contains internal template phrasing ('Some external sources could not be verified', 'this field is not definitive') anywhere in the final report", () => {
  for (const row of [acquisitionReportRow(), legalReportRow()]) {
    const report = normalizeReport(row);
    const allContent = report.sections.map((s) => s.content).join("\n");
    assert.doesNotMatch(allContent, /Some external sources could not be verified/i);
    assert.doesNotMatch(allContent, /this field is not definitive/i);
  }
});

test("normalizeReport preserves the [Verified]/[Derived] deal-fact labels and figures exactly -- purchase price, ARR, EV/ARR, financing figures survive the rewrite untouched", () => {
  const report = normalizeReport(acquisitionReportRow());
  const targetOverview = report.sections.find((s) => s.field === "targetCompanyOverview")?.content || "";
  const valuation = report.sections.find((s) => s.field === "valuationAnalysis")?.content || "";
  const financing = report.sections.find((s) => s.field === "financingStructure")?.content || "";

  assert.match(targetOverview, /\[Verified\] Purchase price: \$14M/);
  assert.match(targetOverview, /\[Verified\] Target ARR: \$2\.8M/);
  assert.match(valuation, /\[Derived\] EV\/ARR: 5\.0x/);
  assert.match(financing, /\[Derived\] Equity contribution: \$8M/);
  assert.match(financing, /\[Derived\] Debt requirement: \$6M/);
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

test("stripReportPresentationArtifacts never mangles ordinary report prose that happens to mention 'employees'", () => {
  const sanitized = stripReportPresentationArtifacts(
    "The target company has 18 employees and 150 enterprise customers as of the most recent verified count."
  );
  assert.equal(
    sanitized,
    "The target company has 18 employees and 150 enterprise customers as of the most recent verified count."
  );
});

test("sanitizeReportSectionsForPresentation drops a section that becomes fully empty after stripping (all internal artifact, no real prose), rather than rendering a blank card", () => {
  const sections = sanitizeReportSectionsForPresentation([
    { field: "missingInformation", title: "Missing Information", content: "[Unknown] [Required:x]" },
    { field: "strategicFit", title: "Strategic Fit", content: "Real analysis survives." },
  ]);
  // [Unknown][Required:x] rewrites into a real sentence, not empty content,
  // so both sections should actually survive -- proving the rewrite (not
  // deletion) is what happens for this specific shape.
  assert.equal(sections.length, 2);
  assert.ok(sections.some((s) => s.field === "missingInformation"));
  assert.match(
    sections.find((s) => s.field === "missingInformation").content,
    /^X requires additional verification before this can be finalized\.$/
  );
});

test("sanitizeReportSectionsForPresentation drops a section that becomes fully empty after stripping non-rewritable internal artifact (e.g. a bare citation with no rewrite rule)", () => {
  const sections = sanitizeReportSectionsForPresentation([
    { field: "someField", title: "Some Field", content: "[R1] [Asset:file.pdf]" },
    { field: "strategicFit", title: "Strategic Fit", content: "Real analysis survives." },
  ]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].field, "strategicFit");
});

// --- 5. Drift checks: generation/routing/reasoning are untouched ----------

test("plan-executor.ts's per-domain timeout fallbacks are unmodified by this fix -- they still write the full citation-tag detail internally (drift check, proves this fix is presentation-only)", () => {
  assert.match(planExecutorSource, /\[Basis:acquisition evidence registry\]/);
  assert.match(planExecutorSource, /\[Basis:research task registry\]/);
  assert.match(planExecutorSource, /The synthesis provider reached its deadline/);
  assert.match(planExecutorSource, /existing decision engine/);
});

test("report-utils.ts applies the universal presentation sanitizer unconditionally, for every report type, not gated on a specific report_type (drift check)", () => {
  const reportUtilsSource = readFileSync(
    new URL("../app/dashboard/report-utils.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    reportUtilsSource,
    /const sections = sanitizeReportSectionsForPresentation\(normalizeSections\(row\)\);/
  );
  assert.doesNotMatch(reportUtilsSource, /reportType === "Acquisition Due Diligence Report"\s*\n\s*\? sanitizeReportSectionsForPresentation/);
});

test("ReportPdfButton.tsx reads report.sections from the same normalized report object the dashboard viewer uses -- no separate/duplicated section source that could bypass the sanitizer (drift check)", () => {
  assert.doesNotMatch(pdfButtonSource, /from\s+["']@\/app\/lib\/report-engine\/report-presentation-sanitizer["']/);
  assert.match(pdfButtonSource, /report\.sections/);
});

test("acquisition prompts remain classified as Acquisition Due Diligence -- report_type resolves to the correct title, never a legal/generic one (routing untouched by this fix)", () => {
  const report = normalizeReport(acquisitionReportRow());
  assert.equal(report.type, "Acquisition Due Diligence Report");
});
