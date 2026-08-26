import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createDynamicReportPlanFallback } from "../app/lib/ai/dynamic-report-plan.ts";
import { createDynamicResearchPlanFallback } from "../app/lib/ai/dynamic-research-plan.ts";
import { createExpertiseProfileFallback } from "../app/lib/ai/expertise-profile.ts";
import {
  calculateMarketOverallConfidence,
  classifyMarketConfidence,
  evaluateMarketResearchCoverage,
} from "../app/lib/ai/market-research-coverage.ts";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import { evaluateAggregateResearchEvidence } from "../app/lib/ai/research-evidence-evaluation.ts";

const prompt = "Analyze the US AI accounting software market.";
const checkedAt = "2026-08-02T00:00:00.000Z";

function evidence({
  id,
  field,
  company,
  url,
  sourceType = "official company source",
  claim = `${company} provides accounting software for business customers.`,
  publishedDate = "2025-01-15",
}) {
  return {
    id,
    field,
    claim,
    value: claim,
    label: "Verified from external source",
    sourceTitle: `${company} product and market evidence`,
    publisher: company,
    url,
    sourceType,
    authorityLevel: url.includes("sec.gov") ? "primary" : "secondary",
    confidence: 76,
    publishedDate,
    lastChecked: checkedAt,
    supportingData: [claim],
    impact: "neutral",
    impactReason: "Supports market coverage.",
    qualityScore: 58,
    qualityRationale: "Directly relevant public source with valid provenance.",
  };
}

const evidenceFixture = [
  evidence({ id: "R1", field: "competitors", company: "Intuit", url: "https://investors.intuit.com/financial-information/annual-reports/default.aspx", sourceType: "official_filing" }),
  evidence({ id: "R2", field: "competitors", company: "Xero", url: "https://www.xero.com/us/accounting-software/" }),
  evidence({ id: "R3", field: "competitors", company: "Sage", url: "https://www.sage.com/en-us/products/accounting/" }),
  evidence({ id: "R4", field: "product_evidence", company: "FreshBooks", url: "https://www.freshbooks.com/accounting-software" }),
  evidence({ id: "R5", field: "company_evidence", company: "Oracle", url: "https://www.oracle.com/erp/netsuite/" }),
  evidence({ id: "R6", field: "market_demand", company: "US Census Bureau", url: "https://www.census.gov/programs-surveys/susb.html", sourceType: "official_statistics", claim: "Official business statistics support the addressable buyer population context." }),
  evidence({ id: "R7", field: "industry_structure", company: "AICPA", url: "https://www.aicpa-cima.com/resources/landing/future-of-finance", sourceType: "professional_standard", claim: "Industry association evidence describes technology adoption in accounting." }),
  evidence({ id: "R8", field: "competitors", company: "Botkeeper", url: "https://www.botkeeper.com/", claim: "Botkeeper offers AI-assisted bookkeeping services to accounting firms." }),
  evidence({ id: "R9", field: "competitors", company: "Dext", url: "https://dext.com/us", claim: "Dext provides automated bookkeeping and accounting data extraction." }),
  evidence({ id: "R10", field: "competitors", company: "AutoEntry", url: "https://www.autoentry.com/", claim: "AutoEntry automates accounting document data entry." }),
  // These six vendors are named only by a single Gartner mention (R13) below
  // -- adding their own official page gives each a second, independent
  // corroborating source, consistent with the multi-source validation rule.
  evidence({ id: "R15", field: "competitors", company: "Zoho Books", url: "https://www.zoho.com/us/books/", claim: "Zoho Books provides accounting software with invoicing automation for small businesses." }),
  evidence({ id: "R16", field: "competitors", company: "BlackLine", url: "https://www.blackline.com/", claim: "BlackLine provides financial close automation software for enterprise accounting teams." }),
  evidence({ id: "R17", field: "competitors", company: "FloQast", url: "https://floqast.com/", claim: "FloQast provides close management software for accounting teams." }),
  evidence({ id: "R18", field: "competitors", company: "Vic.ai", url: "https://vic.ai/", claim: "Vic.ai provides AI-powered accounts payable automation software." }),
  evidence({ id: "R19", field: "competitors", company: "Numeric", url: "https://numeric.io/", claim: "Numeric provides close management software for accounting teams." }),
  evidence({ id: "R20", field: "competitors", company: "Puzzle", url: "https://puzzle.io/", claim: "Puzzle provides accounting software for startups." }),
  evidence({ id: "R11", field: "market_size", company: "Grand View Research", url: "https://www.grandviewresearch.com/industry-analysis/accounting-software-market", sourceType: "market_research", claim: "The US accounting software market planning baseline is estimated at $8.4 billion in 2025." }),
  evidence({ id: "R12", field: "cagr", company: "Grand View Research", url: "https://www.grandviewresearch.com/industry-analysis/accounting-software-market-size", sourceType: "market_research", claim: "The accounting software category is forecast to grow at a 9.2% CAGR through 2030." }),
  evidence({ id: "R13", field: "competitors", company: "Gartner", url: "https://www.gartner.com/en/information-technology/glossary/accounting-software", sourceType: "market_research", claim: "QuickBooks, Xero, Sage, NetSuite, Oracle, Zoho Books, FreshBooks, BlackLine, FloQast, Vic.ai, Numeric Accounting, and Puzzle Accounting are software vendors in the accounting market." }),
  evidence({ id: "R14", field: "competitors", company: "Validation Required", url: "https://invalid", sourceType: "market_research", claim: "A placeholder source claims another benchmark institution is a competitor." }),
];

