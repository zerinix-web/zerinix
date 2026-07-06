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
  checkUsageAllowance,
  createAiCacheKey,
  estimateAiCostUsd,
  extractTokenUsage,
  getCachedAiResponse,
  getUserPlanTier,
  hashAiPayload,
  recordAiUsage,
  selectAiModel,
  storeCachedAiResponse,
  type TokenUsage,
} from "@/app/lib/ai/governance";
import { createAiJobDescriptor } from "@/app/lib/ai/queue";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const planPrompts = {
  executiveSummary: {
    prompt:
      "Write a premium 2-3 sentence executive summary. Cover the opportunity, objective, and first strategic focus.",
    maxTokens: 700,
  },
  businessModel: {
    prompt:
      "Explain the business model clearly: value proposition, core activities, distribution channels, and differentiation.",
    maxTokens: 850,
  },
  targetCustomer: {
    prompt:
      "Describe the target customer profile, early adopter segment, buying motivation, and core problem.",
    maxTokens: 750,
  },
  revenueModel: {
    prompt:
      "Recommend the revenue model: pricing approach, packaging, recurring revenue, and upsell opportunities.",
    maxTokens: 750,
  },
  roadmap90Days: {
    prompt:
      "Write an actionable roadmap for the first 90 days: days 0-30, 31-60, and 61-90.",
    maxTokens: 850,
  },
  risks: {
    prompt:
      "List the main business risks and mitigation actions for each risk.",
    maxTokens: 700,
  },
  firstCustomerStrategy: {
    prompt:
      "Write a practical go-to-market strategy: target beachhead, channel, offer, messaging, sales motion, launch sequence, and validation method.",
    maxTokens: 800,
  },
  kpiMetrics: {
    prompt:
      "List the KPI metrics to track: acquisition, activation, revenue, retention, and operational metrics.",
    maxTokens: 700,
  },
  successScore: {
    prompt:
      "Give an AI success score from 0-100 and write 2 short reasons.",
    maxTokens: 500,
  },
} as const;

type PlanReportField = keyof typeof planPrompts;

type PlanReportChunk = Record<PlanReportField, string>;

const planFields = Object.keys(planPrompts) as PlanReportField[];

type ResponseLanguage = "English" | "Turkish";

const planFieldLabels: Record<
  ResponseLanguage,
  Record<PlanReportField, string>
> = {
  English: {
    executiveSummary: "Executive Summary",
    businessModel: "Business Model",
    targetCustomer: "Target Customer",
    revenueModel: "Revenue Model",
    roadmap90Days: "90-Day Roadmap",
    risks: "Risks",
    firstCustomerStrategy: "Go-to-Market Strategy",
    kpiMetrics: "KPI Metrics",
    successScore: "AI Success Score",
  },
  Turkish: {
    executiveSummary: "Yönetici Özeti",
    businessModel: "İş Modeli",
    targetCustomer: "Hedef Müşteri",
    revenueModel: "Gelir Modeli",
    roadmap90Days: "90 Günlük Yol Haritası",
    risks: "Riskler",
    firstCustomerStrategy: "Pazara Giriş Stratejisi",
    kpiMetrics: "KPI Metrikleri",
    successScore: "AI Başarı Skoru",
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
  return {
    executiveSummary: field === "executiveSummary" ? content : "",
    businessModel: field === "businessModel" ? content : "",
    targetCustomer: field === "targetCustomer" ? content : "",
    revenueModel: field === "revenueModel" ? content : "",
    roadmap90Days: field === "roadmap90Days" ? content : "",
    risks: field === "risks" ? content : "",
    firstCustomerStrategy: field === "firstCustomerStrategy" ? content : "",
    kpiMetrics: field === "kpiMetrics" ? content : "",
    successScore: field === "successScore" ? content : "",
  };
}

function serializePlanChunk(field: PlanReportField, content: string) {
  return `${JSON.stringify(createPlanChunk(field, content))}\n`;
}

function buildLanguageInstructions(language: ResponseLanguage) {
  return [
    "You are a senior AI business planner working for ZERINIX.",
    `Respond entirely in ${language}.`,
    `Every heading, paragraph, bullet point, table label, markdown label, and sentence must be in ${language}.`,
    `If the user prompt includes another language, still write the final answer only in ${language}.`,
    "Do not switch languages. Do not translate the user's business name unless needed for grammar.",
    "Write premium, clear, actionable analysis dense enough for a real entrepreneur to make decisions.",
  ].join("\n");
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
        { error: "Too many requests." },
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

    if (!isPrivateBetaAllowed(user.email)) {
      return NextResponse.json(
        { error: "Private beta access only." },
        { status: 403 }
      );
    }

    const rateLimit = checkRateLimit(`api:plan:${user.id}:${ip}`, {
      limit: 12,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests." },
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

    if (!isPlanReportField(reportField)) {
      return NextResponse.json(
        { error: "Invalid plan field." },
        { status: 400 }
      );
    }

    const fieldConfig = planPrompts[reportField];
    const instructions = buildLanguageInstructions(responseLanguage);
    const model = selectAiModel("business_plan");
    const input = `Business idea / goal: ${promptText}

Section to generate: ${planFieldLabels[responseLanguage][reportField]}
Task: ${fieldConfig.prompt}

Write only the content for this section. Do not write a JSON object, field name, markdown code block, or any other report section.`;
    const promptHash = hashAiPayload(promptText);
    const cacheKey = createAiCacheKey({
      endpoint: "/api/plan",
      reportField,
      language: responseLanguage,
      model,
      instructions,
      input,
    });
    const planTier = await getUserPlanTier(supabase, user.id);
    const allowance = await checkUsageAllowance(supabase, user.id, planTier);

    if (!allowance.allowed) {
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
        status: "rate_limited",
        responseTimeMs: 0,
        metadata: {
          reason: allowance.reason,
          dailyUsed: allowance.dailyUsed,
          monthlyUsed: allowance.monthlyUsed,
        },
      });

      return NextResponse.json(
        { error: allowance.reason },
        { status: 429 }
      );
    }

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
