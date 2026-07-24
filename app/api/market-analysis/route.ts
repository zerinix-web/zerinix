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
  formatDecisionConfidenceReport,
  formatCanonicalFinancialAssumptions,
  formatFinancialConsistencyReport,
  formatReportIntelligenceSummary,
  formatSourceIntelligenceSummary,
  formatValidationIntelligenceSummary,
  type AiFinancialModelContext,
} from "@/app/lib/ai/financial-assumptions";
import { createAiCostOptimizationMetrics } from "@/app/lib/ai/token-optimization";
import { isReportGenerationFailureText } from "@/app/lib/report-errors";
import { validateGeneratedReportSections } from "@/app/lib/report-quality-validation";
import { evaluateReportConfidence } from "@/app/lib/report-confidence";
import { scoreReportSources } from "@/app/lib/source-reliability";
import { aggregateReportEvidence } from "@/app/lib/live-evidence";
import { createExecutiveDecisionIntelligence } from "@/app/lib/executive-decision-intelligence";
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
import {
  localizePdfPresentationLabel,
  localizePdfPresentationText,
  normalizePdfText,
} from "@/app/lib/pdf-normalization.mjs";

const fieldPrompts = {
  executiveSummary: {
    prompt:
      "Write an investor-grade Executive Summary with one job only: market verdict. Start with exactly one final decision from PASS, HOLD, VALIDATE, or REJECT plus Decision Confidence, then cover market attractiveness, demand signal, competitive intensity, entry timing, strategic gap, and the founder's most important market decision. Early-stage ideas without validation should usually be HOLD or VALIDATE, not REJECT. Do not repeat TAM/SAM/SOM, SWOT, Porter, competitor, entry-plan, KPI, or source detail. Do not use internal labels or confidence tags. Do not write a heading. Max 115 words.",
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
      "Analyze only competitors and substitutes. For each important competitor or substitute include available pricing, target customer, funding, employee size, strengths, weaknesses, positioning, and how the analyzed company can outperform. Omit unknown fields rather than inventing them. Include incumbent alternatives, switching barriers, pricing signals, likely response, and entrant gap. End with a concise executive implication explaining the competitive decision impact. Do not add a heading. Do not repeat SWOT, threats, market overview, or entry strategy. Do not write a heading. Max 220 words.",
    maxTokens: 1400,
  },
  customerPainPoints: {
    prompt:
      "List only customer pain points: current workarounds, economic cost, switching triggers, urgency level, and interview evidence needed to confirm demand. Do not repeat ICP, solution, competitors, or GTM. Do not write a heading. Max 135 words.",
    maxTokens: 1000,
  },
  opportunities: {
    prompt:
      "Identify only market opportunities: underserved segments, channel openings, pricing gaps, partnership angles, product wedges, regulatory/timing advantages, and why incumbents may not address them. Include a compact Market Opportunity Score with Demand Score, Competition Score, Timing Score, Execution Difficulty, Revenue Potential, overall Opportunity Score 0-100, and one-line calculation explanation. Each opportunity must include the founder implication or validation action. End with a concise executive implication explaining the founder action or validation priority. Do not add a heading. Do not repeat SWOT, entry strategy, or competitor analysis. Do not write a heading. Max 190 words.",
    maxTokens: 1000,
  },
  threats: {
    prompt:
      "Identify only market threats as a professional Risk Matrix. Each material threat must include Probability, Impact, Severity, Mitigation, and Early Warning Signal. Cover competitive pressure, demand uncertainty, switching costs, regulation, platform dependency, price compression, trust barriers, data access, and distribution risk. End with a concise executive implication explaining which risk should change the entry plan first. Do not add a heading. Do not repeat SWOT or Executive Recommendation. Do not write a heading. Max 205 words.",
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
      "Create only market validation operating metrics. Include demand, conversion, willingness to pay, sales cycle, channel CAC, retention intent, competitor displacement, market pull, and target/warning thresholds. Never use placeholder values such as 1, Target: 1, N/A, or arbitrary percentages. If a metric lacks validation data, write Validation Required as the value and give a meaningful target threshold or validation test. Do not repeat Unit Economics or Validation Plan except as a concise threshold. Do not write a heading. Max 185 words.",
    maxTokens: 1000,
  },
  executiveRecommendation: {
    prompt:
      "Write only final investment decision in investment-committee language. Include selected decision, the single key reason, biggest risks, and next concrete action. Use one Decision Confidence value, then add AI Confidence Breakdown dimensions: Market Confidence, Competition Confidence, Financial Confidence, Execution Confidence, Product Confidence, each with a concise investor-relevant explanation. Add Founder Decision Engine answering: If I were the founder, what would I do first, postpone, spend money on, and absolutely avoid? Select exactly one visible option and no second option: PASS, HOLD, VALIDATE, or REJECT. Early-stage ideas without validation should prefer HOLD or VALIDATE, not REJECT. Do not use internal recommendation codes or internal scoring terminology. Do not restate market overview, SWOT, entry plan, or financial dashboard. Do not write a heading. Max 210 words.",
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
      "Define only key market validation metrics an investor would monitor: demand, conversion, willingness to pay, sales cycle, retention intent, CAC/channel cost, competitor displacement, and market pull signals. Include decision thresholds only. Never output placeholder numbers such as 1, Target: 1, or 1 / Target:1. If a threshold is unknown, write Validation Required. Do not repeat KPI Dashboard explanations. Do not write a heading. Max 125 words.",
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
      "List only 4-6 reliable verified sources used or most relevant for validating this market, then close the report with CEO Brief. Prefer real organizations over generic references, especially OECD, World Bank, IMF, Eurostat, TÜİK, TCMB, Statista, McKinsey, BCG, Deloitte, PwC, EY, KPMG, CB Insights, PitchBook, or Crunchbase when genuinely relevant. For each verified source include publisher, confidence, publication year, source type, and URL only when available. If no verified source metadata exists, omit the citation item and write a concise planning-input note instead. Do not invent URLs, report names, publications, or fake citations. End with CEO Brief as a board-level briefing: maximum 10 concise bullets, each directly supported by report findings. Do not use generic phrases such as 'industry reports' as verified evidence. Do not repeat analysis outside CEO Brief. Do not write a heading.",
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
type MarketReportMetadataChunk = {
  reportMetadata: {
    investmentScore: AiFinancialModelContext["investmentScore"];
    benchmarkFit: AiFinancialModelContext["benchmarkFit"];
    benchmarkScore: AiFinancialModelContext["benchmarkScore"];
    reportQuality: AiFinancialModelContext["reportIntelligence"];
    validationIntelligence: AiFinancialModelContext["validationIntelligenceV2"];
  };
};
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

const turkishFieldLabels: Record<MarketReportField, string> = {
  executiveSummary: "Yönetici Özeti",
  marketOverview: "Pazar Genel Bakışı",
  tamSamSom: "TAM / SAM / SOM",
  industryTrends: "Sektör Trendleri",
  targetCustomer: "Hedef Müşteri",
  competitorAnalysis: "Rakip Analizi",
  customerPainPoints: "Müşteri Problemleri",
  opportunities: "Fırsatlar",
  threats: "Tehditler",
  swotAnalysis: "SWOT Analizi",
  portersFiveForces: "Porter'ın Beş Gücü",
  unitEconomics: "Birim Ekonomisi",
  financialDashboard: "Finansal Panel",
  scenarioAnalysis: "Senaryo Analizi: Kötü / Baz / En İyi",
  kpiDashboard: "KPI Paneli",
  executiveRecommendation: "Yönetici Tavsiyesi",
  entryStrategy: "Pazara Giriş Stratejisi",
  validationPlan: "Doğrulama Planı",
  keyMetrics: "Temel Metrikler",
  founderRoadmap: "Kurucu Yol Haritası",
  sourcesAssumptions: "Kaynaklar / Varsayımlar",
  sources: "Kaynaklar",
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
  Turkish: turkishFieldLabels,
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

function removePlaceholderKpiValues(content: string) {
  return content
    .replace(/\|\s*1\s*\|\s*Target\s*:\s*1\s*\|/gi, "| Validation Required | Target: validation test required |")
    .replace(/\b1\s*\|\s*Target\s*:\s*1\b/gi, "Validation Required | Target: validation test required")
    .replace(/\b1\s*(?:[-–—]\s*)?\/\s*(?:target\s*[:\-–—]?\s*)?1\b/gi, "Validation Required")
    .replace(/\b1\s*\/\s*Target\s*:\s*1\b/gi, "Validation Required")
    .replace(/\b1\s*\/\s*Target\s*1\b/gi, "Validation Required")
    .replace(/\b1\s*\/\s*Target\b/gi, "Validation Required")
    .replace(
      /\bValue\s*:\s*1\s*(?:\||,|;|\s+-\s+)\s*Target\s*:\s*1\b/gi,
      "Value: Validation Required | Target: validation test required"
    )
    .replace(/\bMetric\s*:\s*1\b/gi, "Metric: Validation Required")
    .replace(/\b(Current|Baseline|Threshold)\s*:\s*1\b/gi, "$1: Validation Required")
    .replace(/\bTarget\s*:\s*1\b/gi, "Target: validation test required")
    .replace(/\bTarget\s+1\b/gi, "Target: validation test required")
    .replace(/\bValue\s*:\s*1\b/gi, "Value: Validation Required")
    .trim();
}

function removeTamSamSomOwnershipText(content: string) {
  return sanitizeMarketReportContent(content)
    .split("\n")
    .filter((line) => {
      const normalized = line.replace(/^[-*•]\s*/, "").trim();

      if (!normalized) {
        return true;
      }

      return !(
        /^(?:tam|sam|som)\s*[:\-–—]/i.test(normalized) ||
        /\btam\s*\/\s*sam\s*\/\s*som\b/i.test(normalized) ||
        /\bmarket sizing\s*[:\-–—]/i.test(normalized)
      );
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function detectLanguage(value: string): ResponseLanguage {
  const normalized = value.toLowerCase();
  const hasTurkishCharacters = /[çğıöşü]/i.test(normalized);
  const hasTurkishSentencePattern =
    /\b(nasıl|nedir|hangi|neden|nerede|kim|kaç|mı|mi|mu|mü|olur|olabilir|öner|analiz et)\b/i.test(
      normalized
    );
  const hasEnglishStructure =
    /\b(analyze|analyse|analysis|market|business|startup|company|idea|report|strategy|pricing|competitors?|customers?|growth|create|generate|validate|in|for|with|and|the)\b/i.test(
      normalized
    );
  const hasTurkishWords =
    /\b(ve|bir|için|ile|ama|fakat|iş|hedef|müşteri|pazar|gelir|strateji|istiyorum|yap|kurmak|deneme|merhaba|selam|evet|hayır|lutfen|lütfen)\b/i.test(
      normalized
    );

  if (hasTurkishCharacters || hasTurkishSentencePattern) {
    return "Turkish";
  }

  if (hasEnglishStructure) {
    return "English";
  }

  return hasTurkishWords ? "Turkish" : "English";
}

function normalizeLanguage(_value: unknown, prompt: string): ResponseLanguage {
  return detectLanguage(prompt);
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

function serializeMarketReportMetadataChunk(
  context: AiFinancialModelContext
) {
  const chunk: MarketReportMetadataChunk = {
    reportMetadata: {
      investmentScore: context.investmentScore,
      benchmarkFit: context.benchmarkFit,
      benchmarkScore: context.benchmarkScore,
      reportQuality: context.reportIntelligence,
      validationIntelligence: context.validationIntelligenceV2,
    },
  };

  return `${JSON.stringify(chunk)}\n`;
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

function formatLocalizedBulletGroup(
  language: ResponseLanguage,
  englishLabel: string,
  turkishLabel: string,
  items: string[]
) {
  return formatBulletGroup(marketLabel(language, englishLabel, turkishLabel), items);
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
  context: AiFinancialModelContext,
  language: ResponseLanguage
) {
  const strengths = context.investmentScore.strengths.length
    ? context.investmentScore.strengths
    : [
        marketText(
          language,
          `${context.inputs.industry} model has a focused market-entry thesis and ${context.metrics.grossMargin.displayValue} gross-margin planning input.`,
          `${context.inputs.industry} modeli odaklı bir pazara giriş tezi ve ${context.metrics.grossMargin.displayValue} brüt marj planlama girdisi taşır.`
        ),
      ];
  const weaknesses = context.investmentScore.weaknesses.length
    ? context.investmentScore.weaknesses
    : [
        marketText(
          language,
          `Primary validation is still required for ${context.inputs.targetCustomer}, pricing, and repeatable acquisition.`,
          `${context.inputs.targetCustomer}, fiyatlandırma ve tekrarlanabilir edinim için birincil doğrulama hâlâ gereklidir.`
        ),
      ];
  const opportunities = extractFallbackBullets(
    report.opportunities,
    marketText(
      language,
      "A focused beachhead gives the founder a practical segment to validate before expanding.",
      "Odaklı başlangıç pazarı, kurucuya genişlemeden önce doğrulanabilir pratik bir segment sağlar."
    )
  );
  const threats = context.investmentScore.topRisks.length
    ? context.investmentScore.topRisks
    : extractFallbackBullets(
        report.threats,
        marketText(
          language,
          "Competitive response, acquisition cost inflation, and weak retention could reduce investability.",
          "Rekabet tepkisi, edinim maliyeti enflasyonu ve zayıf elde tutma yatırım yapılabilirliği azaltabilir."
        )
      );

  return [
    formatLocalizedBulletGroup(language, "Strengths", "Güçlü Yönler", strengths),
    formatLocalizedBulletGroup(language, "Weaknesses", "Zayıf Yönler", weaknesses),
    formatLocalizedBulletGroup(language, "Opportunities", "Fırsatlar", opportunities),
    formatLocalizedBulletGroup(language, "Threats", "Tehditler", threats),
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

function removeLegacyValidationIntelligenceBlock(content: string) {
  return sanitizeMarketReportContent(content)
    .split(/\n{2,}/)
    .filter((block) => {
      const normalizedBlock = block.trim();
      const hasLegacyHeading =
        /\b(?:Validation Roadmap|Doğrulama Yol Haritası)\s*:/i.test(normalizedBlock);
      const hasOldValidationScore =
        /\b(?:Validation Score|Doğrulama Skoru)\s*[:\-–—]\s*(?:Not Started|Başlamadı|In Progress|Devam Ediyor|Validated|Doğrulandı)\b/i.test(normalizedBlock);
      const hasOldPriorityFormat =
        /\b(?:Priority|Öncelik)\s+\d+\s*[:\-–—]\s*/i.test(normalizedBlock) &&
        !/\b(?:Success Metric|Başarı Metriği|Timeline|Zamanlama|Evidence|Kanıt)\s*[:\-–—]/i.test(normalizedBlock);

      return !hasLegacyHeading && !hasOldValidationScore && !hasOldPriorityFormat;
    })
    .join("\n\n")
    .trim();
}

function marketText(language: ResponseLanguage, english: string, turkish: string) {
  return language === "Turkish" ? turkish : english;
}

function marketLabel(language: ResponseLanguage, english: string, turkish: string) {
  return language === "Turkish"
    ? localizePdfPresentationLabel(turkish || english, "tr")
    : localizePdfPresentationLabel(english, "en");
}

function localizeDeterministicMarketText(content: string, language: ResponseLanguage) {
  return localizePdfPresentationText(content, language === "Turkish" ? "tr" : "en");
}

function normalizeTurkishMarketSourcePhrases(content: string) {
  return content
    .replace(/\bFood & Beverage \/ Specialty Coffee\b/g, "Yiyecek & İçecek / Özel Kahve")
    .replace(/\bD2C Brand \+ Subscription \+ B2B\b/g, "D2C Marka + Abonelik + B2B")
    .replace(
      /\b(?:Revenue|Gelir) expands toward (\$[\d.,]+[kMB]?) with stronger conversion (?:and|ve) retention\.?/gi,
      "Gelir $1 seviyesine çıkar; daha güçlü dönüşüm ve elde tutma ile desteklenir."
    )
    .replace(
      /\binvestment need is (\$[\d.,]+[kMB]?) against (\$[\d.,]+[kMB]?) Year-1 ARR\.?/gi,
      "$1 yatırım ihtiyacına karşılık 1. yıl ARR hedefi $2."
    )
    .replace(/\$30\/month\b/g, "$30/ay");
}

function localizeMarketDecision(decision: string, language: ResponseLanguage) {
  if (language !== "Turkish") return decision;

  const normalized = decision.toUpperCase();
  if (normalized === "PASS") return "GEÇ";
  if (normalized === "HOLD") return "BEKLE";
  if (normalized === "VALIDATE") return "DOĞRULA";
  if (normalized === "REJECT") return "REDDET";

  return decision;
}

function cleanInternalMarketSourceFallbacks(content: string, language: ResponseLanguage) {
  const cleanReplacement = marketText(
    language,
    "Source category: Planning assumption. External citation metadata was not provided.",
    "Kaynak kategorisi: Planlama varsayımı. Harici atıf metadatası sağlanmadı."
  );

  return content
    .replace(/\bsources(?:\.[a-z0-9_-]+)+\b/gi, cleanReplacement)
    .replace(/\bdeduplicated\.none\.provided\.by\.user\b/gi, cleanReplacement)
    .replace(/\bnone\.provided\.by\.user\b/gi, cleanReplacement)
    .replace(/\bundefined\b/gi, marketText(language, "Not verified", "Doğrulanmadı"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function enforceMarketReportLanguage(
  content: string,
  language: ResponseLanguage,
  context?: AiFinancialModelContext
) {
  let normalized = cleanInternalMarketSourceFallbacks(content, language);

  if (context) {
    const confidenceValue = `${context.investmentScore.confidence}%`;
    normalized = normalized
      .replace(/\b(?:Decision Confidence|Karar Güveni)\s*[:\-–—]\s*\d{1,3}%?(?:\s*\([^)]+\))?/gi, () =>
        language === "Turkish"
          ? `Karar Güveni: ${confidenceValue}`
          : `Decision Confidence: ${confidenceValue}`
      )
      .replace(/\b(?:Confidence|Güven)\s*[:\-–—]\s*\d{1,3}%\b/gi, (match) =>
        /decision|karar/i.test(match)
          ? match
          : language === "Turkish"
            ? `Güven: ${confidenceValue}`
            : `Confidence: ${confidenceValue}`
      );
  }

  if (language === "Turkish") {
    return localizeDeterministicMarketText(normalizeTurkishMarketSourcePhrases(normalized), language)
      .replace(/\bAI Executive Insight\b/g, "AI Yönetici İçgörüsü")
      .replace(/\bMarket Opportunity Score\b/g, "Pazar Fırsatı Skoru")
      .replace(/\bAI Confidence Breakdown\b/g, "AI Güven Dağılımı")
      .replace(/\bFounder Decision Engine\b/g, "Kurucu Karar Motoru")
      .replace(/\bRisk Matrix\b/g, "Risk Matrisi")
      .replace(/\bCEO Brief\b/g, "CEO Özeti")
      .replace(/\bCommentary\s*:/g, "Yorum:")
      .replace(/\bDecision\s*:/g, "Karar:")
      .replace(/\bInvestment Recommendation\s*:/g, "Yatırım Tavsiyesi:")
      .replace(/\bMain Risk\s*:/g, "Ana Risk:")
      .replace(/\bNext Action\s*:/g, "Sonraki Aksiyon:")
      .replace(/\bOwner\s*:/g, "Sahip:")
      .replace(/\bTarget\s*:/g, "Hedef:")
      .replace(/\bTrigger\s*:/g, "Tetikleyici:")
      .replace(/\bAction\s*:/g, "Aksiyon:")
      .replace(/\bStatus\s*:/g, "Durum:")
      .replace(/\bValidation Required\b/g, "Doğrulama gerekli")
      .replace(/\bModel target\b/g, "Model hedefi")
      .replace(/\bWatch\b/g, "İzleme")
      .replace(/\bDecision Confidence\b/g, "Karar Güveni")
      .replace(/\bDecision posture\b/g, "Karar duruşu")
      .replace(/\bPASS\b/g, "GEÇ")
      .replace(/\bHOLD\b/g, "BEKLE")
      .replace(/\bVALIDATE\b/g, "DOĞRULA")
      .replace(/\bREJECT\b/g, "REDDET")
      .trim();
  }

  return localizeDeterministicMarketText(normalized, language)
    .replace(/\bAI Yönetici İçgörüsü\b/g, "AI Executive Insight")
    .replace(/\bPazar Fırsatı Skoru\b/g, "Market Opportunity Score")
    .replace(/\bAI Güven Dağılımı\b/g, "AI Confidence Breakdown")
    .replace(/\bKurucu Karar Motoru\b/g, "Founder Decision Engine")
    .replace(/\bRisk Matrisi\b/g, "Risk Matrix")
    .replace(/\bCEO Özeti\b/g, "CEO Brief")
    .replace(/\bYorum\s*:/g, "Commentary:")
    .replace(/\bKarar\s*:/g, "Decision:")
    .replace(/\bKarar Güveni\b/g, "Decision Confidence")
    .replace(/\bYatırım Tavsiyesi\s*:/g, "Investment Recommendation:")
    .replace(/\bAna Risk\s*:/g, "Main Risk:")
    .replace(/\bSonraki Aksiyon\s*:/g, "Next Action:")
    .replace(/\bSahip\s*:/g, "Owner:")
    .replace(/\bHedef\s*:/g, "Target:")
    .replace(/\bTetikleyici\s*:/g, "Trigger:")
    .replace(/\bAksiyon\s*:/g, "Action:")
    .replace(/\bDurum\s*:/g, "Status:")
    .replace(/\bDoğrulama gerekli\b/gi, "Validation Required")
    .replace(/\bModel hedefi\b/gi, "Model target")
    .replace(/\bİzleme\b/g, "Watch")
    .replace(/\bGEÇ\b/g, "PASS")
    .replace(/\bBEKLE\b/g, "HOLD")
    .replace(/\bDOĞRULA\b/g, "VALIDATE")
    .replace(/\bREDDET\b/g, "REJECT")
    .trim();
}

function buildMarketExecutiveInsight(
  context: AiFinancialModelContext,
  focus: string,
  language: ResponseLanguage
) {
  return marketText(
    language,
    `AI Executive Insight: ${focus} matters because the founder should validate ${context.investmentScore.nextCriticalAction.toLowerCase()} before committing spend against the beachhead demand signal and ${context.metrics.cacPayback.displayValue} payback assumption.`,
    `AI Yönetici İçgörüsü: ${focus}, kurucunun başlangıç pazar talebi ve ${context.metrics.cacPayback.displayValue} geri ödeme varsayımına karşı harcama yapmadan önce ${context.investmentScore.nextCriticalAction.toLowerCase()} konusunu doğrulaması gerektiği için önemlidir.`
  );
}

function cleanTamSamSomCommentary(content: string) {
  return content
    .replace(/\b(?:AI\s+)?Executive Insight\s*[:\-–—][\s\S]*$/i, "")
    .replace(/\b(?:yorum|interpretation|commentary)\s*[:\-–—][\s\S]*$/i, "")
    .replace(/\b(?:TAM|SAM|SOM)\s*[:\-–—][\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTamSamSomCommentary(content: string) {
  const line = sanitizeMarketReportContent(content)
    .split("\n")
    .map((item) => item.trim().replace(/^[-*•]\s*/, ""))
    .find((item) => /^(yorum|interpretation|commentary)\s*[:\-–—]/i.test(item));

  return line
    ? cleanTamSamSomCommentary(
        line.replace(/^(yorum|interpretation|commentary)\s*[:\-–—]\s*/i, "")
      )
    : "";
}

function buildCanonicalMarketTamSamSomSection(
  context: AiFinancialModelContext,
  sourceContent = "",
  language: ResponseLanguage
) {
  const { tam, sam, som } = context.metrics;
  const commentary =
    extractTamSamSomCommentary(sourceContent) ||
    marketText(
      language,
      "Treat the sizing as a directional market-entry model until category boundaries, serviceable segment, and obtainable wedge are validated with current market evidence.",
      "Kategori sınırları, hizmet verilebilir segment ve elde edilebilir giriş kaması güncel pazar kanıtıyla doğrulanana kadar bu büyüklükleme yön gösteren bir pazara giriş modeli olarak ele alınmalıdır."
    );

  return sanitizeMarketReportContent(
    [
      `TAM: ${tam.displayValue}`,
      `SAM: ${sam.displayValue}`,
      `SOM: ${som.displayValue}`,
      `${marketLabel(language, "Commentary", "Yorum")}: ${commentary}`,
      buildMarketExecutiveInsight(context, marketText(language, "Market sizing", "Pazar büyüklüğü"), language),
    ].join("\n")
  );
}

function buildMarketOpportunityScore(context: AiFinancialModelContext, language: ResponseLanguage) {
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
    marketText(language, `- Demand Score: ${demand}/100`, `- Talep Skoru: ${demand}/100`),
    marketText(language, `- Competition Score: ${competition}/100`, `- Rekabet Skoru: ${competition}/100`),
    marketText(language, `- Timing Score: ${timing}/100`, `- Zamanlama Skoru: ${timing}/100`),
    marketText(language, `- Execution Difficulty: ${executionDifficulty}/100`, `- Yürütme Zorluğu: ${executionDifficulty}/100`),
    marketText(language, `- Revenue Potential: ${revenuePotential}/100`, `- Gelir Potansiyeli: ${revenuePotential}/100`),
    marketText(language, `- Overall Opportunity Score: ${overall}/100 — strongest when demand, timing, execution feasibility, and revenue potential reinforce the same entry thesis.`, `- Genel Fırsat Skoru: ${overall}/100 — talep, zamanlama, yürütülebilirlik ve gelir potansiyeli aynı giriş tezini desteklediğinde güçlenir.`),
  ];
}

function buildMarketConfidenceBreakdown(context: AiFinancialModelContext, language: ResponseLanguage) {
  const engine = context.investmentScore.decisionEngine;
  const market = scorePercent(engine.marketScore.score, engine.marketScore.maximumScore);
  const competition = scorePercent(engine.competitionScore.score, engine.competitionScore.maximumScore);
  const financial = scorePercent(engine.financialScore.score, engine.financialScore.maximumScore);
  const execution = scorePercent(engine.executionScore.score, engine.executionScore.maximumScore);
  const product = scorePercent(engine.technologyScore.score, engine.technologyScore.maximumScore);
  return [
    marketText(language, `- Decision Confidence: ${context.investmentScore.confidence}% — the single Decision Confidence used across this report.`, `- Karar Güveni: ${context.investmentScore.confidence}% — bu rapor genelinde kullanılan tek Karar Güveni değeridir.`),
    marketText(language, `- Market Confidence: ${market}% — ${engine.marketScore.explanation}`, `- Pazar Güveni: ${market}% — ${engine.marketScore.explanation}`),
    marketText(language, `- Competition Confidence: ${competition}% — ${engine.competitionScore.explanation}`, `- Rekabet Güveni: ${competition}% — ${engine.competitionScore.explanation}`),
    marketText(language, `- Financial Confidence: ${financial}% — ${engine.financialScore.explanation}`, `- Finansal Güven: ${financial}% — ${engine.financialScore.explanation}`),
    marketText(language, `- Execution Confidence: ${execution}% — ${engine.executionScore.explanation}`, `- Yürütme Güveni: ${execution}% — ${engine.executionScore.explanation}`),
    marketText(language, `- Product Confidence: ${product}% — technology/product readiness affects differentiation and defensibility.`, `- Ürün Güveni: ${product}% — teknoloji/ürün hazırlığı farklılaşmayı ve savunulabilirliği etkiler.`),
    marketText(language, "- Decision confidence is driven most by market proof, capital efficiency, execution realism, and validation evidence.", "- Karar güveni en çok pazar kanıtı, sermaye verimliliği, yürütme gerçekçiliği ve doğrulama kanıtından etkilenir."),
  ];
}

function buildMarketRiskMatrix(context: AiFinancialModelContext, language: ResponseLanguage) {
  const risks = context.investmentScore.topRisks.length
    ? context.investmentScore.topRisks
    : language === "Turkish"
      ? ["Talep doğrulama riski", "Rekabet tepkisi riski", "CAC ve geri ödeme riski"]
      : ["Demand validation risk", "Competitive response risk", "CAC and payback risk"];

  return risks.slice(0, 4).map((risk, index) => {
    const probability = index === 0 ? marketText(language, "High", "Yüksek") : marketText(language, "Medium", "Orta");
    const impact = index <= 1 ? marketText(language, "High", "Yüksek") : marketText(language, "Medium", "Orta");
    const severity = index === 0 ? marketText(language, "Critical", "Kritik") : marketText(language, "Material", "Önemli");

    return marketText(
      language,
      `- ${risk} | Probability: ${probability} | Impact: ${impact} | Severity: ${severity} | Mitigation: validate the market signal before scaling entry spend | Early Warning Signal: conversion, pricing, or CAC misses the threshold.`,
      `- ${risk} | Olasılık: ${probability} | Etki: ${impact} | Şiddet: ${severity} | Azaltım: pazara giriş harcamasını ölçeklemeden önce pazar sinyalini doğrula | Erken Uyarı Sinyali: dönüşüm, fiyatlandırma veya CAC eşik altında kalır.`
    );
  });
}

function buildMarketFounderDecisionEngine(context: AiFinancialModelContext, language: ResponseLanguage) {
  return [
    marketText(language, `- If I were the founder: I would first validate ${context.investmentScore.nextCriticalAction.toLowerCase()}.`, `- Kurucu olsaydım: Önce ${context.investmentScore.nextCriticalAction.toLowerCase()} konusunu doğrulardım.`),
    marketText(language, "- What to postpone: broad geographic expansion and multi-channel acquisition until the beachhead proof is repeatable.", "- Ertelenecekler: başlangıç pazar kanıtı tekrarlanabilir olana kadar geniş coğrafi yayılım ve çok kanallı edinim."),
    marketText(language, "- Where to spend money: customer interviews, pricing tests, competitor displacement tests, and the smallest launch asset that proves beachhead demand.", "- Para harcanacak alan: müşteri görüşmeleri, fiyatlandırma testleri, rakipten geçiş testleri ve başlangıç talebini kanıtlayan en küçük lansman varlığı."),
    marketText(language, "- What to avoid: treating category growth as proof of obtainable revenue before willingness-to-pay evidence exists.", "- Kaçınılacaklar: ödeme isteği kanıtı oluşmadan kategori büyümesini elde edilebilir gelir kanıtı saymak."),
  ];
}

function buildCanonicalMarketKpiDashboard(context: AiFinancialModelContext, language: ResponseLanguage) {
  const { metrics, revenueForecast } = context;
  const yearOne = revenueForecast[0];
  const customerLabel =
    context.inputs.industryKey === "mobility"
      ? marketText(language, "active riders", "aktif kullanıcı")
      : marketText(language, "customers", "müşteri");

  return [
    marketText(language, `Acquisition: ${yearOne.customers.toLocaleString("en-US")} ${customerLabel} by Month 12 | Target: ${Math.ceil(yearOne.customers / 12).toLocaleString("en-US")} net new ${customerLabel}/month | Status: Model target`, `Edinim: 12. ayda ${yearOne.customers.toLocaleString("en-US")} ${customerLabel} | Hedef: ayda ${Math.ceil(yearOne.customers / 12).toLocaleString("en-US")} net yeni ${customerLabel} | Durum: Model hedefi`),
    marketText(language, "Activation: Validation Required | Target: prove first paid activation from qualified demand before scaling | Status: Validation required", "Aktivasyon: Doğrulama gerekli | Hedef: ölçeklemeden önce nitelikli talepten ilk ücretli aktivasyonu kanıtla | Durum: Doğrulama gerekli"),
    marketText(language, "Retention: Validation Required | Target: validate repeat purchase or renewal behavior before increasing acquisition spend | Status: Validation required", "Elde Tutma: Doğrulama gerekli | Hedef: edinim harcamasını artırmadan önce tekrar satın alma veya yenileme davranışını doğrula | Durum: Doğrulama gerekli"),
    marketText(language, `Revenue: ${metrics.mrr.displayValue} monthly / ${metrics.arr.displayValue} yearly | Target: Base-case forecast | Status: Model target`, `Gelir: aylık ${metrics.mrr.displayValue} / yıllık ${metrics.arr.displayValue} | Hedef: Baz senaryo tahmini | Durum: Model hedefi`),
    marketText(language, `CAC: ${metrics.cac.displayValue} | Target: maintain CAC within benchmark payback range | Status: Watch`, `CAC: ${metrics.cac.displayValue} | Hedef: CAC değerini referans geri ödeme aralığında tut | Durum: İzleme`),
    marketText(language, `WTP: ${metrics.arpa.displayValue} | Target: validate willingness to pay with paid demand evidence | Status: Validation required`, `Ödeme İsteği: ${metrics.arpa.displayValue} | Hedef: ödeme isteğini ücretli talep kanıtıyla doğrula | Durum: Doğrulama gerekli`),
    marketText(language, "Sales cycle: Validation Required | Target: measure time from qualified lead to first paid conversion | Status: Validation required", "Satış Döngüsü: Doğrulama gerekli | Hedef: nitelikli adaydan ilk ücretli dönüşüme kadar geçen süreyi ölç | Durum: Doğrulama gerekli"),
    marketText(language, "Conversion: Validation Required | Target: prove repeatable conversion before scaling spend | Status: Validation required", "Dönüşüm: Doğrulama gerekli | Hedef: harcamayı ölçeklemeden önce tekrarlanabilir dönüşümü kanıtla | Durum: Doğrulama gerekli"),
  ].join("\n");
}

function getVisibleDecision(context: AiFinancialModelContext) {
  const score = context.investmentScore;

  if (score.recommendation === "GO") return "VALIDATE";
  if (score.recommendation === "PASS" && score.confidence < 35) return "PASS";

  return "HOLD";
}

function buildCanonicalMarketExecutiveRecommendation(
  context: AiFinancialModelContext,
  language: ResponseLanguage
) {
  const confidence = context.investmentScore.confidence;
  const confidenceLabel =
    confidence >= 75
      ? marketText(language, "High", "Yüksek")
      : confidence >= 55
        ? marketText(language, "Medium", "Orta")
        : marketText(language, "Low", "Düşük");
  const decision = localizeMarketDecision(getVisibleDecision(context), language);
  const recommendation =
    decision === localizeMarketDecision("VALIDATE", language)
      ? marketText(language, "Validate market demand with controlled entry spend", "Kontrollü giriş harcamasıyla pazar talebini doğrula")
      : decision === localizeMarketDecision("PASS", language)
        ? marketText(language, "Pass until market access or economics improve", "Pazar erişimi veya ekonomi iyileşene kadar geç")
        : marketText(language, "Hold for validation before scaling entry spend", "Giriş harcamasını ölçeklemeden önce doğrulama için bekle");
  const reportQualityConfidence =
    context.reportIntelligence.confidenceLevel === "High Confidence"
      ? marketText(language, "High Confidence", "Yüksek Güven")
      : context.reportIntelligence.confidenceLevel === "Low Confidence"
        ? marketText(language, "Low Confidence", "Düşük Güven")
        : marketText(language, "Medium Confidence", "Orta Güven");
  const benchmarkActions = context.benchmarkScore.actions.slice(0, 2).join("; ");
  const benchmarkActionsTr = [
    context.benchmarkScore.dimensions.pricingFit < 65 ? "fiyatlandırmayı doğrula" : "",
    context.benchmarkScore.deviations.some((deviation) => deviation.metric === "CAC" && deviation.status !== "Within Benchmark")
      ? "edinim kanallarını test et"
      : "",
    context.benchmarkScore.dimensions.financialBenchmarkFit < 65 ? "ilk sermaye riskini azalt" : "",
  ].filter(Boolean).join("; ") || "benchmark varsayımlarını operasyon verisiyle izle";

  return [
    marketText(language, `Decision: ${decision}`, `Karar: ${decision}`),
    marketText(language, `Decision Confidence: ${confidence}% (${confidenceLabel})`, `Karar Güveni: ${confidence}% (${confidenceLabel})`),
    marketText(language, `Report Quality Confidence: ${reportQualityConfidence} (${context.reportIntelligence.totalScore}/100)`, `Rapor Kalitesi Güveni: ${reportQualityConfidence} (${context.reportIntelligence.totalScore}/100)`),
    marketText(
      language,
      `Validation Intelligence: ${context.validationIntelligenceV2.overallScore}/100 (${context.validationIntelligenceV2.confidenceLevel}). Priority: ${context.validationIntelligenceV2.recommendedSequence[0] || "Validate customer demand"}`,
      `Doğrulama Zekası: ${context.validationIntelligenceV2.overallScore}/100 (${context.validationIntelligenceV2.confidenceLevel === "High" ? "Yüksek" : context.validationIntelligenceV2.confidenceLevel === "Medium" ? "Orta" : "Düşük"}). Öncelik: ${context.validationIntelligenceV2.recommendedSequence[0] === "Validate customer demand" ? "Müşteri talebini doğrula" : context.validationIntelligenceV2.recommendedSequence[0] || "Müşteri talebini doğrula"}`
    ),
    marketText(language, `Benchmark Fit: ${context.benchmarkScore.overallFit}/100 (${context.benchmarkScore.confidence}). ${benchmarkActions}`, `Benchmark Uyumu: ${context.benchmarkScore.overallFit}/100 (${context.benchmarkScore.confidence}). ${benchmarkActionsTr}`),
    marketText(language, `Investment Recommendation: ${recommendation}`, `Yatırım Tavsiyesi: ${recommendation}`),
    marketText(language, `Main Risk: ${context.investmentScore.topRisks[0] || "Market demand requires validation."}`, `Ana Risk: ${context.investmentScore.topRisks[0] || "Pazar talebi doğrulama gerektiriyor."}`),
    marketText(language, `Next Action: ${context.investmentScore.nextCriticalAction}`, `Sonraki Aksiyon: ${context.investmentScore.nextCriticalAction}`),
    formatDecisionConfidenceReport(context, language),
    formatReportIntelligenceSummary(context, language),
  ].join("\n");
}

function buildMarketCeoBrief(context: AiFinancialModelContext, language: ResponseLanguage) {
  const decision = localizeMarketDecision(getVisibleDecision(context), language);
  return [
    marketText(language, `- Decision posture: ${decision}; Decision Confidence is ${context.investmentScore.confidence}/100.`, `- Karar duruşu: ${decision}; Karar Güveni ${context.investmentScore.confidence}/100.`),
    marketText(language, `- Immediate board priority: ${context.investmentScore.nextCriticalAction}`, `- Acil yönetim önceliği: ${context.investmentScore.nextCriticalAction}`),
    marketText(language, `- Validate the beachhead customer for ${context.inputs.targetCustomer} before expanding the entry plan.`, `- Giriş planını genişletmeden önce ${context.inputs.targetCustomer} için başlangıç müşterisini doğrula.`),
    marketText(language, "- Prove willingness to pay before treating the beachhead demand signal as obtainable revenue.", "- Başlangıç talep sinyalini elde edilebilir gelir saymadan önce ödeme isteğini kanıtla."),
    marketText(language, `- Financial discipline depends on keeping CAC payback at or below ${context.metrics.cacPayback.displayValue}.`, `- Finansal disiplin CAC geri ödemesini ${context.metrics.cacPayback.displayValue} veya altında tutmaya bağlıdır.`),
    marketText(language, "- Build one repeatable channel before adding geographies, segments, or acquisition motions.", "- Coğrafya, segment veya edinim hareketi eklemeden önce tek bir tekrarlanabilir kanal kur."),
    marketText(language, "- Avoid confusing broad market growth with reachable demand.", "- Geniş pazar büyümesini erişilebilir taleple karıştırmaktan kaçın."),
    marketText(language, "- Avoid scaling acquisition before pricing and conversion evidence is proven.", "- Fiyatlandırma ve dönüşüm kanıtı oluşmadan edinimi ölçeklemekten kaçın."),
    marketText(language, "- Biggest opportunity: use a narrow entry wedge to convert the first credible beachhead demand into revenue.", "- En büyük fırsat: ilk güvenilir başlangıç talebini gelire çevirmek için dar bir giriş kaması kullanmak."),
    marketText(language, `- Biggest hidden risk: ${context.investmentScore.topRisks[0] || "buyer urgency may be weaker than the market narrative suggests."}`, `- En büyük gizli risk: ${context.investmentScore.topRisks[0] || "alıcı aciliyeti pazar anlatısının ima ettiğinden zayıf olabilir."}`),
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

function buildCanonicalMarketKeyMetrics(context: AiFinancialModelContext, language: ResponseLanguage) {
  const rows =
    language === "Turkish"
      ? [
          ["Talep", "Market Lead", "Nitelikli talep kanıtı", "Talep sinyali zayıf kalırsa", "ICP ve teklif hipotezini daralt"],
          ["Dönüşüm", "GTM Lead", "Tekrarlanabilir ücretli dönüşüm", "Dönüşüm eşiği doğrulanmazsa", "Mesaj, kanal ve fiyat testlerini yenile"],
          ["Ödeme İsteği", "Founder", `${context.metrics.arpa.displayValue} planlama girdisi`, "Ödeme isteği hedefin altında kalırsa", "Paketleme ve fiyat çıpasını yeniden test et"],
          ["CAC", "Growth Lead", `${context.metrics.cac.displayValue} veya daha iyi`, "CAC geri ödeme aralığını aşarsa", "Ücretli kanalı durdur ve daha düşük maliyetli kanala kay"],
          ["Elde Tutma", "Ops Lead", "Tekrar satın alma/yenileme sinyali", "Tekrar davranışı oluşmazsa", "Ürün değer önerisini ve deneyimi yeniden tasarla"],
        ]
      : [
          ["Demand", "Market Lead", "Qualified demand evidence", "Demand signal remains weak", "Narrow ICP and offer hypothesis"],
          ["Conversion", "GTM Lead", "Repeatable paid conversion", "Conversion threshold is not validated", "Retest message, channel, and pricing"],
          ["WTP", "Founder", `${context.metrics.arpa.displayValue} planning input`, "Willingness to pay is below target", "Retest packaging and price anchor"],
          ["CAC", "Growth Lead", `${context.metrics.cac.displayValue} or better`, "CAC exceeds payback range", "Pause paid channel and shift to lower-cost channel"],
          ["Retention", "Ops Lead", "Repeat purchase/renewal signal", "Repeat behavior does not emerge", "Redesign product value proposition and experience"],
        ];

  return rows
    .map(([kpi, owner, target, trigger, action]) =>
      language === "Turkish"
        ? `${kpi}: Sahip: ${owner} | Hedef: ${target} | Tetikleyici: ${trigger} | Aksiyon: ${action}`
        : `${kpi}: Owner: ${owner} | Target: ${target} | Trigger: ${trigger} | Action: ${action}`
    )
    .join("\n");
}

function ensureMarketReportQuality(
  report: Record<MarketReportField, string>,
  context?: AiFinancialModelContext,
  language: ResponseLanguage = "English"
) {
  const normalized = { ...report };

  for (const field of reportFields) {
    normalized[field] = sanitizeMarketReportContent(normalized[field] || "");
  }
  normalized.kpiDashboard = removePlaceholderKpiValues(normalized.kpiDashboard);
  normalized.keyMetrics = removePlaceholderKpiValues(normalized.keyMetrics);

  if (!context) {
    for (const field of reportFields) {
      normalized[field] = enforceMarketReportLanguage(normalized[field], language);
    }

    return normalized;
  }

  const model = context.metrics;

  normalized.kpiDashboard = removePlaceholderKpiValues(buildCanonicalMarketKpiDashboard(context, language));
  normalized.keyMetrics = buildCanonicalMarketKeyMetrics(context, language);
  normalized.tamSamSom = buildCanonicalMarketTamSamSomSection(context, normalized.tamSamSom, language);
  normalized.opportunities = removeTamSamSomOwnershipText(normalized.opportunities);
  normalized.executiveRecommendation = buildCanonicalMarketExecutiveRecommendation(context, language);
  normalized.opportunities = appendIntelligenceBlock(
    normalized.opportunities,
    marketLabel(language, "Market Opportunity Score", "Pazar Fırsatı Skoru"),
    buildMarketOpportunityScore(context, language)
  );
  normalized.competitorAnalysis = appendIntelligenceBlock(
    normalized.competitorAnalysis,
    marketLabel(language, "AI Executive Insight", "AI Yönetici İçgörüsü"),
    [buildMarketExecutiveInsight(context, marketText(language, "Competitive position", "Rekabet konumu"), language)]
  );

  for (const field of ["unitEconomics", "financialDashboard", "kpiDashboard"] as const) {
    normalized[field] = sanitizeMarketReportContent(
      ensureMetricLine(
        normalized[field],
        marketLabel(language, "Gross Margin", "Brüt Marj"),
        model.grossMargin.displayValue,
        `${model.grossMargin.formula}; ${model.grossMargin.benchmarkComparison.toLowerCase()}.`
      )
    );
  }
  normalized.financialDashboard = sanitizeMarketReportContent(
    `${normalized.financialDashboard}\n${formatFinancialConsistencyReport(context, language)}`
  );

  normalized.executiveRecommendation = sanitizeMarketReportContent(normalized.executiveRecommendation);
  normalized.executiveRecommendation = appendIntelligenceBlock(
    normalized.executiveRecommendation,
    marketLabel(language, "AI Confidence Breakdown", "AI Güven Dağılımı"),
    buildMarketConfidenceBreakdown(context, language)
  );
  normalized.executiveRecommendation = appendIntelligenceBlock(
    normalized.executiveRecommendation,
    marketLabel(language, "Founder Decision Engine", "Kurucu Karar Motoru"),
    buildMarketFounderDecisionEngine(context, language)
  );
  normalized.threats = appendIntelligenceBlock(
    normalized.threats,
    marketLabel(language, "Risk Matrix", "Risk Matrisi"),
    buildMarketRiskMatrix(context, language)
  );
  normalized.founderRoadmap = appendIntelligenceBlock(
    normalized.founderRoadmap,
    marketLabel(language, "AI Action Plan", "AI Aksiyon Planı"),
    [
      marketText(language, `- Immediate Actions: ${context.investmentScore.nextCriticalAction}. Expected impact: resolves the highest-risk market-entry decision.`, `- Acil Aksiyonlar: ${context.investmentScore.nextCriticalAction}. Beklenen etki: en riskli pazara giriş kararını çözer.`),
      marketText(language, "- Next 30 Days: validate demand, pricing, and buyer urgency. Expected impact: separates real pull from generic interest.", "- Sonraki 30 Gün: talep, fiyatlandırma ve alıcı aciliyetini doğrula. Beklenen etki: gerçek çekişi genel ilgiden ayırır."),
      marketText(language, "- Next 90 Days: prove one repeatable channel and competitor displacement signal. Expected impact: improves GTM confidence.", "- Sonraki 90 Gün: tek bir tekrarlanabilir kanal ve rakipten geçiş sinyali kanıtla. Beklenen etki: pazara giriş güvenini artırır."),
      marketText(language, "- Next 6 Months: confirm retention intent, payback, and operating cadence. Expected impact: protects capital efficiency.", "- Sonraki 6 Ay: elde tutma niyeti, geri ödeme ve operasyon ritmini doğrula. Beklenen etki: sermaye verimliliğini korur."),
      marketText(language, "- Next 12 Months: expand only after the entry wedge is repeatable. Expected impact: scales from evidence, not narrative.", "- Sonraki 12 Ay: yalnızca giriş kaması tekrarlanabilir olduğunda genişle. Beklenen etki: anlatıdan değil kanıttan ölçeklenir."),
    ]
  );
  normalized.validationPlan = removeLegacyValidationIntelligenceBlock(normalized.validationPlan);
  normalized.validationPlan = appendIntelligenceBlock(
    normalized.validationPlan,
    marketLabel(language, "Validation Intelligence", "Doğrulama Zekası"),
    [formatValidationIntelligenceSummary(context, language)]
  );
  normalized.sources = appendIntelligenceBlock(
    cleanInternalMarketSourceFallbacks(normalized.sources, language),
    marketLabel(language, "Source Intelligence", "Source Intelligence"),
    [formatSourceIntelligenceSummary(context, language)]
  );
  normalized.sources = appendIntelligenceBlock(
    normalized.sources,
    marketLabel(language, "CEO Brief", "CEO Özeti"),
    buildMarketCeoBrief(context, language)
  );
  normalized.sourcesAssumptions = cleanInternalMarketSourceFallbacks(
    normalized.sourcesAssumptions,
    language
  );

  if (
    !hasMeaningfulSwotGroup(normalized.swotAnalysis, "Strengths") ||
    !hasMeaningfulSwotGroup(normalized.swotAnalysis, "Weaknesses") ||
    !hasMeaningfulSwotGroup(normalized.swotAnalysis, "Opportunities") ||
    !hasMeaningfulSwotGroup(normalized.swotAnalysis, "Threats")
  ) {
    normalized.swotAnalysis = sanitizeMarketReportContent(
      buildCanonicalSwotSection(normalized, context, language)
    );
  }

  for (const field of reportFields) {
    normalized[field] = enforceMarketReportLanguage(normalized[field], language, context);
  }

  return normalized;
}

function parseFullMarketReport(
  value: string,
  context?: AiFinancialModelContext,
  language: ResponseLanguage = "English"
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
    report: ensureMarketReportQuality(report, context, language),
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
    `The user's latest message language is ${language}. This overrides saved profile language, persistent memory language, browser locale, and previous conversation language.`,
    `Respond entirely in ${language}.`,
    `Every heading, paragraph, bullet point, table label, markdown label, source note, and sentence must be in ${language}.`,
    language === "Turkish"
      ? "Turkish report glossary: write Food & Beverage / Specialty Coffee as Yiyecek & İçecek / Özel Kahve; D2C Brand + Subscription + B2B as D2C Marka + Abonelik + B2B; Revenue as Gelir; burn as Nakit Yakımı; runway as Finansal Pist; $30/month as $30/ay. Keep CAC, LTV, ARPA, ICP, B2B, B2C, D2C, and HoReCa unchanged."
      : "Use English report labels and financial wording consistently.",
    `If source material is in another language, summarize it only in ${language}.`,
    "Do not switch languages. Do not ask questions or request clarification.",
    "Be current, analytical, evidence-weighted, and decision-oriented for an early-stage founder.",
    "Generate a dedicated market analysis, not a business plan.",
    "Before generating financial metrics, classify the business model from the user's idea context. Use precise categories such as D2C Brand, SaaS, Marketplace, Professional Services, Ecommerce, Subscription, Food & Beverage, Manufacturing, or a clear hybrid such as D2C + Subscription + B2B.",
    "For Food & Beverage, specialty coffee, D2C consumer brands, ecommerce, or subscription commerce ideas, do not use Professional Services assumptions. Use realistic consumer/FMCG assumptions for ARPA/order value, CAC, gross margin, payback period, repeat purchase, subscription retention, customer volume, inventory/COGS, and B2B wholesale where relevant.",
    "D2C, FMCG, and Food & Beverage models must not use SaaS-style growth curves, SaaS ARR quality, near-zero payback, or enterprise ACV assumptions. Treat customer growth, paid acquisition, inventory, wholesale, retail, and subscription retention as validation-sensitive planning assumptions unless the user provides real traction data.",
    "Founder, execution, risk, and investor-readiness scores must depend on evidence quality. If the user provides only an idea with no sales, waitlist, retention, customer, preorder, or pilot data, lower confidence and avoid aggressive break-even or execution scores.",
    language === "Turkish"
      ? "Kullanıcının fikri premium kahve markasıysa, kullanıcı açıkça farklı bir model tarif etmediği sürece sektör adını Yiyecek & İçecek / Özel Kahve ve iş modelini D2C Marka + Abonelik + B2B olarak yaz."
      : "If the idea is a premium coffee brand, classify Industry as Food & Beverage / Specialty Coffee and Business Model as D2C + Subscription + B2B unless the user clearly describes a different model.",
    "The user's exact submitted market/business idea is the anchor for the whole report. Every section must name or clearly reference that idea through industry-specific competitors, customer segments, market trends, risks, planning inputs, and validation actions rather than reusable template paragraphs.",
    "Prioritize market overview, TAM/SAM/SOM, industry trends, competitors, gap analysis, customer pain, opportunities, threats, SWOT, Porter's Five Forces, entry strategy, validation, metrics, sources, and an investment-style verdict.",
    "Write in polished investment memo prose. Use canonical evidence labels only where they materially improve trust for sources, metrics, TAM/SAM/SOM, competitor claims, or KPI assumptions.",
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
    "The Investment Decision Inputs block in the user input contains the calculated investment score, visible decision, estimated valuation, funding stage, decision factors, strengths, weaknesses, top risks, and next critical action. Use those values as the source of truth.",
    "Unit Economics, KPI Dashboard, Financial Dashboard, Scenario Analysis, Financial Assumptions, and Executive Recommendation must reference the same calculated financial model whenever financial metrics appear.",
    "For ARR, MRR, CAC, LTV, Gross Margin, Burn, Runway, EBITDA, and Break-even, financial sections must show value, formula, planning input, evidence label, and reference basis without internal labels. Use only this evidence set: Verified, Benchmark Derived, Planning Assumption, Validation Required.",
    "Add concise evidence metadata where it materially improves trust for market data, financial metrics, KPI assumptions, TAM/SAM/SOM, and competitor insights. Do not over-label ordinary sentences.",
    "Do not expose internal grading labels, source-model labels, or internal recommendation codes anywhere in the final report.",
    "Make reasoning deeply industry-specific for SaaS, AI, Cybersecurity, Healthcare, Logistics, Restaurant, Drone, Marketplace, FinTech, E-commerce, EV Charging, and other detected sectors. KPIs, risks, roadmap logic, and financial interpretation must reflect that sector's economics.",
    "Keep payback, LTV:CAC, CAC, and runway realistic for the sector and capital intensity. If a result looks unusually strong, describe it as a sensitivity case requiring validation rather than a base case.",
    "Decision Confidence must match evidence quality and the calculated decision inputs. Use exactly one visible decision from PASS, HOLD, VALIDATE, or REJECT. Early-stage ideas with validation gaps should prefer HOLD or VALIDATE; reserve REJECT for clearly non-investable economics or execution risk.",
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
    "When writing Executive Recommendation, select exactly one visible decision: PASS, HOLD, VALIDATE, or REJECT.",
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
    const input = `Latest user request language: ${responseLanguage}
Output language hard requirement: ${responseLanguage}. Ignore saved profile language, persistent memory language, browser locale, and previous conversation language.

Business idea: ${promptText}

${financialAssumptionsContext}
${userMemoryInstruction ? `\n${userMemoryInstruction}\n` : ""}

Report section to generate: ${fieldLabelsByLanguage[responseLanguage][reportField]}
Analysis task: ${fieldConfig.prompt}
First perform current web research. Use reliable sources for market size, competitor companies, industry trends, target customers, recent news, pricing models, SWOT inputs, Porter's Five Forces inputs, and entry strategy signals.
Before writing visible output, silently construct the full Integrated Market Strategy Model. Do not output the model.
Derive this section only from that model so market size, ICP, competitors, pricing, GTM, financial implications, risks, and recommendation stay consistent.
Write the section as an investor-grade market diligence note with practical market-entry recommendations for the founder.
Do not lead every section with the same decision-implication formula. Use it only where the section's job requires it.
Use canonical evidence labels only where they materially improve trust for sources, metrics, TAM/SAM/SOM, competitor claims, or KPI assumptions. Do not expose internal confidence tiers or decision-implication labels.
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
Use the Investment Decision Inputs block as the calculated source for Investment Score, visible decision, Decision Confidence, estimated valuation, funding stage, decision factors, strengths, weaknesses, top risks, and next critical action.
Reuse that single calculated model everywhere. Do not create conflicting financial values in separate sections. If a value is directional, say it needs validation and explain why.
Align Decision Confidence with evidence quality and the calculated decision inputs; avoid extreme confidence unless the evidence clearly supports it.
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
        !isReportGenerationFailureText(cachedFullReport.responseText) &&
        detectLanguage(cachedFullReport.responseText) === responseLanguage
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
            canonicalFinancialAssumptions,
            responseLanguage
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
          const cachedReportValidation = validateGeneratedReportSections(parsedCachedReport);
          const cachedSourceReliability = scoreReportSources(parsedCachedReport);
          const cachedLiveEvidence = aggregateReportEvidence({ report: parsedCachedReport });
          const cachedReportConfidence = evaluateReportConfidence({
            report: parsedCachedReport,
            validation: cachedReportValidation,
            sources: cachedSourceReliability,
          });
          const cachedDecisionIntelligence = createExecutiveDecisionIntelligence({
            report: parsedCachedReport,
            validation: cachedReportValidation,
            sources: cachedSourceReliability,
            evidence: cachedLiveEvidence,
            confidence: cachedReportConfidence,
          });

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
              ...cachedReportValidation,
              ...cachedSourceReliability,
              ...cachedLiveEvidence,
              ...cachedReportConfidence,
              ...cachedDecisionIntelligence,
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

          return new Response(encoder.encode(
            serializeMarketReportMetadataChunk(canonicalFinancialAssumptions) +
              cachedWarning +
              serializeMarketReportChunks(parsedCachedReport)
          ), {
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

      const fullReportInput = `Latest user request language: ${responseLanguage}
Output language hard requirement: ${responseLanguage}. Ignore saved profile language, persistent memory language, browser locale, and previous conversation language.

Business idea: ${promptText}

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
Use exactly one visible decision: PASS, HOLD, VALIDATE, or REJECT.
Do not expose internal grading labels, source-model labels, or internal recommendation codes anywhere in the final report.
Align Decision Confidence with evidence quality; avoid extreme confidence values unless the evidence clearly supports them.
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
      const fullReportInputCostMetrics = createAiCostOptimizationMetrics({
        beforeText: `${instructions}\n${fullReportInput}`,
      });
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
        } = parseFullMarketReport(
          responseText,
          canonicalFinancialAssumptions,
          responseLanguage
        );
        const reportValidation = validateGeneratedReportSections(parsedReport);
        const sourceReliability = scoreReportSources(parsedReport);
        const liveEvidence = aggregateReportEvidence({ report: parsedReport });
        const reportConfidence = evaluateReportConfidence({
          report: parsedReport,
          validation: reportValidation,
          sources: sourceReliability,
        });
        const decisionIntelligence = createExecutiveDecisionIntelligence({
          report: parsedReport,
          validation: reportValidation,
          sources: sourceReliability,
          evidence: liveEvidence,
          confidence: reportConfidence,
        });
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
            ...fullReportInputCostMetrics,
            ...reportValidation,
            ...sourceReliability,
            ...liveEvidence,
            ...reportConfidence,
            ...decisionIntelligence,
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

        return new Response(encoder.encode(
          serializeMarketReportMetadataChunk(canonicalFinancialAssumptions) +
            warning +
            serializeMarketReportChunks(parsedReport)
        ), {
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
            ...fullReportInputCostMetrics,
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
          encoder.encode(
            serializeMarketReportMetadataChunk(canonicalFinancialAssumptions) +
              warning +
              serializeMarketReportChunks(fallbackReport)
          ),
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

    if (
      cachedResponse &&
      !isReportGenerationFailureText(cachedResponse.responseText) &&
      detectLanguage(cachedResponse.responseText) === responseLanguage
    ) {
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
