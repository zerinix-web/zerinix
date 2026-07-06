import OpenAI from "openai";
import { NextResponse } from "next/server";
import { isPrivateBetaAllowed } from "@/app/lib/beta-access";
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
      "Write a crisp founder-focused executive summary. Cover the business idea, who it serves, why now, the likely wedge, and the first strategic priority. Be specific to the user's idea. Max 130 words.",
    maxTokens: 650,
  },
  problem: {
    prompt:
      "Define the concrete customer problem. Explain the painful workflow, current alternatives, urgency, and why the problem is worth solving. Avoid generic startup language. Max 130 words.",
    maxTokens: 650,
  },
  solution: {
    prompt:
      "Describe the proposed solution, core product experience, strongest differentiator, and what the first usable version should include. Make it practical for an early-stage founder. Max 150 words.",
    maxTokens: 750,
  },
  targetCustomer: {
    prompt:
      "Define the target customer and ICP. Include the beachhead segment, buyer/user, early adopter traits, buying trigger, budget sensitivity, and disqualifying customer profile. Max 160 words.",
    maxTokens: 750,
  },
  marketOpportunity: {
    prompt:
      "Analyze the market opportunity using explicit assumptions. Cover market category, demand drivers, reachable initial niche, expansion path, and what must be validated before investing heavily. Max 160 words.",
    maxTokens: 800,
  },
  competitorLandscape: {
    prompt:
      "Map the competitor landscape. Include direct competitors, indirect substitutes, likely incumbent behavior, differentiation angles, and where a new entrant can win. Max 170 words.",
    maxTokens: 850,
  },
  businessModel: {
    prompt:
      "Explain the business model: value proposition, customer acquisition motion, delivery model, cost drivers, margins, retention loop, and operational leverage. Max 170 words.",
    maxTokens: 850,
  },
  pricingStrategy: {
    prompt:
      "Recommend a pricing strategy. Include packaging, entry price logic, premium tier or upsell path, trial or pilot approach, and assumptions that must be tested. Max 150 words.",
    maxTokens: 750,
  },
  goToMarketPlan: {
    prompt:
      "Write a go-to-market plan. Include beachhead positioning, channel strategy, message, launch sequence, proof assets, and first validation milestones. Max 170 words.",
    maxTokens: 850,
  },
  salesStrategy: {
    prompt:
      "Write the sales strategy. Include who to contact, outreach angle, discovery questions, pilot offer, buying objections, and closing motion. Max 160 words.",
    maxTokens: 800,
  },
  risks: {
    prompt:
      "List the main risks and mitigation actions. Be honest about market, product, execution, distribution, pricing, regulatory, and funding risks where relevant. Max 170 words.",
    maxTokens: 800,
  },
  kpis: {
    prompt:
      "Define the KPIs. Include acquisition, activation, retention, revenue, sales pipeline, product quality, and learning metrics. Explain what good early traction looks like. Max 150 words.",
    maxTokens: 750,
  },
  roadmap306090: {
    prompt:
      "Create a 30-60-90 day roadmap with specific founder actions, not vague goals. Cover validation, product, sales, marketing, operations, and decision gates. Max 190 words.",
    maxTokens: 900,
  },
  financialAssumptions: {
    prompt:
      "Write financial assumptions for early-stage decision making. Include revenue assumptions, cost categories, unit economics, break-even signals, budget priorities, and assumptions to validate. Max 170 words.",
    maxTokens: 850,
  },
  founderScore: {
    prompt:
      "Give an AI Founder Score out of 100. Include the score, 3 concise reasons, and the single highest-leverage action to improve the score. Max 110 words.",
    maxTokens: 600,
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
    pricingStrategy: "Pricing Strategy",
    goToMarketPlan: "Go-to-Market Plan",
    salesStrategy: "Sales Strategy",
    risks: "Risks",
    kpis: "KPIs",
    roadmap306090: "30-60-90 Day Roadmap",
    financialAssumptions: "Financial Assumptions",
    founderScore: "AI Founder Score out of 100",
  },
  Turkish: {
    executiveSummary: "Yönetici Özeti",
    problem: "Problem",
    solution: "Çözüm",
    targetCustomer: "Hedef Müşteri / ICP",
    marketOpportunity: "Pazar Fırsatı",
    competitorLandscape: "Rakip Haritası",
    businessModel: "İş Modeli",
    pricingStrategy: "Fiyatlandırma Stratejisi",
    goToMarketPlan: "Pazara Giriş Planı",
    salesStrategy: "Satış Stratejisi",
    risks: "Riskler",
    kpis: "KPI'lar",
    roadmap306090: "30-60-90 Günlük Yol Haritası",
    financialAssumptions: "Finansal Varsayımlar",
    founderScore: "100 Üzerinden AI Kurucu Skoru",
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
    "You are a senior AI business report engine working for ZERINIX.",
    `Respond entirely in ${language}.`,
    `Every heading, paragraph, bullet point, table label, markdown label, and sentence must be in ${language}.`,
    `If the user prompt includes another language, still write the final answer only in ${language}.`,
    "Do not switch languages. Do not translate the user's business name unless needed for grammar.",
    "Write a structured, professional, founder-focused business report.",
    "Be specific to the user's idea. Do not use generic filler or broad motivational language.",
    "Make recommendations actionable for early-stage decision making.",
    "Be honest about assumptions, uncertainty, validation needs, and execution risk.",
    "If data is not provided, state a reasonable assumption instead of inventing precise facts.",
  ].join("\n");
}

function isWeakBusinessPrompt(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return true;
  }

  const genericPrompts = new Set([
    "test",
    "deneme",
    "hi",
    "hello",
    "hey",
    "merhaba",
    "selam",
    "ok",
    "okay",
    "start",
    "başla",
  ]);

  if (genericPrompts.has(normalized)) {
    return true;
  }

  const words = normalized.split(" ").filter(Boolean);

  return words.length < 4 && normalized.length < 28;
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

    const { prompt, field, language } = await req.json();
    const promptText = typeof prompt === "string" ? prompt : "";
    const responseLanguage = normalizeLanguage(language, promptText);
    const reportField = typeof field === "string" ? field : "executiveSummary";

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
- Use clear headings only if they help this section, but do not repeat the section title.
- Include practical founder actions, examples, and decision criteria.
- Avoid generic filler such as "conduct market research" unless you specify exactly what to research and why.
- Be honest about assumptions and uncertainty.
- Keep the section concise, dense, and useful.

Write only the content for this section. Do not write a JSON object, field name, markdown code block, or any other report section.`;
    const productionLimit = await checkAiProductionRateLimit({
      supabase,
      userId: user.id,
      endpoint: "/api/plan",
      requestKind: "business_plan",
      promptText,
      reportField,
      ip,
    });
    const { model, planTier, promptHash } = productionLimit;

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
