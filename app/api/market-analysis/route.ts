import { NextResponse } from "next/server";
import { isPrivateBetaAllowed } from "@/app/lib/beta-access";
import { isAmbiguousBusinessRequest } from "@/app/lib/business-idea-detection";
import { createClient } from "@/app/lib/supabase/server";
import {
  checkRateLimit,
  getClientIpFromRequest,
  getRateLimitHeaders,
} from "@/app/lib/security/rate-limit";
import { validateApiRequest } from "@/app/lib/security/request-validation";
import { logServerError } from "@/app/lib/security/errors";
import { logOperationalInfo } from "@/app/lib/security/logging";
import {
  createAiCacheKey,
  estimateAiCostUsd,
  extractTokenUsage,
  getCachedAiResponse,
  recordAiUsage,
  storeCachedAiResponse,
  type TokenUsage,
} from "@/app/lib/ai/governance";
import { checkAiProductionRateLimit } from "@/app/lib/ai/rate-limit";
import { createAiJobDescriptor } from "@/app/lib/ai/queue";
import {
  createCanonicalFinancialAssumptions,
  formatCanonicalFinancialAssumptions,
  type AiFinancialModelContext,
} from "@/app/lib/ai/financial-assumptions";
import { isReportGenerationFailureText } from "@/app/lib/report-errors";
import {
  createOpenAiClient,
  getAiConfigurationErrorMessage,
  isAiTestMode,
  logAiExecution,
} from "@/app/lib/ai/runtime";
import { sanitizeAiResponseText } from "@/app/lib/ai/response-sanitization";
import {
  applyUserMemoryOperations,
  buildUserMemoryContext,
  extractExplicitMemoryOperations,
  loadUserMemoriesForUser,
} from "@/app/lib/ai/user-memory";
import {
  buildDecisionSupportDirectives,
  buildFullReportStructureDirectives,
} from "@/app/lib/ai/report-quality-directives";
import { normalizePdfText } from "@/app/lib/pdf-normalization.mjs";

const fieldPrompts = {
  executiveSummary: {
    prompt:
      "Write an investor-grade Executive Summary with one job only: market verdict. Start with Proceed / Hold for validation / Decline and conviction, then cover market attractiveness, demand signal, competitive intensity, entry timing, strategic gap, and the founder's most important market decision. Do not repeat TAM/SAM/SOM, SWOT, Porter, competitor, entry-plan, KPI, or source detail. Do not use internal labels or confidence tags. Do not write a heading. Max 115 words.",
    maxTokens: 1000,
  },
  marketOverview: {
    prompt:
      "Analyze only the market overview: category definition, maturity, growth drivers, buyer behavior, adoption barriers, demand signals, and timing. Do not repeat TAM/SAM/SOM numbers, competitor mapping, customer pain points, or entry strategy. Use polished investor memo prose without internal evidence or confidence labels. Do not write a heading. Max 165 words.",
    maxTokens: 1800,
  },
  tamSamSom: {
    prompt:
      "Estimate only TAM, SAM, and SOM using concise, readable sizing logic. State the market boundary, reachable segment, obtainable wedge, and one validation input needed. Keep it easy to scan: three compact lines plus one short interpretation. Do not repeat competitor analysis, customer pain, trends, or entry strategy. Do not invent precision or use internal confidence labels. Do not write a heading. Max 130 words.",
    maxTokens: 1400,
  },
  industryTrends: {
    prompt:
      "Identify only industry trends that matter for investment timing: technology shifts, buyer behavior changes, regulatory or macro forces, recent news, budget movement, and adoption inflection points. Do not repeat market overview, TAM, competitors, or entry plan. Do not write a heading. Max 145 words.",
    maxTokens: 1200,
  },
  targetCustomer: {
    prompt:
      "Describe only target customer / ICP: early adopters, buyer/user roles, budget holders, buying motivations, adoption barriers, urgency, willingness to pay, and best initial beachhead. Do not repeat customer pain details, TAM, pricing, or entry tactics. Do not write a heading. Max 145 words.",
    maxTokens: 1000,
  },
  competitorAnalysis: {
    prompt:
      "Analyze only competitors and substitutes. For each important competitor or substitute include available pricing, target customer, funding, employee size, strengths, weaknesses, positioning, and how the analyzed company can outperform. Omit unknown fields rather than inventing them. Include incumbent alternatives, switching barriers, pricing signals, likely response, and entrant gap. End with AI Executive Insight explaining the competitive decision implication. Do not repeat SWOT, threats, market overview, or entry strategy. Do not write a heading. Max 220 words.",
    maxTokens: 1400,
  },
  customerPainPoints: {
    prompt:
      "List only customer pain points: current workarounds, economic cost, switching triggers, urgency level, and interview evidence needed to confirm demand. Do not repeat ICP, solution, competitors, or GTM. Do not write a heading. Max 135 words.",
    maxTokens: 1000,
  },
  opportunities: {
    prompt:
      "Identify only market opportunities: underserved segments, channel openings, pricing gaps, partnership angles, product wedges, regulatory/timing advantages, and why incumbents may not address them. Include a compact Market Opportunity Score with Demand Score, Competition Score, Timing Score, Execution Difficulty, Revenue Potential, overall Opportunity Score 0-100, and one-line calculation explanation. Each opportunity must include the founder implication or validation action. End with AI Executive Insight explaining why the opportunity changes priority. Do not repeat SWOT, entry strategy, or competitor analysis. Do not write a heading. Max 190 words.",
    maxTokens: 1000,
  },
  threats: {
    prompt:
      "Identify only market threats as a professional Risk Matrix. Each material threat must include Probability, Impact, Severity, Mitigation, and Early Warning Signal. Cover competitive pressure, demand uncertainty, switching costs, regulation, platform dependency, price compression, trust barriers, data access, and distribution risk. End with AI Executive Insight explaining which risk should change the entry plan first. Do not repeat SWOT or Executive Recommendation. Do not write a heading. Max 205 words.",
    maxTokens: 1000,
  },
  swotAnalysis: {
    prompt:
      "Create SWOT with exactly four labeled groups: Strengths, Weaknesses, Opportunities, Threats. Use 2-4 distinct bullets per group. Strengths and Weaknesses must focus on internal market-entry position; Opportunities and Threats must be external but must not repeat Opportunities, Threats, Competitor Analysis, or Executive Summary. Each bullet must state why it matters for market entry. Do not write a heading. Max 145 words.",
    maxTokens: 1300,
  },
  portersFiveForces: {
    prompt:
      "Analyze only Porter's Five Forces with a qualitative rating and one founder implication for rivalry, new entrants, buyer power, supplier/platform power, and substitutes. Do not repeat SWOT, threats, or competitor descriptions. Do not write a heading. Max 160 words.",
    maxTokens: 1400,
  },
  unitEconomics: {
    prompt:
      "Analyze only Unit Economics implied by the market as a compact explainable table. Include likely ARPA/ACV, gross margin, CAC, LTV, payback period, retention/churn planning inputs, and the one input that most affects viability. For each key metric show value, formula, planning input, evidence strength, and reference basis in compressed professional language. Use numbers and ranges only where defensible; avoid product, market, or GTM prose. Do not write a heading. Max 140 words.",
    maxTokens: 1200,
  },
  financialDashboard: {
    prompt:
      "Create only high-level market-derived financial KPI cards. Use compact lines for ARR, MRR, Revenue, Expenses, Gross Margin, CAC, LTV, Payback Period, Burn Rate, Runway, EBITDA, Break-even Month, and Investment Needed. Each line must include value plus tiny formula, planning-input, evidence-strength, and reference-basis cues. Summarize CAC/LTV/payback if already covered by Unit Economics; do not explain again. No generic commentary or internal labels. Do not write a heading. Max 145 words.",
    maxTokens: 1300,
  },
  scenarioAnalysis: {
    prompt:
      "Create only future scenarios with three distinct cases: Worst Case, Base Case, and Best Case. For each case include demand signal, pricing/MRR implication, CAC/payback implication, burn/runway implication, market risk, and founder decision. Do not reuse the same text across cases. Do not repeat Financial Dashboard or Executive Recommendation wording. Do not write a heading. Max 170 words.",
    maxTokens: 1200,
  },
  kpiDashboard: {
    prompt:
      "Create only market validation operating metrics. Include demand, conversion, willingness to pay, sales cycle, channel CAC, retention intent, competitor displacement, market pull, and target/warning thresholds. Add Executive KPIs with Market Readiness, Product Readiness, Go-To-Market Readiness, Investor Readiness, Scalability, and AI Readiness, each with a score and one-line explanation. Do not repeat Unit Economics or Validation Plan except as a concise threshold. Do not write a heading. Max 185 words.",
    maxTokens: 1000,
  },
  executiveRecommendation: {
    prompt:
      "Write only final investment decision in investment-committee language. Include selected decision, the single key reason, biggest risks, and next concrete action. Replace any single conviction score with AI Confidence Breakdown: Market Confidence, Competition Confidence, Financial Confidence, Execution Confidence, Product Confidence, each with weighted explanation. Add Founder Decision Engine answering: If I were the founder, what would I do first, postpone, spend money on, and absolutely avoid? Select exactly one visible option and no second option: Proceed, Hold for validation, or Decline. Do not use internal recommendation codes or internal scoring terminology. Do not restate market overview, SWOT, entry plan, or financial dashboard. Do not write a heading. Max 210 words.",
    maxTokens: 850,
  },
  entryStrategy: {
    prompt:
      "Recommend only market entry strategy: beachhead segment, positioning, first channel, initial offer, pricing/pilot approach, credibility assets, expansion wedge, and decision gates. Do not repeat validation plan, target customer definition, or competitor analysis. Do not write a heading. Max 155 words.",
    maxTokens: 1300,
  },
  validationPlan: {
    prompt:
      "Write only the first 30-45 day validation plan. Include customer interviews, competitor research, pricing tests, concierge MVP or landing page test, success criteria, kill/pivot signals, and the decision each test informs. Do not repeat roadmap or KPI dashboard wording. Do not write a heading. Max 155 words.",
    maxTokens: 1300,
  },
  keyMetrics: {
    prompt:
      "Define only key market validation metrics an investor would monitor: demand, conversion, willingness to pay, sales cycle, retention intent, CAC/channel cost, competitor displacement, and market pull signals. Include decision thresholds only. Do not repeat KPI Dashboard explanations. Do not write a heading. Max 125 words.",
    maxTokens: 900,
  },
  founderRoadmap: {
    prompt:
      "Create only the AI Action Plan with Immediate Actions, Next 30 Days, Next 90 Days, Next 6 Months, and Next 12 Months. Each step must depend on the prior market proof point, decision gate, and expected business impact. Include only execution actions for market validation, competitive learning, pricing proof, and entry readiness. Do not repeat validation plan or KPI thresholds. Do not write a heading. Max 205 words.",
    maxTokens: 1200,
  },
  sourcesAssumptions: {
    prompt:
      "List only verified sources, evidence basis, planning inputs, and missing validation data. Do not repeat market or financial analysis. Prefer real organizations over generic references, especially OECD, World Bank, IMF, Eurostat, TÜİK, TCMB, Statista, McKinsey, BCG, Deloitte, PwC, EY, KPMG, CB Insights, PitchBook, or Crunchbase when genuinely relevant. For each verified source include publisher, confidence, publication year, source type, and URL only when available. If no verified source metadata exists, omit the citation item and write a concise planning-input note instead. Do not invent URLs, report names, publications, or fake citations. If uncertain, mark the item as a planning input instead of fabricating a citation. Do not write vague source claims such as 'industry reports' unless a specific source is named. Do not write a heading. Max 190 words.",
    maxTokens: 1300,
  },
  sources: {
    prompt:
      "List only 4-6 reliable verified sources used or most relevant for validating this market, then close the report with CEO Brief. Prefer real organizations over generic references, especially OECD, World Bank, IMF, Eurostat, TÜİK, TCMB, Statista, McKinsey, BCG, Deloitte, PwC, EY, KPMG, CB Insights, PitchBook, or Crunchbase when genuinely relevant. For each verified source include publisher, confidence, publication year, source type, and URL only when available. If no verified source metadata exists, omit the citation item and write a concise planning-input note instead. Do not invent URLs, report names, publications, or fake citations. End with CEO Brief containing top 5 priorities, top 3 mistakes to avoid, biggest opportunity, biggest hidden risk, and one-sentence executive conclusion. Do not use generic phrases such as 'industry reports' as verified evidence. Do not repeat analysis outside CEO Brief. Do not write a heading.",
    maxTokens: 1400,
  },
} as const;

