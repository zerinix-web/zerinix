import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { realEstateFields } from "../app/lib/report-engine/prompts/real-estate.ts";
import {
  collectRealEstateResearchSourceContent,
  prepareRealEstateReportForPresentation,
} from "../app/lib/report-engine/real-estate-presentation.ts";
import {
  assertRealEstateResearchComposition,
  assertRealEstateUsesAvailableExternalEvidence,
  calculateRealEstateResearchComposition,
  deduplicateUsableRealEstateExternalEvidence,
} from "../app/lib/report-engine/real-estate-quality.mjs";
import {
  EvidenceNormalizer,
  resolveResearchTaskReference,
} from "../app/lib/research-evidence/index.mjs";

function createInternalReport() {
  const report = Object.fromEntries(
    realEstateFields.map((field) => [
      field,
      `[Unknown] ${field} için doğrulama gerekiyor. [Required: resmî kayıt]`,
    ])
  );

  report.assetIdentification =
    "[Verified from uploaded asset] Ada: 1517. [Asset: IMG_5412.PNG]";
  report.extractedDocumentFacts = [
    "[Verified from uploaded asset] İl: Hatay. [Asset: IMG_5412.PNG]",
    "[Verified from uploaded asset] İlçe: Defne. [Asset: IMG_5412.PNG]",
    "[Verified from uploaded asset] Mahalle: Dursunlu. [Asset: IMG_5412.PNG]",
    "[Verified from uploaded asset] Mevkii: Tamurcu. [Asset: IMG_5412.PNG]",
    "[Verified from uploaded asset] Ada: 1517. [Asset: IMG_5412.PNG]",
    "[Verified from uploaded asset] Parsel: 1. [Asset: IMG_5412.PNG]",
    "[Verified from uploaded asset] Yüzölçümü: 6.364,62 m². [Asset: IMG_5412.PNG]",
    "[Verified from uploaded asset] Nitelik: Ağaçlı Tarla. [Asset: IMG_5412.PNG]",
  ].join("\n");
  report.location =
    "[Verified from uploaded asset] Ada: 1517. [Asset: IMG_5412.PNG]";
  report.zoningLandUseStatus =
    "[Unknown] Bu veri açık kaynaklardan doğrulanamadı. [Required: belediye imar belgesi]";
  report.finalRecommendation =
    "[Recommendation] Wait. Preliminary due-diligence report. What is known: Taşınmaz Bilgileri bölümündeki belge verileri. What was researched: imar, erişim ve risk. Top risks: imar, yol ve tapu belirsizliği. Top opportunities: resmî doğrulama sonrası geliştirme potansiyeli. Next actions: resmî kayıtları incele. [Basis: R1]";
  report.sources =
    "[Verified from official source] Kaynak başlığı: Defne Belediyesi İmar Duyurusu; Kurum/site: Defne Belediyesi; URL: https://www.defne.bel.tr/duyuru/imar-plani; Erişim tarihi: 30.07.2026. [R1]";

  return report;
}

test("real-estate presentation shows each OCR identity fact only once", () => {
  const presented = prepareRealEstateReportForPresentation({
    report: createInternalReport(),
    language: "Turkish",
    assetNames: ["IMG_5412.PNG"],
  });
  const combined = Object.values(presented).join("\n");

  assert.equal(combined.match(/Ada:\s*1517/g)?.length, 1);
  assert.match(presented.extractedDocumentFacts, /İl:\s*Hatay/);
  assert.match(presented.extractedDocumentFacts, /Parsel:\s*1/);
  assert.doesNotMatch(presented.location, /Ada:\s*1517/);
});

test("real-estate presentation removes internal labels and uploaded filenames", () => {
  const presented = prepareRealEstateReportForPresentation({
    report: createInternalReport(),
    language: "Turkish",
    assetNames: ["IMG_5412.PNG"],
  });
  const combined = Object.values(presented).join("\n");

  assert.doesNotMatch(
    combined,
    /\[(?:Verified from uploaded asset|Unknown|Recommendation|Basis|Required)\]/i
  );
  assert.doesNotMatch(
    combined,
    /\b(?:Asset|uploaded_asset|real_estate|property_document|Likely domain|Likely content type)\b/i
  );
  assert.doesNotMatch(combined, /IMG_5412\.PNG/i);
});

