import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createExpertiseProfileFallback,
  getSelectedModeMismatchMessage,
  normalizeSelectedAnalysisMode,
} from "../app/lib/ai/expertise-profile.ts";
import {
  createUnderstandingFallback,
  enforceUnderstandingPolicy,
} from "../app/lib/ai/understanding.ts";
import {
  classifyReportDomain,
  resolveReportDomainForSelectedMode,
} from "../app/lib/report-engine/domain.ts";
import { labelModelDerivedFinancialClaims } from "../app/lib/report-engine/financial-claim-labeling.ts";
import { deduplicateUsableRealEstateExternalEvidence } from "../app/lib/report-engine/real-estate-quality.mjs";
import { marketReportFields } from "../app/lib/report-engine/prompts/market.ts";

const plannerSource = await readFile(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const recommendationSource = await readFile(
  new URL("../components/planner/RecommendationCard.tsx", import.meta.url),
  "utf8"
);
const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);
const executorSource = await readFile(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const workerSource = await readFile(
  new URL("../app/lib/report-jobs/worker.ts", import.meta.url),
  "utf8"
);

const propertyPrompt =
  "İstanbul Kağıthane'de yaklaşık 120 milyon TL bütçeyle A sınıfı bir ofis binası satın almayı değerlendiriyorum. Amacım uzun vadeli kira geliri elde etmek ve 10 yıl içinde değer artışından faydalanmak.";

test("the three selected cards remain their authoritative top-level modes", () => {
  assert.equal(normalizeSelectedAnalysisMode("plan"), "plan");
  assert.equal(normalizeSelectedAnalysisMode("market"), "market");
  assert.equal(normalizeSelectedAnalysisMode("chat"), "chat");
});

test("classifier output cannot replace the selected top-level mode", () => {
  const fallback = createUnderstandingFallback({
    prompt: "Analyze the European software market through 2031.",
    selectedMode: "market",
  });
  const candidate = {
    ...fallback,
    reportPlan: { ...fallback.reportPlan, selectedMode: "plan" },
    researchPlan: { ...fallback.researchPlan, selectedMode: "plan" },
  };
  const result = enforceUnderstandingPolicy(candidate, fallback);

  assert.equal(result.reportPlan.selectedMode, "market");
  assert.equal(result.researchPlan.selectedMode, "market");
});

test("real-estate request under Strategic Advisory uses the real-estate profile", () => {
  const understanding = createUnderstandingFallback({
    prompt: propertyPrompt,
    selectedMode: "chat",
  });
  const profile = createExpertiseProfileFallback({
    prompt: propertyPrompt,
    selectedMode: "chat",
    detectedDomain: understanding.detectedIndustry,
  });

  assert.equal(understanding.detectedIndustry, "real_estate");
  assert.equal(understanding.reportPlan.selectedMode, "chat");
  assert.equal(profile.domain, "real_estate");
  assert.equal(profile.subdomain, "investment_due_diligence");
  assert.match(understanding.reportPlan.sections.map((item) => item.id).join(" "), /title_ownership/);
  const visiblePlan = JSON.stringify({
    sections: understanding.reportPlan.sections,
    dashboardMetrics: understanding.reportPlan.dashboardMetrics,
  });
  assert.doesNotMatch(
    visiblePlan,
    /CAC|ARR|MRR|Founder Readiness|target customer|ICP|go.to.market/i
  );
});

test("Strategic Advisory real estate resolves the real-estate report family", () => {
  const understanding = createUnderstandingFallback({
    prompt: propertyPrompt,
    selectedMode: "chat",
  });
  const inferredDomain = classifyReportDomain(propertyPrompt);
  const reportDomain = resolveReportDomainForSelectedMode({
    selectedMode: "chat",
    inferredDomain,
    expertiseDomain: understanding.expertiseProfile.domain,
  });

  assert.equal(inferredDomain, "real_estate");
  assert.equal(reportDomain, "real_estate");
  assert.match(
    executorSource,
    /reportDomain === "real_estate"[\s\S]*generateRealEstateInvestmentReport/
  );
  assert.doesNotMatch(
    understanding.reportPlan.sections.map((item) => `${item.id} ${item.title}`).join(" "),
    /ICP|CAC|LTV|ARR|MRR|Founder Readiness|go.to.market/i
  );
  assert.match(
    understanding.reportPlan.sections
      .map((item) => `${item.title} ${item.purpose}`)
      .join(" "),
    /purchase price[\s\S]*rent[\s\S]*occupancy[\s\S]*NOI[\s\S]*cap rate[\s\S]*financing[\s\S]*holding-period/i
  );
});

test("Business Idea Validation always resolves to the business report pipeline, even with real-estate evidence in the prompt", () => {
  // Business Idea Validation ("plan") is the product the user explicitly
  // selected -- there is no separate "real estate" product reachable from
  // it, so real-estate evidence in the prompt must never redirect it to
  // the real-estate investment-analysis report (zoning/parcel/title/
  // cadastral content). Confirmed live: an AI SaaS platform for
  // commercial-building energy costs was misrouted this way; this test
  // uses a genuine real-estate prompt (stronger real-estate evidence than
  // that live bug) to prove the fix holds even in the hardest case.
  const understanding = createUnderstandingFallback({
    prompt: propertyPrompt,
    selectedMode: "plan",
  });
  const mismatch = getSelectedModeMismatchMessage({
    selectedMode: "plan",
    detectedDomain: understanding.detectedIndustry,
    prompt: propertyPrompt,
  });

  assert.equal(understanding.reportPlan.selectedMode, "plan");
  assert.equal(mismatch, "");
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "plan",
      inferredDomain: "real_estate",
      expertiseDomain: understanding.expertiseProfile.domain,
    }),
    "business"
  );
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "plan",
      inferredDomain: "real_estate",
      expertiseDomain: "real_estate",
    }),
    "business"
  );
});

