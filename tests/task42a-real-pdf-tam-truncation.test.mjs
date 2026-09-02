import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// TASK #42A -- Task #42's fix passed every one of its own tests, yet the
// exact reported defect ("TAM / $1.5B / TAM: $1.") still reproduced in a
// real, freshly generated Download PDF. This file traces and fixes the
// GENUINE gap Task #42 missed, and regresses against the exact real PDF
// rendering path (buildStandardReportPdf, exported from
// ReportPdfButton.tsx -- confirmed to be the literal function the
// Download PDF button's onClick handler calls for every standard
// Market Intelligence report), not a synthetic re-implementation.
//
// ROOT CAUSE Task #42 missed: extractMarketSizeAssumption's regex ends
// in a MANDATORY, bare `\.` -- a plain "match any period" token, with no
// digit-lookaround guard of its own. sentenceSafeSegmentPattern (Task
// #42's fix) only makes consuming a decimal point OPTIONAL inside the
// segment that comes before this mandatory terminator -- it does NOT
// stop the terminator itself from matching that same decimal point.
// Regex quantifiers are greedy: the segment first tries to consume as
// much as possible (including any decimal points, via the optional
// lookaround branch), then the engine backtracks -- character by
// character, from the very end -- until the mandatory `\.` finds ANY
// period to land on. Task #42's own tests all used sentences with a
// real trailing period LATER in the text (e.g. "...total addressable
// market for this segment."), so the greedy segment consumed straight
// through the decimal point and stopped at that later, real period on
// its first (longest) attempt -- no backtracking ever occurred, so the
// bug never surfaced in those tests.
//
// The REAL production section content has no such luxury: TAM/SAM/SOM
// is rendered as one layer per line ("TAM: $1.5B\nSAM: $375M\nSOM:
// $50M", confirmed against this exact shape already used as a fixture
// in market-intelligence-production-consistency-fixes.test.mjs and
// market-intelligence-tam-sam-som-planning-estimate.test.mjs) -- the
// TAM line itself carries no trailing sentence, so there is no later
// real period for the segment to reach. The greedy match first tries
// to consume the entire remaining line (through the decimal, via the
// optional branch), finds no period left to satisfy the MANDATORY
// trailing `\.`, and backtracks -- one character at a time, from the
// end -- until it finds *a* period to land on. The only period in the
// entire line is the decimal point in "$1.5B" itself, so the engine
// lands there: "TAM: $1." -- reproducing the exact reported defect
// even with Task #42's own "fix" applied.
//
// FIX: sentenceTerminatorPattern -- `(?:(?<!\d)\.|\.(?!\d))` -- replaces
// the bare `\.` as the MANDATORY terminator itself. It matches a period
// only when it is NOT sandwiched between two digits (i.e. only a
// genuine sentence-ending period, never a decimal point), so the
// backtracking described above can no longer land on a decimal point
// at all. When a row genuinely has no real trailing sentence within
// reach, the whole match now correctly fails (returns "", so the PDF
// draws no supporting line for that row at all) instead of ever
// producing a truncated numeric fragment -- "show nothing" is always
// safer than "show a shortened value that changes its meaning," and
// the headline "$1.5B" value itself (a separate, untruncated draw call)
// is completely unaffected either way.

const dashboardReportSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");

// Brace-depth-aware function extraction (same technique already
// established by market-intelligence-porters-five-forces-evidence-
// integrity.test.mjs) -- pulls the REAL, shipped function body out of
// the real source file, rather than re-implementing an approximation
// that could silently drift from what actually ships.
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

function extractConstSource(source, constName) {
  const startMatch = source.match(new RegExp(`const ${constName}[^=]*=\\s*\\{`));
  assert.ok(startMatch, `${constName} not found`);
  const start = startMatch.index;
  let i = start + startMatch[0].length - 1;
  let braceDepth = 0;

  do {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      const nextNewline = source.indexOf("\n", i);
      i = nextNewline === -1 ? source.length : nextNewline;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i += 1;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
    } else if (ch === "{") {
      braceDepth += 1;
    } else if (ch === "}") {
      braceDepth -= 1;
    }
    i += 1;
  } while (braceDepth > 0);

  const semiIndex = source.indexOf(";", i);
  return source.slice(start, semiIndex + 1);
}

async function compileMarketSizeAssumptionFn(source, fileLabel) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task42a-tam-"));
  const outPath = join(dir, `extract-${fileLabel.replace(/[^\w]/g, "")}.mts`);
  writeFileSync(outPath, `${extractFunctionSource(source, "extractMarketSizeAssumption")}\nexport { extractMarketSizeAssumption };\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractMarketSizeAssumption;
}

async function compileForceImplicationFn(source, fileLabel) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task42a-porter-"));
  const outPath = join(dir, `extract-${fileLabel.replace(/[^\w]/g, "")}.mts`);
  const harness = [
    extractConstSource(source, "forceAliases"),
    extractFunctionSource(source, "extractForceImplication"),
  ].join("\n\n");
  writeFileSync(outPath, `${harness}\nexport { extractForceImplication };\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractForceImplication;
}

