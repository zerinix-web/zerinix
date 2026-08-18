import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDomainAnalysisInstructions } from "../app/lib/report-engine/prompts/domain-analysis.ts";

const root = new URL("..", import.meta.url).pathname;
function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

// Production-readiness audit finding (fixed this pass): Strategic
// Advisory / specialized-domain reports (legal, finance, accounting,
// operations, procurement) were the only report type that never called
// buildStrictReportLanguageInstruction -- market.ts already does, and
// real-estate.ts has its own dedicated post-hoc language validator as a
// substitute. domain-analysis.ts had neither, relying only on the
// generic worker-level repair pass as its sole line of defense against
// mixed-language output.
test("Strategic Advisory report instructions include the shared strict-language directive, matching market.ts's coverage", () => {
  const instructions = buildDomainAnalysisInstructions("legal", "Turkish");

  // "preserving evidence labels... exactly" (the original wording) told
  // the model to keep English evidence-classification labels verbatim
  // even in a Turkish report -- directly contradicting the full-language
  // instruction on the next line. Fixed to require the labels themselves
  // be written in the report's own language; only registry reference
  // numbers and filenames are language-neutral.
  assert.match(instructions, /Respond entirely in Turkish\./);
  assert.match(instructions, /evidence-classification labels, must be written in Turkish/);
  assert.match(
    instructions,
    /Output language is Turkish\. Write every user-visible title, heading, label, paragraph, bullet, table cell, warning, placeholder, recommendation, source label, and action only in Turkish\./,
    "buildStrictReportLanguageInstruction's output must be present"
  );
});

