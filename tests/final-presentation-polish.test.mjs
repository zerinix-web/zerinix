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
  // Each explanation states why the metric is missing, what evidence
  // is absent, and what the founder should collect next -- not a bare
  // one-line placeholder repeated identically across metrics.
  assert.match(output, /ARR: gerçekleşmiş gelir verisi bulunmadığı için hesaplanamıyor; kurucunun fatura\/ödeme kayıtlarından gerçekleşmiş gelir verisini paylaşması gerekir/);
  assert.match(output, /CAC: gerçek müşteri edinimi ve elde tutma verisi bulunmadığı için hesaplanamıyor; kurucunun kanal başına edinim maliyeti ve kohort elde tutma kayıtlarını toplaması gerekir/);
  assert.match(output, /TAM: doğrulanmış pazar büyüklüğü verisi bulunmadığı için hesaplanamıyor; sektör raporu veya resmi istatistik gibi doğrulanmış kaynaklar gerekir/);
  assert.match(output, /Brüt marj: gerçekleşmiş gelir ve maliyet verisi bulunmadığı için hesaplanamıyor; kurucunun birim maliyet ve satış fiyatı verisini paylaşması gerekir/);
});

test("unrelated lines that only coincidentally share the same trailing value are never merged", () => {
  // Reproduces a real bug: businessModel and benchmark.label can fall
  // back to the exact same generic string when nothing in the prompt
  // matches a specific industry, so "Industry benchmark: X" and
  // "Business model: X" ended up with an identical line ending -- the
  // consolidation pass must never merge these, since they are two
  // completely different, legitimate assumption entries that were
  // never generated as an unavailable-data explanation.
  const output = labelModelDerivedFinancialClaims({
    content: [
      "• Industry benchmark: Genel Hizmetler",
      "• İş modeli: Genel Hizmetler",
      "• Hedef müşteri: öngörülen ilk kullanıcılar",
    ].join("\n"),
    metricValues: [],
    language: "Turkish",
    sourceContext: "Yeni bir iş fikrini değerlendiriyorum.",
  });

  assert.match(output, /• Industry benchmark: Genel Hizmetler/);
  assert.match(output, /• İş modeli: Genel Hizmetler/);
  assert.doesNotMatch(output, /Industry benchmark, /);
  assert.doesNotMatch(output, /,\s*İş modeli:/);
});

test("identical missing-data explanations within one section are consolidated instead of repeated", () => {
  const output = labelModelDerivedFinancialClaims({
    content: [
      "CAC: 5.000 dolar",
      "LTV: 12.000 dolar",
      "Geri ödeme süresi: 4 ay",
    ].join("\n"),
    metricValues: ["CAC", "LTV", "Geri ödeme süresi"],
    language: "Turkish",
    sourceContext: "Yeni bir iş fikrini değerlendiriyorum.",
  });

  const occurrences = output.match(/kurucunun kanal başına edinim maliyeti/g) || [];
  assert.equal(occurrences.length, 1, "the shared explanation must appear once, not once per metric");
  assert.match(output, /^CAC, LTV, Geri ödeme süresi: /m);
});