test("US AI accounting market receives a dynamic multi-source research plan", () => {
  const expertiseProfile = createExpertiseProfileFallback({
    prompt,
    selectedMode: "market",
    assets: [],
  });
  const reportPlan = createDynamicReportPlanFallback({
    expertiseProfile,
    selectedMode: "market",
    prompt,
  });
  const researchPlan = createDynamicResearchPlanFallback({
    expertiseProfile,
    reportPlan,
    selectedMode: "market",
    prompt,
  });
  const competitorTask = researchPlan.tasks.find(
    (task) => task.evidenceField === "competitors"
  );
  const sourceTypes = new Set(
    researchPlan.tasks.flatMap((task) => task.preferredSourceTypes)
  );
  const planText = JSON.stringify(researchPlan);

  assert.ok(competitorTask, "competitor discovery must be planned");
  assert.equal(competitorTask.queries.length, 3);
  assert.match(competitorTask.purpose, /multiple relevant competitors dynamically/i);
  assert.ok(sourceTypes.has("official_statistics"));
  assert.ok(sourceTypes.has("official_filing"));
  assert.ok(sourceTypes.has("company_source"));
  assert.ok(sourceTypes.has("credible_market_data"));
  assert.doesNotMatch(planText, /\b(?:QuickBooks|Xero|Sage|FreshBooks|NetSuite|Dynamics 365|Zoho|BlackLine|FloQast)\b/i);
});

test("aggregate evidence supports a report and represents multiple competitors and domains", () => {
  const gate = evaluateAggregateResearchEvidence(evidenceFixture);
  const coverage = evaluateMarketResearchCoverage(evidenceFixture, prompt);

  assert.equal(gate.after.reportDecision, "allow_report");
  assert.ok(coverage.competitorBreadth > 1);
  assert.ok(coverage.independentDomains >= 6);
  assert.ok(coverage.sourceTypeDiversity >= 3);
  assert.equal(coverage.verifiedMarketSizeAvailable, true);
});

test("missing market size lowers financial evidence without collapsing every score", () => {
  const evidenceWithoutMarketSize = evidenceFixture.filter(
    (item) => item.id !== "R11" && item.id !== "R12"
  );
  const coverage = evaluateMarketResearchCoverage(
    evidenceWithoutMarketSize,
    prompt
  );
  const scores = Object.values(coverage.dimensions);

  assert.ok(coverage.overallConfidence > 9);
  assert.ok(coverage.dimensions.marketConfidence > coverage.dimensions.financialEvidence);
  assert.notEqual(new Set(scores).size, 1);
  assert.equal(coverage.dimensions.founderReadiness, 25);
  assert.notEqual(coverage.dimensions.founderReadiness, coverage.dimensions.marketConfidence);
  assert.equal(coverage.verifiedMarketSizeAvailable, false);
});

