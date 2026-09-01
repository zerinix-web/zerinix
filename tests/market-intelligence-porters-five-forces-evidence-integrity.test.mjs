import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// TASK #19 -- Audit and harden Market Intelligence decision-critical
// claims.
//
// Focused audit of a REAL Market Intelligence report against the
// critical invariant: a report must distinguish VERIFIED FACT / DERIVED
// ESTIMATE / PLANNING ASSUMPTION / VALIDATION REQUIRED, and a planning
// assumption or unevidenced claim must never visually or semantically
// appear equivalent to a verified fact.
//
// Audited: Market Size, CAGR, TAM/SAM/SOM, Competitive Landscape, Major
// Players, Customer Segments, Barriers/Opportunities, Porter's Five
// Forces, Strategic Recommendations, Executive Summary. Most of these
// were already correctly hardened by prior tasks (#10-#18):
//   - Market Size/CAGR already route through getDashboardMetricEvidence,
//     which correctly classifies the real report's contested $1.5B
//     figure as "derived" (not a bare "verified") given the field's own
//     text names two conflicting alternative figures -- confirmed
//     correct, not a defect.
//   - TAM/SAM/SOM already shows a "Planning Estimate / Not Verified" tag
//     PLUS the real per-layer assumption sentence (e.g. SAM's "25% of
//     TAM" derivation) inline below each bar -- confirmed correct, not a
//     defect.
//   - Strategic Recommendations' budget ceilings/pilot targets/KPI
//     thresholds are PRESCRIPTIVE (proposed spending limits and goals for
//     a recommended future action), not descriptive claims about the
//     world -- they do not require VERIFIED/ESTIMATED labeling the way a
//     market-size figure does. Confirmed by design, not a defect.
//
// ONE genuine defect found: Porter's Five Forces rendered every force
// with identical visual weight regardless of evidentiary support. The
// real report's own text says, verbatim, "Supplier power -- Low-to-
// moderate: key suppliers are cloud/AI model providers (not evidenced
// directly in registry)..." right next to "Buyer power -- High...
// (buyer guides and legal ops surveys) [R23][R95]" -- two forces with
// materially different evidentiary support, presented identically, with
// no badge, color, or marker distinguishing them anywhere in web or PDF.
//
// FIX: a new evidence classifier reads each force's own already-
// extracted implication sentence (extractForceImplication's output --
// no new text is scanned) and returns "validationRequired" when that
// sentence explicitly admits it is unevidenced OR carries no visible
// citation marker at all, "benchmarkDerived" when it does cite one
// ("[R#]" or a "(R4, R5, R6)"-style reference list). Web (page.tsx,
// Planner.tsx) renders this as the existing EvidenceBadge component,
// gated to Market Intelligence only. PDF (ReportPdfButton.tsx,
// Planner.tsx's PDF drawer) recolors the existing intensity bar (amber
// for unevidenced, unchanged teal for cited) rather than adding a new
// element, avoiding any pagination/height risk -- also gated to Market
// Intelligence only, since "portersFiveForces" is a field name SHARED
// with Business Plan, which has no "[R#]" citation convention to read.

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

