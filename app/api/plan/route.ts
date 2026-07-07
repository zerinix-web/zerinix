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

const planPrompts = {
  executiveSummary: {
    prompt:
      "Write an investor-grade Executive Summary with one job only: executive decision. Cover final thesis, investment attractiveness, strongest proof, largest constraint, financial viability signal, and one board-level priority. Do not explain the business model, product, market sizing, SWOT, pricing, GTM, risks, or roadmap. Use no more than one compact evidence/confidence note if it materially changes the verdict. Max 120 words.",
    maxTokens: 650,
  },
  problem: {
    prompt:
      "Define only the customer pain. Explain the painful workflow, current alternatives, urgency, economic cost of inaction, and why the pain is severe enough to investigate. Do not describe the product, market size, pricing, competitors, or solution. Use one evidence/confidence note only if needed. Max 140 words.",
    maxTokens: 650,
  },
  solution: {
    prompt:
      "Describe only the product solution. Cover core experience, differentiated capability, first product scope, defensibility path, and what must be true for the product to win. Do not repeat customer pain, revenue model, GTM, market size, or roadmap. Max 145 words.",
    maxTokens: 750,
  },
  targetCustomer: {
    prompt:
      "Define only the ICP. Include beachhead segment, buyer/user, budget owner, adoption trigger, urgency, willingness to pay, disqualifying profile, and highest-probability first 50 customers. Do not repeat market size, product features, pricing mechanics, or GTM channel tactics. Max 155 words.",
    maxTokens: 750,
  },
  marketOpportunity: {
    prompt:
      "Analyze only market opportunity without calculating TAM/SAM/SOM. Cover category, demand drivers, reachable initial niche, expansion path, venture-scale potential, and validation gates before significant investment. Do not repeat ICP details, competitor mapping, product description, pricing, go-to-market tactics, or market-sizing numbers owned by TAM/SAM/SOM. Max 155 words.",
    maxTokens: 800,
  },
  competitorLandscape: {
    prompt:
      "Map only competitors and substitutes. Include direct competitors, indirect substitutes, incumbent response, positioning map, switching barriers, and the gap for a new entrant. Do not repeat market sizing, SWOT, risks, GTM, or product description. Max 170 words.",
    maxTokens: 850,
  },
  businessModel: {
    prompt:
      "Explain only revenue mechanics. Cover who pays, what they pay for, pricing unit, recurring/transactional logic, gross margin logic, retention loop, operational leverage, and why the model can compound. Do not repeat product features, ICP, acquisition channels, or financial KPI dashboard detail. Max 165 words.",
    maxTokens: 850,
  },
  tamSamSom: {
    prompt:
      "Build only TAM / SAM / SOM. Define market boundaries, reachable segment, near-term obtainable share, sizing assumptions, and confidence. Do not repeat competitor, ICP, GTM, product, pricing, or risk analysis. Do not invent precision; use ranges. Max 145 words.",
    maxTokens: 850,
  },
  swotAnalysis: {
    prompt:
      "Create SWOT with distinct bullets only. Strengths and Weaknesses must focus on internal company/model factors; Opportunities and Threats must be external but must not repeat Risks, Market Opportunity, or Competitor Landscape. Use short bullets and avoid Evidence/Confidence labels unless a bullet depends on a fragile assumption. Max 150 words.",
    maxTokens: 850,
  },
  portersFiveForces: {
    prompt:
      "Analyze only industry forces using Porter's Five Forces. Give a qualitative rating and one founder implication for rivalry, new entrants, buyer power, supplier/platform power, and substitutes. Do not repeat SWOT, risks, or competitor descriptions. Max 160 words.",
    maxTokens: 850,
  },
  pricingStrategy: {
    prompt:
      "Recommend only pricing logic. Include value metric, packaging, entry price logic, premium tier, pilot economics, expansion path, and pricing validation tests. Do not repeat revenue model, unit economics, financial dashboard, or GTM channels. Max 145 words.",
    maxTokens: 750,
  },
  goToMarketPlan: {
    prompt:
      "Write only customer acquisition strategy. Include beachhead positioning, channel thesis, message, launch sequence, proof assets, first 10 customer path, CAC risk, and validation milestones. Do not repeat ICP definition, sales process, roadmap, or pricing logic. Max 165 words.",
    maxTokens: 850,
  },
  salesStrategy: {
    prompt:
      "Write only the enterprise/founder-led sales process. Include account targets, outreach angle, discovery questions, pilot offer, buying objections, procurement friction, closing motion, and first repeatable sales signal. Do not repeat GTM channels, ICP, pricing dashboard, or roadmap. Max 155 words.",
    maxTokens: 800,
  },
  unitEconomics: {
    prompt:
      "Write only financial unit metrics. Include ARPA/ACV if relevant, gross margin, CAC, LTV, LTV:CAC, payback period, retention/churn assumption, and the single assumption that most affects viability. Use numbers and ranges only; no strategic prose, market claims, or GTM explanation. Max 145 words.",
    maxTokens: 850,
  },
  financialDashboard: {
    prompt:
      "Create only high-level financial KPI cards. Use compact lines for Revenue, Expenses, Gross Margin, CAC, LTV, Payback Period, Burn Rate, Runway, EBITDA, Break-even Month, and Investment Needed. Summarize CAC/LTV/payback if already covered by Unit Economics; do not explain them again. No generic commentary. Max 145 words.",
    maxTokens: 950,
  },
  scenarioAnalysis: {
    prompt:
      "Create only future scenarios: Worst Case, Base Case, and Best Case. For each case include trigger conditions, revenue/MRR implication, burn/runway implication, biggest risk, and founder decision. Do not repeat Financial Dashboard or Executive Recommendation wording. Max 170 words.",
    maxTokens: 900,
  },
  kpiDashboard: {
    prompt:
      "Create only the executive KPI Dashboard. Include the 6-8 operating metrics that prove whether the plan is working: acquisition, activation, retention, pipeline, product quality, learning velocity, and revenue signal. Use target threshold and warning threshold only. Do not include CAC, LTV, Gross Margin, Payback, ARR, MRR, Burn, or Runway; those belong to Unit Economics and Financial Dashboard. Do not include roadmap tasks or market claims. Max 135 words.",
    maxTokens: 850,
  },
  executiveRecommendation: {
    prompt:
      "Write only final investment decision. Include exactly four elements: selected decision, confidence level, biggest risks, and next actions. Select exactly one option and no second option: GO, NO GO, WAIT, PIVOT, RAISE, or BOOTSTRAP. Confidence must align with evidence: RAISE usually 70-90 only with strong validation, WAIT usually 40-70, PIVOT/NO GO usually 50-80. Do not restate the business model, market summary, SWOT, roadmap, or financial dashboard. Max 95 words.",
    maxTokens: 650,
  },
  risks: {
    prompt:
      "Write only risks. Include severity, probability, leading indicator, and mitigation for the top market, product, distribution, pricing, regulatory, funding, and execution risks where relevant. Do not repeat SWOT threats, scenario cases, or recommendation wording. Max 155 words.",
    maxTokens: 800,
  },
  kpis: {
    prompt:
      "Define only the KPI governance logic, not another dashboard. For each KPI category, state owner, review cadence, decision trigger, and what action changes if the metric misses. Do not repeat KPI Dashboard values, Unit Economics, Financial Dashboard metrics, roadmap tasks, or market claims. Max 120 words.",
    maxTokens: 750,
  },
  roadmap306090: {
    prompt:
      "Create only the 30-60-90 style milestone timeline with four dependent horizons: 30 Days, 90 Days, 180 Days, and 12 Months. Each horizon must contain milestones and decision gates only. Do not repeat GTM, sales process, KPIs, or founder execution detail from Founder Roadmap. Max 165 words.",
    maxTokens: 900,
  },
  founderRoadmap: {
    prompt:
      "Create only the founder execution plan with Tomorrow, This Week, 30 Days, 90 Days, 180 Days, and 12 Months. Each step must depend on the prior proof point. Focus on founder actions, evidence to collect, owner mindset, and go/no-go threshold. Do not repeat timeline milestones, GTM strategy, or KPIs. Max 185 words.",
    maxTokens: 950,
  },
  financialAssumptions: {
    prompt:
      "Write only assumptions behind the financial model. Derive the chain Revenue -> MRR -> Gross Margin -> CAC -> LTV -> Payback -> Burn -> Runway -> EBITDA. Use real data if present; otherwise state each assumption and why it is reasonable. Do not repeat dashboard numbers except to identify the assumption they depend on. Max 165 words.",
    maxTokens: 1050,
  },
  founderScore: {
    prompt:
      "Write only founder evaluation. Include Overall Score plus sub-scores for Innovation, Market Timing, Competition, Capital Intensity, Execution Difficulty, Revenue Potential, and Risk Level. Use 0-100 scores with one concise reason each. Do not repeat recommendation, roadmap, or risk section. Max 140 words.",
    maxTokens: 800,
  },
  sourcesAssumptions: {
    prompt:
      "List only sources and evidence assumptions. Separate real evidence, inferred assumptions, and missing data. Do not repeat financial or strategic analysis. Do not write vague source claims such as 'industry reports' unless a specific source is named. Use phrases such as 'Assumption based on comparable sector benchmarks', 'Needs validation with primary research', or 'Low confidence until verified'. Max 160 words.",
    maxTokens: 1050,
  },
} as const;

