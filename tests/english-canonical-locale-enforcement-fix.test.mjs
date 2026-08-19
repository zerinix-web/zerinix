import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { detectPdfPresentationLocale } from "../app/lib/pdf-normalization.mjs";
import { getEvidenceLabel, evidenceLabels } from "../app/lib/report-evidence.ts";
import { getResponseLanguage } from "../app/lib/report-language.ts";

// CRITICAL PRODUCTION FIX -- enforce English as the canonical UI language.
//
// Confirmed live: an English Business Plan report showed French evidence
// badges ("Hypothèse", "Analyse IA", "Estimé") -- the same underlying bug
// class as the previously-fixed "Varsayım"/"Bölüm" Turkish leak, now
// reproduced in the French branch of the same shared function.
//
// Root cause: detectPdfPresentationLocale's (app/lib/pdf-normalization.mjs)
// French keyword list included the bare word "Sources", which is spelled
// identically in French and English (confirmed against this app's own
// canonical vocabulary -- report-language.ts's copy.en.sources === "Sources"
// === copy.fr.sources). Since every single report has a Sources section,
// this guaranteed the false positive would eventually surface in
// production, exactly mirroring the earlier "risk" bug in the Turkish
// branch (identical in Turkish and English, and present in nearly every
// report via a Risk section).
//
// The fix removes "Sources" from the French keyword list. Because
// detectPdfPresentationLocale is the single shared locale-detection
// function every benchmark-driven and evidence-driven section (Financial
// Assumptions, Benchmark Intelligence, SWOT, Roadmap, Founder Readiness,
// Sources, Dashboard, PDF) ultimately derives its locale from, this one
// fix -- not a per-badge string patch -- corrects every section at once.
//
// This test file also adds a STRUCTURAL guard (not a one-off patch):
// every non-English keyword list in detectPdfPresentationLocale is
// cross-checked against this app's own canonical English report
// vocabulary, so any future keyword addition that reintroduces this exact
// bug class (a non-English keyword that happens to be spelled identically
// to English) fails this test immediately, rather than silently shipping
// and surfacing in a live report weeks later.

const pdfNormalizationSource = readFileSync("app/lib/pdf-normalization.mjs", "utf8");

// The canonical English vocabulary this app actually renders in report UI
// -- pulled from the same sources the localization pipeline itself uses
// (report-language.ts's copy.en, report-evidence.ts's evidenceLabels.English),
// plus the other UI badge words named in the bug report.
const canonicalEnglishVocabulary = [
  "Report", "Executive Summary", "Decision", "BUY", "WAIT", "AVOID",
  "Confidence Score", "Main Risk", "Risks", "Recommendations", "Next Action",
  "Evidence", "Sources", "Source", "Warnings", "Missing Information",
  "Legal Assessment", "Access date", "Reliability", "Page",
  "Verified", "Estimated", "Assumption", "AI Analysis",
  "Section", "Confidence", "Investor Insight", "Key Takeaway", "Details",
];

function extractKeywordListSource(localeCode) {
  const patterns = {
    tr: /\/\\b\(\?:pazar[\s\S]*?\)\\b\/i/,
    de: /\/\\b\(\?:Zusammenfassung[\s\S]*?\)\\b\/i/,
    fr: /\/\\b\(\?:Synthèse[\s\S]*?\)\\b\/i/,
    es: /\/\\b\(\?:Resumen[\s\S]*?\)\\b\/i/,
  };
  const match = patterns[localeCode].exec(pdfNormalizationSource);
  return match ? match[0] : "";
}

// --- The exact live bug and its fix --------------------------------------

test("an English report's Sources section is no longer misdetected as French (the exact live bug)", () => {
  const englishSourcesSection =
    "Sources\nVerified external research evidence:\nTitle: BSA/AML Examination Manual\nPublisher: FFIEC\nReference: [R1]\nURL: https://ffiec.gov/bsa-aml";

  assert.equal(detectPdfPresentationLocale(englishSourcesSection), "en");
});

test("an English report never renders the French evidence labels for any section, including one that mentions Sources (the exact live bug, end to end)", () => {
  const sections = [
    "Executive Summary\nDecision: GO. The main risk is enterprise sales cycles.",
    "Sources\nVerified external research evidence for this report.",
    "Financial Assumptions\nGross Margin assumption is based on comparable benchmark sources.",
  ];

  for (const content of sections) {
    const locale = getResponseLanguage(detectPdfPresentationLocale(content));
    assert.equal(locale, "English", `"${content}" should resolve to English`);

    for (const level of ["verified", "benchmarkDerived", "planningAssumption", "validationRequired"]) {
      const label = getEvidenceLabel(level, locale);
      assert.notEqual(label, evidenceLabels.French[level], `English section leaked the French label for ${level}: "${label}"`);
      assert.notEqual(label, evidenceLabels.Turkish[level], `English section leaked the Turkish label for ${level}: "${label}"`);
    }
  }
});

test("an English report never contains Hypothèse, Analyse IA, Estimé, Estime, Varsayım, or Bölüm", () => {
  const forbidden = ["Hypothèse", "Analyse IA", "Estimé", "Estime", "Varsayım", "Bölüm"];
  const sections = [
    "Sources\nVerified external research evidence.",
    "Financial Dashboard\nRisk Posture: Tracked. Main Risk: customer concentration.",
    "Benchmark Intelligence\nSector Fit assessed against comparable sources.",
  ];

  for (const content of sections) {
    const locale = getResponseLanguage(detectPdfPresentationLocale(content));
    const renderedLabels = ["verified", "benchmarkDerived", "planningAssumption", "validationRequired"].map(
      (level) => getEvidenceLabel(level, locale)
    );
    const eyebrow = detectPdfPresentationLocale(content) === "tr" ? "Bölüm" : "Section";
    assert.notEqual(eyebrow, "Bölüm", `"${content}" rendered the Turkish section eyebrow "Bölüm"`);

    for (const forbiddenWord of forbidden) {
      assert.ok(!renderedLabels.includes(forbiddenWord), `"${content}" rendered forbidden label "${forbiddenWord}"`);
    }
  }
});

