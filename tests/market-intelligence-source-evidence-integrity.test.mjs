import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inferEvidenceLevel } from "../app/lib/report-evidence.ts";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";

// P0 FIX #5 -- Market Intelligence source/evidence integrity repair.
//
// ROOT CAUSES (confirmed via forensic trace, research/evidence -> extraction
// -> canonical report data -> section confidence/status -> UI presentation):
//
// 1. CLAIM-EVIDENCE MISMATCH on the Market Metrics (CAGR/Market Size) card.
//    graph.cagr (market-intelligence-graph.ts) computes confidenceClassification
//    PER EVIDENCE ITEM -- a market can legitimately have one [Estimated]
//    ("forecast to grow at...") and one [Verified] ("industry sources
//    confirm a growth rate of...") line for the SAME metric. The projected
//    `cagr` field text then contains BOTH tags on separate lines.
//    extractHeadlineCagrValue grabs the FIRST percentage found in that
//    text (research-discovery order, not sorted by classification), but
//    getDashboardMetricEvidence -> inferEvidenceLevel (report-evidence.ts)
//    scanned the ENTIRE multi-line content for the bare word "verified" --
//    so whenever the [Verified] line happened to sit anywhere in the same
//    field, the card showed "Data Confirmed" even when the headline value
//    on screen actually came from the [Estimated] line. A source
//    supporting a DIFFERENT claim was confirming this one.
//
// 2. FALSE "DATA CONFIRMED" VIA GENERIC/NEGATIVE TEXT LEAKING THE WORD
//    "verified" INTO A REPORT-WIDE SCAN. page.tsx's Decision Signal/
//    Decision Confidence KPI cards fall back to `fullContent` (every
//    section's text, concatenated) when Market Intelligence has no
//    separate `executiveRecommendation` field, then run the SAME
//    inferEvidenceLevel keyword scan. Several canonical, correctly-labeled
//    strings elsewhere in the report use the bare word "verified" to
//    describe an ABSENCE or an explicit non-confirmation --
//    market-intelligence-graph.ts's planningEstimateTitle ("not externally
//    verified market size", rendered on EVERY Planning-Estimate report,
//    not just failures), tamSamSomUnavailable/marketSizeUnavailable ("A
//    verified market-size figure ... could not be established"), route.ts's
//    insufficientEvidenceFallbackTemplates/missingMarketSizeBenchmarkReason
//    (an honest "insufficient evidence" notice), and notVerifiedReplacement
//    ("Not verified", a programmer-artifact cleanup value). The scanner
//    has no negation awareness, so each of these -- meant to say evidence
//    was NOT confirmed -- was read as proof the unrelated KPI card's
//    decision/confidence value WAS confirmed. This fired on the single
//    most common report shape (any [Estimated] Planning Estimate) and,
//    worst of all, fired MORE often the more uncertain a gated decision
//    (P0 FIX #4) was, since its own gap explanation said "...evidence".
//
// FIX:
// 1. page.tsx: a new extractEvidenceLineForValue(content, value) isolates
//    evidence-level detection to the single line that actually produced
//    the displayed headline value (falling back to the full content only
//    when no single line contains it), used at the Market Metrics card's
//    getDashboardMetricEvidence call site.
// 2. Five canonical, English-only strings reworded from "verified" to
//    "confirmed" (identical meaning, no trigger-word collision):
//    market-intelligence-graph.ts's planningEstimateTitle,
//    tamSamSomUnavailable, marketSizeUnavailable; route.ts's
//    insufficientEvidenceFallbackTemplates.English,
//    missingMarketSizeBenchmarkReason.English, notVerifiedReplacement's
//    English value. inferEvidenceLevel/report-evidence.ts itself, and
//    every OTHER report kind's use of it, is completely untouched --
//    genuinely verified content (verifiedMarketSizeTitle, "Validated
//    competitor comparison", real invoice/bank/audited financial evidence)
//    still says so and still classifies as "verified".

const checkedAt = "2026-08-26T00:00:00.000Z";

function verifiedEvidence({ id, field, claim, value }) {
  return {
    id,
    field,
    claim,
    value,
    label: "Verified from external source",
    sourceTitle: "Independent market research publisher",
    publisher: "Independent Research Co.",
    url: `https://research-example.com/reports/${id}`,
    sourceType: "credible_market_data",
    authorityLevel: "secondary",
    confidence: 78,
    publishedDate: "2026-01-10",
    lastChecked: checkedAt,
    supportingData: [],
    impact: "neutral",
    impactReason: "",
  };
}

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");

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

