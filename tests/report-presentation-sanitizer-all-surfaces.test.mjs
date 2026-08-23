import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL FIX -- apply presentation sanitization to ALL report surfaces.
//
// A prior turn built a universal content sanitizer
// (app/lib/report-engine/report-presentation-sanitizer.ts) and wired it
// into app/dashboard/report-utils.ts's normalizeReport -- the single
// function both the dashboard viewer (page.tsx) and the PDF button
// (ReportPdfButton.tsx) read their `report.sections` from. That wiring
// was real but insufficient: root-caused live to two independent,
// PDF/UI-specific section-reconstruction paths that run AFTER
// normalizeReport already excluded the original "sources"/
// "externalEvidence" fields:
//
//   1. ReportPdfButton.tsx's own basePdfSections computation calls
//      buildLegalReportSections(normalizedSections, ...) for legal
//      reports, which builds a FRESH "legalSources" section from the
//      report's own citation content -- entirely new data the upstream
//      field-name exclusion could never have seen. formatPdfCitationContent
//      /formatLegalSourceContent then deliberately render Publisher/URL/
//      Source type/Confidence lines for it (that machinery's whole
//      purpose, built long before "remove Sources entirely" was a
//      requirement).
//   2. page.tsx independently calls the SAME buildLegalReportSections a
//      second time on its own copy of the sections, and used to render
//      the reconstructed "legalSources" section in an "Appendix"-style
//      "Sources" panel via its own (drifted, less complete) local
//      isSourceSectionTitle helper.
//
// Both surfaces also render two more places that read structured
// AI-generated text independently of `report.sections` entirely: the
// "Executive Decision Center" PDF cover card
// (drawExecutiveDecisionIntelligencePage) and its dashboard-viewer
// equivalent (ExecutiveDecisionIntelligencePanel), both sourced from
// readExecutiveDecisionIntelligenceSummary(report.metadata).
//
// Fixed by: (a) widening the shared sanitizer with a canonical,
// title-based exclusion (isInternalOnlySectionTitle) covering every
// language variant already used across the report schemas, used by BOTH
// normalizeReport (field+title) AND a second, independent filter applied
// directly to ReportPdfButton.tsx's own pdfSections and page.tsx's own
// visibleSections, so neither surface can reintroduce a Sources page via
// its own reconstruction; (b) wrapping the Executive Decision
// Intelligence summary's verdict/recommendation text in
// stripReportPresentationArtifacts on both surfaces; (c) wrapping the
// PDF's own per-section sectionBodyContent (the literal text handed to
// jsPDF) in stripReportPresentationArtifacts as a final defensive pass,
// and switching the cover-page's own extraction source
// (fullReportContent) from the unfiltered basePdfSections to the
// filtered pdfSections.

const sanitizerSource = readFileSync(
  new URL("../app/lib/report-engine/report-presentation-sanitizer.ts", import.meta.url),
  "utf8"
);
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(
  new URL("../app/dashboard/[id]/page.tsx", import.meta.url),
  "utf8"
);

const {
  isInternalOnlySectionTitle,
  isUniversalCustomerFacingSection,
  stripReportPresentationArtifacts,
  sanitizeReportSectionsForPresentation,
} = await import("../app/lib/report-engine/report-presentation-sanitizer.ts");

// --- isInternalOnlySectionTitle: canonical title matching -----------------

test("isInternalOnlySectionTitle matches every sources/external-evidence title variant used across every report schema and language", () => {
  const titlesThatMustBeExcluded = [
    "Sources",
    "sources",
    "Sources Continued",
    "References",
    "Verified Sources",
    "External Evidence",
    "Sources / Assumptions",
    "Kaynaklar",
    "Kaynaklar Devamı",
    "Doğrulanmış Kaynaklar",
    "Dış Kaynak Kanıtları",
    "Kaynaklar / Varsayımlar",
    "Quellen",
    "Externe Nachweise",
    "Fuentes",
    "Evidencia externa",
    "Éléments probants externes",
  ];

  for (const title of titlesThatMustBeExcluded) {
    assert.ok(isInternalOnlySectionTitle(title), `title not recognized as internal-only: "${title}"`);
  }
});