// --- English labels render correctly everywhere (requirement 2) ---------

test("English is the canonical rendering for every named badge/label when report language is English", () => {
  const locale = "English";

  assert.equal(getEvidenceLabel("planningAssumption", locale), "Assumption");
  assert.equal(getEvidenceLabel("benchmarkDerived", locale), "Estimated");
  assert.equal(getEvidenceLabel("validationRequired", locale), "AI Analysis");
  assert.equal(getEvidenceLabel("verified", locale), "Verified");
});

// --- Genuine non-English reports are unaffected (no regression) ----------

test("genuine French, Turkish, German, and Spanish content still correctly detects its own locale", () => {
  const cases = [
    ["Synthèse exécutive\nDécision: ACHETER\nL'hypothèse de remboursement repose sur des données de planification.", "fr"],
    ["Sources\nSynthèse des preuves externes vérifiées de ce rapport.", "fr"],
    ["Yönetici Özeti\nKarar: EVET\nGeri ödeme varsayımı planlama girdilerine dayanmaktadır.", "tr"],
    ["Riskler\nAna Risk: Müşteri yoğunlaşması ve doğrulama eksikliği.", "tr"],
    ["Zusammenfassung\nEntscheidung: KAUFEN\nDie Annahme basiert auf Planungsdaten.", "de"],
    ["Resumen ejecutivo\nDecisión: COMPRAR\nEl supuesto se basa en datos de planificación.", "es"],
  ];

  for (const [content, expected] of cases) {
    assert.equal(detectPdfPresentationLocale(content), expected, `"${content}" should detect as "${expected}"`);
  }
});

test("a genuine French report still correctly renders Hypothèse/Analyse IA/Estimé (no regression)", () => {
  const genuineFrench = "Synthèse exécutive\nDécision: ACHETER\nL'hypothèse de remboursement repose sur des données de planification.";
  const locale = getResponseLanguage(detectPdfPresentationLocale(genuineFrench));

  assert.equal(locale, "French");
  assert.equal(getEvidenceLabel("planningAssumption", locale), "Hypothèse");
  assert.equal(getEvidenceLabel("validationRequired", locale), "Analyse IA");
  assert.equal(getEvidenceLabel("benchmarkDerived", locale), "Estimé");
});

// --- Verify every report section shares the same locale pipeline ---------

test("every benchmark/evidence-driven report section resolves the same English locale from the same shared function", () => {
  const sectionContents = {
    "Financial Assumptions": "Key Assumptions behind the financial model, sourced from comparable benchmark sources.",
    "Benchmark Intelligence": "Sector Fit and Business Model Fit assessed against industry sources.",
    SWOT: "Weaknesses: unproven at scale. Sources of competitive risk remain limited.",
    Roadmap: "Immediate Actions: complete primary research. Sources for validation include direct customer interviews.",
    "Founder Readiness": "Validation Confidence: 52/100 - primary customer and pricing risk requires validation.",
    Sources: "Verified external research evidence for this report.",
  };

  for (const [section, content] of Object.entries(sectionContents)) {
    const locale = detectPdfPresentationLocale(content);
    assert.equal(locale, "en", `section "${section}" did not resolve to English: got "${locale}"`);
  }
});

// --- Structural guard: cannot accidentally inherit another locale --------

test("STRUCTURAL GUARD: no non-English keyword in detectPdfPresentationLocale may be spelled identically to this app's own canonical English report vocabulary (prevents this entire bug class from recurring)", () => {
  for (const code of ["tr", "de", "fr", "es"]) {
    const keywordListSource = extractKeywordListSource(code);
    assert.ok(keywordListSource, `could not locate the ${code} keyword list in pdf-normalization.mjs`);

    const keywords = [...keywordListSource.matchAll(/[\p{L} ]{2,}/gu)]
      .map((match) => match[0].trim())
      .filter(Boolean);

    for (const keyword of keywords) {
      const collision = canonicalEnglishVocabulary.find(
        (englishWord) => englishWord.toLowerCase() === keyword.toLowerCase()
      );
      assert.equal(
        collision,
        undefined,
        `${code} keyword "${keyword}" is spelled identically to the English report word "${collision}" -- this will misdetect any English report using that word as ${code} (the exact bug class this fix eliminates)`
      );
    }
  }
});

test("detectPdfPresentationLocale's French keyword list no longer contains the bare word 'Sources' (drift check)", () => {
  const fnMatch = /export function detectPdfPresentationLocale\([\s\S]*?\n\}/.exec(pdfNormalizationSource);
  assert.ok(fnMatch, "detectPdfPresentationLocale not found");
  assert.doesNotMatch(fnMatch[0], /Synthèse\|Décision\|Risques\|Sources\|/, "the French keyword list still contains the ambiguous English/French word 'Sources'");
});

test("every other French keyword remains in place (no over-correction / regression in French detection)", () => {
  const fnMatch = /export function detectPdfPresentationLocale\([\s\S]*?\n\}/.exec(pdfNormalizationSource);
  assert.ok(fnMatch, "detectPdfPresentationLocale not found");
  for (const keyword of ["Synthèse", "Décision", "Risques", "Recommandations"]) {
    assert.match(fnMatch[0], new RegExp(keyword), `French keyword "${keyword}" was unexpectedly removed`);
  }
});
