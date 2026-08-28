import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// TASK #14 -- Fix the REAL Market Intelligence competitor contradiction
// found in the regenerated localhost report.
//
// After Task #13 shipped, the SAME report was regenerated and the
// contradiction was still live: Competitive Landscape said "No competitor
// data could be validated for this market yet." while Major Players, one
// section above it, said "Only evidence-supported major players in the
// supplied registry: Ironclad, Evisort, DocuSign CLM, and LawGeex." Task
// #13's own regression tests all passed -- because none of them exercised
// THIS specific prose shape.
//
// ROOT CAUSE (confirmed via direct reproduction against the exact real
// content shape, before writing any fix): extractMarketIntelligenceCompetitorRows
// correctly found zero structured rows (this Major Players content has no
// markdown table, no flattened bullets, and no deterministic "- Vendor
// (Label): ..." bulleted lines -- just a single free-text sentence). The
// pipeline's own designed recovery for exactly this case,
// extractMarketIntelligenceCompetitorNamesOnly, has two prose-matching
// tiers -- predicate-leading ("include X, Y, Z") and subject-leading ("X,
// Y, Z are established competitors") -- and Task #12 already fixed both of
// those. But the real content used a THIRD, equally common shape neither
// tier recognizes: a colon-introduced list with no trigger word before it
// and no "are/is ... competitors" clause after it ("... in the supplied
// registry: Ironclad, Evisort, DocuSign CLM, and LawGeex."). Reproduced
// directly against the unmodified source below (see the first test in
// this file) before any fix was written, confirming this exact gap.
//
// FIX: a third prose-matching tier, colonLeadingMatch, anchored on the
// colon itself -- the name list must be the LAST thing before the
// sentence ends (period, newline, or end of string), so a colon-
// introduced clause that continues into further prose past the list does
// not match at all rather than truncating into a misleading partial
// capture. Reuses the exact same nameListGroup capture group as the two
// existing tiers. Mirrored identically across page.tsx,
// ReportPdfButton.tsx, and Planner.tsx (each has its own duplicate of
// this function, per this codebase's established pattern).
//
// SECOND FIX, found while auditing web/PDF consistency per this ticket's
// explicit instruction: page.tsx and Planner.tsx's own on-screen
// "Relevant Players Identified" compact card (the state this fix now
// correctly reaches) never rendered the Market Map at all -- not even
// its own "Validation Needed" box -- while ReportPdfButton.tsx's and
// Planner.tsx's OWN PDF drawer already correctly drew it (in its own
// Validation Needed state, since a names-only row carries no
// category/position signal) in the equivalent branch. Fixed by rendering
// <MarketMap> there too, using vendor-only pseudo-rows -- this fabricates
// nothing: MarketMap's own placement inference requires a category/
// position/strengths/weaknesses signal, none of which exist for a
// names-only vendor, so it naturally falls into its own honest
// "Validation Needed" state exactly as this ticket permits ("Market Map
// may still remain 'Validation Needed' if reliable two-axis positioning
// cannot be established").
//
// Nothing is fabricated, and no vendor name is special-cased: every
// assertion below reuses a DIFFERENT, generic vendor list than the real
// report's, to prove the fix is pattern-based, not a hardcoded fix for
// Ironclad/Evisort/DocuSign CLM/LawGeex specifically.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");

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
  while (source[i] !== "{") {
    i += 1;
  }

  let braceDepth = 0;
  do {
    if (source[i] === "{") braceDepth += 1;
    else if (source[i] === "}") braceDepth -= 1;
    i += 1;
  } while (braceDepth > 0);

  return source.slice(start, i);
}

async function compileNamesOnlyExtractor(source, plausibilityFnName) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-real-report-recovery-"));
  const outPath = join(dir, "names-only.mts");
  const harness = `
${extractFunctionSource(source, plausibilityFnName)}

${extractFunctionSource(source, "extractMarketIntelligenceCompetitorNamesOnly")}

export { extractMarketIntelligenceCompetitorNamesOnly };
`;
  writeFileSync(outPath, harness);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractMarketIntelligenceCompetitorNamesOnly;
}

