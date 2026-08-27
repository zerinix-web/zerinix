import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { buildMarketIntelligenceGraph } from "../app/lib/ai/market-intelligence-graph.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const routeSource = readFileSync(`${repoRoot}app/api/market-analysis/route.ts`, "utf8");
const pageSource = readFileSync(`${repoRoot}app/dashboard/[id]/page.tsx`, "utf8");

// P0 PRODUCTION FIX -- root-cause fixes for the remaining cross-section
// evidence propagation and PDF presentation integrity issues:
//
// 1. MARKET SIZE -> TAM EVIDENCE PROPAGATION: a validated Market Size
//    figure (e.g. $131.6B) rendered next to an unresolved "TAM:
//    Validation Needed" with no deterministic connection between them --
//    the model's own tamSamSom prompt already instructs it to build TAM
//    from a compatible verified figure, but nothing enforced this
//    deterministically at the code level, so a report could show a
//    validated total with no code-level guarantee it would ever be
//    reconciled into TAM. Fixed with a new, narrow, deterministic
//    post-processing step (propagateVerifiedMarketSizeIntoTam,
//    route.ts) that: (a) never fires when a geography conflict is
//    detected between the verified evidence's own scope and the
//    requested market (verifiedMarketSizeGeographyConflict, computed
//    once at graph-build time from the exact same
//    evidenceConflictsWithRequestedGeography rule buildPlanningEstimate
//    already relies on), (b) never overwrites a TAM value the model
//    already resolved on its own (checked via the SAME canonical
//    extractMarketSizingLayerValue/parseMarketSizingMagnitude the web
//    report and PDF use to decide "resolved"), and (c) never derives or
//    invents SAM/SOM from the propagated figure -- only TAM, clearly
//    labeled "Evidence-Supported", carrying the same evidence IDs
//    already shown in the Market Size section.
//
// 2. MAJOR PLAYERS -> COMPETITIVE LANDSCAPE PROPAGATION: reworded
//    describeCompetitiveCoverage's "adjacent players evidenced, no
//    direct competitor validated" message to NAME the evidence-supported
//    incumbents directly in Competitive Landscape itself (not only via
//    a pointer to Major Players), while explicitly listing the missing
//    structured attributes (category, strengths, weaknesses, market
//    share, pricing) as requiring validation -- never fabricating any
//    of them, never claiming validated DIRECT-competitor status.
//
// 4. CONFIDENCE GAUGE COHERENCE: SnapshotGauge's `value ?? 0` treated a
//    genuinely unknown confidence (null) as the NUMBER 0 for its ring-
//    fill computation -- the center digit already correctly showed
//    "--", but the ring's fill fraction was computed as if a real 0%
//    score existed. Fixed to render a flat, neutral ring with no
//    value-derived fill fraction at all when the score is unknown.

// ===========================================================================
// 1. Market Size -> TAM propagation
// ===========================================================================

const checkedAt = "2026-08-27T00:00:00.000Z";
function officialMarketSizeEvidence(overrides) {
  return {
    id: "MS1",
    field: "market_size",
    claim: "",
    value: "",
    label: "Verified from official source",
    sourceTitle: "",
    publisher: "",
    url: "",
    sourceType: "official_statistics",
    authorityLevel: "primary",
    confidence: 90,
    publishedDate: "2026-01-10",
    lastChecked: checkedAt,
    supportingData: [],
    impact: "neutral",
    impactReason: "Supports verified market size.",
    qualityScore: 92,
    qualityRationale: "Primary government statistics.",
    searchQuery: "",
    ...overrides,
  };
}

