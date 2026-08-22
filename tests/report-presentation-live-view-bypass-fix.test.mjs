import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL DEBUG -- find why report sanitization is not reaching
// production output.
//
// Root cause, found by tracing the actual runtime path (generation
// result -> report normalization -> stored report data -> dashboard
// viewer -> PDF renderer), not by adding a new sanitizer:
//
// report-utils.ts's normalizeReport (and its
// sanitizeReportSectionsForPresentation call, built two turns ago) only
// ever runs when a SAVED report is reloaded via loadUserReport -- the
// dashboard viewer (app/dashboard/[id]/page.tsx) and PDF export
// (ReportPdfButton.tsx) both go through it correctly. But there is a
// THIRD rendering surface that never went through it at all: the LIVE
// report view a user sees the moment generation finishes, in the same
// session, via components/Planner.tsx's streamFullReport ->
// setPlanReport -> ReportPanel, and the markdown persisted into the chat
// message via getReportMarkdown. That surface reads `persistedSections`
// straight from the worker's job-status response and was never routed
// through the sanitizer -- confirmed by grepping the entire components/
// directory for any reference to report-presentation-sanitizer before
// this fix: zero matches. A user generating a report saw the raw,
// unsanitized content immediately; only reloading the SAVED report later
// (dashboard page) ever looked clean.
//
// Fixed by reusing the exact same, already-built sanitizer
// (isUniversalCustomerFacingSection / stripReportPresentationArtifacts)
// at every point Planner.tsx turns worker output into user-visible
// content: the outputFields list (filtered before the extraction loop,
// so hasCompletePayload's count stays consistent), each field's content
// (sanitized inside that same loop), activeReportFields (the field list
// ReportPanel actually renders from), ReportPanel's own sections useMemo
// (a second, defensive pass at the actual render boundary), and
// getReportMarkdown (the function that builds the text persisted into
// the chat message, a separate durable artifact from the reports table
// row). No new sanitizer was added -- every one of these call sites
// reuses the same two exported functions from
// app/lib/report-engine/report-presentation-sanitizer.ts.

const plannerSource = readFileSync(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);

const {
  isUniversalCustomerFacingSection,
  stripReportPresentationArtifacts,
} = await import("../app/lib/report-engine/report-presentation-sanitizer.ts");
const { extractAcquisitionDealFacts, computeAcquisitionDerivedMetrics } = await import(
  "../app/lib/ai/acquisition-deal-facts.ts"
);

// --- Drift checks: no new sanitizer was added, the existing one is ------
// ---    now wired into every point Planner.tsx produces user-visible ----
// ---    content -----------------------------------------------------------

test("Planner.tsx imports the existing report-presentation-sanitizer module -- no new sanitizer file was created for this fix (drift check)", () => {
  assert.match(
    plannerSource,
    /import \{\s*\n\s*isUniversalCustomerFacingSection,\s*\n\s*stripReportPresentationArtifacts,\s*\n\s*\} from "@\/app\/lib\/report-engine\/report-presentation-sanitizer";/
  );
});

test("Planner.tsx filters outputFields through isUniversalCustomerFacingSection BEFORE the extraction loop, so hasCompletePayload's field count stays consistent with what's actually extracted (drift check, ordering matters)", () => {
  const filterIndex = plannerSource.indexOf(
    "outputFields = outputFields.filter((entry) => isUniversalCustomerFacingSection(entry));"
  );
  const loopIndex = plannerSource.indexOf("for (const { field, title } of outputFields) {");
  const completeCheckIndex = plannerSource.indexOf("const hasCompletePayload =");

  assert.ok(filterIndex > -1, "outputFields filter not found");
  assert.ok(loopIndex > -1, "extraction loop not found");
  assert.ok(completeCheckIndex > -1, "hasCompletePayload check not found");
  assert.ok(filterIndex < loopIndex, "filter must run before the extraction loop");
  assert.ok(loopIndex < completeCheckIndex, "extraction loop must run before hasCompletePayload is computed");
});

