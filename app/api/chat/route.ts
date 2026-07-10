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
  normalizeAiPrompt,
  recordAiUsage,
  storeCachedAiResponse,
  type AiRequestKind,
} from "@/app/lib/ai/governance";
import { checkAiProductionRateLimit } from "@/app/lib/ai/rate-limit";
import { loadUserReport, type DashboardReport } from "@/app/dashboard/report-utils";
import {
  createOpenAiClient,
  getAiConfigurationErrorMessage,
  isAiTestMode,
  logAiExecution,
} from "@/app/lib/ai/runtime";
import { sanitizeAiResponseText } from "@/app/lib/ai/response-sanitization";

type ChatInputMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatAttachmentInput = {
  name: string;
  size: number;
  textContent: string;
};

type ReportMemoryContext = {
  id: string;
  title: string;
  type: string;
  prompt: string;
  content: string;
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
  | "Sales Strategist"
  | "Real Estate Advisor"
  | "Finance Advisor"
  | "Crypto Advisor"
  | "Career Advisor"
  | "Legal Information Assistant"
  | "General AI Assistant";

type ChatIntent =
  | "Investment"
  | "Startup"
  | "Marketing"
  | "Sales"
  | "Finance"
  | "Real Estate"
  | "Crypto"
  | "Career"
  | "Legal Information"
  | "General";

const intentExpertMap: Record<ChatIntent, AiExpert> = {
  Investment: "Investment Advisor",
  Startup: "Startup Mentor",
  Marketing: "Marketing Strategist",
  Sales: "Sales Strategist",
  Finance: "Finance Advisor",
  "Real Estate": "Real Estate Advisor",
  Crypto: "Crypto Advisor",
  Career: "Career Advisor",
  "Legal Information": "Legal Information Assistant",
  General: "General AI Assistant",
};

const expertInstructions: Record<AiExpert, string> = {
  "Business Advisor":
    "Write from the perspective of a pragmatic business advisor. Focus on business models, market opportunity, operational tradeoffs, pricing, execution risks, and next decisions.",
  "Investment Advisor":
    "Write from the perspective of an investment advisor for educational decision support. Focus on goals, budget, risk tolerance, time horizon, diversification, liquidity, downside risk, ranked allocation options, and clear next steps. Do not guarantee returns or present regulated financial advice as certainty.",
  "Startup Mentor":
    "Write from the perspective of a startup mentor. Focus on founder-market fit, customer discovery, MVP scope, distribution, validation, fundraising readiness, ranked startup opportunities, and the next practical milestone.",
  "Marketing Strategist":
    "Write from the perspective of a marketing strategist. Focus on positioning, customer segments, acquisition channels, messaging, funnel metrics, experiments, ranked campaign options, and campaign priorities.",
  "Sales Strategist":
    "Write from the perspective of a sales strategist. Focus on ICP, pipeline design, outbound/inbound motion, qualification, pricing conversations, objection handling, close plan, revenue targets, and ranked sales plays.",
  "Real Estate Advisor":
    "Write from the perspective of a real estate advisor for educational decision support. Focus on location, yield, occupancy, financing, regulatory risk, cash flow, liquidity, ranked property strategies, and due diligence.",
  "Finance Advisor":
    "Write from the perspective of a finance advisor for educational decision support. Focus on budgeting, cash flow, risk, tax-aware planning at a high level, scenarios, ranked financial actions, and financial discipline. Recommend a licensed professional for regulated or personal tax/legal decisions.",
  "Crypto Advisor":
    "Write from the perspective of a crypto advisor for educational decision support. Focus on volatility, custody, security, liquidity, regulatory risk, position sizing, ranked crypto strategies, and risk management. Do not guarantee returns.",
  "Career Advisor":
    "Write from the perspective of a career advisor. Focus on skills, positioning, opportunities, compensation, portfolio proof, networking, ranked career moves, and practical next steps.",
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

function normalizeReportId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 128) : "";
}