async function compileCompetitorRowsExtractor(source, plausibilityFnName) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-real-report-recovery-rows-"));
  const outPath = join(dir, "rows.mts");
  const harness = `
${extractFunctionSource(source, plausibilityFnName)}

${extractFunctionSource(source, "extractFlattenedMarketIntelligenceCompetitorRows")}

${extractFunctionSource(source, "extractMarketIntelligenceCompetitorRowsFromMajorPlayers")}

${extractFunctionSource(source, "extractMarketIntelligenceCompetitorRowsFromTable")}

${extractFunctionSource(source, "extractMarketIntelligenceCompetitorRows")}

export { extractMarketIntelligenceCompetitorRows };
`;
  writeFileSync(outPath, harness);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractMarketIntelligenceCompetitorRows;
}

const surfaces = [
  { label: "page.tsx", source: pageSource, plausibilityFnName: "isImplausibleCompetitorNameOnScreen" },
  { label: "ReportPdfButton.tsx", source: pdfButtonSource, plausibilityFnName: "isImplausibleCompetitorNamePdf" },
  { label: "Planner.tsx", source: plannerSource, plausibilityFnName: "isImplausibleCompetitorNameOnScreen" },
];

// A different, generic vendor list (deliberately NOT the real report's
// Ironclad/Evisort/DocuSign CLM/LawGeex) in the exact same shape that
// broke production: an intro clause ending in a colon, immediately
// followed by the name list, with no predicate trigger word before it and
// no "are/is ... competitors" clause after it.
const colonLeadingRegistryProse =
  "Only evidence-supported major players in the supplied registry: Meridian Ledger, Northwind Analytics, and Cobalt Fintech.";

test("THE EXACT FAILURE SHAPE (Task #14): a colon-introduced Major Players vendor list, with no predicate trigger word and no trailing 'are/is ... competitors' clause, recovers all real vendor names -- in all three surfaces", async () => {
  for (const { label, source, plausibilityFnName } of surfaces) {
    const fn = await compileNamesOnlyExtractor(source, plausibilityFnName);
    const names = fn(colonLeadingRegistryProse);
    assert.deepEqual(
      names,
      ["Meridian Ledger", "Northwind Analytics", "Cobalt Fintech"],
      `${label}: expected all 3 real vendor names recovered from the colon-leading shape, got ${JSON.stringify(names)}`
    );
  }
});

test("end-to-end fixture reproducing the exact reported production shape: Competitive Landscape's OWN structured extraction finds zero rows for this content, confirming the fixture genuinely starts from the broken 'initially empty/unusable' state before recovery", async () => {
  for (const { source, plausibilityFnName } of surfaces) {
    const extractRows = await compileCompetitorRowsExtractor(source, plausibilityFnName);
    // No markdown table, no flattened bullets in Competitive Landscape's
    // own content; Major Players' content is free prose, not the
    // deterministic bulleted format -- every structured tier correctly
    // finds nothing here, which is exactly why recovery must go through
    // the names-only prose tier this fix repairs.
    assert.deepEqual(extractRows("", colonLeadingRegistryProse), []);
  }
});

test("regression guard: the colon-leading tier does not weaken evidence standards -- an unrelated colon (e.g. a 'Confidence:' value line) with no real vendor names still yields zero, in all three surfaces", async () => {
  const content =
    "Confidence: 82/100 High. No named vendors could be independently verified as direct competitors in this specific segment.";

  for (const { label, source, plausibilityFnName } of surfaces) {
    const fn = await compileNamesOnlyExtractor(source, plausibilityFnName);
    const names = fn(content);
    assert.deepEqual(names, [], `${label}: expected zero names fabricated, got ${JSON.stringify(names)}`);
  }
});

