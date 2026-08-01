import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createUnderstandingFallback,
  createUniversalReportReadiness,
  enforceUnderstandingPolicy,
} from "../app/lib/ai/understanding.ts";
import {
  sanitizeInternalResearchDiagnostics,
} from "../app/lib/report-output-sanitization.ts";

const plannerSource = await readFile(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const understandingRouteSource = await readFile(
  new URL("../app/api/understanding/route.ts", import.meta.url),
  "utf8"
);
const planRouteSource = await readFile(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const pdfSource = await readFile(
  new URL("../app/lib/pdf-engine/real-estate-report.ts", import.meta.url),
  "utf8"
);

test("property screenshot with OCR parcel identity can start research without mandatory questions", () => {
  const fallback = createUnderstandingFallback({
    prompt: "Bu parsele yatırım yapmak istiyorum",
    assets: [
      {
        name: "IMG_5412.PNG",
        size: 680_000,
        mimeType: "image/png",
        textContent:
          "İl: Hatay İlçe: Defne Mahalle: Dursunlu Mevkii: Tamurcu Ada: 1517 Parsel: 1 Yüzölçümü: 6.364,62 m² Nitelik: Ağaçlı Tarla",
      },
    ],
  });

  assert.equal(fallback.detectedIndustry, "real_estate");
  assert.equal(fallback.detectedContentType, "property_document");
  assert.equal(fallback.canGenerateReport, true);
  assert.equal(fallback.recommendedAction, "report");
  assert.deepEqual(
    fallback.clarificationQuestions.map((question) => question.id),
    ["purchase_price"]
  );
  assert.equal(fallback.clarificationQuestions[0]?.required, false);
  assert.deepEqual(fallback.missingCriticalInformation, []);
  assert.ok(createUniversalReportReadiness(fallback, {}));
});

test("generic model output cannot override stronger property classification", () => {
  const fallback = createUnderstandingFallback({
    prompt: "Bu arsaya yatırım yapmak istiyorum",
    assets: [
      {
        name: "IMG_5412.PNG",
        size: 680_000,
        mimeType: "image/png",
      },
    ],
  });
  const result = enforceUnderstandingPolicy(
    {
      detectedIndustry: "general",
      detectedContentType: "image",
      detectedIntent: "Görseli incelemek",
      confidence: 0.61,
      missingCriticalInformation: [
        "investment_objective",
        "property_location",
        "official_property_records",
        "purchase_price",
      ],
      suggestedReportTypes: ["Görsel Analizi"],
      extractedAssetFacts: [
        { field: "province", label: "İl", value: "Hatay", source: "IMG_5412.PNG" },
        { field: "district", label: "İlçe", value: "Defne", source: "IMG_5412.PNG" },
        { field: "block", label: "Ada", value: "1517", source: "IMG_5412.PNG" },
        { field: "parcel", label: "Parsel", value: "1", source: "IMG_5412.PNG" },
        { field: "parcel_size", label: "Yüzölçümü", value: "6.364,62 m²", source: "IMG_5412.PNG" },
      ],
      clarificationQuestions: [
        {
          id: "investment_objective",
          question: "Yatırım hedefiniz ve süreniz nedir?",
          placeholder: "",
          options: [],
          required: true,
        },
        {
          id: "property_location",
          question: "Kesin konumu paylaşabilir misiniz?",
          placeholder: "",
          options: [],
          required: true,
        },
        {
          id: "official_property_records",
          question: "İmar ve tapu kayıtlarını paylaşabilir misiniz?",
          placeholder: "",
          options: [],
          required: true,
        },
        {
          id: "purchase_price",
          question: "Satış fiyatı nedir?",
          placeholder: "",
          options: [],
          required: true,
        },
      ],
      canGenerateReport: false,
      recommendedAction: "clarify",
    },
    fallback
  );

  assert.equal(result.detectedIndustry, "real_estate");
  assert.equal(result.detectedContentType, "property_document");
  assert.equal(result.canGenerateReport, true);
  assert.equal(result.recommendedAction, "report");
  assert.equal(result.extractedAssetFacts.length, 5);
  assert.deepEqual(
    result.clarificationQuestions.map((question) => ({
      id: question.id,
      required: question.required,
    })),
    [{ id: "purchase_price", required: false }]
  );
  assert.doesNotMatch(
    result.clarificationQuestions.map((question) => question.question).join(" "),
    /kesin konum|imar|tapu|takyidat|yatırım amacı/i
  );
});

test("understanding sends binary assets to semantic analysis and Planner respects the gate", () => {
  assert.match(plannerSource, /dataUrl: attachment\.dataUrl \|\| ""/);
  assert.match(understandingRouteSource, /buildAnalysisProviderInput/);
  assert.match(understandingRouteSource, /property_document rather than the generic image type/);
  assert.match(
    plannerSource,
    /setPendingRecommendation\(\{\s*prompt: submittedPrompt,\s*attachments: queuedAttachments,\s*recommendation/
  );
  assert.match(plannerSource, /createUniversalReportReadiness/);
});

test("technical research failures are removed centrally from user-facing report content", () => {
  const sanitized = sanitizeInternalResearchDiagnostics(`
[Unknown] İmar durumu dış kaynaktan doğrulanamadı.
provider=tavily query="Hatay Defne 1517 ada 1 parsel" result=failed reason=Request was aborted
Research attempts
provider disabled
`);

  assert.doesNotMatch(
    sanitized,
    /provider|query|result=failed|Request was aborted|provider disabled|Research attempts/i
  );
  assert.match(
    sanitized,
    /Bazı dış kaynaklar doğrulanamadığı için bu bölüm kesin sonuç içermiyor\./
  );
  assert.doesNotMatch(
    planRouteSource,
    /state the providers searched, the exact queries executed/i
  );
  assert.match(pdfSource, /provider disabled/);
  assert.match(pdfSource, /result\\s\*=\\s\*failed/);
});
