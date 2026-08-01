import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sanitizeAiResponseText } from "../app/lib/ai/response-sanitization.ts";
import { createUnderstandingFallback } from "../app/lib/ai/understanding.ts";
import {
  classifyReportDomain,
  resolveReportDomainForSelectedMode,
} from "../app/lib/report-engine/domain.ts";
import { sanitizeInternalRoutingMetadata } from "../app/lib/report-output-sanitization.ts";
import {
  realEstateFields,
  validateRealEstateReport,
} from "../app/lib/report-engine/prompts/real-estate.ts";

const plannerSource = await readFile(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const executorSource = await readFile(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const chatRouteSource = await readFile(
  new URL("../app/api/chat/route.ts", import.meta.url),
  "utf8"
);

const propertyPrompt = "bu araziye yatırım yapmak istiyorum";
const propertyAssets = [
  {
    name: "IMG_5412.PNG",
    size: 1_591_535,
    mimeType: "image/png",
    textContent:
      "Taşınmaz bilgileri Ada 1517 Parsel 1, Ağaçlı Tarla, 6.364,62 m²",
  },
];

test("land request plus uploaded property evidence resolves to real estate", () => {
  const understanding = createUnderstandingFallback({
    prompt: propertyPrompt,
    assets: propertyAssets,
    selectedMode: "plan",
  });

  assert.equal(understanding.detectedIndustry, "real_estate");
  assert.equal(understanding.detectedContentType, "property_document");
  assert.equal(understanding.expertiseProfile.domain, "real_estate");
  assert.equal(
    classifyReportDomain(propertyPrompt, propertyAssets.map((asset) => ({
      name: asset.name,
      type: asset.mimeType,
      textContent: asset.textContent,
    }))),
    "real_estate"
  );
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "plan",
      inferredDomain: "real_estate",
      expertiseDomain: understanding.expertiseProfile.domain,
    }),
    "real_estate"
  );
});

test("real-estate report routing reaches the dedicated writer before business generation", () => {
  assert.match(
    executorSource,
    /if \(reportDomain === "real_estate"\) \{[\s\S]*generateRealEstateInvestmentReport\(/
  );
  assert.match(
    executorSource,
    /selectedGenerator:[\s\S]*reportDomain === "real_estate"[\s\S]*"generateRealEstateInvestmentReport"/
  );
});

test("real-estate schema and validator reject startup report artifacts", () => {
  const startupArtifacts =
    /^(?:problem|solution|targetCustomer|businessModel|pricingStrategy|goToMarketPlan|salesStrategy|unitEconomics|founderScore|founderRoadmap)$/i;
  assert.equal(realEstateFields.some((field) => startupArtifacts.test(field)), false);

  const report = Object.fromEntries(
    realEstateFields.map((field) => [
      field,
      field === "recommendedDueDiligence"
        ? "Obtain official title, zoning, access, and comparable evidence."
        : field === "finalRecommendation"
          ? "[Recommendation] WAIT. This is a preliminary due-diligence report."
          : "[Unknown] Evidence is insufficient.",
    ])
  );
  report.investmentScore = "[Estimate] No score can be calculated from available evidence.";
  report.finalRecommendation += " CAC $5k, LTV $78k, ARR $2M, MRR $100k.";

  assert.throws(() => validateRealEstateReport(report), /domain-inappropriate/i);
});

test("internal routing metadata is removed from chat and report output", () => {
  const unsafe = [
    "Useful conclusion.",
    "ZERINIX validated request context",
    "Likely domain: real_estate",
    "Likely content type: property_document",
    "Inferred decision goal: investment",
    "Unresolved information: zoning",
    "Private expertise routing context.",
  ].join("\n");

  for (const output of [
    sanitizeAiResponseText(unsafe),
    sanitizeInternalRoutingMetadata(unsafe),
  ]) {
    assert.match(output, /Useful conclusion/);
    assert.doesNotMatch(
      output,
      /validated request context|Likely domain|Likely content type|Inferred decision goal|Unresolved information|Private expertise routing context/i
    );
  }
  assert.doesNotMatch(
    plannerSource,
    /ZERINIX validated request context|Likely domain|Likely content type|Inferred decision goal|Unresolved information/
  );
});

test("direct execution and Strategic Advisory answer contract remain intact", () => {
  assert.doesNotMatch(plannerSource, /<RecommendationCard|pendingRecommendation/);
  assert.match(plannerSource, /if \(selectedMode === "chat"\)[\s\S]*sendChatMessage/);
  assert.match(plannerSource, /createDirectReportReadiness\(understanding\)[\s\S]*generatePlan/);
  assert.match(chatRouteSource, /isDirectStrategicAdvisory/);
  assert.match(chatRouteSource, /Lead with one concise recommendation paragraph/);
  assert.match(chatRouteSource, /3–5 key reasons/);
  assert.match(chatRouteSource, /Key risks and Immediate next actions/);
  assert.match(chatRouteSource, /Do not end with follow-up questions/);
});
