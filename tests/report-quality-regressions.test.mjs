import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  stripFencedCodeBlocks,
  stripLeakedPromptEchoLines,
} from "../app/lib/report-jobs/prompt-echo-sanitization.ts";
import {
  findReportLanguageIssues,
  repairReportLanguageSections,
} from "../app/lib/report-language.ts";
import { normalizePdfSourceDomain } from "../app/lib/pdf-normalization.mjs";
import { planFields } from "../app/lib/report-engine/prompts/plan.ts";
import { realEstateFields } from "../app/lib/report-engine/prompts/real-estate.ts";
import { domainAnalysisFields } from "../app/lib/report-engine/prompts/domain-analysis.ts";

// Citations.tsx/ReportPdfButton.tsx contain JSX and can't be imported
// directly by the plain Node test runner (no existing test in this
// suite imports a .tsx file directly -- every one reads the source
// instead), so the citation-quality-gate fix is verified against the
// real source text of both files, matching this suite's established
// convention for .tsx modules.
const citationsSource = readFileSync(
  new URL("../components/planner/Citations.tsx", import.meta.url),
  "utf8"
);
const reportPdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
// market-analysis/route.ts imports next/server, same constraint as
// plan-executor.ts -- verified against source, matching convention.
const marketAnalysisRouteSource = readFileSync(
  new URL("../app/api/market-analysis/route.ts", import.meta.url),
  "utf8"
);
// worker.ts imports "server-only" -- same constraint, verified against source.
const workerSource = readFileSync(
  new URL("../app/lib/report-jobs/worker.ts", import.meta.url),
  "utf8"
);

// --- Bug 1: raw prompt / formatting instructions leaking into report content ---
// (plan-executor.ts's sanitizeVisibleReportContent composes exactly
// these two pure helpers -- see app/lib/report-jobs/prompt-echo-sanitization.ts
// -- ahead of its own existing internal-line filtering, so exercising
// them directly proves the new behavior without needing plan-executor.ts's
// next/server-dependent module graph.)

function sanitizeForTest(content, promptText = "") {
  const withoutCodeFences = stripFencedCodeBlocks(content);
  return promptText
    ? stripLeakedPromptEchoLines(withoutCodeFences, promptText)
    : withoutCodeFences;
}

test("a Turkish prompt's markdown-format instructions do not leak into report content", () => {
  const promptText =
    "Kahve zinciri işim için bir rapor hazırla. Lütfen çıktıyı şu markdown formatında ver: ## Başlık, ardından madde işaretli liste ve bir tablo ekle: | Sütun 1 | Sütun 2 |";
  const leakedContent = [
    "Kahve zinciri talebi, seçilen bölgede güçlü görünüyor.",
    "Lütfen çıktıyı şu markdown formatında ver: ## Başlık, ardından madde işaretli liste ve bir tablo ekle: | Sütun 1 | Sütun 2 |",
    "Aylık ciro tahmini 120.000 TL civarındadır.",
  ].join("\n");

  const sanitized = sanitizeForTest(leakedContent, promptText);

  assert.match(sanitized, /Kahve zinciri talebi/);
  assert.match(sanitized, /Aylık ciro tahmini/);
  assert.doesNotMatch(sanitized, /markdown formatında/);
});

