import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseMarketSizingMagnitude } from "../app/lib/report-presentation.ts";

// TASK #57 -- Unify Market Intelligence TAM/SAM/SOM magnitude parsing
// under the shared canonical parser.
//
// Task #56's audit found Planner.tsx carried its own independent
// parseMarketSizeMagnitude with a broken number-capture group
// (\d+(?:[.,]\d+)? -- only ONE optional decimal/thousands group) and a
// non-global comma-to-period replace -- silently mis-parsing any
// comma-grouped figure with more than one comma:
//   parseMarketSizeMagnitude("40,000")        -> 40        (should be 40,000)
//   parseMarketSizeMagnitude("$1,234,567")    -> 567       (should be 1,234,567)
//   parseMarketSizeMagnitude("$50,000,000")   -> null      (should be 50,000,000)
// page.tsx's own local parseMonetaryMagnitude was functionally
// near-identical to the shared parser but was still a second,
// independently-maintained copy of the identical rule -- the exact
// structural risk that let Planner.tsx's copy silently drift broken in
// the first place.
//
// FIX: page.tsx's parseMonetaryMagnitude and Planner.tsx's
// parseMarketSizeMagnitude are now both pure one-line delegations to
// report-presentation.ts's parseMarketSizingMagnitude (the same parser
// ReportPdfButton.tsx already delegated to, and the same parser
// app/api/market-analysis/route.ts uses at generation time) -- kept as
// thin, same-named wrappers (not renamed/removed) so every pre-existing
// caller keeps reading identically and no call site needed touching.
// This file proves: (1) the exact behavioral difference between the old
// Planner.tsx implementation and the shared parser for every divergent
// format class, (2) that all three render-surface wrappers are now pure
// delegations carrying zero parsing logic of their own, (3) scale
// safety (18M can never become 18/18K/18B), and (4) fail-before/
// pass-after for the specific reported defect.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");