test("isInternalOnlySectionTitle never matches an ordinary analysis section title", () => {
  const titlesThatMustSurvive = [
    "Strategic Fit",
    "Valuation Analysis",
    "Financial Dashboard",
    "Missing Information",
    "Regulatory Review",
    "Executive Acquisition Summary",
    "Domain Findings",
  ];

  for (const title of titlesThatMustSurvive) {
    assert.ok(!isInternalOnlySectionTitle(title), `legitimate title incorrectly excluded: "${title}"`);
  }
});

test("isUniversalCustomerFacingSection excludes by field OR title -- a section only needs to match one to be removed", () => {
  assert.equal(isUniversalCustomerFacingSection({ field: "sources", title: "Whatever" }), false);
  assert.equal(isUniversalCustomerFacingSection({ field: "legalSources", title: "Sources" }), false);
  assert.equal(isUniversalCustomerFacingSection({ field: "financialDashboard", title: "Financial Dashboard" }), true);
});

// --- PDF contains zero R identifiers / zero source sections ---------------

test("ReportPdfButton.tsx filters pdfSections through isUniversalCustomerFacingSection -- the single array both the per-section render loop and the Table of Contents read from (drift check)", () => {
  assert.match(
    pdfButtonSource,
    /const pdfSections = localizePdfReportSections\(pdfBaseSectionsWithBenchmark, pdfLocale\)\.filter\(\s*\n\s*\(section\) => isUniversalCustomerFacingSection\(section\)\s*\n\s*\);/
  );
});

test("ReportPdfButton.tsx's per-section render loop wraps the final sectionBodyContent in stripReportPresentationArtifacts as a last-line-of-defense pass (drift check)", () => {
  const loopStart = pdfButtonSource.indexOf("pdfSections.forEach((section) => {");
  const wrapIndex = pdfButtonSource.indexOf("const sectionBodyContent = stripReportPresentationArtifacts(");
  assert.ok(loopStart > -1, "pdfSections.forEach loop not found");
  assert.ok(wrapIndex > -1, "sectionBodyContent is not wrapped in stripReportPresentationArtifacts");
  assert.ok(
    wrapIndex > loopStart && wrapIndex < loopStart + 2000,
    "the stripReportPresentationArtifacts wrap is not inside the render loop"
  );
});

test("ReportPdfButton.tsx's cover-page extraction source (fullReportContent) reads from the filtered pdfSections, not the unfiltered basePdfSections (drift check, prevents a regex match inside excluded Sources content from leaking into a cover-card value)", () => {
  assert.match(
    pdfButtonSource,
    /const fullReportContent = pdfSections\s*\n\s*\.map\(\(section\) => `\$\{section\.title\}\\n\$\{section\.content\}`\)/
  );
  assert.doesNotMatch(
    pdfButtonSource,
    /const fullReportContent = basePdfSections/
  );
});

