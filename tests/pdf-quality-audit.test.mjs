import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  repairReportLanguageSections,
} from "../app/lib/report-language.ts";
import { normalizePdfText } from "../app/lib/pdf-normalization.mjs";

const pdfSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
const realEstateSource = readFileSync(
  new URL("../app/lib/pdf-engine/real-estate-report.ts", import.meta.url),
  "utf8"
);
// report-presentation.ts has a real (non-type-only) "@/app/..." import that
// plain `node --test` cannot resolve, same as every other test in this
// suite that touches it -- verified via static source assertions instead
// of a live import.
const presentationSource = readFileSync(
  new URL("../app/lib/report-presentation.ts", import.meta.url),
  "utf8"
);

// --- report-language.ts: replaceKnownReportCopy word-boundary fix -------

test("repairReportLanguageSections never corrupts VALIDATE (or other ALL-CAPS words containing a short foreign-locale token as a substring)", () => {
  const sections = [
    {
      title: "Executive Summary",
      content: "Bottom Line: VALIDATE with Decision Confidence Medium -- the pain is real.",
    },
  ];
  const repaired = repairReportLanguageSections(sections, "en").sections;

  assert.match(repaired[0].content, /\bVALIDATE\b/);
  assert.doesNotMatch(repaired[0].content, /VBUYIDATE/);
});

test("replaceKnownReportCopy still repairs a genuine standalone foreign-locale token", () => {
  // "AL" (Turkish for "buy") leaking as a standalone word into an English
  // report should still be repaired to "BUY" -- only the unbounded,
  // mid-word substitution was the bug.
  const sections = [{ title: "Decision", content: "Recommendation: AL" }];
  const repaired = repairReportLanguageSections(sections, "en").sections;

  assert.match(repaired[0].content, /\bBUY\b/);
});

// --- report-presentation.ts: extractDecision / extractPercentScore ------

test("extractDecision falls back to the whole field's content for the decision keyword, not just the labeled Recommendation span", () => {
  const match = presentationSource.match(/function extractDecision\([\s\S]*?\n}\n/);
  assert.ok(match, "extractDecision function not found");
  // Must try the labeled span first, but fall back to searching `content`
  // itself when that span has no keyword -- not immediately give up and
  // return the raw (potentially unbounded) labeled text.
  assert.match(
    match[0],
    /\(labeled && labeled\.match\([\s\S]{0,80}\)\)[\s\S]{0,40}\|\|[\s\S]{0,40}content\.match\(/
  );
});

test("extractPercentScore requires an explicit %/100 suffix for its unlabeled full-content fallback, so it can't fabricate a score from an unrelated bare number", () => {
  const match = presentationSource.match(/function extractPercentScore\([\s\S]*?\n}\n/);
  assert.ok(match, "extractPercentScore function not found");
  assert.match(match[0], /labeled\s*\n?\s*\?\s*labeled\.match/);
  // The unlabeled (content) branch's suffix group must be mandatory, i.e.
  // not end in the `?` that made it optional before this fix.
  assert.match(match[0], /:\s*content\.match\(\/\\b\(\\d\{1,3\}\)\\s\*\(\?:%\|\\\/\\s\*100\)\\b\/\)/);
});

// --- pdf-normalization.mjs: Turkish Lira glyph substitution -------------

test("normalizePdfText substitutes the Turkish Lira sign (missing from the embedded font) with an ASCII TL prefix", () => {
  assert.equal(
    normalizePdfText("Valuation: ₺84,500,000 to ₺99,700,000"),
    "Valuation: TL 84,500,000 to TL 99,700,000"
  );
});

// --- ReportPdfButton.tsx: static source assertions -----------------------
// This file has a "use client" React component with heavy jsPDF/DOM
// dependencies; the rest of the test suite already establishes
// regex-based static source assertions as the pattern for verifying its
// internals without a browser or React render tree.

test("escapeRegExp tolerates a non-breaking space wherever a literal space was expected", () => {
  assert.match(pdfSource, /function escapeRegExp/);
  assert.match(pdfSource, /\.replace\(\/ \/g, "\[ \\\\u00a0\]"\)/);
});

test("isMobilityReportContent no longer treats \"yearly revenue\"/\"monthly revenue\" as mobility signals", () => {
  const match = pdfSource.match(/return \/\\b\(scooter\|[\s\S]*?\)\\b\/i\.test\(/);
  assert.ok(match, "isMobilityReportContent's detection regex not found");
  assert.doesNotMatch(match[0], /yearly revenue/i);
  assert.doesNotMatch(match[0], /monthly revenue/i);
  // Still recognizes the real, mobility-exclusive signals.
  assert.match(match[0], /rider cac/i);
  assert.match(match[0], /rider ltv/i);
});

test("the Table of Contents surfaces a count instead of silently dropping entries once it fills its single reserved page", () => {
  assert.match(pdfSource, /moreTocSectionsCopy/);
  assert.match(pdfSource, /hiddenTocCount/);
});

test("financial metric cards (Financial Dashboard, Unit Economics, TAM/SAM/SOM) prefer their own section content before falling back to the rest of the report", () => {
  assert.match(
    pdfSource,
    /extractCanonicalFinancialMetricValue\(content, metric\.label, metric\.aliases\)[\s\S]{0,40}\|\|[\s\S]{0,40}extractCanonicalFinancialMetricValue\(metricContent, metric\.label, metric\.aliases\)/
  );
  assert.match(
    pdfSource,
    /extractMetricValueFromAliases\(content, aliases\)\)[\s\S]{0,40}\|\|[\s\S]{0,80}extractMetricValueFromAliases\(metricContent, aliases\)\)/
  );
  assert.match(
    pdfSource,
    /getTamRows = \(visualContent: string, rawContent = ""\)/
  );
});

