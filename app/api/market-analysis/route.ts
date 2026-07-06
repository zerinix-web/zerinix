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

const fieldPrompts = {
  executiveSummary: {
    prompt:
      "Write a concise executive summary of the market analysis. Cover market attractiveness, demand signal, competitive intensity, entry timing, and the most important founder decision. Do not write a heading. Max 120 words.",
    maxTokens: 1000,
  },
  marketOverview: {
    prompt:
      "Analyze the market overview: category definition, maturity, growth drivers, buyer behavior, adoption barriers, and current demand signals. Be honest about assumptions if exact figures are unavailable. Do not write a heading. Max 180 words.",
    maxTokens: 1800,
  },
  tamSamSom: {
    prompt:
      "Estimate TAM, SAM, and SOM using transparent assumptions. Explain the sizing logic, what would make the market larger or smaller, and what the founder should validate. Do not invent precise numbers; qualify uncertainty. Do not write a heading. Max 170 words.",
    maxTokens: 1400,
  },
  industryTrends: {
    prompt:
      "Identify the most relevant industry trends, technology shifts, buyer behavior changes, regulatory or macro forces, and recent news shaping the market. Do not write a heading. Max 160 words.",
    maxTokens: 1200,
  },
  targetCustomer: {
    prompt:
      "Describe target customer segments, early adopters, buyer/user roles, budget holders, buying motivations, adoption barriers, and the best initial beachhead. Do not write a heading. Max 150 words.",
    maxTokens: 1000,
  },
  competitorAnalysis: {
    prompt:
      "Analyze direct competitors, indirect substitutes, incumbent alternatives, positioning gaps, likely competitor response, and where a new entrant can differentiate. Do not write a heading. Max 180 words.",
    maxTokens: 1400,
  },
  customerPainPoints: {
    prompt:
      "List the most important customer pain points, current workarounds, switching triggers, urgency level, and evidence the founder should collect in interviews. Do not write a heading. Max 150 words.",
    maxTokens: 1000,
  },
  opportunities: {
    prompt:
      "Identify practical market opportunities: underserved segments, channel openings, pricing gaps, partnership angles, product wedges, and timing advantages. Do not write a heading. Max 150 words.",
    maxTokens: 1000,
  },
  threats: {
    prompt:
      "Identify market threats: competitive pressure, demand uncertainty, switching costs, regulation, platform dependency, price compression, trust barriers, and distribution risk. Do not write a heading. Max 150 words.",
    maxTokens: 1000,
  },
  swotAnalysis: {
    prompt:
      "Create a concise SWOT analysis with Strengths, Weaknesses, Opportunities, and Threats. Use bullets and keep it specific to the user's idea and market. Do not write a heading. Max 180 words.",
    maxTokens: 1300,
  },
  portersFiveForces: {
    prompt:
      "Analyze Porter's Five Forces: competitive rivalry, threat of new entrants, buyer power, supplier/platform power, and threat of substitutes. Rate each force qualitatively and explain founder implications. Do not write a heading. Max 190 words.",
    maxTokens: 1400,
  },
  entryStrategy: {
    prompt:
      "Recommend an entry strategy: beachhead segment, positioning, first channel, initial offer, pricing/pilot approach, credibility assets, and wedge to expand. Do not write a heading. Max 180 words.",
    maxTokens: 1300,
  },
  validationPlan: {
    prompt:
      "Write a validation plan for the first 30-45 days. Include customer interviews, competitor research, pricing tests, landing page or concierge MVP, success criteria, and kill/pivot signals. Do not write a heading. Max 180 words.",
    maxTokens: 1300,
  },
  keyMetrics: {
    prompt:
      "Define the key market validation metrics: demand, conversion, willingness to pay, sales cycle, retention intent, channel cost, and competitor displacement signals. Do not write a heading. Max 140 words.",
    maxTokens: 900,
  },
  sources: {
    prompt:
      "List 4-6 reliable sources used or most relevant for validating this market. Include source name and the specific evidence it supports. Do not write a heading.",
    maxTokens: 1200,
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
  "entryStrategy",
  "validationPlan",
  "keyMetrics",
  "sources",
] as const;

type MarketReportField = (typeof reportFields)[number];

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
  entryStrategy: "Entry Strategy",
  validationPlan: "Validation Plan",
  keyMetrics: "Key Metrics",
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
  "Entry Strategy": "entryStrategy",
  "Validation Plan": "validationPlan",
  "Key Metrics": "keyMetrics",
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
    entryStrategy: "Pazara Giriş Stratejisi",
    validationPlan: "Doğrulama Planı",
    keyMetrics: "Temel Metrikler",
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
    "Generate a dedicated market analysis, not a business plan.",
    "Prioritize market overview, TAM/SAM/SOM, trends, competitors, customer pain, opportunities, threats, SWOT, Porter's Five Forces, entry strategy, validation, metrics, and sources.",
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

    const reportField =
      typeof field === "string"
        ? field
        : typeof section === "string"
          ? legacySectionToField[section]
          : undefined;

    if (!isMarketReportField(reportField)) {
      return NextResponse.json(
        { error: "Invalid report field." },
        { status: 400 }
      );
    }

    const fieldConfig = fieldPrompts[reportField];

    const instructions = buildLanguageInstructions(responseLanguage);
    const input = `Business idea: ${promptText}

Report section to generate: ${fieldLabelsByLanguage[responseLanguage][reportField]}
Analysis task: ${fieldConfig.prompt}
First perform current web research. Use reliable sources for market size, competitor companies, industry trends, target customers, recent news, pricing models, SWOT inputs, Porter's Five Forces inputs, and entry strategy signals.
Write the report from the available information with practical market-entry recommendations for the founder.
Avoid generic filler. Use assumptions explicitly when evidence is limited.
Use structured markdown inside the section when useful: short paragraphs, bullets, or compact tables.
Write only the content for this section. Do not write a JSON object, field name, braces, markdown code block, heading, or any other report section.
Do not generate business-plan sections here. Do not suggest website URLs, domain names, brand names, or site ideas for the product.`;
    const productionLimit = await checkAiProductionRateLimit({
      supabase,
      userId: user.id,
      endpoint: "/api/market-analysis",
      requestKind: "market_analysis",
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
          ...sectionUsageMetadata,
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
                ...sectionUsageMetadata,
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
                ...sectionUsageMetadata,
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
