import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createUnderstandingFallback,
  createUniversalReportReadiness,
  getUniversalReportReadinessError,
} from "../app/lib/ai/understanding.ts";

const plannerSource = await readFile(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const recommendationCardSource = await readFile(
  new URL("../components/planner/RecommendationCard.tsx", import.meta.url),
  "utf8"
);
const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);
const planExecutorSource = await readFile(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);

const domainCases = [
  {
    expectedIndustry: "real_estate",
    expectedAction: "report",
    prompt: "Bu arsaya yatırım yapmak istiyorum",
    assets: [{ name: "parsel.png", size: 4_096, mimeType: "image/png" }],
  },
  {
    expectedIndustry: "legal",
    prompt: "Bu hukuki belge için risk raporu hazırla",
    assets: [{ name: "agreement.pdf", size: 4_096, mimeType: "application/pdf" }],
  },
  {
    expectedIndustry: "accounting",
    prompt: "Bu bilançoyu analiz et",
    assets: [
      {
        name: "bilanco.xlsx",
        size: 4_096,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
  },
  {
    expectedIndustry: "healthcare",
    prompt: "Sağlık kliniği için kapasite raporu hazırla",
    assets: [],
  },
  {
    expectedIndustry: "logistics",
    prompt: "Lojistik operasyonlarımızı analiz et",
    assets: [],
  },
  {
    expectedIndustry: "startup",
    prompt: "Yapay zekâ tabanlı bir girişim kurmak istiyorum",
    assets: [],
  },
];

test("report domains use readiness while real-estate researchable gaps do not block", () => {
  for (const domainCase of domainCases) {
    const understanding = createUnderstandingFallback(domainCase);
    const expectedAction = domainCase.expectedAction || "clarify";

    assert.equal(
      understanding.detectedIndustry,
      domainCase.expectedIndustry,
      domainCase.expectedIndustry
    );
    assert.equal(understanding.recommendedAction, expectedAction);
    assert.equal(
      understanding.canGenerateReport,
      expectedAction === "report"
    );
    assert.ok(understanding.clarificationQuestions.length > 0);
    assert.ok(understanding.clarificationQuestions.length <= 4);
    assert.deepEqual(
      understanding.missingCriticalInformation,
      understanding.clarificationQuestions
        .filter((question) => question.required)
        .map((question) => question.id)
    );
  }
});

test("report readiness is created only after every required answer exists", () => {
  const understanding = createUnderstandingFallback({
    prompt: "Lojistik operasyonlarımızı analiz et",
  });
  const incompleteAnswers = Object.fromEntries(
    understanding.clarificationQuestions
      .slice(0, -1)
      .map((question) => [question.id, "Yanıt"])
  );
  const completeAnswers = Object.fromEntries(
    understanding.clarificationQuestions.map((question) => [
      question.id,
      "Yanıt",
    ])
  );

  assert.equal(
    createUniversalReportReadiness(understanding, incompleteAnswers),
    null
  );

  const readiness = createUniversalReportReadiness(
    understanding,
    completeAnswers
  );
  assert.ok(readiness);
  assert.equal(getUniversalReportReadinessError(readiness), "");
  assert.match(
    getUniversalReportReadinessError({
      ...readiness,
      answers: { ...readiness.answers, [readiness.requiredQuestionIds[0]]: "" },
    }),
    /required question/i
  );
});

test("Planner always shows summary, missing information, and questions before research", () => {
  assert.match(recommendationCardSource, /"İçerik Özeti"/);
  assert.match(recommendationCardSource, /"Eksik Bilgiler"/);
  assert.match(recommendationCardSource, /"Sorular"/);
  assert.match(recommendationCardSource, /primaryDisabled=\{!requiredQuestionsAnswered\}/);

  const submitStart = plannerSource.indexOf(
    "async function submitForUnderstanding"
  );
  const submitEnd = plannerSource.indexOf(
    "async function continueRecommendationAsChat",
    submitStart
  );
  const submitFlow = plannerSource.slice(submitStart, submitEnd);

  assert.match(submitFlow, /setPendingRecommendation/);
  assert.doesNotMatch(submitFlow, /generatePlan\(/);
});

test("OCR property facts render in a read-only detected information card above questions", () => {
  for (const field of [
    "province",
    "district",
    "neighborhood",
    "block",
    "parcel",
    "parcel_size",
    "property_type",
  ]) {
    assert.match(recommendationCardSource, new RegExp(`\"${field}\"`));
  }

  const detectedCardStart = recommendationCardSource.indexOf(
    '"Algılanan Bilgiler"'
  );
  const questionFormStart = recommendationCardSource.indexOf(
    "{questions.length > 0 ?",
    detectedCardStart
  );
  const detectedCardSource = recommendationCardSource.slice(
    detectedCardStart,
    questionFormStart
  );

  assert.ok(detectedCardStart >= 0);
  assert.ok(questionFormStart > detectedCardStart);
  assert.match(detectedCardSource, /detectedPropertyFacts\.map/);
  assert.doesNotMatch(detectedCardSource, /<(?:input|button|textarea|select)\b/);
  assert.doesNotMatch(detectedCardSource, /setAnswers/);
});

test("universal report requests are rejected before research when readiness is invalid", () => {
  const readinessGuard = planRouteSource.indexOf(
    "getUniversalReportReadinessError"
  );
  const enqueueEntry = planRouteSource.indexOf(
    '.from("report_jobs")',
    readinessGuard
  );
  const researchEntry = planExecutorSource.indexOf(
    "generateRealEstateInvestmentReport({"
  );

  assert.ok(readinessGuard >= 0);
  assert.ok(enqueueEntry > readinessGuard);
  assert.ok(researchEntry >= 0);
  assert.match(planRouteSource, /REPORT_INPUT_INCOMPLETE/);
  assert.match(plannerSource, /"X-Zerinix-Universal-Input": "true"/);
  assert.match(plannerSource, /\.\.\.\(reportReadiness \? \{ reportReadiness \} : \{\}\)/);
});
