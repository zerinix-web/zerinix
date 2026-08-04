import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildStrictReportLanguageInstruction,
  findReportLanguageIssues,
  getResponseLanguage,
  resolveMarketIntelligenceLanguage,
  resolveMarketPdfLanguage,
} from "../app/lib/report-language.ts";
import { buildMarketLanguageInstructions } from "../app/lib/report-engine/prompts/market.ts";

const planRoute = readFileSync("app/api/plan/route.ts", "utf8");
const pdfButton = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");

const englishPrompt = "US AI accounting software";
const turkishPrompt = "ABD yapay zeka muhasebe yazılımı pazarı";

// --- Requirement 1: language priority (explicit > detected-from-prompt > English) ---

test("English category prompt resolves to English, not site/browser locale", () => {
  assert.equal(resolveMarketIntelligenceLanguage({ requestText: englishPrompt }), "en");
});

test("Turkish prompt resolves to Turkish purely from prompt text", () => {
  assert.equal(resolveMarketIntelligenceLanguage({ requestText: turkishPrompt }), "tr");
});

test("explicit selection overrides prompt detection in both directions", () => {
  assert.equal(
    resolveMarketIntelligenceLanguage({ explicitLanguage: "Turkish", requestText: englishPrompt }),
    "tr"
  );
  assert.equal(
    resolveMarketIntelligenceLanguage({ explicitLanguage: "English", requestText: turkishPrompt }),
    "en"
  );
});

test("ambiguous/no-signal prompts fall back to English, never to a locale guess", () => {
  assert.equal(resolveMarketIntelligenceLanguage({ requestText: "Construction ERP" }), "en");
  assert.equal(resolveMarketIntelligenceLanguage({ requestText: "Cybersecurity MDR" }), "en");
  assert.equal(resolveMarketIntelligenceLanguage({ requestText: "" }), "en");
});

// --- Requirements 8-9: PDF/export language trusts the saved report language ---

test("PDF export trusts the saved report language over re-detecting from the prompt", () => {
  // "rapor" is a Turkish signal word; without savedReportLanguage this prompt
  // would detect as Turkish, but the report was actually generated in English.
  const ambiguousText = "market rapor";
  assert.equal(
    resolveMarketPdfLanguage({ savedReportLanguage: "en", requestText: ambiguousText }),
    "en"
  );
});

test("PDF export still honors an explicit override above the saved language", () => {
  assert.equal(
    resolveMarketPdfLanguage({
      explicitLanguage: "Turkish",
      savedReportLanguage: "en",
      requestText: englishPrompt,
    }),
    "tr"
  );
});

test("PDF export falls back to prompt detection only when no saved language exists", () => {
  assert.equal(resolveMarketPdfLanguage({ requestText: turkishPrompt }), "tr");
  assert.equal(resolveMarketPdfLanguage({ requestText: englishPrompt }), "en");
});

test("a saved report's language survives reload/export regardless of prompt wording", () => {
  const savedReport = { metadata: { reportLanguage: "en" }, prompt: englishPrompt };
  assert.equal(
    resolveMarketPdfLanguage({
      savedReportLanguage: savedReport.metadata.reportLanguage,
      requestText: savedReport.prompt,
    }),
    "en"
  );
});

// --- Requirement 6: prompt enforcement ---

test("buildMarketLanguageInstructions names the language and forbids mixing", () => {
  const englishInstructions = buildMarketLanguageInstructions("English");
  assert.match(englishInstructions, /Output language is English/);
  assert.match(englishInstructions, /Do not mix languages/);
  assert.match(englishInstructions, /Preserve proper nouns/i);
  assert.match(englishInstructions, /URLs/);

  const turkishInstructions = buildMarketLanguageInstructions("Turkish");
  assert.match(turkishInstructions, /Output language is Turkish/);
  assert.match(turkishInstructions, /Do not mix languages/);
});

test("buildStrictReportLanguageInstruction preserves proper nouns, URLs, citations, and acronyms", () => {
  const instruction = buildStrictReportLanguageInstruction("English");
  assert.match(instruction, /proper nouns/i);
  assert.match(instruction, /company names/i);
  assert.match(instruction, /URLs/);
  assert.match(instruction, /citations/i);
  assert.match(instruction, /acronyms/i);
});

// --- Requirement 5/10: no language mixing in a single section ---

