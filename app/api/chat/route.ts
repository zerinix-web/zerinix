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
  estimateAiCostUsd,
  extractTokenUsage,
  recordAiUsage,
} from "@/app/lib/ai/governance";
import { checkAiProductionRateLimit } from "@/app/lib/ai/rate-limit";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type ChatInputMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatAttachmentInput = {
  name: string;
  size: number;
  textContent: string;
};

type AiChatProfile = {
  preferred_country: string | null;
  preferred_industries: string[];
  investment_budget_ranges: string[];
  preferred_language: string | null;
  experience_level: string | null;
  available_time: string | null;
  business_interests: string[];
  risk_tolerance: string | null;
  long_term_goals: string[];
};

type AiExpert =
  | "Business Advisor"
  | "Investment Advisor"
  | "Startup Mentor"
  | "Marketing Strategist"
  | "Real Estate Advisor"
  | "Finance Advisor"
  | "Crypto Advisor"
  | "Career Advisor"
  | "Legal Information Assistant"
  | "General AI Assistant";

const expertInstructions: Record<AiExpert, string> = {
  "Business Advisor":
    "Write from the perspective of a pragmatic business advisor. Focus on business models, market opportunity, operational tradeoffs, pricing, execution risks, and next decisions.",
  "Investment Advisor":
    "Write from the perspective of an investment advisor for educational decision support. Focus on goals, budget, risk tolerance, time horizon, diversification, liquidity, downside risk, and clear next steps. Do not guarantee returns or present regulated financial advice as certainty.",
  "Startup Mentor":
    "Write from the perspective of a startup mentor. Focus on founder-market fit, customer discovery, MVP scope, distribution, validation, fundraising readiness, and the next practical milestone.",
  "Marketing Strategist":
    "Write from the perspective of a marketing strategist. Focus on positioning, customer segments, acquisition channels, messaging, funnel metrics, experiments, and campaign priorities.",
  "Real Estate Advisor":
    "Write from the perspective of a real estate advisor for educational decision support. Focus on location, yield, occupancy, financing, regulatory risk, cash flow, liquidity, and due diligence.",
  "Finance Advisor":
    "Write from the perspective of a finance advisor for educational decision support. Focus on budgeting, cash flow, risk, tax-aware planning at a high level, scenarios, and financial discipline. Recommend a licensed professional for regulated or personal tax/legal decisions.",
  "Crypto Advisor":
    "Write from the perspective of a crypto advisor for educational decision support. Focus on volatility, custody, security, liquidity, regulatory risk, position sizing, and risk management. Do not guarantee returns.",
  "Career Advisor":
    "Write from the perspective of a career advisor. Focus on skills, positioning, opportunities, compensation, portfolio proof, networking, and practical career moves.",
  "Legal Information Assistant":
    "Write from the perspective of a legal information assistant. Provide general legal information, identify issues and questions to ask counsel, and avoid presenting the answer as legal advice.",
  "General AI Assistant":
    "Write from the perspective of a clear, capable general AI assistant. Be direct, useful, and adapt to the user's task.",
};

function normalizeMessages(value: unknown): ChatInputMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((message) => {
      if (!message || typeof message !== "object") {
        return null;
      }

      const role = (message as { role?: unknown }).role;
      const content = (message as { content?: unknown }).content;

      if (
        (role !== "user" && role !== "assistant") ||
        typeof content !== "string" ||
        !content.trim()
      ) {
        return null;
      }

      return {
        role,
        content: content.trim().slice(0, 6_000),
      };
    })
    .filter((message): message is ChatInputMessage => Boolean(message))
    .slice(-16);
}

function normalizeAttachments(value: unknown): ChatAttachmentInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((attachment) => {
      if (!attachment || typeof attachment !== "object") {
        return null;
      }

      const name = (attachment as { name?: unknown }).name;
      const size = (attachment as { size?: unknown }).size;
      const textContent = (attachment as { textContent?: unknown }).textContent;

      if (typeof name !== "string" || !name.trim()) {
        return null;
      }

      return {
        name: name.trim().slice(0, 180),
        size: typeof size === "number" && Number.isFinite(size) ? size : 0,
        textContent:
          typeof textContent === "string" ? textContent.trim().slice(0, 12_000) : "",
      };
    })
    .filter((attachment): attachment is ChatAttachmentInput => Boolean(attachment))
    .slice(-6);
}

