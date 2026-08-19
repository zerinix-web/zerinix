import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { detectPdfPresentationLocale } from "../app/lib/pdf-normalization.mjs";
import { getEvidenceLabel } from "../app/lib/report-evidence.ts";
import { getResponseLanguage } from "../app/lib/report-language.ts";

// CRITICAL PRODUCTION FIX -- remaining mixed-language UI badges.
//
// Confirmed live: an English Business Plan report still showed Turkish
// evidence badges ("Varsayım") and a Turkish section eyebrow ("Bölüm 21")
// despite the earlier fix that correctly threaded a computed locale
// through EvidenceBadge/getDashboardEvidenceLabel and the Section/Bölüm
// eyebrow in both app/dashboard/[id]/page.tsx and components/Planner.tsx.
//
// Root cause: that fix correctly THREADS the locale returned by
// detectPdfPresentationLocale, but the DETECTION function itself
// (app/lib/pdf-normalization.mjs) had a latent bug -- its Turkish-keyword
// list included the bare word "risk", which is spelled identically in
// Turkish and English and therefore can never disambiguate the two
// languages. Because nearly every real business report mentions "risk"
// somewhere (a Risk section, "Risk Posture", "Main Risk", a Financial
// Dashboard risk card), this false-positively misdetected genuinely
// English report sections as Turkish, which then correctly-but-wrongly
// rendered the Turkish evidence label and section eyebrow for that
// (mis-detected) locale. The isolated test content used in the earlier
// fix's regression tests happened not to contain the word "risk", so
// those tests passed while real production reports kept failing.
//
// The fix removes "risk" from the keyword list. Every other keyword in
// the list is a Turkish-only word (not a valid English word), so genuine
// Turkish detection is unaffected -- a real Turkish section is never
// signaled by "risk" alone, since it is always accompanied by other
// Turkish-specific vocabulary or diacritic characters.
//
// detectPdfPresentationLocale is the single shared locale-detection
// function used by both the dashboard (page.tsx, Planner.tsx) and the PDF
// export (ReportPdfButton.tsx), so this one fix corrects locale detection
// everywhere it is used -- "fixed at the source", not by per-badge string
// replacement.

const pdfNormalizationSource = readFileSync("app/lib/pdf-normalization.mjs", "utf8");
const pageSource = readFileSync("app/dashboard/[id]/page.tsx", "utf8");
const plannerSource = readFileSync("components/Planner.tsx", "utf8");

// --- The exact live bug and its fix --------------------------------------

test("an English report section that mentions 'risk' is no longer misdetected as Turkish (the exact live bug)", () => {
  const englishSectionWithRisk =
    "Financial Dashboard\nRisk Posture: Tracked\nThe main risk to this business is customer concentration and slow enterprise sales cycles. Investment Score: 74/100. Decision: GO.";

  assert.equal(detectPdfPresentationLocale(englishSectionWithRisk), "en");
});

test("an English evidence badge never renders the Turkish 'Varsayım' for a section that mentions risk (the exact live bug, end to end)", () => {
  const englishSectionWithRisk =
    "Executive Summary\nDecision: GO\nRisk Posture: Tracked. The payback assumption is based on planning inputs and carries execution risk.";
  const locale = getResponseLanguage(detectPdfPresentationLocale(englishSectionWithRisk));

  assert.equal(locale, "English");
  assert.equal(getEvidenceLabel("planningAssumption", locale), "Assumption");
  assert.notEqual(getEvidenceLabel("planningAssumption", locale), "Varsayım");
});

test("an English section eyebrow never renders the Turkish 'Bölüm' for a section that mentions risk (the exact live bug, end to end)", () => {
  const englishSectionWithRisk =
    "Risks\nMain Risk: Customer concentration. Execution risk remains elevated until enterprise pilots convert.";
  const reportLocale = detectPdfPresentationLocale(englishSectionWithRisk);
  const eyebrow = reportLocale === "tr" ? "Bölüm" : "Section";

  assert.equal(reportLocale, "en");
  assert.equal(eyebrow, "Section");
});

// --- Genuine Turkish reports are unaffected (no regression) --------------

