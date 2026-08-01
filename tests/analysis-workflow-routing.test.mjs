import test from "node:test";
import assert from "node:assert/strict";
import {
  createUnderstandingFallback,
  selectAnalysisWorkflow,
} from "../app/lib/ai/understanding.ts";

test("employment-law requests select the legal workflow", () => {
  const prompt =
    "Altı yıldır çalıştığım işyerinden performans gerekçesiyle çıkarıldım; yazılı uyarı ve savunma talebi yoktu, kıdem ve ihbar haklarımı incele.";
  const result = createUnderstandingFallback({ prompt });

  assert.equal(selectAnalysisWorkflow({ prompt }), "legal");
  assert.equal(result.detectedIndustry, "legal");
  assert.equal(result.detectedContentType, "general_document");
});

test("real-estate requests select the real-estate workflow", () => {
  const prompt = "Hatay Defne'deki 1517 ada 1 parsel arsaya yatırım yapmalı mıyım?";

  assert.equal(selectAnalysisWorkflow({ prompt }), "real_estate");
  assert.equal(createUnderstandingFallback({ prompt }).detectedIndustry, "real_estate");
});

test("commercial-property investment requests never fall through to legal clarification", () => {
  const prompt =
    "İstanbul Kağıthane'de yaklaşık 120 milyon TL bütçeyle A sınıfı bir ofis binası satın almayı değerlendiriyorum...";
  const result = createUnderstandingFallback({ prompt });

  assert.equal(selectAnalysisWorkflow({ prompt }), "real_estate");
  assert.equal(result.detectedIndustry, "real_estate");
  assert.equal(result.detectedContentType, "property_document");
  assert.doesNotMatch(
    result.clarificationQuestions.map((question) => question.id).join(" "),
    /governing_jurisdiction|review_perspective|decision_deadline|available_evidence/
  );
  assert.ok(result.suggestedReportTypes.includes("Yatırım Analizi"));
});

test("property requests use legal workflow only for explicit legal or contract review", () => {
  const prompt =
    "Kağıthane'deki ofis binasının satış sözleşmesini hukuki açıdan incele.";

  assert.equal(selectAnalysisWorkflow({ prompt }), "legal");
  assert.equal(createUnderstandingFallback({ prompt }).detectedIndustry, "legal");
});

test("startup requests select the business workflow", () => {
  const prompt = "I want to launch a startup for independent accountants.";

  assert.equal(selectAnalysisWorkflow({ prompt }), "business");
  assert.equal(createUnderstandingFallback({ prompt }).detectedIndustry, "startup");
});

test("finance and marketing requests select their domain workflows", () => {
  const financePrompt = "Analyze our cash flow, profitability, and annual budget.";
  const marketingPrompt = "Evaluate our brand campaign and conversion performance.";

  assert.equal(selectAnalysisWorkflow({ prompt: financePrompt }), "finance");
  assert.equal(
    createUnderstandingFallback({ prompt: financePrompt }).detectedIndustry,
    "accounting"
  );
  assert.equal(selectAnalysisWorkflow({ prompt: marketingPrompt }), "marketing");
  assert.equal(
    createUnderstandingFallback({ prompt: marketingPrompt }).detectedIndustry,
    "marketing"
  );
});

test("ambiguous analysis requests select generic clarification", () => {
  const prompt = "Bunu değerlendirmek istiyorum.";
  const result = createUnderstandingFallback({ prompt });

  assert.equal(selectAnalysisWorkflow({ prompt }), "generic");
  assert.equal(result.detectedIndustry, "general");
  assert.equal(result.recommendedAction, "clarify");
  assert.deepEqual(
    result.clarificationQuestions.map((question) => question.id),
    ["analysis_objective"]
  );
});

test("legal workflow never renders business KPI, baseline, or success questions", () => {
  const result = createUnderstandingFallback({
    prompt:
      "İşveren maaşımı ödemedi ve beni yazılı uyarı olmadan işten çıkardı. Haklarım ve dava sürecim nedir?",
  });
  const questionText = result.clarificationQuestions
    .map((question) => `${question.id} ${question.question}`)
    .join(" ");

  assert.equal(result.detectedIndustry, "legal");
  assert.doesNotMatch(
    questionText,
    /analysis_objective|current_baseline|success_criteria|baseline|KPI|başarı hangi ölçüt/i
  );
  assert.ok(
    result.clarificationQuestions.every((question) =>
      [
        "governing_jurisdiction",
        "review_perspective",
        "decision_deadline",
        "available_evidence",
      ].includes(question.id)
    )
  );
});