test("verified source metadata remains complete in the report evidence registry", async () => {
  const researchSource = await readFile(
    new URL("../app/lib/ai/domain-research.ts", import.meta.url),
    "utf8"
  );
  for (const item of evidenceFixture) {
    assert.doesNotThrow(() => new URL(item.url));
    assert.ok(item.publisher.trim());
  }
  assert.match(researchSource, /Publisher:/);
  assert.match(researchSource, /Source URL:/);
  assert.match(researchSource, /Access date:/);
  assert.match(researchSource, /Source classification:/);
  assert.match(researchSource, /Confidence classification:/);
  assert.match(researchSource, /item\.url \? "Preliminary external evidence" : "Unverified"/);
});

test("chat and Market Intelligence report can consume one lossless final research graph", async () => {
  const graph = buildMarketIntelligenceGraph(
    { evidence: evidenceFixture },
    prompt
  );
  const competitorNames = graph.competitors.map((item) => item.name);

  for (const expected of [
    "Intuit (QuickBooks)",
    "Xero",
    "Sage",
    "Oracle NetSuite",
    "Zoho Books",
    "FreshBooks",
    "BlackLine",
    "FloQast",
    "Vic.ai",
    "Numeric",
    "Puzzle",
    "Botkeeper",
    "Dext",
    "AutoEntry",
  ]) {
    assert.ok(competitorNames.includes(expected), `${expected} must survive`);
  }
  assert.equal(graph.coverage.competitorBreadth, graph.competitors.length);
  for (const excluded of [
    "Gartner",
    "Grand View Research",
    "US Census Bureau",
    "AICPA",
    "Validation Required",
  ]) {
    assert.ok(!competitorNames.includes(excluded), `${excluded} is not a vendor`);
  }
  assert.ok(graph.coverage.competitorBreadth > 1);
  assert.ok(graph.vendorIntelligence.marketInfrastructure.some((item) => item.name === "US Census Bureau"));
  assert.ok(graph.vendorIntelligence.marketInfrastructure.some((item) => item.name === "AICPA"));
  assert.ok(graph.vendorIntelligence.evidenceProviders.some((item) => item.name === "Gartner"));
  assert.ok(graph.vendorIntelligence.evidenceProviders.some((item) => item.name === "Grand View Research"));
  assert.ok(graph.planningEstimate, "source-backed planning estimate expected");
  assert.match(graph.planningEstimate.tam, /\$8\.4B/);
  assert.match(graph.planningEstimate.formula, /\[R11\]/);
  // Evidence-first market-sizing engine: SAM's assumption is tagged
  // [Assumption] only when no real serviceable-share evidence was found
  // (true for this fixture -- it has a market forecast and competitors,
  // not a segment-share breakdown), and SOM is now honestly tagged [Gap]
  // rather than a fabricated default percentage when no obtainable-share/
  // penetration-rate/win-rate evidence exists (also true here).
  assert.ok(graph.planningEstimate.assumptions.every((item) => /\[Assumption\]|\[Gap\]|\[Evidence\]/.test(item)));
  assert.ok(graph.planningEstimate.assumptions.some((item) => /\[Assumption\]/.test(item)), "default SAM assumption expected");
  assert.ok(graph.planningEstimate.assumptions.some((item) => /\[Gap\]/.test(item)), "SOM should be an honest gap, not a fabricated percentage, for this fixture");
  assert.equal(graph.planningEstimate.somStatus, "pending");
  assert.doesNotMatch(graph.planningEstimate.som, /\d/, "a pending SOM must never carry a fabricated numeric figure");
  assert.equal(graph.verifiedMarketSize.length, 0, "a market forecast is not a verified endpoint");
  assert.ok(graph.cagr.some((item) => item.evidenceIds.includes("R12")));

  for (const source of graph.sources) {
    assert.ok(source.title);
    assert.ok(source.publisher);
    assert.doesNotThrow(() => new URL(source.url));
    assert.ok(source.sourceType);
    assert.ok(source.confidenceClassification);
    assert.equal(
      source.confidenceLevel,
      classifyMarketConfidence(source.confidenceScore)
    );
    assert.ok(source.claim);
  }
  assert.ok(!graph.sources.some((source) => source.evidenceId === "R14"));

  const sourceIds = new Set(graph.sources.map((item) => item.evidenceId));
  for (const id of graph.planningEstimate.evidenceIds) {
    assert.ok(sourceIds.has(id), `planning estimate evidence ${id} must exist`);
  }
  assert.notEqual(
    new Set(Object.values(graph.coverage.dimensions)).size,
    1,
    "confidence dimensions must remain evidence-specific"
  );
  assert.equal(
    graph.coverage.overallConfidence,
    calculateMarketOverallConfidence(graph.coverage.dimensions)
  );

  const reportProjection = projectMarketIntelligenceGraphToReport(graph);
  for (const expected of competitorNames) {
    assert.match(
      reportProjection.competitiveLandscape,
      new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  }
  for (const vendor of graph.vendorIntelligence.vendors.filter((item) => item.eligibleForMajorPlayers)) {
    assert.match(reportProjection.majorPlayers, new RegExp(vendor.name.replace(/[()]/g, "\\$&")));
  }
  assert.match(reportProjection.marketInfrastructure, /US Census Bureau/);
  assert.match(reportProjection.marketInfrastructure, /AICPA/);
  assert.match(reportProjection.tamSamSom, /TAM \[Estimated\]: \$8\.4B/);
  assert.match(reportProjection.tamSamSom, /SAM \[Estimated\]/);
  // SOM is honestly reported as pending (not a fabricated percentage of
  // SAM) since this fixture carries no penetration-rate/win-rate evidence
  // -- see the evidence-first market-sizing engine's SOM section.
  assert.match(reportProjection.tamSamSom, /SOM \[Validation Needed\]/);
  assert.doesNotMatch(reportProjection.tamSamSom, /SOM \[Estimated\]/);
  assert.match(reportProjection.sources, /https:\/\/www\.xero\.com\/us\/accounting-software/);
  assert.doesNotMatch(reportProjection.competitiveLandscape, /No validated competitors|None present/i);
  assert.doesNotMatch(
    reportProjection.competitiveLandscape,
    /Gartner|Grand View Research|US Census Bureau|AICPA/
  );
  assert.doesNotMatch(reportProjection.sources, /Validation Required|https:\/\/invalid/);

  const chatRoute = await readFile(
    new URL("../app/api/chat/route.ts", import.meta.url),
    "utf8"
  );
  const marketRoute = await readFile(
    new URL("../app/api/market-analysis/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(chatRoute, /marketIntelligenceGraph: chatMarketGraph/);
  assert.match(marketRoute, /conversationResearch\?\.marketIntelligenceGraph/);
  assert.match(
    marketRoute,
    /projectMarketIntelligenceGraphToReport\(graph, language\)/
  );
  assert.match(
    marketRoute,
    /createReportCacheData\(\s*domainResearch,\s*marketIntelligenceGraph\s*\)/
  );
  const fullReportSerializer = marketRoute.slice(
    marketRoute.indexOf("function serializeMarketReportChunks"),
    marketRoute.indexOf("function createMockMarketReport")
  );
  assert.match(fullReportSerializer, /serializeNormalizedReportChunk/);
  assert.doesNotMatch(fullReportSerializer, /sanitizeMarketReportContent/);
});

test("sizing stays unavailable and explains the evidence gap when endpoints are absent", () => {
  const evidenceWithoutSizing = evidenceFixture.filter(
    (item) => !["R11", "R12"].includes(item.id)
  );
  const graph = buildMarketIntelligenceGraph(
    { evidence: evidenceWithoutSizing },
    prompt
  );
  assert.equal(graph.planningEstimate, null);

  const report = projectMarketIntelligenceGraphToReport(graph);
  // Evidence-first market-sizing recovery loop: instead of the fully
  // generic pipeline-jargon-free notice, tamSamSom now carries the
  // specific sizingGap explanation naming exactly what was searched and
  // found missing -- still an honest non-fabrication (no vendor count or
  // per-buyer figure ever substituted as a market-size figure).
  assert.ok(graph.sizingGap, "expected a sizingGap explaining the evidence gap");
  assert.equal(graph.sizingGap.missingIngredient, "everything");
  assert.equal(report.tamSamSom, graph.sizingGap.explanation);
  assert.match(report.tamSamSom, /found no verifiable numeric evidence/i);
  assert.doesNotMatch(report.tamSamSom, /\$\d/, "must never contain a fabricated dollar figure");
});

test("market contract keeps verified sizing separate from transparent planning estimates", async () => {
  const marketPromptSource = await readFile(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );

  assert.match(marketPromptSource, /Verified TAM \/ SAM \/ SOM is unavailable/);
  assert.match(marketPromptSource, /separate Planning Estimate/);
  assert.match(marketPromptSource, /transparent formula and calculation basis/);
  assert.match(marketPromptSource, /never present it as verified/i);
});
