import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  buildStrictReportLanguageInstruction,
  detectReportLanguage,
  getResponseLanguage,
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

test("mixed-language report labels are rejected", () => {
  assert.throws(
    () => validateReportLanguageConsistency("Yönetici Özeti\nConfidence Score", "tr"),
    /language validation failed/i
  );
  assert.throws(
    () => validateReportLanguageConsistency("Zusammenfassung\nMain Risk", "de"),
    /language validation failed/i
  );
  assert.throws(
    () => validateReportLanguageConsistency(
      "Yönetici Özeti\nThe report explains the market risk and the decision for the company with clear recommendations and next actions.",
      "tr"
    ),
    /en prose/i
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
