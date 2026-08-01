import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  classifyReportDomain,
} from "../app/lib/report-engine/domain.ts";
import {
  realEstateFields,
  validateRealEstateReport,
  validateRealEstateReportLanguage,
} from "../app/lib/report-engine/prompts/real-estate.ts";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function createPreliminaryReport() {
  return Object.fromEntries(
    realEstateFields.map((field) => {
      if (field === "finalRecommendation") {
        return [
          field,
          "Insufficient Evidence. Preliminary due-diligence report. What is known: uploaded asset only. What is not known: critical fields. What was externally researched: documented separately. What failed to be researched: documented separately. Top three risks: title, zoning, access. Top three opportunities: Unknown. Exact conditions that would change the decision: authoritative evidence. Next three actions in priority order: title record, zoning record, comparable evidence.",
        ];
      }

      if (field === "recommendedDueDiligence") {
        return [field, "Obtain the official records before investing."];
      }

      if (field === "valuationRange") {
        return [
          field,
          "[Unknown] Valuation Not Yet Defensible. Missing gates: Location, Parcel size, Zoning/use, Comparables, Currency, Calculation method. Evidence acquisition plan: obtain the official registry, municipal planning record, and dated comparable evidence.",
        ];
      }

      return [field, "[Unknown] Unknown"];
    })
  );
}

function createTurkishLanguageReport() {
  const report = Object.fromEntries(
    realEstateFields.map((field) => [
      field,
      "[Unknown] Bu alan için resmî kayıt incelemesi gerekiyor.",
    ])
  );
  report.finalRecommendation =
    "[Recommendation] Bekle. Bu bir ön durum tespiti raporudur.";
  return report;
}

test("property and tapu requests select real-estate before schema construction", () => {
  assert.equal(
    classifyReportDomain("bu arsaya yatırım yapmak istiyorum", [
      { name: "IMG_1042.png", type: "image/png" },
    ]),
    "real_estate"
  );
  assert.equal(
    classifyReportDomain("Assess this title deed and parcel", [
      { name: "tapu.pdf", type: "application/pdf" },
    ]),
    "real_estate"
  );
  assert.equal(
    classifyReportDomain("Build a SaaS platform for real estate agents"),
    "business"
  );

  const route = read("app/lib/report-jobs/plan-executor.ts");
  const classificationIndex = route.indexOf(
    "classifyReportDomain(promptText, analysisAssets)"
  );
  const financialModelIndex = route.indexOf(
    "createCanonicalFinancialAssumptions({",
    classificationIndex
  );

  assert.ok(classificationIndex > 0);
  assert.ok(financialModelIndex > classificationIndex);
  assert.match(
    route.slice(classificationIndex, financialModelIndex),
    /reportDomain === "real_estate"[\s\S]*generateRealEstateInvestmentReport/
  );
});

test("real-estate schema contains only the required due-diligence sections", () => {
  assert.deepEqual(realEstateFields, [
    "assetIdentification",
    "extractedDocumentFacts",
    "ownershipTitleFindings",
    "location",
    "zoningLandUseStatus",
    "accessInfrastructure",
    "comparableMarketEvidence",
    "valuationRange",
    "legalRisks",
    "environmentalGeotechnicalRisks",
    "liquidity",
    "developmentPotential",
    "scenarioAnalysis",
    "investmentScore",
    "missingInformation",
    "recommendedDueDiligence",
    "finalRecommendation",
    "sources",
  ]);
});

test("real-estate validation rejects startup and SaaS metrics", () => {
  for (const forbidden of [
    "ARR",
    "MRR",
    "CAC",
    "LTV",
    "TAM",
    "SAM",
    "SOM",
    "Founder readiness",
    "Customer acquisition",
    "Professional services",
  ]) {
    const report = createPreliminaryReport();
    report.assetIdentification = `[Unknown] ${forbidden}`;

    assert.throws(
      () => validateRealEstateReport(report),
      /domain-inappropriate field/
    );
  }
});

test("ordinary Turkish sentences containing tam are not treated as TAM", () => {
  const report = createPreliminaryReport();
  report.finalRecommendation =
    "Insufficient Evidence. Preliminary due-diligence report. Tam bir yatırım kararı için resmi kayıtlar tamamlanmalıdır.";

  assert.equal(validateRealEstateReport(report), report);
});

test("valid evidence-grounded real-estate report content passes validation", () => {
  const report = createPreliminaryReport();
  report.assetIdentification =
    "[Verified from uploaded asset] Belge bir tapu görüntüsüdür.";
  report.missingInformation =
    "[Unknown] Parsel büyüklüğü, imar durumu ve karşılaştırılabilir satışlar eksiktir.";
  report.valuationRange =
    "[Unknown] Değerleme Henüz Savunulabilir Değil. Eksik doğrulama kapıları: imar ve emsal. Kanıt edinme planı: resmi kayıtları edin. [Required: resmi kayıtlar]";
  report.finalRecommendation =
    "[Recommendation] Bekle. Bu bir Ön durum tespiti raporu; doğrulamalar tamamlanmalıdır.";

  assert.equal(validateRealEstateReport(report), report);
});

