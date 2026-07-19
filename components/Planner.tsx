"use client";

import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { jsPDF } from "jspdf";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
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
import { MobileBottomNavigation } from "@/components/MobileNavigation";
import { createClient } from "@/app/lib/supabase/client";
import { sanitizeAiResponseText } from "@/app/lib/ai/response-sanitization";
import { logOperationalInfo } from "@/app/lib/security/logging";
import { isAmbiguousBusinessRequest } from "@/app/lib/business-idea-detection";
import {
  containsReportGenerationFailure,
  isReportGenerationFailureText,
} from "@/app/lib/report-errors";
import { dedupeReportSections } from "@/app/lib/report-section-normalization";
import {
  detectPdfPresentationLocale,
  localizePdfPresentationLabel,
  localizePdfPresentationText,
  localizePdfReportSections,
  normalizePdfCanonicalTamSamSomContent,
  normalizePdfFinancialSectionContent,
  normalizePdfTamSamSomBodyContent,
  normalizePdfTamSamSomOwnershipContent,
  normalizePdfText,
  normalizePdfSourceContent,
  normalizePdfSourceDomain,
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
type ExecutiveBriefField =
  | "decisionGoal"
  | "company"
  | "industryMarket"
  | "region"
  | "businessObjective"
  | "additionalContext";
type ExecutiveBriefFields = Record<ExecutiveBriefField, string>;

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

type RegenerationContext = {
  reportId: string;
  reportTitle: string;
  reportType: "Business Plan" | "Market Analysis";
  workspaceId: string;
  prompt: string;
};

type LastRequest = {
  mode: ChatMode;
  prompt: string;
};

type PlannerProps = {
  initialConversations?: Conversation[];
  conversationLoadError?: string;
  initialMode?: ChatMode;
  initialWorkspaces?: PlannerWorkspace[];
  initialWorkspaceId?: string;
  initialReport?: InitialReport | null;
  regenerationContext?: RegenerationContext | null;
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

const modeEmptyState: Record<ChatMode, { title: string; description: string; placeholder: string }> =
  {
    chat: {
      title: "Pressure-test a strategic decision.",
      description:
        "Use a continuous advisory session with memory, markdown answers, file context, and fast model routing.",
      placeholder: "Ask a strategic question, paste notes, or upload context for ZERINIX to assess...",
    },
    plan: {
      title: "Create a strategic decision report.",
      description:
        "Analyze opportunities, markets and business decisions with ZERINIX.",
      placeholder:
        "Describe the decision, market or business question you want ZERINIX to analyze.",
    },
    market: {
      title: "Build market intelligence.",
      description:
        "Enter a market, product category, geography or strategic question. ZERINIX will generate a structured market intelligence report.",
      placeholder:
        "Example: Premium gym franchise market in Turkey, urban professionals, competitors, pricing and entry risk...",
    },
  };

const modeCards: Array<{
  mode: ChatMode;
  label: string;
  description: string;
  output: string;
  opens: string;
  icon: LucideIcon;
}> = [
  {
    mode: "plan",
    label: "Business Idea Validation",
    description: "Pressure-test a venture thesis, customer fit, risks and execution path.",
    output: "Validation report",
    opens: "Creates a structured business validation report",
    icon: BriefcaseBusiness,
  },
  {
    mode: "market",
    label: "Market Intelligence",
    description: "Map market size, competitors, timing, entry strategy and opportunity quality.",
    output: "Market memo",
    opens: "Creates a market intelligence report",
    icon: BarChart3,
  },
  {
    mode: "chat",
    label: "Strategic Advisory",
    description: "Use ZERINIX as an executive advisor for a specific strategic decision.",
    output: "Advisor session",
    opens: "Advisor session",
    icon: Bot,
  },
];

const executiveDecisionExamples: Record<ChatMode, string[]> = {
  plan: [
    "Validate an AI procurement platform for mid-market CFOs before raising a seed round.",
    "Assess whether a premium wellness clinic can scale in Dubai with a membership model.",
    "Evaluate a B2B SaaS idea for automated compliance reporting in EU financial services.",
  ],
  market: [
    "Analyze the Turkish premium fitness market, buyer segments, pricing and competitive gaps.",
    "Map the European EV charging software market for fleet operators and municipalities.",
    "Size the opportunity for AI customer support automation in boutique e-commerce brands.",
  ],
  chat: [
    "Should we enter the enterprise segment now or keep focusing on SMB customers?",
    "Which GTM risk matters most before we spend on paid acquisition?",
    "How should we prioritize product, sales and fundraising over the next 90 days?",
  ],
};

const executiveDecisionCategories = [
  { label: "Market entry", detail: "Timing, demand, competitors", icon: BarChart3 },
  { label: "Business model", detail: "Pricing, margins, scalability", icon: PieChart },
  { label: "Execution risk", detail: "Team, capital, operations", icon: ShieldAlert },
];

const executiveBriefFields: Array<{
  field: ExecutiveBriefField;
  label: string;
  placeholder: string;
  multiline?: boolean;
}> = [
  {
    field: "decisionGoal",
    label: "Decision Goal",
    placeholder: "What decision should this report support?",
  },
  {
    field: "company",
    label: "Company",
    placeholder: "Company, product or business idea",
  },
  {
    field: "industryMarket",
    label: "Industry / Market",
    placeholder: "Industry, category, customer segment",
  },
  {
    field: "region",
    label: "Target Country or Region",
    placeholder: "Country, region or launch geography",
  },
  {
    field: "businessObjective",
    label: "Business Objective",
    placeholder: "Validation, fundraising, expansion, pricing, GTM...",
    multiline: true,
  },
  {
    field: "additionalContext",
    label: "Additional Context",
    placeholder: "Known constraints, competitors, budget, timeline, assumptions or links",
    multiline: true,
  },
];

const emptyExecutiveBrief: ExecutiveBriefFields = {
  decisionGoal: "",
  company: "",
  industryMarket: "",
  region: "",
  businessObjective: "",
  additionalContext: "",
};

function buildExecutiveBriefPrompt(fields: ExecutiveBriefFields) {
  return [
    ["Decision Goal", fields.decisionGoal],
    ["Company", fields.company],
    ["Industry / Market", fields.industryMarket],
    ["Target Country or Region", fields.region],
    ["Business Objective", fields.businessObjective],
    ["Additional Context", fields.additionalContext],
  ]
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `${label}: ${value.trim()}`)
    .join("\n");
}

const decisionGoalLabels: Record<ChatMode, string> = {
  plan: "Business Idea Validation",
  market: "Market Intelligence",
  chat: "Strategic Advisory",
};

const mobileWizardStepLabels = ["Decision type", "Business context", "Generate"];

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
  const sections = dedupeReportSections(
    fields.map(({ field, title }) => ({
      field,
      title,
      content: sanitizeReportFieldContent(field, reportData[field] || ""),
    }))
  );

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
    return "New analysis session";
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
    title === "New analysis session" ||
    title === "New ZERINIX conversation" ||
    title === "Untitled conversation"
  );
}

function getAnalysisSessionTitle(title: string) {
  return title === "New conversation" ? "New analysis session" : title;
}

function createConversation(id: string): Conversation {
  const now = Date.now();

  return {
    id,
    title: "New analysis session",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function getInitialLastRequest({
  regenerationContext,
  restoredReportMode,
  initialReport,
  initialMode,
  initialConversations,
}: {
  regenerationContext: RegenerationContext | null;
  restoredReportMode: ChatMode | null;
  initialReport: InitialReport | null;
  initialMode?: ChatMode;
  initialConversations: Conversation[];
}): LastRequest | null {
  const regenerationPrompt =
    regenerationContext?.prompt.trim() || initialReport?.prompt.trim() || "";

  if (regenerationContext && regenerationPrompt) {
    return {
      mode: regenerationContext.reportType === "Market Analysis" ? "market" : "plan",
      prompt: regenerationPrompt,
    };
  }

  if (restoredReportMode && initialReport?.prompt.trim()) {
    return {
      mode: restoredReportMode,
      prompt: initialReport.prompt.trim(),
    };
  }

  const recentUserMessage = [...initialConversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .flatMap((conversation) => [...conversation.messages].reverse())
    .find((message) => message.role === "user" && message.content.trim());

  if (!recentUserMessage) {
    return null;
  }

  return {
    mode: recentUserMessage.mode || initialMode || "chat",
    prompt: recentUserMessage.content.trim(),
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
  sourceType?: "Verified source" | "Company reference" | "Industry reference" | "Planning assumption";
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
  if (/\b(assumption|planning input|estimate|ai assumption|market-derived|model-derived|needs validation)\b/i.test(value)) {
    return "Planning assumption";
  }

  if (/\b(company|official website|website|pricing page|annual report|investor relations|press release|case study|customer story)\b/i.test(value)) {
    return "Company reference";
  }

  if (/\b(industry|market report|research|benchmark|government|statistics|statista|euromonitor|gartner|forrester|mckinsey|bcg|deloitte|pwc|oecd|world bank|imf|eurostat|tüik|tuik|association)\b/i.test(value)) {
    return "Industry reference";
  }

  return "Verified source";
}

function getCitationDomain(url?: string, organization = "") {
  if (url) {
    return normalizePdfSourceDomain(url);
  }

  return normalizePdfSourceDomain(
    normalizePdfText(organization)
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|corp|company|publisher|organization)\b\.?/g, "")
  );
}

function getCitationSourceName(citation: Pick<CitationData, "sourceTitle" | "organization" | "url">) {
  return (
    getCitationDomain(citation.url, citation.organization) ||
    citation.organization ||
    citation.sourceTitle ||
    "Source"
  );
}

function getCitationDedupeKey(citation: CitationData) {
  const domain = getCitationDomain(citation.url, citation.organization);
  const titleKey = normalizePdfText(citation.sourceTitle).toLowerCase().replace(/\W+/g, " ").trim();
  const organizationKey = normalizePdfText(citation.organization).toLowerCase().replace(/\W+/g, " ").trim();
  const domainNameKey = normalizePdfText(domain.split(".")[0] || "").toLowerCase().replace(/\W+/g, " ").trim();
  const sourceNameKey = normalizePdfText(getCitationSourceName(citation))
    .toLowerCase()
    .replace(/\W+/g, " ")
    .trim();
  const normalizedSourceName =
    domainNameKey &&
    (titleKey === domainNameKey ||
      organizationKey === domainNameKey ||
      sourceNameKey === domainNameKey ||
      titleKey.startsWith(`${domainNameKey} `) ||
      organizationKey.startsWith(`${domainNameKey} `))
      ? domainNameKey
      : sourceNameKey || titleKey || organizationKey;

  return [
    "source",
    domain || "no-domain",
    organizationKey || "unknown-publisher",
    normalizedSourceName || "unknown-source",
  ].join("|");
}

function getPdfCitationSourceTypeLabel(citation: CitationData) {
  if (citation.sourceType === "Company reference") {
    return "Official company website";
  }

  if (citation.sourceType === "Industry reference") {
    return "Industry reference";
  }

  if (citation.sourceType === "Planning assumption") {
    return "Planning assumption";
  }

  return "Verified source";
}

function getPdfCitationTrustLabel(citation: CitationData) {
  if (!citation.url || citation.sourceType === "Planning assumption") {
    return "Reference";
  }

  return "Verified source";
}

function dedupePdfCitations(citations: CitationData[]) {
  const unique = new Map<string, CitationData>();

  citations.forEach((citation) => {
    const domain = getCitationDomain(citation.url, citation.organization);
    const publisherKey = normalizePdfText(citation.organization).toLowerCase().replace(/\W+/g, " ").trim();
    const sourceNameKey = normalizePdfText(getCitationSourceName(citation))
      .toLowerCase()
      .replace(/\W+/g, " ")
      .trim();
    const key = [
      domain || "no-domain",
      publisherKey || "unknown-publisher",
      sourceNameKey || "unknown-source",
    ].join("|");
    const existing = unique.get(key);

    unique.set(key, {
      ...existing,
      ...citation,
      ...(existing?.url && !citation.url ? { url: existing.url } : {}),
      ...(existing?.sourceType && !citation.sourceType ? { sourceType: existing.sourceType } : {}),
      ...(existing?.confidence && !citation.confidence ? { confidence: existing.confidence } : {}),
    });
  });

  return Array.from(unique.values());
}

function getFinalDedupePdfSources(citations: CitationData[]) {
  const unique = new Map<
    string,
    {
      sourceName: string;
      sourceType: string;
      trustLabel: string;
    }
  >();

  dedupePdfCitations(citations).forEach((citation) => {
    const domain = getCitationDomain(citation.url, citation.organization);
    const domainNameKey = normalizePdfText(domain.split(".")[0] || "")
      .toLowerCase()
      .replace(/\W+/g, " ")
      .trim();
    const sourceName = getCitationSourceName(citation);
    const sourceNameKey = normalizePdfText(sourceName).toLowerCase().replace(/\W+/g, " ").trim();
    const rawPublisherKey = normalizePdfText(citation.organization).toLowerCase().replace(/\W+/g, " ").trim();
    const publisherKey =
      domainNameKey &&
      (!rawPublisherKey ||
        rawPublisherKey === "publisher not specified" ||
        rawPublisherKey === domainNameKey ||
        rawPublisherKey.startsWith(`${domainNameKey} `) ||
        sourceNameKey === domainNameKey)
        ? domainNameKey
        : rawPublisherKey || "unknown-publisher";
    const displayKey = sourceNameKey || domainNameKey || "unknown-source";
    const key = [
      domain || "no-domain",
      publisherKey,
      displayKey,
    ].join("|");
    const fallbackDisplayKey = `display:${domain || "no-domain"}|${displayKey}`;

    if (!unique.has(key) && !unique.has(fallbackDisplayKey)) {
      unique.set(key, {
        sourceName,
        sourceType: getPdfCitationSourceTypeLabel(citation),
        trustLabel: getPdfCitationTrustLabel(citation),
      });
      unique.set(fallbackDisplayKey, unique.get(key)!);
    }
  });

  return Array.from(new Set(unique.values()));
}

function normalizeCitationUrl(value = "") {
  const normalized = normalizePdfText(value).trim();

  if (
    !normalized ||
    /^[-–—]+$/.test(normalized) ||
    /^(?:not verified|url doğrulanmadı|n\/?a|not available|none|null|undefined)$/i.test(normalized)
  ) {
    return "";
  }

  return /^https?:\/\//i.test(normalized) ? normalized : "";
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
      const url = normalizeCitationUrl(
        rawLine.match(/\]\((https?:\/\/[^)]+)\)/i)?.[1]?.trim() ||
          rawLine.match(/\bhttps?:\/\/[^\s)]+/i)?.[0]?.trim() ||
          ""
      );
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
          const normalizedUrl = normalizeCitationUrl(url || value);
          if (normalizedUrl) current.url = normalizedUrl;
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
    const key = getCitationDedupeKey(citation);
    const existing = unique.get(key);

    unique.set(key, {
      ...existing,
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

  const domain = getCitationDomain(citation.url, citation.organization);
  const sourceName = getCitationSourceName(citation);
  const trustLabel = citation.sourceType === "Verified source" && citation.url ? "Verified" : "Reference";

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-6 text-white">{sourceName}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <span className="rounded-full border border-teal-200/15 bg-teal-200/10 px-2.5 py-1 text-[11px] font-semibold text-teal-100">
            {citation.sourceType || "Verified source"}
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-zinc-300">
            {trustLabel}
          </span>
        </div>
      </div>
      {citation.url ? (
        <a
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex w-fit items-center rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-xs font-semibold text-teal-100 transition hover:border-teal-200/25 hover:bg-teal-200/10"
        >
          Open source
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
          key={`${getCitationDomain(citation.url, citation.organization)}-${citation.sourceTitle}-${citation.publicationYear || ""}-${citation.url || ""}-${index}`}
          citation={citation}
        />
      ))}
    </div>
  );
}

