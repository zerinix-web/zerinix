import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  applyMarketResearchCoverageToContext,
  evaluateMarketResearchCoverage,
} from "../app/lib/ai/market-research-coverage.ts";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import {
  getSectionTakeaway,
  stripLeadingTakeawaySentence,
} from "../app/lib/report-presentation.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const routeSource = readFileSync(`${repoRoot}app/api/market-analysis/route.ts`, "utf8");
const graphSource = readFileSync(`${repoRoot}app/lib/ai/market-intelligence-graph.ts`, "utf8");

// P0 PRODUCTION HARDENING PASS -- targeted root-cause fixes for three
// remaining Market Intelligence report consistency/presentation defects
// observed on a real, newly generated production report:
//
// 1. EXECUTIVE SUMMARY NORMALIZATION: Decision ("MONITOR") rendered
//    correctly while Confidence rendered "--" on the same banner-derived
//    resolver (resolveMarketIntelligenceExecutiveDecision). Root cause:
//    the deterministic "Decision: TOKEN (Confidence: NN%)" banner is only
//    embedded into executiveSummary when a `coverage` object is present
//    (route.ts's `if (coverage)` gate) -- for a report reconstructed from
//    the full-report cache with a cached graph but no separately-cached
//    domain-research bundle, `cachedCoverageResult` was unconditionally
//    nulled out even though a real, already-computed coverage value
//    (cachedMarketGraph?.coverage) was available the whole time, because
//    applyMarketResearchCoverageToContext's `bundle.evidence` parameter
//    is only read as a FALLBACK when no coverageOverride is supplied --
//    completely unused once a real override is present. Fixed by
//    widening the gate to `cachedDomainResearch || cachedMarketGraph?.coverage`
//    and passing a safe empty-evidence bundle when only the override is
//    available -- never fabricates a coverage figure; the override is
//    always either a genuine, already-computed MarketResearchCoverage or
//    undefined.
//
// 2. MARKET SIZE vs TAM/SAM/SOM SEMANTICS: a validated Market Size figure
//    rendered with no qualification next to an independently-unresolved
//    TAM read as internally contradictory. No "why TAM isn't promoted
//    from Market Size" explanation existed anywhere in the pipeline.
//    Fixed by appending a generic, always-present "Market / Industry
//    Baseline -- Not Yet Validated as TAM for This Business" label plus
//    explanation to the verified-market-size branch's rendered text --
//    purely additive presentation copy; the TAM/SAM/SOM validation rule
//    itself, and the verified market-size evidence lines, are completely
//    unchanged.
//
// 3. PDF DUPLICATE SECTION CONTENT: a numbered/bulleted first line with a
//    bold sub-label glued to a colon ("1. **Regulatory tailwinds**:
//    Rising...", the shape the shared "bold metric labels" style
//    guidance produces for exactly the 8 reported fields) still
//    duplicated, despite the field-based wiring being correct. Root
//    cause: stripLeadingTakeawaySentence's bullet-marker branch manually
//    stripped "**" by DELETING it before comparison, while
//    getSectionTakeaway (via splitSentences -> stripMarkdown) replaces
//    "**" with a SPACE -- a one-space mismatch ("tailwinds :" vs.
//    "tailwinds:") that silently failed the duplicate check. Fixed by
//    removing the premature manual strip and letting
//    isDuplicateOfTakeaway's own internal stripMarkdown normalize both
//    sides identically, exactly as the non-bullet branch already does.

// ===========================================================================
// 1. Executive Summary confidence/coverage cache-reconstruction fix
// ===========================================================================

test("EXEC1: applyMarketResearchCoverageToContext honors a real coverageOverride even when the evidence bundle is empty -- the exact mechanism the route.ts fix relies on", () => {
  const checkedAt = "2026-08-27T00:00:00.000Z";
  const realEvidence = [
    {
      id: "E1",
      field: "market_size",
      claim: "Market size is $131.6B",
      value: "$131.6B",
      label: "Verified from official source",
      sourceTitle: "x",
      publisher: "x",
      url: "https://www.census.gov/x",
      sourceType: "official_statistics",
      authorityLevel: "primary",
      confidence: 90,
      publishedDate: "2026-01-10",
      lastChecked: checkedAt,
      supportingData: [],
      impact: "neutral",
      impactReason: "x",
      qualityScore: 92,
      qualityRationale: "x",
      searchQuery: "",
    },
  ];
  const realCoverage = evaluateMarketResearchCoverage(realEvidence, "test prompt");

  const minimalContext = {
    investmentScore: {
      decisionEngine: {
        marketScore: { value: 0, reasoning: [] },
        competitionScore: { value: 0, reasoning: [] },
        financialScore: { value: 0, reasoning: [] },
        executionScore: { value: 0, reasoning: [] },
        founderScore: { value: 0, reasoning: [] },
      },
    },
  };

  const result = applyMarketResearchCoverageToContext(minimalContext, { evidence: [] }, "test prompt", realCoverage);
  assert.equal(result.coverage, realCoverage, "a real coverageOverride must be used verbatim even with an empty evidence bundle");
  assert.ok(result.coverage.overallConfidence > 0, "the real, already-computed confidence must survive, not be discarded");
});