test("market research under Business Validation does not override the selected card", () => {
  const prompt =
    "2026–2031 döneminde Avrupa ve ABD’de AI Decision Intelligence Platform pazarını analiz et.";
  const understanding = createUnderstandingFallback({
    prompt,
    selectedMode: "plan",
  });
  const mismatch = getSelectedModeMismatchMessage({
    selectedMode: "plan",
    detectedDomain: understanding.detectedIndustry,
    prompt,
  });

  assert.equal(mismatch, "");
  assert.equal(understanding.detectedIndustry, "startup");
  assert.equal(understanding.expertiseProfile.domain, "business");
  assert.equal(understanding.reportPlan.selectedMode, "plan");
});

test("Business Idea Validation never becomes Contract Review", () => {
  const understanding = createUnderstandingFallback({
    prompt: "Review the termination and liability clauses in this customer contract.",
    selectedMode: "plan",
  });

  assert.equal(understanding.detectedIndustry, "startup");
  assert.equal(understanding.detectedContentType, "business_idea");
  assert.equal(understanding.expertiseProfile.domain, "business");
  assert.doesNotMatch(
    JSON.stringify(understanding),
    /Contract Review|Legal Review|governing_jurisdiction|contract_objective/i
  );
});

test("Strategic Advisory never inherits contract-review questions or expertise", () => {
  const understanding = createUnderstandingFallback({
    prompt: "Review the termination and liability clauses in this customer contract.",
    selectedMode: "chat",
  });

  assert.equal(understanding.detectedIndustry, "general");
  assert.equal(understanding.reportPlan.selectedMode, "chat");
  assert.deepEqual(understanding.clarificationQuestions, []);
  assert.doesNotMatch(
    JSON.stringify(understanding),
    /contract_objective|governing_jurisdiction|review_perspective|available_evidence|employment attorney|legal risk advisor/i
  );
});