test("uppercase TAM is rejected as a forbidden business acronym", () => {
  const report = createPreliminaryReport();
  report.comparableMarketEvidence =
    "[Estimate] TAM was calculated from a generic market assumption.";

  assert.throws(
    () => validateRealEstateReport(report),
    /domain-inappropriate field "TAM"/
  );
});

test("customer acquisition is rejected as a forbidden business phrase", () => {
  const report = createPreliminaryReport();
  report.liquidity =
    "[Estimate] Customer acquisition is expected to determine liquidity.";

  assert.throws(
    () => validateRealEstateReport(report),
    /domain-inappropriate field "Customer acquisition"/i
  );
});

test("valuation is blocked without every evidence prerequisite", () => {
  const report = createPreliminaryReport();
  report.valuationRange =
    "[Estimate] USD 120,000 based on parcel size and nearby prices.";
  report.finalRecommendation = "Conditional proceed.";

  assert.throws(
    () => validateRealEstateReport(report),
    /location, parcel size, zoning\/use, comparables, currency, and calculation method/
  );
});

test("insufficient evidence produces a preliminary report with explicit unknowns", () => {
  const report = createPreliminaryReport();

  assert.equal(validateRealEstateReport(report), report);
  assert.match(report.valuationRange, /Valuation Not Yet Defensible/);
  assert.match(report.missingInformation, /Unknown/);
  assert.match(report.finalRecommendation, /Preliminary due-diligence report/);
});

test("Turkish preliminary reports use a concise localized decision contract", () => {
  const report = createPreliminaryReport();
  report.valuationRange =
    "[Unknown] Değerleme Henüz Savunulabilir Değil. Eksik doğrulama kapıları: imar, emsaller ve hesaplama yöntemi. Kanıt edinme planı: resmi imar kaydı ve tarihli emsal verisi edin. [Required: resmi kayıtlar]";
  report.finalRecommendation =
    "[Recommendation] Bekle. Bu bir Ön durum tespiti raporu; tam değerleme değildir. Bilinenler, araştırılanlar, bilinmeyenler, riskler, fırsatlar, sonraki adımlar ve kararı değiştirecek kanıt açıklandı.";

  assert.equal(validateRealEstateReport(report), report);
});

test("Turkish real-estate reports repair mixed English analytical prose", () => {
  const report = createPreliminaryReport();
  report.assetIdentification =
    "[Verified from uploaded asset] Taşınmaz görüntüsünde il, ilçe, mahalle, ada ve parsel bilgileri açıkça görülmektedir.";
  report.valuationRange =
    "[Unknown] Valuation Not Yet Defensible. Missing gates: imar ve emsal. Evidence acquisition plan: resmi kayıtları edin.";

  assert.equal(validateRealEstateReport(report), report);
});

test("Turkish real-estate language gate removes only arbitrary English prose", () => {
  const report = createTurkishLanguageReport();
  report.location =
    "[Verified from external source] The property should be reviewed with the official municipal zoning record. [R1]";

  assert.equal(validateRealEstateReportLanguage(report, "Turkish"), report);
  assert.doesNotMatch(report.location, /The property should/);
  assert.match(report.location, /güvenilir biçimde çevrilemediği/i);
});

test("source titles and URLs do not trigger the Turkish language gate", () => {
  const report = createTurkishLanguageReport();
  report.sources =
    "[Verified from external source] Hatay Metropolitan Municipality Planning Portal; URL: https://example.gov.tr/planning. [R1]";

  assert.equal(
    validateRealEstateReportLanguage(report, "Turkish"),
    report
  );
});

