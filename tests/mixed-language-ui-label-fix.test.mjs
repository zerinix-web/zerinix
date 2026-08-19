import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getEvidenceLabel } from "../app/lib/report-evidence.ts";
import { getResponseLanguage } from "../app/lib/report-language.ts";
import { detectPdfPresentationLocale } from "../app/lib/pdf-normalization.mjs";

// PRODUCTION UI POLISH FIX -- mixed-language UI labels.
//
// Confirmed live: an English Business Plan report showed Turkish UI chrome
// mixed into otherwise-English output --
//   - "Varsayım" (Turkish for "Assumption") on evidence badges
//   - "Section 23" was fine in English, but the same eyebrow label was
//     never translated for a Turkish report either -- both directions of
//     the same underlying bug: the label was not derived from the report's
//     own detected language.
//
// Root cause #1: `getDashboardEvidenceLabel` (duplicated independently in
// app/dashboard/[id]/page.tsx and components/Planner.tsx) called
// `getEvidenceLabel(level, "Turkish")` unconditionally, regardless of the
// report's actual language, so every EvidenceBadge in the entire dashboard
// -- KPIs, financial metrics, section badges, citation confidence --
// rendered Turkish text even for English (or German/French/Spanish)
// reports.
//
// Root cause #2: the section "eyebrow" label
// (`Section ${String(index + 1).padStart(2, "0")}`) was hardcoded English
// in both files, never localized for a Turkish report, unlike its sibling
// "Kaynaklar"/"Sources" label a few lines away in the same component.
//
// The fix threads the report's own detected locale (via
// detectPdfPresentationLocale + getResponseLanguage) into every
// EvidenceBadge call site in both files, and makes the "Section" eyebrow
// locale-aware the same way its "Sources" sibling already was.

const pageSource = readFileSync("app/dashboard/[id]/page.tsx", "utf8");
const plannerSource = readFileSync("components/Planner.tsx", "utf8");

// --- The exact live bug: evidence label must follow the report's own language, never hardcoded ---

test("an English-detected report never renders the Turkish 'Varsayım' evidence label (the exact live bug)", () => {
  const englishContent =
    "Executive Summary\nAI Investment Score: 74/100\nDecision: GO\nThe payback assumption is based on planning inputs.";
  const locale = getResponseLanguage(detectPdfPresentationLocale(englishContent));

  assert.equal(locale, "English");
  assert.equal(getEvidenceLabel("planningAssumption", locale), "Assumption");
  assert.notEqual(getEvidenceLabel("planningAssumption", locale), "Varsayım");
});

test("a Turkish-detected report correctly renders 'Varsayım', not the English 'Assumption'", () => {
  const turkishContent =
    "Yönetici Özeti\nYatırım Skoru: 74/100\nKarar: EVET\nGeri ödeme varsayımı planlama girdilerine dayanmaktadır.";
  const locale = getResponseLanguage(detectPdfPresentationLocale(turkishContent));

  assert.equal(locale, "Turkish");
  assert.equal(getEvidenceLabel("planningAssumption", locale), "Varsayım");
});

test("every evidence level resolves to an English label for an English report, across all four levels", () => {
  const locale = getResponseLanguage(detectPdfPresentationLocale("Executive Summary\nDecision: GO\nRevenue grows steadily."));
  const levels = ["verified", "benchmarkDerived", "planningAssumption", "validationRequired"];
  const expectedEnglish = ["Verified", "Estimated", "Assumption", "AI Analysis"];

  levels.forEach((level, index) => {
    assert.equal(getEvidenceLabel(level, locale), expectedEnglish[index]);
  });
});

// --- The exact live bug: "Section" eyebrow must follow the report's own language ---

test("the localized 'Section'/'Bölüm' eyebrow reads correctly for both English and Turkish reports", () => {
  const localizeSectionEyebrow = (reportLocale) => (reportLocale === "tr" ? "Bölüm" : "Section");

  assert.equal(localizeSectionEyebrow(detectPdfPresentationLocale("Executive Summary and market analysis.")), "Section");
  assert.equal(localizeSectionEyebrow(detectPdfPresentationLocale("Yönetici özeti ve pazar analizi.")), "Bölüm");
});