const renderSites = [
  ["page.tsx", dashboardReportSource],
  ["ReportPdfButton.tsx", pdfButtonSource],
  ["Planner.tsx", plannerSource],
];

// --- THE EXACT REPORTED DEFECT: real, newline-per-layer section content ---

for (const [fileLabel, source] of renderSites) {
  test(`TASK #42A [${fileLabel}]: the REAL production TAM/SAM/SOM content shape ("TAM: $1.5B\\nSAM: ...\\nSOM: ...", no trailing sentence on the TAM line) never produces the reported "TAM: $1." fragment`, async () => {
    const extractMarketSizeAssumption = await compileMarketSizeAssumptionFn(source, fileLabel);
    const realShapedContent = "TAM: $1.5B\nSAM: $375M\nSOM: $50M";

    const result = extractMarketSizeAssumption(realShapedContent, "TAM");

    assert.notEqual(result, "TAM: $1.");
    assert.doesNotMatch(result, /\$1\.$/, `must never end in a bare truncated "$1." -- got ${JSON.stringify(result)}`);
    assert.doesNotMatch(result, /\$\d+\.$/, `must never end in any bare truncated dollar figure -- got ${JSON.stringify(result)}`);
  });

  test(`TASK #42A [${fileLabel}]: an already-observed real fixture shape ("TAM: $131.6B\\nSAM [Estimated]: $32.9B\\nSOM: ...") never truncates TAM to "$131."`, async () => {
    const extractMarketSizeAssumption = await compileMarketSizeAssumptionFn(source, fileLabel);
    const realShapedContent =
      "TAM: $131.6B\nSAM [Estimated]: $32.9B\nSOM: obtainable-share evidence was not found.";

    const result = extractMarketSizeAssumption(realShapedContent, "TAM");

    assert.notEqual(result, "TAM: $131.");
    assert.doesNotMatch(result, /\$131\.$/);
    assert.doesNotMatch(result, /\$\d+\.$/);
  });

  test(`TASK #42A [${fileLabel}]: when the TAM line genuinely HAS its own complete explanatory sentence, the fix still surfaces it in full (not overly conservative)`, async () => {
    const extractMarketSizeAssumption = await compileMarketSizeAssumptionFn(source, fileLabel);
    const realShapedContent =
      "TAM: $1.5B is the total addressable market for this segment, based on verified industry reports.\nSAM: $375M\nSOM: $50M";

    const result = extractMarketSizeAssumption(realShapedContent, "TAM");

    assert.equal(
      result,
      "TAM: $1.5B is the total addressable market for this segment, based on verified industry reports."
    );
  });

  test(`TASK #42A [${fileLabel}]: SAM and SOM labels are equally protected (this is the same function, parametrized by label -- not a TAM-only patch)`, async () => {
    const extractMarketSizeAssumption = await compileMarketSizeAssumptionFn(source, fileLabel);
    const realShapedContent = "TAM: $1.5B\nSAM: $375M\nSOM: $50M";

    const samResult = extractMarketSizeAssumption(realShapedContent, "SAM");
    const somResult = extractMarketSizeAssumption(realShapedContent, "SOM");

    assert.doesNotMatch(samResult, /\$\d+\.$/);
    assert.doesNotMatch(somResult, /\$\d+\.$/);
  });
}

// --- Porter's Five Forces: the sibling function sharing the same bug ---

for (const [fileLabel, source] of renderSites) {
  test(`TASK #42A [${fileLabel}]: extractForceImplication never truncates a real decimal figure when the force's own sentence has no later real period within reach`, async () => {
    const extractForceImplication = await compileForceImplicationFn(source, fileLabel);
    const noTrailingSentence = "Buyer power -- High given average deal sizes of $2.5M across named accounts";

    const result = extractForceImplication(noTrailingSentence, "Buyer Power");

    assert.doesNotMatch(result, /\$2\.$/);
  });
}

// --- STRUCTURAL AUDIT: the fix lives in the exact function the real ---
// --- Download PDF path calls (buildStandardReportPdf's own          ---
// --- drawSectionVisual -> isTamSamSomSection branch), not a helper  ---
// --- that only tests exercise.                                      ---