test("Turkish real-estate presentation localizes system decision prose", () => {
  const report = createInternalReport();
  report.finalRecommendation +=
    "\nNot verified. See Development Potential.\nsource parsing diagnostics.\nURL: belge\n- hatay.\n- csb.";
  const presented = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
    assetNames: ["IMG_5412.PNG"],
  });
  const combined = Object.values(presented).join("\n");

  assert.match(presented.finalRecommendation, /^Karar: BEKLE\b/);
  assert.doesNotMatch(
    combined,
    /\b(?:Wait|Preliminary due-diligence report|What is known|What was researched|Top risks|Top opportunities|Next actions|Unknown|Required)\b/i
  );
  assert.match(combined, /doğrulanmadı/i);
  assert.match(combined, /Mevcut kanıtlarla bağımsız bir yatırım fırsatı doğrulanmadı/);
  assert.doesNotMatch(combined, /source parsing diagnostics/i);
  assert.doesNotMatch(combined, /URL:\s*belge|(?:^|\n)\s*-\s*(?:hatay|csb)\./i);
});

test("claim-level source mapping requires successful evidence for the same section", () => {
  const report = createInternalReport();
  const url = "https://www.defne.bel.tr/imar/hatay-defne-dursunlu/1517-1";
  report.zoningLandUseStatus =
    `[Verified from official source] Hatay ili Defne ilçesi Dursunlu Mahallesi Ada 1517 Parsel 1 için resmî imar planı kaydı. URL: ${url}`;
  report.sources =
    `[Verified from official source] Kaynak başlığı: Defne Belediyesi Parsel İmar Kaydı; URL: ${url}`;
  const evidence = {
    label: "Verified from official source",
    field: "zoning",
    claim:
      "Hatay ili Defne ilçesi Dursunlu Mahallesi Ada 1517 Parsel 1 imar planı",
    value: "Parsel için resmî plan kaydı",
    sourceTitle: "Defne Belediyesi Parsel İmar Kaydı",
    publisher: "Defne Belediyesi",
    url,
  };

  const failed = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
    evidence: [{ ...evidence, retrievalStatus: "failed" }],
  });
  const successful = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
    evidence: [{ ...evidence, retrievalStatus: "success" }],
  });

  assert.match(failed.sources, /Birincil kaynak: Yüklenen taşınmaz belgesi/);
  assert.match(failed.sources, /Gerekli doğrulama kaynakları/);
  assert.doesNotMatch(failed.sources, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(successful.zoningLandUseStatus, /Dış kaynaktan doğrulandı/);
  assert.match(successful.sources, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("real source metadata renders as a concise title, domain, and exact link", () => {
  const report = createInternalReport();
  report.zoningLandUseStatus =
    "[Verified from official source] Hatay ili Defne ilçesi Dursunlu Mahallesi Ada 1517 Parsel 1 için resmî imar planı kaydı yayımlandı. URL: https://www.defne.bel.tr/imar/hatay-defne-dursunlu/1517-1 [R1]";
  report.sources =
    "[Verified from official source] Kaynak başlığı: Defne Belediyesi Parsel İmar Kaydı; URL: https://www.defne.bel.tr/imar/hatay-defne-dursunlu/1517-1 [R1]";
  const presented = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
    assetNames: ["IMG_5412.PNG"],
  });

  assert.match(presented.sources, /Defne Belediyesi Parsel İmar Kaydı/);
  assert.match(presented.sources, /defne\.bel\.tr/);
  assert.match(
    presented.sources,
    /https:\/\/www\.defne\.bel\.tr\/imar\/hatay-defne-dursunlu\/1517-1/
  );
  assert.doesNotMatch(presented.sources, /Erişim tarihi|T\d{2}:\d{2}:\d{2}/);
});