function buildReportMemoryContext(report: DashboardReport | null): ReportMemoryContext | null {
  if (!report || report.status.toLowerCase() !== "completed" || report.sections.length === 0) {
    return null;
  }

  const sectionBlocks = report.sections
    .map((section) => {
      const title = section.title.trim();
      const content = section.content.replace(/\s+/g, " ").trim();

      if (!title || !content) {
        return "";
      }

      return `## ${title}\n${content}`;
    })
    .filter(Boolean);

  if (sectionBlocks.length === 0) {
    return null;
  }

  const header = [
    `Report ID: ${report.id}`,
    `Report title: ${report.title}`,
    `Report type: ${report.type}`,
    report.prompt ? `Original user prompt: ${report.prompt}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: report.id,
    title: report.title,
    type: report.type,
    prompt: report.prompt,
    content: `${header}\n\n${sectionBlocks.join("\n\n")}`,
  };
}

function isReportMemoryQuestion(prompt: string, messages: ChatInputMessage[]) {
  const text = [...messages.slice(-4).map((message) => message.content), prompt]
    .join("\n")
    .toLowerCase();

  return /\b(my report|the report|this report|tam|sam|som|competitors?|risks?|cagr|gross margin|market size|executive summary|swot|porter|financial dashboard|unit economics|sources?)\b/i.test(
    text
  );
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

function getRoutingText(
  messages: ChatInputMessage[],
  prompt: string,
  profile: AiChatProfile | null
): string {
  const latest = prompt.toLowerCase();
  const recentContext = messages
    .slice(-4)
    .map((message) => message.content)
    .join("\n")
    .toLowerCase();

  return `${buildProfileContext(profile).toLowerCase()}\n${recentContext}\n${latest}`;
}

function classifyIntent(
  messages: ChatInputMessage[],
  prompt: string,
  profile: AiChatProfile | null
): ChatIntent {
  const text = getRoutingText(messages, prompt, profile);

  if (/\b(legal|law|lawyer|attorney|contract|lawsuit|liability|compliance|terms of service|privacy policy|regulation|court|trademark|patent|hukuk|avukat|sözleşme|dava|yasal|mevzuat)\b/i.test(text)) {
    return "Legal Information";
  }

  if (/\b(crypto|bitcoin|btc|ethereum|eth|token|defi|nft|wallet|stablecoin|blockchain|altcoin|staking|kripto|coin|blokzincir)\b/i.test(text)) {
    return "Crypto";
  }

  if (/\b(real estate|property|rental|rent|landlord|tenant|mortgage|airbnb|housing|commercial property|emlak|gayrimenkul|konut|arsa|kira)\b/i.test(text)) {
    return "Real Estate";
  }

  if (/\b(career|job|resume|cv|interview|salary|promotion|portfolio|linkedin|hire|hiring|iş kariyer|özgeçmiş|mülakat|maaş|terfi)\b/i.test(text)) {
    return "Career";
  }

  if (/\b(sales|sell|selling|pipeline|prospecting|outbound|inbound|lead generation|lead gen|crm|quota|close rate|closing|deal|b2b sales|satış|müşteri bul|potansiyel müşteri|anlaşma|kapanış)\b/i.test(text)) {
    return "Sales";
  }

  if (/\b(marketing|brand|branding|seo|ads|advertising|campaign|conversion|funnel|copywriting|content strategy|social media|growth marketing|pazarlama|reklam|marka|dönüşüm)\b/i.test(text)) {
    return "Marketing";
  }

  if (/\b(accounting|budget|cash flow|cashflow|tax|taxes|debt|loan|profit margin|expenses|personal finance|forecast|bütçe|nakit akışı|vergi|borç|kredi|gider)\b/i.test(text)) {
    return "Finance";
  }

  if (/\b(invest|investment|portfolio|asset allocation|stocks?|bonds?|etf|fund|wealth|where should i put|where should i invest|yatırım|portföy|hisse|fon|tahvil|servet)\b/i.test(text)) {
    return "Investment";
  }

  if (/\b(startup|mvp|founder|venture|pitch deck|fundraising|seed round|accelerator|yc|startup ideas?|girişim|kurucu|yatırım turu)\b/i.test(text)) {
    return "Startup";
  }

  if (/\b(business|business idea|company|market opportunity|revenue model|pricing|operations|customer segment|iş fik|şirket|işletme|pazar fırsat|gelir modeli)\b/i.test(text)) {
    return "Startup";
  }

  return "General";
}

function classifyExpert(
  messages: ChatInputMessage[],
  prompt: string,
  profile: AiChatProfile | null
) {
  const intent = classifyIntent(messages, prompt, profile);

  return {
    intent,
    expert: intentExpertMap[intent],
  };
}

function classifyChatRequestKind(
  intent: ChatIntent,
  attachments: ChatAttachmentInput[],
  advisorRequest: boolean
): AiRequestKind {
  if (attachments.length > 0) {
    return "file_analysis";
  }

  if (intent === "Investment" || intent === "Finance" || intent === "Crypto" || intent === "Real Estate") {
    return "investment_advice";
  }

  if (advisorRequest || intent === "Startup" || intent === "Marketing" || intent === "Sales") {
    return "business_advice";
  }

  return "simple_chat";
}

function shouldUseChatCache(input: {
  attachments: ChatAttachmentInput[];
  messages: ChatInputMessage[];
  requestKind: AiRequestKind;
  reportMemory: ReportMemoryContext | null;
}) {
  return (
    input.attachments.length === 0 &&
    !input.reportMemory &&
    input.requestKind !== "file_analysis" &&
    input.messages.length <= 2
  );
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

function isVagueAdvisorPrompt(prompt: string) {
  return /^(where should i invest\??|where should i put my money\??|what should i build\??|i want to start a business\.?|best startup ideas\.?|business ideas\.?|startup ideas\.?|how should i invest\??|nereye yatırım yapmalıyım\??|ne iş kurmalıyım\??|iş fikri öner\.?)$/i.test(
    prompt.trim()
  );
}

function getEssentialAdvisorQuestions(
  intent: ChatIntent,
  prompt: string,
  missing: string[]
) {
  if (missing.length === 0) {
    return [];
  }

  const essentialByIntent: Partial<Record<ChatIntent, string[]>> = {
    Investment: ["budget", "risk tolerance", "country"],
    Startup: ["country", "budget", "experience"],
    "Real Estate": ["country", "budget", "risk tolerance"],
    Crypto: ["budget", "risk tolerance"],
    Finance: ["budget", "goals"],
  };
  const essentials = essentialByIntent[intent] || [];
  const essentialMissing = missing.filter((item) => essentials.includes(item));

  if (isVagueAdvisorPrompt(prompt)) {
    return essentialMissing.slice(0, 3);
  }

  if (intent === "Investment" && missing.includes("risk tolerance")) {
    return ["risk tolerance"];
  }

  if (intent === "Investment" && missing.includes("budget")) {
    return ["budget"];
  }

  return [];
}

function buildAdvisorClarification(
  _prompt: string,
  missing: string[],
  expert: AiExpert
) {
  const requested = missing;

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
  const sanitizedContent = sanitizeAiResponseText(content);

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sanitizedContent));
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    }
  );
}

function createMockChatResponse(prompt: string, expert: AiExpert) {
  return sanitizeAiResponseText([
    `Mock ${expert} response for: ${prompt}`,
    "",
    "This deterministic response is served because AI_TEST_MODE is enabled.",
    "",
    "- No OpenAI request was made.",
    "- Conversation, streaming UI, sidebar persistence, copy, regenerate, and file upload flows can be tested safely.",
    "- Switch AI_TEST_MODE off to use the configured environment-specific OpenAI key.",
  ].join("\n"));
}

const TEXT_LIKE_RESPONSE_FIELD_PATTERN =
  /^(output_text|text|value|content|message|refusal|response|answer|summary|reply|markdown|body|description)$/i;

const NON_CONTENT_RESPONSE_FIELD_PATTERN =
  /^(id|object|type|status|role|model|created|created_at|updated_at|usage|metadata|annotations|finish_reason|index|incomplete_details)$/i;

function extractTextFromValue(
  value: unknown,
  parentKey = "",
  seen: WeakSet<object> = new WeakSet()
): string {
  if (typeof value === "string") {
    return !parentKey || TEXT_LIKE_RESPONSE_FIELD_PATTERN.test(parentKey) ? value : "";
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  if (seen.has(value)) {
    return "";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextFromValue(item, parentKey, seen))
      .filter(Boolean)
      .join("");
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  const candidateKeys =
    type === "output_text"
      ? ["text", "value", "content", "message"]
      : [
          "output_text",
          "text",
          "value",
          "content",
          "message",
          "refusal",
          "response",
          "answer",
          "summary",
        ];

  for (const key of candidateKeys) {
    const extracted = extractTextFromValue(record[key], key, seen);

    if (extracted.trim()) {
      return extracted;
    }
  }

  for (const [key, item] of Object.entries(record)) {
    if (candidateKeys.includes(key) || NON_CONTENT_RESPONSE_FIELD_PATTERN.test(key)) {
      continue;
    }

    const extracted = extractTextFromValue(item, key, seen);

    if (extracted.trim()) {
      return extracted;
    }
  }

  return "";
}

function extractResponseText(response: unknown) {
  if (!response || typeof response !== "object") {
    return "";
  }

  const record = response as Record<string, unknown>;
  const directText = extractTextFromValue(record.output_text);

  if (directText.trim()) {
    return directText;
  }

  const outputText = extractTextFromValue(record.output);

  if (outputText.trim()) {
    return outputText;
  }

  return extractTextFromValue(record.output_parsed);
}

function extractOutputItemText(item: unknown) {
  return extractTextFromValue(item);
}

function getChatMaxOutputTokens(requestKind: AiRequestKind) {
  if (requestKind === "simple_chat") {
    return 900;
  }

  if (requestKind === "investment_advice") {
    return 1_400;
  }

  return 1_200;
}

function getResponseStatus(response: unknown) {
  if (!response || typeof response !== "object") {
    return "";
  }

  const status = (response as Record<string, unknown>).status;

  return typeof status === "string" ? status : "";
}

function getIncompleteReason(response: unknown) {
  if (!response || typeof response !== "object") {
    return "";
  }

  const details = (response as Record<string, unknown>).incomplete_details;

  if (!details || typeof details !== "object") {
    return "";
  }

  const reason = (details as Record<string, unknown>).reason;

  return typeof reason === "string" ? reason : "";
}

function createIncompleteResponseFallback(reason: string) {
  if (reason === "max_output_tokens") {
    return "I reached the response length limit before I could display the answer. Please ask me to continue or narrow the question.";
  }

  return "I received a response but could not display it. Please try again.";
}

function getChatErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Chat response failed. Please try again.";
}

function sanitizeResponseShape(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== "object") {
    return typeof value;
  }

  if (depth > 3) {
    return Array.isArray(value) ? `array(${value.length})` : "object";
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sample: value.slice(0, 3).map((item) => sanitizeResponseShape(item, depth + 1)),
    };
  }

  const record = value as Record<string, unknown>;

  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !/key|token|secret|authorization|cookie/i.test(key))
      .map(([key, item]) => [
        key,
        typeof item === "string"
          ? `string(${item.length})`
          : sanitizeResponseShape(item, depth + 1),
      ])
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
    const reportId = normalizeReportId(body?.reportId);
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
    const loadedReport = reportId ? await loadUserReport(supabase, user, reportId) : null;
    const reportMemory = buildReportMemoryContext(loadedReport);
    const reportMemoryDebugReason = reportMemory
      ? "attached"
      : reportId
        ? loadedReport
          ? "Report was found but is not completed or has no saved sections."
          : `Report id ${reportId} was not found for the authenticated user.`
        : "No report id was provided with this chat request.";
    const reportQuestion = isReportMemoryQuestion(prompt, messages);
    const { intent: selectedIntent, expert: selectedExpert } = classifyExpert(
      messages,
      prompt,
      chatProfile
    );
    const advisorRequest = isBusinessAdvisorConversation(messages, prompt);
    const missingAdvisorContext = advisorRequest
      ? getMissingAdvisorContext(messages, prompt, chatProfile)
      : [];
    const essentialAdvisorQuestions = advisorRequest && !reportMemory
      ? getEssentialAdvisorQuestions(selectedIntent, prompt, missingAdvisorContext)
      : [];
    const requestKind = classifyChatRequestKind(
      selectedIntent,
      attachments,
      advisorRequest
    );
    const responseLanguage = detectResponseLanguage(prompt);

    if (isAiTestMode()) {
      logAiExecution({
        endpoint: "/api/chat",
        source: "mock",
        mode: requestKind,
      });

      return textStream(createMockChatResponse(prompt, selectedExpert));
    }

    if (reportQuestion && !reportMemory) {
      console.info("[api:chat] report memory missing", {
        conversationId: conversationId || null,
        reportId: reportId || null,
        reportMemoryAttached: false,
        reportMemoryDebugReason,
        promptLength: prompt.length,
      });

      return textStream(
        [
          "No report is attached to this chat request.",
          "",
          `Debug reason: ${reportMemoryDebugReason}`,
          "",
          "Open AI Chat from a saved report or pass the report id so I can answer from the report text.",
        ].join("\n")
      );
    }

    if (advisorRequest && essentialAdvisorQuestions.length > 0) {
      return textStream(
        buildAdvisorClarification(prompt, essentialAdvisorQuestions, selectedExpert)
      );
    }

    const productionLimit = await checkAiProductionRateLimit({
      supabase,
      userId: user.id,
      account: user,
      endpoint: "/api/chat",
      requestKind,
      promptText: prompt,
      reportField: "chat",
      ip,
    });
    const { model, planTier, promptHash } = productionLimit;

    if (!productionLimit.allowed) {
      return NextResponse.json(
        { error: productionLimit.reason },
        { status: 429 }
      );
    }

    const chatCacheEnabled = shouldUseChatCache({
      attachments,
      messages,
      requestKind,
      reportMemory,
    });
    const chatCacheKey = createAiCacheKey({
      endpoint: "/api/chat",
      normalizedPrompt: normalizeAiPrompt(prompt),
      mode: `chat:${requestKind}:${selectedIntent}:${selectedExpert}`,
      language: responseLanguage,
      model,
    });

    if (chatCacheEnabled) {
      const cachedChatResponse = await getCachedAiResponse(
        supabase,
        user.id,
        chatCacheKey
      );

      if (cachedChatResponse?.responseText) {
        logAiExecution({
          endpoint: "/api/chat",
          source: "cache",
          mode: requestKind,
          model: cachedChatResponse.model || model,
          cacheHit: true,
        });

        await recordAiUsage(supabase, {
          userId: user.id,
          endpoint: "/api/chat",
          reportField: "chat",
          promptHash,
          model: cachedChatResponse.model || model,
          planTier,
          tokenUsage: {
            promptTokens: cachedChatResponse.promptTokens,
            completionTokens: cachedChatResponse.completionTokens,
            totalTokens: cachedChatResponse.totalTokens,
          },
          estimatedCostUsd: 0,
          cacheHit: true,
          responseTimeMs: Date.now() - startedAt,
          metadata: {
            quota_event: false,
            quota_mode: requestKind,
            quota_consumed: false,
            usage_kind: "chat_cache_hit",
            conversation_id: conversationId || null,
            selected_intent: selectedIntent,
            selected_expert: selectedExpert,
            request_kind: requestKind,
            profile_used: Boolean(profileContext),
            report_memory_used: Boolean(reportMemory),
            report_id: reportMemory?.id || null,
            model_preference: modelPreference,
            attachment_count: attachments.length,
            actual_ai_call: false,
            cachedEstimatedCostUsd: cachedChatResponse.estimatedCostUsd,
          },
        });

        return textStream(cachedChatResponse.responseText);
      }
    }

    const attachmentContext = buildAttachmentContext(attachments);
    let client: ReturnType<typeof createOpenAiClient>;

    try {
      client = createOpenAiClient();
    } catch (error) {
      const configurationError = getAiConfigurationErrorMessage(error);

      if (configurationError) {
        return NextResponse.json({ error: configurationError }, { status: 500 });
      }

      throw error;
    }

    logAiExecution({
      endpoint: "/api/chat",
      source: "real_ai",
      mode: requestKind,
      model,
    });

    const maxOutputTokens = getChatMaxOutputTokens(requestKind);
    const instructionsText = [
      "You are ZERINIX AI, a premium business operating assistant.",
      `Classified user intent: ${selectedIntent}.`,
      `Selected expert: ${selectedExpert}.`,
      expertInstructions[selectedExpert],
      "The selected expert must shape the perspective, vocabulary, priorities, caveats, and structure of the answer. Do not announce the routing process unless it helps the user.",
      profileContext
        ? `Persistent user profile for non-sensitive personalization:\n${profileContext}\nUse this profile to avoid asking for details the user has already saved. If the user's latest message conflicts with the profile, prioritize the latest message.`
        : "No persistent chat profile is available yet. Do not invent profile preferences.",
      reportMemory
        ? [
            "A saved ZERINIX report is attached as authoritative report memory.",
            "Prioritize the report memory over general model knowledge for every answer.",
            "If the report contains the answer, never say you assume; explicitly reference the relevant report finding or section.",
            "If the report does not contain the requested information, say that the report does not contain it, then use general reasoning clearly marked as outside-report reasoning.",
            "Keep using this report memory for follow-up questions in this conversation.",
          ].join("\n")
        : "No saved report memory is attached to this chat request.",
      "Answer naturally and directly. You may help with business, strategy, operations, finance, product, marketing, technology, or general questions.",
      "Use the conversation history for context, but do not fabricate facts.",
      "When attached file text is provided, treat it as user-supplied context. If a file has no readable text, say so briefly when relevant.",
      "If the user asks for a structured investor report, suggest AI Plan or Market Analysis mode instead of generating the full report in Chat mode.",
      "Advisor quality rules: ask follow-up questions only if the missing information is absolutely necessary. Never ask for information already present in the persistent profile or conversation. If useful but non-critical information is missing, proceed with clearly labeled assumptions.",
      "When giving recommendations, go deeper than generic advice. Rank options from best to worst, show step-by-step reasoning, explain why each option was chosen, and include estimated investment, expected ROI or outcome range, timeline, risks, advantages, disadvantages, and next actions whenever applicable.",
      "For investment, finance, crypto, real estate, legal, tax, or career-sensitive topics, use educational decision-support language, state uncertainty, and avoid guarantees.",
      "Keep Business Plan and Market Analysis separate: do not generate a PDF-style report in Chat mode. If the user explicitly wants a full structured report, suggest AI Plan or Market Analysis.",
      "Use concise markdown when it improves readability. Match the user's language.",
    ].join("\n");
    const inputMessages = [
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
      ...(reportMemory
        ? [
            {
              role: "user" as const,
              content: `Saved ZERINIX report memory. Use this as the primary source for answering report-related questions:\n\n${reportMemory.content}`,
            },
          ]
        : []),
      {
        role: "user" as const,
        content: prompt,
      },
    ];
    const finalPromptLength =
      instructionsText.length +
      inputMessages.reduce((total, message) => total + message.content.length, 0);

    console.info("[api:chat] provider call started", {
      model,
      selectedIntent,
      selectedExpert,
      requestKind,
      conversationId: conversationId || null,
      reportId: reportId || null,
      reportMemoryAttached: Boolean(reportMemory),
      reportMemoryDebugReason,
      reportMemoryLength: reportMemory?.content.length || 0,
      promptLength: prompt.length,
      finalPromptLength,
      providerCalled: true,
      quotaConsumed: false,
    });

    const stream = await client.responses
      .create(
        {
          model,
          reasoning: { effort: "minimal" },
          text: { verbosity: "low" },
          instructions: instructionsText,
          input: inputMessages,
          max_output_tokens: maxOutputTokens,
          stream: true,
        },
        { signal: req.signal }
      )
      .catch(async (error) => {
        const errorMessage = getChatErrorMessage(error);

        console.info("[api:chat] provider request failed", {
          model,
          selectedIntent,
          selectedExpert,
          requestKind,
          conversationId: conversationId || null,
          providerCalled: true,
          quotaConsumed: false,
          failureReason: errorMessage,
        });

        await recordAiUsage(supabase, {
          userId: user.id,
          endpoint: "/api/chat",
          reportField: "chat",
          promptHash,
          model,
          planTier,
          tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          estimatedCostUsd: 0,
          cacheHit: false,
          status: "failed",
          responseTimeMs: Date.now() - startedAt,
          metadata: {
            quota_event: false,
            quota_mode: requestKind,
            quota_consumed: false,
            usage_kind: "chat_message",
            conversation_id: conversationId || null,
            selected_intent: selectedIntent,
            selected_expert: selectedExpert,
            request_kind: requestKind,
            profile_used: Boolean(profileContext),
            report_memory_used: Boolean(reportMemory),
            report_id: reportMemory?.id || null,
            model_preference: modelPreference,
            attachment_count: attachments.length,
            actual_ai_call: true,
            phase: "openai_request",
            error_message: errorMessage,
          },
        });

        throw error;
      });

    const encoder = new TextEncoder();

    return new Response(
      new ReadableStream({
        async start(controller) {
          let streamedText = "";
          let completedText = "";
          let completedResponse: unknown = null;
          let incompleteReason = "";
          let usedDisplayFallback = false;
          let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

          try {
            for await (const event of stream) {
              if (event.type === "response.output_text.delta" && event.delta) {
                const deltaText = extractTextFromValue(event.delta);

                if (deltaText) {
                  streamedText += deltaText;
                  controller.enqueue(encoder.encode(deltaText));
                }
              }

              if (event.type === "response.output_text.done" && !streamedText) {
                const doneText = extractTextFromValue(event.text);

                if (doneText) {
                  streamedText = doneText;
                  controller.enqueue(encoder.encode(doneText));
                }
              }

              if (event.type === "response.output_item.done" && !streamedText) {
                const itemText = extractOutputItemText(event.item);

                if (itemText) {
                  streamedText = itemText;
                  controller.enqueue(encoder.encode(itemText));
                }
              }

              if (event.type === "response.completed") {
                completedResponse = event.response;
                incompleteReason = getIncompleteReason(event.response);
                tokenUsage = extractTokenUsage(event.response);
                completedText = extractResponseText(event.response);

                if (getResponseStatus(event.response) === "incomplete") {
                  console.error("[api:chat] OpenAI response incomplete", {
                    model,
                    selectedIntent,
                    selectedExpert,
                    requestKind,
                    maxOutputTokens,
                    incompleteReason,
                    conversationId: conversationId || null,
                    responseShape: sanitizeResponseShape(event.response),
                  });
                }

                if (!streamedText && completedText) {
                  const sanitizedCompletedText = sanitizeAiResponseText(completedText);
                  streamedText = sanitizedCompletedText;
                  controller.enqueue(encoder.encode(sanitizedCompletedText));
                }
              }

              if (event.type === "response.incomplete") {
                completedResponse = event.response;
                incompleteReason = getIncompleteReason(event.response);
                tokenUsage = extractTokenUsage(event.response);
                completedText = extractResponseText(event.response);

                console.error("[api:chat] OpenAI response incomplete", {
                  model,
                  selectedIntent,
                  selectedExpert,
                  requestKind,
                  maxOutputTokens,
                  incompleteReason,
                  conversationId: conversationId || null,
                  responseShape: sanitizeResponseShape(event.response),
                });

                if (!streamedText && completedText) {
                  const sanitizedCompletedText = sanitizeAiResponseText(completedText);
                  streamedText = sanitizedCompletedText;
                  controller.enqueue(encoder.encode(sanitizedCompletedText));
                }
              }

              if (event.type === "response.failed") {
                const errorMessage =
                  event.response?.error?.message || "OpenAI chat response failed.";

                throw new Error(errorMessage);
              }

              if (event.type === "error") {
                throw new Error(event.message || "OpenAI chat stream failed.");
              }
            }

            if (!streamedText.trim()) {
              console.error("[api:chat] OpenAI completed without output text", {
                model,
                selectedIntent,
                selectedExpert,
                conversationId: conversationId || null,
                completedTextLength: completedText.length,
                streamFinalResponseAvailable: Boolean(completedText),
                responseStatus: getResponseStatus(completedResponse),
                incompleteReason,
                responseShape: sanitizeResponseShape(completedResponse),
              });

              streamedText = createIncompleteResponseFallback(incompleteReason);
              usedDisplayFallback = true;
              controller.enqueue(encoder.encode(streamedText));
            }

            streamedText = sanitizeAiResponseText(streamedText);

            controller.close();

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
                quota_mode: requestKind,
                quota_consumed: !productionLimit.quotaAlreadyCharged,
                usage_kind: "chat_message",
                conversation_id: conversationId || null,
                selected_intent: selectedIntent,
                selected_expert: selectedExpert,
                request_kind: requestKind,
                profile_used: Boolean(profileContext),
                report_memory_used: Boolean(reportMemory),
                report_id: reportMemory?.id || null,
                model_preference: modelPreference,
                attachment_count: attachments.length,
                actual_ai_call: true,
                max_output_tokens: maxOutputTokens,
                response_status: getResponseStatus(completedResponse) || null,
                incomplete_reason: incompleteReason || null,
                display_fallback_used: usedDisplayFallback,
              },
            });

            console.info("[api:chat] provider call completed", {
              model,
              selectedIntent,
              selectedExpert,
              requestKind,
              conversationId: conversationId || null,
              providerCalled: true,
              quotaConsumed: !productionLimit.quotaAlreadyCharged,
            });

            if (chatCacheEnabled && !usedDisplayFallback) {
              const estimatedCostUsd = estimateAiCostUsd(model, tokenUsage);

              await storeCachedAiResponse(supabase, {
                userId: user.id,
                cacheKey: chatCacheKey,
                promptHash,
                endpoint: "/api/chat",
                reportField: "chat",
                language: responseLanguage,
                model,
                responseText: streamedText,
                tokenUsage,
                estimatedCostUsd,
                expiresInDays: 7,
              });
            }
          } catch (error) {
            logServerError("api:chat:stream", error);
            const errorMessage = getChatErrorMessage(error);

            if (!streamedText.trim()) {
              controller.enqueue(encoder.encode(errorMessage));
            }

            controller.close();

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
                quota_mode: requestKind,
                quota_consumed: false,
                usage_kind: "chat_message",
                conversation_id: conversationId || null,
                selected_intent: selectedIntent,
                selected_expert: selectedExpert,
                request_kind: requestKind,
                profile_used: Boolean(profileContext),
                report_memory_used: Boolean(reportMemory),
                report_id: reportMemory?.id || null,
                model_preference: modelPreference,
                attachment_count: attachments.length,
                actual_ai_call: true,
                error_message: errorMessage,
              },
            });
          }
        },
      }),
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
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
