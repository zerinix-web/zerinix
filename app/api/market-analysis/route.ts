import OpenAI from "openai";
import { NextResponse } from "next/server";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const fieldPrompts: Record<string, { prompt: string; maxTokens: number }> = {
  executiveSummary: {
    prompt:
      "Güncel web araştırmasına dayanarak 2-3 cümlelik yönetici özeti yaz. Pazar fırsatı, kime satıldığı ve ilk odak noktasını belirt. Başlık yazma.",
    maxTokens: 190,
  },
  marketAnalysis: {
    prompt:
      "Güncel kaynaklardan pazar büyüklüğü, rakip şirketler, sektör trendleri ve son haberleri kısa analiz et. Başlık yazma.",
    maxTokens: 270,
  },
  targetAudience: {
    prompt:
      "Güncel pazar sinyallerine göre hedef müşteri segmentlerini, erken benimseyenleri ve satın alma motivasyonlarını belirt. Başlık yazma.",
    maxTokens: 210,
  },
  revenueModel: {
    prompt:
      "Rakip fiyatlandırma modellerini ve gelir potansiyelini kullanarak uygun gelir modelini öner. Başlık yazma.",
    maxTokens: 210,
  },
  risks: {
    prompt:
      "SWOT için kullanılabilecek güncel verilerle ana riskleri ve azaltma aksiyonlarını yaz. Başlık yazma.",
    maxTokens: 210,
  },
  roadmap90Days: {
    prompt:
      "Web araştırmasından çıkan pazar gerçeklerine göre ilk 90 gün için uygulanabilir yol haritası yaz: 0-30, 31-60, 61-90 gün. Başlık yazma.",
    maxTokens: 220,
  },
  successScore: {
    prompt:
      "Güncel rekabet, pazar büyüklüğü, trendler ve risklere göre 0-100 arası başarı skoru ver; 2 kısa gerekçe yaz. Başlık yazma.",
    maxTokens: 150,
  },
  sources: {
    prompt:
      "Web araştırmasında kullandığın en güvenilir 4-6 kaynağı listele. Her satırda kaynak adı, kısa kullanım nedeni ve URL olsun. Başlık yazma.",
    maxTokens: 220,
  },
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

    if (!fieldConfig || !reportField) {
      return NextResponse.json(
        { error: "Geçersiz rapor alanı." },
        { status: 400 }
      );
    }

    const stream = await client.responses.create(
      {
        model: "gpt-5-mini",
        input: `ZERINIX pazar raporu alanı: ${reportField}
İş fikri: ${prompt}

Görev: ${fieldConfig.prompt}
Önce güncel web araştırması yap. Güvenilir kaynaklardan pazar büyüklüğü, rakip şirketler, sektör trendleri, hedef müşteri, son haberler, fiyatlandırma modelleri ve SWOT verilerini dikkate al.
Türkçe, net, uygulanabilir yaz. Markdown başlığı yazma. JSON yazma. Ürün için web adresi, alan adı, marka adı veya site önerisi verme; yalnızca sources alanında kaynak URL'si yaz.`,
        max_output_tokens: fieldConfig.maxTokens,
        stream: true,
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
            for await (const event of stream) {
              if (event.type === "response.output_text.delta") {
                controller.enqueue(
                  encoder.encode(
                    `${JSON.stringify({ [reportField]: event.delta })}\n`
                  )
                );
              }
            }

            controller.close();
          } catch (error) {
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
