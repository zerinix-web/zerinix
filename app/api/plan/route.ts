import OpenAI from "openai";
import { NextResponse } from "next/server";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const planPrompts = {
  executiveSummary: {
    prompt:
      "2-3 cümlelik premium yönetici özeti yaz. İş fikrinin fırsatını, hedefini ve ilk stratejik odağını belirt.",
    maxTokens: 700,
  },
  businessModel: {
    prompt:
      "İş modelini net açıkla: değer önerisi, temel faaliyetler, dağıtım kanalları ve farklılaşma.",
    maxTokens: 850,
  },
  targetCustomer: {
    prompt:
      "Hedef müşteri profilini, erken benimseyen segmenti, satın alma motivasyonunu ve temel problemi açıkla.",
    maxTokens: 750,
  },
  revenueModel: {
    prompt:
      "Gelir modelini öner: fiyatlandırma yaklaşımı, paketleme, tekrar eden gelir ve upsell fırsatları.",
    maxTokens: 750,
  },
  roadmap90Days: {
    prompt:
      "İlk 90 gün için uygulanabilir yol haritası yaz: 0-30, 31-60, 61-90 gün.",
    maxTokens: 850,
  },
  risks: {
    prompt:
      "Ana iş risklerini ve her risk için azaltma aksiyonlarını yaz.",
    maxTokens: 700,
  },
  firstCustomerStrategy: {
    prompt:
      "İlk müşterileri bulmak için pratik strateji yaz: kanal, teklif, mesaj, satış hareketi ve doğrulama yöntemi.",
    maxTokens: 800,
  },
  kpiMetrics: {
    prompt:
      "Takip edilmesi gereken KPI metriklerini yaz: acquisition, activation, revenue, retention ve operasyon metrikleri.",
    maxTokens: 700,
  },
  successScore: {
    prompt:
      "0-100 arası AI başarı skoru ver ve 2 kısa gerekçe yaz.",
    maxTokens: 500,
  },
} as const;

type PlanReportField = keyof typeof planPrompts;

type PlanReportChunk = Record<PlanReportField, string>;

const planFields = Object.keys(planPrompts) as PlanReportField[];

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

export async function POST(req: Request) {
  try {
    const { prompt, field } = await req.json();
    const reportField = typeof field === "string" ? field : "executiveSummary";

    if (!isPlanReportField(reportField)) {
      return NextResponse.json(
        { error: "Geçersiz plan alanı." },
        { status: 400 }
      );
    }

    const fieldConfig = planPrompts[reportField];

    const stream = await client.responses.create(
      {
        model: "gpt-5-mini",
        input: `Sen ZERINIX için çalışan üst düzey AI business planner'sın.
İş fikri / hedef: ${prompt}

Görev: ${fieldConfig.prompt}
Sadece bu bölümün içerik metnini yaz. JSON nesnesi, alan adı, markdown kod bloğu veya başka rapor bölümü yazma.
Türkçe, premium, net ve uygulanabilir yaz. Gerçek bir girişimcinin karar alabileceği yoğunlukta ol.`,
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
    );

    const encoder = new TextEncoder();

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            for await (const event of stream) {
              if (event.type === "response.output_text.delta") {
                controller.enqueue(
                  encoder.encode(serializePlanChunk(reportField, event.delta))
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
      { error: "Bir hata oluştu." },
      { status: 500 }
    );
  }
}