function SourcesCard({ sections }: { sections: ReportSection[] }) {
  const mergedContent = sections
    .map((section) => section.content.trim())
    .filter(Boolean)
    .join("\n");
  const citations = parseCitations(mergedContent);

  if (!mergedContent) {
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
          <div className="mt-4 space-y-3">
            {citations.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {citations.map((citation, index) => (
                  <Citation
                    key={`${getCitationDomain(citation.url, citation.organization)}-${citation.sourceTitle}-${citation.publicationYear || ""}-${index}`}
                    citation={citation}
                  />
                ))}
              </div>
            ) : null}
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-sm font-semibold text-white">Methodology &amp; Assumptions</p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Market sizing, financial projections and KPI estimates are based on available market signals, benchmark data and planning assumptions.
              </p>
            </div>
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

const roadmapStepAliases: Record<string, string[]> = {
  Tomorrow: ["Tomorrow", "Immediate Actions", "Today", "First 24 Hours"],
  "This Week": ["This Week", "Next 7 Days", "Week 1"],
  "30 Days": ["30 Days", "Next 30 Days"],
  "90 Days": ["90 Days", "Next 90 Days"],
  "180 Days": ["180 Days", "6 Months", "Next 6 Months"],
  "12 Months": ["12 Months", "Next 12 Months", "Year 1"],
};

const competitorFieldLabels = [
  "Company",
  "Positioning",
  "Strengths",
  "Weaknesses",
  "Competitive Threat",
  "Threat",
  "Pricing",
  "Target Customer",
  "Funding",
  "Employee Size",
  "How ZERINIX can outperform",
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

function cleanExecutiveText(value: string, maxLength = 180) {
  const cleaned = normalizePdfText(value)
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  const truncated = cleaned.slice(0, maxLength).replace(/\s+\S*$/, "");

  return `${truncated || cleaned.slice(0, maxLength)}…`;
}

function extractMeaningfulBullets(content: string, limit = 4) {
  const normalized = normalizePdfText(content);
  const bulletLines = normalized
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\*\*/g, "")
        .trim()
    )
    .filter((line) => line.length > 16 && !isOrphanBulletText(line));

  if (bulletLines.length > 0) {
    return bulletLines.slice(0, limit).map((line) => cleanExecutiveText(line, 150));
  }

  return normalized
    .replace(/\*\*/g, "")
    .split(/(?<=[.!?])\s+/)
    .map((line) => cleanExecutiveText(line, 150))
    .filter((line) => line.length > 16 && !isOrphanBulletText(line))
    .slice(0, limit);
}

function extractMarketLevelDescription(content: string, label: string) {
  const value = extractMarketSizeValue(content, label);
  const snippet = extractSectionSnippet(content, label) || extractKeywordInsight(content, [label]);
  const description = snippet
    .replace(new RegExp(`^${escapeRegExp(label)}\\s*[:\\-–—]?`, "i"), "")
    .replace(value, "")
    .replace(/\b(?:formula|source|confidence|assumption)\b\s*[:\-–—].*$/i, "")
    .trim();

  return cleanExecutiveText(description || `${label} validation requires verified market data.`, 140);
}

function getReportMarketRows(content: string) {
  return [
    {
      label: "TAM",
      name: "Total Addressable Market",
      value: extractMarketSizeValue(content, "TAM") || "NO DATA",
      description: extractMarketLevelDescription(content, "TAM"),
      tone: "from-teal-200 to-cyan-100",
    },
    {
      label: "SAM",
      name: "Serviceable Available Market",
      value: extractMarketSizeValue(content, "SAM") || "NO DATA",
      description: extractMarketLevelDescription(content, "SAM"),
      tone: "from-teal-400 to-teal-200",
    },
    {
      label: "SOM",
      name: "Serviceable Obtainable Market",
      value: extractMarketSizeValue(content, "SOM") || "VALIDATION REQUIRED",
      description: extractMarketLevelDescription(content, "SOM"),
      tone: "from-emerald-400 to-teal-300",
    },
  ];
}

function parseInlineField(line: string, label: string) {
  const labels = competitorFieldLabels
    .filter((item) => item !== label)
    .map(escapeRegExp)
    .join("|");
  const match = line.match(
    new RegExp(`${escapeRegExp(label)}\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=\\s+(?:${labels})\\s*[:\\-–—]|$)`, "i")
  );

  return match?.[1]?.trim() || "";
}

function extractCompetitorRows(content: string) {
  const normalized = normalizePdfText(content).replace(/\*\*/g, "");
  const tableRows = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|") && !/^\|\s*-/.test(line));

  if (tableRows.length > 1) {
    const headers = tableRows[0]
      .split("|")
      .map((cell) => cell.trim().toLowerCase())
      .filter(Boolean);

    return tableRows
      .slice(1)
      .map((row) => row.split("|").map((cell) => cell.trim()).filter(Boolean))
      .map((cells) => {
        const read = (keys: string[]) => {
          const index = headers.findIndex((header) => keys.some((key) => header.includes(key)));
          return index >= 0 ? cells[index] || "" : "";
        };

        return {
          company: read(["company", "competitor", "rakip"]),
          positioning: read(["position", "konum"]),
          strengths: read(["strength", "güç"]),
          weaknesses: read(["weakness", "zayıf"]),
          threat: read(["threat", "risk"]),
        };
      })
      .filter((row) => row.company || row.positioning || row.strengths || row.weaknesses || row.threat)
      .slice(0, 5);
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim().replace(/^[-*•]\s+/, ""))
    .filter((line) => line.length > 14);
  const rows: Array<{
    company: string;
    positioning: string;
    strengths: string;
    weaknesses: string;
    threat: string;
  }> = [];

  lines.forEach((line) => {
    const company =
      parseInlineField(line, "Company") ||
      parseInlineField(line, "Competitor") ||
      line.match(/^([A-Z0-9][A-Za-z0-9 .&()/-]{1,42})\s*[:—–-]\s+/)?.[1]?.trim() ||
      "";
    const positioning = parseInlineField(line, "Positioning") || parseInlineField(line, "Target Customer");
    const strengths = parseInlineField(line, "Strengths");
    const weaknesses = parseInlineField(line, "Weaknesses");
    const threat = parseInlineField(line, "Competitive Threat") || parseInlineField(line, "Threat");

    if (company || positioning || strengths || weaknesses || threat) {
      rows.push({
        company: cleanExecutiveText(company || "Market participant", 52),
        positioning: cleanExecutiveText(positioning || line, 120),
        strengths: cleanExecutiveText(strengths || extractKeywordInsight(line, ["strength", "advantage"]) || "VALIDATION REQUIRED", 110),
        weaknesses: cleanExecutiveText(weaknesses || extractKeywordInsight(line, ["weakness", "gap"]) || "VALIDATION REQUIRED", 110),
        threat: cleanExecutiveText(threat || extractKeywordInsight(line, ["threat", "risk"]) || "VALIDATION REQUIRED", 90),
      });
    }
  });

  return rows.slice(0, 5);
}