test("truthfulness gate rejects failed, homepage, placeholder, and section-irrelevant evidence", () => {
  const base = {
    label: "Verified from official source",
    field: "zoning",
    claim: "Ada 1517 Parsel 1 için imar planı kaydı",
    value: "Plan kaydı bulundu",
    sourceTitle: "Defne Belediyesi Parsel İmar Kaydı",
    publisher: "Defne Belediyesi",
    retrievalStatus: "completed_with_evidence",
  };

  assert.equal(
    deduplicateUsableRealEstateExternalEvidence([
      { ...base, url: "https://www.defne.bel.tr" },
      { ...base, url: "https://www.defne.bel.tr/yüklenen/belge" },
      { ...base, url: "https://www.defne.bel.tr/parsel-sorgu" },
      { ...base, url: "https://www.defne.bel.tr/imar/plan.png" },
      { ...base, url: "" },
      {
        ...base,
        field: "comparables",
        claim: "Hatay deprem risk planı",
        value: "Bölgesel deprem riski",
        sourceTitle: "AFAD İl Risk Azaltma Planı",
        url: "https://hatay.afad.gov.tr/irap",
      },
      {
        ...base,
        field: "comparables",
        claim: "Haberde arsa fiyatı 2.000 TL/m² olarak belirtildi",
        value: "2.000 TL/m²",
        sourceTitle: "Bölgesel Arsa Fiyatları Haberi",
        publisher: "Yerel Haber",
        url: "https://yerelhaber.com.tr/haber/arsa-fiyatlari",
      },
      {
        ...base,
        claim: "Parselin imar durumu uygun olarak doğrulandı",
        value: "Uygun",
        sourceTitle: "Belediye İmar Duyurusu",
        url: "https://www.defne.bel.tr/duyuru/imar-plani",
      },
      {
        ...base,
        retrievalStatus: "failed",
        url: "https://www.defne.bel.tr/imar/1517-1",
      },
    ]).length,
    0
  );
});

test("usable source counts are deduplicated from canonical evidence only", () => {
  const evidence = {
    label: "Verified from official source",
    field: "zoning",
    claim: "Ada 1517 Parsel 1 imar planı",
    value: "Plan paftası kaydı",
    sourceTitle: "Defne Belediyesi İmar Planı",
    publisher: "Defne Belediyesi",
    retrievalStatus: "success",
    url: "https://www.defne.bel.tr/imar/1517-1?utm_source=test",
  };
  const usable = deduplicateUsableRealEstateExternalEvidence([
    evidence,
    { ...evidence, url: "https://www.defne.bel.tr/imar/1517-1" },
  ]);

  assert.equal(usable.length, 1);
});

test("presentation removes synthetic sources, ISO timestamps, repeated asset basis, and artificial confidence", () => {
  const report = createInternalReport();
  report.assetIdentification =
    "[Verified from uploaded asset] Belge gayrimenkul kaydıdır. Güven: 99/100. Kaynak: IMG_5412.PNG. Erişim tarihi: 2026-07-31T10:15:30.000Z. [Asset: IMG_5412.PNG]";
  report.extractedDocumentFacts = [
    "[Verified from uploaded asset] İl: Hatay. [Asset: IMG_5412.PNG]",
    "[Verified from uploaded asset] İlçe: Defne. [Asset: IMG_5412.PNG]",
    "[Verified from uploaded asset] Mahalle: Dursunlu. [Asset: IMG_5412.PNG]",
    "[Verified from uploaded asset] Ada: 1517. Güven: 99/100. Kaynak: IMG_5412.PNG. Karar Gerekçesi: Belgeden doğrudan çıkarılan bu bilgi taşınmaz kimliğinin değerlendirme temelidir. [Asset: IMG_5412.PNG]",
    "[Verified from uploaded asset] Parsel: 1. Güven: 99/100. Kaynak: IMG_5412.PNG. Karar Gerekçesi: Belgeden doğrudan çıkarılan bu bilgi taşınmaz kimliğinin değerlendirme temelidir. [Asset: IMG_5412.PNG]",
  ].join("\n");
  report.sources = [
    "[Verified from official source] Kaynak başlığı: Sahte belge; URL: https://belediye.gov.tr/yüklenen/belge",
    "[Verified from official source] Kaynak başlığı: Defne Belediyesi İmar Planı; URL: https://www.defne.bel.tr/imar/1517-1; Erişim tarihi: 2026-07-31T10:15:30.000Z",
    "[Verified from official source] Kaynak başlığı: Defne Belediyesi İmar Planı; URL: https://www.defne.bel.tr/imar/1517-1?utm_source=duplicate",
  ].join("\n");
  report.zoningLandUseStatus =
    "[Verified from official source] Hatay ili Defne ilçesi Dursunlu Mahallesi Ada 1517 Parsel 1 için resmî imar planı kaydı. URL: https://www.defne.bel.tr/imar/1517-1 [R1]";
  report.finalRecommendation =
    "[Recommendation] Bekle. 10 gerçek dış kaynak değerlendirildi. Karar güveni: 68/100. Kanıt Yetersiz.";

  const presented = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
    assetNames: ["IMG_5412.PNG"],
  });
  const combined = Object.values(presented).join("\n");

  assert.match(presented.assetIdentification, /Belgeden çıkarıldı/);
  assert.equal(presented.sources.split("\n").length, 2);
  assert.doesNotMatch(presented.finalRecommendation, /10 gerçek dış kaynak/);
  assert.doesNotMatch(combined, /99\/100|68\/100|T10:15:30|yüklenen\/belge/);
  assert.equal(combined.match(/Kaynak:\s*yüklenen belge/gi)?.length || 0, 0);
});

