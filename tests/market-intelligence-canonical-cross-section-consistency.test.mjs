import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runConsistencyValidationPass } from "../app/lib/report-consistency-validation.ts";
import {
  buildMarketIntelligenceGraph,
  extractMarketAmount,
} from "../app/lib/ai/market-intelligence-graph.ts";

// P0 FIX #6 -- canonical cross-section consistency repair.
//
// ROOT CAUSE (confirmed via forensic trace, research/evidence -> canonical
// report model -> derived sections -> UI/PDF): route.ts's
// runConsistencyValidationPass call never supplied `metricTargets` for
// Market Intelligence at all. A stale comment at the call site explained
// this as "no financial model of a hypothetical company to check numbers
// against" -- true for Business Plan's CAC/LTV/ARR concepts (which
// genuinely have no Market Intelligence equivalent), but never true for
// Market Intelligence's OWN native metrics: graph.planningEstimate/
// graph.verifiedMarketSize/graph.cagr (P0 FIX #1/#2's own canonical,
// already-computed fields) ARE a real source of truth, just never
// cross-checked against every other section's own free-text restatement of
// the same figures (marketOverview, industryTrends, customerSegments,
// strategicRecommendations, etc. can each independently restate "the $X
// market" or "a CAGR of Y%" with no mechanism preventing silent drift from
// the canonical number). Business Plan already had this exact protection
// via buildPlanFinancialConsistencyTargets (plan-executor.ts) -- Market
// Intelligence simply never got its own equivalent.
//
// FIX: route.ts's new buildMarketGraphMetricConsistencyTargets(graph,
// cagrFieldText) builds the same MetricConsistencyTarget shape Business
// Plan already uses, wired into the existing, unmodified, already-tested
// runConsistencyValidationPass/correctMetricMentions machinery via
// `metricTargets`. Sourced only from values that are themselves
// unambiguous, already-resolved numbers (graph.verifiedMarketSize parsed
// via the newly-exported extractMarketAmount, graph.planningEstimate.tam,
// and -- ONLY when buildPlanningEstimate itself resolved a real numeric
// range, never its own gap-explanation sentence -- .sam/.som) -- an
// unresolved layer is never promoted into a fabricated "canonical" value
// that could then overwrite a DIFFERENT, correct mention elsewhere.
// `metricProtectedFields: ["marketSize", "cagr", "tamSamSom"]` excludes
// only the fields these values are themselves deterministically rendered
// into; every other field (executiveSummary included) is corrected against
// them if it explicitly restates the same labeled metric with a different
// number.

const checkedAt = "2026-08-30T00:00:00.000Z";

function verifiedEvidence({ id, field, claim, value, sourceType = "credible_market_data", authorityLevel = "secondary", label = "Verified from external source" }) {
  return {
    id,
    field,
    claim,
    value,
    label,
    sourceTitle: "Independent market research publisher",
    publisher: "Independent Research Co.",
    url: `https://research-example.com/reports/${id}`,
    sourceType,
    authorityLevel,
    confidence: 82,
    publishedDate: "2026-01-10",
    lastChecked: checkedAt,
    supportingData: [],
    impact: "neutral",
    impactReason: "",
  };
}

const routeSource = readFileSync(new URL("../app/api/market-analysis/route.ts", import.meta.url), "utf8");

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

async function loadBuildMarketGraphMetricConsistencyTargets() {
  const body = `import { extractMarketAmount } from ${JSON.stringify(
    pathToFileURL(join(process.cwd(), "app/lib/ai/market-intelligence-graph.ts")).href
  )};\n\nexport ${extractFunctionSource(routeSource, "buildMarketGraphMetricConsistencyTargets")}\n`;
  const dir = mkdtempSync(join(tmpdir(), "zerinix-market-consistency-targets-"));
  const outPath = join(dir, "buildMarketGraphMetricConsistencyTargets.ts");
  writeFileSync(outPath, body);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.buildMarketGraphMetricConsistencyTargets;
}