// Production-readiness audit finding (CRITICAL, fixed this pass):
// plan.ts's risks field prompt explicitly asks the model to write a
// full Probability/Impact/Severity/Mitigation/Early-Warning-Signal risk
// matrix directly, and explicitly says "Do not add a heading" for it --
// so the append-guard in plan-executor.ts (which only checked for the
// literal heading "Risk Matrix") could never detect that content and
// always appended a second, templated risk matrix underneath, with
// independently-assigned severity that could contradict the model's own
// analysis for the same risk.
test("business-plan risks field does not append a duplicate templated risk matrix when the model already wrote one", () => {
  const source = read("app/lib/report-jobs/plan-executor.ts");

  assert.match(
    source,
    /function risksAlreadyIncludeRiskMatrix\(content: string\) \{\s*\n\s*return \(\s*\n\s*\/\\b\(\?:probability\|olasılık\)\\b\/i\.test\(content\) &&\s*\n\s*\/\\b\(\?:mitigation\|azaltım\|azaltma\)\\b\/i\.test\(content\)/,
    "the detection helper must check for the risk matrix's real required structure (Probability/Mitigation, English or Turkish), not a heading the model is told never to write"
  );
  // The risk-matrix append itself was moved to run after the
  // labelModelDerivedFinancialClaims loop (see
  // shouldAppendRiskMatrix's own comment in plan-executor.ts) so the
  // deterministic risk matrix can never be mistaken for unverifiable
  // AI-written prose and replaced with a generic fallback -- but the
  // decision of WHETHER to append it must still be made from the
  // model's own pre-labeling content, since risksAlreadyIncludeRiskMatrix
  // checks for the model's own Probability/Mitigation structure.
  assert.match(
    source,
    /const shouldAppendRiskMatrix = !risksAlreadyIncludeRiskMatrix\(normalized\.risks\);/,
    "the append-or-skip decision must still be computed from the model's own content before labeling"
  );
  assert.match(
    source,
    /normalized\.risks = shouldAppendRiskMatrix\s*\n\s*\? appendIntelligenceBlock\(\s*\n\s*normalized\.risks,/,
    "the append must be skipped when the model's own content already satisfies the risk-matrix requirement"
  );
});

// Production-readiness audit findings (CRITICAL, fixed this pass): a
// font-size measurement/draw-time mismatch in the main PDF pagination
// engine (the same class of bug already fixed once for SWOT boxes in an
// earlier commit, but not applied to the financial-dashboard layout or
// the main body-text pagination path), plus silent content-loss bugs
// (a hard 8-source cap in the PDF vs. unlimited on screen, and
// truncated table/roadmap/scenario text with no ellipsis).
test("PDF font-size measurement is pinned to the real draw-time font before every affected wrap/split call", () => {
  const source = read("app/dashboard/[id]/ReportPdfButton.tsx");

  // getFinancialLayout: pin to 6.2 (labelLines' real draw font) and 5.8
  // (detailLines' real draw font), restoring afterward.
  const financialLayoutStart = source.indexOf("const getFinancialLayout = (content: string, width: number) => {");
  const financialLayoutBody = source.slice(financialLayoutStart, source.indexOf("\n      const drawSectionVisual", financialLayoutStart));
  assert.match(financialLayoutBody, /const previousFontSize = pdf\.getFontSize\(\);/);
  assert.match(financialLayoutBody, /pdf\.setFontSize\(6\.2\);/);
  assert.match(financialLayoutBody, /pdf\.setFontSize\(5\.8\);/);
  assert.match(financialLayoutBody, /pdf\.setFontSize\(previousFontSize\);/);

  // Main body-text pagination: pin to 9.2 for Executive Summary, 8.8
  // otherwise, matching the real draw-time condition below it.
  assert.match(
    source,
    /const bodyLinesPreviousFontSize = pdf\.getFontSize\(\);\s*\n\s*pdf\.setFontSize\(section\.title\.toLowerCase\(\)\.includes\("executive summary"\) \? 9\.2 : 8\.8\);\s*\n\s*const bodyLines = splitPdfReadableLines\(sectionBodyContent, bodyWidth\);\s*\n\s*pdf\.setFontSize\(bodyLinesPreviousFontSize\);/
  );
});

test("PDF Sources section has no artificial cap below what the on-screen citation list shows", () => {
  const source = read("app/dashboard/[id]/ReportPdfButton.tsx");
  assert.doesNotMatch(source, /finalDedupeSources\s*\n\s*\.slice\(0, 8\)/);
  assert.match(source, /const finalDedupeSources = getFinalDedupePdfSources\(citations\);/);
});

test("PDF text truncation (competitor table cells, roadmap steps, scenario snippets) adds an ellipsis instead of silently dropping content", () => {
  const source = read("app/dashboard/[id]/ReportPdfButton.tsx");

  assert.match(
    source,
    /const truncatePdfCellLines = \(lines: string\[\], maxLines: number\) => \{\s*\n\s*if \(lines\.length <= maxLines\) return lines;\s*\n\s*const output = lines\.slice\(0, maxLines\);\s*\n\s*output\[maxLines - 1\] = `\$\{output\[maxLines - 1\]\.replace\(\/\[\.,;:\]\*\$\/, ""\)\}\.\.\.`;\s*\n\s*return output;\s*\n\s*\};/,
    "truncatePdfCellLines must exist and append an ellipsis on truncation, matching the real-estate engine's own truncateLines()"
  );

  // Every previously-bare `wrapPdfText(...).slice(0, N)` / raw
  // `.splitTextToSize(...).slice(0, N)` call site this audit found
  // (competitor cells, roadmap step text, scenario snippet) must now
  // route through the ellipsis-adding helper.
  const truncatedCallSiteCount = (source.match(/truncatePdfCellLines\(/g) || []).length;
  assert.ok(
    truncatedCallSiteCount >= 3,
    `expected at least 3 call sites using truncatePdfCellLines (competitor cell, roadmap step, scenario snippet), found ${truncatedCallSiteCount}`
  );
});

test("real-estate PDF's fixed-layout Sources panel shows a '+N more' note instead of silently dropping sources past its row budget, in every supported language", () => {
  const source = read("app/lib/pdf-engine/real-estate-report.ts");

  assert.match(source, /moreSources: \(count: number\) => string;/);
  assert.match(
    source,
    /if \(sources\.length > maxVisibleRows\) \{\s*\n\s*pdf\.setFontSize\(6\.2\);\s*\n\s*pdf\.setTextColor\(palette\.slate\);\s*\n\s*pdf\.text\(copy\.moreSources\(sources\.length - maxVisibleRows\), 22, 188\);\s*\n\s*\}/,
    "the panel must render a count of hidden sources, not just stop drawing"
  );

  // Every locale object must define moreSources -- a report generated
  // in any of the 5 supported languages must render this note in that
  // same language, not fall back to English.
  for (const fragment of [
    'moreSources: (count: number) => `+ ${count} kaynak daha`', // Turkish
    'moreSources: (count: number) => `+ ${count} more`', // English
    'moreSources: (count: number) => `+ ${count} weitere`', // German
    'moreSources: (count: number) => `+ ${count} de plus`', // French
    'moreSources: (count: number) => `+ ${count} más`', // Spanish
  ]) {
    assert.ok(source.includes(fragment), `missing locale string: ${fragment}`);
  }
});