async function compileForceEvidenceFn(source, fnName) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-porter-evidence-"));
  const outPath = join(dir, "extract.mts");
  writeFileSync(outPath, `${extractFunctionSource(source, fnName)}\nexport { ${fnName} };\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod[fnName];
}

// Brace/string/comment-aware extraction -- a naive indexOf(";", start)
// breaks the moment a "//" comment inside the object literal itself
// contains a semicolon as ordinary punctuation (exactly what this file's
// own new Task #19 comments do), so this tracks real object nesting
// instead, skipping over line comments and string literals.
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

async function compileForceExtractionFns(source) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-porter-extraction-"));
  const outPath = join(dir, "extract.mts");
  const harness = [
    extractConstSource(source, "forceAliases"),
    extractFunctionSource(source, "extractForceIntensity"),
    extractFunctionSource(source, "extractForceImplication"),
  ].join("\n\n");
  writeFileSync(outPath, `${harness}\nexport { extractForceIntensity, extractForceImplication };\n`);
  return import(pathToFileURL(outPath).href);
}

// The EXACT real per-force sentences (report id 88a0bab9-fd65-4e76-a6f3-1fb1e5d2851e).
const realForceTexts = {
  Rivalry:
    "Rivalry — Moderate to high: multiple AI-enabled CLM vendors and convergence on AI features; implication: price and feature competition will intensify (R4, R5, R6).",
  Entrants:
    "Threat of new entry — Moderate: technological entry easier (LLMs), but procurement listings, data access, and proven accuracy raise barriers (DocuSign procurement evidence; accuracy requirements) [R3][R5].",
  "Supplier Power":
    "Supplier power — Low-to-moderate: key suppliers are cloud/AI model providers (not evidenced directly in registry) but vendors can switch models; implication: manageable cost control if models are fungible.",
  "Buyer Power":
    "Buyer power — High for mid-sized firms: buyers demand demonstrable ROI, accuracy, and procurement-friendly contracts (buyer guides and legal ops surveys) [R23][R95].",
  Substitutes:
    "Substitutes — Moderate: manual legal review and professional services remain substitutes where AI accuracy or trust is insufficient; implication: must prove accuracy to convert those spend lines.",
};

test("EXACT REAL FAILURE SHAPE: 'Supplier Power' (explicitly self-flagged as unevidenced) and 'Substitutes' (no citation at all) classify as validationRequired, while the 3 cited forces classify as benchmarkDerived, in page.tsx and Planner.tsx", async () => {
  for (const { label, source } of [
    { label: "page.tsx", source: pageSource },
    { label: "Planner.tsx", source: plannerSource },
  ]) {
    const getForceEvidenceLevel = await compileForceEvidenceFn(source, "getForceEvidenceLevel");

    assert.equal(getForceEvidenceLevel(realForceTexts.Rivalry), "benchmarkDerived", `${label}: Rivalry`);
    assert.equal(getForceEvidenceLevel(realForceTexts.Entrants), "benchmarkDerived", `${label}: Entrants`);
    assert.equal(getForceEvidenceLevel(realForceTexts["Buyer Power"]), "benchmarkDerived", `${label}: Buyer Power`);
    assert.equal(
      getForceEvidenceLevel(realForceTexts["Supplier Power"]),
      "validationRequired",
      `${label}: Supplier Power must be flagged -- its own text admits it is unevidenced`
    );
    assert.equal(
      getForceEvidenceLevel(realForceTexts.Substitutes),
      "validationRequired",
      `${label}: Substitutes must be flagged -- it carries no citation at all`
    );
  }
});

test("no fabrication: a force with no implication text at all defaults to validationRequired, never a fabricated positive classification, in page.tsx and Planner.tsx", async () => {
  for (const source of [pageSource, plannerSource]) {
    const getForceEvidenceLevel = await compileForceEvidenceFn(source, "getForceEvidenceLevel");
    assert.equal(getForceEvidenceLevel(""), "validationRequired");
  }
});

test("no over-triggering: a genuinely cited force with a different citation style ([R100], a longer reference list) still classifies as benchmarkDerived, in page.tsx and Planner.tsx", async () => {
  for (const source of [pageSource, plannerSource]) {
    const getForceEvidenceLevel = await compileForceEvidenceFn(source, "getForceEvidenceLevel");
    assert.equal(getForceEvidenceLevel("Some force text with a single citation [R100]."), "benchmarkDerived");
    assert.equal(
      getForceEvidenceLevel("Some force text citing multiple sources (R1, R2, R3, R4)."),
      "benchmarkDerived"
    );
  }
});

// SECOND DEFECT found during this same audit (not caused by the
// evidence-badge fix above -- a pre-existing bug uncovered while testing
// it against the real report end-to-end): the "Substitutes" force's own
// alias list never included the bare word "substitutes" (unlike Buyer/
// Supplier Power, which both include their own bare force name as an
// alias) -- when the model wrote its own sentence as a bare "Substitutes
// -- Moderate: ..." heading (exactly what the real report did), NEITHER
// extractForceIntensity NOR extractForceImplication could find it,
// silently showing "Not specified" and no implication sentence for real
// content the model actually generated. Fixed by adding "substitutes" to
// the alias list, mirroring the existing Buyer/Supplier precedent.
test("SECOND REAL DEFECT: 'Substitutes' written as a bare heading ('Substitutes -- Moderate: ...', the real report's exact shape) is now correctly recognized by both extractForceIntensity and extractForceImplication, in page.tsx, Planner.tsx, and ReportPdfButton.tsx", async () => {
  const realSubstitutesLine =
    "Substitutes — Moderate: manual legal review and professional services remain substitutes where AI accuracy or trust is insufficient; implication: must prove accuracy to convert those spend lines.";

  for (const { label, source } of [
    { label: "page.tsx", source: pageSource },
    { label: "Planner.tsx", source: plannerSource },
    { label: "ReportPdfButton.tsx", source: pdfButtonSource },
  ]) {
    const { extractForceIntensity, extractForceImplication } = await compileForceExtractionFns(source);

    const intensity = extractForceIntensity(realSubstitutesLine, "Substitutes");
    assert.ok(intensity, `${label}: expected Substitutes' intensity to be recognized, not silently "Not specified"`);
    assert.equal(intensity.level, "Moderate");

    const implication = extractForceImplication(realSubstitutesLine, "Substitutes");
    assert.ok(implication, `${label}: expected Substitutes' implication sentence to be recognized`);
    assert.match(implication, /manual legal review and professional services/);
  }
});