type PlanReportField = keyof typeof planPrompts;

type PlanReportChunk = Partial<Record<PlanReportField, string>>;

const planFields = Object.keys(planPrompts) as PlanReportField[];
const FULL_REPORT_FIELD = "fullReport";
const MAX_AI_CALLS_PER_PLAN_REPORT = 1;
const FULL_REPORT_MAX_OUTPUT_TOKENS = 12_000;

type ResponseLanguage = "English" | "Turkish";

const planFieldLabels: Record<
  ResponseLanguage,
  Record<PlanReportField, string>
> = {
  English: {
    executiveSummary: "Executive Summary",
    problem: "Problem",
    solution: "Solution",
    targetCustomer: "Target Customer / ICP",
    marketOpportunity: "Market Opportunity",
    competitorLandscape: "Competitor Landscape",
    businessModel: "Business Model",
    tamSamSom: "TAM / SAM / SOM",
    swotAnalysis: "SWOT Analysis",
    portersFiveForces: "Porter's Five Forces",
    pricingStrategy: "Pricing Strategy",
    goToMarketPlan: "Go-to-Market Plan",
    salesStrategy: "Sales Strategy",
    unitEconomics: "Unit Economics",
    financialDashboard: "Financial Dashboard",
    scenarioAnalysis: "Scenario Analysis: Worst / Base / Best Case",
    kpiDashboard: "KPI Dashboard",
    executiveRecommendation: "Executive Recommendation",
    risks: "Risks",
    kpis: "KPIs",
    founderRoadmap: "Founder Roadmap",
    roadmap306090: "30-60-90 Day Roadmap",
    financialAssumptions: "Financial Assumptions",
    founderScore: "Founder Score",
    sourcesAssumptions: "Sources / Assumptions",
  },
  Turkish: {
    executiveSummary: "Yönetici Özeti",
    problem: "Problem",
    solution: "Çözüm",
    targetCustomer: "Hedef Müşteri / ICP",
    marketOpportunity: "Pazar Fırsatı",
    competitorLandscape: "Rakip Haritası",
    businessModel: "İş Modeli",
    tamSamSom: "TAM / SAM / SOM",
    swotAnalysis: "SWOT Analizi",
    portersFiveForces: "Porter'ın Beş Gücü",
    pricingStrategy: "Fiyatlandırma Stratejisi",
    goToMarketPlan: "Pazara Giriş Planı",
    salesStrategy: "Satış Stratejisi",
    unitEconomics: "Birim Ekonomisi",
    financialDashboard: "Finansal Dashboard",
    scenarioAnalysis: "Senaryo Analizi: Kötü / Baz / İyi",
    kpiDashboard: "KPI Dashboard",
    executiveRecommendation: "Yönetici Tavsiyesi",
    risks: "Riskler",
    kpis: "KPI'lar",
    founderRoadmap: "Kurucu Yol Haritası",
    roadmap306090: "30-60-90 Gün Yol Haritası",
    financialAssumptions: "Finansal Varsayımlar",
    founderScore: "Kurucu Skoru",
    sourcesAssumptions: "Kaynaklar / Varsayımlar",
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

function isPlanReportField(value: string | undefined): value is PlanReportField {
  return planFields.includes(value as PlanReportField);
}

function createPlanChunk(field: PlanReportField, content: string): PlanReportChunk {
  return { [field]: content };
}

function serializePlanChunk(field: PlanReportField, content: string) {
  return `${JSON.stringify(createPlanChunk(field, content))}\n`;
}

function serializePlanReportChunks(report: Record<PlanReportField, string>) {
  return planFields.map((field) => serializePlanChunk(field, report[field])).join("");
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

function getOpenAiResponseStatusDetails(response: unknown) {
  if (!response || typeof response !== "object") {
    return {
      status: "unknown",
      incompleteReason: "",
      errorMessage: "",
    };
  }

  const status =
    typeof (response as { status?: unknown }).status === "string"
      ? (response as { status: string }).status
      : "unknown";
  const incompleteDetails = (response as { incomplete_details?: unknown })
    .incomplete_details;
  const incompleteReason =
    incompleteDetails &&
    typeof incompleteDetails === "object" &&
    typeof (incompleteDetails as { reason?: unknown }).reason === "string"
      ? (incompleteDetails as { reason: string }).reason
      : "";
  const error = (response as { error?: unknown }).error;
  const errorMessage =
    error &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";

  return {
    status,
    incompleteReason,
    errorMessage,
  };
}

function assertCompletedOpenAiResponse(response: unknown) {
  const details = getOpenAiResponseStatusDetails(response);

  if (details.status !== "completed") {
    throw new Error(
      [
        `OpenAI response ended with status "${details.status}".`,
        details.incompleteReason ? `Incomplete reason: ${details.incompleteReason}.` : "",
        details.errorMessage ? `Provider error: ${details.errorMessage}.` : "",
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
}

function parseFullPlanReport(value: string): Record<PlanReportField, string> {
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(value) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Full report JSON parse failed: ${
        error instanceof Error ? error.message : "Invalid JSON"
      }. outputLength=${value.length}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Full report JSON validation failed: root output was not an object. outputLength=${value.length}`
    );
  }

  const report = {} as Record<PlanReportField, string>;
  const invalidFields: string[] = [];
  const failureFields: string[] = [];

  for (const field of planFields) {
    const content = parsed[field];

    if (typeof content !== "string" || !content.trim()) {
      invalidFields.push(field);
      continue;
    }

    if (isReportGenerationFailureText(content)) {
      failureFields.push(field);
      continue;
    }

    report[field] = content.trim();
  }

  if (invalidFields.length || failureFields.length) {
    throw new Error(
      [
        "Full report JSON validation failed.",
        invalidFields.length ? `Missing/invalid fields: ${invalidFields.join(", ")}.` : "",
        failureFields.length ? `Failure-text fields: ${failureFields.join(", ")}.` : "",
        `outputLength=${value.length}`,
      ]
        .filter(Boolean)
        .join(" ")
    );
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
    console.error("[api:plan] Could not verify AI call budget", {
      reportRequestId,
      error: error.message,
    });

    return 0;
  }

  return count ?? 0;
}

function buildLanguageInstructions(language: ResponseLanguage) {
  return [
    "You are the ZERINIX Business Intelligence Report Engine.",
    "Write like a McKinsey / BCG / Bain partner and Sequoia-style investment analyst preparing a founder diligence memo.",
    `Respond entirely in ${language}.`,
    `Every heading, paragraph, bullet point, table label, markdown label, and sentence must be in ${language}.`,
    `If the user prompt includes another language, still write the final answer only in ${language}.`,
    "Do not switch languages. Do not translate the user's business name unless needed for grammar.",
    "Produce investor-grade, evidence-weighted analysis for early-stage business decisions.",
    "Be specific to the user's idea. Remove generic advice, motivational language, and obvious startup boilerplate.",
    "Use evidence and confidence only where they materially affect a decision. Do not attach Evidence, Confidence, or Decision implication labels to every paragraph.",
    "Avoid repeated label patterns. Prefer concise analyst prose; use Evidence/Confidence labels sparingly and only when uncertainty is important.",
    "Do not use generic AI phrases such as 'It is important to', 'Businesses should', 'This strategy can help', 'In today's market', or 'By leveraging'.",
    "Each report section must contribute a unique analytical job. Do not restate conclusions, paragraphs, metrics, or examples assigned to another section.",
    "Respect strict section ownership: Executive Summary = executive decision only; Problem = customer pain only; Solution = product only; Target Customer = ICP only; Market Opportunity = market attractiveness without TAM/SAM/SOM calculations; TAM/SAM/SOM = market sizing only; Competitor Landscape = competitors only; Business Model = revenue mechanics only; SWOT = internal strengths/weaknesses plus non-duplicative external bullets; Porter's Five Forces = industry forces only; Pricing = pricing logic only; Go-to-Market = customer acquisition only; Sales Strategy = enterprise sales process only; Unit Economics = financial unit metrics only; Financial Dashboard = high-level financial KPIs only; Scenario Analysis = future scenarios only; KPI Dashboard = operating metric values only; KPIs = governance cadence and decision triggers only; Executive Recommendation = final investment decision only; Risks = risks only; Founder Roadmap = founder execution plan only; 30-60-90 Roadmap = timeline only; Financial Assumptions = assumptions only; Founder Score = founder evaluation only; Sources / Assumptions = sources only.",
    "Never repeat the same metric more than once unless necessary. If a metric appears in Unit Economics, later financial sections may summarize it but must not explain it again.",
    "Use one internally consistent server-calculated financial model across Unit Economics, Financial Dashboard, Scenario Analysis, Financial Assumptions, and Executive Recommendation. Reuse exact TAM, SAM, SOM, ARPA, ARR, MRR, CAC, LTV, payback, burn, runway, EBITDA, break-even, investment-needed, ROI, and revenue forecast values unless explicitly updating a scenario.",
    "The Data-Driven Financial Analysis Engine block in the user input contains the calculated base-case financial model. Use those values as the source of truth.",
    "Executive Summary, Business Model, Unit Economics, KPI Dashboard, Financial Dashboard, Scenario Analysis, Financial Assumptions, and Executive Recommendation must reference the same calculated financial model whenever financial metrics appear.",
    "Every financial estimate must include a confidence level. If confidence is Low, label it as an assumption needing validation instead of presenting it as a verified benchmark.",
    "Keep payback, LTV:CAC, CAC, and runway realistic for the sector and capital intensity. If a result looks unusually strong, label it as a sensitivity or low-confidence assumption rather than a base case.",
    "Recommendation confidence must match evidence quality: RAISE normally requires 70-90 with strong validation; WAIT normally sits at 40-70; PIVOT or NO GO normally sits at 50-80 depending on evidence. Do not use extreme confidence values unless justified.",
    "Do not fake source authority. If a precise source is unavailable, use assumption language such as 'Assumption based on comparable sector benchmarks', 'Needs validation with primary research', or 'Low confidence until verified'.",
    "Every section must end with a complete sentence or complete bullet. Never end mid-sentence.",
    "Distinguish facts, assumptions, and hypotheses. Never present guesses as facts.",
    "Use analytical framing: market attractiveness, strategic wedge, competitive gap, monetization logic, execution risk, and investor verdict.",
    "Prefer compact bullets, decision criteria, quantified ranges, and distinct section-specific insights.",
    "If precise market data is unavailable, give transparent assumptions and confidence rather than invented precision.",
    "Do not recommend vague actions such as 'do market research' unless the exact research question, method, and decision impact are specified.",
    "Before writing any visible output, silently build one Integrated Strategy Model for the whole company. Do not reveal this internal model directly.",
    "The hidden Integrated Strategy Model must contain: Business Model, Customer, ICP, Market, Competition, TAM/SAM/SOM, Pricing, Revenue, GTM, Risks, Financial, Assumptions, and Founder priorities.",
    "Every section must be derived from that same hidden model. No section may be written as a standalone independent answer.",
    "Maintain dependency logic across the whole report: Problem changes Solution; Solution changes Pricing; Pricing changes Financial; Financial changes Runway; Runway changes Risk; Risk changes CEO Recommendation.",
    "Financial reasoning must follow this chain: Revenue -> MRR -> Gross Margin -> CAC -> LTV -> Payback -> Burn -> Runway -> EBITDA.",
    "Use real data first when available. If data is missing, create an explicit assumption, explain why it is reasonable, and assign confidence.",
    "The final executive decision must be exactly one of: Launch, Delay, Pivot, Kill, Bootstrap, Raise, Acquire, Merge, Franchise, Licensing, Joint Venture.",
    "When writing Executive Recommendation, select exactly one of: GO, NO GO, WAIT, PIVOT, RAISE, BOOTSTRAP.",
    "Founder Score must include Overall Score, Innovation, Market Timing, Competition, Capital Intensity, Execution Difficulty, Revenue Potential, and Risk Level.",
    "Founder Roadmap must include Tomorrow, This Week, 30 Days, 90 Days, 180 Days, and 12 Months, with each step dependent on the prior proof point.",
  ].join("\n");
}

function isWeakBusinessPrompt(value: string) {
  return isAmbiguousBusinessRequest(value);
}

function clarificationMessage(language: ResponseLanguage) {
  return language === "Turkish"
    ? "Daha güçlü bir iş raporu hazırlamam için lütfen iş fikrini biraz daha aç: ürün/hizmet nedir, hedef müşteri kimdir ve hangi pazarda başlamak istiyorsun?"
    : "Please add a little more detail so I can generate a useful business report: what is the product or service, who is the target customer, and which market do you want to start in?";
}

export async function POST(req: Request) {
  try {
    const ip = getClientIpFromRequest(req);
    const ipRateLimit = checkRateLimit(`api:plan:ip:${ip}`, {
      limit: 30,
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

    const rateLimit = checkRateLimit(`api:plan:${user.id}:${ip}`, {
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

    const { prompt, field, language, reportRequestId: rawReportRequestId } =
      await req.json();
    const promptText = typeof prompt === "string" ? prompt : "";
    const responseLanguage = normalizeLanguage(language, promptText);
    const requestedField = typeof field === "string" ? field : "executiveSummary";
    const isFullReportRequest = requestedField === FULL_REPORT_FIELD;
    const reportField = isFullReportRequest ? "executiveSummary" : requestedField;
    const usageReportField = isFullReportRequest ? FULL_REPORT_FIELD : reportField;
    const reportRequestId =
      typeof rawReportRequestId === "string" ? rawReportRequestId.trim().slice(0, 128) : "";

    if (isWeakBusinessPrompt(promptText)) {
      return NextResponse.json(
        { error: clarificationMessage(responseLanguage) },
        { status: 422 }
      );
    }

    if (!isPlanReportField(reportField)) {
      return NextResponse.json(
        { error: "Invalid plan field." },
        { status: 400 }
      );
    }

    const fieldConfig = planPrompts[reportField];
    const instructions = buildLanguageInstructions(responseLanguage);
    const canonicalFinancialAssumptions = createCanonicalFinancialAssumptions({
      prompt: promptText,
      reportKind: "business_plan",
    });
    const financialAssumptionsContext = formatCanonicalFinancialAssumptions(
      canonicalFinancialAssumptions
    );
    const input = `Business idea / goal: ${promptText}

${financialAssumptionsContext}

Section to generate: ${planFieldLabels[responseLanguage][reportField]}
Task: ${fieldConfig.prompt}

Report quality rules:
- First silently construct the full Integrated Strategy Model. Do not output it.
- Derive this section only from that model, including dependencies from previous strategic choices.
- Use clear headings only if they help this section, but do not repeat the section title.
- Follow the section ownership contract exactly; do not borrow content assigned to another section.
- Do not lead every section with the same decision-implication formula. Use it only where the section's job requires it.
- Use Evidence, Confidence, and Decision implication labels sparingly; do not repeat those labels in every paragraph or bullet.
- Do not repeat ideas, metrics, examples, or conclusions that belong to other sections; this section must add unique value.
- Remove filler phrases such as "It is important to", "Businesses should", "This strategy can help", "In today's market", and "By leveraging".
- Maintain exact financial consistency with the same assumption set across Unit Economics, Financial Dashboard, Scenario Analysis, Financial Assumptions, and Executive Recommendation.
- Use the Data-Driven Financial Analysis Engine block as the calculated base-case model for TAM, SAM, SOM, ARPA, CAC, LTV, Gross Margin, MRR, ARR, Payback, Burn Rate, Runway, EBITDA, Break-even Month, Investment Needed, ROI, and Revenue Forecast.
- Reuse that single calculated model everywhere. Do not create conflicting financial values in separate sections. If a value is low-confidence, warn that it needs validation and explain why.
- Align recommendation confidence with evidence quality; avoid extreme confidence values unless the evidence clearly supports them.
- Use honest assumption language instead of vague source claims such as "industry reports".
- Finish with a complete sentence or complete bullet. Do not end mid-sentence.
- Include practical founder actions, examples, decision criteria, and validation thresholds only when they belong to this section.
- Avoid generic filler such as "conduct market research" unless you specify exactly what to research, how to research it, and what decision it informs.
- Be explicit about assumptions, uncertainty, downside risk, and what would change the recommendation only in sections responsible for those topics.
- Keep financial claims consistent with the chain Revenue -> MRR -> Gross Margin -> CAC -> LTV -> Payback -> Burn -> Runway -> EBITDA.
- Keep the section concise, dense, analytical, and investor-ready.

Write only the content for this section. Do not write a JSON object, field name, markdown code block, or any other report section.`;
    const productionLimit = await checkAiProductionRateLimit({
      supabase,
      userId: user.id,
      endpoint: "/api/plan",
      requestKind: "business_plan",
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
      console.info("[api:plan] quota denied before provider call", {
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
        endpoint: "/api/plan",
        normalizedPrompt: productionLimit.normalizedPrompt,
        mode: `business_plan:${FULL_REPORT_FIELD}:${canonicalFinancialAssumptions.version}:${canonicalFinancialAssumptions.fingerprint}`,
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
        const parsedCachedReport = parseFullPlanReport(cachedFullReport.responseText);

        await recordAiUsage(supabase, {
          userId: user.id,
          endpoint: "/api/plan",
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

        return new Response(encoder.encode(serializePlanReportChunks(parsedCachedReport)), {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        });
      }

      if (cachedFullReport) {
        console.error("[api:plan] Ignoring cached failed full report content", {
          endpoint: "/api/plan",
          reportField: FULL_REPORT_FIELD,
          cacheKey: fullReportCacheKey,
        });
      }

      const existingAiCallCount = await countAiCallsForReport({
        supabase,
        userId: user.id,
        reportRequestId,
      });

      console.info("[api:plan] AI call budget", {
        endpoint: "/api/plan",
        reportRequestId: reportRequestId || null,
        existingAiCallCount,
        maxAiCallsPerReport: MAX_AI_CALLS_PER_PLAN_REPORT,
        requestedField: FULL_REPORT_FIELD,
      });

      if (existingAiCallCount >= MAX_AI_CALLS_PER_PLAN_REPORT) {
        return NextResponse.json(
          {
            error:
              "AI call budget exceeded for this report. Please start a new report request.",
          },
          { status: 429 }
        );
      }

      const fullReportInput = `Business idea / goal: ${promptText}

${financialAssumptionsContext}

Generate the complete Business Plan report as one structured JSON object.
Return exactly these JSON keys and no others:
${planFields.map((fieldName) => `- ${fieldName}: ${planFieldLabels[responseLanguage][fieldName]} — ${planPrompts[fieldName].prompt}`).join("\n")}

Report quality rules:
- First silently construct the full Integrated Strategy Model. Do not output it.
- Derive every section from the same model so the entire report is internally consistent.
- Follow the section ownership contract exactly; do not borrow content assigned to another section.
- Keep each JSON value concise, dense, analytical, investor-ready, and complete.
- Do not repeat ideas, metrics, examples, or conclusions across sections.
- Use the Data-Driven Financial Analysis Engine block as the calculated base-case model for TAM, SAM, SOM, ARPA, CAC, LTV, Gross Margin, MRR, ARR, Payback, Burn Rate, Runway, EBITDA, Break-even Month, Investment Needed, ROI, and Revenue Forecast.
- Reuse that single calculated model everywhere. Do not create conflicting financial values in separate sections. If a value is low-confidence, warn that it needs validation and explain why.
- Align recommendation confidence with evidence quality; avoid extreme confidence values unless the evidence clearly supports them.
- Use honest assumption language instead of vague source claims such as "industry reports".
- Finish every section with a complete sentence or complete bullet. Never end mid-sentence.
- Do not include markdown code fences, braces inside string values, or commentary outside JSON.`;
      const queuedJob = createAiJobDescriptor({
        kind: "business_plan",
        userId: user.id,
        endpoint: "/api/plan",
        reportField: FULL_REPORT_FIELD,
        promptHash,
        language: responseLanguage,
        model,
      });
      const startedAt = Date.now();

      try {
        console.info("[api:plan] provider call started", {
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
            max_output_tokens: FULL_REPORT_MAX_OUTPUT_TOKENS,
            reasoning: {
              effort: "low",
            },
            text: {
              verbosity: "medium",
              format: createFullReportJsonSchema(
                "zerinix_business_plan_report",
                planFields
              ),
            },
          },
          { signal: req.signal }
        );
        const tokenUsage = extractTokenUsage(response);
        const estimatedCostUsd = estimateAiCostUsd(model, tokenUsage);
        const responseTimeMs = Date.now() - startedAt;
        assertCompletedOpenAiResponse(response);
        const responseText = extractResponseText(response);
        if (!responseText.trim()) {
          const details = getOpenAiResponseStatusDetails(response);
          throw new Error(
            `OpenAI response completed without output_text. status=${details.status} outputLength=0`
          );
        }
        const parsedReport = parseFullPlanReport(responseText);
        const cacheResponseText = JSON.stringify(parsedReport);

        if (!isReportGenerationFailureText(cacheResponseText)) {
          await storeCachedAiResponse(supabase, {
            userId: user.id,
            cacheKey: fullReportCacheKey,
            promptHash,
            endpoint: "/api/plan",
            reportField: FULL_REPORT_FIELD,
            language: responseLanguage,
            model,
            responseText: cacheResponseText,
            tokenUsage,
            estimatedCostUsd,
            expiresInDays: 7,
          });
        }

        await recordAiUsage(supabase, {
          userId: user.id,
          endpoint: "/api/plan",
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
            max_ai_calls_per_report: MAX_AI_CALLS_PER_PLAN_REPORT,
            job: queuedJob,
          },
        });

        console.info("[api:plan] provider call completed", {
          reportField: FULL_REPORT_FIELD,
          reportRequestId: reportRequestId || null,
          model,
          providerCalled: true,
          quotaConsumed: !productionLimit.quotaAlreadyCharged,
        });

        return new Response(encoder.encode(serializePlanReportChunks(parsedReport)), {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        });
      } catch (error) {
        await recordAiUsage(supabase, {
          userId: user.id,
          endpoint: "/api/plan",
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
            max_ai_calls_per_report: MAX_AI_CALLS_PER_PLAN_REPORT,
            job: queuedJob,
            failure_reason:
              error instanceof Error && error.message ? error.message : "GenerationFailed",
          },
        });
        console.info("[api:plan] provider call failed", {
          reportField: FULL_REPORT_FIELD,
          reportRequestId: reportRequestId || null,
          model,
          providerCalled: true,
          quotaConsumed: false,
          failureReason:
            error instanceof Error && error.message ? error.message : "GenerationFailed",
        });
        logServerError("api:plan:full-report", error);

        return NextResponse.json(
          { error: "Report generation failed. Please try again later." },
          { status: 502 }
        );
      }
    }

    const cacheKey = createAiCacheKey({
      endpoint: "/api/plan",
      normalizedPrompt: productionLimit.normalizedPrompt,
      mode: `business_plan:${reportField}:${canonicalFinancialAssumptions.version}:${canonicalFinancialAssumptions.fingerprint}`,
      language: responseLanguage,
      model,
    });

    const cachedResponse = await getCachedAiResponse(supabase, user.id, cacheKey);
    const encoder = new TextEncoder();

    if (cachedResponse && !isReportGenerationFailureText(cachedResponse.responseText)) {
      await recordAiUsage(supabase, {
        userId: user.id,
        endpoint: "/api/plan",
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

      return new Response(encoder.encode(serializePlanChunk(reportField, cachedResponse.responseText)), {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    if (cachedResponse) {
      console.error("[api:plan] Ignoring cached failed report content", {
        endpoint: "/api/plan",
        reportField,
        cacheKey,
      });
    }

    const queuedJob = createAiJobDescriptor({
      kind: "business_plan",
      userId: user.id,
      endpoint: "/api/plan",
      reportField,
      promptHash,
      language: responseLanguage,
      model,
    });
    const startedAt = Date.now();

    console.info("[api:plan] provider call started", {
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
          text: {
            verbosity: "medium",
          },
        },
        { signal: req.signal }
      )
      .catch(async (error) => {
        console.info("[api:plan] provider request failed", {
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
          endpoint: "/api/plan",
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
          let streamedText = "";
          let tokenUsage: TokenUsage = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          };

          try {
            for await (const event of stream) {
              if (event.type === "response.output_text.delta") {
                streamedText += event.delta;
                controller.enqueue(
                  encoder.encode(serializePlanChunk(reportField, event.delta))
                );
              }

              if (event.type === "response.output_text.done" && !streamedText) {
                streamedText = event.text;
                controller.enqueue(
                  encoder.encode(serializePlanChunk(reportField, event.text))
                );
              }

              if (event.type === "response.completed") {
                tokenUsage = extractTokenUsage(event.response);
              }
            }

            const estimatedCostUsd = estimateAiCostUsd(model, tokenUsage);
            const responseTimeMs = Date.now() - startedAt;

            if (streamedText && !isReportGenerationFailureText(streamedText)) {
              await storeCachedAiResponse(supabase, {
                userId: user.id,
                cacheKey,
                promptHash,
                endpoint: "/api/plan",
                reportField,
                language: responseLanguage,
                model,
                responseText: streamedText,
                tokenUsage,
                estimatedCostUsd,
                expiresInDays: 7,
              });
            } else if (streamedText) {
              console.error("[api:plan] Refused to cache failed report content", {
                endpoint: "/api/plan",
                reportField,
                cacheKey,
              });
            }

            await recordAiUsage(supabase, {
              userId: user.id,
              endpoint: "/api/plan",
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

            console.info("[api:plan] provider call completed", {
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
              endpoint: "/api/plan",
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
            logServerError("api:plan:stream", error);
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
    logServerError("api:plan", error);

    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 }
    );
  }
}