test("EXEC2: route.ts's cached-report coverage gate no longer requires cachedDomainResearch when a real coverage override (cachedMarketGraph?.coverage) is already available", () => {
  const gateMatch = routeSource.match(
    /const cachedCoverageResult = ([^\n]+)\n\s*\?\s*applyMarketResearchCoverageToContext\(\s*\n\s*canonicalFinancialAssumptions,\s*\n\s*([^,]+),/
  );
  assert.ok(gateMatch, "cachedCoverageResult assignment not found");
  const [, condition, bundleArg] = gateMatch;
  assert.match(condition, /cachedDomainResearch \|\| cachedMarketGraph\?\.coverage/, `gate condition must accept either source, got: ${condition}`);
  assert.match(bundleArg.trim(), /cachedDomainResearch \|\| \{ evidence: \[\] \}/, `bundle argument must fall back to an empty (never fabricated) evidence array, got: ${bundleArg}`);
});

test("EXEC3 (no regression): the fresh-generation coverage path (marketCoverageResult.coverage, unconditionally computed) is untouched by this fix", () => {
  assert.match(routeSource, /const marketCoverageResult = applyMarketResearchCoverageToContext\(/);
  assert.match(routeSource, /parseFullMarketReport\(\s*\n\s*responseText,\s*\n\s*marketCoverageResult\.coverage,/);
});

test("EXEC4 (no regression): the banner-embedding gate itself (`if (coverage)`) and its downstream buildMarketExecutiveDecisionBrief/formatExecutiveDecisionBrief call are unchanged -- this fix only widens what can satisfy `coverage`, never what happens once it's present", () => {
  assert.match(routeSource, /if \(coverage\) \{/);
  assert.match(routeSource, /marketExecutiveDecisionBrief = buildMarketExecutiveDecisionBrief\(/);
  assert.match(routeSource, /normalized\.executiveSummary = formatExecutiveDecisionBrief\(/);
});

// ===========================================================================
// 2. Market Size vs TAM/SAM/SOM baseline labeling
// ===========================================================================

const checkedAt2 = "2026-08-27T00:00:00.000Z";
let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `B${idCounter}`;
}
function officialMarketSizeEvidence(overrides) {
  return {
    id: nextId(),
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
    lastChecked: checkedAt2,
    supportingData: [],
    impact: "neutral",
    impactReason: "Supports verified market size.",
    qualityScore: 92,
    qualityRationale: "Primary government statistics.",
    searchQuery: "",
    ...overrides,
  };
}

const boutiquePrompt =
  "Evaluate the mature U.S. commercial real estate services market for a boutique brokerage entering a narrow suburban niche.";

test("BASELINE1: the exact reported production shape -- a verified $131.6B market-size figure is explicitly labeled a Market / Industry Baseline with an explanation of why it is not automatically TAM", () => {
  const evidence = [
    officialMarketSizeEvidence({
      claim: "The U.S. commercial real estate services market size was $131.6 billion in 2024, per Census Bureau statistics.",
      value: "$131.6 billion",
      sourceTitle: "U.S. Census Bureau Services Annual Survey",
      publisher: "U.S. Census Bureau",
      url: "https://www.census.gov/cre-services",
    }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, boutiquePrompt);
  assert.ok(graph.verifiedMarketSize.length > 0, "fixture must actually clear the verified-market-size bar");

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.match(projection.marketSize, /\$131\.6 billion/);
  assert.match(projection.marketSize, /Market \/ Industry Baseline/i);
  assert.match(projection.marketSize, /Not Yet Validated as TAM/i);
  assert.match(
    projection.marketSize,
    /geography, customer segment, and product\/service definition/i,
    "the explanation must state the generic reason (scope must be independently confirmed), not a market-specific fabricated reason"
  );
});

test("BASELINE2 (no regression): the verified market-size evidence line itself (value, confidence, evidence id) is byte-for-byte unchanged -- this fix is purely additive", () => {
  const evidence = [
    officialMarketSizeEvidence({
      claim: "The U.S. commercial real estate services market size was $50 billion in 2025, per Census Bureau statistics.",
      value: "$50 billion",
      sourceTitle: "U.S. Census Bureau Services Annual Survey",
      publisher: "U.S. Census Bureau",
      url: "https://www.census.gov/cre-services",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, boutiquePrompt);
  assert.ok(graph.verifiedMarketSize.length > 0, "fixture must actually clear the verified-market-size bar");
  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.match(projection.marketSize, /^Verified market-size evidence/);
  assert.match(projection.marketSize, /\[Verified\] \$50 billion \| Confidence: \d+\/100/);
});

test("BASELINE3 (no regression): the Planning Estimate path (no verified market size, benchmark-derived TAM) is completely untouched -- the baseline qualifier only ever appears in the verified-market-size branch", () => {
  const evidence = [
    officialMarketSizeEvidence({
      authorityLevel: "secondary",
      sourceType: "credible_market_data",
      claim: "The market generated $131.6 billion in revenue in 2024.",
      value: "$131.6 billion",
      confidence: 80,
      qualityScore: 74,
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, boutiquePrompt);
  assert.equal(graph.verifiedMarketSize.length, 0, "fixture must NOT clear the verified bar (secondary authority, no market-size phrase match)");
  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.doesNotMatch(projection.marketSize, /Market \/ Industry Baseline/i);
});

test("BASELINE4 (no regression): the fully-unavailable path (no verified size, no planning estimate, no benchmark) never mentions a baseline qualifier either", () => {
  const graph = buildMarketIntelligenceGraph({ evidence: [] }, boutiquePrompt);
  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.doesNotMatch(projection.marketSize, /Market \/ Industry Baseline/i);
});

test("BASELINE5: all 5 supported languages have real, non-empty translations for the new copy keys (no missing-language fallback to English)", () => {
  const languageBlocks = [...graphSource.matchAll(/verifiedMarketSizeTitle: "([^"]+)",\s*\n\s*marketSizeBaselineLabel: "([^"]+)",\s*\n\s*marketSizeBaselineExplanation:\s*\n?\s*"([^"]+)",/g)];
  assert.equal(languageBlocks.length, 5, `expected exactly 5 language blocks with both new keys, found ${languageBlocks.length}`);
  for (const [, , label, explanation] of languageBlocks) {
    assert.ok(label.length > 5);
    assert.ok(explanation.length > 40);
  }
});

// ===========================================================================
// 3. PDF duplicate content -- bullet-branch normalization symmetry
// ===========================================================================

test("DEDUP1: the exact reported production shape -- a numbered bullet with a bold sub-label glued to a colon ('1. **Regulatory tailwinds**: ...') is now correctly deduplicated", () => {
  const content =
    "1. **Regulatory tailwinds**: Rising compliance requirements are pushing adoption across major metros.\n2. **Cost pressure**: Operating margins are tightening amid rising insurance costs.";
  const takeaway = getSectionTakeaway(content);
  assert.match(takeaway, /Regulatory tailwinds/);

  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.ok(!stripped.includes("Regulatory tailwinds"), `the duplicated first bullet must be removed, got: "${stripped}"`);
  assert.match(stripped, /Cost pressure/, "the genuinely different second bullet must be fully preserved");
});

test("DEDUP2: the same bold-label-glued-to-colon shape without a numbered/bulleted marker also dedups correctly (already-correct non-bullet path, unchanged)", () => {
  const content =
    "**Regulatory tailwinds**: Rising compliance requirements are pushing adoption across major metros.\n\nSeparately, insurance costs are also rising.";
  const takeaway = getSectionTakeaway(content);
  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.ok(!stripped.includes("Regulatory tailwinds"));
  assert.match(stripped, /Separately, insurance costs/);
});

test("DEDUP3 (no regression): a bulleted first line with NO bold label (plain text) still dedups exactly as before", () => {
  const content =
    "1. Rising compliance requirements are pushing adoption across major metros.\n2. Operating margins are tightening amid rising insurance costs.";
  const takeaway = getSectionTakeaway(content);
  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.ok(!stripped.includes("Rising compliance requirements"));
  assert.match(stripped, /Operating margins/);
});

test("DEDUP4 (no regression): a genuinely non-duplicate bulleted first line is left completely unchanged", () => {
  const content =
    "1. **Regulatory tailwinds**: Rising compliance requirements are pushing adoption across major metros.\n2. **Cost pressure**: Operating margins are tightening amid rising insurance costs.";
  const unrelatedTakeaway = "This is a completely unrelated takeaway sentence that never appears anywhere in this body text.";
  const stripped = stripLeadingTakeawaySentence(content, unrelatedTakeaway);
  assert.equal(stripped, content);
});

test("DEDUP5 (regression guard, previously fixed shape): the label-only-first-line lookahead case from the prior fix still works correctly", () => {
  const content = "**Answer:**\nVendors are bundling integration services with core platform offerings.\n\nAdditional detail follows.";
  const takeaway = getSectionTakeaway(content);
  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.ok(!stripped.includes("Vendors are bundling integration services"));
  assert.match(stripped, /Additional detail follows/);
});

test("DEDUP6: source drift check -- the bullet branch no longer manually strips '**' before comparison (superseded by the multi-sentence-scan rewrite, which never pre-strips markdown at all -- isDuplicateOfTakeaway's own stripMarkdown normalizes every candidate)", () => {
  const presentationSource = readFileSync(`${repoRoot}app/lib/report-presentation.ts`, "utf8");
  assert.doesNotMatch(
    presentationSource,
    /const firstLineTextOnly = trimmedFirstLine\.slice\(bulletMarkerMatch\[0\]\.length\)\.replace\(\/\\\*\\\*\/g, ""\);/,
    "the premature manual '**' strip must never be reintroduced"
  );
});

test("DEDUP7: the exact newly-diagnosed shape -- a bulleted item whose own short (<=24 char) opening sentence is filtered out by splitSentences, making the takeaway the SECOND sentence on the same line -- is now correctly deduplicated while the short opening sentence is preserved intact", () => {
  const content =
    "1. **Regulatory tailwinds.** Rising demand for compliance automation across the U.S. and E.U. is accelerating adoption of AI-driven audit tools among mid-market financial services firms with cross-border obligations.\n2. **Cloud migration.** Enterprises are consolidating legacy on-prem audit systems onto cloud-native platforms, creating a large addressable upgrade market for compliance vendors.";
  const takeaway = getSectionTakeaway(content);
  assert.match(takeaway, /Rising demand for compliance automation/, "the takeaway must be the second sentence, since the first is <=24 chars and filtered by splitSentences");

  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.ok(!stripped.includes("Rising demand for compliance automation"), `the duplicated second sentence must be removed, got: "${stripped}"`);
  assert.match(stripped, /\*\*Regulatory tailwinds\.\*\*/, "the short opening sentence must survive intact, including its closing bold marker");
  assert.match(stripped, /Cloud migration/, "the second bullet must be fully preserved");
});

test("DEDUP8 (no regression): the non-bulleted equivalent of the same short-first-sentence shape also dedups correctly", () => {
  const content =
    "**Regulatory tailwinds.** Rising demand for compliance automation across the U.S. and E.U. is accelerating adoption of AI-driven audit tools among mid-market financial services firms with cross-border obligations.\n\nSeparately, cloud migration is also underway.";
  const takeaway = getSectionTakeaway(content);
  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.ok(!stripped.includes("Rising demand for compliance automation"));
  assert.match(stripped, /\*\*Regulatory tailwinds\.\*\*/);
  assert.match(stripped, /Separately, cloud migration/);
});

test("DEDUP9 (no regression): when the takeaway genuinely IS the literal first sentence of a multi-sentence body, only that first sentence is removed -- later sentences on the same line are untouched", () => {
  const content =
    "Vendors are bundling integration services with core platform offerings to increase switching costs in mature markets. Additionally, pricing pressure is rising. A third observation follows here for good measure.\n\nMore detail follows in a separate paragraph.";
  const takeaway = getSectionTakeaway(content);
  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.ok(!stripped.includes("Vendors are bundling integration services"));
  assert.match(stripped, /Additionally, pricing pressure is rising/);
  assert.match(stripped, /A third observation follows/);
  assert.match(stripped, /More detail follows/);
});