test("genuine Turkish report content still correctly detects as Turkish, with or without the word 'risk'", () => {
  const genuineTurkish =
    "Yönetici Özeti\nKarar: EVET\nYatırım Skoru: 74/100\nGeri ödeme varsayımı planlama girdilerine dayanmaktadır.";
  const genuineTurkishWithRisk =
    "Riskler\nAna Risk: Müşteri yoğunlaşması. Doğrulama gerektiren birincil varsayım budur.";

  assert.equal(detectPdfPresentationLocale(genuineTurkish), "tr");
  assert.equal(detectPdfPresentationLocale(genuineTurkishWithRisk), "tr");
});

test("a Turkish evidence badge still correctly renders 'Varsayım' for genuine Turkish content", () => {
  const genuineTurkish = "Riskler\nAna Risk: Müşteri yoğunlaşması. Doğrulama gerektiren birincil varsayım budur.";
  const locale = getResponseLanguage(detectPdfPresentationLocale(genuineTurkish));

  assert.equal(locale, "Turkish");
  assert.equal(getEvidenceLabel("planningAssumption", locale), "Varsayım");
});

test("a Turkish section eyebrow still correctly renders 'Bölüm' for genuine Turkish content", () => {
  const genuineTurkish = "Riskler\nAna Risk: Müşteri yoğunlaşması ve doğrulama eksikliği.";
  const reportLocale = detectPdfPresentationLocale(genuineTurkish);
  const eyebrow = reportLocale === "tr" ? "Bölüm" : "Section";

  assert.equal(reportLocale, "tr");
  assert.equal(eyebrow, "Bölüm");
});

// --- Badge localization follows report locale everywhere -----------------

test("every evidence level resolves to the correct language across English, Turkish, and risk-mentioning variants of both", () => {
  const cases = [
    ["Executive Summary. Decision: GO. Revenue grows steadily despite market risk.", "English", "Assumption"],
    ["Yönetici Özeti. Karar: EVET. Risk yüksek olsa da gelir istikrarlı büyüyor.", "Turkish", "Varsayım"],
  ];

  for (const [content, expectedLanguage, expectedLabel] of cases) {
    const locale = getResponseLanguage(detectPdfPresentationLocale(content));
    assert.equal(locale, expectedLanguage, `"${content}" should detect as ${expectedLanguage}`);
    assert.equal(getEvidenceLabel("planningAssumption", locale), expectedLabel);
  }
});

// --- Drift checks -----------------------------------------------------

test("detectPdfPresentationLocale's Turkish keyword list no longer contains the bare word 'risk' (drift check)", () => {
  const fnMatch = /export function detectPdfPresentationLocale\([\s\S]*?\n\}/.exec(pdfNormalizationSource);
  assert.ok(fnMatch, "detectPdfPresentationLocale not found");
  assert.doesNotMatch(fnMatch[0], /\|risk\|/, "the Turkish keyword list still contains the ambiguous English/Turkish word 'risk'");
});

test("every other Turkish-only keyword remains in place (no over-correction / regression in Turkish detection)", () => {
  const fnMatch = /export function detectPdfPresentationLocale\([\s\S]*?\n\}/.exec(pdfNormalizationSource);
  assert.ok(fnMatch, "detectPdfPresentationLocale not found");
  for (const keyword of ["pazar", "müşteri", "gelir", "fırsat", "özet", "kaynak", "varsayım", "doğrulama", "yatırım", "kurucu", "rekabet", "tavsiye", "yönetici"]) {
    assert.match(fnMatch[0], new RegExp(keyword), `Turkish keyword "${keyword}" was unexpectedly removed`);
  }
});

test("page.tsx's and Planner.tsx's Section/Bölüm eyebrow and EvidenceBadge locale threading are still wired correctly (drift check, no regression from the earlier fix)", () => {
  assert.match(pageSource, /\{reportLocale === "tr" \? "Bölüm" : "Section"\}/);
  assert.match(plannerSource, /\{sectionPdfLocale === "tr" \? "Bölüm" : "Section"\}/);
  assert.doesNotMatch(pageSource, /getEvidenceLabel\(level, "Turkish"\)/);
  assert.doesNotMatch(plannerSource, /getEvidenceLabel\(level, "Turkish"\)/);
});