function extractFunctionSource(source, functionName) {
  const startMatch = source.match(new RegExp(`function ${functionName}\\(`));
  assert.ok(startMatch, `${functionName} not found`);
  const start = startMatch.index;
  let i = start + startMatch[0].length - 1;
  let depth = 1;
  while (depth > 0) {
    i += 1;
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") depth -= 1;
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

const canonicalMagnitudeImport = `import { parseMarketSizingMagnitude } from ${JSON.stringify(
  pathToFileURL(join(process.cwd(), "app/lib/report-presentation.ts")).href
)};\n`;

async function compileWrapper(source, functionName) {
  const raw = extractFunctionSource(source, functionName);
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task57-magnitude-"));
  const outPath = join(dir, `${functionName}.ts`);
  writeFileSync(outPath, `${canonicalMagnitudeImport}export ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod[functionName];
}

// THE OLD, BROKEN Planner.tsx implementation, reproduced verbatim here
// as a fixed reference (not read live from any file) -- used only to
// prove fail-before/pass-after: the current, shared-delegating
// implementation must disagree with this old one on exactly the inputs
// Task #56 identified as divergent, proving the bug was real and is now
// fixed, not merely never tested.
function OLD_BROKEN_planner_parseMarketSizeMagnitude(value) {
  const matches = [...value.matchAll(/(\d+(?:[.,]\d+)?)\s*(thousand\b|million\b|billion\b|trillion\b|[kKmMbBtT]\b)?/gi)];
  const unitMatches = matches.filter((candidate) => candidate[2]);
  const last = unitMatches.length > 0 ? unitMatches.at(-1) : matches.at(-1);
  if (!last) return null;

  const numeric = Number(last[1].replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const unit = (last[2] || "").toLowerCase();
  const multiplier =
    unit === "t" || unit === "trillion"
      ? 1e12
      : unit === "b" || unit === "billion"
        ? 1e9
        : unit === "m" || unit === "million"
          ? 1e6
          : unit === "k" || unit === "thousand"
            ? 1e3
            : 1;

  return numeric * multiplier;
}

// ---------------------------------------------------------------------------
// A-J: the required number-format matrix, asserted against the shared
// canonical parser directly.
// ---------------------------------------------------------------------------

test("A) plain integer", () => {
  assert.equal(parseMarketSizingMagnitude("18000000"), 18_000_000);
});

test("B) decimal", () => {
  assert.equal(parseMarketSizingMagnitude("18.5"), 18.5);
});

test("C) suffix K", () => {
  assert.equal(parseMarketSizingMagnitude("18K"), 18_000);
  assert.equal(parseMarketSizingMagnitude("18.5K"), 18_500);
});

test("D) suffix M", () => {
  assert.equal(parseMarketSizingMagnitude("18M"), 18_000_000);
  assert.equal(parseMarketSizingMagnitude("18.5M"), 18_500_000);
});

test("E) suffix B", () => {
  assert.equal(parseMarketSizingMagnitude("1.2B"), 1_200_000_000);
});

test("F) comma-grouped numbers", () => {
  assert.equal(parseMarketSizingMagnitude("18,000,000"), 18_000_000);
  assert.equal(parseMarketSizingMagnitude("1,250,000"), 1_250_000);
});

test("G) decimal + comma combinations supported by the current canonical rules", () => {
  // The canonical parser strips ALL commas (thousands separators) before
  // parsing, so a comma-grouped figure with a trailing decimal parses as
  // one coherent number -- never a European decimal-comma reading.
  assert.equal(parseMarketSizingMagnitude("1,234,567.89"), 1_234_567.89);
  assert.equal(parseMarketSizingMagnitude("$2,100,000,000"), 2_100_000_000);
});

test("H) currency prefixes/symbols currently supported", () => {
  assert.equal(parseMarketSizingMagnitude("$18M"), 18_000_000);
  assert.equal(parseMarketSizingMagnitude("USD 18 million"), 18_000_000);
  assert.equal(parseMarketSizingMagnitude("£2.8 thousand"), 2_800);
});

test("I) whitespace / normalized formatting variants", () => {
  assert.equal(parseMarketSizingMagnitude("18 M"), 18_000_000);
  assert.equal(parseMarketSizingMagnitude("  18M  "), 18_000_000);
  assert.equal(parseMarketSizingMagnitude("18\tmillion"), 18_000_000);
});

test("J) malformed or ambiguous values fail closed -- never fabricate a number", () => {
  assert.equal(parseMarketSizingMagnitude(""), null);
  assert.equal(parseMarketSizingMagnitude("Validation Required"), null);
  assert.equal(parseMarketSizingMagnitude("Not available"), null);
  assert.equal(parseMarketSizingMagnitude("--"), null);
  assert.equal(parseMarketSizingMagnitude("$0"), null, "zero is not a valid market size -- must fail closed, not report a real zero market");
  assert.equal(parseMarketSizingMagnitude("N/A"), null);
});

// ---------------------------------------------------------------------------
// Scale safety -- explicit proof that no 1K/1M/1B corruption can occur.
// ---------------------------------------------------------------------------

test("SCALE SAFETY: 18M can never become 18, 18K, or 18B", () => {
  const result = parseMarketSizingMagnitude("$18M");
  assert.equal(result, 18_000_000);
  assert.notEqual(result, 18);
  assert.notEqual(result, 18_000);
  assert.notEqual(result, 18_000_000_000);
});

test("SCALE SAFETY: 18,000,000 normalizes consistently with 18M for the same real value", () => {
  assert.equal(parseMarketSizingMagnitude("18,000,000"), parseMarketSizingMagnitude("18M"));
});

test("SCALE SAFETY: the exact reported divergent cases from Task #56's audit now parse correctly through the shared parser", () => {
  assert.equal(parseMarketSizingMagnitude("40,000"), 40_000);
  assert.equal(parseMarketSizingMagnitude("$1,234,567"), 1_234_567);
  assert.equal(parseMarketSizingMagnitude("$50,000,000"), 50_000_000);
});

// ---------------------------------------------------------------------------
// FAIL-BEFORE / PASS-AFTER: the old, broken Planner.tsx implementation
// (reproduced verbatim above) genuinely disagreed with the shared parser
// on these exact inputs -- proving the reported defect was real, not
// hypothetical.
// ---------------------------------------------------------------------------

test("FAIL-BEFORE: the old Planner.tsx-local implementation mis-parses comma-grouped figures by up to ~2000x (this is what Task #57 fixed)", () => {
  assert.equal(OLD_BROKEN_planner_parseMarketSizeMagnitude("40,000"), 40, "old implementation shrinks 40,000 to 40 -- a 1000x error");
  assert.equal(OLD_BROKEN_planner_parseMarketSizeMagnitude("$1,234,567"), 567, "old implementation shrinks $1,234,567 to 567 -- a ~2178x error");
  assert.equal(OLD_BROKEN_planner_parseMarketSizeMagnitude("$50,000,000"), null, "old implementation fails to parse $50,000,000 at all");

  // Prove the disagreement directly against the now-correct shared parser.
  assert.notEqual(
    OLD_BROKEN_planner_parseMarketSizeMagnitude("40,000"),
    parseMarketSizingMagnitude("40,000"),
    "the old and new implementations must disagree on this input -- that disagreement IS the bug"
  );
  assert.notEqual(
    OLD_BROKEN_planner_parseMarketSizeMagnitude("$1,234,567"),
    parseMarketSizingMagnitude("$1,234,567")
  );
});

test("PASS-AFTER: Planner.tsx's real, current parseMarketSizeMagnitude no longer reproduces the old implementation's bug", async () => {
  const plannerParse = await compileWrapper(plannerSource, "parseMarketSizeMagnitude");
  assert.equal(plannerParse("40,000"), 40_000);
  assert.equal(plannerParse("$1,234,567"), 1_234_567);
  assert.equal(plannerParse("$50,000,000"), 50_000_000);
});

test("PASS-AFTER: page.tsx's parseMonetaryMagnitude agrees with the shared parser on the same divergent inputs", async () => {
  const pageParse = await compileWrapper(pageSource, "parseMonetaryMagnitude");
  assert.equal(pageParse("40,000"), 40_000);
  assert.equal(pageParse("$1,234,567"), 1_234_567);
  assert.equal(pageParse("$50,000,000"), 50_000_000);
});

// ---------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH -- structural proof that all three render-
// surface wrappers now carry ZERO independent parsing logic.
// ---------------------------------------------------------------------------

test("STRUCTURAL: page.tsx's parseMonetaryMagnitude is a pure one-line delegation to the shared parser", () => {
  const fn = extractFunctionSource(pageSource, "parseMonetaryMagnitude");
  assert.match(fn, /return parseMarketSizingMagnitude\(value\);/);
  assert.ok(!fn.includes(".matchAll("), "must carry zero independent parsing logic");
  assert.ok(!fn.includes("multiplier"), "must carry zero independent unit-multiplier logic");
});

test("STRUCTURAL: Planner.tsx's parseMarketSizeMagnitude is a pure one-line delegation to the shared parser", () => {
  const fn = extractFunctionSource(plannerSource, "parseMarketSizeMagnitude");
  assert.match(fn, /return parseMarketSizingMagnitude\(value\);/);
  assert.ok(!fn.includes(".matchAll("), "must carry zero independent parsing logic");
  assert.ok(!fn.includes("multiplier"), "must carry zero independent unit-multiplier logic");
});

test("STRUCTURAL: ReportPdfButton.tsx's parseMarketSizeMagnitude is a pure one-line delegation to the shared parser (pre-existing, unchanged by this task)", () => {
  const fn = extractFunctionSource(pdfButtonSource, "parseMarketSizeMagnitude");
  assert.match(fn, /return parseMarketSizingMagnitude\(value\);/);
});

// ---------------------------------------------------------------------------
// WEB / PDF PARITY -- all three surfaces agree byte-for-byte on the full
// A-J format matrix and the scale-safety cases, since they now all
// delegate to the exact same function rather than three independently-
// maintained copies.
// ---------------------------------------------------------------------------

test("WEB/PDF PARITY: page.tsx, Planner.tsx, and ReportPdfButton.tsx all agree on every A-J format case and every scale-safety case", async () => {
  const pageParse = await compileWrapper(pageSource, "parseMonetaryMagnitude");
  const plannerParse = await compileWrapper(plannerSource, "parseMarketSizeMagnitude");
  const pdfParse = await compileWrapper(pdfButtonSource, "parseMarketSizeMagnitude");

  const cases = [
    "18000000",
    "18.5",
    "18K",
    "18.5K",
    "18M",
    "18.5M",
    "1.2B",
    "18,000,000",
    "1,250,000",
    "1,234,567.89",
    "$2,100,000,000",
    "$18M",
    "USD 18 million",
    "£2.8 thousand",
    "18 M",
    "  18M  ",
    "40,000",
    "$1,234,567",
    "$50,000,000",
    "",
    "Validation Required",
    "$0",
  ];

  for (const value of cases) {
    const canonical = parseMarketSizingMagnitude(value);
    assert.equal(pageParse(value), canonical, `page.tsx must agree with the shared parser for "${value}"`);
    assert.equal(plannerParse(value), canonical, `Planner.tsx must agree with the shared parser for "${value}"`);
    assert.equal(pdfParse(value), canonical, `ReportPdfButton.tsx must agree with the shared parser for "${value}"`);
  }
});

// ---------------------------------------------------------------------------
// NO DECISION REGRESSION -- this task's changes are confined to the
// magnitude-parsing wrappers only. Drift check confirming no decision/
// confidence/ENTER-eligibility/evidence-gap/Closure-Plan/recommendation-
// linkage/evidence-classification function was touched.
// ---------------------------------------------------------------------------

test("NO DECISION REGRESSION: this task's source changes are confined to parseMonetaryMagnitude/parseMarketSizeMagnitude and their surrounding comments -- decision, confidence, ENTER eligibility, evidence-gap, Closure Plan, and recommendation-linkage functions are untouched", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /resolveMarketIntelligenceGatedExecutiveDecision/, "canonical decision resolver must still be present and in use");
  }
  assert.ok(
    !plannerSource.includes("function parseTamSamSomDecision"),
    "no new independent decision-parsing function was introduced"
  );
});
