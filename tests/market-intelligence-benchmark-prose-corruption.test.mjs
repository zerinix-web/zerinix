import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// TASK #27E -- Fix user-visible prose corruption introduced by Market
// Intelligence evidence/citation sanitization.
//
// ROOT CAUSE (confirmed live against the real persisted report, id
// 4c0b5786-357c-4927-b7ff-3d38664b6495, and every regenerated sibling --
// 69609b72, 55c96ce5, d1bd69a6, 85f46427, 4c12c95c -- via direct
// byte-for-byte reproduction against the pre-fix code): route.ts's
// marketReportTermReplacements array had a row
// `[/\bBenchmarks?\b/gi, "Market references"]` that matched the ordinary
// English word "benchmark"/"benchmarks" ANYWHERE in generated prose, not
// just as a label -- the exact same defect class P0 FIX #8 already fixed
// for "Assumption" (see that fix's own comment a few lines above this
// row in route.ts). "Market references" was then relabeled again by
// pdf-normalization.mjs's own `Market references -> Market sources` rule,
// producing the final, grammatically broken text:
//   "independent accuracy benchmark report"
//     -> "independent accuracy Market references report"
//     -> "independent accuracy Market sources report"
//   "per-account annual revenue benchmarks to validate SOM assumptions"
//     -> "per-account annual revenue Market references to validate..."
//     -> "per-account annual revenue Market sources to validate..."
// Unlike "Assumption", "Benchmark" has no bracketed-tag or line-heading
// use anywhere in this pipeline's actual vocabulary --
// report-quality-directives.ts only ever instructs the model to emit
// [Verified]/[Estimated]/[Assumption] as evidence tags -- so there was no
// label position left to scope the rule to. FIX: the row is removed
// entirely from marketReportTermReplacements.
//
// AUDIT (required by the ticket): the same live reproduction technique
// was run against all 6 real reports' full section sets. The bug also
// silently corrupted "Market Size" ("...the clearest, supported
// benchmark in the dataset" -> "...supported Market sources...") and
// "Regional Analysis" ("no Europe-specific benchmarks..." ->
// "no Europe-specific Market sources...") in every one of the 6 reports,
// beyond the 2 instances the user found in Strategic Recommendations.
// The rest of marketReportTermReplacements and normalizePdfText's own
// replace chain were audited the same way (real content from all 6
// reports run through every rule): no other rule produced a detectable
// corruption artifact. A category of bare single-word delete-to-empty
// rules (TBD/Placeholder/Unknown/Unavailable/Failed) remains
// theoretically as unscoped as "Benchmark" was, but triggered on none of
// the real content audited here -- flagged in the task's final report as
// a latent risk for a future pass, not fixed in this one, since there is
// no live evidence of it firing.
//
// Because sanitizeMarketReportContent (which includes this rule) is
// applied once, at generation/persist time, the fix prevents this
// corruption in every future report (new or regenerated). It cannot
// retroactively repair the exact wording already persisted for report
// 4c0b5786 and its siblings without guessing which of "benchmark" or
// "benchmarks" was originally there (both occur across the corrupted
// instances) -- doing so would be exactly the kind of fabrication the
// ticket explicitly forbids, so those specific rows will keep showing
// "Market sources" until they are regenerated.

