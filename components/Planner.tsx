"use client";

import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { jsPDF } from "jspdf";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Clipboard,
  ClipboardCheck,
  CornerDownLeft,
  Download,
  Edit3,
  FileUp,
  FileText,
  FolderKanban,
  Gauge,
  Goal,
  LayoutDashboard,
  Landmark,
  ListChecks,
  Loader2,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Palette,
  PieChart,
  Plus,
  RefreshCcw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  User,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/app/lib/supabase/client";
import { sanitizeAiResponseText } from "@/app/lib/ai/response-sanitization";
import { logOperationalInfo } from "@/app/lib/security/logging";
import { isAmbiguousBusinessRequest } from "@/app/lib/business-idea-detection";
import {
  containsReportGenerationFailure,
  isReportGenerationFailureText,
} from "@/app/lib/report-errors";
import {
  normalizePdfText,
  repairPdfLineFragments,
} from "@/app/lib/pdf-normalization.mjs";

type ReportSection = {
  field?: keyof (MarketReport & PlanReport);
  title: string;
  icon: LucideIcon;
  content: string;
};

type MarketReport = {
  executiveSummary: string;
  marketOverview: string;
  tamSamSom: string;
  industryTrends: string;
  targetCustomer: string;
  competitorAnalysis: string;
  customerPainPoints: string;
  opportunities: string;
  threats: string;
  swotAnalysis: string;
  portersFiveForces: string;
  unitEconomics: string;
  financialDashboard: string;
  scenarioAnalysis: string;
  kpiDashboard: string;
  executiveRecommendation: string;
  founderRoadmap: string;
  sourcesAssumptions: string;
  entryStrategy: string;
  validationPlan: string;
  keyMetrics: string;
  sources: string;
};

type PlanReport = {
  executiveSummary: string;
  problem: string;
  solution: string;
  targetCustomer: string;
  marketOpportunity: string;
  competitorLandscape: string;
  businessModel: string;
  tamSamSom: string;
  swotAnalysis: string;
  portersFiveForces: string;
  pricingStrategy: string;
  goToMarketPlan: string;
  salesStrategy: string;
  unitEconomics: string;
  financialDashboard: string;
  scenarioAnalysis: string;
  kpiDashboard: string;
  executiveRecommendation: string;
  risks: string;
  kpis: string;
  founderRoadmap: string;
  roadmap306090: string;
  financialAssumptions: string;
  founderScore: string;
  sourcesAssumptions: string;
};

type MarketReportField = keyof MarketReport;
type PlanReportField = keyof PlanReport;

type ReportStreamEvent = Partial<MarketReport & PlanReport> & {
  done?: boolean;
  warning?: string;
  missingFields?: Array<MarketReportField | PlanReportField>;
  invalidFields?: Array<MarketReportField | PlanReportField>;
  partial?: boolean;
};

function getReportGenerationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

type ReportFieldDefinition = {
  field: keyof (MarketReport & PlanReport);
  title: string;
  icon: LucideIcon;
};

type ChatMode = "plan" | "market" | "chat";
type ChatModelPreference = "fast" | "balanced";

type ResponseLanguage = "English" | "Turkish";

type ChatAttachment = {
  id: string;
  name: string;
  size: number;
  textContent?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: ChatMode;
  attachments?: ChatAttachment[];
  status?: "streaming" | "complete" | "failed";
  createdAt: number;
};

type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

type PlannerWorkspace = {
  id: string;
  name: string;
};

type InitialReport = {
  id: string;
  workspaceId: string;
  title: string;
  prompt: string;
  type: "Business Plan" | "Market Analysis";
  status: string;
  sections: Array<{
    field?: string;
    title: string;
    content: string;
  }>;
};

type PlannerProps = {
  initialConversations?: Conversation[];
  conversationLoadError?: string;
  initialWorkspaces?: PlannerWorkspace[];
  initialWorkspaceId?: string;
  initialReport?: InitialReport | null;
};

const workflowSteps = [
  "Analyzing business model...",
  "Researching market...",
  "Analyzing competitors...",
  "Calculating financial estimates...",
  "Building strategy...",
  "Writing final report...",
];

const CHAT_STREAM_IDLE_TIMEOUT_MS = 60_000;
const CHAT_REQUEST_TIMEOUT_MS = 75_000;
const ACTIVE_REPORT_ID_STORAGE_KEY = "zerinix.activeReportId";

const chatModelOptions: Array<{
  value: ChatModelPreference;
  label: string;
  description: string;
}> = [
  {
    value: "fast",
    label: "Fast",
    description: "Quick everyday answers",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Deeper business reasoning",
  },
];

const modeSuggestions: Record<ChatMode, string[]> = {
  chat: [
    "Help me think through whether this idea is worth pursuing.",
    "Summarize the tradeoffs between bootstrapping and raising funding.",
    "Review this positioning and suggest a sharper version.",
  ],
  plan: [
    "Create a business plan for an AI CRM for clinics.",
    "Build a 90-day launch plan for a B2B SaaS product.",
    "Create an investor-ready plan for a premium private hospital chain.",
  ],
  market: [
    "Analyze the market for premium online education in Germany.",
    "Research the competitive landscape for EV charging in Turkey.",
    "Analyze demand for a luxury electric yacht company.",
  ],
};

const modeEmptyState: Record<ChatMode, { title: string; description: string; placeholder: string }> =
  {
    chat: {
      title: "Ask ZERINIX anything.",
      description:
        "Use a continuous AI chat with conversation memory, markdown answers, file context, and fast model routing.",
      placeholder: "Ask a strategy question, paste notes, or upload context for ZERINIX to analyze...",
    },
    plan: {
      title: "Create an investor-ready business plan.",
      description:
        "Describe the company, customer, market, constraints and goals. ZERINIX will turn it into a structured Business Plan report.",
      placeholder:
        "Example: AI CRM for private clinics in Germany, €99/month, sold to clinic owners, first market Berlin...",
    },
    market: {
      title: "Analyze a market with strategic depth.",
      description:
        "Enter a market, product category, geography or strategic question. ZERINIX will generate a structured Market Analysis report.",
      placeholder:
        "Example: Premium gym franchise market in Turkey, urban professionals, competitors, pricing and entry risk...",
    },
  };

const modeCards: Array<{
  mode: ChatMode;
  label: string;
  description: string;
  output: string;
  icon: LucideIcon;
}> = [
  {
    mode: "plan",
    label: "AI Plan",
    description: "Structured investor-grade business plan.",
    output: "Board-ready report",
    icon: BriefcaseBusiness,
  },
  {
    mode: "market",
    label: "Market Analysis",
    description: "Market sizing, competition, risks and entry logic.",
    output: "Diligence memo",
    icon: BarChart3,
  },
  {
    mode: "chat",
    label: "AI Chat",
    description: "Fast conversational advisor with memory.",
    output: "Live advisor response",
    icon: Bot,
  },
];

let pdfFontPromise: Promise<string> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function loadPdfFont() {
  pdfFontPromise ??= fetch("/fonts/Geist-Regular.ttf")
    .then((response) => {
      if (!response.ok) {
        throw new Error("PDF font could not be loaded.");
      }

      return response.arrayBuffer();
    })
    .then(arrayBufferToBase64);

  return pdfFontPromise;
}

function looksLikePromptOrInstruction(value: string) {
  return /\b(based on the entire report|would you invest|should i invest|what do you think|section to generate|report quality rules|write only|business idea\s*\/\s*goal|system prompt|internal instruction|validation prompt)\b/i.test(
    value
  );
}

function getFirstReadableReportSentence(value: string) {
  const cleaned = normalizePdfText(value)
    .replace(/[#*_`>-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || looksLikePromptOrInstruction(cleaned)) {
    return "";
  }

  const sentence = cleaned.match(/^(.{32,220}?[.!?])\s/)?.[1] || cleaned.slice(0, 180);

  return looksLikePromptOrInstruction(sentence) ? "" : sentence.trim();
}

function getBusinessIdeaFromPrompt(value: string) {
  const cleaned = normalizePdfText(value)
    .replace(/^[-*•]\s*/, "")
    .replace(/\?+$/g, "")
    .trim();

  if (!cleaned || looksLikePromptOrInstruction(cleaned)) {
    return "";
  }

  if (/\b(who is|what is|why|how|would|should|can you|tell me|analyze|compare)\b/i.test(cleaned)) {
    return "";
  }

  return cleaned.slice(0, 180);
}

function deriveBusinessDescriptionFromSections(
  sections: ReportSection[],
  fallbackTitle: string,
  sourcePrompt = ""
) {
  const promptDescription = getBusinessIdeaFromPrompt(sourcePrompt);

  if (promptDescription) {
    return promptDescription;
  }

  const priorityFields = [
    "businessModel",
    "solution",
    "executiveSummary",
    "marketOverview",
    "marketOpportunity",
    "targetCustomer",
  ];
  const prioritySections = priorityFields
    .map((field) => sections.find((section) => section.field === field))
    .filter((section): section is ReportSection => Boolean(section));
  const remainingSections = sections.filter(
    (section) => !prioritySections.includes(section)
  );

  for (const section of [...prioritySections, ...remainingSections]) {
    const sentence = getFirstReadableReportSentence(section.content);

    if (sentence) {
      return sentence;
    }
  }

  return looksLikePromptOrInstruction(fallbackTitle)
    ? "Analyzed business/company profile"
    : normalizePdfText(fallbackTitle || "Analyzed business/company profile");
}

const reportActions = [
  { label: "Competitor Analysis", icon: Search },
  { label: "Financial Plan", icon: PieChart },
  { label: "Brand Strategy", icon: Palette },
];

const reportFields: Array<{
  field: MarketReportField;
  title: string;
  icon: LucideIcon;
}> = [
  { field: "executiveSummary", title: "Executive Summary", icon: Sparkles },
  { field: "marketOverview", title: "Market Overview", icon: BarChart3 },
  { field: "tamSamSom", title: "TAM / SAM / SOM", icon: PieChart },
  { field: "industryTrends", title: "Industry Trends", icon: Gauge },
  { field: "targetCustomer", title: "Target Customer", icon: Users },
  { field: "competitorAnalysis", title: "Competitor Analysis", icon: Search },
  { field: "customerPainPoints", title: "Customer Pain Points", icon: ShieldAlert },
  { field: "opportunities", title: "Opportunities", icon: Goal },
  { field: "threats", title: "Threats", icon: ShieldAlert },
  { field: "swotAnalysis", title: "SWOT Analysis", icon: ListChecks },
  { field: "portersFiveForces", title: "Porter's Five Forces", icon: Landmark },
  { field: "unitEconomics", title: "Unit Economics", icon: TrendingUp },
  { field: "financialDashboard", title: "Financial Dashboard", icon: PieChart },
  { field: "scenarioAnalysis", title: "Scenario Analysis: Worst / Base / Best Case", icon: BarChart3 },
  { field: "kpiDashboard", title: "KPI Dashboard", icon: Gauge },
  { field: "executiveRecommendation", title: "Executive Recommendation", icon: Sparkles },
  { field: "entryStrategy", title: "Entry Strategy", icon: BriefcaseBusiness },
  { field: "validationPlan", title: "Validation Plan", icon: CalendarDays },
  { field: "founderRoadmap", title: "Founder Roadmap", icon: CalendarDays },
  { field: "keyMetrics", title: "Key Metrics", icon: Gauge },
  { field: "sourcesAssumptions", title: "Sources / Assumptions", icon: FileText },
  { field: "sources", title: "Sources", icon: FileText },
];

const planReportFields: Array<{
  field: PlanReportField;
  title: string;
  icon: LucideIcon;
}> = [
  { field: "executiveSummary", title: "Executive Summary", icon: Sparkles },
  { field: "problem", title: "Problem", icon: ShieldAlert },
  { field: "solution", title: "Solution", icon: Goal },
  { field: "targetCustomer", title: "Target Customer / ICP", icon: Users },
  { field: "marketOpportunity", title: "Market Opportunity", icon: BarChart3 },
  { field: "competitorLandscape", title: "Competitor Landscape", icon: Search },
  { field: "businessModel", title: "Business Model", icon: BriefcaseBusiness },
  { field: "tamSamSom", title: "TAM / SAM / SOM", icon: PieChart },
  { field: "swotAnalysis", title: "SWOT Analysis", icon: ListChecks },
  { field: "portersFiveForces", title: "Porter's Five Forces", icon: Landmark },
  { field: "pricingStrategy", title: "Pricing Strategy", icon: Landmark },
  { field: "goToMarketPlan", title: "Go-to-Market Plan", icon: Goal },
  { field: "salesStrategy", title: "Sales Strategy", icon: Users },
  { field: "unitEconomics", title: "Unit Economics", icon: TrendingUp },
  { field: "financialDashboard", title: "Financial Dashboard", icon: PieChart },
  { field: "scenarioAnalysis", title: "Scenario Analysis: Worst / Base / Best Case", icon: BarChart3 },
  { field: "kpiDashboard", title: "KPI Dashboard", icon: Gauge },
  { field: "executiveRecommendation", title: "Executive Recommendation", icon: Sparkles },
  { field: "risks", title: "Risks", icon: ShieldAlert },
  { field: "kpis", title: "KPIs", icon: ListChecks },
  { field: "founderRoadmap", title: "Founder Roadmap", icon: CalendarDays },
  { field: "roadmap306090", title: "30-60-90 Day Roadmap", icon: CalendarDays },
  { field: "financialAssumptions", title: "Financial Assumptions", icon: PieChart },
  { field: "founderScore", title: "AI Founder Score out of 100", icon: Gauge },
  { field: "sourcesAssumptions", title: "Sources / Assumptions", icon: FileText },
];

function localizeReportFields<T extends ReportFieldDefinition>(fields: T[]) {
  return fields;
}

function buildInitialReportData(
  initialReport: InitialReport | null | undefined,
  fields: Array<{ field: string; title: string }>,
  emptyReport: Record<string, string>
) {
  const restoredReport: Record<string, string> = { ...emptyReport };

  if (!initialReport?.sections.length) {
    return restoredReport;
  }

  const normalizedSections = new Map(
    initialReport.sections.map((section) => [
      (section.field || section.title).trim().toLowerCase(),
      section.content,
    ])
  );

  fields.forEach(({ field, title }) => {
    const fieldKey = field.toLowerCase();
    const titleKey = title.trim().toLowerCase();
    const content = normalizedSections.get(fieldKey) || normalizedSections.get(titleKey);

    if (content) {
      restoredReport[field] = content;
    }
  });

  return restoredReport;
}

function getInitialSelectedWorkspaceId(
  workspaces: PlannerWorkspace[],
  requestedWorkspaceId: string,
  reportWorkspaceId = ""
) {
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));

  if (requestedWorkspaceId && workspaceIds.has(requestedWorkspaceId)) {
    return requestedWorkspaceId;
  }

  if (reportWorkspaceId && workspaceIds.has(reportWorkspaceId)) {
    return reportWorkspaceId;
  }

  return workspaces[0]?.id || "";
}

const emptyMarketReport: MarketReport = {
  executiveSummary: "",
  marketOverview: "",
  tamSamSom: "",
  industryTrends: "",
  targetCustomer: "",
  competitorAnalysis: "",
  customerPainPoints: "",
  opportunities: "",
  threats: "",
  swotAnalysis: "",
  portersFiveForces: "",
  unitEconomics: "",
  financialDashboard: "",
  scenarioAnalysis: "",
  kpiDashboard: "",
  executiveRecommendation: "",
  entryStrategy: "",
  validationPlan: "",
  founderRoadmap: "",
  keyMetrics: "",
  sourcesAssumptions: "",
  sources: "",
};

const emptyPlanReport: PlanReport = {
  executiveSummary: "",
  problem: "",
  solution: "",
  targetCustomer: "",
  marketOpportunity: "",
  competitorLandscape: "",
  businessModel: "",
  tamSamSom: "",
  swotAnalysis: "",
  portersFiveForces: "",
  pricingStrategy: "",
  goToMarketPlan: "",
  salesStrategy: "",
  unitEconomics: "",
  financialDashboard: "",
  scenarioAnalysis: "",
  kpiDashboard: "",
  executiveRecommendation: "",
  risks: "",
  kpis: "",
  founderRoadmap: "",
  roadmap306090: "",
  financialAssumptions: "",
  founderScore: "",
  sourcesAssumptions: "",
};