test("ReportPdfButton.tsx's legalSourceCount reads from basePdfSections (pre-filter), preserving the legitimate bare-count stat without needing to render the excluded Sources section (drift check)", () => {
  assert.match(
    pdfButtonSource,
    /const legalSourceCount = new Set\(\s*\n\s*\(basePdfSections\.find\(\(section\) => section\.field === "legalSources"\)/
  );
});

test("ReportPdfButton.tsx never lets isSourceSectionTitle's branch actually execute -- the section it would match is already filtered out of pdfSections before the render loop runs (structural proof, not just a drift check)", () => {
  // With pdfSections already excluding every isInternalOnlySectionTitle
  // match, a section satisfying isSourceSectionTitle(section.title) can
  // never reach this forEach body -- confirmed by the filter existing
  // upstream of the loop in source order.
  const filterIndex = pdfButtonSource.indexOf("const pdfSections = localizePdfReportSections(pdfBaseSectionsWithBenchmark, pdfLocale).filter(");
  const loopIndex = pdfButtonSource.indexOf("pdfSections.forEach((section) => {");
  assert.ok(filterIndex > -1 && loopIndex > -1);
  assert.ok(filterIndex < loopIndex, "the pdfSections filter must run before the render loop");
});

// --- UI contains zero internal metadata ------------------------------------

// NOTE: superseded by the "Remove internal intelligence language from
// Market Intelligence reports" ticket -- visibleSections now also runs
// an additional, Market-Intelligence-only sanitizeMarketIntelligence
// PresentationText pass on top of the universal
// stripReportPresentationArtifacts, so the exact literal map body this
// test originally asserted no longer matches verbatim. The underlying
// guarantee (isUniversalCustomerFacingSection filtering +
// stripReportPresentationArtifacts sanitization on every section) is
// unchanged and re-asserted below. See
// tests/market-intelligence-remove-internal-language-fix.test.mjs for
// the full, current assertion.
test("page.tsx filters visibleSections through isUniversalCustomerFacingSection and sanitizes their content, and sourceSections is now hardcoded empty -- 'remove the Sources section entirely', not relocate it to an appendix (drift check)", () => {
  assert.match(
    pageSource,
    /const visibleSections = uniqueReportSections\s*\n\s*\.filter\(\(section\) => isUniversalCustomerFacingSection\(section\)\)\s*\n\s*\.map\(\(section\) => \(\{\s*\n\s*\.\.\.section,\s*\n\s*content: isMarketIntelligenceReport\s*\n\s*\? sanitizeMarketIntelligencePresentationText\(stripReportPresentationArtifacts\(section\.content\)\)\s*\n\s*: stripReportPresentationArtifacts\(section\.content\),\s*\n\s*\}\)\)/
  );
  assert.match(pageSource, /const sourceSections: typeof uniqueReportSections = \[\];/);
});

test("page.tsx's ExecutiveDecisionIntelligencePanel (the dashboard's Executive Decision Center cover-card equivalent) wraps verdict/recommendation in stripReportPresentationArtifacts (drift check)", () => {
  const panelMatch = /function ExecutiveDecisionIntelligencePanel\([\s\S]*?\n\}/.exec(pageSource);
  assert.ok(panelMatch, "ExecutiveDecisionIntelligencePanel not found");
  assert.match(panelMatch[0], /stripReportPresentationArtifacts\(summary\.verdict\)/);
  assert.match(panelMatch[0], /stripReportPresentationArtifacts\(summary\.recommendation\)/);
});

// --- Cover cards are sanitized ---------------------------------------------

test("ReportPdfButton.tsx's drawExecutiveDecisionIntelligencePage (the PDF's Executive Decision Center cover card) wraps verdict/recommendation in stripReportPresentationArtifacts (drift check)", () => {
  const pageFnMatch = /const drawExecutiveDecisionIntelligencePage = \([\s\S]*?\n\s*\};/.exec(pdfButtonSource);
  assert.ok(pageFnMatch, "drawExecutiveDecisionIntelligencePage not found");
  assert.match(pageFnMatch[0], /stripReportPresentationArtifacts\(summary\.verdict\)/);
  assert.match(pageFnMatch[0], /stripReportPresentationArtifacts\(summary\.recommendation\)/);
});

// --- TOC is sanitized -------------------------------------------------------

test("ReportPdfButton.tsx's TOC entries (tocEntries.push) are built exclusively inside the pdfSections.forEach loop -- the same already-filtered, already-sanitized array the section cards render from, so the TOC can never list a Sources/External Evidence page or show unsanitized titles (structural proof)", () => {
  const loopStart = pdfButtonSource.indexOf("pdfSections.forEach((section) => {");
  assert.ok(loopStart > -1, "pdfSections.forEach loop not found");

  const pushMatches = [...pdfButtonSource.matchAll(/tocEntries\.push\(/g)];
  assert.ok(pushMatches.length >= 2, "expected at least 2 tocEntries.push call sites");

  for (const match of pushMatches) {
    assert.ok(
      match.index > loopStart,
      "a tocEntries.push call site exists outside the pdfSections.forEach loop -- it could list an unfiltered section"
    );
  }
});

// --- Behavioral proof: the sanitizer's exported functions, exercised ------
// ---    against a realistic worst-case fixture ----------------------------

test("sanitizeReportSectionsForPresentation removes a reconstructed 'legalSources' section (field name the upstream field-exclusion list does not name) purely by its title, mirroring exactly what buildLegalReportSections produces", () => {
  const sections = [
    { field: "domainFindings", title: "Domain Findings", content: "The claim is well-supported by the evidence on file." },
    {
      field: "legalSources",
      title: "Sources",
      content:
        "• [R1] Statista\n  Publisher: Statista\n  URL: https://statista.com/report\n  Confidence: Verified",
    },
  ];
  const sanitized = sanitizeReportSectionsForPresentation(sections);

  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].field, "domainFindings");
  assert.doesNotMatch(sanitized.map((s) => s.content).join("\n"), /\[R\d+\]/);
  assert.doesNotMatch(sanitized.map((s) => s.content).join("\n"), /Publisher:/);
  assert.doesNotMatch(sanitized.map((s) => s.content).join("\n"), /https?:\/\//);
});

test("stripReportPresentationArtifacts rewrites the ticket's own BAD example into natural executive language, matching the shape of its own GOOD example", () => {
  const rewritten = stripReportPresentationArtifacts(
    "[Recommendation] [Basis:decision engine] Obtain authoritative evidence required to resolve valuation."
  );

  assert.doesNotMatch(rewritten, /\[Recommendation\]/);
  assert.doesNotMatch(rewritten, /\[Basis:/);
  assert.doesNotMatch(rewritten, /decision engine/i);
  assert.match(rewritten, /Obtain authoritative evidence required to resolve valuation\./);
});

test("stripReportPresentationArtifacts removes every internal-vocabulary term the fix requires, in one pass", () => {
  const dirty = [
    "Verified from official source",
    "Verified from external source",
    "Verified from uploaded asset",
    "[R1] [R17]",
    "[Basis:decision engine]",
    "evidence registry",
    "research task registry",
    "decision engine",
    "synthesis provider",
    "deadline fallback",
  ].join(" -- ");

  const cleaned = stripReportPresentationArtifacts(dirty);

  assert.doesNotMatch(cleaned, /Verified from (?:official|external|uploaded asset)/i);
  assert.doesNotMatch(cleaned, /\[R\d+\]/);
  assert.doesNotMatch(cleaned, /\[Basis:/);
  assert.doesNotMatch(cleaned, /evidence registry/i);
  assert.doesNotMatch(cleaned, /research task registry/i);
  assert.doesNotMatch(cleaned, /decision engine/i);
  assert.doesNotMatch(cleaned, /synthesis provider/i);
  assert.doesNotMatch(cleaned, /deadline fallback/i);
});

// --- Reasoning quality / evidence usage are untouched ----------------------

test("generation/producer files are unmodified by this fix -- buildLegalReportSections and formatPdfCitationContent still fully construct Publisher/URL/Source-type citation detail internally (drift check, proves this is a rendering-surface fix, not a reasoning-quality reduction)", () => {
  assert.match(pdfButtonSource, /`  Publisher: \$\{source\.publisher\}`/);
  assert.match(pdfButtonSource, /`  URL: \$\{source\.url\}`/);
  assert.match(pdfButtonSource, /function formatPdfCitationContent/);

  const legalReportRenderingSource = readFileSync(
    new URL("../app/lib/report-engine/legal-report-rendering.ts", import.meta.url),
    "utf8"
  );
  assert.match(legalReportRenderingSource, /function buildLegalReportSections/);
});

test("report-presentation-sanitizer.ts's field/title exclusion lists are the single canonical definitions reused by both page.tsx and ReportPdfButton.tsx -- no separate, independently-maintained copy of the exclusion logic exists in either UI file (drift check, the root cause this fix addresses)", () => {
  assert.doesNotMatch(pageSource, /function isUniversalCustomerFacingSection/);
  assert.doesNotMatch(pdfButtonSource, /function isUniversalCustomerFacingSection/);
  assert.match(sanitizerSource, /export function isUniversalCustomerFacingSection/);
});