test("grounded real-estate fallback preserves extracted facts and groups research gaps", () => {
  const route = read("app/lib/report-jobs/plan-executor.ts");

  assert.match(
    route,
    /bundle\.decisionIntelligence\.extractedFacts\.filter/
  );
  assert.match(route, /Doğrulanamayan Kritik Bilgiler/);
  assert.match(route, /const taskGroups = new Map/);
  assert.match(route, /what is known|Bilinenler/i);
  assert.match(route, /Kararı değiştirecek kanıt/);
  assert.match(route, /Yeterli bağımsız dış kanıt bulunmadığı için yatırım skoru hesaplanmadı/);
  assert.match(route, /Ağaçlı Tarla.*imar durumu/s);
  assert.match(
    route,
    /Değerleme Henüz Savunulabilir Değil\. Eksik doğrulama kapıları:[\s\S]*Kanıt edinme planı:/
  );
  assert.match(
    route,
    /Valuation Not Yet Defensible\. Missing gates:[\s\S]*Evidence acquisition plan:/
  );
  assert.doesNotMatch(
    route,
    /bundle\.plan\s*\.map\(\s*\(task\)\s*=>\s*`\[Unknown\] \$\{task\.field\}/
  );
});

test("queued plan execution preserves exact stage failures for the worker", () => {
  const route = read("app/lib/report-jobs/plan-executor.ts");
  const worker = read("app/lib/report-jobs/worker.ts");
  const planner = read("components/Planner.tsx");

  assert.match(route, /function logPlanStageDiagnostic/);
  assert.match(route, /function serializePlanStreamError/);
  assert.match(route, /stage: "asset_extraction"/);
  assert.match(route, /stage: "entity_extraction"/);
  assert.match(route, /stage: "research"/);
  assert.match(route, /stage: "decision_engine"/);
  assert.match(route, /stage: "report_builder"/);
  assert.match(route, /stage: "pdf_preparation"/);
  assert.doesNotMatch(route, /controller\.error\(/);
  assert.match(worker, /readExecutionResponse/);
  assert.match(worker, /event\.fatal === false/);
  assert.match(worker, /readString\(event\.errorStage\)/);
  assert.match(planner, /jobStatus\.error/);
});

test("browser report requests identify and execute the Decision Intelligence pipeline", () => {
  const route = read("app/lib/report-jobs/plan-executor.ts");
  const planner = read("components/Planner.tsx");

  assert.match(planner, /const planRequestUrl = "\/api\/plan"/);
  assert.match(planner, /"X-Zerinix-Pipeline": "decision_intelligence_v1"/);
  assert.doesNotMatch(planner, /fetch\("\/api\/market-analysis"/);
  assert.doesNotMatch(planner, /function analyzeMarket\(/);
  assert.match(route, /X-Zerinix-Pipeline/);
  assert.match(route, /logDecisionPipelineMarker\("PIPELINE", "entered"/);
  assert.match(route, /logDecisionPipelineMarker\("ASSET", "started"/);
  assert.match(route, /logDecisionPipelineMarker\("ENTITY", "started"/);
  assert.match(route, /logDecisionPipelineMarker\("RESEARCH", "started"/);
  assert.match(route, /logDecisionPipelineMarker\("RESEARCH", "finished"/);
  assert.match(route, /console\.info\("\[EVIDENCE\] normalized"/);
  assert.match(route, /logDecisionPipelineMarker\("DECISION", "started"/);
  assert.match(route, /logDecisionPipelineMarker\("DECISION", "finished"/);
  assert.match(route, /logDecisionPipelineMarker\("REPORT", "started"/);
  assert.match(route, /logDecisionPipelineMarker\("REPORT", "finished"/);
  assert.match(route, /console\.info\("\[STREAM\] closed"/);
  assert.match(planner, /console\.info\("\[SESSION\] persisted"/);
  assert.match(planner, /activeReportRequestRef/);
  assert.match(planner, /conversationNavigationGenerationRef\.current \+= 1/);
  assert.match(planner, /reason: "report_generation_active"/);
  const reportFinishedIndex = route.indexOf(
    'logDecisionPipelineMarker("REPORT", "finished"'
  );
  const streamClosedIndex = route.indexOf(
    "closeDecisionPipelineStream(",
    reportFinishedIndex
  );
  const telemetryIndex = route.indexOf(
    "await storeCachedAiResponse",
    reportFinishedIndex
  );
  assert.ok(reportFinishedIndex > 0);
  assert.ok(streamClosedIndex > reportFinishedIndex);
  assert.ok(telemetryIndex > streamClosedIndex);
});

test("planner and saved reports preserve the real-estate schema without startup visuals", () => {
  const planner = read("components/Planner.tsx");
  const reportUtils = read("app/dashboard/report-utils.ts");
  const savedPdf = read("app/dashboard/[id]/ReportPdfButton.tsx");

  assert.match(planner, /realEstateReportFields/);
  assert.match(planner, /reportDomain === "real_estate"/);
  assert.match(planner, /real_estate_investment_analysis/);
  assert.match(planner, /if \(!isDomainDecisionReport\)[\s\S]*Founder Readiness Gauge/);
  assert.match(planner, /Real Estate Evidence & Due-Diligence Methodology/);
  assert.match(planner, /isRealEstateReport[\s\S]*Evidence Quality[\s\S]*Main Opportunity[\s\S]*Required Next Action/);
  assert.match(planner, /isRealEstateReport[\s\S]*\? "Due-Diligence Report"[\s\S]*: "Investor Ready"/);
  assert.match(savedPdf, /Real Estate Evidence & Due-Diligence Methodology/);
  assert.match(savedPdf, /isRealEstateReport[\s\S]*Overall Investment Score/);
  assert.match(savedPdf, /isRealEstateReport[\s\S]*\? "Due-Diligence Report"[\s\S]*: "Investor Ready"/);
  assert.match(reportUtils, /Real Estate Investment Analysis/);
  assert.match(reportUtils, /assetIdentification: "Asset Identification"/);
});
