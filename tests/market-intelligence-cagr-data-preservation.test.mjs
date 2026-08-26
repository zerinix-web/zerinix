import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import { dedupeReportParagraphsAcrossSections } from "../app/lib/report-content-quality.mjs";

// P0 FIX #2 -- CAGR data preservation and rendering.
//
// ROOT CAUSE (confirmed via forensic trace, research -> graph -> report
// normalization -> web/PDF): cagr sits immediately after marketSize in
// marketReportFields, and per its own prompt (marketPrompts.cagr) the model
// is expected to name the same growth percentage marketOverview/
// executiveSummary may already mention in scene-setting prose (e.g. "the
// market is growing at 12.4% CAGR"). cagr was NOT in
// dedupeReportParagraphsAcrossSections' excludedFields (route.ts), unlike
// its siblings tamSamSom/executiveSummary/competitiveLandscape/majorPlayers,
// which received this exact protection for the identical bug class. When
// cagr's own paragraph shared enough tokens and the SAME numbers with an
// earlier field's paragraph, cross-section fuzzy-dedup collapsed the entire
// cagr field into a bare "See <field> for the established premise" stub --
// a stub with zero digits in it. extractHeadlineCagrValue (page.tsx /
// ReportPdfButton.tsx) then correctly found no percentage in that stub and
// rendered "Validation Needed", even though the original text stated a
// real, sourced (or honestly [Estimated]) figure.
//
// A second, independent defect was found and fixed: describeMissingMarketEvidence
// used to lump "cagr" into marketSizeBenchmarkDependentFields, so a degraded
// cagr section was always explained by "no verified market size / no
// benchmark" -- TAM-related signals that say nothing about whether CAGR's
// OWN evidence (graph.cagr) existed. cagr now names its own evidence gap.
//
// FIX: (1) route.ts's dedupeReportParagraphsAcrossSections call now
// excludes "cagr", exactly like its siblings. (2) describeMissingMarketEvidence
// now branches on graph.cagr.length for the "cagr" field specifically,
// instead of reusing marketSize's benchmark signal.
//
// NOT changed (deliberately): graph.cagr's own evidence extraction filter
// (keyword+percentage co-occurrence, confidence >= 48) and
// projectMarketIntelligenceGraphToReport's "if (graph.cagr.length > 0)"
// branch structure. There is no deterministic "planning estimate" analog
// for CAGR the way there is for TAM/SAM/SOM -- the model's own prompt
// (marketPrompts.cagr) already instructs it to write an honest
// [Estimated] adjacent-benchmark figure or an explicit gap statement when
// graph.cagr is empty. Overwriting that unconditionally with a
// deterministic fallback would risk discarding a legitimate model-derived
// directional estimate, which the ticket's own CASE B explicitly protects.

const routeSource = readFileSync("app/api/market-analysis/route.ts", "utf8");
const graphSource = readFileSync("app/lib/ai/market-intelligence-graph.ts", "utf8");
const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

const checkedAt = "2026-08-20T00:00:00.000Z";

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

// --- CASE A: validated numeric CAGR survives the graph -> projection step -