function extractBalancedBlock(source, startIndex) {
  let depth = 0;
  let started = false;
  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
      started = true;
    } else if (ch === "}") {
      depth -= 1;
      if (started && depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  throw new Error("extractBalancedBlock: no balanced closing brace found");
}

async function importSanitizeMarketReportContent() {
  const routeSourcePath = join(repoRoot, "app/api/market-analysis/route.ts");
  const routeSource = readFileSync(routeSourcePath, "utf8");

  const startMarker = "const marketReportFinancialAcronymReplacements";
  const startIdx = routeSource.indexOf(startMarker);
  assert.notEqual(startIdx, -1, "marketReportFinancialAcronymReplacements must exist in route.ts");

  const funcMarker = "function sanitizeMarketReportContent(value: string) {";
  const funcIdx = routeSource.indexOf(funcMarker, startIdx);
  assert.notEqual(funcIdx, -1, "sanitizeMarketReportContent must exist in route.ts");

  const braceStart = routeSource.indexOf("{", funcIdx);
  const functionBlock = extractBalancedBlock(routeSource, braceStart);
  const combinedBlock = routeSource.slice(startIdx, braceStart) + functionBlock;

  const responseSanitizationUrl = pathToFileURL(
    join(repoRoot, "app/lib/ai/response-sanitization.ts")
  ).href;
  const pdfNormalizationUrl = pathToFileURL(join(repoRoot, "app/lib/pdf-normalization.mjs")).href;
  const reportOutputSanitizationUrl = pathToFileURL(
    join(repoRoot, "app/lib/report-output-sanitization.ts")
  ).href;

  const harness = `
import { sanitizeAiResponseText } from ${JSON.stringify(responseSanitizationUrl)};
import { normalizePdfText } from ${JSON.stringify(pdfNormalizationUrl)};
import { stripInternalImplementationTokens } from ${JSON.stringify(reportOutputSanitizationUrl)};

${combinedBlock}

export { sanitizeMarketReportContent };
`;

  const dir = mkdtempSync(join(tmpdir(), "zerinix-market-sanitize-27e-"));
  const outPath = join(dir, "sanitize.mts");
  writeFileSync(outPath, harness);
  return import(pathToFileURL(outPath).href);
}

const { sanitizeMarketReportContent } = await importSanitizeMarketReportContent();

test("route.ts no longer defines an unscoped Benchmark(s) -> Market references relabeling rule", () => {
  const routeSource = readFileSync(join(repoRoot, "app/api/market-analysis/route.ts"), "utf8");
  assert.doesNotMatch(
    routeSource,
    /\[\/\\bBenchmarks\?\\b\/gi,\s*"Market references"\]/,
    "the unscoped Benchmark(s) relabeling rule must be removed, not merely renamed"
  );
});

test("1a. 'benchmark'/'benchmarks' survive as ordinary prose across the exact reported failure shapes", () => {
  const cases = [
    [
      "KPI: independent accuracy benchmark report (clause extraction & risk scoring) across 500 representative contracts.",
      /independent accuracy benchmark report/,
    ],
    [
      "provide per-account annual revenue benchmarks to validate SOM assumptions.",
      /per-account annual revenue benchmarks to validate SOM assumptions/,
    ],
    [
      "that 2024 figure is the clearest, supported benchmark in the dataset.",
      /clearest, supported benchmark in the dataset/,
    ],
    [
      "no Europe-specific benchmarks in the supplied registry.",
      /no Europe-specific benchmarks in the supplied registry/,
    ],
    [
      "third-party benchmarks demonstrating extraction quality.",
      /third-party benchmarks demonstrating extraction quality/,
    ],
    [
      "if accuracy benchmarks or procurement listing fails, re-evaluate.",
      /if accuracy benchmarks or procurement listing fails/,
    ],
  ];
  for (const [input, expected] of cases) {
    const output = sanitizeMarketReportContent(input);
    assert.match(output, expected, `expected "${input}" to survive intact, got "${output}"`);
    assert.doesNotMatch(output, /Market (?:references|sources)/i, `"${input}" must never become "Market sources"/"Market references"`);
  }
});

test("1b. normal words 'source', 'sources', 'data source', 'accuracy report', and 'revenue data' are not semantically corrupted", () => {
  const cases = [
    "This claim is supported by a single public source.",
    "Multiple independent sources confirm the same pricing trend.",
    "The figure is derived from a third-party data source, not an internal estimate.",
    "See the accuracy report published alongside the vendor's product page.",
    "Revenue data for the mid-market segment remains sparse.",
  ];
  for (const input of cases) {
    const output = sanitizeMarketReportContent(input);
    assert.equal(output.trim(), input.trim(), `"${input}" must pass through unchanged`);
  }
});

test("2. citation cleanup still works: valid R# references and evidence-status labels survive", () => {
  const input =
    "Ironclad leads on enterprise deals with strong AI positioning [R3]. Evisort differentiates on AI-native analysis [Unverified reference].";
  const output = sanitizeMarketReportContent(input);
  assert.match(output, /\[R3\]/, "a valid R# citation must survive sanitization");
  assert.match(output, /\(Evidence status: Unverified\)/, "the professional evidence-status label must still be applied");
  assert.doesNotMatch(output, /\[Unverified reference\]/, "the raw bracket marker must not survive");
});

test("3. all four real Strategic Recommendations actions remain intact and readable", () => {
  const raw =
    "Recommendation: Enter (evidence supports entering with a validated mid-market penetration plan and procurement readiness; see R12, R4, R5, R3).\n" +
    "Conviction: Supported by growth forecasts and active vendor productization; key remaining uncertainty is SOM and realistic win rates.\n" +
    "Trade-offs: Invest early in accuracy benchmarking and procurement qualification rather than broad enterprise feature parity.\n" +
    "First 90 Days (three concrete actions): 1) Market-access validation — Owner: Head of Sales (U.S. mid-market), Budget ceiling: USD 80,000; KPI: number of qualified mid-market procurement channels secured (target = 3 state or national procurement frameworks or reseller agreements); Success criterion: at least one state procurement listing or one reseller agreement signed within 90 days (evidence path: state contract templates like R3).\n" +
    "2) Accuracy benchmarking engagement — Owner: Head of Product, Budget ceiling: USD 60,000; KPI: independent accuracy benchmark report (clause extraction & risk scoring) across 500 representative contracts; Success criterion: third-party benchmarks demonstrating ≥90% extraction F1 or equivalent within 90 days (requirement driven by buyer expectations in vendor docs) [Unverified reference][Unverified reference].\n" +
    "3) 6-account pilot commitments — Owner: Head of Commercial, Budget ceiling: USD 60,000 (sales support); KPI: signed pilot contracts with 6 U.S. mid-market customers across two verticals (target verticals: tech services and manufacturing); Success criterion: at least 3 pilots convert to paid contracts within 6 months or provide per-account annual revenue benchmarks to validate SOM assumptions.\n" +
    "If all three succeed, scale; if accuracy benchmarks or procurement listing fails, re-evaluate and monitor instead.\n" +
    "(174 words)";

  const output = sanitizeMarketReportContent(raw);

  assert.doesNotMatch(output, /Market (?:references|sources)/i, "no action may contain the corrupted 'Market sources' phrase");

  const actionMarkers = output.match(/(?:^|\s)([1-3])\)\s/gm) || [];
  assert.equal(actionMarkers.length, 3, "all 3 numbered First-90-Days actions must remain distinct and present");

  assert.match(output, /independent accuracy benchmark report/, "action 2's KPI wording must remain grammatical");
  assert.match(output, /third-party benchmarks demonstrating/, "action 2's success criterion wording must remain grammatical");
  assert.match(output, /per-account annual revenue benchmarks to validate SOM assumptions/, "action 3's fallback KPI wording must remain grammatical");
  assert.match(output, /if accuracy benchmarks or procurement listing fails/, "the closing contingency sentence must remain grammatical");
  assert.match(output, /R12, R4, R5, R3/, "citations in the top-line recommendation must survive");
  assert.match(output, /\(Evidence status: Unverified\)/, "unresolved sub-claims must still carry the professional evidence label");
});

test("4. Task #27D content-restoration regressions remain fixed after this change", () => {
  // Re-verifies (with the additional #27E fix applied) that Major Players
  // still does not collapse to the generic disclaimer -- the exact class
  // of regression Task #27D fixed, guarding against any interaction
  // between the two fixes.
  const majorPlayers =
    "Ironclad — product pages indicate CLM positioning; public pricing not fixed on site [Unverified reference].\n" +
    "Evisort — publishes an AI engine and contract LLM [Unverified reference].\n" +
    "DocuSign CLM — appears in state procurement pricing [Unverified reference].\n" +
    "LawGeex — advertises AI contract-review capabilities [Unverified reference].";
  const output = sanitizeMarketReportContent(majorPlayers);
  assert.doesNotMatch(output, /does not contain a definitive conclusion/i);
  for (const vendor of ["Ironclad", "Evisort", "DocuSign CLM", "LawGeex"]) {
    assert.match(output, new RegExp(vendor));
  }
  assert.equal(
    output.split("\n").filter(Boolean).length,
    4,
    "all 4 vendor lines must survive, matching Task #27D's own guarantee"
  );
});