test("regression guard: a colon-introduced list that continues into further prose past the names (not the last thing in the sentence) is NOT truncated into a partial, misleading capture -- it simply does not match this tier, in all three surfaces", async () => {
  const content =
    "Note: Meridian Ledger, Northwind Analytics, and Cobalt Fintech are frequently mentioned but evidence quality varies significantly by source and region across the several distinct markets this report also touches on.";

  for (const { source, plausibilityFnName } of surfaces) {
    const fn = await compileNamesOnlyExtractor(source, plausibilityFnName);
    const names = fn(content);
    // Neither the colon-leading tier (the list isn't the last thing in
    // the sentence) nor the subject-leading tier (too much text between
    // the list and any competitor-descriptor noun) should fire here --
    // under-extraction in this ambiguous case is the accepted, pre-
    // existing risk profile; silently truncating into a partial vendor
    // list would be worse.
    assert.deepEqual(names, []);
  }
});

test("no regression: the pre-existing predicate-leading and subject-leading tiers (Task #12) still work exactly as before, in all three surfaces", async () => {
  for (const { source, plausibilityFnName } of surfaces) {
    const fn = await compileNamesOnlyExtractor(source, plausibilityFnName);
    assert.deepEqual(
      fn("Major players in this market include Meridian Ledger, Northwind Analytics, and Cobalt Fintech."),
      ["Meridian Ledger", "Northwind Analytics", "Cobalt Fintech"]
    );
    assert.deepEqual(
      fn("Meridian Ledger, Northwind Analytics, and Cobalt Fintech are established competitors in this space."),
      ["Meridian Ledger", "Northwind Analytics", "Cobalt Fintech"]
    );
  }
});

test("no special-casing: the fix is a generic colon-leading pattern, not a hardcoded list of the real report's four vendor names, in all three surfaces", () => {
  for (const source of [pageSource, pdfButtonSource, plannerSource]) {
    // The real report's vendor names appear only in this fix's own
    // explanatory comments (documenting the exact production shape that
    // broke, per this codebase's established convention) -- never as a
    // literal string comparison or hardcoded list in actual executable
    // code. Confirmed generic behavior against a DIFFERENT vendor list is
    // covered by the tests above; this test only checks no code path
    // singles out these specific names.
    assert.doesNotMatch(source, /===\s*"Ironclad"|\[\s*"Ironclad"/);
    assert.doesNotMatch(source, /===\s*"DocuSign CLM"|\[\s*"DocuSign CLM"/);
    assert.doesNotMatch(source, /===\s*"LawGeex"|\[\s*"LawGeex"/);
    assert.match(
      source,
      /const colonLeadingMatch = proseWithoutUrls\.match\(new RegExp\(`:\\\\s\*\$\{nameListGroup\}\\\\s\*\(\?:\[\.\\\\n\]\|\$\)`\)\);/,
      "expected the generic colon-leading tier to be present"
    );
    assert.match(
      source,
      /const listMatch = predicateLeadingMatch \|\| subjectLeadingMatch \|\| colonLeadingMatch;/
    );
  }
});

test("web/PDF drift fix: the on-screen 'Relevant Players Identified' compact card now renders the Market Map (vendor-only pseudo-rows, never fabricating a position), matching what ReportPdfButton.tsx's and Planner.tsx's own PDF drawer already did in the equivalent branch, in page.tsx and Planner.tsx", () => {
  for (const source of [pageSource, plannerSource]) {
    // Confirms the names-only card's own container still exists (so the
    // MarketMap assertion below is checked against the right branch, not
    // some unrelated part of the file).
    assert.match(source, /Relevant Players Identified — Detailed Comparison Requires Validation/);

    assert.match(
      source,
      /<MarketMap\s*\n\s*rows=\{namesOnly\.map\(\(name\) => \(\{\s*\n\s*vendor: name,\s*\n\s*category: "",\s*\n\s*position: "",\s*\n\s*strengths: "",\s*\n\s*weaknesses: "",\s*\n\s*\}\)\)\}\s*\n\s*\/>/,
      "expected MarketMap to be rendered with vendor-only pseudo-rows in the names-only card"
    );
  }
});

test("drift check: ReportPdfButton.tsx's and Planner.tsx's PDF drawer already correctly called drawMarketMap in the equivalent names-only/compact branch before this fix -- confirms the drift was web-only, and guards against it ever being removed from the PDF path", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /if \(namesLayout\) \{\s*\n\s*drawMarketMap\(visualY \+ namesLayout\.totalHeight \+ marketMapGap\);/);
  }
});
