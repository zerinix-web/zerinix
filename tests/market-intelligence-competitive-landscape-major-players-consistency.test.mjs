import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// TASK #12 (issue #2) -- Competitive Landscape claimed "No competitor data
// could be validated for this market yet." while Major Players, in the
// SAME report, plainly named four real, evidence-supported vendors
// (Ironclad, Evisort, DocuSign CLM, LawGeex).
//
// ROOT CAUSE (confirmed via direct reproduction against the exact reported
// shape): extractMarketIntelligenceCompetitorRows correctly found zero
// structured rows (no table, no bullets in this report's content -- the
// deterministic graph splice wasn't applied, so Major Players was plain
// model prose). The pipeline's own designed fallback for exactly this case,
// extractMarketIntelligenceCompetitorNamesOnly, has a SECOND extraction
// tier for unbulleted prose -- but that tier's only pattern required a
// PREDICATE-leading trigger word immediately before the name list
// ("include X, Y, Z" / "such as X, Y, Z"). The model wrote the names in the
// equally common SUBJECT-leading form ("Ironclad, Evisort, DocuSign CLM,
// and LawGeex are established competitors in this space"), which the old
// pattern never matched -- so this tier also returned zero names despite
// four real, well-formed, plausible vendor names sitting in plain sight,
// and the UI fell all the way through to the flat "no competitor data
// validated" state instead of at least the compact "Relevant Players
// Identified" card.
//
// FIX: added a second sub-pattern (reusing the exact same name-list
// capture group) that matches the name list immediately followed by
// "are/is (adjective) competitors/players/vendors/...", plus extended the
// existing predicate-leading pattern with "led by/dominated by/anchored
// by" (an equally common predicate-leading construction). Also fixed a
// secondary bug: a name at the end of a captured list could swallow the
// sentence's own trailing period. Mirrored identically across page.tsx,
// ReportPdfButton.tsx, and Planner.tsx (each has its own duplicate of this
// function). Nothing is fabricated: every extracted name was already
// present, verbatim, in the report's own Major Players text.

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
  const dir = mkdtempSync(join(tmpdir(), "zerinix-competitor-names-only-"));
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

const surfaces = [
  { label: "page.tsx", source: pageSource, plausibilityFnName: "isImplausibleCompetitorNameOnScreen" },
  { label: "ReportPdfButton.tsx", source: pdfButtonSource, plausibilityFnName: "isImplausibleCompetitorNamePdf" },
  { label: "Planner.tsx", source: plannerSource, plausibilityFnName: "isImplausibleCompetitorNameOnScreen" },
];

test("the exact reported production defect: subject-leading Major Players prose ('X, Y, and Z are established competitors') now extracts all real vendor names, in all three surfaces", async () => {
  const content =
    "Ironclad, Evisort, DocuSign CLM, and LawGeex are established competitors in this space, each offering contract lifecycle management capabilities.";

  for (const { label, source, plausibilityFnName } of surfaces) {
    const fn = await compileNamesOnlyExtractor(source, plausibilityFnName);
    const names = fn(content);
    assert.deepEqual(
      names,
      ["Ironclad", "Evisort", "DocuSign CLM", "LawGeex"],
      `${label}: expected all 4 real vendor names to be extracted, got ${JSON.stringify(names)}`
    );
  }
});

test("a 'led by'/'dominated by' predicate-leading variant is also extracted, in all three surfaces", async () => {
  const content =
    "The competitive set is led by Ironclad, Evisort, DocuSign CLM, and LawGeex, all of which offer contract lifecycle management.";

  for (const { label, source, plausibilityFnName } of surfaces) {
    const fn = await compileNamesOnlyExtractor(source, plausibilityFnName);
    const names = fn(content);
    assert.deepEqual(
      names,
      ["Ironclad", "Evisort", "DocuSign CLM", "LawGeex"],
      `${label}: expected all 4 real vendor names to be extracted via 'led by', got ${JSON.stringify(names)}`
    );
  }
});

test("no regression: the original predicate-leading pattern ('include X, Y, Z') still works, in all three surfaces", async () => {
  const content = "Major players in this market include Ironclad, Evisort, DocuSign CLM, and LawGeex.";

  for (const { label, source, plausibilityFnName } of surfaces) {
    const fn = await compileNamesOnlyExtractor(source, plausibilityFnName);
    const names = fn(content);
    assert.deepEqual(
      names,
      ["Ironclad", "Evisort", "DocuSign CLM", "LawGeex"],
      `${label}: expected the pre-existing predicate-leading pattern to still work, got ${JSON.stringify(names)}`
    );
  }
});

test("the trailing-period bug is fixed: a name at the very end of a captured list no longer swallows the sentence's own trailing period", async () => {
  const content = "Ironclad and LawGeex are leading vendors.";

  for (const { source, plausibilityFnName } of surfaces) {
    const fn = await compileNamesOnlyExtractor(source, plausibilityFnName);
    const names = fn(content);
    assert.ok(names.includes("LawGeex"), `expected "LawGeex" without a trailing period, got ${JSON.stringify(names)}`);
    assert.ok(!names.includes("LawGeex."), `"LawGeex." with a stray trailing period must not appear, got ${JSON.stringify(names)}`);
  }
});

test("no evidence-standard weakening, regression guard: ordinary prose naming no real vendors still extracts zero names, in all three surfaces", async () => {
  const content =
    "This market shows strong evidence of growth. The regulatory landscape is evolving rapidly, and buyer sentiment remains cautious.";

  for (const { label, source, plausibilityFnName } of surfaces) {
    const fn = await compileNamesOnlyExtractor(source, plausibilityFnName);
    const names = fn(content);
    assert.deepEqual(names, [], `${label}: expected zero names to be fabricated from vendor-free prose, got ${JSON.stringify(names)}`);
  }
});

test("no evidence-standard weakening, regression guard: the bulleted tier still takes priority over the subject-leading prose tier when both could technically apply", async () => {
  const content =
    "- Ironclad (Contract Lifecycle Management): Strong enterprise presence.\n- Evisort (AI Contract Analysis): Growing mid-market share.\n\nOther vendors such as Acme Corp and Beta Inc are not established competitors in this space.";

  for (const { source, plausibilityFnName } of surfaces) {
    const fn = await compileNamesOnlyExtractor(source, plausibilityFnName);
    const names = fn(content);
    // The bulleted tier already found real names, so the prose fallback
    // tier (which would otherwise also match "Acme Corp and Beta Inc")
    // must never run at all.
    assert.deepEqual(names, ["Ironclad", "Evisort"]);
  }
});

test("source drift check: all three surfaces have the identical subject-leading name-list extraction tier (name list immediately followed by 'are/is ... competitors/players/vendors/...')", () => {
  for (const source of [pageSource, pdfButtonSource, plannerSource]) {
    assert.match(
      source,
      /led by\|dominated by\|anchored by/,
      "the predicate-leading trigger words must be extended with 'led by'/'dominated by'/'anchored by'"
    );
    assert.match(source, /const subjectLeadingMatch = proseWithoutUrls\.match\(/);
    assert.match(
      source,
      /competitors\?\|players\?\|vendors\?\|providers\?\|companies\|solutions\?\|options\?/,
      "the subject-leading pattern must recognize the common competitor-describing nouns"
    );
    assert.match(
      source,
      /\.replace\(\/\\\.\$\/, ""\)/,
      "the trailing-period fix must be present"
    );
  }
});