const reportFields = [
  "executiveSummary",
  "marketOverview",
  "tamSamSom",
  "industryTrends",
  "targetCustomer",
  "competitorAnalysis",
  "customerPainPoints",
  "opportunities",
  "threats",
  "swotAnalysis",
  "portersFiveForces",
  "unitEconomics",
  "financialDashboard",
  "scenarioAnalysis",
  "kpiDashboard",
  "executiveRecommendation",
  "entryStrategy",
  "validationPlan",
  "keyMetrics",
  "founderRoadmap",
  "sourcesAssumptions",
  "sources",
] as const;

type MarketReportField = (typeof reportFields)[number];
const FULL_REPORT_FIELD = "fullReport";
const MAX_AI_CALLS_PER_MARKET_REPORT = 1;

type MarketReportChunk = Partial<Record<MarketReportField, string>>;
type MarketReportWarningChunk = {
  warning: string;
  missingFields?: MarketReportField[];
  invalidFields?: MarketReportField[];
  partial?: boolean;
};

const fieldLabels: Record<MarketReportField, string> = {
  executiveSummary: "Executive Summary",
  marketOverview: "Market Overview",
  tamSamSom: "TAM / SAM / SOM",
  industryTrends: "Industry Trends",
  targetCustomer: "Target Customer",
  competitorAnalysis: "Competitor Analysis",
  customerPainPoints: "Customer Pain Points",
  opportunities: "Opportunities",
  threats: "Threats",
  swotAnalysis: "SWOT Analysis",
  portersFiveForces: "Porter's Five Forces",
  unitEconomics: "Unit Economics",
  financialDashboard: "Financial Dashboard",
  scenarioAnalysis: "Scenario Analysis: Worst / Base / Best Case",
  kpiDashboard: "KPI Dashboard",
  executiveRecommendation: "Executive Recommendation",
  entryStrategy: "Entry Strategy",
  validationPlan: "Validation Plan",
  keyMetrics: "Key Metrics",
  founderRoadmap: "Founder Roadmap",
  sourcesAssumptions: "Sources / Assumptions",
  sources: "Sources",
};

const legacySectionToField: Record<string, string> = {
  "Executive Summary": "executiveSummary",
  "Market Analysis": "marketOverview",
  "Market Overview": "marketOverview",
  "TAM / SAM / SOM": "tamSamSom",
  "Industry Trends": "industryTrends",
  "Target Audience": "targetCustomer",
  "Target Customer": "targetCustomer",
  "Competitor Analysis": "competitorAnalysis",
  "Customer Pain Points": "customerPainPoints",
  Opportunities: "opportunities",
  Threats: "threats",
  "SWOT Analysis": "swotAnalysis",
  "Porter's Five Forces": "portersFiveForces",
  "Unit Economics": "unitEconomics",
  "Financial Dashboard": "financialDashboard",
  "Scenario Analysis: Worst / Base / Best Case": "scenarioAnalysis",
  "KPI Dashboard": "kpiDashboard",
  "Executive Recommendation": "executiveRecommendation",
  "Entry Strategy": "entryStrategy",
  "Validation Plan": "validationPlan",
  "Key Metrics": "keyMetrics",
  "Founder Roadmap": "founderRoadmap",
  "Sources / Assumptions": "sourcesAssumptions",
  Sources: "sources",
};

type ResponseLanguage = "English" | "Turkish";

const fieldLabelsByLanguage: Record<
  ResponseLanguage,
  Record<MarketReportField, string>
> = {
  English: fieldLabels,
  Turkish: fieldLabels,
};

const marketReportTermReplacements: Array<[RegExp, string]> = [
  [/\bLow[\s-]+Confidence\b/gi, "Directional"],
  [/\bMedium[\s-]+Confidence\b/gi, "Developing"],
  [/\bHigh[\s-]+Confidence\b/gi, "Verified"],
  [/\bEarly evidence\b/gi, "Directional"],
  [/\bDeveloping evidence\b/gi, "Developing"],
  [/\bStrong evidence\b/gi, "Verified"],
  [/\bSector view\b/gi, "Market view"],
  [/\bIndustry[\s-]+Estimate\b/gi, "Market view"],
  [/\bAI[\s-]+Assumptions?\b/gi, "Planning inputs"],
  [/\bBenchmarks?\b/gi, "Market references"],
  [/\bAssumptions?\b/gi, "Planning inputs"],
  [/\bSource unavailable\b/gi, ""],
  [/\bConfidence unavailable\b/gi, ""],
  [/\bTBD\b/gi, ""],
  [/\bPlaceholder\b/gi, ""],
  [/\bUnknown\b/gi, ""],
  [/\bUnavailable\b/gi, ""],
  [/Yeni analiz\s+geçişi gerekir\.?/gi, ""],
  [/requires a fresh\s+analysis pass\.?/gi, ""],
  [/Section missing\.?/gi, ""],
  [/\bFailed\b/gi, ""],
  [/\bWAIT\b/g, "Hold for validation"],
];

function sanitizeMarketReportContent(value: string) {
  const sanitized = marketReportTermReplacements.reduce(
    (content, [pattern, replacement]) => content.replace(pattern, replacement),
    sanitizeAiResponseText(value)
  );

  return normalizePdfText(sanitized)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function detectLanguage(value: string): ResponseLanguage {
  const normalized = value.toLowerCase();
  const turkishSignals = [
    /[çğıöşü]/i,
    /\b(ve|bir|için|ile|ama|fakat|iş|hedef|müşteri|pazar|gelir|strateji|istiyorum|yap|kurmak|deneme|merhaba|selam|evet|hayır|lutfen|lütfen)\b/i,
  ];

  return turkishSignals.some((signal) => signal.test(normalized)) ? "Turkish" : "English";
}

function normalizeLanguage(value: unknown, prompt: string): ResponseLanguage {
  return value === "Turkish" || value === "English" ? value : detectLanguage(prompt);
}

function isMarketReportField(value: string | undefined): value is MarketReportField {
  return reportFields.includes(value as MarketReportField);
}

function createReportChunk(field: MarketReportField, content: string): MarketReportChunk {
  return { [field]: content };
}

function serializeReportChunk(field: MarketReportField, content: string) {
  return `${JSON.stringify(createReportChunk(field, sanitizeMarketReportContent(content)))}\n`;
}

function serializeWarningChunk(warning: MarketReportWarningChunk) {
  return `${JSON.stringify(warning)}\n`;
}

function serializeMarketReportChunks(report: Record<MarketReportField, string>) {
  return reportFields
    .filter((field) => report[field]?.trim())
    .map((field) => serializeReportChunk(field, report[field]))
    .join("");
}

function createFallbackMarketReport() {
  return Object.fromEntries(
    reportFields.map((field) => [field, ""])
  ) as Record<MarketReportField, string>;
}

function createMockMarketReport(prompt: string, language: ResponseLanguage) {
  const labels = fieldLabelsByLanguage[language];

  return Object.fromEntries(
    reportFields.map((field, index) => [
      field,
      [
        `${labels[field]} mock output for "${prompt}".`,
        "AI_TEST_MODE is enabled, so this deterministic market section was generated without calling OpenAI or web search.",
        `Mock validation marker: market-analysis-${String(index + 1).padStart(2, "0")}.`,
      ].join(" "),
    ])
  ) as Record<MarketReportField, string>;
}

function createFullReportJsonSchema(name: string, fields: readonly string[]) {
  return {
    type: "json_schema" as const,
    name,
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        fields.map((field) => [
          field,
          {
            type: "string",
            minLength: 1,
          },
        ])
      ),
      required: [...fields],
    },
  };
}

