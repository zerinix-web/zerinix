import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { jsPDF } from "jspdf";

import {
  resolveReportLanguage,
  validateReportLanguageConsistency,
} from "../app/lib/report-language.ts";
import { buildLegalReportSections } from "../app/lib/report-engine/legal-report-rendering.ts";

const englishRequest = "I worked for a software company in California for four years. I was terminated without prior warning after reporting repeated unpaid overtime. What legal claims and filing deadlines apply?";
const turkishRequest = "Kaliforniya'da bir yazılım şirketinde dört yıl çalıştım. Fazla mesai ücretlerini bildirdikten sonra önceden uyarılmadan işten çıkarıldım. Hangi hukuki haklarım ve başvuru sürelerim var?";

const englishSections = [
  { field: "subjectIdentification", title: "Subject Identification", content: "California employment dispute concerning termination and unpaid overtime." },
  { field: "decisionAssessment", title: "Decision Assessment", content: "The facts support prompt review of wage and retaliation claims." },
  { field: "domainFindings", title: "Domain Findings", content: "The reported timing may support a retaliation theory if records corroborate the complaint." },
  { field: "riskAnalysis", title: "Risk Analysis", content: "Filing deadlines and the severance waiver require immediate legal review." },
  { field: "recommendedActions", title: "Recommended Actions", content: "1. Preserve records.\n2. Confirm deadlines.\n3. Review the agreement." },
  { field: "finalRecommendation", title: "Final Recommendation", content: "Proceed promptly with a California employment-law review." },
];

const turkishSections = [
  { field: "subjectIdentification", title: "Konu Tanımlama", content: "Kaliforniya'daki fesih ve ödenmeyen fazla mesai uyuşmazlığı." },
  { field: "decisionAssessment", title: "Karar Değerlendirmesi", content: "Bildirilen olgular ücret ve misilleme taleplerinin hızla incelenmesini destekliyor." },
  { field: "domainFindings", title: "Alan Bulguları", content: "Kayıtlar şikâyeti doğrularsa bildirilen zamanlama misilleme iddiasını destekleyebilir." },
  { field: "riskAnalysis", title: "Risk Analizi", content: "Başvuru süreleri ve feragat metni derhal hukuki inceleme gerektiriyor." },
  { field: "recommendedActions", title: "Önerilen Aksiyonlar", content: "1. Kayıtları koruyun.\n2. Süreleri doğrulayın.\n3. Sözleşmeyi inceletin." },
  { field: "finalRecommendation", title: "Nihai Tavsiye", content: "Kaliforniya iş hukuku incelemesini gecikmeden başlatın." },
];

function renderFixturePdf(request, sections, uiLanguage, browserLanguage) {
  const locale = resolveReportLanguage({ requestText: request, uiLanguage, browserLanguage });
  const rendered = buildLegalReportSections(sections, locale, request);
  const visibleText = rendered.map((section) => `${section.title}\n${section.content}`).join("\n\n");
  validateReportLanguageConsistency(visibleText, locale);
  const pdf = new jsPDF();
  pdf.text(pdf.splitTextToSize(visibleText, 175), 15, 15);
  const output = pdf.output("arraybuffer");
  return { locale, visibleText, byteLength: output.byteLength };
}

test("English California legal request overrides Turkish UI/browser and exports an English PDF", () => {
  const result = renderFixturePdf(englishRequest, englishSections, "tr", "tr-TR");
  assert.equal(result.locale, "en");
  assert.match(result.visibleText, /Executive Legal Assessment/);
  assert.doesNotMatch(result.visibleText, /Yönetici Hukuki Değerlendirmesi|İş Fikri Doğrulama/);
  assert.ok(result.byteLength > 1_000);
});

test("Turkish legal request remains Turkish and exports a Turkish PDF", () => {
  const result = renderFixturePdf(turkishRequest, turkishSections, "en", "en-US");
  assert.equal(result.locale, "tr");
  assert.match(result.visibleText, /Yönetici Hukuki Değerlendirmesi/);
  assert.doesNotMatch(result.visibleText, /Executive Legal Assessment|Business Idea Validation/);
  assert.ok(result.byteLength > 1_000);
});

test("legal report rendering excludes business controls and methodology", () => {
  const planner = readFileSync("components/Planner.tsx", "utf8");
  assert.match(planner, /!isLegalReport \? reportActions\.map/);
  assert.match(planner, /<SourcesCard sections=\{sourceSections\} legal=\{isLegalReport\}/);
  assert.match(planner, /!isDomainDecisionReport \? \(\s*<BenchmarkIntelligencePanel/);
  const result = renderFixturePdf(englishRequest, englishSections, "tr", "tr-TR");
  assert.doesNotMatch(result.visibleText, /Competitor Analysis|Financial Plan|Brand Strategy|Market sizing|Financial projections|KPI estimates|Business Idea Validation/i);
});

test("mixed-language legal content cannot be exported", () => {
  const mixedSections = englishSections.map((section) => section.field === "finalRecommendation"
    ? { ...section, content: `${section.content}\nBu bölüm yatırım ve hukuki karar için Türkçe açıklamalar içeriyor ve sonraki adımları öneriyor.` }
    : section);
  assert.throws(
    () => renderFixturePdf(englishRequest, mixedSections, "tr", "tr-TR"),
    /language validation failed/i
  );
});