async function loadExtractEvidenceLineForValue() {
  const body = `export ${extractFunctionSource(pageSource, "extractEvidenceLineForValue")}`;
  const dir = mkdtempSync(join(tmpdir(), "zerinix-evidence-line-"));
  const outPath = join(dir, "extractEvidenceLineForValue.ts");
  writeFileSync(outPath, `${body}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractEvidenceLineForValue;
}

// ---------------------------------------------------------------------------
// Root cause #1: claim-evidence mismatch on a multi-item CAGR field
// ---------------------------------------------------------------------------

test("REGRESSION (root cause #1): a CAGR field with one [Estimated] and one [Verified] evidence line -- extracting the headline value from the [Estimated] line must NOT classify as 'verified' merely because a [Verified] line exists elsewhere in the same field", () => {
  const prompt = "Market Intelligence report on the AI coding-assistant market.";
  const evidence = [
    // Contains "forecast" -> classifies Estimated despite isVerified(item).
    verifiedEvidence({
      id: "R1",
      field: "market_growth",
      claim: "The market is forecast to grow at a compound annual growth rate of 15% through 2030.",
      value: "Forecast CAGR of 15%",
    }),
    // No forecast/estimate language -> classifies Verified.
    verifiedEvidence({
      id: "R2",
      field: "market_growth",
      claim: "Industry sources report the market has a compound annual growth rate of 8%, sourced from an independent research firm.",
      value: "CAGR of 8%",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  assert.equal(graph.cagr.length, 2, "sanity check: both evidence items must independently qualify for graph.cagr");
  assert.equal(graph.cagr[0].confidenceClassification, "Estimated");
  assert.equal(graph.cagr[1].confidenceClassification, "Verified");

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.match(projection.cagr, /\[Estimated\]/);
  assert.match(projection.cagr, /\[Verified\]/);

  // extractHeadlineCagrValue's own regex (mirrored here, pinned against
  // source in the PARITY test below) finds the FIRST percentage in the
  // text -- the [Estimated] line, since it appears first.
  const match = projection.cagr.match(/\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?)?\s*%/);
  const headlineValue = match[0];
  assert.equal(headlineValue, "15%", "sanity check: the extracted headline must be the Estimated line's figure, not the Verified one");

  // BEFORE the fix (whole-content scan): would read "verified" from the
  // OTHER line and misclassify.
  const beforeFix = inferEvidenceLevel({
    label: "CAGR",
    value: headlineValue,
    context: projection.cagr,
  });
  assert.equal(beforeFix, "verified", "sanity check: an unscoped whole-field scan does misclassify -- this proves the bug is real");

  // AFTER the fix: scoped to the single line containing the headline value.
  const lines = projection.cagr.split("\n");
  const matchingLine = lines.find((line) => line.includes(headlineValue));
  assert.match(matchingLine, /\[Estimated\]/);
  const afterFix = inferEvidenceLevel({ label: "CAGR", value: headlineValue, context: matchingLine });
  assert.notEqual(afterFix, "verified", "the [Estimated] line's own figure must never classify as verified merely because a different line elsewhere is Verified");
});

test("extractEvidenceLineForValue isolates the single line containing the extracted value, and falls back to full content when no line contains it", async () => {
  const extractEvidenceLineForValue = await loadExtractEvidenceLineForValue();

  const multiLine = "- [Estimated] Forecast CAGR of 15% through 2030 | Confidence: 55/100 (Medium) | Evidence: [R1]\n- [Verified] CAGR of 8%, independently reported | Confidence: 82/100 (High) | Evidence: [R2]";
  assert.match(extractEvidenceLineForValue(multiLine, "15%"), /\[Estimated\]/);
  assert.match(extractEvidenceLineForValue(multiLine, "8%"), /\[Verified\]/);

  // No matching line -> fall back to the full content unchanged.
  assert.equal(extractEvidenceLineForValue(multiLine, "42%"), multiLine);
  // No value at all (empty headline) -> fall back to the full content.
  assert.equal(extractEvidenceLineForValue(multiLine, ""), multiLine);
});

test("PARITY: the Market Metrics card (CAGR/Market Size) now scopes getDashboardMetricEvidence's context to extractEvidenceLineForValue(content, value), not the raw multi-line content", () => {
  // P0 FIX #8 -- confirmed live (CAGR scope/KPI semantics repair): a
  // multi-estimate CAGR range is forced to "benchmarkDerived" before
  // reaching the classifier below (no single evidence line supports a
  // two-number range); the single-estimate case this test protects still
  // routes through this exact pinned getDashboardMetricEvidence(...) call.
  assert.match(
    pageSource,
    /const evidence =\s*\n\s*isCagr && cagrPresentation\?\.isMultiEstimate\s*\n\s*\?\s*\("benchmarkDerived" as const\)\s*\n\s*:\s*getDashboardMetricEvidence\(\s*\n\s*isCagr \? "CAGR" : "Market Size",\s*\n\s*value,\s*\n\s*extractEvidenceLineForValue\(content, value\)\s*\n\s*\);/
  );
});

// ---------------------------------------------------------------------------
// Root cause #2: negative/generic text leaking the word "verified"
// ---------------------------------------------------------------------------

test("REGRESSION (root cause #2): an honest 'evidence not confirmed' notice no longer contains the bare word 'verified' -- a report-wide scan of that notice must not misclassify an unrelated card as confirmed", () => {
  const graphSource = readFileSync("app/lib/ai/market-intelligence-graph.ts", "utf8");
  const routeSource = readFileSync("app/api/market-analysis/route.ts", "utf8");

  const rewordedStrings = [
    { name: "planningEstimateTitle", pattern: /planningEstimateTitle: "Planning Estimate — not externally confirmed market size"/, source: graphSource },
    { name: "tamSamSomUnavailable", pattern: /"A confirmed market-size figure \(TAM \/ SAM \/ SOM\) could not be established for this market\./, source: graphSource },
    { name: "marketSizeUnavailable", pattern: /No confirmed local figure, comparable benchmark, or sufficient buyer-population-and-pricing data/, source: graphSource },
    { name: "insufficientEvidenceFallbackTemplates.English", pattern: /`\$\{label\}: Insufficient confirmed evidence\. \$\{reason\} The rest of this report remains based on independently confirmed evidence/, source: routeSource },
    { name: "missingMarketSizeBenchmarkReason.English", pattern: /"No confirmed local market-size figure and no adjacent regional or global benchmark data were found in this run\."/, source: routeSource },
    { name: "notVerifiedReplacement English value", pattern: /"Not confirmed",\s*\n\s*"Doğrulanmadı"/, source: routeSource },
  ];

  for (const { name, pattern, source } of rewordedStrings) {
    assert.match(source, pattern, `${name} must use the reworded "confirmed" text`);
  }

  // Directly prove the old trigger word is gone from each specific string
  // (not just that the new one is present) by checking the exact old
  // phrases no longer appear anywhere in either file.
  assert.doesNotMatch(graphSource, /not externally verified market size/);
  assert.doesNotMatch(graphSource, /A verified market-size figure \(TAM \/ SAM \/ SOM\) could not be established/);
  assert.doesNotMatch(graphSource, /No verified local figure, comparable benchmark/);
  assert.doesNotMatch(routeSource, /Insufficient verified evidence/);
  assert.doesNotMatch(routeSource, /independently verified evidence -- this section alone/);
  assert.doesNotMatch(routeSource, /No verified local market-size figure and no adjacent/);
  assert.doesNotMatch(routeSource, /"Not verified",/);
});

