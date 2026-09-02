import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #43A -- Task #43's fix passed its own tests, but real PDF
// verification found TWO further, genuinely different truncation
// mechanisms Task #43 never touched:
//
// 1. OWNER (and Budget/Success Metric/Activity/Evidence Tie) resolved
//    to a value cut mid-abbreviation: "Owner: Head of BD (U.S.
//    mid-market); ..." resolved to "Head of BD (U.S" instead of the
//    complete value. Root cause: each of these fields' own regex
//    terminator, `(?:;|\.\s|\.$|$)`, treats ANY period followed by
//    whitespace as "the field's own end" -- with no concept that
//    "U.S." is a known abbreviation, not a real end-of-value period.
//    This is a DIFFERENT bug class from Task #42/#42A's decimal-point
//    problem: it is a real extraction-regex defect (this text was
//    never even passed to the PDF layout/wrapping engine Task #43
//    fixed -- it was already wrong by the time extractRecommendation-
//    Signals returned it).
//
// 2. Porter's Five Forces card text ended mid-sentence ("...need for",
//    "...go-to-market cost;") with NO ellipsis at all -- unlike the
//    "$1." truncation, this is wrapped lines being SILENTLY DROPPED
//    (`.slice(0, 2)`) inside a card whose height (`forceCardHeight`,
//    `forceCardSpacing`) was a FIXED constant (14/16) never adjusted
//    for how many lines a force's real sentence actually needed. Task
//    #43 fixed Strategic Recommendations' identical class of bug but
//    never audited Porter's Five Forces, a completely separate code
//    path.
//
// FIXES:
// 1. extractRecommendationSignals now runs its 5 label-based fields
//    (Budget/Success Metric/Owner/Activity/Evidence Tie) against a
//    copy of the line with every known abbreviation's periods
//    protected (protectSentenceAbbreviations/restoreSentenceAbbreviations
//    -- this file's own pre-existing, already-used fix for the
//    identical problem in splitSentences), so "U.S." can never
//    satisfy the field's own end-of-value terminator.
// 2. getPorterLayout (new, shared by both files' height-budgeting and
//    drawing call sites, mirroring computeRecommendationCardLayout's
//    own pattern) measures each force's REAL wrapped line count and
//    sizes forceCardHeight/forceCardSpacing from the real max across
//    all 5 forces, instead of a fixed 14/16 with a `.slice(0, 2)` that
//    silently dropped anything past line 2.

const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");

// --- PART 1: Owner/Budget/Success Metric/Activity/Evidence Tie -------

