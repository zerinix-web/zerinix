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
      "Write an investor-grade executive summary of the market analysis. Cover market attractiveness, demand signal, competitive intensity, entry timing, strategic gap, and the founder's most important decision. Include Evidence and Confidence for every major claim. Do not write a heading. Max 150 words.",
    maxTokens: 1000,
  },
  marketOverview: {
    prompt:
      "Analyze the market overview like a strategy diligence memo: category definition, maturity, growth drivers, buyer behavior, adoption barriers, demand signals, and timing. Distinguish facts from assumptions and add Evidence and Confidence. Do not write a heading. Max 200 words.",
    maxTokens: 1800,
  },
  tamSamSom: {
    prompt:
      "Estimate TAM, SAM, and SOM using transparent assumptions and clear sizing logic. Explain market boundaries, reachable segments, adoption constraints, what could expand or shrink the market, and validation data needed. Do not invent precision; include Evidence and Confidence. Do not write a heading. Max 210 words.",
    maxTokens: 1400,
  },
  industryTrends: {
    prompt:
      "Identify the industry trends that matter for investment timing: technology shifts, buyer behavior changes, regulatory or macro forces, recent news, budget movement, and adoption inflection points. Include Evidence and Confidence. Do not write a heading. Max 180 words.",
    maxTokens: 1200,
  },
  targetCustomer: {
    prompt:
      "Describe target customer segments with ICP precision: early adopters, buyer/user roles, budget holders, buying motivations, adoption barriers, urgency, willingness to pay, and the best initial beachhead. Include Evidence and Confidence. Do not write a heading. Max 170 words.",
    maxTokens: 1000,
  },
  competitorAnalysis: {
    prompt:
      "Analyze competitors like an investor diligence section: direct competitors, indirect substitutes, incumbent alternatives, positioning map, switching barriers, pricing signals, likely response, and where a new entrant can exploit a gap. Include Evidence and Confidence. Do not write a heading. Max 210 words.",
    maxTokens: 1400,
  },
  customerPainPoints: {
    prompt:
      "List the highest-value customer pain points, current workarounds, economic cost, switching triggers, urgency level, and interview evidence needed to confirm demand. Include Evidence and Confidence. Do not write a heading. Max 170 words.",
    maxTokens: 1000,
  },
  opportunities: {
    prompt:
      "Identify practical market opportunities with strategic logic: underserved segments, channel openings, pricing gaps, partnership angles, product wedges, regulatory/timing advantages, and why incumbents may not address them. Include Evidence and Confidence. Do not write a heading. Max 170 words.",
    maxTokens: 1000,
  },
  threats: {
    prompt:
      "Identify threats with severity and probability: competitive pressure, demand uncertainty, switching costs, regulation, platform dependency, price compression, trust barriers, data access, and distribution risk. Include Evidence and Confidence. Do not write a heading. Max 170 words.",
    maxTokens: 1000,
  },
  swotAnalysis: {
    prompt:
      "Create a concise SWOT analysis with Strengths, Weaknesses, Opportunities, and Threats. Make each bullet specific, decision-relevant, and evidence-weighted with Confidence. Do not write a heading. Max 200 words.",
    maxTokens: 1300,
  },
  portersFiveForces: {
    prompt:
      "Analyze Porter's Five Forces with a qualitative rating for each force and a founder implication. Cover rivalry, new entrants, buyer power, supplier/platform power, and substitutes. Include Evidence and Confidence for each force. Do not write a heading. Max 210 words.",
    maxTokens: 1400,
  },
  unitEconomics: {
    prompt:
      "Analyze Unit Economics implied by the market. Include likely ARPA/ACV, gross margin, CAC, LTV, payback period, retention/churn assumptions, and what the market suggests about viability. Use real data first; otherwise state assumptions and confidence. Do not write a heading. Max 190 words.",
    maxTokens: 1200,
  },
  financialDashboard: {
    prompt:
      "Create a Financial Dashboard with compact card-style lines for Revenue, Expenses, Gross Margin, CAC, LTV, Payback Period, Burn Rate, Runway, EBITDA, Break-even Month, and Investment Needed. Tie every estimate to market evidence or explicit assumptions. Do not write a heading. Max 220 words.",
    maxTokens: 1300,
  },
  scenarioAnalysis: {
    prompt:
      "Create Scenario Analysis with Worst Case, Base Case, and Best Case. For each case include demand signal, pricing/MRR implication, CAC/payback implication, burn/runway implication, market risk, and founder decision. Do not write a heading. Max 210 words.",
    maxTokens: 1200,
  },
  kpiDashboard: {
    prompt:
      "Create a KPI Dashboard for market validation. Include demand, conversion, willingness to pay, sales cycle, channel CAC, retention intent, competitor displacement, market pull, and target/warning thresholds. Do not write a heading. Max 180 words.",
    maxTokens: 1000,
  },
  executiveRecommendation: {
    prompt:
      "Write the Executive Recommendation. Select exactly one option and no second option: GO, NO GO, WAIT, PIVOT, RAISE, or BOOTSTRAP. Base it only on market evidence, risks, and financial implications. Add a short rationale and decisive next proof point. Do not write a heading. Max 130 words.",
    maxTokens: 850,
  },
  entryStrategy: {
    prompt:
      "Recommend an entry strategy using consulting-style sequencing: beachhead segment, positioning, first channel, initial offer, pricing/pilot approach, credibility assets, expansion wedge, and decision gates. Include Evidence and Confidence. Do not write a heading. Max 200 words.",
    maxTokens: 1300,
  },
  validationPlan: {
    prompt:
      "Write a validation plan for the first 30-45 days. Include customer interviews, competitor research, pricing tests, concierge MVP or landing page test, success criteria, kill/pivot signals, and the decision each test informs. Include Confidence where assumptions are weak. Do not write a heading. Max 200 words.",
    maxTokens: 1300,
  },
  keyMetrics: {
    prompt:
      "Define key market validation metrics an investor would monitor: demand, conversion, willingness to pay, sales cycle, retention intent, CAC/channel cost, competitor displacement, and market pull signals. Include decision thresholds and Confidence. Do not write a heading. Max 160 words.",
    maxTokens: 900,
  },
  founderRoadmap: {
    prompt:
      "Create Founder Roadmap with Tomorrow, This Week, 30 Days, 90 Days, 180 Days, and 12 Months. Each step must depend on the prior market proof point and decision gate. Include action, evidence to collect, and go/no-go threshold. Do not write a heading. Max 230 words.",
    maxTokens: 1200,
  },
  sourcesAssumptions: {
    prompt:
      "List Sources / Assumptions. Separate real evidence, inferred assumptions, and missing data. For each assumption, explain reason, confidence, and which market or financial conclusion would change if wrong. Do not write a heading. Max 190 words.",
    maxTokens: 1100,
  },
  sources: {
    prompt:
      "List 4-6 reliable sources used or most relevant for validating this market. For each source, state the specific evidence it supports, how it affects the verdict, and the confidence level. Do not write a heading.",
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
    "Every important claim must include an Evidence note and a Confidence level: High, Medium, or Low.",
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
Before writing visible output, silently construct the full Integrated Market Strategy Model. Do not output the model.
Derive this section only from that model so market size, ICP, competitors, pricing, GTM, financial implications, risks, and recommendation stay consistent.
Write the section as an investor-grade market diligence note with practical market-entry recommendations for the founder.
Lead with the decision implication, then support it with Evidence and Confidence.
Avoid generic filler. Use assumptions explicitly when evidence is limited and state what would change the verdict.
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