function buildAttachmentContext(attachments: ChatAttachmentInput[]) {
  if (attachments.length === 0) {
    return "";
  }

  return attachments
    .map((attachment, index) => {
      const fileIntro = `File ${index + 1}: ${attachment.name} (${attachment.size} bytes)`;

      if (!attachment.textContent) {
        return `${fileIntro}\nReadable text was not available for this file.`;
      }

      return `${fileIntro}\n${attachment.textContent}`;
    })
    .join("\n\n---\n\n");
}

function normalizeProfile(value: unknown): AiChatProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const profile = value as Partial<AiChatProfile>;

  return {
    preferred_country:
      typeof profile.preferred_country === "string" ? profile.preferred_country : null,
    preferred_industries: Array.isArray(profile.preferred_industries)
      ? profile.preferred_industries.filter((item): item is string => typeof item === "string")
      : [],
    investment_budget_ranges: Array.isArray(profile.investment_budget_ranges)
      ? profile.investment_budget_ranges.filter(
          (item): item is string => typeof item === "string"
        )
      : [],
    preferred_language:
      typeof profile.preferred_language === "string" ? profile.preferred_language : null,
    experience_level:
      typeof profile.experience_level === "string" ? profile.experience_level : null,
    available_time:
      typeof profile.available_time === "string" ? profile.available_time : null,
    business_interests: Array.isArray(profile.business_interests)
      ? profile.business_interests.filter((item): item is string => typeof item === "string")
      : [],
    risk_tolerance:
      typeof profile.risk_tolerance === "string" ? profile.risk_tolerance : null,
    long_term_goals: Array.isArray(profile.long_term_goals)
      ? profile.long_term_goals.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function buildProfileContext(profile: AiChatProfile | null) {
  if (!profile) {
    return "";
  }

  const lines = [
    profile.preferred_country ? `Preferred country / market: ${profile.preferred_country}` : "",
    profile.preferred_industries.length
      ? `Preferred industries: ${profile.preferred_industries.join(", ")}`
      : "",
    profile.investment_budget_ranges.length
      ? `Investment budget ranges: ${profile.investment_budget_ranges.join(", ")}`
      : "",
    profile.preferred_language ? `Preferred language: ${profile.preferred_language}` : "",
    profile.experience_level ? `Experience level: ${profile.experience_level}` : "",
    profile.available_time ? `Available time: ${profile.available_time}` : "",
    profile.business_interests.length
      ? `Business interests: ${profile.business_interests.join(", ")}`
      : "",
    profile.risk_tolerance ? `Risk tolerance: ${profile.risk_tolerance}` : "",
    profile.long_term_goals.length
      ? `Long-term goals: ${profile.long_term_goals.join(", ")}`
      : "",
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : "";
}

function detectResponseLanguage(value: string) {
  return /[çğıöşü]/i.test(value) ||
    /\b(ülke|bütçe|risk|yatırım|iş|fikir|pazar|hedef|deneyim|zaman|para|öneri|startup|girişim)\b/i.test(value)
    ? "Turkish"
    : "English";
}

function classifyExpert(
  messages: ChatInputMessage[],
  prompt: string,
  profile: AiChatProfile | null
): AiExpert {
  const latest = prompt.toLowerCase();
  const recentContext = messages
    .slice(-4)
    .map((message) => message.content)
    .join("\n")
    .toLowerCase();
  const text = `${buildProfileContext(profile).toLowerCase()}\n${recentContext}\n${latest}`;

  if (/\b(legal|law|lawyer|attorney|contract|lawsuit|liability|compliance|terms of service|privacy policy|regulation|court|trademark|patent|hukuk|avukat|sözleşme|dava|yasal|mevzuat)\b/i.test(text)) {
    return "Legal Information Assistant";
  }

  if (/\b(crypto|bitcoin|btc|ethereum|eth|token|defi|nft|wallet|stablecoin|blockchain|altcoin|staking|kripto|coin|blokzincir)\b/i.test(text)) {
    return "Crypto Advisor";
  }

  if (/\b(real estate|property|rental|rent|landlord|tenant|mortgage|airbnb|housing|commercial property|emlak|gayrimenkul|konut|arsa|kira)\b/i.test(text)) {
    return "Real Estate Advisor";
  }

  if (/\b(career|job|resume|cv|interview|salary|promotion|portfolio|linkedin|hire|hiring|iş kariyer|özgeçmiş|mülakat|maaş|terfi)\b/i.test(text)) {
    return "Career Advisor";
  }

  if (/\b(marketing|brand|branding|seo|ads|advertising|campaign|conversion|funnel|copywriting|content strategy|social media|growth marketing|pazarlama|reklam|marka|dönüşüm)\b/i.test(text)) {
    return "Marketing Strategist";
  }

  if (/\b(accounting|budget|cash flow|cashflow|tax|taxes|debt|loan|profit margin|expenses|personal finance|forecast|bütçe|nakit akışı|vergi|borç|kredi|gider)\b/i.test(text)) {
    return "Finance Advisor";
  }

  if (/\b(invest|investment|portfolio|asset allocation|stocks?|bonds?|etf|fund|wealth|where should i put|where should i invest|yatırım|portföy|hisse|fon|tahvil|servet)\b/i.test(text)) {
    return "Investment Advisor";
  }

  if (/\b(startup|mvp|founder|venture|pitch deck|fundraising|seed round|accelerator|yc|startup ideas?|girişim|kurucu|yatırım turu)\b/i.test(text)) {
    return "Startup Mentor";
  }

  if (/\b(business|business idea|company|market opportunity|revenue model|pricing|operations|customer segment|iş fik|şirket|işletme|pazar fırsat|gelir modeli)\b/i.test(text)) {
    return "Business Advisor";
  }

  return "General AI Assistant";
}

function isBusinessAdvisorRequest(prompt: string) {
  const normalized = prompt.toLowerCase();

  return [
    /\binvest\b/,
    /\binvestment\b/,
    /\bbusiness ideas?\b/,
    /\bstartup ideas?\b/,
    /\bstartup recommendations?\b/,
    /\bmarket opportunities?\b/,
    /\bwhere should i put\b/,
    /\bwhat should i build\b/,
    /\bhow (?:can|should) i invest\b/,
    /\bmake money with\b/,
    /\bi have\s+[$€£₺]?\s?\d+/,
    /\bwith\s+[$€£₺]?\s?\d+/,
    /\byatırım\b/i,
    /\biş fik/i,
    /\bgirişim fik/i,
    /\bstartup öner/i,
    /\bpazar fırsat/i,
    /\bnereye yatırım/i,
    /\bparam var/i,
    /\bne iş kur/i,
  ].some((pattern) => pattern.test(normalized));
}

function isBusinessAdvisorConversation(messages: ChatInputMessage[], prompt: string) {
  if (isBusinessAdvisorRequest(prompt)) {
    return true;
  }

  return messages.slice(-6).some((message) => {
    const content = message.content.toLowerCase();

    return (
      isBusinessAdvisorRequest(content) ||
      content.includes("rank the best options with reasoning") ||
      content.includes("ranked recommendations") ||
      content.includes("önerileri sıralayıp") ||
      content.includes("yatırım tutarı")
    );
  });
}

function conversationText(
  messages: ChatInputMessage[],
  prompt: string,
  profile: AiChatProfile | null
) {
  return [
    buildProfileContext(profile),
    ...messages.map((message) => message.content),
    prompt,
  ]
    .join("\n")
    .toLowerCase();
}

function getMissingAdvisorContext(
  messages: ChatInputMessage[],
  prompt: string,
  profile: AiChatProfile | null
) {
  const text = conversationText(messages, prompt, profile);
  const missing: string[] = [];

  if (!profile?.preferred_country &&
    !/\b(country|location|market|geography|region|city|usa|us|uk|europe|turkey|türkiye|germany|uae|dubai|ülke|şehir|pazar|bölge)\b/i.test(text)
  ) {
    missing.push("country");
  }

  if (!profile?.investment_budget_ranges.length &&
    !/[$€£₺]\s?\d+|\d+\s?(?:usd|eur|gbp|try|tl|dollar|euro|lira|k|m|bin|milyon|thousand|million|budget|capital|bütçe|sermaye)/i.test(text)
  ) {
    missing.push("budget");
  }

  if (!profile?.risk_tolerance && !/\b(low|medium|high|conservative|moderate|aggressive|risk|risky|safe|düşük|orta|yüksek|riskli|güvenli)\b/i.test(text)) {
    missing.push("risk tolerance");
  }

  if (!profile?.experience_level && !/\b(experience|experienced|beginner|first time|background|worked|built|operator|founder|deneyim|tecrübe|başlangıç|kurucu)\b/i.test(text)) {
    missing.push("experience");
  }

  if (!profile?.available_time && !/\b(full[-\s]?time|part[-\s]?time|hours?|weekends?|available time|time per week|tam zaman|yarı zaman|saat|hafta sonu|zaman)\b/i.test(text)) {
    missing.push("available time");
  }

  if (!profile?.long_term_goals.length && !/\b(goal|goals|income|cash flow|growth|wealth|exit|passive|build|learn|hedef|gelir|nakit|büyüme|çıkış|pasif)\b/i.test(text)) {
    missing.push("goals");
  }

  return missing;
}

function buildAdvisorClarification(
  prompt: string,
  missing: string[],
  expert: AiExpert
) {
  const language = detectResponseLanguage(prompt);
  const requested = missing;

  if (language === "Turkish") {
    const labels: Record<string, string> = {
      country: "ülke / hedef pazar",
      budget: "bütçe",
      "risk tolerance": "risk toleransı",
      experience: "deneyim",
      "available time": "ayırabileceğin zaman",
      goals: "ana hedef",
    };

    return [
      `${expert} olarak sana gerçekten uygulanabilir öneriler verebilmem için birkaç bilgiye ihtiyacım var:`,
      "",
      ...requested.map((item, index) => `${index + 1}. ${labels[item] || item}?`),
      "",
      "Kısa cevap verebilirsin; sonra önerileri sıralayıp yatırım tutarı, zaman çizelgesi, riskler ve sonraki adımlarla çıkaracağım.",
    ].join("\n");
  }

  const labels: Record<string, string> = {
    country: "country / target market",
    budget: "budget",
    "risk tolerance": "risk tolerance",
    experience: "experience level",
    "available time": "available time per week",
    goals: "primary goal",
  };

  return [
    `As your ${expert}, I need a little context first to give you useful recommendations:`,
    "",
    ...requested.map((item, index) => `${index + 1}. What is your ${labels[item] || item}?`),
    "",
    "You can answer briefly. Then I’ll rank the best options with reasoning, estimated investment, timeline, risks, and next actions.",
  ].join("\n");
}

function textStream(content: string) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(content));
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const ip = getClientIpFromRequest(req);
  const ipRateLimit = checkRateLimit(`api:chat:ip:${ip}`, {
    limit: 60,
    windowMs: 60_000,
  });

  if (!ipRateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many chat requests. Please wait a moment and try again." },
      { status: 429, headers: getRateLimitHeaders(ipRateLimit) }
    );
  }

  try {
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

    const userRateLimit = checkRateLimit(`api:chat:${user.id}:${ip}`, {
      limit: 45,
      windowMs: 60_000,
    });

    if (!userRateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many chat requests. Please wait a moment and try again." },
        { status: 429, headers: getRateLimitHeaders(userRateLimit) }
      );
    }

    const body = await req.json();
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const messages = normalizeMessages(body?.messages);
    const attachments = normalizeAttachments(body?.attachments);
    const modelPreference = body?.modelPreference === "balanced" ? "balanced" : "fast";
    const conversationId =
      typeof body?.conversationId === "string"
        ? body.conversationId.trim().slice(0, 128)
        : "";

    if (!prompt) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const { data: profileData, error: profileError } = await supabase
      .from("ai_chat_profiles")
      .select(
        "preferred_country,preferred_industries,investment_budget_ranges,preferred_language,experience_level,available_time,business_interests,risk_tolerance,long_term_goals"
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("[ai_chat_profiles select failed]", profileError);
    }

    const chatProfile = normalizeProfile(profileData);
    const profileContext = buildProfileContext(chatProfile);
    const selectedExpert = classifyExpert(messages, prompt, chatProfile);
    const advisorRequest = isBusinessAdvisorConversation(messages, prompt);
    const missingAdvisorContext = advisorRequest
      ? getMissingAdvisorContext(messages, prompt, chatProfile)
      : [];

    if (advisorRequest && missingAdvisorContext.length > 0) {
      return textStream(
        buildAdvisorClarification(prompt, missingAdvisorContext, selectedExpert)
      );
    }

    const productionLimit = await checkAiProductionRateLimit({
      supabase,
      userId: user.id,
      account: user,
      endpoint: "/api/chat",
      requestKind: "simple",
      promptText: prompt,
      reportField: "chat",
      ip,
    });
    const { model: routedModel, planTier, promptHash } = productionLimit;
    const model = modelPreference === "balanced" ? "gpt-5-mini" : routedModel;

    if (!productionLimit.allowed) {
      return NextResponse.json(
        { error: productionLimit.reason },
        { status: 429 }
      );
    }

    const attachmentContext = buildAttachmentContext(attachments);

    const stream = await client.responses.create({
      model,
      instructions: [
        "You are ZERINIX AI, a premium business operating assistant.",
        `Selected expert: ${selectedExpert}.`,
        expertInstructions[selectedExpert],
        "The selected expert must shape the perspective, vocabulary, priorities, caveats, and structure of the answer. Do not announce the routing process unless it helps the user.",
        profileContext
          ? `Persistent user profile for non-sensitive personalization:\n${profileContext}\nUse this profile to avoid asking for details the user has already saved. If the user's latest message conflicts with the profile, prioritize the latest message.`
          : "No persistent chat profile is available yet. Do not invent profile preferences.",
        "Answer naturally and directly. You may help with business, strategy, operations, finance, product, marketing, technology, or general questions.",
        "Use the conversation history for context, but do not fabricate facts.",
        "When attached file text is provided, treat it as user-supplied context. If a file has no readable text, say so briefly when relevant.",
        "If the user asks for a structured investor report, suggest AI Plan or Market Analysis mode instead of generating the full report in Chat mode.",
        "AI Business Advisor behavior: when the user asks for investment ideas, business ideas, startup recommendations, market opportunities, or how to invest money, first ask only the minimum missing clarification questions: country/market, budget, risk tolerance, experience, available time, and goals. If those details are already available in the conversation, do not ask again.",
        "When enough advisor context exists, answer as a conversational advisory memo, not a PDF report. Include ranked recommendations, reasoning, estimated investment, expected timeline, key risks, and concrete next actions. Be practical, honest about assumptions, and avoid regulated financial-advice language that sounds like a guarantee.",
        "Use concise markdown when it improves readability. Match the user's language.",
      ].join("\n"),
      input: [
        ...messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        ...(profileContext
          ? [
              {
                role: "user" as const,
                content: `Persistent user profile context:\n\n${profileContext}`,
              },
            ]
          : []),
        ...(attachmentContext
          ? [
              {
                role: "user" as const,
                content: `Attached file context:\n\n${attachmentContext}`,
              },
            ]
          : []),
        {
          role: "user" as const,
          content: prompt,
        },
      ],
      max_output_tokens: 1_800,
      stream: true,
    });

    const encoder = new TextEncoder();

    return new Response(
      new ReadableStream({
        async start(controller) {
          let streamedText = "";
          let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

          try {
            for await (const event of stream) {
              if (event.type === "response.output_text.delta") {
                streamedText += event.delta;
                controller.enqueue(encoder.encode(event.delta));
              }

              if (event.type === "response.output_text.done" && !streamedText) {
                streamedText = event.text;
                controller.enqueue(encoder.encode(event.text));
              }

              if (event.type === "response.completed") {
                tokenUsage = extractTokenUsage(event.response);
              }
            }

            await recordAiUsage(supabase, {
              userId: user.id,
              endpoint: "/api/chat",
              reportField: "chat",
              promptHash,
              model,
              planTier,
              tokenUsage,
              estimatedCostUsd: estimateAiCostUsd(model, tokenUsage),
              cacheHit: false,
              responseTimeMs: Date.now() - startedAt,
              metadata: {
                quota_event: !productionLimit.quotaAlreadyCharged,
                quota_consumed: !productionLimit.quotaAlreadyCharged,
                usage_kind: "chat_message",
                conversation_id: conversationId || null,
                selected_expert: selectedExpert,
                profile_used: Boolean(profileContext),
                model_preference: modelPreference,
                attachment_count: attachments.length,
                actual_ai_call: true,
              },
            });

            controller.close();
          } catch (error) {
            logServerError("api:chat:stream", error);

            await recordAiUsage(supabase, {
              userId: user.id,
              endpoint: "/api/chat",
              reportField: "chat",
              promptHash,
              model,
              planTier,
              tokenUsage,
              estimatedCostUsd: 0,
              cacheHit: false,
              status: "failed",
              responseTimeMs: Date.now() - startedAt,
              metadata: {
                quota_event: false,
                quota_consumed: false,
                usage_kind: "chat_message",
                conversation_id: conversationId || null,
                selected_expert: selectedExpert,
                profile_used: Boolean(profileContext),
                model_preference: modelPreference,
                attachment_count: attachments.length,
                actual_ai_call: true,
              },
            });

            controller.error(error);
          }
        },
      }),
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    logServerError("api:chat", error);

    return NextResponse.json(
      { error: "Chat response failed. Please try again." },
      { status: 500 }
    );
  }
}
