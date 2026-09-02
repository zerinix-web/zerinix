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

// CRITICAL FIX -- apply presentation sanitization to ALL report surfaces:
// this policy changed from the prior turn. Business Plan's own
// "Sources / Assumptions" section (field "sourcesAssumptions", a
// different field name from "sources") IS now excluded entirely, by
// title, not just content-sanitized -- the requirement is to REMOVE the
// section completely, matching every other report type's Sources
// section, not merely to clean the citation detail out of it.
test("Business Plan's own 'Sources / Assumptions' section is now excluded entirely, by title, matching the 'remove the Sources section completely' requirement for every report type", () => {
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
  assert.equal(report.sections.length, 0);
});

test("a genuinely non-sources Business Plan section still renders normally, with its content sanitized like any other section", () => {
  const businessRow = {
    id: "r4",
    report_type: "business_plan",
    status: "completed",
    sections: [
      {
        field: "financialDashboard",
        title: "Financial Dashboard",
        content: "[Recommendation] [Basis:decision engine] Revenue is projected to grow 15% year over year.",
      },
    ],
  };
  const report = normalizeReport(businessRow);
  assert.equal(report.sections.length, 1);
  assert.equal(report.sections[0].field, "financialDashboard");
  assert.doesNotMatch(report.sections[0].content, /\[Recommendation\]/);
  assert.doesNotMatch(report.sections[0].content, /\[Basis:/);
  assert.match(report.sections[0].content, /Revenue is projected to grow 15% year over year\./);
});

// --- 3. No R identifiers appear (any domain) -------------------------------

test("stripReportPresentationArtifacts removes every R# identifier shape, regardless of digit count", () => {
  for (const raw of ["[R1] claim text", "[R2] claim text", "[R42] claim text", "[R123] claim text"]) {
    assert.doesNotMatch(stripReportPresentationArtifacts(raw), /\[R\d+\]/);
  }
});

// --- 4. Final report reads like a premium executive advisor ---------------
// ---    (the [Unknown][Required:field] rewrite, not just tag-stripping) ---

// NOTE: superseded by the "final cleanup" turn -- the rewrite used to
// insert the humanized field identifier as the sentence's own subject
// ("Valuation purchase price requires additional verification before
// this can be finalized."), which itself leaked an internal research-
// task field name in lightly-cleaned form. Every occurrence now becomes
// the same fixed, genuinely generic executive sentence instead --
// confirmed correct via the dedicated
// report-presentation-sanitizer-all-surfaces.test.mjs suite.
test("stripReportPresentationArtifacts rewrites the exact BAD fallback sentence into the fix's own required generic GOOD sentence, regardless of the internal field identifier", () => {
  const rewritten = stripReportPresentationArtifacts(
    "[Unknown] [Required:valuation_purchase_price] Some external sources could not be verified."
  );
  assert.doesNotMatch(rewritten, /\[Unknown\]/);
  assert.doesNotMatch(rewritten, /\[Required:/);
  assert.doesNotMatch(rewritten, /Some external sources could not be verified/);
  assert.doesNotMatch(rewritten, /valuation_purchase_price/i);
  assert.equal(rewritten, "Additional financial and operational information is needed before making a final decision.");
});

test("stripReportPresentationArtifacts's rewrite is identical regardless of which internal field identifier triggered it -- never leaks the field name in any form", () => {
  const rewritten = stripReportPresentationArtifacts(
    "[Unknown] [Required:employment_records] Some external sources could not be verified, so this field is not definitive."
  );
  assert.doesNotMatch(rewritten, /employment_records/i);
  assert.doesNotMatch(rewritten, /employment records/i);
  assert.equal(rewritten, "Additional financial and operational information is needed before making a final decision.");
});

test("normalizeReport's rewritten sentence never contains internal template phrasing ('Some external sources could not be verified', 'this field is not definitive') anywhere in the final report", () => {
  for (const row of [acquisitionReportRow(), legalReportRow()]) {
    const report = normalizeReport(row);
    const allContent = report.sections.map((s) => s.content).join("\n");
    assert.doesNotMatch(allContent, /Some external sources could not be verified/i);
    assert.doesNotMatch(allContent, /this field is not definitive/i);
  }
});

// NOTE: superseded by the "final cleanup" turn -- [Verified]/[Derived]
// bracket labels are now removed too (a deliberate policy reversal from
// an earlier turn), while the underlying figures they labeled must
// survive exactly. "[Verified] Purchase price: $40M" -> "Purchase price:
// $40M", never the bare label alone.
test("normalizeReport preserves the underlying purchase price, ARR, EV/ARR, and financing figures exactly, with the [Verified]/[Derived] bracket labels now removed", () => {
  const report = normalizeReport(acquisitionReportRow());
  const targetOverview = report.sections.find((s) => s.field === "targetCompanyOverview")?.content || "";
  const valuation = report.sections.find((s) => s.field === "valuationAnalysis")?.content || "";
  const financing = report.sections.find((s) => s.field === "financingStructure")?.content || "";

  assert.doesNotMatch(targetOverview, /\[Verified\]/);
  assert.doesNotMatch(valuation, /\[Derived\]/);
  assert.doesNotMatch(financing, /\[Derived\]/);

  assert.match(targetOverview, /Purchase price: \$14M/);
  assert.match(targetOverview, /Target ARR: \$2\.8M/);
  assert.match(valuation, /EV\/ARR: 5\.0x/);
  assert.match(financing, /Equity contribution: \$8M/);
  assert.match(financing, /Debt requirement: \$6M/);
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

test("sanitizeReportSectionsForPresentation rewrites (never drops) a section whose content is only [Unknown][Required:x] into real, natural-language text", () => {
  const sections = sanitizeReportSectionsForPresentation([
    { field: "missingInformation", title: "Missing Information", content: "[Unknown] [Required:x]" },
    { field: "strategicFit", title: "Strategic Fit", content: "Real analysis survives." },
  ]);
  // [Unknown][Required:x] rewrites into a real sentence, not empty content,
  // so both sections should actually survive -- proving the rewrite (not
  // deletion) is what happens for this specific shape.
  assert.equal(sections.length, 2);
  assert.ok(sections.some((s) => s.field === "missingInformation"));
  assert.equal(
    sections.find((s) => s.field === "missingInformation").content,
    "Additional financial and operational information is needed before making a final decision."
  );
});

test("sanitizeReportSectionsForPresentation still drops a section whose ORIGINAL content was already empty -- the schema-preservation fallback only applies when sanitization itself emptied real content, never to a field that had nothing to begin with", () => {
  const sections = sanitizeReportSectionsForPresentation([
    { field: "someField", title: "Some Field", content: "" },
    { field: "strategicFit", title: "Strategic Fit", content: "Real analysis survives." },
  ]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].field, "strategicFit");
});

// NOTE: superseded by the "sanitization must preserve complete report
// payload" turn -- a section is no longer dropped just because
// sanitization consumed 100% of its ORIGINAL, genuinely-non-empty
// content (confirmed live: plan-executor.ts's timeout fallback sets
// roiAnalysis/irrAnalysis to nothing but the timeout-disclosure sentence,
// and dropping those two fields broke Planner.tsx's hasCompletePayload
// check -- "Report job completed without a complete report payload.").
// The section now survives with a generic fallback sentence instead,
// preserving the report's field-count contract. A section is still
// dropped when its ORIGINAL content was already empty (see the sibling
// test above, and stripReportPresentationArtifacts's own early return).
test("sanitizeReportSectionsForPresentation keeps a section whose original content sanitizes down to nothing, replacing it with a fallback sentence rather than dropping it -- preserves the report's field-count contract", () => {
  const sections = sanitizeReportSectionsForPresentation([
    { field: "someField", title: "Some Field", content: "[R1] [Asset:file.pdf]" },
    { field: "strategicFit", title: "Strategic Fit", content: "Real analysis survives." },
  ]);
  assert.equal(sections.length, 2);
  assert.equal(
    sections.find((s) => s.field === "someField").content,
    "Additional information is needed to complete this section."
  );
  assert.equal(sections.find((s) => s.field === "strategicFit").content, "Real analysis survives.");
});

// --- 5. Drift checks: generation/routing/reasoning are untouched ----------

// NOTE: superseded in part by the "final acquisition intelligence polish"
// turn -- revenueSynergies/costSynergies no longer use the
// [Basis:acquisition evidence registry] tag at all (replaced with real,
// deal-specific cross-sell/customer-expansion/product-portfolio-fit and
// infrastructure-consolidation/operational-efficiency/procurement-leverage
// reasoning), a deliberate content-generation improvement, not a
// sanitization change. The other tagged fallback strings this test checks
// (research task registry, the timeout-disclosure sentence) are untouched
// and still prove this file continues to write internal citation-tag
// detail for the sanitizer to correctly process.
test("plan-executor.ts's per-domain timeout fallbacks still write internal citation-tag detail for the sanitizer to process (drift check)", () => {
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

test("ReportPdfButton.tsx reads report.sections from the same normalized report object the dashboard viewer uses, AND applies its own additional late-stage sanitization pass on pdfSections -- confirmed live, PDF-specific transforms (buildLegalReportSections) can reconstruct a fresh sources-like section after normalizeReport already ran, so the PDF surface needs a second, independent filter, not just the upstream one (drift check)", () => {
  assert.match(pdfButtonSource, /from\s+["']@\/app\/lib\/report-engine\/report-presentation-sanitizer["']/);
  assert.match(pdfButtonSource, /report\.sections/);
  assert.match(
    pdfButtonSource,
    /const pdfSections = localizePdfReportSections\(pdfBaseSectionsWithBenchmark, pdfLocale\)\.filter\(\s*\n\s*\(section\) => isUniversalCustomerFacingSection\(section\)/
  );
});

test("acquisition prompts remain classified as Acquisition Due Diligence -- report_type resolves to the correct title, never a legal/generic one (routing untouched by this fix)", () => {
  const report = normalizeReport(acquisitionReportRow());
  assert.equal(report.type, "Acquisition Due Diligence Report");
});

// --- TASK #41 -- eliminate malformed and empty citation artifacts -----
//
// ROOT CAUSE (confirmed via full lifecycle trace: generation ->
// normalization -> canonical state -> web renderer -> PDF renderer):
// citationBracketTagPattern (above) correctly deletes an individual
// [R#]-shaped citation tag, but when Market Intelligence's own
// generation prompt grouped several citations inside ONE parenthetical
// or bracket, separated by commas -- e.g. "regional signals ([R12],
// [R45])." or "adoption patterns ([R7],[R21])." -- removing each tag
// individually left the comma(s) that used to separate them stranded
// inside the group: "(, )" / "(,,)" / "[,]". A group holding exactly one
// citation and nothing else collapsed to a fully empty "()" / "[]".
// This is a single, centralized fix in stripReportPresentationArtifacts
// itself (leadingGroupSeparatorPattern/trailingGroupSeparatorPattern/
// emptyParentheticalGroupPattern/emptyBracketGroupPattern) -- since every
// render surface (page.tsx, Planner.tsx web + PDF, ReportPdfButton.tsx
// PDF) and the canonical narrative fields
// (market-intelligence-canonical-state.ts) already funnel through this
// exact function, the fix reaches all of them with zero renderer
// changes.

const plannerSourceForCitationAudit = readFileSync(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const dashboardReportSourceForCitationAudit = readFileSync(
  new URL("../app/dashboard/[id]/page.tsx", import.meta.url),
  "utf8"
);

test("TASK #41: '(,)' collapses entirely -- a single citation alone in a parenthetical leaves no empty group behind", () => {
  const result = stripReportPresentationArtifacts("Adoption patterns ([R7]).");
  assert.equal(result, "Adoption patterns.");
  assert.doesNotMatch(result, /\(,?\)/);
});

test("TASK #41: '(,,)' (two citations, no space) collapses entirely -- the real reported production artifact", () => {
  const result = stripReportPresentationArtifacts("Regional expansion signals ([R12],[R45]).");
  assert.equal(result, "Regional expansion signals.");
  assert.doesNotMatch(result, /\(,+\)/);
});

test("TASK #41: '()' (already-empty parenthetical, e.g. from an upstream removal) is removed entirely rather than left as bare empty parens", () => {
  const result = stripReportPresentationArtifacts("A note ().");
  assert.equal(result, "A note.");
  assert.doesNotMatch(result, /\(\)/);
});

test("TASK #41: '[,]' (square-bracket citation group) collapses entirely", () => {
  const result = stripReportPresentationArtifacts("Adoption patterns [[R7], [R21]].");
  assert.equal(result, "Adoption patterns.");
  assert.doesNotMatch(result, /\[,?\]/);
});

test("TASK #41: three citations inside one parenthetical, comma-separated, all collapse together (never left as '(,,)' or any partial remnant)", () => {
  const result = stripReportPresentationArtifacts("Group of three ([R1],[R2],[R3]).");
  assert.equal(result, "Group of three.");
  assert.doesNotMatch(result, /[([][,;\s]*[)\]]/);
});

test("TASK #41: a citation followed immediately by terminal punctuation leaves no dangling space or empty group before the punctuation", () => {
  const result = stripReportPresentationArtifacts("Strong evidence supports this claim ([R99]).");
  assert.equal(result, "Strong evidence supports this claim.");
});

test("TASK #41: a citation mixed with REAL content in the same parenthetical is stripped without losing the real content -- leading, trailing, and both-sided cases", () => {
  assert.equal(
    stripReportPresentationArtifacts("Obtainable share ([R12], up 12% YoY) matters."),
    "Obtainable share (up 12% YoY) matters."
  );
  assert.equal(
    stripReportPresentationArtifacts("The stated range (up 12% YoY, [R99]) applies."),
    "The stated range (up 12% YoY) applies."
  );
  assert.equal(
    stripReportPresentationArtifacts("The combined figure ([R1], up 12%, [R2]) is cited."),
    "The combined figure (up 12%) is cited."
  );
});

test("TASK #41: valid ordinary parentheses with real content (never citations) are left completely untouched", () => {
  assert.equal(
    stripReportPresentationArtifacts("Products (e.g., widgets) are common in this segment."),
    "Products (e.g., widgets) are common in this segment."
  );
  assert.equal(
    stripReportPresentationArtifacts("A simple ranked list (1, 2, 3) stays exactly as written."),
    "A simple ranked list (1, 2, 3) stays exactly as written."
  );
  assert.equal(
    stripReportPresentationArtifacts("Segment growth (North America) remained steady."),
    "Segment growth (North America) remained steady."
  );
});

test("TASK #41: a real, meaningful bracket group with no citation inside (e.g. a footnote-style aside) is never touched by the new empty-group passes", () => {
  assert.equal(
    stripReportPresentationArtifacts("The finding [see Appendix A] is notable."),
    "The finding [see Appendix A] is notable."
  );
});

test("TASK #41: a standalone citation with no surrounding parentheses/brackets around it still resolves cleanly (regression check against the pre-existing citation-stripping behavior)", () => {
  assert.equal(
    stripReportPresentationArtifacts("Legit citation stays [R42] intact context around it."),
    "Legit citation stays intact context around it."
  );
});

test("TASK #41: realistic Market Intelligence section prose (Market Overview / Industry Trends / Porter's Five Forces style sentences) sanitizes cleanly with no malformed citation remnants", () => {
  const sections = [
    "Market Overview: The market is expanding rapidly, with regional expansion signals ([R12], [R45]) supporting continued growth.",
    "Industry Trends: Adoption patterns ([R7],[R21]) point toward consolidation among mid-market vendors.",
    "Porter's Five Forces: Buyer power remains moderate ([R3]), while supplier concentration is low ([R8], [R14]).",
    "Barriers: Regulatory complexity ([R19]) and capital intensity ([R22],[R25]) both slow new entrants.",
  ];
  for (const raw of sections) {
    const cleaned = stripReportPresentationArtifacts(raw);
    assert.doesNotMatch(cleaned, /\[R\d+\]/, `raw citation marker leaked in: "${cleaned}"`);
    assert.doesNotMatch(cleaned, /[([][,;\s]*[)\]]/, `empty/malformed citation group leaked in: "${cleaned}"`);
    assert.doesNotMatch(cleaned, /\s[,;]/, `dangling separator leaked in: "${cleaned}"`);
  }
});

test("TASK #41: the fix is idempotent -- sanitizing already-clean text a second time never introduces or removes anything further", () => {
  const raw = "Regional expansion signals ([R12], [R45]) supporting continued growth.";
  const once = stripReportPresentationArtifacts(raw);
  const twice = stripReportPresentationArtifacts(once);
  assert.equal(once, twice);
});

test("TASK #41 STRUCTURAL AUDIT: web and PDF (page.tsx, Planner.tsx, ReportPdfButton.tsx) all consume the SAME centralized stripReportPresentationArtifacts -- no independent citation-cleanup implementation exists on any render surface", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSourceForCitationAudit],
    ["Planner.tsx", plannerSourceForCitationAudit],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(
      source,
      /stripReportPresentationArtifacts/,
      `${name}: must consume the centralized stripReportPresentationArtifacts sanitizer`
    );
  }
});

test("TASK #41: web and PDF resolve an identical, artifact-free result for the same raw section content -- pure and deterministic, so the two surfaces can never structurally disagree", () => {
  const raw = "Regional expansion signals ([R12],[R45]) supporting continued growth.";
  const webResult = stripReportPresentationArtifacts(raw);
  const pdfResult = stripReportPresentationArtifacts(raw);
  assert.equal(webResult, pdfResult);
  assert.doesNotMatch(webResult, /[([][,;\s]*[)\]]/);
});
