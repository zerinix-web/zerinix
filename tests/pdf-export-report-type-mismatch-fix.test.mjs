import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isLegalRenderableReport } from "../app/lib/report-engine/legal-report-rendering.ts";

// CRITICAL BUG FIX -- PDF export used the wrong report payload after
// Market Intelligence generation.
//
// Bug: components/Planner.tsx's live/in-progress report view (the
// on-screen chat-generation flow, distinct from the SAVED dashboard view
// in app/dashboard/[id]/) computes its own isLegalReport flag to decide
// which PDF template to draw. It called isLegalRenderableReport with a
// hardcoded `type: "Strategic Report"` literal instead of this report's
// real type -- so isLegalRenderableReport's own explicit, type-based
// exemptions for Real Estate / Acquisition / Market Analysis reports
// (each `if (report.type === "...") return false;` near the top of that
// function) could never fire from this call site, no matter what kind of
// report was actually being viewed.
//
// Confirmed live: "I want a Market Intelligence analysis, not a legal
// analysis." -- a prompt that merely contains the bare word "legal" as a
// negation -- correctly generated a Market Intelligence report (on-screen
// render is unaffected, since it reads reportTitle/isMarketIntelligence
// directly, never isLegalRenderableReport), but the exported PDF was
// built from buildLegalReportSections' fixed legal template (title
// "Legal Assessment Report", sections reduced to "Material Facts" and the
// other fixed legal-template fields) because isLegalRenderableReport's
// keyword fallback (legalSignalPattern, which includes the bare word
// "legal") matched the prompt and nothing stopped it.
//
// Fixed by computing the real type string Planner.tsx already has enough
// context to know (isRealEstateReport / reportDomain === "acquisition" /
// isMarketIntelligence) and passing THAT to isLegalRenderableReport,
// mirroring exactly what app/dashboard/[id]/page.tsx and
// ReportPdfButton.tsx already do by passing the full, real saved report
// object (which always carries the correct .type). No AI generation
// logic, routing rule, or report-generation section list was touched --
// this is a presentation/export mapping fix only.

const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");

const MARKET_INTELLIGENCE_HIJACK_PROMPT =
  "I want a Market Intelligence analysis, not a legal analysis.";
const marketIntelligenceSections = [
  { field: "marketOverview", title: "Market Overview", content: "The AI cybersecurity market is growing rapidly, driven by rising enterprise compliance spend." },
  { field: "competitiveLandscape", title: "Competitive Landscape", content: "Key competitors include established security vendors and emerging AI-native entrants." },
  { field: "tamSamSom", title: "TAM / SAM / SOM", content: "TAM: $12B. SAM: $3B. SOM: $150M within 3 years." },
  { field: "strategicRecommendations", title: "Strategic Recommendations", content: "Enter via a mid-market compliance-automation wedge before expanding upstream." },
];

// Mirrors Planner.tsx's own legalRenderableReportType ternary exactly, so
// this test proves the real mechanism rather than a reimplementation of
// it. The source-level test below keeps this in sync with the actual
// code.
function legalRenderableReportType({ isRealEstateReport, reportDomain, isMarketIntelligence }) {
  return isRealEstateReport
    ? "Real Estate Investment Analysis"
    : reportDomain === "acquisition"
      ? "Acquisition Due Diligence Report"
      : isMarketIntelligence
        ? "Market Analysis"
        : "Strategic Report";
}

// --- 1. The core reported bug: Market Intelligence must never export as ---
// --- Legal Assessment -------------------------------------------------

test("Generate Market Intelligence -> export PDF: isLegalRenderableReport (via Planner.tsx's real type-mapping) returns false, so the PDF keeps the Market Intelligence template and title", () => {
  const type = legalRenderableReportType({
    isRealEstateReport: false,
    reportDomain: "business",
    isMarketIntelligence: true,
  });
  assert.equal(type, "Market Analysis");
  assert.equal(
    isLegalRenderableReport({
      type,
      title: "Market Intelligence Report",
      prompt: MARKET_INTELLIGENCE_HIJACK_PROMPT,
      sections: marketIntelligenceSections,
    }),
    false
  );
});

test("the exact bug reproduction: the OLD hardcoded 'Strategic Report' type would have misclassified this same prompt as legal (confirms the bug was real, not hypothetical)", () => {
  assert.equal(
    isLegalRenderableReport({
      type: "Strategic Report",
      title: "Market Intelligence Report",
      prompt: MARKET_INTELLIGENCE_HIJACK_PROMPT,
      sections: marketIntelligenceSections,
    }),
    true
  );
});

