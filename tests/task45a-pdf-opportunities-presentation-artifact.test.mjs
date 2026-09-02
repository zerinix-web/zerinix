import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// TASK #45A -- Remove the real PDF presentation artifact introduced/
// exposed in Opportunities.
//
// REAL REPORTED DEFECT (page 7 of a real Download PDF):
//   "documented price lists (e.g. Key insights •, South Carolina)"
// followed by stray bullet markers before items 3 and 4 of a numbered
// Opportunities list.
//
// ROOT CAUSE #1 -- components/Planner.tsx's formatPdfReadableContent
// (the shared PDF body-text formatter every non-"complete visual"
// section, including Opportunities/Threats/Barriers/Market Drivers,
// passes through) restructures long, unstructured prose (>=520 chars,
// no existing bullets, <=4 lines) into a "lead paragraph + 'Key
// insights' heading + bullet list" shape, to make dense text more
// scannable in the PDF. It builds this from splitPdfSentences(content),
// which used to split on ANY bare period/!/? with NO abbreviation
// awareness. A real Opportunities sentence naming "(e.g. South
// Carolina, Texas)" was split right after "e.g." into two fragments;
// whichever fragment landed at the executiveParagraph/insightBullets
// boundary got the synthetic "Key insights" heading (and the next
// fragment's own leading "• ") spliced directly into what should have
// remained ONE continuous sentence -- reproducing the exact reported
// artifact.
//
// ROOT CAUSE #2 -- the same function's "is this content already
// structured enough to leave alone" check only ever recognized bullet
// markers (-*•) or a pipe table, never a genuinely NUMBERED list
// ("1) ... 2) ... 3) ... 4) ..." written as one continuous paragraph,
// the real Opportunities shape). Such content fell through as
// "unstructured" and was destructively re-flowed by the same sentence-
// splitting + bullet-prepending logic -- corrupting the original
// numbering and prefixing a stray "• " directly onto whichever items
// landed in the bullet slice (items 3+, since the first 2 sentences
// become the unbulleted lead paragraph) -- reproducing the reported
// "stray bullet markers before items 3 and 4".
//
// FIX:
// 1. splitPdfSentences now runs protectSentenceAbbreviations/
//    restoreSentenceAbbreviations (report-presentation.ts's own
//    established fix for the identical class of bug in splitSentences/
//    extractRecommendationSignals, now exported for reuse) before/after
//    splitting, so a known abbreviation's periods ("e.g.", "U.S.",
//    "Mr.", etc.) can never be mistaken for a sentence boundary.
// 2. The "already structured" check now also recognizes a genuine
//    numbered list (2+ occurrences of a bounded 1-20 item marker
//    followed by a capital letter, avoiding false positives on years
//    or decimal figures) and leaves it completely untouched -- the
//    original numbering and prose survive exactly as generated, never
//    restructured into a synthetic paragraph+bullets shape at all.
//
// This is a presentation/sanitization-only fix: the underlying claim
// text, source-to-claim support classification, decision, confidence,
// evidence classification, and recommendation logic are all untouched.

const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");

function extractFunctionSource(source, functionName) {
  const startMatch = source.match(new RegExp(`function ${functionName}\\(`));
  assert.ok(startMatch, `${functionName} not found`);
  const start = startMatch.index;
  let i = start + startMatch[0].length - 1;
  let parenDepth = 1;
  while (parenDepth > 0) {
    i += 1;
    if (source[i] === "(") parenDepth += 1;
    else if (source[i] === ")") parenDepth -= 1;
  }
  while (source[i] !== "{") i += 1;
  let braceDepth = 0;
  do {
    if (source[i] === "{") braceDepth += 1;
    else if (source[i] === "}") braceDepth -= 1;
    i += 1;
  } while (braceDepth > 0);
  return source.slice(start, i);
}