test("a fully English section reports no language-consistency issues", () => {
  const text =
    "The competitive landscape shows five major vendors. Intuit (QuickBooks) leads with the largest independent footprint, followed by Xero and Sage.";
  const issues = findReportLanguageIssues(text, "English");
  assert.equal(issues.length, 0);
});

test("a Turkish sentence mixed into an English section is detected as language mixing", () => {
  const text =
    "The competitive landscape shows five major vendors. Pazar öncüsü olarak QuickBooks öne çıkıyor ve rakiplerinden daha fazla pazar payına sahiptir.";
  const issues = findReportLanguageIssues(text, "English");
  assert.ok(issues.length > 0);
  assert.ok(issues.some((issue) => issue.detectedLanguage === "tr"));
});

test("a fully Turkish section reports no language-consistency issues", () => {
  const text =
    "Rekabet ortamı beş büyük tedarikçi göstermektedir. Intuit (QuickBooks) en büyük bağımsız kanıt tabanına sahiptir ve Xero ile Sage onu takip etmektedir.";
  const issues = findReportLanguageIssues(text, "Turkish");
  assert.equal(issues.length, 0);
});

// --- Requirement 5/10: company names and URLs remain unchanged / never flagged ---

test("a source line with a URL and a preserved proper noun is never flagged as mixed", () => {
  const text = "Source: https://quickbooks.intuit.com/pricing — Verified from official source.";
  assert.equal(findReportLanguageIssues(text, "English").length, 0);
  assert.equal(findReportLanguageIssues(text, "Turkish").length, 0);
});

test("a lone brand/company name inside otherwise-correct-language prose does not trip mixed-language detection", () => {
  const englishWithBrand =
    "BlackLine provides financial close automation software for enterprise accounting teams and integrates with major ERP platforms.";
  assert.equal(findReportLanguageIssues(englishWithBrand, "English").length, 0);

  const turkishWithBrand =
    "BlackLine, kurumsal muhasebe ekipleri için finansal kapanış otomasyonu sağlayan ve büyük ERP platformlarıyla entegre olan bir yazılımdır.";
  assert.equal(findReportLanguageIssues(turkishWithBrand, "Turkish").length, 0);
});

// --- Wiring checks: mode-gated, scoped-to-Market-Intelligence branches exist ---
// (readFileSync string assertions, matching the existing pattern used by
// tests/research-preflight-cache.test.mjs for hard-to-execute route code.)

test("app/api/plan/route.ts resolves Market Intelligence language via the new resolver, gated by analysisMode", () => {
  assert.match(planRoute, /resolveMarketIntelligenceLanguage/);
  assert.match(planRoute, /normalizeSelectedAnalysisMode\(body\.analysisMode\)\s*===\s*"market"/);
  assert.match(planRoute, /ai_chat_profiles/);
  assert.match(planRoute, /preferred_language/);
});

test("app/api/plan/route.ts preserves the original resolveReportLanguage call for non-market modes", () => {
  assert.match(
    planRoute,
    /resolveReportLanguage\(\{\s*explicitLanguage: body\.explicitReportLanguage,\s*uiLanguage: body\.uiLanguage \|\| body\.language \|\| req\.headers\.get\("x-zerinix-ui-language"\),/
  );
});

test("ReportPdfButton.tsx resolves market-report PDF language from the saved report language, gated by report type", () => {
  assert.match(pdfButton, /resolveMarketPdfLanguage/);
  assert.match(pdfButton, /isMarketIntelligenceDashboardReport/);
  assert.match(pdfButton, /savedReportLanguage:\s*report\.metadata\?\.reportLanguage/);
});

test("ReportPdfButton.tsx preserves the original resolveReportLanguage call for non-market report types", () => {
  const nonMarketBranchPattern =
    /resolveReportLanguage\(\{\s*explicitLanguage: window\.localStorage\.getItem\("zerinix_report_language"\),\s*requestText: report\.prompt,\s*uiLanguage: report\.metadata\?\.reportLanguage,\s*\}\)/;
  assert.match(pdfButton, nonMarketBranchPattern);
});

// --- getResponseLanguage sanity (used across the fixed call sites) ---

test("getResponseLanguage round-trips the resolved codes used by the new resolvers", () => {
  assert.equal(getResponseLanguage(resolveMarketIntelligenceLanguage({ requestText: englishPrompt })), "English");
  assert.equal(getResponseLanguage(resolveMarketIntelligenceLanguage({ requestText: turkishPrompt })), "Turkish");
});
