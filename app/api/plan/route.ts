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

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const planPrompts = {
  executiveSummary: {
    prompt:
      "Write an investor-grade executive summary that synthesizes the whole report instead of previewing every later section. Cover only the final thesis, investment attractiveness, strongest proof, largest constraint, financial viability signal, and one board-level priority. Do not repeat detailed market, SWOT, pricing, or roadmap content. Max 140 words.",
    maxTokens: 650,
  },
  problem: {
    prompt:
      "Define the concrete customer problem as an investment diligence issue. Explain the painful workflow, current alternatives, urgency, economic cost of inaction, and why this pain can support a venture-scale opportunity. Include Evidence and Confidence. Max 150 words.",
    maxTokens: 650,
  },
  solution: {
    prompt:
      "Describe the solution as a strategic product thesis. Cover the core experience, differentiated capability, initial product scope, defensibility path, and what must be true for the solution to win. Include Evidence and Confidence. Max 160 words.",
    maxTokens: 750,
  },
  targetCustomer: {
    prompt:
      "Define the ICP with consulting-level precision. Include beachhead segment, buyer/user, budget owner, adoption trigger, urgency, willingness to pay, disqualifying profile, and the highest-probability first 50 customers. Include Evidence and Confidence. Max 170 words.",
    maxTokens: 750,
  },
  marketOpportunity: {
    prompt:
      "Analyze only market opportunity and competition context. Cover market category, demand drivers, reachable initial niche, expansion path, venture-scale ceiling, competitive intensity, and validation gates before significant investment. Do not repeat ICP details, product description, or go-to-market tactics. Max 190 words.",
    maxTokens: 800,
  },
  competitorLandscape: {
    prompt:
      "Map the competitor landscape like an investor diligence note. Include direct competitors, indirect substitutes, incumbent response, positioning map, switching barriers, and where the gap exists for a new entrant. Include Evidence and Confidence. Max 190 words.",
    maxTokens: 850,
  },
  businessModel: {
    prompt:
      "Explain the business model as an investment case. Cover value proposition, revenue mechanics, gross margin logic, acquisition motion, retention loop, operational leverage, and what could make the model structurally attractive. Include Evidence and Confidence. Max 190 words.",
    maxTokens: 850,
  },
  tamSamSom: {
    prompt:
      "Build TAM / SAM / SOM from the integrated strategy model. Define market boundaries, reachable segment, near-term obtainable share, sizing assumptions, evidence, and confidence. This section owns sizing only; do not repeat competitor, GTM, or product strategy. Do not invent precision; use ranges and explain why. Max 180 words.",
    maxTokens: 850,
  },
  swotAnalysis: {
    prompt:
      "Create a decision-oriented SWOT Analysis. Each Strength, Weakness, Opportunity, and Threat must add a new diligence insight that is not already stated in the Executive Summary. Use short, specific bullets tied to the strategy model, with Evidence and Confidence only where material. Max 180 words.",
    maxTokens: 850,
  },
  portersFiveForces: {
    prompt:
      "Analyze Porter's Five Forces with a qualitative rating for each force and the founder implication. Cover rivalry, new entrants, buyer power, supplier/platform power, and substitutes. Include Evidence and Confidence. Max 200 words.",
    maxTokens: 850,
  },
  pricingStrategy: {
    prompt:
      "Recommend a pricing strategy based on buyer value, alternatives, urgency, and willingness to pay. Include packaging, entry price logic, premium tier, pilot economics, expansion path, and validation tests. Include Evidence and Confidence. Max 160 words.",
    maxTokens: 750,
  },
  goToMarketPlan: {
    prompt:
      "Write a go-to-market plan with investor-grade execution logic. Include beachhead positioning, channel thesis, message, launch sequence, proof assets, first 10 customer path, CAC risk, and validation milestones. Include Evidence and Confidence. Max 190 words.",
    maxTokens: 850,
  },
  salesStrategy: {
    prompt:
      "Write the sales strategy as a founder-led revenue motion. Include account targets, outreach angle, discovery questions, pilot offer, buying objections, procurement friction, closing motion, and first repeatable sales signal. Include Evidence and Confidence. Max 180 words.",
    maxTokens: 800,
  },
  unitEconomics: {
    prompt:
      "Write Unit Economics as an investor dashboard. Include ARPA/ACV if relevant, gross margin, CAC, LTV, LTV:CAC, payback period, retention/churn assumption, and the assumption that most affects viability. Use numbers, ranges, and assumptions only; avoid strategic prose already covered elsewhere. Max 180 words.",
    maxTokens: 850,
  },
  financialDashboard: {
    prompt:
      "Create a Financial Dashboard focused only on numbers and assumptions. Use compact card-style lines for Revenue, Expenses, Gross Margin, CAC, LTV, Payback Period, Burn Rate, Runway, EBITDA, Break-even Month, and Investment Needed. Every number must be real data or an explicit assumption with reason and confidence. No generic commentary. Max 200 words.",
    maxTokens: 950,
  },
  scenarioAnalysis: {
    prompt:
      "Create Scenario Analysis with Worst Case, Base Case, and Best Case. For each case include trigger conditions, revenue/MRR implication, burn/runway implication, biggest risk, and founder decision. Keep all scenarios consistent with the financial chain. Max 210 words.",
    maxTokens: 900,
  },
  kpiDashboard: {
    prompt:
      "Create a KPI Dashboard for investor monitoring. Include acquisition, activation, retention, revenue, unit economics, pipeline, product quality, and learning metrics. For each metric provide target threshold, warning threshold, and decision implication. Do not repeat roadmap tasks or market claims. Max 180 words.",
    maxTokens: 850,
  },
  executiveRecommendation: {
    prompt:
      "Write the Executive Recommendation with only four elements: investment decision, confidence level, biggest risks, and next actions. Select exactly one option and no second option: GO, NO GO, WAIT, PIVOT, RAISE, or BOOTSTRAP. Confidence must align with evidence: RAISE usually 70-90 only with strong validation, WAIT usually 40-70, PIVOT/NO GO usually 50-80. Never use 10% unless the analysis is unusable. Do not restate the business model, market summary, SWOT, or roadmap. Max 120 words.",
    maxTokens: 650,
  },
  risks: {
    prompt:
      "Write a risk analysis with severity, probability, leading indicators, and mitigations. Cover market, product, distribution, pricing, regulatory, funding, and execution risks where relevant. Include Evidence and Confidence for each top risk. Max 190 words.",
    maxTokens: 800,
  },
  kpis: {
    prompt:
      "Define KPI metrics that an investor or operating partner would inspect. Include acquisition, activation, retention, revenue, pipeline, product quality, unit economics, and decision thresholds for traction. Include Evidence and Confidence. Max 160 words.",
    maxTokens: 750,
  },
  roadmap306090: {
    prompt:
      "Create the Founder Roadmap. It must have four dependent horizons: 30 Days, 90 Days, 180 Days, and 12 Months. Each horizon must depend on the evidence and decision gate from the previous horizon. Cover validation, product, sales, marketing, operations, capital needs, kill/pivot criteria, and founder priorities. Include Confidence where assumptions are weak. Max 230 words.",
    maxTokens: 900,
  },
  founderRoadmap: {
    prompt:
      "Create Founder Roadmap with Tomorrow, This Week, 30 Days, 90 Days, 180 Days, and 12 Months. Each step must depend on the prior step's proof point and decision gate. Include action, owner mindset, evidence to collect, and go/no-go threshold. Max 240 words.",
    maxTokens: 950,
  },
  financialAssumptions: {
    prompt:
      "Write Financial Assumptions entirely from the integrated strategy model. Derive the chain Revenue -> MRR -> Gross Margin -> CAC -> LTV -> Payback -> Burn -> Runway -> EBITDA. Use real data if present; otherwise state each assumption and why it is reasonable. Focus only on assumptions, sensitivity, and numeric implications. Max 200 words.",
    maxTokens: 1050,
  },
  founderScore: {
    prompt:
      "Detail the Founder Score. Include Overall Score plus sub-scores for Innovation, Market Timing, Competition, Capital Intensity, Execution Difficulty, Revenue Potential, and Risk Level. Use 0-100 scores, concise evidence, and confidence for each. Max 190 words.",
    maxTokens: 800,
  },
  sourcesAssumptions: {
    prompt:
      "List Sources / Assumptions. Separate real evidence, inferred assumptions, and missing data. Do not write vague source claims such as 'industry reports' unless a specific source is named. When evidence is not verified, say 'Assumption based on comparable sector benchmarks', 'Needs validation with primary research', or 'Low confidence until verified'. For each assumption, explain the reason, confidence, and which financial or strategic conclusion would change if wrong. Max 210 words.",
    maxTokens: 1050,
  },
} as const;

