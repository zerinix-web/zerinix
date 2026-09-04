import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assessMarketEntryConfidence } from "../app/lib/report-engine/market-intelligence-presentation.ts";
import { resolveMarketSizingCascade, parseMarketSizingMagnitude } from "../app/lib/report-presentation.ts";

// TASK #21 -- Audit and harden Market Intelligence TAM / SAM / SOM
// decision integrity.
//
// ROOT CAUSE (confirmed by direct inspection of
// app/lib/ai/market-intelligence-graph.ts's buildPlanningEstimate and
// app/api/market-analysis/route.ts's resolveDecisionCriticalEvidenceState,
// before any fix was written):
//
// buildPlanningEstimate classifies SAM's own derivation as one of
// "evidenceDerived" (a real segment/geography narrowing percentage was
// found in the evidence) or "defaultAssumption" (buildPlanningEstimate's
// own disclosed, un-evidenced 25% default -- "no segment-narrowing
// evidence found"). obtainableShareResolved -- the ONE pillar
// specifically responsible for recognizing SOM/obtainable-share
// uncertainty (Task #11) -- only ever checked `samMethod !== "blocked"`,
// treating "evidenceDerived" and "defaultAssumption" as EQUALLY resolved
// as long as SOM's own obtainable-share percentage was itself
// evidence-backed. That let a report whose SAM was NEVER independently
// verified (just a blind 25% guess) still read as fully sizing-resolved
// and clear a strong ENTER/AVOID decision: SOM = SAM x (real win-rate%)
// is only ever as trustworthy as the SAM it was multiplied against, and
// an assumed SAM must not be silently absorbed into an otherwise-
// evidenced SOM chain. This is exactly "another decision-critical
// market-sizing input [that] is only a planning assumption" this ticket
// asks to be recognized.
//
// FIX: obtainableShareResolved now requires samMethod to be the genuine
// "evidenceDerived" state, not merely "not blocked" -- a defaultAssumption
// SAM alone is now sufficient to gate a strong decision to MONITOR, even
// when SOM's own percentage was evidence-based.
//
// Confirmed NOT bugs during this same audit (already correct, verified
// by direct inspection):
//   - Mathematical nesting (SAM <= TAM, SOM <= SAM) is guaranteed at TWO
//     independent layers: buildPlanningEstimate computes SAM/SOM as
//     TAM/SAM multiplied by percentages bounded to (0, 1)
//     (extractServiceableSharePercent: 0 < percent < 100;
//     extractObtainableSharePercent: 0 < percent < 50), so nesting cannot
//     be violated by construction; resolveMarketSizingCascade
//     (report-presentation.ts, shared/exported) independently re-verifies
//     nesting from parsed presentation text for reports that never went
//     through the structured pipeline at all.
//   - A derived/assumed number is never mislabeled as verified: the
//     section-level evidence badge (getTamSamSomSectionEvidence) returns
//     "benchmarkDerived", never "verified", whenever any layer carries an
//     "[Estimated]"/"Planning Estimate" tag.
//   - Missing evidence never becomes 0 or a fabricated number: an
//     unresolved cascade layer returns "validationRequired"
//     (page.tsx/Planner.tsx render this as "Validation Needed"), never a
//     silently-substituted number.
//   - decisionCriticalEvidence (built once in route.ts) is passed
//     identically into both assessMarketEntryConfidence (Executive
//     Summary's canonical banner) and buildMarketEntryRecommendation
//     (Strategic Recommendations) -- fixing the ONE shared function
//     automatically keeps both surfaces consistent (Task #13's
//     established finding, unchanged by this pass).