test("no regression: the pre-existing bare-force-name aliases for Buyer Power/Supplier Power still work exactly as before, in page.tsx, Planner.tsx, and ReportPdfButton.tsx", async () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    const { extractForceIntensity } = await compileForceExtractionFns(source);
    assert.ok(extractForceIntensity("Buyer power is high due to procurement leverage.", "Buyer Power"));
    assert.ok(extractForceIntensity("Supplier power is low given fungible cloud providers.", "Supplier Power"));
  }
});

test("WEB SOURCE CHECK: the Porter's Five Forces card renders an EvidenceBadge per force, gated to Market Intelligence only, in page.tsx and Planner.tsx", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(
      source,
      /\{isMarketIntelligence \? \(\s*\n\s*<EvidenceBadge level=\{getForceEvidenceLevel\(implication\)\} locale=\{evidenceLocale\} market \/>\s*\n\s*\) : null\}/
    );
  }
});

test("PDF SOURCE CHECK: the Porter's Five Forces intensity bar recolors to amber for an unevidenced force and stays teal otherwise, gated to Market Intelligence only, in ReportPdfButton.tsx and Planner.tsx", () => {
  assert.match(
    pdfButtonSource,
    /pdf\.setFillColor\(\s*\n\s*isMarketIntelligenceReport && !isForceEvidenceCited\(implication\) \? "#fbbf24" : "#5eead4"\s*\n\s*\);/
  );
  assert.match(plannerSource, /isMarketIntelligence && getForceEvidenceLevel\(implication\) === "validationRequired"\s*\n\s*\? "#fbbf24"\s*\n\s*: "#5eead4"/);
});

test("no regression: the underlying intensity/implication extraction (extractForceIntensity, extractForceImplication) is completely untouched -- this fix only reads their already-displayed output, never re-derives it", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.match(source, /function extractForceIntensity\(/);
    assert.match(source, /function extractForceImplication\(/);
  }
});

test("drift check: TAM/SAM/SOM's own evidence badge and per-layer assumption sentence (SAM's '25% of TAM' derivation) are untouched by this pass", () => {
  assert.match(pageSource, /const assumptions = bars\.map\(\(bar, index\) => \(resolved\[index\] \? extractMarketSizeAssumption\(content, bar\.label\) : ""\)\);/);
  assert.match(pageSource, /Planning Estimate \/ Not Verified/);
});

test("drift check: Market Size/CAGR's evidence classification path (getDashboardMetricEvidence, deriveMarketSizeMetricEvidenceLevel) is untouched by this pass", () => {
  // TASK #32 -- extractEvidenceLineForValue's page.tsx-local
  // implementation was superseded by the shared
  // deriveMarketSizeMetricEvidenceLevel/extractEvidenceLineForMetricValue
  // in report-presentation.ts (see tests/market-intelligence-source-
  // evidence-integrity.test.mjs for that fix's own dedicated coverage) --
  // this drift check now pins the current shared-function shape instead.
  assert.match(pageSource, /deriveMarketSizeMetricEvidenceLevel,/);
  assert.match(pageSource, /function getDashboardMetricEvidence\(label: string, value: string, content: string\): EvidenceLevel \{/);
});
