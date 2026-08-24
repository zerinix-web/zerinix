import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// FINAL PRESENTATION FIX -- premium TAM/SAM/SOM visual system cleanup.
//
// Market Intelligence reports previously showed TAM/SAM/SOM twice: the
// bars/circles visual, plus a separate always-visible insight
// snippet/paragraph repeating the same information. This closes that gap:
//
// 1. There is now only ONE primary TAM/SAM/SOM visual per surface -- the
//    duplicate ExecutiveInsightBanner/SectionTakeaway snippet (page.tsx,
//    Planner.tsx) and the duplicate PDF body-text paragraph
//    (ReportPdfButton.tsx) are gone.
// 2. The visual market sizing stack (TAM/SAM/SOM) always renders -- the
//    old whole-card "maxMagnitude === 0" early return (which replaced the
//    entire 3-layer stack with one generic dashed card) is removed from
//    both page.tsx and Planner.tsx.
// 3. When numeric data exists, each layer shows its real value, a real
//    per-layer assumption sentence (extractMarketSizeAssumption, reading
//    the layer's own generated text -- never fabricated), and a
//    confidence/validation state (EvidenceBadge, already existing).
// 4. When numeric data does not exist, each layer independently shows
//    "Validation Needed" (never a long paragraph), and the exact short
//    explanation "Additional market validation is required before sizing
//    can be confirmed." appears once, below the visual.
// 5. Detailed methodology (the full raw section paragraph) is only
//    reachable through the existing collapsed AnalysisNotes disclosure,
//    never as always-visible main-body text.
// 6. PDF matches the UI: the exported PDF's own "Additional market
//    validation is required..." wording matches the UI, and the
//    commentary/insight body paragraph is only drawn when the visual drew
//    real circles (never stacked under the same explanation twice).
//
// AI generation, calculations, validation logic, and routing are
// untouched -- confirmed via drift checks below.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

// Same balanced-bracket extractor established in
// market-intelligence-decision-report-upgrade.test.mjs -- walks past the
// balanced `(...)` parameter list first, then finds the balanced `{...}`
// function body, so a multi-line destructured/typed parameter list (whose
// own sibling braces would otherwise fool a naive brace counter or a
// non-greedy regex) is handled correctly.
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