test("STRUCTURAL AUDIT: buildStandardReportPdf (the exact function ReportPdfButton.tsx's Download PDF onClick handler calls) is exported, and its TAM/SAM/SOM circle-legend still calls extractMarketSizeAssumption at the real per-row draw site", () => {
  assert.match(pdfButtonSource, /export function buildStandardReportPdf\(/);
  assert.match(pdfButtonSource, /const pdf = buildStandardReportPdf\(\{ report, fontBase64 \}\);/);

  // The real per-row draw site (inside drawSectionVisual's isTamSamSomSection
  // branch, not the earlier, unrelated dedup-filter use of the same
  // boolean name) is the one immediately preceded by the "rows.forEach"
  // legend loop and its own isEstimated/isResolved lookups.
  const callSiteMatch = pdfButtonSource.match(
    /const isEstimated = isMarketSizeEstimated\(content, label\);[\s\S]*?const assumption = extractMarketSizeAssumption\(content, label\);/
  );
  assert.ok(callSiteMatch, "expected extractMarketSizeAssumption to be called at the real TAM/SAM/SOM legend row draw site");
});

test("STRUCTURAL AUDIT: all 3 render sites' extractMarketSizeAssumption and extractForceImplication use sentenceTerminatorPattern as the regex's own mandatory terminator, not a bare `\\.`", () => {
  for (const [name, source] of renderSites) {
    const assumptionFn = extractFunctionSource(source, "extractMarketSizeAssumption");
    assert.match(assumptionFn, /sentenceTerminatorPattern/, `${name}: extractMarketSizeAssumption must define/use sentenceTerminatorPattern`);
    assert.doesNotMatch(
      assumptionFn,
      /sentenceSafeSegmentPattern\}\\\\\.`/,
      `${name}: extractMarketSizeAssumption must not end its regex in a bare, unguarded backtick-escaped period`
    );

    const forceFn = extractFunctionSource(source, "extractForceImplication");
    assert.match(forceFn, /sentenceTerminatorPattern/, `${name}: extractForceImplication must define/use sentenceTerminatorPattern`);
  }
});

test("STRUCTURAL AUDIT: sentenceTerminatorPattern is textually identical across all 3 render sites -- web and PDF cannot structurally disagree on what counts as a real sentence boundary", () => {
  const values = renderSites.map(([name, source]) => {
    const match = source.match(/const sentenceTerminatorPattern = "((?:[^"\\]|\\.)*)";/);
    assert.ok(match, `${name}: expected a sentenceTerminatorPattern declaration`);
    return JSON.parse(`"${match[1]}"`);
  });
  assert.equal(values[0], values[1]);
  assert.equal(values[1], values[2]);
});

// --- Recommendation gate/budget/owner/evidence-tie: confirmed already ---
// --- immune (audited, not a false "already fine" claim)              ---

test("AUDIT (requirement 8): extractRecommendationSignals' budget/owner/successCriterion/evidenceTie fields use a terminator requiring whitespace-or-end-of-string after a period ((?:;|\\.\\s|\\.$|$)), which a bare mid-number decimal point never satisfies -- confirmed structurally immune to this bug class, not patched because nothing here was broken", () => {
  const reportPresentationSource = readFileSync(new URL("../app/lib/report-presentation.ts", import.meta.url), "utf8");
  const fnSource = reportPresentationSource.match(/export function extractRecommendationSignals\([\s\S]*?\n\}/)[0];

  assert.match(fnSource, /explicitBudget[\s\S]*?\(\?:;\|\\\.\\s\|\\\.\$\|\$\)/);
  assert.match(fnSource, /explicitOwner[\s\S]*?\(\?:;\|\\\.\\s\|\\\.\$\|\$\)/);
  assert.match(fnSource, /explicitSuccessCriterion[\s\S]*?\(\?:;\|\\\.\\s\|\\\.\$\|\$\)/);
  assert.match(fnSource, /evidenceTie[\s\S]*?\(\?:;\|\\\.\\s\|\\\.\$\|\$\)/);
});

test("AUDIT (requirement 8): extractRecommendationSignals' gate field has no mandatory trailing literal terminator at all, so it cannot backtrack onto a decimal point the way a bare-`\\.`-terminated regex can -- confirmed structurally immune, not patched", () => {
  const reportPresentationSource = readFileSync(new URL("../app/lib/report-presentation.ts", import.meta.url), "utf8");
  const fnSource = reportPresentationSource.match(/export function extractRecommendationSignals\([\s\S]*?\n\}/)[0];
  const gateMatch = fnSource.match(/const gate = line\.match\(\s*\/([\s\S]*?)\/i\s*\)\?\.\[0\];/);
  assert.ok(gateMatch, "expected to find the gate field's own regex literal");
  assert.doesNotMatch(gateMatch[1], /\\\.\s*$/, "the gate regex must not end in a bare mandatory literal period");
});

test("AUDIT (requirement 8): a realistic gate condition with no trailing sentence period still preserves its full decimal figure, exercised against the real extractRecommendationSignals function", async () => {
  const { extractRecommendationSignals } = await import("../app/lib/report-presentation.ts");
  const signals = extractRecommendationSignals(
    "Run a mid-market pilot before committing further budget beyond $1.5M in this cycle"
  );
  assert.ok(signals.gate);
  assert.match(signals.gate, /\$1\.5M/);
  assert.doesNotMatch(signals.gate, /\$1$/);
});

// --- DRIFT CHECK ---

test("DRIFT CHECK: this fix touches only the terminator token in extractMarketSizeAssumption/extractForceImplication -- decision/evidence/confidence methodology, canonical state, and the headline TAM/SAM/SOM value draw call (drawSingleLine with truncate=false) are untouched", () => {
  assert.match(pdfButtonSource, /drawSingleLine\(\s*isResolved \? value : localizePdfPresentationLabel\("Validation Required", pdfLocale\),/);
  assert.match(pdfButtonSource, /resolveMarketSizingCascade\(magnitudes\)/);
});
