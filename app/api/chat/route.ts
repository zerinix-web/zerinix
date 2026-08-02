import { NextResponse } from "next/server";
import type { ResponseInput } from "openai/resources/responses/responses";
import { authorizeStrategicReportAccess } from "@/app/lib/strategic-report-access";
import { createClient } from "@/app/lib/supabase/server";
import {
  checkRateLimit,
  getClientIpFromRequest,
  getRateLimitHeaders,
} from "@/app/lib/security/rate-limit";
import { validateApiRequest } from "@/app/lib/security/request-validation";
import { logServerError } from "@/app/lib/security/errors";
import { logOperationalError, logOperationalInfo } from "@/app/lib/security/logging";
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
import {
  buildAnalysisAssetContext as buildAttachmentContext,
  buildAnalysisAssetModelContent as buildAttachmentModelContent,
  extractAnalysisUrls,
  getAnalysisAssetValidationError as getAttachmentValidationError,
  normalizeAnalysisAssets as normalizeAttachments,
  shouldUseAnalysisWebResearch,
  type AnalysisAsset as ChatAttachmentInput,
} from "@/app/lib/ai/analysis-assets";
import { checkAiProductionRateLimit } from "@/app/lib/ai/rate-limit";
import { recordAIAbuseEvent } from "@/app/lib/ai/abuse-protection";
import { loadUserReport, type DashboardReport } from "@/app/dashboard/report-utils";
import {
  createOpenAiClient,
  getAiConfigurationErrorMessage,
  isAiTestMode,
  logAiExecution,
} from "@/app/lib/ai/runtime";
import { sanitizeAiResponseText } from "@/app/lib/ai/response-sanitization";
import {
  createAiCostOptimizationMetrics,
  omitTrailingDuplicateUserPrompt,
  optimizeChatHistoryForCost,
} from "@/app/lib/ai/token-optimization";
import {
  applyUserMemoryOperations,
  buildUserMemoryContext,
  extractExplicitMemoryOperations,
  getUserMemoryByType,
  getUserNameFromMemories,
  loadUserMemoriesForUser,
  type UserMemory,
  type UserMemoryType,
} from "@/app/lib/ai/user-memory";
import {
  expertInstructions,
  type AiExpert,
} from "@/app/lib/report-engine/prompts/chat";
import {
  createOpenAiRequestId,
  finalizeOpenAiCostResponse,
  runWithOpenAiCostContext,
  setOpenAiCostIdentity,
  withOpenAiCostOperation,
} from "@/app/lib/ai/cost-instrumentation";

type ChatInputMessage = {
  role: "user" | "assistant";
  content: string;
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

const MAX_REPORT_MEMORY_SECTION_CHARS = 2_800;
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
    .slice(-10);
}

function normalizeReportId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 128) : "";
}

function getRelevantReportSectionTitles(
  report: DashboardReport,
  prompt: string,
  messages: ChatInputMessage[]
) {
  const query = [...messages.slice(-3).map((message) => message.content), prompt]
    .join("\n")
    .toLowerCase();

  if (/\b(full report|entire report|whole report|summari[sz]e|overview|executive summary|investment memo)\b/i.test(query)) {
    return null;
  }

  const titleMatchers: RegExp[] = [];

  if (/\b(tam|sam|som|market size|market opportunity|cagr)\b/i.test(query)) {
    titleMatchers.push(/tam|sam|som|market|opportun|size|trend/i);
  }

  if (/\b(competitors?|competition|porter|swot|threats?|moat)\b/i.test(query)) {
    titleMatchers.push(/compet|porter|swot|threat|risk|market/i);
  }

  if (/\b(risks?|weakness|threat|regulation|downside)\b/i.test(query)) {
    titleMatchers.push(/risk|swot|threat|weakness|recommend/i);
  }

  if (/\b(financial|revenue|arr|mrr|cac|ltv|gross margin|burn|runway|payback|unit economics|kpi|scenario)\b/i.test(query)) {
    titleMatchers.push(/financial|unit economics|kpi|scenario|pricing|business model|assumption/i);
  }

  if (/\b(recommendation|decision|invest|go|no go|wait|next action)\b/i.test(query)) {
    titleMatchers.push(/recommend|executive|scenario|risk|financial/i);
  }

  if (/\b(source|citation|reference|assumption)\b/i.test(query)) {
    titleMatchers.push(/source|citation|reference|assumption/i);
  }

  if (titleMatchers.length === 0) {
    return null;
  }

  const selectedTitles = new Set<string>();

  for (const section of report.sections) {
    const title = section.title.trim();

    if (/executive summary/i.test(title) || titleMatchers.some((matcher) => matcher.test(title))) {
      selectedTitles.add(title);
    }
  }

  return selectedTitles.size ? selectedTitles : null;
}