async function compileFunction(source, functionName) {
  const raw = extractFunctionSource(source, functionName);
  const dir = mkdtempSync(join(tmpdir(), "zerinix-tam-sam-som-dedup-fn-"));
  const outPath = join(dir, `${functionName}.ts`);
  writeFileSync(outPath, `export ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod[functionName];
}

// --- 1. TAM/SAM/SOM renders once (no duplicate insight snippet) ----------

test("page.tsx: the TAM/SAM/SOM section no longer shows a duplicate ExecutiveInsightBanner/SectionTakeaway snippet above the visual", () => {
  assert.match(
    pageSource,
    /!isFinancialDashboard &&\s*\n\s*section\.field !== "tamSamSom" \? \(\s*\n\s*<ExecutiveInsightBanner/
  );
  assert.match(
    pageSource,
    /detailsContent\.trim\(\) && section\.field !== "tamSamSom" \? \(\s*\n\s*<SectionTakeaway/
  );
});

test("Planner.tsx: the TAM/SAM/SOM section no longer shows a duplicate ExecutiveInsightBanner/SectionTakeaway snippet above the visual", () => {
  assert.match(
    plannerSource,
    /section\.field !== "financialDashboard" &&\s*\n\s*section\.field !== "tamSamSom" \? \(\s*\n\s*<ExecutiveInsightBanner/
  );
  assert.match(
    plannerSource,
    /hasVisibleDetailsContent && section\.field !== "tamSamSom" \? \(\s*\n\s*<SectionTakeaway/
  );
});

test("page.tsx: mobile TAM/SAM/SOM no longer shows the full raw paragraph always-expanded next to the visual -- it moves into a collapsed AnalysisNotes disclosure", () => {
  assert.match(pageSource, /const isTamSamSomSection = section\.field === "tamSamSom";/);
  assert.match(
    pageSource,
    /isTamSamSomSection \? \(\s*\n\s*<AnalysisNotes compact label=\{getReportPresentationLabels\(section\.content\)\.details\}>/
  );
});

test("methodology stays reachable (only inside the collapsed AnalysisNotes disclosure, per this ticket's own requirement), never fully dropped", () => {
  for (const source of [pageSource, plannerSource]) {
    // AnalysisNotes must still render for tamSamSom sections (no
    // `&& section.field !== "tamSamSom"` guard on the AnalysisNotes call
    // itself) -- only the duplicate insight-snippet components are gated.
    assert.match(source, /hasVisibleDetailsContent \? \(\s*\n\s*<AnalysisNotes|detailsContent\.trim\(\) \? \(\s*\n\s*<AnalysisNotes/);
  }
});

// --- 2. Missing data uses the visual validation state, not a paragraph ---

test("page.tsx and Planner.tsx: the whole-card 'maxMagnitude === 0' early return is gone -- TAM/SAM/SOM always renders the 3-layer stack, even when every layer is missing", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.doesNotMatch(source, /if \(maxMagnitude === 0\)/);
  }
});

test("page.tsx and Planner.tsx: an unresolved layer shows 'Validation Needed' (never a long paragraph), and the exact short explanation appears once below the visual when any layer is unresolved", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /const hasUnresolvedLayer = resolved\.some\(\(isResolved\) => !isResolved\);/);
    assert.match(
      source,
      /hasUnresolvedLayer \? \(\s*\n\s*<p className="mt-5 border-t border-white\/10 pt-4 text-sm leading-6 text-zinc-400">\s*\n\s*Additional market validation is required before sizing can be confirmed\.\s*\n\s*<\/p>\s*\n\s*\) : null/
    );
  }
});

test("page.tsx: each bar independently renders its own amber 'Validation Needed' row (never a fabricated bar width) whenever that layer is not resolved -- the per-layer branch is unconditional, not gated behind the removed whole-card check", () => {
  assert.match(
    pageSource,
    /const width = isResolved && magnitude !== null \? `\$\{Math\.max\(8, \(magnitude \/ maxMagnitude\) \* 100\)\}%` : null;/
  );
  assert.match(pageSource, /\{width \? \(/);
  assert.match(pageSource, /Validation Needed\s*\n\s*<\/span>/);
});

// --- 3. Numeric data renders the visual sizing stack (values + assumptions) --

test("page.tsx: extractMarketSizeAssumption reads a real per-layer assumption sentence from the generated content, never fabricating one", async () => {
  const content =
    "TAM (Germany, 2026) ~= EUR200-800 million [Estimated], derived from the OECD benchmark using population share as the scaling assumption. SAM ~= EUR80-320 million [Estimated], the serviceable share within compliant enterprise segments. SOM ~= EUR8-32 million [Estimated], the realistic 12-month obtainable share.";

  const fn = await compileFunction(pageSource, "extractMarketSizeAssumption");
  const tamAssumption = fn(content, "TAM");
  assert.match(tamAssumption, /OECD benchmark/);
  assert.match(tamAssumption, /TAM/);

  const noSignal = fn("This section does not discuss market sizing at all.", "TAM");
  assert.equal(noSignal, "");
});

test("Planner.tsx: extractMarketSizeAssumption exists and getReportMarketRows prefers it over the generic (assumption-stripping) description extractor", () => {
  assert.match(plannerSource, /function extractMarketSizeAssumption\(content: string, label: string\)/);
  assert.match(
    plannerSource,
    /description: extractMarketSizeAssumption\(content, "TAM"\) \|\| extractMarketLevelDescription\(content, "TAM"\),/
  );
  assert.match(
    plannerSource,
    /description: extractMarketSizeAssumption\(content, "SAM"\) \|\| extractMarketLevelDescription\(content, "SAM"\),/
  );
  assert.match(
    plannerSource,
    /description: extractMarketSizeAssumption\(content, "SOM"\) \|\| extractMarketLevelDescription\(content, "SOM"\),/
  );
});

test("page.tsx: a populated layer shows only its real value plus its resolved/estimated status -- never the removed duplicate extractFirstInsight() explanation, and never an inline assumption/methodology snippet (moved to the expandable Details disclosure per this ticket's requirement 3)", () => {
  assert.doesNotMatch(pageSource, /const explanation = extractFirstInsight\(content\);/);
  assert.doesNotMatch(pageSource, /\{value && assumption \? \(/);
  assert.match(
    pageSource,
    /\{isResolved \? \(\s*\n\s*<div className="min-w-0 space-y-1 text-left sm:text-right">/
  );
});

// --- 4. PDF export does not duplicate TAM/SAM/SOM sections ----------------

test("ReportPdfButton.tsx: exactly one TAM/SAM/SOM section is ever drawn per report -- isTamSamSomPdfSection gates a single card, and the wording now matches the UI's own explanation", () => {
  const occurrences = pdfButtonSource.match(/const isTamSamSomPdfSection = section\.field === "tamSamSom"/g) || [];
  assert.equal(occurrences.length, 1);
  assert.match(pdfButtonSource, /Additional market validation is required before sizing can be confirmed\./);
  assert.doesNotMatch(pdfButtonSource, /No verified or logically nested/);
});

test("ReportPdfButton.tsx: the commentary/insight body paragraph below the TAM/SAM/SOM visual is only drawn when the visual actually drew real circles -- never stacked under the visual's own 'Additional market validation...' explanation", () => {
  assert.match(
    pdfButtonSource,
    /const tamSamSomMagnitudes = getTamRows\(getTamVisualContent\(section\.content\), section\.content\)\.map\(\(row\) =>/
  );
  assert.match(pdfButtonSource, /const isTamSamSomCoherentlyNested =/);
  assert.match(pdfButtonSource, /if \(hasBodyText && isTamSamSomCoherentlyNested\) \{/);
});

test("Planner.tsx's own downloadPdf export: the coherence-gated explanation now matches the UI's exact wording (regression guard on the deliberately separate, otherwise-untouched PDF code path)", () => {
  assert.match(
    plannerSource,
    /"Additional market validation is required before sizing can be confirmed\."/
  );
  assert.doesNotMatch(plannerSource, /No verified or logically nested/);
});

// --- 5. Preserve: AI generation, calculations, validation logic, routing --

test("AI generation logic and calculations (tamSamSom prompt, market-intelligence-graph.ts) are untouched (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /Define TAM, SAM, and SOM using explicit market boundaries/);

  const marketGraphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketGraphSource, /function buildMarketIntelligenceGraph/);
});

test("validation logic and routing are untouched by this presentation-only fix (drift check)", () => {
  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function classifyReportDomain/);

  // parseMonetaryMagnitude/parseMarketSizeMagnitude (the actual figure
  // parsing used to decide real-value vs. Validation Needed) are
  // unchanged -- same behavior as before this ticket.
  assert.match(pageSource, /function parseMonetaryMagnitude\(value: string\)/);
  assert.match(plannerSource, /function parseMarketSizeMagnitude\(value: string\)/);
});