test("an unverified recommendation link is not counted as a usable source", () => {
  const report = createInternalReport();
  report.sources = "[Unknown] Kaynak doğrulanamadı.";
  report.recommendedDueDiligence =
    "[Recommendation] Belediye ana sayfasını inceleyin: https://www.defne.bel.tr/imar/basvuru";
  report.finalRecommendation =
    "[Recommendation] Bekle. 7 gerçek dış kaynak değerlendirildi. Kanıt Yetersiz.";

  const presented = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
  });

  assert.match(presented.sources, /Birincil kaynak/);
  assert.match(presented.sources, /Gerekli doğrulama kaynakları/);
  assert.doesNotMatch(presented.sources, /https?:\/\//);
});

test("city-only evidence and unrelated comparable listings do not survive exact-section filtering", () => {
  const report = createInternalReport();
  const cityOnlyUrl = "https://www.defne.bel.tr/duyuru/ilce-imar-plani";
  const unrelatedUrl = "https://ilan.example.tr/harbiye/tarla-2026";
  const comparableUrl = "https://ilan.example.tr/dursunlu/tamurcu-tarla-2026";
  report.zoningLandUseStatus =
    `[Verified from official source] Defne ilçesinde imar çalışmaları yürütülmektedir. URL: ${cityOnlyUrl}`;
  report.comparableMarketEvidence = [
    `[Verified from external source] Harbiye Mahallesi tarla ilanı; 2026; 6.000 m²; 12.000.000 TL satılık ilan. URL: ${unrelatedUrl}`,
    `[Verified from external source] Dursunlu Mahallesi Tamurcu mevkii Ağaçlı Tarla ilanı; 2026; 6.000 m²; 12.000.000 TL satılık ilan. URL: ${comparableUrl}`,
  ].join("\n");
  report.sources = [
    `[Verified from official source] Kaynak başlığı: İlçe İmar Sayfası; URL: ${cityOnlyUrl}`,
    `[Verified from external source] Kaynak başlığı: Harbiye Tarla İlanı; URL: ${unrelatedUrl}`,
    `[Verified from external source] Kaynak başlığı: Dursunlu Karşılaştırılabilir Tarla İlanı; URL: ${comparableUrl}`,
  ].join("\n");

  const presented = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
  });

  assert.match(presented.zoningLandUseStatus, /Parsel bazlı resmî imar durumu henüz doğrulanmadı/);
  assert.doesNotMatch(presented.comparableMarketEvidence, /Harbiye/);
  assert.match(presented.comparableMarketEvidence, /Dursunlu/);
  assert.equal(presented.sources.split("\n").length, 2);
  assert.match(presented.sources, /Dursunlu Karşılaştırılabilir Tarla İlanı/);
});