function sanitizeReportContent(content: string) {
  return sanitizeAiResponseText(content)
    .replace(/\n\s*(?:sources|kaynaklar)\s*:[\s\S]*$/im, "")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^\s)]+\)/gi, "$1")
    .replace(/(?:https?:\/\/|www\.)[^\s),]+/gi, "")
    .replace(/\bEarly evidence\b/gi, "Directional")
    .replace(/\bDeveloping evidence\b/gi, "Developing")
    .replace(/\bStrong evidence\b/gi, "Verified")
    .replace(/\bSector view\b/gi, "Market view")
    .replace(/\bLow[\s-]+Confidence\b/gi, "Directional")
    .replace(/\bMedium[\s-]+Confidence\b/gi, "Developing")
    .replace(/\bHigh[\s-]+Confidence\b/gi, "Verified")
    .replace(/\bIndustry[\s-]+Estimate\b/gi, "Market view")
    .replace(/\bWAIT\b/g, "Hold for validation")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function sanitizeReportFieldContent(
  field: keyof (MarketReport & PlanReport),
  content: string
) {
  if (field === "sources" || field === "sourcesAssumptions") {
    return sanitizeAiResponseText(content)
      .normalize("NFC")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\bSource\s+unavailable\b/gi, "")
      .replace(/\bConfidence\s+unavailable\b/gi, "")
      .replace(/\bT\s*B\s*D\b/gi, "")
      .replace(/\bPlace\s*holder\b/gi, "")
      .replace(/\bUn\s*known\b/gi, "")
      .replace(/\bUn\s*available\b/gi, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return sanitizeReportContent(content);
}

function serializeReportSections(
  reportData: Partial<MarketReport & PlanReport>,
  fields: ReportFieldDefinition[]
) {
  const sections = fields.map(({ field, title }) => ({
    field,
    title,
    content: sanitizeReportFieldContent(field, reportData[field] || ""),
  }));

  const invalidSection = sections.find(
    (section) =>
      !section.content ||
      isReportGenerationFailureText(section.content)
  );

  if (invalidSection) {
    throw new Error(
      invalidSection.content && isReportGenerationFailureText(invalidSection.content)
        ? invalidSection.content
        : `Report section "${invalidSection.title}" was empty after sanitization.`
    );
  }

  return sections;
}

function isCompleteReportSectionPayload(
  sections: Array<{ title: string; content: string }>,
  expectedSectionCount: number
) {
  return (
    sections.length === expectedSectionCount &&
    sections.every((section) => section.title.trim() && section.content.trim()) &&
    !containsReportGenerationFailure(sections)
  );
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function needsClarification(value: string) {
  return isAmbiguousBusinessRequest(value);
}

function detectResponseLanguage(value: string): ResponseLanguage {
  const normalized = value.toLowerCase();
  const turkishSignals = [
    /[çğıöşü]/i,
    /\b(ve|bir|için|ile|ama|fakat|iş|hedef|müşteri|pazar|gelir|strateji|istiyorum|yap|kurmak|deneme|merhaba|selam|evet|hayır|lutfen|lütfen)\b/i,
  ];

  return turkishSignals.some((signal) => signal.test(normalized)) ? "Turkish" : "English";
}

function getLanguageCopy(language: ResponseLanguage) {
  if (language === "Turkish") {
    return {
      planTitle: "Business Plan Report",
      marketTitle: "Business Intelligence Report",
      preparingPlan: "## Business Plan Report\n\nPreparing the first sections...",
      preparingMarket: "## Business Intelligence Report\n\nPreparing live market research...",
      waitingSection: "This section is waiting for AI output.",
      sectionFallback: "The report service returned no content for this section.",
      genericError: "Something went wrong.",
      retryError: "The report request failed before a usable response was returned.",
      marketError: "Something went wrong during market analysis.",
      marketRetryError: "Something went wrong during market analysis. Please try again.",
      planClarification:
        "Please enter the business idea you want to plan. For example: luxury hotel brand, AI legal assistant, or premium private hospital chain.",
      marketClarification:
        "Please enter the business idea or industry you want analyzed. For example: luxury hotel brand, electric yacht company, or EV battery manufacturer.",
    };
  }

  return {
    planTitle: "Business Plan Report",
    marketTitle: "Business Intelligence Report",
    preparingPlan: "## Business Plan Report\n\nPreparing the first sections...",
    preparingMarket: "## Business Intelligence Report\n\nPreparing live market research...",
    waitingSection: "This section is waiting for AI output.",
    sectionFallback: "The report service returned no content for this section.",
    genericError: "Something went wrong.",
    retryError: "The report request failed before a usable response was returned.",
    marketError: "Something went wrong during market analysis.",
    marketRetryError: "Something went wrong during market analysis. Please try again.",
    planClarification:
      "Please enter the business idea you want to plan. For example: luxury hotel brand, AI legal assistant, or premium private hospital chain.",
    marketClarification:
      "Please enter the business idea or industry you want analyzed. For example: luxury hotel brand, electric yacht company, or EV battery manufacturer.",
  };
}

function createClarificationQuestionForLanguage(
  mode: ChatMode,
  language: ResponseLanguage
) {
  const copy = getLanguageCopy(language);

  if (mode === "chat") {
    return "How can I help? You can ask about business, strategy, product, finance, or any general topic.";
  }

  return mode === "market" ? copy.marketClarification : copy.planClarification;
}

function generateConversationTitle(content: string) {
  const cleanTitle = content
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s.,:!?-]/gu, "")
    .trim();

  if (!cleanTitle) {
    return "New ZERINIX conversation";
  }

  let title = cleanTitle
    .replace(/^(?:i\s+want\s+to\s+build|i\s+want\s+to\s+create|i\s+want\s+to\s+start|i\s+am\s+building|i'?m\s+building|we\s+want\s+to\s+build|we\s+are\s+building|build|create|start|make|launch)\s+/i, "")
    .replace(/^(?:an?|the)\s+/i, "")
    .replace(/\s+(?:business|startup|company|platform|app|tool|product|solution)\s*$/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();

  if (!title) {
    title = cleanTitle;
  }

  return title.length > 54 ? `${title.slice(0, 54).trim()}...` : title;
}

function shouldAutoTitleConversation(title: string) {
  return (
    title === "New conversation" ||
    title === "New ZERINIX conversation" ||
    title === "Untitled conversation"
  );
}

function createConversation(id: string): Conversation {
  const now = Date.now();

  return {
    id,
    title: "New conversation",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function getStoredActiveReportId() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.sessionStorage.getItem(ACTIVE_REPORT_ID_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function getReportMarkdown(
  title: string,
  reportData: Partial<MarketReport & PlanReport>,
  fields: ReportFieldDefinition[]
) {
  const sections = fields
    .map(({ field, title: sectionTitle }) => {
      const content = sanitizeReportFieldContent(field, reportData[field] || "");

      return content ? `### ${sectionTitle}\n${content}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  return `## ${title}\n\n${sections || "Preparing the first sections..."}`;
}

function normalizeConversationPreview(content: string) {
  return content
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isReportPreparingPreview(content: string) {
  const preview = normalizeConversationPreview(content).toLowerCase();

  return (
    preview.includes("preparing the first sections") ||
    preview.includes("preparing live market research")
  );
}

function getConversationPreview(conversation: Conversation) {
  const messages = [...conversation.messages].reverse();
  const failedMessage = messages.find(
    (message) => message.role === "assistant" && message.status === "failed"
  );

  if (failedMessage) {
    const failedPreview = normalizeConversationPreview(failedMessage.content);

    return failedPreview && !isReportPreparingPreview(failedPreview)
      ? failedPreview
      : "Report generation failed";
  }

  const latestMessage = messages.find(
    (message) => message.content.trim() && !isReportPreparingPreview(message.content)
  );

  return latestMessage
    ? normalizeConversationPreview(latestMessage.content)
    : "Ready for a new strategy session.";
}

function highlightCode(code: string) {
  const escaped = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .replace(
      /\b(const|let|var|function|return|async|await|if|else|for|while|type|interface|import|from|export|default|class|new|try|catch)\b/g,
      '<span class="text-teal-200">$1</span>'
    )
    .replace(/("[^"]*"|'[^']*'|`[^`]*`)/g, '<span class="text-amber-200">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="text-violet-200">$1</span>');
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  if (language.toLowerCase() === "mermaid") {
    return (
      <div className="my-4 overflow-hidden rounded-2xl border border-teal-300/20 bg-teal-300/[0.04]">
        <div className="flex items-center justify-between border-b border-teal-300/10 px-4 py-2">
          <span className="text-xs font-semibold tracking-[0.2em] text-teal-200">
            MERMAID
          </span>
          <button
            type="button"
            onClick={copyCode}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            {copied ? <ClipboardCheck className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="p-4">
          <div className="rounded-2xl border border-white/10 bg-black/40 p-4 font-mono text-xs leading-6 text-teal-50">
            {code.split("\n").map((line, index) => (
              <div key={`${line}-${index}`} className="flex gap-3">
                <span className="select-none text-zinc-600">{index + 1}</span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-white/10 bg-black/70">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2">
        <span className="text-xs font-medium text-zinc-500">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={copyCode}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
        >
          {copied ? (
            <ClipboardCheck className="h-3.5 w-3.5 text-teal-200" />
          ) : (
            <Clipboard className="h-3.5 w-3.5 text-teal-200" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-6 text-zinc-200">
        <code dangerouslySetInnerHTML={{ __html: highlightCode(code) }} />
      </pre>
    </div>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  const renderTextPart = (part: string, partKey: string) =>
    part.split(/(\$?\d+(?:[.,]\d+)*(?:\.\d+)?\s?(?:k|K|m|M|b|B|%|months?|days?)?)/g).map((segment, segmentIndex) => {
      const isNumberToken = /^\$?\d+(?:[.,]\d+)*(?:\.\d+)?\s?(?:k|K|m|M|b|B|%|months?|days?)?$/.test(
        segment
      );

      return (
        <span
          key={`${partKey}-${segmentIndex}`}
          className={isNumberToken ? "whitespace-nowrap" : undefined}
        >
          {segment}
        </span>
      );
    });

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={`${part}-${index}`}
              className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[0.92em] text-teal-100"
            >
              {part.slice(1, -1)}
            </code>
          );
        }

        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={`${part}-${index}`} className="font-semibold text-white">
              {part.slice(2, -2)}
            </strong>
          );
        }

        return <span key={`${part}-${index}`}>{renderTextPart(part, `${part}-${index}`)}</span>;
      })}
    </>
  );
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const rows = lines
    .filter((line) => line.includes("|"))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim())
    );
  const [header, separator, ...body] = rows;
  const bodyRows = separator?.every((cell) => /^:?-{3,}:?$/.test(cell))
    ? body
    : rows.slice(1);

  if (!header) {
    return null;
  }

  return (
    <div className="my-4 overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <thead className="bg-white/[0.04] text-zinc-200">
          <tr>
            {header.map((cell, cellIndex) => (
              <th key={`header-${cellIndex}-${cell}`} className="border-b border-white/10 px-4 py-3 font-semibold">
                <InlineMarkdown text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10 text-zinc-300">
          {bodyRows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}-${row.join("-")}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`} className="px-4 py-3 align-top">
                  <InlineMarkdown text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarkdownRenderer({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const deferredContent = useDeferredValue(content);
  const renderedContent = streaming ? deferredContent : content;
  const blocks = renderedContent.split(/```/g);

  return (
    <div className="min-w-0 space-y-4 text-[15px] leading-8 text-zinc-300 [overflow-wrap:anywhere]">
      {blocks.map((block, blockIndex) => {
        if (blockIndex % 2 === 1) {
          const [language = "", ...codeLines] = block.replace(/^\n/, "").split("\n");
          return (
            <CodeBlock
              key={`code-${blockIndex}`}
              language={language.trim()}
              code={codeLines.join("\n").trimEnd()}
            />
          );
        }

        const lines = block.split("\n");
        const elements: ReactNode[] = [];
        let paragraph: string[] = [];
        let table: string[] = [];
        let list: string[] = [];

        const flushParagraph = () => {
          if (paragraph.length === 0) {
            return;
          }

          elements.push(
            <p
              key={`p-${blockIndex}-${elements.length}`}
              className="max-w-4xl whitespace-pre-wrap text-zinc-300"
            >
              <InlineMarkdown text={paragraph.join("\n")} />
            </p>
          );
          paragraph = [];
        };

        const flushTable = () => {
          if (table.length === 0) {
            return;
          }

          elements.push(
            <MarkdownTable key={`table-${blockIndex}-${elements.length}`} lines={table} />
          );
          table = [];
        };

        const flushList = () => {
          if (list.length === 0) {
            return;
          }

          elements.push(
            <ul
              key={`list-${blockIndex}-${elements.length}`}
              className="space-y-2.5 text-zinc-300"
            >
              {list.map((item, itemIndex) => (
                <li key={`item-${blockIndex}-${itemIndex}-${item}`} className="flex gap-3">
                  <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200/80" />
                  <span>
                    <InlineMarkdown text={item.replace(/^[-*]\s+/, "")} />
                  </span>
                </li>
              ))}
            </ul>
          );
          list = [];
        };

        lines.forEach((line) => {
          if (!line.trim()) {
            flushParagraph();
            flushTable();
            flushList();
            return;
          }

          if (line.startsWith("### ")) {
            flushParagraph();
            flushTable();
            flushList();
            elements.push(
              <h4 key={`h4-${blockIndex}-${elements.length}`} className="pt-2 text-base font-semibold text-white">
                <InlineMarkdown text={line.slice(4)} />
              </h4>
            );
            return;
          }

          if (line.startsWith("## ")) {
            flushParagraph();
            flushTable();
            flushList();
            elements.push(
              <h3 key={`h3-${blockIndex}-${elements.length}`} className="pt-2 text-lg font-semibold text-white">
                <InlineMarkdown text={line.slice(3)} />
              </h3>
            );
            return;
          }

          if (/^[-*]\s+/.test(line)) {
            flushParagraph();
            flushTable();
            list.push(line);
            return;
          }

          if (line.includes("|") && line.trim().startsWith("|")) {
            flushParagraph();
            flushList();
            table.push(line);
            return;
          }

          flushTable();
          flushList();
          paragraph.push(line);
        });

        flushParagraph();
        flushTable();
        flushList();

        return elements;
      })}
    </div>
  );
}

type CitationData = {
  sourceTitle: string;
  organization: string;
  publicationYear?: string;
  confidence?: "High" | "Medium" | "Low";
  url?: string;
  sourceType?: "Verified source" | "Planning assumption";
};

function normalizeCitationConfidence(value: string): CitationData["confidence"] | undefined {
  const normalized = value.trim().toLowerCase();

  if (normalized === "high" || normalized === "strong") {
    return "High";
  }

  if (normalized === "medium" || normalized === "moderate") {
    return "Medium";
  }

  if (normalized === "low") {
    return "Low";
  }

  return undefined;
}

function normalizeSourceType(value: string): CitationData["sourceType"] {
  return /\b(assumption|planning input|estimate|ai assumption|market-derived)\b/i.test(value)
    ? "Planning assumption"
    : "Verified source";
}

function parseCitations(content: string): CitationData[] {
  if (/\bsource\s+unavailable\b/i.test(content)) {
    return [];
  }

  const fallbackConfidence = normalizeCitationConfidence(
    content.match(/\bconfidence\s*[:\-–—]\s*(high|medium|low|moderate|strong)\b/i)?.[1] || ""
  );

  const entries: CitationData[] = [];
  let current: Partial<CitationData> = {};
  const flushCurrent = () => {
    if (current.sourceTitle || current.organization || current.url) {
      entries.push({
        sourceTitle: current.sourceTitle || current.organization || "Untitled source",
        organization: current.organization || "Publisher not specified",
        ...(current.publicationYear ? { publicationYear: current.publicationYear } : {}),
        ...(current.confidence || fallbackConfidence
          ? { confidence: current.confidence || fallbackConfidence }
          : {}),
        ...(current.url ? { url: current.url } : {}),
        ...(current.sourceType ? { sourceType: current.sourceType } : { sourceType: "Verified source" }),
      });
    }
    current = {};
  };

  content
    .split("\n")
    .forEach((rawLine) => {
      const url =
        rawLine.match(/\]\((https?:\/\/[^)]+)\)/i)?.[1]?.trim() ||
        rawLine.match(/\bhttps?:\/\/[^\s)]+/i)?.[0]?.trim();
      const line = rawLine
        .replace(/^[-*•]\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$1")
        .replace(/\bhttps?:\/\/[^\s)]+/gi, "")
        .trim();

      if (!line) {
        return;
      }

      const metadataMatch = line.match(
        /^(title|source|publisher|organization|year|publication year|url|confidence|source type|type)\s*[:\-–—]\s*(.+)$/i
      );
      if (metadataMatch) {
        const key = metadataMatch[1].toLowerCase();
        const value = metadataMatch[2].trim();

        if ((key === "title" || key === "source") && current.sourceTitle) {
          flushCurrent();
        }

        if (key === "title" || key === "source") {
          current.sourceTitle = value;
        } else if (key === "publisher" || key === "organization") {
          current.organization = value;
        } else if (key === "year" || key === "publication year") {
          current.publicationYear = value.match(/\b(19|20)\d{2}\b/)?.[0];
        } else if (key === "url") {
          current.url = url || value;
        } else if (key === "confidence") {
          current.confidence = normalizeCitationConfidence(value);
        } else {
          current.sourceType = normalizeSourceType(value);
        }
        if (url) current.url = url;
        return;
      }

      const citationMatch = line.match(
        /^([^—–|-]{2,80})\s*[—–-]\s*(.+?)(?:\s*\((\d{4})\))?(?:\s*[.;:]?\s*)?$/
      );

      if (!citationMatch) {
        return;
      }

      flushCurrent();
      const organization = citationMatch[1].trim();
      const sourceTitle = citationMatch[2]
        .replace(/\bconfidence\s*[:\-–—]\s*(high|medium|low|moderate|strong)\b/i, "")
        .trim();
      const publicationYear = citationMatch[3]?.trim();

      if (!organization || !sourceTitle || /\bsource\s+unavailable\b/i.test(sourceTitle)) {
        return;
      }

      entries.push({
        sourceTitle,
        organization,
        ...(publicationYear ? { publicationYear } : {}),
        ...(fallbackConfidence ? { confidence: fallbackConfidence } : {}),
        ...(url ? { url } : {}),
        sourceType: normalizeSourceType(line),
      });
    });
  flushCurrent();

  const unique = new Map<string, CitationData>();

  entries.forEach((citation) => {
    const normalizedUrl = citation.url?.trim().toLowerCase().replace(/\/+$/, "");
    const key = normalizedUrl
      ? `url:${normalizedUrl}`
      : [
          "source",
          normalizePdfText(citation.organization).toLowerCase().replace(/\W+/g, " ").trim(),
          normalizePdfText(citation.sourceTitle).toLowerCase().replace(/\W+/g, " ").trim(),
        ].join("|");
    const existing = unique.get(key);

    unique.set(key, {
      ...citation,
      ...(existing?.url && !citation.url ? { url: existing.url } : {}),
      ...(existing?.confidence && !citation.confidence ? { confidence: existing.confidence } : {}),
      ...(existing?.sourceType && !citation.sourceType ? { sourceType: existing.sourceType } : {}),
    });
  });

  return Array.from(unique.values());
}

function Citation({ citation }: { citation?: CitationData }) {
  if (!citation) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <p className="text-sm font-semibold leading-6 text-white">{citation.sourceTitle}</p>
      <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
        <p>
          <span className="text-zinc-500">Publisher</span>
          <span className="ml-2 text-zinc-200">{citation.organization}</span>
        </p>
        {citation.publicationYear ? (
          <p>
            <span className="text-zinc-500">Year</span>
            <span className="ml-2 text-zinc-200">{citation.publicationYear}</span>
          </p>
        ) : null}
        {citation.confidence ? (
          <p>
            <span className="text-zinc-500">Confidence</span>
            <span className="ml-2 text-zinc-200">{citation.confidence}</span>
          </p>
        ) : null}
        {citation.sourceType ? (
          <p>
            <span className="text-zinc-500">Type</span>
            <span className="ml-2 text-zinc-200">{citation.sourceType}</span>
          </p>
        ) : null}
      </div>
      {citation.url ? (
        <a
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block truncate text-xs text-teal-200/80 underline-offset-4 hover:text-teal-100 hover:underline"
        >
          {citation.url}
        </a>
      ) : null}
    </div>
  );
}

function CitationList({ content }: { content: string }) {
  const citations = parseCitations(content);

  if (citations.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {citations.map((citation, index) => (
        <Citation
          key={`${citation.organization}-${citation.sourceTitle}-${citation.publicationYear || ""}-${citation.url || ""}-${index}`}
          citation={citation}
        />
      ))}
    </div>
  );
}

function SourcesCard({ sections }: { sections: ReportSection[] }) {
  const sectionsWithCitations = sections.filter(
    (section) => parseCitations(section.content).length > 0
  );

  if (sectionsWithCitations.length === 0) {
    return null;
  }

  return (
    <article className="rounded-[2rem] border border-teal-200/15 bg-teal-200/[0.045] p-5 shadow-xl shadow-black/30">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
          <FileText className="h-5 w-5 text-teal-100" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/80">
            Research Appendix
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight text-white">
            Sources
          </h3>
          <div className="mt-4 space-y-5">
            {sectionsWithCitations.map((section) => (
              <div key={section.field || section.title} className="border-t border-white/10 pt-4 first:border-t-0 first:pt-0">
                {sectionsWithCitations.length > 1 ? (
                  <p className="mb-2 text-sm font-semibold text-zinc-100">
                    {section.title}
                  </p>
                ) : null}
                <CitationList content={section.content} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

const financialDashboardMetrics = [
  { label: "ARR", aliases: ["ARR", "Annual Recurring Revenue", "Revenue"] },
  { label: "MRR", aliases: ["MRR", "Monthly Recurring Revenue"] },
  { label: "Gross Margin", aliases: ["Gross Margin", "Margin"] },
  { label: "CAC", aliases: ["CAC", "Customer Acquisition Cost"] },
  { label: "LTV", aliases: ["LTV", "Lifetime Value"] },
  { label: "Burn Rate", aliases: ["Burn Rate", "Burn"] },
  { label: "Runway", aliases: ["Runway"] },
  { label: "Payback", aliases: ["Payback", "Payback Period"] },
  { label: "Break-even", aliases: ["Break-even Month", "Break even Month", "Breakeven"] },
];

const mobilityFinancialDashboardMetrics = [
  { label: "Yearly Revenue", aliases: ["Yearly Revenue", "Annual Revenue", "ARR", "Revenue"] },
  { label: "Monthly Revenue", aliases: ["Monthly Revenue", "MRR"] },
  { label: "Gross Margin", aliases: ["Gross Margin", "Margin"] },
  { label: "Rider CAC", aliases: ["Rider CAC", "CAC", "Customer Acquisition Cost"] },
  { label: "Rider LTV", aliases: ["Rider LTV", "LTV", "Lifetime Value"] },
  { label: "Burn Rate", aliases: ["Burn Rate", "Monthly Burn", "Burn"] },
  { label: "Runway", aliases: ["Runway"] },
  { label: "Payback", aliases: ["Payback", "Payback Period", "CAC Payback"] },
  { label: "Break-even", aliases: ["Break-even Month", "Break even Month", "Breakeven"] },
];

const founderScoreMetrics = [
  "Overall Score",
  "Innovation",
  "Market Timing",
  "Competition",
  "Capital Intensity",
  "Execution Difficulty",
  "Revenue Potential",
  "Risk Level",
];

const swotQuadrants = [
  { title: "Strengths", icon: Check },
  { title: "Weaknesses", icon: ShieldAlert },
  { title: "Opportunities", icon: Goal },
  { title: "Threats", icon: ShieldAlert },
];

const founderRoadmapSteps = [
  "Tomorrow",
  "This Week",
  "30 Days",
  "90 Days",
  "180 Days",
  "12 Months",
];

function extractMetricValue(content: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(
      `${escapedLabel}\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=\\s*(?:\\||[,;]\\s*[A-Z][A-Za-z /-]{1,32}\\s*[:\\-–—]|\\bformula\\b|\\bplanning input\\b|\\bevidence\\b|\\breference\\b|\\bconfidence\\b|\\n\\s*[A-Z][A-Za-z /-]{1,32}\\s*[:\\-–—]|$))`,
      "i"
    )
  );

  return match?.[1]?.trim().replace(/\*\*/g, "") || "";
}

function extractMetricValueFromAliases(
  content: string,
  aliases: string[] | readonly string[]
) {
  for (const alias of aliases) {
    const value = extractMetricValue(content, alias);

    if (value) {
      return value;
    }
  }

  return "";
}

function formatMetricCardValue(value: string) {
  const cleanValue = value.trim().replace(/\*\*/g, "");

  if (!cleanValue) {
    return "";
  }

  return cleanValue
    .split(/\b(?:formula|assumptions?|confidence|benchmark(?: source| comparison)?|explanation|justification|source)\b\s*[:\-–—]/i)[0]
    .split(/\s+(?:based on|using|assuming|calculated from|derived from)\s+/i)[0]
    .split(/\s*[;|]\s*/)[0]
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/(\d)\.\s+(\d)(\s*[kKmMbB%])?/g, "$1.$2$3")
    .replace(/(\d),\s+(\d{3})/g, "$1,$2")
    .trim();
}

function compactPdfMetricValue(value: string) {
  const cleanValue = formatMetricCardValue(value)
    .replace(/\s+/g, " ")
    .replace(/\s+([kKmMbB%$])/g, "$1")
    .replace(/([kKmMbB%])\s+\$/g, "$1$")
    .trim();
  const numericMatch = cleanValue.match(
    /(?:[$€₺]\s*)?\d+(?:[.,]\d+)*(?:\.\d+)?\s*(?:[kKmMbB%]|months?|ay|gün|days?)?\s*(?:[$€₺])?/i
  );

  return numericMatch?.[0]?.replace(/\s+/g, " ").replace(/([kKmMbB%])\s+([$€₺])/g, "$1$2") || cleanValue.split(/\s{2,}/)[0] || "";
}

function extractMarketSizeValue(content: string, label: string) {
  const escapedLabel = escapeRegExp(label);
  const direct = normalizePdfText(content).match(
    new RegExp(`\\b${escapedLabel}\\b\\s*[:\\-–—]?\\s*((?:[<>~≈]?\\s*)?[€$₺]?\\s*\\d+(?:[.,]\\d+)*(?:\\s*[kKmMbBtT%])?)`, "i")
  )?.[1];

  return compactPdfMetricValue(direct || extractMetricValue(content, label));
}

function isMobilityReportContent(content: string) {
  return /\b(scooter|micromobility|micro mobility|shared mobility|bike sharing|bikeshare|per-ride|urban riders|commuters|fleet utilization|rental|rider cac|rider ltv|active riders|yearly revenue|monthly revenue)\b/i.test(
    content
  );
}

function getFinancialDashboardMetrics(content: string) {
  return isMobilityReportContent(content)
    ? mobilityFinancialDashboardMetrics
    : financialDashboardMetrics;
}

function extractMetricDetail(content: string, aliases: string[] | readonly string[]) {
  const lines = normalizePdfText(content).split("\n");
  const line = lines.find((candidate) =>
    aliases.some((alias) =>
      new RegExp(`^(?:[-*•]\\s*)?(?:\\*\\*)?${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?\\s*[:\\-–—]`, "i").test(
        candidate.trim()
      )
    )
  );

  if (!line) {
    return "";
  }

  return line
    .replace(/^[-*•]\s*/, "")
    .replace(/\*\*/g, "")
    .split(/\s*\|\s*/)
    .slice(1)
    .join(" | ")
    .replace(/\bbenchmarkSource\b/gi, "source")
    .trim();
}

function extractScore(content: string, label: string) {
  const value = extractMetricValue(content, label);
  const scoreMatch = value.match(/\b(\d{1,3})\b/);
  const fallbackMatch = content.match(
    new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\d]{0,30}(\\d{1,3})`, "i")
  );
  const rawScore = Number(scoreMatch?.[1] || fallbackMatch?.[1] || NaN);

  if (!Number.isFinite(rawScore)) {
    return null;
  }

  return Math.max(0, Math.min(100, rawScore));
}

function detectRecommendation(content: string) {
  const explicit = content.match(
    /\b(?:recommendation|decision|karar)\s*[:\-–—]\s*([A-Z][A-Z ]{1,34})\b/i
  );
  const explicitDecision = explicit?.[1]?.trim().replace(/\s+/g, " ").toUpperCase();

  if (explicitDecision && !["CONFIDENCE", "INVESTMENT", "MAIN RISK"].includes(explicitDecision)) {
    return explicitDecision;
  }

  const match = content.match(/\b(HOLD FOR VALIDATION|INVEST|REJECT|GO|PASS|NO GO|WAIT|PIVOT|RAISE|BOOTSTRAP)\b/i);
  const recommendation = match?.[1]?.toUpperCase() || "";

  if (recommendation === "NO GO" || recommendation === "REJECT") {
    return "PASS";
  }

  return recommendation;
}

function formatDecisionLabel(decision: string) {
  const normalized = decision.trim().replace(/\s+/g, " ").toUpperCase();

  if (normalized === "HOLD FOR VALIDATION") {
    return "Hold for validation";
  }

  if (normalized === "PASS") {
    return "Reject";
  }

  if (normalized === "GO") {
    return "Invest";
  }

  return normalized
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function extractConfidence(content: string) {
  const explicit = extractScore(content, "Confidence");

  if (explicit !== null) {
    return explicit;
  }

  const scoreMatch = content.match(/\b(?:score|conviction)\s*(?:of|:)?\s*(\d{1,3})\s*\/\s*100\b/i);
  const score = Number(scoreMatch?.[1] || NaN);

  if (Number.isFinite(score)) {
    return Math.max(0, Math.min(100, score));
  }

  const percentMatch = content.match(/\b(\d{1,3})\s*%/);
  const percent = Number(percentMatch?.[1] || NaN);

  if (Number.isFinite(percent)) {
    return Math.max(0, Math.min(100, percent));
  }

  if (/\b(high|strong)\s+(?:confidence|conviction)\b/i.test(content)) {
    return 80;
  }

  if (/\b(medium|moderate)\s+(?:confidence|conviction)\b/i.test(content)) {
    return 60;
  }

  if (/\b(low|weak)\s+(?:confidence|conviction)\b/i.test(content)) {
    return 35;
  }

  return null;
}

function extractSectionSnippet(content: string, title: string) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(
      `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:[-*]\\s*)?(?:\\*\\*)?${escapedTitle}(?:\\*\\*)?\\s*[:\\-–—]?\\s*([\\s\\S]*?)(?=\\n\\s*(?:#{1,6}\\s*)?(?:[-*]\\s*)?(?:\\*\\*)?(?:Strengths|Weaknesses|Opportunities|Threats|Worst|Base|Best|Revenue|MRR|Monthly Revenue|Burn|Runway|Risk|Decision)(?:\\*\\*)?\\s*[:\\-–—]|$)`,
      "i"
    )
  );

  return match?.[1]?.trim() || "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const swotLabelAliases: Record<string, string[]> = {
  Strengths: ["Strengths", "Güçlü Yönler", "Güçlü Yanlar", "Avantajlar"],
  Weaknesses: ["Weaknesses", "Zayıf Yönler", "Zayıflıklar", "Eksikler"],
  Opportunities: ["Opportunities", "Fırsatlar"],
  Threats: ["Threats", "Tehditler"],
};

const scenarioLabelAliases: Record<string, string[]> = {
  Worst: ["Worst", "Worst Case", "Kötü", "Kötü Senaryo"],
  Base: ["Base", "Base Case", "Baz", "Baz Senaryo"],
  Best: ["Best", "Best Case", "İyi", "Iyi", "İyi Senaryo", "Iyi Senaryo"],
};

function extractAliasedSectionSnippet(
  content: string,
  labels: string[],
  stopLabels: string[] = labels
) {
  const normalizedContent = normalizePdfText(content);
  const labelPattern = labels.map(escapeRegExp).join("|");
  const stopPattern = stopLabels
    .filter((label) => !labels.includes(label))
    .map(escapeRegExp)
    .join("|");

  if (labelPattern) {
    const lineMatch = normalizedContent.match(
      new RegExp(
        `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:[-*•]\\s*)?(?:\\*\\*)?(?:${labelPattern})(?:\\*\\*)?\\s*(?:case|senaryo)?\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=${stopPattern ? `\\n\\s*(?:#{1,6}\\s*)?(?:[-*•]\\s*)?(?:\\*\\*)?(?:${stopPattern})(?:\\*\\*)?\\s*(?:case|senaryo)?\\s*[:\\-–—]` : "$"}|$)`,
        "i"
      )
    );

    if (lineMatch?.[1]?.trim()) {
      return lineMatch[1].trim();
    }

    if (stopPattern) {
      const inlineMatch = normalizedContent.match(
        new RegExp(
          `(?:${labelPattern})\\s*(?:case|senaryo)?\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=\\s+(?:${stopPattern})\\s*(?:case|senaryo)?\\s*[:\\-–—]|$)`,
          "i"
        )
      );

      if (inlineMatch?.[1]?.trim()) {
        return inlineMatch[1].trim();
      }
    }
  }

  if (stopLabels !== labels) {
    return "";
  }

  for (const label of labels) {
    const snippet = extractSectionSnippet(content, label);

    if (snippet) {
      return snippet;
    }
  }

  return "";
}

function isOrphanBulletText(value: string) {
  return /^(swot analysis|strengths|weaknesses|opportunities|threats|güçlü yönler|güçlü yanlar|zayıf yönler|zayıflıklar|fırsatlar|tehditler)$/i.test(
    value.trim()
  ) || /^[a-zçğıöşü]\.$/i.test(value.trim()) || /^\d+[.)]?$/.test(value.trim()) || /^[€$₺.,()]$/.test(value.trim()) || /^\d+(?:[.,]\d+)?\s*(?:[kKmMbB%]|months?|ay|gün|days?)$/i.test(value.trim());
}

function containsOtherSwotLabel(value: string, currentLabel: string) {
  return Object.entries(swotLabelAliases).some(([label, aliases]) => {
    if (label === currentLabel) {
      return false;
    }

    return aliases.some((alias) =>
      new RegExp(`(?:^|\\b)${escapeRegExp(alias)}\\s*[:\\-–—]`, "i").test(value)
    );
  });
}

function extractBullets(content: string, fallback: string) {
  const source = content || "";
  const bullets = source
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\*\*/g, "")
        .replace(new RegExp(`^${fallback}\\s*[:\\-–—]\\s*`, "i"), "")
        .trim()
    )
    .filter((line) => line && !new RegExp(`^${fallback}$`, "i").test(line) && !isOrphanBulletText(line))
    .slice(0, 3);

  if (bullets.length > 0) {
    return bullets;
  }

  return source
    .replace(/\*\*/g, "")
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line && !new RegExp(`^${fallback}$`, "i").test(line) && !isOrphanBulletText(line))
    .slice(0, 2);
}

function extractSwotBullets(content: string, label: string, fallbackContent = content) {
  const aliases = swotLabelAliases[label] || [label];
  const allSwotAliases = Object.values(swotLabelAliases).flat();
  const snippet = extractAliasedSectionSnippet(content, aliases, allSwotAliases);
  const direct = extractBullets(snippet, label).filter(
    (bullet) => !containsOtherSwotLabel(bullet, label)
  );

  if (direct.length > 0) {
    return direct;
  }

  for (const alias of aliases) {
    const labelPattern = new RegExp(
      `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:[-*•]\\s*)?(?:\\*\\*)?${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?\\s*[:\\-–—]\\s*([^\\n]+)`,
      "i"
    );
    const inline = content.match(labelPattern)?.[1]?.trim() || "";

    if (inline && !new RegExp(`^${alias}$`, "i").test(inline)) {
      return extractBullets(inline, label).filter(
        (bullet) => !containsOtherSwotLabel(bullet, label)
      );
    }
  }

  const fallbackSnippet =
    extractAliasedSectionSnippet(fallbackContent, aliases, allSwotAliases) ||
    extractKeywordInsight(
      fallbackContent,
      label === "Strengths"
        ? ["strength", "advantage", "moat", "positive", "güçlü", "avantaj"]
        : label === "Weaknesses"
          ? ["weakness", "constraint", "cost", "capital", "margin pressure", "zayıf", "maliyet"]
          : label === "Opportunities"
            ? ["opportunity", "underserved", "growth", "demand", "gap", "fırsat"]
            : ["threat", "risk", "regulation", "competition", "substitute", "tehdit"]
    );

  return extractBullets(fallbackSnippet, label)
    .filter((bullet) => !containsOtherSwotLabel(bullet, label))
    .slice(0, 2);
}

function extractScenarioSnippet(content: string, scenario: string) {
  const aliases = scenarioLabelAliases[scenario] || [scenario];
  const allAliases = Object.values(scenarioLabelAliases).flat();
  const sectionSnippet = extractAliasedSectionSnippet(content, aliases, allAliases);

  if (sectionSnippet) {
    return sectionSnippet;
  }

  for (const alias of aliases) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stopLabels = allAliases
      .filter((candidate) => candidate !== alias)
      .map((candidate) => candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const inlineMatch = normalizePdfText(content).match(
      new RegExp(
        `${escapedAlias}\\s*(?:case|senaryo)?\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=\\s+(?:${stopLabels})\\s*(?:case|senaryo)?\\s*[:\\-–—]|$)`,
        "i"
      )
    );

    if (inlineMatch?.[1]?.trim()) {
      return inlineMatch[1].trim();
    }
  }

  return "";
}

function extractShortDescription(content: string, aliases: string[] | readonly string[]) {
  const detail = extractMetricDetail(content, aliases)
    .replace(/\b(?:formula|assumptions?|benchmark|source|confidence)\s*[:=]\s*/gi, "")
    .replace(/\s*\|\s*/g, " ")
    .trim();

  if (detail) {
    return detail;
  }

  const raw = normalizePdfText(extractMetricValueFromAliases(content, aliases));

  return raw
    .split(/\b(?:formula|assumptions?|confidence|benchmark(?: source| comparison)?|explanation|justification|source)\b\s*[:\-–—]/i)
    .slice(1)
    .join(" ")
    .replace(/\s*\|\s*/g, " ")
    .trim();
}

function extractKpiValue(content: string, label: string) {
  return (
    compactPdfMetricValue(extractMetricValue(content, label)) ||
    compactPdfMetricValue(extractKeywordInsight(content, [label])) ||
    ""
  );
}

function extractKpiTarget(content: string, label: string) {
  const snippet = extractSectionSnippet(content, label) || extractKeywordInsight(content, [label]);
  const target = snippet.match(/\btarget\s*[:\-–—]\s*([^.;\n|]+)/i)?.[1]?.trim();

  return target ? compactPdfMetricValue(target) || target : "";
}

function extractKpiStatus(content: string, label: string) {
  const snippet = extractSectionSnippet(content, label) || extractKeywordInsight(content, [label]);
  const status = snippet.match(/\bstatus\s*[:\-–—]\s*([^.;\n|]+)/i)?.[1]?.trim();

  if (status) {
    return status;
  }

  return (extractScore(content, label) ?? 0) >= 70 ? "On track" : "Watch";
}

function removeDuplicateVisualText(title: string, content: string) {
  const normalizedTitle = title.toLowerCase();

  if (normalizedTitle.includes("tam / sam / som")) {
    return "";
  }

  if (normalizedTitle.includes("financial dashboard")) {
    return "";
  }

  if (normalizedTitle.includes("swot")) {
    return "";
  }

  return normalizePdfText(content);
}

function splitPdfSentences(content: string) {
  return (
    normalizePdfText(content)
      .replace(/\n+/g, " ")
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []
  )
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isSourceLikeSection(section: Pick<ReportSection, "field" | "title">) {
  return (
    section.field === "sources" ||
    section.field === "sourcesAssumptions" ||
    /^(sources|references|kaynaklar|sources \/ assumptions|kaynaklar \/ varsayımlar)$/i.test(
      section.title.trim()
    )
  );
}

function formatPdfCitationContent(content: string) {
  const citations = parseCitations(content);

  if (citations.length === 0) {
    return "";
  }

  return citations
    .slice(0, 8)
    .map((citation) => {
      const year = citation.publicationYear ? `\n  Year: ${citation.publicationYear}` : "";
      const confidence = citation.confidence ? `\n  Confidence: ${citation.confidence}` : "";
      const url = citation.url ? `\n  URL: ${citation.url}` : "";
      const sourceType = citation.sourceType ? `\n  Type: ${citation.sourceType}` : "";

      return [
        `• ${citation.sourceTitle}`,
        `  Publisher: ${citation.organization}`,
        year,
        confidence,
        sourceType,
        url,
      ].join("\n");
    })
    .join("\n");
}

function formatPdfReadableContent(section: ReportSection) {
  if (isSourceLikeSection(section)) {
    return formatPdfCitationContent(section.content);
  }

  const content = removeDuplicateVisualText(section.title, section.content);
  const normalized = normalizePdfText(content);

  if (!normalized) {
    return "";
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const alreadyStructured =
    lines.some((line) => /^[-*•]\s+/.test(line) || /^\|/.test(line)) ||
    lines.length >= 4;

  if (normalized.length < 520 || alreadyStructured) {
    return normalized;
  }

  const sentences = splitPdfSentences(normalized);

  if (sentences.length <= 4) {
    return normalized;
  }

  const executiveParagraph = sentences.slice(0, 2).join(" ");
  const insightBullets = sentences.slice(2, 7).map((sentence) => `• ${sentence}`);

  return [executiveParagraph, "Key insights", ...insightBullets].join("\n");
}

function dedupePdfSections<T extends { title: string; content: string }>(sections: T[]) {
  const seen = new Set<string>();

  return sections.filter((section) => {
    const key = section.title.trim().toLowerCase().replace(/\s+/g, " ");

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function mergePdfSourceSections<T extends { title: string; content: string }>(sections: T[]) {
  const sourceSections = sections.filter((section) =>
    /^(sources|references|kaynaklar|sources \/ assumptions|kaynaklar \/ varsayımlar)$/i.test(
      section.title.trim()
    )
  );
  const nonSourceSections = sections.filter(
    (section) => !sourceSections.includes(section)
  );
  const mergedSourceContent = sourceSections
    .map((section) => section.content.trim())
    .filter(Boolean)
    .join("\n");

  if (!mergedSourceContent) {
    return nonSourceSections;
  }

  return [
    ...nonSourceSections,
    {
      ...sourceSections[0],
      title: "Sources",
      content: mergedSourceContent,
    },
  ];
}

function extractFirstInsight(content: string) {
  return (
    content
      .replace(/^#{1,6}\s+/gm, "")
      .split(/\n+/)
      .map((line) => line.trim().replace(/^[-*]\s+/, ""))
      .find((line) => line.length > 24) || ""
  );
}

function extractKeywordInsight(content: string, keywords: string[]) {
  const lines = content
    .replace(/^#{1,6}\s+/gm, "")
    .split(/\n+/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter((line) => line.length > 12);

  return (
    lines.find((line) =>
      keywords.some((keyword) => line.toLowerCase().includes(keyword.toLowerCase()))
    ) ||
    lines[0] ||
    ""
  );
}

function extractPercentScore(content: string, label: string) {
  const explicitScore = extractScore(content, label);

  if (explicitScore !== null) {
    return explicitScore;
  }

  const value = extractMetricValue(content, label);
  const percent = Number(value.match(/(\d{1,3})\s*%/)?.[1] || NaN);

  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
}

function getDecisionClasses(decision: string) {
  if (decision === "GO" || decision === "RAISE" || decision === "BOOTSTRAP") {
    return "border-emerald-300/35 bg-emerald-300/15 text-emerald-100";
  }

  if (decision === "NO GO" || decision === "PIVOT") {
    return "border-red-300/30 bg-red-300/12 text-red-100";
  }

  if (decision === "WAIT") {
    return "border-amber-300/35 bg-amber-300/15 text-amber-100";
  }

  return "border-teal-200/30 bg-teal-200/12 text-teal-100";
}

function MiniProgressCircle({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const displayValue = value === null ? "—" : `${value}%`;
  const degrees = (value ?? 0) * 3.6;

  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-black/30 p-4">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(rgb(94 234 212) ${degrees}deg, rgb(39 39 42) 0deg)`,
        }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-950 text-xs font-semibold text-white">
          {displayValue}
        </div>
      </div>
      {label ? (
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
          {label}
        </p>
      ) : null}
    </div>
  );
}

function ExecutiveSummaryVisual({ section }: { section: ReportSection }) {
  if (section.field !== "executiveSummary") {
    return null;
  }

  const score =
    extractScore(section.content, "AI Investment Score") ??
    extractScore(section.content, "AI Founder Score") ??
    extractConfidence(section.content);
  const recommendation = detectRecommendation(section.content) || "REVIEW";
  const highlights = [
    extractKeywordInsight(section.content, ["market", "pazar", "tam", "sam", "som"]),
    extractKeywordInsight(section.content, ["revenue", "gelir", "pricing", "fiyat"]),
    extractKeywordInsight(section.content, ["risk", "risk", "threat", "tehdit"]),
  ].filter(Boolean);
  const kpis = [
    {
      label: "Investment Score",
      value: score === null ? "—" : `${score}/100`,
      accent: "from-teal-200/25 to-cyan-200/5",
    },
    {
      label: "Decision",
      value: recommendation,
      accent: "from-emerald-300/20 to-teal-300/5",
    },
    {
      label: "Market Signal",
      value: extractMetricValue(section.content, "Market") || extractMetricValue(section.content, "TAM") || "Review",
      accent: "from-sky-300/18 to-teal-300/5",
    },
    {
      label: "Risk Posture",
      value: extractMetricValue(section.content, "Risk") || extractMetricValue(section.content, "Main Risk") || "Tracked",
      accent: "from-amber-300/18 to-teal-300/5",
    },
  ];

  return (
    <div className="mb-5 overflow-hidden rounded-[2.25rem] border border-teal-200/15 bg-[radial-gradient(circle_at_20%_10%,rgba(94,234,212,0.22),transparent_28%),radial-gradient(circle_at_90%_20%,rgba(20,184,166,0.12),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.075),rgba(255,255,255,0.018))]">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-teal-200/75">
              Executive Summary
            </p>
            <h4 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Investment Decision Snapshot
            </h4>
          </div>
          <span className={`w-fit rounded-full border px-4 py-2 text-xs font-semibold tracking-[0.18em] ${getDecisionClasses(recommendation)}`}>
            {recommendation}
          </span>
        </div>
      </div>
      <div className="grid gap-0 lg:grid-cols-[0.9fr_1.35fr]">
        <div className="border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-teal-200/75">
            AI Investment Score
          </p>
          <div className="mt-5 flex items-end gap-4">
            <div
              className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full"
              style={{
                background: `conic-gradient(rgb(94 234 212) ${(score ?? 0) * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
              }}
            >
              <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full border border-white/10 bg-black/70">
                <span className="text-3xl font-semibold tracking-tight text-white">
                  {score === null ? "--" : score}
                </span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Score</span>
              </div>
            </div>
            <div>
              <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold tracking-[0.18em] ${getDecisionClasses(recommendation)}`}>
                {recommendation}
              </span>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                {extractFirstInsight(section.content) || "Executive signal is being assembled."}
              </p>
            </div>
          </div>
        </div>
        <div className="p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {kpis.map((kpi) => (
              <div
                key={kpi.label}
                className={`rounded-3xl border border-white/10 bg-gradient-to-br ${kpi.accent} p-4`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  {kpi.label}
                </p>
                <p className="mt-3 line-clamp-2 text-2xl font-semibold tracking-tight text-white">
                  {kpi.value}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-3xl border border-white/10 bg-black/30 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-200/70">
              Executive Highlights
            </p>
            <div className="mt-3 grid gap-2">
              {(highlights.length > 0 ? highlights : [extractFirstInsight(section.content)]).map((highlight) => (
                <div key={highlight} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-zinc-300">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200" />
                  <span className="line-clamp-2">{highlight}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExecutiveInsightBanner({ section }: { section: ReportSection }) {
  const insight = extractFirstInsight(section.content);
  const confidence = extractConfidence(section.content);

  if (!insight) {
    return null;
  }

  return (
    <div className="mb-5 rounded-[1.75rem] border border-teal-200/15 bg-[linear-gradient(135deg,rgba(94,234,212,0.1),rgba(255,255,255,0.025))] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-200/80">
            Investor Insight
          </p>
          <p className="mt-2 line-clamp-2 max-w-4xl text-lg font-medium leading-7 text-white">
            {insight}
          </p>
        </div>
        <div className="shrink-0 rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs font-semibold text-zinc-300">
          Confidence {confidence === null ? "—" : `${confidence}%`}
        </div>
      </div>
    </div>
  );
}

function GaugeCircle({ label, score }: { label: string; score: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div
        className="mx-auto flex h-20 w-20 items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(rgb(94 234 212) ${score * 3.6}deg, rgb(39 39 42) 0deg)`,
        }}
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black text-lg font-semibold text-white">
          {score}
        </div>
      </div>
      <p className="mt-3 text-center text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
        {label}
      </p>
    </div>
  );
}

function PremiumSectionVisual({ section }: { section: ReportSection }) {
  const field = section.field;

  if (field === "tamSamSom") {
    const bars = [
      { label: "TAM", aliases: ["TAM"], width: "100%", color: "from-teal-200 to-cyan-100" },
      { label: "SAM", aliases: ["SAM"], width: "62%", color: "from-teal-400 to-teal-200" },
      { label: "SOM", aliases: ["SOM"], width: "28%", color: "from-emerald-400 to-teal-300" },
    ];

    return (
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(94,234,212,0.12),transparent_30%),rgba(255,255,255,0.025)] p-5">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
              Market Sizing Blocks
            </p>
            <p className="mt-2 text-sm text-zinc-400">TAM, SAM and SOM shown as investable opportunity layers.</p>
          </div>
          <div className="hidden h-16 w-16 rounded-full border border-teal-200/20 bg-teal-200/10 sm:block" />
        </div>
        <div className="space-y-4">
          {bars.map((bar) => {
            const value = extractMetricValueFromAliases(section.content, bar.aliases);

            return (
              <div key={bar.label} className="grid items-center gap-3 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(7rem,auto)]">
                <div className="rounded-2xl border border-white/10 bg-black/35 p-3 text-center">
                  <p className="text-xs font-semibold tracking-[0.2em] text-zinc-400">
                    {bar.label}
                  </p>
                </div>
                <div className="h-14 rounded-2xl border border-white/10 bg-zinc-950 p-1.5">
                  <div
                    className={`h-full rounded-[1.1rem] bg-gradient-to-r ${bar.color} shadow-lg shadow-teal-950/20`}
                    style={{ width: bar.width }}
                  />
                </div>
                {value ? (
                  <p className="min-w-0 truncate whitespace-nowrap rounded-2xl border border-white/10 bg-black/35 px-3 py-2 text-right text-sm font-semibold text-white">
                    {formatMetricCardValue(value)}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (field === "marketOpportunity" || field === "marketOverview") {
    const opportunity = extractFirstInsight(section.content);
    const chartBars = [
      { label: "Demand", width: "82%", color: "bg-teal-200" },
      { label: "Timing", width: "68%", color: "bg-cyan-200" },
      { label: "Access", width: "56%", color: "bg-emerald-300" },
      { label: "Defensibility", width: "48%", color: "bg-amber-200" },
    ];

    return (
      <div className="mb-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-teal-200/15 bg-teal-200/[0.055] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Market Opportunity Chart
          </p>
          <p className="mt-3 line-clamp-3 text-xl font-semibold leading-8 text-white">
            {opportunity || "Opportunity signal is being evaluated."}
          </p>
        </div>
        <div className="rounded-[2rem] border border-white/10 bg-black/35 p-5">
          <div className="space-y-4">
            {chartBars.map((bar) => (
              <div key={bar.label}>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold uppercase tracking-[0.18em] text-zinc-500">{bar.label}</span>
                  <span className="text-zinc-400">{bar.width}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                  <div className={`h-full rounded-full ${bar.color}`} style={{ width: bar.width }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

if (field === "swotAnalysis") {
    return (
      <div className="mb-5 grid gap-3 md:grid-cols-2">
        {swotQuadrants.map(({ title, icon: Icon }) => {
          const bullets = extractSwotBullets(section.content, title);

          return (
            <div key={title} className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
                  <Icon className="h-4 w-4 text-teal-100" />
                </div>
                <p className="text-sm font-semibold text-white">{title}</p>
              </div>
              <ul className="mt-4 space-y-2">
                {bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-2 text-sm leading-6 text-zinc-300">
                    <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    );
  }

  if (field === "businessModel") {
    const blocks = [
      ["Value", extractKeywordInsight(section.content, ["value", "değer", "problem"])],
      ["Delivery", extractKeywordInsight(section.content, ["delivery", "product", "platform", "ürün"])],
      ["Revenue", extractKeywordInsight(section.content, ["revenue", "gelir", "subscription"])],
      ["Moat", extractKeywordInsight(section.content, ["moat", "defensible", "advantage", "rekabet"])],
    ];

    return (
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.045),rgba(94,234,212,0.05))] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
          Operating Model Canvas
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {blocks.map(([label, value], index) => (
            <div key={label} className="relative rounded-3xl border border-white/10 bg-black/35 p-4">
              <span className="absolute right-4 top-4 text-3xl font-semibold text-white/5">
                {index + 1}
              </span>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-zinc-200">{value || "Defined in analysis"}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (field === "pricingStrategy") {
    const tiers = [
      ["Entry", extractKeywordInsight(section.content, ["entry", "starter", "low", "başlangıç"])],
      ["Core", extractKeywordInsight(section.content, ["core", "standard", "main", "ana"])],
      ["Premium", extractKeywordInsight(section.content, ["premium", "enterprise", "high", "kurumsal"])],
    ];

    return (
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {tiers.map(([label, value], index) => (
          <div
            key={label}
            className={`rounded-[2rem] border p-5 ${
              index === 1
                ? "border-teal-200/30 bg-teal-200/[0.07]"
                : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Pricing Tier
            </p>
            <p className="mt-3 text-2xl font-semibold text-white">{label}</p>
            <p className="mt-4 line-clamp-3 text-sm leading-6 text-zinc-300">{value || "Pricing signal"}</p>
          </div>
        ))}
      </div>
    );
  }

  if (field === "goToMarketPlan" || field === "salesStrategy" || field === "entryStrategy") {
    const stages = ["Audience", "Channel", "Conversion", "Expansion"];

    return (
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-black/35 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
          Go-To-Market Motion
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {stages.map((stage, index) => (
            <div key={stage} className="relative rounded-3xl border border-white/10 bg-white/[0.035] p-4">
              {index < stages.length - 1 ? (
                <div className="absolute left-[calc(100%-0.25rem)] top-1/2 hidden h-px w-5 bg-teal-200/40 md:block" />
              ) : null}
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-200 text-xs font-bold text-black">
                {index + 1}
              </span>
              <p className="mt-4 text-sm font-semibold text-white">{stage}</p>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">
                {extractKeywordInsight(section.content, [stage]) || "Execution lever"}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (field === "unitEconomics" || field === "financialAssumptions") {
    const flow = isMobilityReportContent(section.content)
      ? ["Revenue", "Rider CAC", "Rider LTV", "Payback", "Runway"]
      : ["Revenue", "CAC", "LTV", "Payback", "Runway"];

    return (
      <div className="mb-5 overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(90deg,rgba(94,234,212,0.08),rgba(255,255,255,0.025))]">
        <div className="border-b border-white/10 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Unit Economics Chain
          </p>
        </div>
        <div className="grid gap-px bg-white/10 md:grid-cols-5">
          {flow.map((metric) => (
            <div key={metric} className="bg-zinc-950/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{metric}</p>
              <p className="mt-3 truncate whitespace-nowrap text-lg font-semibold text-white">
                {formatMetricCardValue(extractMetricValue(section.content, metric)) || "—"}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (field === "competitorAnalysis" || field === "competitorLandscape") {
    return (
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
          Competitive Positioning Map
        </p>
        <div className="relative mt-5 h-64 rounded-3xl border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.035),rgba(94,234,212,0.07))]">
          <div className="absolute left-1/2 top-0 h-full w-px bg-white/10" />
          <div className="absolute left-0 top-1/2 h-px w-full bg-white/10" />
          {[
            ["Incumbents", "24%", "32%"],
            ["Specialists", "70%", "30%"],
            ["ZERINIX Thesis", "58%", "62%"],
            ["Low-end", "28%", "75%"],
          ].map(([label, left, top], index) => (
            <div key={label} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left, top }}>
              <div className={`h-4 w-4 rounded-full ${index === 2 ? "bg-teal-200" : "bg-white/35"}`} />
              <p className="mt-2 whitespace-nowrap rounded-full border border-white/10 bg-black/65 px-2 py-1 text-xs font-semibold text-zinc-200">
                {label}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (field === "financialDashboard") {
    return (
      <div className="mb-5 overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(94,234,212,0.12),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.015))]">
        <div className="flex flex-col gap-2 border-b border-white/10 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-teal-200/75">
              Bloomberg-Style Financial Console
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              Unit economics, runway and investor-readiness signals.
            </p>
          </div>
          <span className="w-fit rounded-full border border-teal-200/20 bg-teal-200/10 px-3 py-1 text-xs font-semibold text-teal-100">
            Live model
          </span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {getFinancialDashboardMetrics(section.content).map((metric, index) => {
            const value = formatMetricCardValue(
              extractMetricValueFromAliases(section.content, metric.aliases)
            );

            return (
              <div
                key={metric.label}
                className="flex min-h-32 min-w-0 flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-black/35 p-3.5 shadow-xl shadow-black/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-2 min-w-0 break-words text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                    {metric.label}
                  </p>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${
                    index % 3 === 0
                      ? "bg-teal-200 text-black"
                      : index % 3 === 1
                        ? "bg-amber-300/15 text-amber-200"
                        : "bg-white/10 text-zinc-300"
                  }`}>
                    {index % 3 === 0 ? "On track" : index % 3 === 1 ? "Watch" : "Model"}
                  </span>
                </div>
                <div className="mt-4 min-w-0">
                  <p className="truncate whitespace-nowrap text-[clamp(1.15rem,2.2vw,1.65rem)] font-semibold leading-tight tracking-tight text-white">
                    {value || "—"}
                  </p>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-teal-200/80"
                      style={{ width: `${[78, 64, 72, 58, 70, 50, 66, 62, 54, 60, 48][index] || 60}%` }}
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-teal-200/70">Investor KPI</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (field === "founderScore") {
    const scoredMetrics = founderScoreMetrics
      .map((metric) => ({ metric, score: extractScore(section.content, metric) }))
      .filter((item): item is { metric: string; score: number } => item.score !== null);

    if (scoredMetrics.length === 0) {
      return null;
    }

    return (
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {scoredMetrics.map(({ metric, score }) => (
          <GaugeCircle key={metric} label={metric} score={score} />
        ))}
      </div>
    );
  }

  if (field === "scenarioAnalysis") {
    const scenarioMetrics = isMobilityReportContent(section.content)
      ? ["Revenue", "Monthly Revenue", "Burn", "Runway", "Risk", "Decision"]
      : ["Revenue", "MRR", "Burn", "Runway", "Risk", "Decision"];
    const styles = {
      Worst: "border-red-300/20 bg-red-300/[0.055]",
      Base: "border-teal-200/20 bg-teal-200/[0.055]",
      Best: "border-emerald-300/20 bg-emerald-300/[0.06]",
    } as const;

    return (
      <div className="mb-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
        {["Worst", "Base", "Best"].map((scenario) => {
          const snippet = extractScenarioSnippet(section.content, scenario);

          return (
            <div key={scenario} className={`rounded-3xl border p-4 ${styles[scenario as keyof typeof styles]}`}>
              <div className="flex items-center justify-between">
                <p className="text-lg font-semibold text-white">{scenario}</p>
                <span className="h-3 w-3 rounded-full bg-current text-teal-200" />
              </div>
              <div className="mt-4 space-y-2">
                {scenarioMetrics.map((metric) => (
                  <div key={metric} className="flex items-start justify-between gap-3 border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
                    <span className="text-xs uppercase tracking-[0.14em] text-zinc-500">{metric}</span>
                    <span className="max-w-40 text-right text-sm font-medium text-zinc-200">
                      {extractMetricValue(snippet, metric) || "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        </div>
        <div className="rounded-[2rem] border border-white/10 bg-black/35 p-5">
          <div className="mb-4 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            <span>Risk</span>
            <span>Return</span>
          </div>
          <div className="relative h-44 rounded-3xl border border-white/10 bg-[linear-gradient(135deg,rgba(248,113,113,0.16),rgba(94,234,212,0.14))]">
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/10" />
            <div className="absolute left-0 top-1/2 h-px w-full bg-white/10" />
            {[
              { label: "Worst", left: "22%", top: "68%", color: "bg-red-300" },
              { label: "Base", left: "50%", top: "42%", color: "bg-teal-200" },
              { label: "Best", left: "76%", top: "22%", color: "bg-emerald-300" },
            ].map((point) => (
              <div key={point.label} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: point.left, top: point.top }}>
                <div className={`h-4 w-4 rounded-full ${point.color} shadow-lg shadow-black`} />
                <p className="mt-2 rounded-full bg-black/60 px-2 py-1 text-xs font-semibold text-white">{point.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (field === "executiveRecommendation") {
    const selected = detectRecommendation(section.content);
    const decisions = ["GO", "NO GO", "WAIT", "PIVOT", "RAISE", "BOOTSTRAP"];
    const recommendationMetrics = [
      ["Confidence", extractConfidence(section.content) ? `${extractConfidence(section.content)}%` : "—"],
      ["Investment Needed", extractMetricValue(section.content, "Investment Needed") || "—"],
      ["Next Action", extractMetricValue(section.content, "Next Action") || extractMetricValue(section.content, "Next Critical Action") || "—"],
      ["Main Risk", extractMetricValue(section.content, "Main Risk") || "—"],
    ];

    return (
      <div className="mb-5 rounded-[2.25rem] border border-teal-200/20 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.16),transparent_30%),rgba(94,234,212,0.06)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/80">
              Executive Recommendation
            </p>
            <p className="mt-2 text-5xl font-semibold tracking-tight text-white">
              {selected || "Review"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {decisions.map((decision) => {
              const active = selected === decision;

              return (
                <span
                  key={decision}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold tracking-[0.14em] ${
                    active
                      ? "border-teal-200/60 bg-teal-200 text-black"
                      : "border-white/10 bg-black/20 text-zinc-500"
                  }`}
                >
                  {decision}
                </span>
              );
            })}
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {recommendationMetrics.map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
              <p className="mt-2 line-clamp-2 text-sm font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Confidence Meter</p>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-teal-200" style={{ width: `${extractConfidence(section.content) ?? 50}%` }} />
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Next Actions Checklist</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {["Validate demand", "Protect runway", "Refine ICP", "Measure conversion"].map((action) => (
                <div key={action} className="flex items-center gap-2 text-sm text-zinc-300">
                  <span className="h-4 w-4 rounded-full border border-teal-200/40 bg-teal-200/10" />
                  {action}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (field === "founderRoadmap" || field === "roadmap306090") {
    return (
      <div className="mb-5 overflow-x-auto rounded-[2rem] border border-white/10 bg-[linear-gradient(90deg,rgba(94,234,212,0.08),rgba(255,255,255,0.02))] p-5">
        <div className="relative grid min-w-[840px] grid-cols-6 gap-4">
        <div className="absolute left-8 right-8 top-8 h-px bg-gradient-to-r from-teal-200/10 via-teal-200/50 to-teal-200/10" />
        {founderRoadmapSteps.map((step, index) => (
          <div key={step} className="relative rounded-[1.4rem] border border-white/10 bg-black/45 p-4">
            <div className="flex flex-col gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-200 text-xs font-bold text-black">
                {index + 1}
              </span>
              <p className="text-sm font-semibold text-white">{step}</p>
              <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                {index < 2 ? "Priority" : index < 4 ? "Build" : "Scale"}
              </span>
            </div>
          </div>
        ))}
        </div>
      </div>
    );
  }

  if (field === "portersFiveForces") {
    const forces = ["Rivalry", "Entrants", "Buyer Power", "Supplier Power", "Substitutes"];

    return (
      <div className="mb-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="relative flex min-h-72 items-center justify-center rounded-[2rem] border border-white/10 bg-[radial-gradient(circle,rgba(94,234,212,0.12),transparent_58%)]">
          <div className="absolute h-56 w-56 rounded-full border border-teal-200/10" />
          <div className="absolute h-40 w-40 rounded-full border border-teal-200/15" />
          <div className="absolute h-24 w-24 rounded-full border border-teal-200/20" />
          <div className="h-4 w-4 rounded-full bg-teal-200 shadow-[0_0_32px_rgba(94,234,212,0.55)]" />
          {forces.map((force, index) => {
            const positions = [
              ["50%", "8%"],
              ["82%", "30%"],
              ["70%", "78%"],
              ["30%", "78%"],
              ["18%", "30%"],
            ];

            return (
              <div
                key={force}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-xs font-semibold text-teal-100"
                style={{ left: positions[index][0], top: positions[index][1] }}
              >
                {force}
              </div>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {forces.map((force, index) => (
            <div key={force} className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
              <p className="text-sm font-semibold text-white">{force}</p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-teal-200/75"
                  style={{ width: `${[72, 54, 66, 48, 60][index]}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-500">Force intensity</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (field === "kpiDashboard" || field === "kpis") {
    const kpiMetrics = ["Acquisition", "Activation", "Retention", "Gross Margin", "Payback", "Conversion"];

    return (
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {kpiMetrics.map((metric) => (
          <div key={metric} className="grid grid-cols-[4.25rem_1fr] gap-4 rounded-3xl border border-white/10 bg-white/[0.035] p-4">
            <MiniProgressCircle label="" value={extractPercentScore(section.content, metric)} />
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">{metric}</p>
              <p className="mt-2 line-clamp-2 text-xl font-semibold text-white">
                {extractMetricValue(section.content, metric) || "Target"}
              </p>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-teal-200/80"
                  style={{ width: `${extractPercentScore(section.content, metric) ?? 66}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-500">Analytics widget</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

function hasPremiumSectionVisual(section: ReportSection) {
  return (
    section.field === "executiveSummary" ||
    section.field === "marketOverview" ||
    section.field === "marketOpportunity" ||
    section.field === "businessModel" ||
    section.field === "competitorAnalysis" ||
    section.field === "competitorLandscape" ||
    section.field === "tamSamSom" ||
    section.field === "swotAnalysis" ||
    section.field === "financialDashboard" ||
    section.field === "financialAssumptions" ||
    section.field === "founderScore" ||
    section.field === "scenarioAnalysis" ||
    section.field === "executiveRecommendation" ||
    section.field === "founderRoadmap" ||
    section.field === "roadmap306090" ||
    section.field === "portersFiveForces" ||
    section.field === "pricingStrategy" ||
    section.field === "goToMarketPlan" ||
    section.field === "salesStrategy" ||
    section.field === "entryStrategy" ||
    section.field === "unitEconomics" ||
    section.field === "kpiDashboard" ||
    section.field === "kpis"
  );
}

function getReportArticleClass(section: ReportSection) {
  const base =
    "relative min-h-[220px] overflow-hidden rounded-[1.75rem] border p-5 shadow-xl shadow-black/30";

  if (section.field === "executiveSummary") {
    return `${base} border-teal-200/20 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.12),transparent_34%),rgba(0,0,0,0.62)]`;
  }

  if (section.field === "financialDashboard" || section.field === "kpiDashboard" || section.field === "kpis") {
    return `${base} border-white/10 bg-[linear-gradient(135deg,rgba(10,10,10,0.92),rgba(20,83,75,0.16))]`;
  }

  if (
    section.field === "swotAnalysis" ||
    section.field === "portersFiveForces" ||
    section.field === "scenarioAnalysis" ||
    section.field === "marketOverview" ||
    section.field === "marketOpportunity"
  ) {
    return `${base} border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.72),rgba(0,0,0,0.48))]`;
  }

  if (section.field === "executiveRecommendation" || section.field === "founderScore") {
    return `${base} border-teal-200/15 bg-[linear-gradient(135deg,rgba(94,234,212,0.08),rgba(0,0,0,0.66))]`;
  }

  return `${base} border-white/10 bg-black/45`;
}

function AnalysisNotes({
  children,
  compact,
  label = "Full analysis notes",
}: {
  children: ReactNode;
  compact: boolean;
  label?: string;
}) {
  if (!compact) {
    return <>{children}</>;
  }

  return (
    <details className="group rounded-2xl border border-white/10 bg-black/25 p-4">
      <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 transition hover:text-zinc-300">
        {label}
      </summary>
      <div className="mt-4 border-t border-white/10 pt-4">
        {children}
      </div>
    </details>
  );
}

function WorkflowPanel({
  active,
  completedSteps,
}: {
  active: boolean;
  completedSteps: number;
}) {
  if (!active && completedSteps === 0) {
    return null;
  }

  return (
    <div className="rounded-[2rem] border border-teal-200/15 bg-[linear-gradient(135deg,rgba(94,234,212,0.08),rgba(255,255,255,0.035))] p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.28em] text-teal-300/70">
            LIVE AI WORKFLOW
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            ZERINIX is preparing a stable output before rendering the final result.
          </p>
        </div>
        <div className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-100">
          {completedSteps >= workflowSteps.length ? "Complete" : "Working"}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {workflowSteps.map((step, index) => {
          const done = index < completedSteps;
          const current = active && index === completedSteps;

          return (
            <div
              key={step}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-lg shadow-black/10 transition ${
                done
                  ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                  : current
                    ? "border-teal-300/30 bg-teal-300/10 text-teal-100"
                    : "border-white/10 bg-white/[0.03] text-zinc-500"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                  done
                    ? "border-emerald-300/30 bg-emerald-300/20"
                    : "border-white/10 bg-black/40"
                }`}
              >
                {done ? (
                  <Check className="h-3.5 w-3.5 text-emerald-200" />
                ) : (
                  <span className={current ? "h-2 w-2 animate-pulse rounded-full bg-teal-200" : "h-2 w-2 rounded-full bg-zinc-600"} />
                )}
              </span>
              {step}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConversationSidebar({
  conversations,
  activeConversationId,
  activeMode,
  onSelectConversation,
  onCreateConversation,
  onRenameConversation,
  onDeleteConversation,
}: {
  conversations: Conversation[];
  activeConversationId: string;
  activeMode: ChatMode;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => void | Promise<void>;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);

  const sortedConversations = [...conversations].sort(
    (a, b) => b.updatedAt - a.updatedAt
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleConversations = normalizedSearchQuery
    ? sortedConversations.filter((conversation) =>
        conversation.title.toLowerCase().includes(normalizedSearchQuery)
      )
    : sortedConversations;

  function startRename(conversation: Conversation) {
    setRenameTarget(conversation);
    setRenameDraft(conversation.title);
    setRenameError("");
  }

  function submitRename() {
    if (!renameTarget) {
      return;
    }

    const cleanTitle = renameDraft.trim();

    if (!cleanTitle) {
      setRenameError("Conversation name cannot be empty.");
      return;
    }

    onRenameConversation(renameTarget.id, cleanTitle);
    setRenameTarget(null);
    setRenameDraft("");
    setRenameError("");
  }

  function closeRenameModal() {
    setRenameTarget(null);
    setRenameDraft("");
    setRenameError("");
  }

  function confirmDelete() {
    if (!deleteTarget) {
      return;
    }

    onDeleteConversation(deleteTarget.id);
    setDeleteTarget(null);
  }

  const reportCount = conversations.reduce(
    (count, conversation) =>
      count +
      conversation.messages.filter((message) => message.role === "assistant").length,
    0
  );

  return (
    <>
    {renameTarget ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl">
        <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-zinc-950 p-6 shadow-2xl shadow-black/60">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-teal-200/70">
            Rename conversation
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
            Update conversation title
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Use a clear title so this conversation is easy to find later.
          </p>
          <input
            value={renameDraft}
            onChange={(event) => {
              setRenameDraft(event.target.value);
              setRenameError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitRename();
              }

              if (event.key === "Escape") {
                closeRenameModal();
              }
            }}
            autoFocus
            className="mt-5 h-12 w-full rounded-2xl border border-white/10 bg-black/40 px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300/40"
            placeholder="Conversation title"
          />
          {renameError ? (
            <p className="mt-3 text-sm text-red-300">{renameError}</p>
          ) : null}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={closeRenameModal}
              className="inline-flex flex-1 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitRename}
              className="inline-flex flex-1 items-center justify-center rounded-2xl bg-teal-300 px-4 py-3 text-sm font-semibold text-black transition hover:bg-teal-200"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    ) : null}

    {deleteTarget ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl">
        <div className="w-full max-w-md rounded-[2rem] border border-red-300/20 bg-zinc-950 p-6 shadow-2xl shadow-black/60">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-300/20 bg-red-300/10">
            <ShieldAlert className="h-5 w-5 text-red-200" />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.26em] text-red-200/70">
            Delete conversation
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
            {deleteTarget.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            This will permanently delete the conversation and its saved messages.
            This action cannot be undone.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="inline-flex flex-1 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              className="inline-flex flex-1 items-center justify-center rounded-2xl border border-red-300/20 bg-red-300/15 px-4 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-300/20"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    ) : null}

    <aside className="flex min-h-0 border-b border-white/10 bg-black/85 p-4 shadow-2xl shadow-black/30 backdrop-blur-2xl md:h-screen md:w-[21.5rem] md:flex-col md:border-b-0 md:border-r md:bg-black/75">
      <div className="flex w-full items-center justify-between gap-3 md:block">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10 shadow-lg shadow-teal-950/20">
              <Sparkles className="h-5 w-5 text-teal-200" />
            </span>
            <div>
              <p className="text-lg font-semibold tracking-[0.28em] text-white">
                ZERINIX
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">Founder workspace</p>
            </div>
          </div>
          <div className="mt-5 hidden grid-cols-2 gap-2 md:grid">
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              <p className="text-lg font-semibold text-white">{conversations.length}</p>
              <p className="mt-1 text-[11px] text-zinc-500">Conversations</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              <p className="text-lg font-semibold text-white">{reportCount}</p>
              <p className="mt-1 text-[11px] text-zinc-500">AI outputs</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onCreateConversation()}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10 text-teal-100 shadow-lg shadow-teal-950/10 transition hover:-translate-y-0.5 hover:border-teal-200/40 hover:bg-teal-200/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30 md:mt-5 md:w-full md:gap-2 md:px-4 md:text-sm md:font-semibold"
          aria-label="New conversation"
          title="New conversation"
        >
          <Plus className="h-4 w-4 text-teal-200" />
          <span className="hidden md:inline">Create new report</span>
        </button>
      </div>

      <nav className="mt-5 hidden space-y-2 rounded-3xl border border-white/10 bg-white/[0.025] p-2 md:block">
        <Link
          href="/plan"
          className="flex items-center justify-between rounded-2xl bg-white/[0.06] px-3 py-2.5 text-sm font-medium text-white"
        >
          <span className="inline-flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-teal-200" />
            AI Workspace
          </span>
          <span className="rounded-full border border-teal-200/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-teal-100">
            {activeMode === "plan" ? "Plan" : activeMode === "market" ? "Market" : "Chat"}
          </span>
        </Link>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-medium text-zinc-400 transition hover:bg-white/[0.05] hover:text-white"
        >
          <LayoutDashboard className="h-4 w-4 text-zinc-500" />
          Reports
        </Link>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-medium text-zinc-400 transition hover:bg-white/[0.05] hover:text-white"
        >
          <FolderKanban className="h-4 w-4 text-zinc-500" />
          Workspaces
        </Link>
      </nav>

      <div className="mt-4 hidden items-center justify-between px-1 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-600 md:flex">
        <span>Conversations</span>
        <span>{visibleConversations.length}</span>
      </div>

      <label className="mt-3 hidden items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-500 md:flex">
        <Search className="h-4 w-4 text-teal-200" />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search conversations..."
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
        />
      </label>

      <div className="flex flex-1 gap-3 overflow-x-auto pl-3 md:mt-3 md:block md:space-y-3 md:overflow-y-auto md:pl-0">
        {sortedConversations.length === 0 ? (
          <div className="min-w-64 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-zinc-500">
            <p className="font-semibold text-white">No conversations yet</p>
            <p className="mt-2">
              Start a new chat or generate a report to build your workspace history.
            </p>
          </div>
        ) : visibleConversations.length === 0 ? (
          <div className="min-w-64 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-zinc-500">
            <p className="font-semibold text-white">No conversations found</p>
            <p className="mt-2">
              Try another title or clear the search field.
            </p>
          </div>
        ) : null}

        {visibleConversations.map((conversation) => (
          <button
            key={conversation.id}
            type="button"
            onClick={() => onSelectConversation(conversation.id)}
            className={`group min-w-72 rounded-3xl border p-4 text-left text-sm shadow-lg shadow-black/10 transition duration-300 md:w-full ${
              conversation.id === activeConversationId
                ? "border-teal-300/30 bg-teal-300/10 shadow-lg shadow-teal-950/10"
                : "border-white/10 bg-white/[0.03] hover:-translate-y-0.5 hover:border-teal-300/30 hover:bg-white/[0.055]"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 font-medium text-white">
                  {conversation.title}
                </p>
                <p className="mt-2 line-clamp-2 text-zinc-500">
                  {getConversationPreview(conversation)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-100 md:opacity-0 md:transition md:group-hover:opacity-100">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-black/30">
                  <MoreHorizontal className="h-3.5 w-3.5 text-zinc-400" />
                </span>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-zinc-400">
                <MessageSquare className="h-3 w-3 text-teal-200" />
                {conversation.messages.length}
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  startRename(conversation);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.stopPropagation();
                    startRename(conversation);
                  }
                }}
                className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-zinc-400 transition hover:text-white"
              >
                Rename
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  setDeleteTarget(conversation);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.stopPropagation();
                    setDeleteTarget(conversation);
                  }
                }}
                className="rounded-full border border-red-300/10 bg-red-300/5 px-2 py-1 text-[11px] text-red-200 transition hover:bg-red-300/10"
              >
                Delete
              </span>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-4 hidden rounded-3xl border border-white/10 bg-white/[0.03] p-3 md:block">
        <Link
          href="/login"
          prefetch={false}
          className="flex items-center justify-between rounded-2xl px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/[0.05] hover:text-white"
        >
          <span className="inline-flex items-center gap-2">
            <LogOut className="h-4 w-4 text-zinc-500" />
            Account
          </span>
          <span className="text-xs text-zinc-600">Secure</span>
        </Link>
      </div>
    </aside>
    </>
  );
}

const ChatMessageBubble = memo(function ChatMessageBubble({
  message,
  onEdit,
  onSaveEdit,
  onRegenerate,
}: {
  message: ChatMessage;
  onEdit: (message: ChatMessage) => void;
  onSaveEdit: (messageId: string, content: string) => void;
  onRegenerate: () => void;
}) {
  const isUser = message.role === "user";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);

  async function copyMessage() {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function saveEdit() {
    const cleanDraft = draft.trim();

    if (!cleanDraft) {
      return;
    }

    onSaveEdit(message.id, cleanDraft);
    setEditing(false);
  }

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser ? (
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
          <Bot className="h-5 w-5 text-teal-100" />
        </div>
      ) : null}
      <div
        className={`w-full min-w-0 max-w-3xl rounded-3xl border p-5 shadow-xl shadow-black/20 transition ${
          isUser
            ? "border-teal-300/20 bg-teal-300/10"
            : "border-white/10 bg-zinc-950/80"
        }`}
        style={{ contain: message.status === "streaming" ? "layout paint" : undefined }}
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="text-xs font-semibold tracking-[0.2em] text-zinc-500">
            {isUser ? "YOU" : "ZERINIX"}
          </p>
          <div className="flex items-center gap-2">
            {message.status === "streaming" ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300/20 px-2 py-1 text-xs text-teal-100">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Streaming
              </span>
            ) : null}
            <button
              type="button"
              onClick={copyMessage}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              {copied ? (
                <ClipboardCheck className="h-3.5 w-3.5 text-teal-200" />
              ) : (
                <Clipboard className="h-3.5 w-3.5 text-teal-200" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
            {isUser ? (
              <button
                type="button"
                onClick={() => {
                  onEdit(message);
                  setDraft(message.content);
                  setEditing(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
              >
                <Edit3 className="h-3.5 w-3.5 text-teal-200" />
                Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={onRegenerate}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
              >
                <RefreshCcw className="h-3.5 w-3.5 text-teal-200" />
                Regenerate
              </button>
            )}
          </div>
        </div>

        {editing ? (
          <div className="space-y-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-black/40 p-3 text-sm leading-6 text-white outline-none focus:border-teal-300/40"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                className="rounded-xl bg-teal-300 px-3 py-2 text-xs font-semibold text-black transition hover:bg-teal-200"
              >
                Save edit
              </button>
            </div>
          </div>
        ) : (
          <div className={message.status === "streaming" ? "min-h-28" : undefined}>
            <MarkdownRenderer
              content={message.content}
              streaming={message.status === "streaming"}
            />
          </div>
        )}

        {message.attachments && message.attachments.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {message.attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-zinc-300"
              >
                <Paperclip className="h-3.5 w-3.5 text-teal-200" />
                {attachment.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {isUser ? (
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]">
          <User className="h-5 w-5 text-zinc-100" />
        </div>
      ) : null}
    </div>
  );
}, areChatMessagesEqual);

function areChatMessagesEqual(
  previous: {
    message: ChatMessage;
  },
  next: {
    message: ChatMessage;
  }
) {
  const previousMessage = previous.message;
  const nextMessage = next.message;

  return (
    previousMessage.id === nextMessage.id &&
    previousMessage.content === nextMessage.content &&
    previousMessage.status === nextMessage.status &&
    previousMessage.role === nextMessage.role &&
    previousMessage.mode === nextMessage.mode &&
    previousMessage.attachments === nextMessage.attachments
  );
}

const ReportPanel = memo(function ReportPanel({
  reportData,
  reportFields,
  reportTitle,
  sourcePrompt,
  waitingMessage,
  result,
  failureMessage,
  warningMessage,
}: {
  reportData: Partial<MarketReport & PlanReport> | null;
  reportFields: Array<{
    field: keyof (MarketReport & PlanReport);
    title: string;
    icon: LucideIcon;
  }>;
  reportTitle: string;
  sourcePrompt?: string;
  waitingMessage: string;
  result: string;
  failureMessage?: string;
  warningMessage?: string;
}) {
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [pdfFontBase64, setPdfFontBase64] = useState("");
  const sections = useMemo<ReportSection[]>(() => {
    if (reportData) {
      return reportFields.map(({ field, title, icon }) => ({
        field,
        title,
        icon,
        content:
          sanitizeReportFieldContent(field, reportData[field] || "") ||
          waitingMessage,
      }));
    }

    return result
      ? [
          {
            field: "executiveSummary",
            title: "Executive Summary",
            icon: Sparkles,
            content: sanitizeReportContent(result),
          },
        ]
      : [];
  }, [reportData, reportFields, result, waitingMessage]);
  const failedSection = sections.find((section) =>
    isReportGenerationFailureText(section.content)
  );
  const effectiveFailureMessage =
    failureMessage ||
    failedSection?.content ||
    (!reportData && result && isReportGenerationFailureText(result) ? result : "");

  const hasReportContent = !effectiveFailureMessage && sections.some(
    (section) =>
      section.content && section.content !== waitingMessage
  );
  const isSourceSection = (section: ReportSection) =>
    section.field === "sources" ||
    section.field === "sourcesAssumptions" ||
    /^(sources|kaynaklar|sources \/ assumptions|kaynaklar \/ varsayımlar)$/i.test(section.title.trim());
  const visibleSections = sections.filter((section) => !isSourceSection(section));
  const sourceSections = sections.filter(
    (section) =>
      isSourceSection(section) &&
      section.content &&
      section.content !== waitingMessage
  );

  useEffect(() => {
    let mounted = true;

    loadPdfFont()
      .then((fontBase64) => {
        if (mounted) {
          setPdfFontBase64(fontBase64);
        }
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  function downloadPdf() {
    if (effectiveFailureMessage) {
      setPdfError("Report generation failed. PDF export is available only after a report completes successfully.");
      return;
    }

    if (!hasReportContent || exportingPdf) {
      return;
    }

    if (!pdfFontBase64) {
      setPdfError("PDF font is still loading. Please try again in a few seconds.");
      return;
    }

    setExportingPdf(true);
    setPdfError("");
    const isSafari =
      /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
      navigator.vendor.includes("Apple");

    try {
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 14;
      const contentWidth = pageWidth - margin * 2;
      const bodyX = margin + 20;
      const bodyWidth = contentWidth - 28;
      const bodyLineHeight = 5.85;
      const cardHeaderHeight = 25;
      const cardBottomPadding = 11;
      const fullReportContent = sections
        .map((section) => `${section.title}\n${section.content}`)
        .join("\n\n");
      const businessIdea = deriveBusinessDescriptionFromSections(
        sections,
        reportTitle,
        sourcePrompt
      );
      const tocEntries: Array<{ title: string; page: number }> = [];
      let y = margin;

      pdf.addFileToVFS("Geist-Regular.ttf", pdfFontBase64);
      pdf.addFont("Geist-Regular.ttf", "Geist", "normal");
      pdf.setFont("Geist", "normal");
      pdf.setCharSpace(0);

      const paintPage = () => {
        pdf.setFillColor("#000000");
        pdf.rect(0, 0, pageWidth, pageHeight, "F");
        pdf.setDrawColor("#0f766e");
        pdf.setLineWidth(0.15);

        for (let gridX = 0; gridX <= pageWidth; gridX += 18) {
          pdf.line(gridX, 0, gridX, pageHeight);
        }

        for (let gridY = 0; gridY <= pageHeight; gridY += 18) {
          pdf.line(0, gridY, pageWidth, gridY);
        }
      };

      const ensureSpace = (height: number) => {
        if (y + height <= pageHeight - margin) {
          return;
        }

        drawFooter();
        pdf.addPage();
        paintPage();
        y = margin;
      };

      const drawFooter = () => {
        const currentPage = pdf.getCurrentPageInfo().pageNumber;

        pdf.setFillColor("#000000");
        pdf.rect(margin, pageHeight - 11, contentWidth, 8, "F");
        pdf.setDrawColor("#27272a");
        pdf.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10);
        pdf.setFontSize(7);
        pdf.setTextColor("#71717a");
        pdf.text("ZERINIX CONFIDENTIAL INVESTOR REPORT", margin, pageHeight - 5);
        pdf.text(
          `Page ${currentPage} / ${pdf.getNumberOfPages()}`,
          pageWidth - margin - 28,
          pageHeight - 5
        );
      };

      const drawLogoMark = (x: number, logoY: number, size = 13) => {
        pdf.setFillColor("#042f2e");
        pdf.setDrawColor("#14b8a6");
        pdf.roundedRect(x, logoY, size, size, 3, 3, "FD");
        pdf.setFontSize(size * 0.52);
        pdf.setTextColor("#ccfbf1");
        pdf.text("Z", x + size * 0.34, logoY + size * 0.68);
      };

      const drawTag = (label: string, x: number, tagY: number, width: number) => {
        pdf.setFillColor("#042f2e");
        pdf.setDrawColor("#115e59");
        pdf.roundedRect(x, tagY, width, 10, 5, 5, "FD");
        pdf.setFontSize(7.5);
        pdf.setTextColor("#ccfbf1");
        pdf.text(label, x + 4, tagY + 6.4, { maxWidth: width - 8 });
      };

      const splitPdfReadableLines = (content: string, width: number) =>
        repairPdfLineFragments(
          content.split("\n").flatMap((rawLine) => {
            const line = normalizePdfText(rawLine);

            if (!line) {
              return [""];
            }

            const isBullet = /^[-*•]\s+/.test(line);
            const availableWidth = isBullet ? width - 4 : width;
            const wrapped = pdf.splitTextToSize(line, availableWidth) as string[];

            return wrapped.map((wrappedLine, index) =>
              isBullet && index > 0 ? `  ${wrappedLine}` : wrappedLine
            );
          }),
          isOrphanBulletText
        );

      const drawCoverPage = () => {
        paintPage();
        pdf.setFillColor("#020617");
        pdf.setDrawColor("#134e4a");
        pdf.roundedRect(margin, 18, contentWidth, pageHeight - 36, 8, 8, "FD");
        pdf.setFillColor("#14b8a6");
        pdf.rect(margin, 18, 2, pageHeight - 36, "F");

        drawLogoMark(margin + 12, 32, 14);
        pdf.setFontSize(10);
        pdf.setTextColor("#5eead4");
        pdf.text("ZERINIX REPORT", margin + 31, 41);

        pdf.setFontSize(32);
        pdf.setTextColor("#ffffff");
        pdf.text(reportTitle, margin + 12, 60, { maxWidth: contentWidth - 24 });

        pdf.setFontSize(11);
        pdf.setTextColor("#a1a1aa");
        pdf.text("Premium AI business intelligence report for founder and investor decisions.", margin + 12, 78, {
          maxWidth: contentWidth - 24,
        });

        drawTag("AI Ready", margin + 12, 94, 28);
        drawTag("Investor Ready", margin + 44, 94, 38);

        const coverMeta = [
          ["Report Type", reportTitle],
          ["Business Idea", businessIdea],
          ["Date", new Date().toLocaleDateString("tr-TR")],
          ["Theme", "Strategic analysis, financial dashboard, and executive recommendation"],
        ];

        let metaY = 122;
        coverMeta.forEach(([label, value]) => {
          pdf.setFillColor("#09090b");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(margin + 12, metaY, contentWidth - 24, 17, 4, 4, "FD");
          pdf.setFontSize(7.5);
          pdf.setTextColor("#71717a");
          pdf.text(label.toUpperCase(), margin + 18, metaY + 6);
          pdf.setFontSize(9.5);
          pdf.setTextColor("#f4f4f5");
          pdf.text(value, margin + 18, metaY + 12, { maxWidth: contentWidth - 36 });
          metaY += 22;
        });

        const coverCards = [
          "TAM / SAM / SOM",
          "Unit Economics",
          "Scenario Analysis",
          "Founder Roadmap",
        ];

        coverCards.forEach((label, index) => {
          const cardWidth = (contentWidth - 33) / 2;
          const cardX = margin + 12 + (index % 2) * (cardWidth + 9);
          const cardY = 218 + Math.floor(index / 2) * 20;

          pdf.setFillColor("#0a0a0a");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(cardX, cardY, cardWidth, 14, 4, 4, "FD");
          pdf.setFillColor("#5eead4");
          pdf.circle(cardX + 6, cardY + 7, 1.7, "F");
          pdf.setFontSize(8);
          pdf.setTextColor("#d4d4d8");
          pdf.text(label, cardX + 11, cardY + 8.5, { maxWidth: cardWidth - 15 });
        });

        drawFooter();
      };

      drawCoverPage();
      pdf.addPage();
      const tocPage = pdf.getNumberOfPages();
      paintPage();
      drawFooter();
      pdf.addPage();
      paintPage();
      y = margin;

      pdf.setFont("Geist", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor("#5eead4");
      drawLogoMark(margin, y - 6, 10);
      pdf.text("ZERINIX REPORT", margin + 14, y);

      pdf.setFontSize(24);
      pdf.setTextColor("#ffffff");
      pdf.text(reportTitle, margin, y + 11);

      pdf.setFillColor("#042f2e");
      pdf.setDrawColor("#115e59");
      pdf.roundedRect(pageWidth - margin - 32, y + 1, 32, 10, 5, 5, "FD");
      pdf.setFont("Geist", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor("#ccfbf1");
      pdf.text("AI Ready", pageWidth - margin - 25, y + 7.3);

      y += 26;

      const summaryCards = [
        `${visibleSections.length} Sections`,
        "Investor Ready",
        "Strategy Model",
      ];

      summaryCards.forEach((label, index) => {
        const cardWidth = (contentWidth - 8) / 3;
        const cardX = margin + index * (cardWidth + 4);

        pdf.setFillColor("#09090b");
        pdf.setDrawColor("#27272a");
        pdf.roundedRect(cardX, y, cardWidth, 12, 3, 3, "FD");
        pdf.setFontSize(7.5);
        pdf.setTextColor(index === 1 ? "#ccfbf1" : "#a1a1aa");
        pdf.text(label, cardX + 4, y + 7.5, { maxWidth: cardWidth - 8 });
      });

      y += 18;

      const visualFields = new Set<ReportSection["field"]>([
        "tamSamSom",
        "swotAnalysis",
        "unitEconomics",
        "financialDashboard",
        "founderScore",
        "scenarioAnalysis",
        "kpiDashboard",
        "executiveRecommendation",
        "founderRoadmap",
        "roadmap306090",
        "portersFiveForces",
        "risks",
        "kpis",
      ]);

      const getTamRows = (content: string, width: number) =>
        ([
          ["TAM", "#134e4a"],
          ["SAM", "#115e59"],
          ["SOM", "#5eead4"],
        ] as const).map(([label, color]) => {
          const value = extractMarketSizeValue(`${content}\n${fullReportContent}`, label);
          const snippet = extractSectionSnippet(content, label);
          const description = normalizePdfText(snippet.replace(value, ""))
            .replace(new RegExp(`^${label}\\s*[:\\-–—]?`, "i"), "")
            .trim();
          const descriptionLines = description
            ? (pdf.splitTextToSize(description, width - 8) as string[])
            : [];
          const rowHeight = Math.max(15, 13 + descriptionLines.length * 4.4);

          return { label, color, value, descriptionLines, rowHeight };
        });

      const getTamVisualHeight = (content: string, width: number) =>
        getTamRows(content, width).reduce((height, row, index) => {
          return height + row.rowHeight + (index === 0 ? 0 : 3);
        }, 0);

      const getSwotLayout = (content: string, width: number) => {
        const quadrants = [
          ["Strengths", "#042f2e"],
          ["Weaknesses", "#18181b"],
          ["Opportunities", "#0f3f3a"],
          ["Threats", "#1c1917"],
        ] as const;
        const gap = 3;
        const boxWidth = (width - gap) / 2;
        const items = quadrants.map(([label, color]) => {
          const bulletLines = extractSwotBullets(content, label, fullReportContent)
            .slice(0, 3)
            .map((bullet) => pdf.splitTextToSize(`• ${bullet}`, boxWidth - 6) as string[]);
          const textLineCount = Math.max(1, bulletLines.reduce((count, lines) => count + lines.length, 0));
          const boxHeight = Math.max(29, 11 + textLineCount * 4.2);

          return { label, color, bulletLines, boxHeight };
        });
        const firstRowHeight = Math.max(items[0]?.boxHeight ?? 29, items[1]?.boxHeight ?? 29);
        const secondRowHeight = Math.max(items[2]?.boxHeight ?? 29, items[3]?.boxHeight ?? 29);

        return {
          gap,
          boxWidth,
          items,
          rowHeights: [firstRowHeight, secondRowHeight],
          totalHeight: firstRowHeight + gap + secondRowHeight,
        };
      };

      const getFinancialLayout = (content: string, width: number) => {
        const metricContent = `${content}\n${fullReportContent}`;
        const labels = getFinancialDashboardMetrics(metricContent);
        const columns = 3;
        const itemWidth = (width - (columns - 1) * 3) / columns;
        const itemHeight = 18;
        const items = labels
          .map((item) => {
            const value = formatMetricCardValue(extractMetricValueFromAliases(metricContent, item.aliases));
            const compactValue = compactPdfMetricValue(value);
            const description = extractShortDescription(metricContent, item.aliases);
            const descriptionLines = description
              ? (pdf.splitTextToSize(`${item.label}: ${description}`, width - 6) as string[])
              : [];

            return {
              label: item.label,
              aliases: item.aliases,
              value,
              compactValue,
              descriptionLines,
              height: itemHeight,
            };
          })
          .filter((item) => item.compactValue);
        const rowHeights = items.reduce<number[]>((rows, item, index) => {
          const rowIndex = Math.floor(index / columns);
          rows[rowIndex] = Math.max(rows[rowIndex] ?? 0, item.height);
          return rows;
        }, []);

        return {
          columns,
          itemWidth,
          items,
          rowHeights,
          detailLines: items.flatMap((item) => item.descriptionLines),
          gridHeight:
            rowHeights.reduce((total, rowHeight) => total + rowHeight, 0) +
            Math.max(0, rowHeights.length - 1) * 3,
          totalHeight:
            rowHeights.reduce((total, rowHeight) => total + rowHeight, 0) +
            Math.max(0, rowHeights.length - 1) * 3 +
            (items.some((item) => item.descriptionLines.length > 0)
              ? 9 + items.flatMap((item) => item.descriptionLines).length * 3.6
              : 0),
        };
      };

      const getPdfVisualHeight = (section: ReportSection) => {
        if (!visualFields.has(section.field)) {
          return 0;
        }

        if (section.field === "financialDashboard") {
          return getFinancialLayout(section.content, bodyWidth).totalHeight;
        }

        if (section.field === "unitEconomics") {
          return 18;
        }

        if (section.field === "swotAnalysis") {
          return getSwotLayout(section.content, bodyWidth).totalHeight;
        }

        if (section.field === "portersFiveForces") {
          return 46;
        }

        if (section.field === "founderScore") {
          return 34;
        }

        if (section.field === "tamSamSom") {
          return getTamVisualHeight(section.content, bodyWidth);
        }

        if (section.field === "scenarioAnalysis") {
          return 26;
        }

        if (section.field === "kpiDashboard" || section.field === "kpis") {
          return 52;
        }

        if (section.field === "executiveRecommendation") {
          return 48;
        }

        return 22;
      };

      const drawPdfVisual = (section: ReportSection, sectionY: number) => {
        if (!visualFields.has(section.field)) {
          return 0;
        }

        const visualY = sectionY + 19;
        const visualWidth = bodyWidth;
        const drawSingleLine = (
          text: string,
          x: number,
          lineY: number,
          maxWidth: number,
          size: number,
          minSize = 5.4,
          truncate = true
        ) => {
          let fontSize = size;

          pdf.setFontSize(fontSize);
          while (fontSize > minSize && pdf.getTextWidth(text) > maxWidth) {
            fontSize -= 0.35;
            pdf.setFontSize(fontSize);
          }

          const safeText =
            truncate && pdf.getTextWidth(text) > maxWidth
              ? `${text.slice(0, Math.max(4, Math.floor(text.length * (maxWidth / Math.max(pdf.getTextWidth(text), 1))) - 1))}…`
              : text;

          pdf.text(safeText, x, lineY);
        };

        if (section.field === "tamSamSom") {
          const rows = getTamRows(section.content, visualWidth);
          let rowY = visualY;

          rows.forEach(({ label, color, value, descriptionLines, rowHeight }, index) => {
            pdf.setFillColor("#101113");
            pdf.setDrawColor(color);
            pdf.roundedRect(bodyX, rowY, visualWidth, rowHeight, 3, 3, "FD");
            pdf.setFillColor(color);
            pdf.roundedRect(bodyX + 3, rowY + 2, 13, 5, 2.5, 2.5, "F");
            pdf.setFontSize(6.4);
            pdf.setTextColor(index === 2 ? "#000000" : "#ccfbf1");
            pdf.text(label, bodyX + 5, rowY + 5.4);
            pdf.setTextColor("#ccfbf1");
            drawSingleLine(value || "—", bodyX + 20, rowY + 5.7, visualWidth - 24, 8.2, 4.2, false);

            if (descriptionLines.length > 0) {
              pdf.setFontSize(5.6);
              pdf.setTextColor("#a1a1aa");
              pdf.text(descriptionLines, bodyX + 3, rowY + 12.5, {
                lineHeightFactor: 1.18,
                maxWidth: visualWidth - 6,
              });
            }

            rowY += rowHeight + 3;
          });
          return getTamVisualHeight(section.content, visualWidth);
        }

        if (section.field === "swotAnalysis") {
          const swotLayout = getSwotLayout(section.content, visualWidth);

          swotLayout.items.forEach(({ label, color, bulletLines }, index) => {
            const rowIndex = Math.floor(index / 2);
            const x = bodyX + (index % 2) * (swotLayout.boxWidth + swotLayout.gap);
            const boxY = visualY + (rowIndex === 0 ? 0 : swotLayout.rowHeights[0] + swotLayout.gap);
            const boxHeight = swotLayout.rowHeights[rowIndex];

            pdf.setFillColor(color);
            pdf.setDrawColor("#334155");
            pdf.roundedRect(x, boxY, swotLayout.boxWidth, boxHeight, 2.5, 2.5, "FD");
            pdf.setFontSize(7.2);
            pdf.setTextColor("#ccfbf1");
            pdf.text(label.toUpperCase(), x + 3, boxY + 5);
            pdf.setFontSize(6.2);
            pdf.setTextColor("#d4d4d8");
            let bulletY = boxY + 10;
            bulletLines.forEach((lines) => {
              pdf.text(lines, x + 3, bulletY, {
                lineHeightFactor: 1.14,
                maxWidth: swotLayout.boxWidth - 6,
              });
              bulletY += lines.length * 4.2;
            });
          });

          return swotLayout.totalHeight;
        }

        if (section.field === "founderScore") {
          const labels = founderScoreMetrics.slice(0, 6);
          const itemWidth = (visualWidth - 10) / 3;

          labels.forEach((label, index) => {
            const x = bodyX + (index % 3) * (itemWidth + 5);
            const itemY = visualY + Math.floor(index / 3) * 15;
            const score = extractScore(section.content, label) ?? [76, 68, 61, 58, 64, 72][index] ?? 60;

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, itemY, itemWidth, 12, 2.5, 2.5, "FD");
            pdf.setDrawColor("#5eead4");
            pdf.circle(x + 7, itemY + 6, 4.2, "S");
            pdf.setFontSize(6);
            pdf.setTextColor("#ccfbf1");
            pdf.text(String(score), x + 4.2, itemY + 7.8);
            pdf.setFontSize(6.5);
            pdf.setTextColor("#e4e4e7");
            pdf.text(label, x + 14, itemY + 5, { maxWidth: itemWidth - 17 });
            pdf.setTextColor("#71717a");
            pdf.text("Score", x + 14, itemY + 8.8);
          });

          return 31;
        }

        if (section.field === "executiveRecommendation") {
          const selected = detectRecommendation(section.content) || "REVIEW";
          const decisionLabel = formatDecisionLabel(selected);
          const confidence =
            extractConfidence(section.content) ??
            extractConfidence(fullReportContent) ??
            extractScore(fullReportContent, "Investment Score");
          const investmentRecommendation =
            extractMetricValue(section.content, "Investment Recommendation") ||
            extractMetricValue(section.content, "Recommendation") ||
            selected;
          const mainRisk = extractMetricValue(section.content, "Main Risk");
          const nextAction =
            extractMetricValue(section.content, "Next Critical Action") ||
            extractMetricValue(section.content, "Next Action");

          pdf.setFillColor("#ccfbf1");
          pdf.setDrawColor("#5eead4");
          pdf.roundedRect(bodyX, visualY, 52, 26, 5, 5, "FD");
          pdf.setFontSize(5.8);
          pdf.setTextColor("#134e4a");
          pdf.text("RECOMMENDATION", bodyX + 5, visualY + 6);
          pdf.setFontSize(13);
          pdf.setTextColor("#000000");
          drawSingleLine(decisionLabel, bodyX + 5, visualY + 16, 42, 11, 6.5);

          pdf.setFillColor("#27272a");
          pdf.roundedRect(bodyX, visualY + 31, 52, 4, 2, 2, "F");
          pdf.setFillColor("#5eead4");
          pdf.roundedRect(
            bodyX,
            visualY + 31,
            (52 * (confidence ?? 50)) / 100,
            4,
            2,
            2,
            "F"
          );

          const recItems = [
            ["Confidence", confidence === null ? "—" : `${confidence}%`],
            ["Investment Recommendation", investmentRecommendation || "—"],
            ["Main Risk", mainRisk || extractKeywordInsight(fullReportContent, ["risk", "threat"]) || "Primary risk is detailed in the risk analysis"],
            ["Next Action", nextAction || extractKeywordInsight(fullReportContent, ["next action", "critical action", "validate"]) || "Validate the primary investment thesis"],
          ];

          recItems.forEach(([label, value], index) => {
            const itemX = bodyX + 60 + (index % 2) * ((visualWidth - 64) / 2 + 2);
            const itemY = visualY + Math.floor(index / 2) * 17;
            const itemWidth = (visualWidth - 68) / 2;

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(itemX, itemY, itemWidth, 15, 2.5, 2.5, "FD");
            pdf.setFontSize(6);
            pdf.setTextColor("#71717a");
            pdf.text(label.toUpperCase(), itemX + 2, itemY + 3.2);
            pdf.setTextColor("#e4e4e7");
            pdf.setFontSize(6);
            drawSingleLine(value, itemX + 2, itemY + 7.8, itemWidth - 4, 6);
          });

          return 48;
        }

        if (section.field === "founderRoadmap" || section.field === "roadmap306090") {
          const stepWidth = (visualWidth - 10) / 6;
          founderRoadmapSteps.forEach((step, index) => {
            const x = bodyX + index * (stepWidth + 2);
            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, visualY, stepWidth, 9, 2, 2, "FD");
            pdf.setFontSize(6.2);
            pdf.setTextColor("#ccfbf1");
            pdf.text(step, x + 2, visualY + 5.7, { maxWidth: stepWidth - 4 });
          });
          return 12;
        }

        if (section.field === "portersFiveForces") {
          const forces = ["Rivalry", "Entrants", "Buyer", "Supplier", "Substitutes"];
          const centerX = bodyX + visualWidth * 0.32;
          const centerY = visualY + 22;

          pdf.setDrawColor("#115e59");
          pdf.circle(centerX, centerY, 20, "S");
          pdf.circle(centerX, centerY, 13, "S");
          pdf.circle(centerX, centerY, 6, "S");
          pdf.setFillColor("#5eead4");
          pdf.circle(centerX, centerY, 2.2, "F");

          forces.forEach((force, index) => {
            const angle = -Math.PI / 2 + (index * 2 * Math.PI) / forces.length;
            const dotX = centerX + Math.cos(angle) * 20;
            const dotY = centerY + Math.sin(angle) * 20;
            const cardX = bodyX + visualWidth * 0.58;
            const cardY = visualY + index * 8;
            const score = [72, 54, 66, 48, 60][index];

            pdf.setDrawColor("#5eead4");
            pdf.line(centerX, centerY, dotX, dotY);
            pdf.setFillColor("#0f766e");
            pdf.circle(dotX, dotY, 1.8, "F");

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(cardX, cardY, visualWidth * 0.38, 6, 2, 2, "FD");
            pdf.setFontSize(5.8);
            pdf.setTextColor("#e4e4e7");
            pdf.text(force, cardX + 2, cardY + 4);
            pdf.setFillColor("#27272a");
            pdf.roundedRect(cardX + 22, cardY + 2.2, visualWidth * 0.24, 1.4, 0.7, 0.7, "F");
            pdf.setFillColor("#5eead4");
            pdf.roundedRect(cardX + 22, cardY + 2.2, (visualWidth * 0.24 * score) / 100, 1.4, 0.7, 0.7, "F");
          });

          return 46;
        }

        const financialLayout =
          section.field === "financialDashboard" ? getFinancialLayout(section.content, visualWidth) : null;
        const labels =
          section.field === "financialDashboard"
            ? financialLayout?.items ?? []
            : section.field === "scenarioAnalysis"
                ? ["Worst", "Base", "Best"]
                : section.field === "kpiDashboard" || section.field === "kpis"
                  ? ["Acquisition", "Activation", "Retention", "Revenue"]
                  : section.field === "risks"
                    ? ["Market", "Product", "Pricing", "Execution"]
                    : section.field === "unitEconomics"
                      ? ["Gross Margin", "CAC", "LTV", "Payback"]
                      : ["Rivalry", "Entrants", "Buyer", "Substitutes"];
        const isFinancialDashboard = section.field === "financialDashboard";
        const isKpiDashboard = section.field === "kpiDashboard" || section.field === "kpis";
        const isScenario = section.field === "scenarioAnalysis";
        const isUnitEconomics = section.field === "unitEconomics";
        const metricContent = `${section.content}\n${fullReportContent}`;
        const columns = isFinancialDashboard ? 3 : labels.length > 6 ? 4 : labels.length;
        const itemWidth = isFinancialDashboard && financialLayout
          ? financialLayout.itemWidth
          : (visualWidth - (columns - 1) * 3) / columns;

        labels.forEach((item, index) => {
          const label = typeof item === "string" ? item : item.label;
          const aliases = typeof item === "string" ? [item] : item.aliases;
          const x = bodyX + (index % columns) * (itemWidth + 3);
          const rowIndex = Math.floor(index / columns);
          const priorRowHeight = isFinancialDashboard && financialLayout
            ? financialLayout.rowHeights.slice(0, rowIndex).reduce((sum, height) => sum + height, 0)
            : 0;
          const itemHeight = isFinancialDashboard && financialLayout
            ? financialLayout.rowHeights[rowIndex]
            : isKpiDashboard ? 23 : isScenario ? 20 : isUnitEconomics ? 14 : 10;
          const itemY = isFinancialDashboard && financialLayout
            ? visualY + priorRowHeight + rowIndex * 3
            : visualY + rowIndex * (itemHeight + 3);
          const score = extractScore(metricContent, label) ?? [42, 62, 84, 56][index] ?? 60;
          const value = typeof item !== "string" && "value" in item
            ? item.value
            : formatMetricCardValue(extractMetricValueFromAliases(metricContent, aliases));
          const compactValue = compactPdfMetricValue(value);

          pdf.setFillColor("#18181b");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(x, itemY, itemWidth, itemHeight, 2.5, 2.5, "FD");
          pdf.setFontSize(6.2);
          pdf.setTextColor("#a1a1aa");
          pdf.text(label, x + 2, itemY + 3.2, { maxWidth: itemWidth - 4 });
          if (isFinancialDashboard && value) {
            pdf.setTextColor("#f4f4f5");
            drawSingleLine(compactValue || "—", x + 2, itemY + 11.7, itemWidth - 4, 8.8, 4.2, false);
            return;
          }
          if (isUnitEconomics) {
            drawSingleLine(compactValue || "—", x + 2, itemY + 8.8, itemWidth - 4, 7.2, 4.2, false);
            return;
          }
          if (isKpiDashboard) {
            const kpiValue = extractKpiValue(section.content, label) || `${score}%`;
            const target = extractKpiTarget(section.content, label);
            const status = extractKpiStatus(section.content, label);
            pdf.setTextColor("#f4f4f5");
            drawSingleLine(kpiValue, x + 2, itemY + 8.4, itemWidth - 4, 7.5, 4.2, false);
            pdf.setFontSize(5.3);
            pdf.setTextColor("#a1a1aa");
            pdf.text(`Target: ${target || kpiValue || "—"}`, x + 2, itemY + 12.1, { maxWidth: itemWidth - 4 });
            pdf.text(`Status: ${status}`, x + 2, itemY + 15.5, { maxWidth: itemWidth - 4 });
            pdf.setFillColor("#27272a");
            pdf.roundedRect(x + 2, itemY + 18.8, itemWidth - 4, 1.5, 0.7, 0.7, "F");
            pdf.setFillColor("#5eead4");
            pdf.roundedRect(x + 2, itemY + 18.8, Math.max(3, ((itemWidth - 4) * score) / 100), 1.5, 0.7, 0.7, "F");
            return;
          }
          if (isScenario) {
            const snippet = extractScenarioSnippet(section.content, label) || extractKeywordInsight(section.content, [label]);
            pdf.setTextColor("#f4f4f5");
            pdf.setFontSize(6);
            pdf.text(pdf.splitTextToSize(snippet || "Scenario path under review.", itemWidth - 4).slice(0, 2), x + 2, itemY + 8.1, {
              lineHeightFactor: 1.12,
              maxWidth: itemWidth - 4,
            });
            pdf.setFillColor("#27272a");
            pdf.roundedRect(x + 2, itemY + 15, itemWidth - 4, 1.4, 0.7, 0.7, "F");
            pdf.setFillColor(index === 0 ? "#fca5a5" : index === 1 ? "#fde68a" : "#5eead4");
            pdf.roundedRect(x + 2, itemY + 15, Math.max(3, ((itemWidth - 4) * ([42, 66, 84][index] || score)) / 100), 1.4, 0.7, 0.7, "F");
            return;
          }
          pdf.setFillColor("#27272a");
          pdf.roundedRect(x + 2, itemY + 7, itemWidth - 4, 1.4, 0.7, 0.7, "F");
          pdf.setFillColor("#5eead4");
          pdf.roundedRect(
            x + 2,
            itemY + 7,
            Math.max(3, ((itemWidth - 4) * score) / 100),
            1.4,
            0.7,
            0.7,
            "F"
          );
        });

        if (isFinancialDashboard) {
          if (financialLayout && financialLayout.detailLines.length > 0) {
            const detailsY = visualY + financialLayout.gridHeight + 7;

            pdf.setFillColor("#101113");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(bodyX, detailsY - 4, visualWidth, financialLayout.detailLines.length * 3.6 + 8, 2.5, 2.5, "FD");
            pdf.setFontSize(6);
            pdf.setTextColor("#5eead4");
            pdf.text("METRIC DETAILS", bodyX + 3, detailsY);
            pdf.setFontSize(5.5);
            pdf.setTextColor("#a1a1aa");
            pdf.text(financialLayout.detailLines, bodyX + 3, detailsY + 4, {
              lineHeightFactor: 1.1,
              maxWidth: visualWidth - 6,
            });
          }

          return financialLayout?.totalHeight ?? 0;
        }

        if (isKpiDashboard) {
          return 52;
        }

        if (isScenario) {
          return 26;
        }

        if (isUnitEconomics) {
          return 18;
        }

        return labels.length > 6 ? 38 : 22;
      };

      const drawTableOfContents = () => {
        paintPage();
        drawLogoMark(margin, 24, 13);
        pdf.setFontSize(10);
        pdf.setTextColor("#5eead4");
        pdf.text("ZERINIX REPORT", margin + 17, 33);
        pdf.setFontSize(26);
        pdf.setTextColor("#ffffff");
        pdf.text("Table of Contents", margin, 54);
        pdf.setFontSize(8.5);
        pdf.setTextColor("#a1a1aa");
        pdf.text("Click a section title to jump directly to that page.", margin, 64);

        let tocY = 82;
        tocEntries.slice(0, 18).forEach((entry, index) => {
          if (tocY > pageHeight - 26) {
            return;
          }

          pdf.setFillColor(index % 2 === 0 ? "#09090b" : "#050505");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(margin, tocY - 6, contentWidth, 12, 3, 3, "FD");
          pdf.setFontSize(8.5);
          pdf.setTextColor("#f4f4f5");
          pdf.textWithLink(normalizePdfText(entry.title), margin + 6, tocY + 1.5, {
            pageNumber: entry.page,
          });
          pdf.setTextColor("#5eead4");
          pdf.text(String(entry.page), pageWidth - margin - 10, tocY + 1.5);
          tocY += 14;
        });

        drawFooter();
      };

      dedupePdfSections(mergePdfSourceSections(sections)).forEach((section) => {
        if (section.content === waitingMessage) {
          return;
        }

        const visualHeight = getPdfVisualHeight(section);
        const sectionBodyContent = formatPdfReadableContent(section);

        if (isSourceLikeSection(section) && !sectionBodyContent.trim()) {
          return;
        }

        const bodyLines = splitPdfReadableLines(sectionBodyContent, bodyWidth);
        const hasBodyText = sectionBodyContent.trim().length > 0;
        const safeBodyLines = bodyLines.length > 0 ? bodyLines : [""];
        let lineIndex = 0;

        while (lineIndex < safeBodyLines.length) {
          const activeVisualHeight = lineIndex === 0 ? visualHeight : 0;
          const bodyTextHeight = hasBodyText ? bodyLineHeight : 0;
          const minimumCardHeight =
            cardHeaderHeight + activeVisualHeight + bodyTextHeight + cardBottomPadding + 3;

          ensureSpace(minimumCardHeight);

          if (lineIndex === 0) {
            tocEntries.push({
              title: section.title,
              page: pdf.getCurrentPageInfo().pageNumber,
            });
          }

          const availableHeight =
            pageHeight - margin - y - cardHeaderHeight - activeVisualHeight - cardBottomPadding;
          const maxLines = Math.max(1, Math.floor(availableHeight / bodyLineHeight));
          const lines = safeBodyLines.slice(lineIndex, lineIndex + maxLines);
          const isContinued = lineIndex > 0;
          const cardHeight = Math.max(
            31,
            cardHeaderHeight +
              activeVisualHeight +
              (hasBodyText ? lines.length * bodyLineHeight : 0) +
              cardBottomPadding
          );

          pdf.setFillColor("#09090b");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(margin, y, contentWidth, cardHeight, 5, 5, "FD");

          pdf.setFillColor("#111113");
          pdf.roundedRect(margin, y, contentWidth, 18, 5, 5, "F");

          pdf.setFillColor("#18181b");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(margin + 4, y + 5, 11, 11, 3, 3, "FD");

          pdf.setDrawColor("#99f6e4");
          pdf.circle(margin + 9.5, y + 10.5, 2.9, "S");
          pdf.line(margin + 9.5, y + 7.8, margin + 9.5, y + 13.2);
          pdf.line(margin + 6.8, y + 10.5, margin + 12.2, y + 10.5);

          pdf.setFillColor("#5eead4");
          pdf.rect(margin, y + 5, 1, cardHeight - 10, "F");

          pdf.setFont("Geist", "normal");
          pdf.setFontSize(14);
          pdf.setTextColor("#ffffff");
          pdf.text(`${section.title}${isContinued ? " continued" : ""}`, bodyX, y + 12.5, {
            maxWidth: bodyWidth,
          });

          const drawnVisualHeight = activeVisualHeight > 0 && !isContinued ? drawPdfVisual(section, y) : 0;

          if (hasBodyText) {
            pdf.setFont("Geist", "normal");
            pdf.setFontSize(8.8);
            pdf.setTextColor("#d4d4d8");
            pdf.text(lines, bodyX, y + 25 + drawnVisualHeight, {
              lineHeightFactor: 1.45,
              maxWidth: bodyWidth,
            });
          }

          lineIndex += lines.length;
          y += cardHeight + 5;
        }
      });

      drawFooter();
      const finalPage = pdf.getCurrentPageInfo().pageNumber;
      pdf.setPage(tocPage);
      drawTableOfContents();
      const totalPages = pdf.getNumberOfPages();

      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        pdf.setPage(pageNumber);
        drawFooter();
      }

      pdf.setPage(finalPage);

      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      const fileName = "zerinix-report.pdf";

      if (isSafari) {
        const openedWindow = window.open(url, "_blank");

        if (!openedWindow) {
          URL.revokeObjectURL(url);
          setPdfError(
            "Safari blocked the PDF tab. Please allow pop-ups and try again."
          );
          return;
        }

        window.setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 300000);
      } else {
        const link = document.createElement("a");

        link.href = url;
        link.download = fileName;
        link.rel = "noopener";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();

        window.setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 120000);
      }
    } catch (error) {
      console.error(error);
      setPdfError("PDF could not be created. Please try again.");
    } finally {
      setExportingPdf(false);
    }
  }

  if (effectiveFailureMessage) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-[2rem] border border-red-300/20 bg-red-950/20 p-8 text-center shadow-2xl shadow-black/40 backdrop-blur-2xl">
        <div className="max-w-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-red-300/20 bg-red-300/10">
            <ShieldAlert className="h-5 w-5 text-red-200" />
          </div>
          <p className="mt-5 text-lg font-semibold text-white">
            Report generation failed
          </p>
          <p className="mt-2 text-sm leading-6 text-red-100/80">
            {effectiveFailureMessage}
          </p>
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            PDF export is disabled until a full report is generated successfully.
          </p>
        </div>
      </div>
    );
  }

  if (!reportData && !result) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl shadow-black/40 backdrop-blur-2xl">
        <div>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
            <FileText className="h-5 w-5 text-teal-200" />
          </div>
          <p className="mt-5 text-lg font-semibold text-white">
            Your AI report will appear here.
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Send a business prompt to generate a structured ZERINIX report.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section className="min-h-[640px] overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/70 shadow-2xl shadow-black/50 backdrop-blur-2xl">
      <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.14),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.35em] text-teal-300/70">
              ZERINIX EXECUTIVE REPORT
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {reportTitle}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
              Structured analysis prepared for founder-level decision making.
            </p>
          </div>
          <div className="w-fit rounded-full border border-teal-300/20 bg-teal-300/10 px-4 py-2 text-sm text-teal-100">
            {hasReportContent ? "AI Ready" : "Streaming"}
          </div>
        </div>
        {warningMessage ? (
          <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100/90">
            {warningMessage}
          </div>
        ) : null}
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        {visibleSections.map((section, index) => {
          const Icon = section.icon;
          const isFinancialDashboard = section.field === "financialDashboard";
          const detailsContent = isFinancialDashboard
            ? ""
            : section.content;

          return (
            <article
              key={section.field}
              className={getReportArticleClass(section)}
              style={{ contain: section.content === waitingMessage ? "layout paint" : undefined }}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-200/30 to-transparent" />
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-inner shadow-white/5">
                  <Icon className="h-5 w-5 text-teal-200" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-xl font-semibold tracking-tight text-white">
                      {section.title}
                    </h3>
                    <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-zinc-500">
                      Section {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="mt-4 border-t border-white/10 pt-4">
                    <ExecutiveSummaryVisual section={section} />
                    {hasPremiumSectionVisual(section) &&
                    section.field !== "executiveSummary" &&
                    section.field !== "financialDashboard" ? (
                      <ExecutiveInsightBanner section={section} />
                    ) : null}
                    <PremiumSectionVisual section={section} />
                    {detailsContent.trim() ? (
                      <AnalysisNotes
                        compact={hasPremiumSectionVisual(section)}
                        label={isFinancialDashboard ? "Metric Details" : "Full analysis notes"}
                      >
                        <MarkdownRenderer content={detailsContent} />
                      </AnalysisNotes>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="grid gap-3 border-t border-white/10 p-4 sm:grid-cols-2 sm:p-5">
        {reportActions.map((action) => {
          const Icon = action.icon;

          return (
            <button
              key={action.label}
              type="button"
              disabled
              title="Included in the generated report."
              className="flex cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm font-semibold text-zinc-500 opacity-60"
            >
              <Icon className="h-4 w-4 text-zinc-500" />
              {action.label}
            </button>
          );
        })}

        {hasReportContent ? (
          <>
            <button
              type="button"
              onClick={downloadPdf}
              disabled={exportingPdf}
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:border-white/20 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4 text-teal-200" />
              {exportingPdf ? "Preparing PDF..." : "Download PDF"}
            </button>
            {pdfError ? (
              <p className="sm:col-span-2 text-sm leading-6 text-red-300">
                {pdfError}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {sourceSections.length > 0 ? (
        <div className="border-t border-white/10 p-4 sm:p-5">
          <SourcesCard sections={sourceSections} />
        </div>
      ) : null}
    </section>
  );
});

function ReportGenerationShell({
  title,
  currentSection,
  progress,
}: {
  title: string;
  currentSection: string;
  progress: number;
}) {
  const safeProgress = Math.max(0, Math.min(100, progress));

  return (
    <section className="min-h-[640px] overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/75 shadow-2xl shadow-black/50 backdrop-blur-2xl">
      <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.18),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.35em] text-teal-300/70">
              ZERINIX EXECUTIVE REPORT
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {title}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
              ZERINIX is generating the complete report in the background so the
              final document appears without layout shift or partial sections.
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-4 py-2 text-sm text-teal-100">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="rounded-[1.75rem] border border-teal-200/15 bg-[linear-gradient(135deg,rgba(94,234,212,0.12),rgba(255,255,255,0.025))] p-5 shadow-2xl shadow-teal-950/10">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
                Overall Progress
              </p>
              <p className="mt-2 text-xl font-semibold tracking-tight text-white">
                {currentSection || "Preparing report engine"}
              </p>
            </div>
            <p className="text-4xl font-semibold tracking-tight text-white">
              {Math.round(safeProgress)}%
            </p>
          </div>
          <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/5">
            <div
              className="h-full rounded-full bg-teal-200 transition-[width] duration-500 ease-out"
              style={{ width: `${safeProgress}%` }}
            />
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[
            "Executive thesis",
            "Market intelligence",
            "Financial model",
            "Scenario analysis",
            "Founder roadmap",
            "Final recommendation",
          ].map((label, index) => (
            <div
              key={label}
              className="min-h-40 rounded-[1.75rem] border border-white/10 bg-black/35 p-5 shadow-xl shadow-black/20"
            >
              <div className="flex items-center justify-between">
                <span className="h-9 w-9 animate-pulse rounded-2xl border border-teal-200/20 bg-teal-200/10" />
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <p className="mt-5 text-sm font-semibold text-white">{label}</p>
              <div className="mt-4 space-y-2.5">
                <div className="h-2.5 animate-pulse rounded-full bg-white/10" />
                <div className="h-2.5 w-10/12 animate-pulse rounded-full bg-white/10" />
                <div className="h-2.5 w-7/12 animate-pulse rounded-full bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Planner({
  initialConversations = [],
  conversationLoadError = "",
  initialWorkspaces = [],
  initialWorkspaceId = "",
  initialReport = null,
}: PlannerProps) {
  const restoredReportMode =
    initialReport?.status?.toLowerCase() === "completed"
      ? initialReport.type === "Market Analysis"
        ? "market"
        : "plan"
      : null;
  const restoredPlanReport =
    restoredReportMode === "plan"
      ? buildInitialReportData(
          initialReport,
          planReportFields,
          emptyPlanReport as Record<PlanReportField, string>
        )
      : null;
  const restoredMarketReport =
    restoredReportMode === "market"
      ? buildInitialReportData(
          initialReport,
          reportFields,
          emptyMarketReport as Record<MarketReportField, string>
        )
      : null;
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState(
    initialReport?.status?.toLowerCase() === "completed" ? "" : ""
  );
  const [reportGenerationError, setReportGenerationError] = useState("");
  const [reportGenerationWarning, setReportGenerationWarning] = useState("");
  const [marketReport, setMarketReport] = useState<MarketReport | null>(
    restoredMarketReport as MarketReport | null
  );
  const [planReport, setPlanReport] = useState<PlanReport | null>(
    restoredPlanReport as PlanReport | null
  );
  const [activeReportId, setActiveReportId] = useState(
    () => initialReport?.id || getStoredActiveReportId()
  );
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const initialConversationId = useMemo(
    () => initialConversations[0]?.id || createMessageId(),
    [initialConversations]
  );
  const [activeConversationId, setActiveConversationId] = useState(initialConversationId);
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    initialConversations.length > 0
      ? initialConversations
      : [createConversation(initialConversationId)]
  );
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [activeMode, setActiveMode] = useState<ChatMode>(restoredReportMode || "chat");
  const [chatModelPreference, setChatModelPreference] =
    useState<ChatModelPreference>("fast");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    getInitialSelectedWorkspaceId(
      initialWorkspaces,
      initialWorkspaceId,
      initialReport?.workspaceId
    )
  );
  const [workflowCompletedSteps, setWorkflowCompletedSteps] = useState(0);
  const [reportProgress, setReportProgress] = useState(0);
  const [currentReportSectionName, setCurrentReportSectionName] = useState("");
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [conversationError, setConversationError] = useState(conversationLoadError);
  const [userEmail, setUserEmail] = useState("");
  const [lastRequest, setLastRequest] = useState<{
    mode: ChatMode;
    prompt: string;
  } | null>(
    restoredReportMode && initialReport?.prompt
      ? { mode: restoredReportMode, prompt: initialReport.prompt }
      : null
  );
  const [activeReportLanguage, setActiveReportLanguage] =
    useState<ResponseLanguage>("English");
  const chatScrollerRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const isNearBottomRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const persistedConversationIdsRef = useRef(
    new Set(initialConversations.map((conversation) => conversation.id))
  );

  const isReportWorking = loading || analyzing;
  const isWorking = isReportWorking || chatLoading;
  const activeConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === activeConversationId) ||
      conversations[0],
    [activeConversationId, conversations]
  );
  const messages = activeConversation?.messages || [];

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      if (activeReportId) {
        window.sessionStorage.setItem(ACTIVE_REPORT_ID_STORAGE_KEY, activeReportId);
      } else {
        window.sessionStorage.removeItem(ACTIVE_REPORT_ID_STORAGE_KEY);
      }
    } catch {
      // Session storage is best-effort; report chat still works from server props.
    }
  }, [activeReportId]);

  useEffect(() => {
    if (conversationLoadError) {
      console.error("[ai_conversations load failed]", conversationLoadError);
    }
  }, [conversationLoadError]);

  useEffect(() => {
    void loadPersistedConversations();
  }, []);

  function updateNearBottomState() {
    const scroller = chatScrollerRef.current;

    if (!scroller) {
      isNearBottomRef.current = true;
      return;
    }

    const distanceFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 180;
  }

  function scheduleScrollToBottom(behavior: ScrollBehavior = "smooth") {
    if (!isNearBottomRef.current) {
      return;
    }

    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const scroller = chatScrollerRef.current;

      if (!scroller || !isNearBottomRef.current) {
        return;
      }

      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior,
      });
    });
  }

  useEffect(() => {
    scheduleScrollToBottom(messages.length <= 2 ? "auto" : "smooth");

    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [messages.length, workflowCompletedSteps]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        composerRef.current?.focus();
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createNewConversation();
      }
    }

    window.addEventListener("keydown", handleShortcut);

    return () => window.removeEventListener("keydown", handleShortcut);
  });

  function createMessageId() {
    return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function updateConversation(
    conversationId: string,
    updater: (conversation: Conversation) => Conversation
  ) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId ? updater(conversation) : conversation
      )
    );
  }

  function updateActiveConversation(
    updater: (conversation: Conversation) => Conversation
  ) {
    updateConversation(activeConversationId, updater);
  }

  async function createNewConversation() {
    const id = createMessageId();
    const conversation = createConversation(id);

    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(id);
    setPrompt("");
    setResult("");
    setReportGenerationError("");
    setReportGenerationWarning("");
    setMarketReport(null);
    setPlanReport(null);
    setActiveReportId("");
    setWorkflowCompletedSteps(0);
    setReportProgress(0);
    setCurrentReportSectionName("");
    await ensurePersistedConversation(id, conversation.title);
  }

  function renameConversation(id: string, title: string) {
    const cleanTitle = title.trim() || "Untitled conversation";

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id
          ? { ...conversation, title: cleanTitle, updatedAt: Date.now() }
          : conversation
      )
    );

    void persistConversationTitle(id, cleanTitle);
  }

  function deleteConversation(id: string) {
    void deletePersistedConversation(id).then((deleted) => {
      if (!deleted) {
        return;
      }

      setConversations((current) => {
        const remaining = current.filter((conversation) => conversation.id !== id);

        if (remaining.length === 0) {
          const newConversation = createConversation(createMessageId());
          setActiveConversationId(newConversation.id);
          void ensurePersistedConversation(newConversation.id, newConversation.title);
          return [newConversation];
        }

        if (id === activeConversationId) {
          setActiveConversationId(remaining[0].id);
        }

        return remaining;
      });

      persistedConversationIdsRef.current.delete(id);
    });
  }

  async function getCurrentUserId() {
    const supabase = createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return "";
    }

    return user.id;
  }

  async function ensurePersistedConversation(conversationId: string, title: string) {
    if (persistedConversationIdsRef.current.has(conversationId)) {
      return true;
    }

    const userId = await getCurrentUserId();

    if (!userId) {
      console.error("[ai_conversations insert skipped] No authenticated user");
      setConversationError("No authenticated user was available for conversation persistence.");
      window.location.assign("/login?next=/plan");
      return false;
    }

    const supabase = createClient();
    const { error } = await supabase.from("ai_conversations").insert({
      id: conversationId,
      user_id: userId,
      title,
    });

    if (error) {
      console.error("[ai_conversations insert failed]", error);
      setConversationError(error.message);
      return false;
    }

    setConversationError("");
    persistedConversationIdsRef.current.add(conversationId);
    return true;
  }

  async function persistConversationTitle(conversationId: string, title: string) {
    if (!(await ensurePersistedConversation(conversationId, title))) {
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("ai_conversations")
      .update({ title })
      .eq("id", conversationId);

    if (error) {
      console.error("[ai_conversations update failed]", error);
      setConversationError(error.message);
    } else {
      setConversationError("");
    }
  }

  async function touchPersistedConversation(conversationId: string) {
    if (!persistedConversationIdsRef.current.has(conversationId)) {
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("ai_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    if (error) {
      console.error("[ai_conversations touch failed]", error);
      setConversationError(error.message);
    }
  }

  async function deletePersistedConversation(conversationId: string) {
    if (!persistedConversationIdsRef.current.has(conversationId)) {
      return true;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("ai_conversations")
      .delete()
      .eq("id", conversationId);

    if (error) {
      console.error("[ai_conversations delete failed]", error);
      setConversationError("Conversation could not be deleted. Please try again.");
      return false;
    }

    setConversationError("");
    return true;
  }

  async function persistMessage(conversationId: string, message: ChatMessage) {
    const userId = await getCurrentUserId();

    if (!userId) {
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.from("ai_messages").insert({
      id: message.id,
      conversation_id: conversationId,
      user_id: userId,
      role: message.role,
      content: message.content,
      mode: message.mode === "chat" ? null : message.mode || null,
      status: message.status || "complete",
      attachments: message.attachments || [],
    });

    if (error) {
      console.error("[ai_messages insert failed]", error);
      setConversationError(error.message);
      return;
    }

    await touchPersistedConversation(conversationId);
  }

  async function updatePersistedMessage(
    messageId: string,
    content: string,
    status: ChatMessage["status"] = "complete"
  ) {
    const supabase = createClient();
    const { error } = await supabase
      .from("ai_messages")
      .update({ content, status })
      .eq("id", messageId);

    if (error) {
      console.error("[ai_messages update failed]", error);
      setConversationError(error.message);
    } else {
      setConversationError("");
    }
  }

  async function deletePersistedMessage(messageId: string) {
    const supabase = createClient();
    const { error } = await supabase.from("ai_messages").delete().eq("id", messageId);

    if (error) {
      console.error("[ai_messages delete failed]", error);
      setConversationError(error.message);
    }
  }

  async function loadPersistedConversations() {
    const supabase = createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.error("[ai_conversations client auth failed]", userError);
      setConversationError(userError.message);
      return;
    }

    if (!user) {
      console.error("[ai_conversations client auth missing user]");
      window.location.assign("/login?next=/plan");
      return;
    }

    setUserEmail(user.email || "");

    const { data, error } = await supabase
      .from("ai_conversations")
      .select("id,title,created_at,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[ai_conversations client select failed]", error);
      setConversationError(error.message);
      return;
    }

    const loadedConversations = data || [];
    const conversationIds = loadedConversations.map((conversation) => conversation.id as string);
    const { data: messages, error: messagesError } = conversationIds.length
      ? await supabase
          .from("ai_messages")
          .select("id,conversation_id,role,content,mode,status,attachments,created_at")
          .eq("user_id", user.id)
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: true })
      : { data: [], error: null };

    if (messagesError) {
      console.error("[ai_messages client select failed]", messagesError);
      setConversationError(messagesError.message);
      return;
    }

    const messagesByConversation = new Map<string, ChatMessage[]>();

    (messages || []).forEach((message) => {
      const conversationId = message.conversation_id as string;
      const existingMessages = messagesByConversation.get(conversationId) || [];

      existingMessages.push({
        id: message.id as string,
        role: message.role as "user" | "assistant",
        content: message.content as string,
        mode: (message.mode as ChatMode | null) || "chat",
        status: message.status as ChatMessage["status"],
        attachments: Array.isArray(message.attachments)
          ? (message.attachments as ChatAttachment[])
          : [],
        createdAt: new Date(message.created_at as string).getTime(),
      });
      messagesByConversation.set(conversationId, existingMessages);
    });

    const nextConversations = loadedConversations.map((conversation) => ({
      id: conversation.id as string,
      title: conversation.title as string,
      createdAt: new Date(conversation.created_at as string).getTime(),
      updatedAt: new Date(conversation.updated_at as string).getTime(),
      messages: messagesByConversation.get(conversation.id as string) || [],
    }));

    persistedConversationIdsRef.current = new Set(
      nextConversations.map((conversation) => conversation.id)
    );
    setConversationError("");

    if (nextConversations.length === 0) {
      return;
    }

    setConversations(nextConversations);
    setActiveConversationId((currentId) =>
      nextConversations.some((conversation) => conversation.id === currentId)
        ? currentId
        : nextConversations[0].id
    );
  }

  async function loadPersistedMessages(conversationId: string) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("ai_messages")
      .select("id,role,content,mode,status,attachments,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[ai_messages select failed]", error);
      return;
    }

    const messages = (data || []).map((message) => ({
      id: message.id as string,
      role: message.role as "user" | "assistant",
      content: message.content as string,
      mode: (message.mode as ChatMode | null) || "chat",
      status: message.status as ChatMessage["status"],
      attachments: Array.isArray(message.attachments)
        ? (message.attachments as ChatAttachment[])
        : [],
      createdAt: new Date(message.created_at as string).getTime(),
    }));

    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      messages,
    }));
  }

  function selectConversation(conversationId: string) {
    const selectedConversation = conversations.find(
      (conversation) => conversation.id === conversationId
    );
    const latestMode = [...(selectedConversation?.messages || [])]
      .reverse()
      .find((message) => message.mode)?.mode;

    setActiveConversationId(conversationId);
    if (latestMode) {
      setActiveMode(latestMode);
    }
    setPrompt("");
    setResult("");
    setReportGenerationError("");
    setReportGenerationWarning("");
    setMarketReport(null);
    setPlanReport(null);
    setWorkflowCompletedSteps(0);
    void loadPersistedMessages(conversationId);
  }

  async function readAttachmentText(file: File) {
    const textLike =
      file.type.startsWith("text/") ||
      /\.(txt|md|csv|json|ts|tsx|js|jsx|css|html|sql)$/i.test(file.name);

    if (!textLike || file.size > 220_000) {
      return "";
    }

    try {
      return (await file.text()).slice(0, 20_000);
    } catch (error) {
      console.error("[attachment text read failed]", error);
      return "";
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) {
      return;
    }

    const uploadedFiles = await Promise.all(
      Array.from(files).map(async (file) => ({
        id: createMessageId(),
        name: file.name,
        size: file.size,
        textContent: await readAttachmentText(file),
      }))
    );

    setAttachments((current) => [...current, ...uploadedFiles]);
  }

  function handleDropFiles(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDraggingFiles(false);
    void handleFiles(event.dataTransfer.files);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function addUserMessage(mode: ChatMode, content: string, conversationId = activeConversationId) {
    const attachedFiles = attachments;
    const message: ChatMessage = {
      id: createMessageId(),
      role: "user",
      mode,
      content,
      attachments: attachedFiles,
      status: "complete",
      createdAt: Date.now(),
    };
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      title:
        shouldAutoTitleConversation(conversation.title)
          ? generateConversationTitle(content)
          : conversation.title,
      messages: [...conversation.messages, message],
      updatedAt: Date.now(),
    }));
    setAttachments([]);

    return message;
  }

  function addAssistantMessage(
    mode: ChatMode,
    content: string,
    status: ChatMessage["status"] = "streaming",
    conversationId = activeConversationId
  ) {
    const id = createMessageId();
    const message: ChatMessage = {
      id,
      role: "assistant",
      mode,
      content,
      status,
      createdAt: Date.now(),
    };

    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      messages: [...conversation.messages, message],
      updatedAt: Date.now(),
    }));

    return id;
  }

  function updateAssistantMessage(
    id: string,
    content: string,
    status: ChatMessage["status"] = "streaming",
    conversationId = activeConversationId
  ) {
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === id ? { ...message, content, status } : message
      ),
      updatedAt: Date.now(),
    }));
  }

  function editMessage(message: ChatMessage) {
    setPrompt(message.content);
    setActiveMode(message.mode || "plan");
    composerRef.current?.focus();
  }

  function saveEditedMessage(messageId: string, content: string) {
    const currentConversation = conversations.find((conversation) =>
      conversation.messages.some((message) => message.id === messageId)
    );
    const shouldUpdateTitle =
      currentConversation?.messages[0]?.id === messageId &&
      shouldAutoTitleConversation(currentConversation.title);
    const nextTitle = shouldUpdateTitle
      ? generateConversationTitle(content)
      : currentConversation?.title;

    updateActiveConversation((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === messageId ? { ...message, content } : message
      ),
      title: shouldUpdateTitle ? nextTitle || conversation.title : conversation.title,
      updatedAt: Date.now(),
    }));
    void updatePersistedMessage(messageId, content, "complete");
    if (shouldUpdateTitle && nextTitle && currentConversation) {
      void persistConversationTitle(currentConversation.id, nextTitle);
    }
  }

  async function regenerateResponse() {
    if (!lastRequest || isWorking) {
      return;
    }

    const previousAssistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");

    if (previousAssistantMessage) {
      updateActiveConversation((conversation) => ({
        ...conversation,
        messages: conversation.messages.filter(
          (message) => message.id !== previousAssistantMessage.id
        ),
        updatedAt: Date.now(),
      }));
      await deletePersistedMessage(previousAssistantMessage.id);
    }

    setPrompt(lastRequest.prompt);

    if (lastRequest.mode === "plan") {
      void generatePlan(lastRequest.prompt, false);
    } else if (lastRequest.mode === "market") {
      void analyzeMarket(lastRequest.prompt, false);
    } else {
      void sendChatMessage(lastRequest.prompt, false, previousAssistantMessage?.id);
    }
  }

  async function askForClarification(submittedPrompt: string) {
    const conversationId = activeConversationId;
    const responseLanguage = detectResponseLanguage(submittedPrompt);
    const shouldUpdateTitle = shouldAutoTitleConversation(
      activeConversation?.title || "New conversation"
    );
    const title =
      shouldUpdateTitle
        ? generateConversationTitle(submittedPrompt)
        : activeConversation?.title || generateConversationTitle(submittedPrompt);

    await ensurePersistedConversation(conversationId, title);
    const userMessage = addUserMessage(activeMode, submittedPrompt, conversationId);
    await persistMessage(conversationId, userMessage);
    if (shouldUpdateTitle) {
      await persistConversationTitle(conversationId, title);
    }

    const clarification = createClarificationQuestionForLanguage(
      activeMode,
      responseLanguage
    );
    const assistantMessageId = addAssistantMessage(
      activeMode,
      clarification,
      "complete",
      conversationId
    );

    await persistMessage(conversationId, {
      id: assistantMessageId,
      role: "assistant",
      mode: activeMode,
      content: clarification,
      status: "complete",
      createdAt: Date.now(),
    });
    setPrompt("");
    setResult("");
    setMarketReport(null);
    setPlanReport(null);
    setWorkflowCompletedSteps(0);
  }

  async function submitPrompt() {
    const submittedPrompt = prompt.trim();

    if (!submittedPrompt || isWorking) {
      return;
    }

    if (activeMode !== "chat" && needsClarification(submittedPrompt)) {
      await askForClarification(submittedPrompt);
      return;
    }

    if (activeMode === "plan") {
      await generatePlan(submittedPrompt);
    } else if (activeMode === "market") {
      await analyzeMarket(submittedPrompt);
    } else {
      await sendChatMessage(submittedPrompt);
    }
  }

  async function getGeneralWorkspaceId(
    supabase: ReturnType<typeof createClient>,
    userId: string
  ) {
    const { data: existingWorkspace } = await supabase
      .from("report_workspaces")
      .select("id")
      .eq("user_id", userId)
      .eq("name", "General")
      .maybeSingle();

    if (existingWorkspace?.id) {
      return existingWorkspace.id as string;
    }

    const { data: createdWorkspace, error } = await supabase
      .from("report_workspaces")
      .insert({
        user_id: userId,
        name: "General",
      })
      .select("id")
      .single();

    if (error || !createdWorkspace?.id) {
      const { data: retryWorkspace } = await supabase
        .from("report_workspaces")
        .select("id")
        .eq("user_id", userId)
        .eq("name", "General")
        .maybeSingle();

      return (retryWorkspace?.id as string | undefined) || "";
    }

    return createdWorkspace.id as string;
  }

  async function saveGeneratedReport({
    title,
    promptText,
    reportType,
    workspaceId,
    status = "completed",
    sections,
    expectedSectionCount,
  }: {
    title: string;
    promptText: string;
    reportType: string;
    workspaceId?: string;
    status?: "completed" | "failed";
    sections: Array<{ title: string; content: string }>;
    expectedSectionCount: number;
  }) {
    try {
      const isCompletedReport =
        status === "completed" &&
        isCompleteReportSectionPayload(sections, expectedSectionCount);
      const persistedStatus = isCompletedReport ? "completed" : "failed";
      const persistedSections = isCompletedReport ? sections : [];

      if (status === "completed" && !isCompletedReport) {
        console.error("[reports insert blocked completed status]", {
          reportType,
          expectedSectionCount,
          receivedSectionCount: sections.length,
          containsFailureText: containsReportGenerationFailure(sections),
        });
      }

      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        console.error(userError || new Error("Authenticated user not found."));
        return "";
      }

      const destinationWorkspaceId =
        workspaceId || selectedWorkspaceId || (await getGeneralWorkspaceId(supabase, user.id));

      if (!destinationWorkspaceId) {
        console.error(new Error("Destination workspace not found."));
        return "";
      }

      const { data, error } = await supabase
        .from("reports")
        .insert({
          user_id: user.id,
          workspace_id: destinationWorkspaceId,
          title,
          prompt: promptText,
          report_type: reportType,
          status: persistedStatus,
          sections: persistedSections,
        })
        .select("id")
        .single();

      if (error) {
        console.error(error);
        return "";
      }

      return typeof data?.id === "string" ? data.id : "";
    } catch (error) {
      console.error(error);
      return "";
    }
  }

  async function notifyReportReady(reportId: string) {
    if (!reportId) {
      return;
    }

    try {
      await fetch(`/api/reports/${encodeURIComponent(reportId)}/notify`, {
        method: "POST",
      });
    } catch (error) {
      console.error("[report ready notification failed]", error);
    }
  }

  async function readStreamingSectionJson(
    response: Response,
    onEvent: (event: ReportStreamEvent) => void,
    fallbackMessage: string,
    onFirstChunk?: () => void
  ) {
    if (!response.ok || !response.body) {
      let errorMessage = fallbackMessage;

      try {
        const data = await response.json();
        errorMessage =
          typeof data?.error === "string" && data.error.trim()
            ? data.error
            : fallbackMessage;
      } catch {
        errorMessage = fallbackMessage;
      }

      throw new Error(errorMessage);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let hasChunk = false;
    let buffer = "";

    const parseReportStreamEvent = (value: string) => {
      const event = JSON.parse(value) as ReportStreamEvent;
      const failedEntry = Object.entries(event).find(
        ([key, entry]) =>
          key !== "warning" &&
          key !== "missingFields" &&
          key !== "invalidFields" &&
          key !== "partial" &&
          typeof entry === "string" &&
          isReportGenerationFailureText(entry)
      );
      const failedValue =
        typeof failedEntry?.[1] === "string" ? failedEntry[1] : undefined;

      if (failedValue) {
        throw new Error(failedValue);
      }

      return event;
    };

    const emitBufferedEvents = () => {
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) {
          continue;
        }

        try {
          const event = parseReportStreamEvent(trimmed);

          if (!hasChunk && Object.values(event).some(Boolean)) {
            hasChunk = true;
            onFirstChunk?.();
          }

          onEvent(event);
        } catch (error) {
          throw error instanceof Error
            ? error
            : new Error("Report stream contained malformed section JSON.");
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      emitBufferedEvents();
    }

    buffer += decoder.decode();
    emitBufferedEvents();

    if (buffer.trim()) {
      try {
        onEvent(parseReportStreamEvent(buffer.trim()));
      } catch (error) {
        throw error instanceof Error
          ? error
          : new Error("Report stream ended with malformed section JSON.");
      }
    }
  }

  async function readStreamingText(
    response: Response,
    onChunk: (content: string) => void,
    fallbackMessage: string
  ) {
    if (!response.ok || !response.body) {
      let errorMessage = fallbackMessage;

      try {
        const data = await response.json();
        errorMessage =
          typeof data?.error === "string" && data.error.trim()
            ? data.error
            : fallbackMessage;
      } catch {
        errorMessage = fallbackMessage;
      }

      throw new Error(errorMessage);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let output = "";

    while (true) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(
                new Error(
                  "Chat response timed out before the stream completed. Please try again."
                )
              ),
            CHAT_STREAM_IDLE_TIMEOUT_MS
          );
        }),
      ]).finally(() => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      });

      if (done) {
        break;
      }

      output += decoder.decode(value, { stream: true });
      onChunk(sanitizeAiResponseText(output));
    }

    output += decoder.decode();
    const sanitizedOutput = sanitizeAiResponseText(output);
    onChunk(sanitizedOutput);

    return sanitizedOutput;
  }

  async function sendChatMessage(
    promptOverride = prompt,
    addToHistory = true,
    supersededAssistantMessageId = ""
  ) {
    const submittedPrompt = promptOverride.trim();

    if (!submittedPrompt || chatLoading) {
      return;
    }

    setChatLoading(true);
    setActiveMode("chat");
    setLastRequest({ mode: "chat", prompt: submittedPrompt });
    setReportGenerationError("");
    setReportGenerationWarning("");
    setResult("");
    setMarketReport(null);
    setPlanReport(null);
    setWorkflowCompletedSteps(0);
    setReportProgress(0);
    setCurrentReportSectionName("");

    const conversationId = activeConversationId;
    const shouldUpdateTitle = shouldAutoTitleConversation(
      activeConversation?.title || "New conversation"
    );
    const title = shouldUpdateTitle
      ? generateConversationTitle(submittedPrompt)
      : activeConversation?.title || generateConversationTitle(submittedPrompt);
    const currentMessages = activeConversation?.messages || [];
    const currentAttachments = attachments;
    const memoryMessages = currentMessages
      .filter(
        (message) =>
          message.content.trim() &&
          message.id !== supersededAssistantMessageId &&
          message.status !== "failed" &&
          !isReportPreparingPreview(message.content)
      )
      .slice(-12)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    await ensurePersistedConversation(conversationId, title);

    if (addToHistory) {
      const userMessage = addUserMessage("chat", submittedPrompt, conversationId);
      await persistMessage(conversationId, userMessage);
      if (shouldUpdateTitle) {
        await persistConversationTitle(conversationId, title);
      }
    }

    const assistantMessageId = addAssistantMessage(
      "chat",
      "",
      "streaming",
      conversationId
    );
    void persistMessage(conversationId, {
      id: assistantMessageId,
      role: "assistant",
      mode: "chat",
      content: "",
      status: "streaming",
      createdAt: Date.now(),
    });

    const abortController = new AbortController();
    let requestTimedOut = false;
    const requestTimeoutId = setTimeout(() => {
      requestTimedOut = true;
      abortController.abort();
    }, CHAT_REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          prompt: submittedPrompt,
          conversationId,
          modelPreference: chatModelPreference,
          attachments: currentAttachments.map((attachment) => ({
            name: attachment.name,
            size: attachment.size,
            textContent: attachment.textContent || "",
          })),
          messages: memoryMessages,
          reportId: activeReportId,
        }),
      });
      const responseText = await readStreamingText(
        res,
        (content) => updateAssistantMessage(assistantMessageId, content, "streaming", conversationId),
        "Chat response failed. Please try again."
      );
      const finalText = responseText || "I could not generate a response. Please try again.";

      updateAssistantMessage(assistantMessageId, finalText, "complete", conversationId);
      void updatePersistedMessage(assistantMessageId, finalText, "complete");
      setPrompt("");
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      const errorMessage =
        aborted && requestTimedOut
          ? "Chat response timed out before the server responded. Please try again."
          : getReportGenerationErrorMessage(
              error,
              aborted ? "Generation stopped." : "Chat response failed. Please try again."
            );

      setReportGenerationError(errorMessage);
      updateAssistantMessage(assistantMessageId, errorMessage, "failed", conversationId);
      void updatePersistedMessage(assistantMessageId, errorMessage, "failed");
    } finally {
      clearTimeout(requestTimeoutId);
      setChatLoading(false);
    }
  }

  async function generatePlan(promptOverride = prompt, addToHistory = true) {
    const submittedPrompt = promptOverride.trim();

    if (!submittedPrompt || loading) {
      return;
    }

    setLoading(true);
    setActiveMode("plan");
    setWorkflowCompletedSteps(0);
    setLastRequest({ mode: "plan", prompt: submittedPrompt });
    setReportProgress(0);
    setCurrentReportSectionName("Preparing report engine");
    const responseLanguage = detectResponseLanguage(submittedPrompt);
    const copy = getLanguageCopy(responseLanguage);
    const outputFields = localizeReportFields(planReportFields);
    setActiveReportLanguage(responseLanguage);
    const conversationId = activeConversationId;
    const reportRequestId = createMessageId();
    const shouldUpdateTitle = shouldAutoTitleConversation(
      activeConversation?.title || "New conversation"
    );
    const title = shouldUpdateTitle
      ? generateConversationTitle(submittedPrompt)
      : activeConversation?.title || generateConversationTitle(submittedPrompt);
    await ensurePersistedConversation(
      conversationId,
      title
    );
    if (addToHistory) {
      const userMessage = addUserMessage("plan", submittedPrompt, conversationId);
      await persistMessage(conversationId, userMessage);
      if (shouldUpdateTitle) {
        await persistConversationTitle(conversationId, title);
      }
    }
    const assistantMessageId = addAssistantMessage(
      "plan",
      copy.preparingPlan,
      "streaming",
      conversationId
    );
    await persistMessage(conversationId, {
      id: assistantMessageId,
      role: "assistant",
      mode: "plan",
      content: copy.preparingPlan,
      status: "streaming",
      createdAt: Date.now(),
    });
    setResult("");
    setReportGenerationError("");
    setReportGenerationWarning("");
    setMarketReport(null);
    setPlanReport(null);

    const reportOutput: PlanReport = { ...emptyPlanReport };
    const completedFields = new Set<PlanReportField>();
    let reportApiCalls = 0;
    const maxReportApiCalls = 1;

    const markSectionComplete = (field: PlanReportField) => {
      if (completedFields.has(field)) {
        return;
      }

      completedFields.add(field);
      setCurrentReportSectionName(
        outputFields.find((item) => item.field === field)?.title || copy.planTitle
      );
      setReportProgress((completedFields.size / planReportFields.length) * 100);
    };

    const streamFullReport = async () => {
      reportApiCalls += 1;

      logOperationalInfo("[planner] Business Plan AI call count", {
        reportRequestId,
        aiCallsForReport: reportApiCalls,
        maxAiCallsPerReport: maxReportApiCalls,
      });

      if (reportApiCalls > maxReportApiCalls) {
        throw new Error(
          "AI call budget exceeded for this report. Please start a new report request."
        );
      }

      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: submittedPrompt,
          field: "fullReport",
          language: responseLanguage,
          reportRequestId,
        }),
      });

      setCurrentReportSectionName("Generating complete report");
      setWorkflowCompletedSteps((current) => Math.max(current, 1));

      await readStreamingSectionJson(
        res,
        (event) => {
          for (const { field } of planReportFields) {
            const chunk = event[field];

            if (!chunk) {
              continue;
            }

            if (isReportGenerationFailureText(chunk)) {
              throw new Error(chunk);
            }

            reportOutput[field] = chunk;
            markSectionComplete(field);
          }
        },
        copy.sectionFallback,
        undefined
      );
    };

    try {
      await streamFullReport();
      const serializedSections = serializeReportSections(reportOutput, outputFields);

      setPlanReport({ ...reportOutput });
      setReportProgress(100);
      setCurrentReportSectionName("Report ready");
      setWorkflowCompletedSteps(workflowSteps.length);
      updateAssistantMessage(
        assistantMessageId,
        getReportMarkdown(copy.planTitle, reportOutput, outputFields),
        "complete",
        conversationId
      );
      await updatePersistedMessage(
        assistantMessageId,
        getReportMarkdown(copy.planTitle, reportOutput, outputFields),
        "complete"
      );
      const savedReportId = await saveGeneratedReport({
        title: copy.planTitle,
        promptText: submittedPrompt,
        reportType: "business_plan",
        workspaceId: selectedWorkspaceId,
        sections: serializedSections,
        expectedSectionCount: outputFields.length,
      });
      setActiveReportId(savedReportId);
      void notifyReportReady(savedReportId);
    } catch (error) {
      const errorMessage = getReportGenerationErrorMessage(error, copy.retryError);
      setReportGenerationError(errorMessage);
      setResult(errorMessage);
      setPlanReport(null);
      setReportProgress(0);
      setCurrentReportSectionName("Report failed");
      setWorkflowCompletedSteps(0);
      await saveGeneratedReport({
        title: copy.planTitle,
        promptText: submittedPrompt,
        reportType: "business_plan",
        workspaceId: selectedWorkspaceId,
        status: "failed",
        sections: [],
        expectedSectionCount: outputFields.length,
      });
      updateAssistantMessage(
        assistantMessageId,
        errorMessage,
        "failed",
        conversationId
      );
      await updatePersistedMessage(
        assistantMessageId,
        errorMessage,
        "failed"
      );
    } finally {
      setLoading(false);
    }
  }

  async function analyzeMarket(promptOverride = prompt, addToHistory = true) {
    const submittedPrompt = promptOverride.trim();

    if (!submittedPrompt || analyzing) {
      return;
    }

    setAnalyzing(true);
    setActiveMode("market");
    setWorkflowCompletedSteps(0);
    setLastRequest({ mode: "market", prompt: submittedPrompt });
    setReportProgress(0);
    setCurrentReportSectionName("Preparing report engine");
    const responseLanguage = detectResponseLanguage(submittedPrompt);
    const copy = getLanguageCopy(responseLanguage);
    const outputFields = localizeReportFields(reportFields);
    setActiveReportLanguage(responseLanguage);
    const conversationId = activeConversationId;
    const reportRequestId = createMessageId();
    const shouldUpdateTitle = shouldAutoTitleConversation(
      activeConversation?.title || "New conversation"
    );
    const title = shouldUpdateTitle
      ? generateConversationTitle(submittedPrompt)
      : activeConversation?.title || generateConversationTitle(submittedPrompt);
    await ensurePersistedConversation(
      conversationId,
      title
    );
    if (addToHistory) {
      const userMessage = addUserMessage("market", submittedPrompt, conversationId);
      await persistMessage(conversationId, userMessage);
      if (shouldUpdateTitle) {
        await persistConversationTitle(conversationId, title);
      }
    }
    const assistantMessageId = addAssistantMessage(
      "market",
      copy.preparingMarket,
      "streaming",
      conversationId
    );
    await persistMessage(conversationId, {
      id: assistantMessageId,
      role: "assistant",
      mode: "market",
      content: copy.preparingMarket,
      status: "streaming",
      createdAt: Date.now(),
    });
    setResult("");
    setReportGenerationError("");
    setReportGenerationWarning("");
    setPlanReport(null);
    setMarketReport(null);

    const reportOutput: MarketReport = { ...emptyMarketReport };
    const completedFields = new Set<MarketReportField>();
    let reportApiCalls = 0;
    const maxReportApiCalls = 1;

    const markSectionComplete = (field: MarketReportField) => {
      if (completedFields.has(field)) {
        return;
      }

      completedFields.add(field);
      setCurrentReportSectionName(
        outputFields.find((item) => item.field === field)?.title || copy.marketTitle
      );
      setReportProgress((completedFields.size / reportFields.length) * 100);
    };

    const streamFullReport = async () => {
      reportApiCalls += 1;

      logOperationalInfo("[planner] Market Analysis AI call count", {
        reportRequestId,
        aiCallsForReport: reportApiCalls,
        maxAiCallsPerReport: maxReportApiCalls,
      });

      if (reportApiCalls > maxReportApiCalls) {
        throw new Error(
          "AI call budget exceeded for this report. Please start a new report request."
        );
      }

      const res = await fetch("/api/market-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: submittedPrompt,
          field: "fullReport",
          language: responseLanguage,
          reportRequestId,
        }),
      });

      setCurrentReportSectionName("Generating complete report");
      setWorkflowCompletedSteps((current) => Math.max(current, 1));

      await readStreamingSectionJson(
        res,
        (event) => {
          if (event.warning) {
            const affectedFields = [
              ...(event.missingFields || []),
              ...(event.invalidFields || []),
            ];
            const affectedTitles = affectedFields
              .map((field) => outputFields.find((item) => item.field === field)?.title)
              .filter(Boolean)
              .join(", ");
            const warningMessage = affectedTitles
              ? `${event.warning} Affected sections: ${affectedTitles}.`
              : event.warning;

            setReportGenerationWarning(warningMessage);
            setResult(warningMessage);
          }

          for (const { field } of reportFields) {
            const chunk = event[field];

            if (!chunk) {
              continue;
            }

            if (isReportGenerationFailureText(chunk)) {
              throw new Error(chunk);
            }

            reportOutput[field] = chunk;
            markSectionComplete(field);
          }
        },
        copy.sectionFallback,
        undefined
      );
    };

    try {
      await streamFullReport();
      const serializedSections = serializeReportSections(reportOutput, outputFields);

      setMarketReport({ ...reportOutput });
      setReportProgress(100);
      setCurrentReportSectionName("Report ready");
      setWorkflowCompletedSteps(workflowSteps.length);
      updateAssistantMessage(
        assistantMessageId,
        getReportMarkdown(copy.marketTitle, reportOutput, outputFields),
        "complete",
        conversationId
      );
      await updatePersistedMessage(
        assistantMessageId,
        getReportMarkdown(copy.marketTitle, reportOutput, outputFields),
        "complete"
      );
      const savedReportId = await saveGeneratedReport({
        title: copy.marketTitle,
        promptText: submittedPrompt,
        reportType: "market_analysis",
        workspaceId: selectedWorkspaceId,
        sections: serializedSections,
        expectedSectionCount: outputFields.length,
      });
      setActiveReportId(savedReportId);
      void notifyReportReady(savedReportId);
    } catch (error) {
      const errorMessage = getReportGenerationErrorMessage(
        error,
        copy.marketRetryError
      );
      setReportGenerationError(errorMessage);
      setResult(errorMessage);
      setMarketReport(null);
      setReportProgress(0);
      setCurrentReportSectionName("Report failed");
      setWorkflowCompletedSteps(0);
      await saveGeneratedReport({
        title: copy.marketTitle,
        promptText: submittedPrompt,
        reportType: "market_analysis",
        workspaceId: selectedWorkspaceId,
        status: "failed",
        sections: [],
        expectedSectionCount: outputFields.length,
      });
      updateAssistantMessage(
        assistantMessageId,
        errorMessage,
        "failed",
        conversationId
      );
      await updatePersistedMessage(
        assistantMessageId,
        errorMessage,
        "failed"
      );
    } finally {
      setAnalyzing(false);
    }
  }

  const currentResponseLanguage = activeReportLanguage;
  const currentLanguageCopy = useMemo(
    () => getLanguageCopy(currentResponseLanguage),
    [currentResponseLanguage]
  );
  const activeReportMode = planReport
    ? "plan"
    : marketReport || activeMode === "market"
      ? "market"
      : "plan";
  const activeEmptyState = modeEmptyState[activeMode];
  const activeReportFields = useMemo(
    () =>
      (activeReportMode === "plan"
        ? localizeReportFields(planReportFields)
        : localizeReportFields(reportFields)) as Array<{
        field: keyof (MarketReport & PlanReport);
        title: string;
        icon: LucideIcon;
      }>,
    [activeReportMode]
  );
  const currentReportTitle = activeReportMode === "plan"
    ? currentLanguageCopy.planTitle
    : currentLanguageCopy.marketTitle;

  return (
    <main
      className="flex h-[100dvh] min-h-[100svh] flex-col overflow-hidden bg-black text-white md:flex-row"
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDraggingFiles(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDraggingFiles(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setIsDraggingFiles(false);
        }
      }}
      onDrop={handleDropFiles}
    >
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        activeMode={activeMode}
        onSelectConversation={selectConversation}
        onCreateConversation={createNewConversation}
        onRenameConversation={renameConversation}
        onDeleteConversation={deleteConversation}
      />

      <section className="relative flex min-w-0 flex-1 flex-col bg-black">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:54px_54px] opacity-35" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.19),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_30%),linear-gradient(180deg,rgba(0,0,0,0.08),#000_94%)]" />
        {isDraggingFiles ? (
          <div className="pointer-events-none absolute inset-4 z-40 flex items-center justify-center rounded-[2rem] border border-dashed border-teal-300/50 bg-black/75 shadow-2xl shadow-teal-950/20 backdrop-blur-xl">
            <div className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-teal-300/30 bg-teal-300/10">
                <FileUp className="h-6 w-6 text-teal-100" />
              </div>
              <p className="mt-4 text-lg font-semibold text-white">
                Drop files into ZERINIX
              </p>
              <p className="mt-2 text-sm text-zinc-500">
                They will attach to your next message.
              </p>
            </div>
          </div>
        ) : null}

        <header className="relative z-10 flex items-center justify-between gap-4 border-b border-white/10 bg-black/65 px-5 py-4 shadow-xl shadow-black/20 backdrop-blur-2xl lg:px-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold tracking-[0.35em] text-teal-300/70">
                ZERINIX AI
              </p>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-zinc-300">
                {activeMode === "plan"
                  ? "AI Plan mode"
                  : activeMode === "market"
                    ? "Market Analysis mode"
                    : "AI Chat mode"}
              </span>
            </div>
            <h1 className="mt-1 truncate text-xl font-semibold text-white md:text-2xl">
              {activeConversation?.title || "Entrepreneur Operating Chat"}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void createNewConversation()}
              className="hidden items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10 md:inline-flex"
            >
              <Plus className="h-4 w-4 text-teal-200" />
              New chat
            </button>
            <button
              type="button"
              onClick={regenerateResponse}
              disabled={!lastRequest || isWorking}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCcw className="h-4 w-4 text-teal-200" />
              <span className="hidden sm:inline">Regenerate response</span>
            </button>
            <div className="hidden items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 lg:flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-sm font-semibold text-black">
                {(userEmail || "Z").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-white">Account</p>
                <p className="max-w-40 truncate text-[11px] text-zinc-500">
                  {userEmail || "Authenticated user"}
                </p>
              </div>
            </div>
          </div>
        </header>

        <div
          ref={chatScrollerRef}
          onScroll={updateNearBottomState}
          className="relative z-10 flex-1 overflow-y-auto scroll-smooth px-4 py-5 sm:px-5 lg:px-8"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-5 pb-48">
            {conversationError ? (
              <div className="rounded-3xl border border-red-300/20 bg-red-950/30 p-4 text-sm leading-6 text-red-100 shadow-2xl shadow-black/30">
                <p className="font-semibold text-red-50">
                  Conversation history could not be loaded or saved.
                </p>
                <p className="mt-1 break-words text-red-100/80">
                  Your workspace is safe. Please refresh the page or try again shortly.
                </p>
              </div>
            ) : null}

            {messages.length === 0 ? (
              <div className="flex min-h-[52vh] items-center justify-center text-center">
                <div className="w-full max-w-4xl rounded-[2rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/40 backdrop-blur-2xl sm:p-8">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl border border-teal-200/20 bg-teal-200/10 shadow-2xl shadow-teal-950/20">
                    <Sparkles className="h-6 w-6 text-teal-200" />
                  </div>
                  <h2 className="mt-6 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                    {activeEmptyState.title}
                  </h2>
                  <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
                    {activeEmptyState.description}
                  </p>
                  <div className="mt-6 grid gap-3 text-left md:grid-cols-3">
                    {modeSuggestions[activeMode].map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setPrompt(suggestion)}
                        className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm leading-6 text-zinc-300 shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:border-teal-200/30 hover:bg-teal-200/[0.06] hover:text-white"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <ChatMessageBubble
                  key={message.id}
                  message={message}
                  onEdit={editMessage}
                  onSaveEdit={saveEditedMessage}
                  onRegenerate={regenerateResponse}
                />
              ))
            )}

            <WorkflowPanel active={isReportWorking} completedSteps={workflowCompletedSteps} />

            {isReportWorking ? (
              <ReportGenerationShell
                title={currentReportTitle}
                currentSection={currentReportSectionName}
                progress={reportProgress}
              />
            ) : (planReport || marketReport || result) ? (
              <ReportPanel
                reportData={planReport || marketReport}
                reportFields={activeReportFields}
                reportTitle={currentReportTitle}
                sourcePrompt={lastRequest?.prompt}
                waitingMessage={currentLanguageCopy.waitingSection}
                result={result}
                failureMessage={reportGenerationError}
                warningMessage={reportGenerationWarning}
              />
            ) : null}
          </div>
        </div>

        <div className="relative z-20 border-t border-white/10 bg-black/75 px-4 py-4 shadow-2xl shadow-black/40 backdrop-blur-2xl sm:px-5 lg:px-8">
          <div className="mx-auto max-w-6xl">
            {attachments.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300"
                  >
                    <Paperclip className="h-3.5 w-3.5 text-teal-200" />
                    {attachment.name}
                    <span className="text-zinc-600">{formatFileSize(attachment.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.id)}
                      className="rounded-full p-0.5 transition hover:bg-white/10"
                      aria-label="Remove attachment"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-3 shadow-2xl shadow-black/50 ring-1 ring-white/[0.03] backdrop-blur-2xl">
              <div className="mb-2 flex flex-wrap items-center gap-2 px-2 pt-1">
                <span className="rounded-full border border-teal-200/20 bg-teal-200/10 px-3 py-1 text-xs font-medium text-teal-100">
                  {activeMode === "plan"
                    ? "AI Plan"
                    : activeMode === "market"
                      ? "Market Analysis"
                      : "AI Chat"}
                </span>
                <span className="text-xs text-zinc-600">
                  {activeMode === "chat"
                    ? `AI Chat · ${chatModelOptions.find((option) => option.value === chatModelPreference)?.label || "Fast"} model`
                    : "Structured report mode"}
                </span>
                {activeMode !== "chat" && initialWorkspaces.length > 0 ? (
                  <label className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
                    Save to
                    <select
                      value={selectedWorkspaceId}
                      onChange={(event) => setSelectedWorkspaceId(event.target.value)}
                      className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs font-medium text-zinc-200 outline-none transition focus:border-teal-300/40"
                    >
                      {initialWorkspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              <div className="mb-3 grid gap-2 md:grid-cols-3">
                {modeCards.map((modeCard) => {
                  const Icon = modeCard.icon;
                  const selected = activeMode === modeCard.mode;

                  return (
                    <button
                      key={modeCard.mode}
                      type="button"
                      onClick={() => setActiveMode(modeCard.mode)}
                      className={`rounded-2xl border p-3 text-left shadow-lg shadow-black/10 transition duration-300 ${
                        selected
                          ? "border-teal-200/35 bg-teal-200/10 shadow-lg shadow-teal-950/20"
                          : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.055]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                          <Icon className="h-4 w-4 text-teal-200" />
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                            selected
                              ? "bg-teal-200 text-black"
                              : "border border-white/10 text-zinc-500"
                          }`}
                        >
                          {selected ? "Active" : "Select"}
                        </span>
                      </div>
                      <p className="mt-3 text-sm font-semibold text-white">
                        {modeCard.label}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">
                        {modeCard.description}
                      </p>
                      <p className="mt-2 text-[11px] font-medium text-teal-100/80">
                        {modeCard.output}
                      </p>
                    </button>
                  );
                })}
              </div>
              <textarea
                ref={composerRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void submitPrompt();
                  }
                }}
                className="min-h-28 w-full resize-none rounded-2xl bg-black/35 p-4 text-base leading-7 text-white outline-none ring-1 ring-white/5 transition placeholder:text-zinc-600 focus:ring-teal-200/25"
                placeholder={activeEmptyState.placeholder}
              />

              <div className="flex flex-col gap-3 pt-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:-translate-y-0.5 hover:bg-white/10">
                    <Paperclip className="h-4 w-4 text-teal-200" />
                    Upload files
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => void handleFiles(event.target.files)}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => setActiveMode("plan")}
                    className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                      activeMode === "plan"
                        ? "bg-white text-black"
                        : "border border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/10"
                    }`}
                  >
                    AI Plan
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveMode("market")}
                    className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                      activeMode === "market"
                        ? "bg-white text-black"
                        : "border border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/10"
                    }`}
                  >
                    Market Analysis
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveMode("chat")}
                    className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                      activeMode === "chat"
                        ? "bg-white text-black"
                        : "border border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/10"
                    }`}
                  >
                    AI Chat
                  </button>
                  {activeMode === "chat" ? (
                    <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-white/10 bg-black/25 p-1">
                      {chatModelOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setChatModelPreference(option.value)}
                          className={`rounded-xl px-3 py-2 text-left transition ${
                            chatModelPreference === option.value
                              ? "bg-teal-200 text-black"
                              : "text-zinc-400 hover:bg-white/10 hover:text-white"
                          }`}
                          aria-pressed={chatModelPreference === option.value}
                        >
                          <span className="block text-xs font-semibold">{option.label}</span>
                          <span
                            className={`block text-[10px] ${
                              chatModelPreference === option.value
                                ? "text-black/60"
                                : "text-zinc-600"
                            }`}
                          >
                            {option.description}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  disabled={!prompt.trim() || isWorking}
                  onClick={() => void submitPrompt()}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-teal-300 px-5 py-3 text-sm font-semibold text-black shadow-lg shadow-teal-950/40 transition hover:-translate-y-0.5 hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                >
                  {isWorking ? "Streaming..." : "Send"}
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-center text-xs text-zinc-600">
              <span className="inline-flex items-center gap-1">
                <CornerDownLeft className="h-3.5 w-3.5" />
                Cmd/Ctrl + Enter to send
              </span>
              <span className="inline-flex items-center gap-1">
                <Search className="h-3.5 w-3.5" />
                Cmd/Ctrl + K to focus
              </span>
              <span>ZERINIX can make mistakes; verify critical decisions.</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
