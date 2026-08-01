import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeAiResponseText } from "../app/lib/ai/response-sanitization.ts";
import {
  localizePdfPresentationText,
} from "../app/lib/pdf-normalization.mjs";
import { dedupeReportParagraphsAcrossSections } from "../app/lib/report-content-quality.mjs";
import { labelModelDerivedFinancialClaims } from "../app/lib/report-engine/financial-claim-labeling.ts";

test("Turkish chat output removes remaining English presentation labels", () => {
  const output = sanitizeAiResponseText([
    "Recommendation: Bekle",
    "Why: İmar durumu doğrulanmadı.",
    "Key Risks: Tapu ve erişim belirsiz.",
    "Immediate Actions: Resmî belgeleri inceleyin.",
    "Next Actions: Emsal araştırmasını tamamlayın.",
    "Validation Required",
    "AI Analysis",
    "Estimated",
  ].join("\n"));

  assert.doesNotMatch(
    output,
    /Recommendation|\bWhy\b|Immediate Actions|Next Actions|Validation Required|AI Analysis|Estimated/i
  );
  assert.match(output, /TAVS[İi]YE: Bekle/i);
  assert.match(output, /Gerekçe: İmar durumu doğrulanmadı/);
  assert.match(output, /Acil Adımlar/);
});

test("Turkish PDF output naturalizes unavailable values and removes fake bare market metrics", () => {
  const output = localizePdfPresentationText([
    "Recommendation: Bekle",
    "Why: Yeterli doğrulanmış veri yok.",
    "TAM=3",
    "Değerleme sağlanmadı; mevcut kanıtlardan hesaplanamaz.",
  ].join("\n"), "tr");

  assert.doesNotMatch(output, /Recommendation|\bWhy\b|TAM\s*[=:]\s*3/i);
  assert.match(output, /TAVS[İi]YE: Bekle/i);
  assert.match(output, /TAM: Hesaplanamadı/);
  assert.match(output, /Veri bulunamadı/);
});

test("duplicate recommendations become one concise cross-reference", () => {
  const recommendation =
    "Yönetici Tavsiyesi: Resmî imar, temiz tapu ve yasal erişim doğrulanana kadar sermaye taahhüdünde bulunmayın; doğrulama olumluysa yatırımı yeniden değerlendirin.";
  const report = dedupeReportParagraphsAcrossSections({
    executiveSummary: recommendation,
    executiveRecommendation: recommendation.replace("Yönetici Tavsiyesi", "Tavsiye"),
  });

  assert.equal(report.executiveSummary, recommendation);
  assert.equal(
    report.executiveRecommendation,
    "Birleştirilmiş değerlendirme Yönetici Özeti bölümünde sunulmuştur."
  );
});

test("Turkish report output replaces raw missing values with contextual explanations", () => {
  const output = sanitizeAiResponseText([
    "Değerleme: null",
    "Yatırım hedefi: Not provided",
    "İmar belgesi: undefined",
    "Konum: N/A",
    "Executive Summary: Karar için mevcut bilgiler değerlendirildi.",
  ].join("\n"));

  assert.doesNotMatch(output, /\b(?:null|undefined|N\/?A|Not provided|Executive Summary)\b/i);
  assert.match(output, /Değerleme: Yeterli veri olmadığı için hesaplanamadı/);
  assert.match(output, /Yatırım hedefi: Kullanıcı tarafından belirtilmemiş/);
  assert.match(output, /İmar belgesi: Doğrulanmış kayıt mevcut değil/);
  assert.match(output, /Yönetici Özeti/);
});

test("missing financial metrics use metric-specific Turkish explanations", () => {
  const output = labelModelDerivedFinancialClaims({
    content: [
      "ARR: 2 milyon dolar",
      "CAC: 5.000 dolar",
      "TAM: 3 milyar dolar",
      "Brüt marj: %58",
    ].join("\n"),
    metricValues: ["ARR", "CAC", "TAM", "Brüt marj"],
    language: "Turkish",
    sourceContext: "Yeni bir iş fikrini değerlendiriyorum.",
  });

  assert.doesNotMatch(output, /sağlanmadı; mevcut kanıtlardan hesaplanamaz/i);
  assert.match(output, /ARR: Gerçekleşmiş gelir verisi bulunmadığı için hesaplanamadı/);
  assert.match(output, /CAC: Gerçek müşteri edinimi ve gelir verisi gerekli/);
  assert.match(output, /TAM: Doğrulanmış pazar verisi olmadan hesaplanamaz/);
  assert.match(output, /Brüt marj: Gelir ve maliyet verisi olmadan hesaplanamaz/);
});