type PlanReportField = keyof typeof planPrompts;

type PlanReportChunk = Partial<Record<PlanReportField, string>>;

const planFields = Object.keys(planPrompts) as PlanReportField[];

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
    roadmap306090: "Founder Roadmap",
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
    roadmap306090: "Kurucu Yol Haritası",
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
    "Every important claim must include an Evidence note and a Confidence level: High, Medium, or Low.",
    "Avoid repetitive evidence phrasing; when confidence is clear, use compact labels such as Evidence: and Confidence: rather than repeating explanatory boilerplate.",
    "Do not use generic AI phrases such as 'It is important to', 'Businesses should', 'This strategy can help', 'In today's market', or 'By leveraging'.",
    "Each report section must contribute a unique analytical job. Do not restate conclusions, paragraphs, or examples already assigned to another section.",
    "Executive Summary must synthesize the report verdict. Financial sections must focus on numbers and assumptions. Market sections must focus on opportunity and competition. SWOT must not repeat Executive Summary.",
    "Use one consistent financial assumption set across Unit Economics, Financial Dashboard, Scenario Analysis, Financial Assumptions, and Executive Recommendation. Reuse exact ASP, ARR, MRR, CAC, LTV, payback, burn, runway, and investment values unless explicitly updating the scenario.",
    "Keep payback, LTV:CAC, CAC, and runway realistic for the sector and capital intensity. If a result looks unusually strong, label it as a sensitivity or low-confidence assumption rather than a base case.",
    "Recommendation confidence must match evidence quality: RAISE normally requires 70-90 with strong validation; WAIT normally sits at 40-70; PIVOT or NO GO normally sits at 50-80 depending on evidence. Do not use extreme confidence values unless justified.",
    "Do not fake source authority. If a precise source is unavailable, use assumption language such as 'Assumption based on comparable sector benchmarks', 'Needs validation with primary research', or 'Low confidence until verified'.",
    "Every section must end with a complete sentence or complete bullet. Never end mid-sentence.",
    "Distinguish facts, assumptions, and hypotheses. Never present guesses as facts.",
    "Use analytical framing: market attractiveness, strategic wedge, competitive gap, monetization logic, execution risk, and investor verdict.",
    "Prefer compact bullets, decision criteria, and quantified ranges when defensible.",
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
    const reportField = typeof field === "string" ? field : "executiveSummary";
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
    const input = `Business idea / goal: ${promptText}

Section to generate: ${planFieldLabels[responseLanguage][reportField]}
Task: ${fieldConfig.prompt}

Report quality rules:
- First silently construct the full Integrated Strategy Model. Do not output it.
- Derive this section only from that model, including dependencies from previous strategic choices.
- Use clear headings only if they help this section, but do not repeat the section title.
- Lead with the decision implication before details.
- Add Evidence and Confidence for every material assertion.
- Do not repeat ideas that belong to other sections; this section must add unique value.
- Remove filler phrases such as "It is important to", "Businesses should", "This strategy can help", "In today's market", and "By leveraging".
- Maintain exact financial consistency with the same assumption set across Unit Economics, Financial Dashboard, Scenario Analysis, Financial Assumptions, and Executive Recommendation.
- Align recommendation confidence with evidence quality; avoid extreme confidence values unless the evidence clearly supports them.
- Use honest assumption language instead of vague source claims such as "industry reports".
- Finish with a complete sentence or complete bullet. Do not end mid-sentence.
- Include practical founder actions, examples, decision criteria, and validation thresholds.
- Avoid generic filler such as "conduct market research" unless you specify exactly what to research, how to research it, and what decision it informs.
- Be explicit about assumptions, uncertainty, downside risk, and what would change the recommendation.
- Keep financial claims consistent with the chain Revenue -> MRR -> Gross Margin -> CAC -> LTV -> Payback -> Burn -> Runway -> EBITDA.
- Keep the section concise, dense, analytical, and investor-ready.

Write only the content for this section. Do not write a JSON object, field name, markdown code block, or any other report section.`;
    const productionLimit = await checkAiProductionRateLimit({
      supabase,
      userId: user.id,
      endpoint: "/api/plan",
      requestKind: "business_plan",
      promptText,
      reportField,
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
      return NextResponse.json(
        { error: productionLimit.reason },
        { status: 429 }
      );
    }

    const cacheKey = createAiCacheKey({
      endpoint: "/api/plan",
      normalizedPrompt: productionLimit.normalizedPrompt,
      mode: `business_plan:${reportField}`,
      language: responseLanguage,
      model,
    });

    const cachedResponse = await getCachedAiResponse(supabase, user.id, cacheKey);
    const encoder = new TextEncoder();

    if (cachedResponse) {
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
            job: queuedJob,
            phase: "openai_request",
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

            if (streamedText) {
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
                job: queuedJob,
              },
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
                job: queuedJob,
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