const routeSource = readFileSync(new URL("../app/api/market-analysis/route.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

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

// --- Fixtures matching the established convention in
// market-intelligence-executive-decision-integrity.test.mjs -----------------

function fixtureCoverage(overrides = {}) {
  return {
    evidenceCount: 12,
    verifiedSources: 6,
    independentDomains: 5,
    competitorBreadth: 4,
    sourceTypeDiversity: 3,
    claimCoverage: 70,
    freshnessScore: 80,
    averageQuality: 75,
    verifiedMarketSizeAvailable: true,
    dimensions: {
      marketConfidence: 85,
      competitiveEvidence: 80,
      financialEvidence: 75,
      productEvidence: 70,
      executionReadiness: 999,
      founderReadiness: 999,
    },
    overallConfidence: 80,
    sourceClasses: ["market_research", "government_statistics"],
    ...overrides,
  };
}

test("SOURCE FIX: resolveDecisionCriticalEvidenceState now requires samMethod === 'evidenceDerived' (not merely '!== \"blocked\"') to consider obtainableShareResolved true", () => {
  assert.match(
    routeSource,
    /obtainableShareResolved:\s*\n\s*graph\.planningEstimate === null \|\|\s*\n\s*\(graph\.planningEstimate\.samMethod === "evidenceDerived" &&\s*\n\s*graph\.planningEstimate\.somStatus === "calculated"\),/
  );
  assert.doesNotMatch(
    routeSource,
    /obtainableShareResolved:\s*\n\s*graph\.planningEstimate === null \|\|\s*\n\s*\(graph\.planningEstimate\.samMethod !== "blocked"/,
    "the old, weaker condition must be fully replaced, not left as a secondary fallback"
  );
});

test("A) verified TAM + assumed SAM + unresolved SOM: a strong raw ENTER-level blend is downgraded to MONITOR when obtainableShareResolved is false, exactly as Task #11 established (unchanged by this fix)", () => {
  const coverage = fixtureCoverage();
  const result = assessMarketEntryConfidence(coverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: false, // SOM genuinely unresolved
  });

  assert.equal(result.decision, "MONITOR");
  assert.equal(result.evidenceGapBlocksStrongDecision, true);
});

test("F) THE ROOT-CAUSE SCENARIO: canonical decision cannot become ENTER solely from an unsupported SAM assumption -- even when SOM's own percentage was evidence-based, an assumed (not evidence-derived) SAM alone must gate a strong decision to MONITOR", () => {
  // This is the exact new scenario this fix closes: obtainableShareResolved
  // is now false whenever samMethod !== "evidenceDerived", REGARDLESS of
  // whether SOM's own obtainable-share percentage was itself evidence-
  // backed (somStatus === "calculated") -- reproducing what
  // resolveDecisionCriticalEvidenceState now correctly computes for a
  // graph.planningEstimate shaped like { samMethod: "defaultAssumption",
  // somStatus: "calculated" }.
  const coverage = fixtureCoverage();
  const result = assessMarketEntryConfidence(coverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: false, // simulates samMethod: "defaultAssumption" + somStatus: "calculated"
  });

  assert.equal(result.decision, "MONITOR", "an assumed SAM must gate the decision even with a 'calculated' SOM");
  assert.equal(result.evidenceGapBlocksStrongDecision, true);
});

test("D) sufficient evidence + no decision-critical unresolved blocker (SAM genuinely evidenceDerived + SOM calculated): a strong ENTER remains possible, unmodified by this fix", () => {
  const coverage = fixtureCoverage();
  const result = assessMarketEntryConfidence(coverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: true, // simulates samMethod: "evidenceDerived" + somStatus: "calculated"
  });

  assert.equal(result.decision, "ENTER");
  assert.equal(result.evidenceGapBlocksStrongDecision, false);
});

test("B) SAM > TAM invalid state: resolveMarketSizingCascade never resolves SAM when it exceeds its own TAM, regardless of SAM's own value being present", () => {
  const cascade = resolveMarketSizingCascade([1_000_000, 5_000_000, null]);
  assert.equal(cascade.tamResolved, true);
  assert.equal(cascade.samResolved, false, "a SAM larger than TAM must never resolve, even though a SAM number exists");
  assert.equal(cascade.somResolved, false);
  assert.equal(cascade.allResolved, false);
});

test("C) SOM > SAM invalid state: resolveMarketSizingCascade never resolves SOM when it exceeds its own SAM, even when TAM and SAM are both otherwise valid", () => {
  const cascade = resolveMarketSizingCascade([10_000_000, 2_000_000, 3_000_000]);
  assert.equal(cascade.tamResolved, true);
  assert.equal(cascade.samResolved, true);
  assert.equal(cascade.somResolved, false, "a SOM larger than SAM must never resolve");
  assert.equal(cascade.allResolved, false);
});

test("missing SOM must remain Validation Required: resolveMarketSizingCascade never fabricates a value or defaults to 0 when SOM has no parseable figure", () => {
  const cascade = resolveMarketSizingCascade([10_000_000, 2_500_000, null]);
  assert.equal(cascade.tamResolved, true);
  assert.equal(cascade.samResolved, true);
  assert.equal(cascade.somResolved, false);
  assert.equal(cascade.allResolved, false);
});