test("resolved document facts are not repeated as missing and split currency values are repaired", () => {
  const report = createInternalReport();
  report.missingInformation =
    "Eksik Bilgiler: belge türü, asset, parsel alanı, imar durumu, güncel tapu kaydı.\nResmî parsel alanı doğrulaması ayrıca gereklidir.";
  report.extractedDocumentFacts +=
    "\n[Verified from uploaded asset] Ada: Pafta 42. [Asset: IMG_5412.PNG]";
  report.valuationRange =
    "[Unknown] Desteklenmeyen fiyat örneği 1.\n000.000 TL olarak kullanılmamalıdır.";

  const presented = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
  });

  assert.doesNotMatch(
    presented.missingInformation.split("\n")[0],
    /belge türü|parsel alanı/i
  );
  assert.doesNotMatch(presented.missingInformation, /\basset\b/i);
  assert.match(presented.missingInformation, /imar durumu/);
  assert.match(presented.missingInformation, /Resmî parsel alanı doğrulaması/);
  assert.doesNotMatch(presented.valuationRange, /1\.000\.000 TL|\n000\.000 TL/);
  assert.match(presented.valuationRange, /değerleme aralığı oluşturulmadı/);
  assert.match(presented.extractedDocumentFacts, /Belgeden çıkarıldı|Ada:\s*1517/);
  assert.match(presented.extractedDocumentFacts, /Pafta:\s*42/);
  assert.doesNotMatch(presented.extractedDocumentFacts, /Ada:\s*Pafta/i);
});

test("three Web Search sources keep their task mapping and reach the report without the global fallback", () => {
  const accessedAt = "2026-07-30T12:00:00.000Z";
  const tasks = [
    { id: "RE-zoning", field: "zoning" },
    { id: "RE-hazards", field: "hazards" },
    { id: "RE-infrastructure", field: "infrastructure" },
  ];
  const providerResults = [
    {
      taskId: "RE-zoning",
      field: "Zoning/Imar Plan Status",
      title: "Defne Belediyesi İmar Planı",
      url: "https://defne.bel.tr/plan/dursunlu",
      snippet: "Dursunlu bölgesine ilişkin plan belgesi yayımlanmıştır.",
    },
    {
      taskId: "RE-hazards",
      field: "Regional Hazard Evidence",
      title: "AFAD Hatay İl Risk Azaltma Planı",
      url: "https://hatay.afad.gov.tr/irap",
      snippet: "Hatay için bölgesel afet riskleri değerlendirilmiştir.",
    },
    {
      taskId: "RE-infrastructure",
      field: "Infrastructure Findings",
      title: "Hatay Altyapı Çalışmaları",
      url: "https://hatay.bel.tr/altyapi/defne",
      snippet: "Defne ilçesindeki altyapı çalışmaları açıklanmıştır.",
    },
  ];
  const normalizer = new EvidenceNormalizer();
  const normalized = providerResults.map((result) => {
    const task = resolveResearchTaskReference(result, tasks);
    const source = normalizer.normalize(result, { collectedAt: accessedAt });
    return { ...source, field: task?.field || "" };
  });

  assert.equal(normalized.length, 3);
  assert.deepEqual(
    normalized.map((item) => item.field),
    ["zoning", "hazards", "infrastructure"]
  );
  assert.equal(normalized[0].source, "defne.bel.tr");
  assert.equal(normalized[0].provenance[0].collectedAt, accessedAt);

  const report = createInternalReport();
  report.zoningLandUseStatus =
    `[Verified from official source] Hatay ili Defne ilçesi Dursunlu Mahallesi Ada 1517 Parsel 1 için resmî imar planı kaydı: ${normalized[0].snippet} [R1] ${normalized[0].url}`;
  report.environmentalGeotechnicalRisks =
    `[Verified from official source] Dursunlu Mahallesi için konuma özgü AFAD afet riski bulgusu: ${normalized[1].snippet} [R2] ${normalized[1].url}`;
  report.accessInfrastructure =
    `[Verified from external source] Dursunlu Mahallesi için yakın alan altyapı bulgusu: ${normalized[2].snippet} [R3] ${normalized[2].url}`;
  report.sources = normalized
    .map(
      (item, index) =>
        `[Verified from external source] Kaynak başlığı: ${item.title}; Kurum/site: ${item.source}; URL: ${item.url}; Erişim tarihi: 30.07.2026. [R${index + 1}]`
    )
    .join("\n");
  const presented = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
    assetNames: ["IMG_5412.PNG"],
  });

  assert.match(
    presented.zoningLandUseStatus,
    /https:\/\/defne\.bel\.tr\/plan\/dursunlu/
  );
  assert.match(presented.sources, /https:\/\/hatay\.afad\.gov\.tr\/irap/);
  assert.doesNotMatch(
    Object.values(presented).join("\n"),
    /Tüm kullanılabilir dış kaynak stratejileri sonuç vermedi/
  );
});

