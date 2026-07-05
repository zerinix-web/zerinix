import OpenAI from "openai";
import { NextResponse } from "next/server";
import { isPrivateBetaAllowed } from "@/app/lib/beta-access";
import { createClient } from "@/app/lib/supabase/server";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const fieldPrompts: Record<string, { prompt: string; maxTokens: number }> = {
  executiveSummary: {
    prompt:
      "Based on current web research, write a 2-3 sentence executive summary. Cover the market opportunity, who it sells to, and the first strategic focus. Do not write a heading. Max 90 words.",
    maxTokens: 1000,
  },
  marketAnalysis: {
    prompt:
      "Briefly analyze market size, competitor companies, industry trends, and recent news from current sources. Do not write a heading. Max 170 words.",
    maxTokens: 1800,
  },
  targetAudience: {
    prompt:
      "Describe target customer segments, early adopters, and buying motivations based on current market signals. Do not write a heading. Max 130 words.",
    maxTokens: 1000,
  },
  revenueModel: {
    prompt:
      "Recommend a suitable revenue model using competitor pricing models and revenue potential. Do not write a heading. Max 130 words.",
    maxTokens: 1000,
  },
  risks: {
    prompt:
      "Write the main risks and mitigation actions using current data that could support SWOT analysis. Do not write a heading. Max 130 words.",
    maxTokens: 1000,
  },
  roadmap90Days: {
    prompt:
      "Write an actionable first 90-day roadmap based on the market realities found in web research: days 0-30, 31-60, and 61-90. Do not write a heading. Max 150 words.",
    maxTokens: 1400,
  },
  successScore: {
    prompt:
      "Give a success score from 0-100 based on current competition, market size, trends, and risks; write 2 short reasons. Do not write a heading. Max 80 words.",
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
    "Be clear, current, and actionable.",
  ].join("\n");
}

export async function POST(req: Request) {
  try {
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

    const { prompt, field, section, language } = await req.json();
    const promptText = typeof prompt === "string" ? prompt : "";
    const responseLanguage = normalizeLanguage(language, promptText);
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
Write the report from the available information.
Write only the content for this section. Do not write a JSON object, field name, braces, markdown code block, heading, or any other report section.
Do not suggest website URLs, domain names, brand names, or site ideas for the product; write source URLs only in the Sources section.`;

    const stream = await client.responses.create(
      {
        model: "gpt-5-mini",
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
    );

    const encoder = new TextEncoder();

    return new Response(
      new ReadableStream({
        async start(controller) {
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

              if (event.type === "response.completed" && !streamedText) {
                const completedText = extractResponseText(event.response);

                if (completedText) {
                  streamedText = completedText;
                  controller.enqueue(
                    encoder.encode(serializeReportChunk(reportField, completedText))
                  );
                }
              }
            }

            controller.close();
          } catch (error) {
            console.error("[market-analysis] stream error", error);
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
    console.error(error);

    return NextResponse.json(
      { error: "Market analysis could not be generated." },
      { status: 500 }
    );
  }
}
