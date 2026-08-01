import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createUnderstandingFallback,
  enforceUnderstandingPolicy,
  universalUnderstandingSchema,
} from "../app/lib/ai/understanding.ts";
import { classifyReportDomain } from "../app/lib/report-engine/domain.ts";

const understandingRouteSource = await readFile(
  new URL("../app/api/understanding/route.ts", import.meta.url),
  "utf8"
);
const plannerSource = await readFile(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const migrationSource = await readFile(
  new URL(
    "../supabase/migrations/20260730150000_add_universal_analysis_context.sql",
    import.meta.url
  ),
  "utf8"
);

test("contract classification gates research on material legal decision inputs", () => {
  const result = createUnderstandingFallback({
    prompt: "",
    assets: [
      {
        name: "commercial-agreement.pdf",
        size: 1_024,
        mimeType: "application/pdf",
      },
    ],
  });

  assert.equal(result.detectedIndustry, "legal");
  assert.equal(result.detectedContentType, "contract");
  assert.equal(result.recommendedAction, "clarify");
  assert.deepEqual(
    result.clarificationQuestions.map((question) => question.id),
    [
      "contract_objective",
      "governing_jurisdiction",
      "review_perspective",
      "decision_deadline",
    ]
  );
});

test("accounting spreadsheet requests period, currency, and reporting scope", () => {
  const result = createUnderstandingFallback({
    prompt: "Bu bilançonun finansal sağlığını analiz et",
    assets: [
      {
        name: "bilanco.xlsx",
        size: 2_048,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
  });

  assert.equal(result.detectedIndustry, "accounting");
  assert.equal(result.detectedContentType, "financial_statement");
  assert.deepEqual(
    result.clarificationQuestions.map((question) => question.id),
    ["financial_period", "currency", "reporting_scope"]
  );
});

test("retail spreadsheet preserves recommendations but waits for critical inputs", () => {
  const result = createUnderstandingFallback({
    prompt:
      "Market zinciri satışlarını, şube performansını ve stok devir hızını analiz et",
    assets: [
      {
        name: "sube-satislari.csv",
        size: 3_072,
        mimeType: "text/csv",
      },
    ],
  });

  assert.equal(result.detectedIndustry, "retail");
  assert.equal(result.detectedContentType, "spreadsheet");
  assert.equal(result.canGenerateReport, false);
  assert.equal(result.recommendedAction, "clarify");
  assert.deepEqual(
    result.clarificationQuestions.map((question) => question.id),
    ["financial_period", "currency", "reporting_scope"]
  );
  assert.match(result.suggestedReportTypes.join(" "), /Şube Performansı/);
  assert.match(result.suggestedReportTypes.join(" "), /Stok Devir Hızı/);
});

test("property evidence with a decision goal routes to real estate", () => {
  const result = createUnderstandingFallback({
    prompt:
      "Bu tapudaki Hatay Defne 1517 ada 1 parsel arsaya yatırım yapmak istiyorum",
    assets: [
      {
        name: "tapu.png",
        size: 4_096,
        mimeType: "image/png",
      },
    ],
  });

  assert.equal(result.detectedIndustry, "real_estate");
  assert.equal(result.detectedContentType, "property_document");
  assert.equal(result.recommendedAction, "report");
  assert.equal(result.canGenerateReport, true);
  assert.deepEqual(
    result.clarificationQuestions.map((question) => ({
      id: question.id,
      required: question.required,
    })),
    [{ id: "purchase_price", required: false }]
  );
});

test("business idea does not start research before startup inputs are complete", () => {
  const result = createUnderstandingFallback({
    prompt:
      "Almanya’da yapay zekâ tabanlı bir muhasebe uygulaması kurmak istiyorum.",
  });

  assert.equal(result.detectedIndustry, "startup");
  assert.equal(result.detectedContentType, "business_idea");
  assert.equal(result.recommendedAction, "clarify");
  assert.equal(result.canGenerateReport, false);
  assert.deepEqual(
    result.clarificationQuestions.map((question) => question.id),
    ["target_customer", "venture_stage"]
  );
  assert.equal(
    classifyReportDomain(
      "Almanya’da yapay zekâ tabanlı bir muhasebe uygulaması kurmak istiyorum."
    ),
    "business"
  );
});

test("ordinary questions preserve the existing chat path", () => {
  const result = createUnderstandingFallback({
    prompt: "Brüt kâr marjı nasıl hesaplanır?",
  });

  assert.equal(result.recommendedAction, "chat");
  assert.equal(result.canGenerateReport, false);
});

test("a generic attachment without a user goal requests one critical clarification", () => {
  const result = createUnderstandingFallback({
    prompt: "",
    assets: [
      {
        name: "uploaded-document.pdf",
        size: 2_048,
        mimeType: "application/pdf",
      },
    ],
  });

  assert.equal(result.recommendedAction, "clarify");
  assert.deepEqual(
    result.clarificationQuestions.map((question) => question.id),
    ["analysis_objective"]
  );
});

test("invalid model output is replaced by a schema-valid fallback", () => {
  const fallback = createUnderstandingFallback({
    prompt: "What is working capital?",
  });
  const result = enforceUnderstandingPolicy(
    {
      detectedIndustry: "unsupported_domain",
      confidence: 8,
    },
    fallback
  );

  assert.deepEqual(result, fallback);
  assert.equal(universalUnderstandingSchema.safeParse(result).success, true);
});

test("classification is authenticated, bounded, rate-limited, cached, and usage-attributed", () => {
  assert.match(understandingRouteSource, /validateApiRequest/);
  assert.match(understandingRouteSource, /maxBodyBytes: 17_000_000/);
  assert.match(understandingRouteSource, /supabase\.auth\.getUser\(\)/);
  assert.match(understandingRouteSource, /api:understanding:user/);
  assert.match(understandingRouteSource, /MAX_CLASSIFICATION_ASSETS = 6/);
  assert.match(understandingRouteSource, /getCachedAiResponse/);
  assert.match(understandingRouteSource, /recordAiUsage/);
  assert.match(understandingRouteSource, /safe_fallback/);
  assert.match(understandingRouteSource, /MAX_ASSET_DATA_URL_CHARS = 6_667_000/);
  assert.match(understandingRouteSource, /buildAnalysisProviderInput/);
});

test("analysis context persists in the existing RLS-owned conversation", () => {
  assert.match(plannerSource, /persistAnalysisContext/);
  assert.match(plannerSource, /clarificationAnswers/);
  assert.match(plannerSource, /reportStatus: "completed"/);
  assert.match(migrationSource, /alter table public\.ai_conversations/);
  assert.match(migrationSource, /analysis_context jsonb/);
  assert.match(migrationSource, /jsonb_typeof\(analysis_context\) = 'object'/);
  assert.match(
    migrationSource,
    /existing ai_conversations RLS policies/
  );
});

test("drag-and-drop preserves the isolated composer text without lifting typing state", () => {
  assert.match(plannerSource, /const composerDraftRef = useRef\(""\)/);
  assert.match(plannerSource, /draftSnapshotRef\.current = value/);
  assert.match(
    plannerSource,
    /async function handlePlannerDrop[\s\S]*await handleDropFiles\(event\)/
  );
  assert.doesNotMatch(
    plannerSource,
    /async function handlePlannerDrop[\s\S]{0,400}requestUniversalUnderstanding/
  );
});