// --- Drift checks: page.tsx ---

test("page.tsx's getDashboardEvidenceLabel no longer hardcodes Turkish (drift check)", () => {
  const fnMatch = /function getDashboardEvidenceLabel\([\s\S]*?\n\}/.exec(pageSource);
  assert.ok(fnMatch, "getDashboardEvidenceLabel not found in page.tsx");
  assert.doesNotMatch(fnMatch[0], /"Turkish"/, "getDashboardEvidenceLabel still hardcodes Turkish in page.tsx");
  assert.match(fnMatch[0], /locale: EvidenceLocale/, "getDashboardEvidenceLabel no longer accepts a locale parameter in page.tsx");
});

test("every EvidenceBadge call site in page.tsx passes an explicit locale prop (drift check, no future regressions)", () => {
  const callSites = pageSource.match(/<EvidenceBadge[^/]*\/>/g) || [];
  assert.ok(callSites.length > 0, "no EvidenceBadge call sites found in page.tsx");

  const missingLocale = callSites.filter((call) => !/locale=\{/.test(call));
  assert.deepEqual(missingLocale, [], `EvidenceBadge call sites without a locale prop: ${JSON.stringify(missingLocale)}`);
});

test("page.tsx's Section eyebrow is locale-aware, matching its Sources/Kaynaklar sibling (drift check)", () => {
  assert.match(
    pageSource,
    /\{reportLocale === "tr" \? "Bölüm" : "Section"\}/,
    "the Section eyebrow in page.tsx is no longer locale-aware"
  );
});

// --- Drift checks: components/Planner.tsx (independent duplicate implementation) ---

test("Planner.tsx's getDashboardEvidenceLabel no longer hardcodes Turkish (drift check)", () => {
  const fnMatch = /function getDashboardEvidenceLabel\([\s\S]*?\n\}/.exec(plannerSource);
  assert.ok(fnMatch, "getDashboardEvidenceLabel not found in Planner.tsx");
  assert.doesNotMatch(fnMatch[0], /"Turkish"/, "getDashboardEvidenceLabel still hardcodes Turkish in Planner.tsx");
  assert.match(fnMatch[0], /locale: EvidenceLocale/, "getDashboardEvidenceLabel no longer accepts a locale parameter in Planner.tsx");
});

test("every EvidenceBadge call site in Planner.tsx passes an explicit locale prop (drift check, no future regressions)", () => {
  const callSites = plannerSource.match(/<EvidenceBadge[^/]*\/>/g) || [];
  assert.ok(callSites.length > 0, "no EvidenceBadge call sites found in Planner.tsx");

  const missingLocale = callSites.filter((call) => !/locale=\{/.test(call));
  assert.deepEqual(missingLocale, [], `EvidenceBadge call sites without a locale prop: ${JSON.stringify(missingLocale)}`);
});

test("every getDashboardEvidenceLabel(confidenceBadge) text call site in Planner.tsx passes an explicit locale argument (drift check)", () => {
  const callSites = plannerSource.match(/getDashboardEvidenceLabel\([^)]*\)/g) || [];
  const bareCallSites = callSites.filter((call) => call === "getDashboardEvidenceLabel(confidenceBadge)" || call === "getDashboardEvidenceLabel(level)");
  assert.deepEqual(bareCallSites, [], `getDashboardEvidenceLabel call sites without a locale argument: ${JSON.stringify(bareCallSites)}`);
});

test("Planner.tsx's Section eyebrow is locale-aware (drift check)", () => {
  assert.match(
    plannerSource,
    /\{sectionPdfLocale === "tr" \? "Bölüm" : "Section"\}/,
    "the Section eyebrow in Planner.tsx is no longer locale-aware"
  );
});
