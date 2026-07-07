import OpenAI from "openai";
import { NextResponse } from "next/server";
import { isPrivateBetaAllowed } from "@/app/lib/beta-access";
import { isAmbiguousBusinessRequest } from "@/app/lib/business-idea-detection";
import { createClient } from "@/app/lib/supabase/server";
import {
  checkRateLimit,
  getClientIpFromRequest,
  getRateLimitHeaders,
} from "@/app/lib/security/rate-limit";
import { logServerError } from "@/app/lib/security/errors";
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
} from "@/app/lib/ai/financial-assumptions";
import { isReportGenerationFailureText } from "@/app/lib/report-errors";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const fieldPrompts = {
  executiveSummary: {
    prompt:
      "Write an investor-grade Executive Summary with one job only: market verdict. Cover market attractiveness, demand signal, competitive intensity, entry timing, strategic gap, and the founder's most important market decision. Do not repeat TAM/SAM/SOM, SWOT, Porter, competitor, entry-plan, KPI, or source detail. Do not write a heading. Max 115 words.",
    maxTokens: 1000,
  },
  marketOverview: {
    prompt:
      "Analyze only the market overview: category definition, maturity, growth drivers, buyer behavior, adoption barriers, demand signals, and timing. Do not repeat TAM/SAM/SOM numbers, competitor mapping, customer pain points, or entry strategy. Use one evidence/confidence note only if it changes the verdict. Do not write a heading. Max 165 words.",
    maxTokens: 1800,
  },
  tamSamSom: {
    prompt:
      "Estimate only TAM, SAM, and SOM using transparent assumptions and clear sizing logic. Explain market boundaries, reachable segments, adoption constraints, and validation data needed. Do not repeat competitor analysis, customer pain, trends, or entry strategy. Do not invent precision. Do not write a heading. Max 145 words.",
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
      "Analyze only competitors and substitutes: direct competitors, indirect substitutes, incumbent alternatives, positioning map, switching barriers, pricing signals, likely response, and entrant gap. Do not repeat SWOT, threats, market overview, or entry strategy. Do not write a heading. Max 170 words.",
    maxTokens: 1400,
  },
  customerPainPoints: {
    prompt:
      "List only customer pain points: current workarounds, economic cost, switching triggers, urgency level, and interview evidence needed to confirm demand. Do not repeat ICP, solution, competitors, or GTM. Do not write a heading. Max 135 words.",
    maxTokens: 1000,
  },
  opportunities: {
    prompt:
      "Identify only market opportunities: underserved segments, channel openings, pricing gaps, partnership angles, product wedges, regulatory/timing advantages, and why incumbents may not address them. Do not repeat SWOT, entry strategy, or competitor analysis. Do not write a heading. Max 135 words.",
    maxTokens: 1000,
  },
  threats: {
    prompt:
      "Identify only market threats with severity and probability: competitive pressure, demand uncertainty, switching costs, regulation, platform dependency, price compression, trust barriers, data access, and distribution risk. Do not repeat SWOT or Executive Recommendation. Do not write a heading. Max 135 words.",
    maxTokens: 1000,
  },
  swotAnalysis: {
    prompt:
      "Create SWOT with distinct bullets only. Strengths and Weaknesses must focus on internal market-entry position; Opportunities and Threats must be external but must not repeat Opportunities, Threats, Competitor Analysis, or Executive Summary. Keep bullets short and decision-relevant. Do not write a heading. Max 145 words.",
    maxTokens: 1300,
  },
  portersFiveForces: {
    prompt:
      "Analyze only Porter's Five Forces with a qualitative rating and one founder implication for rivalry, new entrants, buyer power, supplier/platform power, and substitutes. Do not repeat SWOT, threats, or competitor descriptions. Do not write a heading. Max 160 words.",
    maxTokens: 1400,
  },
  unitEconomics: {
    prompt:
      "Analyze only Unit Economics implied by the market. Include likely ARPA/ACV, gross margin, CAC, LTV, payback period, retention/churn assumptions, and the one assumption that most affects viability. Use numbers, ranges, and explicit assumptions only; avoid product, market, or GTM prose. Do not write a heading. Max 140 words.",
    maxTokens: 1200,
  },
  financialDashboard: {
    prompt:
      "Create only high-level market-derived financial KPI cards. Use compact lines for Revenue, Expenses, Gross Margin, CAC, LTV, Payback Period, Burn Rate, Runway, EBITDA, Break-even Month, and Investment Needed. Summarize CAC/LTV/payback if already covered by Unit Economics; do not explain again. No generic commentary. Do not write a heading. Max 145 words.",
    maxTokens: 1300,
  },
  scenarioAnalysis: {
    prompt:
      "Create only future scenarios: Worst Case, Base Case, and Best Case. For each case include demand signal, pricing/MRR implication, CAC/payback implication, burn/runway implication, market risk, and founder decision. Do not repeat Financial Dashboard or Executive Recommendation wording. Do not write a heading. Max 170 words.",
    maxTokens: 1200,
  },
  kpiDashboard: {
    prompt:
      "Create only market validation operating metrics. Include demand, conversion, willingness to pay, sales cycle, channel CAC, retention intent, competitor displacement, market pull, and target/warning thresholds. Do not repeat Unit Economics or Validation Plan except as a concise threshold. Do not write a heading. Max 135 words.",
    maxTokens: 1000,
  },
  executiveRecommendation: {
    prompt:
      "Write only final investment decision. Include exactly four elements: selected decision, confidence level, biggest risks, and next actions. Select exactly one option and no second option: GO, NO GO, WAIT, PIVOT, RAISE, or BOOTSTRAP. Confidence must align with evidence: RAISE usually 70-90 only with strong validation, WAIT usually 40-70, PIVOT/NO GO usually 50-80. Do not restate market overview, SWOT, entry plan, or financial dashboard. Do not write a heading. Max 95 words.",
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
      "Create only founder execution roadmap with Tomorrow, This Week, 30 Days, 90 Days, 180 Days, and 12 Months. Each step must depend on the prior market proof point and decision gate. Include only execution actions for market validation, competitive learning, pricing proof, and entry readiness. Do not repeat validation plan or KPI thresholds. Do not write a heading. Max 165 words.",
    maxTokens: 1200,
  },
  sourcesAssumptions: {
    prompt:
      "List only sources and evidence assumptions. Separate real evidence, inferred assumptions, and missing data. Do not repeat market or financial analysis. Do not write vague source claims such as 'industry reports' unless a specific source is named. Use phrases such as 'Assumption based on comparable sector benchmarks', 'Needs validation with primary research', or 'Low confidence until verified'. Do not write a heading. Max 160 words.",
    maxTokens: 1300,
  },
  sources: {
    prompt:
      "List only 4-6 reliable sources used or most relevant for validating this market. Name specific sources when available. Do not use generic phrases such as 'industry reports' as verified evidence. For each source, state the specific evidence it supports and confidence level. If a source is missing, label the item as an assumption needing primary research. Do not repeat analysis. Do not write a heading.",
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
  Turkish: {
    executiveSummary: "Yönetici Özeti",
    marketOverview: "Pazar Genel Görünümü",
    tamSamSom: "TAM / SAM / SOM",
    industryTrends: "Sektör Trendleri",
    targetCustomer: "Hedef Müşteri",
    competitorAnalysis: "Rakip Analizi",
    customerPainPoints: "Müşteri Acı Noktaları",
    opportunities: "Fırsatlar",
    threats: "Tehditler",
    swotAnalysis: "SWOT Analizi",
    portersFiveForces: "Porter'ın Beş Gücü",
    unitEconomics: "Birim Ekonomisi",
    financialDashboard: "Finansal Dashboard",
    scenarioAnalysis: "Senaryo Analizi: Kötü / Baz / İyi",
    kpiDashboard: "KPI Dashboard",
    executiveRecommendation: "Yönetici Tavsiyesi",
    entryStrategy: "Pazara Giriş Stratejisi",
    validationPlan: "Doğrulama Planı",
    keyMetrics: "Temel Metrikler",
    founderRoadmap: "Kurucu Yol Haritası",
    sourcesAssumptions: "Kaynaklar / Varsayımlar",
    sources: "Kaynaklar",
  },
};

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
  return `${JSON.stringify(createReportChunk(field, content))}\n`;
}