test("mode policy rejects a classifier profile borrowed from another card", () => {
  const fallback = createUnderstandingFallback({
    prompt: "Validate a subscription product for independent retailers.",
    selectedMode: "plan",
  });
  const candidate = {
    ...fallback,
    detectedIndustry: "legal",
    detectedContentType: "contract",
    expertiseProfile: {
      ...fallback.expertiseProfile,
      subdomain: "contract_review",
      taskType: "legal_analysis",
      professionalPerspective: "legal risk advisor",
      criticalClarifications: ["Which jurisdiction applies?"],
    },
    clarificationQuestions: [
      {
        id: "governing_jurisdiction",
        question: "Which jurisdiction applies?",
        placeholder: "Jurisdiction",
        options: [],
        required: true,
      },
    ],
  };
  const result = enforceUnderstandingPolicy(candidate, fallback);

  assert.equal(result.detectedIndustry, "startup");
  assert.equal(result.detectedContentType, "business_idea");
  assert.deepEqual(result.expertiseProfile, fallback.expertiseProfile);
  assert.equal(result.reportPlan.selectedMode, "plan");
  assert.doesNotMatch(
    result.clarificationQuestions.map((item) => item.id).join(" "),
    /jurisdiction|contract|legal/
  );
});

test("Market Intelligence overrides automatic contract routing", () => {
  const understanding = createUnderstandingFallback({
    prompt: "Compare contract-management platform demand and competitors in Europe.",
    selectedMode: "market",
  });

  assert.equal(understanding.detectedIndustry, "marketing");
  assert.equal(understanding.expertiseProfile.domain, "marketing");
  assert.equal(understanding.reportPlan.selectedMode, "market");
  assert.doesNotMatch(
    JSON.stringify(understanding.clarificationQuestions),
    /contract_objective|governing_jurisdiction|review_perspective|available_evidence/i
  );
});

test("unsupported model-derived business metrics are removed unless a scenario was requested", () => {
  const labeled = labelModelDerivedFinancialClaims({
    content: [
      "Professional Services model",
      "ARR: $2M",
      "CAC: $5k",
      "LTV: $78k",
      "Estimated required funding: $1.3M",
    ].join("\n"),
    metricValues: ["$2M", "$5k", "$78k", "$1.3M"],
    language: "English",
    sourceContext: "AI decision platform for SMEs",
  });

  assert.doesNotMatch(labeled, /Professional Services/);
  for (const value of ["$2M", "$5k", "$78k", "$1.3M"]) {
    assert.doesNotMatch(labeled, new RegExp(value.replace("$", "\\$")));
  }
  // The unavailable copy must never leak raw internal status strings --
  // it should read as a clean executive explanation of why the figure is
  // missing and what evidence would resolve it, not a bare status token.
  assert.doesNotMatch(labeled, /not provided/i);
  assert.doesNotMatch(labeled, /cannot be calculated from available evidence/i);
  assert.match(labeled, /no verified (?:realized-revenue|customer acquisition and retention|expense or financing) data exists yet[^\n]+ to calculate this/i);
  assert.doesNotMatch(labeled, /User-provided[^\n]+\$(?:2M|5k|78k|1\.3M)/i);
});

test("irrelevant real-estate research sources are excluded", () => {
  const usable = deduplicateUsableRealEstateExternalEvidence([
    {
      label: "Verified from official source",
      field: "zoning",
      claim: "The municipality publishes general zoning information.",
      value: "General city-wide planning page",
      sourceTitle: "Municipality zoning information",
      publisher: "Municipality",
      url: "https://municipality.gov.example/planning/general-information",
      retrievalStatus: "success",
    },
    {
      label: "Verified from external source",
      field: "comparables",
      claim: "A news article discusses regional property demand.",
      value: "No comparable property record",
      sourceTitle: "Regional property news",
      publisher: "News Publisher",
      url: "https://news.example.com/property-demand-2026",
      retrievalStatus: "success",
    },
  ]);

  assert.deepEqual(usable, []);
});

test("sufficient Market Intelligence context skips generic clarification", () => {
  const understanding = createUnderstandingFallback({
    prompt:
      "2026–2031 döneminde Avrupa ve ABD’de AI Decision Intelligence Platform pazarını analiz et.",
    selectedMode: "market",
  });

  assert.equal(understanding.reportPlan.selectedMode, "market");
  assert.equal(understanding.recommendedAction, "report");
  assert.deepEqual(understanding.clarificationQuestions, []);
  assert.doesNotMatch(
    JSON.stringify(understanding),
    /current_baseline|success_criteria|venture_stage|founder/i
  );
});