function trimReportMemorySectionContent(value: string) {
  const content = value.replace(/\s+/g, " ").trim();

  if (content.length <= MAX_REPORT_MEMORY_SECTION_CHARS) {
    return content;
  }

  return `${content.slice(0, 2_000).trim()} … ${content.slice(-700).trim()}`;
}

function buildReportMemoryContext(
  report: DashboardReport | null,
  prompt = "",
  messages: ChatInputMessage[] = []
): ReportMemoryContext | null {
  if (!report || report.status.toLowerCase() !== "completed" || report.sections.length === 0) {
    return null;
  }

  const relevantTitles = getRelevantReportSectionTitles(report, prompt, messages);
  const sectionBlocks = report.sections
    .filter((section) => !relevantTitles || relevantTitles.has(section.title.trim()))
    .map((section) => {
      const title = section.title.trim();
      const content = trimReportMemorySectionContent(section.content);

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

function isExplicitSavedReportQuestion(prompt: string) {
  return /\bmy\s+(saved\s+|attached\s+|generated\s+)?report\b|\b(the|this)\s+(saved|attached|generated)\s+report\b|\b(saved|attached|generated)\s+report\b|\breport\s+(i|we)\s+(saved|attached|generated)\b|\b(kayıtlı|kaydedilmiş|ekli|oluşturduğum)\s+rapor\b|\b(mein|gespeicherte[rs]?|angehängte[rs]?)\s+bericht\b/i.test(
    prompt
  );
}

function formatMissingSavedReportResponse(
  responseLanguage: "English" | "Turkish"
) {
  if (responseLanguage === "Turkish") {
    return "Kayıtlı rapor bu konuşmada kullanılamıyor. Raporu açarak devam edebilir veya sorunuzu doğrudan sorabilirsiniz; mevcut konuşma bağlamından yanıtlayabilirim.";
  }

  return "That saved report is not available in this conversation. Open the report to continue from it, or ask your question directly and I can answer from our current conversation.";
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

function hasProfileContext(profile: AiChatProfile | null) {
  return Boolean(buildProfileContext(profile));
}

function shouldAttachProfileContext(input: {
  prompt: string;
  messages: ChatInputMessage[];
  profile: AiChatProfile | null;
  intent: ChatIntent;
  advisorRequest: boolean;
  reportQuestion: boolean;
  hasAttachments: boolean;
}) {
  if (!hasProfileContext(input.profile)) {
    return false;
  }

  if (
    input.advisorRequest ||
    input.reportQuestion ||
    input.hasAttachments ||
    input.intent !== "General"
  ) {
    return true;
  }

  const text = [...input.messages.slice(-3).map((message) => message.content), input.prompt]
    .join("\n")
    .toLowerCase();

  return /\b(my profile|my preferences?|preferred|preference|country|market|budget|risk tolerance|language|writing style|experience|available time|goals?|business interests?|industry|industries)\b/i.test(
    text
  );
}

function shouldAttachUserMemoryContext(input: {
  prompt: string;
  messages: ChatInputMessage[];
  memories: UserMemory[];
  intent: ChatIntent;
  advisorRequest: boolean;
  reportQuestion: boolean;
  hasAttachments: boolean;
}) {
  if (input.memories.length === 0) {
    return false;
  }

  if (input.memories.some((memory) => memory.type === "name")) {
    return true;
  }

  if (
    input.advisorRequest ||
    input.reportQuestion ||
    input.hasAttachments ||
    input.intent !== "General"
  ) {
    return true;
  }

  const text = [...input.messages.slice(-3).map((message) => message.content), input.prompt]
    .join("\n")
    .toLowerCase();

  return /\b(who am i|my name|my company|my preferences?|remember|saved about me|what do you know about me|language preference|writing style|long[-\s]?term goal|always|prefer)\b/i.test(
    text
  );
}

function detectResponseLanguage(value: string) {
  const normalized = value.toLowerCase();
  const hasEnglishStructure =
    /\b(analyze|analyse|analysis|market|business|startup|company|idea|report|strategy|pricing|competitors?|customers?|growth|create|generate|validate|in|for|with|and|the|hello|hi)\b/i.test(
      normalized
    );
  const hasTurkishWords =
    /\b(ülke|bütçe|risk|yatırım|iş|fikir|pazar|hedef|deneyim|zaman|para|öneri|girişim|ben kimim|adim ne|adım ne|ismim ne|ismin ne|beni taniyor musun|beni tanıyor musun)\b/i.test(
      normalized
    );

  if (hasEnglishStructure && !hasTurkishWords) {
    return "English";
  }

  return /[çğıöşü]/i.test(normalized) || hasTurkishWords
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
  profileContext: string;
  userMemoryContext: string;
  webResearch: boolean;
}) {
  return (
    input.attachments.length === 0 &&
    !input.webResearch &&
    !input.reportMemory &&
    !input.profileContext &&
    !input.userMemoryContext &&
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

function isUserIdentityQuestion(prompt: string) {
  return /^(?:who am i|what is my name|do you know my name|who do you know me as|ben kimim|ad[ıi]m ne|[İIıi]smim ne|beni tan[ıi]yor musun)\??$/i.test(
    prompt.trim()
  );
}

function getMemoryRecallType(prompt: string): UserMemoryType | null {
  const normalized = prompt.trim().toLowerCase();

  if (/^(?:who am i|what is my name|do you know my name|who do you know me as|ben kimim|ad[ıi]m ne|ismim ne|beni tan[ıi]yor musun)\??$/.test(normalized)) {
    return "name";
  }

  if (/\b(?:what is my company|which company|where do i work|what company do i work)\b/.test(normalized)) {
    return "company";
  }

  if (/\b(?:which language do i prefer|what language do i prefer|preferred language|language preference)\b/.test(normalized)) {
    return "language";
  }

  if (/\b(?:how should you answer me|how should you respond|writing style|response style)\b/.test(normalized)) {
    return "writing_style";
  }

  if (/\b(?:what is my long[-\s]?term goal|what is my goal|long[-\s]?term goal)\b/.test(normalized)) {
    return "long_term_goal";
  }

  return null;
}

function formatMemorySaveResponse(
  type: UserMemoryType,
  content: string,
  responseLanguage: "English" | "Turkish"
) {
  if (responseLanguage === "Turkish") {
    switch (type) {
      case "name":
        return `Adınızı ${content} olarak kaydettim.`;
      case "company":
        return `Şirketinizi ${content} olarak kaydettim.`;
      case "language":
        return `Dil tercihinizi ${content} olarak kaydettim.`;
      case "writing_style":
        return `${content} tercihinizi hatırlayacağım.`;
      case "long_term_goal":
        return "Uzun vadeli hedefinizi kaydettim.";
      default:
        return "Bunu hatırlayacağım.";
    }
  }

  switch (type) {
    case "name":
      return `I've saved your name as ${content}.`;
    case "company":
      return `I've saved your company as ${content}.`;
    case "language":
      return `I've saved your language preference as ${content}.`;
    case "writing_style":
      return `I'll remember that you prefer ${content}.`;
    case "long_term_goal":
      return "I've saved your long-term goal.";
    default:
      return "I'll remember that.";
  }
}

function formatMemoryRecallResponse(
  type: UserMemoryType,
  content: string,
  responseLanguage: "English" | "Turkish"
) {
  if (responseLanguage === "Turkish") {
    switch (type) {
      case "name":
        return `Senin adın ${content}. Nasıl yardımcı olabilirim?`;
      case "company":
        return `${content} için nasıl yardımcı olabilirim?`;
      case "language":
        return `Elbette, ${content} yanıt vereceğim.`;
      case "writing_style":
        return `Elbette, ${content} biçiminde yanıtlayacağım.`;
      case "long_term_goal":
        return `Bu hedef doğrultusunda nasıl yardımcı olabilirim?`;
      default:
        return content;
    }
  }

  switch (type) {
    case "name":
      return `Hi ${content}. How can I help today?`;
    case "company":
      return `Your company is ${content}.`;
    case "language":
      return `Of course, I'll respond in ${content}.`;
    case "writing_style":
      return `You prefer ${content}.`;
    case "long_term_goal":
      return `Your long-term goal is ${content}.`;
    default:
      return content;
  }
}

function getSavedMemoryContent(memories: UserMemory[], type: UserMemoryType) {
  return getUserMemoryByType(memories, type);
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

  if (requestKind === "business_advice" || requestKind === "investment_advice") {
    return 3_200;
  }

  if (requestKind === "file_analysis") {
    return 3_500;
  }

  return 3_000;
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

type ChatAuthorizationDiagnostic = {
  authenticatedUserId: string | null;
  authenticatedEmail: string | null;
  selectedAction: string | null;
  requestMode: string | null;
  chatMode: string | null;
  reportMode: string | null;
  attachmentCount: number;
  attachmentMimeTypes: string[];
  hasAttachments: boolean;
  fileAnalysis: boolean;
  intent: string | null;
  isStrategicReport: boolean;
  isContinueAsChat: boolean;
  authorizationBranch: string;
  reason: string;
};

function logChatAuthorizationDecision(
  branchId:
    | "AUTH_BRANCH_01"
    | "AUTH_BRANCH_02"
    | "AUTH_BRANCH_03"
    | "AUTH_BRANCH_04",
  diagnostic: ChatAuthorizationDiagnostic
) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.info(`[api:chat:authorization] ${branchId}`, diagnostic);
}

async function handleChatPost(req: Request) {
  const requestValidation = validateApiRequest(req, {
    maxBodyBytes: 17_000_000,
  });

  if (!requestValidation.ok) {
    if (requestValidation.status === 401 || requestValidation.status === 403) {
      logChatAuthorizationDecision("AUTH_BRANCH_01", {
        authenticatedUserId: null,
        authenticatedEmail: null,
        selectedAction: null,
        requestMode: null,
        chatMode: null,
        reportMode: null,
        attachmentCount: 0,
        attachmentMimeTypes: [],
        hasAttachments: false,
        fileAnalysis: false,
        intent: null,
        isStrategicReport: false,
        isContinueAsChat: false,
        authorizationBranch: "request_validation_denied",
        reason: requestValidation.message,
      });
    }
    return NextResponse.json(
      { error: requestValidation.message },
      { status: requestValidation.status }
    );
  }

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
      logChatAuthorizationDecision("AUTH_BRANCH_02", {
        authenticatedUserId: user?.id || null,
        authenticatedEmail: user?.email || null,
        selectedAction: null,
        requestMode: null,
        chatMode: null,
        reportMode: null,
        attachmentCount: 0,
        attachmentMimeTypes: [],
        hasAttachments: false,
        fileAnalysis: false,
        intent: null,
        isStrategicReport: false,
        isContinueAsChat: false,
        authorizationBranch: userError
          ? "supabase_get_user_error"
          : "authenticated_user_missing",
        reason: userError?.message || "No authenticated user was returned.",
      });
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    setOpenAiCostIdentity({ userId: user.id, reportType: "strategic_advisory" });

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
    const attachmentValidationError = getAttachmentValidationError(body?.attachments);

    if (attachmentValidationError) {
      await recordAIAbuseEvent(supabase, {
        userId: user.id,
        type: "oversized_input",
        metadata: {
          endpoint: "/api/chat",
          reason: attachmentValidationError,
          ip,
        },
      });

      return NextResponse.json(
        { error: attachmentValidationError },
        { status: 400 }
      );
    }

    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const messages = normalizeMessages(body?.messages);
    const attachments = normalizeAttachments(body?.attachments);
    const isDirectStrategicAdvisory = body?.analysisMode === "chat";
    const promptUrls = extractAnalysisUrls(prompt);
    const webResearch = shouldUseAnalysisWebResearch(prompt, attachments);
    const requestedMode =
      body?.requestMode === "file_analysis" ? "file_analysis" : "chat";
    const isFileAnalysis =
      requestedMode === "file_analysis" && attachments.length > 0;
    const rawChatMode =
      typeof body?.chatMode === "string" ? body.chatMode.trim().slice(0, 80) : "";
    const rawReportMode =
      typeof body?.reportMode === "string" ? body.reportMode.trim().slice(0, 80) : "";
    const selectedAction =
      typeof body?.selectedAction === "string" && body.selectedAction.trim()
        ? body.selectedAction.trim().slice(0, 80)
        : requestedMode === "file_analysis"
          ? "continue_as_chat"
          : "chat";
    const authorizationIntent = classifyIntent(messages, prompt, null);
    const isStrategicReport =
      rawReportMode === "plan" ||
      rawReportMode === "market" ||
      selectedAction === "generate_strategic_report";
    const isContinueAsChat = selectedAction === "continue_as_chat";
    const reportAccess = await authorizeStrategicReportAccess({
      request: req,
      account: user,
    });
    const betaAccessAllowed = reportAccess.allowed;
    const betaAuthorizationBranch = reportAccess.allowed
      ? reportAccess.branch
      : isFileAnalysis
        ? "authenticated_file_analysis"
        : reportAccess.branch;

    if (process.env.NODE_ENV !== "production") {
      console.info("[api:chat:file-routing]", {
        selectedAction:
          requestedMode === "file_analysis" ? "continue_as_chat" : "chat",
        attachmentCount: attachments.length,
        attachmentMimeTypes: attachments.map(
          (attachment) => attachment.type || "application/octet-stream"
        ),
        resolvedRequestMode: isFileAnalysis ? "file_analysis" : "chat",
        fileAnalysis: isFileAnalysis,
        betaAuthorizationBranch,
      });
    }

    if (!betaAccessAllowed && !isFileAnalysis) {
      logChatAuthorizationDecision("AUTH_BRANCH_03", {
        authenticatedUserId: user.id,
        authenticatedEmail: user.email || null,
        selectedAction,
        requestMode: requestedMode,
        chatMode: rawChatMode || "chat",
        reportMode: rawReportMode || null,
        attachmentCount: attachments.length,
        attachmentMimeTypes: attachments.map(
          (attachment) => attachment.type || "application/octet-stream"
        ),
        hasAttachments: attachments.length > 0,
        fileAnalysis: isFileAnalysis,
        intent: authorizationIntent,
        isStrategicReport,
        isContinueAsChat,
        authorizationBranch: betaAuthorizationBranch,
        reason:
          "Private beta authorization failed because the authenticated user is not beta-allowed and the request did not resolve to file_analysis.",
      });
      return NextResponse.json(
        { error: "Private beta access only." },
        { status: 403 }
      );
    }

    logChatAuthorizationDecision("AUTH_BRANCH_04", {
      authenticatedUserId: user.id,
      authenticatedEmail: user.email || null,
      selectedAction,
      requestMode: requestedMode,
      chatMode: rawChatMode || "chat",
      reportMode: rawReportMode || null,
      attachmentCount: attachments.length,
      attachmentMimeTypes: attachments.map(
        (attachment) => attachment.type || "application/octet-stream"
      ),
      hasAttachments: attachments.length > 0,
      fileAnalysis: isFileAnalysis,
      intent: authorizationIntent,
      isStrategicReport,
      isContinueAsChat,
      authorizationBranch: betaAuthorizationBranch,
      reason: reportAccess.allowed
        ? `Authorization continued through ${reportAccess.branch}.`
        : "Authorization continued because the request resolved to authenticated file_analysis.",
    });

    const reportId = normalizeReportId(body?.reportId);
    const modelPreference = body?.modelPreference === "balanced" ? "balanced" : "fast";
    const conversationId =
      typeof body?.conversationId === "string"
        ? body.conversationId.trim().slice(0, 128)
        : "";

    if (!prompt) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const responseLanguage = detectResponseLanguage(prompt);
    const { data: profileData, error: profileError } = await supabase
      .from("ai_chat_profiles")
      .select(
        "preferred_country,preferred_industries,investment_budget_ranges,preferred_language,experience_level,available_time,business_interests,risk_tolerance,long_term_goals"
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      logServerError("api:chat:profile-select", profileError);
    }

    const chatProfile = normalizeProfile(profileData);
    const memoryOperations = extractExplicitMemoryOperations(prompt);
    const memoryApplyResult = memoryOperations.length > 0
      ? await applyUserMemoryOperations(supabase, user.id, memoryOperations, user)
      : { remembered: 0, forgotten: 0, failed: 0, storage: "none" as const };

    if (memoryOperations.length > 0) {
      logOperationalInfo("[api:chat] persistent memory operation", {
        userId: user.id,
        conversationId: conversationId || null,
        operationCount: memoryOperations.length,
        remembered: memoryApplyResult.remembered,
        forgotten: memoryApplyResult.forgotten,
        failed: memoryApplyResult.failed,
        storage: memoryApplyResult.storage,
        error: memoryApplyResult.error || null,
      });
    }

    if (memoryApplyResult.failed > 0) {
      return textStream(
        `I could not save that to persistent memory because the memory database write failed.\n\n${memoryApplyResult.error || "No Supabase error details were returned."}`
      );
    }

    const userMemories = await loadUserMemoriesForUser(
      supabase,
      user,
      memoryApplyResult.fallbackMemories
    );
    const rememberedName = getUserNameFromMemories(userMemories);

    if (memoryOperations.length > 0) {
      if (memoryApplyResult.storage !== "table") {
        return textStream(
          `I could not save that to public.user_memories, so I will not claim it was saved.\n\nStorage used: ${memoryApplyResult.storage}.\n${memoryApplyResult.error || "No Supabase table-write error was returned."}`
        );
      }

      if (memoryApplyResult.remembered > 0 || memoryApplyResult.forgotten > 0) {
        const savedOperation = memoryOperations.find(
          (operation) => operation.action === "remember"
        );

        if (memoryApplyResult.remembered > 0 && savedOperation?.action === "remember") {
          const savedContent =
            getSavedMemoryContent(userMemories, savedOperation.type) || savedOperation.content;

          return textStream(
            formatMemorySaveResponse(savedOperation.type, savedContent, responseLanguage)
          );
        }

        if (memoryApplyResult.remembered > 0) {
          return textStream("I've saved that to persistent memory.");
        }

        return textStream("I've removed that from persistent memory.");
      }

      return textStream("That memory is already saved.");
    }

    const reportQuestion = isReportMemoryQuestion(prompt, messages);
    const explicitSavedReportQuestion = isExplicitSavedReportQuestion(prompt);
    const loadedReport = reportId && reportQuestion
      ? await loadUserReport(supabase, user, reportId)
      : null;
    const reportMemory = buildReportMemoryContext(loadedReport, prompt, messages);
    const reportMemoryDebugReason = reportMemory
      ? "attached"
      : reportId
        ? reportQuestion
          ? loadedReport
            ? "Report was found but is not completed or has no saved sections."
            : `Report id ${reportId} was not found for the authenticated user.`
          : "Report id was provided but this message did not require report memory."
        : "No report id was provided with this chat request.";
    const { intent: selectedIntent, expert: selectedExpert } = classifyExpert(
      messages,
      prompt,
      chatProfile
    );
    const advisorRequest = isBusinessAdvisorConversation(messages, prompt);
    const missingAdvisorContext = advisorRequest
      ? getMissingAdvisorContext(messages, prompt, chatProfile)
      : [];
    const essentialAdvisorQuestions =
      advisorRequest &&
      !isDirectStrategicAdvisory &&
      !reportMemory &&
      attachments.length === 0 &&
      promptUrls.length === 0
      ? getEssentialAdvisorQuestions(selectedIntent, prompt, missingAdvisorContext)
      : [];
    const requestKind = isFileAnalysis
      ? "file_analysis"
      : classifyChatRequestKind(selectedIntent, attachments, advisorRequest);
    const profileContext = shouldAttachProfileContext({
      prompt,
      messages,
      profile: chatProfile,
      intent: selectedIntent,
      advisorRequest,
      reportQuestion,
      hasAttachments: attachments.length > 0,
    })
      ? buildProfileContext(chatProfile)
      : "";
    const userMemoryContext = shouldAttachUserMemoryContext({
      prompt,
      messages,
      memories: userMemories,
      intent: selectedIntent,
      advisorRequest,
      reportQuestion,
      hasAttachments: attachments.length > 0,
    })
      ? buildUserMemoryContext(userMemories)
      : "";

    logOperationalInfo("[api:chat] persistent memory loaded", {
      userId: user.id,
      conversationId: conversationId || null,
      memoryCount: userMemories.length,
      memoryContextAttached: Boolean(userMemoryContext),
      hasRememberedName: Boolean(rememberedName),
      storage: memoryApplyResult.storage,
    });

    const recallType = getMemoryRecallType(prompt);
    const recalledMemory = recallType ? getUserMemoryByType(userMemories, recallType) : "";

    if (recallType && recalledMemory) {
      logOperationalInfo("[api:chat] answered from persistent memory", {
        endpoint: "/api/chat",
        mode: requestKind,
        providerCalled: false,
        memoryContextAttached: true,
        memoryType: recallType,
      });

      return textStream(
        formatMemoryRecallResponse(recallType, recalledMemory, responseLanguage)
      );
    }

    if (isUserIdentityQuestion(prompt) && rememberedName) {
      logOperationalInfo("[api:chat] answered from persistent memory", {
        endpoint: "/api/chat",
        mode: requestKind,
        providerCalled: false,
        memoryContextAttached: true,
        memoryType: "name",
      });

      return textStream(
        formatMemoryRecallResponse("name", rememberedName, responseLanguage)
      );
    }

    if (isAiTestMode()) {
      logAiExecution({
        endpoint: "/api/chat",
        source: "mock",
        mode: requestKind,
      });

      return textStream(createMockChatResponse(prompt, selectedExpert));
    }

    if (explicitSavedReportQuestion && !reportMemory) {
      logOperationalInfo("[api:chat] report memory missing", {
        conversationId: conversationId || null,
        reportId: reportId || null,
        reportMemoryAttached: false,
        reportMemoryDebugReason,
        promptLength: prompt.length,
      });

      return textStream(formatMissingSavedReportResponse(responseLanguage));
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
      profileContext,
      userMemoryContext,
      webResearch,
    });
    const chatCacheKey = createAiCacheKey({
      endpoint: "/api/chat",
      normalizedPrompt: normalizeAiPrompt(
        userMemoryContext ? `${prompt}\n\nUser memories:\n${userMemoryContext}` : prompt
      ),
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
            user_memory_used: Boolean(userMemoryContext),
            user_memory_count: userMemories.length,
            memory_operation_count: memoryOperations.length,
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
    const attachmentModelContent = buildAttachmentModelContent(attachments);
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
    const historyWithoutCurrentPrompt = omitTrailingDuplicateUserPrompt(
      messages,
      prompt
    );
    const optimizedHistory = optimizeChatHistoryForCost(
      historyWithoutCurrentPrompt.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      {
        maxRecentMessages:
          reportMemory || attachmentContext ? 12 : requestKind === "simple_chat" ? 8 : 10,
        maxTotalChars: reportMemory || attachmentContext ? 22_000 : 16_000,
      }
    );
    const instructionsText = [
      "You are ZERINIX AI, a premium business operating assistant.",
      "Always reply in the same language as the user's latest message. This overrides saved profile language, persistent memory language, browser locale, and previous conversation language.",
      `Classified user intent: ${selectedIntent}.`,
      `Selected expert: ${selectedExpert}.`,
      expertInstructions[selectedExpert],
      "The selected expert must shape the perspective, vocabulary, priorities, caveats, and structure of the answer. Do not announce the routing process unless it helps the user.",
      profileContext
        ? `Persistent user profile for non-sensitive personalization:\n${profileContext}\nUse this profile to avoid asking for details the user has already saved. If the user's latest message conflicts with the profile, prioritize the latest message.`
        : "No persistent chat profile is available yet. Do not invent profile preferences.",
      userMemoryContext
        ? `Persistent user memories for stable personalization:\n${userMemoryContext}\nUse these memories as durable user facts and preferences. If the latest user message conflicts with memory, prioritize the latest message and only update memory when the user explicitly asks you to remember or forget something.`
        : "No persistent user memories are stored yet. Do not claim anything has been remembered unless the user explicitly asked and the request is handled.",
      reportMemory
        ? [
            "A saved ZERINIX report is attached as authoritative report memory.",
            "Prioritize the report memory over general model knowledge for every answer.",
            "If the report contains the answer, never say you assume; explicitly reference the relevant report finding or section.",
            "If the report does not contain the requested information, say that the report does not contain it, then use general reasoning clearly marked as outside-report reasoning.",
            "Keep using this report memory for follow-up questions in this conversation.",
          ].join("\n")
        : "Answer from the current conversation and general reasoning. Do not mention missing report context unless the user explicitly asks about a saved report.",
      "Answer naturally and directly. You may help with business, strategy, operations, finance, product, marketing, technology, or general questions.",
      "Use the conversation history for context, but do not fabricate facts.",
      "Treat attached file text and binary file inputs as primary user-supplied evidence. Analyze every attached asset directly, attribute material findings to its filename, and use those findings before general model knowledge. If neither readable text nor binary content is available, say so briefly when relevant.",
      promptUrls.length > 0
        ? `The user supplied these URLs as primary external context:\n${promptUrls.join("\n")}\nUse web research to inspect and corroborate them before answering.`
        : "No URL was supplied as primary external context.",
      "If the user asks for a structured investor report, suggest AI Plan or Market Analysis mode instead of generating the full report in Chat mode.",
      "Advisor quality rules: ask follow-up questions only if the missing information is absolutely necessary. Never ask for information already present in the persistent profile or conversation. If useful but non-critical information is missing, proceed with clearly labeled assumptions.",
      isDirectStrategicAdvisory
        ? "This is a direct Strategic Advisory submission. Lead with one concise recommendation paragraph. Then provide 3–5 key reasons, followed by Key risks and Immediate next actions. Write like an executive consultant, keep the response conversation-oriented, and avoid a long essay unless the user explicitly requests a detailed report. Do not end with follow-up questions. Treat missing information as assumptions, confidence limitations, evidence gaps, or next actions inside the answer."
        : "Use follow-up questions sparingly and only when an immediate useful answer is impossible.",
      "When giving recommendations, go deeper than generic advice. Rank options from best to worst, show step-by-step reasoning, explain why each option was chosen, and include estimated investment, expected ROI or outcome range, timeline, risks, advantages, disadvantages, and next actions whenever applicable.",
      "For investment, finance, crypto, real estate, legal, tax, or career-sensitive topics, use educational decision-support language, state uncertainty, and avoid guarantees.",
      "Keep Business Plan and Market Analysis separate: do not generate a PDF-style report in Chat mode. If the user explicitly wants a full structured report, suggest AI Plan or Market Analysis.",
      "Use concise markdown when it improves readability. Match the user's language.",
    ].join("\n");
    const originalInputMessages = [
      ...messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
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
    const inputMessages = [
      ...optimizedHistory.messages,
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
    const providerInput: ResponseInput =
      attachmentModelContent.length > 0
        ? [
            ...inputMessages.slice(0, -1),
            {
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                ...attachmentModelContent,
              ],
            },
          ]
        : inputMessages;
    const inputCostMetrics = createAiCostOptimizationMetrics({
      beforeText: `${instructionsText}\n${originalInputMessages
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n")}`,
      afterText: `${instructionsText}\n${inputMessages
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n")}`,
      trimmedMessageCount:
        optimizedHistory.metrics.trimmed_message_count +
        (messages.length - historyWithoutCurrentPrompt.length),
      model,
    });
    const finalPromptLength =
      instructionsText.length +
      inputMessages.reduce((total, message) => total + message.content.length, 0);

    logOperationalInfo("[api:chat] provider call started", {
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
      estimatedInputTokenSavings: inputCostMetrics.estimated_input_token_savings,
      estimatedInputCostSavingsUsd:
        inputCostMetrics.estimated_input_cost_savings_usd,
      trimmedMessageCount: inputCostMetrics.trimmed_message_count,
      providerCalled: true,
      quotaConsumed: false,
    });

    const stream = await withOpenAiCostOperation(
      {
        operationName: requestKind === "file_analysis" ? "file_analysis" : "advisor",
        reportType: "strategic_advisory",
      },
      () => client.responses.create(
        {
          model,
          reasoning: { effort: "minimal" },
          text: { verbosity: "low" },
          instructions: instructionsText,
          input: providerInput,
          max_output_tokens: maxOutputTokens,
          stream: true,
          ...(webResearch
            ? {
                tools: [
                  {
                    type: "web_search_preview" as const,
                    search_context_size: "low" as const,
                  },
                ],
                include: ["web_search_call.action.sources" as const],
              }
            : {}),
        },
        { signal: req.signal }
      )).catch(async (error) => {
        const errorMessage = getChatErrorMessage(error);

        logOperationalInfo("[api:chat] provider request failed", {
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
            user_memory_used: Boolean(userMemoryContext),
            user_memory_count: userMemories.length,
            memory_operation_count: memoryOperations.length,
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
                  logOperationalError("[api:chat]", new Error("OpenAI response incomplete"), {
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

                logOperationalError("[api:chat]", new Error("OpenAI response incomplete"), {
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
              logOperationalError("[api:chat]", new Error("OpenAI completed without output text"), {
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
                user_memory_used: Boolean(userMemoryContext),
                user_memory_count: userMemories.length,
                memory_operation_count: memoryOperations.length,
                report_memory_used: Boolean(reportMemory),
                report_id: reportMemory?.id || null,
                model_preference: modelPreference,
                attachment_count: attachments.length,
                actual_ai_call: true,
                max_output_tokens: maxOutputTokens,
                response_status: getResponseStatus(completedResponse) || null,
                incomplete_reason: incompleteReason || null,
                display_fallback_used: usedDisplayFallback,
                ...inputCostMetrics,
              },
            });

            logOperationalInfo("[api:chat] provider call completed", {
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
                ...inputCostMetrics,
                selected_intent: selectedIntent,
                selected_expert: selectedExpert,
                request_kind: requestKind,
                profile_used: Boolean(profileContext),
                user_memory_used: Boolean(userMemoryContext),
                user_memory_count: userMemories.length,
                memory_operation_count: memoryOperations.length,
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

export async function POST(req: Request) {
  const requestId = createOpenAiRequestId(req);
  return runWithOpenAiCostContext(
    { requestId, route: "/api/chat", reportType: "strategic_advisory" },
    async () => finalizeOpenAiCostResponse(await handleChatPost(req))
  );
}