function serializeMarketReportChunks(report: Record<MarketReportField, string>) {
  return reportFields
    .map((field) => serializeReportChunk(field, report[field]))
    .join("");
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

function parseFullMarketReport(value: string): Record<MarketReportField, string> {
  const parsed = JSON.parse(value) as Record<string, unknown>;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Report generation failed before every section completed.");
  }

  const report = {} as Record<MarketReportField, string>;

  for (const field of reportFields) {
    const content = parsed[field];

    if (
      typeof content !== "string" ||
      !content.trim() ||
      isReportGenerationFailureText(content)
    ) {
      throw new Error("Report generation failed before every section completed.");
    }

    report[field] = content.trim();
  }

  return report;
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

function extractResponseText(response: unknown) {
  if (!response || typeof response !== "object") {
    return "";
  }

  const outputText = (response as { output_text?: unknown }).output_text;

  if (typeof outputText === "string") {
    return outputText;
  }

  const output = (response as { output?: unknown }).output;

  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) => {
      const content = (item as { content?: unknown }).content;

      return Array.isArray(content) ? content : [];
    })
    .map((part) => {
      const text = (part as { text?: unknown }).text;

      return typeof text === "string" ? text : "";
    })
    .join("");
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
    "Prioritize market overview, TAM/SAM/SOM, industry trends, competitors, gap analysis, customer pain, opportunities, threats, SWOT, Porter's Five Forces, entry strategy, validation, metrics, sources, and an investment-style verdict.",
    "Use evidence and confidence only where they materially affect a decision. Do not attach Evidence, Confidence, or Decision implication labels to every paragraph.",
    "Avoid repeated label patterns. Prefer concise analyst prose; use Evidence/Confidence labels sparingly and only when uncertainty is important.",
    "Do not use generic AI phrases such as 'It is important to', 'Businesses should', 'This strategy can help', 'In today's market', or 'By leveraging'.",
    "Each report section must contribute a unique market diligence job. Do not restate conclusions, paragraphs, metrics, or examples already assigned to another section.",
    "Respect strict section ownership: Executive Summary = market verdict only; Market Overview = category and demand context only; TAM/SAM/SOM = market sizing only; Industry Trends = timing forces only; Target Customer = ICP only; Competitor Analysis = competitors only; Customer Pain Points = pain only; Opportunities and Threats = distinct market openings/risks only; SWOT = non-duplicative matrix only; Porter's Five Forces = industry forces only; Unit Economics = unit metrics only; Financial Dashboard = high-level KPIs only; Scenario Analysis = future scenarios only; KPI Dashboard/Key Metrics = operating validation metrics only; Executive Recommendation = final investment decision only; Entry Strategy = market entry only; Validation Plan = tests only; Founder Roadmap = execution sequence only; Sources / Assumptions and Sources = sources only.",
    "Never repeat the same metric more than once unless necessary. If a metric appears in Unit Economics, later financial sections may summarize it but must not explain it again.",
    "Use one consistent financial assumption set across Unit Economics, Financial Dashboard, Scenario Analysis, and Executive Recommendation. Reuse exact ASP, MRR, CAC, LTV, payback, burn, runway, and investment values unless explicitly updating the scenario.",
    "The Data-Driven Financial Analysis Engine block in the user input contains the calculated base-case financial model. Use those values as the source of truth.",
    "Unit Economics, KPI Dashboard, Financial Dashboard, Scenario Analysis, Financial Assumptions, and Executive Recommendation must reference the same calculated financial model whenever financial metrics appear.",
    "Every financial estimate must include a confidence level. If confidence is Low, label it as an assumption needing validation instead of presenting it as a verified benchmark.",
    "Keep payback, LTV:CAC, CAC, and runway realistic for the sector and capital intensity. If a result looks unusually strong, label it as a sensitivity or low-confidence assumption rather than a base case.",
    "Recommendation confidence must match evidence quality: RAISE normally requires 70-90 with strong validation; WAIT normally sits at 40-70; PIVOT or NO GO normally sits at 50-80 depending on evidence. Do not use extreme confidence values unless justified.",
    "Do not fake source authority. If a precise source is unavailable, use assumption language such as 'Assumption based on comparable sector benchmarks', 'Needs validation with primary research', or 'Low confidence until verified'.",
    "Every section must end with a complete sentence or complete bullet. Never end mid-sentence.",
    "Distinguish facts, assumptions, and hypotheses. Never present guesses as facts.",
    "Be honest about assumptions and uncertainty; do not invent precise figures.",
    "Do not give generic advice. State what the founder should decide, why, what evidence supports it, and what could disprove it.",
    "Before writing any visible output, silently build one Integrated Market Strategy Model for the whole opportunity. Do not reveal this internal model directly.",
    "The hidden Integrated Market Strategy Model must contain: Business Model, Customer, ICP, Market, Competition, TAM/SAM/SOM, Pricing, Revenue, GTM, Risks, Financial assumptions, and Founder priorities.",
    "Every section must be derived from that same hidden model. No section may be written as a standalone independent answer.",
    "Maintain dependency logic across the analysis: Problem changes Solution; Solution changes Pricing; Pricing changes Financial; Financial changes Runway; Runway changes Risk; Risk changes CEO Recommendation.",
    "Where financial market implications appear, reason through Revenue -> MRR -> Gross Margin -> CAC -> LTV -> Payback -> Burn -> Runway -> EBITDA.",
    "Use real data first when available. If data is missing, create an explicit assumption, explain why it is reasonable, and assign confidence.",
    "If a decision implication is needed, choose exactly one of: Launch, Delay, Pivot, Kill, Bootstrap, Raise, Acquire, Merge, Franchise, Licensing, Joint Venture.",
    "When writing Executive Recommendation, select exactly one of: GO, NO GO, WAIT, PIVOT, RAISE, BOOTSTRAP.",
    "Where score or KPI dashboards appear, make them investor-readable with explicit thresholds and confidence.",
    "Founder Roadmap must include Tomorrow, This Week, 30 Days, 90 Days, 180 Days, and 12 Months, with each step dependent on the prior proof point.",
  ].join("\n");
}