test("all three layers correctly nested and present: resolveMarketSizingCascade resolves TAM/SAM/SOM together, in all three surfaces (real evidence can produce real values)", () => {
  const cascade = resolveMarketSizingCascade([10_000_000, 2_500_000, 500_000]);
  assert.equal(cascade.tamResolved, true);
  assert.equal(cascade.samResolved, true);
  assert.equal(cascade.somResolved, true);
  assert.equal(cascade.allResolved, true);
});

async function compileIsMarketSizeEstimated(source) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-tam-estimated-"));
  const outPath = join(dir, "extract.mts");
  const harness = [
    extractFunctionSource(source, "extractMarketSizeAssumption"),
    extractFunctionSource(source, "isMarketSizeEstimated"),
  ].join("\n\n");
  writeFileSync(outPath, `${harness}\nexport { isMarketSizeEstimated };\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.isMarketSizeEstimated;
}

test("E) planning assumptions cannot be relabeled as verified: isMarketSizeEstimated correctly recognizes an explicit '[Estimated]'/'Planning Estimate' tag, and does not fire on ordinary unlabeled text, in page.tsx and Planner.tsx", async () => {
  for (const source of [pageSource, plannerSource]) {
    const isMarketSizeEstimated = await compileIsMarketSizeEstimated(source);
    assert.equal(isMarketSizeEstimated("SAM [Estimated]: USD 375 million.", "SAM"), true);
    assert.equal(
      isMarketSizeEstimated("SAM: USD 375 million — Planning Estimate derived from 25% of TAM.", "SAM"),
      true
    );
    assert.equal(
      isMarketSizeEstimated("TAM: USD 1.5 billion, confirmed by Emergen Research's own published 2024 figure.", "TAM"),
      false,
      "a genuinely unlabeled, non-estimate sentence must not be misclassified as an assumption either way"
    );
  }
});

test("G) UI and PDF receive the same resolved sizing state: page.tsx's and Planner.tsx's own local resolveTamSamSomCascade wrappers use the mathematically identical nesting formula as the shared, PDF-facing resolveMarketSizingCascade", () => {
  for (const source of [pageSource, plannerSource]) {
    const cascadeSource = extractFunctionSource(source, "resolveTamSamSomCascade");
    assert.match(cascadeSource, /samResolved = tamResolved && magnitudes\[1\] !== null && magnitudes\[1\] <= \(magnitudes\[0\] as number\)/);
    assert.match(cascadeSource, /somResolved = samResolved && magnitudes\[2\] !== null && magnitudes\[2\] <= \(magnitudes\[1\] as number\)/);
  }
  // The PDF-drawing paths in both files call the SAME shared, imported
  // function directly with already-extracted magnitudes -- structurally
  // impossible for the PDF's own nesting check to drift from the web
  // report's, since neither reimplements the math for PDF specifically.
  // TASK #24 -- both PDF paths now also constrain the shared cascade's
  // output against a persisted canonical samMethod/somStatus (narrowing
  // only, never widening) -- see constrainMarketSizingResolutionToCanonicalState.
  // Planner.tsx reads its already-in-scope marketIntelligenceCanonicalState
  // (a ReportPanel prop); ReportPdfButton.tsx re-derives it from report.metadata.
  for (const [source, canonicalStateExpression] of [
    [plannerSource, "marketIntelligenceCanonicalState"],
    [pdfButtonSource, "readMarketIntelligenceCanonicalState\\(report\\.metadata\\)"],
  ]) {
    assert.match(source, /resolveMarketSizingCascade,/);
    assert.match(
      source,
      new RegExp(
        `const cascade = constrainMarketSizingResolutionToCanonicalState\\(\\s*\\n\\s*resolveMarketSizingCascade\\(magnitudes\\),\\s*\\n\\s*${canonicalStateExpression}\\s*\\n\\s*\\);`
      )
    );
  }
});

test("drift check: buildPlanningEstimate's percentage extractors remain bounded to (0, 1) as fractions, guaranteeing SAM <= TAM and SOM <= SAM by construction at the source layer (untouched by this pass)", () => {
  const graphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    graphSource,
    /Number\.isFinite\(percent\) && percent > 0 && percent < 100 \? percent \/ 100 : null;/,
    "serviceable-share percentage must remain bounded below 100%"
  );
  assert.match(
    graphSource,
    /Number\.isFinite\(percent\) && percent > 0 && percent < 50 \? percent \/ 100 : null;/,
    "obtainable-share percentage must remain bounded below 50% (a realistic win-rate ceiling)"
  );
});

test("drift check: decisionCriticalEvidence is still computed once and passed identically into both the Executive Summary banner and Strategic Recommendations (Task #13's established single-source-of-truth), unaffected by this pass", () => {
  // TASK #29 -- the no-graph branch no longer falls back to `undefined`
  // (which silently disabled the evidence gate for both consumers below
  // whenever a report generated with no MarketIntelligenceGraph at all --
  // see this line's own comment in route.ts) -- it now falls back to the
  // explicit, fully-unresolved DecisionCriticalEvidenceState, the most
  // conservative real gap this pipeline can express. The single-source-
  // of-truth property this test guards (one computation, shared
  // identically by both consumers) is unchanged by that fix.
  assert.match(
    routeSource,
    /const decisionCriticalEvidence: DecisionCriticalEvidenceState = graph\s*\n\s*\? resolveDecisionCriticalEvidenceState\(graph\)\s*\n\s*: \{ marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: false \};/
  );
  assert.doesNotMatch(
    routeSource,
    /const decisionCriticalEvidence[^=]*=\s*graph\s*\?\s*resolveDecisionCriticalEvidenceState\(graph\)\s*:\s*undefined/,
    "the no-graph branch must never silently disable the evidence gate again"
  );
});

test("no fabrication guard: an assumed SAM with NO obtainable-share evidence at all (the exact real report's shape) still correctly gates to MONITOR, both before and after this fix", () => {
  const coverage = fixtureCoverage();
  const result = assessMarketEntryConfidence(coverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: false, // samMethod: "defaultAssumption", somStatus: "pending"
  });

  assert.equal(result.decision, "MONITOR");
});

// --- SECOND DEFECT, found while verifying the fixes above end-to-end
// against the real report's actual TAM/SAM/SOM text -----------------------
//
// parseMarketSizingMagnitude/parseMonetaryMagnitude/parseMarketSizeMagnitude
// (the shared function and its two page.tsx/Planner.tsx local copies)
// each pick "the last number-like match in the string" as the monetary
// figure -- a deliberate, previously-established fix (Task #19) for
// genuine ranges like "$2.1-2.8 billion", where the upper bound is
// correct. But the real report's own TAM sentence, "USD 1.5 billion
// (U.S., 2024 baseline from Emergen Research) [R12].", carries a
// trailing citation tag: matching "12" from "[R12]" as if it were the
// monetary figure, corrupting the parsed magnitude this section's own
// SAM <= TAM / SOM <= SAM nesting check depends on -- reproduced by
// direct call before any fix was written. A SECOND, more severe bug
// surfaced during the same verification: without a trailing word
// boundary, the single-letter unit shortcuts ([kKmMbBtT]) matched the
// FIRST LETTER of any adjacent word, not just a standalone abbreviation
// -- "2024 baseline" parsed as "2024" + "b" (from "baseline") = 2024
// BILLION.
//
// FIX: prefer the last match that carries an explicit currency-scale
// unit over a bare, unit-less number, and require every unit token
// (including the single-letter shortcuts) to be followed by a real word
// boundary -- so a citation tag, a bare year, or an unrelated word can
// never be mistaken for the monetary value itself, while the established
// range-upper-bound behavior remains completely intact.

async function compileFunctionFromFile(source, functionName) {
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
  const raw = source.slice(start, i);

  // TASK #57 -- page.tsx's parseMonetaryMagnitude and Planner.tsx's
  // parseMarketSizeMagnitude are now both thin delegations to the
  // shared, canonical parseMarketSizingMagnitude (report-presentation.ts)
  // rather than independent copies -- imported by absolute path so an
  // extracted, standalone-compiled function has the real dependency
  // available. Harmless/unused for any OTHER extracted function.
  const canonicalMagnitudeImport = `import { parseMarketSizingMagnitude } from ${JSON.stringify(
    pathToFileURL(join(process.cwd(), "app/lib/report-presentation.ts")).href
  )};\n`;

  const dir = mkdtempSync(join(tmpdir(), "zerinix-magnitude-parse-"));
  const outPath = join(dir, "extract.mts");
  writeFileSync(outPath, `${canonicalMagnitudeImport}${raw}\nexport { ${functionName} };\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod[functionName];
}