test("REGRESSION (root cause #2, P0 FIX #4 interaction): the market-sizing decision-critical gap explanation no longer contains the bare word 'verified'", () => {
  const presentationSource = readFileSync("app/lib/report-engine/market-intelligence-presentation.ts", "utf8");
  assert.match(
    presentationSource,
    /"A defensible market-size figure \(TAM\/SAM\/SOM\) could not be established from independently confirmed evidence/
  );
  assert.doesNotMatch(presentationSource, /could not be established from independently verified evidence/);
});

test("genuinely verified content is untouched: verifiedMarketSizeTitle and the validated-competitor-comparison title still correctly say so -- this fix removes false positives, it never weakens or hides real verified evidence", () => {
  const graphSource = readFileSync("app/lib/ai/market-intelligence-graph.ts", "utf8");
  assert.match(graphSource, /verifiedMarketSizeTitle: "Verified market-size evidence"/);
  assert.match(graphSource, /competitorComparisonTitle: "Validated competitor comparison"/);
});

test("DRIFT CHECK: inferEvidenceLevel (report-evidence.ts) itself, and its use by every OTHER report kind, is completely unmodified -- this is a wording fix at the call sites that leak into Market Intelligence content, never a change to the shared evidence classifier", () => {
  const evidenceSource = readFileSync("app/lib/report-evidence.ts", "utf8");
  assert.match(
    evidenceSource,
    /if \(\/\\b\(derived from\|derived value\|calculated from the \(\?:verified\|user\[\\s-\]\?provided\)\)\\b\/i\.test\(evidenceContext\)\) \{/
  );
  assert.match(
    evidenceSource,
    /if \(\/\\b\(verified\|actual\|audited\|invoice\|bookkeeping\|accounting\|bank\|stripe\)\\b\/i\.test\(evidenceContext\)\) \{/
  );
  // Real verified financial evidence (invoice/bank/stripe/audited) must
  // still classify as verified -- proves the shared classifier itself is
  // untouched and still correctly confirms genuine evidence.
  assert.equal(
    inferEvidenceLevel({ label: "MRR", value: "$12,000", context: "Confirmed from Stripe invoice records." }),
    "verified"
  );
});

// ---------------------------------------------------------------------------
// Planning estimates remain distinguishable from verified market data
// ---------------------------------------------------------------------------

test("a Planning Estimate ([Estimated] tag) and a fully verified market size ([Verified] tag) remain classified distinctly and correctly -- the wording fix only removes the false-positive trigger word, it does not blur the Verified/Estimated distinction", () => {
  const estimatedLine = "TAM [Estimated]: $4.2 billion based on a regional benchmark scaling assumption.";
  const verifiedLine = "- [Verified] Global market size: $2.1 billion in 2025 | Confidence: 81/100 (High) | Evidence: [R1]";

  assert.notEqual(inferEvidenceLevel({ label: "TAM", value: "$4.2 billion", context: estimatedLine }), "verified");
  assert.equal(inferEvidenceLevel({ label: "Market Size", value: "$2.1 billion", context: verifiedLine }), "verified");
});

// ---------------------------------------------------------------------------
// UI/PDF evidence-status consistency (Section 8)
// ---------------------------------------------------------------------------

const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

test("PARITY: ReportPdfButton.tsx does not implement a separate, independent evidence-status keyword scanner for CAGR/Market Size -- it renders only the bare extracted value (extractHeadlineCagrValue/extractHeadlineMonetaryValue), never its own competing 'verified'/'Data Confirmed' classification that could disagree with the web card", () => {
  assert.doesNotMatch(pdfButtonSource, /getDashboardMetricEvidence/);
  assert.doesNotMatch(pdfButtonSource, /inferEvidenceLevel/);
});

// ---------------------------------------------------------------------------
// Drift checks: P0 FIX #1-#4 remain intact
// ---------------------------------------------------------------------------

test("DRIFT CHECK: P0 FIX #1 (TAM/SAM/SOM), #2 (CAGR), #3 (Competitive Landscape/Major Players), and #4 (executive decision gate) canonical logic is untouched by this pass", () => {
  const reportPresentationSource = readFileSync("app/lib/report-presentation.ts", "utf8");
  assert.match(reportPresentationSource, /export function resolveMarketSizingCascade\(/);
  assert.match(pdfButtonSource, /const cascade = resolveMarketSizingCascade\(magnitudes\);/);

  const routeSource = readFileSync("app/api/market-analysis/route.ts", "utf8");
  assert.match(routeSource, /if \(field === "cagr"\) \{/);
  assert.match(
    routeSource,
    /excludedFields:\s*\[\s*"strategicRecommendations",\s*"tamSamSom",\s*"executiveSummary",\s*"competitiveLandscape",\s*"majorPlayers",\s*"cagr",?\s*\]/
  );
  assert.match(routeSource, /marketSizingResolved:\s*\n\s*graph\.planningEstimate !== null \|\| graph\.verifiedMarketSize\.length > 0,/);

  const graphSource = readFileSync("app/lib/ai/market-intelligence-graph.ts", "utf8");
  assert.match(graphSource, /adjacentPlayersAlongsideValidatedVendors/);

  const vendorDiscoverySource = readFileSync("app/lib/ai/vendor-discovery.ts", "utf8");
  assert.match(vendorDiscoverySource, /official_product_page_plus_independent_source/);

  const presentationSource = readFileSync("app/lib/report-engine/market-intelligence-presentation.ts", "utf8");
  assert.match(
    presentationSource,
    /marketConfidence \* 0\.4 \+\s*\n\s*competitiveEvidence \* 0\.25 \+\s*\n\s*financialEvidence \* 0\.2 \+\s*\n\s*productEvidence \* 0\.15/
  );
  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
  // quality failure): reads from rawConfidence (the uncapped blend)
  // now, not `confidence` -- thresholds unchanged.
  assert.match(
    presentationSource,
    /rawConfidence >= 65 \? "ENTER" : rawConfidence >= 40 \? "MONITOR" : "AVOID"/
  );
});