test("a missing source is represented by one natural sentence", () => {
  const report = createInternalReport();
  report.sources =
    "[Unknown] provider_unavailable query=imar result=failed Request was aborted";
  const presented = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
    assetNames: ["IMG_5412.PNG"],
  });

  assert.match(presented.sources, /Birincil kaynak/);
  assert.match(presented.sources, /Gerekli doğrulama kaynakları/);
  assert.doesNotMatch(presented.sources, /provider_unavailable|Request was aborted/);
});

test("every presentation path preserves every required report section", () => {
  const report = createInternalReport();
  report.recommendedDueDiligence =
    "provider_unavailable result=failed Request was aborted";
  report.legalRisks = "";
  report.scenarioAnalysis = "";
  report.investmentScore = "";

  const presented = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
    assetNames: ["IMG_5412.PNG"],
  });

  assert.deepEqual(
    realEstateFields.filter((field) => !presented[field]?.trim()),
    []
  );
  assert.match(presented.recommendedDueDiligence, /Kanıt yetersiz/);
  assert.match(presented.investmentScore, /Skorlanmadı/i);
});

test("PDF source mapping uses evidence outside the sources section before fallback", () => {
  const contents = collectRealEstateResearchSourceContent([
    {
      field: "zoningLandUseStatus",
      title: "İmar ve Arazi Kullanım Durumu",
      content:
        "[Verified from official source] Defne Belediyesi plan kaydı: https://www.defne.bel.tr/imar/dursunlu",
    },
    {
      field: "sources",
      title: "Kaynaklar",
      content:
        "[Unknown] Bu veri açık kaynaklardan doğrulanamadı; resmî belge kontrolü gerekiyor.",
    },
  ]);

  assert.equal(contents.length, 2);
  assert.match(contents[1], /https:\/\/www\.defne\.bel\.tr\/imar\/dursunlu/);
});

test("renderer removes repeated global failure copy and localizes decision evidence headings", () => {
  const report = createInternalReport();
  report.zoningLandUseStatus = [
    "Tüm kullanılabilir dış kaynak stratejileri sonuç vermedi.",
    "Tüm kullanılabilir dış kaynak stratejileri sonuç vermedi.",
  ].join("\n");
  report.finalRecommendation = [
    "[Recommendation] Executive Summary: Wait.",
    "AI Insight: Evidence remains limited.",
    "Supporting Evidence: Defne Municipality.",
    "Missing Evidence: Official parcel zoning.",
    "Decision Reasoning: Purchase should wait for verification.",
  ].join("\n");
  const presented = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
    assetNames: ["IMG_5412.PNG"],
  });
  const combined = Object.values(presented).join("\n");

  assert.doesNotMatch(
    combined,
    /Tüm kullanılabilir dış kaynak stratejileri sonuç vermedi/
  );
  assert.match(presented.finalRecommendation, /^Karar: BEKLE/);
  assert.match(presented.finalRecommendation, /En Büyük Risk/);
  assert.match(presented.finalRecommendation, /En Güçlü Doğrulanmış Fırsat/);
  assert.match(presented.finalRecommendation, /İlk 3 Sonraki Adım/);
  assert.doesNotMatch(presented.finalRecommendation, /Yapay Zekâ İçgörüsü|Destekleyici Kanıt|Eksik Kanıt|Karar Gerekçesi/);
});