test("EXACT REAL FAILURE SHAPE: a trailing citation tag ('[R12]') is never mistaken for the monetary figure -- 'USD 1.5 billion ... [R12].' parses to 1.5 billion, not 12, in all three implementations", async () => {
  const realTamValue = "USD 1.5 billion (U.S., 2024 baseline from Emergen Research) [R12].";

  assert.equal(parseMarketSizingMagnitude(realTamValue), 1_500_000_000);

  const pageParseMonetaryMagnitude = await compileFunctionFromFile(pageSource, "parseMonetaryMagnitude");
  assert.equal(pageParseMonetaryMagnitude(realTamValue), 1_500_000_000);

  const plannerParseMarketSizeMagnitude = await compileFunctionFromFile(plannerSource, "parseMarketSizeMagnitude");
  assert.equal(plannerParseMarketSizeMagnitude(realTamValue), 1_500_000_000);
});

test("SECOND REAL DEFECT: a bare number immediately followed by an unrelated word is never misread through that word's own first letter -- '2024 baseline' must never parse as 2024 billion, in all three implementations", async () => {
  const trapValue = "2024 baseline figure, not a monetary amount at all.";

  assert.equal(parseMarketSizingMagnitude(trapValue), 2024, "bare number with no real unit -- multiplier must stay 1");

  const pageParseMonetaryMagnitude = await compileFunctionFromFile(pageSource, "parseMonetaryMagnitude");
  assert.equal(pageParseMonetaryMagnitude(trapValue), 2024);

  const plannerParseMarketSizeMagnitude = await compileFunctionFromFile(plannerSource, "parseMarketSizeMagnitude");
  assert.equal(plannerParseMarketSizeMagnitude(trapValue), 2024);
});

