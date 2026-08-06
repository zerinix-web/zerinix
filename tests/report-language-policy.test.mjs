import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  buildStrictReportLanguageInstruction,
  detectReportLanguage,
  getResponseLanguage,
  repairReportLanguageSections,
  reportCopy,
  resolveReportLanguage,
  validateReportLanguageConsistency,
} from "../app/lib/report-language.ts";
import {
  localizePdfPresentationLabel,
  resolvePdfPresentationLocale,
} from "../app/lib/pdf-normalization.mjs";

const domainLabelsSource = readFileSync(new URL("../app/lib/report-engine/prompts/domain-analysis.ts", import.meta.url), "utf8");
const realEstateLabelsSource = readFileSync(new URL("../app/lib/report-engine/prompts/real-estate.ts", import.meta.url), "utf8");
const legalRendererSource = readFileSync(new URL("../app/lib/report-engine/legal-report-rendering.ts", import.meta.url), "utf8");

const cases = [
  { code: "tr", name: "Turkish", request: "Bu yatırımın ana risklerini ve sonraki adımları analiz et.", summary: "Yönetici Özeti", decision: "Karar", legal: "Hukuki Değerlendirme" },
  { code: "en", name: "English", request: "Analyze the main risks and next actions for this investment.", summary: "Executive Summary", decision: "Decision", legal: "Legal Assessment" },
  { code: "de", name: "German", request: "Analysiere die wichtigsten Risiken und nächsten Schritte für diese Investition.", summary: "Zusammenfassung", decision: "Entscheidung", legal: "Rechtliche Bewertung" },
  { code: "fr", name: "French", request: "Analysez les principaux risques et les prochaines actions pour cet investissement.", summary: "Synthèse exécutive", decision: "Décision", legal: "Évaluation juridique" },
  { code: "es", name: "Spanish", request: "Analiza los principales riesgos y las siguientes acciones para esta inversión.", summary: "Resumen ejecutivo", decision: "Decisión", legal: "Evaluación jurídica" },
];

test("report language resolution follows explicit, UI, browser, then request priority", () => {
  assert.equal(resolveReportLanguage({ explicitLanguage: "fr", uiLanguage: "tr", browserLanguage: "de", requestText: cases[4].request }), "fr");
  assert.equal(resolveReportLanguage({ uiLanguage: "tr", browserLanguage: "de", requestText: cases[4].request }), "es");
  assert.equal(resolveReportLanguage({ browserLanguage: "de-DE", requestText: cases[4].request }), "es");
  assert.equal(resolveReportLanguage({ requestText: cases[4].request }), "es");
});

for (const item of cases) {
  test(`${item.name} request produces one ${item.name} report language`, () => {
    assert.equal(detectReportLanguage(item.request), item.code);
    assert.equal(getResponseLanguage(item.code), item.name);
    assert.equal(reportCopy(item.code, "executiveSummary"), item.summary);
    assert.equal(reportCopy(item.code, "decision"), item.decision);
    assert.match(buildStrictReportLanguageInstruction(item.code), new RegExp(`only in ${item.name}`));
    assert.doesNotThrow(() => validateReportLanguageConsistency(`${item.summary}\n${item.decision}`, item.code));
  });
}

test("mixed-language validation is non-fatal and repairs only the offending section", () => {
  assert.equal(
    validateReportLanguageConsistency("Yönetici Özeti\nConfidence Score", "tr"),
    false
  );
  const repaired = repairReportLanguageSections(
    [
      {
        field: "summary",
        title: "Executive Summary",
        content:
          "Yatırım kararı için mevcut kanıtlar dikkatle değerlendirilmiştir. The report explains the market risk and the decision with clear recommendations and next actions.",
      },
      {
        field: "risk",
        title: "Riskler",
        content: "İmar belirsizliği yatırım kararını sınırlandırmaktadır.",
      },
    ],
    "tr"
  );

  assert.equal(repaired.sections[0].title, "Yönetici Özeti");
  assert.match(repaired.sections[0].content, /mevcut kanıtlar dikkatle değerlendirilmiştir/i);
  assert.doesNotMatch(repaired.sections[0].content, /The report explains/);
  // The removal notice must never be written into rendered section
  // content -- only into `warnings`, the channel Planner surfaces as
  // its own dedicated "Warnings / Missing Evidence" section. Content
  // should also never expose the mechanism ("translated") -- see the
  // warnings assertion below for the correct, customer-appropriate text.
  assert.doesNotMatch(repaired.sections[0].content, /çevrilemediği|translated|dil gereksinimini/i);
  assert.equal(
    repaired.sections[1].content,
    "İmar belirsizliği yatırım kararını sınırlandırmaktadır."
  );
  assert.equal(repaired.warnings.length, 1);
  assert.match(repaired.warnings[0], /dil gereksinimini karşılamadığı/i);
  assert.doesNotMatch(repaired.warnings[0], /çevrilemediği|translated/i);
  assert.equal(
    validateReportLanguageConsistency(
      repaired.sections.map((section) => `${section.title}\n${section.content}`).join("\n"),
      "tr"
    ),
    true
  );
});

test("report section labels are localized in all supported languages", () => {
  for (const item of cases) {
    assert.match(domainLabelsSource, new RegExp(`${item.name}: \\{`));
    assert.match(realEstateLabelsSource, new RegExp(`${item.name}: \\{`));
  }
});

test("PDF rendering honors persisted language instead of independently detecting it", () => {
  assert.equal(resolvePdfPresentationLocale("de", "Executive Summary"), "de");
  assert.equal(resolvePdfPresentationLocale("French", "Yönetici Özeti"), "fr");
  assert.equal(localizePdfPresentationLabel("Executive Summary", "de"), "Zusammenfassung");
  assert.equal(localizePdfPresentationLabel("Confidence Score", "fr"), "Indice de confiance");
  assert.equal(localizePdfPresentationLabel("Legal Assessment", "es"), "Evaluación jurídica");
});

test("legal renderer consumes one language code for all visible section labels", () => {
  for (const title of ["Yönetici Hukuki Değerlendirmesi", "Executive Legal Assessment", "Rechtliche Gesamtbewertung", "Évaluation juridique exécutive", "Evaluación jurídica ejecutiva"]) {
    assert.ok(legalRendererSource.includes(title));
  }
  assert.match(legalRendererSource, /const labels = legalRenderCopy\[locale\]/);
});