test("pasted code blocks and sample tables in the prompt never appear as business evidence", () => {
  const promptText = "Bir SaaS aracı planlıyorum.";
  const leakedContent = [
    "Hedef müşteri küçük işletmelerdir.",
    "```js",
    "function calculateChurn(users) { return users.filter(u => !u.active).length; }",
    "```",
    "Fiyatlandırma modeli aylık abonelik şeklindedir.",
  ].join("\n");

  const sanitized = sanitizeForTest(leakedContent, promptText);

  assert.match(sanitized, /Hedef müşteri/);
  assert.match(sanitized, /Fiyatlandırma modeli/);
  assert.doesNotMatch(sanitized, /```/);
  assert.doesNotMatch(sanitized, /function calculateChurn/);
});

test("legitimate short user-provided facts survive sanitization even when they overlap the prompt", () => {
  const promptText =
    "Şirketimizin adı Acme Yazılım ve aylık gelirimiz 50.000 TL. Bu bilgilere göre bir rapor hazırla.";
  const legitimateContent = [
    "Şirket adı: Acme Yazılım.",
    "Aylık gelir 50.000 TL olarak bildirilmiştir.",
    "CAC ve LTV oranı sağlıklı görünüyor.",
  ].join("\n");

  const sanitized = sanitizeForTest(legitimateContent, promptText);

  assert.match(sanitized, /Acme Yazılım/);
  assert.match(sanitized, /50\.000 TL/);
  assert.match(sanitized, /CAC ve LTV/);
});

test("sanitization is a no-op for clean content with no prompt text supplied", () => {
  const cleanContent = "Bu bölüm tamamen özgün ve temiz bir analiz içermektedir.";
  assert.equal(sanitizeForTest(cleanContent), cleanContent);
});

// Regression: the pipeline deliberately instructs the model to reuse
// the same "analyzed business/company description" (a verbatim slice
// of the raw prompt) across many report sections. An earlier version
// of this filter stripped any long line that overlapped the prompt at
// all, which gutted every section that legitimately restated that
// shared description, cascading into "Report payload is missing
// required sections" for real Business Idea Validation runs. This
// must never regress: plain declarative restatement of the prompt,
// even at length and even repeated verbatim across sections, must
// always survive.
test("long verbatim restatement of the analyzed business description across many sections never gets stripped", () => {
  const promptText =
    "Üç şubesi olan bir kahve zinciri işletiyorum, aylık ortalama gelirimiz şube başına 150.000 TL ve dördüncü bir şube açmayı planlıyorum, bu yatırım kararını değerlendirir misin?";
  const sharedDescription =
    "Üç şubesi olan bir kahve zinciri işletiyorum, aylık ortalama gelirimiz şube başına 150.000 TL ve dördüncü bir şube açmayı planlıyorum.";

  for (const sectionContent of [
    `${sharedDescription} Hedef müşteri düzenli kahve tüketen ofis çalışanlarıdır.`,
    `${sharedDescription} Rekabet analizi bölgedeki zincir kafeleri kapsamaktadır.`,
    `${sharedDescription} Finansal varsayımlar mevcut üç şubenin performansına dayanmaktadır.`,
  ]) {
    const sanitized = sanitizeForTest(sectionContent, promptText);
    assert.match(sanitized, /Üç şubesi olan bir kahve zinciri işletiyorum/);
    assert.equal(sanitized, sectionContent);
  }
});

// --- Bug 2: short foreign-language fragments escaping detection ---

test("a short leftover English fragment inside a Turkish section is now detected", () => {
  const mixed = "Doğrulama tamamlandı. AI Analysis and the report risk stays low.";
  const issues = findReportLanguageIssues(mixed, "tr");
  assert.ok(issues.some((issue) => issue.kind === "foreign_prose" || issue.kind === "foreign_ui_text"));
});

test("financial acronyms, technical terms, and URLs never trigger residual foreign-language detection", () => {
  for (const [code, safe] of [
    ["tr", "CAC ve LTV oranı B2B modelinde sağlıklıdır."],
    ["tr", "Kaynak: https://example.com/rapor CAC metriği burada."],
    ["en", "CAC and LTV remain healthy for this B2B SaaS model."],
    ["de", "Die CAC und LTV Kennzahlen sind für dieses B2B Modell gesund."],
  ]) {
    assert.deepEqual(findReportLanguageIssues(safe, code), []);
  }
});

test("repairReportLanguageSections removes short residual foreign fragments without corrupting the rest", () => {
  const repaired = repairReportLanguageSections(
    [
      {
        field: "risks",
        title: "Riskler",
        content: "Ana risk sermaye kısıtıdır. Not verified yet. CAC oranı 40 TL'dir.",
      },
    ],
    "tr"
  );

  assert.match(repaired.sections[0].content, /Ana risk sermaye kısıtıdır/);
  assert.match(repaired.sections[0].content, /CAC oranı 40 TL/);
});

// --- Bug 3: internal fallback/translation messages leaking into report content ---

test("the language-repair fallback message never appears in section content, only in warnings", () => {
  const repaired = repairReportLanguageSections(
    [
      {
        field: "summary",
        title: "Executive Summary",
        content:
          "Değerlendirme tamamlanmıştır. The report explains the market risk and the decision with clear recommendations and next actions.",
      },
    ],
    "tr"
  );

  assert.doesNotMatch(repaired.sections[0].content, /çevrilemediği|translated|translation/i);
  assert.equal(repaired.warnings.length, 1);
  assert.match(repaired.warnings[0], /dil gereksinimini karşılamadığı/i);
});

// --- Bug 4: garbage/placeholder citation entries ---

test("parseCitations' flushCurrent rejects stray metadata fragments with no real evidence in both citation renderers", () => {
  for (const source of [citationsSource, reportPdfButtonSource]) {
    assert.match(source, /STRAY_CITATION_FIELD_VALUES/);
    assert.match(source, /function isPlausibleCitationField\(/);
    // flushCurrent must gate on plausibility, not on bare truthiness
    // of sourceTitle/organization/url (the old permissive gate that
    // let a stray "Publisher: user" line become a full citation).
    assert.doesNotMatch(
      source,
      /if \(current\.sourceTitle \|\| current\.organization \|\| current\.url\) \{/
    );
    assert.match(source, /hasUsableEvidence/);
  }
});

test("getFinalDedupePdfSources excludes citations with no usable evidence as a second layer of defense", () => {
  for (const source of [citationsSource, reportPdfButtonSource]) {
    assert.match(
      source,
      /dedupePdfCitations\(citations\)\.forEach\(\(citation\) => \{\s*\n\s*const hasUsableEvidence[\s\S]{0,200}if \(!hasUsableEvidence\) \{\s*\n\s*return;/
    );
  }
});

test("normalizePdfSourceDomain never mangles free-form organization prose into a fake domain", () => {
  assert.equal(normalizePdfSourceDomain("R7: finansal muhasebe ansiklopedileri"), "");
  assert.equal(normalizePdfSourceDomain("U.S. Census Bureau"), "");
  assert.equal(normalizePdfSourceDomain("mckinsey.com"), "mckinsey.com");
  assert.equal(normalizePdfSourceDomain("https://www.mckinsey.com/insights"), "mckinsey.com");
});

// --- Regression: Market Intelligence reports failing "Report payload
// is missing required sections" whenever the model omitted/invalidated
// even one field. parseFullMarketReport had no fallback synthesis (unlike
// plan-executor.ts's business path), so an empty/invalid field flowed
// straight through to worker.ts's readExecutionResponse as truly
// missing content. Fixed by giving it the same never-empty guarantee,
// without touching the missing/invalid-field tracking that diagnostics
// and the partial-report warning rely on. ---

test("parseFullMarketReport never leaves a missing or invalid field empty", () => {
  assert.doesNotMatch(
    marketAnalysisRouteSource,
    /missingFields\.push\(field\);\s*\n\s*report\[field\] = "";/
  );
  assert.doesNotMatch(
    marketAnalysisRouteSource,
    /invalidFields\.push\(field\);\s*\n\s*report\[field\] = "";/
  );
  assert.match(
    marketAnalysisRouteSource,
    /missingFields\.push\(field\);\s*\n\s*report\[field\] = createMarketFieldFallback\(field, language\);/
  );
  assert.match(
    marketAnalysisRouteSource,
    /invalidFields\.push\(field\);\s*\n\s*report\[field\] = createMarketFieldFallback\(field, language\);/
  );
});

test("the market fallback is honest (never a fabricated market fact) and covers all 5 supported languages", () => {
  assert.match(marketAnalysisRouteSource, /const marketFieldFallbackTemplates/);
  for (const language of ["English", "Turkish", "German", "French", "Spanish"]) {
    assert.match(
      marketAnalysisRouteSource,
      new RegExp(`${language}: \\(label\\) =>`)
    );
  }
  assert.match(marketAnalysisRouteSource, /validation gap, not a market finding/i);
});

test("missing/invalid-field tracking used by the partial-report warning is unchanged", () => {
  // The fallback fix must not weaken or bypass isPartialReportResult's
  // input -- missingFields/invalidFields must still be pushed exactly
  // as before, only the *content* written for those fields changed.
  assert.match(marketAnalysisRouteSource, /const isPartialReport = isPartialReportResult\(missingFields, invalidFields\);/);
  assert.match(marketAnalysisRouteSource, /Market analysis returned a partial report/);
});

// --- Regression (live-reproduced): worker.ts's inferDomain misclassified
// a complete, real Business Idea Validation report as "real_estate"
// because "scenarioAnalysis" is a field name independently defined in
// planFields, realEstateFields, AND domainAnalysisFields. The old
// fallback matched on ANY shared field name, so every real business
// report (which always has a "scenarioAnalysis" field) tripped the
// real_estate branch whenever reportDomain wasn't set on the
// payload/events, and worker.ts then checked the response against the
// wrong field list, reporting every real field as missing. Fixed by
// deriving domain-exclusive field lists so a name shared with a
// lower-priority/default domain can never cause a false match. ---

test("scenarioAnalysis (shared across all three report schemas) can never trigger a false domain match", () => {
  // This is the exact field-name collision that caused the live
  // failure -- assert it's real, so the fix below is proven necessary.
  assert.ok((planFields).includes("scenarioAnalysis"));
  assert.ok((realEstateFields).includes("scenarioAnalysis"));
  assert.ok((domainAnalysisFields).includes("scenarioAnalysis"));

  const realEstateDistinguishingFields = realEstateFields.filter(
    (field) => !planFields.includes(field)
  );
  const domainAnalysisDistinguishingFields = domainAnalysisFields.filter(
    (field) => !planFields.includes(field) && !realEstateFields.includes(field)
  );

  assert.ok(!realEstateDistinguishingFields.includes("scenarioAnalysis"));
  assert.ok(!domainAnalysisDistinguishingFields.includes("scenarioAnalysis"));
  // The fix must still be able to recognize a genuine real-estate or
  // domain-analysis report -- plenty of exclusive fields must remain.
  assert.ok(realEstateDistinguishingFields.length >= 10);
  assert.ok(domainAnalysisDistinguishingFields.length >= 5);

  // A real, complete business-plan event stream (every planFields key
  // present, exactly as the live-reproduced bug had) must never match
  // either fallback -- this is the actual failure condition reproduced
  // live against the real, running application.
  const businessEvent = Object.fromEntries(planFields.map((field) => [field, "content"]));
  assert.equal(
    realEstateDistinguishingFields.some((field) => field in businessEvent),
    false
  );
  assert.equal(
    domainAnalysisDistinguishingFields.some((field) => field in businessEvent),
    false
  );
});

test("worker.ts's inferDomain fallback uses domain-exclusive field lists, not the raw shared lists", () => {
  assert.match(workerSource, /const realEstateDistinguishingFields = realEstateFields\.filter/);
  assert.match(workerSource, /const domainAnalysisDistinguishingFields = domainAnalysisFields\.filter/);
  assert.match(
    workerSource,
    /events\.some\(\(event\) => realEstateDistinguishingFields\.some\(\(field\) => field in event\)\)/
  );
  assert.match(
    workerSource,
    /events\.some\(\(event\) => domainAnalysisDistinguishingFields\.some\(\(field\) => field in event\)\)/
  );
  // The old, collision-prone fallback must be gone.
  assert.doesNotMatch(
    workerSource,
    /events\.some\(\(event\) => realEstateFields\.some\(\(field\) => field in event\)\)/
  );
});
