import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createDecisionInputPolicy,
  expressDecisionInputFields,
} from "../app/lib/decision-intelligence/input-policy.mjs";
import {
  createUnderstandingFallback,
  enforceUnderstandingPolicy,
} from "../app/lib/ai/understanding.ts";

const understandingRouteSource = await readFile(
  new URL("../app/api/understanding/route.ts", import.meta.url),
  "utf8"
);

const field = (id, question, required = true) => ({
  id,
  question,
  placeholder: "",
  options: [],
  required,
});

test("Decision Engine separates researchable real-estate fields from user fields", () => {
  const policy = createDecisionInputPolicy({
    domain: "real_estate",
    fields: [
      field("property_location", "Kesin konum nedir?"),
      field("official_property_records", "İmar ve tapu kayıtları mevcut mu?"),
      field("municipality", "İlgili belediye hangisi?"),
      field("purchase_price", "Pazarlık fiyatınız nedir?"),
    ],
  });

  assert.deepEqual(
    policy.userInputFields.map((item) => ({
      id: item.id,
      required: item.required,
    })),
    [{ id: "purchase_price", required: false }]
  );
  assert.ok(
    policy.researchFields.some((item) => item.id === "property_location")
  );
  assert.ok(policy.researchFields.some((item) => item.id === "zoning"));
  assert.ok(policy.researchFields.some((item) => item.id === "title_status"));
  assert.ok(policy.researchFields.some((item) => item.id === "comparables"));
});

test("LLM can rephrase only Decision Engine user fields and cannot add questions", () => {
  const policy = createDecisionInputPolicy({
    domain: "legal",
    fields: [
      field("contract_objective", "Bu sözleşmeyle ne yapmak istiyorsunuz?"),
      field("governing_jurisdiction", "Hangi hukuk uygulanmalı?"),
    ],
  });
  const expressed = expressDecisionInputFields({
    policy,
    llmPhrasings: [
      field("contract_objective", "İncelemenin temel amacı nedir?", false),
      field("invented_question", "Yeni ve izinsiz soru?", true),
    ],
  });

  assert.deepEqual(
    expressed.map((item) => item.id),
    ["contract_objective", "governing_jurisdiction"]
  );
  assert.equal(expressed[0].question, "İncelemenin temel amacı nedir?");
  assert.equal(expressed[0].required, true);
  assert.doesNotMatch(
    expressed.map((item) => item.question).join(" "),
    /izinsiz/
  );
});

test("Universal Understanding rejects LLM-invented question IDs", () => {
  const fallback = createUnderstandingFallback({
    prompt: "",
    assets: [
      {
        name: "commercial-agreement.pdf",
        size: 1_024,
        mimeType: "application/pdf",
      },
    ],
  });
  const result = enforceUnderstandingPolicy(
    {
      ...fallback,
      clarificationQuestions: [
        field("invented_question", "Yeni soru"),
        field("property_location", "Konum nedir?"),
      ],
      missingCriticalInformation: ["invented_question", "property_location"],
      canGenerateReport: false,
      recommendedAction: "clarify",
    },
    fallback
  );

  assert.deepEqual(
    result.clarificationQuestions.map((item) => item.id),
    fallback.clarificationQuestions.map((item) => item.id)
  );
});

test("classifier prompt limits the LLM to Decision Engine field IDs", () => {
  assert.match(
    understandingRouteSource,
    /Decision Engine exclusively decides which fields may be asked/
  );
  assert.match(
    understandingRouteSource,
    /Never add a question for an ID that is not present/
  );
  assert.match(understandingRouteSource, /createDecisionInputPolicy/);
});