function hasMeaningfulSwotGroup(content: string, label: string) {
  const groupMatch = content.match(
    new RegExp(
      `${label}\\s*[:\\-–—]?\\s*([\\s\\S]*?)(?=\\n\\s*(?:Strengths|Weaknesses|Opportunities|Threats)\\s*[:\\-–—]?|$)`,
      "i"
    )
  );
  const groupContent = sanitizeMarketReportContent(groupMatch?.[1] || "");

  return groupContent
    .split(/\n|•|-/)
    .map((item) => item.trim())
    .filter((item) => item.length > 18).length > 0;
}

function formatBulletGroup(label: string, items: string[]) {
  const bullets = items
    .map((item) => sanitizeMarketReportContent(item).replace(/^[-*•]\s*/, ""))
    .filter((item) => item.length > 8)
    .slice(0, 3);

  return `${label}:\n${bullets.map((item) => `- ${item}`).join("\n")}`;
}

function extractFallbackBullets(content: string, fallback: string) {
  const bullets = sanitizeMarketReportContent(content)
    .split(/\n|•|-/)
    .map((item) => item.trim())
    .filter((item) => item.length > 24 && !/^(opportunities|threats|strengths|weaknesses)$/i.test(item))
    .slice(0, 3);

  return bullets.length ? bullets : [fallback];
}

function buildCanonicalSwotSection(
  report: Record<MarketReportField, string>,
  context: AiFinancialModelContext
) {
  const strengths = context.investmentScore.strengths.length
    ? context.investmentScore.strengths
    : [
        `${context.inputs.industry} model has a focused market-entry thesis and ${context.metrics.grossMargin.displayValue} gross-margin planning input.`,
      ];
  const weaknesses = context.investmentScore.weaknesses.length
    ? context.investmentScore.weaknesses
    : [
        `Primary validation is still required for ${context.inputs.targetCustomer}, pricing, and repeatable acquisition.`,
      ];
  const opportunities = extractFallbackBullets(
    report.opportunities,
    `${context.metrics.sam.displayValue} serviceable market gives the founder a focused beachhead to validate before expanding.`
  );
  const threats = context.investmentScore.topRisks.length
    ? context.investmentScore.topRisks
    : extractFallbackBullets(
        report.threats,
        "Competitive response, acquisition cost inflation, and weak retention could reduce investability."
      );

  return [
    formatBulletGroup("Strengths", strengths),
    formatBulletGroup("Weaknesses", weaknesses),
    formatBulletGroup("Opportunities", opportunities),
    formatBulletGroup("Threats", threats),
  ].join("\n\n");
}

function scorePercent(score: number, maximumScore: number) {
  return maximumScore > 0 ? Math.round((score / maximumScore) * 100) : 0;
}

