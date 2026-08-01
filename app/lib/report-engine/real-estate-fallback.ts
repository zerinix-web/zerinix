import {
  realEstateFieldLabels,
  realEstateFields,
  type RealEstateReportField,
} from "@/app/lib/report-engine/prompts/real-estate";
import type { ResponseLanguage } from "@/app/lib/report-engine/schema";

export function createEmergencyRealEstateReport({
  language,
  assetNames,
}: {
  language: ResponseLanguage;
  assetNames: string[];
}): Record<RealEstateReportField, string> {
  const isTurkish = language === "Turkish";
  const uploadedAssets = assetNames.length
    ? assetNames.join(", ")
    : isTurkish
      ? "yüklenen varlık yok"
      : "no uploaded asset";
  const report = Object.fromEntries(
    realEstateFields.map((field) => [
      field,
      `[Unknown] ${realEstateFieldLabels[language][field]}: ${
        isTurkish
          ? "birincil rapor oluşturucu doğrulanabilir bir çıktı üretemedi"
          : "the primary report builder did not produce a validatable output"
      }. [Required: ${
        isTurkish ? "yetkili kayıt ve uzman incelemesi" : "authoritative records and professional review"
      }]`,
    ])
  ) as Record<RealEstateReportField, string>;

  report.assetIdentification = isTurkish
    ? `[Verified from uploaded asset] İşlenen dosyalar: ${uploadedAssets}. [Asset: ${uploadedAssets}]`
    : `[Verified from uploaded asset] Processed files: ${uploadedAssets}. [Asset: ${uploadedAssets}]`;
  report.valuationRange = isTurkish
    ? "[Unknown] Değerleme Henüz Savunulabilir Değil. Eksik doğrulama kapıları: konum, parsel alanı, imar/kullanım, emsaller, para birimi ve hesaplama yöntemi. Kanıt edinme planı: resmi tapu ve imar kayıtlarını, tarihli emsalleri, para birimini ve lisanslı değerleme yöntemini doğrula. [Required: resmi kayıtlar ve lisanslı değerleme]"
    : "[Unknown] Valuation Not Yet Defensible. Missing gates: Location, Parcel size, Zoning/use, Comparables, Currency, Calculation method. Evidence acquisition plan: obtain official title and planning records, dated comparables, currency, and a licensed valuation method. [Required: official records and licensed valuation]";
  report.recommendedDueDiligence = isTurkish
    ? "[Recommendation] Resmi tapu/takyidat kaydını, belediye imar belgesini, kadastro erişimini, altyapı ve tehlike kayıtlarını ve tarihli emsalleri edin; ardından lisanslı uzman incelemesi yaptır. [Basis: doğrulanamayan kritik karar kanıtları]"
    : "[Recommendation] Obtain official title and encumbrance records, municipal planning evidence, cadastral access, infrastructure and hazard records, and dated comparables; then commission licensed professional review. [Basis: unverified critical decision evidence]";
  report.finalRecommendation = isTurkish
    ? `[Recommendation] Kanıt Yetersiz. Bu bir Ön durum tespiti raporu; tam değerleme değildir. Bilinenler: ${uploadedAssets} işlendi. Araştırılanlar: mevcut araştırma sağlayıcıları ve yüklenen varlık bağlamı. Bilinmeyenler: resmi tapu, imar, erişim, altyapı, tehlike ve emsal doğrulamaları. Başlıca riskler: hukuki durum, geliştirme hakkı ve fiyat kanıtının doğrulanmamış olması. Başlıca fırsatlar: resmi kanıtlar olumluysa yeniden değerlendirilebilir. Kesin sonraki adımlar: resmi kayıtları edin, parsel bazlı inceleme yaptır, tarihli emsalleri doğrula. Kararı değiştirecek kanıt: temiz tapu/takyidat, uygun resmi imar, yasal erişim, kabul edilebilir teknik bulgular ve desteklenebilir fiyat. [Basis: rapor oluşturma doğrulama hatası]`
    : `[Recommendation] Insufficient Evidence. Preliminary due-diligence report, not a valuation. Known: ${uploadedAssets} was processed. Researched: configured research providers and uploaded-asset context. Unknown: official title, zoning, access, infrastructure, hazards, and comparable evidence. Top risks: unverified legal status, development rights, and pricing evidence. Top opportunities: reassessment if official evidence is favorable. Next actions: obtain official records, commission parcel-level review, and verify dated comparables. Evidence that would change the decision: clean title, compatible official zoning, legal access, acceptable technical findings, and supportable pricing. [Basis: report validation failure]`;
  report.sources = isTurkish
    ? `[Verified from uploaded asset] ${uploadedAssets}; dosya kaynağı. [Asset: ${uploadedAssets}]`
    : `[Verified from uploaded asset] ${uploadedAssets}; uploaded file source. [Asset: ${uploadedAssets}]`;

  return report;
}