test("no regression (Task #19's own established fix): a genuine multi-estimate range still resolves to its upper bound, e.g. '$2.1-2.8 billion' -> 2.8 billion, in all three implementations", async () => {
  const rangeValue = "$2.1-2.8 billion";

  assert.equal(parseMarketSizingMagnitude(rangeValue), 2_800_000_000);

  const pageParseMonetaryMagnitude = await compileFunctionFromFile(pageSource, "parseMonetaryMagnitude");
  assert.equal(pageParseMonetaryMagnitude(rangeValue), 2_800_000_000);

  const plannerParseMarketSizeMagnitude = await compileFunctionFromFile(plannerSource, "parseMarketSizeMagnitude");
  assert.equal(plannerParseMarketSizeMagnitude(rangeValue), 2_800_000_000);
});

test("no regression: informal shorthand notation (no space, and with a space before an unrelated word) still parses correctly, in all three implementations", async () => {
  assert.equal(parseMarketSizingMagnitude("$50k"), 50_000);
  assert.equal(parseMarketSizingMagnitude("$3 B market"), 3_000_000_000);

  const pageParseMonetaryMagnitude = await compileFunctionFromFile(pageSource, "parseMonetaryMagnitude");
  assert.equal(pageParseMonetaryMagnitude("$50k"), 50_000);
  assert.equal(pageParseMonetaryMagnitude("$3 B market"), 3_000_000_000);

  const plannerParseMarketSizeMagnitude = await compileFunctionFromFile(plannerSource, "parseMarketSizeMagnitude");
  assert.equal(plannerParseMarketSizeMagnitude("$50k"), 50_000);
  assert.equal(plannerParseMarketSizeMagnitude("$3 B market"), 3_000_000_000);
});

test("this fix corrects the exact real-report nesting check that Scenario D/no-fabrication above exercise with clean fixtures: with the raw real TAM/SAM text, samResolved now correctly reflects the TRUE parsed magnitudes instead of citation-tag-corrupted ones", () => {
  const realTam = "USD 1.5 billion (U.S., 2024 baseline from Emergen Research) [R12].";
  const realSam =
    "USD 375 million — explicit Planning inputs: serviceable mid-market share = 25% of TAM (assumption stated due to lack of mid-market-only disaggregation in sources).";

  const tamMagnitude = parseMarketSizingMagnitude(realTam);
  const samMagnitude = parseMarketSizingMagnitude(realSam);
  assert.equal(tamMagnitude, 1_500_000_000);
  assert.equal(samMagnitude, 375_000_000);

  const cascade = resolveMarketSizingCascade([tamMagnitude, samMagnitude, null]);
  assert.equal(cascade.tamResolved, true);
  assert.equal(cascade.samResolved, true, "SAM ($375M) is genuinely <= TAM ($1.5B) once both are parsed correctly");
  assert.equal(cascade.somResolved, false, "SOM has no parseable figure in this report -- correctly unresolved");
});