function isWeakMarketPrompt(value: string) {
  return isAmbiguousBusinessRequest(value);
}

function clarificationMessage(language: ResponseLanguage) {
  return language === "Turkish"
    ? "Daha güçlü bir pazar analizi için lütfen iş fikrini veya sektörü, hedef müşteriyi ve hedef ülke/pazarı biraz daha detaylandır."
    : "Please add a little more detail for a useful market analysis: the business idea or industry, target customer, and target country or market.";
}

export async function POST(req: Request) {
  try {
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
        { error: clarificationMessage(responseLanguage) },
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

    const instructions = buildLanguageInstructions(responseLanguage);
    const canonicalFinancialAssumptions = createCanonicalFinancialAssumptions({
      prompt: promptText,
      reportKind: "market_analysis",
    });
    const financialAssumptionsContext = formatCanonicalFinancialAssumptions(
      canonicalFinancialAssumptions
    );
    const input = `Business idea: ${promptText}

${financialAssumptionsContext}

Report section to generate: ${fieldLabelsByLanguage[responseLanguage][reportField]}
Analysis task: ${fieldConfig.prompt}
First perform current web research. Use reliable sources for market size, competitor companies, industry trends, target customers, recent news, pricing models, SWOT inputs, Porter's Five Forces inputs, and entry strategy signals.
Before writing visible output, silently construct the full Integrated Market Strategy Model. Do not output the model.
Derive this section only from that model so market size, ICP, competitors, pricing, GTM, financial implications, risks, and recommendation stay consistent.
Write the section as an investor-grade market diligence note with practical market-entry recommendations for the founder.
Do not lead every section with the same decision-implication formula. Use it only where the section's job requires it.
Use Evidence, Confidence, and Decision implication labels sparingly; do not repeat those labels in every paragraph or bullet.
Avoid generic filler. Use assumptions explicitly when evidence is limited and state what would change the verdict.
Follow the section ownership contract exactly; do not borrow content assigned to another section.
Do not repeat ideas, metrics, examples, or conclusions that belong to other sections; this section must add unique value.
Remove filler phrases such as "It is important to", "Businesses should", "This strategy can help", "In today's market", and "By leveraging".
Maintain exact financial consistency with the same assumption set across Unit Economics, Financial Dashboard, Scenario Analysis, and Executive Recommendation.
Use the Data-Driven Financial Analysis Engine block as the calculated base-case model for TAM, SAM, SOM, ARPA, CAC, LTV, Gross Margin, MRR, ARR, Payback, Burn Rate, Runway, EBITDA, Break-even Month, Investment Needed, ROI, and Revenue Forecast.
Reuse that single calculated model everywhere. Do not create conflicting financial values in separate sections. If a value is low-confidence, warn that it needs validation and explain why.
Align recommendation confidence with evidence quality; avoid extreme confidence values unless the evidence clearly supports them.
Use honest assumption language instead of vague source claims such as "industry reports".
Finish with a complete sentence or complete bullet. Do not end mid-sentence.
Use structured markdown inside the section when useful: short paragraphs, bullets, or compact tables.
Write only the content for this section. Do not write a JSON object, field name, braces, markdown code block, heading, or any other report section.
Do not generate business-plan sections here. Do not suggest website URLs, domain names, brand names, or site ideas for the product.`;
    const productionLimit = await checkAiProductionRateLimit({
      supabase,
      userId: user.id,
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
      report_request_id: reportRequestId || null,
      usage_kind: "section_generation",
    };

    if (!productionLimit.allowed) {
      console.info("[api:market-analysis] quota denied before provider call", {
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
        normalizedPrompt: productionLimit.normalizedPrompt,
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
        const parsedCachedReport = parseFullMarketReport(cachedFullReport.responseText);

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
            quota_consumed: false,
            report_request_id: reportRequestId || null,
            usage_kind: "full_report_cache_hit",
            actual_ai_call: false,
            cachedEstimatedCostUsd: cachedFullReport.estimatedCostUsd,
          },
        });

        return new Response(encoder.encode(serializeMarketReportChunks(parsedCachedReport)), {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        });
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

      console.info("[api:market-analysis] AI call budget", {
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

Generate the complete Market Analysis report as one structured JSON object.
Return exactly these JSON keys and no others:
${reportFields.map((fieldName) => `- ${fieldName}: ${fieldLabelsByLanguage[responseLanguage][fieldName]} — ${fieldPrompts[fieldName].prompt}`).join("\n")}

First perform current web research in this single request. Use reliable sources for market size, competitor companies, industry trends, target customers, recent news, pricing models, SWOT inputs, Porter's Five Forces inputs, and entry strategy signals.
Before writing visible output, silently construct the full Integrated Market Strategy Model. Do not output the model.
Derive every section only from that model so market size, ICP, competitors, pricing, GTM, financial implications, risks, and recommendation stay consistent.
Follow the section ownership contract exactly; do not borrow content assigned to another section.
Do not repeat ideas, metrics, examples, or conclusions across sections.
Use the Data-Driven Financial Analysis Engine block as the calculated base-case model for TAM, SAM, SOM, ARPA, CAC, LTV, Gross Margin, MRR, ARR, Payback, Burn Rate, Runway, EBITDA, Break-even Month, Investment Needed, ROI, and Revenue Forecast.
Reuse that single calculated model everywhere. Do not create conflicting financial values in separate sections. If a value is low-confidence, warn that it needs validation and explain why.
Align recommendation confidence with evidence quality; avoid extreme confidence values unless the evidence clearly supports them.
Use honest assumption language instead of vague source claims such as "industry reports".
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
        console.info("[api:market-analysis] provider call started", {
          reportField: FULL_REPORT_FIELD,
          reportRequestId: reportRequestId || null,
          model,
          providerCalled: true,
          quotaConsumed: false,
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
        const parsedReport = parseFullMarketReport(responseText);
        const cacheResponseText = JSON.stringify(parsedReport);

        if (!isReportGenerationFailureText(cacheResponseText)) {
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
            quota_consumed: !productionLimit.quotaAlreadyCharged,
            report_request_id: reportRequestId || null,
            usage_kind: "full_report_generation",
            actual_ai_call: true,
            max_ai_calls_per_report: MAX_AI_CALLS_PER_MARKET_REPORT,
            job: queuedJob,
          },
        });

        console.info("[api:market-analysis] provider call completed", {
          reportField: FULL_REPORT_FIELD,
          reportRequestId: reportRequestId || null,
          model,
          providerCalled: true,
          quotaConsumed: !productionLimit.quotaAlreadyCharged,
        });

        return new Response(encoder.encode(serializeMarketReportChunks(parsedReport)), {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        });
      } catch (error) {
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
        console.info("[api:market-analysis] provider call failed", {
          reportField: FULL_REPORT_FIELD,
          reportRequestId: reportRequestId || null,
          model,
          providerCalled: true,
          quotaConsumed: false,
          failureReason:
            error instanceof Error && error.message ? error.message : "GenerationFailed",
        });
        logServerError("api:market-analysis:full-report", error);

        return NextResponse.json(
          { error: "Market analysis could not be generated." },
          { status: 502 }
        );
      }
    }

    const cacheKey = createAiCacheKey({
      endpoint: "/api/market-analysis",
      normalizedPrompt: productionLimit.normalizedPrompt,
      mode: `market_analysis:${reportField}:${canonicalFinancialAssumptions.version}:${canonicalFinancialAssumptions.fingerprint}`,
      language: responseLanguage,
      model,
    });

    const cachedResponse = await getCachedAiResponse(supabase, user.id, cacheKey);
    const encoder = new TextEncoder();

    if (cachedResponse && !isReportGenerationFailureText(cachedResponse.responseText)) {
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

    console.info("[api:market-analysis] provider call started", {
      reportField,
      reportRequestId: reportRequestId || null,
      model,
      providerCalled: true,
      quotaConsumed: false,
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
        console.info("[api:market-analysis] provider request failed", {
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

            console.info("[api:market-analysis] provider call completed", {
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