test("TAM1: verifiedMarketSizeGeographyConflict is null when the verified evidence's own geography matches the request", () => {
  const evidence = [
    officialMarketSizeEvidence({
      claim: "The U.S. property management services market size was $131.6 billion in 2024, per Census Bureau statistics.",
      value: "$131.6 billion",
      sourceTitle: "U.S. Census Bureau Services Annual Survey",
      publisher: "U.S. Census Bureau",
      url: "https://www.census.gov/property-management",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "Evaluate the United States property management services market.");
  assert.ok(graph.verifiedMarketSize.length > 0);
  assert.equal(graph.verifiedMarketSizeGeographyConflict, null);
});

test("TAM2 (no evidence-standard weakening, regression guard): verifiedMarketSizeGeographyConflict correctly names the conflicting geography when the verified evidence is scoped to a DIFFERENT specific country than requested", () => {
  const evidence = [
    officialMarketSizeEvidence({
      claim: "The United Kingdom property management services market size was £45 billion in 2024, per ONS statistics.",
      value: "£45 billion",
      sourceTitle: "UK Office for National Statistics",
      publisher: "ONS",
      url: "https://www.ons.gov.uk/property-management",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "Evaluate the United States property management services market.");
  assert.ok(graph.verifiedMarketSize.length > 0);
  assert.equal(graph.verifiedMarketSizeGeographyConflict, "United Kingdom");
});

test("TAM3: the reworded Market/Industry Baseline explanation names the specific conflicting geography deterministically when one is detected, instead of a generic explanation", async () => {
  const { buildMarketIntelligenceGraph: buildGraph, projectMarketIntelligenceGraphToReport } = await import(
    "../app/lib/ai/market-intelligence-graph.ts"
  );
  const evidence = [
    officialMarketSizeEvidence({
      claim: "The United Kingdom property management services market size was £45 billion in 2024, per ONS statistics.",
      value: "£45 billion",
      sourceTitle: "UK Office for National Statistics",
      publisher: "ONS",
      url: "https://www.ons.gov.uk/property-management",
    }),
  ];
  const graph = buildGraph({ evidence }, "Evaluate the United States property management services market.");
  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.match(projection.marketSize, /specifically scoped to United Kingdom/i, "the baseline explanation must name the specific conflicting geography deterministically");
});

async function compileRouteFunction(names, header = "") {
  const pieces = names.map((name) => `export ${extractFunctionSource(routeSource, name)}`);
  const dir = mkdtempSync(join(tmpdir(), "zerinix-tam-propagation-"));
  const outPath = join(dir, "bundle.ts");
  writeFileSync(outPath, `${header}${pieces.join("\n\n")}\n`);
  return import(pathToFileURL(outPath).href);
}

function extractFunctionSource(source, name) {
  const idx = source.indexOf(`function ${name}(`);
  const parenStart = source.indexOf("(", idx);
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < source.length; i++) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        parenEnd = i;
        break;
      }
    }
  }
  const braceStart = source.indexOf("{", parenEnd);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(idx, i + 1);
    }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

const canonicalSizingHeader = `import { extractMarketSizingLayerValue, parseMarketSizingMagnitude } from ${JSON.stringify(
  pathToFileURL(join(repoRoot, "app/lib/report-presentation.ts")).href
)};
import { extractMarketAmount } from ${JSON.stringify(
  pathToFileURL(join(repoRoot, "app/lib/ai/market-intelligence-graph.ts")).href
)};
type ResponseLanguage = "English" | "Turkish" | "German" | "French" | "Spanish";
type MarketIntelligenceGraph = any;
`;

test("TAM4: the exact reported scenario -- a $131.6B verified Market Size, scope matches, model's own TAM is unresolved ('Validation Needed') -- TAM is deterministically propagated, clearly labeled, evidence-linked, and the model's own SAM/SOM discussion is fully preserved with no fabrication", async () => {
  const { propagateVerifiedMarketSizeIntoTam } = await compileRouteFunction(
    ["propagateVerifiedMarketSizeIntoTam"],
    canonicalSizingHeader
  );

  const graph = {
    verifiedMarketSize: [{ description: "$131.6 billion", evidenceIds: ["R12"], confidenceScore: 82, confidenceLevel: "High" }],
    verifiedMarketSizeGeographyConflict: null,
  };
  const tamSamSomText = [
    "TAM / SAM / SOM Breakdown:",
    "Method: Top-down | Geography: United States | Year: 2026",
    "TAM: Validation Needed",
    "SAM: Pending TAM Validation",
    "SOM: Pending SAM Validation",
  ].join("\n");

  const result = propagateVerifiedMarketSizeIntoTam(tamSamSomText, graph, "English");
  assert.match(result, /^TAM \[Evidence-Supported.*\]: \$131\.6 billion \| Evidence: \[R12\]/);
  assert.match(result, /TAM \/ SAM \/ SOM Breakdown:/, "the heading line must survive untouched");
  assert.doesNotMatch(result, /TAM: Validation Needed/, "the model's own now-superseded unresolved TAM line must be removed, not left dangling below the new one");
  assert.match(result, /SAM: Pending TAM Validation/, "SAM must survive completely untouched -- never derived from the propagated TAM");
  assert.match(result, /SOM: Pending SAM Validation/, "SOM must survive completely untouched -- never derived from the propagated TAM");
});