function appendIntelligenceBlock(content: string, title: string, lines: string[]) {
  const cleanLines = lines.map((line) => sanitizeMarketReportContent(line).trim()).filter(Boolean);

  if (!cleanLines.length || new RegExp(`\\b${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(content)) {
    return content;
  }

  return sanitizeMarketReportContent(`${content.trim()}\n\n${title}:\n${cleanLines.join("\n")}`);
}

function buildMarketExecutiveInsight(context: AiFinancialModelContext, focus: string) {
  return `AI Executive Insight: ${focus} matters because the founder should validate ${context.investmentScore.nextCriticalAction.toLowerCase()} before committing spend against the ${context.metrics.som.displayValue} obtainable market and ${context.metrics.cacPayback.displayValue} payback assumption.`;
}

function buildMarketOpportunityScore(context: AiFinancialModelContext) {
  const engine = context.investmentScore.decisionEngine;
  const demand = scorePercent(engine.marketScore.score, engine.marketScore.maximumScore);
  const competition = scorePercent(engine.competitionScore.score, engine.competitionScore.maximumScore);
  const timing = Math.round((demand + scorePercent(engine.technologyScore.score, engine.technologyScore.maximumScore)) / 2);
  const executionDifficulty = 100 - scorePercent(engine.executionScore.score, engine.executionScore.maximumScore);
  const revenuePotential = scorePercent(engine.financialScore.score, engine.financialScore.maximumScore);
  const overall = Math.round(
    demand * 0.25 +
      competition * 0.15 +
      timing * 0.2 +
      (100 - executionDifficulty) * 0.2 +
      revenuePotential * 0.2
  );

  return [
    `- Demand Score: ${demand}/100`,
    `- Competition Score: ${competition}/100`,
    `- Timing Score: ${timing}/100`,
    `- Execution Difficulty: ${executionDifficulty}/100`,
    `- Revenue Potential: ${revenuePotential}/100`,
    `- Overall Opportunity Score: ${overall}/100 — weighted by demand 25%, competition 15%, timing 20%, execution feasibility 20%, and revenue potential 20%.`,
  ];
}

function buildMarketConfidenceBreakdown(context: AiFinancialModelContext) {
  const engine = context.investmentScore.decisionEngine;
  const market = scorePercent(engine.marketScore.score, engine.marketScore.maximumScore);
  const competition = scorePercent(engine.competitionScore.score, engine.competitionScore.maximumScore);
  const financial = scorePercent(engine.financialScore.score, engine.financialScore.maximumScore);
  const execution = scorePercent(engine.executionScore.score, engine.executionScore.maximumScore);
  const product = scorePercent(engine.technologyScore.score, engine.technologyScore.maximumScore);
  const weighted = Math.round(
    market * 0.25 +
      competition * 0.15 +
      financial * 0.25 +
      execution * 0.2 +
      product * 0.15
  );

  return [
    `- Market Confidence: ${market}% × 25% weight — ${engine.marketScore.explanation}`,
    `- Competition Confidence: ${competition}% × 15% weight — ${engine.competitionScore.explanation}`,
    `- Financial Confidence: ${financial}% × 25% weight — ${engine.financialScore.explanation}`,
    `- Execution Confidence: ${execution}% × 20% weight — ${engine.executionScore.explanation}`,
    `- Product Confidence: ${product}% × 15% weight — technology/product readiness affects differentiation and defensibility.`,
    `- Weighted Confidence: ${weighted}% — weighted toward market proof and financial viability because they drive the entry decision.`,
  ];
}

function buildMarketRiskMatrix(context: AiFinancialModelContext) {
  const risks = context.investmentScore.topRisks.length
    ? context.investmentScore.topRisks
    : ["Demand validation risk", "Competitive response risk", "CAC and payback risk"];

  return risks.slice(0, 4).map((risk, index) => {
    const probability = index === 0 ? "High" : "Medium";
    const impact = index <= 1 ? "High" : "Medium";
    const severity = probability === "High" && impact === "High" ? "Critical" : "Material";

    return `- ${risk} | Probability: ${probability} | Impact: ${impact} | Severity: ${severity} | Mitigation: validate the market signal before scaling entry spend | Early Warning Signal: conversion, pricing, or CAC misses the threshold.`;
  });
}

function buildMarketFounderDecisionEngine(context: AiFinancialModelContext) {
  return [
    `- If I were the founder: I would first validate ${context.investmentScore.nextCriticalAction.toLowerCase()}.`,
    "- What to postpone: broad geographic expansion and multi-channel acquisition until the beachhead proof is repeatable.",
    `- Where to spend money: customer interviews, pricing tests, competitor displacement tests, and the smallest launch asset that proves ${context.metrics.som.displayValue} obtainable demand.`,
    "- What to avoid: treating category growth as proof of obtainable revenue before willingness-to-pay evidence exists.",
  ];
}

function buildMarketExecutiveKpis(context: AiFinancialModelContext) {
  const engine = context.investmentScore.decisionEngine;

  return [
    `- Market Readiness: ${scorePercent(engine.marketScore.score, engine.marketScore.maximumScore)}/100 — ${engine.marketScore.explanation}`,
    `- Product Readiness: ${scorePercent(engine.technologyScore.score, engine.technologyScore.maximumScore)}/100 — readiness depends on differentiated value and early user proof.`,
    `- Go-To-Market Readiness: ${scorePercent(engine.executionScore.score, engine.executionScore.maximumScore)}/100 — readiness depends on channel CAC and repeatable sales learning.`,
    `- Investor Readiness: ${context.investmentScore.confidence}/100 — confidence reflects evidence quality across market, economics, and execution.`,
    `- Scalability: ${scorePercent(engine.financialScore.score, engine.financialScore.maximumScore)}/100 — scalability depends on ${context.metrics.grossMargin.displayValue} gross margin and ${context.metrics.cacPayback.displayValue} payback.`,
    `- AI Readiness: ${scorePercent(engine.technologyScore.score, engine.technologyScore.maximumScore)}/100 — AI readiness matters only if it improves differentiation, cost, or speed.`,
  ];
}

function buildMarketCeoBrief(context: AiFinancialModelContext) {
  return [
    "Top 5 priorities:",
    `- ${context.investmentScore.nextCriticalAction}`,
    `- Validate the beachhead customer for ${context.inputs.targetCustomer}.`,
    `- Prove willingness to pay before assuming ${context.metrics.som.displayValue} obtainable demand.`,
    `- Keep payback at or below ${context.metrics.cacPayback.displayValue}.`,
    "- Build one repeatable channel before expanding the entry plan.",
    "Top 3 mistakes to avoid:",
    "- Confusing broad market growth with reachable demand.",
    "- Underestimating incumbent/substitute response.",
    "- Scaling acquisition before pricing and conversion are proven.",
    `Biggest opportunity: Use a narrow entry wedge to capture the first credible share of ${context.metrics.som.displayValue}.`,
    `Biggest hidden risk: ${context.investmentScore.topRisks[0] || "The market may look attractive before buyer urgency is proven."}`,
    `One-sentence executive conclusion: ${context.investmentScore.recommendation} should depend on whether the founder proves the riskiest market-entry assumption before scaling capital.`,
  ];
}

function ensureMetricLine(content: string, label: string, value: string, detail: string) {
  const normalizedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linePattern = new RegExp(`\\b${normalizedLabel}\\s*[:\\-–—]\\s*(?:—|-|–|\\s*)(?=\\s|$)`, "i");

  if (linePattern.test(content)) {
    return content.replace(linePattern, `${label}: ${value}`);
  }

  if (new RegExp(`\\b${normalizedLabel}\\s*[:\\-–—]`, "i").test(content)) {
    return content;
  }

  return `${content.trim()}\n- ${label}: ${value} — ${detail}`.trim();
}

function ensureMarketReportQuality(
  report: Record<MarketReportField, string>,
  context?: AiFinancialModelContext
) {
  const normalized = { ...report };

  for (const field of reportFields) {
    normalized[field] = sanitizeMarketReportContent(normalized[field] || "");
  }

  if (!context) {
    return normalized;
  }

  const model = context.metrics;

  normalized.tamSamSom = sanitizeMarketReportContent(
    [
      `TAM: ${model.tam.displayValue}`,
      `SAM: ${model.sam.displayValue}`,
      `SOM: ${model.som.displayValue}`,
      normalized.tamSamSom,
    ]
      .filter(Boolean)
      .join("\n")
  );
  normalized.tamSamSom = appendIntelligenceBlock(
    normalized.tamSamSom,
    "AI Executive Insight",
    [buildMarketExecutiveInsight(context, "Market sizing")]
  );
  normalized.opportunities = appendIntelligenceBlock(
    normalized.opportunities,
    "Market Opportunity Score",
    buildMarketOpportunityScore(context)
  );
  normalized.competitorAnalysis = appendIntelligenceBlock(
    normalized.competitorAnalysis,
    "AI Executive Insight",
    [buildMarketExecutiveInsight(context, "Competitive position")]
  );

  for (const field of ["unitEconomics", "financialDashboard", "kpiDashboard"] as const) {
    normalized[field] = sanitizeMarketReportContent(
      ensureMetricLine(
        normalized[field],
        "Gross Margin",
        model.grossMargin.displayValue,
        `${model.grossMargin.formula}; ${model.grossMargin.benchmarkComparison.toLowerCase()}.`
      )
    );
  }

  const confidence = context.investmentScore.confidence;
  const confidenceLabel =
    confidence >= 75 ? "high" : confidence >= 55 ? "moderate" : "low";

  normalized.executiveRecommendation = sanitizeMarketReportContent(
    ensureMetricLine(
      normalized.executiveRecommendation,
      "Conviction",
      `${confidence}%`,
      `This is a ${confidenceLabel}-conviction recommendation based on the same market, financial, and execution model.`
    )
  );
  normalized.executiveRecommendation = appendIntelligenceBlock(
    normalized.executiveRecommendation,
    "AI Confidence Breakdown",
    buildMarketConfidenceBreakdown(context)
  );
  normalized.executiveRecommendation = appendIntelligenceBlock(
    normalized.executiveRecommendation,
    "Founder Decision Engine",
    buildMarketFounderDecisionEngine(context)
  );
  normalized.threats = appendIntelligenceBlock(
    normalized.threats,
    "Risk Matrix",
    buildMarketRiskMatrix(context)
  );
  normalized.kpiDashboard = appendIntelligenceBlock(
    normalized.kpiDashboard,
    "Executive KPIs",
    buildMarketExecutiveKpis(context)
  );
  normalized.founderRoadmap = appendIntelligenceBlock(
    normalized.founderRoadmap,
    "AI Action Plan",
    [
      `- Immediate Actions: ${context.investmentScore.nextCriticalAction}. Expected impact: resolves the highest-risk market-entry decision.`,
      "- Next 30 Days: validate demand, pricing, and buyer urgency. Expected impact: separates real pull from generic interest.",
      "- Next 90 Days: prove one repeatable channel and competitor displacement signal. Expected impact: improves GTM confidence.",
      "- Next 6 Months: confirm retention intent, payback, and operating cadence. Expected impact: protects capital efficiency.",
      "- Next 12 Months: expand only after the entry wedge is repeatable. Expected impact: scales from evidence, not narrative.",
    ]
  );
  normalized.sources = appendIntelligenceBlock(
    normalized.sources,
    "CEO Brief",
    buildMarketCeoBrief(context)
  );

  if (
    !hasMeaningfulSwotGroup(normalized.swotAnalysis, "Strengths") ||
    !hasMeaningfulSwotGroup(normalized.swotAnalysis, "Weaknesses") ||
    !hasMeaningfulSwotGroup(normalized.swotAnalysis, "Opportunities") ||
    !hasMeaningfulSwotGroup(normalized.swotAnalysis, "Threats")
  ) {
    normalized.swotAnalysis = sanitizeMarketReportContent(
      buildCanonicalSwotSection(normalized, context)
    );
  }

  return normalized;
}

function parseFullMarketReport(
  value: string,
  context?: AiFinancialModelContext
): {
  report: Record<MarketReportField, string>;
  missingFields: MarketReportField[];
  invalidFields: MarketReportField[];
} {
  const parsed = JSON.parse(value) as Record<string, unknown>;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Report generation failed before every section completed.");
  }

  const report = {} as Record<MarketReportField, string>;
  const missingFields: MarketReportField[] = [];
  const invalidFields: MarketReportField[] = [];

  for (const field of reportFields) {
    const content = parsed[field];

    if (typeof content !== "string" || !content.trim()) {
      missingFields.push(field);
      report[field] = "";
      continue;
    }

    if (isReportGenerationFailureText(content)) {
      invalidFields.push(field);
      report[field] = "";
      continue;
    }

    report[field] = sanitizeMarketReportContent(content.trim());
  }

  return {
    report: ensureMarketReportQuality(report, context),
    missingFields,
    invalidFields,
  };
}

async function countAiCallsForReport({
  supabase,
  userId,
  reportRequestId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  reportRequestId: string;
}) {
  if (!reportRequestId) {
    return 0;
  }

  const { count, error } = await supabase
    .from("ai_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("metadata->>report_request_id", reportRequestId)
    .eq("metadata->>actual_ai_call", "true");

  if (error) {
    console.error("[api:market-analysis] Could not verify AI call budget", {
      reportRequestId,
      error: error.message,
    });

    return 0;
  }

  return count ?? 0;
}

const TEXT_LIKE_RESPONSE_FIELD_PATTERN =
  /^(output_text|text|value|content|message|response|answer|summary)$/i;

const NON_CONTENT_RESPONSE_FIELD_PATTERN =
  /^(id|object|type|status|role|model|created|created_at|updated_at|usage|metadata|annotations|finish_reason|index|incomplete_details)$/i;

function extractTextFromValue(
  value: unknown,
  parentKey = "",
  seen: WeakSet<object> = new WeakSet()
): string {
  if (typeof value === "string") {
    return !parentKey || TEXT_LIKE_RESPONSE_FIELD_PATTERN.test(parentKey) ? value : "";
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  if (seen.has(value)) {
    return "";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextFromValue(item, parentKey, seen))
      .filter(Boolean)
      .join("");
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  const candidateKeys =
    type === "output_text"
      ? ["text", "value", "content", "message"]
      : [
          "output_text",
          "text",
          "value",
          "content",
          "message",
          "response",
          "answer",
          "summary",
        ];

  for (const key of candidateKeys) {
    const extracted = extractTextFromValue(record[key], key, seen);

    if (extracted.trim()) {
      return extracted;
    }
  }

  for (const [key, item] of Object.entries(record)) {
    if (candidateKeys.includes(key) || NON_CONTENT_RESPONSE_FIELD_PATTERN.test(key)) {
      continue;
    }

    const extracted = extractTextFromValue(item, key, seen);

    if (extracted.trim()) {
      return extracted;
    }
  }

  return "";
}

function extractResponseText(response: unknown) {
  if (!response || typeof response !== "object") {
    return "";
  }

  const record = response as Record<string, unknown>;

  if (record.output_parsed) {
    return JSON.stringify(record.output_parsed);
  }

  const directText = extractTextFromValue(record.output_text);

  if (directText.trim()) {
    return directText;
  }

  const outputText = extractTextFromValue(record.output);

  return outputText.trim() ? outputText : "";
}

function buildLanguageInstructions(language: ResponseLanguage) {
  return [
    "You are the ZERINIX Market Intelligence Report Engine.",
    "Write like a McKinsey / BCG / Bain strategy partner and Sequoia-style market diligence analyst.",
    `Respond entirely in ${language}.`,
    `Every heading, paragraph, bullet point, table label, markdown label, source note, and sentence must be in ${language}.`,
    `If source material is in another language, summarize it only in ${language}.`,
    "Do not switch languages. Do not ask questions or request clarification.",
    "Be current, analytical, evidence-weighted, and decision-oriented for an early-stage founder.",
    "Generate a dedicated market analysis, not a business plan.",
    "The user's exact submitted market/business idea is the anchor for the whole report. Every section must name or clearly reference that idea through industry-specific competitors, customer segments, market trends, risks, planning inputs, and validation actions rather than reusable template paragraphs.",
    "Prioritize market overview, TAM/SAM/SOM, industry trends, competitors, gap analysis, customer pain, opportunities, threats, SWOT, Porter's Five Forces, entry strategy, validation, metrics, sources, and an investment-style verdict.",
    "Write in polished investment memo prose. Do not attach internal evidence tags, confidence tiers, market-source labels, or decision-implication labels to paragraphs.",
    "Avoid repeated label patterns. Prefer concise analyst prose with natural language about evidence strength only when uncertainty changes the decision.",
    "Do not use generic AI phrases such as 'It is important to', 'Businesses should', 'This strategy can help', 'In today's market', or 'By leveraging'.",
    "Write like an executive consulting memo: short analytical paragraphs, numbered insights where useful, concrete observations, and no filler conclusions.",
    "Do not repeat the user's prompt verbatim. Refer to the opportunity through specific market context, customer segment, competitor set, or economic driver.",
    "Every section must contain at least one concrete business insight that changes sizing, timing, positioning, pricing, distribution, risk, or validation priorities.",
    "Prefer specific observed market dynamics over generic advice. If evidence is limited, state the decision-relevant uncertainty without sounding like an AI disclaimer.",
    "For every major analytical statement, use consulting reasoning: claim first, then reason or supporting context, then the business implication for the founder.",
    "Every major section must answer: what is happening, why it is happening, and why it matters for the founder.",
    "Prefer causal reasoning over description. Avoid unsupported claims; if support is weak, frame the statement as a decision hypothesis to validate.",
    "Each report section must contribute a unique market diligence job. Do not restate conclusions, paragraphs, metrics, or examples already assigned to another section.",
    "Respect strict section ownership: Executive Summary = market verdict only; Market Overview = category and demand context only; TAM/SAM/SOM = market sizing only; Industry Trends = timing forces only; Target Customer = ICP only; Competitor Analysis = competitors only; Customer Pain Points = pain only; Opportunities and Threats = distinct market openings/risks only; SWOT = non-duplicative matrix only; Porter's Five Forces = industry forces only; Unit Economics = unit metrics only; Financial Dashboard = high-level KPIs only; Scenario Analysis = future scenarios only; KPI Dashboard/Key Metrics = operating validation metrics only; Executive Recommendation = final investment decision only; Entry Strategy = market entry only; Validation Plan = tests only; Founder Roadmap = execution sequence only; Sources / Assumptions and Sources = sources only.",
    "Never repeat the same metric more than once unless necessary. If a metric appears in Unit Economics, later financial sections may summarize it but must not explain it again.",
    "Use one consistent financial planning-input set across Unit Economics, Financial Dashboard, Scenario Analysis, and Executive Recommendation. Reuse exact ASP, MRR, CAC, LTV, payback, burn, runway, and investment values unless explicitly updating the scenario.",
    "The Data-Driven Financial Analysis Engine block in the user input contains the calculated base-case financial model. Use those values as the source of truth.",
    "The Investment Scoring Engine block in the user input contains the calculated investment score, internal recommendation, estimated valuation, funding stage, decision scores, strengths, weaknesses, top risks, and next critical action. Use those values as the source of truth, but translate the visible decision into Proceed, Hold for validation, or Decline.",
    "Unit Economics, KPI Dashboard, Financial Dashboard, Scenario Analysis, Financial Assumptions, and Executive Recommendation must reference the same calculated financial model whenever financial metrics appear.",
    "For ARR, MRR, CAC, LTV, Gross Margin, Burn, Runway, EBITDA, and Break-even, financial sections must show value, formula, planning input, evidence strength, and reference basis without internal labels.",
    "Do not expose internal grading labels, source-model labels, or internal recommendation codes anywhere in the final report.",
    "Make reasoning deeply industry-specific for SaaS, AI, Cybersecurity, Healthcare, Logistics, Restaurant, Drone, Marketplace, FinTech, E-commerce, EV Charging, and other detected sectors. KPIs, risks, roadmap logic, and financial interpretation must reflect that sector's economics.",
    "Keep payback, LTV:CAC, CAC, and runway realistic for the sector and capital intensity. If a result looks unusually strong, describe it as a sensitivity case requiring validation rather than a base case.",
    "Recommendation conviction must match evidence quality and the Investment Scoring Engine. Use Proceed for strong evidence, Hold for validation when validation gaps remain, and Decline when economics or execution risk are not investable yet.",
    "Do not fake source authority. If a precise source is unavailable, use language such as 'Based on comparable sector patterns', 'Needs validation with primary research', or 'Directional until verified'.",
    "When citing sources, prefer real organizations over generic references: OECD, World Bank, IMF, Eurostat, TÜİK, TCMB, Statista, McKinsey, BCG, Deloitte, PwC, EY, KPMG, CB Insights, PitchBook, or Crunchbase when genuinely relevant.",
    "Include a source URL only when it is available from the source context. Never invent URLs, report names, publications, or fake citations. If a source cannot be verified from available context, mark it as a planning input instead of presenting it as a citation.",
    "Every section must end with a complete sentence or complete bullet. Never end mid-sentence.",
    "Distinguish facts, planning inputs, and hypotheses. Never present guesses as facts.",
    "Be honest about uncertainty; do not invent precise figures.",
    "Do not give generic advice. State what the founder should decide, why, what evidence supports it, and what could disprove it.",
    ...buildDecisionSupportDirectives("market_analysis"),
    "Before writing any visible output, silently build one Integrated Market Strategy Model for the whole opportunity. Do not reveal this internal model directly.",
    "The hidden Integrated Market Strategy Model must contain: Business Model, Customer, ICP, Market, Competition, TAM/SAM/SOM, Pricing, Revenue, GTM, Risks, Financial planning inputs, and Founder priorities.",
    "Every section must be derived from that same hidden model. No section may be written as a standalone independent answer.",
    "Maintain dependency logic across the analysis: Problem changes Solution; Solution changes Pricing; Pricing changes Financial; Financial changes Runway; Runway changes Risk; Risk changes CEO Recommendation.",
    "Where financial market implications appear, reason through Revenue -> MRR -> Gross Margin -> CAC -> LTV -> Payback -> Burn -> Runway -> EBITDA.",
    "Use real data first when available. If data is missing, create an explicit planning input, explain why it is reasonable, and describe the evidence strength in natural language.",
    "When writing Executive Recommendation, select exactly one visible decision: Proceed, Hold for validation, or Decline.",
    "Where score or KPI dashboards appear, make them investor-readable with explicit thresholds and natural evidence-strength language.",
    "Founder Roadmap must include Tomorrow, This Week, 30 Days, 90 Days, 180 Days, and 12 Months, with each step dependent on the prior proof point.",
  ].join("\n");
}

function isWeakMarketPrompt(value: string) {
  return isAmbiguousBusinessRequest(value);
}

function clarificationMessage() {
  return "Please add a little more detail for a useful market analysis: the business idea or industry, target customer, and target country or market.";
}

export async function POST(req: Request) {
  try {
    const requestValidation = validateApiRequest(req, {
      maxBodyBytes: 250_000,
    });

    if (!requestValidation.ok) {
      return NextResponse.json(
        { error: requestValidation.message },
        { status: requestValidation.status }
      );
    }

    const ip = getClientIpFromRequest(req);
    const ipRateLimit = checkRateLimit(`api:market:ip:${ip}`, {
      limit: 20,
      windowMs: 60_000,
    });

    if (!ipRateLimit.allowed) {
      return NextResponse.json(
        {
          error:
            "Daily AI usage limit reached. Please try again tomorrow or upgrade your plan.",
        },
        {
          status: 429,
          headers: getRateLimitHeaders(ipRateLimit),
        }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (!isPrivateBetaAllowed(user)) {
      return NextResponse.json(
        { error: "Private beta access only." },
        { status: 403 }
      );
    }

    const rateLimit = checkRateLimit(`api:market:${user.id}:${ip}`, {
      limit: 24,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error:
            "Daily AI usage limit reached. Please try again tomorrow or upgrade your plan.",
        },
        {
          status: 429,
          headers: getRateLimitHeaders(rateLimit),
        }
      );
    }

    const {
      prompt,
      field,
      section,
      language,
      reportRequestId: rawReportRequestId,
    } = await req.json();
    const promptText = typeof prompt === "string" ? prompt : "";
    const responseLanguage = normalizeLanguage(language, promptText);
    const reportRequestId =
      typeof rawReportRequestId === "string" ? rawReportRequestId.trim().slice(0, 128) : "";

    if (isWeakMarketPrompt(promptText)) {
      return NextResponse.json(
        { error: clarificationMessage() },
        { status: 422 }
      );
    }

    const requestedField =
      typeof field === "string"
        ? field
        : typeof section === "string"
          ? legacySectionToField[section]
          : undefined;
    const isFullReportRequest = requestedField === FULL_REPORT_FIELD;
    const reportField = isFullReportRequest ? "executiveSummary" : requestedField;
    const usageReportField = isFullReportRequest ? FULL_REPORT_FIELD : reportField;

    if (!isMarketReportField(reportField)) {
      return NextResponse.json(
        { error: "Invalid report field." },
        { status: 400 }
      );
    }

    const fieldConfig = fieldPrompts[reportField];

    if (isAiTestMode()) {
      logAiExecution({
        endpoint: "/api/market-analysis",
        source: "mock",
        mode: isFullReportRequest ? FULL_REPORT_FIELD : reportField,
      });

      const encoder = new TextEncoder();
      const mockReport = createMockMarketReport(promptText, responseLanguage);
      const payload = isFullReportRequest
        ? serializeMarketReportChunks(mockReport)
        : serializeReportChunk(reportField, mockReport[reportField]);

      return new Response(encoder.encode(payload), {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    const instructions = buildLanguageInstructions(responseLanguage);
    const canonicalFinancialAssumptions = createCanonicalFinancialAssumptions({
      prompt: promptText,
      reportKind: "market_analysis",
    });
    const financialAssumptionsContext = formatCanonicalFinancialAssumptions(
      canonicalFinancialAssumptions
    );
    const memoryOperations = extractExplicitMemoryOperations(promptText);
    const memoryApplyResult = memoryOperations.length > 0
      ? await applyUserMemoryOperations(supabase, user.id, memoryOperations, user)
      : { remembered: 0, forgotten: 0, failed: 0, storage: "none" as const };

    if (memoryApplyResult.failed > 0) {
      return NextResponse.json(
        { error: "Persistent memory could not be updated. Please try again later." },
        { status: 500 }
      );
    }

    const userMemories = await loadUserMemoriesForUser(
      supabase,
      user,
      memoryApplyResult.fallbackMemories
    );
    const userMemoryContext = buildUserMemoryContext(userMemories);
    const userMemoryInstruction = userMemoryContext
      ? `Persistent user memories for stable context. Use them only as durable user facts/preferences and never expose this block as report text:\n${userMemoryContext}`
      : "";
    const input = `Business idea: ${promptText}

${financialAssumptionsContext}
${userMemoryInstruction ? `\n${userMemoryInstruction}\n` : ""}

Report section to generate: ${fieldLabelsByLanguage[responseLanguage][reportField]}
Analysis task: ${fieldConfig.prompt}
First perform current web research. Use reliable sources for market size, competitor companies, industry trends, target customers, recent news, pricing models, SWOT inputs, Porter's Five Forces inputs, and entry strategy signals.
Before writing visible output, silently construct the full Integrated Market Strategy Model. Do not output the model.
Derive this section only from that model so market size, ICP, competitors, pricing, GTM, financial implications, risks, and recommendation stay consistent.
Write the section as an investor-grade market diligence note with practical market-entry recommendations for the founder.
Do not lead every section with the same decision-implication formula. Use it only where the section's job requires it.
Do not use internal evidence tags, confidence tiers, market-source labels, planning-input labels, or decision-implication labels.
Avoid generic filler. Use planning inputs explicitly when evidence is limited and state what would change the verdict.
Write in concise executive-consulting style: specific observations, short analytical paragraphs, numbered insights when useful, and no boilerplate conclusions.
Do not repeat the user's prompt verbatim; anchor the analysis in the market, buyer, competitor, and economic context.
Include at least one concrete business insight in this section that affects sizing, positioning, pricing, channel choice, risk, or validation priority.
Use Claim -> Reason / supporting context -> Business implication whenever the section makes an analytical judgment.
Answer what is happening, why it is happening, and why it matters for the founder without adding generic advice.
Follow the section ownership contract exactly; do not borrow content assigned to another section.
Do not repeat ideas, metrics, examples, or conclusions that belong to other sections; this section must add unique value.
Remove filler phrases such as "It is important to", "Businesses should", "This strategy can help", "In today's market", and "By leveraging".
Maintain exact financial consistency with the same planning-input set across Unit Economics, Financial Dashboard, Scenario Analysis, and Executive Recommendation.
Use the Data-Driven Financial Analysis Engine block as the calculated base-case model for TAM, SAM, SOM, ARPA, CAC, LTV, Gross Margin, MRR, ARR, Payback, Burn Rate, Runway, EBITDA, Break-even Month, Investment Needed, ROI, and Revenue Forecast.
Use the Investment Scoring Engine block as the calculated source for Investment Score, internal recommendation, conviction, estimated valuation, funding stage, decision scores, strengths, weaknesses, top risks, and next critical action.
Reuse that single calculated model everywhere. Do not create conflicting financial values in separate sections. If a value is directional, say it needs validation and explain why.
Align recommendation conviction with evidence quality and the calculated Investment Scoring Engine; avoid extreme conviction unless the evidence clearly supports it.
Do not expose internal grading labels, source-model labels, or internal recommendation codes anywhere in the final report.
Make examples, KPIs, risks, roadmap actions, and financial interpretation specific to the detected industry instead of using generic startup templates.
Use honest planning-input language instead of vague source claims such as "industry reports".
When citing sources, prefer real organizations such as OECD, World Bank, IMF, Eurostat, TÜİK, TCMB, Statista, McKinsey, BCG, Deloitte, PwC, EY, KPMG, CB Insights, PitchBook, or Crunchbase when genuinely relevant; include URLs only when available and never invent URLs or report names.
Finish with a complete sentence or complete bullet. Do not end mid-sentence.
Use structured markdown inside the section when useful: short paragraphs, bullets, or compact tables.
Write only the content for this section. Do not write a JSON object, field name, braces, markdown code block, heading, or any other report section.
Do not generate business-plan sections here. Do not suggest website URLs, domain names, brand names, or site ideas for the product.`;
    const productionLimit = await checkAiProductionRateLimit({
      supabase,
      userId: user.id,
      account: user,
      endpoint: "/api/market-analysis",
      requestKind: "market_analysis",
      promptText,
      reportField: usageReportField,
      reportRequestId,
      ip,
    });
    const { model, planTier, promptHash } = productionLimit;
    const sectionUsageMetadata = {
      quota_event: false,
      quota_mode: "market_analysis",
      report_request_id: reportRequestId || null,
      usage_kind: "section_generation",
    };

    if (!productionLimit.allowed) {
      logOperationalInfo("[api:market-analysis] quota denied before provider call", {
        reportField: usageReportField,
        reportRequestId: reportRequestId || null,
        providerCalled: false,
        quotaConsumed: false,
        failureReason: productionLimit.reason,
      });

      return NextResponse.json(
        { error: productionLimit.reason },
        { status: 429 }
      );
    }

    if (isFullReportRequest) {
      const fullReportCacheKey = createAiCacheKey({
        endpoint: "/api/market-analysis",
        normalizedPrompt: userMemoryContext
          ? `${productionLimit.normalizedPrompt}\nmemories:${userMemoryContext}`
          : productionLimit.normalizedPrompt,
        mode: `market_analysis:${FULL_REPORT_FIELD}:${canonicalFinancialAssumptions.version}:${canonicalFinancialAssumptions.fingerprint}`,
        language: responseLanguage,
        model,
      });
      const cachedFullReport = await getCachedAiResponse(
        supabase,
        user.id,
        fullReportCacheKey
      );
      const encoder = new TextEncoder();

      if (
        cachedFullReport &&
        !isReportGenerationFailureText(cachedFullReport.responseText)
      ) {
        logAiExecution({
          endpoint: "/api/market-analysis",
          source: "cache",
          mode: FULL_REPORT_FIELD,
          model: cachedFullReport.model || model,
          cacheHit: true,
        });

        let parsedCachedReport: Record<MarketReportField, string> | null = null;
        let cachedMissingFields: MarketReportField[] = [];
        let cachedInvalidFields: MarketReportField[] = [];

        try {
          const parsedCachePayload = parseFullMarketReport(
            cachedFullReport.responseText,
            canonicalFinancialAssumptions
          );

          parsedCachedReport = parsedCachePayload.report;
          cachedMissingFields = parsedCachePayload.missingFields;
          cachedInvalidFields = parsedCachePayload.invalidFields;
        } catch (error) {
          console.error("[api:market-analysis] Ignoring malformed cached full report", {
            reportRequestId: reportRequestId || null,
            cacheKey: fullReportCacheKey,
            failureReason:
              error instanceof Error && error.message ? error.message : "CacheParseFailed",
          });
        }

        if (!parsedCachedReport) {
          logOperationalInfo("[api:market-analysis] cache miss after malformed full report", {
            reportRequestId: reportRequestId || null,
            cacheKey: fullReportCacheKey,
          });
        } else {

          if (cachedMissingFields.length || cachedInvalidFields.length) {
            logOperationalInfo("[api:market-analysis] cached full report partial sections", {
              reportRequestId: reportRequestId || null,
              missingFields: cachedMissingFields,
              invalidFields: cachedInvalidFields,
              source: "cache",
            });
          }

          await recordAiUsage(supabase, {
            userId: user.id,
            endpoint: "/api/market-analysis",
            reportField: FULL_REPORT_FIELD,
            promptHash,
            model: cachedFullReport.model || model,
            planTier,
            tokenUsage: {
              promptTokens: cachedFullReport.promptTokens,
              completionTokens: cachedFullReport.completionTokens,
              totalTokens: cachedFullReport.totalTokens,
            },
            estimatedCostUsd: 0,
            cacheHit: true,
            responseTimeMs: 0,
            metadata: {
              quota_event: false,
              quota_mode: "market_analysis",
              quota_consumed: false,
              report_request_id: reportRequestId || null,
              usage_kind: "full_report_cache_hit",
              actual_ai_call: false,
              cachedEstimatedCostUsd: cachedFullReport.estimatedCostUsd,
            },
          });

          const cachedWarning =
            cachedMissingFields.length || cachedInvalidFields.length
              ? serializeWarningChunk({
                  warning:
                    "Market analysis returned a partial report. Some areas need additional market validation before they are decision-grade.",
                  missingFields: cachedMissingFields,
                  invalidFields: cachedInvalidFields,
                  partial: true,
                })
              : "";

          return new Response(encoder.encode(cachedWarning + serializeMarketReportChunks(parsedCachedReport)), {
            headers: {
              "Content-Type": "application/x-ndjson; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
            },
          });
        }
      }

      if (cachedFullReport) {
        console.error("[api:market-analysis] Ignoring cached failed full report content", {
          endpoint: "/api/market-analysis",
          reportField: FULL_REPORT_FIELD,
          cacheKey: fullReportCacheKey,
        });
      }

      const existingAiCallCount = await countAiCallsForReport({
        supabase,
        userId: user.id,
        reportRequestId,
      });

      logOperationalInfo("[api:market-analysis] AI call budget", {
        endpoint: "/api/market-analysis",
        reportRequestId: reportRequestId || null,
        existingAiCallCount,
        maxAiCallsPerReport: MAX_AI_CALLS_PER_MARKET_REPORT,
        requestedField: FULL_REPORT_FIELD,
      });

      if (existingAiCallCount >= MAX_AI_CALLS_PER_MARKET_REPORT) {
        return NextResponse.json(
          {
            error:
              "AI call budget exceeded for this report. Please start a new report request.",
          },
          { status: 429 }
        );
      }

      const fullReportInput = `Business idea: ${promptText}

${financialAssumptionsContext}
${userMemoryInstruction ? `\n${userMemoryInstruction}\n` : ""}

Generate the complete Market Analysis report as one structured JSON object.
Return exactly these JSON keys and no others:
${reportFields.map((fieldName) => `- ${fieldName}: ${fieldLabelsByLanguage[responseLanguage][fieldName]} — ${fieldPrompts[fieldName].prompt}`).join("\n")}

Deterministic report contract:
${buildFullReportStructureDirectives("market_analysis").map((directive) => `- ${directive}`).join("\n")}

First perform current web research in this single request. Use reliable sources for market size, competitor companies, industry trends, target customers, recent news, pricing models, SWOT inputs, Porter's Five Forces inputs, and entry strategy signals.
Before writing visible output, silently construct the full Integrated Market Strategy Model. Do not output the model.
Derive every section only from that model so market size, ICP, competitors, pricing, GTM, financial implications, risks, and recommendation stay consistent.
Follow the section ownership contract exactly; do not borrow content assigned to another section.
Do not repeat ideas, metrics, examples, or conclusions across sections.
Use the Data-Driven Financial Analysis Engine block as the calculated base-case model for TAM, SAM, SOM, ARPA, CAC, LTV, Gross Margin, MRR, ARR, Payback, Burn Rate, Runway, EBITDA, Break-even Month, Investment Needed, ROI, and Revenue Forecast.
Reuse that single calculated model everywhere. Do not create conflicting financial values in separate sections. If a value is directional, state that it needs validation and explain why.
Translate any internal recommendation into exactly one visible decision: Proceed, Hold for validation, or Decline.
Do not expose internal grading labels, source-model labels, or internal recommendation codes anywhere in the final report.
Align recommendation conviction with evidence quality; avoid extreme conviction values unless the evidence clearly supports them.
Use honest planning-input language instead of vague source claims such as "industry reports".
When citing sources, prefer real organizations such as OECD, World Bank, IMF, Eurostat, TÜİK, TCMB, Statista, McKinsey, BCG, Deloitte, PwC, EY, KPMG, CB Insights, PitchBook, or Crunchbase when genuinely relevant; include URLs only when available and never invent URLs or report names.
Write concise executive memo prose with specific observations, numbered insights where useful, and no generic conclusions.
Do not repeat the user's prompt verbatim; translate it into market context, buyer economics, competitor dynamics, and founder decisions.
Every section must include at least one concrete business insight that changes sizing, timing, positioning, pricing, distribution, risk, or validation priority.
Use Claim -> Reason / supporting context -> Business implication for major analytical statements.
Every major section must make clear what is happening, why it is happening, and why it matters for the founder.
Prefer causal reasoning over descriptive text and avoid unsupported assertions.
Finish every section with a complete sentence or complete bullet. Never end mid-sentence.
Do not generate business-plan sections here. Do not suggest website URLs, domain names, brand names, or site ideas for the product.
Do not include markdown code fences, braces inside string values, or commentary outside JSON.`;
      const queuedJob = createAiJobDescriptor({
        kind: "market_analysis",
        userId: user.id,
        endpoint: "/api/market-analysis",
        reportField: FULL_REPORT_FIELD,
        promptHash,
        language: responseLanguage,
        model,
      });
      const startedAt = Date.now();

      try {
        logOperationalInfo("[api:market-analysis] provider call started", {
          reportField: FULL_REPORT_FIELD,
          reportRequestId: reportRequestId || null,
          model,
          providerCalled: true,
          quotaConsumed: false,
        });

        const client = createOpenAiClient();
        logAiExecution({
          endpoint: "/api/market-analysis",
          source: "real_ai",
          mode: FULL_REPORT_FIELD,
          model,
        });
        const response = await client.responses.create(
          {
            model,
            instructions,
            input: fullReportInput,
            max_output_tokens: 6500,
            reasoning: {
              effort: "low",
            },
            tools: [
              {
                type: "web_search_preview",
                search_context_size: "low",
              },
            ],
            include: ["web_search_call.action.sources"],
            text: {
              verbosity: "medium",
              format: createFullReportJsonSchema(
                "zerinix_market_analysis_report",
                reportFields
              ),
            },
          },
          { signal: req.signal }
        );
        const tokenUsage = extractTokenUsage(response);
        const estimatedCostUsd = estimateAiCostUsd(model, tokenUsage);
        const responseTimeMs = Date.now() - startedAt;
        const responseText = extractResponseText(response);
        const {
          report: parsedReport,
          missingFields,
          invalidFields,
        } = parseFullMarketReport(responseText, canonicalFinancialAssumptions);
        const cacheResponseText = JSON.stringify(parsedReport);
        const isPartialReport = Boolean(missingFields.length || invalidFields.length);

        logOperationalInfo("[api:market-analysis] full report section validation", {
          reportRequestId: reportRequestId || null,
          model,
          responseTextLength: responseText.length,
          completedFields: reportFields.filter(
            (fieldName) =>
              !missingFields.includes(fieldName) && !invalidFields.includes(fieldName)
          ),
          missingFields,
          invalidFields,
          partial: isPartialReport,
        });
        reportFields.forEach((fieldName) => {
          logOperationalInfo("[api:market-analysis] section validation step", {
            reportRequestId: reportRequestId || null,
            reportField: fieldName,
            model,
            status: missingFields.includes(fieldName)
              ? "missing"
              : invalidFields.includes(fieldName)
                ? "invalid"
                : "completed",
            contentLength: parsedReport[fieldName]?.length || 0,
          });
        });

        if (!isPartialReport && !isReportGenerationFailureText(cacheResponseText)) {
          await storeCachedAiResponse(supabase, {
            userId: user.id,
            cacheKey: fullReportCacheKey,
            promptHash,
            endpoint: "/api/market-analysis",
            reportField: FULL_REPORT_FIELD,
            language: responseLanguage,
            model,
            responseText: cacheResponseText,
            tokenUsage,
            estimatedCostUsd,
            expiresInDays: 3,
          });
        } else if (isPartialReport) {
          logOperationalInfo("[api:market-analysis] skipped cache for partial full report", {
            reportRequestId: reportRequestId || null,
            missingFields,
            invalidFields,
          });
        }

        await recordAiUsage(supabase, {
          userId: user.id,
          endpoint: "/api/market-analysis",
          reportField: FULL_REPORT_FIELD,
          promptHash,
          model,
          planTier,
          tokenUsage,
          estimatedCostUsd,
          cacheHit: false,
          responseTimeMs,
          metadata: {
            quota_event: !productionLimit.quotaAlreadyCharged,
            quota_mode: "market_analysis",
            quota_consumed: !productionLimit.quotaAlreadyCharged,
            report_request_id: reportRequestId || null,
            usage_kind: "full_report_generation",
            actual_ai_call: true,
            max_ai_calls_per_report: MAX_AI_CALLS_PER_MARKET_REPORT,
            job: queuedJob,
          },
        });

        logOperationalInfo("[api:market-analysis] provider call completed", {
          reportField: FULL_REPORT_FIELD,
          reportRequestId: reportRequestId || null,
          model,
          providerCalled: true,
          quotaConsumed: !productionLimit.quotaAlreadyCharged,
        });

        const warning =
          isPartialReport
            ? serializeWarningChunk({
                warning:
                  "Market analysis returned a partial report. Some areas need additional market validation before they are decision-grade.",
                missingFields,
                invalidFields,
                partial: true,
              })
            : "";

        return new Response(encoder.encode(warning + serializeMarketReportChunks(parsedReport)), {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        });
      } catch (error) {
        const configurationError = getAiConfigurationErrorMessage(error);

        if (configurationError) {
          return NextResponse.json({ error: configurationError }, { status: 500 });
        }

        await recordAiUsage(supabase, {
          userId: user.id,
          endpoint: "/api/market-analysis",
          reportField: FULL_REPORT_FIELD,
          promptHash,
          model,
          planTier,
          tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          estimatedCostUsd: 0,
          cacheHit: false,
          status: "failed",
          responseTimeMs: Date.now() - startedAt,
          metadata: {
            quota_event: false,
            quota_mode: "market_analysis",
            quota_consumed: false,
            report_request_id: reportRequestId || null,
            usage_kind: "full_report_generation",
            actual_ai_call: true,
            max_ai_calls_per_report: MAX_AI_CALLS_PER_MARKET_REPORT,
            job: queuedJob,
            failure_reason:
              error instanceof Error && error.message ? error.message : "GenerationFailed",
          },
        });
        logOperationalInfo("[api:market-analysis] provider call failed", {
          reportField: FULL_REPORT_FIELD,
          reportRequestId: reportRequestId || null,
          model,
          providerCalled: true,
          quotaConsumed: false,
          failureReason:
            error instanceof Error && error.message ? error.message : "GenerationFailed",
        });
        logServerError("api:market-analysis:full-report", error);

        const failedFields = [...reportFields];
        const fallbackReport = createFallbackMarketReport();
        const warning = serializeWarningChunk({
          warning:
            "Market analysis returned a partial report because the provider response could not be parsed completely. Please retry to refresh the affected areas.",
          missingFields: failedFields,
          invalidFields: [],
          partial: true,
        });

        return new Response(
          encoder.encode(warning + serializeMarketReportChunks(fallbackReport)),
          {
            status: 200,
            headers: {
              "Content-Type": "application/x-ndjson; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
            },
          }
        );
      }
    }

    const cacheKey = createAiCacheKey({
      endpoint: "/api/market-analysis",
      normalizedPrompt: userMemoryContext
        ? `${productionLimit.normalizedPrompt}\nmemories:${userMemoryContext}`
        : productionLimit.normalizedPrompt,
      mode: `market_analysis:${reportField}:${canonicalFinancialAssumptions.version}:${canonicalFinancialAssumptions.fingerprint}`,
      language: responseLanguage,
      model,
    });

    const cachedResponse = await getCachedAiResponse(supabase, user.id, cacheKey);
    const encoder = new TextEncoder();

    if (cachedResponse && !isReportGenerationFailureText(cachedResponse.responseText)) {
      logAiExecution({
        endpoint: "/api/market-analysis",
        source: "cache",
        mode: reportField,
        model: cachedResponse.model || model,
        cacheHit: true,
      });

      await recordAiUsage(supabase, {
        userId: user.id,
        endpoint: "/api/market-analysis",
        reportField,
        promptHash,
        model: cachedResponse.model || model,
        planTier,
        tokenUsage: {
          promptTokens: cachedResponse.promptTokens,
          completionTokens: cachedResponse.completionTokens,
          totalTokens: cachedResponse.totalTokens,
        },
        estimatedCostUsd: 0,
        cacheHit: true,
        responseTimeMs: 0,
        metadata: {
          ...sectionUsageMetadata,
          quota_consumed: false,
          cachedEstimatedCostUsd: cachedResponse.estimatedCostUsd,
        },
      });

      return new Response(encoder.encode(serializeReportChunk(reportField, cachedResponse.responseText)), {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    if (cachedResponse) {
      console.error("[api:market-analysis] Ignoring cached failed report content", {
        endpoint: "/api/market-analysis",
        reportField,
        cacheKey,
      });
    }

    const queuedJob = createAiJobDescriptor({
      kind: "market_analysis",
      userId: user.id,
      endpoint: "/api/market-analysis",
      reportField,
      promptHash,
      language: responseLanguage,
      model,
    });
    const startedAt = Date.now();

    logOperationalInfo("[api:market-analysis] provider call started", {
      reportField,
      reportRequestId: reportRequestId || null,
      model,
      providerCalled: true,
      quotaConsumed: false,
    });

    let client: ReturnType<typeof createOpenAiClient>;

    try {
      client = createOpenAiClient();
    } catch (error) {
      const configurationError = getAiConfigurationErrorMessage(error);

      if (configurationError) {
        return NextResponse.json({ error: configurationError }, { status: 500 });
      }

      throw error;
    }

    logAiExecution({
      endpoint: "/api/market-analysis",
      source: "real_ai",
      mode: reportField,
      model,
    });

    const stream = await client.responses
      .create(
        {
          model,
          instructions,
          input,
          max_output_tokens: fieldConfig.maxTokens,
          stream: true,
          reasoning: {
            effort: "low",
          },
          tools: [
            {
              type: "web_search_preview",
              search_context_size: "low",
            },
          ],
          include: ["web_search_call.action.sources"],
          text: {
            verbosity: "medium",
          },
        },
        { signal: req.signal }
      )
      .catch(async (error) => {
        logOperationalInfo("[api:market-analysis] provider request failed", {
          reportField,
          reportRequestId: reportRequestId || null,
          model,
          providerCalled: true,
          quotaConsumed: false,
          failureReason:
            error instanceof Error && error.message ? error.message : "ProviderError",
        });

        await recordAiUsage(supabase, {
          userId: user.id,
          endpoint: "/api/market-analysis",
          reportField,
          promptHash,
          model,
          planTier,
          tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          estimatedCostUsd: 0,
          cacheHit: false,
          status: "failed",
          responseTimeMs: Date.now() - startedAt,
          metadata: {
            ...sectionUsageMetadata,
            quota_consumed: false,
            job: queuedJob,
            phase: "openai_request",
            failure_reason:
              error instanceof Error && error.message ? error.message : "ProviderError",
          },
        });

        throw error;
      });

    return new Response(
      new ReadableStream({
        async start(controller) {
          let tokenUsage: TokenUsage = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          };

          try {
            let streamedText = "";

            for await (const event of stream) {
              if (event.type === "response.output_text.delta" && event.delta) {
                streamedText += event.delta;
                controller.enqueue(
                  encoder.encode(serializeReportChunk(reportField, event.delta))
                );
              }

              if (event.type === "response.output_text.done" && !streamedText) {
                streamedText = event.text;
                controller.enqueue(
                  encoder.encode(serializeReportChunk(reportField, event.text))
                );
              }

              if (event.type === "response.completed") {
                tokenUsage = extractTokenUsage(event.response);
                const completedText = extractResponseText(event.response);

                if (completedText && !streamedText) {
                  streamedText = completedText;
                  controller.enqueue(
                    encoder.encode(serializeReportChunk(reportField, completedText))
                  );
                }
              }
            }

            const estimatedCostUsd = estimateAiCostUsd(model, tokenUsage);
            const responseTimeMs = Date.now() - startedAt;

            if (streamedText && !isReportGenerationFailureText(streamedText)) {
              await storeCachedAiResponse(supabase, {
                userId: user.id,
                cacheKey,
                promptHash,
                endpoint: "/api/market-analysis",
                reportField,
                language: responseLanguage,
                model,
                responseText: streamedText,
                tokenUsage,
                estimatedCostUsd,
                expiresInDays: 3,
              });
            } else if (streamedText) {
              console.error("[api:market-analysis] Refused to cache failed report content", {
                endpoint: "/api/market-analysis",
                reportField,
                cacheKey,
              });
            }

            await recordAiUsage(supabase, {
              userId: user.id,
              endpoint: "/api/market-analysis",
              reportField,
              promptHash,
              model,
              planTier,
              tokenUsage,
              estimatedCostUsd,
              cacheHit: false,
              responseTimeMs,
              metadata: {
                ...sectionUsageMetadata,
                quota_event: !productionLimit.quotaAlreadyCharged,
                quota_consumed: !productionLimit.quotaAlreadyCharged,
                job: queuedJob,
              },
            });

            logOperationalInfo("[api:market-analysis] provider call completed", {
              reportField,
              reportRequestId: reportRequestId || null,
              model,
              providerCalled: true,
              quotaConsumed: !productionLimit.quotaAlreadyCharged,
            });

            controller.close();
          } catch (error) {
            await recordAiUsage(supabase, {
              userId: user.id,
              endpoint: "/api/market-analysis",
              reportField,
              promptHash,
              model,
              planTier,
              tokenUsage,
              estimatedCostUsd: estimateAiCostUsd(model, tokenUsage),
              cacheHit: false,
              status: "failed",
              responseTimeMs: Date.now() - startedAt,
              metadata: {
                ...sectionUsageMetadata,
                quota_consumed: false,
                job: queuedJob,
                failure_reason:
                  error instanceof Error && error.message ? error.message : "GenerationFailed",
              },
            });
            logServerError("api:market-analysis:stream", error);
            controller.error(error);
          }
        },
      }),
      {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  } catch (error) {
    logServerError("api:market-analysis", error);

    return NextResponse.json(
      { error: "Market analysis could not be generated." },
      { status: 500 }
    );
  }
}