function extractRoadmapAction(content: string, step: string) {
  const aliases = roadmapStepAliases[step] || [step];
  const allAliases = Object.values(roadmapStepAliases).flat();
  const snippet =
    extractAliasedSectionSnippet(content, aliases, allAliases) ||
    aliases.map((alias) => extractKeywordInsight(content, [alias])).find(Boolean) ||
    "";
  const action = extractMeaningfulBullets(snippet, 1)[0] || cleanExecutiveText(snippet, 150);

  return action || "VALIDATION REQUIRED";
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

function dedupePdfFinancialMetricValue(value: string) {
  const compactValue = compactPdfMetricValue(value);

  if (!compactValue) {
    return "";
  }

  const normalizedValue = normalizePdfText(value).replace(/\s+/g, " ").trim();
  const metricTokens = normalizedValue.match(/(?:[$€₺]\s*)?\d+(?:[.,]\d+)*(?:\.\d+)?\s*(?:[kKmMbB%]|months?|ay|gün|days?)?\s*(?:[$€₺])?/gi) || [];
  const normalizedTokens = metricTokens.map((token) => compactPdfMetricValue(token)).filter(Boolean);
  const uniqueTokens = new Set(normalizedTokens.map((token) => token.toLowerCase()));

  if (normalizedTokens.length > 1 && uniqueTokens.size === 1) {
    return normalizedTokens[0];
  }

  return compactValue;
}

type FinancialMetricConfidenceBadge =
  | "Verified"
  | "Model Estimate"
  | "Planning Assumption"
  | "Validation Required";

function getFinancialMetricConfidenceBadge(
  label: string,
  aliases: string[] | readonly string[],
  content: string,
  value: string
): FinancialMetricConfidenceBadge {
  const metricContext = normalizePdfText(
    `${label}\n${value}\n${extractMetricDetail(content, aliases)}`
  );

  if (!value || /\b(no data|not available|validation required|needs validation|validate|low confidence)\b/i.test(metricContext)) {
    return "Validation Required";
  }

  if (/\b(verified|actual|audited|invoice|bookkeeping|accounting|bank|stripe)\b/i.test(metricContext)) {
    return "Verified";
  }

  if (/\b(cac|customer acquisition cost|ltv|lifetime value|payback)\b/i.test(metricContext)) {
    return "Validation Required";
  }

  if (/\b(burn|runway|break[\s-]?even|investment needed|planning input|assumption|manual input|founder input|target|threshold|warning)\b/i.test(metricContext)) {
    return "Planning Assumption";
  }

  return "Model Estimate";
}

function getPdfFinancialMetricConfidenceBadge(badge: FinancialMetricConfidenceBadge) {
  return badge;
}

function getFinancialMetricConfidenceBadgeClass(badge: FinancialMetricConfidenceBadge) {
  if (badge === "Model Estimate") {
    return "bg-teal-200 text-black";
  }

  if (badge === "Validation Required") {
    return "bg-amber-300/15 text-amber-200";
  }

  if (badge === "Planning Assumption") {
    return "bg-sky-300/10 text-sky-200";
  }

  return "bg-white/10 text-zinc-300";
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
  const financialContent = normalizePdfFinancialSectionContent(content, { title });

  if (!financialContent) {
    return "";
  }

  const normalizedTitle = title.toLowerCase();

  if (isTamSamSomTitle(title)) {
    return "";
  }

  if (normalizedTitle.includes("swot")) {
    return "";
  }

  return removeDuplicatePdfExecutiveInsightText(
    normalizePdfTamSamSomOwnershipContent(financialContent, { title })
  );
}

function isTamSamSomTitle(title: string) {
  return /\btam\b[\s/|,·-]*\bsam\b[\s/|,·-]*\bsom\b/i.test(title);
}

function removeDuplicatePdfExecutiveInsightText(content: string) {
  const seenLines = new Set<string>();
  const seenSentences = new Set<string>();

  return normalizePdfText(content)
    .replace(
      /(^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:AI\s+)?Executive Insight(?:\*\*)?\s*[:\-–—]\s*/gi,
      "$1"
    )
    .replace(
      /\b([A-Z][A-Za-z /-]{1,40}\s*[:\-–—]\s*)((?:[€$₺]?\d+(?:[.,]\d+)*\s*[kKmMbBtT%]?)(?:\s+(?:months?|days?|ay|gün))?)\s+\2\b/gi,
      "$1$2"
    )
    .replace(/\b([A-Za-zÇĞİÖŞÜçğıöşü]{3,})\s+\1\b/gi, "$1")
    .split("\n")
    .filter((line) => {
      const key = line.replace(/^[-*•]\s*/, "").toLowerCase().replace(/\s+/g, " ").trim();
      const sentenceKey = key.replace(/[.!?]+$/g, "");

      if (sentenceKey.length >= 32 && seenSentences.has(sentenceKey)) {
        return false;
      }

      if (key.length < 24 || !seenLines.has(key)) {
        if (key.length >= 24) {
          seenLines.add(key);
        }
        if (sentenceKey.length >= 32) {
          seenSentences.add(sentenceKey);
        }
        return true;
      }

      return false;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function isSourceLikeSection(section: { field?: string; title: string }) {
  return (
    section.field === "sources" ||
    section.field === "sourcesAssumptions" ||
    /^(sources(?:\s+continued)?|references|kaynaklar|sources \/ assumptions|kaynaklar \/ varsayımlar)$/i.test(
      section.title.trim()
    )
  );
}

function formatPdfCitationContent(content: string) {
  const sourceContent = normalizePdfSourceContent(
    normalizePdfFinancialSectionContent(content, {
      field: "sourcesAssumptions",
      title: "Sources / Assumptions",
    })
  );
  const citations = parseCitations(sourceContent);
  const methodologyBlock = [
    "Methodology & Assumptions",
    "Market sizing, financial projections and KPI estimates are based on available market signals, benchmark data and planning assumptions.",
  ].join("\n");

  if (citations.length === 0) {
    return methodologyBlock;
  }

  const finalDedupeSources = getFinalDedupePdfSources(citations);
  const sourceLines = finalDedupeSources
    .slice(0, 8)
    .map((source) =>
      [
        `• ${source.sourceName}`,
        `  Source type: ${source.sourceType}`,
        `  ${source.trustLabel}`,
      ].join("\n")
    )
    .join("\n");

  return `${sourceLines}\n\n${methodologyBlock}`;
}

function formatPdfReadableContent(section: ReportSection) {
  if (isSourceLikeSection(section)) {
    return formatPdfCitationContent(section.content);
  }

  if (section.field === "tamSamSom" || isTamSamSomTitle(section.title)) {
    return normalizePdfTamSamSomBodyContent(section.content);
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

function getPdfSectionDedupeKey(section: { field?: string; title: string; content: string }) {
  const fieldKey = section.field?.trim().toLowerCase();

  if (fieldKey) {
    return fieldKey;
  }

  const titleKey = normalizePdfText(section.title).toLowerCase().replace(/\s+/g, " ").trim();

  if (isTamSamSomTitle(section.title)) {
    return "tam-sam-som";
  }

  return titleKey || normalizePdfText(section.content).toLowerCase().slice(0, 180);
}

function isLegacyTamSamSomSection(section: { field?: string; title: string; content: string }) {
  const fieldKey = section.field?.trim().toLowerCase();

  if (fieldKey === "tamsamsom" || isTamSamSomTitle(section.title)) {
    return false;
  }

  const title = normalizePdfText(section.title).toLowerCase();
  const content = normalizePdfText(section.content);
  const explicitMetricLines = content
    .split("\n")
    .filter((line) => /^(?:[-*•]\s*)?(?:tam|sam|som)\s*[:\-–—]/i.test(line.trim())).length;

  return (
    /\bmarket\s+sizing\b|\bmarket\s+size\b|\btam\s*\/\s*sam\s*\/\s*som\b/i.test(title) ||
    explicitMetricLines >= 2
  );
}

function isTamSamSomDuplicateFragment(section: { field?: string; title: string; content: string }) {
  const fieldKey = section.field?.trim().toLowerCase();

  if (fieldKey === "tamsamsom" || isTamSamSomTitle(section.title)) {
    return false;
  }

  const title = normalizePdfText(section.title).toLowerCase().replace(/\s+/g, " ").trim();
  const content = normalizePdfText(section.content);
  const titleIsMetricFragment = /^(tam|sam|som)(?:\s+(?:analysis|overview|market|section))?$/i.test(title);
  const hasMetricLine = content
    .split("\n")
    .some((line) => /^(?:[-*•]\s*)?(?:tam|sam|som)\s*[:\-–—]/i.test(line.trim()));
  const isMarketSizingInsight =
    /\b(?:ai\s+)?executive insight\b/i.test(content) &&
    /\b(?:tam|sam|som|market sizing|market size)\b/i.test(`${title}\n${content}`);

  return titleIsMetricFragment || (hasMetricLine && isMarketSizingInsight);
}

function dedupePdfSections<T extends { field?: string; title: string; content: string }>(sections: T[]) {
  const seen = new Set<string>();
  const seenContent = new Set<string>();
  const hasCanonicalTamSamSom = sections.some(
    (section) => section.field?.trim().toLowerCase() === "tamsamsom"
  );
  let hasTamSamSom = false;

  return sections.filter((section) => {
    const fieldKey = section.field?.trim().toLowerCase();
    const isCanonicalTamSamSom = fieldKey === "tamsamsom";
    const isTamSamSomSection = isCanonicalTamSamSom || isTamSamSomTitle(section.title);

    if (hasCanonicalTamSamSom && isTamSamSomSection && !isCanonicalTamSamSom) {
      return false;
    }

    if (isTamSamSomSection) {
      if (hasTamSamSom) {
        return false;
      }

      hasTamSamSom = true;
    }

    if (hasTamSamSom && isTamSamSomDuplicateFragment(section)) {
      return false;
    }

    if (isLegacyTamSamSomSection(section)) {
      return false;
    }

    const key = getPdfSectionDedupeKey(section);
    const normalizedContent = normalizePdfTamSamSomOwnershipContent(section.content, section);
    const contentKey = removeDuplicatePdfExecutiveInsightText(normalizedContent)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .slice(0, 360);

    if (!key || seen.has(key) || (contentKey && seenContent.has(contentKey))) {
      return false;
    }

    seen.add(key);
    if (contentKey) {
      seenContent.add(contentKey);
    }
    return true;
  }).map((section) => {
    const fieldKey = section.field?.trim().toLowerCase();

    if (fieldKey === "tamsamsom" || isTamSamSomTitle(section.title)) {
      return {
        ...section,
        field: "tamSamSom",
        title: "TAM / SAM / SOM",
        content: normalizePdfCanonicalTamSamSomContent(section.content),
      };
    }

    return section;
  });
}

function mergePdfSourceSections<T extends { field?: string; title: string; content: string }>(sections: T[]) {
  const sourceSections = sections.filter((section) => isSourceLikeSection(section));
  const nonSourceSections = sections.filter(
    (section) => !sourceSections.includes(section)
  );
  const mergedSourceContent = sourceSections
    .map((section) => section.content.trim())
    .filter(Boolean)
    .join("\n");
  const normalizedSourceContent = normalizePdfSourceContent(mergedSourceContent);

  if (!normalizedSourceContent) {
    return nonSourceSections;
  }

  return [
    ...nonSourceSections,
    {
      ...sourceSections[0],
      field: "sources",
      title: "Sources",
      content: removeDuplicatePdfExecutiveInsightText(normalizedSourceContent),
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
    const rows = getReportMarketRows(section.content);

    return (
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(94,234,212,0.12),transparent_30%),rgba(255,255,255,0.025)] p-5">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
              Market Sizing Stack
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              TAM, SAM and SOM separated into decision-ready opportunity layers.
            </p>
          </div>
          <div className="hidden h-16 w-16 rounded-full border border-teal-200/20 bg-teal-200/10 sm:block" />
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {rows.map((row, index) => (
            <div key={row.label} className="min-h-44 rounded-3xl border border-white/10 bg-black/35 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                    {row.label}
                  </p>
                  <p className="mt-1 text-sm font-medium text-zinc-300">{row.name}</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  Layer {index + 1}
                </span>
              </div>
              <p className="mt-5 truncate whitespace-nowrap text-3xl font-semibold tracking-tight text-white">
                {row.value}
              </p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${row.tone}`}
                  style={{ width: `${[100, 68, 36][index]}%` }}
                />
              </div>
            </div>
          ))}
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
          {flow.map((metric) => {
            const value = formatMetricCardValue(extractMetricValue(section.content, metric));
            const confidenceBadge = getFinancialMetricConfidenceBadge(
              metric,
              [metric],
              section.content,
              value
            );

            return (
              <div key={metric} className="bg-zinc-950/80 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{metric}</p>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold ${getFinancialMetricConfidenceBadgeClass(confidenceBadge)}`}>
                    {confidenceBadge}
                  </span>
                </div>
                <p className="mt-3 truncate whitespace-nowrap text-lg font-semibold text-white">
                  {value || "—"}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (field === "competitorAnalysis" || field === "competitorLandscape") {
    const competitors = extractCompetitorRows(section.content);

    return (
      <div className="mb-5 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.025]">
        <div className="border-b border-white/10 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Competitive Intelligence Table
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            Positioning, strengths, weaknesses and threat level from the generated analysis.
          </p>
        </div>
        {competitors.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[1fr_1.35fr_1.15fr_1.15fr_0.9fr] gap-px bg-white/10 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                {["Company", "Positioning", "Strengths", "Weaknesses", "Threat"].map((label) => (
                  <div key={label} className="bg-zinc-950/80 px-4 py-3">
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid gap-px bg-white/10">
                {competitors.map((row, index) => (
                  <div
                    key={`${row.company}-${index}`}
                    className="grid grid-cols-[1fr_1.35fr_1.15fr_1.15fr_0.9fr] bg-black/35 text-sm leading-6 text-zinc-300"
                  >
                    <div className="px-4 py-4 font-semibold text-white">{row.company}</div>
                    <div className="px-4 py-4">{row.positioning || "VALIDATION REQUIRED"}</div>
                    <div className="px-4 py-4">{row.strengths}</div>
                    <div className="px-4 py-4">{row.weaknesses}</div>
                    <div className="px-4 py-4">
                      <span className="rounded-full border border-teal-200/20 bg-teal-200/10 px-2.5 py-1 text-xs font-semibold text-teal-100">
                        {row.threat}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-36 items-center justify-center p-6 text-center">
            <p className="max-w-md text-sm leading-6 text-zinc-400">
              VALIDATION REQUIRED: competitor records were not structured enough to render a comparison table.
            </p>
          </div>
        )}
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
            const confidenceBadge = getFinancialMetricConfidenceBadge(
              metric.label,
              metric.aliases,
              section.content,
              value
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
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${getFinancialMetricConfidenceBadgeClass(confidenceBadge)}`}>
                    {confidenceBadge}
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
              {(extractMeaningfulBullets(
                extractAliasedSectionSnippet(section.content, ["Next Action", "Next Critical Action", "Immediate Actions"], ["Main Risk", "Confidence", "Investment Needed"]) ||
                  extractKeywordInsight(section.content, ["next action", "critical action", "validate"]),
                4
              ).length > 0
                ? extractMeaningfulBullets(
                    extractAliasedSectionSnippet(section.content, ["Next Action", "Next Critical Action", "Immediate Actions"], ["Main Risk", "Confidence", "Investment Needed"]) ||
                      extractKeywordInsight(section.content, ["next action", "critical action", "validate"]),
                    4
                  )
                : ["VALIDATION REQUIRED"]
              ).map((action) => (
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
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Founder Action Timeline
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            Time-bound priorities converted into an execution-ready roadmap.
          </p>
        </div>
        <div className="relative grid min-w-[960px] grid-cols-6 gap-4">
        <div className="absolute left-8 right-8 top-8 h-px bg-gradient-to-r from-teal-200/10 via-teal-200/50 to-teal-200/10" />
        {founderRoadmapSteps.map((step, index) => (
          <div key={step} className="relative min-h-48 rounded-[1.4rem] border border-white/10 bg-black/45 p-4">
            <div className="flex flex-col gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-200 text-xs font-bold text-black">
                {index + 1}
              </span>
              <p className="text-sm font-semibold text-white">{step}</p>
              <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                {index < 2 ? "Priority" : index < 4 ? "Build" : "Scale"}
              </span>
              <p className="line-clamp-5 text-xs leading-5 text-zinc-400">
                {extractRoadmapAction(section.content, step)}
              </p>
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
    const kpiMetrics = ["Acquisition", "Activation", "Retention", "Revenue", "CAC", "WTP", "Sales cycle", "Conversion"];

    return (
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {kpiMetrics.map((metric) => {
          const value = extractMetricValue(section.content, metric);
          const confidenceBadge = getFinancialMetricConfidenceBadge(
            metric,
            [metric],
            section.content,
            value
          );

          return (
            <div key={metric} className="grid grid-cols-[4.25rem_1fr] gap-4 rounded-3xl border border-white/10 bg-white/[0.035] p-4">
              <MiniProgressCircle label="" value={extractPercentScore(section.content, metric)} />
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">{metric}</p>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold ${getFinancialMetricConfidenceBadgeClass(confidenceBadge)}`}>
                    {confidenceBadge}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-xl font-semibold text-white">
                  {value || "Target"}
                </p>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-teal-200/80"
                    style={{ width: `${extractPercentScore(section.content, metric) ?? 0}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-zinc-500">Analytics widget</p>
              </div>
            </div>
          );
        })}
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
  const displayConversations = sortedConversations.filter((conversation) => {
    const title = getAnalysisSessionTitle(conversation.title).trim().toLowerCase();
    const preview = getConversationPreview(conversation).trim().toLowerCase();
    const combined = `${title} ${preview}`;

    return !(
      /^(merhaba|test|testing|deneme|dev|development|demo|sample|dummy|placeholder|asdf|hello)$/.test(title) ||
      /\b(local\s+test|development\s+test|test\s+conversation|demo\s+conversation|sample\s+conversation|dummy\s+conversation|placeholder\s+conversation)\b/.test(combined) ||
      /\b(bana\s+para\s+kazand[ıi]racak\s+i[sş]\s+s[öo]yle|para\s+kazand[ıi]racak\s+y[öo]ntemler\s+neler)\b/.test(combined)
    );
  });
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleConversations = normalizedSearchQuery
    ? displayConversations.filter((conversation) =>
        getAnalysisSessionTitle(conversation.title).toLowerCase().includes(normalizedSearchQuery)
      )
    : displayConversations;

  function startRename(conversation: Conversation) {
    setRenameTarget(conversation);
    setRenameDraft(getAnalysisSessionTitle(conversation.title));
    setRenameError("");
  }

  function submitRename() {
    if (!renameTarget) {
      return;
    }

    const cleanTitle = renameDraft.trim();

    if (!cleanTitle) {
      setRenameError("Analysis session name cannot be empty.");
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

  const reportCount = displayConversations.reduce(
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
            Rename analysis session
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
            Update analysis title
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Use a clear title so this analysis is easy to find later.
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
            placeholder="Analysis session title"
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
            Delete analysis session
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
            {getAnalysisSessionTitle(deleteTarget.title)}
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            This will permanently delete the analysis session and its saved report context.
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
          <Link
            href="/dashboard"
            aria-label="Go to dashboard home"
            className="flex items-center gap-3 rounded-2xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10 shadow-lg shadow-teal-950/20">
              <Sparkles className="h-5 w-5 text-teal-200" />
            </span>
            <div>
              <p className="text-lg font-semibold tracking-[0.28em] text-white">
                ZERINIX
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">Founder workspace</p>
            </div>
          </Link>
          <div className="mt-5 hidden grid-cols-2 gap-2 md:grid">
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              <p className="text-lg font-semibold text-white">{conversations.length}</p>
              <p className="mt-1 text-[11px] text-zinc-500">Analysis sessions</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              <p className="text-lg font-semibold text-white">{reportCount}</p>
              <p className="mt-1 text-[11px] text-zinc-500">Saved outputs</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onCreateConversation()}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10 text-teal-100 shadow-lg shadow-teal-950/10 transition hover:-translate-y-0.5 hover:border-teal-200/40 hover:bg-teal-200/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30 md:mt-5 md:w-full md:gap-2 md:px-4 md:text-sm md:font-semibold"
          aria-label="New analysis session"
          title="New analysis session"
        >
          <Plus className="h-4 w-4 text-teal-200" />
          <span className="hidden md:inline">New analysis session</span>
        </button>
      </div>

      <nav className="mt-5 hidden space-y-2 rounded-3xl border border-white/10 bg-white/[0.025] p-2 md:block">
        <Link
          href="/plan?new=1&mode=plan"
          className="flex items-center justify-between rounded-2xl bg-white/[0.06] px-3 py-2.5 text-sm font-medium text-white"
        >
          <span className="inline-flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-teal-200" />
            Analysis Workspace
          </span>
          <span className="rounded-full border border-teal-200/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-teal-100">
            {activeMode === "plan" ? "Plan" : activeMode === "market" ? "Market" : "Advisor"}
          </span>
        </Link>
        <Link
          href="/dashboard#reports"
          className="flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-medium text-zinc-400 transition hover:bg-white/[0.05] hover:text-white"
        >
          <LayoutDashboard className="h-4 w-4 text-zinc-500" />
          Reports
        </Link>
        <Link
          href="/dashboard#workspaces"
          className="flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-medium text-zinc-400 transition hover:bg-white/[0.05] hover:text-white"
        >
          <FolderKanban className="h-4 w-4 text-zinc-500" />
          Workspaces
        </Link>
      </nav>

      <div className="mt-4 hidden items-center justify-between px-1 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-600 md:flex">
        <span>Analysis History</span>
        <span>{visibleConversations.length}</span>
      </div>

      <label className="mt-3 hidden items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-500 md:flex">
        <Search className="h-4 w-4 text-teal-200" />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search analysis history..."
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
        />
      </label>

      <div className="flex flex-1 gap-3 overflow-x-auto pl-3 md:mt-3 md:block md:space-y-3 md:overflow-y-auto md:pl-0">
        {sortedConversations.length === 0 ? (
          <div className="min-w-64 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-zinc-500">
            <p className="font-semibold text-white">No analysis sessions yet</p>
            <p className="mt-2">
              Generate a report or start an advisor session to build your decision history.
            </p>
          </div>
        ) : visibleConversations.length === 0 ? (
          <div className="min-w-64 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-zinc-500">
            <p className="font-semibold text-white">No analysis sessions found</p>
            <p className="mt-2">
              Try another title or clear the search field.
            </p>
          </div>
        ) : null}

        {visibleConversations.map((conversation) => (
          <div
            key={conversation.id}
            className={`group min-w-72 rounded-2xl border p-3 text-left text-sm shadow-lg shadow-black/10 transition duration-300 md:w-full ${
              conversation.id === activeConversationId
                ? "border-teal-300/30 bg-teal-300/10 shadow-lg shadow-teal-950/10"
                : "border-white/10 bg-white/[0.03] hover:-translate-y-0.5 hover:border-teal-300/30 hover:bg-white/[0.055]"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectConversation(conversation.id)}
              className="block w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
            >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 font-medium leading-5 text-white">
                  {getAnalysisSessionTitle(conversation.title)}
                </p>
                <p className="mt-1 line-clamp-1 text-xs leading-5 text-zinc-500">
                  {getConversationPreview(conversation)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-100 md:opacity-0 md:transition md:group-hover:opacity-100">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-black/30">
                  <MoreHorizontal className="h-3.5 w-3.5 text-zinc-400" />
                </span>
              </div>
            </div>
            </button>

            <div className="mt-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-zinc-400">
                <MessageSquare className="h-3 w-3 text-teal-200" />
                {conversation.messages.length}
              </span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  startRename(conversation);
                }}
                className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-zinc-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setDeleteTarget(conversation);
                }}
                className="rounded-full border border-red-300/10 bg-red-300/5 px-2 py-1 text-[11px] text-red-200 transition hover:bg-red-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200/30"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 hidden rounded-3xl border border-white/10 bg-white/[0.03] p-3 md:block">
        <Link
          href="/dashboard/settings"
          prefetch={false}
          aria-label="Open account settings"
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
      return dedupeReportSections(
        reportFields.map(({ field, title, icon }) => ({
          field,
          title,
          icon,
          content:
            sanitizeReportFieldContent(field, reportData[field] || "") ||
            waitingMessage,
        }))
      );
    }

    return dedupeReportSections(
      result
        ? [
            {
              field: "executiveSummary",
              title: "Executive Summary",
              icon: Sparkles,
              content: sanitizeReportContent(result),
            },
          ]
        : []
    );
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
      const basePdfSections = dedupePdfSections(mergePdfSourceSections(sections));
      const pdfLocale = detectPdfPresentationLocale(
        [reportTitle, sourcePrompt, ...basePdfSections.map((section) => `${section.title}\n${section.content}`)]
          .filter(Boolean)
          .join("\n\n")
      );
      const pdfSections = localizePdfReportSections(basePdfSections, pdfLocale);
      const localizedReportTitle = localizePdfPresentationLabel(reportTitle, pdfLocale);
      const fullReportContent = basePdfSections
        .map((section) => `${section.title}\n${section.content}`)
        .join("\n\n");
      const businessIdea = deriveBusinessDescriptionFromSections(
        pdfSections,
        localizedReportTitle,
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

      const drawFooter = (includePageCounter = false) => {
        const currentPage = pdf.getCurrentPageInfo().pageNumber;

        pdf.setFillColor("#000000");
        pdf.rect(0, pageHeight - 13, pageWidth, 13, "F");
        pdf.setDrawColor("#27272a");
        pdf.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10);

        if (!includePageCounter) {
          return;
        }

        pdf.setFontSize(7);
        pdf.setTextColor("#71717a");
        pdf.text(
          pdfLocale === "tr"
            ? `Sayfa ${currentPage} / ${pdf.getNumberOfPages()}`
            : `Page ${currentPage} / ${pdf.getNumberOfPages()}`,
          pageWidth - margin - 22,
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
            const isSourceMetaLine = /^(?:Domain|Publisher|Year|Confidence|Type|URL)\s*:/i.test(line);
            const availableWidth = isBullet || isSourceMetaLine ? width - 4 : width;
            const wrapped = pdf.splitTextToSize(line, availableWidth) as string[];

            return wrapped.map((wrappedLine, index) => {
              if (isSourceMetaLine) {
                return `${index > 0 ? "    " : "  "}${wrappedLine}`;
              }

              return isBullet && index > 0 ? `  ${wrappedLine}` : wrappedLine;
            });
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
        pdf.text(localizePdfPresentationLabel("ZERINIX REPORT", pdfLocale), margin + 31, 41);

        pdf.setFontSize(32);
        pdf.setTextColor("#ffffff");
        pdf.text(localizedReportTitle, margin + 12, 60, { maxWidth: contentWidth - 24 });

        pdf.setFontSize(11);
        pdf.setTextColor("#a1a1aa");
        pdf.text(localizePdfPresentationText("Premium AI business intelligence report for founder and investor decisions.", pdfLocale), margin + 12, 78, {
          maxWidth: contentWidth - 24,
        });

        drawTag(localizePdfPresentationLabel("AI Ready", pdfLocale), margin + 12, 94, 28);
        drawTag(localizePdfPresentationLabel("Investor Ready", pdfLocale), margin + 44, 94, 38);

        const coverMeta = [
          [localizePdfPresentationLabel("Report Type", pdfLocale), localizedReportTitle],
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
      pdf.text(localizePdfPresentationLabel("ZERINIX REPORT", pdfLocale), margin + 14, y);

      pdf.setFontSize(24);
      pdf.setTextColor("#ffffff");
      pdf.text(localizedReportTitle, margin, y + 11);

      pdf.setFillColor("#042f2e");
      pdf.setDrawColor("#115e59");
      pdf.roundedRect(pageWidth - margin - 32, y + 1, 32, 10, 5, 5, "FD");
      pdf.setFont("Geist", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor("#ccfbf1");
      pdf.text(localizePdfPresentationLabel("AI Ready", pdfLocale), pageWidth - margin - 25, y + 7.3);

      y += 26;

      const summaryCards = [
        `${pdfSections.filter((section) => !isSourceSection(section)).length} Sections`,
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
          const value = extractMarketSizeValue(content, label);
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
	          const bullets = extractSwotBullets(content, label, fullReportContent)
	            .filter((bullet) => !/\b(?:no data|not available|validation required)\b/i.test(bullet))
	            .slice(0, 3);
	          const fallbackBullets = bullets.length > 0 ? bullets : ["No validated insight available"];
          const bulletLines = fallbackBullets
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
        const metricContent = content;
        const labels = getFinancialDashboardMetrics(metricContent);
        const columns = 3;
        const itemWidth = (width - (columns - 1) * 3) / columns;
        const itemHeight = 18;
        const items = labels
          .map((item) => {
            const value = formatMetricCardValue(extractMetricValueFromAliases(metricContent, item.aliases));
            const compactValue = dedupePdfFinancialMetricValue(value);
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
          return 51;
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

          rows.forEach(({ label, color, value }, index) => {
            const rowHeight = 15;

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

            rowY += rowHeight + 3;
          });
          return 51;
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
            const score = extractScore(section.content, label);

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, itemY, itemWidth, 12, 2.5, 2.5, "FD");
            pdf.setDrawColor("#5eead4");
            pdf.circle(x + 7, itemY + 6, 4.2, "S");
            pdf.setFontSize(6);
            pdf.setTextColor("#ccfbf1");
            pdf.text(score === null ? "—" : String(score), x + 4.2, itemY + 7.8);
            pdf.setFontSize(6.5);
            pdf.setTextColor("#e4e4e7");
            pdf.text(label, x + 14, itemY + 5, { maxWidth: itemWidth - 17 });
            pdf.setTextColor("#71717a");
            pdf.text(localizePdfPresentationLabel("Score", pdfLocale), x + 14, itemY + 8.8);
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
          pdf.text(localizePdfPresentationLabel("RECOMMENDATION", pdfLocale), bodyX + 5, visualY + 6);
          pdf.setFontSize(13);
          pdf.setTextColor("#000000");
          drawSingleLine(decisionLabel, bodyX + 5, visualY + 16, 42, 11, 6.5);

          pdf.setFillColor("#27272a");
          pdf.roundedRect(bodyX, visualY + 31, 52, 4, 2, 2, "F");
          pdf.setFillColor("#5eead4");
          pdf.roundedRect(
            bodyX,
            visualY + 31,
            (52 * (confidence ?? 0)) / 100,
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
                  ? ["Acquisition", "Activation", "Retention", "Revenue", "CAC", "WTP", "Sales cycle", "Conversion"]
                  : section.field === "risks"
                    ? ["Market", "Product", "Pricing", "Execution"]
                    : section.field === "unitEconomics"
                      ? ["ARPA", "CAC", "LTV", "Payback", "Gross Margin"]
                      : ["Rivalry", "Entrants", "Buyer", "Substitutes"];
        const isFinancialDashboard = section.field === "financialDashboard";
        const isKpiDashboard = section.field === "kpiDashboard" || section.field === "kpis";
        const isScenario = section.field === "scenarioAnalysis";
        const isUnitEconomics = section.field === "unitEconomics";
        const metricContent = isFinancialDashboard ? section.content : `${section.content}\n${fullReportContent}`;
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
          const score = extractScore(metricContent, label);
          const value = typeof item !== "string" && "value" in item
            ? item.value
            : formatMetricCardValue(extractMetricValueFromAliases(metricContent, aliases));
          const compactValue = isFinancialDashboard
            ? dedupePdfFinancialMetricValue(value)
            : compactPdfMetricValue(value);
          const confidenceBadge = isFinancialDashboard || isUnitEconomics || isKpiDashboard
            ? getFinancialMetricConfidenceBadge(label, aliases, metricContent, value)
            : null;
          const pdfConfidenceBadge = confidenceBadge
            ? getPdfFinancialMetricConfidenceBadge(confidenceBadge)
            : null;

          pdf.setFillColor("#18181b");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(x, itemY, itemWidth, itemHeight, 2.5, 2.5, "FD");
          pdf.setFontSize(6.2);
          pdf.setTextColor("#a1a1aa");
          pdf.text(label, x + 2, itemY + 3.2, { maxWidth: itemWidth - 4 });
          if (isFinancialDashboard && value) {
            pdf.setTextColor("#f4f4f5");
            drawSingleLine(compactValue || "—", x + 2, itemY + 11.7, itemWidth - 4, 8.8, 4.2, false);
            pdf.setFontSize(4.8);
            pdf.setTextColor("#5eead4");
            drawSingleLine(pdfConfidenceBadge || "Validation Required", x + itemWidth - 32, itemY + 16, 30, 4.8, 3.8);
            return;
          }
          if (isUnitEconomics) {
            drawSingleLine(compactValue || "—", x + 2, itemY + 8.8, itemWidth - 4, 7.2, 4.2, false);
            pdf.setFontSize(3.7);
            pdf.setTextColor("#5eead4");
            drawSingleLine(pdfConfidenceBadge || "Validation Required", x + 2, itemY + 12.2, itemWidth - 4, 3.8, 3.2);
            return;
          }
          if (isKpiDashboard) {
            const kpiValue = extractKpiValue(section.content, label) || (score === null ? "—" : `${score}%`);
            const target = extractKpiTarget(section.content, label);
            const status = extractKpiStatus(section.content, label);
            pdf.setTextColor("#f4f4f5");
            drawSingleLine(kpiValue, x + 2, itemY + 8.4, itemWidth - 4, 7.5, 4.2, false);
            pdf.setFontSize(5.3);
            pdf.setTextColor("#a1a1aa");
            pdf.text(`Target: ${target || kpiValue || "—"}`, x + 2, itemY + 12.1, { maxWidth: itemWidth - 4 });
            pdf.text(`Status: ${status}`, x + 2, itemY + 15.2, { maxWidth: itemWidth - 4 });
            pdf.setFontSize(4);
            pdf.setTextColor("#5eead4");
            drawSingleLine(pdfConfidenceBadge || "Validation Required", x + 2, itemY + 18.1, itemWidth - 4, 4, 3.4);
            pdf.setFillColor("#27272a");
            pdf.roundedRect(x + 2, itemY + 20.1, itemWidth - 4, 1.5, 0.7, 0.7, "F");
            pdf.setFillColor("#5eead4");
            pdf.roundedRect(x + 2, itemY + 20.1, Math.max(0, ((itemWidth - 4) * (score ?? 0)) / 100), 1.5, 0.7, 0.7, "F");
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
            pdf.roundedRect(x + 2, itemY + 15, Math.max(3, ((itemWidth - 4) * ([42, 66, 84][index] ?? score ?? 0)) / 100), 1.4, 0.7, 0.7, "F");
            return;
          }
          pdf.setFillColor("#27272a");
          pdf.roundedRect(x + 2, itemY + 7, itemWidth - 4, 1.4, 0.7, 0.7, "F");
          pdf.setFillColor("#5eead4");
          pdf.roundedRect(
            x + 2,
            itemY + 7,
            Math.max(0, ((itemWidth - 4) * (score ?? 0)) / 100),
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
            pdf.text(localizePdfPresentationLabel("METRIC DETAILS", pdfLocale), bodyX + 3, detailsY);
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
        pdf.text(localizePdfPresentationLabel("ZERINIX REPORT", pdfLocale), margin + 17, 33);
        pdf.setFontSize(26);
        pdf.setTextColor("#ffffff");
        pdf.text(localizePdfPresentationLabel("Table of Contents", pdfLocale), margin, 54);
        pdf.setFontSize(8.5);
        pdf.setTextColor("#a1a1aa");
        pdf.text(localizePdfPresentationText("Click a section title to jump directly to that page.", pdfLocale), margin, 64);

        const tocColumnGap = 5;
        const tocColumnCount = 2;
        const tocColumnWidth = (contentWidth - tocColumnGap) / tocColumnCount;
        const tocRowHeight = 10;
        const tocMaxRows = Math.floor((pageHeight - 108) / tocRowHeight);

        tocEntries.forEach((entry, index) => {
          const columnIndex = Math.floor(index / tocMaxRows);

          if (columnIndex >= tocColumnCount) {
            return;
          }

          const rowIndex = index % tocMaxRows;
          const tocX = margin + columnIndex * (tocColumnWidth + tocColumnGap);
          const tocY = 82 + rowIndex * tocRowHeight;

          pdf.setFillColor(index % 2 === 0 ? "#09090b" : "#050505");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(tocX, tocY - 5.5, tocColumnWidth, 8.5, 2.5, 2.5, "FD");
          pdf.setFontSize(7.2);
          pdf.setTextColor("#f4f4f5");
          pdf.textWithLink(normalizePdfText(entry.title), tocX + 3, tocY + 0.8, {
            pageNumber: entry.page,
            maxWidth: tocColumnWidth - 14,
          });
          pdf.setTextColor("#5eead4");
          pdf.text(String(entry.page), tocX + tocColumnWidth - 8, tocY + 0.8);
        });

        drawFooter();
      };

      pdfSections.forEach((section) => {
        if (section.content === waitingMessage) {
          return;
        }

        const visualHeight = getPdfVisualHeight(section);
        const sectionBodyContent = section.field === "tamSamSom" ? "" : formatPdfReadableContent(section);

	        if (isSourceLikeSection(section) && !sectionBodyContent.trim()) {
	          return;
	        }

	        if (visualHeight <= 0 && !sectionBodyContent.trim()) {
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
          const sectionTitle = isContinued && isSourceLikeSection(section)
            ? ""
            : `${section.title}${isContinued ? pdfLocale === "tr" ? " devamı" : " continued" : ""}`;

          if (sectionTitle) {
            pdf.text(sectionTitle, bodyX, y + 12.5, {
              maxWidth: bodyWidth,
            });
          }

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
        drawFooter(true);
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
            Enter business context to generate a structured ZERINIX report.
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
          const hasVisibleDetailsContent = detailsContent.replace(/[#*_`>\-[\]\s()]/g, "").trim().length > 0;

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
                    {section.field === "executiveSummary" ? (
                      <ExecutiveSummaryVisual section={section} />
                    ) : null}
                    {hasPremiumSectionVisual(section) &&
                    section.field !== "executiveSummary" &&
                    section.field !== "financialDashboard" &&
                    section.field !== "tamSamSom" ? (
                      <ExecutiveInsightBanner section={section} />
                    ) : null}
                    <PremiumSectionVisual section={section} />
                    {hasVisibleDetailsContent && section.field !== "tamSamSom" ? (
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
  initialMode,
  initialWorkspaces = [],
  initialWorkspaceId = "",
  initialReport = null,
  regenerationContext = null,
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
  const initialExecutiveBrief: ExecutiveBriefFields = {
    ...emptyExecutiveBrief,
    additionalContext: regenerationContext?.prompt || "",
  };
  const [prompt, setPrompt] = useState(() => buildExecutiveBriefPrompt(initialExecutiveBrief));
  const [chatPrompt, setChatPrompt] = useState("");
  const [executiveBrief, setExecutiveBrief] = useState<ExecutiveBriefFields>(initialExecutiveBrief);
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
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
    () => regenerationContext?.reportId || initialReport?.id || getStoredActiveReportId()
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
  const [activeMode, setActiveMode] = useState<ChatMode>(
    (regenerationContext
      ? regenerationContext.reportType === "Market Analysis"
        ? "market"
        : "plan"
      : restoredReportMode) ||
      initialMode ||
      "chat"
  );
  const [mobileWizardActive, setMobileWizardActive] = useState(
    Boolean(regenerationContext) || !restoredReportMode
  );
  const [mobileWizardStep, setMobileWizardStep] = useState<1 | 2 | 3>(
    regenerationContext ? 2 : 1
  );
  const [mobileBusinessIdea, setMobileBusinessIdea] = useState(
    regenerationContext?.prompt || ""
  );
  const [mobileMarket, setMobileMarket] = useState("");
  const [mobileGoal, setMobileGoal] = useState(
    regenerationContext
      ? `Regenerate the ${regenerationContext.reportType.toLowerCase()} with updated strategic analysis.`
      : ""
  );
  const [mobileConstraints, setMobileConstraints] = useState(
    regenerationContext?.reportTitle
      ? `Existing report context: ${regenerationContext.reportTitle}`
      : ""
  );
  const [chatModelPreference, setChatModelPreference] =
    useState<ChatModelPreference>("fast");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    getInitialSelectedWorkspaceId(
      initialWorkspaces,
      regenerationContext?.workspaceId || initialWorkspaceId,
      initialReport?.workspaceId
    )
  );
  const [workflowCompletedSteps, setWorkflowCompletedSteps] = useState(0);
  const [reportProgress, setReportProgress] = useState(0);
  const [currentReportSectionName, setCurrentReportSectionName] = useState("");
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [conversationError, setConversationError] = useState(conversationLoadError);
  const [userEmail, setUserEmail] = useState("");
  const [lastRequest, setLastRequest] = useState<LastRequest | null>(() =>
    getInitialLastRequest({
      regenerationContext,
      restoredReportMode,
      initialReport,
      initialMode,
      initialConversations,
    })
  );
  const [activeReportLanguage, setActiveReportLanguage] =
    useState<ResponseLanguage>("English");
  const chatScrollerRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);
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
    clearComposerPrompt();
    setResult("");
    setReportGenerationError("");
    setReportGenerationWarning("");
    setMarketReport(null);
    setPlanReport(null);
    setActiveReportId("");
    setWorkflowCompletedSteps(0);
    setReportProgress(0);
    setCurrentReportSectionName("");
    setMobileWizardActive(true);
    setMobileWizardStep(1);
    setMobileBusinessIdea("");
    setMobileMarket("");
    setMobileGoal("");
    setMobileConstraints("");
    await ensurePersistedConversation(id, conversation.title);
  }

  function renameConversation(id: string, title: string) {
    const cleanTitle = title.trim() || "Untitled analysis";

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
      setConversationError("No authenticated user was available for analysis history persistence.");
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
      setConversationError("Analysis session could not be deleted. Please try again.");
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
    clearComposerPrompt();
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

  function updateExecutiveBriefField(field: ExecutiveBriefField, value: string) {
    setExecutiveBrief((current) => {
      const next = { ...current, [field]: value };

      setPrompt(buildExecutiveBriefPrompt(next));

      return next;
    });
  }

  function setComposerPrompt(value: string, field: ExecutiveBriefField = "additionalContext") {
    setPrompt(value);
    setExecutiveBrief({ ...emptyExecutiveBrief, [field]: value });
  }

  function clearComposerPrompt() {
    setPrompt("");
    setExecutiveBrief(emptyExecutiveBrief);
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
    setComposerPrompt(message.content);
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
    const request = lastRequest?.prompt.trim() ? lastRequest : null;

    if (!request || isWorking) {
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

    setComposerPrompt(request.prompt);

    if (request.mode === "plan") {
      void generatePlan(request.prompt, false);
    } else if (request.mode === "market") {
      void analyzeMarket(request.prompt, false);
    } else {
      void sendChatMessage(request.prompt, false, previousAssistantMessage?.id);
    }
  }

  async function askForClarification(submittedPrompt: string) {
    const conversationId = activeConversationId;
    const responseLanguage = detectResponseLanguage(submittedPrompt);
    const shouldUpdateTitle = shouldAutoTitleConversation(
      activeConversation?.title || "New analysis session"
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
    clearComposerPrompt();
    setResult("");
    setMarketReport(null);
    setPlanReport(null);
    setWorkflowCompletedSteps(0);
  }

  async function submitPrompt(promptOverride?: string) {
    const submittedPrompt = (promptOverride ?? prompt).trim();

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

  async function submitChatPrompt() {
    const submittedPrompt = chatPrompt.trim();

    if (!submittedPrompt || isWorking) {
      return;
    }

    await sendChatMessage(submittedPrompt);
    setChatPrompt("");
  }

  function handleExecutiveBriefKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void (activeMode === "market" ? analyzeMarket(prompt) : generatePlan(prompt));
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

  async function attributeReportUsage(reportId: string, reportRequestId: string) {
    if (!reportId || !reportRequestId) {
      return;
    }

    try {
      await fetch("/api/reports/attribute-usage", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, reportRequestId }),
      });
    } catch (error) {
      console.error("[report usage attribution failed]", error);
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
                  "Advisor response timed out before the stream completed. Please try again."
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
      activeConversation?.title || "New analysis session"
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
        "Advisor response failed. Please try again."
      );
      const finalText = responseText || "I could not generate a response. Please try again.";

      updateAssistantMessage(assistantMessageId, finalText, "complete", conversationId);
      void updatePersistedMessage(assistantMessageId, finalText, "complete");
      clearComposerPrompt();
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      const errorMessage =
        aborted && requestTimedOut
          ? "Advisor response timed out before the server responded. Please try again."
          : getReportGenerationErrorMessage(
              error,
              aborted ? "Generation stopped." : "Advisor response failed. Please try again."
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
      activeConversation?.title || "New analysis session"
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
      await attributeReportUsage(savedReportId, reportRequestId);
      void notifyReportReady(savedReportId);
    } catch (error) {
      const errorMessage = getReportGenerationErrorMessage(error, copy.retryError);
      setReportGenerationError(errorMessage);
      setResult(errorMessage);
      setPlanReport(null);
      setReportProgress(0);
      setCurrentReportSectionName("Report failed");
      setWorkflowCompletedSteps(0);
      const failedReportId = await saveGeneratedReport({
        title: copy.planTitle,
        promptText: submittedPrompt,
        reportType: "business_plan",
        workspaceId: selectedWorkspaceId,
        status: "failed",
        sections: [],
        expectedSectionCount: outputFields.length,
      });
      await attributeReportUsage(failedReportId, reportRequestId);
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
      activeConversation?.title || "New analysis session"
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
      await attributeReportUsage(savedReportId, reportRequestId);
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
      const failedReportId = await saveGeneratedReport({
        title: copy.marketTitle,
        promptText: submittedPrompt,
        reportType: "market_analysis",
        workspaceId: selectedWorkspaceId,
        status: "failed",
        sections: [],
        expectedSectionCount: outputFields.length,
      });
      await attributeReportUsage(failedReportId, reportRequestId);
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
  const selectedMobileModeCard =
    modeCards.find((modeCard) => modeCard.mode === activeMode) || modeCards[0];
  const mobileContextReady = Boolean(
    (mobileBusinessIdea.trim() || mobileGoal.trim()) &&
      (activeMode === "chat" || mobileBusinessIdea.trim())
  );
  const shouldShowMobileWizard = mobileWizardActive;
  const shouldHideDesktopCreationOnMobile = mobileWizardActive;
  const shouldShowToolbarRegenerate = true;
  const hasConversationMessages = messages.length > 0;
  const hasWorkspaceActivity =
    hasConversationMessages ||
    isReportWorking ||
    Boolean(planReport || marketReport || result || reportGenerationError);
  const advisorSuggestions = [
    "Validate my business idea",
    "Find my strongest competitors",
    "Build a pricing strategy",
    "Plan expansion into a new market",
  ];
  const firstInteractionSuggestions = [
    "Validate my business idea",
    "Analyze my market",
    "Find competitors",
    "Improve my pricing",
  ];
  const recentAssistantOutputs = useMemo(
    () =>
      (activeConversation?.messages || [])
        .filter((message) => message.role === "assistant" && message.content.trim())
        .map((message) => ({
          id: message.id,
          title: activeConversation
            ? getAnalysisSessionTitle(activeConversation.title)
            : "Current analysis",
          content: message.content,
          createdAt: message.createdAt,
        }))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 3),
    [activeConversation]
  );

  function buildMobileWizardPrompt() {
    const lines = [
      `Decision type: ${decisionGoalLabels[activeMode]}`,
      mobileBusinessIdea.trim()
        ? `Business idea: ${mobileBusinessIdea.trim()}`
        : "",
      mobileMarket.trim() ? `Market: ${mobileMarket.trim()}` : "",
      mobileGoal.trim() ? `Goal: ${mobileGoal.trim()}` : "",
      mobileConstraints.trim()
        ? `Constraints: ${mobileConstraints.trim()}`
        : "",
    ].filter(Boolean);

    return lines.join("\n");
  }

  async function submitMobileWizard() {
    const mobilePrompt = buildMobileWizardPrompt();

    if (!mobilePrompt.trim() || isWorking) {
      return;
    }

    setPrompt(mobilePrompt);
    setMobileWizardStep(3);
    await submitPrompt(mobilePrompt);
  }

  return (
    <main
      className="flex h-[100dvh] min-h-[100svh] flex-col overflow-hidden bg-black pb-20 text-white md:flex-row md:pb-0"
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
      <MobileBottomNavigation />
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        activeMode={activeMode}
        onSelectConversation={selectConversation}
        onCreateConversation={createNewConversation}
        onRenameConversation={renameConversation}
        onDeleteConversation={deleteConversation}
      />

      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-black">
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
                They will attach to your next analysis request.
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
                {decisionGoalLabels[activeMode]}
              </span>
            </div>
            <h1 className="mt-1 truncate text-xl font-semibold text-white md:text-2xl">
              {activeConversation
                ? getAnalysisSessionTitle(activeConversation.title)
                : "Business Decision Advisor"}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void createNewConversation()}
              className="hidden items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10 md:inline-flex"
            >
              <Plus className="h-4 w-4 text-teal-200" />
              New analysis
            </button>
            {shouldShowToolbarRegenerate ? (
              <button
                type="button"
                onClick={regenerateResponse}
                disabled={isWorking}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCcw className="h-4 w-4 text-teal-200" />
                <span className="inline">Regenerate response</span>
              </button>
            ) : null}
            <Link
              href="/dashboard/settings"
              aria-label="Open account settings"
              className="hidden items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30 lg:flex"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-sm font-semibold text-black">
                {(userEmail || "Z").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-white">Account</p>
                <p className="max-w-40 truncate text-[11px] text-zinc-500">
                  {userEmail || "Authenticated user"}
                </p>
              </div>
            </Link>
          </div>
        </header>

        <div
          ref={chatScrollerRef}
          onScroll={updateNearBottomState}
          className="relative z-10 min-h-0 flex-1 overflow-y-auto scroll-smooth px-4 py-5 sm:px-5 lg:px-8"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-48">
            {shouldShowMobileWizard ? (
              <section className="space-y-4 md:hidden">
                <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-2xl">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-200/70">
                        Strategic report builder
                      </p>
                      <h2 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-white">
                        Create a decision report.
                      </h2>
                    </div>
                    <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-semibold text-teal-100">
                      Step {mobileWizardStep}/3
                    </span>
                  </div>
                  <div className="mt-5 grid grid-cols-3 gap-2">
                    {mobileWizardStepLabels.map((label, index) => {
                      const step = (index + 1) as 1 | 2 | 3;
                      const active = mobileWizardStep === step;
                      const complete = mobileWizardStep > step;

                      return (
                        <div
                          key={label}
                          className={`rounded-2xl border px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.12em] ${
                            active || complete
                              ? "border-teal-200/30 bg-teal-200/10 text-teal-100"
                              : "border-white/10 bg-black/25 text-zinc-600"
                          }`}
                        >
                          {label}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {mobileWizardStep === 1 ? (
                  <div className="grid gap-3">
                    {modeCards.map((modeCard) => {
                      const Icon = modeCard.icon;
                      const selected = activeMode === modeCard.mode;
                      const mobileLabel =
                        modeCard.mode === "plan"
                          ? "Validate Idea"
                          : modeCard.mode === "market"
                            ? "Market Intelligence"
                            : "Strategic Advisory";

                      return (
                        <button
                          key={`mobile-${modeCard.mode}`}
                          type="button"
                          onClick={() => {
                            setActiveMode(modeCard.mode);
                            setMobileWizardStep(2);
                          }}
                          className={`rounded-[1.65rem] border p-5 text-left shadow-xl shadow-black/20 transition duration-300 ${
                            selected
                              ? "border-teal-200/35 bg-teal-200/10"
                              : "border-white/10 bg-white/[0.045]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
                              <Icon className="h-5 w-5 text-teal-200" />
                            </span>
                            <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] font-medium text-zinc-400">
                              Select
                            </span>
                          </div>
                          <h3 className="mt-4 text-xl font-semibold tracking-tight text-white">
                            {mobileLabel}
                          </h3>
                          <p className="mt-2 text-sm leading-6 text-zinc-500">
                            {modeCard.opens}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {mobileWizardStep === 2 ? (
                  <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-xl">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-200/70">
                          Business context
                        </p>
                        <h3 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                          {selectedMobileModeCard.label}
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMobileWizardStep(1)}
                        className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-xs font-semibold text-zinc-400"
                      >
                        Change
                      </button>
                    </div>

                    <div className="mt-5 space-y-3">
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                          Business idea
                        </span>
                        <textarea
                          value={mobileBusinessIdea}
                          onChange={(event) => setMobileBusinessIdea(event.target.value)}
                          className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-black/35 p-4 text-sm leading-6 text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300/35 focus:ring-2 focus:ring-teal-200/10"
                          placeholder="Describe the business, product or opportunity."
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                          Market
                        </span>
                        <input
                          value={mobileMarket}
                          onChange={(event) => setMobileMarket(event.target.value)}
                          className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300/35 focus:ring-2 focus:ring-teal-200/10"
                          placeholder="Industry, geography or customer segment."
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                          Goal
                        </span>
                        <input
                          value={mobileGoal}
                          onChange={(event) => setMobileGoal(event.target.value)}
                          className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300/35 focus:ring-2 focus:ring-teal-200/10"
                          placeholder="What decision should ZERINIX support?"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                          Constraints
                        </span>
                        <textarea
                          value={mobileConstraints}
                          onChange={(event) => setMobileConstraints(event.target.value)}
                          className="mt-2 min-h-20 w-full resize-none rounded-2xl border border-white/10 bg-black/35 p-4 text-sm leading-6 text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300/35 focus:ring-2 focus:ring-teal-200/10"
                          placeholder="Budget, timeline, risks, geography, team or known limits."
                        />
                      </label>

                      {activeMode !== "chat" && initialWorkspaces.length > 0 ? (
                        <label className="block rounded-2xl border border-white/10 bg-black/25 p-3">
                          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                            Save to workspace
                          </span>
                          <select
                            value={selectedWorkspaceId}
                            onChange={(event) => setSelectedWorkspaceId(event.target.value)}
                            className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm font-medium text-zinc-200 outline-none transition focus:border-teal-300/40"
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

                    <div className="mt-5 grid gap-3">
                      <button
                        type="button"
                        onClick={() => setMobileWizardStep(3)}
                        disabled={!mobileContextReady}
                        className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-white/10 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Review request
                      </button>
                    </div>
                  </div>
                ) : null}

                {mobileWizardStep === 3 ? (
                  <div className="rounded-[2rem] border border-teal-200/15 bg-teal-200/[0.06] p-5 shadow-2xl shadow-black/30 ring-1 ring-teal-200/10 backdrop-blur-xl">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-100/75">
                      Generation
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                      {selectedMobileModeCard.label}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">
                      {isWorking
                        ? activeMode === "chat"
                          ? "ZERINIX Advisor is preparing strategic guidance."
                          : "ZERINIX is generating your strategic report."
                        : "Review the context and start the existing ZERINIX generation workflow."}
                    </p>

                    <div className="mt-5 rounded-[1.35rem] border border-white/10 bg-black/30 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        Request summary
                      </p>
                      <p className="mt-2 text-sm leading-6 text-zinc-300">
                        {buildMobileWizardPrompt().slice(0, 420)}
                      </p>
                    </div>

                    {isWorking ? (
                      <div className="mt-5 rounded-[1.35rem] border border-teal-200/20 bg-black/30 p-4">
                        <div className="flex items-center justify-between gap-4">
                          <span className="inline-flex items-center gap-2 text-sm font-semibold text-teal-100">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {activeMode === "chat" ? "Advising" : "Generating"}
                          </span>
                          <span className="text-sm font-semibold text-white">
                            {Math.round(reportProgress)}%
                          </span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-teal-200 transition-[width] duration-500"
                            style={{ width: `${Math.max(8, Math.min(100, reportProgress))}%` }}
                          />
                        </div>
                        <p className="mt-3 text-xs leading-5 text-zinc-500">
                          {currentReportSectionName || "Preparing analysis engine"}
                        </p>
                      </div>
                    ) : (
                      <div className="mt-5 grid gap-3">
                        <button
                          type="button"
                          onClick={() => void submitMobileWizard()}
                          disabled={!mobileContextReady || isWorking}
                          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-teal-300 px-5 py-3 text-sm font-semibold text-black shadow-lg shadow-teal-950/30 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {activeMode === "chat"
                            ? "Start Advisory Session"
                            : "Generate Strategic Report"}
                          <Send className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setMobileWizardStep(2)}
                          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-zinc-300"
                        >
                          Edit context
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
              </section>
            ) : null}

            <div
              className={`mx-auto w-full gap-6 pb-14 ${
                shouldHideDesktopCreationOnMobile ? "hidden md:flex md:flex-col" : "flex flex-col"
              }`}
            >
              <div className="flex min-w-0 flex-col gap-5 transition-all duration-200 ease-out">
              {conversationError ? (
                <div className="rounded-3xl border border-red-300/20 bg-red-950/30 p-4 text-sm leading-6 text-red-100 shadow-2xl shadow-black/30">
                  <p className="font-semibold text-red-50">
                    Analysis history could not be loaded or saved.
                  </p>
                  <p className="mt-1 break-words text-red-100/80">
                    Your workspace is safe. Please refresh the page or try again shortly.
                  </p>
                </div>
              ) : null}

                    <div className="px-1">
                      <p className="text-xs font-semibold tracking-[0.32em] text-teal-300/70">
                        ZERINIX AI
                      </p>
                      <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-400">
                        AI-powered business decision intelligence for founders and teams.
                      </p>
                    </div>

						            <section className="rounded-[1.75rem] border border-teal-200/15 bg-white/[0.055] p-3.5 shadow-2xl shadow-black/35 ring-1 ring-teal-200/[0.035] backdrop-blur-2xl sm:p-4">
		                  <div className="mb-2">
				                <p className="text-base font-semibold text-white">Ask ZERINIX</p>
		                <p className="mt-0.5 text-xs text-zinc-400">
		                  Discuss your idea with ZERINIX, then turn your conversation into a strategic report.
		                </p>
		              </div>
				              <div className="rounded-[1.35rem] border border-white/10 bg-black/35 p-2.5 shadow-inner shadow-black/25 transition duration-200 ease-out focus-within:border-teal-300/50 focus-within:shadow-teal-950/25 focus-within:ring-2 focus-within:ring-teal-200/15">
		                <textarea
		                  value={chatPrompt}
		                  onChange={(event) => setChatPrompt(event.target.value)}
					              className="min-h-12 w-full resize-none border-0 bg-transparent p-1 text-sm leading-5 text-white outline-none transition placeholder:text-zinc-500/80 sm:min-h-14"
		                  placeholder="Ask ZERINIX about your business, market or strategy..."
		                />
		                <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		                  <div className="flex flex-wrap gap-1.5">
		                    {firstInteractionSuggestions.map((suggestion) => (
		                      <button
		                        key={suggestion}
		                        type="button"
		                        onClick={() => setChatPrompt(suggestion)}
		                        className="rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition hover:border-teal-300/25 hover:bg-teal-300/10 hover:text-teal-100"
		                      >
		                        {suggestion}
		                      </button>
		                    ))}
		                  </div>
		                  <button
		                    type="button"
		                    onClick={() => void submitChatPrompt()}
		                    disabled={!chatPrompt.trim() || isWorking}
					            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-2xl bg-teal-300 px-4 py-2 text-sm font-semibold text-black shadow-lg shadow-teal-950/30 transition duration-200 ease-out hover:-translate-y-0.5 hover:bg-teal-200 hover:shadow-xl hover:shadow-teal-950/45 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-lg"
		                  >
			                    {chatLoading ? "ZERINIX is thinking..." : "Ask ZERINIX"}
			                    <Send className="h-4 w-4" />
		                  </button>
		                </div>
		              </div>
		            </section>

		            {messages.length > 0 ? (
		              <section className="min-h-[54vh] rounded-[2rem] border border-white/10 bg-white/[0.045] p-4 shadow-2xl shadow-black/35 ring-1 ring-white/[0.035] backdrop-blur-2xl transition-all duration-200 ease-out sm:p-6">
		                <div className="space-y-6">
		                  {messages.map((message) => (
		                    <ChatMessageBubble
		                      key={message.id}
		                      message={message}
		                      onEdit={editMessage}
		                      onSaveEdit={saveEditedMessage}
		                      onRegenerate={regenerateResponse}
		                    />
		                  ))}
		                </div>
		              </section>
		            ) : null}

		              <section className="space-y-4 transition-all duration-200 ease-out">
		                <details
		                  open={!hasConversationMessages}
		                  className="group"
		                >
		                  {hasConversationMessages ? (
			                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-3.5 shadow-xl shadow-black/20 transition hover:bg-white/[0.06] [&::-webkit-details-marker]:hidden">
		                      <div>
		                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-200/70">
		                          Decision Intelligence
		                        </p>
		                        <h2 className="mt-1 text-base font-semibold tracking-tight text-white">
		                          Create an analysis
		                        </h2>
			                        <p className="mt-1 text-xs leading-5 text-zinc-500">
			                          Expand report generation tools when you need a structured output.
			                        </p>
		                      </div>
		                      <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-medium text-zinc-400 transition group-open:border-teal-200/25 group-open:text-teal-100">
		                        Expand
		                      </span>
		                    </summary>
		                  ) : (
		                    <div>
		                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-200/70">
		                        Decision Intelligence
		                      </p>
			                      <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-white">
			                        Create an analysis
			                      </h2>
			                      <p className="mt-1.5 max-w-2xl text-sm leading-6 text-zinc-500">
			                        Choose an analysis type and describe the decision you want ZERINIX to evaluate.
			                      </p>
		                    </div>
		                  )}

					                <div className={`${hasConversationMessages ? "mt-3" : "mt-3"} overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-3.5 shadow-2xl shadow-black/35 ring-1 ring-white/[0.035] backdrop-blur-2xl`}>
	                  <div className="grid gap-3 md:grid-cols-3">
                    {modeCards.map((modeCard) => {
                      const Icon = modeCard.icon;
                      const selected = activeMode === modeCard.mode;

                      return (
                        <button
	                          key={modeCard.mode}
	                          type="button"
	                          onClick={() => setActiveMode(modeCard.mode)}
				                          className={`flex min-h-36 flex-col rounded-[1.25rem] border p-3.5 text-left shadow-lg shadow-black/10 transition duration-200 ease-out hover:-translate-y-0.5 hover:shadow-xl md:shadow-sm ${
			                            selected
				                              ? "border-teal-200/35 bg-teal-200/[0.12] shadow-xl shadow-teal-950/30 ring-1 ring-teal-200/20"
			                              : "border-white/10 bg-black/25 hover:border-white/20 hover:bg-white/[0.055] hover:shadow-black/25"
			                          }`}
		                        >
                          <div className="flex items-center justify-between gap-3">
	                            <span
		                              className={`flex h-9 w-9 items-center justify-center rounded-xl border ${
	                                selected
			                                  ? "border-teal-200/30 bg-teal-200/10"
			                                  : "border-white/10 bg-white/[0.04]"
		                              }`}
		                            >
				                              <Icon className={`h-4 w-4 ${selected ? "text-teal-100" : "text-teal-200"}`} />
		                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                                selected
		                                  ? "bg-teal-200 text-black"
		                                  : "border border-white/10 text-zinc-500"
                              }`}
                            >
                              {selected ? "Recommended" : "Select"}
                            </span>
                          </div>
			                          <p className="mt-3 text-sm font-semibold text-white">
	                            {modeCard.label}
	                          </p>
			                          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-zinc-500">
	                            {modeCard.description}
	                          </p>
			                          <p className="mt-auto pt-2 text-[11px] font-medium text-teal-100/80">
                            {modeCard.mode === "chat"
                              ? modeCard.output
                              : `${modeCard.output} · ${modeCard.opens}`}
                          </p>
                        </button>
                      );
                    })}
                  </div>

				                  <div className="mt-3 rounded-[1.45rem] border border-white/10 bg-black/30 p-3.5 shadow-inner shadow-black/20">
			                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
		                      <div className="flex flex-wrap items-center gap-2">
					                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-zinc-200 shadow-sm shadow-black/10 transition duration-200 ease-out hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/10 hover:shadow-lg hover:shadow-black/25 active:translate-y-0">
				                          <Paperclip className="h-4 w-4 text-teal-200" />
		                          Upload files
		                          <input
		                            type="file"
		                            multiple
		                            className="hidden"
		                            onChange={(event) => void handleFiles(event.target.files)}
		                          />
		                        </label>
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
		                      <div className="flex flex-col items-stretch gap-2 sm:items-end">
					                        <p className="text-xs text-zinc-500">
			                          Turn this analysis into a structured decision report.
			                        </p>
		                        <button
		                          type="button"
		                          disabled={!chatPrompt.trim() || isWorking}
		                          onClick={() => {
		                            const sharedPrompt = chatPrompt.trim();

		                            if (!sharedPrompt || isWorking) {
		                              return;
		                            }

		                            void (activeMode === "market"
		                              ? analyzeMarket(sharedPrompt)
		                              : generatePlan(sharedPrompt));
		                          }}
					                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-teal-200/20 bg-teal-300 px-4.5 py-2.5 text-sm font-semibold text-black shadow-lg shadow-teal-950/35 transition duration-200 ease-out hover:-translate-y-0.5 hover:border-teal-100/40 hover:bg-teal-200 hover:shadow-xl hover:shadow-teal-950/45 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-lg"
		                        >
		                          {isWorking ? "Generating..." : "Generate Strategic Report"}
		                          <Send className="h-4 w-4" />
		                        </button>
		                      </div>
		                    </div>
		                  </div>
	                </div>
	                </details>
	              </section>

              {hasWorkspaceActivity ? (
                <>
                  <section className="rounded-[1.55rem] border border-white/10 bg-white/[0.045] p-3.5 shadow-xl shadow-black/20 ring-1 ring-white/[0.025] backdrop-blur-2xl">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-200/70">
                      Advisor
                    </p>
                    <h3 className="mt-1.5 text-base font-semibold text-white">
                      AI Suggestions
                    </h3>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {advisorSuggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => setChatPrompt(suggestion)}
                          className="flex w-full items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-left text-xs font-medium text-zinc-300 transition duration-200 ease-out hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/[0.06] hover:text-white"
                        >
                          <Sparkles className="h-3.5 w-3.5 shrink-0 text-teal-200/80" />
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-[1.55rem] border border-white/10 bg-white/[0.045] p-3.5 shadow-xl shadow-black/20 ring-1 ring-white/[0.025] backdrop-blur-2xl">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-200/70">
                      Context
                    </p>
                    <h3 className="mt-1.5 text-base font-semibold text-white">
                      Conversation Context
                    </h3>
                    <div className="mt-3 grid gap-2 md:grid-cols-4">
                      <div className="rounded-2xl border border-white/10 bg-black/25 p-2.5 md:col-span-2">
                        <p className="text-[11px] font-medium text-zinc-500">Current session</p>
                        <p className="mt-1 line-clamp-2 text-sm font-semibold text-zinc-100">
                          {activeConversation
                            ? getAnalysisSessionTitle(activeConversation.title)
                            : "Strategic Analysis Builder"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/25 p-2.5">
                        <p className="text-base font-semibold text-white">{messages.length}</p>
                        <p className="text-[11px] text-zinc-500">Messages</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/25 p-2.5">
                        <p className="text-base font-semibold text-white">{attachments.length}</p>
                        <p className="text-[11px] text-zinc-500">Files</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/25 p-2.5 md:col-span-4">
                        <p className="text-[11px] font-medium text-zinc-500">Analysis type</p>
                        <p className="mt-1 text-sm font-semibold text-zinc-100">
                          {decisionGoalLabels[activeMode]}
                        </p>
                      </div>
                    </div>
                  </section>

                  {recentAssistantOutputs.length > 0 ? (
                    <section className="rounded-[1.55rem] border border-white/10 bg-white/[0.045] p-3.5 shadow-xl shadow-black/20 ring-1 ring-white/[0.025] backdrop-blur-2xl">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-200/70">
                            Outputs
                          </p>
                          <h3 className="mt-1.5 text-base font-semibold text-white">
                            Recent Outputs
                          </h3>
                        </div>
                        <span className="rounded-full border border-white/10 bg-black/25 px-2 py-1 text-[11px] text-zinc-500">
                          {recentAssistantOutputs.length}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        {recentAssistantOutputs.map((output) => (
                          <div
                            key={output.id}
                            className="rounded-2xl border border-white/10 bg-black/25 p-2.5"
                          >
                            <p className="line-clamp-1 text-sm font-semibold text-zinc-100">
                              {output.title}
                            </p>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">
                              {output.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </>
              ) : null}

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
          </div>
        </div>
      </section>
    </main>
  );
}