test("TAM5 (no evidence-standard weakening, regression guard): when the verified evidence's geography conflicts with the request, TAM is left completely unchanged -- the validated figure is never forced into TAM", async () => {
  const { propagateVerifiedMarketSizeIntoTam } = await compileRouteFunction(
    ["propagateVerifiedMarketSizeIntoTam"],
    canonicalSizingHeader
  );

  const graph = {
    verifiedMarketSize: [{ description: "£45 billion", evidenceIds: ["R7"], confidenceScore: 80, confidenceLevel: "High" }],
    verifiedMarketSizeGeographyConflict: "United Kingdom",
  };
  const tamSamSomText = "TAM: Validation Needed\nSAM: Pending TAM Validation\nSOM: Pending SAM Validation";
  const result = propagateVerifiedMarketSizeIntoTam(tamSamSomText, graph, "English");
  assert.equal(result, tamSamSomText, "TAM must remain byte-identical when scope does not match");
});

test("TAM6 (no evidence-standard weakening, regression guard): when the model already derived a real, parseable TAM of its own, the verified Market Size figure is NEVER used to overwrite it", async () => {
  const { propagateVerifiedMarketSizeIntoTam } = await compileRouteFunction(
    ["propagateVerifiedMarketSizeIntoTam"],
    canonicalSizingHeader
  );

  const graph = {
    verifiedMarketSize: [{ description: "$131.6 billion", evidenceIds: ["R12"], confidenceScore: 82, confidenceLevel: "High" }],
    verifiedMarketSizeGeographyConflict: null,
  };
  const tamSamSomText = "TAM [Estimated]: $2.4B\nSAM [Estimated]: $600M\nSOM: Validation Needed";
  const result = propagateVerifiedMarketSizeIntoTam(tamSamSomText, graph, "English");
  assert.equal(result, tamSamSomText, "an already-resolved TAM must never be overwritten by the verified Market Size figure");
});

test("TAM7 (no evidence-standard weakening, regression guard): SAM and SOM are NEVER derived, estimated, or invented from the propagated TAM figure -- the function only ever touches the TAM line", () => {
  const body = extractFunctionSource(routeSource, "propagateVerifiedMarketSizeIntoTam");
  assert.doesNotMatch(body, /\bSAM\b\s*[:=]/, "the function body must never construct or assign a SAM value");
  assert.doesNotMatch(body, /\bSOM\b\s*[:=]/, "the function body must never construct or assign a SOM value");
});

test("TAM8: source drift check -- propagateVerifiedMarketSizeIntoTam is actually wired into applySharedMarketGraph's merged.tamSamSom field", () => {
  const wireIdx = routeSource.indexOf("merged.tamSamSom = propagateVerifiedMarketSizeIntoTam(merged.tamSamSom, graph, language);");
  assert.ok(wireIdx !== -1, "propagateVerifiedMarketSizeIntoTam must be called on merged.tamSamSom inside applySharedMarketGraph");
});