test("CASE A: a verified CAGR evidence item (keyword + percentage co-occurring) produces a projection.cagr line carrying the numeric value, the [Verified] tag, confidence score, and evidence reference -- nothing invented, nothing dropped", () => {
  const prompt = "Market Intelligence report on the AI coding-assistant market.";
  const evidence = [
    verifiedEvidence({
      id: "R7",
      field: "market_growth",
      claim: "The AI coding-assistant market has a compound annual growth rate of 12.4% from 2025 to 2030.",
      value: "CAGR of 12.4% (2025-2030)",
    }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  assert.equal(graph.cagr.length, 1, "expected the co-occurring keyword+percentage evidence to populate graph.cagr");
  assert.equal(graph.cagr[0].confidenceClassification, "Verified");

  const projection = projectMarketIntelligenceGraphToReport(graph);
  assert.ok(projection.cagr, "projection.cagr must be populated");
  assert.match(projection.cagr, /12\.4%/, "the numeric CAGR value must survive into the projected report text");
  assert.match(projection.cagr, /\[Verified\]/);
  assert.match(projection.cagr, /\[R7\]/, "the evidence reference must survive alongside the value");
  assert.match(projection.cagr, /Confidence:\s*\d+\/100/);
});

// --- CASE B: an evidence-insufficient/estimated CAGR is never silently ----
// --- promoted to a confirmed/Verified state --------------------------------

test("CASE B: an evidence item whose own text reads as a forecast/estimate is classified Estimated, not Verified, and the projection carries the honest [Estimated] tag -- an unsupported CAGR is never upgraded to confirmed", () => {
  const prompt = "Market Intelligence report on the AI coding-assistant market.";
  const evidence = [
    verifiedEvidence({
      id: "R9",
      field: "market_growth",
      claim: "Analysts project an estimated forecast growth rate of 9.5% for the adjacent DevOps tooling category.",
      value: "Estimated CAGR proxy of 9.5%",
    }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  assert.equal(graph.cagr.length, 1);
  assert.equal(
    graph.cagr[0].confidenceClassification,
    "Estimated",
    "forecast/estimate language must classify as Estimated, never Verified"
  );

  const projection = projectMarketIntelligenceGraphToReport(graph);
  assert.match(projection.cagr, /9\.5%/, "the candidate figure must still be preserved and displayed");
  assert.match(projection.cagr, /\[Estimated\]/);
  assert.doesNotMatch(
    projection.cagr,
    /\[Verified\]/,
    "an Estimated-classification CAGR must never render with the Verified tag"
  );
});

// --- CASE C: no defensible CAGR exists -- never fabricated -----------------

test("CASE C: no evidence item has both a growth-rate keyword and a percentage co-occurring -- graph.cagr stays empty and projection.cagr is never fabricated (stays undefined, falls through to the model's own honest gap text)", () => {
  const prompt = "Market Intelligence report on the AI coding-assistant market.";
  const evidence = [
    verifiedEvidence({
      id: "R1",
      field: "market_size",
      claim: "The global market for AI coding assistants was valued at $2.1 billion in 2025.",
      value: "$2.1 billion market size, 2025",
    }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  assert.equal(graph.cagr.length, 0, "no evidence item names a growth rate, so graph.cagr must stay empty");

  const projection = projectMarketIntelligenceGraphToReport(graph);
  assert.equal(
    projection.cagr,
    undefined,
    "projection.cagr must never be set to a fabricated percentage when no defensible CAGR evidence exists"
  );
});

// --- CASE D: valid CAGR survives cross-section dedup regardless of what ----
// --- an earlier section already said (the actual production defect) --------

test("REGRESSION (production defect): a CAGR paragraph that restates the same growth sentence already stated in an earlier field (marketOverview) is no longer collapsed into a contentless cross-reference stub", () => {
  // Same sentence in both fields -- a realistic shape given marketOverview's
  // own prompt permits scene-setting growth context, and cagr's prompt
  // (marketPrompts.cagr) independently instructs the model to state the
  // growth figure with its period/geography/source. Kept byte-identical so
  // the collision is deterministic (exact-fingerprint match) rather than
  // depending on the fuzzy containment/Jaccard thresholds.
  const sharedGrowthSentence =
    "The AI coding-assistant market is growing at approximately 12.4% CAGR through 2030 across North America and Europe.";
  const report = {
    executiveSummary: "Bottom Line: Enter this market now (72% confidence). Key Findings: strong structural tailwinds.",
    marketOverview: sharedGrowthSentence,
    marketSize: "[Verified] Global market size: $2.1 billion in 2025 | Confidence: 81/100 (High) | Evidence: [R1]",
    cagr: sharedGrowthSentence,
  };

  // Simulates the OLD, unfixed call shape (cagr NOT excluded) to prove the
  // collision is real and reproducible against this exact fixture.
  const beforeFix = dedupeReportParagraphsAcrossSections(report, {
    language: "English",
    sectionLabels: { marketOverview: "Market Overview", cagr: "CAGR" },
    excludedFields: ["executiveSummary"],
  });
  assert.doesNotMatch(
    beforeFix.cagr,
    /\d+(?:\.\d+)?%/,
    "sanity check: without the fix, the near-duplicate restatement collapses cagr into a stub with no percentage left in it"
  );

  // The actual, current route.ts call shape: cagr is now excluded.
  const afterFix = dedupeReportParagraphsAcrossSections(report, {
    language: "English",
    sectionLabels: { marketOverview: "Market Overview", cagr: "CAGR" },
    excludedFields: ["executiveSummary", "cagr"],
  });
  assert.match(
    afterFix.cagr,
    /12\.4%/,
    "with cagr excluded from cross-section dedup, its real percentage must survive intact"
  );
  assert.equal(afterFix.cagr, report.cagr, "cagr's content must pass through completely unmodified");
});

test("REGRESSION: a valid CAGR paragraph survives dedup even when TAM/SAM/SOM (tamSamSom) is itself partial/unresolved elsewhere in the same report -- CAGR is never coupled to another metric's completeness", () => {
  const report = {
    marketOverview: "The market is growing at approximately 12.4% CAGR through 2030.",
    cagr: "The market is growing at approximately 12.4% CAGR through 2030, per independent research. [R7]",
    tamSamSom:
      "Planning Estimate\nTAM [Estimated]: $7.32B\nSAM [Validation Needed]: Additional market validation is required\nSOM [Validation Needed]: Additional market validation is required",
  };

  const result = dedupeReportParagraphsAcrossSections(report, {
    language: "English",
    sectionLabels: { marketOverview: "Market Overview" },
    excludedFields: ["tamSamSom", "cagr"],
  });

  assert.match(result.cagr, /12\.4%/, "CAGR must remain visible regardless of tamSamSom's own resolution state");
  assert.match(result.tamSamSom, /7\.32B/, "tamSamSom's own content is independently untouched by this fix");
});

// --- Missing CAGR correctly remains "Validation Needed" (no false positive)-

test("a stub cross-reference (the exact shape dedup produces for a collapsed field) never contains a percentage -- extractHeadlineCagrValue's regex (mirrored here and pinned against source below) correctly returns empty, which is the correct 'Validation Needed' outcome for genuinely missing data, not a bug", () => {
  const extractHeadlineCagrValue = (content) => {
    const match = (content || "").match(/\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?)?\s*%/);
    return match ? match[0].replace(/\s+/g, " ").trim() : "";
  };

  const stub = 'See "Market Overview" for the established premise. [R7]';
  assert.equal(extractHeadlineCagrValue(stub), "", "a genuine cross-reference stub has no percentage to extract");
  assert.equal(extractHeadlineCagrValue(""), "");
  assert.equal(extractHeadlineCagrValue(undefined), "");
});

// --- Web/PDF parity: identical extraction logic, same canonical field ------

test("PARITY: extractHeadlineCagrValue is byte-identical in page.tsx and ReportPdfButton.tsx, and both read from the SAME canonical `cagr` report field -- neither surface independently reparses or infers CAGR from unrelated prose", () => {
  const pattern = /function extractHeadlineCagrValue\(content: string\) \{\s*const match = \(content \|\| ""\)\.match\(\s*\/\\d\+\(\?:\[\.,\]\\d\+\)\?\(\?:\\s\*\[-–—\]\\s\*\\d\+\(\?:\[\.,\]\\d\+\)\?\)\?\\s\*%\/\s*\);\s*return match \? match\[0\]\.replace\(\/\\s\+\/g, " "\)\.trim\(\) : "";\s*\}/;

  assert.match(pageSource, pattern, "page.tsx's extractor must match the pinned shape");
  assert.match(pdfButtonSource, pattern, "ReportPdfButton.tsx's extractor must match the exact same pinned shape");
});

test("PARITY: ReportPdfButton.tsx's 'CAGR' metric tile and 'Market Growth Signal' composite both read the same `cagr` report field the web dashboard renders -- no separate PDF-only CAGR derivation exists", () => {
  assert.match(
    pdfButtonSource,
    /const cagrContent = pdfSections\.find\(\(candidate\) => candidate\.field === "cagr"\)\?\.content \|\| "";/
  );
  assert.match(pdfButtonSource, /\{ label: "CAGR", value: extractHeadlineCagrValue\(cagrContent\) \}/);
});

// --- Fix #1: cagr excluded from cross-section paragraph dedup --------------

test("route.ts: cagr is now excluded from dedupeReportParagraphsAcrossSections, alongside its siblings tamSamSom/executiveSummary/competitiveLandscape/majorPlayers -- a valid CAGR paragraph can no longer be silently collapsed into another section's cross-reference stub", () => {
  assert.match(
    routeSource,
    /excludedFields:\s*\[\s*"strategicRecommendations",\s*"tamSamSom",\s*"executiveSummary",\s*"competitiveLandscape",\s*"majorPlayers",\s*"cagr",?\s*\]/
  );
});

// --- Fix #2: cagr's degradation reason now names its own evidence gap ------

test("route.ts: describeMissingMarketEvidence now branches on graph.cagr.length for the cagr field specifically, instead of reusing marketSize's verified-size/benchmark signal -- the reason text shown when cagr genuinely has no evidence now correctly names CAGR's own gap", () => {
  assert.match(routeSource, /if \(field === "cagr"\) \{/);
  assert.match(routeSource, /const hasCagrEvidence = Boolean\(graph\?\.cagr\?\.length\);/);
  assert.match(routeSource, /missingCagrEvidenceReason\[language\]/);
});

test("route.ts: cagr is no longer a member of marketSizeBenchmarkDependentFields -- its degradation reason is decided by its own branch above, not TAM's benchmark signal", () => {
  assert.match(
    routeSource,
    /const marketSizeBenchmarkDependentFields = new Set<MarketReportField>\(\[\s*"marketSize",\s*"tamSamSom",\s*"regionalAnalysis",?\s*\]\);/
  );
});

// --- Drift check: evidence-first CAGR extraction and projection branch -----
// --- structure are completely untouched by this fix ------------------------

test("DRIFT CHECK: graph.cagr's own evidence-extraction filter (keyword+percentage co-occurrence in the SAME evidence item, confidence >= 48, isVerified) is byte-identical to before this fix -- this pass never loosens evidence standards to make the CAGR card populate", () => {
  assert.match(
    graphSource,
    /const cagr = evidence\s*\.filter\(\s*\(item\) =>\s*isVerified\(item\) &&\s*calculateEvidenceConfidence\(item\) >= 48 &&\s*\/cagr\|compound annual\|growth rate\|forecast growth\/i\.test\(\s*evidenceText\(item\)\s*\) && \/\\d\+\(\?:\\\.\\d\+\)\?\\s\*%\/\.test\(evidenceText\(item\)\)/
  );
});

test("DRIFT CHECK: projectMarketIntelligenceGraphToReport's CAGR branch structure (if graph.cagr.length > 0, map to the [tag] description | Confidence | Evidence line) is untouched -- no new else-branch was added that could overwrite the model's own honest [Estimated]/gap prose with a deterministic fallback", () => {
  assert.match(graphSource, /if \(graph\.cagr\.length > 0\) \{/);
  assert.match(
    graphSource,
    /projection\.cagr = graph\.cagr\s*\.map\(\s*\(item\) =>\s*`- \[\$\{classificationTag\(language, item\.confidenceClassification\)\}\] \$\{item\.description\}/
  );
});

test("DRIFT CHECK: P0 FIX #1 (TAM/SAM/SOM) is untouched by this pass -- resolveMarketSizingCascade and its PDF integration remain exactly as that fix left them", () => {
  const reportPresentationSource = readFileSync("app/lib/report-presentation.ts", "utf8");
  assert.match(reportPresentationSource, /export function resolveMarketSizingCascade\(/);
  assert.match(pdfButtonSource, /const cascade = resolveMarketSizingCascade\(magnitudes\);/);
});
