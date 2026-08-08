import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  assertReportIsolation,
  findReportIsolationViolations,
  ReportIsolationError,
} from "../app/lib/report-engine/report-isolation-validator.ts";
import {
  assessMarketEntryConfidence,
  buildMarketExecutiveSummary,
  buildMarketEntryRecommendation,
  localizeMarketEntryDecision,
} from "../app/lib/report-engine/market-intelligence-presentation.ts";
import {
  buildDecisionSupportDirectives,
  buildExecutivePresentationDirectives,
  buildFullReportStructureDirectives,
} from "../app/lib/ai/report-quality-directives.ts";
import { formatMarketResearchCoverageForReport } from "../app/lib/ai/market-research-coverage.ts";

const marketAnalysisSource = readFileSync(
  new URL("../app/api/market-analysis/route.ts", import.meta.url),
  "utf8"
);
const marketPromptSource = readFileSync(
  new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
  "utf8"
);
const planPromptSource = readFileSync(
  new URL("../app/lib/report-engine/prompts/plan.ts", import.meta.url),
  "utf8"
);
const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
// A synthetic MarketResearchCoverage fixture, shaped like the real output
// of evaluateMarketResearchCoverage -- deliberately includes non-zero
// founderReadiness/executionReadiness dimensions to prove the presentation
// module never reads them.
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
      marketConfidence: 72,
      competitiveEvidence: 65,
      financialEvidence: 60,
      productEvidence: 55,
      executionReadiness: 999, // must never influence the market-facing decision
      founderReadiness: 999, // must never influence the market-facing decision
    },
    overallConfidence: 68,
    sourceClasses: ["market_research", "government_statistics"],
    ...overrides,
  };
}

// Reproduces the reported production bug: a Turkish car-wash Market
// Intelligence request ("Türkiye'de oto yıkama işine girmek istiyorum.
// Bana pazar analizi yap.") whose generated sections must never contain
// Business Idea Validation's or Strategic Advisory's vocabulary.
const carWashMarketSections = {
  executiveSummary: "Bottom Line: placeholder, replaced below.",
  marketOverview: "Türkiye'deki oto yıkama sektörü, artan araç sahipliği ve şehirleşme ile büyümektedir.",
  marketSize: "Pazar büyüklüğü 2024 yılında yaklaşık 8 milyar TL olarak tahmin edilmektedir.",
  cagr: "2024-2029 CAGR yaklaşık %9 olarak öngörülmektedir.",
  marketSegmentation: "Segmentler: self-servis, otomatik ve detaylı bakım hizmetleri.",
  regionalAnalysis: "İstanbul ve Ankara en yüksek talep yoğunluğuna sahiptir.",
  industryTrends: "Su tasarruflu ekipman ve mobil oto yıkama hizmetleri öne çıkmaktadır.",
  competitiveLandscape: "Sektör parçalıdır; büyük zincirler ve bağımsız işletmeler bir aradadır.",
  majorPlayers: "Bölgesel zincirler ve bağımsız operatörler pazarın çoğunu oluşturur.",
  customerSegments: "Bireysel araç sahipleri ve filo müşterileri ana segmentlerdir.",
  marketDrivers: "Artan araç sayısı ve şehirleşme talebi desteklemektedir.",
  barriers: "Su kısıtlamaları ve yerel izin gereklilikleri giriş engelidir.",
  opportunities: "Mobil ve randevu bazlı hizmetler için doğrulanmamış bir talep boşluğu bulunmaktadır.",
  threats: "Su kısıtlamaları sıkılaşırsa faaliyet maliyetleri önemli ölçüde artabilir.",
  tamSamSom: "TAM 8 milyar TL, SAM 1,2 milyar TL, SOM 60 milyon TL olarak tahmin edilmektedir.",
  portersFiveForces: "Rekabet yüksektir; tedarikçi gücü düşüktür.",
  strategicRecommendations: "İlk 90 günde iki pilot lokasyon ile talep doğrulaması önerilir.",
  sources: "[Verified from external source] Title: Turkey Car Wash Market Report",
};

