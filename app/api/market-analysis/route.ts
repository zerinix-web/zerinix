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

const fieldPrompts: Record<string, { prompt: string; maxTokens: number }> = {
  executiveSummary: {
    prompt:
      "Based on current market research, write a 2-3 sentence executive summary focused on market attractiveness, demand signal, competitor pressure, and entry focus. Do not write a heading. Max 100 words.",
    maxTokens: 1000,
  },
  marketAnalysis: {
    prompt:
      "Analyze market size, growth drivers, category maturity, industry trends, recent news, and demand signals. Be honest about assumptions if exact market size is unavailable. Do not write a heading. Max 190 words.",
    maxTokens: 1800,
  },
  targetAudience: {
    prompt:
      "Describe target customer segments, early adopters, buyer/user roles, budget holders, buying motivations, and adoption barriers based on market signals. Do not write a heading. Max 150 words.",
    maxTokens: 1000,
  },
  revenueModel: {
    prompt:
      "Analyze competitor pricing patterns and recommend pricing/revenue model options. Include price sensitivity, packaging, pilot strategy, and revenue potential. Do not write a heading. Max 150 words.",
    maxTokens: 1000,
  },
  risks: {
    prompt:
      "Write the main market-entry risks and mitigations: competitor response, demand uncertainty, pricing risk, regulatory constraints, switching costs, and channel risk where relevant. Do not write a heading. Max 150 words.",
    maxTokens: 1000,
  },
  roadmap90Days: {
    prompt:
      "Write an actionable market-entry roadmap based on the market realities found in research: days 0-30, 31-60, and 61-90. Prioritize validation, competitor interviews, pricing tests, and first channel experiments. Do not write a heading. Max 170 words.",
    maxTokens: 1400,
  },
  successScore: {
    prompt:
      "Give a market-entry success score from 0-100 based on market size, timing, demand, competition, pricing room, and entry risk; write 2-3 short reasons. Do not write a heading. Max 90 words.",
    maxTokens: 800,
  },
  sources: {
    prompt:
      "List the 4-6 most reliable sources used in the web research. Each line should include source name, short reason for use, and URL. Do not write a heading.",
    maxTokens: 1200,
  },
};

const reportFields = [
  "executiveSummary",
  "marketAnalysis",
  "targetAudience",
  "revenueModel",
  "risks",
  "roadmap90Days",
  "successScore",
  "sources",
] as const;

type MarketReportField = (typeof reportFields)[number];

type MarketReportChunk = Record<MarketReportField, string>;

const fieldLabels: Record<MarketReportField, string> = {
  executiveSummary: "Executive Summary",
  marketAnalysis: "Market Analysis",
  targetAudience: "Target Audience",
  revenueModel: "Revenue Model",
  risks: "Risks",
  roadmap90Days: "90-Day Roadmap",
  successScore: "AI Success Score",
  sources: "Sources",
};

const legacySectionToField: Record<string, string> = {
  "Executive Summary": "executiveSummary",
  "Market Analysis": "marketAnalysis",
  "Target Audience": "targetAudience",
  "Revenue Model": "revenueModel",
  Risks: "risks",
  "90-Day Roadmap": "roadmap90Days",
  "AI Success Score (0-100)": "successScore",
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
    marketAnalysis: "Pazar Analizi",
    targetAudience: "Hedef Kitle",
    revenueModel: "Gelir Modeli",
    risks: "Riskler",
    roadmap90Days: "90 Günlük Yol Haritası",
    successScore: "AI Başarı Skoru",
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
  return {
    executiveSummary: field === "executiveSummary" ? content : "",
    marketAnalysis: field === "marketAnalysis" ? content : "",
    targetAudience: field === "targetAudience" ? content : "",
    revenueModel: field === "revenueModel" ? content : "",
    risks: field === "risks" ? content : "",
    roadmap90Days: field === "roadmap90Days" ? content : "",
    successScore: field === "successScore" ? content : "",
    sources: field === "sources" ? content : "",
  };
}

function serializeReportChunk(field: MarketReportField, content: string) {
  return `${JSON.stringify(createReportChunk(field, content))}\n`;
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
    "You are a professional market analyst working for ZERINIX.",
    `Respond entirely in ${language}.`,
    `Every heading, paragraph, bullet point, table label, markdown label, source note, and sentence must be in ${language}.`,
    `If source material is in another language, summarize it only in ${language}.`,
    "Do not switch languages. Do not ask questions or request clarification.",
    "Be clear, current, market-focused, and actionable for an early-stage founder.",
    "Prioritize market size, trends, competitors, pricing, demand, and entry strategy.",
    "Be honest about assumptions and uncertainty; do not invent precise figures.",
  ].join("\n");
}

function isWeakMarketPrompt(value: string) {
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
      limit: 8,
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

    const { prompt, field, section, language } = await req.json();
    const promptText = typeof prompt === "string" ? prompt : "";
    const responseLanguage = normalizeLanguage(language, promptText);

    if (isWeakMarketPrompt(promptText)) {
      return NextResponse.json(
        { error: clarificationMessage(responseLanguage) },
        { status: 422 }
      );
    }

    const reportField =
      typeof field === "string"
        ? field
        : typeof section === "string"
          ? legacySectionToField[section]
          : undefined;
    const fieldConfig =
      typeof reportField === "string" ? fieldPrompts[reportField] : undefined;

    if (!fieldConfig || !isMarketReportField(reportField)) {
      return NextResponse.json(
        { error: "Invalid report field." },
        { status: 400 }
      );
    }

    const instructions = buildLanguageInstructions(responseLanguage);
    const input = `Business idea: ${promptText}

Report section to generate: ${fieldLabelsByLanguage[responseLanguage][reportField]}
Analysis task: ${fieldConfig.prompt}
First perform current web research. Use reliable sources for market size, competitor companies, industry trends, target customers, recent news, pricing models, and SWOT inputs.
Write the report from the available information with practical market-entry recommendations for the founder.
Avoid generic filler. Use assumptions explicitly when evidence is limited.
Write only the content for this section. Do not write a JSON object, field name, braces, markdown code block, heading, or any other report section.
Do not suggest website URLs, domain names, brand names, or site ideas for the product; write source URLs only in the Sources section.`;
    const productionLimit = await checkAiProductionRateLimit({
      supabase,
      userId: user.id,
      endpoint: "/api/market-analysis",
      requestKind: "market_analysis",
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
      endpoint: "/api/market-analysis",
      normalizedPrompt: productionLimit.normalizedPrompt,
      mode: `market_analysis:${reportField}`,
      language: responseLanguage,
      model,
    });

    const cachedResponse = await getCachedAiResponse(supabase, user.id, cacheKey);
    const encoder = new TextEncoder();

    if (cachedResponse) {
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
            job: queuedJob,
            phase: "openai_request",
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

            if (streamedText) {
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
                job: queuedJob,
              },
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
                job: queuedJob,
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