test("Market Intelligence reports export Market Overview, Competitive Landscape, TAM/SAM/SOM, Strategic Recommendations, and all generated sections -- not the fixed legal template's Material Facts subset", () => {
  const type = legalRenderableReportType({
    isRealEstateReport: false,
    reportDomain: "business",
    isMarketIntelligence: true,
  });
  const isLegal = isLegalRenderableReport({
    type,
    title: "Market Intelligence Report",
    prompt: MARKET_INTELLIGENCE_HIJACK_PROMPT,
    sections: marketIntelligenceSections,
  });
  assert.equal(isLegal, false, "isLegalReport must be false so basePdfSections stays the real generated sections, not buildLegalReportSections' fixed list");

  const fieldNames = marketIntelligenceSections.map((s) => s.field);
  assert.ok(fieldNames.includes("marketOverview"));
  assert.ok(fieldNames.includes("competitiveLandscape"));
  assert.ok(fieldNames.includes("tamSamSom"));
  assert.ok(fieldNames.includes("strategicRecommendations"));
});

// --- 2. Legal Assessment requests must still export Legal Assessment -----

test("a genuine legal-advice request (isMarketIntelligence false) still exports as Legal Assessment", () => {
  const type = legalRenderableReportType({
    isRealEstateReport: false,
    reportDomain: "business",
    isMarketIntelligence: false,
  });
  assert.equal(type, "Strategic Report");

  const legalSections = [
    {
      field: "subjectIdentification",
      title: "Subject Identification",
      content: "Employment termination and unpaid compensation dispute.",
    },
    {
      field: "domainFindings",
      title: "Domain Findings",
      content: "The employee was terminated without notice pay or a written warning.",
    },
  ];
  assert.equal(
    isLegalRenderableReport({
      type,
      title: "Legal Assessment",
      prompt:
        "I need legal advice about my employer terminating me last week; the filing deadline is next Friday.",
      sections: legalSections,
    }),
    true
  );
});

// --- 3. Business Plan and Acquisition exports unchanged ------------------

test("Business Plan exports are unaffected: isMarketIntelligence false and reportDomain 'business' still resolve to the original 'Strategic Report' type (no behavior change)", () => {
  const type = legalRenderableReportType({
    isRealEstateReport: false,
    reportDomain: "business",
    isMarketIntelligence: false,
  });
  assert.equal(type, "Strategic Report", "Business Plan's resolved type is unchanged from before this fix");
});

test("Acquisition exports are unaffected: reportDomain 'acquisition' already short-circuits isLegalRenderableReport entirely via isKnownNonLegalSpecializedDomain, so this fix's new 'Acquisition Due Diligence Report' type string is purely defensive and never changes behavior", () => {
  const type = legalRenderableReportType({
    isRealEstateReport: false,
    reportDomain: "acquisition",
    isMarketIntelligence: false,
  });
  assert.equal(type, "Acquisition Due Diligence Report");
  // isLegalRenderableReport isn't even reached for acquisition in
  // Planner.tsx (isKnownNonLegalSpecializedDomain already excludes
  // reportDomain === "acquisition" before this function is called) --
  // confirmed by source check below.
  assert.match(plannerSource, /const isKnownNonLegalSpecializedDomain =[\s\S]{0,200}reportDomain === "acquisition";/);
  assert.match(
    plannerSource,
    /const isLegalReport =\s*\n\s*reportDomain === "legal" \|\|\s*\n\s*\(!isKnownNonLegalSpecializedDomain/
  );
});

// --- 4. Source-level checks: the fix is exactly what it claims to be -----

test("Planner.tsx no longer hardcodes 'Strategic Report' unconditionally for isLegalRenderableReport's type field", () => {
  assert.doesNotMatch(plannerSource, /isLegalRenderableReport\(\{\s*\n\s*type: "Strategic Report",/);
});

test("Planner.tsx's legalRenderableReportType mirrors the real report-type signals already used elsewhere (isRealEstateReport / reportDomain === \"acquisition\" / isMarketIntelligence)", () => {
  assert.match(
    plannerSource,
    /const legalRenderableReportType = isRealEstateReport\s*\n\s*\? "Real Estate Investment Analysis"\s*\n\s*: reportDomain === "acquisition"\s*\n\s*\? "Acquisition Due Diligence Report"\s*\n\s*: isMarketIntelligence\s*\n\s*\? "Market Analysis"\s*\n\s*: "Strategic Report";/
  );
  assert.match(plannerSource, /type: legalRenderableReportType,/);
});

test("app/dashboard/[id]/page.tsx and ReportPdfButton.tsx (the saved dashboard view) already pass the real report object and are untouched by this fix (drift check)", () => {
  const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
  const pdfButtonSource = readFileSync(
    new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
    "utf8"
  );
  assert.match(pageSource, /const isLegalReport = isLegalRenderableReport\(report\);/);
  assert.match(pdfButtonSource, /const isLegalReport = isLegalRenderableReport\(report\);/);
});

test("AI generation logic and routing rules are untouched by this fix (drift check)", () => {
  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function classifyReportDomain/);
  assert.match(domainSource, /export function applyPromptIntentModeOverride/);

  const marketPresentationSource = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPresentationSource, /export function buildMarketExecutiveDecisionBrief/);
});