// ---------------------------------------------------------------------------
// Market Size / TAM: identical wherever displayed
// ---------------------------------------------------------------------------

test("Market Size remains identical wherever the same metric is displayed -- a section that restates a DIFFERENT market-size figure is corrected to the canonical, evidence-derived one", async () => {
  const buildTargets = await loadBuildMarketGraphMetricConsistencyTargets();
  const prompt = "Market Intelligence report on the AI coding-assistant market.";
  const evidence = [
    verifiedEvidence({
      id: "R1",
      field: "market_size",
      claim: "The global market for AI coding assistants was valued at $2.1 billion in 2025.",
      value: "$2.1 billion market size, 2025",
      sourceType: "government_statistics",
      authorityLevel: "primary",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  assert.ok(graph.verifiedMarketSize.length > 0, "sanity check: a verified market-size figure must exist");

  const targets = buildTargets(graph, "");
  const marketSizeTarget = targets.find((t) => t.labelPattern === "Market Size");
  assert.ok(marketSizeTarget, "a Market Size consistency target must be built from verified evidence");
  assert.match(marketSizeTarget.canonicalDisplayValue, /2\.1/);

  const sections = {
    marketSize: "[Verified] Global market size: $2.1 billion in 2025 | Confidence: 90/100 (High) | Evidence: [R1]",
    marketOverview: "This is a fast-growing category. Market Size: $7.5 billion, driven by enterprise adoption.",
    industryTrends: "Analysts note the Market Size is $2.1 billion, consistent with independent research.",
  };

  const result = runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    metricTargets: targets,
    metricProtectedFields: ["marketSize"],
  });

  assert.match(sections.marketOverview, /Market Size: \$2\.1 billion/, "the contradicting $7.5B figure must be corrected to the canonical $2.1B");
  assert.doesNotMatch(sections.marketOverview, /\$7\.5 billion/);
  assert.match(sections.industryTrends, /\$2\.1 billion/, "an already-correct mention must survive unchanged");
  assert.match(sections.marketSize, /\$2\.1 billion in 2025/, "the protected canonical field itself must never be rewritten");
  assert.ok(result.correctionsApplied.some((c) => c.type === "market_size_mismatch"));
});

// ---------------------------------------------------------------------------
// CAGR: cannot be Validation Needed in its section while confirmed elsewhere
// ---------------------------------------------------------------------------

test("CAGR cannot read Validation Needed in its own section while a DIFFERENT, contradicting number is presented as confirmed elsewhere -- the other section is corrected to the canonical figure", async () => {
  const buildTargets = await loadBuildMarketGraphMetricConsistencyTargets();
  const prompt = "Market Intelligence report on the AI coding-assistant market.";
  const evidence = [
    verifiedEvidence({
      id: "R7",
      field: "market_growth",
      claim: "Independent research reports the market has a compound annual growth rate of 12.4%.",
      value: "CAGR of 12.4%",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  assert.equal(graph.cagr.length, 1);

  const cagrFieldText = "- [Verified] Independent research reports the market has a compound annual growth rate of 12.4%. | Confidence: 82/100 (High) | Evidence: [R7]";
  const targets = buildTargets(graph, cagrFieldText);
  const cagrTarget = targets.find((t) => t.labelPattern === "CAGR");
  assert.ok(cagrTarget);
  assert.equal(cagrTarget.canonicalDisplayValue, "12.4%");

  const sections = {
    cagr: cagrFieldText,
    strategicRecommendations: "1. Enter now given the CAGR: 25% growth trajectory identified in early research.",
  };
  runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    metricTargets: targets,
    metricProtectedFields: ["cagr"],
  });

  assert.match(sections.strategicRecommendations, /CAGR: 12\.4%/, "the contradicting 25% figure must be corrected to the canonical 12.4%");
  assert.doesNotMatch(sections.strategicRecommendations, /25%/);
});

test("no CAGR consistency target is built when graph.cagr is empty -- a genuinely unresolved CAGR is never fabricated as a canonical value to correct other sections against", async () => {
  const buildTargets = await loadBuildMarketGraphMetricConsistencyTargets();
  const prompt = "Market Intelligence report on an obscure niche market.";
  const graph = buildMarketIntelligenceGraph({ evidence: [] }, prompt);
  assert.equal(graph.cagr.length, 0);

  const targets = buildTargets(graph, "Validation Needed -- no defensible CAGR could be established.");
  assert.ok(!targets.some((t) => t.labelPattern === "CAGR"), "no CAGR target must exist when there is nothing defensible to enforce");
});

// P0 FIX #7 adversarial case 3 (Market Size has evidence but CAGR does
// not): the two metrics are independently sourced and must never
// contaminate one another -- a real, verified Market Size figure existing
// must not upgrade, downgrade, or fabricate a CAGR consistency target when
// no CAGR evidence exists at all in the same graph.
test("ADVERSARIAL CASE (P0 FIX #7): Market Size has real verified evidence but CAGR has none in the same graph -- a Market Size/TAM target IS built, no CAGR target is built, and neither metric influences the other", async () => {
  const buildTargets = await loadBuildMarketGraphMetricConsistencyTargets();
  const prompt = "Market Intelligence report on the AI coding-assistant market.";
  const evidence = [
    verifiedEvidence({
      id: "R1",
      field: "market_size",
      claim: "The global market for AI coding assistants was valued at $2.1 billion in 2025, according to government statistics.",
      value: "$2.1 billion market size, 2025",
      sourceType: "government_statistics",
      authorityLevel: "primary",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  assert.ok(graph.verifiedMarketSize.length > 0);
  assert.equal(graph.cagr.length, 0);

  const targets = buildTargets(graph, "");
  const marketSizeTarget = targets.find((t) => t.labelPattern === "Market Size");
  const tamTarget = targets.find((t) => t.labelPattern === "TAM");
  const cagrTarget = targets.find((t) => t.labelPattern === "CAGR");
  assert.ok(marketSizeTarget, "Market Size target must be built from the real verified evidence");
  assert.match(marketSizeTarget.canonicalDisplayValue, /2\.1/);
  assert.ok(tamTarget, "TAM shares the same canonical figure as Market Size");
  assert.equal(cagrTarget, undefined, "no CAGR target may exist -- Market Size's confirmed status must never leak onto the unrelated, unresolved CAGR metric");
});

// ---------------------------------------------------------------------------
// TAM/SAM/SOM: consistent, and never fabricated when genuinely unresolved
// ---------------------------------------------------------------------------

test("TAM/SAM/SOM: an unresolved SAM (buildPlanningEstimate itself could not derive one) never becomes a fabricated canonical target -- missing stays missing, it is never promoted into a value that could overwrite a different, correct mention elsewhere", async () => {
  const buildTargets = await loadBuildMarketGraphMetricConsistencyTargets();
  // A thin, single-signal market with a buyer-population estimate but no
  // pricing evidence -- buildPlanningEstimate's own confirmed-live
  // documented shape for samMethod: "blocked".
  const prompt = "Market Intelligence report on a very niche B2B tooling market.";
  const evidence = [
    verifiedEvidence({
      id: "R1",
      field: "market_demand",
      claim: "There are approximately 40,000 addressable businesses in this category.",
      value: "40,000 addressable buyers",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);

  const targets = buildTargets(graph, "");
  if (graph.planningEstimate && graph.planningEstimate.samMethod === "blocked") {
    assert.ok(!targets.some((t) => t.labelPattern === "SAM"), "a blocked SAM must never become a consistency target");
  }
  if (graph.planningEstimate && graph.planningEstimate.somStatus !== "calculated") {
    assert.ok(!targets.some((t) => t.labelPattern === "SOM"), "a pending SOM must never become a consistency target");
  }
});

test("TAM/SAM/SOM: when a Planning Estimate resolves a real SAM, a different section's contradicting SAM mention is corrected to it, and the canonical tamSamSom field itself is protected from rewriting", async () => {
  const buildTargets = await loadBuildMarketGraphMetricConsistencyTargets();
  const graph = {
    planningEstimate: {
      tam: "$4.2 billion",
      sam: "$1.8 billion",
      som: "$450 million",
      samMethod: "evidenceDerived",
      somStatus: "calculated",
    },
    verifiedMarketSize: [],
  };

  const targets = buildTargets(graph, "");
  const samTarget = targets.find((t) => t.labelPattern === "SAM");
  const somTarget = targets.find((t) => t.labelPattern === "SOM");
  assert.equal(samTarget.canonicalDisplayValue, "$1.8 billion");
  assert.equal(somTarget.canonicalDisplayValue, "$450 million");

  const sections = {
    tamSamSom: "TAM [Estimated]: $4.2 billion\nSAM [Estimated]: $1.8 billion\nSOM [Estimated]: $450 million",
    customerSegments: "The reachable SAM: $3 billion segment includes mid-market buyers underserved today.",
  };
  runConsistencyValidationPass({
    sections,
    fields: Object.keys(sections),
    language: "English",
    metricTargets: targets,
    metricProtectedFields: ["tamSamSom"],
  });

  assert.match(sections.customerSegments, /SAM: \$1\.8 billion/);
  assert.match(sections.tamSamSom, /SAM \[Estimated\]: \$1\.8 billion/, "the protected canonical tamSamSom field must never be rewritten against itself");
});

// ---------------------------------------------------------------------------
// Planning Estimate cannot become Data Confirmed downstream
// ---------------------------------------------------------------------------

test("extractMarketAmount (now exported for this fix) still returns a clean, short token, never a whole sentence -- the canonical value used to correct other sections is a real number, not free text that could corrupt a corrected mention", () => {
  const parsed = extractMarketAmount("The global market for AI coding assistants was valued at $2.1 billion in 2025.");
  assert.ok(parsed);
  assert.equal(parsed.token, "$2.1 billion");
});

test("PARITY: the metricTargets/metricProtectedFields wiring lives in route.ts's single runConsistencyValidationPass call site (the same one that already enforces the canonical decision), not duplicated per renderer", () => {
  assert.match(
    routeSource,
    /metricTargets: graph \? buildMarketGraphMetricConsistencyTargets\(graph, deduped\.cagr\) : undefined,/
  );
  assert.match(routeSource, /metricProtectedFields: \["marketSize", "cagr", "tamSamSom"\],/);
  const occurrences = routeSource.match(/runConsistencyValidationPass\(/g) || [];
  assert.equal(occurrences.length, 1);
});

test("REGRESSION: buildMarketGraphMetricConsistencyTargets does not collide with the historical, already-removed founder/investment-scoring buildMarketFinancialConsistencyTargets name -- report-type-isolation.test.mjs's own drift check for that removal remains meaningful", () => {
  assert.doesNotMatch(routeSource, /\bbuildMarketFinancialConsistencyTargets\(/);
  assert.match(routeSource, /function buildMarketGraphMetricConsistencyTargets\(/);
});

// ---------------------------------------------------------------------------
// Unsupported competitors cannot become verified downstream (P0 FIX #3)
// ---------------------------------------------------------------------------

test("REGRESSION: sanitizeMarketProseCompetitorClaims still runs BEFORE buildMarketExecutiveDecisionBrief consumes opportunities/threats, so an adjacent-only competitor sanitized in one field can never surface as verified in the quoted Executive Summary text -- untouched by this pass", () => {
  const applySharedGraphIndex = routeSource.indexOf("function applySharedMarketGraph");
  const sanitizeCallIndex = routeSource.indexOf("sanitizeMarketProseCompetitorClaims(", applySharedGraphIndex);
  const buildBriefCallIndex = routeSource.indexOf("marketExecutiveDecisionBrief = buildMarketExecutiveDecisionBrief(");
  assert.ok(sanitizeCallIndex > 0 && buildBriefCallIndex > sanitizeCallIndex);
});

// ---------------------------------------------------------------------------
// Executive Summary consumes canonical evidence states
// ---------------------------------------------------------------------------

test("REGRESSION: executiveSummary is not itself a metricProtectedField -- if its quoted opportunity/risk text ever explicitly restated a labeled Market Size/TAM/CAGR figure, it would still be corrected against the canonical value like any other non-canonical field", () => {
  assert.doesNotMatch(routeSource, /metricProtectedFields: \[[^\]]*"executiveSummary"/);
});

// ---------------------------------------------------------------------------
// Drift checks: P0 FIX #1-#5 remain intact
// ---------------------------------------------------------------------------

test("DRIFT CHECK: P0 FIX #1 (TAM/SAM/SOM), #2 (CAGR), #3 (Competitive Landscape/Major Players), #4 (executive decision gate), and #5 (source/evidence integrity) canonical logic is untouched by this pass", () => {
  const reportPresentationSource = readFileSync("app/lib/report-presentation.ts", "utf8");
  assert.match(reportPresentationSource, /export function resolveMarketSizingCascade\(/);

  const pdfButtonSource = readFileSync(
    new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
    "utf8"
  );
  assert.match(
    pdfButtonSource,
    /const cascade = constrainMarketSizingResolutionToCanonicalState\(\s*\n\s*resolveMarketSizingCascade\(magnitudes\),\s*\n\s*readMarketIntelligenceCanonicalState\(report\.metadata\)\s*\n\s*\);/
  );

  assert.match(routeSource, /if \(field === "cagr"\) \{/);
  assert.match(
    routeSource,
    /excludedFields:\s*\[\s*"strategicRecommendations",\s*"tamSamSom",\s*"executiveSummary",\s*"competitiveLandscape",\s*"majorPlayers",\s*"cagr",?\s*\]/
  );
  assert.match(routeSource, /marketSizingResolved:\s*\n\s*graph\.planningEstimate !== null \|\| graph\.verifiedMarketSize\.length > 0,/);

  const graphSource = readFileSync("app/lib/ai/market-intelligence-graph.ts", "utf8");
  assert.match(graphSource, /adjacentPlayersAlongsideValidatedVendors/);
  assert.match(graphSource, /planningEstimateTitle: "Planning Estimate — not externally confirmed market size"/);

  const vendorDiscoverySource = readFileSync("app/lib/ai/vendor-discovery.ts", "utf8");
  assert.match(vendorDiscoverySource, /official_product_page_plus_independent_source/);

  const presentationSource = readFileSync("app/lib/report-engine/market-intelligence-presentation.ts", "utf8");
  assert.match(
    presentationSource,
    /marketConfidence \* 0\.4 \+\s*\n\s*competitiveEvidence \* 0\.25 \+\s*\n\s*financialEvidence \* 0\.2 \+\s*\n\s*productEvidence \* 0\.15/
  );

  const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
  // P0 FIX #8 -- confirmed live (CAGR scope/KPI semantics repair): a
  // multi-estimate CAGR range is now forced to "benchmarkDerived" before
  // it ever reaches the canonical classifier (no single evidence line
  // supports a two-number range), but the single-estimate case -- the
  // one this drift check protects -- still routes through the exact
  // pinned evidence-classification call below.
  // TASK #32 -- getDashboardMetricEvidence(..., extractEvidenceLineForValue(...))
  // was superseded by the shared deriveMarketSizeMetricEvidenceLevel
  // (report-presentation.ts), reused identically by Planner.tsx -- see
  // tests/market-intelligence-source-evidence-integrity.test.mjs for that
  // fix's own dedicated coverage.
  assert.match(
    pageSource,
    /const evidence =\s*\n\s*isCagr && cagrPresentation\?\.isMultiEstimate\s*\n\s*\?\s*\("benchmarkDerived" as const\)\s*\n\s*:\s*deriveMarketSizeMetricEvidenceLevel\(isCagr \? "CAGR" : "Market Size", value, content\);/
  );
});