test("TAM9: the graph exposes verifiedMarketSizeGeographyConflict as a real, computed field -- not a stub -- reusing evidenceConflictsWithRequestedGeography", () => {
  const graphSource = readFileSync(`${repoRoot}app/lib/ai/market-intelligence-graph.ts`, "utf8");
  assert.match(graphSource, /verifiedMarketSizeGeographyConflict: string \| null;/);
  assert.match(graphSource, /const verifiedMarketSizeGeographyConflict = \(\(\) => \{/);
  assert.match(graphSource, /evidenceConflictsWithRequestedGeography\(anchor, requestedGeography\)/);
});

// ===========================================================================
// 2. Major Players -> Competitive Landscape: named companies + explicit gaps
// ===========================================================================

test("COMPLANDSCAPE-NAMED1: the exact reported scenario -- CBRE, JLL, and Cushman & Wakefield are evidence-supported (Major Players) but the strict direct-competitor bar isn't cleared -- Competitive Landscape names all three directly, explicitly lists the missing structured attributes, and never fabricates any of them", async () => {
  const { buildMarketIntelligenceGraph: buildGraph, projectMarketIntelligenceGraphToReport } = await import(
    "../app/lib/ai/market-intelligence-graph.ts"
  );
  let idc = 0;
  const ev = (overrides) => {
    idc += 1;
    return {
      id: `NC${idc}`,
      field: "industry_structure",
      claim: "",
      value: "",
      label: "Verified from external source",
      sourceTitle: "Industry structure analysis",
      publisher: "Sector Analytics",
      url: "https://www.sectoranalytics.example/cre-structure",
      sourceType: "credible_market_data",
      authorityLevel: "secondary",
      confidence: 28,
      publishedDate: "2026-01-10",
      lastChecked: checkedAt,
      supportingData: [],
      impact: "neutral",
      impactReason: "x",
      qualityScore: undefined,
      qualityRationale: "x",
      searchQuery: "",
      ...overrides,
    };
  };
  const evidence = [
    ev({
      claim:
        "The leading commercial real estate services firms are CBRE, JLL, and Cushman & Wakefield, reflecting rising platform concentration among incumbents.",
      value: "Incumbent concentration finding",
    }),
  ];
  const graph = buildGraph({ evidence }, "Evaluate the mature U.S. commercial real estate services market.");
  assert.equal(graph.vendorIntelligence.vendors.length, 0, "fixture must not clear the strict direct-competitor bar");
  const adjacentNames = graph.vendorIntelligence.adjacentPlayers.map((p) => p.name).sort();
  assert.deepEqual(adjacentNames, ["CBRE", "Cushman & Wakefield", "JLL"]);

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  for (const name of ["CBRE", "JLL", "Cushman & Wakefield"]) {
    assert.ok(
      projection.competitiveLandscape.includes(name),
      `Competitive Landscape must directly name ${name}, got: ${projection.competitiveLandscape}`
    );
  }
  for (const attribute of ["category", "strengths", "weaknesses", "market share", "pricing"]) {
    assert.ok(
      projection.competitiveLandscape.toLowerCase().includes(attribute),
      `Competitive Landscape must explicitly name "${attribute}" as a missing structured attribute`
    );
  }
  // No fabricated numeric figures (market share percentages, pricing
  // dollar amounts) anywhere in the Competitive Landscape text.
  assert.doesNotMatch(projection.competitiveLandscape, /\$\d/);
  assert.doesNotMatch(projection.competitiveLandscape, /\d+(?:\.\d+)?%/);
});

// ===========================================================================
// 4. Confidence gauge coherence -- no fabricated numeric implication
// ===========================================================================

test("GAUGE1: SnapshotGauge no longer treats an unknown (null) confidence as the number 0 for its ring-fill computation", () => {
  const fnSource = extractFunctionSource(pageSource, "SnapshotGauge");
  assert.doesNotMatch(
    fnSource,
    /const safeValue = value \?\? 0;/,
    "the old null-as-zero coercion must be removed"
  );
  assert.match(fnSource, /const hasNoScore = value === null;/);
  assert.match(
    fnSource,
    /background: hasNoScore\s*\n\s*\? "rgba\(255,255,255,0\.08\)"\s*\n\s*: `conic-gradient/,
    "an unknown score must render a flat, neutral ring with no value-derived fill fraction at all"
  );
});

test("GAUGE2 (no regression): a real, known confidence score still renders its actual proportional ring fill and the actual number in the center", () => {
  const fnSource = extractFunctionSource(pageSource, "SnapshotGauge");
  assert.match(fnSource, /\{hasNoScore \? "--" : value\}/);
  assert.match(fnSource, /\$\{value \* 3\.6\}deg/);
});

test("GAUGE3: 'Unknown' (the exact substring the pre-existing forbidden-placeholder test scans for) does not appear anywhere in page.tsx as a result of this fix", () => {
  assert.doesNotMatch(pageSource, /Unknown/);
});