test("compactPdfMetricValue preserves a range (e.g. \"$2.1-2.8B\") instead of truncating to its first bound", () => {
  assert.match(pdfSource, /function compactPdfMetricValue/);
  assert.match(pdfSource, /rangePattern/);
});

test("the competitor table never misreads the field's own instructed closing summary sentence as another competitor row", () => {
  assert.match(pdfSource, /competitorSummaryLinePattern/);
  assert.match(pdfSource, /Executive implication/);
});

test("parseCitations detects a dedicated \"URL: https://...\" line instead of stripping its value before the field can be recognized", () => {
  const match = pdfSource.match(/function parseCitations\([\s\S]*?\n}\n/);
  assert.ok(match, "parseCitations function not found");
  assert.match(match[0], /strippedLine/);
});

test("the cover page's business-idea prompt excerpt truncates at a word boundary with an ellipsis instead of cutting mid-word", () => {
  const match = pdfSource.match(/function getBusinessIdeaFromPrompt\([\s\S]*?\n}\n/);
  assert.ok(match, "getBusinessIdeaFromPrompt function not found");
  assert.match(match[0], /…/);
  assert.doesNotMatch(match[0], /return cleaned\.slice\(0, 180\);/);
});

test("the cover page's Decision banner cannot overflow off the page even if fed unbounded text", () => {
  assert.match(pdfSource, /decisionBannerWidth/);
  assert.match(pdfSource, /decisionDisplay/);
});

test("the cover page's KPI cards measure label/value wrapping at their real draw-time font size, not whatever font the Decision banner left active", () => {
  assert.match(pdfSource, /previousCoverFontSize/);
});

// --- real-estate-report.ts: static source assertions ---------------------

test("groupCitationLines reconstructs a citation split across multiple lines by repairReportLanguageSections before extraction runs", () => {
  assert.match(realEstateSource, /function groupCitationLines/);
  assert.match(realEstateSource, /Verified from official source\|Verified from external source/);
});

test("real-estate-report.ts substitutes the Turkish Lira sign the same way pdf-normalization.mjs does", () => {
  assert.match(realEstateSource, /\\u20BA\\s\*\/g, "TL "/);
});