test("grounded real-estate renderer includes real evidence metadata and evidence-based decision blocks", () => {
  const rendererSource = readFileSync(
    new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(
    rendererSource,
    /Tüm kullanılabilir dış kaynak stratejileri sonuç vermedi/
  );
  assert.match(rendererSource, /item\.sourceTitle/);
  assert.match(rendererSource, /item\.url/);
  assert.match(rendererSource, /item\.lastChecked/);
  assert.match(rendererSource, /item\.qualityScore \?\? item\.confidence/);
  assert.match(rendererSource, /item\.impactReason/);
  for (const heading of [
    "Yönetici Özeti",
    "Yapay Zekâ İçgörüsü",
    "Destekleyici Kanıt",
    "Eksik Kanıt",
    "Karar Gerekçesi",
  ]) {
    assert.match(rendererSource, new RegExp(heading));
  }
});

test("real-estate output always retains a decision summary", () => {
  const presented = prepareRealEstateReportForPresentation({
    report: createInternalReport(),
    language: "Turkish",
    assetNames: ["IMG_5412.PNG"],
  });

  assert.match(presented.finalRecommendation, /^Karar: BEKLE\b/);
  assert.match(presented.finalRecommendation, /En Büyük Risk/i);
  assert.match(presented.finalRecommendation, /En Güçlü Doğrulanmış Fırsat/i);
  assert.match(presented.finalRecommendation, /İlk 3 Sonraki Adım/i);
});

test("Phase 9 sanitizes technical gaps and consolidates human-readable missing evidence", () => {
  const report = createInternalReport();
  report.missingInformation = [
    "analysis",
    "undefined",
    "null",
    "unknown_field",
    "provider_id: openai_web_search",
    "Parsel bazlı imar durumu",
    "Güncel tapu ve takyidat kaydı",
    "Parsel bazlı imar durumu",
  ].join("\n");
  report.location =
    "Konum kaydı doğrulanmadan bu başlıkta kesin yatırım sonucu üretilemez.";
  report.legalRisks =
    "Tapu kaydı doğrulanmadan bu başlıkta kesin yatırım sonucu üretilemez.";
  report.liquidity =
    "Pazar verisi doğrulanmadan bu başlıkta kesin yatırım sonucu üretilemez.";

  const presented = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
    assetNames: ["IMG_5412.PNG"],
  });

  assert.doesNotMatch(
    Object.values(presented).join("\n"),
    /\b(?:analysis|undefined|null|unknown_field|provider_id|openai_web_search)\b/i
  );
  assert.equal(
    presented.missingInformation.match(/Parsel bazlı resmî imar durumu/g)?.length,
    1
  );
  assert.equal(
    presented.missingInformation.match(/Güncel tapu ve takyidat kaydı/g)?.length,
    1
  );
  assert.ok(
    (Object.values(presented)
      .join("\n")
      .match(/kesin yatırım sonucu üretilemez/gi)?.length || 0) <= 1
  );
});

test("Phase 9 maps usable research evidence into its section and cited source list", () => {
  const report = createInternalReport();
  report.zoningLandUseStatus = "";
  report.sources = "";
  const url = "https://www.defne.bel.tr/imar/dursunlu/1517-1";
  const presented = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
    assetNames: ["IMG_5412.PNG"],
    evidence: [
      {
        label: "Verified from official source",
        field: "zoning",
        claim:
          "Hatay ili Defne ilçesi Dursunlu Mahallesi Ada 1517 Parsel 1 resmî imar kaydı",
        value: "Ada 1517 Parsel 1 için yürürlükteki plan kaydı yayımlandı",
        sourceTitle: "Dursunlu Ada 1517 Parsel 1 İmar Kaydı",
        publisher: "Defne Belediyesi",
        url,
        retrievalStatus: "success",
        lastChecked: "2026-07-31T10:15:30.000Z",
      },
    ],
  });

  assert.match(presented.zoningLandUseStatus, /Dış kaynaktan doğrulandı/);
  assert.match(presented.zoningLandUseStatus, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(presented.sources, /Dursunlu Ada 1517 Parsel 1 İmar Kaydı/);
  assert.match(presented.sources, /Desteklediği bölüm: İmar ve Arazi Kullanımı/);
  assert.match(presented.sources, /Erişim tarihi: 31\.07\.2026/);
});