test("reproduces the reported bug scenario: a Turkish car-wash Market Intelligence report never contains Business Idea Validation vocabulary", () => {
  const coverage = fixtureCoverage();
  const sections = {
    ...carWashMarketSections,
    executiveSummary: buildMarketExecutiveSummary(carWashMarketSections, "Turkish", coverage),
    strategicRecommendations: `${carWashMarketSections.strategicRecommendations}\n\n${buildMarketEntryRecommendation(carWashMarketSections, "Turkish", coverage)}`,
  };

  // Assert the exact symptoms reported: none of these may appear anywhere.
  const fullText = Object.values(sections).join("\n");
  for (const forbidden of [
    /founder readiness/i,
    /validation gate/i,
    /\brunway\b/i,
    /ebitda/i,
    /founder (?:score|scoring|execution|decision engine)/i,
    /\bPASS\b|\bHOLD\b|\bVALIDATE\b|\bREJECT\b/,
    /product[\s-]market fit|\bpmf\b/i,
    /fundraising|funding round|seed round/i,
    /build\s*\/\s*(?:don'?t|do not)\s*build/i,
  ]) {
    assert.doesNotMatch(fullText, forbidden, `forbidden term matched: ${forbidden}`);
  }

  assert.doesNotThrow(() => assertReportIsolation("market_intelligence", sections));
});

test("assessMarketEntryConfidence never derives its decision from founderReadiness or executionReadiness", () => {
  const low = assessMarketEntryConfidence(
    fixtureCoverage({ dimensions: { marketConfidence: 10, competitiveEvidence: 10, financialEvidence: 10, productEvidence: 10, founderReadiness: 100, executionReadiness: 100 } })
  );
  const high = assessMarketEntryConfidence(
    fixtureCoverage({ dimensions: { marketConfidence: 90, competitiveEvidence: 90, financialEvidence: 90, productEvidence: 90, founderReadiness: 0, executionReadiness: 0 } })
  );

  assert.equal(low.decision, "AVOID");
  assert.equal(high.decision, "ENTER");
});

test("buildMarketExecutiveSummary discusses only market attractiveness, demand, competition, and entry strategy", () => {
  const coverage = fixtureCoverage();
  const summary = buildMarketExecutiveSummary(carWashMarketSections, "English", coverage);

  assert.match(summary, /Bottom Line:/);
  assert.match(summary, /Key Findings:/);
  assert.match(summary, /Biggest Opportunity:/);
  assert.match(summary, /Biggest Risk:/);
  assert.match(summary, /(?:ENTER|MONITOR|AVOID)/);
  assert.doesNotMatch(summary, /founder|EBITDA|runway|PMF|fundrais/i);
});

test("buildMarketEntryRecommendation answers should-enter/why/where/when/how and never evaluates a founder", () => {
  const coverage = fixtureCoverage();
  const recommendation = buildMarketEntryRecommendation(carWashMarketSections, "English", coverage);

  assert.match(recommendation, /Should this market be entered/);
  assert.match(recommendation, /Why:/);
  assert.match(recommendation, /Where:/);
  assert.match(recommendation, /When:/);
  assert.match(recommendation, /How:/);
  assert.doesNotMatch(recommendation, /founder|EBITDA|runway|PMF|fundrais/i);
});

test("localizeMarketEntryDecision covers every supported language with market-entry vocabulary, not PASS/HOLD/VALIDATE/REJECT", () => {
  for (const language of ["English", "Turkish", "German", "French", "Spanish"]) {
    for (const decision of ["ENTER", "MONITOR", "AVOID"]) {
      const localized = localizeMarketEntryDecision(decision, language);
      assert.ok(localized, `${language}/${decision} produced no value`);
      assert.doesNotMatch(localized, /^(?:PASS|HOLD|VALIDATE|REJECT)$/);
    }
  }
});

// --- report-isolation-validator.ts -----------------------------------

test("findReportIsolationViolations flags every symptom named in the production bug report for market_intelligence", () => {
  const contaminated = {
    executiveSummary: "Founder Readiness is strong and the Validation Gate has closed.",
    tamSamSom: "Runway is 14 months and EBITDA margin is healthy.",
    strategicRecommendations: "Bottom Line: VALIDATE. This is a Build / Don't Build decision requiring a funding round.",
  };

  const violations = findReportIsolationViolations("market_intelligence", contaminated);
  const terms = violations.map((v) => v.term);

  assert.ok(terms.some((t) => /Founder Readiness/i.test(t)));
  assert.ok(terms.some((t) => /Validation Gate/i.test(t)));
  assert.ok(terms.some((t) => /Runway/i.test(t)));
  assert.ok(terms.some((t) => /EBITDA/i.test(t)));
  assert.ok(terms.some((t) => /decision verdict token/i.test(t)));
  assert.ok(terms.some((t) => /Build \/ Don't Build/i.test(t)));
  assert.ok(terms.some((t) => /Fundraising/i.test(t)));

  assert.throws(
    () => assertReportIsolation("market_intelligence", contaminated),
    ReportIsolationError
  );
});

test("findReportIsolationViolations never flags clean market_intelligence content", () => {
  const violations = findReportIsolationViolations("market_intelligence", carWashMarketSections);
  assert.deepEqual(violations, []);
});

test("findReportIsolationViolations never flags a legitimate Business Idea Validation report for its own founder/EBITDA/runway content", () => {
  const legitimateBusinessPlan = {
    executiveSummary: "Bottom Line: VALIDATE. Founder Score reflects strong execution readiness.",
    financialDashboard: "Runway: 11 months. EBITDA: -$40K/month. Burn Rate: $60K/month.",
    founderScore: "Founder Readiness: 72/100. Validation Confidence: 58/100.",
  };

  assert.deepEqual(findReportIsolationViolations("business_plan", legitimateBusinessPlan), []);
  assert.doesNotThrow(() => assertReportIsolation("business_plan", legitimateBusinessPlan));
});

test("findReportIsolationViolations flags Market Intelligence's exclusive template headings inside a Business Idea Validation report", () => {
  const contaminated = {
    marketOverview: "Market Overview\nThis section describes the category at large.",
    regionalAnalysis: "Regional Analysis\nEurope and North America are compared.",
  };

  const violations = findReportIsolationViolations("business_plan", contaminated);
  assert.ok(violations.some((v) => /Market Overview/i.test(v.term)));
  assert.ok(violations.some((v) => /Regional Analysis/i.test(v.term)));
});

test("the 'competitive landscape' phrase is only flagged as a heading, not as ordinary Business Plan prose", () => {
  const legitimateProse = {
    marketOpportunity:
      "Given the competitive landscape, the reachable niche is smaller than the category total.",
  };
  assert.deepEqual(findReportIsolationViolations("business_plan", legitimateProse), []);

  const asHeading = {
    marketOpportunity: "Competitive Landscape\nA rival-by-rival breakdown follows.",
  };
  assert.ok(findReportIsolationViolations("business_plan", asHeading).length > 0);
});

test("strategic_advisory rejects both Business Idea Validation and Market Intelligence vocabulary", () => {
  const foundersLeak = { domainFindings: "Founder Readiness and Runway are strong." };
  const marketLeak = { domainFindings: "Market Overview\nRegional Analysis follows." };

  assert.throws(() => assertReportIsolation("strategic_advisory", foundersLeak), ReportIsolationError);
  assert.throws(() => assertReportIsolation("strategic_advisory", marketLeak), ReportIsolationError);
});

test("strategic_advisory allows its own genuine domain-analysis content", () => {
  const cleanDomainReport = {
    subjectIdentification: "Riverside Precision Machining Inc., a CNC manufacturing plant.",
    domainFindings: "Customer concentration is materially above the sector benchmark.",
    financialImplications: "A revenue decline of 15-25% is plausible if a top account is lost.",
    finalRecommendation: "Conditional proceed pending an environmental Phase I assessment.",
  };

  assert.deepEqual(findReportIsolationViolations("strategic_advisory", cleanDomainReport), []);
});

// --- market-analysis/route.ts: static source assertions ----------------
// This file has many real (non-type-only) "@/" imports that plain
// `node --test` cannot resolve, matching every other test in this suite
// that touches it -- verified via static source assertions instead of a
// live import.

test("market-analysis/route.ts no longer depends on the founder/investment scoring engine for report content", () => {
  // Matches an actual call/definition (identifier immediately followed by
  // "(") so this doesn't false-positive on the explanatory comments left
  // behind documenting what was removed and why.
  assert.doesNotMatch(marketAnalysisSource, /buildMarketExecutiveScorecard\(/);
  assert.doesNotMatch(marketAnalysisSource, /buildMarketCeoSummary\(/);
  assert.doesNotMatch(marketAnalysisSource, /buildMarketFinancialConfidenceAppendix\(/);
  assert.doesNotMatch(marketAnalysisSource, /buildMarketFinancialConsistencyTargets\(/);
  assert.doesNotMatch(marketAnalysisSource, /buildMarketFounderDecisionEngine\(/);
  assert.doesNotMatch(marketAnalysisSource, /context\.investmentScore\./);
  assert.doesNotMatch(marketAnalysisSource, /context\.reportIntelligence\./);
  assert.doesNotMatch(marketAnalysisSource, /^if \(false\)/m);
});

test("market-analysis/route.ts imports and calls the isolated presentation module and the isolation validator", () => {
  assert.match(marketAnalysisSource, /from "@\/app\/lib\/report-engine\/market-intelligence-presentation"/);
  assert.match(marketAnalysisSource, /buildMarketExecutiveSummary\(/);
  assert.match(marketAnalysisSource, /buildMarketEntryRecommendation\(/);
  assert.match(marketAnalysisSource, /assertReportIsolation\(\s*"market_intelligence"/);
});

test("market-analysis/route.ts's decision vocabulary is ENTER/MONITOR/AVOID, not the Business Plan's PASS/HOLD/VALIDATE/REJECT", () => {
  assert.doesNotMatch(marketAnalysisSource, /\bWAIT\b.{0,20}Hold for validation/);
  assert.doesNotMatch(marketAnalysisSource, /Founder Decision Engine/);
  assert.doesNotMatch(marketAnalysisSource, /Investment Recommendation/);
});

test("plan-executor.ts and market-analysis/route.ts both invoke assertReportIsolation for their own report type", () => {
  assert.match(planExecutorSource, /assertReportIsolation\(\s*"business_plan"/);
  assert.match(planExecutorSource, /assertReportIsolation\(\s*"strategic_advisory"/);
});

// --- report-quality-directives.ts: kind-specific scorecard ----------------

test("buildExecutivePresentationDirectives never gives Market Intelligence or Strategic Advisory Business Plan's Investment Readiness / CEO Summary framing", () => {
  const marketDirectives = buildExecutivePresentationDirectives("market_analysis").join("\n");
  const domainDirectives = buildExecutivePresentationDirectives("specialized_analysis").join("\n");
  const planDirectives = buildExecutivePresentationDirectives("business_plan").join("\n");

  assert.doesNotMatch(marketDirectives, /Investment Readiness/);
  assert.doesNotMatch(marketDirectives, /CEO Summary/);
  assert.doesNotMatch(domainDirectives, /Investment Readiness/);
  assert.doesNotMatch(domainDirectives, /CEO Summary/);

  // Business Plan itself is untouched -- this is isolation, not deletion.
  assert.match(planDirectives, /Investment Readiness/);
  assert.match(planDirectives, /CEO Summary/);
});

test("buildDecisionSupportDirectives is Business-Plan-only at the type level and its founder/CEO/Roadmap content never leaks into market.ts or domain-analysis.ts", () => {
  assert.doesNotMatch(marketPromptSource, /buildDecisionSupportDirectives/);
  const domainAnalysisSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/domain-analysis.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(domainAnalysisSource, /buildDecisionSupportDirectives/);

  const planDirectives = buildDecisionSupportDirectives("business_plan").join("\n");
  assert.match(planDirectives, /founder/i);
  assert.match(planDirectives, /Roadmap/);
  assert.match(planDirectives, /CEO Brief/);
});

test("buildFullReportStructureDirectives is Business-Plan-only and is never called with market_analysis in practice", () => {
  assert.doesNotMatch(planExecutorSource, /buildFullReportStructureDirectives\(\s*"market_analysis"/);
  const structureDirectives = buildFullReportStructureDirectives("business_plan").join("\n");
  assert.match(structureDirectives, /Roadmap/);
});

// --- market-research-coverage.ts: AI-facing text never names founder/execution --

test("formatMarketResearchCoverageForReport never injects the words 'founder' or 'execution' into the model's context", () => {
  const coverage = fixtureCoverage();
  const output = formatMarketResearchCoverageForReport(coverage);
  assert.doesNotMatch(output, /founder|execution/i);
  // Sanity: the function still produces real, non-empty guidance text.
  assert.match(output, /market/i);
});

// --- market.ts field prompts: unchanged isolation guarantees ------------

test("market.ts's own field prompts still explicitly forbid founder/business-plan content (unchanged by this fix)", () => {
  assert.match(marketPromptSource, /Do not introduce business-plan, founder, product, pricing-strategy, sales-strategy, or unit-economics content/);
  assert.match(planPromptSource, /founder|Founder/); // sanity: plan.ts legitimately keeps founder content
});