test("Planner.tsx sanitizes each extracted field's content with stripReportPresentationArtifacts inside the same loop that populates reportOutput (drift check)", () => {
  const loopMatch = /for \(const \{ field, title \} of outputFields\) \{[\s\S]*?const content = stripReportPresentationArtifacts\(/.exec(
    plannerSource
  );
  assert.ok(loopMatch, "content extraction is not wrapped in stripReportPresentationArtifacts");
});

test("Planner.tsx filters activeReportFields (the field list ReportPanel actually renders from) through isUniversalCustomerFacingSection (drift check)", () => {
  const fieldsMatch = /const activeReportFields = useMemo\(\s*\n\s*\(\) =>\s*\n\s*\([\s\S]*?\)\.filter\(\(entry\) => isUniversalCustomerFacingSection\(entry\)\)/.exec(
    plannerSource
  );
  assert.ok(fieldsMatch, "activeReportFields is not filtered through isUniversalCustomerFacingSection");
});

test("Planner.tsx's ReportPanel component applies a second, defensive stripReportPresentationArtifacts pass at the actual render boundary, on top of (not instead of) the unrelated sanitizeReportFieldContent diagnostic cleanup (drift check)", () => {
  const sectionsMatch = /const sections = useMemo<ReportSection\[\]>\(\(\) => \{[\s\S]*?reportFields\s*\n\s*\.filter\(\(entry\) => isUniversalCustomerFacingSection\(entry\)\)\s*\n\s*\.map\(\(\{ field, title, icon \}\) => \(\{[\s\S]*?stripReportPresentationArtifacts\(\s*\n\s*sanitizeReportFieldContent\(field, reportData\[field\] \|\| ""\)\s*\n\s*\)/.exec(
    plannerSource
  );
  assert.ok(sectionsMatch, "ReportPanel's sections useMemo does not apply the defensive stripReportPresentationArtifacts pass");
});

test("Planner.tsx's getReportMarkdown (the function that builds the text persisted into the chat message) filters fields and sanitizes content the same way (drift check)", () => {
  const markdownMatch = /function getReportMarkdown\([\s\S]*?fields\s*\n\s*\.filter\(\(entry\) => isUniversalCustomerFacingSection\(entry\)\)\s*\n\s*\.map\(\(\{ field, title: sectionTitle \}\) => \{\s*\n\s*const content = stripReportPresentationArtifacts\(/.exec(
    plannerSource
  );
  assert.ok(markdownMatch, "getReportMarkdown does not filter/sanitize the same way");
});

// --- Regression: reproduce the exact $40M purchase price / $10M ARR ------
// ---    acquisition case end-to-end ---------------------------------------

const acquisitionPrompt =
  "We are acquiring a cybersecurity SaaS company. Purchase price is $40M and target ARR is $10M.";

test("extractAcquisitionDealFacts/computeAcquisitionDerivedMetrics reproduce the exact $40M/$10M case: EV/ARR = 4.0x, matching the fix's own required GOOD example", () => {
  const facts = extractAcquisitionDealFacts(acquisitionPrompt);
  assert.equal(facts.purchasePrice, 40_000_000);
  assert.equal(facts.targetArr, 10_000_000);

  const derived = computeAcquisitionDerivedMetrics(facts);
  assert.equal(derived.evToArr, 4.0);
});

// A realistic $40M/$10M acquisition persisted-section fixture, shaped
// exactly like createGroundedAcquisitionTimeoutFallback's actual output
// (plan-executor.ts) -- the same worst-case shape prior turns' fixtures
// used, now with this ticket's own named numbers. This mirrors exactly
// what Planner.tsx's `persistedSections` (jobStatus.report.sections) look
// like the moment a live generation completes.
function persistedAcquisitionSections() {
  return [
    {
      field: "executiveAcquisitionSummary",
      title: "Executive Acquisition Summary",
      content:
        "[Recommendation] [Basis:decision engine] The synthesis provider reached its deadline; this preliminary report was completed from verified evidence and the existing decision engine.\n[Recommendation] [Basis:decision engine] Proceed conditionally on confirmed financing terms.",
    },
    {
      field: "targetCompanyOverview",
      title: "Target Company Overview",
      content: "[Verified] Purchase price: $40M\n[Verified] Target ARR: $10M",
    },
    {
      field: "externalEvidence",
      title: "External Evidence",
      content:
        "[Verified] [R1] valuation: SaaS EV/ARR benchmark 3.5x-4.5x https://saas-capital.example.com/benchmarks",
    },
    {
      field: "valuationAnalysis",
      title: "Valuation Analysis (EV/ARR, Purchase Price Fairness)",
      content:
        "[Derived] EV/ARR: 4.0x\n[R1] Comparable SaaS transactions average 3.5x-4.5x EV/ARR, supporting the $40M purchase price as fair against $10M target ARR.",
    },
    {
      field: "missingInformation",
      title: "Missing Information",
      content:
        "[Unknown] [Required:valuation_purchase_price] Some external sources could not be verified, so this field is not definitive.",
    },
    {
      field: "finalInvestmentRecommendation",
      title: "Final Investment Recommendation",
      content:
        "[Recommendation] [Basis:decision engine] Proceed conditionally: financing terms are the primary open item before close.",
    },
    {
      field: "sources",
      title: "Sources",
      content:
        "[Verified] [R1] valuation: SaaS EV/ARR benchmark https://saas-capital.example.com/benchmarks",
    },
  ];
}

// Mirrors Planner.tsx's own outputFields.filter(...) + the extraction
// loop's stripReportPresentationArtifacts(content) exactly -- proving the
// same two exported sanitizer functions, applied the same way this fix
// now wires them in Planner.tsx, produce a fully clean live view for this
// exact scenario.
function simulateLiveViewExtraction(persistedSections) {
  const outputFields = persistedSections
    .map((section) => ({ field: section.field, title: section.title }))
    .filter((entry) => isUniversalCustomerFacingSection(entry));

  const reportOutput = {};
  for (const { field, title } of outputFields) {
    const persistedSection = persistedSections.find(
      (section) => section.field === field || section.title === title
    );
    const content = stripReportPresentationArtifacts(
      typeof persistedSection?.content === "string" ? persistedSection.content.trim() : ""
    );
    if (content) {
      reportOutput[field] = content;
    }
  }
  return { outputFields, reportOutput };
}

test("the live view (simulating Planner.tsx's exact extraction logic) excludes the Sources and External Evidence sections entirely for the $40M/$10M acquisition case", () => {
  const { outputFields, reportOutput } = simulateLiveViewExtraction(persistedAcquisitionSections());

  assert.ok(!outputFields.some((f) => f.field === "sources"));
  assert.ok(!outputFields.some((f) => f.field === "externalEvidence"));
  assert.equal(reportOutput.sources, undefined);
  assert.equal(reportOutput.externalEvidence, undefined);
});

test("the live view contains zero R identifiers, zero URLs, zero 'Verified from...' phrases, and zero internal metadata for the $40M/$10M acquisition case", () => {
  const { reportOutput } = simulateLiveViewExtraction(persistedAcquisitionSections());
  const allContent = Object.values(reportOutput).join("\n");

  assert.doesNotMatch(allContent, /\[R\d+\]/, "R identifiers leaked");
  assert.doesNotMatch(allContent, /https?:\/\//i, "a URL leaked");
  assert.doesNotMatch(allContent, /Verified from (?:official|external|uploaded asset)/i, "'Verified from...' leaked");
  assert.doesNotMatch(allContent, /\[Basis:/, "[Basis:...] leaked");
  assert.doesNotMatch(allContent, /\[Recommendation\]/, "[Recommendation] leaked");
  assert.doesNotMatch(allContent, /\[Unknown\]/, "[Unknown] leaked");
  assert.doesNotMatch(allContent, /\[Required:/, "[Required:...] leaked");
  assert.doesNotMatch(allContent, /decision engine/i, "'decision engine' leaked");
  assert.doesNotMatch(allContent, /synthesis provider/i, "'synthesis provider' leaked");
  assert.doesNotMatch(allContent, /evidence registry/i, "'evidence registry' leaked");
});

test("the live view preserves the $40M purchase price, $10M target ARR, and the derived 4.0x EV/ARR multiple exactly, correctly labeled [Verified]/[Derived]", () => {
  const { reportOutput } = simulateLiveViewExtraction(persistedAcquisitionSections());

  assert.match(reportOutput.targetCompanyOverview, /\[Verified\] Purchase price: \$40M/);
  assert.match(reportOutput.targetCompanyOverview, /\[Verified\] Target ARR: \$10M/);
  assert.match(reportOutput.valuationAnalysis, /\[Derived\] EV\/ARR: 4\.0x/);
});

test("the live view's Missing Information field is rewritten into a natural sentence (not just tag-stripped) for the $40M/$10M acquisition case", () => {
  const { reportOutput } = simulateLiveViewExtraction(persistedAcquisitionSections());

  assert.doesNotMatch(reportOutput.missingInformation, /\[Unknown\]/);
  assert.doesNotMatch(reportOutput.missingInformation, /\[Required:/);
  assert.doesNotMatch(reportOutput.missingInformation, /Some external sources could not be verified/i);
  assert.match(reportOutput.missingInformation, /^Valuation purchase price requires additional verification before this can be finalized\.$/);
});

test("the live view leaves natural executive-language analysis intact for the $40M/$10M acquisition case -- the fix removes labels, not the underlying reasoning", () => {
  const { reportOutput } = simulateLiveViewExtraction(persistedAcquisitionSections());

  assert.match(
    reportOutput.valuationAnalysis,
    /Comparable SaaS transactions average 3\.5x-4\.5x EV\/ARR, supporting the \$40M purchase price as fair against \$10M target ARR\./
  );
  assert.match(
    reportOutput.finalInvestmentRecommendation,
    /Proceed conditionally: financing terms are the primary open item before close\./
  );
});