test("Market Intelligence uses a dedicated report family and never Business Plan fields", () => {
  const expectedFields = [
    "executiveSummary",
    "marketOverview",
    "marketSize",
    "cagr",
    "marketSegmentation",
    "regionalAnalysis",
    "industryTrends",
    "competitiveLandscape",
    "majorPlayers",
    "customerSegments",
    "marketDrivers",
    "barriers",
    "opportunities",
    "threats",
    "tamSamSom",
    "portersFiveForces",
    "strategicRecommendations",
    "sources",
  ];
  const forbiddenFields = [
    "problem",
    "solution",
    "targetCustomer",
    "businessModel",
    "pricingStrategy",
    "salesStrategy",
    "unitEconomics",
    "founderScore",
    "founderRoadmap",
  ];

  assert.deepEqual([...marketReportFields], expectedFields);
  assert.equal(
    forbiddenFields.some((field) => marketReportFields.includes(field)),
    false
  );
  assert.match(
    executorSource,
    /selectedAnalysisMode === "market"[\s\S]*executeMarketAnalysisRequest/
  );
  assert.match(workerSource, /analysisMode\) === "market"[\s\S]*return "market"/);
  assert.match(workerSource, /domain === "market"[\s\S]*return "market_analysis"/);
});

test("Business Validation keeps venture-specific gaps without blocking direct generation", () => {
  const understanding = createUnderstandingFallback({
    prompt:
      "KOBİ’ler için yapay zekâ destekli stratejik karar ve rapor platformu kurmak istiyorum.",
    selectedMode: "plan",
  });

  assert.equal(understanding.detectedIndustry, "startup");
  assert.equal(understanding.reportPlan.selectedMode, "plan");
  assert.match(
    understanding.clarificationQuestions.map((item) => item.id).join(" "),
    /target_customer|target_market|venture_stage/
  );
  assert.doesNotMatch(
    JSON.stringify(understanding.clarificationQuestions),
    /parcel|zoning|jurisdiction|tapu|imar/i
  );
});

test("explicit mode selection removes the redundant recommendation selector", () => {
  assert.doesNotMatch(recommendationSource, /Önerilen Analizler|Recommended Analyses/);
  assert.doesNotMatch(recommendationSource, /RecommendationReason|Why this recommendation/);
  assert.doesNotMatch(recommendationSource, /Continue as Chat|Sohbet Olarak Devam Et/);
  assert.doesNotMatch(plannerSource, /<RecommendationCard/);
  assert.doesNotMatch(plannerSource, /pendingRecommendation/);
  assert.doesNotMatch(plannerSource, /understanding\.recommendedAction === "clarify"/);
  assert.match(
    plannerSource,
    /selectedMode === "chat"[\s\S]*sendChatMessage/
  );
  assert.match(
    plannerSource,
    /createDirectReportReadiness\(understanding\)[\s\S]*void generatePlan\([\s\S]*reportReadiness,[\s\S]*selectedMode/
  );
  assert.doesNotMatch(plannerSource, /recommendation\.reportMode\s*\)/);
});

test("selected mode authority is enforced in enqueue and worker execution paths", () => {
  assert.match(planRouteSource, /getSelectedModeMismatchMessage/);
  assert.match(planRouteSource, /ANALYSIS_MODE_MISMATCH/);
  assert.match(executorSource, /getSelectedModeMismatchMessage/);
  assert.match(executorSource, /ANALYSIS_MODE_MISMATCH/);
  assert.match(plannerSource, /const queuedAttachments = \[\.\.\.attachments\]/);
  assert.match(plannerSource, /sendChatMessage\([\s\S]*queuedAttachments/);
  assert.match(plannerSource, /generatePlan\([\s\S]*queuedAttachments/);
  assert.match(plannerSource, /selectedMode,/);
});