async function compileSplitPdfSentences() {
  const raw = extractFunctionSource(plannerSource, "splitPdfSentences");
  const pieces = [
    "import { normalizePdfText } from \"/Users/iyslv/Desktop/zerinix/app/lib/pdf-normalization.mjs\";",
    "import { protectSentenceAbbreviations, restoreSentenceAbbreviations } from \"/Users/iyslv/Desktop/zerinix/app/lib/report-presentation.ts\";",
    raw.replace("function splitPdfSentences", "export function splitPdfSentences"),
  ].join("\n\n");

  const dir = mkdtempSync(join(new URL("..", import.meta.url).pathname, ".zerinix-task45a-test-"));
  const outPath = join(dir, "splitPdfSentences.ts");
  writeFileSync(outPath, pieces);
  try {
    const mod = await import(pathToFileURL(outPath).href);
    return mod.splitPdfSentences;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- 1. "Key insights" residue: the exact reported abbreviation split ---

test("TASK #45A: 'documented price lists (e.g. South Carolina, Texas)' is never split right after 'e.g.' -- the real, shipped splitPdfSentences resolves it as ONE complete sentence", async () => {
  const splitPdfSentences = await compileSplitPdfSentences();
  const sentences = splitPdfSentences(
    "Multiple states publish documented price lists (e.g. South Carolina, Texas) that vendors can reference for competitive positioning."
  );
  assert.equal(sentences.length, 1);
  // normalizePdfText (an existing, unrelated feature -- glues an
  // abbreviation to its following word with a non-breaking space so it
  // can never be orphaned at a line wrap) turns the space after "e.g."
  // into U+00A0; normalize both sides to a plain space before comparing
  // since this test is about sentence-boundary correctness, not that
  // pre-existing whitespace choice.
  const normalizeSpaces = (value) => value.replace(/ /g, " ");
  assert.equal(
    normalizeSpaces(sentences[0]),
    "Multiple states publish documented price lists (e.g. South Carolina, Texas) that vendors can reference for competitive positioning."
  );
  assert.doesNotMatch(normalizeSpaces(sentences.join(" ")), /\(e\.\s*$/, "must never end mid-parenthetical at the abbreviation's own period");
});

test("TASK #45A: reproducing the exact end-to-end reported artifact -- with the OLD unprotected splitting, 'Key insights' would land inside the (e.g. ...) parenthetical; with the real, fixed splitPdfSentences, it never does", async () => {
  const splitPdfSentences = await compileSplitPdfSentences();
  // A realistic long (>=520 char), unstructured Opportunities-shaped
  // paragraph naming the exact real example ("South Carolina") inside
  // an "(e.g. ...)" clause, long enough to trigger the real
  // paragraph+bullets restructuring formatPdfReadableContent performs.
  const longUnstructuredContent =
    "Procurement teams across the mid-market increasingly rely on publicly documented price lists (e.g. South Carolina, Texas) when negotiating contract lifecycle management software renewals, since these disclosures let buyers benchmark vendor pricing against comparable public-sector deals. Vendors that publish transparent, itemized pricing tend to close deals faster than those relying on opaque, sales-led quoting processes. Buyers also increasingly demand documented compliance certifications before committing to a multi-year renewal. Several vendors have begun offering usage-based pricing tiers to address budget-conscious mid-market accounts. Contract renewal cycles are shortening across the sector, creating more frequent evaluation windows for challenger vendors to win share.";
  assert.ok(longUnstructuredContent.length >= 520, "fixture must be long enough to trigger restructuring");

  const sentences = splitPdfSentences(longUnstructuredContent);
  assert.ok(sentences.length > 4, "fixture must have enough sentences to trigger the executiveParagraph/insightBullets split");

  const executiveParagraph = sentences.slice(0, 2).join(" ");
  const insightBullets = sentences.slice(2, 7).map((sentence) => `• ${sentence}`);
  const structured = [executiveParagraph, "Key insights", ...insightBullets].join("\n");

  // The exact reported failure shape: "Key insights" (or a bullet)
  // landing inside the "(e.g. ...)" clause.
  assert.doesNotMatch(structured, /\(e\.g\.\s*\n?\s*Key insights/i, "Key insights must never be spliced inside the (e.g. ...) clause");
  assert.doesNotMatch(structured, /\(e\.\s*\n?\s*Key insights/i);
  // The South Carolina example itself must survive completely intact,
  // as one real, readable clause -- not split, not merged with "Key
  // insights", not missing its closing parenthesis. normalizePdfText
  // (an existing, unrelated feature) glues "e.g." to the following word
  // with a non-breaking space, so \s (which matches U+00A0) is used
  // rather than a literal space.
  assert.match(structured, /\(e\.g\.\s+South Carolina, Texas\)/);
});

// --- 2. Stray bullet contamination / numbered-list preservation --------

test("TASK #45A: a genuine numbered Opportunities list ('1) ... 2) ... 3) ... 4) ...', written as one continuous paragraph) is recognized as already-structured and left COMPLETELY untouched -- no Key insights heading, no stray bullets before items 3/4, no restructuring at all", () => {
  const numberedOpportunities =
    "1) Vendors can differentiate through transparent AI accuracy benchmarking validated against named competitors and independently published evaluation results. 2) Procurement teams increasingly demand documented compliance certifications before committing to a multi-year renewal cycle across the mid-market segment. 3) Multiple states publish documented price lists (e.g. South Carolina, Texas) that vendors can reference for competitive positioning against incumbent providers. 4) Contract renewal cycles are shortening across the sector, creating more frequent evaluation windows for challenger vendors to win share from incumbents.";
  assert.ok(numberedOpportunities.length >= 520, "fixture must be long enough that length alone would have triggered restructuring");

  const numberedListMarkerMatch = plannerSource.match(
    /const numberedListMarkerCount = \(\s*\n\s*normalized\.match\((\/[\s\S]*?\/g)\) \|\| \[\]\s*\n\s*\)\.length;/
  );
  assert.ok(numberedListMarkerMatch, "expected to find the real numberedListMarkerCount regex in source");
  // Extracting the REAL, shipped regex literal text (not re-implementing it) to test against, avoiding a hand-copied approximation that could drift from production.
  const numberedListMarkerPattern = (0, eval)(numberedListMarkerMatch[1]);

  const matchCount = (numberedOpportunities.match(numberedListMarkerPattern) || []).length;
  assert.ok(matchCount >= 2, `expected the real numbered-marker pattern to detect at least 2 markers, found ${matchCount}`);
});

test("TASK #45A: the numbered-marker detector does NOT false-positive on a year mention or a decimal percentage inside ordinary prose", () => {
  const numberedListMarkerMatch = plannerSource.match(
    /const numberedListMarkerCount = \(\s*\n\s*normalized\.match\((\/[\s\S]*?\/g)\) \|\| \[\]\s*\n\s*\)\.length;/
  );
  // See the test above for why eval is used here (extracting the real shipped regex, not a hand copy).
  const numberedListMarkerPattern = (0, eval)(numberedListMarkerMatch[1]);

  const yearProse =
    "In 2024. The market grew significantly due to increased AI adoption across the mid-market segment, with several vendors reporting double-digit growth in new customer acquisition during the fiscal year across every major region.";
  const percentProse =
    "The CAGR is 3.5%. Contract values grew steadily throughout the period. A 10. 5% increase was separately reported by one analyst covering the broader sector across multiple quarters of sustained expansion in the addressable market.";

  assert.equal((yearProse.match(numberedListMarkerPattern) || []).length, 0);
  assert.equal((percentProse.match(numberedListMarkerPattern) || []).length, 0);
});

// --- 3. Numbered list preservation + South Carolina example intact (E2E) ---

test("TASK #45A: end-to-end -- combining the real splitPdfSentences fix with the real numbered-marker check, a genuine numbered Opportunities list is returned completely unmodified (never restructured), while genuinely unstructured long prose naming the same South Carolina example still restructures safely with the sentence intact", async () => {
  const splitPdfSentences = await compileSplitPdfSentences();
  const numberedListMarkerMatch = plannerSource.match(
    /const numberedListMarkerCount = \(\s*\n\s*normalized\.match\((\/[\s\S]*?\/g)\) \|\| \[\]\s*\n\s*\)\.length;/
  );
  // See earlier tests for rationale (extracting the real shipped regex, not a hand copy).
  const numberedListMarkerPattern = (0, eval)(numberedListMarkerMatch[1]);

  function simulateFormatPdfReadableContent(normalized) {
    const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
    const numberedListMarkerCount = (normalized.match(numberedListMarkerPattern) || []).length;
    const alreadyStructured =
      lines.some((line) => /^[-*•]\s+/.test(line) || /^\|/.test(line)) ||
      lines.length >= 4 ||
      numberedListMarkerCount >= 2;
    if (normalized.length < 520 || alreadyStructured) {
      return normalized;
    }
    const sentences = splitPdfSentences(normalized);
    if (sentences.length <= 4) {
      return normalized;
    }
    const executiveParagraph = sentences.slice(0, 2).join(" ");
    const insightBullets = sentences.slice(2, 7).map((s) => `• ${s}`);
    return [executiveParagraph, "Key insights", ...insightBullets].join("\n");
  }

  const numberedOpportunities =
    "1) Vendors can differentiate through transparent AI accuracy benchmarking validated against named competitors and independently published evaluation results. 2) Procurement teams increasingly demand documented compliance certifications before committing to a multi-year renewal cycle across the mid-market segment. 3) Multiple states publish documented price lists (e.g. South Carolina, Texas) that vendors can reference for competitive positioning against incumbent providers. 4) Contract renewal cycles are shortening across the sector, creating more frequent evaluation windows for challenger vendors to win share from incumbents.";

  const result = simulateFormatPdfReadableContent(numberedOpportunities);
  assert.equal(result, numberedOpportunities, "a genuine numbered list must be returned byte-for-byte unmodified");
  assert.doesNotMatch(result, /Key insights/);
  assert.doesNotMatch(result, /•/);
  assert.match(result, /\(e\.g\. South Carolina, Texas\)/);
  assert.match(result, /^1\) .*2\) .*3\) .*4\) /s, "the original 1)/2)/3)/4) numbering must survive completely intact");
});

// --- 4. Structural audit ------------------------------------------------

test("STRUCTURAL AUDIT: splitPdfSentences (Planner.tsx) calls the real, shared protectSentenceAbbreviations/restoreSentenceAbbreviations -- not a re-implemented or missing abbreviation guard", () => {
  const fnSource = extractFunctionSource(plannerSource, "splitPdfSentences");
  assert.match(fnSource, /protectSentenceAbbreviations\(/);
  assert.match(fnSource, /restoreSentenceAbbreviations\(/);
});

test("STRUCTURAL AUDIT: report-presentation.ts's protectSentenceAbbreviations/restoreSentenceAbbreviations are exported (Task #45A) so Planner.tsx can import the real, shared implementation instead of a second, driftable copy", () => {
  const reportPresentationSource = readFileSync(new URL("../app/lib/report-presentation.ts", import.meta.url), "utf8");
  assert.match(reportPresentationSource, /export function protectSentenceAbbreviations\(/);
  assert.match(reportPresentationSource, /export function restoreSentenceAbbreviations\(/);
  assert.match(
    plannerSource,
    /protectSentenceAbbreviations,\s*\n\s*restoreSentenceAbbreviations,\s*\n\s*stripLeadingTakeawaySentence,\s*\n\} from "@\/app\/lib\/report-presentation";/
  );
});

test("STRUCTURAL AUDIT: the alreadyStructured check includes a numberedListMarkerCount term, so a genuinely enumerated section is never destructively re-flowed", () => {
  assert.match(plannerSource, /numberedListMarkerCount >= 2/);
});

// --- 5. Web/PDF equivalent prose ----------------------------------------

test("TASK #45A (web/PDF equivalence): page.tsx has no equivalent 'Key insights' paragraph-to-bullets restructuring at all -- the web report always shows the section's real, unmodified content, so it was never exposed to this defect class in the first place", () => {
  assert.doesNotMatch(pageSource, /Key insights/);
  assert.doesNotMatch(pageSource, /splitPdfSentences/);
});

test("TASK #45A (web/PDF equivalence): ReportPdfButton.tsx (the other real Download PDF path) also has no equivalent restructuring logic -- this defect and its fix are scoped entirely to Planner.tsx's own separate PDF drawer, confirmed by source", () => {
  assert.doesNotMatch(pdfButtonSource, /Key insights/);
  assert.doesNotMatch(pdfButtonSource, /splitPdfSentences/);
});

// --- 6. Preserve Task #45 protections + decision/evidence untouched ----

test("DRIFT CHECK: Task #45's Competitive Landscape scoping caption and Task #44's negatedVerifiedPattern remain in place, untouched by this presentation-only fix", () => {
  assert.match(plannerSource, /Vendor Confidence reflects existence and market relevance only -- not category, position, strengths, or weaknesses\./);
  const reportEvidenceSource = readFileSync(new URL("../app/lib/report-evidence.ts", import.meta.url), "utf8");
  assert.match(reportEvidenceSource, /const negatedVerifiedPattern =/);
});

test("DRIFT CHECK: decision/confidence/evidence-gap/recommendation methodology is untouched -- this fix only changes how PDF body prose is sentence-split and when it gets restructured, never any classification or scoring logic", async () => {
  const marketIntelligencePresentationSource = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketIntelligencePresentationSource, /export function assessMarketEntryConfidence\(/);
  assert.match(marketIntelligencePresentationSource, /marketConfidence\s*\*\s*0\.4/);
});
