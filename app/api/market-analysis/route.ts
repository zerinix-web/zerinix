import OpenAI from "openai";
import { NextResponse } from "next/server";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const fieldPrompts: Record<string, { prompt: string; maxTokens: number }> = {
  executiveSummary: {
    prompt:
      "Güncel web araştırmasına dayanarak 2-3 cümlelik yönetici özeti yaz. Pazar fırsatı, kime satıldığı ve ilk odak noktasını belirt. Başlık yazma. En fazla 90 kelime.",
    maxTokens: 1000,
  },
  marketAnalysis: {
    prompt:
      "Güncel kaynaklardan pazar büyüklüğü, rakip şirketler, sektör trendleri ve son haberleri kısa analiz et. Başlık yazma. En fazla 170 kelime.",
    maxTokens: 1800,
  },
  targetAudience: {
    prompt:
      "Güncel pazar sinyallerine göre hedef müşteri segmentlerini, erken benimseyenleri ve satın alma motivasyonlarını belirt. Başlık yazma. En fazla 130 kelime.",
    maxTokens: 1000,
  },
  revenueModel: {
    prompt:
      "Rakip fiyatlandırma modellerini ve gelir potansiyelini kullanarak uygun gelir modelini öner. Başlık yazma. En fazla 130 kelime.",
    maxTokens: 1000,
  },
  risks: {
    prompt:
      "SWOT için kullanılabilecek güncel verilerle ana riskleri ve azaltma aksiyonlarını yaz. Başlık yazma. En fazla 130 kelime.",
    maxTokens: 1000,
  },
  roadmap90Days: {
    prompt:
      "Web araştırmasından çıkan pazar gerçeklerine göre ilk 90 gün için uygulanabilir yol haritası yaz: 0-30, 31-60, 61-90 gün. Başlık yazma. En fazla 150 kelime.",
    maxTokens: 1400,
  },
  successScore: {
    prompt:
      "Güncel rekabet, pazar büyüklüğü, trendler ve risklere göre 0-100 arası başarı skoru ver; 2 kısa gerekçe yaz. Başlık yazma. En fazla 80 kelime.",
    maxTokens: 800,
  },
  sources: {
    prompt:
      "Web araştırmasında kullandığın en güvenilir 4-6 kaynağı listele. Her satırda kaynak adı, kısa kullanım nedeni ve URL olsun. Başlık yazma.",
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

function logRawOpenAIEvent(event: unknown) {
  const rawEvent = event as { type?: string };

  if (
    rawEvent.type === "response.completed" ||
    rawEvent.type === "response.failed" ||
    rawEvent.type === "response.incomplete" ||
    rawEvent.type === "response.error"
  ) {
    console.log("[market-analysis] raw OpenAI response", JSON.stringify(event));
  }
}

export async function POST(req: Request) {
  try {
    const { prompt, field, section } = await req.json();
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
        { error: "Geçersiz rapor alanı." },
        { status: 400 }
      );
    }

    const stream = await client.responses.create(
      {
        model: "gpt-5-mini",
        input: `Sen ZERINIX için çalışan profesyonel bir pazar analistisin.
İş fikri: ${prompt}

Üretilecek rapor bölümü: ${fieldLabels[reportField]}
Analiz görevi: ${fieldConfig.prompt}
Önce güncel web araştırması yap. Güvenilir kaynaklardan pazar büyüklüğü, rakip şirketler, sektör trendleri, hedef müşteri, son haberler, fiyatlandırma modelleri ve SWOT verilerini dikkate al.
Soru sorma ve açıklama isteme; mevcut bilgilerle raporu yaz.
Sadece bu bölümün içerik metnini yaz. JSON nesnesi, alan adı, süslü parantez, markdown kod bloğu, başlık veya başka rapor bölümü yazma.
Türkçe, net, uygulanabilir yaz. Ürün için web adresi, alan adı, marka adı veya site önerisi verme; yalnızca Sources bölümünde kaynak URL'si yaz.`,
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
              logRawOpenAIEvent(event);

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

            console.log(
              "[market-analysis] serialized JSON schema",
              JSON.stringify(createReportChunk(reportField, streamedText))
            );
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
      { error: "Pazar analizi oluşturulamadı." },
      { status: 500 }
    );
  }
}