test("Phase 9 does not turn failures, property type, or unsupported prose into facts or opportunities", () => {
  const report = createInternalReport();
  report.ownershipTitleFindings = "Malik Ahmet Yılmaz'dır.";
  report.zoningLandUseStatus = "Ağaçlı Tarla niteliği yapılaşma hakkı sağlar.";
  report.developmentPotential =
    "Bölge gelişirse gelecekte olumlu bir fırsat olabilir.";
  const failedUrl = "https://www.defne.bel.tr/imar/dursunlu/1517-1";
  const presented = prepareRealEstateReportForPresentation({
    report,
    language: "Turkish",
    evidence: [
      {
        label: "Verified from official source",
        field: "zoning",
        claim:
          "Hatay ili Defne ilçesi Dursunlu Mahallesi Ada 1517 Parsel 1 imar araştırması",
        value: "Request was aborted",
        sourceTitle: "Defne Belediyesi",
        url: failedUrl,
        retrievalStatus: "failed",
      },
    ],
  });
  const combined = Object.values(presented).join("\n");

  assert.doesNotMatch(combined, /Malik Ahmet|Request was aborted|openai|provider/i);
  assert.match(presented.ownershipTitleFindings, /malik.*doğrulanmadı/i);
  assert.match(presented.zoningLandUseStatus, /taşınmaz niteliği yapılaşma hakkı olarak yorumlanmadı/i);
  assert.equal(
    presented.developmentPotential,
    "Mevcut kanıtlarla bağımsız bir yatırım fırsatı doğrulanmadı."
  );
  assert.match(
    presented.finalRecommendation,
    /En Güçlü Doğrulanmış Fırsat: Mevcut kanıtlarla bağımsız bir yatırım fırsatı doğrulanmadı/
  );
  assert.equal(
    presented.finalRecommendation.match(/^\d+\. /gm)?.length,
    3
  );
});

test("quality gate rejects an OCR-only report when usable external evidence exists", () => {
  const report = Object.fromEntries(
    realEstateFields.map((field) => [
      field,
      "[Verified from uploaded asset] Ada: 1517. [Asset: IMG_5412.PNG]",
    ])
  );
  const evidence = [
      {
        label: "Verified from official source",
        field: "zoning",
        claim: "Ada 1517 Parsel 1 için resmî imar planı yayımlandı",
        value: "Ada 1517 Parsel 1 plan kaydı",
        sourceTitle: "Defne Belediyesi Ada 1517 Parsel 1 İmar Planı",
        url: "https://www.defne.bel.tr/imar/1517-1",
      },
    ];

  assert.throws(
    () =>
      assertRealEstateUsesAvailableExternalEvidence({
        reportText: Object.values(report).join("\n"),
        evidence,
      }),
    /merely repeats uploaded facts/
  );
});

test("full real-estate reports require at least eighty percent research content", () => {
  const report = {
    extractedDocumentFacts:
      "[Verified from uploaded asset] İl: Hatay. [Asset: IMG_5412.PNG]",
    location:
      "[Verified from official source] Defne ilçesinin bölgesel planlama bağlamı resmî kaynaktan incelendi ve karar üzerindeki etkisi değerlendirildi. [R1]",
    zoningLandUseStatus:
      "[Verified from official source] İmar planı ve arazi kullanımı resmî belediye kaydı üzerinden ayrıntılı olarak incelendi. [R2]",
    accessInfrastructure:
      "[Verified from external source] Yol erişimi ve temel altyapı göstergeleri güvenilir harita ve kurum kayıtlarıyla değerlendirildi. [R3]",
    environmentalGeotechnicalRisks:
      "[Verified from official source] Afet ve jeolojik risk bağlamı resmî kurum verileri kullanılarak değerlendirildi. [R4]",
    finalRecommendation:
      "[Recommendation] Koşullu ilerleme kararı, resmî ve harici araştırma bulgularına dayanır. [Basis: R1, R2, R3, R4]",
    sources: "https://example.gov.tr/record",
  };
  const composition = calculateRealEstateResearchComposition(report);

  assert.ok(composition.researchShare >= 0.8);
  assert.equal(
    assertRealEstateResearchComposition({ report }).researchShare,
    composition.researchShare
  );
});

test("OCR-heavy content cannot satisfy the eighty-percent research gate", () => {
  const report = {
    extractedDocumentFacts:
      "[Verified from uploaded asset] İl: Hatay; İlçe: Defne; Mahalle: Dursunlu; Mevkii: Tamurcu; Ada: 1517; Parsel: 1; Yüzölçümü: 6.364,62 m²; Nitelik: Ağaçlı Tarla. [Asset: IMG_5412.PNG]",
    location:
      "[Verified from official source] Konum bağlamı incelendi. [R1]",
    sources: "https://example.gov.tr/record",
  };

  assert.throws(
    () => assertRealEstateResearchComposition({ report }),
    /below the required 80%/
  );
});