test("TASK #43A: the exact reported defect -- 'Owner: Head of BD (U.S. mid-market); Budget cap: USD 60,000' -- resolves Owner to the COMPLETE value, never 'Head of BD (U.S'", () => {
  const signals = extractRecommendationSignals(
    "Owner: Head of BD (U.S. mid-market); Budget cap: USD 60,000; Success criterion: 3 signed pilot LOIs within 90 days."
  );
  assert.equal(signals.owner, "Head of BD (U.S. mid-market)");
  assert.notEqual(signals.owner, "Head of BD (U.S");
  assert.doesNotMatch(signals.owner, /\(U\.S$/);
});

test("TASK #43A: an abbreviation embedded in Budget/Success Metric/Activity/Evidence Tie is equally protected -- not an Owner-only patch", () => {
  const signals = extractRecommendationSignals(
    "Activity: Benchmark against U.K. and E.U. competitor pricing; Evidence Tie: Validated via Acme Inc. trade data; Budget cap: USD 40,000; Success criterion: at least one signed U.S. mid-market reference customer within 6 months."
  );
  assert.equal(signals.activity, "Benchmark against U.K. and E.U. competitor pricing");
  assert.match(signals.evidenceTie, /Validated via Acme Inc\. trade data$/);
  assert.match(signals.metric, /U\.S\. mid-market reference customer within 6 months\.?$/);
});

test("TASK #43A (no regression): a field with NO abbreviation still terminates at its own real end-of-value boundary, never over-extending into the next field", () => {
  const signals = extractRecommendationSignals(
    "Owner: Head of Sales; Budget cap: USD 75,000; Success criterion: 20% pilot conversion rate."
  );
  assert.equal(signals.owner, "Head of Sales");
  assert.equal(signals.budget, "USD 75,000");
  assert.equal(signals.metric, "20% pilot conversion rate");
});

test("TASK #43A (no regression): a genuine sentence-ending period immediately after an abbreviation still correctly ends the value (abbreviation protection must not swallow a real terminator two periods later)", () => {
  const signals = extractRecommendationSignals("Owner: Head of BD (U.S.); Budget cap: USD 50,000.");
  assert.equal(signals.owner, "Head of BD (U.S.)");
});

// --- PART 2: Porter's Five Forces card clipping -----------------------

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

function extractConstArrowFunctionSource(source, name) {
  const startMatch = source.match(new RegExp(`const ${name} = \\(`));
  assert.ok(startMatch, `${name} not found`);
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
  if (source[i] === ";") i += 1;
  return source.slice(start, i);
}

async function compileGetPorterLayout(source, fileLabel, { needsWrapPdfText }) {
  const pieces = [
    "import { jsPDF } from \"jspdf\";",
    "import { localizePdfPresentationText } from \"/Users/iyslv/Desktop/zerinix/app/lib/pdf-normalization.mjs\";",
    needsWrapPdfText
      ? "import { wrapPdfText as wrapPdfTextWithEngine } from \"/Users/iyslv/Desktop/zerinix/app/lib/pdf-engine/utils.ts\";"
      : "",
    "const pdf = new jsPDF();",
    "const pdfLocale = \"en\";",
    needsWrapPdfText
      ? "const wrapPdfText = (text, width) => wrapPdfTextWithEngine({ pdf, text, width, normalizeText: (v) => v });"
      : "",
    extractConstSource(source, "forceAliases"),
    extractFunctionSource(source, "extractForceIntensity"),
    extractFunctionSource(source, "extractForceImplication"),
    (() => {
      const match = source.match(/const porterForceNames = (\[[^\]]*\]);/);
      assert.ok(match, `${fileLabel}: porterForceNames not found`);
      return `const porterForceNames = ${match[1]};`;
    })(),
    `const porterForceCardGap = ${source.match(/const porterForceCardGap = (\d+(?:\.\d+)?);/)[1]};`,
    `const porterImplicationLineHeight = ${source.match(/const porterImplicationLineHeight = (\d+(?:\.\d+)?);/)[1]};`,
    extractConstArrowFunctionSource(source, "getPorterLayout").replace(
      "const getPorterLayout = ",
      "export const getPorterLayout = "
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  const dir = mkdtempSync(join(new URL("..", import.meta.url).pathname, `.zerinix-porter-layout-test-${fileLabel.replace(/[^\w]/g, "")}-`));
  const outPath = join(dir, "porterLayout.ts");
  writeFileSync(outPath, pieces);
  try {
    const mod = await import(pathToFileURL(outPath).href);
    return mod.getPorterLayout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cardSources = [
  ["ReportPdfButton.tsx", pdfButtonSource, { needsWrapPdfText: true }],
  ["Planner.tsx", plannerSource, { needsWrapPdfText: false }],
];

for (const [fileLabel, source, options] of cardSources) {
  test(`TASK #43A [${fileLabel}]: getPorterLayout never drops a force's wrapped lines silently -- a long real force sentence (needing 3+ lines) is fully represented across the returned lines, not cut at line 2`, async () => {
    const getPorterLayout = await compileGetPorterLayout(source, fileLabel, options);

    // A realistic long Rivalry sentence, long enough to need 3+ wrapped
    // lines at this card's narrow width -- shaped like the real reported
    // defect ("...need for"), which is exactly what a naturally long,
    // complete investor-interpretation sentence looks like mid-sentence.
    const longSentence =
      "Rivalry -- High: dense field of well-capitalized incumbents and fast-moving new entrants competing aggressively on price and feature velocity, creating sustained need for continuous differentiation and defensible retention mechanics across every named segment.";
    const content = `${longSentence}\nEntrants -- Moderate: barriers to entry are real but surmountable.\nBuyer power -- High: buyers can switch vendors at low cost.\nSupplier power -- Low: vendors can be readily substituted.\nSubstitutes -- Moderate: threat of substitutes is credible.`;

    const layout = getPorterLayout(content, 180);
    const rivalry = layout.forces.find((f) => f.force === "Rivalry");
    assert.ok(rivalry, "expected a Rivalry entry");
    assert.ok(rivalry.lines.length > 2, `expected this long sentence to need more than 2 lines, got ${rivalry.lines.length}`);

    const rejoined = rivalry.lines.join(" ");
    assert.match(rejoined, /need for continuous differentiation/, "the real ending must survive -- never cut at '...need for'");
    assert.match(rejoined, /defensible retention mechanics/, "the sentence's true end must be present");

    // The card must have grown to fit -- never still the original fixed
    // 14mm that only ever fit 2 lines.
    assert.ok(layout.forceCardHeight > 14, `expected forceCardHeight to grow past 14 for a ${rivalry.lines.length}-line sentence, got ${layout.forceCardHeight}`);
  });

  test(`TASK #43A [${fileLabel}]: getPorterLayout keeps the ORIGINAL 14/16 geometry when every force's sentence still fits in 2 lines (no visual regression for the common case)`, async () => {
    const getPorterLayout = await compileGetPorterLayout(source, fileLabel, options);
    const content =
      "Rivalry -- High: intense competition among incumbents.\nEntrants -- Moderate: some barriers to entry exist.\nBuyer power -- High: buyers can switch vendors.\nSupplier power -- Low: vendors are substitutable.\nSubstitutes -- Moderate: some substitute risk.";

    const layout = getPorterLayout(content, 180);
    assert.equal(layout.forceCardHeight, 14);
    assert.equal(layout.forceCardSpacing, 16);
    assert.equal(layout.totalHeight, 80);
  });

  test(`TASK #43A [${fileLabel}]: a force with no discussion at all still resolves safely (empty lines, minimum card height) -- never fabricated content`, async () => {
    const getPorterLayout = await compileGetPorterLayout(source, fileLabel, options);
    const layout = getPorterLayout("Nothing about competitive forces here.", 180);
    for (const entry of layout.forces) {
      assert.equal(entry.implication, "");
      assert.deepEqual(entry.lines, []);
    }
    assert.equal(layout.forceCardHeight, 14);
  });
}

// --- STRUCTURAL AUDIT: the old silent line-drop is gone, shared layout used ---

for (const [fileLabel, source] of [
  ["ReportPdfButton.tsx", pdfButtonSource],
  ["Planner.tsx", plannerSource],
]) {
  test(`STRUCTURAL AUDIT [${fileLabel}]: getPorterLayout is called exactly twice (height-budgeting + drawing), so the two can never disagree about how tall a Porter's Five Forces card needs to be`, () => {
    const occurrences = source.match(/getPorterLayout\(/g) || [];
    // 3 = the 2 call sites + the function's own declaration
    // ("const getPorterLayout = (...) => {" also contains the literal
    // substring "getPorterLayout(" once via the const-arrow-function
    // pattern match below being separate); count call sites precisely.
    const callSites = (source.match(/= getPorterLayout\(|return getPorterLayout\(/g) || []).length;
    assert.equal(callSites, 2, `${fileLabel}: expected exactly 2 getPorterLayout call sites, found ${callSites} (occurrences incl. declaration: ${occurrences.length})`);
  });

  test(`STRUCTURAL AUDIT [${fileLabel}]: no remaining fixed forceCardHeight = 14 / forceCardSpacing = 16 literal assignment in the Porter's Five Forces drawing branch (the old fixed-height defect)`, () => {
    assert.doesNotMatch(source, /const forceCardHeight = 14;/, `${fileLabel}: fixed forceCardHeight must be removed`);
    assert.doesNotMatch(source, /const forceCardSpacing = 16;/, `${fileLabel}: fixed forceCardSpacing must be removed`);
  });

  test(`STRUCTURAL AUDIT [${fileLabel}]: the Porter's Five Forces implication text is no longer sliced to a hard 2-line cap with no ellipsis`, () => {
    // The vulnerable shape: wrap(...).slice(0, 2) with nothing appended.
    // getPorterLayout's own cap is `.slice(0, 4)` (a generous safety
    // bound, not a 2-line visual cap tuned to the old fixed card).
    assert.doesNotMatch(source, /\.slice\(0, 2\)\s*;\s*\n\s*pdf\.text\(implicationLines/, `${fileLabel}: the old 2-line implication cap must be gone`);
    assert.match(source, /\.slice\(0, 4\)/, `${fileLabel}: expected getPorterLayout's own generous 4-line safety cap`);
  });
}

test("WEB/PDF PARITY: both files define the SAME porterImplicationLineHeight/porterForceCardGap constants, so neither PDF code path can grow a Porter card by a different amount for the same content", () => {
  for (const [name, source] of [
    ["ReportPdfButton.tsx", pdfButtonSource],
    ["Planner.tsx", plannerSource],
  ]) {
    assert.match(source, /const porterForceCardGap = 2;/, `${name}: expected porterForceCardGap = 2`);
    assert.match(source, /const porterImplicationLineHeight = 3\.2;/, `${name}: expected porterImplicationLineHeight = 3.2`);
  }
});

// --- DRIFT CHECK ---

test("DRIFT CHECK (requirement 9): decision/evidence/confidence methodology, TAM/SAM/SOM logic, and Porter's own evidence-citation color signal are untouched -- this fix only changes how much vertical space a card reserves and how many lines are drawn, never what is classified or computed", () => {
  for (const [name, source] of [
    ["ReportPdfButton.tsx", pdfButtonSource],
    ["Planner.tsx", plannerSource],
  ]) {
    assert.match(source, /extractForceIntensity\(content, force\)\?\.\w+ \?\? 0|extractForceIntensity\(section\.content, force\)\?\.\w+ \?\? 0/, `${name}: force intensity derivation must be unchanged`);
  }
});
