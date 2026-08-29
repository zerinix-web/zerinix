"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ClipboardCheck,
  Download,
  FileUp,
  FileText,
  FolderKanban,
  Gauge,
  Goal,
  Info,
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
  Users,
} from "lucide-react";
import Link from "next/link";
import { MobileBottomNavigation } from "@/components/MobileNavigation";
import {
  MobileConversationExperience,
  type MobileConversationMessage,
} from "@/components/planner/MobileConversationExperience";
import { createClient, restoreSupabaseSession } from "@/app/lib/supabase/client";
import {
  sanitizeAiResponseText,
  extractChatStreamError,
} from "@/app/lib/ai/response-sanitization";
import {
  buildExecutiveSnapshot,
  compactExecutiveDecisionMemoSections,
  extractSectionMainExplanation,
  getReportQualityBreakdown,
  getReportPresentationLabels,
  getSectionTakeaway,
  isExecutivePresentationSection,
  normalizeFounderReadinessScoreText,
  normalizeReportPresentationText,
  readFounderReadinessMetricValue,
  readFounderReadinessScoreValue,
  resolveMarketSizingCascade,
  stripLeadingTakeawaySentence,
} from "@/app/lib/report-presentation";
import type {
  ReportBenchmarkFit,
  ReportBenchmarkScore,
  ReportInvestmentScore,
  ReportMetadata,
  ReportQualityScore,
} from "@/app/lib/report-investment-score";
import {
  isReportAdvisoryWarningText,
} from "@/app/lib/report-errors";
import { dedupeReportSections } from "@/app/lib/report-section-normalization";
import {
  calculateReportProgress,
  assertReportApiCallBudget,
  REPORT_GENERATION_MAX_API_CALLS,
} from "@/app/lib/report-engine/generation-service";
import {
  isCompleteReportSectionPayload,
  sanitizeReportContent,
  sanitizeReportFieldContent,
} from "@/app/lib/report-engine/formatter";
import type {
  ReportFieldDefinition as EngineReportFieldDefinition,
  ResponseLanguage,
} from "@/app/lib/report-engine/schema";
import {
  detectReportLanguage,
  getReportLanguageCode,
  getResponseLanguage,
  repairReportLanguageSections,
  resolveMarketIntelligenceLanguage,
  resolveReportLanguage,
  validateReportLanguageConsistency,
  type ReportLanguageCode,
} from "@/app/lib/report-language";
import {
  cleanPdfLegacyValidationIntelligenceContent,
  detectPdfPresentationLocale,
  resolvePdfPresentationLocale,
  extractPdfValidationIntelligenceSection,
  insertPdfBenchmarkIntelligenceSection,
  localizePdfPresentationLabel,
  localizePdfPresentationText,
  localizePdfReportSections,
  normalizePdfCanonicalTamSamSomContent,
  normalizePdfFinancialSectionContent,
  normalizePdfTamSamSomOwnershipContent,
  normalizePdfText,
  normalizePdfSourceContent,
  repairPdfLineFragments,
} from "@/app/lib/pdf-normalization.mjs";
import { createInsightSignature, describesSameInsight } from "@/app/lib/report-content-quality.mjs";
import {
  applyPdfFont,
  createPdfDocument,
  drawPdfFooter,
  drawPdfLogoMark,
  getPdfPageMetrics,
  paintPdfPageBackground,
  type PdfLocale,
} from "@/app/lib/pdf-engine/core";
import { drawPdfSectionCardFrame } from "@/app/lib/pdf-engine/section-renderer";
import {
  splitPdfReadableLines as splitPdfReadableLinesWithEngine,
} from "@/app/lib/pdf-engine/utils";
import {
  getEvidenceBadgeClass,
  getEvidenceLabel,
  inferEvidenceLevel,
  type EvidenceLevel,
  type EvidenceLocale,
} from "@/app/lib/report-evidence";
import { formatMetricCardValue } from "@/components/planner/report-utils";
import { detectRecommendation } from "@/components/planner/decision-label";
import {
  extractExecutiveDecisionFromText,
  decisionTokensForLanguage,
  localizedLabelVariants,
} from "@/app/lib/report-engine/executive-decision-brief";
import {
  getCanonicalDecisionLabel,
  reconcileMarketIntelligenceDecisionText,
  resolveCanonicalDecisionFromReportText,
  resolveMarketIntelligenceExecutiveDecision,
} from "@/app/lib/report-engine/executive-decision-vocabulary";
import {
  SourcesCard,
  getFinalDedupePdfSources,
  parseCitations,
} from "@/components/planner/Citations";
import { MarkdownRenderer } from "@/components/planner/MarkdownRenderer";
import { ChatMessages, getReportCompletionHeadline } from "@/components/planner/ChatMessages";
import { BenchmarkIntelligencePanel } from "@/components/planner/BenchmarkIntelligencePanel";
import {
  classifyReportDomain,
  resolveReportDomainForSelectedMode,
  type ReportDomain,
} from "@/app/lib/report-engine/domain";
import {
  buildLegalReportSections,
  formatLegalSourceContent,
  isLegalRenderableReport,
} from "@/app/lib/report-engine/legal-report-rendering";
import {
  realEstateFieldLabels,
  realEstateFields,
  type RealEstateReportField,
} from "@/app/lib/report-engine/prompts/real-estate";
import {
  domainAnalysisFieldLabels,
  domainAnalysisFields,
  type DomainAnalysisField,
  type SpecializedReportDomain,
} from "@/app/lib/report-engine/prompts/domain-analysis";
import {
  acquisitionAnalysisFieldLabels,
  acquisitionAnalysisFields,
  type AcquisitionAnalysisField,
} from "@/app/lib/report-engine/prompts/acquisition-analysis";
import { planFieldLabels } from "@/app/lib/report-engine/prompts/plan";
import { marketFieldLabels } from "@/app/lib/report-engine/prompts/market";
import { inferReportDomainFromFieldNames } from "@/app/lib/report-engine/domain-inference";
import {
  isUniversalCustomerFacingSection,
  sanitizeMarketIntelligencePresentationText,
  stripReportPresentationArtifacts,
} from "@/app/lib/report-engine/report-presentation-sanitizer";
import {
  useAttachments,
  type PlannerAttachment,
} from "@/components/planner/useAttachments";
import { useReportExport } from "@/components/planner/useReportExport";
import {
  createDirectReportReadiness,
  createUnderstandingFallback,
  universalUnderstandingSchema,
  type UniversalReportReadiness,
} from "@/app/lib/ai/understanding";
import { UnderstandingLoadingState } from "@/components/planner/UnderstandingCard";
import { getComposerSuggestions } from "@/components/planner/composer-suggestions";

type ReportSection = {
  field?: keyof (MarketReport & PlanReport) | string;
  title: string;
  icon: LucideIcon;
  content: string;
};

type MarketReport = {
  executiveSummary: string;
  marketOverview: string;
  marketSize: string;
  cagr: string;
  marketSegmentation: string;
  regionalAnalysis: string;
  industryTrends: string;
  competitiveLandscape: string;
  majorPlayers: string;
  customerSegments: string;
  marketDrivers: string;
  barriers: string;
  opportunities: string;
  threats: string;
  tamSamSom: string;
  portersFiveForces: string;
  strategicRecommendations: string;
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
  risks: string;
  kpis: string;
  founderRoadmap: string;
  roadmap306090: string;
  financialAssumptions: string;
  founderScore: string;
  sourcesAssumptions: string;
} & Record<RealEstateReportField | DomainAnalysisField | AcquisitionAnalysisField, string> & Partial<MarketReport>;

type MarketReportField = keyof MarketReport;
type PlanReportField = keyof PlanReport;

function getReportGenerationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function sanitizeVisiblePlannerReportContent(content: string) {
  return sanitizeAiResponseText(content);
}

function isPrivateBetaReportRestriction(value: string) {
  return value.trim().toLowerCase() === "private beta access only.";
}

type ReportFieldDefinition = EngineReportFieldDefinition<
  keyof (MarketReport & PlanReport),
  LucideIcon
>;

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

type ChatAttachment = {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
  textContent?: string;
  dataUrl?: string;
  status?: "processing" | "ready" | "error";
  progress?: number;
  error?: string;
};

export type ChatMessage = {
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

type PersistedMessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  mode: ChatMode | null;
  status: ChatMessage["status"];
  attachments: ChatAttachment[] | null;
  created_at: string;
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
  type:
    | "Business Plan"
    | "Market Analysis"
    | "Real Estate Investment Analysis"
    | "Acquisition Due Diligence Report"
    | "Strategic Report";
  status: string;
  metadata?: ReportMetadata;
  investmentScore?: ReportInvestmentScore;
  sections: Array<{
    field?: string;
    title: string;
    content: string;
  }>;
};

type RegenerationContext = {
  reportId: string;
  reportTitle: string;
  reportType:
    | "Business Plan"
    | "Market Analysis"
    | "Real Estate Investment Analysis"
    | "Acquisition Due Diligence Report"
    | "Strategic Report";
  workspaceId: string;
  prompt: string;
  reportLanguage?: string;
};

type LastRequest = {
  mode: ChatMode;
  prompt: string;
  attachments?: PlannerAttachment[];
  reportReadiness?: UniversalReportReadiness;
  language?: ResponseLanguage;
};

type PlannerProps = {
  initialConversations?: Conversation[];
  conversationLoadError?: string;
  initialMode?: ChatMode;
  initialWorkspaces?: PlannerWorkspace[];
  initialWorkspaceId?: string;
  initialReport?: InitialReport | null;
  regenerationContext?: RegenerationContext | null;
  preferredLanguage?: string;
};

const CHAT_STREAM_IDLE_TIMEOUT_MS = 60_000;
const CHAT_REQUEST_TIMEOUT_MS = 75_000;
// P0 PRODUCTION FIX -- confirmed live: bounds only the initial /api/plan
// enqueue POST (expected to return quickly with a jobId; the actual
// report generation is deferred to the background job), not the overall
// report-generation wait -- that is already covered by the polling
// loop's own maxReportPollWaitMs ceiling further down.
const PLAN_ENQUEUE_REQUEST_TIMEOUT_MS = 30_000;
const ACTIVE_REPORT_ID_STORAGE_KEY = "zerinix.activeReportId";
const MESSAGE_CONVERSATION_ID_CHUNK_SIZE = 25;

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function loadPersistedMessagesForConversations(
  supabase: SupabaseClient,
  userId: string,
  conversationIds: string[]
) {
  const messages: PersistedMessageRow[] = [];

  for (const chunk of chunkValues(conversationIds, MESSAGE_CONVERSATION_ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("ai_messages")
      .select("id,conversation_id,role,content,mode,status,attachments,created_at")
      .eq("user_id", userId)
      .in("conversation_id", chunk)
      .order("created_at", { ascending: true });

    if (error) {
      return { data: [] as PersistedMessageRow[], error };
    }

    messages.push(...((data || []) as PersistedMessageRow[]));
  }

  messages.sort(
    (left, right) =>
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );

  return { data: messages, error: null };
}

async function getSupabaseAccessToken() {
  const supabase = createClient();
  const session = await restoreSupabaseSession(supabase);
  const accessToken = session?.access_token;

  if (!session) {
    const reason = "no session: supabase.auth.getSession() returned null";
    throw new Error(reason);
  }

  if (!accessToken) {
    const reason = "no access token: Supabase session exists without access_token";
    throw new Error(reason);
  }

  return accessToken;
}

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

const analysisWorkspaceModes: Array<{
  mode: ChatMode;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    mode: "plan",
    title: "Business Idea Validation",
    description: "Test demand, positioning, viability, and the path to execution.",
    icon: BriefcaseBusiness,
  },
  {
    mode: "market",
    title: "Market Intelligence",
    description: "Understand markets, competitors, customers, and growth signals.",
    icon: BarChart3,
  },
  {
    mode: "chat",
    title: "Strategic Advisory",
    description: "Work through complex decisions with a focused AI advisor.",
    icon: MessageSquare,
  },
];

const analysisQuickActions: Array<{
  label: string;
  mode: ChatMode;
  starter: string;
}> = [
  {
    label: "Validate Business Idea",
    mode: "plan",
    starter: "Validate my business idea",
  },
  {
    label: "Analyze Market",
    mode: "market",
    starter: "Analyze my market",
  },
  {
    label: "Find Competitors",
    mode: "market",
    starter: "Find competitors for this opportunity",
  },
  {
    label: "Improve Pricing",
    mode: "chat",
    starter: "Help me improve my pricing",
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
  { field: "marketSize", title: "Market Size", icon: PieChart },
  { field: "cagr", title: "CAGR", icon: TrendingUp },
  { field: "marketSegmentation", title: "Market Segmentation", icon: ListChecks },
  { field: "regionalAnalysis", title: "Regional Analysis", icon: Landmark },
  { field: "industryTrends", title: "Industry Trends", icon: Gauge },
  { field: "competitiveLandscape", title: "Competitive Landscape", icon: Search },
  { field: "majorPlayers", title: "Major Players", icon: BriefcaseBusiness },
  { field: "customerSegments", title: "Customer Segments", icon: Users },
  { field: "marketDrivers", title: "Market Drivers", icon: TrendingUp },
  { field: "barriers", title: "Barriers", icon: ShieldAlert },
  { field: "opportunities", title: "Opportunities", icon: Goal },
  { field: "threats", title: "Threats", icon: ShieldAlert },
  { field: "tamSamSom", title: "TAM / SAM / SOM", icon: PieChart },
  { field: "portersFiveForces", title: "Porter's Five Forces", icon: Landmark },
  { field: "strategicRecommendations", title: "Strategic Recommendations", icon: Sparkles },
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
  { field: "risks", title: "Risks", icon: ShieldAlert },
  { field: "kpis", title: "KPIs", icon: ListChecks },
  { field: "founderRoadmap", title: "Founder Roadmap", icon: CalendarDays },
  { field: "roadmap306090", title: "30-60-90 Day Roadmap", icon: CalendarDays },
  { field: "financialAssumptions", title: "Financial Assumptions", icon: PieChart },
  { field: "founderScore", title: "Founder Readiness Score", icon: Gauge },
  { field: "sourcesAssumptions", title: "Sources / Assumptions", icon: FileText },
];

const realEstateReportFields: Array<{
  field: RealEstateReportField;
  title: string;
  icon: LucideIcon;
}> = realEstateFields.map((field) => {
  const icons: Partial<Record<RealEstateReportField, LucideIcon>> = {
    assetIdentification: Landmark,
    extractedDocumentFacts: FileText,
    ownershipTitleFindings: ClipboardCheck,
    location: Landmark,
    zoningLandUseStatus: LayoutDashboard,
    accessInfrastructure: Goal,
    comparableMarketEvidence: Search,
    valuationRange: PieChart,
    legalRisks: ShieldAlert,
    environmentalGeotechnicalRisks: ShieldAlert,
    liquidity: TrendingUp,
    developmentPotential: BarChart3,
    scenarioAnalysis: BarChart3,
    investmentScore: Gauge,
    missingInformation: Info,
    recommendedDueDiligence: ListChecks,
    finalRecommendation: Sparkles,
    sources: FileText,
  };

  return {
    field,
    title: realEstateFieldLabels.English[field],
    icon: icons[field] || FileText,
  };
});

const specializedReportFields: Array<{
  field: DomainAnalysisField;
  title: string;
  icon: LucideIcon;
}> = domainAnalysisFields.map((field) => {
  const icons: Partial<Record<DomainAnalysisField, LucideIcon>> = {
    subjectIdentification: ClipboardCheck,
    extractedFacts: FileText,
    externalEvidence: Search,
    domainFindings: ListChecks,
    regulatoryCompliance: Landmark,
    financialImplications: PieChart,
    operationalImplications: FolderKanban,
    riskAnalysis: ShieldAlert,
    scenarioAnalysis: BarChart3,
    decisionAssessment: Gauge,
    missingInformation: Info,
    recommendedActions: Goal,
    finalRecommendation: Sparkles,
    sources: FileText,
  };

  return {
    field,
    title: domainAnalysisFieldLabels.English[field],
    icon: icons[field] || FileText,
  };
});

const acquisitionReportFields: Array<{
  field: AcquisitionAnalysisField;
  title: string;
  icon: LucideIcon;
}> = acquisitionAnalysisFields.map((field) => {
  const icons: Partial<Record<AcquisitionAnalysisField, LucideIcon>> = {
    executiveAcquisitionSummary: Sparkles,
    targetCompanyOverview: ClipboardCheck,
    externalEvidence: Search,
    strategicFit: Goal,
    valuationAnalysis: PieChart,
    financingStructure: TrendingUp,
    debtCapacity: BarChart3,
    roiAnalysis: Gauge,
    irrAnalysis: Gauge,
    revenueSynergies: ListChecks,
    costSynergies: ListChecks,
    integrationRisks: ShieldAlert,
    operationalRisks: ShieldAlert,
    regulatoryReview: Landmark,
    competitivePosition: BarChart3,
    dealRisks: ShieldAlert,
    postMergerIntegrationPlan: CalendarDays,
    missingInformation: Info,
    finalInvestmentRecommendation: Sparkles,
    sources: FileText,
  };

  return {
    field,
    title: acquisitionAnalysisFieldLabels.English[field],
    icon: icons[field] || FileText,
  };
});

function isSpecializedReportDomain(
  domain: ReportDomain
): domain is SpecializedReportDomain {
  return (
    domain === "legal" ||
    domain === "finance" ||
    domain === "accounting" ||
    domain === "operations" ||
    domain === "procurement"
  );
}

function getPlanFieldsForDomain(domain: ReportDomain, prompt = "") {
  if (domain === "real_estate") return realEstateReportFields;
  if (domain === "acquisition") return acquisitionReportFields;
  if (
    domain === "operations" &&
    /\b(retail|store|branch|sku|product sales|inventory turnover|perakende|market zinciri|mağaza|şube|ürün satış|stok devir)\b/i.test(
      prompt
    )
  ) {
    const Turkish = /[çğıöşüÇĞİÖŞÜ]/.test(prompt);
    const titles: Record<DomainAnalysisField, string> = Turkish
      ? {
          subjectIdentification: "Veri Seti ve Dönem",
          extractedFacts: "Yüklenen Satış Verilerinin Özeti",
          externalEvidence: "Pazar ve Referans Kanıtları",
          domainFindings: "Şube ve Ürün Performansı",
          regulatoryCompliance: "Veri Kalitesi ve Kontroller",
          financialImplications: "Kârlılık Analizi",
          operationalImplications: "Stok Devir Hızı",
          riskAnalysis: "Düşük Performanslı Ürünler ve Riskler",
          scenarioAnalysis: "Büyüme Senaryoları",
          decisionAssessment: "Performans Değerlendirmesi",
          missingInformation: "Kritik Veri Eksikleri",
          recommendedActions: "Önceliklendirilmiş Aksiyon Planı",
          finalRecommendation: "Yönetici Tavsiyesi",
          sources: "Kaynaklar",
        }
      : {
          subjectIdentification: "Dataset and Period",
          extractedFacts: "Uploaded Sales Data Summary",
          externalEvidence: "Market and Benchmark Evidence",
          domainFindings: "Branch and Product Performance",
          regulatoryCompliance: "Data Quality and Controls",
          financialImplications: "Profitability Analysis",
          operationalImplications: "Inventory Turnover",
          riskAnalysis: "Low-performing Products and Risks",
          scenarioAnalysis: "Growth Scenarios",
          decisionAssessment: "Performance Assessment",
          missingInformation: "Critical Data Gaps",
          recommendedActions: "Prioritized Action Plan",
          finalRecommendation: "Executive Recommendation",
          sources: "Sources",
        };
    return specializedReportFields.map((field) => ({
      ...field,
      title: titles[field.field as DomainAnalysisField],
    }));
  }
  if (isSpecializedReportDomain(domain)) return specializedReportFields;
  return planReportFields;
}

function localizeReportFields<T extends ReportFieldDefinition>(
  fields: T[],
  language: ResponseLanguage = "English"
) {
  return fields.map((field) => {
    const defaultSpecializedTitle =
      domainAnalysisFieldLabels.English[field.field as DomainAnalysisField];
    const hasCustomSpecializedTitle =
      Boolean(defaultSpecializedTitle) &&
      field.title !== defaultSpecializedTitle;

    return {
      ...field,
      title: hasCustomSpecializedTitle
        ? field.title
        : realEstateFieldLabels[language]?.[field.field as RealEstateReportField]
          || domainAnalysisFieldLabels[language]?.[field.field as DomainAnalysisField]
          || acquisitionAnalysisFieldLabels[language]?.[field.field as AcquisitionAnalysisField]
          || (marketFieldLabels[language] as Partial<Record<string, string>>)?.[field.field]
          || (planFieldLabels[language] as Partial<Record<string, string>>)?.[field.field]
          || field.title,
    };
  });
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
      sanitizeVisiblePlannerReportContent(section.content),
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
  marketSize: "",
  cagr: "",
  marketSegmentation: "",
  regionalAnalysis: "",
  industryTrends: "",
  competitiveLandscape: "",
  majorPlayers: "",
  customerSegments: "",
  marketDrivers: "",
  barriers: "",
  opportunities: "",
  threats: "",
  tamSamSom: "",
  portersFiveForces: "",
  strategicRecommendations: "",
  sources: "",
};

const emptyPlanReport = Object.assign({
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
  risks: "",
  kpis: "",
  founderRoadmap: "",
  roadmap306090: "",
  financialAssumptions: "",
  founderScore: "",
  sourcesAssumptions: "",
}, Object.fromEntries(
  [...realEstateFields, ...domainAnalysisFields, ...acquisitionAnalysisFields].map((field) => [field, ""])
)) as PlanReport;

function detectResponseLanguage(value: string): ResponseLanguage {
  return getResponseLanguage(detectReportLanguage(value));
}

function getExplicitReportLanguageSelection() {
  return typeof window === "undefined"
    ? ""
    : window.localStorage.getItem("zerinix_report_language") || "";
}

function getPlannerUiLanguage() {
  return typeof document === "undefined"
    ? ""
    : document.cookie.match(/(?:^|;\s*)zerinix_locale_manual=([^;]+)/)?.[1] || "";
}

function resolvePlannerReportLanguage(
  value: string,
  mode?: ChatMode,
  preferredLanguage?: string
): ResponseLanguage {
  if (mode === "market") {
    // Market Intelligence never defers to site/browser locale -- a short
    // category prompt has no reliable language signal either way, and
    // falling back to locale there is what produces mismatched loading
    // copy for an English prompt on a Turkish-locale browser. Preferred
    // language (Settings) is consulted with the same priority the server
    // uses, so the loading-state language matches the final resolution
    // immediately instead of only after the server responds.
    return getResponseLanguage(resolveMarketIntelligenceLanguage({
      explicitLanguage: getExplicitReportLanguageSelection() || preferredLanguage,
      requestText: value,
    }));
  }
  const browserLanguage = typeof navigator === "undefined" ? "" : navigator.language;
  return getResponseLanguage(resolveReportLanguage({
    explicitLanguage: getExplicitReportLanguageSelection(),
    uiLanguage: getPlannerUiLanguage(),
    browserLanguage,
    requestText: value,
  }));
}

function getLanguageCopy(language: ResponseLanguage) {
  if (language === "Turkish") {
    return {
      planTitle: "İş Planı Raporu",
      marketTitle: "Pazar İstihbaratı Raporu",
      realEstateTitle: "Gayrimenkul Yatırım Analizi",
      preparingPlan: "## İş Planı Raporu\n\nİlk bölümler hazırlanıyor...",
      preparingMarket: "## Pazar İstihbaratı Raporu\n\nCanlı pazar araştırması hazırlanıyor...",
      preparingRealEstate:
        "## Gayrimenkul Yatırım Analizi\n\nBelge kanıtları ve durum tespiti hazırlanıyor...",
      waitingSection: "Bu bölüm AI çıktısını bekliyor.",
      sectionFallback: "Rapor servisi bu bölüm için içerik döndürmedi.",
      genericError: "Bir şeyler ters gitti.",
      retryError: "Rapor isteği kullanılabilir bir yanıt dönmeden önce başarısız oldu.",
      marketError: "Pazar analizi sırasında bir şeyler ters gitti.",
      marketRetryError: "Pazar analizi sırasında bir şeyler ters gitti. Lütfen tekrar deneyin.",
      planClarification:
        "Lütfen planlamak istediğiniz iş fikrini girin. Örneğin: lüks otel markası, AI hukuk asistanı veya premium özel hastane zinciri.",
      marketClarification:
        "Lütfen analiz edilmesini istediğiniz iş fikrini veya sektörü girin. Örneğin: lüks otel markası, elektrikli yat şirketi veya EV batarya üreticisi.",
      preparingSubtitle: "Raporunuz hazırlanıyor…",
    };
  }

  if (language === "German") {
    return { planTitle: "Geschäftsplan", marketTitle: "Marktintelligenzbericht", realEstateTitle: "Immobilien-Investitionsanalyse", preparingPlan: "## Geschäftsplan\n\nDie ersten Abschnitte werden erstellt...", preparingMarket: "## Marktintelligenzbericht\n\nDie Marktrecherche wird erstellt...", preparingRealEstate: "## Immobilien-Investitionsanalyse\n\nNachweise und Due Diligence werden erstellt...", waitingSection: "Dieser Abschnitt wartet auf die Analyse.", sectionFallback: "Für diesen Abschnitt liegt kein Inhalt vor.", genericError: "Ein Fehler ist aufgetreten.", retryError: "Die Berichtsanfrage wurde ohne verwertbare Antwort beendet.", marketError: "Bei der Marktanalyse ist ein Fehler aufgetreten.", marketRetryError: "Bei der Marktanalyse ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.", planClarification: "Bitte beschreiben Sie die zu analysierende Geschäftsidee.", marketClarification: "Bitte beschreiben Sie die zu analysierende Geschäftsidee oder Branche.", preparingSubtitle: "Ihr Bericht wird vorbereitet…" };
  }
  if (language === "French") {
    return { planTitle: "Plan d'affaires", marketTitle: "Rapport d'intelligence de marché", realEstateTitle: "Analyse d'investissement immobilier", preparingPlan: "## Plan d'affaires\n\nPréparation des premières sections...", preparingMarket: "## Rapport d'intelligence de marché\n\nPréparation de la recherche de marché...", preparingRealEstate: "## Analyse d'investissement immobilier\n\nPréparation des preuves et des diligences...", waitingSection: "Cette section attend l'analyse.", sectionFallback: "Aucun contenu n'a été produit pour cette section.", genericError: "Une erreur s'est produite.", retryError: "La demande de rapport a échoué sans réponse exploitable.", marketError: "Une erreur s'est produite pendant l'analyse de marché.", marketRetryError: "Une erreur s'est produite pendant l'analyse de marché. Veuillez réessayer.", planClarification: "Veuillez décrire l'idée d'entreprise à analyser.", marketClarification: "Veuillez décrire l'idée d'entreprise ou le secteur à analyser.", preparingSubtitle: "Préparation de votre rapport…" };
  }
  if (language === "Spanish") {
    return { planTitle: "Plan de negocio", marketTitle: "Informe de inteligencia de mercado", realEstateTitle: "Análisis de inversión inmobiliaria", preparingPlan: "## Plan de negocio\n\nPreparando las primeras secciones...", preparingMarket: "## Informe de inteligencia de mercado\n\nPreparando la investigación de mercado...", preparingRealEstate: "## Análisis de inversión inmobiliaria\n\nPreparando evidencia y diligencia debida...", waitingSection: "Esta sección está esperando el análisis.", sectionFallback: "No se generó contenido para esta sección.", genericError: "Se produjo un error.", retryError: "La solicitud del informe finalizó sin una respuesta utilizable.", marketError: "Se produjo un error durante el análisis de mercado.", marketRetryError: "Se produjo un error durante el análisis de mercado. Inténtelo de nuevo.", planClarification: "Describa la idea de negocio que desea analizar.", marketClarification: "Describa la idea de negocio o el sector que desea analizar.", preparingSubtitle: "Preparando su informe…" };
  }

  return {
    planTitle: "Business Plan Report",
    marketTitle: "Market Intelligence Report",
    realEstateTitle: "Real Estate Investment Analysis",
    preparingPlan: "## Business Plan Report\n\nPreparing the first sections...",
    preparingMarket: "## Market Intelligence Report\n\nPreparing live market research...",
    preparingRealEstate:
      "## Real Estate Investment Analysis\n\nPreparing document evidence and due diligence...",
    preparingSubtitle: "Preparing your report…",
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

function getSpecializedReportTitle(
  domain: SpecializedReportDomain,
  language: ResponseLanguage
) {
  const titles: Record<
    SpecializedReportDomain,
    Record<ResponseLanguage, string>
  > = {
    legal: { English: "Legal Decision Analysis", Turkish: "Hukuki Karar Analizi", German: "Rechtliche Entscheidungsanalyse", French: "Analyse de décision juridique", Spanish: "Análisis de decisión jurídica" },
    finance: { English: "Financial Decision Analysis", Turkish: "Finansal Karar Analizi", German: "Finanzielle Entscheidungsanalyse", French: "Analyse de décision financière", Spanish: "Análisis de decisión financiera" },
    accounting: { English: "Accounting Review", Turkish: "Muhasebe İncelemesi", German: "Rechnungslegungsprüfung", French: "Examen comptable", Spanish: "Revisión contable" },
    operations: { English: "Operations Analysis", Turkish: "Operasyon Analizi", German: "Betriebsanalyse", French: "Analyse opérationnelle", Spanish: "Análisis operativo" },
    procurement: { English: "Procurement Analysis", Turkish: "Tedarik Analizi", German: "Beschaffungsanalyse", French: "Analyse des achats", Spanish: "Análisis de compras" },
  };

  return titles[domain][language];
}

const acquisitionReportTitles: Record<ResponseLanguage, string> = {
  English: "Acquisition Due Diligence Report",
  Turkish: "Satın Alma Durum Tespiti Raporu",
  German: "Akquisitions-Due-Diligence-Bericht",
  French: "Rapport de diligence raisonnable d'acquisition",
  Spanish: "Informe de diligencia debida de adquisición",
};

function getAcquisitionReportTitle(language: ResponseLanguage) {
  return acquisitionReportTitles[language];
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
      // Regeneration must reproduce the original report's language exactly,
      // not re-detect it -- prompt-only re-detection can land on a
      // different language than the one the saved report actually used.
      language: regenerationContext.reportLanguage
        ? getResponseLanguage(getReportLanguageCode(regenerationContext.reportLanguage as ReportLanguageCode))
        : undefined,
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

function removeLargePlannerQueryPayloads() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const url = new URL(window.location.href);
    const allowedPlannerParams = new Set(["new", "mode", "workspaceId", "reportId"]);
    let changed = false;

    Array.from(url.searchParams.keys()).forEach((param) => {
      if (!allowedPlannerParams.has(param)) {
        url.searchParams.delete(param);
        changed = true;
      }
    });

    if (changed) {
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`
      );
    }
  } catch {
    // URL cleanup is best-effort; report generation still uses POST body below.
  }
}

function getReportMarkdown(
  title: string,
  reportData: Partial<MarketReport & PlanReport>,
  fields: ReportFieldDefinition[]
) {
  // This markdown is persisted into the chat message (persistMessage/
  // updatePersistedMessage) -- a durable artifact separate from the
  // reports table row -- so isUniversalCustomerFacingSection/
  // stripReportPresentationArtifacts are applied here too, not just
  // upstream where reportData/fields were built, so a saved conversation
  // reopened later never shows the un-sanitized markdown either.
  const sections = fields
    .filter((entry) => isUniversalCustomerFacingSection(entry))
    .map(({ field, title: sectionTitle }) => {
      const content = stripReportPresentationArtifacts(
        sanitizeReportFieldContent(field, reportData[field] || "")
      );

      return content ? `### ${sectionTitle}\n${content}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  return `## ${title}\n\n${sections || "Preparing the first sections..."}`;
}

function moveReportAdvisoriesIntoWarningsSection({
  reportData,
  fields,
  warnings,
  language,
}: {
  reportData: PlanReport;
  fields: ReportFieldDefinition[];
  warnings: string[];
  language: ResponseLanguage;
}) {
  const reportContainsAdvisories = Object.values(reportData).some(
    (content) =>
      typeof content === "string" &&
      isReportAdvisoryWarningText(content)
  );
  const uniqueWarnings = [...new Set(warnings.map((warning) => warning.trim()))]
    .filter(Boolean)
    .slice(0, 12);

  if (!reportContainsAdvisories && uniqueWarnings.length === 0) {
    return "";
  }

  const availableFields = new Set(fields.map(({ field }) => field));
  const warningField: PlanReportField = availableFields.has(
    "missingInformation"
  )
    ? "missingInformation"
    : availableFields.has("sourcesAssumptions")
      ? "sourcesAssumptions"
      : (fields[fields.length - 1]?.field as PlanReportField | undefined) ||
        "executiveSummary";
  const heading =
    language === "Turkish"
      ? "Nihai Onay Öncesi Gerekli Bilgiler"
      : "Key Information Needed Before Final Approval";
  const existingContent = reportData[warningField]?.trim() || "";
  const warningDetails = uniqueWarnings
    .filter((warning) => !existingContent.includes(warning))
    .map((warning) => `- ${warning}`)
    .join("\n");

  if (!new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "im").test(existingContent)) {
    reportData[warningField] = [
      heading,
      warningDetails,
      existingContent,
    ]
      .filter(Boolean)
      .join("\n\n");
  } else if (warningDetails) {
    reportData[warningField] = `${existingContent}\n\n${warningDetails}`;
  }

  return language === "Turkish"
    ? "Sağlayıcı ve doğrulama uyarıları raporun “Nihai Onay Öncesi Gerekli Bilgiler” bölümüne eklendi."
    : "Provider and verification warnings were included in the report’s “Key Information Needed Before Final Approval” section.";
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

const financialDashboardMetrics = [
  { label: "ARR", aliases: ["ARR", "Annual Recurring Revenue", "Revenue"] },
  { label: "MRR", aliases: ["MRR", "Monthly Recurring Revenue"] },
  { label: "Gross Margin", aliases: ["Gross Margin", "grossMargin", "Brüt Marj"] },
  { label: "CAC", aliases: ["CAC", "Customer Acquisition Cost"] },
  { label: "LTV", aliases: ["LTV", "Lifetime Value"] },
  { label: "Burn Rate", aliases: ["Burn Rate", "Aylık Nakit Yakımı", "Nakit Yakımı", "Burn"] },
  { label: "Runway", aliases: ["Runway", "Finansal Pist"] },
  { label: "Payback", aliases: ["Payback", "Geri Ödeme", "Payback Period"] },
  { label: "Break-even", aliases: ["Break-even Month", "Başabaş Ayı", "Başabaş", "Break even Month", "Breakeven"] },
];

const mobilityFinancialDashboardMetrics = [
  { label: "Yearly Revenue", aliases: ["Yearly Revenue", "Annual Revenue", "ARR", "Revenue"] },
  { label: "Monthly Revenue", aliases: ["Monthly Revenue", "MRR"] },
  { label: "Gross Margin", aliases: ["Gross Margin", "grossMargin", "Brüt Marj"] },
  { label: "Rider CAC", aliases: ["Rider CAC", "CAC", "Customer Acquisition Cost"] },
  { label: "Rider LTV", aliases: ["Rider LTV", "LTV", "Lifetime Value"] },
  { label: "Burn Rate", aliases: ["Burn Rate", "Aylık Nakit Yakımı", "Nakit Yakımı", "Monthly Burn", "Burn"] },
  { label: "Runway", aliases: ["Runway", "Finansal Pist"] },
  { label: "Payback", aliases: ["Payback", "Geri Ödeme", "Payback Period", "CAC Payback"] },
  { label: "Break-even", aliases: ["Break-even Month", "Başabaş Ayı", "Başabaş", "Break even Month", "Breakeven"] },
];

const founderScoreMetrics = [
  { label: "Founder Readiness Score", aliases: ["Founder Readiness Score", "Kurucu Hazırlık Skoru", "Overall Score", "Genel Skor"] },
  { label: "Idea Quality", aliases: ["Idea Quality", "Fikir Kalitesi"] },
  { label: "Market Attractiveness", aliases: ["Market Attractiveness", "Pazar Çekiciliği"] },
  { label: "Business Model Quality", aliases: ["Business Model Quality", "İş Modeli Kalitesi"] },
  { label: "Validation Confidence", aliases: ["Validation Confidence", "Doğrulama Güveni"] },
  { label: "Execution Complexity", aliases: ["Execution Complexity", "executionComplexity", "Execution Difficulty", "executionDifficulty", "Execution", "Uygulama Karmaşıklığı", "Yürütme Karmaşıklığı", "Uygulama Zorluğu"] },
  { label: "Evidence Confidence", aliases: ["Evidence Confidence", "Kanıt Güveni"] },
  { label: "Founder Evidence", aliases: ["Founder Evidence", "Kurucu Kanıtı"] },
];

const founderScoreDimensionMetrics = founderScoreMetrics.filter(
  (metric) => metric.label !== "Founder Readiness Score"
);

const founderScorePdfDimensionMetrics = [
  { label: "Idea Quality", aliases: ["Idea Quality", "Fikir Kalitesi"] },
  { label: "Market Attractiveness", aliases: ["Market Attractiveness", "Pazar Çekiciliği"] },
  { label: "Business Model Quality", aliases: ["Business Model Quality", "İş Modeli Kalitesi"] },
  { label: "Validation Confidence", aliases: ["Validation Confidence", "Doğrulama Güveni"] },
  { label: "Execution Complexity", aliases: ["Execution Complexity", "executionComplexity", "Execution Difficulty", "executionDifficulty", "Execution", "Uygulama Karmaşıklığı", "Yürütme Karmaşıklığı", "Uygulama Zorluğu"] },
  { label: "Evidence Confidence", aliases: ["Evidence Confidence", "Kanıt Güveni"] },
  { label: "Founder Evidence", aliases: ["Founder Evidence", "Kurucu Kanıtı"] },
];

// Same fix as ReportPdfButton.tsx's identical kpiDashboardMetrics (the
// PDF export's own separate copy of this list): CAC deliberately
// removed. The kpiDashboard prompt (plan.ts) explicitly instructs the
// model "Do not include CAC, LTV, Gross Margin, Payback, ARR, MRR,
// Burn, or Runway; those belong to Unit Economics and Financial
// Dashboard" -- so a CAC card here was always structurally wrong, and
// with no proper "CAC: $X" line ever written for this section, its
// value extraction fell through to the bare-score fallback below,
// which (confirmed live, e-commerce inventory SaaS report) rendered
// CAC's dollar figure with a nonsensical "%" suffix ("CAC 51%") on the
// on-screen dashboard too. isPercentage marks which of these are
// genuinely 0-100% completion/funnel metrics -- only those may fall
// back to a bare extracted number with a "%" suffix; see
// extractKpiValueFromSnippet below.
const kpiDashboardMetrics = [
  { label: "Acquisition", aliases: ["Acquisition", "acquisition", "Edinim"], isPercentage: true },
  { label: "Activation", aliases: ["Activation", "activation", "Aktivasyon"], isPercentage: true },
  { label: "Retention", aliases: ["Retention", "retention", "Elde Tutma"], isPercentage: true },
  { label: "Revenue", aliases: ["Revenue", "revenue", "Gelir"], isPercentage: false },
  { label: "WTP", aliases: ["WTP", "Ödeme İsteği"], isPercentage: false },
  { label: "Sales cycle", aliases: ["Sales cycle", "Satış Döngüsü"], isPercentage: false },
  { label: "Conversion", aliases: ["Conversion", "Dönüşüm"], isPercentage: true },
];

const unitEconomicsMetrics = [
  { label: "ARPA", aliases: ["ARPA", "ACV", "Average Revenue Per Account", "Ortalama Gelir"] },
  { label: "CAC", aliases: ["CAC", "Customer Acquisition Cost", "Müşteri Edinme Maliyeti"] },
  { label: "LTV", aliases: ["LTV", "Lifetime Value", "Yaşam Boyu Değer"] },
  { label: "Payback", aliases: ["Payback", "Payback Period", "Geri Ödeme"] },
  { label: "Gross Margin", aliases: ["Gross Margin", "grossMargin", "Brüt Marj"] },
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
  const normalizedContent = normalizePdfText(content);
  const lineMatch = normalizedContent
    .split("\n")
    .map((line) => line.trim())
    .find((line) =>
      new RegExp(`^(?:[-*•]\\s*)?(?:\\*\\*)?${escapedLabel}(?:\\*\\*)?\\s*[:\\-–—]`, "i").test(line)
    );

  if (lineMatch) {
    const lineValue = lineMatch
      .replace(new RegExp(`^(?:[-*•]\\s*)?(?:\\*\\*)?${escapedLabel}(?:\\*\\*)?\\s*[:\\-–—]\\s*`, "i"), "")
      .trim()
      .replace(/\*\*/g, "");
    // CRITICAL FIX -- confirmed live: a label written alone on its own
    // line, with its real value on the FOLLOWING line(s) (e.g. the
    // deterministic Executive Decision banner's "Top 3 Risks:" heading
    // above a numbered list), matched here and returned an EMPTY string
    // immediately -- this branch never looked past the label's own line,
    // so callers like takeFirstListItem(extractMetricValueFromAliases(...))
    // always got "" for exactly the multi-line, list-shaped fields they
    // exist to read. Falls through to the multi-line-capable branches
    // below only when this line genuinely had nothing after the label;
    // every single-line "Label: value" match (the overwhelming majority
    // of call sites) is completely unaffected.
    if (lineValue) {
      return lineValue;
    }
  }

  const tableMatch = normalizedContent.match(
    new RegExp(`\\|\\s*(?:\\*\\*)?${escapedLabel}(?:\\*\\*)?\\s*\\|\\s*([^|\\n]+)`, "i")
  );

  if (tableMatch?.[1]?.trim()) {
    return tableMatch[1].trim().replace(/\*\*/g, "");
  }

  const inlineMatch = normalizedContent.match(
    new RegExp(
      `(?:^|[|\\n])\\s*(?:\\*\\*)?${escapedLabel}(?:\\*\\*)?\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=\\s*(?:\\||\\n|[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü /-]{1,32}\\s*[:\\-–—]|$))`,
      "i"
    )
  );

  if (inlineMatch?.[1]?.trim()) {
    return inlineMatch[1].trim().replace(/\*\*/g, "");
  }

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

// A labeled block (e.g. the text captured after "Top 3 Risks:") is often
// a multi-item bulleted/numbered list, not a single sentence -- too long
// for a compact KPI tile. Takes just the first real item, stripping its
// own bullet/number marker, rather than displaying the whole block
// verbatim or an arbitrary substring of it.
function takeFirstListItem(value: string) {
  const firstLine = value
    .split(/\n+/)
    .map((line) => line.trim().replace(/^[-*•]\s*/, "").replace(/^\(?\d{1,2}[).]\s*/, ""))
    .find(Boolean);

  return firstLine || value.trim();
}

function extractStrictMetricValueFromAliases(
  content: string,
  aliases: string[] | readonly string[]
) {
  const normalizedContent = normalizePdfText(content);
  const lines = normalizedContent
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const alias of aliases) {
    const escapedAlias = escapeRegExp(alias);
    const lineMatch = lines.find((line) =>
      new RegExp(`^(?:[-*•]\\s*)?(?:\\*\\*)?${escapedAlias}(?:\\*\\*)?\\s*[:=\\-–—]`, "i").test(line)
    );

    if (lineMatch) {
      return lineMatch
        .replace(new RegExp(`^(?:[-*•]\\s*)?(?:\\*\\*)?${escapedAlias}(?:\\*\\*)?\\s*[:=\\-–—]\\s*`, "i"), "")
        .replace(/\*\*/g, "")
        .trim();
    }

    const tableMatch = normalizedContent.match(
      new RegExp(`\\|\\s*(?:\\*\\*)?${escapedAlias}(?:\\*\\*)?\\s*\\|\\s*([^|\\n]+)`, "i")
    );

    if (tableMatch?.[1]?.trim()) {
      return tableMatch[1].trim().replace(/\*\*/g, "");
    }

    const objectMatch = normalizedContent.match(
      new RegExp(`["']?${escapedAlias}["']?\\s*[:=]\\s*["']?([^"',}\\n|]+)`, "i")
    );

    if (objectMatch?.[1]?.trim()) {
      return objectMatch[1].trim().replace(/\*\*/g, "");
    }
  }

  return "";
}

function normalizePdfFinancialMetrics(content: string, fullReportContent = "") {
  const metricContent = `${content}\n${fullReportContent}`;

  return getFinancialDashboardMetrics(metricContent)
    .map((metric) => {
      const value = extractCanonicalFinancialMetricValue(metricContent, metric.label, metric.aliases);
      const compactValue = dedupePdfFinancialMetricValue(value);

      return {
        label: metric.label,
        aliases: metric.aliases,
        value,
        compactValue,
      };
    })
    .filter((metric) => metric.compactValue);
}

function extractCanonicalFinancialMetricValue(
  content: string,
  label: string,
  aliases: string[] | readonly string[]
) {
  if (label === "Gross Margin") {
    const grossMarginValue = formatMetricCardValue(
      extractStrictMetricValueFromAliases(content, ["grossMargin", "Gross Margin", "Brüt Marj"])
    );

    return grossMarginValue.match(/\d+(?:[.,]\d+)?\s*%/)?.[0] || "";
  }

  const rawValue = formatMetricCardValue(extractMetricValueFromAliases(content, aliases));

  if (/\bmargin\b/i.test(label)) {
    return rawValue.match(/\d+(?:[.,]\d+)?\s*%/)?.[0] || "";
  }

  return compactPdfMetricValue(rawValue);
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

// tamSamSom's own prompt requires a "named scaling assumption" and
// calculation basis stated as prose next to each layer's own figure. This
// reads that real sentence back out -- the same "sentence containing the
// label" technique extractForceImplication uses for Porter's Five Forces
// -- rather than fabricating one. extractMarketLevelDescription (above)
// deliberately strips out anything after an "assumption:"/"confidence:"
// label, so it cannot supply this on its own; used only as the fallback
// when no full assumption sentence is present.
function extractMarketSizeAssumption(content: string, label: string) {
  const match = content.match(new RegExp(`[^.\\n]*\\b${label}\\b[^.\\n]*\\.`, "i"));

  return match ? match[0].trim().replace(/^[-*•]\s+/, "") : "";
}

// tamSamSom's own prompt allows a transparent, benchmark-derived estimate
// when no verified local figure exists, explicitly requiring every such
// figure be labeled "[Estimated]" and "never presented as verified". This
// reads that real marker back out of the layer's own sentence, rather than
// assuming estimated status.
function isMarketSizeEstimated(content: string, label: string) {
  const sentence = extractMarketSizeAssumption(content, label);

  return /\[Estimated\]/i.test(sentence) || /\bPlanning Estimate\b/i.test(sentence);
}

function getReportMarketRows(content: string) {
  return [
    {
      label: "TAM",
      name: "Total Addressable Market",
      value: extractMarketSizeValue(content, "TAM") || "NO DATA",
      description: extractMarketSizeAssumption(content, "TAM") || extractMarketLevelDescription(content, "TAM"),
      tone: "from-teal-200 to-cyan-100",
    },
    {
      label: "SAM",
      name: "Serviceable Available Market",
      value: extractMarketSizeValue(content, "SAM") || "NO DATA",
      description: extractMarketSizeAssumption(content, "SAM") || extractMarketLevelDescription(content, "SAM"),
      tone: "from-teal-400 to-teal-200",
    },
    {
      label: "SOM",
      name: "Serviceable Obtainable Market",
      value: extractMarketSizeValue(content, "SOM") || "—",
      description: extractMarketSizeAssumption(content, "SOM") || extractMarketLevelDescription(content, "SOM"),
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
        strengths: cleanExecutiveText(strengths || extractKeywordInsight(line, ["strength", "advantage"]) || "—", 110),
        weaknesses: cleanExecutiveText(weaknesses || extractKeywordInsight(line, ["weakness", "gap"]) || "—", 110),
        threat: cleanExecutiveText(threat || extractKeywordInsight(line, ["threat", "risk"]) || "—", 90),
      });
    }
  });

  return rows.slice(0, 5);
}

// CRITICAL FIX -- restore Market Intelligence's structured visual
// presentation. Market Intelligence's competitiveLandscape content is a
// markdown table generated by market-intelligence-graph.ts with its own
// column set (Vendor / Category / Segment / Strengths / Weaknesses /
// Market Relevance) -- distinct from Business Plan/Acquisition's
// Company/Positioning/Threat table extractCompetitorRows above already
// parses, so reusing that function would leave Company/Threat cells
// empty rather than actually presenting this report kind's real data.
// Positional slicing (not .filter(Boolean) on data cells) keeps columns
// aligned even when a cell is legitimately empty.
// CRITICAL FIX -- restore Market Intelligence's Market Metrics cards.
// marketSize/cagr are free-flowing analytical prose (their prompts never
// require a literal "Market Size:"/"CAGR:" label line the way
// tamSamSom's three sub-values do), so extractMetricValue's strict
// "Label: value" match would almost always come back empty here. These
// extractors instead find the first genuinely-present currency amount /
// percentage in the section's own content -- never a fabricated number,
// and the caller falls back to a premium "Validation Needed" empty state
// when nothing is found, per this ticket's explicit requirement not to
// paper over missing data with invented figures.
// CRITICAL FIX -- confirmed live (root-cause pipeline repair): this
// regex never recognized "£" (only €/$/₺), nor a spelled-out currency
// CODE ("USD 1.2 billion") -- a correctly-generated, correctly-sourced
// GBP or code-labeled figure would silently render "Validation Needed"
// purely because of currency notation, not because evidence was
// missing. Tolerates the same common codes already added for TAM/SAM/SOM
// elsewhere in this file.
// CRITICAL FIX -- confirmed live: a pricing/ARPA/per-customer dollar
// figure mentioned in marketSize's own free-flowing prose (e.g. "SMB
// customers typically pay $2K-$10K annually") was being grabbed as if it
// were the section's headline TOTAL MARKET SIZE figure -- this function
// used to match the FIRST dollar amount found anywhere in the content
// with no awareness of what that figure actually represents. A
// pricing/ARPA/ACV figure must never be classified or rendered as total
// market size. Any candidate whose immediate surrounding text names it
// as a pricing/per-customer/contract-value figure is now skipped; when
// every candidate is excluded, the caller correctly falls back to its
// "Validation Needed" state, matching TAM/SAM/SOM's own already-correct
// behavior for the same report. Mirrors page.tsx's identical fix.
const marketSizeExclusionContext =
  /\b(?:ARPA|ACV|WTP|average revenue per (?:account|customer|user|buyer)|revenue per (?:account|customer|user|buyer)|per[\s-](?:customer|user|seat|account|buyer|month|mo)\b|\/\s*(?:user|month|mo|seat|customer|buyer)\b|pricing|price point|price range|subscription (?:price|fee|cost|tier)|contract value|\bACV\b|\bCAC\b|\bLTV\b|willing(?:ness)? to pay|customers?\s+(?:typically\s+)?(?:pay|spend|purchase)|SMBs?\s+(?:typically\s+)?(?:pay|spend|purchase)|buyers?\s+(?:typically\s+)?(?:pay|spend|purchase)|annual (?:revenue|spend|contract|purchase) per|per[\s-]buyer)\b/i;
// CRITICAL FIX -- confirmed live (root-cause repair, ticket 2): the
// negative exclusion list above is fundamentally open-ended -- it has to
// anticipate every possible way the model might describe a non-market-
// size figure (pricing, ARPA, ACV, willingness-to-pay, "per-buyer
// purchase", ...), and a live report still leaked a per-buyer figure
// worded in a way the exclusion list didn't yet cover. This is not a
// case that can be closed by continuing to add more exclusion keywords.
// A candidate figure is now REQUIRED to sit near genuine, positive
// market-sizing language ("market size", "total addressable market",
// "market is valued/worth/estimated at", "TAM of", ...) -- a small,
// closed vocabulary -- in addition to passing the exclusion check.
// Whenever this restored one canonical field: the graph-projection layer
// (market-intelligence-graph.ts) now deterministically sets marketSize
// itself whenever no verified figure exists (a computed planning
// estimate, or an explicit "unavailable" notice) -- this presentation-
// layer check only remains as defense-in-depth for the narrow residual
// case where the model's own raw prose is trusted verbatim (adjacent
// benchmarks exist but no computable estimate). Fails closed: if nothing
// passes BOTH checks, no figure is ever guessed. Mirrors page.tsx's
// identical fix.
const marketSizePositiveContext =
  /\b(?:market size|total addressable market|serviceable addressable market|serviceable obtainable market|addressable market|market (?:opportunity|value)|\bTAM\b|\bSAM\b|\bSOM\b|industry size|(?:is|was|remains)\s+(?:valued|worth|estimated|sized)\s+at)\b/i;

function extractHeadlineMonetaryValue(content: string) {
  const unitWord = "(?:thousand|million|billion|trillion)";
  const currencyToken = "(?:[€$₺£]|(?:USD|EUR|GBP|TRY|CAD|AUD|CHF|JPY)\\b)";
  const bound = `${currencyToken}\\s*\\d+(?:[.,]\\d+)*(?:\\s*[kKmMbBtT]\\b|\\s+${unitWord}\\b)?`;
  const pattern = new RegExp(
    `${bound}(?:\\s*[-–—]\\s*(?:${currencyToken}\\s*)?\\d+(?:[.,]\\d+)*(?:\\s*[kKmMbBtT]\\b|\\s+${unitWord}\\b)?)?`,
    "gi"
  );
  const text = content || "";

  for (const match of text.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;
    // Trailing window is deliberately short (just enough for a directly
    // attached qualifier like "$2K-$10K annually (ARPA)" or "$2K-$10K
    // per customer") -- a longer trailing window risked reaching into
    // the START of the NEXT, unrelated sentence (e.g. a genuine market-
    // size figure immediately followed by a separate sentence about
    // per-customer pricing) and excluding a perfectly valid market-size
    // figure because of context that describes a different number
    // entirely. The leading window stays generous since a pricing/ARPA
    // label almost always precedes the figure it describes.
    const exclusionWindow = text.slice(Math.max(0, matchIndex - 80), matchIndex + match[0].length + 20);

    if (marketSizeExclusionContext.test(exclusionWindow)) {
      continue;
    }

    // The positive-confirmation window is wider (market-sizing language
    // often opens the sentence, well before the figure itself: "The
    // total addressable market for X in the U.S. is estimated at $Y").
    const positiveWindow = text.slice(Math.max(0, matchIndex - 150), matchIndex + match[0].length + 60);

    if (!marketSizePositiveContext.test(positiveWindow)) {
      continue;
    }

    return match[0].replace(/\s+/g, " ").trim();
  }

  return "";
}

function extractHeadlineCagrValue(content: string) {
  const match = (content || "").match(
    /\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?)?\s*%/
  );

  return match ? match[0].replace(/\s+/g, " ").trim() : "";
}

// CRITICAL FIX -- confirmed live: app/lib/report-engine/markdown-table-
// flattening.ts's flattenMarkdownTables runs on every Market Intelligence
// field (including competitiveLandscape) before the deterministic graph
// projection is spliced back in; when that graph splice is unavailable
// for a given generation (e.g. a cached response with no preserved
// research graph), the flattened "- Vendor — Category: X; Strengths: Y;
// ..." bullet shape is what actually reaches this section's content --
// never restored back into a "| a | b | c |" table. The table-only parser
// below then saw zero table rows and reported "Validation Needed" even
// though the report plainly names real, evidence-backed vendors. This
// fallback reads that exact flattened shape (the same header vocabulary
// the deterministic table uses, now as "Header: Value" pairs instead of
// cells) so the premium card consumes the SAME underlying vendor data
// either way, without fabricating anything new.
//
// CRITICAL FIX -- confirmed live (root-cause pipeline repair): none of
// the three competitor-row extraction tiers below validated that a
// captured "vendor" string actually LOOKS like a company/product name --
// so when the underlying competitiveLandscape text was un-gated model
// prose (e.g. this exact cache-degraded path), an entire evidence/
// citation sentence like "Pricing evidence: Westlaw Edge charges
// $89-$450/user/month..." could be captured whole as a "vendor name" -- a
// structural parsing failure, not a data problem. Mirrors vendor-
// discovery.ts's own isImplausibleCompetitorName heuristic (length/word-
// count bounds, markdown/parser-artifact characters, instruction-leading
// verbs) plus an explicit reject for the specific evidence/citation-label
// prefixes this exact failure mode produces (never a real company name).
// Applied as a per-row VENDOR-field gate only -- an implausible vendor is
// treated as missing, not fabricated; any other real fields the row
// captured survive untouched, and the row is only dropped entirely when
// nothing real remains.
function isImplausibleCompetitorNameOnScreen(name: string) {
  const trimmed = (name || "").trim();

  if (!trimmed) return true;
  if (trimmed.length > 60) return true;
  if (trimmed.includes("...") || trimmed.includes("…")) return true;
  if (/[[\]{}`|]|https?:\/\/|www\.|\.(?:com|org|net|edu|gov|io)\b/i.test(trimmed)) return true;
  if (
    /^(?:conduct|analyz[e]?|generate|write|provide|summarize|summarise|explain|list|identify|assess|evaluate|create|perform|produce|research|describe|compare|review|investigate|determine|prepare|draft|compile|outline)\b/i.test(
      trimmed
    )
  )
    return true;
  if (
    /^(?:pricing evidence|market relevance|confidence|validation(?:\s+status)?|evidence|source|citation|methodology|assumption|coverage|note|reference)\s*:/i.test(
      trimmed
    )
  )
    return true;
  if (trimmed.split(/\s+/).length > 6) return true;

  return false;
}

function extractFlattenedMarketIntelligenceCompetitorRows(content: string) {
  const normalized = (content || "").replace(/\*\*/g, "");
  const bulletLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-\s+\S/.test(line));

  const read = (fieldMap: Array<[string, string]>, keys: string[]) => {
    for (const [key, value] of fieldMap) {
      if (keys.some((k) => key.includes(k))) return value;
    }
    return "";
  };

  return bulletLines
    .map((line) => {
      const withoutBullet = line.replace(/^-\s+/, "");
      const emDashIndex = withoutBullet.indexOf(" — ");
      const vendor = (emDashIndex >= 0 ? withoutBullet.slice(0, emDashIndex) : withoutBullet).trim();
      const fieldsText = emDashIndex >= 0 ? withoutBullet.slice(emDashIndex + 3) : "";
      const fieldMap = fieldsText
        .split("; ")
        .map((pair): [string, string] | null => {
          const colonIndex = pair.indexOf(": ");
          return colonIndex < 0
            ? null
            : [pair.slice(0, colonIndex).trim().toLowerCase(), pair.slice(colonIndex + 2).trim()];
        })
        .filter((pair): pair is [string, string] => pair !== null);

      return {
        vendor,
        category: read(fieldMap, ["category"]),
        position: read(fieldMap, ["segment", "ai capability", "position", "positioning"]),
        strengths: read(fieldMap, ["strength"]),
        weaknesses: read(fieldMap, ["weakness"]),
        relevance: read(fieldMap, ["market relevance"]),
        validationStatus: read(fieldMap, ["confidence"]),
      };
    })
    .map((row) => ({ ...row, vendor: isImplausibleCompetitorNameOnScreen(row.vendor) ? "" : row.vendor }))
    .filter((row) => row.vendor || row.strengths || row.weaknesses)
    .slice(0, 20);
}

// CRITICAL FIX -- confirmed live: Competitive Landscape's table has a
// narrow, brittle format requirement (an unbroken "| a | b | c |" block),
// while Major Players' bullet list (built from the exact same
// evidence-backed vendor set -- see market-intelligence-graph.ts's
// projectMarketIntelligenceGraphToReport, which always sets both fields
// from the same renderableVendors array together) tolerates almost any
// shape, since the generic bullet extractor used elsewhere just needs a
// line starting with "-". That asymmetry let a real, live contradiction
// through: Competitive Landscape showing "Validation Needed" while Major
// Players, immediately below, named real vendors (e.g. "Autodesk
// Construction Cloud") from that identical vendor set. This reads Major
// Players' own real bullet line shape ("- Vendor (Label): Classifications;
// target customer: X (ranking: N/100; overall score: N/100; confidence:
// N/100 Level; [ids])") as a last-resort source of the SAME authoritative
// vendor data, rather than a fabricated stand-in -- vendor/category/
// position map directly from real text; strengths/weaknesses/relevance
// stay empty since Major Players' own format never states them.
function extractMarketIntelligenceCompetitorRowsFromMajorPlayers(majorPlayersContent: string) {
  const normalized = (majorPlayersContent || "").replace(/\*\*/g, "");
  const bulletLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-\s+\S/.test(line));

  return bulletLines
    .map((line) => {
      const match = line.match(/^-\s+(.+?)\s+\(([^)]+)\):\s*([^;]+);[^:]*:\s*([^(]+)\(([^)]*)\)/);

      if (!match) {
        return null;
      }

      const [, vendor, majorPlayerLabel, classifications, , metrics] = match;
      const confidenceMatch = metrics.match(/confidence[^:]*:\s*([^;]+)/i);

      return {
        vendor: vendor.trim(),
        category: majorPlayerLabel.trim(),
        position: classifications.trim(),
        strengths: "",
        weaknesses: "",
        relevance: "",
        validationStatus: confidenceMatch?.[1]?.trim() || "",
      };
    })
    .filter(
      (row): row is NonNullable<typeof row> =>
        row !== null && Boolean(row.vendor) && !isImplausibleCompetitorNameOnScreen(row.vendor)
    )
    .slice(0, 20);
}

// CRITICAL FIX -- confirmed live: real Major Players content can be
// grouped/prose bullets with no parenthetical label immediately after the
// name at all (e.g. "- Thomson Reuters / CoCounsel / Westlaw Edge:
// AI-powered legal research and contract platform..."), which fails the
// row extractor above at its very first capture boundary (it requires
// "Name (Label): ..."). That produced a real, live contradiction: this
// section's own table said "no competitor data could be validated" while
// Major Players, immediately below, named real, validated vendors. This is
// a 4th, last-resort tier: it never fabricates category/position/
// strengths/weaknesses (an empty cell would misrepresent unknown structure
// as verified-absent) -- it extracts ONLY the plausible name segment(s)
// from each bullet, splitting a grouped "A / B / C" entry into separate
// candidate names, and returns names alone. Callers must render this as
// its own distinct state (validated identities, but not enough structure
// for a comparison matrix) rather than blending it into the full-row
// table. Mirrors page.tsx's own extractMarketIntelligenceCompetitorNamesOnly.
function extractMarketIntelligenceCompetitorNamesOnly(majorPlayersContent: string) {
  const normalized = (majorPlayersContent || "").replace(/\*\*/g, "");
  const bulletLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-\s+\S/.test(line));

  const names: string[] = [];

  for (const line of bulletLines) {
    // Strip URLs before splitting on ":" -- a bare "https://" scheme's own
    // colon would otherwise be mistaken for the name/label separator,
    // leaving a bogus "https" candidate.
    const withoutBullet = line.replace(/^-\s+/, "").replace(/https?:\/\/\S+/gi, "");
    const nameSegment = withoutBullet.split(/\s*[:(]|\s+—\s+/)[0]?.trim() || "";

    if (!nameSegment) continue;

    const candidates = nameSegment
      .split(/\s*\/\s*|,\s*/)
      .map((candidate) => candidate.trim())
      .filter(Boolean);

    for (const candidate of candidates) {
      // isImplausibleCompetitorNameOnScreen's evidence/label-phrase reject
      // ("market relevance:", "confidence:", ...) only fires when the
      // colon is still attached -- nameSegment already stripped it during
      // the name/label split above, so re-attach one here purely for this
      // check (never part of the stored name itself).
      if (!isImplausibleCompetitorNameOnScreen(`${candidate}:`) && !names.includes(candidate)) {
        names.push(candidate);
      }
    }
  }

  // CRITICAL FIX -- confirmed live: real Major Players content is not
  // always bulleted at all -- when the deterministic graph splice that
  // normally produces the "- Vendor (Label): ..." bulleted shape isn't
  // applied (e.g. a cached research bundle with no preserved graph),
  // whatever the model itself wrote for this field can be a single prose
  // paragraph naming vendors inline (e.g. "Evidence-supported major
  // players in this market include Procore, Autodesk Construction Cloud,
  // OpenSpace, and Buildots..."), with no bullet markers for the tier
  // above to split on at all -- reproducing the exact reported
  // contradiction (Competitive Landscape saying no data validated while
  // Major Players plainly names real vendors). Only tried when the
  // bulleted tier found nothing; extracts names from the SAME
  // "include/such as/like/named" list-introducing shape prose lists
  // almost always use, never fabricating category/position/strengths/
  // weaknesses here either. Mirrors page.tsx's identical fix.
  if (names.length === 0) {
    const proseWithoutUrls = normalized.replace(/https?:\/\/\S+/gi, "");
    const nameListGroup =
      "((?:[A-Z][\\w&.'-]*(?:\\s+[A-Z][\\w&.'-]*){0,3})(?:\\s*,\\s*(?:and\\s+)?[A-Z][\\w&.'-]*(?:\\s+[A-Z][\\w&.'-]*){0,3})*(?:\\s+and\\s+[A-Z][\\w&.'-]*(?:\\s+[A-Z][\\w&.'-]*){0,3})?)";
    // Tier 2a: predicate-leading prose ("major players include X, Y, and
    // Z", "such as X, Y, Z", "led by X, Y, Z").
    const predicateLeadingMatch = proseWithoutUrls.match(
      new RegExp(
        `\\b(?:include|includes|including|such as|like|named|led by|dominated by|anchored by)\\s+${nameListGroup}`
      )
    );
    // P0 PRODUCTION FIX -- confirmed live (Market Intelligence report-
    // isolation-adjacent research-quality failure, Task #12): mirrors
    // page.tsx's identical fix -- the predicate-leading pattern above only
    // covers ONE of two equally common ways a model introduces a vendor
    // list; the exact reported production shape ("Ironclad, Evisort,
    // DocuSign CLM, and LawGeex are established competitors in this
    // space") is SUBJECT-leading, which the prior pattern never matched
    // at all. Tier 2b covers this second shape: a name list immediately
    // followed by "are/is (adjective) competitors/players/vendors/...",
    // reusing the EXACT SAME name-list capture group as tier 2a.
    const subjectLeadingMatch = proseWithoutUrls.match(
      new RegExp(
        `${nameListGroup}\\s+(?:are|is)\\s+(?:the\\s+)?(?:established|leading|key|major|notable|primary|prominent|main|top)?\\s*(?:competitors?|players?|vendors?|providers?|companies|solutions?|options?)\\b`
      )
    );
    // P0 PRODUCTION FIX -- confirmed live (Task #14): real Major Players
    // prose can introduce its name list with neither a predicate trigger
    // word before it NOR an "are/is ... competitors" clause after it --
    // just a plain colon, e.g. "Only evidence-supported major players in
    // the supplied registry: Ironclad, Evisort, DocuSign CLM, and
    // LawGeex." Neither tier 2a/2b anchor matches this shape. Tier 2c
    // anchors on the colon itself: a name list immediately after a colon,
    // with nothing else before the sentence ends (period/newline/end of
    // string) -- deliberately not open-ended, so a colon-introduced clause
    // that continues past the list into further prose does not match at
    // all, rather than truncating mid-sentence into a partial capture.
    const colonLeadingMatch = proseWithoutUrls.match(new RegExp(`:\\s*${nameListGroup}\\s*(?:[.\\n]|$)`));
    const listMatch = predicateLeadingMatch || subjectLeadingMatch || colonLeadingMatch;

    if (listMatch?.[1]) {
      const candidates = listMatch[1]
        .split(/\s*,\s*|\s+and\s+/)
        .map((candidate) =>
          candidate
            .replace(/^and\s+/i, "")
            // A name at the end of a captured list can swallow the
            // sentence's own trailing period -- only stripped from the
            // LAST character, never from the middle of a name (so real
            // abbreviations like "Corp." elsewhere in the list survive).
            .replace(/\.$/, "")
            .trim()
        )
        .filter(Boolean);

      for (const candidate of candidates) {
        if (!isImplausibleCompetitorNameOnScreen(`${candidate}:`) && !names.includes(candidate)) {
          names.push(candidate);
        }
      }
    }

    // P0 PRODUCTION FIX -- confirmed live against the REAL regenerated
    // report's own stored content (Task #15): Major Players is not always
    // one combined comma-separated list -- the model wrote one "Vendor --
    // description [citation]." entry per line, with the FIRST vendor
    // sharing a line with the intro clause and no "-" bullet marker
    // anywhere. None of the tiers above match this shape. This tier finds
    // each vendor independently: a short capitalized phrase (1-4 words)
    // immediately preceded by a line start, a newline, or a colon-
    // introduced clause, and immediately followed by " -- " (an em dash),
    // the model's own per-item label separator here. Anchoring on that
    // exact separator -- not just any capitalized word -- keeps this
    // safe: ordinary prose essentially never continues a colon or starts
    // a new line with "Word -- " unless it is genuinely introducing a
    // labeled item exactly like this.
    if (names.length === 0) {
      const emDashLabelPattern = /(?:^|\n|:\s+)([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\s+—\s+/g;

      for (const match of proseWithoutUrls.matchAll(emDashLabelPattern)) {
        const candidate = match[1]?.trim();

        if (candidate && !isImplausibleCompetitorNameOnScreen(`${candidate}:`) && !names.includes(candidate)) {
          names.push(candidate);
        }
      }
    }
  }

  return names.slice(0, 20);
}

function extractMarketIntelligenceCompetitorRowsFromTable(content: string) {
  const normalized = (content || "").replace(/\*\*/g, "");
  const tableRows = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|") && !/^\|\s*-/.test(line));

  if (tableRows.length <= 1) {
    return [];
  }

  const headers = tableRows[0]
    .split("|")
    .map((cell) => cell.trim().toLowerCase())
    .filter(Boolean);

  const read = (cells: string[], keys: string[]) => {
    const index = headers.findIndex((header) => keys.some((key) => header.includes(key)));
    return index >= 0 ? cells[index] || "" : "";
  };

  return tableRows
    .slice(1)
    .map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim()))
    .map((cells) => ({
      vendor: read(cells, ["vendor", "company", "competitor"]),
      category: read(cells, ["category"]),
      position: read(cells, ["segment", "ai capability", "position", "positioning"]),
      strengths: read(cells, ["strength"]),
      weaknesses: read(cells, ["weakness"]),
      relevance: read(cells, ["market relevance"]),
      // "Validation Status" reads the same Confidence classification
      // market-intelligence-graph.ts already computes per row (how many
      // independent sources back this entry) -- a distinct signal from
      // Market Relevance, never conflated with it.
      validationStatus: read(cells, ["confidence"]),
    }))
    // Defense-in-depth: the deterministic table is already filtered
    // server-side (isImplausibleCompetitorName), but this render-time
    // check never trusts that alone -- the same evidence-sentence-as-
    // vendor failure mode is possible here too if a model ever writes
    // its own "| a | b | c |" table without going through the graph.
    .map((row) => ({ ...row, vendor: isImplausibleCompetitorNameOnScreen(row.vendor) ? "" : row.vendor }))
    .filter((row) => row.vendor || row.strengths || row.weaknesses)
    .slice(0, 20);
}

// Tries, in order: the real table, the flattened-bullet shape, then Major
// Players' own bullet list (see its own comment above) -- the first tier
// to produce any real rows wins. Every tier reads only content already
// present in the payload; none fabricates a vendor.
function extractMarketIntelligenceCompetitorRows(content: string, majorPlayersContent = "") {
  const tableRows = extractMarketIntelligenceCompetitorRowsFromTable(content);
  if (tableRows.length > 0) {
    return tableRows;
  }

  const flattenedRows = extractFlattenedMarketIntelligenceCompetitorRows(content);
  if (flattenedRows.length > 0) {
    return flattenedRows;
  }

  return extractMarketIntelligenceCompetitorRowsFromMajorPlayers(majorPlayersContent);
}

// CRITICAL FIX -- confirmed live (root-cause pipeline repair): a
// section-intro/label line the model writes before its real numbered
// actions (e.g. "First 90 Days (three actions with owners, budgets,
// KPIs, and success criteria):", closely echoing this field's own prompt
// wording -- a known LLM failure mode) or the deterministic "Market Entry
// Recommendation"/"Why Entry Is Not Recommended Now" heading route.ts
// appends were both being treated as if they were themselves real
// recommendation sentences, rendering a fake "Action" card with prompt/
// heading scaffolding instead of real content. Mirrors market-
// intelligence-presentation.ts's own isHeadingOnlyLine heuristic (a line
// ending in ":" is a label, not a sentence) plus an explicit reject for
// the two known deterministic heading strings.
//
// CRITICAL FIX (Task #17) -- confirmed live against a REAL regenerated
// report: strategicRecommendations' own prompt (market.ts) asks the
// model to "state plainly whether the evidence supports entering,
// piloting, or avoiding this market" as its own opening verdict --
// which the model routinely writes as "Recommendation: Enter (evidence
// supports...)." / "Conviction: ..." / "Trade-offs: ..." sentences. These
// have a colon in the MIDDLE, not at the end, so the ":$" heading check
// above never caught them, and they were rendered verbatim as fake
// numbered "Action" cards -- reproducing the exact reported
// contradiction (this section's own "Action #1" literally read
// "Recommendation: Enter" while Executive Summary's canonical decision
// was MONITOR). These are Executive-Summary-owned verdict language, not
// action items, regardless of which decision they happen to state --
// excluded here unconditionally, the same way the deterministic heading
// strings above already are.
function isRecommendationHeadingLine(item: string) {
  if (/:$/.test(item)) return true;
  if (/^(?:first\s+90\s*-?\s*days?|market entry recommendation|why entry is not recommended now)\b/i.test(item)) {
    return true;
  }
  if (/^(?:recommendation|conviction|trade-?offs?)\s*:/i.test(item)) {
    return true;
  }

  return false;
}

// CRITICAL FIX (Task #18) -- see page.tsx's own identical function for the
// full rationale: every Market Intelligence field prompt ends with "Max N
// words," which the model often echoes back as a trailing self-check
// footnote ("(174 words)", "(Total 136 words)") that would otherwise be
// rendered as a malformed, content-free "Action" card. Anchored start-to-
// end so a real sentence mentioning a word count mid-thought is never
// rejected.
function isMetadataOnlyRecommendationLine(item: string) {
  return /^\(?\s*(?:total\s+)?\d+\s*words?\s*\)?\.?\s*$/i.test(item);
}

// Strategic Recommendations is inherently a list -- each real
// recommendation line rendered as its own card, rather than one long
// paragraph block. Falls back to sentence-splitting (same convention as
// extractBullets elsewhere in this file) when the content has no
// bullet/numbered markers.
function extractRecommendationItems(content: string) {
  const source = content || "";
  // CRITICAL FIX (Task #18) -- see page.tsx's own identical block for the
  // full rationale: a heading ("First 90 Days (three concrete
  // actions):") can share one physical line with its own first numbered
  // action, which the line-level heading check then discards entirely.
  // Inserting a real line break before any numbered marker that follows
  // a ":"/"." boundary lets the heading and the action be evaluated
  // separately, without risking a false split on decimals or citation
  // parentheticals (the marker must be preceded by list/sentence
  // punctuation, not just any digit).
  const normalizedSource = source.replace(/([:.])\s+(\d{1,2}[.)]\s+)/g, "$1\n$2");
  const bulletLines = normalizedSource
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\*\*/g, "")
        .trim()
    )
    .filter(
      (line) => line.length > 8 && !isRecommendationHeadingLine(line) && !isMetadataOnlyRecommendationLine(line)
    );

  if (bulletLines.length > 0) {
    return bulletLines.slice(0, 8);
  }

  return source
    .replace(/\*\*/g, "")
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 8 && !isMetadataOnlyRecommendationLine(line))
    .slice(0, 4);
}

// Best-effort inline signal extraction for a single recommendation line --
// strategicRecommendations' own prompt requires each First-90-Days action
// to name owners, a KPI, a success criterion, and a budget/spend ceiling
// as prose, not as machine-parseable "Owner: X" labels, so this surfaces
// only the signals that can be confidently read back out of that prose
// (an owner role/title, a timeframe, a percentage/numeric KPI) as small
// badges -- it never fabricates a value when the line does not genuinely
// contain one.
const recommendationOwnerRolePattern =
  "(?:CEO|CMO|CFO|COO|CTO|CPO|VP of \\w+|Head of \\w+|(?:regional|country|global) (?:GM|general manager)|product (?:lead|manager|owner)|growth (?:lead|manager)|sales (?:lead|manager)|marketing (?:lead|manager)|founder)";

function extractRecommendationSignals(line: string) {
  const timeframe = line.match(
    /\b\d+[\s-](?:day|days|week|weeks|month|months|gün|hafta|ay)\b|\bQ[1-4]\b|\b(?:this|next)\s+quarter\b/i
  )?.[0];
  // Budget (a spend ceiling) and success metric (a KPI/countable target)
  // are distinct signals strategicRecommendations' own prompt requires
  // separately -- kept apart here rather than one shared "metric" match,
  // so a line naming both (e.g. "$50K budget ... targeting 10 paying
  // pilots") surfaces both instead of only whichever pattern matched
  // first.
  const budget = line.match(/[€$₺]\s*\d+(?:[.,]\d+)*(?:\s*[kKmMbB])?/)?.[0];
  const metric =
    line.match(/\d+(?:[.,]\d+)?\s*%/)?.[0] ||
    line.match(/\b\d+\s+(?:paying\s+)?(?:pilots?|customers?|interviews?|conversions?|sign-?ups?|users?|leads?|deals?)\b/i)?.[0];
  const owner =
    line.match(new RegExp(`\\b(?:owned by|led by|driven by|owner:)\\s+(?:the\\s+)?(${recommendationOwnerRolePattern})\\b`, "i"))?.[1] ||
    line.match(new RegExp(`\\b(${recommendationOwnerRolePattern})\\b`, "i"))?.[1];
  // Decision Gate -- the checkpoint that determines whether to continue,
  // e.g. "... before committing further budget"/"before scaling
  // further". strategicRecommendations' own prompt requires a "numeric
  // or evidence-based success criterion that determines whether to
  // continue" for each action, so this phrasing is a real, expected
  // shape -- never fabricated when absent.
  const gate = line.match(
    /\bbefore\s+(?:committing\s+(?:further\s+)?(?:budget|spend)|scaling(?:\s+further)?|the\s+next\s+decision|proceeding|expanding|the\s+next\s+phase)\b[^.]*/i
  )?.[0];

  return {
    timeframe: timeframe?.trim() || "",
    metric: metric?.trim() || "",
    budget: budget?.trim() || "",
    owner: owner?.trim() || "",
    gate: gate?.trim() || "",
  };
}

// CRITICAL FIX -- do not reintroduce old fake-data behavior. Porter's
// Five Forces' intensity bars were a static, hardcoded array
// ([72, 54, 66, 48, 60]) -- identical for every report regardless of the
// generated content, which the section's own prompt explicitly instructs
// to give "a qualitative assessment ... for each force". This reads that
// real qualitative assessment (high/moderate/low and their synonyms)
// back out of the text near each force's own name, scoped to a bounded
// window so an intensity word describing a DIFFERENT force can't bleed
// into this one's reading. Returns null (never a guessed number) when no
// such signal is present for that force.
const forceAliases: Record<string, string[]> = {
  Rivalry: ["rivalry", "competitive rivalry", "rekabet yoğunluğu"],
  Entrants: ["threat of (?:new )?entr(?:y|ants)", "new entrants", "barriers? to entry", "giriş engeli"],
  "Buyer Power": ["buyer power", "bargaining power of buyers", "alıcı gücü"],
  Buyer: ["buyer power", "bargaining power of buyers", "alıcı gücü"],
  "Supplier Power": ["supplier power", "bargaining power of suppliers", "tedarikçi gücü"],
  Supplier: ["supplier power", "bargaining power of suppliers", "tedarikçi gücü"],
  // CRITICAL FIX (Task #19) -- see page.tsx's own identical entry for the
  // full rationale: a bare "Substitutes -- Moderate: ..." heading matched
  // neither existing alias, silently showing "Not specified" for real
  // content the model actually wrote.
  Substitutes: ["threat of substitutes?", "substitute products?", "substitutes", "ikame ürün"],
};

function extractForceIntensity(content: string, force: string) {
  const aliases = forceAliases[force] || [force];

  for (const alias of aliases) {
    const match = content.match(
      new RegExp(
        `(?:${alias})[^.\\n]{0,70}?\\b(high|strong|significant|intense|severe|yüksek|güçlü|moderate|medium|orta|low|weak|limited|minimal|düşük|zayıf)\\b`,
        "i"
      )
    );

    if (match) {
      const word = match[1].toLowerCase();

      if (/high|strong|significant|intense|severe|yüksek|güçlü/.test(word)) {
        return { level: "High", width: 82 };
      }
      if (/moderate|medium|orta/.test(word)) {
        return { level: "Moderate", width: 55 };
      }
      return { level: "Low", width: 28 };
    }
  }

  return null;
}

// Porter's Five Forces' own prompt requires "a qualitative assessment
// and ONE MARKET IMPLICATION for each force" -- this reads that real
// sentence back out of the generated text (the same sentence
// extractForceIntensity reads the intensity word from) to show as the
// card's investor interpretation, rather than only a bare intensity
// label. Returns "" (never a fabricated implication) when the force
// isn't discussed in its own sentence.
function extractForceImplication(content: string, force: string) {
  const aliases = forceAliases[force] || [force];

  for (const alias of aliases) {
    const match = content.match(new RegExp(`[^.\\n]*\\b(?:${alias})\\b[^.\\n]*\\.`, "i"));

    if (match) {
      return match[0].trim().replace(/^[-*•]\s+/, "");
    }
  }

  return "";
}

// CRITICAL FIX (Task #19) -- see page.tsx's own identical function for
// the full rationale: every Porter's Five Forces card rendered with
// identical visual weight regardless of whether that specific force's
// own sentence cited real evidence ("[R23][R95]") or explicitly admitted
// it had none ("not evidenced directly in registry"). Reads only the
// already-displayed implication sentence; nothing new is scanned, and
// nothing is fabricated when neither signal is present.
function getForceEvidenceLevel(implication: string): EvidenceLevel {
  if (!implication) {
    return "validationRequired";
  }
  if (/\bnot\s+(?:directly\s+)?evidenced\b|\bno\s+(?:direct\s+)?evidence\b|\bunevidenced\b/i.test(implication)) {
    return "validationRequired";
  }
  if (/\[R\d+\]|\(R\d+(?:,\s*R\d+)*\)/.test(implication)) {
    return "benchmarkDerived";
  }

  return "validationRequired";
}

function extractRoadmapAction(content: string, step: string) {
  const aliases = roadmapStepAliases[step] || [step];
  const allAliases = Object.values(roadmapStepAliases).flat();
  const snippet =
    extractAliasedSectionSnippet(content, aliases, allAliases) ||
    aliases.map((alias) => extractKeywordInsight(content, [alias])).find(Boolean) ||
    "";
  const action = extractMeaningfulBullets(snippet, 1)[0] || cleanExecutiveText(snippet, 150);

  return action || "—";
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

type FinancialMetricConfidenceBadge = EvidenceLevel;

function getFinancialMetricConfidenceBadge(
  label: string,
  aliases: string[] | readonly string[],
  content: string,
  value: string
): FinancialMetricConfidenceBadge {
  const metricContext = normalizePdfText(
    `${label}\n${value}\n${extractMetricDetail(content, aliases)}`
  );

  return inferEvidenceLevel({ label, value, context: metricContext });
}

function cleanPdfEvidenceMetadataText(value: string) {
  return normalizePdfText(value)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();

      return !/^(?:[-*•]\s*)?(?:formula|assumptions?|varsayımlar|confidence|güven|evidence|validation evidence|validation needed|metadata|referans|raw evidence metadata|raw validation text|raw validation context|raw benchmark context|internal evidence keys?|benchmark(?:source| source| comparison)?)\s*[:=]/i.test(trimmed);
    })
    .map((line) =>
      line
        .replace(/\s*\|\s*(?:formula|assumptions?|varsayımlar|confidence|güven|evidence|validation evidence|validation needed|metadata|referans|raw evidence metadata|raw validation text|raw validation context|raw benchmark context|internal evidence keys?|benchmark(?:source| source| comparison)?)\s*[:=][^|\n]+/gi, "")
        .replace(/\b(?:formula|assumptions?|varsayımlar|confidence|güven|evidence|validation evidence|validation needed|metadata|referans|raw evidence metadata|raw validation text|raw validation context|raw benchmark context|internal evidence keys?|benchmarkSource|benchmark)\s*=\s*[^|;\n]+/gi, "")
        .replace(/\bplanning assumptions require validation\b[.;]?/gi, "")
        .trimEnd()
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildPdfFinancialMetricDetailLine(
  label: string,
  aliases: string[] | readonly string[],
  content: string,
  value: string
) {
  const compactValue = dedupePdfFinancialMetricValue(value) || "—";

  return `${label}: ${compactValue}`;
}

function getFinancialMetricConfidenceBadgeClass(badge: FinancialMetricConfidenceBadge) {
  return getEvidenceBadgeClass(badge);
}

function getDashboardEvidenceLabel(level: EvidenceLevel, locale: EvidenceLocale = "English") {
  return getEvidenceLabel(level, locale);
}

// PRODUCTION DATA PROVENANCE POLISH -- standardized to exactly three
// user-facing categories across Financial Dashboard, Unit Economics, and
// KPI Dashboard: Verified (falls through to getDashboardEvidenceLabel
// below), Derived (a value calculated only from verified data, e.g. ARR
// from a stated MRR -- never shown as Verified), and Benchmark /
// Assumption (a single, consolidated label -- the reader does not need
// to distinguish an industry benchmark from a planning assumption from
// an AI estimate to know the one thing that matters: this number was not
// supplied or derived from what was supplied). Distinct wording only,
// never a change to the underlying EvidenceLevel/[Verified]/[Estimated]/
// [Assumption] tag vocabulary the AI is prompted with and
// report-evidence-confidence.ts parses, which must stay exactly as-is.
const financialEvidenceBadgeLabels: Partial<Record<EvidenceLevel, Record<EvidenceLocale, string>>> = {
  // CRITICAL FIX -- "Verified" reads as an internal audit-tool label on
  // a financial metric card. This financial-only display wrapper (see
  // the comment above) already renames every non-verified tier; the
  // verified tier previously had no override and fell through to the
  // literal word. Naming it after the founder is also more informative
  // here specifically: a founder-stated financial figure (price,
  // investment, customer count) is what "verified" means in this
  // context, not third-party source verification.
  verified: {
    English: "Founder-Confirmed",
    Turkish: "Kurucu Onaylı",
    German: "Vom Gründer bestätigt",
    French: "Confirmé par le fondateur",
    Spanish: "Confirmado por el fundador",
  },
  derived: {
    English: "Derived",
    Turkish: "Türetilmiş",
    German: "Abgeleitet",
    French: "Dérivé",
    Spanish: "Derivado",
  },
  benchmarkDerived: {
    English: "Benchmark / Assumption",
    Turkish: "Benchmark / Varsayım",
    German: "Benchmark / Annahme",
    French: "Référence / Hypothèse",
    Spanish: "Referencia / Supuesto",
  },
  planningAssumption: {
    English: "Benchmark / Assumption",
    Turkish: "Benchmark / Varsayım",
    German: "Benchmark / Annahme",
    French: "Référence / Hypothèse",
    Spanish: "Referencia / Supuesto",
  },
  validationRequired: {
    English: "Benchmark / Assumption",
    Turkish: "Benchmark / Varsayım",
    German: "Benchmark / Annahme",
    French: "Référence / Hypothèse",
    Spanish: "Referencia / Supuesto",
  },
};

function getFinancialEvidenceBadgeLabel(level: EvidenceLevel, locale: EvidenceLocale = "English") {
  return financialEvidenceBadgeLabels[level]?.[locale] ?? getDashboardEvidenceLabel(level, locale);
}

// CRITICAL FIX -- do not present a planning assumption as actual
// performance. A founder-confirmed figure (evidence === "verified") is
// shown under its plain name; anything modeled or benchmark-derived is
// prefixed so the card title itself, not just the badge next to it,
// makes clear this is a scenario/estimate rather than a reported
// result. The prefix is chosen by what kind of figure it is: top-line
// revenue metrics read "Estimated", unit-economics ratios read
// "Planning", and forward-looking timing metrics (which are inherently
// scenario-dependent) read "Scenario".
function getFinancialMetricDisplayLabel(metricLabel: string, evidence: EvidenceLevel) {
  if (evidence === "verified") {
    return metricLabel;
  }

  const normalized = metricLabel.toLowerCase();
  if (/revenue|\barr\b|\bmrr\b/.test(normalized)) {
    return `Estimated ${metricLabel}`;
  }
  if (/runway|break-even|break even/.test(normalized)) {
    return `Scenario ${metricLabel}`;
  }
  return `Planning ${metricLabel}`;
}

function getSectionEvidenceLevel(section: ReportSection): EvidenceLevel {
  if (section.field === "sources" || section.field === "sourcesAssumptions") {
    return "verified";
  }

  // TAM/SAM/SOM gets its own canonical cascade-based derivation (see
  // resolveTamSamSomCascade's own comment) -- split out from
  // financialDashboard/unitEconomics below, which keep their prior,
  // unrelated Gross Margin-based derivation unchanged.
  if (section.field === "tamSamSom") {
    return getTamSamSomSectionEvidence(section.content);
  }

  if (section.field === "financialDashboard" || section.field === "unitEconomics") {
    return inferEvidenceLevel({
      label: section.title,
      value: extractMetricValue(section.content, "Gross Margin") || section.title,
      context: section.content,
    });
  }

  if (section.field === "kpiDashboard" || section.field === "kpis") {
    return "validationRequired";
  }

  if (section.field === "competitorAnalysis" || section.field === "competitorLandscape" || section.field === "marketOverview" || section.field === "marketOpportunity") {
    return "benchmarkDerived";
  }

  if (section.field === "executiveSummary") {
    return inferEvidenceLevel({
      label: section.title,
      value: extractMetricValue(section.content, "Decision") || extractMetricValue(section.content, "Recommendation") || section.title,
      context: section.content,
    });
  }

  return "planningAssumption";
}

// CRITICAL FIX -- remove internal system language from user-facing
// Market Intelligence output. The bare "Verified"/"Estimated"/
// "Assumption"/"AI Analysis" evidence-tier words (report-evidence.ts)
// are a deliberate, tested, cross-report-kind taxonomy and are left
// exactly as-is there -- this is a Market-Intelligence-only display
// wrapper, the same established pattern as financialEvidenceBadgeLabels
// above, so Business Plan and Acquisition's section badges are
// unaffected.
const marketEvidenceBadgeLabels: Partial<Record<EvidenceLevel, Record<EvidenceLocale, string>>> = {
  verified: {
    English: "Data Confirmed",
    Turkish: "Veri Onaylandı",
    German: "Daten bestätigt",
    French: "Données confirmées",
    Spanish: "Datos confirmados",
  },
  derived: {
    English: "Derived",
    Turkish: "Türetilmiş",
    German: "Abgeleitet",
    French: "Dérivé",
    Spanish: "Derivado",
  },
  benchmarkDerived: {
    English: "Market Support",
    Turkish: "Pazar Desteği",
    German: "Marktunterstützung",
    French: "Support de marché",
    Spanish: "Respaldo de mercado",
  },
  planningAssumption: {
    English: "Key Assumption",
    Turkish: "Temel Varsayım",
    German: "Kernannahme",
    French: "Hypothèse clé",
    Spanish: "Suposición clave",
  },
  validationRequired: {
    English: "Validation Status",
    Turkish: "Doğrulama Durumu",
    German: "Validierungsstatus",
    French: "Statut de validation",
    Spanish: "Estado de validación",
  },
};

function getMarketEvidenceBadgeLabel(level: EvidenceLevel, locale: EvidenceLocale = "English") {
  return marketEvidenceBadgeLabels[level]?.[locale] ?? getDashboardEvidenceLabel(level, locale);
}

function EvidenceBadge({
  level,
  locale = "English",
  market = false,
}: {
  level: EvidenceLevel;
  locale?: EvidenceLocale;
  market?: boolean;
}) {
  return (
    <span className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${getFinancialMetricConfidenceBadgeClass(level)}`}>
      {market ? getMarketEvidenceBadgeLabel(level, locale) : getDashboardEvidenceLabel(level, locale)}
    </span>
  );
}

// A TAM/SAM/SOM value with no currency symbol, unit, or percent sign
// attached is not a real figure a reader can act on -- see the matching
// guard and its rationale in ReportPdfButton.tsx's extractMarketSizeValue,
// which this on-screen renderer mirrors so the dashboard chart and the PDF
// chart never disagree on what counts as a meaningful value.
function isMarketSizeValueMeaningful(value: string) {
  if (!value.trim()) return false;
  return /[$€₺%]|\d\s*[kKmMbBtT]\b|\b(?:milyon|milyar|bin|thousand|million|billion|trillion)\b/i.test(
    value
  );
}

function extractMarketSizeValue(content: string, label: string) {
  const escapedLabel = escapeRegExp(label);
  // CRITICAL FIX -- confirmed live: market-intelligence-graph.ts's own
  // deterministic "Planning Estimate" backend writes each layer as
  // "TAM [Estimated]: $2.4M" -- a bracketed classification tag sitting
  // between the label and its value that this regex previously could not
  // see past (it required the value immediately after an optional
  // colon), silently reading such reports as if TAM/SAM/SOM had never
  // been stated -- the chart showed "Validation Needed" for a layer while
  // the report's own text plainly stated a dollar figure two words later.
  //
  // CRITICAL FIX -- confirmed live (second gap): the model's own natural
  // prose also writes "TAM (Total Addressable Market): USD 1.45B" -- a
  // parenthetical expansion of the label, and a 3-letter currency CODE
  // (USD/EUR/...) instead of a symbol -- neither of which the old narrow
  // "value must start immediately after the colon with an optional
  // symbol" pattern could match, so it fell through to the same
  // "Validation Needed" state a second, different way. Now tolerates an
  // optional "(...)" label expansion (in addition to the existing
  // "[...]" tag), and captures the REST of the line rather than trying to
  // enumerate every currency notation up front -- compactPdfMetricValue
  // (unchanged) still does the actual numeric narrowing below, exactly as
  // it already did for the extractMetricValue fallback path.
  const direct = normalizePdfText(content)
    .replace(/\*\*/g, "")
    .match(
      new RegExp(`\\b${escapedLabel}\\b\\s*(?:\\([^)\\n]{0,80}\\)\\s*)?(?:\\[[^\\]\\n]{0,40}\\]\\s*)?[:\\-–—]\\s*([^\\n]*)`, "i")
    )?.[1];

  const value = compactPdfMetricValue(direct || extractMetricValue(content, label));

  return isMarketSizeValueMeaningful(value) ? value : "";
}

// TAM/SAM/SOM values are ranges by design ("$2.1-2.8B"), so the
// magnitude used for chart scaling is the upper bound of the range --
// the last number+unit found in the string, not the first.
//
// CRITICAL FIX -- confirmed live (cross-surface audit): this only matched
// a single-letter unit ([kKmMbBtT]), so a spelled-out "thousand" matched
// just its leading "t" and was read as TRILLION -- a billion-fold
// misparse ("$200 thousand" -> 200,000,000,000,000 instead of 200,000).
// page.tsx's parseMonetaryMagnitude already tries the full unit word
// first for exactly this reason (thousand/trillion both start with "t");
// mirrored here so the dashboard, Planner, and exported PDF can never
// disagree on a TAM/SAM/SOM layer's resolved/nested state -- or the
// "Data Confirmed" evidence badge derived from it -- purely because one
// surface used a narrower unit parser than another.
function parseMarketSizeMagnitude(value: string): number | null {
  const matches = [...value.matchAll(/(\d+(?:[.,]\d+)?)\s*(thousand|million|billion|trillion|[kKmMbBtT])?/gi)];
  const last = matches.at(-1);
  if (!last) return null;

  const numeric = Number(last[1].replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const unit = (last[2] || "").toLowerCase();
  const multiplier =
    unit === "t" || unit === "trillion"
      ? 1e12
      : unit === "b" || unit === "billion"
        ? 1e9
        : unit === "m" || unit === "million"
          ? 1e6
          : unit === "k" || unit === "thousand"
            ? 1e3
            : 1;

  return numeric * multiplier;
}

const tamSamSomBarLabels = ["TAM", "SAM", "SOM"] as const;

// CRITICAL FIX -- confirmed live: the TAM/SAM/SOM per-layer bar visual
// (below) and the section-level evidence badge (getSectionEvidenceLevel)
// used two independent derivations that could disagree. The badge fell
// back to a naive keyword scan (inferEvidenceLevel) whose "value" input
// was the section's own static title whenever no metric line matched --
// and the honest "insufficient evidence" notice copy (market-intelligence-graph.ts)
// itself contains the word "verified" ("A verified market-size figure ...
// could not be established"), which that keyword scan read as a positive
// signal and returned "Data Confirmed" even though TAM/SAM/SOM were all
// unresolved. Both now derive from this single, deterministic cascade so
// they can never diverge again: a layer only counts as resolved once
// every layer above it in the TAM >= SAM >= SOM hierarchy is also
// resolved, exactly mirroring the nesting rule the bar visual has always
// enforced.
function resolveTamSamSomCascade(content: string) {
  const values = tamSamSomBarLabels.map((label) => extractMarketSizeValue(content, label));
  const magnitudes = values.map((value) => parseMarketSizeMagnitude(value));
  const tamResolved = magnitudes[0] !== null;
  const samResolved = tamResolved && magnitudes[1] !== null && magnitudes[1] <= (magnitudes[0] as number);
  const somResolved = samResolved && magnitudes[2] !== null && magnitudes[2] <= (magnitudes[1] as number);
  const allResolved = tamResolved && samResolved && somResolved;
  const anyEstimated =
    allResolved && tamSamSomBarLabels.some((label) => isMarketSizeEstimated(content, label));

  return { values, magnitudes, tamResolved, samResolved, somResolved, allResolved, anyEstimated };
}

// A section must never show "Data Confirmed" when TAM, SAM, or SOM is
// unresolved, pending its parent's validation, or only ever reached an
// [Estimated]/Planning Estimate figure -- a resolved-but-estimated stack
// is a planning estimate, not verified data, and must not read as
// confirmed either.
function getTamSamSomSectionEvidence(content: string): EvidenceLevel {
  const cascade = resolveTamSamSomCascade(content);

  if (!cascade.allResolved) {
    return "validationRequired";
  }

  return cascade.anyEstimated ? "benchmarkDerived" : "verified";
}

const tamCircleMaxRadius = 17;
const tamCircleMinRadius = 4;
const tamCircleDefaultRadii = [tamCircleMaxRadius, 12.5, tamCircleMinRadius + 4] as const;

// Radius scales with sqrt(value) so *area* -- not radius -- is
// proportional to the underlying market-size figure, matching how a real
// concentric market-sizing chart (the standard McKinsey/VC-deck device
// for TAM/SAM/SOM) communicates relative scale. Falls back to a fixed,
// always-legible set of decreasing radii whenever the parsed values are
// missing or don't make logical sense (SAM/SOM larger than their parent
// figure) rather than drawing a distorted or inverted diagram.
function computeTamSamSomRadii(
  tamValue: number | null,
  samValue: number | null,
  somValue: number | null
): readonly [number, number, number] {
  if (
    tamValue === null ||
    samValue === null ||
    somValue === null ||
    samValue > tamValue * 1.5 ||
    somValue > samValue * 1.5
  ) {
    return tamCircleDefaultRadii;
  }

  const scale = tamCircleMaxRadius / Math.sqrt(tamValue);
  const samRadius = Math.max(
    tamCircleMinRadius + 2,
    Math.min(tamCircleMaxRadius - 2, Math.sqrt(samValue) * scale)
  );
  const somRadius = Math.max(
    tamCircleMinRadius,
    Math.min(samRadius - 2, Math.sqrt(somValue) * scale)
  );

  if (!Number.isFinite(samRadius) || !Number.isFinite(somRadius)) {
    return tamCircleDefaultRadii;
  }

  return [tamCircleMaxRadius, samRadius, somRadius];
}

function looksLikePromptOrInstruction(value: string) {
  return /\b(based on the entire report|would you invest|should i invest|what do you think|section to generate|report quality rules|write only|business idea\s*\/\s*goal|system prompt|internal instruction|validation prompt)\b/i.test(
    value
  );
}

// Confirmed live: raw prompt text like "i want to build an AML/Fraud
// compliance platform..." was displayed verbatim as the report's business
// description, reading as a leftover chat instruction rather than a
// professional one-line summary. Stripping this filler opening reframes it
// as a plain noun phrase ("An AML/Fraud compliance platform...") -- the
// original meaning is unchanged, only the framing.
const leadingWantToPhrase =
  /^i\s+(?:want|would like|plan|am planning|need)\s+to\s+(?:build|create|start|launch|develop)\s+/i;

function sentenceCaseFirstLetter(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function getBusinessIdeaFromPrompt(value: string) {
  const cleaned = sentenceCaseFirstLetter(
    normalizePdfText(value)
      .replace(/^[-*•]\s*/, "")
      .replace(/\?+$/g, "")
      .trim()
      .replace(leadingWantToPhrase, "")
  );

  if (
    !cleaned ||
    looksLikePromptOrInstruction(cleaned) ||
    /\b(who is|what is|why|how|would|should|can you|tell me|analyze|compare)\b/i.test(
      cleaned
    )
  ) {
    return "";
  }

  return cleaned.slice(0, 180);
}

function deriveBusinessDescriptionFromSections(
  sourcePrompt: string,
  sections: ReportSection[]
) {
  const promptDescription = getBusinessIdeaFromPrompt(sourcePrompt);

  if (promptDescription) {
    return promptDescription;
  }

  for (const field of ["businessModel", "solution", "targetCustomer"]) {
    const content = sections.find((section) => section.field === field)?.content || "";
    const sentence = normalizePdfText(content)
      .replace(/[#*_`>-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .match(/^(.{32,220}?[.!?])(?:\s|$)/)?.[1];

    if (sentence) {
      return sentence;
    }
  }

  return "";
}

function isMobilityReportContent(content: string) {
  // Same fix as ReportPdfButton.tsx's isMobilityReportContent (the PDF
  // export's identical duplicate of this function): the previous loose
  // keyword list false-positived on ordinary, unrelated mentions of
  // common words like "rental"/"commuters" elsewhere in a non-mobility
  // report, mislabeling its on-screen Financial Dashboard with "Rider
  // CAC"/"Rider LTV". Matching the one deterministic
  // "Industry benchmark: Mobility / scooter rental" line every report's
  // Financial Assumptions always includes (financial-model.ts's
  // sharedAssumptions, set exactly when inputs.industryKey === "mobility")
  // ties this to the same signal the server actually used, eliminating
  // false positives from incidental word mentions anywhere else in the
  // report.
  return /\bIndustry benchmark:\s*Mobility \/ scooter rental\b|\bSektör referansı:\s*Mobilite \/ scooter kiralama\b/i.test(
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
  const tableScoreMatch = normalizePdfText(content).match(
    new RegExp(`\\|\\s*(?:\\*\\*)?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?\\s*\\|\\s*(\\d{1,3})(?:\\s*%|\\s*\\/\\s*100)?`, "i")
  );
  const fallbackMatch = content.match(
    new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\d]{0,30}(\\d{1,3})`, "i")
  );
  const rawScore = Number(scoreMatch?.[1] || tableScoreMatch?.[1] || fallbackMatch?.[1] || NaN);

  if (!Number.isFinite(rawScore)) {
    return null;
  }

  return Math.max(0, Math.min(100, rawScore));
}

function extractScoreFromAliases(content: string, aliases: string[] | readonly string[]) {
  for (const alias of aliases) {
    const score = extractScore(content, alias);

    if (score !== null) {
      return score;
    }
  }

  return null;
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

// FINAL PREMIUM REPORT RESTORATION -- Market Drivers/Barriers/
// Opportunities/Threats/Customer Segments/Major Players have no separate
// "methodology" the way TAM/SAM/SOM's formulas or Strategic
// Recommendations' owner/budget do -- their generated content IS the
// primary insight, so it must be visible without opening Details, not
// collapsed away. Deliberately strict (no sentence-splitting fallback,
// unlike extractBullets): only lines that already carry a real bullet/
// numbered marker in the model's own output count as "multiple items" --
// never fabricated by chopping prose into fake list items. Capped
// generously (8, not the old 4) so a genuinely longer ranked list is
// never silently cut -- this card is now the section's ONLY presentation
// (no more "Details" underneath to fall back on for the rest).
function extractRealBulletLines(content: string, limit = 8) {
  return (content || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+/.test(line) || /^\d+[.)]\s+/.test(line))
    .map((line) =>
      line
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\*\*/g, "")
        .trim()
    )
    .filter(Boolean)
    .slice(0, limit);
}

// extractSectionMainExplanation now lives in app/lib/report-presentation.ts
// (shared with page.tsx) -- see its own doc comment there for the
// per-line-first sentence-splitting fix that removed a residual
// Key-Takeaway/body duplication bug this local copy still had.

// FINAL PREMIUM REPORT RESTORATION -- these fields have no separate
// "methodology," their generated prose IS the primary insight, and
// downloadPdf's own visualFields (checked at drawPdfVisual/
// getPdfVisualHeight's own early-return guards) previously never listed
// them, so this PDF path drew NO visual at all for them -- not even the
// Key Takeaway box the on-screen PremiumSectionVisual now shows. This is
// that same highlighted Key Takeaway box, mirrored into this PDF path;
// the full body prose still draws below it unchanged (PDF has no
// "collapsed Details" to defer to, so nothing is shortened).
const pdfKeyTakeawayCardFields = new Set([
  "marketDrivers",
  "barriers",
  "opportunities",
  "threats",
  "customerSegments",
  "majorPlayers",
  "regionalAnalysis",
  "industryTrends",
  "marketSegmentation",
]);

// FINAL CLEANUP -- every field whose PDF visual (drawPdfVisual) is now
// enriched enough to be this section's COMPLETE presentation: TAM/SAM/SOM
// shows every layer's own real assumption sentence, Porter's shows every
// force's own real implication sentence, and Executive Summary/
// Competitive Landscape/Strategic Recommendations each already have their
// own dedicated, complete card. Drawing the raw section paragraph a
// second time below any of these would only repeat what the visual
// already fully communicates -- matches page.tsx's/this file's own
// on-screen cardFirstReportFields gate exactly, so web and PDF share the
// same presentation hierarchy.
//
// CRITICAL FIX -- confirmed live: marketSize/cagr were previously listed
// here too, on the assumption (per this comment's own prior text) that
// they "already have their own dedicated, complete card" -- but neither
// field is even in this file's own visualFields set below, so
// drawPdfVisual/getPdfVisualHeight never drew anything for them at all.
// With body text also suppressed, both sections rendered completely
// empty in this PDF export. Removed from this set so both fall back to
// the SAME "full body prose" treatment the pdfKeyTakeawayCardFields group
// above already uses successfully -- restoring their real evidence/
// reasoning text, never re-fabricating anything, and matching the
// equivalent restore already made on-screen and in ReportPdfButton.tsx.
//
// CRITICAL FIX -- confirmed live (root-cause repair): `...pdfKeyTakeawayCardFields`
// was ALSO spread into this set until now -- directly contradicting the
// comment on pdfKeyTakeawayCardFields itself (above), which explicitly
// promises "the full body prose still draws below it unchanged" for
// exactly those 9 fields (marketDrivers/barriers/opportunities/threats/
// customerSegments/majorPlayers/regionalAnalysis/industryTrends/
// marketSegmentation). In reality the spread forced sectionBodyContent to
// "" for every one of them too, so the ONLY thing that ever rendered was
// the 3-line-capped Key Takeaway box -- for majorPlayers specifically,
// this collapsed a full list of real named vendors (Thomson Reuters/
// CoCounsel/Westlaw Edge, LexisNexis/Lexis+ AI, Evisort, Fastcase,
// Litera/Kira, ...) down to a single truncated fragment of its own first
// sentence. Removed so all 9 fields get their real body prose back,
// matching what the surrounding comment always claimed was already true.
const pdfCompleteVisualFields = new Set([
  "executiveSummary",
  "tamSamSom",
  "strategicRecommendations",
  "portersFiveForces",
  "competitiveLandscape",
]);

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

function isMissingKpiText(value: string) {
  const trimmed = value.trim();

  return !trimmed ||
    /^1$/.test(trimmed) ||
    /\b1\s*(?:[-–—]\s*)?\/\s*(?:target\s*[:\-–—]?\s*)?1\b/i.test(value) ||
    /\b(?:value|metric|current|baseline|threshold|target)\s*[:\-–—]?\s*1\b/i.test(trimmed);
}

function extractCanonicalKpiSnippet(content: string, aliases: string[] | readonly string[]) {
  const normalizedContent = normalizePdfText(content);
  const lines = normalizedContent
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const alias of aliases) {
    const escapedAlias = escapeRegExp(alias);
    const labeledLine = lines.find((line) =>
      new RegExp(`^(?:[-*•]\\s*)?(?:\\*\\*)?${escapedAlias}(?:\\*\\*)?\\s*[:\\-–—]`, "i").test(line)
    );

    if (labeledLine) {
      return labeledLine
        .replace(new RegExp(`^(?:[-*•]\\s*)?(?:\\*\\*)?${escapedAlias}(?:\\*\\*)?\\s*[:\\-–—]\\s*`, "i"), "")
        .replace(/\*\*/g, "")
        .trim();
    }

    const tableLine = lines.find((line) =>
      new RegExp(`^\\|\\s*(?:\\*\\*)?${escapedAlias}(?:\\*\\*)?\\s*\\|`, "i").test(line)
    );

    if (tableLine) {
      return tableLine.replace(/\*\*/g, "").trim();
    }

    const objectLine = lines.find((line) =>
      new RegExp(`["']?(?:metric|kpi|name|label)["']?\\s*[:=]\\s*["']?${escapedAlias}["']?`, "i").test(line)
    );

    if (objectLine) {
      return objectLine.replace(/\*\*/g, "").trim();
    }
  }

  return "";
}

function extractKpiSnippet(content: string, aliases: string[] | readonly string[]) {
  return extractCanonicalKpiSnippet(content, aliases);
}

function extractKpiObjectField(snippet: string, fieldLabels: string[]) {
  if (!snippet) {
    return "";
  }

  const fieldPattern = fieldLabels.map(escapeRegExp).join("|");
  const stopPattern = [
    "owner",
    "sahip",
    "target",
    "hedef",
    "status",
    "durum",
    "trigger",
    "tetikleyici",
    "action",
    "aksiyon",
    "value",
    "değer",
    "current",
    "mevcut",
    "baseline",
    "metric",
  ]
    .filter((label) => !fieldLabels.includes(label))
    .map(escapeRegExp)
    .join("|");
  const normalizedSnippet = normalizePdfText(snippet).replace(/[{}"']/g, "");
  const match = normalizedSnippet.match(
    new RegExp(`(?:^|[|;,\\n])\\s*(?:${fieldPattern})\\s*[:=\\-–—]\\s*([\\s\\S]*?)(?=\\s*(?:[|;,\\n]|${stopPattern}\\s*[:=\\-–—]|$))`, "i")
  );
  const value = match?.[1]?.trim().replace(/\*\*/g, "") || "";

  // Genuinely not found: return empty (not the internal "Validation
  // Required" tag) so this shared helper's callers can fall through to
  // their own next extraction strategy or their own context-appropriate
  // user-facing fallback text. Same fix as ReportPdfButton.tsx's
  // identical extractKpiObjectField.
  return isMissingKpiText(value) ? "" : value;
}

function extractKpiQuantityValue(snippet: string) {
  const matches = normalizePdfText(snippet).match(
    /\d+(?:[.,]\d+)*(?:\.\d+)?\s*(?:customers?|users?|reports?|leads?|conversations?|accounts?|orders?|sales|revenue|activation|retention|conversion|%)/gi
  );

  return matches?.at(-1)?.trim() || "";
}

function extractKpiValueFromSnippet(
  snippet: string,
  aliases: string[] | readonly string[],
  isPercentage: boolean
) {
  const explicitValue = extractKpiObjectField(snippet, ["value", "değer", "current", "mevcut", "baseline", "metric"]);
  const targetValue = extractKpiObjectField(snippet, ["target", "hedef"]);
  const quantityValue = extractKpiQuantityValue(snippet);
  // Same fix as ReportPdfButton.tsx's identical extractKpiValueFromSnippet:
  // a bare 1-3 digit number with no unit word attached (extractScore) is
  // only safe to render as "N%" for metrics that are genuinely 0-100%
  // completion/funnel figures. For everything else (Revenue, WTP, Sales
  // cycle) guessing "%" produces the same CAC bug this was fixed for
  // ("$51" rendered as "51%"); an honest "not yet measured" fallback
  // (never the internal "Validation Required" tag) is used instead.
  const score = isPercentage ? extractScoreFromAliases(snippet, aliases) : null;
  const value = explicitValue ||
    targetValue ||
    quantityValue ||
    (score === null ? "" : `${score}%`) ||
    "";

  // Also guards a genuinely empty value: the drawing code's own fallback
  // for a falsy card value independently recomputes a bare score and
  // appends "%" with no isPercentage awareness at all, so leaving
  // `value` as "" here would let that same wrong-unit bug resurface
  // downstream for every non-percentage metric, not just CAC.
  return !value || isMissingKpiText(value) ? "Not yet measured" : value;
}

function extractKpiValueFromAliases(
  content: string,
  aliases: string[] | readonly string[],
  isPercentage: boolean
) {
  return extractKpiValueFromSnippet(extractKpiSnippet(content, aliases), aliases, isPercentage);
}

function extractKpiTargetFromSnippet(snippet: string) {
  const target = extractKpiObjectField(snippet, ["target", "hedef"]);
  const cleanTarget = target ? compactPdfMetricValue(target) || target : "";

  return isMissingKpiText(cleanTarget) ? "To be defined" : cleanTarget;
}

function extractKpiTargetFromAliases(content: string, aliases: string[] | readonly string[]) {
  return extractKpiTargetFromSnippet(extractKpiSnippet(content, aliases));
}

function extractKpiStatusFromSnippet(snippet: string, aliases: string[] | readonly string[]) {
  const status = extractKpiObjectField(snippet, ["status", "durum"]);

  if (status) {
    return status;
  }

  return (extractScoreFromAliases(snippet, aliases) ?? 0) >= 70 ? "On track" : "Watch";
}

function extractKpiStatusFromAliases(content: string, aliases: string[] | readonly string[]) {
  return extractKpiStatusFromSnippet(extractKpiSnippet(content, aliases), aliases);
}

function extractKpiOwnerFromAliases(content: string, aliases: string[] | readonly string[]) {
  return extractKpiObjectField(extractKpiSnippet(content, aliases), ["owner", "sahip"]);
}

function extractKpiTriggerFromAliases(content: string, aliases: string[] | readonly string[]) {
  return extractKpiObjectField(extractKpiSnippet(content, aliases), ["trigger", "tetikleyici"]);
}

function extractKpiActionFromAliases(content: string, aliases: string[] | readonly string[]) {
  return extractKpiObjectField(extractKpiSnippet(content, aliases), ["action", "aksiyon"]);
}

function normalizePdfKpiMetrics(content: string) {
  return kpiDashboardMetrics.map((metric) => {
    const value = extractKpiValueFromAliases(content, metric.aliases, metric.isPercentage);
    const target = extractKpiTargetFromAliases(content, metric.aliases);
    const status = extractKpiStatusFromAliases(content, metric.aliases);
    const owner = extractKpiOwnerFromAliases(content, metric.aliases);
    const trigger = extractKpiTriggerFromAliases(content, metric.aliases);
    const action = extractKpiActionFromAliases(content, metric.aliases);
    const score = extractScoreFromAliases(content, metric.aliases);

    return {
      label: metric.label,
      aliases: metric.aliases,
      value,
      target,
      status,
      owner,
      trigger,
      action,
      score,
    };
  });
}

function normalizePdfFounderScoreMetrics(content: string, investmentScore?: ReportInvestmentScore) {
  const textScoreValues = [
    readFounderReadinessMetricValue("Founder Readiness Score", investmentScore, content),
    readFounderReadinessMetricValue("Idea Quality", investmentScore, content),
    readFounderReadinessMetricValue("Market Attractiveness", investmentScore, content),
    readFounderReadinessMetricValue("Business Model Quality", investmentScore, content),
    readFounderReadinessMetricValue("Validation Confidence", investmentScore, content),
    readFounderReadinessMetricValue("Execution Complexity", investmentScore, content),
    readFounderReadinessMetricValue("Evidence Confidence", investmentScore, content),
    readFounderReadinessMetricValue("Founder Evidence", investmentScore, content),
  ];
  const dimensionScoreValues = textScoreValues.slice(1);

  return founderScorePdfDimensionMetrics.map((metric) => ({
    label: metric.label,
    aliases: metric.aliases,
    score:
      dimensionScoreValues[founderScorePdfDimensionMetrics.findIndex((item) => item.label === metric.label)] ??
      readFounderReadinessMetricValue(metric.label, investmentScore, content),
  }));
}

function buildPdfFounderScoreCards(
  content: string,
  investmentScore: ReportInvestmentScore | undefined,
  locale: PdfLocale
) {
  return normalizePdfFounderScoreMetrics(content, investmentScore).map((metric) => ({
    label: localizePdfPresentationLabel(metric.label, locale),
    score: metric.score,
  }));
}

function getPdfSectionCardTitle(section: ReportSection, locale: PdfLocale) {
  if (section.field === "founderScore") {
    return locale === "tr" ? "Kurucu Hazırlık Boyutları" : "Founder Readiness Dimensions";
  }

  return section.title;
}

function getPdfTocEntryTitle(section: ReportSection, locale: PdfLocale) {
  if (/\b(?:Validation Intelligence|Doğrulama Zekası)\b/i.test(section.content)) {
    return localizePdfPresentationLabel("Validation Intelligence", locale);
  }

  return section.title;
}

// The Competitive Landscape/competitor visual above already renders every
// row of market-intelligence-graph.ts's markdown table as a real table --
// without this, the section's own raw body text (drawn below the visual,
// same as every other section) would dump that SAME markdown table a
// second time as literal, unformatted "| Vendor | Category | ... |" pipe
// syntax. Strips only table row/separator lines, keeping any genuine
// surrounding commentary the model wrote outside the table.
function stripPdfMarkdownTableLines(content: string) {
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("|") && trimmed.endsWith("|"));
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  const cleaned = removeDuplicatePdfExecutiveInsightText(
    normalizePdfTamSamSomOwnershipContent(financialContent, { title })
  );

  if (normalizedTitle.includes("competitive landscape") || normalizedTitle.includes("competitor")) {
    return stripPdfMarkdownTableLines(cleaned);
  }

  return cleaned;
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

function formatPdfCitationContent(content: string, realEstate = false) {
  const sourceContent = normalizePdfSourceContent(
    normalizePdfFinancialSectionContent(content, {
      field: "sourcesAssumptions",
      title: "Sources / Assumptions",
    })
  );
  const citations = parseCitations(sourceContent);
  const methodologyBlock = realEstate
    ? [
        "Real Estate Evidence & Due-Diligence Methodology",
        "Uploaded asset facts are extracted first and kept separate from external evidence. External research coverage records completed, not-found, unavailable, failed, and timed-out tasks. Valuation is gated by confirmed location, parcel size and unit, zoning or land use, sufficient comparables, currency, and an explicit calculation method. Confidence falls with missing or conflicting evidence. Unresolved unknowns remain visible, and this report does not replace title, planning, survey, legal, environmental, geotechnical, or licensed valuation due diligence.",
      ].join("\n")
    : [
        "Methodology & Assumptions",
        "Market sizing, financial projections and KPI estimates are based on available market signals, benchmark data and planning assumptions.",
      ].join("\n");

  if (citations.length === 0) {
    if (realEstate) {
      return [
        "• Uploaded Asset Evidence",
        "  Type: Primary document or image evidence",
        "• Official Planning and Cadastral Research",
        "  Type: Authoritative verification required",
        "• Comparable Market Research",
        "  Type: Dated external market evidence required",
        "• Unresolved Due-Diligence Items",
        "  Type: Missing evidence acquisition plan",
        "",
        methodologyBlock,
      ].join("\n");
    }
    // Confirmed live: this used to render internal provenance/methodology
    // categories ("Market Comparisons", "Financial Comparisons", etc.) as
    // "• Label" / "  Type: ..." bullets -- the exact same visual shape as
    // a real cited source a few lines below (source.sourceName / "Source
    // type: ..."). A reader had no way to tell these apart from genuine
    // external citations. When there are zero real citations, say so
    // plainly under its own heading, kept visually distinct from (never
    // styled like) a source entry, and let the methodology note below
    // explain what the report's figures are actually derived from
    // instead.
    return [
      "External Sources: none available for this report.",
      "",
      methodologyBlock,
      "No primary research or externally verifiable citation currently backs this report's figures -- they are derived from industry benchmark comparisons, financial benchmark/planning assumptions, and internal modeling. Primary research would raise confidence further.",
    ].join("\n");
  }

  const finalDedupeSources = getFinalDedupePdfSources(citations);
  const sourceLines = finalDedupeSources
    .slice(0, 8)
    .map((source) =>
      [
        `• ${source.sourceName}`,
        // Source type / Publisher / Year / URL / Confidence are only
        // rendered when a real value actually exists -- confirmed live,
        // an unavailable field used to still print its label with an
        // empty or placeholder value ("Publisher:", "Year: Not
        // specified", "URL: Not provided"), which reads as broken/
        // fabricated metadata rather than simply absent information.
        ...(source.sourceType ? [`  Source type: ${source.sourceType}`] : []),
        ...(source.publisher ? [`  Publisher: ${source.publisher}`] : []),
        ...(source.publicationYear ? [`  Year: ${source.publicationYear}`] : []),
        ...(source.url ? [`  URL: ${source.url}`] : []),
        ...(source.trustLabel ? [`  Confidence: ${source.trustLabel}`] : []),
      ].join("\n")
    )
    .join("\n");

  return `${sourceLines}\n\n${methodologyBlock}`;
}

function formatPdfReadableContent(
  section: ReportSection,
  founderReadinessScore?: number | null,
  realEstate = false
) {
  if (isSourceLikeSection(section)) {
    return formatPdfCitationContent(section.content, realEstate);
  }

  // FINAL CLEANUP -- these fields' visuals (drawPdfVisual) are now each
  // section's COMPLETE presentation (see pdfCompleteVisualFields' own
  // comment) -- their raw paragraph never draws a second time below the
  // visual. Every other section keeps its existing body text, unchanged.
  if (
    pdfCompleteVisualFields.has(section.field ?? "") ||
    section.field === "tamSamSom" ||
    isTamSamSomTitle(section.title)
  ) {
    return "";
  }

  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
  // presentation hardening): pdfKeyTakeawayCardFields' own Key Takeaway box
  // (drawPdfVisual) reads getSectionTakeaway(section.content) directly off
  // raw content, while this function -- until now -- fed that SAME raw
  // content straight through to the body paragraph below it, so the boxed
  // takeaway sentence rendered a second time as the body's own opening
  // sentence. Stripping it here (mirrors ReportPdfButton.tsx's identical
  // sectionContentWithoutTakeawayDuplication fix) removes the duplicate
  // while the full remaining body prose still draws unchanged.
  const sourceContent = pdfKeyTakeawayCardFields.has(section.field ?? "")
    ? stripLeadingTakeawaySentence(section.content, getSectionTakeaway(section.content))
    : section.content;
  const content = removeDuplicateVisualText(
    section.title,
    section.field === "founderScore"
      ? normalizeFounderReadinessScoreText(section.content, founderReadinessScore)
      : sourceContent
  );
  const normalized = cleanPdfLegacyValidationIntelligenceContent(
    cleanPdfEvidenceMetadataText(content)
  );

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

// CRITICAL FIX -- confirmed live (production report on a real market):
// the exact-fingerprint check below (strip a small decision-word
// stoplist, then require byte-identical normalized text) only ever
// caught two candidates that were nearly IDENTICAL already -- it could
// not recognize the same underlying insight restated with different
// wording, e.g. "risk" and "opportunity" -shaped extraction both landing
// on essentially the same "Platform module commoditization --
// Autodesk/Procore embedding AI features reduces..." claim with a
// different lead-in phrase or punctuation. Now also runs
// describesSameInsight (report-content-quality.mjs) -- the same
// containment/Jaccard token-overlap semantic-similarity check the
// report's own cross-section paragraph dedup already uses -- against
// every PREVIOUSLY ACCEPTED candidate, so a near-identical restatement is
// collapsed into the first (fuller-context) occurrence instead of
// appearing twice. Genuinely distinct risks/opportunities (low token
// overlap) are always kept; nothing is dropped merely for sharing a topic
// or a common word.
function dedupeHighlightCandidates(candidates: string[]) {
  const seen = new Set<string>();
  const acceptedSignatures: ReturnType<typeof createInsightSignature>[] = [];

  return candidates
    .map((highlight) => highlight.trim())
    .filter((highlight) => {
      if (!highlight) {
        return false;
      }

      const fingerprint = highlight
        .toLowerCase()
        .replace(/[*_`#>-]/g, "")
        .replace(/\b(?:decision|opportunity|risk|action|validation|karar|fırsat|risk|aksiyon|doğrulama)\b/g, "")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();

      if (!fingerprint || seen.has(fingerprint)) {
        return false;
      }

      const signature = createInsightSignature(highlight);
      if (acceptedSignatures.some((previous) => describesSameInsight(signature, previous))) {
        return false;
      }

      seen.add(fingerprint);
      acceptedSignatures.push(signature);
      return true;
    })
    .slice(0, 5);
}

// CRITICAL FIX -- confirmed live: Market Intelligence's deterministic
// Executive Decision banner has real, clearly labeled Why/Top 3 Risks/
// Immediate Next Action/What Evidence Is Missing fields -- the generic
// keyword search below (built for Business Plan's free-flowing prose)
// ignores that structure entirely, and its own fallback
// (extractKeywordInsight's `lines[0]`, used whenever a keyword isn't
// found anywhere in the section) can surface a completely unrelated
// opening line as if it were "the risk" or "the next action". Sources
// highlights from the SAME locale-agnostic labeled fields the PDF's own
// Executive Decision card already reads, never a keyword scan of
// arbitrary prose. Mirrors page.tsx's identical fix.
function getMarketIntelligenceExecutiveHighlights(content: string) {
  const candidates = [
    extractMetricValueFromAliases(content, localizedLabelVariants("why")),
    takeFirstListItem(extractMetricValueFromAliases(content, localizedLabelVariants("topRisks"))),
    extractMetricValueFromAliases(content, localizedLabelVariants("immediateNextAction")),
    takeFirstListItem(extractMetricValueFromAliases(content, localizedLabelVariants("missingEvidence"))),
  ];

  return dedupeHighlightCandidates(candidates);
}

function getExecutiveHighlights(content: string) {
  const candidates = [
    extractKeywordInsight(content, ["decision", "recommendation", "karar", "tavsiye"]),
    extractKeywordInsight(content, ["opportunity", "market", "pazar", "tam", "sam", "som"]),
    extractKeywordInsight(content, ["risk", "threat", "tehdit"]),
    extractKeywordInsight(content, ["next action", "critical action", "action", "validate", "aksiyon", "doğrula"]),
    extractKeywordInsight(content, ["validation", "evidence", "confidence", "doğrulama", "kanıt", "güven"]),
    extractFirstInsight(content),
  ];

  return dedupeHighlightCandidates(candidates);
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
  // CRITICAL ARCHITECTURE FIX -- also recognize the centralized
  // executive decision vocabulary's own codes and rendered labels
  // (executive-decision-vocabulary.ts), so the "Decision" KPI card's
  // color coding still applies now that its value can be the canonical
  // label ("Proceed with Conditions") rather than each report kind's
  // own raw word.
  if (decision === "GO" || decision === "VALIDATE" || decision === "RAISE" || decision === "BOOTSTRAP" || decision === "PROCEED" || decision === "Proceed") {
    return "border-emerald-300/35 bg-emerald-300/15 text-emerald-100";
  }

  if (decision === "NO_GO" || decision === "NO-GO" || decision === "NO GO" || decision === "REJECT" || decision === "PIVOT" || decision === "Reject") {
    return "border-red-300/30 bg-red-300/12 text-red-100";
  }

  if (
    decision === "CONDITIONAL_GO" ||
    decision === "WAIT" ||
    decision === "HOLD" ||
    decision === "PAUSE_PENDING_REVIEW" ||
    decision === "Pause Pending Review" ||
    decision === "PROCEED_WITH_CONDITIONS" ||
    decision === "Proceed with Conditions"
  ) {
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

// A real word/phrase label ("Owner", "Target"), not a bare number or time-
// like fragment ("3", "12:30") that a naive colon-split would otherwise
// misread as a label -- keeps the structured-value rendering below from
// firing on a value that merely happens to contain a colon.
function looksLikeKpiValueLabel(text: string) {
  return /^[A-Za-z][A-Za-z\s/&-]{1,30}$/.test(text.trim());
}

// KPI values extracted from report text sometimes arrive as multiple
// "Label: text" fragments joined with "|" (e.g. "Owner: Growth Lead |
// Target: 5 net new customers/month") rather than a single short metric.
// Presentation-only parsing of the already-extracted value string -- the
// underlying extraction/data model is untouched.
function parseKpiValueSegments(value: string) {
  if (!value) return [];

  return value
    .split("|")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const colonIndex = segment.indexOf(":");
      if (colonIndex === -1) {
        return { label: "", text: segment };
      }
      return {
        label: segment.slice(0, colonIndex).trim(),
        text: segment.slice(colonIndex + 1).trim(),
      };
    });
}

// FINAL KPI UI POLISH -- confirmed live: a combined value like "Owner:
// Growth Lead | Target: 5 net new customers/month" rendered as one dense,
// hard-to-scan line. Separates it into label / value / supporting-text
// tiers (showing the most important segment first, per requirement) while
// leaving a genuinely simple value (a short number/percentage with no
// "Label:" structure) rendered exactly as before.
function KpiValueContent({ value }: { value: string }) {
  const segments = parseKpiValueSegments(value);
  const [first, ...rest] = segments;

  if (first?.label && looksLikeKpiValueLabel(first.label)) {
    const supporting = rest
      .map((segment) => (segment.label ? `${segment.label}: ${segment.text}` : segment.text))
      .join(" · ");

    return (
      <div className="mt-2 min-h-[3.5rem]">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">{first.label}</p>
        <p className="line-clamp-1 text-sm font-semibold leading-tight text-white">{first.text || "—"}</p>
        {supporting ? (
          <p className="mt-0.5 line-clamp-1 text-[10px] leading-snug text-zinc-400">{supporting}</p>
        ) : null}
      </div>
    );
  }

  return (
    <p className="mt-2 line-clamp-2 min-h-[3.5rem] max-w-full text-balance text-lg font-semibold leading-tight text-white">
      {value || "Target"}
    </p>
  );
}

function ExecutiveSummaryVisual({
  section,
  investmentScore,
  isMarketIntelligence = false,
}: {
  section: ReportSection;
  investmentScore?: ReportInvestmentScore;
  isMarketIntelligence?: boolean;
}) {
  if (section.field !== "executiveSummary") {
    return null;
  }

  const evidenceLocale = getResponseLanguage(detectPdfPresentationLocale(section.content));

  // CRITICAL FIX -- root-cause repair (ticket: "Fix the canonical
  // decision consistency bug"). Market Intelligence never computes an
  // "AI Investment Score" (investment-score.ts's founder-viability
  // metric, per the report-isolation policy) -- it must always show "--"
  // here, never fall through to extractConfidence(section.content)'s bare
  // percentage scan, which can attach an unrelated "NN%" mentioned
  // anywhere in the executive summary's own prose as if it were an
  // investment score.
  const score = isMarketIntelligence
    ? null
    : investmentScore?.totalScore ??
      extractScore(section.content, "AI Investment Score") ??
      extractConfidence(section.content);
  // CRITICAL ARCHITECTURE FIX -- centralize executive decision
  // vocabulary (see executive-decision-vocabulary.ts). Every report
  // kind's own, unmodified decision output (the shared Executive
  // Decision layer's "Decision: GO/CONDITIONAL GO/NO-GO" token,
  // Acquisition's own "Proceed with Conditions"/"Pause Pending Review"/
  // "Reject" phrase, or Real Estate's "Decision: BUY/WAIT/AVOID" line)
  // is translated into the same 4-value label here, instead of showing
  // each report kind's raw word verbatim on this KPI card.
  //
  // CRITICAL FIX -- confirmed live (root-cause repair): Market
  // Intelligence now resolves through resolveMarketIntelligenceExecutiveDecision
  // (the ONE canonical decision/confidence source for this report kind),
  // never resolveCanonicalDecisionFromReportText's own detectRecommendation
  // fallback -- that bare keyword scan (`\b(GO|NO GO|WAIT|...)\b`) can
  // match the "GO" inside "Go-to-Market", a phrase virtually every Market
  // Intelligence executive summary mentions when discussing entry
  // strategy, fabricating a "GO" verdict regardless of the report's real,
  // conservative recommendation.
  const marketDecision = isMarketIntelligence
    ? resolveMarketIntelligenceExecutiveDecision(section.content, evidenceLocale)
    : null;
  const resolvedDecision = isMarketIntelligence
    ? null
    : resolveCanonicalDecisionFromReportText(section.content, investmentScore?.recommendation);
  const recommendation = marketDecision
    ? marketDecision.decisionLabel
    : resolvedDecision
      ? getCanonicalDecisionLabel(resolvedDecision.decision, evidenceLocale)
      : detectRecommendation(section.content) || "—";
  const decisionColorKey = resolvedDecision?.decision || recommendation;
  const highlights = isMarketIntelligence
    ? getMarketIntelligenceExecutiveHighlights(section.content)
    : getExecutiveHighlights(section.content);
  // CRITICAL FIX (Task #17B) -- see page.tsx's own identical block for
  // the full rationale: extractFirstInsight below reads the executive
  // summary's own raw first sentence verbatim, completely bypassing
  // marketDecision above -- laundered here through the same canonical
  // resolver's own reconciliation helper before display.
  const reconcileExecutiveText = (text: string) =>
    marketDecision ? reconcileMarketIntelligenceDecisionText(text, marketDecision, evidenceLocale) : text;
  const kpis = [
    {
      label: "Investment Score",
      value: score === null ? "—" : `${score}/100`,
      accent: "from-teal-200/25 to-cyan-200/5",
      evidence: inferEvidenceLevel({ label: "Investment Score", value: score === null ? "" : `${score}`, context: section.content }),
    },
    {
      label: "Decision",
      value: recommendation,
      accent: "from-emerald-300/20 to-teal-300/5",
      evidence: getSectionEvidenceLevel(section),
    },
    {
      // CRITICAL FIX -- confirmed live: Market Intelligence's
      // deterministic Executive Decision banner has no "Market:"/"TAM:"
      // labeled line at all -- this generic Business-Plan-shaped
      // extraction (any line starting with "Market"/"TAM" anywhere in
      // the whole executive summary) risked matching an unrelated clause
      // in free-flowing MI prose rather than a genuine market signal.
      // There is no reliable canonical "Market Signal" source in the
      // deterministic banner, so Market Intelligence shows the neutral
      // placeholder directly instead of guessing from arbitrary prose.
      // Business Plan/Acquisition are completely untouched.
      label: "Market Signal",
      value: isMarketIntelligence
        ? "—"
        : extractMetricValue(section.content, "Market") || extractMetricValue(section.content, "TAM") || "—",
      accent: "from-sky-300/18 to-teal-300/5",
      evidence: "benchmarkDerived" as EvidenceLevel,
    },
    {
      // CRITICAL FIX -- confirmed live: same generic risk here. Market
      // Intelligence reads its real "Top 3 Risks" list from the
      // deterministic banner (locale-agnostic label lookup, matching the
      // same extraction the PDF's own Executive Decision card already
      // uses), taking only the first named risk for this compact KPI
      // value, rather than an unlabeled "any line starting with Risk"
      // scan of the whole summary.
      label: "Risk Posture",
      value: isMarketIntelligence
        ? takeFirstListItem(extractMetricValueFromAliases(section.content, localizedLabelVariants("topRisks"))) || "Tracked"
        : extractMetricValue(section.content, "Risk") || extractMetricValue(section.content, "Main Risk") || "Tracked",
      accent: "from-amber-300/18 to-teal-300/5",
      evidence: "validationRequired" as EvidenceLevel,
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
          <span className={`w-fit rounded-full border px-4 py-2 text-xs font-semibold tracking-[0.18em] ${getDecisionClasses(decisionColorKey)}`}>
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
                {reconcileExecutiveText(extractFirstInsight(section.content)) || "Executive signal is being assembled."}
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
	                <div className="mt-2">
	                  <EvidenceBadge level={kpi.evidence as EvidenceLevel} locale={evidenceLocale} market={isMarketIntelligence} />
	                </div>
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
              {(highlights.length > 0 ? highlights.map(reconcileExecutiveText) : [reconcileExecutiveText(extractFirstInsight(section.content))]).map((highlight) => (
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
          {/* P0 PRODUCTION FIX -- confirmed live (Market Intelligence
              production presentation hardening): mirrors the identical fix
              on page.tsx's own ExecutiveInsightBanner -- a bare "—" reads
              as an unexplained gap rather than a stated evidence state. */}
          {confidence === null ? "Confidence: Validation Needed" : `Confidence ${confidence}%`}
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

function PremiumSectionVisual({
  section,
  investmentScore,
  isMarketIntelligence = false,
  majorPlayersContent = "",
  executiveSummaryContent = "",
}: {
  section: ReportSection;
  investmentScore?: ReportInvestmentScore;
  isMarketIntelligence?: boolean;
  // Competitive Landscape's own table and Major Players' bullet list are
  // built from the exact same evidence-backed vendor set (see
  // extractMarketIntelligenceCompetitorRows' own comment) -- passed
  // through so this card can fall back to Major Players' data when its
  // own table content fails to parse, rather than showing "Validation
  // Needed" while a sibling section plainly names the same vendors.
  majorPlayersContent?: string;
  // TASK #17 -- Strategic Recommendations' own raw text can carry the
  // model's own independently-written "Recommendation: TOKEN" verdict
  // sentence, generated at the same time as (but not reconciled with)
  // Executive Summary's own decision statement -- passed through so this
  // card can display the SAME canonical decision every other decision
  // surface reads, rather than trusting its own section's possibly
  // stale/contradictory verdict line.
  executiveSummaryContent?: string;
}) {
  const field = section.field;

  // PERFORMANCE FIX -- this locale computation used to run unconditionally
  // for every section, on every render, even for fields this component
  // never renders anything for (it falls through to `return null` at the
  // end regardless). hasPremiumSectionVisual already mirrors exactly which
  // fields this function handles, so bailing out before the expensive
  // detectPdfPresentationLocale scan for every other field is a pure
  // performance fix -- the output is identical, since those fields would
  // have hit the same `return null` anyway, just after wasted work.
  if (!hasPremiumSectionVisual(section)) {
    return null;
  }

  const evidenceLocale = getResponseLanguage(detectPdfPresentationLocale(section.content));

  if (field === "tamSamSom") {
    const rows = getReportMarketRows(section.content);
    // CRITICAL FIX -- do not reintroduce old fake-data behavior, and
    // never remove the visual component (this ticket's own explicit
    // requirement) -- match the exported PDF's own already-correct
    // treatment (see downloadPdf's own tamSamSom branch, which already
    // uses parseMarketSizeMagnitude for real proportional sizing) -- the
    // on-screen visual had drifted out of sync with it, still using a
    // static [100, 68, 36] bar-width array regardless of the real
    // figures. Each of TAM/SAM/SOM is now independent: a layer with a
    // real extractable value gets a real proportional bar (scaled
    // against whichever layer has the largest magnitude); a layer with
    // no extractable value shows its own "Validation Needed" state
    // instead of a fabricated bar -- never an all-or-nothing gate that
    // would hide two genuinely available figures just because a third
    // one is missing. The whole component only falls back to a single
    // combined empty state when NONE of the three could be established.
    // CRITICAL FIX -- TAM/SAM/SOM must always be logically nested
    // (TAM >= SAM >= SOM). Each row previously showed its own extracted
    // value fully independently, which could produce an investor-facing
    // contradiction: TAM "Validation Needed" while SAM/SOM still showed
    // calculated numbers with no verified anchor to size them against. A
    // row's value is now only ever displayed once every row above it in
    // the hierarchy is ALSO resolved and correctly nested -- a row
    // blocked by an unresolved parent shows "Pending <Parent> Validation"
    // instead of a bare "Validation Needed". A row that has its own value
    // but fails the nesting check against an otherwise-resolved parent
    // falls back to the generic "Validation Needed" -- that is this row's
    // own data problem, not a cascade from above. Shared with the
    // section-level evidence badge (see resolveTamSamSomCascade's own
    // comment) so the two can never disagree.
    const { magnitudes, tamResolved, samResolved, somResolved } = resolveTamSamSomCascade(section.content);
    const maxMagnitude = Math.max(0, ...magnitudes.filter((magnitude): magnitude is number => magnitude !== null));
    const resolved = [tamResolved, samResolved, somResolved];
    const pendingLabels: Array<string | null> = [
      null,
      !tamResolved ? "Pending TAM Validation" : null,
      !samResolved ? "Pending SAM Validation" : null,
    ];
    // Planning Estimate -- see isMarketSizeEstimated's own comment.
    const estimated = rows.map((row, index) => resolved[index] && isMarketSizeEstimated(section.content, row.label));
    // Only remaining explanatory line for this section -- shown when at
    // least one row is still unresolved (a fully-nested stack needs no
    // extra caveat). Formulas, calculation methodology, and assumptions
    // live only in this section's own expandable Details/Methodology
    // disclosure below the visual, never inline here.
    const hasUnresolvedLayer = resolved.some((isResolved) => !isResolved);

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
          {rows.map((row, index) => {
            const magnitude = magnitudes[index];
            const isResolved = resolved[index];
            const isEstimated = estimated[index];

            return (
              <div
                key={row.label}
                className="grid min-h-44 gap-3 rounded-3xl border border-white/10 bg-black/35 p-4 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(7rem,auto)] lg:block"
              >
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
                {isResolved && magnitude !== null ? (
                  <>
                    <div className="mt-3">
                      <EvidenceBadge level={getSectionEvidenceLevel(section)} locale={evidenceLocale} market={isMarketIntelligence} />
                    </div>
                    <p className="mt-5 truncate whitespace-nowrap text-3xl font-semibold tracking-tight text-white">
                      {row.value}
                    </p>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${row.tone}`}
                        style={{ width: `${Math.max(8, (magnitude / maxMagnitude) * 100)}%` }}
                      />
                    </div>
                    {isEstimated ? (
                      <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200/80">
                        Planning Estimate / Not Verified
                      </p>
                    ) : null}
                    {/* CRITICAL FIX -- confirmed live: line-clamp-2 could
                        still cut off a real, single-sentence methodology/
                        assumption explanation when it ran long (e.g. a
                        stated formula or scaling basis) -- removed so the
                        full sentence the report actually generated is
                        always visible, never a fabricated addition. */}
                    {row.description ? (
                      <p className="mt-3 text-xs leading-5 text-zinc-500">{row.description}</p>
                    ) : null}
                  </>
                ) : (
                  <div className="mt-3 flex flex-1 flex-col items-start justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-black/20 p-3">
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                      {pendingLabels[index] || "Validation Needed"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {hasUnresolvedLayer ? (
          <p className="mt-5 border-t border-white/10 pt-4 text-sm leading-6 text-zinc-400">
            Additional market validation is required before sizing can be confirmed.
          </p>
        ) : null}
      </div>
    );
  }

  // FINAL PREMIUM REPORT RESTORATION -- see extractRealBulletLines' own
  // comment. Key Takeaway (one highlighted line) + a genuinely different
  // main explanation + real bullet points only when the model's own
  // output used a list -- never a blank card, falls back to a premium
  // Validation Needed state when nothing could be extracted at all.
  if (
    field === "marketDrivers" ||
    field === "barriers" ||
    field === "opportunities" ||
    field === "threats" ||
    field === "customerSegments" ||
    field === "majorPlayers" ||
    field === "regionalAnalysis" ||
    field === "industryTrends" ||
    field === "marketSegmentation"
  ) {
    const takeaway = getSectionTakeaway(section.content);
    // P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
    // presentation hardening): mirrors page.tsx's identical fix (see its
    // own comment on this exact pattern). getSectionTakeaway's first
    // sentence can itself be a bulleted/numbered line, which
    // extractRealBulletLines(section.content) (raw, unstripped) then
    // re-surfaces verbatim as bullet #1, duplicating the highlighted
    // takeaway underneath it. extractSectionMainExplanation already
    // excludes bulleted lines from its own sentence pool and correctly
    // skips the content's first SENTENCE by index when a takeaway exists --
    // left fed the original `content`, unchanged. Only the bullets
    // extractor is given the takeaway-stripped content; feeding stripped
    // content to extractSectionMainExplanation too would double-skip a
    // sentence (its own index-1 skip, on top of the sentence already
    // having been removed) and silently drop real prose.
    const contentWithoutTakeawayDuplication = stripLeadingTakeawaySentence(section.content, takeaway);
    const explanation = extractSectionMainExplanation(section.content, takeaway);
    const bullets = extractRealBulletLines(contentWithoutTakeawayDuplication);

    if (!takeaway && !explanation && bullets.length === 0) {
      return (
        <div className="mb-5 rounded-[2rem] border border-dashed border-white/15 bg-black/20 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            {section.title}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-amber-300" />
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-200">
              Validation Needed
            </p>
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            No {section.title.toLowerCase()} data could be established for this market yet.
          </p>
        </div>
      );
    }

    return (
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
          {getReportPresentationLabels(section.content).keyTakeaway}
        </p>
        {takeaway ? (
          <p className="mt-3 text-lg font-medium leading-7 text-white">{takeaway}</p>
        ) : null}
        {explanation ? (
          <p className="mt-3 text-sm leading-6 text-zinc-400">{explanation}</p>
        ) : null}
        {bullets.length > 1 ? (
          <ul className="mt-4 space-y-2 border-t border-white/10 pt-4">
            {bullets.map((bullet, index) => (
              <li key={index} className="flex gap-2 text-sm leading-6 text-zinc-300">
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  if (field === "marketOpportunity" || field === "marketOverview") {
    const opportunity = extractFirstInsight(section.content);

    // CRITICAL FIX -- do not reintroduce old fake-data behavior. The
    // Demand/Timing/Access/Defensibility bars below are static, hardcoded
    // percentages -- never derived from this section's actual content --
    // left as-is for Business Plan (out of this fix's scope), but Market
    // Intelligence gets only the honest opportunity panel, full width.
    // Market Intelligence's real market-size/CAGR/indicator figures get
    // their own dedicated, data-driven Market Metrics cards instead (see
    // the "marketSize"/"cagr" field branch below).
    //
    // CRITICAL FIX -- confirmed live: this panel used to show only a
    // line-clamped first sentence, so marketOverview's raw-text Details
    // disclosure below it repeated that same scope statement in full --
    // the exact duplication this ticket's bug report described. Now
    // captures the section's COMPLETE content (headline sentence + the
    // real remaining explanation + any real bullets), mirroring
    // page.tsx's identical fix -- reusing the same extractors, no new
    // calculation. marketOverview is now safe to add to
    // cardFirstReportFields below.
    if (isMarketIntelligence) {
      const explanation = extractSectionMainExplanation(section.content, opportunity);
      const bullets = extractRealBulletLines(section.content);

      return (
        <div className="mb-5 rounded-[2rem] border border-teal-200/15 bg-teal-200/[0.055] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Market Opportunity
          </p>
          <p className="mt-3 text-xl font-semibold leading-8 text-white">
            {opportunity || "Opportunity signal is being evaluated."}
          </p>
          {explanation ? (
            <p className="mt-3 text-sm leading-6 text-teal-50/80">{explanation}</p>
          ) : null}
          {bullets.length > 1 ? (
            <ul className="mt-4 space-y-2 border-t border-teal-200/15 pt-4">
              {bullets.map((bullet, index) => (
                <li key={index} className="flex gap-2 text-sm leading-6 text-teal-50/75">
                  <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    }

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

  // CRITICAL FIX -- restore Market Intelligence's Market Metrics cards.
  // marketSize and cagr are the two headline market-indicator sections
  // Market Intelligence generates outside of tamSamSom (which already has
  // its own visual above) -- each renders as its own stat card with the
  // real extracted figure, or a premium "Validation Needed" state (never
  // a fabricated number or a plain paragraph) when no figure is present
  // in the generated content, exactly as the generation prompt's own
  // "never invent a value" directive already requires.
  if (field === "marketSize" || field === "cagr") {
    const isCagr = field === "cagr";
    const value = isCagr ? extractHeadlineCagrValue(section.content) : extractHeadlineMonetaryValue(section.content);
    // CRITICAL FIX -- confirmed live: this card previously classified ANY
    // extracted figure as "verified" (Data Confirmed) by default, only
    // downgrading it when the content contained the literal
    // "[Estimated]"/"tahmini" tag -- a figure hedged in prose ("could not
    // be independently verified", "requires validation", an assumption
    // or benchmark) with no literal tag still rendered as confirmed
    // evidence. Reuses the SAME canonical evidence classifier
    // (inferEvidenceLevel) TAM/SAM/SOM already uses correctly via
    // getSectionEvidenceLevel, whose default for ambiguous/unlabeled
    // context is "benchmarkDerived", never "verified".
    const evidence = inferEvidenceLevel({
      label: isCagr ? "CAGR" : "Market Size",
      value,
      context: section.content,
    });

    return (
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(94,234,212,0.1),transparent_30%),rgba(255,255,255,0.025)] p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            {isCagr ? "CAGR" : "Market Size"}
          </p>
          {value ? <EvidenceBadge level={evidence} locale={evidenceLocale} market /> : null}
        </div>
        {value ? (
          <>
            <p className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">{value}</p>
            {/* CRITICAL FIX -- confirmed live: this evidence paragraph used
                to be clamped to 3 lines, silently hiding most of the
                section's real reasoning/evidence now that its raw-text
                Details disclosure is fully suppressed (marketSize/cagr are
                in cardFirstReportFields) -- the card became a bare number
                with no supporting analysis. Restyled as a distinct,
                labeled evidence block (never re-fabricated; the same real
                content, just no longer visually cut off) rather than a
                clamped leftover. */}
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-200/60">
                Evidence &amp; Analysis
              </p>
              <p className="mt-2 text-xs leading-5 text-zinc-400">{section.content}</p>
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/20 p-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-300" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">
                Validation Needed
              </p>
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              A defensible figure could not be established for this scope. See the analysis below for
              what would close the gap.
            </p>
          </div>
        )}
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
    const flowMetrics = flow.map((metric) => {
      const value = formatMetricCardValue(extractMetricValue(section.content, metric));
      return {
        metric,
        value,
        confidenceBadge: getFinancialMetricConfidenceBadge(metric, [metric], section.content, value),
      };
    });
    const hasVerifiedEvidence = flowMetrics.some((item) => item.confidenceBadge === "verified");

    return (
      <div className="mb-5 overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(90deg,rgba(94,234,212,0.08),rgba(255,255,255,0.025))]">
        <div className="border-b border-white/10 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Unit Economics Chain
          </p>
        </div>
        {!hasVerifiedEvidence ? (
          <div className="border-b border-amber-300/20 bg-amber-300/10 px-5 py-3">
            <p className="text-xs leading-5 text-amber-100/90">
              <span className="font-semibold">No founder-confirmed financial data available.</span>{" "}
              The figures below are AI planning scenarios based on industry benchmarks and planning
              assumptions, not confirmed business performance.
            </p>
          </div>
        ) : null}
        <div className="grid gap-px bg-white/10 md:grid-cols-5">
          {flowMetrics.map(({ metric, value, confidenceBadge }) => (
            <div key={metric} className="bg-zinc-950/80 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  {getFinancialMetricDisplayLabel(metric, confidenceBadge)}
                </p>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold ${getFinancialMetricConfidenceBadgeClass(confidenceBadge)}`}>
                  {getFinancialEvidenceBadgeLabel(confidenceBadge, evidenceLocale)}
                </span>
              </div>
              <p className="mt-3 truncate whitespace-nowrap text-lg font-semibold text-white">
                {value || "—"}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // CRITICAL FIX -- restore Market Intelligence's structured visual
  // presentation. Market Intelligence's own field is "competitiveLandscape"
  // -- distinct from Business Plan/Acquisition's "competitorLandscape"
  // field the branch below matches -- so this report kind's competitor
  // data has always fallen through to plain text here. A dedicated,
  // data-driven table (see extractMarketIntelligenceCompetitorRows' own
  // comment for why it isn't a reuse of the branch below) restores the
  // structured presentation without touching the existing Business
  // Plan/Acquisition visual.
  if (field === "competitiveLandscape") {
    const rows = extractMarketIntelligenceCompetitorRows(section.content, majorPlayersContent);

    // No competitor data validated at all -- a large empty table shell
    // (header row with nothing under it) stacked on top of MarketMap's
    // own separate "Validation Needed" box was two empty states for the
    // same problem. Show one clean validation card instead, matching the
    // same premium empty-state language used elsewhere (TAM/SAM/SOM,
    // Market Metrics), and skip MarketMap entirely -- it has nothing to
    // plot with zero rows.
    if (rows.length === 0) {
      // CRITICAL FIX -- confirmed live: before claiming "no competitor
      // data could be validated," check whether Major Players actually
      // names real, plausible vendors that just don't fit the strict row
      // shape (see extractMarketIntelligenceCompetitorNamesOnly's own
      // comment) -- this is what let the report say "no competitor data
      // validated" one section above Major Players naming real vendors.
      // Never fabricates category/position/strengths/weaknesses to fill
      // the full table -- shows a distinct, honest third state instead.
      const namesOnly = extractMarketIntelligenceCompetitorNamesOnly(majorPlayersContent);

      if (namesOnly.length > 0) {
        return (
          <div className="mb-5 overflow-hidden rounded-[2rem] border border-dashed border-white/15 bg-black/20">
            <div className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
                Competitive Landscape
              </p>
              <div className="mt-4 flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-sky-300" />
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-200">
                  Relevant Players Identified — Detailed Comparison Requires Validation
                </p>
              </div>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                These companies are identified in available evidence as active market participants.
                Detailed competitive comparison — positioning, strengths, weaknesses, and market share —
                has not yet been independently validated for this analysis.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {namesOnly.map((name) => (
                  <span
                    key={name}
                    className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-xs font-semibold text-sky-100"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
            {/* CRITICAL FIX (Task #14) -- the Market Map card used to
                disappear entirely in this names-only state (not even its
                own "Validation Needed" box), instead of staying present
                and independently honest like it does for the full table.
                Reusing it here with vendor-only pseudo-rows never
                fabricates a position: inferMarketMapPosition requires a
                signal from category/position/strengths/weaknesses text,
                all empty here by design, so it naturally renders its own
                "Validation Needed" state rather than plotting anything. */}
            <MarketMap
              rows={namesOnly.map((name) => ({
                vendor: name,
                category: "",
                position: "",
                strengths: "",
                weaknesses: "",
              }))}
            />
          </div>
        );
      }

      return (
        <div className="mb-5 rounded-[2rem] border border-dashed border-white/15 bg-black/20 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Competitive Landscape
          </p>
          <div className="mt-4 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-amber-300" />
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-200">
              Validation Needed
            </p>
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            No competitor data could be validated for this market yet.
          </p>
        </div>
      );
    }

    return (
      <div className="mb-5 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.025]">
        <div className="border-b border-white/10 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Competitive Landscape
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            Vendors, category, position, strengths, weaknesses, market relevance and validation status
            from the generated analysis.
          </p>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[1020px]">
            <div className="grid grid-cols-[0.85fr_0.75fr_0.85fr_1fr_1fr_0.75fr_0.85fr] gap-px bg-white/10 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              {["Vendor", "Category", "Position", "Strengths", "Weaknesses", "Relevance", "Validation"].map(
                (label) => (
                  <div key={label} className="bg-zinc-950/80 px-4 py-3">
                    {label}
                  </div>
                )
              )}
            </div>
            <div className="grid gap-px bg-white/10">
              {rows.map((row, index) => (
                <div
                  key={`${row.vendor}-${index}`}
                  className="grid grid-cols-[0.85fr_0.75fr_0.85fr_1fr_1fr_0.75fr_0.85fr] bg-black/35 text-sm leading-6 text-zinc-300"
                >
                  <div className="px-4 py-4 font-semibold text-white">{row.vendor || "—"}</div>
                  <div className="px-4 py-4">{row.category || "Validation Needed"}</div>
                  <div className="px-4 py-4">{row.position || "Validation Needed"}</div>
                  <div className="px-4 py-4">{row.strengths || "Validation Needed"}</div>
                  <div className="px-4 py-4">{row.weaknesses || "Validation Needed"}</div>
                  <div className="px-4 py-4">
                    {row.relevance ? (
                      <span className="rounded-full border border-teal-200/20 bg-teal-200/10 px-2.5 py-1 text-xs font-semibold text-teal-100">
                        {row.relevance}
                      </span>
                    ) : (
                      <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs font-semibold text-amber-200">
                        Validation Needed
                      </span>
                    )}
                  </div>
                  <div className="px-4 py-4">
                    {row.validationStatus ? (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-zinc-300">
                        {row.validationStatus}
                      </span>
                    ) : (
                      <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs font-semibold text-amber-200">
                        Validation Needed
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <MarketMap rows={rows} />
      </div>
    );
  }

  if (field === "strategicRecommendations") {
    const items = extractRecommendationItems(section.content);
    // CRITICAL FIX (Task #17) -- see isRecommendationHeadingLine's own
    // comment: this section's raw text can carry an independently-
    // written decision verdict that was never reconciled with Executive
    // Summary's canonical decision. Reads the SAME canonical resolver
    // every other decision surface in this file already calls, against
    // the SAME executiveSummary content, so this section can never
    // display a decision Executive Summary itself disagrees with.
    const strategicRecommendationDecision = isMarketIntelligence
      ? resolveMarketIntelligenceExecutiveDecision(
          executiveSummaryContent,
          detectPdfPresentationLocale(executiveSummaryContent || section.content) === "tr" ? "Turkish" : "English"
        )
      : null;

    return (
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Strategic Recommendations
          </p>
          {strategicRecommendationDecision && strategicRecommendationDecision.decisionLabel !== "—" ? (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
              Current Decision: {strategicRecommendationDecision.decisionLabel}
            </span>
          ) : null}
        </div>
        {items.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {items.map((item, index) => {
              const { timeframe, metric, budget, owner, gate } = extractRecommendationSignals(item);
              const fields = [
                { label: "Owner", value: owner },
                { label: "Timeline", value: timeframe },
                { label: "Budget", value: budget },
                { label: "Success Metric", value: metric },
              ].filter((field) => field.value);

              return (
                <div key={index} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-teal-200/30 bg-teal-200/10 text-xs font-semibold text-teal-100">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Action</p>
                      <p className="mt-1 text-sm leading-6 text-zinc-300">{item}</p>
                    </div>
                  </div>
                  {fields.length > 0 ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3">
                      {fields.map((field) => (
                        <div key={field.label}>
                          <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                            {field.label}
                          </p>
                          <p className="mt-1 truncate text-xs font-semibold text-teal-100">{field.value}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {gate ? (
                    <div className={fields.length > 0 ? "mt-3" : "mt-3 border-t border-white/10 pt-3"}>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                        Decision Gate
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-amber-200">{gate}</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-zinc-400">{section.content}</p>
        )}
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
                    <div className="px-4 py-4">{row.positioning || "—"}</div>
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
              {/* P0 PRODUCTION FIX -- confirmed live (Market Intelligence
                  presentation hardening, round 2): this IS the Competitive
                  Landscape section's own render -- telling the reader to
                  "see" the exact section already on screen was a
                  self-referential, useless copy-paste artifact. Matches
                  page.tsx's own wording for the identical empty state. */}
              No competitor data could be validated for this market yet.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (field === "financialDashboard") {
    const dashboardMetrics = getFinancialDashboardMetrics(section.content).map((metric) => {
      const value = formatMetricCardValue(
        extractMetricValueFromAliases(section.content, metric.aliases)
      );
      return {
        metric,
        value,
        confidenceBadge: getFinancialMetricConfidenceBadge(metric.label, metric.aliases, section.content, value),
      };
    });
    const hasVerifiedEvidence = dashboardMetrics.some((item) => item.confidenceBadge === "verified");

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
          {/* CRITICAL FIX -- do not present AI benchmark estimates as
              confirmed business performance. This badge used to read
              "Live model" unconditionally, regardless of whether any
              metric below was ever confirmed by the founder -- implying
              real, current business data even when every figure is a
              modeled industry-benchmark estimate. It now honestly
              reflects which case applies (mirrors the equivalent,
              already-fixed badge in the dashboard's page.tsx). */}
          <span
            className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${
              hasVerifiedEvidence
                ? "border-teal-200/20 bg-teal-200/10 text-teal-100"
                : "border-amber-300/25 bg-amber-300/10 text-amber-100"
            }`}
          >
            {hasVerifiedEvidence ? "Includes confirmed figures" : "Modeled estimate"}
          </span>
        </div>
        {!hasVerifiedEvidence ? (
          <div className="border-b border-amber-300/20 bg-amber-300/10 px-5 py-3">
            <p className="text-xs leading-5 text-amber-100/90">
              <span className="font-semibold">No founder-confirmed financial data available.</span>{" "}
              The figures below are AI planning scenarios based on industry benchmarks and planning
              assumptions, not confirmed business performance.
            </p>
          </div>
        ) : null}
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {dashboardMetrics.map(({ metric, value, confidenceBadge }) => {
            // CRITICAL FIX -- do not present AI benchmark estimates as
            // confirmed business performance. This fill used to be a
            // hardcoded, metric-unrelated array with no connection to the
            // card it decorated (mirrors the equivalent, already-fixed
            // fill in the dashboard's page.tsx). It now tracks the
            // metric's own real evidence tier instead of an arbitrary
            // per-index number.
            const evidenceFillPercent: Record<EvidenceLevel, number> = {
              verified: 100,
              derived: 85,
              benchmarkDerived: 55,
              planningAssumption: 40,
              validationRequired: 25,
            };
            return (
              <div
                key={metric.label}
                className="flex min-h-32 min-w-0 flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-black/35 p-3.5 shadow-xl shadow-black/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-2 min-w-0 break-words text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                    {getFinancialMetricDisplayLabel(metric.label, confidenceBadge)}
                  </p>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${getFinancialMetricConfidenceBadgeClass(confidenceBadge)}`}>
                    {getFinancialEvidenceBadgeLabel(confidenceBadge, evidenceLocale)}
                  </span>
                </div>
                <div className="mt-4 min-w-0">
                  <p className="truncate whitespace-nowrap text-[clamp(1.15rem,2.2vw,1.65rem)] font-semibold leading-tight tracking-tight text-white">
                    {value || "—"}
                  </p>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full ${confidenceBadge === "verified" ? "bg-teal-200/80" : "bg-amber-300/60"}`}
                      style={{ width: `${evidenceFillPercent[confidenceBadge]}%` }}
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
    const founderScoreLocale = detectPdfPresentationLocale(section.content);
    const scoredMetrics = founderScoreDimensionMetrics
      .map((metric) => ({
        metric: localizePdfPresentationLabel(metric.label, founderScoreLocale),
        score: readFounderReadinessMetricValue(metric.label, investmentScore, section.content),
      }))
      .filter((item): item is { metric: string; score: number } => item.score !== null);

    if (scoredMetrics.length === 0) {
      return null;
    }

    return (
      <div className="mb-5 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-200/70">
          {founderScoreLocale === "tr" ? "Kurucu Hazırlık Boyutları" : "Founder Readiness Dimensions"}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {scoredMetrics.map(({ metric, score }) => (
            <GaugeCircle key={metric} label={metric} score={score} />
          ))}
        </div>
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
    const hasVerifiedEvidence = scenarioMetrics.some((metric) => {
      const value = extractMetricValue(section.content, metric);
      return getFinancialMetricConfidenceBadge(metric, [metric], section.content, value || "") === "verified";
    });

    return (
      <div className="mb-5 space-y-4">
        {!hasVerifiedEvidence ? (
          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-5 py-3">
            <p className="text-xs leading-5 text-amber-100/90">
              <span className="font-semibold">Scenario analysis is modeled, not measured.</span>{" "}
              Baseline financial evidence has not been provided, so the Worst / Base / Best figures
              below are industry-benchmark projections and planning assumptions, not confirmed
              business performance.
            </p>
          </div>
        ) : null}
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

  if (field === "executiveSummary") {
    // The single Executive Decision layer (formatExecutiveDecisionBrief)
    // has a known, deterministic shape -- "Decision: GO (Confidence: 72%)"
    // in English, "Karar: EVET (Güven: 72%)" in Turkish, etc. -- read via a
    // locale-agnostic extractor rather than an English-only regex, which
    // silently fails and falls back to a placeholder for every non-English
    // report.
    const decisionMatch = extractExecutiveDecisionFromText(section.content);
    const selected = decisionMatch?.token.toUpperCase() || "";
    const decisions = decisionMatch
      ? decisionTokensForLanguage(decisionMatch.language)
      : decisionTokensForLanguage("English");
    const whyLabels = localizedLabelVariants("why");
    const topRisksLabels = localizedLabelVariants("topRisks");
    const missingEvidenceLabels = localizedLabelVariants("missingEvidence");
    const whatWouldChangeLabels = localizedLabelVariants("whatWouldChangeThisDecision");
    const immediateNextActionLabels = localizedLabelVariants("immediateNextAction");
    const recommendationMetrics = [
      ["Confidence", extractConfidence(section.content) ? `${extractConfidence(section.content)}%` : "—"],
      ["Why", extractMetricValueFromAliases(section.content, whyLabels) || "—"],
      ["Top Risk", extractAliasedSectionSnippet(section.content, topRisksLabels, missingEvidenceLabels) || "—"],
      // CRITICAL FIX -- "Missing Evidence" reads as an internal audit
      // label, not a board-level card title. The underlying extraction
      // (missingEvidenceLabels) is unchanged -- only the displayed label
      // is renamed to what the reader should actually do with it.
      ["Key Gap", extractAliasedSectionSnippet(section.content, missingEvidenceLabels, whatWouldChangeLabels) || "—"],
    ];

    return (
      <div className="mb-5 rounded-[2.25rem] border border-teal-200/20 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.16),transparent_30%),rgba(94,234,212,0.06)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/80">
              Executive Decision
            </p>
            <p className="mt-2 text-5xl font-semibold tracking-tight text-white">
              {selected || "—"}
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
        <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Immediate Next Action</p>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              {extractMetricValueFromAliases(section.content, immediateNextActionLabels) || "—"}
            </p>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">What Would Change This Decision</p>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              {extractMetricValueFromAliases(section.content, whatWouldChangeLabels) || "—"}
            </p>
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
          {forces.map((force) => {
            const intensity = extractForceIntensity(section.content, force);
            const implication = extractForceImplication(section.content, force);

            return (
              <div key={force} className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">{force}</p>
                  {isMarketIntelligence ? (
                    <EvidenceBadge level={getForceEvidenceLevel(implication)} locale={evidenceLocale} market />
                  ) : null}
                </div>
                {intensity ? (
                  <>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-teal-200/75"
                        style={{ width: `${intensity.width}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">{intensity.level} intensity</p>
                  </>
                ) : (
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">
                    Not specified
                  </p>
                )}
                {/* CRITICAL FIX -- confirmed live: line-clamp-3 could cut
                    off a real, single-sentence force implication at this
                    card's narrow width -- removed so the full sentence the
                    report actually generated is always visible. */}
                {implication ? (
                  <p className="mt-3 border-t border-white/10 pt-3 text-xs leading-5 text-zinc-400">
                    {implication}
                  </p>
                ) : null}
              </div>
            );
          })}
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
            <div key={metric} className="grid min-h-[11.5rem] grid-cols-[4.25rem_1fr] gap-4 rounded-3xl border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center">
                <MiniProgressCircle label="" value={extractPercentScore(section.content, metric)} />
              </div>
              <div className="flex min-w-0 flex-col">
                <div className="flex min-h-[3rem] flex-col gap-1">
                  <p className="line-clamp-2 text-[10px] font-medium uppercase leading-snug tracking-[0.1em] text-zinc-500">{metric}</p>
                  <span className={`w-fit shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${getFinancialMetricConfidenceBadgeClass(confidenceBadge)}`}>
                    {getFinancialEvidenceBadgeLabel(confidenceBadge, evidenceLocale)}
                  </span>
                </div>
                <KpiValueContent value={value} />
                <div className="mt-auto pt-4">
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-teal-200/80"
                      style={{ width: `${extractPercentScore(section.content, metric) ?? 0}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">Analytics widget</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return null;
}

// Positions a vendor on the "Enterprise <-> SME focus" and "Broad
// platform <-> Specialized solution" axes using ONLY keywords already
// present in that vendor's own generated category/position/strengths/
// weaknesses text -- never a fabricated coordinate. A vendor is placed
// only when BOTH axes have a detectable signal; a vendor with signal on
// just one axis (or neither) is omitted from the map entirely rather
// than guessing the other coordinate, per this ticket's own "do not
// fabricate placement" requirement. It still appears in the competitor
// table above regardless.
function inferMarketMapPosition(row: {
  category: string;
  position: string;
  strengths: string;
  weaknesses: string;
}) {
  // Deliberately reads only category/position, not strengths/weaknesses --
  // confirmed live, a weakness like "Limited enterprise features" false-
  // positived the word "enterprise" as if it were this vendor's target
  // segment, when it actually describes the OPPOSITE (a gap in enterprise
  // capability). category/position state the vendor's actual market
  // focus directly, without that negation risk.
  const text = `${row.category} ${row.position}`.toLowerCase();

  let x: number | null = null;
  if (/\benterprise\b/.test(text)) {
    x = 78;
  } else if (/\b(?:sme|smb|small business|mid-market|midmarket|small and medium)\b/.test(text)) {
    x = 22;
  }

  let y: number | null = null;
  if (/\b(?:platform|suite|end-to-end|broad(?:-based)?)\b/.test(text)) {
    y = 22;
  } else if (/\b(?:specialized|specialised|niche|point solution|focused|narrow)\b/.test(text)) {
    y = 78;
  }

  return x !== null && y !== null ? { x, y } : null;
}

function MarketMap({
  rows,
}: {
  rows: Array<{ vendor: string; category: string; position: string; strengths: string; weaknesses: string }>;
}) {
  const placements = rows
    .map((row) => {
      const coordinates = inferMarketMapPosition(row);
      return coordinates ? { vendor: row.vendor || "Vendor", ...coordinates } : null;
    })
    .filter((placement): placement is { vendor: string; x: number; y: number } => placement !== null);

  return (
    <div className="border-t border-white/10 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">Market Map</p>
      {placements.length >= 2 ? (
        <>
          <p className="mt-2 text-sm text-zinc-400">
            Positioning inferred from each vendor&rsquo;s own generated description -- vendors without a clear
            signal on both axes are omitted rather than guessed.
          </p>
          <div className="relative mt-5 h-64 rounded-3xl border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.035),rgba(94,234,212,0.07))]">
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/10" />
            <div className="absolute left-0 top-1/2 h-px w-full bg-white/10" />
            <span className="absolute left-2 top-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Broad platform
            </span>
            <span className="absolute bottom-2 left-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Specialized
            </span>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Enterprise
            </span>
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              SME
            </span>
            {placements.map((placement) => (
              <div
                key={placement.vendor}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${placement.x}%`, top: `${placement.y}%` }}
              >
                <div className="h-3 w-3 rounded-full bg-teal-200 shadow-[0_0_16px_rgba(94,234,212,0.6)]" />
                <p className="mt-2 max-w-24 rounded-full border border-white/10 bg-black/70 px-2 py-1 text-center text-[10px] font-semibold leading-4 text-teal-100 sm:max-w-none sm:whitespace-nowrap">
                  {placement.vendor}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-5 rounded-3xl border border-dashed border-white/15 bg-black/20 p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">Validation Needed</p>
          <p className="mt-2 text-sm text-zinc-400">
            Not enough competitors have a clear category or positioning signal on both axes to plot a reliable
            market map yet.
          </p>
        </div>
      )}
    </div>
  );
}

// Market Metrics dashboard -- combines real signals already generated
// across several Market Intelligence sections (marketSize, cagr,
// customerSegments, threats) into one premium tile grid, rather than
// leaving each as a separate full-width card. Every tile is read from
// real content: Market Growth is a directional word (Growing/Declining)
// only when the generated text actually says so; Adoption Signal reads
// customerSegments' own "adoption maturity" language (its prompt
// explicitly asks for it); Risk Level reads a qualitative risk word near
// "risk" in threats, the same bounded-window technique
// extractForceIntensity already uses for Porter's Five Forces. A tile
// with no detectable signal shows "Validation Needed", never a
// fabricated value.
function extractMarketGrowthTrend(marketSizeContent: string, cagrContent: string) {
  const combined = `${marketSizeContent} ${cagrContent}`;
  if (/\b(?:growing|growth|expand(?:ing)?|increasing|accelerating)\b/i.test(combined)) {
    return "Growing";
  }
  if (/\b(?:declin(?:e|ing)|shrink(?:ing)?|contracting|slowing)\b/i.test(combined)) {
    return "Declining";
  }
  return "";
}

function extractAdoptionSignal(customerSegmentsContent: string) {
  return (
    customerSegmentsContent.match(/adoption\s+(?:maturity|stage|signal)[^.\n]*\./i)?.[0]?.trim() ||
    customerSegmentsContent.match(/\b(?:early adopters?|early majority|late majority|mainstream adoption)\b[^.\n]*\./i)?.[0]?.trim() ||
    ""
  );
}

function extractRiskLevel(threatsContent: string) {
  const match = threatsContent.match(/\b(high|significant|severe|moderate|medium|low|limited|minimal)\b[^.\n]{0,40}\brisk\b/i);
  if (!match) return "";
  const word = match[1].toLowerCase();
  if (/high|significant|severe/.test(word)) return "High";
  if (/moderate|medium/.test(word)) return "Moderate";
  return "Low";
}

// Memoized -- sections is already a stable, useMemo'd reference from
// ReportPanel, so this only needs to recompute when the report's own
// content actually changes, not on every unrelated parent re-render.
const MarketMetricsDashboard = memo(function MarketMetricsDashboard({ sections }: { sections: ReportSection[] }) {
  const findContent = (field: string) => sections.find((section) => section.field === field)?.content || "";
  const marketSizeContent = findContent("marketSize");
  const cagrContent = findContent("cagr");
  const customerSegmentsContent = findContent("customerSegments");
  const threatsContent = findContent("threats");

  const tiles = [
    { label: "Market Growth Signal", value: extractMarketGrowthTrend(marketSizeContent, cagrContent) },
    { label: "CAGR", value: extractHeadlineCagrValue(cagrContent) },
    { label: "Customer Segment", value: extractFirstInsight(customerSegmentsContent) },
    { label: "Adoption Signal", value: extractAdoptionSignal(customerSegmentsContent) },
    { label: "Risk Level", value: extractRiskLevel(threatsContent) },
  ];

  if (tiles.every((tile) => !tile.value)) {
    return null;
  }

  return (
    <div className="mb-5 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
        Market Metrics
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{tile.label}</p>
            {tile.value ? (
              <p className="mt-2 line-clamp-2 text-sm font-semibold text-white">{tile.value}</p>
            ) : (
              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.1em] text-amber-200">
                Validation Needed
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

// CRITICAL FIX -- restore Market Intelligence's SWOT-equivalent
// four-quadrant visual. Market Intelligence has no single "swotAnalysis"
// field the way Business Plan does -- it generates four SEPARATE, real
// sections instead (marketDrivers/barriers/opportunities/threats). This
// combines those four already-generated sections into one 2x2 grid for
// at-a-glance scanning, using each field's own real title (never
// relabeled as "Strengths"/"Weaknesses", which would misrepresent
// market-level analysis as company-level SWOT). Purely additive: each
// field still renders as its own full section exactly as before: this
// component only supplements them with a combined summary view, and
// only renders once ALL FOUR fields have real content -- never a
// partial/broken-looking 1-3 cell grid.
const marketForcesQuadrants: ReadonlyArray<{ field: string; icon: LucideIcon }> = [
  { field: "marketDrivers", icon: TrendingUp },
  { field: "barriers", icon: ShieldAlert },
  { field: "opportunities", icon: Sparkles },
  { field: "threats", icon: ShieldAlert },
];

// Memoized -- same rationale as MarketMetricsDashboard above.
const MarketForcesQuadrant = memo(function MarketForcesQuadrant({ sections }: { sections: ReportSection[] }) {
  const quadrants = marketForcesQuadrants
    .map(({ field, icon }) => {
      const section = sections.find((candidate) => candidate.field === field);
      return section && section.content.trim()
        ? { title: section.title, icon, bullets: extractBullets(section.content, section.title) }
        : null;
    })
    .filter((quadrant): quadrant is { title: string; icon: LucideIcon; bullets: string[] } => Boolean(quadrant));

  if (quadrants.length < marketForcesQuadrants.length) {
    return null;
  }

  return (
    <div className="mb-5 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
        Market Forces at a Glance
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {quadrants.map(({ title, icon: Icon, bullets }) => (
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
        ))}
      </div>
    </div>
  );
});

function hasPremiumSectionVisual(section: ReportSection) {
  return (
    section.field === "executiveSummary" ||
    section.field === "marketOverview" ||
    section.field === "marketOpportunity" ||
    section.field === "marketSize" ||
    section.field === "cagr" ||
    section.field === "businessModel" ||
    section.field === "competitorAnalysis" ||
    section.field === "competitorLandscape" ||
    section.field === "competitiveLandscape" ||
    section.field === "strategicRecommendations" ||
    section.field === "tamSamSom" ||
    section.field === "swotAnalysis" ||
    section.field === "financialDashboard" ||
    section.field === "financialAssumptions" ||
    section.field === "founderScore" ||
    section.field === "scenarioAnalysis" ||
    section.field === "founderRoadmap" ||
    section.field === "roadmap306090" ||
    section.field === "portersFiveForces" ||
    section.field === "pricingStrategy" ||
    section.field === "goToMarketPlan" ||
    section.field === "salesStrategy" ||
    section.field === "entryStrategy" ||
    section.field === "unitEconomics" ||
    section.field === "kpiDashboard" ||
    section.field === "kpis" ||
    section.field === "marketDrivers" ||
    section.field === "barriers" ||
    section.field === "opportunities" ||
    section.field === "threats" ||
    section.field === "customerSegments" ||
    section.field === "majorPlayers" ||
    section.field === "regionalAnalysis" ||
    section.field === "industryTrends" ||
    section.field === "marketSegmentation"
  );
}

// FINAL REPORT PRESENTATION CLEANUP -- these fields already get their own
// premium visual card (ExecutiveSummaryVisual, MarketForcesQuadrant plus
// each field's own Key-Takeaway/explanation/bullets card, the TAM/SAM/SOM
// bars, the Porter's Five Forces radar, or the Strategic Recommendation
// action cards), so the generic ExecutiveInsightBanner/SectionTakeaway
// snippets would only repeat the same summary a second (or third) time.
// Full raw text/methodology stays available for all of them, but only
// inside the collapsed AnalysisNotes disclosure -- never as a second
// always-visible summary.
const cardFirstReportFields = new Set([
  "executiveSummary",
  "marketOverview",
  "marketDrivers",
  "barriers",
  "opportunities",
  "threats",
  "customerSegments",
  "majorPlayers",
  "regionalAnalysis",
  "industryTrends",
  "marketSegmentation",
  "tamSamSom",
  "strategicRecommendations",
  "portersFiveForces",
  "marketSize",
  "cagr",
  "competitiveLandscape",
]);

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

  if (section.field === "founderScore") {
    return `${base} border-teal-200/15 bg-[linear-gradient(135deg,rgba(94,234,212,0.08),rgba(0,0,0,0.66))]`;
  }

  return `${base} border-white/10 bg-black/45`;
}

function AnalysisNotes({
  children,
  compact,
  label = "Details",
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

function getRiskIndicatorClass(level: string) {
  if (level === "High") {
    return "border-red-300/25 bg-red-300/10 text-red-100";
  }

  if (level === "Medium") {
    return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  }

  // CRITICAL FIX (Task #20) -- see page.tsx's own identical function for
  // the full rationale: a risk dimension with no defensible severity
  // signal must never share this file's "Low" (safe-looking teal)
  // styling -- that would visually claim "checked, found safe" for
  // something never actually evaluated.
  if (level === "Validation Needed" || level === "Doğrulama Gerekli") {
    return "border-white/10 bg-white/[0.04] text-zinc-300";
  }

  return "border-teal-300/25 bg-teal-300/10 text-teal-100";
}

function SnapshotGauge({
  label,
  value,
  display,
}: {
  label: string;
  value: number | null;
  display: string;
}) {
  const safeValue = value ?? 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(rgb(94 234 212) ${safeValue * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
          }}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-zinc-950 text-[11px] font-semibold text-white">
            {value === null ? "--" : value}
          </div>
        </div>
        <p className="min-w-0 text-sm font-semibold text-zinc-200">{display}</p>
      </div>
    </div>
  );
}

function ExecutiveSnapshotPanel({
  section,
  investmentScore,
  reportQuality,
  isMarketIntelligence = false,
}: {
  section: ReportSection;
  investmentScore?: ReportInvestmentScore;
  reportQuality?: ReportQualityScore;
  isMarketIntelligence?: boolean;
}) {
  if (!isExecutivePresentationSection(section)) {
    return null;
  }

  const snapshot = buildExecutiveSnapshot(section.content, investmentScore, reportQuality);
  // CRITICAL FIX -- remove internal system language from user-facing
  // Market Intelligence output. "Confidence Radar" reads as an internal
  // diagnostic instrument name, and its dimensions (Market/Financial/
  // Execution readiness) are drawn from investmentScore.decisionEngine
  // -- the generic founder-viability score Market Intelligence does not
  // evaluate, so the label itself is doubly misleading for this report
  // kind. Only the label text is overridden here for Market
  // Intelligence; getReportPresentationLabels itself (shared with
  // Business Plan and Acquisition) and the underlying snapshot
  // computation are untouched.
  const isMarketIntelligenceTurkish = detectPdfPresentationLocale(section.content) === "tr";
  const labels = {
    ...getReportPresentationLabels(section.content),
    ...(isMarketIntelligence
      ? {
          confidence: isMarketIntelligenceTurkish ? "Planlama Güveni" : "Planning Confidence",
          confidenceRadar: isMarketIntelligenceTurkish ? "Karar Faktörleri" : "Decision Factors",
        }
      : {}),
  };
  // CRITICAL FIX -- one of buildConfidenceRadar's 5 dimensions is
  // literally labeled "Evidence"/"Kanıt" (it scores competitive-evidence
  // strength for Business Plan/Acquisition's founder-viability score).
  // Renaming that shared dimension label itself would touch other report
  // kinds, so only Market Intelligence's rendered copy of the array is
  // remapped here; the underlying score computation is untouched.
  const confidenceRadarDimensions = isMarketIntelligence
    ? snapshot.confidenceRadar.map((dimension) =>
        dimension.label === "Evidence" || dimension.label === "Kanıt"
          ? { ...dimension, label: isMarketIntelligenceTurkish ? "Pazar Sinyalleri" : "Market Signals" }
          : dimension
      )
    : snapshot.confidenceRadar;
  const reportQualityBreakdown = getReportQualityBreakdown(
    reportQuality,
    labels.reportQuality === "Rapor Kalitesi"
  );
  // CRITICAL FIX -- root-cause repair (ticket: "Fix the canonical
  // decision consistency bug"). buildExecutiveSnapshot's generic
  // decision/confidence fallback (used whenever
  // resolveCanonicalDecisionFromReportText fails to find the
  // deterministic banner -- e.g. a legacy pre-Executive-Decision-layer
  // executiveSummary) is built on two unsafe full-content scans:
  // extractDecision's fallback matches ANY standalone GO/WAIT/PASS/...
  // keyword in the ENTIRE report (every Market Intelligence report
  // mentions "Go-to-Market" -- \bGO\b matches the "GO" inside it, since a
  // hyphen is a non-word boundary), and separately maps a matched "PASS"
  // token to "GO" -- backwards. extractConfidence's bare percentage
  // fallback can likewise attach an unrelated "NN%" mentioned near the
  // word "confidence" anywhere in ordinary prose. Market Intelligence now
  // resolves decision AND confidence together from resolveMarketIntelligenceExecutiveDecision
  // (the ONE canonical source for this report kind), which never falls
  // through to either unsafe scan. Business Plan/Acquisition's own
  // generic buildExecutiveSnapshot values are completely untouched.
  const marketDecision = isMarketIntelligence
    ? resolveMarketIntelligenceExecutiveDecision(
        section.content,
        isMarketIntelligenceTurkish ? "Turkish" : "English"
      )
    : null;
  const snapshotDecision = marketDecision ? marketDecision.decisionLabel : snapshot.decision;
  const snapshotConfidenceScore = marketDecision ? marketDecision.confidenceScore : snapshot.confidenceScore;
  const snapshotConfidenceDisplay = marketDecision
    ? marketDecision.confidenceScore !== null
      ? `${marketDecision.confidenceScore}%`
      : "—"
    : snapshot.confidence;
  // CRITICAL FIX -- Executive Decision Center. The Founder Readiness
  // gauge reads investmentScore.decisionEngine, the founder-viability
  // score Market Intelligence never computes (report-isolation policy:
  // MI's own prompts "must never mention a founder ... or any
  // startup-readiness concept") -- so it always showed an empty/
  // meaningless gauge for this report kind. Replaced with a Market
  // Signal gauge for MI, reusing the SAME already-computed "Market"
  // confidenceRadar dimension shown a few lines below (not a new
  // calculation) -- a real, MI-appropriate figure instead of a
  // structurally-inapplicable one. Business Plan/Acquisition's founder
  // gauge is completely untouched.
  const marketSignalDimension = isMarketIntelligence
    ? confidenceRadarDimensions.find((dimension) => dimension.label === "Market" || dimension.label === "Pazar") ?? null
    : null;
  // CRITICAL FIX -- confirmed live: this panel's own "Main Risk"/"Next
  // Action" tiles and Risk Level badge were never covered by the decision/
  // confidence fix above -- they still read buildExecutiveSnapshot's
  // generic fallback (investmentScore is always empty for MI, so mainRisk
  // fell to normalizedRiskBullets[0] -- an unbounded full-content bullet
  // scan -- and riskLevel to inferRiskLevel's founder/business-plan
  // keyword presence-check, e.g. "cac"/"funding"). That let this card's
  // "Main Risk" silently disagree with the "Risk Posture" tile a few
  // lines above it in ExecutiveSummaryVisual, which correctly reads the
  // SAME deterministic banner's "Top 3 Risks" field -- two tiles on the
  // same report answering the same question with different text. Now
  // reads the identical canonical alias fields ExecutiveSummaryVisual's
  // Risk Posture tile and getMarketIntelligenceExecutiveHighlights already
  // use, so Main Risk/Next Action can never diverge from them again. Risk
  // Level's severity word is read from that SAME resolved risk sentence
  // (extractRiskLevel, already used identically for Market Metrics'
  // Threats-derived tile) rather than a fabricated classification --
  // falls back to the generic snapshot value only if the banner truly has
  // neither field (never invents a severity that isn't in the text).
  const marketMainRisk = isMarketIntelligence
    ? takeFirstListItem(extractMetricValueFromAliases(section.content, localizedLabelVariants("topRisks"))) ||
      snapshot.mainRisk
    : snapshot.mainRisk;
  const marketNextAction = isMarketIntelligence
    ? extractMetricValueFromAliases(section.content, localizedLabelVariants("immediateNextAction")) ||
      snapshot.nextAction
    : snapshot.nextAction;
  // CRITICAL FIX (Task #20) -- see page.tsx's own identical block for the
  // full rationale: snapshot.riskLevel's generic full-content keyword
  // scan is not a principled Market-Intelligence-specific derivation --
  // a coincidental match elsewhere in the text is not a defensible
  // severity signal.
  const marketRiskLevel = isMarketIntelligence
    ? (() => {
        const severity = extractRiskLevel(marketMainRisk);
        if (severity === "High") return "High";
        if (severity === "Moderate") return "Medium";
        if (severity === "Low") return "Low";
        return isMarketIntelligenceTurkish ? "Doğrulama Gerekli" : "Validation Needed";
      })()
    : snapshot.riskLevel;
  // CRITICAL FIX (Task #20) -- see page.tsx's own identical block for the
  // full rationale: snapshot.riskHeatmap is built entirely from
  // Business-Plan/startup risk categories Market Intelligence never
  // discusses, silently defaulting every category to "Low" purely
  // because its keyword never appeared. Rebuilt from the same canonical
  // Top 3 Risks list Main Risk already reads, falling back to a single
  // row reusing the already-resolved Main Risk/Risk Level so the heatmap
  // can never disagree with the tile next to it.
  const marketRiskHeatmap = isMarketIntelligence
    ? (() => {
        const topRisksBlock = extractMetricValueFromAliases(section.content, localizedLabelVariants("topRisks"));
        const riskItems = topRisksBlock
          ? topRisksBlock
              .split("\n")
              .map((line) => line.trim().replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, ""))
              .filter((line) => line.length > 8)
              .slice(0, 3)
          : [];

        if (riskItems.length > 0) {
          return riskItems.map((item, index) => ({
            label: `${isMarketIntelligenceTurkish ? "Risk" : "Risk"} ${index + 1}`,
            level:
              extractRiskLevel(item) || (isMarketIntelligenceTurkish ? "Doğrulama Gerekli" : "Validation Needed"),
          }));
        }

        return [
          {
            label: isMarketIntelligenceTurkish ? "Ana Risk" : "Main Risk",
            level: marketRiskLevel,
          },
        ];
      })()
    : snapshot.riskHeatmap;
  const groups = [
    { label: labels.why, items: snapshot.why },
    { label: labels.mainRisks, items: snapshot.risks },
    { label: labels.nextActions, items: snapshot.actions },
  ];
  const metrics = [
    { label: labels.financialQuality, value: snapshot.financialQuality },
    { label: labels.reportQuality, value: snapshot.reportQuality },
    { label: labels.mainRisk, value: marketMainRisk },
    { label: labels.nextAction, value: marketNextAction },
  ];

  return (
    <div className="mb-5 rounded-[1.75rem] border border-teal-200/15 bg-[linear-gradient(135deg,rgba(94,234,212,0.09),rgba(255,255,255,0.025))] p-4 shadow-inner shadow-teal-950/10">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            {labels.executiveSnapshot}
          </p>
          <h4 className="mt-2 text-xl font-semibold tracking-tight text-white">
            {labels.decision}: {snapshotDecision}
          </h4>
        </div>
        <span className="w-fit rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs font-semibold text-zinc-200">
          {labels.confidence}: {snapshotConfidenceDisplay}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <SnapshotGauge
          label={labels.confidenceGauge}
          value={snapshotConfidenceScore}
          display={snapshotConfidenceDisplay}
        />
        {isMarketIntelligence ? (
          <SnapshotGauge
            label={isMarketIntelligenceTurkish ? "Pazar Sinyali" : "Market Signal"}
            value={marketSignalDimension?.score ?? null}
            display={
              marketSignalDimension?.score === null || marketSignalDimension?.score === undefined
                ? isMarketIntelligenceTurkish
                  ? "Doğrulama Gerekli"
                  : "Validation Needed"
                : `${marketSignalDimension.score}%`
            }
          />
        ) : (
          <SnapshotGauge
            label={labels.founderScoreGauge}
            value={snapshot.founderScoreValue}
            display={snapshot.founderScore}
          />
        )}
        <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            {labels.riskLevel}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${getRiskIndicatorClass(marketRiskLevel)}`}>
              {marketRiskLevel}
            </span>
            <p className="line-clamp-2 text-sm leading-5 text-zinc-300">{marketMainRisk}</p>
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {metric.label}
            </p>
            <p className="mt-2 line-clamp-2 text-sm font-medium leading-5 text-zinc-200">
              {metric.value}
            </p>
          </div>
        ))}
      </div>
      {reportQualityBreakdown.length > 0 ? (
        <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-200/70">
            {labels.reportQuality}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {reportQualityBreakdown.map((item) => (
              <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  {item.label}
                </p>
                <p className="mt-1 text-sm font-semibold text-zinc-100">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-200/70">
            {labels.riskHeatmap}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {marketRiskHeatmap.map((risk) => (
              <div key={risk.label} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2">
                <span className="text-xs text-zinc-300">{risk.label}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getRiskIndicatorClass(risk.level)}`}>
                  {risk.level}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-200/70">
            {labels.confidenceRadar}
          </p>
          <div className="mt-3 space-y-2">
            {confidenceRadarDimensions.map((dimension) => (
              <div key={dimension.label} className="grid grid-cols-[5.75rem_minmax(0,1fr)_2.5rem] items-center gap-2">
                <span className="text-xs text-zinc-400">{dimension.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-white/10">
                  <span
                    className="block h-full rounded-full bg-teal-200"
                    style={{ width: `${dimension.score ?? 0}%` }}
                  />
                </span>
                <span className="text-right text-xs font-semibold text-zinc-300">
                  {dimension.score === null ? "--" : dimension.score}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {groups.map((group) => (
          <div key={group.label} className="rounded-2xl border border-white/10 bg-black/25 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              {group.label}
            </p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-300">
              {group.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200/80" />
                  <span className="line-clamp-3">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionTakeaway({ content }: { content: string }) {
  const takeaway = getSectionTakeaway(content);
  const labels = getReportPresentationLabels(content);

  if (!takeaway) {
    return null;
  }

  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-200/70">
        {labels.keyTakeaway}
      </p>
      <p className="mt-2 text-sm leading-6 text-zinc-300">{takeaway}</p>
    </div>
  );
}

function ConversationSidebar({
  conversations,
  activeConversationId,
  activeMode,
  modeSelected,
  onSelectConversation,
  onCreateConversation,
  onRenameConversation,
  onDeleteConversation,
}: {
  conversations: Conversation[];
  activeConversationId: string;
  activeMode: ChatMode;
  modeSelected: boolean;
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

    <aside className="hidden min-h-0 border-b border-white/10 bg-black/85 p-4 shadow-2xl shadow-black/30 backdrop-blur-2xl md:flex md:h-screen md:w-[21.5rem] md:flex-col md:border-b-0 md:border-r md:bg-black/75">
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
            {modeSelected
              ? activeMode === "plan"
                ? "Plan"
                : activeMode === "market"
                  ? "Market"
                  : "Advisor"
              : "Select"}
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

      <label className="mt-3 hidden items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-500 focus-within:ring-2 focus-within:ring-teal-200/30 md:flex">
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

// PERFORMANCE FIX -- confirmed live: dashboard/report pages became
// extremely slow (sometimes appearing stuck on the loading skeleton)
// during report streaming. Root cause: dedupeReportSections (used by
// ReportPanel below) rebuilds a brand-new section object for every field
// on every streaming chunk (standard, expected immutable-state practice),
// so every already-completed section gets a new object reference on every
// render even though its own text hasn't changed. This section's render
// body used to recompute detectPdfPresentationLocale/
// normalizeReportPresentationText/getReportPresentationLabels -- each a
// multi-pass scan over the full section text -- inline on every render of
// the parent, so EVERY already-finished section paid that cost again on
// EVERY chunk of a DIFFERENT, still-streaming section. The cost grew with
// report length and render frequency, matching the reported regression.
// Extracting this as its own memoized component, with a custom comparator
// keyed on the section's own content (a string, compared by value) rather
// than the section object's reference, means React skips re-rendering
// (and re-running this expensive work) entirely for any section whose
// text hasn't actually changed since the last render. Pure performance
// fix -- every value produced, and all rendered output, is identical to
// before.
const ReportSectionCard = memo(
  function ReportSectionCard({
    section,
    index,
    investmentScore,
    isDomainDecisionReport,
    isMarketIntelligence,
    reportQuality,
    waitingMessage,
    majorPlayersContent,
    executiveSummaryContent,
  }: {
    section: ReportSection;
    index: number;
    investmentScore?: ReportInvestmentScore;
    isDomainDecisionReport: boolean;
    isMarketIntelligence: boolean;
    reportQuality?: ReportQualityScore;
    waitingMessage: string;
    majorPlayersContent?: string;
    executiveSummaryContent?: string;
  }) {
    const Icon = section.icon;
    const isFinancialDashboard = section.field === "financialDashboard";
    const { detailsContent, presentationLabels, hasVisibleDetailsContent, sectionPdfLocale, sectionEvidenceLocale } =
      useMemo(() => {
        const detailsContent = isFinancialDashboard
          ? ""
          : normalizeReportPresentationText(
              section.field === "founderScore"
                ? normalizeFounderReadinessScoreText(
                    section.content,
                    readFounderReadinessScoreValue(investmentScore)
                  )
                : section.content
            );
        const presentationLabels = getReportPresentationLabels(section.content);
        const hasVisibleDetailsContent = detailsContent.replace(/[#*_`>\-[\]\s()]/g, "").trim().length > 0;
        const sectionPdfLocale = detectPdfPresentationLocale(section.content);
        const sectionEvidenceLocale = getResponseLanguage(sectionPdfLocale);

        return { detailsContent, presentationLabels, hasVisibleDetailsContent, sectionPdfLocale, sectionEvidenceLocale };
        // section.content is a string, compared by value -- this only
        // recomputes when this section's own text (or investmentScore, on
        // which founderScore's derived text also depends) actually changes.
      }, [section.content, section.field, isFinancialDashboard, investmentScore]);

    return (
      <article
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
              <div className="flex w-fit flex-wrap items-center gap-2">
                <EvidenceBadge level={getSectionEvidenceLevel(section)} locale={sectionEvidenceLocale} market={isMarketIntelligence} />
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-zinc-500">
                  {sectionPdfLocale === "tr" ? "Bölüm" : "Section"} {String(index + 1).padStart(2, "0")}
                </span>
              </div>
            </div>
            <div className="mt-4 border-t border-white/10 pt-4">
              {section.field === "executiveSummary" ? (
                <ExecutiveSummaryVisual
                  section={section}
                  investmentScore={investmentScore}
                  isMarketIntelligence={isMarketIntelligence}
                />
              ) : null}
              {!isDomainDecisionReport ? (
                <ExecutiveSnapshotPanel
                  section={section}
                  investmentScore={investmentScore}
                  reportQuality={reportQuality}
                  isMarketIntelligence={isMarketIntelligence}
                />
              ) : null}
              {!isDomainDecisionReport &&
              hasPremiumSectionVisual(section) &&
              section.field !== "financialDashboard" &&
              !cardFirstReportFields.has(section.field ?? "") ? (
                <ExecutiveInsightBanner section={section} />
              ) : null}
              {/* ExecutiveSummaryVisual (above) is already the dedicated
                  Executive Summary card -- PremiumSectionVisual's own
                  executiveSummary branch draws a second, different
                  "Executive Decision" card for the exact same section, so
                  it is skipped here rather than stacking two visual cards
                  for one section. */}
              {!isDomainDecisionReport && section.field !== "executiveSummary" ? (
                <PremiumSectionVisual
                  section={section}
                  investmentScore={investmentScore}
                  isMarketIntelligence={isMarketIntelligence}
                  majorPlayersContent={majorPlayersContent}
                  executiveSummaryContent={executiveSummaryContent}
                />
              ) : null}
              {/* Card-first sections (see cardFirstReportFields) already
                  surface their COMPLETE content via a dedicated visual card
                  -- each card's own extraction now captures the section's
                  full remaining prose/bullets, not just a teaser, so a
                  generic SectionTakeaway or a raw-text "Details"
                  disclosure underneath would only repeat what the card
                  already fully communicates. Neither renders for these
                  sections; every other section keeps both, unchanged. */}
              {hasVisibleDetailsContent && !cardFirstReportFields.has(section.field ?? "") ? (
                <SectionTakeaway content={detailsContent} />
              ) : null}
              {hasVisibleDetailsContent && !cardFirstReportFields.has(section.field ?? "") ? (
                <AnalysisNotes
                  compact
                  label={isFinancialDashboard ? "Metric Details" : presentationLabels.details}
                >
                  <MarkdownRenderer content={detailsContent} />
                </AnalysisNotes>
              ) : null}
            </div>
          </div>
        </div>
      </article>
    );
  },
  (prev, next) =>
    prev.section.content === next.section.content &&
    prev.section.field === next.section.field &&
    prev.section.title === next.section.title &&
    prev.section.icon === next.section.icon &&
    prev.index === next.index &&
    prev.investmentScore === next.investmentScore &&
    prev.isDomainDecisionReport === next.isDomainDecisionReport &&
    prev.reportQuality === next.reportQuality &&
    prev.waitingMessage === next.waitingMessage &&
    prev.majorPlayersContent === next.majorPlayersContent &&
    prev.executiveSummaryContent === next.executiveSummaryContent
);

const ReportPanel = memo(function ReportPanel({
  reportData,
  reportFields,
  reportId,
  reportTitle,
  reportDomain,
  sourcePrompt,
  reportLanguage,
  waitingMessage,
  result,
  failureMessage,
  warningMessage,
  investmentScore,
  benchmarkFit,
  benchmarkScore,
  reportQuality,
  isMarketIntelligence = false,
  onContinueAsChat,
  onBackToWorkspace,
}: {
  reportData: Partial<MarketReport & PlanReport> | null;
  reportFields: Array<{
    field: keyof (MarketReport & PlanReport);
    title: string;
    icon: LucideIcon;
  }>;
  reportId?: string;
  reportTitle: string;
  reportDomain?: ReportDomain;
  sourcePrompt?: string;
  reportLanguage: ResponseLanguage;
  waitingMessage: string;
  result: string;
  failureMessage?: string;
  warningMessage?: string;
  investmentScore?: ReportInvestmentScore;
  benchmarkFit?: ReportBenchmarkFit;
  benchmarkScore?: ReportBenchmarkScore;
  reportQuality?: ReportQualityScore;
  isMarketIntelligence?: boolean;
  onContinueAsChat: () => void;
  onBackToWorkspace: () => void;
}) {
  const sections = useMemo<ReportSection[]>(() => {
    if (reportData) {
      return dedupeReportSections(
        reportFields
          .filter((entry) => isUniversalCustomerFacingSection(entry))
          .map(({ field, title, icon }) => {
            // stripReportPresentationArtifacts runs after
            // sanitizeReportFieldContent's own, unrelated diagnostic-
            // routing cleanup -- a final defensive pass at the actual
            // render boundary, so this panel renders clean output even
            // if some future caller ever passes reportData/reportFields
            // in from a path that doesn't already filter/sanitize
            // upstream. CRITICAL FIX -- remove internal system language
            // from user-facing Market Intelligence output:
            // sanitizeMarketIntelligencePresentationText runs one
            // further, Market-Intelligence-only pass on top of that
            // (see its own doc comment) so this live composer view
            // matches the persisted dashboard viewer's presentation.
            const stripped = stripReportPresentationArtifacts(
              sanitizeReportFieldContent(field, reportData[field] || "")
            );
            return {
              field,
              title,
              icon,
              content:
                (isMarketIntelligence
                  ? sanitizeMarketIntelligencePresentationText(stripped)
                  : stripped) || waitingMessage,
            };
          })
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
  }, [reportData, reportFields, result, waitingMessage, isMarketIntelligence]);
  const effectiveFailureMessage = failureMessage || "";

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
  const isRealEstateReport = reportFields.some(
    ({ field }) => field === "assetIdentification"
  );
  // isLegalRenderableReport's heuristic (a bare "contract"/"legal"/
  // "compliance" keyword match) exists to catch legal-shaped reports
  // whose reportDomain wasn't reliably resolved -- it must never run when
  // reportDomain is already confidently a DIFFERENT known specialized
  // domain, since an Acquisition Due Diligence report legitimately
  // discusses the target's existing contracts and regulatory/compliance
  // considerations and must never be mislabeled and re-rendered as a
  // Legal Assessment because of that vocabulary (same reasoning already
  // applied to real_estate/market above the function's own type checks).
  const isKnownNonLegalSpecializedDomain =
    reportDomain === "real_estate" ||
    reportDomain === "finance" ||
    reportDomain === "accounting" ||
    reportDomain === "operations" ||
    reportDomain === "procurement" ||
    reportDomain === "acquisition";
  // CRITICAL FIX -- PDF export used the wrong report payload after Market
  // Intelligence generation. isLegalRenderableReport has its own explicit,
  // type-based exemptions for Real Estate/Acquisition/Market Analysis
  // (see that function's own comments) -- but this call site always
  // passed the literal placeholder "Strategic Report" instead of this
  // report's actual type, so none of those exemptions could ever fire
  // here specifically. Confirmed live: a Market Intelligence prompt that
  // merely contains the bare word "legal" (e.g. "I want a Market
  // Intelligence analysis, not a legal analysis.") matched
  // isLegalRenderableReport's fallback keyword heuristic and produced a
  // Legal Assessment Report PDF (Material Facts and nothing else) even
  // though the on-screen render -- which reads reportTitle/isMarketIntelligence
  // directly, not this function -- correctly showed the Market
  // Intelligence report. Passing the real type (mirroring exactly what
  // ReportPdfButton.tsx and page.tsx already pass via the full saved
  // report object) lets the exemptions this function already has work as
  // intended for the live/in-progress view too.
  const legalRenderableReportType = isRealEstateReport
    ? "Real Estate Investment Analysis"
    : reportDomain === "acquisition"
      ? "Acquisition Due Diligence Report"
      : isMarketIntelligence
        ? "Market Analysis"
        : "Strategic Report";
  const isLegalReport =
    reportDomain === "legal" ||
    (!isKnownNonLegalSpecializedDomain &&
      isLegalRenderableReport({
        type: legalRenderableReportType,
        title: reportTitle,
        prompt: sourcePrompt || "",
        sections,
      }));
  const isDomainDecisionReport =
    isRealEstateReport ||
    isLegalReport ||
    reportFields.some(({ field }) => field === "subjectIdentification");
  const { exportingPdf, pdfError, setPdfError, runPdfExport } = useReportExport({
    canExport: hasReportContent,
    failureMessage: effectiveFailureMessage,
    loadFont: loadPdfFont,
  });
  const pdfExportIntentRef = useRef(0);

  async function downloadPdf(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    const intentAge = Date.now() - pdfExportIntentRef.current;
    pdfExportIntentRef.current = 0;

    if (!event.isTrusted || intentAge < 0 || intentAge > 2_000) {
      return;
    }

    await runPdfExport(async (pdfFontBase64) => {
    const isSafari =
      /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
      navigator.vendor.includes("Apple");

    try {
      const permissionResponse = await fetch("/api/usage/pdf-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId: reportId || null,
          reportTitle,
        }),
      });

      if (!permissionResponse.ok) {
        const errorPayload = await permissionResponse
          .json()
          .catch(() => null) as { error?: string } | null;

        setPdfError(errorPayload?.error || "PDF export is unavailable right now.");
        return;
      }

      const pdf = createPdfDocument();
      const { pageWidth, pageHeight, margin, contentWidth } = getPdfPageMetrics(pdf);
      const bodyX = margin + 20;
      const bodyWidth = contentWidth - 28;
      const bodyLineHeight = 5.85;
      const cardHeaderHeight = 25;
      const cardBottomPadding = 11;
      const normalizedPdfSections = dedupePdfSections(mergePdfSourceSections(sections));
      const basePdfSections = isLegalReport
        ? buildLegalReportSections(
            normalizedPdfSections,
            getReportLanguageCode(reportLanguage),
            sourcePrompt
          ).map((section) => ({ ...section, icon: FileText }))
        : compactExecutiveDecisionMemoSections(normalizedPdfSections);
      const pdfLanguageSource =
        sourcePrompt?.trim() ||
        [reportTitle, ...basePdfSections.map((section) => `${section.title}\n${section.content}`)]
          .filter(Boolean)
          .join("\n\n");
      const pdfLocale = resolvePdfPresentationLocale(
        reportLanguage,
        pdfLanguageSource
      );
      const languageSafeBasePdfSections = repairReportLanguageSections(
        basePdfSections,
        pdfLocale
      ).sections;
      validateReportLanguageConsistency(
        [reportTitle, ...languageSafeBasePdfSections.map((section) => `${section.title}\n${section.content}`)].join("\n"),
        pdfLocale
      );
      const pdfBaseSectionsWithBenchmark = (
        isDomainDecisionReport
          ? languageSafeBasePdfSections
          : extractPdfValidationIntelligenceSection(
              insertPdfBenchmarkIntelligenceSection(
                languageSafeBasePdfSections,
                benchmarkFit,
                pdfLocale,
                benchmarkScore
              ),
              pdfLocale
            )
      ).map((section) => ({
        ...section,
        icon: "icon" in section ? section.icon : FileText,
      })) as ReportSection[];
      const pdfSections = localizePdfReportSections(pdfBaseSectionsWithBenchmark, pdfLocale);
      const localizedReportTitle = isLegalReport
        ? pdfLocale === "tr"
          ? "Hukuki Değerlendirme Raporu"
          : "Legal Assessment Report"
        : localizePdfPresentationLabel(reportTitle, pdfLocale);
      const fullReportContent = basePdfSections
        .map((section) => `${section.title}\n${section.content}`)
        .join("\n\n");
      const businessIdea = isLegalReport
        ? normalizePdfText(sourcePrompt || "").slice(0, 260)
        : deriveBusinessDescriptionFromSections(sourcePrompt || "", pdfSections);
      const tocEntries: Array<{ title: string; page: number }> = [];
      let y = margin;

      applyPdfFont(pdf, pdfFontBase64);

      const paintPage = () => {
        paintPdfPageBackground(pdf, { pageWidth, pageHeight });
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
        drawPdfFooter(pdf, {
          pageWidth,
          pageHeight,
          margin,
          locale: pdfLocale,
          includePageCounter,
        });
      };

      const drawLogoMark = (x: number, logoY: number, size = 13) => {
        drawPdfLogoMark(pdf, x, logoY, size);
      };

      const splitPdfReadableLines = (content: string, width: number) => {
        const repairedContent = repairPdfLineFragments(
          content.split("\n"),
          isOrphanBulletText
        ).join("\n");
        return splitPdfReadableLinesWithEngine({
          pdf,
          content: repairedContent,
          width,
          normalizeText: normalizePdfText,
          repairLineFragments: repairPdfLineFragments,
          isOrphanBulletText,
        });
      };

      const executiveSnapshot = buildExecutiveSnapshot(fullReportContent, investmentScore, reportQuality);
      const reportQualityBreakdown = getReportQualityBreakdown(reportQuality, pdfLocale === "tr");
      const realEstateDecisionFactors = [
        "Zoning Risk",
        "Title / Ownership Risk",
        "Market Evidence",
        "Access and Infrastructure",
        "Environmental and Geotechnical Risk",
        "Development Potential",
      ].map((label) => ({
        label,
        score: extractScore(fullReportContent, label),
      }));

      const drawDecisionGauge = (
        label: string,
        score: number | null,
        display: string,
        x: number,
        gaugeY: number,
        width: number
      ) => {
        const safeScore = Math.max(0, Math.min(100, score ?? 0));

        pdf.setFillColor("#09090b");
        pdf.setDrawColor("#27272a");
        pdf.roundedRect(x, gaugeY, width, 28, 4, 4, "FD");
        pdf.setFontSize(6.8);
        pdf.setTextColor("#71717a");
        pdf.text(localizePdfPresentationLabel(label, pdfLocale).toUpperCase(), x + 5, gaugeY + 7);
        pdf.setTextColor("#ffffff");
        // CRITICAL FIX -- this box is a fixed 28mm-tall, single-line
        // gauge. `display` can be up to ~120 characters of free text
        // (buildExecutiveSnapshot's confidence fallback, not just a
        // "NN%" figure) -- drawing it at a fixed 15pt with no width
        // constraint risked unbounded overflow past the box edge. Shrink
        // to fit first (same step size drawSingleLine below uses), then
        // hard-truncate only as a last resort.
        const gaugeMaxWidth = width - 10;
        let gaugeFontSize = 15;
        pdf.setFontSize(gaugeFontSize);
        while (gaugeFontSize > 6.5 && pdf.getTextWidth(display) > gaugeMaxWidth) {
          gaugeFontSize -= 0.35;
          pdf.setFontSize(gaugeFontSize);
        }
        const gaugeDisplayText =
          pdf.getTextWidth(display) > gaugeMaxWidth
            ? `${display.slice(0, Math.max(4, Math.floor(display.length * (gaugeMaxWidth / Math.max(pdf.getTextWidth(display), 1))) - 1))}…`
            : display;
        pdf.text(gaugeDisplayText, x + 5, gaugeY + 17);
        pdf.setFillColor("#27272a");
        pdf.roundedRect(x + 5, gaugeY + 21, width - 10, 2.4, 1.2, 1.2, "F");
        pdf.setFillColor("#5eead4");
        pdf.roundedRect(x + 5, gaugeY + 21, ((width - 10) * safeScore) / 100, 2.4, 1.2, 1.2, "F");
      };

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
        pdf.text("ZERINIX EXECUTIVE DECISION CENTER", margin + 31, 41);

        pdf.setFontSize(24);
        pdf.setTextColor("#ffffff");
        pdf.text(localizedReportTitle, margin + 12, 60, { maxWidth: contentWidth - 24 });

        pdf.setFontSize(8.5);
        pdf.setTextColor("#a1a1aa");
        pdf.text(localizePdfPresentationText(
          businessIdea || (isLegalReport
            ? "Legal decision support based on the supplied facts and usable evidence."
            : "Investor-grade decision snapshot generated from the current ZERINIX intelligence layers."),
          pdfLocale
        ), margin + 12, 75, {
          maxWidth: contentWidth - 24,
        });

        // CRITICAL FIX -- root-cause repair (ticket: "Fix the canonical
        // decision consistency bug"): confirmed live -- the PREVIOUS fix
        // here fell back to `buildExecutiveSnapshot(fullReportContent,
        // undefined, ...)` for decision, and `extractConfidence(fullReportContent)`
        // for confidence, whenever no deterministic decision banner was
        // present. Both scan the ENTIRE report: extractDecision matches
        // "GO" inside "Go-to-Market" (a phrase virtually every Market
        // Intelligence report mentions somewhere), and extractConfidence's
        // bare percentage fallback can attach an unrelated "NN%" mentioned
        // anywhere in the report near the word "confidence". This is the
        // confirmed root cause of the live defect (PDF cover/card showing
        // "GO"/"30%" while the web report correctly showed a conservative
        // "MONITOR..." verdict with no confidence figure). Market
        // Intelligence had NO branch of its own here at all before this,
        // so it also fell into the generic default branch below,
        // rendering a "Founder Readiness Score"/"Financial Quality" tile
        // (a report kind that never evaluates a founder, per this report
        // kind's own isolation policy). Now resolves through
        // resolveMarketIntelligenceExecutiveDecision -- the ONE
        // canonical decision/confidence source for Market Intelligence,
        // which never falls through to either unsafe scan -- over the
        // SAME executiveSummary section content the Executive Summary
        // card and the web report use, structurally guaranteeing the
        // cover can never disagree with either.
        const marketExecutiveSummaryContent = isMarketIntelligence
          ? pdfSections.find((section) => section.field === "executiveSummary")?.content || ""
          : "";
        const marketDecision = isMarketIntelligence
          ? resolveMarketIntelligenceExecutiveDecision(
              marketExecutiveSummaryContent,
              pdfLocale === "tr" ? "Turkish" : "English"
            )
          : null;
        const marketDecisionDisplay = marketDecision ? marketDecision.decisionLabel : "";
        const marketConfidenceScore = marketDecision ? marketDecision.confidenceScore : null;
        // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
        // production presentation hardening): mirrors the identical fix in
        // ReportPdfButton.tsx -- this exact value sits one row above
        // "Report Quality" in the metricCards array below, which already
        // resolves the SAME null-confidence case to a semantic label. A
        // bare "—" here read as an unexplained gap right next to that
        // resolved row; reusing the same existing label keeps both rows
        // internally consistent without fabricating a number.
        const marketConfidenceDisplay =
          marketConfidenceScore === null
            ? localizePdfPresentationLabel("Validation Required", pdfLocale)
            : `${marketConfidenceScore}%`;

        // CRITICAL FIX (Task #20) -- confirmed live: the Risk Heatmap
        // panel drawn below (see its own "executiveSnapshot.riskHeatmap"
        // fallback) was never gated for Market Intelligence -- it drew
        // Business-Plan/startup risk categories ("CAC", "Capital
        // efficiency", "Execution", ...) that Market Intelligence's own
        // prompts never discuss, silently defaulting every category to
        // "Low" purely because its keyword never appeared. Rebuilt from
        // the same canonical Top 3 Risks list the web report's own Risk
        // Posture tile reads, falling back to a single row reusing the
        // resolved Main Risk/severity so the heatmap can never disagree
        // with any other Risk Level surface for this same report.
        const marketMainRiskForHeatmap = isMarketIntelligence
          ? takeFirstListItem(extractMetricValueFromAliases(marketExecutiveSummaryContent, localizedLabelVariants("topRisks"))) ||
            executiveSnapshot.mainRisk
          : "";
        const marketRiskLevelForHeatmap = isMarketIntelligence
          ? (() => {
              const severity = extractRiskLevel(marketMainRiskForHeatmap);
              if (severity === "High") return "High";
              if (severity === "Moderate") return "Medium";
              if (severity === "Low") return "Low";
              return pdfLocale === "tr" ? "Doğrulama Gerekli" : "Validation Needed";
            })()
          : "";
        const marketRiskHeatmap = isMarketIntelligence
          ? (() => {
              const topRisksBlock = extractMetricValueFromAliases(
                marketExecutiveSummaryContent,
                localizedLabelVariants("topRisks")
              );
              const riskItems = topRisksBlock
                ? topRisksBlock
                    .split("\n")
                    .map((line) => line.trim().replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, ""))
                    .filter((line) => line.length > 8)
                    .slice(0, 3)
                : [];

              if (riskItems.length > 0) {
                return riskItems.map((item, index) => ({
                  label: `Risk ${index + 1}`,
                  level: extractRiskLevel(item) || (pdfLocale === "tr" ? "Doğrulama Gerekli" : "Validation Needed"),
                }));
              }

              return [
                {
                  label: pdfLocale === "tr" ? "Ana Risk" : "Main Risk",
                  level: marketRiskLevelForHeatmap,
                },
              ];
            })()
          : executiveSnapshot.riskHeatmap;

        const metricCards = isRealEstateReport
          ? [
              ["Decision", executiveSnapshot.decision],
              ["Confidence", executiveSnapshot.confidence],
              [
                "Evidence Quality",
                extractScore(fullReportContent, "Evidence Quality") === null
                  ? "Not verified"
                  : `${extractScore(fullReportContent, "Evidence Quality")}/100`,
              ],
              ["Main Risk", executiveSnapshot.mainRisk],
              [
                "Main Opportunity",
                extractMetricValue(fullReportContent, "Main Opportunity") ||
                  "See Development Potential",
              ],
              ["Required Next Action", executiveSnapshot.nextAction],
            ]
          : isMarketIntelligence
          ? [
              [localizePdfPresentationLabel("Decision", pdfLocale), marketDecisionDisplay],
              [localizePdfPresentationLabel("Confidence Score", pdfLocale), marketConfidenceDisplay],
              [localizePdfPresentationLabel("Report Quality", pdfLocale), executiveSnapshot.reportQuality],
              [localizePdfPresentationLabel("Main Risk", pdfLocale), executiveSnapshot.mainRisk],
              [localizePdfPresentationLabel("Next Action", pdfLocale), executiveSnapshot.nextAction],
            ]
          : isDomainDecisionReport
          ? [
              [localizePdfPresentationLabel("Decision", pdfLocale), executiveSnapshot.decision],
              [localizePdfPresentationLabel("Confidence Score", pdfLocale), executiveSnapshot.confidence],
              [localizePdfPresentationLabel("Report Quality", pdfLocale), executiveSnapshot.reportQuality],
              [localizePdfPresentationLabel("Main Risk", pdfLocale), executiveSnapshot.mainRisk],
              [localizePdfPresentationLabel("Next Action", pdfLocale), executiveSnapshot.nextAction],
            ]
          : [
              [localizePdfPresentationLabel("Decision", pdfLocale), executiveSnapshot.decision],
              [localizePdfPresentationLabel("Confidence Score", pdfLocale), executiveSnapshot.confidence],
              [localizePdfPresentationLabel("Founder Readiness Score", pdfLocale), executiveSnapshot.founderScore],
              [localizePdfPresentationLabel("Financial Quality", pdfLocale), executiveSnapshot.financialQuality],
              [localizePdfPresentationLabel("Report Quality", pdfLocale), executiveSnapshot.reportQuality],
              [localizePdfPresentationLabel("Main Risk", pdfLocale), executiveSnapshot.mainRisk],
              [localizePdfPresentationLabel("Next Action", pdfLocale), executiveSnapshot.nextAction],
            ];

        const metricColumns = 3;
        const metricGap = 5;
        const metricCardWidth = (contentWidth - 24 - metricGap * (metricColumns - 1)) / metricColumns;
        metricCards.forEach(([label, value], index) => {
          const cardX = margin + 12 + (index % metricColumns) * (metricCardWidth + metricGap);
          const cardY = 91 + Math.floor(index / metricColumns) * 20;

          pdf.setFillColor("#09090b");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(cardX, cardY, metricCardWidth, 17, 4, 4, "FD");
          pdf.setFontSize(7.5);
          pdf.setTextColor("#71717a");
          pdf.text(label.toUpperCase(), cardX + 5, cardY + 6);
          pdf.setFontSize(index > 4 ? 7.7 : 10);
          pdf.setTextColor("#f4f4f5");
          // P0 PRODUCTION FIX -- confirmed live (Market Intelligence PDF
          // layout hardening): the old .slice(0, 2) silently dropped any
          // wrapped line beyond the first two with no visual cue at all,
          // unlike every other truncation point in this file (which all
          // append "..." via truncatePdfCellLines) -- a reader could not
          // tell Main Risk/Next Action had been cut short. truncatePdfCellLines
          // itself is declared later in this function, so its exact
          // "keep N lines, append '...' to the last" logic is inlined here
          // rather than reordering unrelated code to hoist it earlier.
          const rawValueLines = pdf.splitTextToSize(value, metricCardWidth - 10) as string[];
          const valueLines = rawValueLines.slice(0, 2);
          if (rawValueLines.length > 2 && valueLines.length > 0) {
            valueLines[valueLines.length - 1] = `${valueLines[valueLines.length - 1].replace(/[.,;:]*$/, "")}...`;
          }
          pdf.text(valueLines, cardX + 5, cardY + 12, {
            lineHeightFactor: 1.05,
            maxWidth: metricCardWidth - 10,
          });
        });

        const gaugeWidth = (contentWidth - 33) / 2;
        drawDecisionGauge(
          "Confidence Gauge",
          isMarketIntelligence ? marketConfidenceScore : executiveSnapshot.confidenceScore,
          isMarketIntelligence ? marketConfidenceDisplay : executiveSnapshot.confidence,
          margin + 12,
          156,
          gaugeWidth
        );
        // Market Intelligence never evaluates a founder (report isolation
        // policy) -- a Founder Readiness gauge is structurally
        // inapplicable, so it is suppressed here exactly like
        // isDomainDecisionReport already suppresses it for Real
        // Estate/Legal/domain-analysis reports.
        if (!isDomainDecisionReport && !isMarketIntelligence) {
          drawDecisionGauge("Founder Readiness Gauge", executiveSnapshot.founderScoreValue, executiveSnapshot.founderScore, margin + 21 + gaugeWidth, 156, gaugeWidth);
        }

        const heatmapY = reportQualityBreakdown.length ? 211 : 195;
        const panelWidth = (contentWidth - 33) / 2;
        if (reportQualityBreakdown.length) {
          const qualityY = 188;
          const itemWidth = (contentWidth - 34) / 6;
          pdf.setFillColor("#09090b");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(margin + 12, qualityY, contentWidth - 24, 15, 4, 4, "FD");
          reportQualityBreakdown.forEach((item, index) => {
            const itemX = margin + 16 + index * itemWidth;
            pdf.setFontSize(4.8);
            pdf.setTextColor("#71717a");
            pdf.text(localizePdfPresentationLabel(item.label, pdfLocale).toUpperCase(), itemX, qualityY + 5, {
              maxWidth: itemWidth - 3,
            });
            pdf.setFontSize(7.5);
            pdf.setTextColor("#f4f4f5");
            pdf.text(item.value, itemX, qualityY + 11.2, { maxWidth: itemWidth - 3 });
          });
        }
        pdf.setFillColor("#09090b");
        pdf.setDrawColor("#27272a");
        pdf.roundedRect(margin + 12, heatmapY, panelWidth, 42, 4, 4, "FD");
        pdf.setFontSize(7.2);
        pdf.setTextColor("#5eead4");
        pdf.text(localizePdfPresentationLabel("Risk Heatmap", pdfLocale).toUpperCase(), margin + 17, heatmapY + 7);
        (isRealEstateReport
          ? realEstateDecisionFactors.map((item) => ({
              label:
                item.label === "Title / Ownership Risk"
                  ? "Legal Risk"
                  : item.label === "Access and Infrastructure"
                    ? "Infrastructure"
                    : item.label === "Environmental and Geotechnical Risk"
                      ? "Environmental Risk"
                      : item.label,
              level:
                item.score === null
                  ? "Not verified"
                  : item.score >= 70
                    ? "Strong"
                    : item.score >= 40
                      ? "Partial"
                      : "Weak",
            }))
          : marketRiskHeatmap).forEach((risk, index) => {
          const rowY = heatmapY + 14 + index * 5;
          pdf.setFontSize(6.4);
          pdf.setTextColor("#d4d4d8");
          pdf.text(localizePdfPresentationLabel(risk.label, pdfLocale), margin + 17, rowY, { maxWidth: panelWidth - 33 });
          pdf.setFillColor(
            risk.level === "High" || risk.level === "Weak"
              ? "#7f1d1d"
              : risk.level === "Medium" || risk.level === "Partial"
                ? "#713f12"
                : risk.level.toLowerCase() === "unknown" ||
                    risk.level === "Validation Needed" ||
                    risk.level === "Doğrulama Gerekli"
                  ? "#3f3f46"
                  : "#064e3b"
          );
          pdf.roundedRect(margin + panelWidth - 9, rowY - 3.2, 16, 4.2, 2, 2, "F");
          pdf.setFontSize(5.4);
          pdf.setTextColor("#ffffff");
          pdf.text(risk.level, margin + panelWidth - 6.5, rowY - 0.2, { maxWidth: 12 });
        });

        pdf.setFillColor("#09090b");
        pdf.setDrawColor("#27272a");
        pdf.roundedRect(margin + 21 + panelWidth, heatmapY, panelWidth, 42, 4, 4, "FD");
        pdf.setFontSize(7.2);
        pdf.setTextColor("#5eead4");
        pdf.text(
          localizePdfPresentationLabel(
            isMarketIntelligence ? "Confidence Factors" : "Confidence Radar",
            pdfLocale
          ).toUpperCase(),
          margin + 26 + panelWidth,
          heatmapY + 7
        );
        // CRITICAL FIX -- one of executiveSnapshot.confidenceRadar's 5
        // dimensions is literally labeled "Evidence"/"Kanıt" (see
        // buildConfidenceRadar in report-presentation.ts). Only Market
        // Intelligence's copy of the array is remapped here; the
        // underlying shared computation and Business Plan/Acquisition
        // rendering are untouched.
        const marketIntelligenceConfidenceRadarDimensions = isMarketIntelligence
          ? executiveSnapshot.confidenceRadar.map((dimension) =>
              dimension.label === "Evidence" || dimension.label === "Kanıt"
                ? { ...dimension, label: pdfLocale === "tr" ? "Pazar Sinyalleri" : "Market Signals" }
                : dimension
            )
          : executiveSnapshot.confidenceRadar;
        (isRealEstateReport
          ? [
              { label: "Evidence Quality", score: extractScore(fullReportContent, "Evidence Quality") },
              { label: "Zoning Risk", score: extractScore(fullReportContent, "Zoning Risk") },
              { label: "Market Evidence", score: extractScore(fullReportContent, "Market Evidence") },
              { label: "Infrastructure", score: extractScore(fullReportContent, "Access and Infrastructure") },
              { label: "Environmental Risk", score: extractScore(fullReportContent, "Environmental and Geotechnical Risk") },
              { label: "Development Potential", score: extractScore(fullReportContent, "Development Potential") },
            ]
          : marketIntelligenceConfidenceRadarDimensions).forEach((dimension, index) => {
          const rowY = heatmapY + 14 + index * 5;
          const score = Math.max(0, Math.min(100, dimension.score ?? 0));
          pdf.setFontSize(6.4);
          pdf.setTextColor("#d4d4d8");
          pdf.text(localizePdfPresentationLabel(dimension.label, pdfLocale), margin + 26 + panelWidth, rowY, { maxWidth: 34 });
          pdf.setFillColor("#27272a");
          pdf.roundedRect(margin + 58 + panelWidth, rowY - 2.8, panelWidth - 50, 2, 1, 1, "F");
          pdf.setFillColor("#5eead4");
          pdf.roundedRect(margin + 58 + panelWidth, rowY - 2.8, ((panelWidth - 50) * score) / 100, 2, 1, 1, "F");
          pdf.setFontSize(5.8);
          pdf.setTextColor("#a1a1aa");
          pdf.text(dimension.score === null ? "--" : String(dimension.score), margin + contentWidth - 11, rowY - 0.8);
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
      // CRITICAL FIX -- confirmed live: this running title previously had
      // NO maxWidth/wrap/truncate at all, so a long report title ran
      // straight off the page edge, silently clipped by the page
      // boundary with no ellipsis or visual cue -- worse than truncation,
      // an invisible loss. Wraps like the cover title above, then pushes
      // everything below down to match (mirrors ReportPdfButton.tsx's
      // already-correct section-page running title).
      const runningTitleMaxWidth = contentWidth - 40;
      const runningTitleLines = pdf.splitTextToSize(localizedReportTitle, runningTitleMaxWidth) as string[];
      pdf.text(runningTitleLines, margin, y + 11, {
        lineHeightFactor: 1.08,
        maxWidth: runningTitleMaxWidth,
      });

      pdf.setFillColor("#042f2e");
      pdf.setDrawColor("#115e59");
      pdf.roundedRect(pageWidth - margin - 32, y + 1, 32, 10, 5, 5, "FD");
      pdf.setFont("Geist", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor("#ccfbf1");
      pdf.text(localizePdfPresentationLabel("AI Ready", pdfLocale), pageWidth - margin - 25, y + 7.3);

      y += 26 + Math.max(0, runningTitleLines.length - 1) * 7;

      const summaryCards = [
        `${pdfSections.filter((section) => !isSourceSection(section)).length} Sections`,
        isRealEstateReport
          ? "Due-Diligence Report"
          : isLegalReport
            ? pdfLocale === "tr" ? "Hukuki Analiz" : "Legal Analysis"
            : "Investor Ready",
        isRealEstateReport
          ? "Real Estate Decision Model"
          : isLegalReport
            ? pdfLocale === "tr" ? "Hukuki Karar Desteği" : "Legal Decision Support"
            : "Strategy Model",
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
        "executiveSummary",
        "founderRoadmap",
        "roadmap306090",
        "portersFiveForces",
        "risks",
        "kpis",
        "competitiveLandscape",
        "strategicRecommendations",
        ...pdfKeyTakeawayCardFields,
      ]);

      if (isDomainDecisionReport) {
        visualFields.clear();
      }

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
        const labels = normalizePdfFinancialMetrics(content, fullReportContent);
        const columns = 3;
        const itemWidth = (width - (columns - 1) * 3) / columns;
        const itemHeight = 18;
        const items = labels
          .map((item) => {
            const value = item.value;
            const compactValue = item.compactValue;
            const detailLine = buildPdfFinancialMetricDetailLine(
              localizePdfPresentationLabel(item.label, pdfLocale),
              item.aliases,
              metricContent,
              value
            );
            const descriptionLines = compactValue
              ? (pdf.splitTextToSize(detailLine, width - 6) as string[])
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

      // Fixed footprint for the Competitive Landscape table/Market Map
      // below -- shared between getPdfVisualHeight (pagination budgeting)
      // and drawPdfVisual (drawing) so the two never disagree on how much
      // space the visual needs.
      const competitorHeaderHeight = 8;
      const competitorRowHeight = 15;
      // P0 PRODUCTION FIX -- confirmed live (Market Intelligence PDF
      // layout hardening): mirrors the identical fix in
      // ReportPdfButton.tsx -- see its own comment for the full root
      // cause (a single fixed 36mm card height regardless of actual
      // action-text/field/gate content, causing visible truncation and
      // overlap on row 2 specifically). Replaced with a real per-card
      // height derived from that card's own content, computed identically
      // for both getPdfVisualHeight (budgeting) and drawPdfVisual
      // (drawing) so the two can never disagree.
      const recommendationCardGap = 3;
      const recommendationCardMinHeight = 36;
      // TASK #17 -- fixed height reserved for the "Current Decision: X"
      // line drawn above the recommendation cards (see drawPdfVisual's own
      // strategic-recommendation branch), read once here so
      // getPdfVisualHeight (pagination budgeting) and drawPdfVisual
      // (drawing) can never disagree about how much space it needs.
      const strategicRecommendationDecisionBadgeHeight = 7;
      const computeRecommendationCardLayout = (item: string, cardWidth: number) => {
        const { timeframe, metric, budget, owner, gate } = extractRecommendationSignals(item);
        pdf.setFontSize(6);
        const actionLines = truncatePdfCellLines(
          pdf.splitTextToSize(localizePdfPresentationText(item, pdfLocale), cardWidth - 13) as string[],
          2
        );
        const fields = (
          [
            ["Owner", owner],
            ["Timeline", timeframe],
            ["Budget", budget],
            ["Success Metric", metric],
          ] as const
        ).filter(([, value]) => value);
        const fieldsTopY = 7.8 + actionLines.length * 3.3 + 2.5;
        const fieldsRows = fields.length > 0 ? Math.ceil(Math.min(fields.length, 4) / 2) : 0;
        const contentBottom =
          fieldsRows > 0 ? fieldsTopY + (fieldsRows - 1) * 5.6 + 5.5 : fieldsTopY + 3;
        const gateReservedHeight = gate ? 9 : 0;
        const height = Math.max(recommendationCardMinHeight, contentBottom + gateReservedHeight);

        return { timeframe, metric, budget, owner, gate, actionLines, fields, fieldsTopY, height };
      };
      const computeRecommendationRowHeights = (items: string[], cardWidth: number) => {
        const cards = items.map((item) => computeRecommendationCardLayout(item, cardWidth));
        const rowHeights = Array.from({ length: Math.ceil(cards.length / 2) }, (_, row) =>
          Math.max(cards[row * 2]?.height ?? 0, cards[row * 2 + 1]?.height ?? 0)
        );

        return { cards, rowHeights };
      };

      // Fixed-line-count cells (table cells, action cards) hard-slice a
      // wrapped line array to fit their budgeted height; slicing alone
      // silently drops the remainder with no visual cue that content was
      // cut. Mirrors ReportPdfButton.tsx's own truncatePdfCellLines.
      const truncatePdfCellLines = (lines: string[], maxLines: number) => {
        if (lines.length <= maxLines) return lines;
        const output = lines.slice(0, maxLines);
        output[maxLines - 1] = `${output[maxLines - 1].replace(/[.,;:]*$/, "")}...`;
        return output;
      };

      // Shared by drawPdfVisual's Executive Summary branch (drawing) and
      // getPdfVisualHeight (pagination budgeting) -- computing the
      // decision/confidence/why/top-risk/etc. values AND their wrapped
      // line counts in exactly one place is what guarantees the height
      // reserved for this card always matches what actually gets drawn
      // in it. Also the root fix for ticket-reported truncation of Why/
      // Top Risk/Information Required/Next Action: those 4 values
      // previously always drew through drawSingleLine (a single-line-
      // only helper that hard-truncates with an ellipsis regardless of
      // available page space) inside a hardcoded 15mm-tall tile. Now
      // wraps up to 4 lines and only grows the tile past its original
      // 15mm height when the content actually needs more room. Mirrors
      // ReportPdfButton.tsx's own getExecutiveDecisionCardLayout.
      const getExecutiveDecisionCardLayout = (content: string, width: number) => {
        const whyLabels = localizedLabelVariants("why");
        const topRisksLabels = localizedLabelVariants("topRisks");
        const missingEvidenceLabels = localizedLabelVariants("missingEvidence");
        const whatWouldChangeLabels = localizedLabelVariants("whatWouldChangeThisDecision");
        const immediateNextActionLabels = localizedLabelVariants("immediateNextAction");
        const why = extractMetricValueFromAliases(content, whyLabels);
        const topRisk = extractAliasedSectionSnippet(content, topRisksLabels, missingEvidenceLabels);
        const missingEvidence = extractAliasedSectionSnippet(content, missingEvidenceLabels, whatWouldChangeLabels);
        const whatWouldChange = extractMetricValueFromAliases(content, whatWouldChangeLabels);
        const nextAction = extractMetricValueFromAliases(content, immediateNextActionLabels);

        // CRITICAL FIX -- root-cause repair (ticket: "Fix the canonical
        // decision consistency bug"): confirmed live -- the PREVIOUS fix
        // here fell back to `buildExecutiveSnapshot(fullReportContent,
        // undefined, ...)` for decision, and `extractConfidence(fullReportContent)`
        // for confidence, whenever this section's own deterministic
        // banner wasn't found. Both scan the ENTIRE report: extractDecision
        // matches "GO" inside "Go-to-Market" (a phrase virtually every
        // Market Intelligence report mentions somewhere), and
        // extractConfidence's bare percentage fallback can attach an
        // unrelated "NN%" mentioned anywhere in the report near the word
        // "confidence". This is the confirmed root cause of the live
        // defect (PDF cover/card showing "GO"/"30%" while the web report
        // correctly showed a conservative "MONITOR..." verdict with no
        // confidence figure). Now resolves through
        // resolveMarketIntelligenceExecutiveDecision -- the ONE
        // canonical decision/confidence source for Market Intelligence,
        // which never falls through to either unsafe scan.
        const marketDecision = isMarketIntelligence
          ? resolveMarketIntelligenceExecutiveDecision(content, pdfLocale === "tr" ? "Turkish" : "English")
          : null;
        const decisionMatch = extractExecutiveDecisionFromText(content);
        const decisionLabel = marketDecision
          ? marketDecision.decisionLabel
          : decisionMatch?.token.toUpperCase() || "—";
        const confidence = marketDecision
          ? marketDecision.confidenceScore
          : extractConfidence(content) ??
            investmentScore?.confidence ??
            extractConfidence(fullReportContent) ??
            extractScore(fullReportContent, "Investment Score");

        const isTurkishPdf = pdfLocale === "tr";
        // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
        // production presentation hardening): mirrors the identical fix
        // in ReportPdfButton.tsx -- a bare "—" for Confidence reads as
        // an unexplained gap rather than a stated evidence state.
        // Reuses the same existing "Validation Required" terminology
        // this codebase already shows for the identical null-confidence
        // state elsewhere, rather than inventing new wording.
        const recItems: Array<[string, string]> = [
          [
            "Confidence",
            confidence === null
              ? localizePdfPresentationLabel("Validation Required", pdfLocale)
              : `${confidence}%`,
          ],
          [
            "Why",
            why ||
              extractKeywordInsight(fullReportContent, ["opportunity", "market"]) ||
              (isTurkishPdf ? "Gerekçe, yönetici kararı bölümünde detaylandırılmıştır" : "Rationale is detailed in the executive decision"),
          ],
          [
            "Top Risk",
            topRisk ||
              extractKeywordInsight(fullReportContent, ["risk", "threat"]) ||
              (isTurkishPdf ? "Ana risk, risk analizi bölümünde detaylandırılmıştır" : "Primary risk is detailed in the risk analysis"),
          ],
          // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
          // production consistency hardening): mirrors the identical fix
          // in ReportPdfButton.tsx -- the old fallback described parser/
          // generation state ("not explicitly stated in the generated
          // executive summary"), which reads as internal system language
          // rather than a finding about the market. Same honest,
          // evidence-aware wording used there for the equivalent state.
          [
            isMarketIntelligence ? "Information Required Before Decision" : "Missing Evidence",
            missingEvidence ||
              (isTurkishPdf
                ? "Nihai karardan önce ek doğrulama gereklidir."
                : "Additional validation required before a final decision."),
          ],
          // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
          // production consistency hardening): mirrors the identical fix
          // in ReportPdfButton.tsx -- extractKeywordInsight's unscoped
          // full-report scan produced a malformed mid-sentence fragment.
          // Falls back to the model's own scoped "(5) Recommendation"
          // bullets (confined to this card's own `content`, never the
          // full report) first.
          [
            "Next Action",
            nextAction ||
              whatWouldChange ||
              (isMarketIntelligence
                ? takeFirstListItem(
                    extractMetricValueFromAliases(content, [
                      "Recommendation",
                      "Öneri",
                      "Empfehlung",
                      "Recommandation",
                      "Recomendación",
                    ])
                  )
                : "") ||
              extractKeywordInsight(fullReportContent, ["next action", "critical action", "validate"]) ||
              (isTurkishPdf ? "Acil sonraki adım için yönetici kararı bölümüne bakın" : "See the Immediate Next Action in the executive decision"),
          ],
        ];

        const itemWidth = (width - 68) / 2;
        const previousFontSize = pdf.getFontSize();
        pdf.setFontSize(6);
        const wrappedValues = recItems.map(([, value]) =>
          (pdf.splitTextToSize(localizePdfPresentationText(value, pdfLocale), itemWidth - 4) as string[]).slice(0, 4)
        );
        pdf.setFontSize(previousFontSize);

        const rowHeights: number[] = [];
        for (let row = 0; row * 2 < recItems.length; row += 1) {
          const leftLines = wrappedValues[row * 2]?.length ?? 1;
          const rightLines = wrappedValues[row * 2 + 1]?.length ?? 1;
          const maxLines = Math.max(leftLines, rightLines, 1);
          rowHeights.push(Math.max(15, 7.8 + (maxLines - 1) * 3.2 + 3));
        }
        const gridHeight =
          rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rowHeights.length - 1) * 2;
        // The card's previous fixed 65 return value already carried ~16mm
        // of padding beyond the raw 3-row grid's own math (49mm) -- kept
        // here so short-content reports render at identical proportions
        // to before; only content that needs more than the original
        // per-tile height grows the card.
        const totalHeight = Math.max(65, gridHeight + 16);

        return {
          decisionLabel,
          confidence,
          recItems,
          itemWidth,
          wrappedValues,
          rowHeights,
          totalHeight,
        };
      };

      // Shared by drawPdfVisual's Competitive Landscape branch (drawing)
      // and getPdfVisualHeight (pagination budgeting) for the "no
      // structured rows, but Major Players names real vendors" state --
      // see extractMarketIntelligenceCompetitorNamesOnly's own comment.
      // Mirrors ReportPdfButton.tsx's own getNamesOnlyCompetitorLayout --
      // see its own P0 fix comment for why introText is now a parameter
      // rather than a single hardcoded sentence.
      const getNamesOnlyCompetitorLayout = (namesOnly: string[], width: number, introText: string) => {
        const previousFontSize = pdf.getFontSize();
        pdf.setFontSize(5.8);
        const introLines = pdf.splitTextToSize(
          localizePdfPresentationText(introText, pdfLocale),
          width - 6
        ) as string[];
        pdf.setFontSize(6.2);
        const nameLines = pdf.splitTextToSize(namesOnly.join("   •   "), width - 6) as string[];
        pdf.setFontSize(previousFontSize);
        const totalHeight = 13 + introLines.length * 3.6 + 5 + nameLines.length * 3.8 + 6;

        return { introLines, nameLines, totalHeight };
      };
      // CRITICAL FIX (Task #15) -- see ReportPdfButton.tsx's own identical
      // constant for the full rationale: the old wording cast doubt on
      // whether these are evidence-supported named players at all, when
      // only the structured attribute comparison was ever unvalidated.
      const adjacentPlayersOnlyIntro =
        "These companies are identified in available evidence as active market participants. Detailed competitive comparison -- positioning, strengths, weaknesses, and market share -- has not yet been independently validated for this analysis.";
      // Distinct from adjacentPlayersOnlyIntro above -- see
      // ReportPdfButton.tsx's own identical constant for the full
      // rationale: these rows ARE validated, named competitors, and the
      // gap is structured comparison DATA, not competitor identity.
      const sparseCompetitorTableIntro =
        pdfLocale === "tr"
          ? "Bu şirketler mevcut kanıtlarla doğrulanmış rakiplerdir, ancak güvenilir bir karşılaştırma tablosu oluşturmak için yeterli sayıda şirkette yapılandırılmış konumlandırma verisi (kategori, pazar konumu, güçlü/zayıf yönler) henüz bulunmamaktadır. Ek doğrulanmış kanıt gerekmektedir."
          : "These are validated, named competitors from available evidence, but there is not yet enough structured comparison data (category, market position, relative strengths and weaknesses) across enough of them to build a reliable side-by-side table. Additional validated evidence is needed.";
      const minCompetitorTableRows = 3;

      const getPdfVisualHeight = (section: ReportSection) => {
        if (!visualFields.has(section.field)) {
          return 0;
        }

        if (pdfKeyTakeawayCardFields.has(section.field ?? "")) {
          const takeaway = getSectionTakeaway(section.content);
          if (!takeaway) {
            return 0;
          }
          const previousFontSize = pdf.getFontSize();
          pdf.setFontSize(8.4);
          const takeawayLines = pdf.splitTextToSize(localizePdfPresentationText(takeaway, pdfLocale), bodyWidth - 12) as string[];
          pdf.setFontSize(previousFontSize);
          return Math.max(16, 8 + Math.min(3, takeawayLines.length) * 4.4);
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
          // Must match drawPdfVisual's own isPorterSection branch exactly
          // (Math.max(44, forces.length(5) * forceCardSpacing(16))).
          return Math.max(44, 5 * 16);
        }

        if (section.field === "founderScore") {
          return 46;
        }

        if (section.field === "tamSamSom") {
          // Must match drawPdfVisual's own tamCircleVisualHeight exactly
          // (tamCircleMaxRadius * 2 + 8 + 27) -- a mismatch here would
          // under- or over-budget the card's page space.
          return tamCircleMaxRadius * 2 + 8 + 27;
        }

        if (section.field === "scenarioAnalysis") {
          return 26;
        }

        if (section.field === "kpiDashboard" || section.field === "kpis") {
          return 52;
        }

        if (section.field === "competitiveLandscape") {
          // Row source must match drawPdfVisual's own fork exactly -- MI
          // reports draw extractMarketIntelligenceCompetitorRows (plus the
          // Market Map), everything else draws extractCompetitorRows with
          // no Market Map -- or drawing and pagination height disagree.
          if (isMarketIntelligence) {
            const rows = extractMarketIntelligenceCompetitorRows(
              section.content,
              pdfSections.find((entry) => entry.field === "majorPlayers")?.content
            );
            // Must match drawPdfVisual's own compactCompetitorState fork
            // exactly -- see its own comment -- or drawing and pagination
            // height disagree.
            if (rows.length === 0) {
              const namesOnly = extractMarketIntelligenceCompetitorNamesOnly(
                pdfSections.find((entry) => entry.field === "majorPlayers")?.content || ""
              );
              if (namesOnly.length > 0) {
                return getNamesOnlyCompetitorLayout(namesOnly, bodyWidth, adjacentPlayersOnlyIntro).totalHeight + 8 + 50;
              }
            } else if (rows.length < minCompetitorTableRows) {
              return (
                getNamesOnlyCompetitorLayout(
                  rows.map((row) => row.vendor || "Vendor"),
                  bodyWidth,
                  sparseCompetitorTableIntro
                ).totalHeight +
                8 +
                50
              );
            }
            return competitorHeaderHeight + Math.max(1, rows.length) * competitorRowHeight + 4 + 8 + 50;
          }
          const rows = extractCompetitorRows(section.content);
          if (rows.length === 0) {
            return competitorHeaderHeight + competitorRowHeight + 4;
          }
          if (rows.length < minCompetitorTableRows) {
            return getNamesOnlyCompetitorLayout(
              rows.map((row) => row.company || "Company"),
              bodyWidth,
              sparseCompetitorTableIntro
            ).totalHeight;
          }
          return competitorHeaderHeight + rows.length * competitorRowHeight + 4;
        }

        if (section.field === "strategicRecommendations") {
          const items = extractRecommendationItems(section.content).slice(0, 4);
          if (items.length === 0) {
            return 0;
          }
          const cardWidth = (bodyWidth - recommendationCardGap) / 2;
          const { rowHeights } = computeRecommendationRowHeights(items, cardWidth);
          return (
            strategicRecommendationDecisionBadgeHeight +
            rowHeights.reduce((sum, height) => sum + height, 0) +
            Math.max(0, rowHeights.length - 1) * recommendationCardGap
          );
        }

        if (section.field === "executiveSummary") {
          return getExecutiveDecisionCardLayout(section.content, bodyWidth).totalHeight;
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

        // Competitive Landscape's markdown table becomes a real table
        // (plus a Market Map for Market Intelligence reports) instead of
        // rendering as raw "| Vendor | Category | ... |" pipe syntax --
        // mirrored from ReportPdfButton.tsx so this PDF path matches both
        // the on-screen PremiumSectionVisual and the other PDF export.
        if (section.field === "competitiveLandscape") {
          const marketMapGap = 8;
          const marketMapHeight = 50;

          // Market Intelligence gets its own real column set (see
          // extractMarketIntelligenceCompetitorRows' own comment) -- the
          // generic table below stays exactly as it always was for
          // Business Plan/Acquisition.
          if (isMarketIntelligence) {
            const miRows = extractMarketIntelligenceCompetitorRows(
              section.content,
              pdfSections.find((entry) => entry.field === "majorPlayers")?.content
            );
            // CRITICAL FIX -- confirmed live: before falling back to a
            // bare empty table shell, check whether Major Players
            // actually names real, plausible vendors that just don't fit
            // the strict row shape (see
            // extractMarketIntelligenceCompetitorNamesOnly's own
            // comment). Never fabricates category/position/strengths/
            // weaknesses to fill the full table -- shows a distinct,
            // honest state instead, matching the on-screen dashboard.
            const namesOnly =
              miRows.length === 0
                ? extractMarketIntelligenceCompetitorNamesOnly(
                    pdfSections.find((entry) => entry.field === "majorPlayers")?.content || ""
                  )
                : [];
            // P0 PRODUCTION FIX -- confirmed live (Market Intelligence PDF
            // layout hardening, round 2): mirrors ReportPdfButton.tsx's
            // identical fix -- see its own comment for the full root
            // cause (a sparse 1-2 row table rendered a mostly-empty
            // spacious 7-column grid instead of a compact, honest state).
            const compactCompetitorState =
              namesOnly.length > 0
                ? {
                    headerText: "RELEVANT PLAYERS IDENTIFIED — DETAILED COMPARISON REQUIRES VALIDATION",
                    layout: getNamesOnlyCompetitorLayout(namesOnly, visualWidth, adjacentPlayersOnlyIntro),
                  }
                : miRows.length > 0 && miRows.length < minCompetitorTableRows
                  ? {
                      headerText:
                        pdfLocale === "tr"
                          ? "REKABET VERİSİ — SINIRLI YAPILANDIRILMIŞ KARŞILAŞTIRMA"
                          : "COMPETITORS IDENTIFIED — LIMITED STRUCTURED COMPARISON DATA",
                      layout: getNamesOnlyCompetitorLayout(
                        miRows.map((row) => row.vendor || "Vendor"),
                        visualWidth,
                        sparseCompetitorTableIntro
                      ),
                    }
                  : null;
            const namesLayout = compactCompetitorState?.layout ?? null;
            const miColumns = [
              { label: localizePdfPresentationLabel("Vendor", pdfLocale), width: visualWidth * 0.15 },
              { label: localizePdfPresentationLabel("Category", pdfLocale), width: visualWidth * 0.13 },
              { label: localizePdfPresentationLabel("Position", pdfLocale), width: visualWidth * 0.15 },
              { label: localizePdfPresentationLabel("Strengths", pdfLocale), width: visualWidth * 0.17 },
              { label: localizePdfPresentationLabel("Weaknesses", pdfLocale), width: visualWidth * 0.17 },
              { label: localizePdfPresentationLabel("Relevance", pdfLocale), width: visualWidth * 0.11 },
              { label: localizePdfPresentationLabel("Validation", pdfLocale), width: visualWidth * 0.12 },
            ];
            let miX = bodyX;

            pdf.setFillColor("#101113");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(
              bodyX,
              visualY,
              visualWidth,
              namesLayout ? namesLayout.totalHeight : competitorHeaderHeight + Math.max(1, miRows.length) * competitorRowHeight,
              3,
              3,
              "FD"
            );
            if (namesLayout && compactCompetitorState) {
              pdf.setFontSize(6.5);
              pdf.setTextColor("#7dd3fc");
              pdf.text(
                localizePdfPresentationText(compactCompetitorState.headerText, pdfLocale),
                bodyX + 3,
                visualY + 7,
                { maxWidth: visualWidth - 6 }
              );
              pdf.setFontSize(5.8);
              pdf.setTextColor("#a1a1aa");
              pdf.text(namesLayout.introLines, bodyX + 3, visualY + 13, {
                lineHeightFactor: 1.3,
                maxWidth: visualWidth - 6,
              });
              pdf.setFontSize(6.2);
              pdf.setTextColor("#e0f2fe");
              const namesY = visualY + 13 + namesLayout.introLines.length * 3.6 + 5;
              pdf.text(namesLayout.nameLines, bodyX + 3, namesY, {
                lineHeightFactor: 1.35,
                maxWidth: visualWidth - 6,
              });
            } else {
              pdf.setFontSize(5.8);
              pdf.setTextColor("#5eead4");
              miColumns.forEach((column) => {
                pdf.text(column.label.toUpperCase(), miX + 2, visualY + 5.2, { maxWidth: column.width - 4 });
                miX += column.width;
              });
            }

            const drawMarketMap = (mapY: number) => {
              const placements = miRows
                .map((row) => {
                  const coordinates = inferMarketMapPosition(row);
                  return coordinates ? { vendor: row.vendor || "Vendor", ...coordinates } : null;
                })
                .filter((placement): placement is { vendor: string; x: number; y: number } => placement !== null);

              pdf.setFontSize(7.2);
              pdf.setTextColor("#5eead4");
              pdf.text(localizePdfPresentationLabel("MARKET MAP", pdfLocale), bodyX, mapY - 2);

              pdf.setFillColor("#101113");
              pdf.setDrawColor("#27272a");
              pdf.roundedRect(bodyX, mapY, visualWidth, marketMapHeight, 3, 3, "FD");

              if (placements.length < 2) {
                pdf.setFontSize(6.2);
                pdf.setTextColor("#fbbf24");
                pdf.text(localizePdfPresentationLabel("VALIDATION NEEDED", pdfLocale), bodyX + 5, mapY + 9);
                pdf.setFontSize(6);
                pdf.setTextColor("#a1a1aa");
                pdf.text(
                  pdf.splitTextToSize(
                    localizePdfPresentationText(
                      "Not enough competitors have a clear category or positioning signal on both axes to plot a reliable market map yet.",
                      pdfLocale
                    ),
                    visualWidth - 10
                  ) as string[],
                  bodyX + 5,
                  mapY + 15,
                  { lineHeightFactor: 1.3, maxWidth: visualWidth - 10 }
                );
                return;
              }

              const mapInnerX = bodyX + 6;
              const mapInnerY = mapY + 6;
              const mapInnerWidth = visualWidth - 12;
              const mapInnerHeight = marketMapHeight - 12;

              pdf.setDrawColor("#27272a");
              pdf.line(mapInnerX + mapInnerWidth / 2, mapInnerY, mapInnerX + mapInnerWidth / 2, mapInnerY + mapInnerHeight);
              pdf.line(mapInnerX, mapInnerY + mapInnerHeight / 2, mapInnerX + mapInnerWidth, mapInnerY + mapInnerHeight / 2);
              pdf.setFontSize(5);
              pdf.setTextColor("#71717a");
              pdf.text(localizePdfPresentationLabel("Broad platform", pdfLocale), mapInnerX + 1, mapInnerY + 3.6);
              pdf.text(localizePdfPresentationLabel("Specialized", pdfLocale), mapInnerX + 1, mapInnerY + mapInnerHeight - 1);
              pdf.text(localizePdfPresentationLabel("SME", pdfLocale), mapInnerX + 1, mapInnerY + mapInnerHeight / 2 - 1);
              const enterpriseLabelWidth = pdf.getTextWidth(localizePdfPresentationLabel("Enterprise", pdfLocale));
              pdf.text(
                localizePdfPresentationLabel("Enterprise", pdfLocale),
                mapInnerX + mapInnerWidth - enterpriseLabelWidth - 1,
                mapInnerY + mapInnerHeight / 2 - 1
              );

              placements.forEach((placement) => {
                const dotX = mapInnerX + (placement.x / 100) * mapInnerWidth;
                const dotY = mapInnerY + (placement.y / 100) * mapInnerHeight;

                pdf.setFillColor("#5eead4");
                pdf.circle(dotX, dotY, 1.6, "F");
                pdf.setFontSize(5.2);
                pdf.setTextColor("#ccfbf1");
                drawSingleLine(placement.vendor, dotX + 2.6, dotY + 1.2, 24, 5.2, 4);
              });
            };

            if (namesLayout) {
              drawMarketMap(visualY + namesLayout.totalHeight + marketMapGap);
              return namesLayout.totalHeight + marketMapGap + marketMapHeight;
            }

            if (miRows.length === 0) {
              // P0 PRODUCTION FIX -- confirmed live (Market Intelligence PDF
              // layout hardening, round 2): mirrors ReportPdfButton.tsx's own
              // already-fixed wording (its "P0 FIX #8" comment) -- this IS the
              // Competitive Landscape section's own render, so it must never
              // tell the reader to "see" the exact section already on screen.
              // This specific occurrence (Planner.tsx's MI branch) had been
              // missed when that fix was made elsewhere.
              pdf.setFontSize(6.2);
              pdf.setTextColor("#a1a1aa");
              pdf.text(
                localizePdfPresentationText("No competitor data could be validated for this market yet.", pdfLocale),
                bodyX + 3,
                visualY + 14,
                { maxWidth: visualWidth - 6 }
              );
              drawMarketMap(visualY + competitorHeaderHeight + competitorRowHeight + 4 + marketMapGap);
              return competitorHeaderHeight + competitorRowHeight + 4 + marketMapGap + marketMapHeight;
            }

            miRows.forEach((row, rowIndex) => {
              const rowY = visualY + competitorHeaderHeight + rowIndex * competitorRowHeight;
              const values = [row.vendor, row.category, row.position, row.strengths, row.weaknesses, row.relevance, row.validationStatus];
              let cellX = bodyX;

              pdf.setDrawColor("#27272a");
              pdf.line(bodyX, rowY, bodyX + visualWidth, rowY);
              values.forEach((value, cellIndex) => {
                const width = miColumns[cellIndex]?.width ?? 20;
                pdf.setFontSize(cellIndex === 0 ? 6.3 : 5.5);
                pdf.setTextColor(cellIndex === 0 ? "#f4f4f5" : "#d4d4d8");
                pdf.text(
                  truncatePdfCellLines(pdf.splitTextToSize(value || localizePdfPresentationLabel("Validation Required", pdfLocale), width - 4) as string[], 2),
                  cellX + 2,
                  rowY + 4.7,
                  { lineHeightFactor: 1.1, maxWidth: width - 4 }
                );
                cellX += width;
              });
            });

            drawMarketMap(
              visualY + competitorHeaderHeight + Math.max(1, miRows.length) * competitorRowHeight + 4 + marketMapGap
            );
            return (
              competitorHeaderHeight +
              Math.max(1, miRows.length) * competitorRowHeight +
              4 +
              marketMapGap +
              marketMapHeight
            );
          }

          const rows = extractCompetitorRows(section.content);

          if (rows.length === 0) {
            // P0 PRODUCTION FIX -- confirmed live (Market Intelligence PDF
            // layout hardening, round 2): this IS the Competitive
            // Landscape section's own render -- telling the reader to
            // "see the Competitive Landscape section" from inside that
            // exact section was a self-referential, useless copy-paste
            // artifact, matching the identical fix already made in
            // ReportPdfButton.tsx's own generic branch.
            pdf.setFillColor("#101113");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(bodyX, visualY, visualWidth, competitorHeaderHeight + competitorRowHeight, 3, 3, "FD");
            pdf.setFontSize(6.2);
            pdf.setTextColor("#a1a1aa");
            pdf.text(
              localizePdfPresentationText("No competitor data could be validated for this market yet.", pdfLocale),
              bodyX + 3,
              visualY + 14,
              { maxWidth: visualWidth - 6 }
            );
            return competitorHeaderHeight + competitorRowHeight + 4;
          }

          // P0 PRODUCTION FIX -- confirmed live (Market Intelligence PDF
          // layout hardening, round 2): mirrors ReportPdfButton.tsx's
          // identical fix -- a sparse table (1-2 rows) used to still draw
          // the full 5-column grid, mostly empty.
          if (rows.length < minCompetitorTableRows) {
            const sparseLayout = getNamesOnlyCompetitorLayout(
              rows.map((row) => row.company || "Company"),
              visualWidth,
              sparseCompetitorTableIntro
            );

            pdf.setFillColor("#101113");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(bodyX, visualY, visualWidth, sparseLayout.totalHeight, 3, 3, "FD");
            pdf.setFontSize(6.5);
            pdf.setTextColor("#7dd3fc");
            pdf.text(
              localizePdfPresentationText("COMPETITORS IDENTIFIED — LIMITED STRUCTURED COMPARISON DATA", pdfLocale),
              bodyX + 3,
              visualY + 7,
              { maxWidth: visualWidth - 6 }
            );
            pdf.setFontSize(5.8);
            pdf.setTextColor("#a1a1aa");
            pdf.text(sparseLayout.introLines, bodyX + 3, visualY + 13, {
              lineHeightFactor: 1.3,
              maxWidth: visualWidth - 6,
            });
            pdf.setFontSize(6.2);
            pdf.setTextColor("#e0f2fe");
            const namesY = visualY + 13 + sparseLayout.introLines.length * 3.6 + 5;
            pdf.text(sparseLayout.nameLines, bodyX + 3, namesY, {
              lineHeightFactor: 1.35,
              maxWidth: visualWidth - 6,
            });

            return sparseLayout.totalHeight;
          }

          const columns = [
            { label: localizePdfPresentationLabel("Company", pdfLocale), width: visualWidth * 0.19 },
            { label: localizePdfPresentationLabel("Positioning", pdfLocale), width: visualWidth * 0.27 },
            { label: localizePdfPresentationLabel("Strengths", pdfLocale), width: visualWidth * 0.2 },
            { label: localizePdfPresentationLabel("Weaknesses", pdfLocale), width: visualWidth * 0.2 },
            { label: localizePdfPresentationLabel("Threat", pdfLocale), width: visualWidth * 0.14 },
          ];
          let x = bodyX;

          pdf.setFillColor("#101113");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(
            bodyX,
            visualY,
            visualWidth,
            competitorHeaderHeight + Math.max(1, rows.length) * competitorRowHeight,
            3,
            3,
            "FD"
          );
          pdf.setFontSize(5.8);
          pdf.setTextColor("#5eead4");
          columns.forEach((column) => {
            pdf.text(column.label.toUpperCase(), x + 2, visualY + 5.2, { maxWidth: column.width - 4 });
            x += column.width;
          });

          rows.forEach((row, rowIndex) => {
            const rowY = visualY + competitorHeaderHeight + rowIndex * competitorRowHeight;
            const values = [row.company, row.positioning, row.strengths, row.weaknesses, row.threat];
            let cellX = bodyX;

            pdf.setDrawColor("#27272a");
            pdf.line(bodyX, rowY, bodyX + visualWidth, rowY);
            values.forEach((value, cellIndex) => {
              const width = columns[cellIndex]?.width ?? 20;
              pdf.setFontSize(cellIndex === 0 ? 6.3 : 5.5);
              pdf.setTextColor(cellIndex === 0 ? "#f4f4f5" : "#d4d4d8");
              pdf.text(
                truncatePdfCellLines(pdf.splitTextToSize(value || "Validation required", width - 4) as string[], 2),
                cellX + 2,
                rowY + 4.7,
                { lineHeightFactor: 1.1, maxWidth: width - 4 }
              );
              cellX += width;
            });
          });

          return competitorHeaderHeight + Math.max(1, rows.length) * competitorRowHeight + 4;
        }

        // Strategic Recommendations is inherently a list -- rendered as
        // Action/Owner/Timeline/Budget/Success Metric/Decision Gate cards
        // rather than one long paragraph block, mirrored from
        // ReportPdfButton.tsx. Each card's signals are read directly out
        // of this recommendation's own generated sentence
        // (extractRecommendationSignals never fabricates a value it
        // cannot find). The section's full prose still renders below this
        // visual, unchanged.
        if (section.field === "strategicRecommendations") {
          const items = extractRecommendationItems(section.content).slice(0, 4);

          if (items.length === 0) {
            return 0;
          }

          // CRITICAL FIX (Task #17) -- see ReportPdfButton.tsx's own
          // identical block for the full rationale: this section's own
          // raw text used to carry an independently-written decision
          // verdict that could disagree with Executive Summary's
          // canonical decision. isRecommendationHeadingLine now excludes
          // that sentence from the cards below, but this remains a
          // decision-bearing surface, so it explicitly states the SAME
          // canonical decision every other surface reads.
          const strategicRecommendationDecision = resolveMarketIntelligenceExecutiveDecision(
            pdfSections.find((entry) => entry.field === "executiveSummary")?.content || "",
            pdfLocale === "tr" ? "Turkish" : "English"
          );
          if (strategicRecommendationDecision.decisionLabel !== "—") {
            pdf.setFontSize(5.6);
            pdf.setTextColor("#a1a1aa");
            pdf.text(
              `${localizePdfPresentationLabel("Current Decision", pdfLocale)}: ${strategicRecommendationDecision.decisionLabel}`,
              bodyX,
              visualY + 3.6,
              { maxWidth: visualWidth }
            );
          }
          const recommendationCardsTopY = visualY + strategicRecommendationDecisionBadgeHeight;

          const columns = 2;
          const cardGap = recommendationCardGap;
          const cardWidth = (visualWidth - (columns - 1) * cardGap) / columns;
          const { cards, rowHeights } = computeRecommendationRowHeights(items, cardWidth);

          cards.forEach(({ gate, actionLines, fields }, index) => {
            const col = index % columns;
            const row = Math.floor(index / columns);
            const x = bodyX + col * (cardWidth + cardGap);
            const cardY = recommendationCardsTopY + rowHeights.slice(0, row).reduce((sum, height) => sum + height + cardGap, 0);
            const cardHeight = rowHeights[row];

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, cardY, cardWidth, cardHeight, 2.5, 2.5, "FD");

            pdf.setFillColor("#042f2e");
            pdf.setDrawColor("#5eead4");
            pdf.circle(x + 6, cardY + 6, 3, "FD");
            pdf.setFontSize(5.6);
            pdf.setTextColor("#ccfbf1");
            pdf.text(String(index + 1), x + 4.7, cardY + 7.4);

            pdf.setFontSize(5.2);
            pdf.setTextColor("#71717a");
            pdf.text(localizePdfPresentationLabel("ACTION", pdfLocale), x + 11, cardY + 4);
            pdf.setFontSize(6);
            pdf.setTextColor("#e4e4e7");
            pdf.text(actionLines, x + 11, cardY + 7.8, {
              lineHeightFactor: 1.15,
              maxWidth: cardWidth - 13,
            });

            const fieldsTopY = cardY + 7.8 + actionLines.length * 3.3 + 2.5;
            const fieldColWidth = (cardWidth - 6) / 2;

            if (fields.length > 0) {
              pdf.setDrawColor("#27272a");
              pdf.line(x + 3, fieldsTopY - 1.6, x + cardWidth - 3, fieldsTopY - 1.6);

              fields.slice(0, 4).forEach(([label, value], fieldIndex) => {
                const fx = x + 3 + (fieldIndex % 2) * fieldColWidth;
                const fy = fieldsTopY + Math.floor(fieldIndex / 2) * 5.6;

                pdf.setFontSize(4.4);
                pdf.setTextColor("#71717a");
                pdf.text(localizePdfPresentationLabel(label, pdfLocale).toUpperCase(), fx, fy);
                pdf.setFontSize(5.2);
                pdf.setTextColor("#5eead4");
                drawSingleLine(value, fx, fy + 2.8, fieldColWidth - 2, 5.2, 4);
              });
            }

            if (gate) {
              pdf.setFontSize(4.4);
              pdf.setTextColor("#71717a");
              pdf.text(localizePdfPresentationLabel("DECISION GATE", pdfLocale), x + 3, cardY + cardHeight - 5.4);
              pdf.setFontSize(5);
              pdf.setTextColor("#fbbf24");
              drawSingleLine(gate, x + 3, cardY + cardHeight - 2, cardWidth - 6, 5, 4);
            }
          });

          return (
            strategicRecommendationDecisionBadgeHeight +
            rowHeights.reduce((sum, height) => sum + height, 0) +
            Math.max(0, rowHeights.length - 1) * cardGap
          );
        }

        if (pdfKeyTakeawayCardFields.has(section.field ?? "")) {
          const takeaway = getSectionTakeaway(section.content);

          if (!takeaway) {
            return 0;
          }

          // Pin to the actual draw-time font before measuring -- see
          // ReportPdfButton.tsx's own identical comment on this same
          // measurement-order bug.
          pdf.setFontSize(8.4);
          const takeawayLines = (pdf.splitTextToSize(localizePdfPresentationText(takeaway, pdfLocale), visualWidth - 12) as string[]).slice(0, 3);
          const takeawayBoxHeight = Math.max(16, 8 + takeawayLines.length * 4.4);

          pdf.setFillColor("#101f1d");
          pdf.setDrawColor("#115e59");
          pdf.roundedRect(bodyX, visualY, visualWidth, takeawayBoxHeight, 3, 3, "FD");

          pdf.setFontSize(6.4);
          pdf.setTextColor("#5eead4");
          pdf.text(localizePdfPresentationLabel("KEY TAKEAWAY", pdfLocale), bodyX, visualY - 2);

          pdf.setFontSize(8.4);
          pdf.setTextColor("#e4e4e7");
          pdf.text(takeawayLines, bodyX + 6, visualY + 7, {
            lineHeightFactor: 1.3,
            maxWidth: visualWidth - 12,
          });

          return takeawayBoxHeight;
        }

        if (section.field === "tamSamSom") {
          // Concentric TAM/SAM/SOM circles -- the standard consulting/
          // VC-deck device for market sizing -- replacing the previous
          // three stacked text rows, mirrored from ReportPdfButton.tsx so
          // the in-app preview matches the exported PDF.
          const rows = getTamRows(section.content, visualWidth);
          const magnitudes = rows.map((row) => parseMarketSizeMagnitude(row.value)) as [
            number | null,
            number | null,
            number | null,
          ];
          // Plus 27mm (9mm per legend row) so each row has room for its
          // own two-line planning-assumption sentence beneath the value --
          // mirrors ReportPdfButton.tsx's own identical constant.
          const tamCircleVisualHeight = tamCircleMaxRadius * 2 + 8 + 27;
          // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
          // decision/market-sizing consistency hardening): this used to
          // require ALL THREE of TAM/SAM/SOM to parse and nest before
          // drawing anything -- discarding an already-resolved TAM ($1.5B)
          // and SAM ($375M) the moment SOM alone was unresolved, exactly
          // the reported production defect ("PDF removes the validated
          // TAM/SAM values... replaces the entire section with a generic
          // validation message"). ReportPdfButton.tsx's own identical gate
          // was already fixed to the per-layer resolveMarketSizingCascade
          // rule (report-presentation.ts) some time ago -- this comment
          // block's own claim of "mirrors ReportPdfButton.tsx's own gate"
          // had gone stale, since this file was never updated to match.
          // Now uses the SAME canonical function the web report uses, so
          // web/PDF (both PDF exports) can never disagree about which
          // layers are trustworthy: a layer resolves only when it has its
          // own parseable value AND every layer above it in the hierarchy
          // is also resolved and correctly nested -- an unresolved TAM
          // still withholds SAM/SOM exactly as before, while SOM alone
          // being unresolved no longer punishes an already-resolved TAM/SAM.
          const cascade = resolveMarketSizingCascade(magnitudes);
          const resolvedByIndex = [cascade.tamResolved, cascade.samResolved, cascade.somResolved];

          if (!cascade.tamResolved && !cascade.samResolved && !cascade.somResolved) {
            // Genuinely nothing to show -- same wording as the on-screen
            // "Validation Needed" state (see PremiumSectionVisual's own
            // tamSamSom branch above) -- the exported PDF must match the
            // UI, not show its own bespoke explanation. Unchanged from
            // prior behavior for this one case.
            const explanationText =
              pdfLocale === "tr"
                ? "Boyutlandırmanın doğrulanabilmesi için ek pazar doğrulaması gereklidir."
                : "Additional market validation is required before sizing can be confirmed.";
            pdf.setFontSize(7.6);
            pdf.setTextColor("#a1a1aa");
            pdf.text(
              pdf.splitTextToSize(explanationText, visualWidth - 6) as string[],
              bodyX + 3,
              visualY + 10,
              { lineHeightFactor: 1.3, maxWidth: visualWidth - 6 }
            );

            return tamCircleVisualHeight;
          }

          const radii = computeTamSamSomRadii(magnitudes[0], magnitudes[1], magnitudes[2]);
          const circleCenterX = bodyX + tamCircleMaxRadius + 4;
          const circleCenterY = visualY + tamCircleMaxRadius + 3;

          rows.forEach((row, index) => {
            pdf.setFillColor(row.color);
            pdf.circle(circleCenterX, circleCenterY, radii[index], "F");
          });

          const legendX = circleCenterX + tamCircleMaxRadius + 10;
          const legendWidth = Math.max(20, bodyX + visualWidth - legendX);
          const legendRowHeight = (tamCircleVisualHeight - 4) / 3;

          rows.forEach(({ label, color, value }, index) => {
            const rowY = visualY + 2 + index * legendRowHeight;
            const isResolved = resolvedByIndex[index];
            const isEstimated = isMarketSizeEstimated(section.content, label);
            // The reader must see WHY the figure is what it is without
            // opening Details -- the same real planning-assumption
            // sentence the on-screen visual now shows inline, never a
            // fabricated one.
            const assumption = extractMarketSizeAssumption(section.content, label);
            pdf.setFillColor(color);
            pdf.roundedRect(legendX, rowY, 7, 4.4, 1.5, 1.5, "F");
            pdf.setFontSize(7.2);
            pdf.setTextColor(isEstimated ? "#fbbf24" : "#a1a1aa");
            pdf.text(
              isEstimated ? `${label} · ${localizePdfPresentationLabel("Planning Estimate", pdfLocale)}` : label,
              legendX + 10,
              rowY + 3.8
            );
            pdf.setTextColor(isResolved ? "#ccfbf1" : "#71717a");
            // Mirrors ReportPdfButton.tsx's identical fix: an unresolved
            // layer's own text is a gap-explanation sentence, which
            // isMarketSizeValueMeaningful correctly filters out of `value`
            // -- reusing this file's own established "Validation Required"
            // convention instead of an unexplained bare "—".
            drawSingleLine(
              isResolved ? value : localizePdfPresentationLabel("Validation Required", pdfLocale),
              legendX + 10,
              rowY + 9.4,
              legendWidth - 10,
              8,
              5,
              false
            );
            if (assumption) {
              pdf.setFontSize(5.2);
              pdf.setTextColor("#71717a");
              const assumptionLines = (
                pdf.splitTextToSize(localizePdfPresentationText(assumption, pdfLocale), legendWidth - 10) as string[]
              ).slice(0, 2);
              pdf.text(assumptionLines, legendX + 10, rowY + 13.6, {
                lineHeightFactor: 1.2,
                maxWidth: legendWidth - 10,
              });
            }
          });

          return tamCircleVisualHeight;
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
            pdf.text(localizePdfPresentationLabel(label, pdfLocale).toUpperCase(), x + 3, boxY + 5);
            pdf.setFontSize(6.2);
            pdf.setTextColor("#d4d4d8");
            let bulletY = boxY + 10;
            bulletLines.forEach((lines) => {
              pdf.text(lines.map((line) => localizePdfPresentationText(line, pdfLocale)), x + 3, bulletY, {
                lineHeightFactor: 1.14,
                maxWidth: swotLayout.boxWidth - 6,
              });
              bulletY += lines.length * 4.2;
            });
          });

          return swotLayout.totalHeight;
        }

        if (section.field === "founderScore") {
          const cards = buildPdfFounderScoreCards(
            section.content,
            investmentScore,
            pdfLocale
          );
          const itemWidth = (visualWidth - 10) / 3;

          cards.forEach((item, index) => {
            const displayLabel = item.label;
            const x = bodyX + (index % 3) * (itemWidth + 5);
            const itemY = visualY + Math.floor(index / 3) * 15;
            const score = item.score;
            const scoreText = score === null ? "—" : `${score}/100`;
            const labelLines = (pdf.splitTextToSize(displayLabel, itemWidth - 19) as string[]).slice(0, 2);

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, itemY, itemWidth, 13.5, 2.5, 2.5, "FD");
            pdf.setDrawColor("#5eead4");
            pdf.circle(x + 7, itemY + 6, 4.2, "S");
            pdf.setFontSize(scoreText.length > 4 ? 4.8 : 5.8);
            pdf.setTextColor("#ccfbf1");
            pdf.text(scoreText, x + 3.6, itemY + 7.6, { maxWidth: 7 });
            pdf.setFontSize(6.2);
            pdf.setTextColor("#e4e4e7");
            pdf.text(labelLines, x + 14, itemY + 5, {
              lineHeightFactor: 1.08,
              maxWidth: itemWidth - 18,
            });
          });

          return 46;
        }

        if (section.field === "executiveSummary") {
          const cardLayout = getExecutiveDecisionCardLayout(section.content, visualWidth);
          const { decisionLabel, confidence, recItems, itemWidth, wrappedValues, rowHeights } = cardLayout;

          pdf.setFillColor("#ccfbf1");
          pdf.setDrawColor("#5eead4");
          pdf.roundedRect(bodyX, visualY, 52, 26, 5, 5, "FD");
          pdf.setFontSize(5.8);
          pdf.setTextColor("#134e4a");
          pdf.text(localizePdfPresentationLabel("DECISION", pdfLocale), bodyX + 5, visualY + 6);
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

          // CRITICAL FIX -- confirmed live (root-cause repair): Why/Top
          // Risk/Information Required/Next Action previously always drew
          // through drawSingleLine (single line only, hard-truncated with
          // an ellipsis regardless of available space) inside a fixed
          // 15mm-tall tile. Now wraps to getExecutiveDecisionCardLayout's
          // own pre-measured line count and each row grows to fit the
          // taller of its two tiles -- short content (the common case)
          // renders at the exact same 15mm tile height as before.
          let recItemRowY = visualY;
          recItems.forEach(([label], index) => {
            const row = Math.floor(index / 2);
            if (index % 2 === 0 && row > 0) {
              recItemRowY += rowHeights[row - 1] + 2;
            }
            const itemX = bodyX + 60 + (index % 2) * ((visualWidth - 64) / 2 + 2);
            const itemY = recItemRowY;
            const rowHeight = rowHeights[row] ?? 15;

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(itemX, itemY, itemWidth, rowHeight, 2.5, 2.5, "FD");
            pdf.setFontSize(6);
            pdf.setTextColor("#71717a");
            pdf.text(localizePdfPresentationLabel(label, pdfLocale).toUpperCase(), itemX + 2, itemY + 3.2);
            pdf.setTextColor("#e4e4e7");
            pdf.setFontSize(6);
            pdf.text(wrappedValues[index] ?? [], itemX + 2, itemY + 7.8, {
              lineHeightFactor: 1.28,
              maxWidth: itemWidth - 4,
            });
          });

          return cardLayout.totalHeight;
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
            pdf.text(localizePdfPresentationLabel(step, pdfLocale), x + 2, visualY + 5.7, { maxWidth: stepWidth - 4 });
          });
          return 12;
        }

        if (section.field === "portersFiveForces") {
          const forces = ["Rivalry", "Entrants", "Buyer", "Supplier", "Substitutes"];
          const centerX = bodyX + visualWidth * 0.32;
          const centerY = visualY + 22;
          // Each force card now also carries its own real investor-
          // interpretation sentence (matching the on-screen radar cards
          // and ReportPdfButton.tsx) -- this section's raw paragraph is
          // essentially "one sentence per force" by its own prompt's
          // structure, so with all five shown here the paragraph below it
          // would be a pure duplicate; the taller card (was a fixed
          // 6mm/8mm-spaced row, now sized to fit up to 2 wrapped lines) is
          // what makes it safe for pdfCompleteVisualFields to suppress
          // that paragraph entirely.
          const forceCardHeight = 14;
          const forceCardSpacing = 16;

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
            const cardY = visualY + index * forceCardSpacing;
            // CRITICAL FIX -- do not reintroduce old fake-data behavior.
            // This used to be a static [72, 54, 66, 48, 60] array,
            // identical for every report -- see extractForceIntensity's
            // own comment for why a real per-force reading is used
            // instead, mirroring the on-screen visual above.
            const score = extractForceIntensity(section.content, force)?.width ?? 0;
            const implication = extractForceImplication(section.content, force);

            pdf.setDrawColor("#5eead4");
            pdf.line(centerX, centerY, dotX, dotY);
            pdf.setFillColor("#0f766e");
            pdf.circle(dotX, dotY, 1.8, "F");

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(cardX, cardY, visualWidth * 0.38, forceCardHeight, 2, 2, "FD");
            pdf.setFontSize(5.8);
            pdf.setTextColor("#e4e4e7");
            pdf.text(localizePdfPresentationLabel(force, pdfLocale), cardX + 2, cardY + 4);
            pdf.setFillColor("#27272a");
            pdf.roundedRect(cardX + 22, cardY + 2.2, visualWidth * 0.24, 1.4, 0.7, 0.7, "F");
            // CRITICAL FIX (Task #19) -- see ReportPdfButton.tsx's own
            // identical block for the full rationale: Market Intelligence
            // only ("portersFiveForces" is a shared field name with
            // Business Plan, which has no [R#] citation convention to
            // read). The bar color signals whether this force's own
            // sentence cited real evidence or did not.
            pdf.setFillColor(
              isMarketIntelligence && getForceEvidenceLevel(implication) === "validationRequired"
                ? "#fbbf24"
                : "#5eead4"
            );
            pdf.roundedRect(cardX + 22, cardY + 2.2, (visualWidth * 0.24 * score) / 100, 1.4, 0.7, 0.7, "F");
            if (implication) {
              pdf.setFontSize(4.6);
              pdf.setTextColor("#a1a1aa");
              const implicationLines = (
                pdf.splitTextToSize(
                  localizePdfPresentationText(implication, pdfLocale),
                  visualWidth * 0.38 - 4
                ) as string[]
              ).slice(0, 2);
              pdf.text(implicationLines, cardX + 2, cardY + 7.6, {
                lineHeightFactor: 1.2,
                maxWidth: visualWidth * 0.38 - 4,
              });
            }
          });

          return Math.max(44, forces.length * forceCardSpacing);
        }

        const financialLayout =
          section.field === "financialDashboard" ? getFinancialLayout(section.content, visualWidth) : null;
        const labels =
          section.field === "financialDashboard"
            ? financialLayout?.items ?? []
            : section.field === "scenarioAnalysis"
                ? ["Worst", "Base", "Best"]
                  : section.field === "kpiDashboard" || section.field === "kpis"
                    ? normalizePdfKpiMetrics(section.content)
                  : section.field === "risks"
                    ? ["Market", "Product", "Pricing", "Execution"]
                    : section.field === "unitEconomics"
                      ? unitEconomicsMetrics
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
          const typedItem = item as string | {
            label: string;
            aliases: string[] | readonly string[];
            value?: string;
            target?: string;
            status?: string;
            owner?: string;
            trigger?: string;
            action?: string;
            score?: number | null;
          };
          const label = typeof typedItem === "string" ? typedItem : typedItem.label;
          const displayLabel = localizePdfPresentationLabel(label, pdfLocale);
          const aliases = typeof typedItem === "string" ? [typedItem] : typedItem.aliases;
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
          const score = typeof typedItem !== "string" && "score" in typedItem ? typedItem.score ?? null : extractScoreFromAliases(metricContent, aliases);
          const value = typeof typedItem !== "string" && typedItem.value
            ? typedItem.value
            : isUnitEconomics && label === "Gross Margin"
              ? formatMetricCardValue(extractStrictMetricValueFromAliases(section.content, ["grossMargin", "Gross Margin", "Brüt Marj"]))
              : formatMetricCardValue(extractMetricValueFromAliases(metricContent, aliases));
          const compactValue = isFinancialDashboard
            ? dedupePdfFinancialMetricValue(value)
            : compactPdfMetricValue(value);
          pdf.setFillColor("#18181b");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(x, itemY, itemWidth, itemHeight, 2.5, 2.5, "FD");
          pdf.setFontSize(6.2);
          pdf.setTextColor("#a1a1aa");
          pdf.text(displayLabel, x + 2, itemY + 3.2, { maxWidth: itemWidth - 4 });
          // Confirmed live (music royalty distribution platform report,
          // downloaded from this page's own PDF export -- a separate
          // generation path from the dashboard's ReportPdfButton.tsx,
          // which never draws this line at all): drawing the evidence-
          // classification badge ("Assumption"/"Estimated"/"AI Analysis")
          // as its own line directly beneath a tiny Financial Dashboard/
          // Unit Economics/KPI Dashboard card's value reads, once
          // extracted or transcribed as plain text, exactly like the raw
          // "CAC $4k Assumption" concatenation this was already fixed for
          // once -- the badge itself is correctly classified now, but
          // showing it at all inside these compact cards reproduces the
          // same visible defect. ReportPdfButton.tsx already omits this
          // badge for all three card types; this brings the PDF export
          // in this page in line with that same, already-correct design
          // instead of drawing a second copy of the confidence label the
          // dashboard PDF deliberately does not show.
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
            const kpiValue = typeof typedItem !== "string" && "value" in typedItem && typedItem.value
              ? typedItem.value
              : (score === null ? "—" : `${score}%`);
            const status = typeof typedItem !== "string" && "status" in typedItem ? typedItem.status || "Watch" : "Watch";
            pdf.setTextColor("#f4f4f5");
            drawSingleLine(kpiValue, x + 2, itemY + 8.4, itemWidth - 4, 7.5, 4.2, false);
            pdf.setFontSize(5.3);
            pdf.setTextColor("#a1a1aa");
            pdf.text(`${localizePdfPresentationLabel("Status", pdfLocale)}: ${localizePdfPresentationLabel(status, pdfLocale)}`, x + 2, itemY + 12.6, { maxWidth: itemWidth - 4 });
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
            pdf.text(pdf.splitTextToSize(localizePdfPresentationText(snippet || "Scenario path under review.", pdfLocale), itemWidth - 4).slice(0, 2), x + 2, itemY + 8.1, {
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
            pdf.text(
              financialLayout.detailLines.map((line) => localizePdfPresentationText(line, pdfLocale)),
              bodyX + 3,
              detailsY + 4,
              {
              lineHeightFactor: 1.1,
              maxWidth: visualWidth - 6,
              }
            );
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
        const sectionBodyContent =
          section.field === "tamSamSom" ||
          section.field === "financialDashboard" ||
          section.field === "unitEconomics"
            ? ""
            : isLegalReport && section.field === "legalSources"
              ? formatLegalSourceContent(section.content, pdfLocale)
              : localizePdfPresentationText(
                formatPdfReadableContent(
                  section,
                  executiveSnapshot.founderScoreValue,
                  isRealEstateReport
                ),
                pdfLocale
              );

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
              title: getPdfTocEntryTitle(section, pdfLocale),
              page: pdf.getCurrentPageInfo().pageNumber,
            });
          }

          const availableHeight =
            pageHeight - margin - y - cardHeaderHeight - activeVisualHeight - cardBottomPadding;
          let maxLines = Math.max(1, Math.floor(availableHeight / bodyLineHeight));
          if (safeBodyLines.length - lineIndex - maxLines === 1 && maxLines > 1) {
            maxLines -= 1;
          }
          const lines = safeBodyLines.slice(lineIndex, lineIndex + maxLines);
          const isContinued = lineIndex > 0;
          const cardHeight = Math.max(
            31,
            cardHeaderHeight +
              activeVisualHeight +
              (hasBodyText ? lines.length * bodyLineHeight : 0) +
              cardBottomPadding
          );

          drawPdfSectionCardFrame(pdf, { margin, y, contentWidth, cardHeight });

          pdf.setFont("Geist", "normal");
          pdf.setFontSize(14);
          pdf.setTextColor("#ffffff");
          const displaySectionTitle = getPdfSectionCardTitle(section, pdfLocale);
          const sectionTitle = isContinued && isSourceLikeSection(section)
            ? ""
            : `${displaySectionTitle}${isContinued ? pdfLocale === "tr" ? " devamı" : " continued" : ""}`;

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
    }
    });
  }

  if (isPrivateBetaReportRestriction(effectiveFailureMessage)) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-[2rem] bg-white/[0.04] p-8 text-center shadow-2xl shadow-black/35 backdrop-blur-2xl">
        <div className="max-w-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.06]">
            <Info className="h-5 w-5 text-teal-200" />
          </div>
          <p className="mt-5 text-lg font-semibold text-white">
            Strategic Reports are currently limited to approved beta users.
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Your request was understood successfully, but full report generation is not
            enabled for this account yet.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2.5 sm:flex-row">
            <button
              type="button"
              onClick={onContinueAsChat}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-teal-200 px-5 text-sm font-semibold text-black transition hover:bg-teal-100"
            >
              Continue as Chat
            </button>
            <button
              type="button"
              onClick={onBackToWorkspace}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-white/[0.06] px-5 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.1]"
            >
              Back to Workspace
            </button>
          </div>
        </div>
      </div>
    );
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
              {isLegalReport ? "ZERINIX LEGAL REPORT" : "ZERINIX EXECUTIVE REPORT"}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {reportTitle}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
              {isLegalReport
                ? "Legal analysis prepared for evidence-based decision making."
                : "Structured analysis prepared for founder-level decision making."}
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
        {!isDomainDecisionReport ? (
          <BenchmarkIntelligencePanel
            benchmarkFit={benchmarkFit}
            benchmarkScore={benchmarkScore}
            sourceText={`${reportTitle}\n${sourcePrompt || ""}\n${sections
              .map((section) => `${section.title}\n${section.content}`)
              .join("\n\n")}`}
          />
        ) : null}

        {isMarketIntelligence ? <MarketMetricsDashboard sections={sections} /> : null}
        {isMarketIntelligence ? <MarketForcesQuadrant sections={sections} /> : null}

        {visibleSections.map((section, index) => (
          <ReportSectionCard
            key={section.field}
            section={section}
            index={index}
            investmentScore={investmentScore}
            isDomainDecisionReport={isDomainDecisionReport}
            isMarketIntelligence={isMarketIntelligence}
            reportQuality={reportQuality}
            waitingMessage={waitingMessage}
            majorPlayersContent={sections.find((entry) => entry.field === "majorPlayers")?.content}
            executiveSummaryContent={sections.find((entry) => entry.field === "executiveSummary")?.content}
          />
        ))}
      </div>

      <div className="grid gap-3 border-t border-white/10 p-4 sm:grid-cols-2 sm:p-5">
        {!isLegalReport ? reportActions.map((action) => {
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
        }) : null}

        {hasReportContent ? (
          <>
            <button
              type="button"
              onPointerDown={() => {
                pdfExportIntentRef.current = Date.now();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  pdfExportIntentRef.current = Date.now();
                }
              }}
              onClick={(event) => {
                void downloadPdf(event);
              }}
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
          <SourcesCard sections={sourceSections} legal={isLegalReport} market={isMarketIntelligence} />
        </div>
      ) : null}
    </section>
  );
});

function ReportGenerationShell({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <section className="flex min-h-64 items-center justify-center rounded-[2rem] border border-white/10 bg-zinc-950/75 p-8 shadow-2xl shadow-black/50 backdrop-blur-2xl">
      <div className="text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-teal-200" />
        <h2 className="mt-4 text-xl font-semibold text-white">{title}</h2>
        <p className="mt-2 text-sm text-zinc-400">{subtitle || "Preparing your report…"}</p>
      </div>
    </section>
  );
}

function createPlannerMessageId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function logPlannerAttachmentTrace(
  point: string,
  attachments: PlannerAttachment[],
  extra: Record<string, unknown> = {}
) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.info(`[planner:attachment-trace] ${point}`, {
    attachmentCount: attachments.length,
    attachments: attachments.map((attachment) => {
      const record = attachment as PlannerAttachment &
        Record<string, unknown>;
      const fileValue = record.file;
      const blobValue = record.blob;
      const uploadedReferenceKeys = [
        "fileId",
        "uploadId",
        "uploadUrl",
        "storagePath",
        "signedUrl",
        "url",
      ].filter((key) => Boolean(record[key]));

      return {
        filename: attachment.name,
        mimeType: attachment.mimeType || "",
        objectKeys: Object.keys(attachment),
        hasFile:
          typeof File !== "undefined" && fileValue instanceof File,
        hasBlob:
          typeof Blob !== "undefined" && blobValue instanceof Blob,
        hasUploadedReference:
          uploadedReferenceKeys.length > 0 || Boolean(attachment.dataUrl),
        uploadedReferenceKeys,
        hasBinaryDataUrl: Boolean(attachment.dataUrl),
        hasTextContent: Boolean(attachment.textContent),
      };
    }),
    ...extra,
  });
}

function serializePlannerAttachments(attachments: PlannerAttachment[]) {
  return attachments
    .filter((attachment) => attachment.status !== "error")
    .map((attachment) => ({
    name: attachment.name,
    type: attachment.mimeType || "",
    size: attachment.size,
    textContent: attachment.textContent || "",
    dataUrl: attachment.dataUrl || "",
    }));
}

function createUnderstandingAssets(attachments: PlannerAttachment[]) {
  return attachments
    .filter((attachment) => attachment.status !== "error")
    .map((attachment) => ({
      name: attachment.name,
      size: attachment.size,
      mimeType: attachment.mimeType || "",
      textContent: (attachment.textContent || "").slice(0, 4_000),
      dataUrl: attachment.dataUrl || "",
    }));
}

function usePlannerChat() {
  const [chatLoading, setChatLoading] = useState(false);
  const {
    attachments,
    setAttachments,
    attachmentError,
    setAttachmentError,
    isDraggingFiles,
    setIsDraggingFiles,
    handleFiles,
    handleDropFiles,
  } = useAttachments({ createId: createPlannerMessageId });

  return {
    chatLoading,
    setChatLoading,
    attachments,
    setAttachments,
    attachmentError,
    setAttachmentError,
    isDraggingFiles,
    setIsDraggingFiles,
    handleFiles,
    handleDropFiles,
  };
}

function useReportGeneration({
  initialConversations,
  initialMode,
  initialReport,
  regenerationContext,
  restoredReportMode,
  restoredMarketReport,
  restoredPlanReport,
}: {
  initialConversations: Conversation[];
  initialMode?: ChatMode;
  initialReport: InitialReport | null;
  regenerationContext: RegenerationContext | null;
  restoredReportMode: ChatMode | null;
  restoredMarketReport: MarketReport | null;
  restoredPlanReport: PlanReport | null;
}) {
  const [result, setResult] = useState(
    initialReport?.status?.toLowerCase() === "completed" ? "" : ""
  );
  const [reportGenerationError, setReportGenerationError] = useState("");
  const [reportGenerationWarning, setReportGenerationWarning] = useState("");
  const [marketReport, setMarketReport] = useState<MarketReport | null>(
    restoredMarketReport
  );
  const [planReport, setPlanReport] = useState<PlanReport | null>(
    restoredPlanReport
  );
  const [activeReportId, setActiveReportId] = useState(
    () => regenerationContext?.reportId || initialReport?.id || getStoredActiveReportId()
  );
  const [loading, setLoading] = useState(false);
  const [workflowCompletedSteps, setWorkflowCompletedSteps] = useState(0);
  const [reportProgress, setReportProgress] = useState(0);
  const [currentReportSectionName, setCurrentReportSectionName] = useState("");
  const [lastRequest, setLastRequest] = useState<LastRequest | null>(() =>
    getInitialLastRequest({
      regenerationContext,
      restoredReportMode,
      initialReport,
      initialMode,
      initialConversations,
    })
  );
  const [currentReportInvestmentScore, setCurrentReportInvestmentScore] =
    useState<ReportInvestmentScore | undefined>(initialReport?.investmentScore);
  const [currentReportMetadata, setCurrentReportMetadata] =
    useState<ReportMetadata | undefined>(initialReport?.metadata);
  const [, setRegeneratingReportMode] = useState<ChatMode | null>(null);

  return {
    result,
    setResult,
    reportGenerationError,
    setReportGenerationError,
    reportGenerationWarning,
    setReportGenerationWarning,
    marketReport,
    setMarketReport,
    planReport,
    setPlanReport,
    activeReportId,
    setActiveReportId,
    loading,
    setLoading,
    workflowCompletedSteps,
    setWorkflowCompletedSteps,
    reportProgress,
    setReportProgress,
    currentReportSectionName,
    setCurrentReportSectionName,
    lastRequest,
    setLastRequest,
    currentReportInvestmentScore,
    setCurrentReportInvestmentScore,
    currentReportMetadata,
    setCurrentReportMetadata,
    setRegeneratingReportMode,
  };
}

function useConversations({
  initialConversations,
  conversationLoadError,
}: {
  initialConversations: Conversation[];
  conversationLoadError: string;
}) {
  const initialConversationId = useMemo(
    () => initialConversations[0]?.id || createPlannerMessageId(),
    [initialConversations]
  );
  const [activeConversationId, setActiveConversationId] = useState(initialConversationId);
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    initialConversations.length > 0
      ? initialConversations
      : [createConversation(initialConversationId)]
  );
  const [conversationError, setConversationError] = useState(conversationLoadError);
  const [userEmail, setUserEmail] = useState("");
  const persistedConversationIdsRef = useRef(
    new Set(initialConversations.map((conversation) => conversation.id))
  );
  const activeConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === activeConversationId) ||
      conversations[0],
    [activeConversationId, conversations]
  );
  const messages = activeConversation?.messages || [];

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

  return {
    initialConversationId,
    activeConversationId,
    setActiveConversationId,
    conversations,
    setConversations,
    activeConversation,
    messages,
    conversationError,
    setConversationError,
    userEmail,
    setUserEmail,
    persistedConversationIdsRef,
    updateConversation,
    updateActiveConversation,
  };
}

const ChatComposer = memo(function ChatComposer({
  activeMode,
  modeSelected,
  modeSelectionDisabled,
  isWorking,
  isUnderstanding,
  analysisActive,
  attachments,
  attachmentError,
  draftSnapshotRef,
  onAnalyze,
  onModeSelect,
  onInvalidateAnalysis,
  onFiles,
  onRemoveAttachment,
}: {
  activeMode: ChatMode;
  modeSelected: boolean;
  modeSelectionDisabled: boolean;
  isWorking: boolean;
  isUnderstanding: boolean;
  analysisActive: boolean;
  attachments: ChatAttachment[];
  attachmentError: string;
  draftSnapshotRef: { current: string };
  onAnalyze: (prompt: string) => void;
  onModeSelect: (mode: ChatMode) => void;
  onInvalidateAnalysis: () => void;
  onFiles: (files: FileList | null, draft: string) => void;
  onRemoveAttachment: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const suggestions = useMemo(() => getComposerSuggestions(draft), [draft]);

  function updateDraft(value: string) {
    setDraft(value);
    draftSnapshotRef.current = value;

    if (analysisActive) {
      onInvalidateAnalysis();
    }
  }

  function applySuggestion(suggestion: string) {
    updateDraft(`${draft.trim()}\n\nFocus on: ${suggestion}`);
  }

  function applyQuickAction(action: (typeof analysisQuickActions)[number]) {
    const currentDraft = draft.trim();
    const nextDraft = currentDraft
      ? `${currentDraft}\n\n${action.starter}`
      : action.starter;

    updateDraft(nextDraft);
    onModeSelect(action.mode);
  }

  return (
    <section className="py-4 sm:py-7">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-teal-200/65">
            ZERINIX AI
          </p>
          <h2 className="mt-2.5 text-[1.75rem] font-semibold leading-tight tracking-[-0.045em] text-white sm:text-[2.05rem]">
            New analysis session
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400/80">
            Tell ZERINIX what you want to accomplish.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-teal-300/15 bg-teal-300/[0.06] px-3.5 py-2 text-[11px] font-medium text-teal-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-300 shadow-[0_0_12px_rgba(94,234,212,0.85)]" />
          {modeSelected ? decisionGoalLabels[activeMode] : "Select analysis type"}
        </span>
      </div>
      <div className="rounded-[1.75rem] border border-white/[0.085] bg-[linear-gradient(145deg,rgba(24,24,27,0.94),rgba(8,8,10,0.99))] p-2 shadow-[0_28px_80px_rgba(0,0,0,0.46)] ring-1 ring-white/[0.025] sm:p-2.5">
        <div className="rounded-[1.35rem] border border-white/[0.07] bg-black/35 p-3.5 transition duration-200 focus-within:border-teal-300/25 focus-within:bg-black/50 focus-within:shadow-[0_0_0_1px_rgba(94,234,212,0.055)] sm:p-4">
          <textarea
            value={draft}
            onChange={(event) => updateDraft(event.target.value)}
            className="min-h-[7.5rem] w-full resize-none border-0 bg-transparent p-1 text-[15px] leading-7 text-white outline-none transition placeholder:text-zinc-600 sm:min-h-[9rem] sm:text-base"
            placeholder="Describe a business decision, opportunity or challenge…"
          />
          {attachments.length > 0 ? (
            <div className="mb-3 mt-2 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/[0.065] py-1.5 pl-3 pr-1.5 text-xs text-zinc-300"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-teal-200" />
                  <span className="min-w-0">
                    <span className="block max-w-52 truncate">{attachment.name}</span>
                    <span className="mt-0.5 block text-[10px] text-zinc-500">
                      {attachment.mimeType || "Unspecified type"} ·{" "}
                      {attachment.size >= 1_000_000
                        ? `${(attachment.size / 1_000_000).toFixed(1)} MB`
                        : `${Math.max(1, Math.round(attachment.size / 1_000))} KB`}
                    </span>
                    {attachment.status === "processing" ? (
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10">
                        <span
                          className="block h-full rounded-full bg-teal-300 transition-all"
                          style={{ width: `${attachment.progress || 15}%` }}
                        />
                      </span>
                    ) : null}
                    {attachment.status === "error" ? (
                      <span className="mt-1 block text-[10px] text-red-300">
                        {attachment.error || "File could not be read."}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(attachment.id)}
                    aria-label={`Remove ${attachment.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-white/10 hover:text-white"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {attachmentError ? (
            <p
              role="alert"
              className="mb-2 rounded-xl bg-red-300/10 px-3 py-2 text-xs leading-5 text-red-200"
            >
              {attachmentError}
            </p>
          ) : null}
          <div className="mt-2.5 flex flex-col gap-2.5 border-t border-white/[0.065] pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.045] px-3.5 text-xs font-medium text-zinc-300 transition hover:border-white/[0.13] hover:bg-white/[0.075] hover:text-white">
                <Paperclip className="h-3.5 w-3.5 text-teal-200" />
                Attach
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.tsv,.txt,.md,.json,.zip,.png,.jpg,.jpeg,.webp,.gif,.heic,.avif"
                  className="sr-only"
                  onChange={(event) => {
                    onFiles(event.target.files, draft);
                    event.target.value = "";
                  }}
                />
              </label>
              <span className="hidden px-1 text-[10px] text-zinc-600 lg:inline">
                PDF, Word, Excel, CSV, images, text or ZIP · 5 MB each
              </span>
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => applySuggestion(suggestion)}
                  className="rounded-full bg-white/[0.045] px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition hover:bg-teal-300/10 hover:text-teal-100"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onAnalyze(draft)}
              disabled={
                !modeSelected ||
                (!draft.trim() && attachments.length === 0) ||
                isWorking ||
                isUnderstanding ||
                attachments.some((attachment) => attachment.status !== "ready")
              }
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-teal-300 px-5 py-2 text-sm font-semibold text-black shadow-[0_12px_28px_rgba(13,148,136,0.18)] transition duration-200 ease-out hover:-translate-y-0.5 hover:bg-teal-200 hover:shadow-[0_16px_34px_rgba(13,148,136,0.24)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              {isUnderstanding ? "Sending..." : "Send"}
              <Send className={`h-4 w-4 ${isUnderstanding ? "animate-pulse" : ""}`} />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 px-2 pb-1.5 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
            Quick actions
          </p>
          <div className="flex flex-wrap gap-2">
            {analysisQuickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => applyQuickAction(action)}
                disabled={modeSelectionDisabled}
                aria-pressed={modeSelected && activeMode === action.mode}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/40 ${
                  modeSelected && activeMode === action.mode
                    ? "border-teal-300/20 bg-teal-300/[0.1] text-teal-100"
                    : "border-white/[0.065] bg-white/[0.035] text-zinc-400 hover:border-white/[0.12] hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {analysisWorkspaceModes.map((option) => {
          const Icon = option.icon;
          const selected = modeSelected && activeMode === option.mode;

          return (
            <button
              key={option.mode}
              type="button"
              onClick={() => onModeSelect(option.mode)}
              disabled={modeSelectionDisabled}
              aria-pressed={selected}
              className={`group relative flex min-h-[8.75rem] flex-col items-start rounded-[1.4rem] border p-4.5 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/40 ${
                selected
                  ? "border-teal-300/30 bg-[linear-gradient(145deg,rgba(20,184,166,0.12),rgba(9,9,11,0.82))] shadow-[0_18px_44px_rgba(4,47,46,0.2)] ring-1 ring-teal-300/[0.08]"
                  : "border-white/[0.075] bg-[linear-gradient(145deg,rgba(255,255,255,0.045),rgba(255,255,255,0.018))] hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-white/[0.055] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
              }`}
            >
              {selected ? (
                <span className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-teal-300 text-black shadow-lg shadow-teal-950/30">
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
              ) : null}
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.9rem] ${
                  selected
                    ? "bg-teal-300 text-black"
                    : "border border-white/[0.065] bg-white/[0.045] text-zinc-400 transition group-hover:border-teal-300/15 group-hover:text-teal-100"
                }`}
              >
                <Icon className="h-[19px] w-[19px]" />
              </span>
              <span className="mt-4 min-w-0 pr-5">
                <span className="block text-[15px] font-semibold tracking-[-0.015em] text-white">
                  {option.title}
                </span>
                <span className="mt-2 block text-xs leading-5 text-zinc-500">
                  {option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {!modeSelected ? (
        <p className="mt-4 text-center text-xs font-medium text-amber-200/80">
          Select an analysis type to continue.
        </p>
      ) : null}
    </section>
  );
});

export default function Planner({
  initialConversations = [],
  conversationLoadError = "",
  initialMode,
  initialWorkspaces = [],
  initialWorkspaceId = "",
  initialReport = null,
  regenerationContext = null,
  preferredLanguage = "",
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
          initialReport?.type === "Real Estate Investment Analysis"
            ? realEstateReportFields
            : initialReport?.type === "Strategic Report"
              ? getPlanFieldsForDomain(
                  classifyReportDomain(initialReport.prompt),
                  initialReport.prompt
                )
              : planReportFields,
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
  useEffect(() => {
    removeLargePlannerQueryPayloads();
  }, []);

  const [prompt, setPrompt] = useState(() => buildExecutiveBriefPrompt(initialExecutiveBrief));
  const {
    chatLoading,
    setChatLoading,
    attachments,
    setAttachments,
    attachmentError,
    setAttachmentError,
    isDraggingFiles,
    setIsDraggingFiles,
    handleFiles,
    handleDropFiles,
  } = usePlannerChat();
  const {
    result,
    setResult,
    reportGenerationError,
    setReportGenerationError,
    reportGenerationWarning,
    setReportGenerationWarning,
    marketReport,
    setMarketReport,
    planReport,
    setPlanReport,
    activeReportId,
    setActiveReportId,
    loading,
    setLoading,
    workflowCompletedSteps,
    setWorkflowCompletedSteps,
    reportProgress,
    setReportProgress,
    currentReportSectionName,
    setCurrentReportSectionName,
    lastRequest,
    setLastRequest,
    currentReportInvestmentScore,
    setCurrentReportInvestmentScore,
    currentReportMetadata,
    setCurrentReportMetadata,
    setRegeneratingReportMode,
  } = useReportGeneration({
    initialConversations,
    initialMode,
    initialReport,
    regenerationContext,
    restoredReportMode,
    restoredMarketReport: restoredMarketReport as MarketReport | null,
    restoredPlanReport: restoredPlanReport as PlanReport | null,
  });
  const {
    activeConversationId,
    setActiveConversationId,
    conversations,
    setConversations,
    activeConversation,
    messages,
    conversationError,
    setConversationError,
    userEmail,
    setUserEmail,
    persistedConversationIdsRef,
    updateConversation,
    updateActiveConversation,
  } = useConversations({
    initialConversations,
    conversationLoadError,
  });
  const [activeMode, setActiveMode] = useState<ChatMode>(
    (regenerationContext
      ? regenerationContext.reportType === "Market Analysis"
        ? "market"
        : "plan"
      : restoredReportMode) ||
      initialMode ||
      "chat"
  );
  const [hasSelectedAnalysisMode, setHasSelectedAnalysisMode] = useState(
    Boolean(regenerationContext || restoredReportMode)
  );
  const [isUnderstanding, setIsUnderstanding] = useState(false);
  const [composerResetKey, setComposerResetKey] = useState(0);
  const [chatModelPreference] = useState<ChatModelPreference>("fast");
  const [selectedWorkspaceId] = useState(
    getInitialSelectedWorkspaceId(
      initialWorkspaces,
      regenerationContext?.workspaceId || initialWorkspaceId,
      initialReport?.workspaceId
    )
  );
  const chatScrollerRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);
  const composerDraftRef = useRef("");
  const understandingRequestRef = useRef(0);
  const activeAnalysisContextRef = useRef<Record<string, unknown> | null>(null);
  const chatRequestInFlightRef = useRef(false);
  const conversationNavigationGenerationRef = useRef(0);
  const activeReportRequestRef = useRef<{
    requestId: string;
    conversationId: string;
  } | null>(null);
  const isNearBottomRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);

  const isReportWorking = loading;
  const isWorking = isReportWorking || chatLoading;

  function cancelPendingUnderstanding() {
    logPlannerAttachmentTrace(
      "CLEANUP_CANCEL_PENDING_UNDERSTANDING",
      attachments,
      { clearsAttachments: false }
    );
    understandingRequestRef.current += 1;
    setIsUnderstanding(false);
  }

  function selectAnalysisMode(mode: ChatMode) {
    if (isWorking || isUnderstanding) {
      return;
    }

    cancelPendingUnderstanding();
    setActiveMode(mode);
    setHasSelectedAnalysisMode(true);
  }

  function buildAttachmentPrompt(files: PlannerAttachment[]) {
    return `Analyze the attached ${files.length === 1 ? "file" : "files"}: ${files
      .map((attachment) => attachment.name)
      .join(", ")}`;
  }

  async function requestUniversalUnderstanding(
    submittedPrompt: string,
    queuedAttachments: PlannerAttachment[],
    selectedMode: ChatMode,
    aiCostRequestId: string
  ) {
    const assets = createUnderstandingAssets(queuedAttachments);
    const fallback = createUnderstandingFallback({
      prompt: submittedPrompt,
      assets,
      selectedMode,
    });

    try {
      const accessToken = await getSupabaseAccessToken();
      const response = await fetch("/api/understanding", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-Zerinix-AI-Request-Id": aiCostRequestId,
        },
        body: JSON.stringify({
          prompt: submittedPrompt,
          selectedMode,
          attachments: assets,
        }),
      });

      if (!response.ok) {
        return fallback;
      }

      const payload = (await response.json()) as { understanding?: unknown };
      const parsed = universalUnderstandingSchema.safeParse(
        payload.understanding
      );
      return parsed.success ? parsed.data : fallback;
    } catch {
      return fallback;
    }
  }

  async function persistAnalysisContext(
    context: Record<string, unknown>
  ) {
    const conversationId = activeConversationId;
    const nextContext: Record<string, unknown> = {
      ...(activeAnalysisContextRef.current || {}),
      ...context,
      updatedAt: new Date().toISOString(),
    };
    activeAnalysisContextRef.current = nextContext;

    try {
      const originalRequest =
        typeof nextContext.originalRequest === "string"
          ? nextContext.originalRequest
          : "";
      const contextTitle =
        activeConversation?.title ||
        (originalRequest
          ? generateConversationTitle(originalRequest)
          : "New analysis session");
      if (!(await ensurePersistedConversation(conversationId, contextTitle))) {
        return;
      }

      const supabase = createClient();
      const session = await restoreSupabaseSession(supabase);
      if (!session?.user?.id) {
        return;
      }

      const { error } = await supabase
        .from("ai_conversations")
        .update({ analysis_context: nextContext })
        .eq("id", conversationId)
        .eq("user_id", session.user.id);

      if (error && process.env.NODE_ENV !== "production") {
        console.warn("[planner] analysis context persistence skipped", {
          code: error.code,
        });
      }
    } catch {
      // Analysis metadata persistence is best-effort and must not block reports.
    }
  }

  async function handlePlannerFiles(files: FileList | null, draft = "") {
    cancelPendingUnderstanding();
    composerDraftRef.current = draft;
    await handleFiles(files);
  }

  async function handlePlannerDrop(event: DragEvent<HTMLElement>) {
    cancelPendingUnderstanding();
    await handleDropFiles(event);
  }

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
    // Conversation history should hydrate once on mount; adding the loader function
    // as a dependency would refetch on every render because it is declared in Planner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return createPlannerMessageId();
  }

  async function createNewConversation() {
    if (activeReportRequestRef.current) {
      console.info("[SESSION] navigation blocked", {
        reason: "report_generation_active",
        ...activeReportRequestRef.current,
      });
      return;
    }
    conversationNavigationGenerationRef.current += 1;
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
    setCurrentReportInvestmentScore(undefined);
    setCurrentReportMetadata(undefined);
    setActiveReportId("");
    setHasSelectedAnalysisMode(false);
    setWorkflowCompletedSteps(0);
    setReportProgress(0);
    setCurrentReportSectionName("");
    cancelPendingUnderstanding();
    activeAnalysisContextRef.current = null;
    composerDraftRef.current = "";
    setComposerResetKey((current) => current + 1);
    setAttachments([]);
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
    if (activeReportRequestRef.current) {
      console.info("[SESSION] navigation blocked", {
        reason: "report_generation_active",
        requestedConversationId: id,
        ...activeReportRequestRef.current,
      });
      return;
    }
    conversationNavigationGenerationRef.current += 1;
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
    await restoreSupabaseSession(supabase);
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
      attachments: (message.attachments || []).map(
        ({ id, name, size, mimeType, textContent }) => ({
          id,
          name,
          size,
          mimeType,
          textContent,
        })
      ),
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
      return false;
    } else {
      setConversationError("");
      return true;
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
    const hydrationGeneration = conversationNavigationGenerationRef.current;
    const supabase = createClient();
    await restoreSupabaseSession(supabase);
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
      setConversationError("No authenticated user was available for analysis history persistence.");
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
      ? await loadPersistedMessagesForConversations(supabase, user.id, conversationIds)
      : { data: [] as PersistedMessageRow[], error: null };

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

    const hydrationIsStale =
      hydrationGeneration !== conversationNavigationGenerationRef.current;
    persistedConversationIdsRef.current = new Set([
      ...persistedConversationIdsRef.current,
      ...nextConversations.map((conversation) => conversation.id),
    ]);
    setConversationError("");

    if (nextConversations.length === 0) {
      return;
    }

    if (hydrationIsStale) {
      setConversations((current) => {
        const currentIds = new Set(
          current.map((conversation) => conversation.id)
        );

        return [
          ...current,
          ...nextConversations.filter(
            (conversation) => !currentIds.has(conversation.id)
          ),
        ];
      });
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
    if (activeReportRequestRef.current) {
      console.info("[SESSION] navigation blocked", {
        reason: "report_generation_active",
        requestedConversationId: conversationId,
        ...activeReportRequestRef.current,
      });
      return;
    }
    conversationNavigationGenerationRef.current += 1;
    const selectedConversation = conversations.find(
      (conversation) => conversation.id === conversationId
    );
    const latestMode = [...(selectedConversation?.messages || [])]
      .reverse()
      .find((message) => message.mode)?.mode;

    setActiveConversationId(conversationId);
    if (latestMode) {
      setActiveMode(latestMode);
      setHasSelectedAnalysisMode(true);
    } else {
      setHasSelectedAnalysisMode(false);
    }
    clearComposerPrompt();
    setResult("");
    setReportGenerationError("");
    setReportGenerationWarning("");
    setMarketReport(null);
    setPlanReport(null);
    setWorkflowCompletedSteps(0);
    cancelPendingUnderstanding();
    activeAnalysisContextRef.current = null;
    composerDraftRef.current = "";
    setComposerResetKey((current) => current + 1);
    setAttachments([]);
    void loadPersistedMessages(conversationId);
  }

  function setComposerPrompt(value: string) {
    setPrompt(value);
  }

  function clearComposerPrompt() {
    setPrompt("");
  }

  function addUserMessage(
    mode: ChatMode,
    content: string,
    conversationId = activeConversationId,
    attachedFiles = attachments
  ) {
    logPlannerAttachmentTrace(
      "CLEANUP_ADD_USER_MESSAGE_BEFORE_RESET",
      attachedFiles,
      {
        mode,
        clearsAttachments: false,
      }
    );
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
    setHasSelectedAnalysisMode(true);
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
    const activeReportMode = [...messages]
      .reverse()
      .find((message) => message.mode === "plan" || message.mode === "market")
      ?.mode;
    const reportMode =
      activeReportMode ||
      (restoredReportMode && activeReportId === initialReport?.id
        ? restoredReportMode
        : null);
    const reportPrompt =
      reportMode
        ? [...messages]
            .reverse()
            .find(
              (message) =>
                message.role === "user" &&
                message.mode === reportMode &&
                message.content.trim()
            )
            ?.content.trim() ||
          initialReport?.prompt.trim() ||
          (lastRequest?.mode === reportMode ? lastRequest.prompt.trim() : "")
        : "";
    const request =
      reportMode && reportPrompt
        ? {
            mode: reportMode,
            prompt: reportPrompt,
            attachments: lastRequest?.attachments || [],
            reportReadiness: lastRequest?.reportReadiness,
          }
        : lastRequest?.prompt.trim()
          ? lastRequest
          : null;

    if (!request) {
      return;
    }

    if (isWorking) {
      return;
    }

    setRegeneratingReportMode(
      request.mode === "plan" || request.mode === "market" ? request.mode : null
    );

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

    if (request.reportReadiness) {
      void generatePlan(
        request.prompt,
        false,
        request.attachments,
        request.reportReadiness,
        request.mode
      );
    } else if (request.mode === "plan") {
      void generatePlan(
        request.prompt,
        false,
        request.attachments,
        request.reportReadiness,
        "plan"
      );
    } else if (request.mode === "market") {
      void generatePlan(
        request.prompt,
        false,
        request.attachments,
        request.reportReadiness,
        "market"
      );
    } else {
      setRegeneratingReportMode(null);
      void sendChatMessage(
        request.prompt,
        false,
        previousAssistantMessage?.id,
        request.attachments
      );
    }
  }

  function getUniversalPrompt(draft: string) {
    const submittedPrompt = draft.trim();

    if (submittedPrompt) {
      return submittedPrompt;
    }

    if (attachments.length > 0) {
      return buildAttachmentPrompt(attachments);
    }

    return "";
  }

  async function submitForUnderstanding(draft: string) {
    const submittedPrompt = getUniversalPrompt(draft);

    if (
      !submittedPrompt ||
      !hasSelectedAnalysisMode ||
      isWorking ||
      isUnderstanding
    ) {
      return;
    }
    const selectedMode = activeMode;
    if (attachments.some((attachment) => attachment.status === "processing")) {
      setAttachmentError("Please wait until every file has finished processing.");
      return;
    }
    if (attachments.some((attachment) => attachment.status === "error")) {
      setAttachmentError("Remove unreadable files before starting the analysis.");
      return;
    }

    const aiCostRequestId = crypto.randomUUID();
    const requestId = understandingRequestRef.current + 1;
    understandingRequestRef.current = requestId;
    setIsUnderstanding(true);
    const queuedAttachments = [...attachments];
    const understanding = await requestUniversalUnderstanding(
      submittedPrompt,
      queuedAttachments,
      selectedMode,
      aiCostRequestId
    );

    if (understandingRequestRef.current !== requestId) {
      return;
    }

    setIsUnderstanding(false);
    void persistAnalysisContext({
      originalRequest: submittedPrompt,
      selectedMode,
      detectedIndustry: understanding.detectedIndustry,
      detectedIntent: understanding.detectedIntent,
      detectedContentType: understanding.detectedContentType,
      uploadedFiles: createUnderstandingAssets(queuedAttachments).map(
        (asset) => ({
          name: asset.name,
          size: asset.size,
          mimeType: asset.mimeType,
        })
      ),
      clarificationQuestions: understanding.clarificationQuestions,
      extractedAssetFacts: understanding.extractedAssetFacts,
      expertiseProfile: understanding.expertiseProfile,
      reportPlan: understanding.reportPlan,
      researchPlan: understanding.researchPlan,
      clarificationAnswers: {},
      reportStatus: selectedMode === "chat" ? "ready_to_start" : "generating",
      createdAt: new Date().toISOString(),
    });

    if (selectedMode === "chat") {
      composerDraftRef.current = "";
      setComposerResetKey((current) => current + 1);
      await sendChatMessage(
        submittedPrompt,
        true,
        "",
        queuedAttachments,
        aiCostRequestId
      );
      return;
    }

    const reportReadiness = createDirectReportReadiness(understanding);
    cancelPendingUnderstanding();
    composerDraftRef.current = "";
    setComposerResetKey((current) => current + 1);
    void generatePlan(
      submittedPrompt,
      true,
      queuedAttachments,
      reportReadiness,
      selectedMode,
      aiCostRequestId
    );
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
    metadata,
  }: {
    title: string;
    promptText: string;
    reportType: string;
    workspaceId?: string;
    status?: "completed" | "failed";
    sections: Array<{ title: string; content: string }>;
    expectedSectionCount: number;
    metadata?: ReportMetadata;
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
          containsEmptySection: sections.some(
            (section) => !section.title.trim() || !section.content.trim()
          ),
        });
      }

      const supabase = createClient();
      await restoreSupabaseSession(supabase);
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
          metadata: persistedStatus === "completed" ? metadata || {} : {},
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

      const streamError = extractChatStreamError(output);
      if (streamError !== null) {
        throw new Error(streamError);
      }

      onChunk(sanitizeAiResponseText(output));
    }

    output += decoder.decode();

    const streamError = extractChatStreamError(output);
    if (streamError !== null) {
      throw new Error(streamError);
    }

    const sanitizedOutput = sanitizeAiResponseText(output);
    onChunk(sanitizedOutput);

    return sanitizedOutput;
  }

  async function sendChatMessage(
    promptOverride = prompt,
    addToHistory = true,
    supersededAssistantMessageId = "",
    attachmentOverride?: PlannerAttachment[],
    aiCostRequestId = crypto.randomUUID()
  ) {
    const currentAttachments =
      attachmentOverride?.length ? attachmentOverride : attachments;
    logPlannerAttachmentTrace(
      "POINT_5_SEND_CHAT_MESSAGE_ENTRY",
      currentAttachments,
      {
        hasAttachmentOverride: attachmentOverride !== undefined,
        composerAttachmentCount: attachments.length,
        cleanupRanBeforeEntry:
          Boolean(attachmentOverride?.length) && attachments.length === 0,
      }
    );
    const submittedPrompt = promptOverride.trim();

    if (!submittedPrompt || chatLoading || chatRequestInFlightRef.current) {
      return;
    }

    chatRequestInFlightRef.current = true;
    setChatLoading(true);
    setActiveMode("chat");
    setLastRequest({
      mode: "chat",
      prompt: submittedPrompt,
      attachments: currentAttachments,
    });
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
    const requestMode =
      currentAttachments.length > 0 ? "file_analysis" : "chat";
    const memoryMessages = currentMessages
      .filter(
        (message) =>
          message.content.trim() &&
          message.id !== supersededAssistantMessageId &&
          message.status !== "failed" &&
          !isReportPreparingPreview(message.content)
      )
      .map((message) => ({
        role: message.role,
        content: [
          message.content,
          message.attachments?.length
            ? `Uploaded files referenced in this message: ${message.attachments
                .map((attachment) => attachment.name)
                .join(", ")}`
            : "",
          message.mode && message.mode !== "chat"
            ? `Selected analysis type: ${message.mode}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      }));

    await ensurePersistedConversation(conversationId, title);

    if (addToHistory) {
      const userMessage = addUserMessage(
        "chat",
        submittedPrompt,
        conversationId,
        currentAttachments
      );
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
      const accessToken = await getSupabaseAccessToken();
      const chatRequestPayload = {
        prompt: submittedPrompt,
        analysisMode: "chat" as const,
        conversationId,
        requestMode,
        modelPreference: chatModelPreference,
        attachments: serializePlannerAttachments(currentAttachments),
        messages: memoryMessages,
        reportId: activeReportId,
      };
      logPlannerAttachmentTrace(
        "POINT_6_BEFORE_CHAT_PAYLOAD_SERIALIZATION",
        currentAttachments,
        {
          requestMode,
          composerAttachmentCount: attachments.length,
          stateResetOccurredBeforeSerialization:
            currentAttachments.length > 0 && attachments.length === 0,
          serializedAttachmentCount: chatRequestPayload.attachments.length,
          clearsAttachmentsAfterSerialization: true,
        }
      );
      setAttachments([]);
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-Zerinix-AI-Request-Id": aiCostRequestId,
        },
        signal: abortController.signal,
        body: JSON.stringify(chatRequestPayload),
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
      chatRequestInFlightRef.current = false;
      setChatLoading(false);
    }
  }

  async function generatePlan(
    promptOverride = prompt,
    addToHistory = true,
    attachmentOverride?: PlannerAttachment[],
    reportReadiness?: UniversalReportReadiness,
    requestedMode: ChatMode = "plan",
    aiCostRequestId = crypto.randomUUID()
  ) {
    const submittedPrompt = promptOverride.trim();

    if (!submittedPrompt) {
      return;
    }

    if (loading || activeReportRequestRef.current) {
      return;
    }

    const conversationId = activeConversationId;
    const reportRequestId = createMessageId();
    const clientExecutionStartedAt = performance.now();
    activeReportRequestRef.current = {
      requestId: reportRequestId,
      conversationId,
    };
    conversationNavigationGenerationRef.current += 1;
    console.info("[SESSION] generation locked", {
      requestId: reportRequestId,
      conversationId,
    });
    setLoading(true);
    setActiveMode(requestedMode);
    setWorkflowCompletedSteps(0);
    const reportAttachments =
      attachmentOverride?.length ? attachmentOverride : attachments;
    // Regenerating the same report must reproduce its original language
    // exactly, not re-detect it -- re-detection can land on a different
    // language than the one the saved report actually used.
    const isRegeneratingSavedReport =
      Boolean(regenerationContext?.reportLanguage) &&
      regenerationContext?.prompt.trim() === submittedPrompt;
    const reportLanguage = isRegeneratingSavedReport
      ? getResponseLanguage(getReportLanguageCode(regenerationContext!.reportLanguage as ReportLanguageCode))
      : resolvePlannerReportLanguage(submittedPrompt, requestedMode, preferredLanguage);
    setLastRequest({
      mode: requestedMode,
      prompt: submittedPrompt,
      attachments: reportAttachments,
      reportReadiness,
      language: reportLanguage,
    });
    setReportProgress(0);
    setCurrentReportSectionName("Preparing your report");
    const copy = getLanguageCopy(reportLanguage);
    const inferredReportDomain = classifyReportDomain(
      submittedPrompt,
      reportAttachments.map((attachment) => ({
        name: attachment.name,
        type: attachment.mimeType,
        textContent: attachment.textContent,
      }))
    );
    const reportDomain = resolveReportDomainForSelectedMode({
      selectedMode: requestedMode,
      inferredDomain: inferredReportDomain,
      expertiseDomain: reportReadiness?.expertiseProfile.domain,
    });
    const baseDomainFields = getPlanFieldsForDomain(reportDomain);
    // CRITICAL FIX -- dual report generation / mismatched report
    // identity. Both are reassigned once, and only once, if the worker's
    // persisted report turns out to be a different domain than this
    // pre-fetch guess -- see the self-correction block right before
    // persistedSections is read, below.
    let outputFields = localizeReportFields(
      requestedMode === "market"
        ? reportFields
        : reportDomain === "operations"
          ? getPlanFieldsForDomain(reportDomain, submittedPrompt)
          : baseDomainFields,
      reportLanguage
    );
    let reportTitle =
      requestedMode === "market"
        ? copy.marketTitle
        : reportDomain === "real_estate"
        ? copy.realEstateTitle
        : reportDomain === "acquisition"
        ? getAcquisitionReportTitle(reportLanguage)
        : isSpecializedReportDomain(reportDomain)
          ? getSpecializedReportTitle(reportDomain, reportLanguage)
          : copy.planTitle;
    const preparingReport =
      requestedMode === "market"
        ? copy.preparingMarket
        : reportDomain === "real_estate"
        ? copy.preparingRealEstate
        : isSpecializedReportDomain(reportDomain)
          ? `## ${reportTitle}\n\n${
              reportLanguage === "Turkish"
                ? "Kanıtlar ve dış kaynak araştırması hazırlanıyor..."
                : "Preparing evidence and external research..."
            }`
          : copy.preparingPlan;
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
    const initialPersistenceTasks: Promise<unknown>[] = [];
    if (addToHistory) {
      const userMessage = addUserMessage(
        requestedMode,
        submittedPrompt,
        conversationId,
        reportAttachments
      );
      initialPersistenceTasks.push(persistMessage(conversationId, userMessage));
      if (shouldUpdateTitle) {
        initialPersistenceTasks.push(
          persistConversationTitle(conversationId, title)
        );
      }
    }
    const assistantMessageId = addAssistantMessage(
      requestedMode,
      preparingReport,
      "streaming",
      conversationId
    );
    initialPersistenceTasks.push(
      persistMessage(conversationId, {
        id: assistantMessageId,
        role: "assistant",
        mode: requestedMode,
        content: preparingReport,
        status: "streaming",
        createdAt: Date.now(),
      })
    );
    void Promise.allSettled(initialPersistenceTasks).then((results) => {
      const rejectedCount = results.filter(
        (result) => result.status === "rejected"
      ).length;
      if (rejectedCount > 0) {
        console.warn("[report-jobs] non-blocking conversation persistence failed", {
          reportRequestId,
          rejectedCount,
        });
      }
    });
    setResult("");
    setReportGenerationError("");
    setReportGenerationWarning("");
    setMarketReport(null);
    setPlanReport(null);
    setCurrentReportInvestmentScore(undefined);

    const reportOutput: PlanReport = { ...emptyPlanReport };
    let reportMetadata: ReportMetadata | undefined;
    const completedFields = new Set<PlanReportField>();
    let reportApiCalls = 0;

    const markSectionComplete = (field: PlanReportField) => {
      if (completedFields.has(field)) {
        return;
      }

      completedFields.add(field);
      setCurrentReportSectionName(
        outputFields.find((item) => item.field === field)?.title || reportTitle
      );
      setReportProgress(
        calculateReportProgress(completedFields.size, outputFields.length)
      );
    };

    const streamFullReport = async () => {
      reportApiCalls += 1;

      assertReportApiCallBudget({
        logLabel: `[planner] ${reportDomain} report AI call count`,
        reportRequestId,
        aiCallsForReport: reportApiCalls,
        maxAiCallsPerReport: REPORT_GENERATION_MAX_API_CALLS,
      });

      removeLargePlannerQueryPayloads();
      const planRequestUrl = "/api/plan";
      const accessToken = await getSupabaseAccessToken();

      // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
      // generation timeout incident): this initial POST only enqueues
      // the report job and is expected to return quickly (the actual
      // generation is deferred to the background) -- but unlike the
      // polling loop below, which has its own maxReportPollWaitMs wall-
      // clock ceiling, this fetch call had no bound of its own. A
      // connection that hangs completely (no response, no error, no
      // closed socket) would leave the UI stuck on "Streaming"/
      // "Preparing your report..." before ever reaching the polling
      // phase where that ceiling could even start counting. Mirrors the
      // same AbortController+timeout pattern already used for chat
      // requests (CHAT_REQUEST_TIMEOUT_MS above).
      const planFetchAbortController = new AbortController();
      let planFetchTimedOut = false;
      const planFetchTimeoutId = setTimeout(() => {
        planFetchTimedOut = true;
        planFetchAbortController.abort();
      }, PLAN_ENQUEUE_REQUEST_TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(planRequestUrl, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            "X-Zerinix-Pipeline": "decision_intelligence_v1",
            "X-Zerinix-Report-Request-Id": reportRequestId,
            "X-Zerinix-AI-Request-Id": aiCostRequestId,
            ...(reportReadiness
              ? { "X-Zerinix-Universal-Input": "true" }
              : {}),
          },
          referrerPolicy: "no-referrer",
          signal: planFetchAbortController.signal,
          body: JSON.stringify({
            prompt: submittedPrompt,
            analysisMode: requestedMode,
            field: "fullReport",
            reportRequestId,
            language: reportLanguage,
            explicitReportLanguage: getExplicitReportLanguageSelection() || undefined,
            uiLanguage: getPlannerUiLanguage() || undefined,
            browserLanguage: typeof navigator === "undefined" ? undefined : navigator.language,
            reportDomain,
            reportTitle,
            workspaceId: selectedWorkspaceId,
            conversationId,
            assistantMessageId,
            attachments: serializePlannerAttachments(reportAttachments),
            ...(reportReadiness ? { reportReadiness } : {}),
          }),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError" && planFetchTimedOut) {
          throw new Error(
            reportLanguage === "Turkish"
              ? "Rapor isteği sunucuya ulaşamadı ve zaman aşımına uğradı. Lütfen tekrar deneyin."
              : "The report request could not reach the server and timed out. Please try again."
          );
        }
        throw error;
      } finally {
        clearTimeout(planFetchTimeoutId);
      }

      if (process.env.NODE_ENV !== "production") {
        console.info("[PLANNER] report response", {
          reportRequestId,
          requestedPipeline: "decision_intelligence_v1",
          responsePipeline: res.headers.get("x-zerinix-pipeline"),
          responseRequestId: res.headers.get(
            "x-zerinix-report-request-id"
          ),
          endpoint: planRequestUrl,
          reportDomain,
          attachmentCount: reportAttachments.length,
        });
      }

      const enqueuePayload = (await res.json().catch(() => null)) as
        | { success?: boolean; jobId?: string; status?: string; error?: string }
        | null;

      if (!res.ok || !enqueuePayload?.success || !enqueuePayload.jobId) {
        throw new Error(
          enqueuePayload?.error || copy.retryError
        );
      }

      const jobId = enqueuePayload.jobId;
      setCurrentReportSectionName("Report queued");
      setWorkflowCompletedSteps((current) => Math.max(current, 1));
      let completedReportId = "";
      let completedReportPayload: {
        sections?: unknown;
        metadata?: unknown;
      } | null = null;
      let pollDelayMs = 0;
      let consecutivePollFailures = 0;
      let totalPollFailures = 0;
      let lastProgress = -1;
      let lastProgressStage = "";
      // CRITICAL FIX -- this loop previously had no wall-clock ceiling: a
      // job stuck in a non-terminal status (e.g. its worker died mid-run)
      // keeps returning HTTP 200 with "processing"/"researching"/etc.
      // forever, which is not caught by the 5-consecutive-*network*-
      // failure guard above -- the UI's "Preparing your report..." spinner
      // (isReportWorking, tied to this same async call) would then spin
      // indefinitely. Report generation's own worst-case internal budget
      // is well under 5 minutes; this ceiling is a generous multiple of
      // that (covering a retry_wait cycle or two) so it never cuts off a
      // report that is genuinely still progressing, while guaranteeing the
      // UI always eventually recovers into the existing error/retry state
      // instead of hanging forever.
      const maxReportPollWaitMs = 8 * 60 * 1000;

      while (!completedReportId) {
        if (performance.now() - clientExecutionStartedAt > maxReportPollWaitMs) {
          throw new Error(
            reportLanguage === "Turkish"
              ? "Rapor oluşturma beklenenden çok daha uzun sürdü ve zaman aşımına uğradı. Lütfen tekrar deneyin."
              : "Report generation is taking much longer than expected and has timed out. Please try again."
          );
        }

        if (pollDelayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, pollDelayMs));
        }

        let statusResponse: Response;
        try {
          statusResponse = await fetch(
            `/api/report-jobs/${encodeURIComponent(jobId)}`,
            {
              credentials: "include",
              headers: { Authorization: `Bearer ${accessToken}` },
              cache: "no-store",
            }
          );
        } catch (error) {
          consecutivePollFailures += 1;
          totalPollFailures += 1;
          if (consecutivePollFailures > 5) {
            throw error;
          }
          pollDelayMs = Math.min(4_000, 500 * 2 ** (consecutivePollFailures - 1));
          continue;
        }

        const jobStatus = (await statusResponse.json().catch(() => null)) as
          | {
              status?: string;
              progress?: number;
              progressStage?: string;
              reportId?: string | null;
              report?: {
                sections?: unknown;
                metadata?: unknown;
              } | null;
              updatedAt?: string | null;
              error?: string | null;
            }
          | null;

        if (
          (!statusResponse.ok || !jobStatus?.status) &&
          (statusResponse.status === 429 || statusResponse.status >= 500)
        ) {
          consecutivePollFailures += 1;
          totalPollFailures += 1;
          if (consecutivePollFailures <= 5) {
            pollDelayMs = Math.min(
              4_000,
              500 * 2 ** (consecutivePollFailures - 1)
            );
            continue;
          }
        }

        if (!statusResponse.ok || !jobStatus?.status) {
          throw new Error(jobStatus?.error || "Report status could not be loaded.");
        }

        consecutivePollFailures = 0;

        if (
          typeof jobStatus.progress === "number" &&
          jobStatus.progress !== lastProgress
        ) {
          lastProgress = jobStatus.progress;
          setReportProgress(Math.max(0, Math.min(100, jobStatus.progress)));
        }

        if (
          jobStatus.progressStage &&
          jobStatus.progressStage !== lastProgressStage
        ) {
          lastProgressStage = jobStatus.progressStage;
          setCurrentReportSectionName(
            jobStatus.progressStage.replace(/_/g, " ")
          );
        }

        if (jobStatus.status === "failed" || jobStatus.status === "cancelled") {
          throw new Error(
            jobStatus.error ||
              (jobStatus.status === "cancelled"
                ? "Report generation was cancelled."
                : copy.retryError)
          );
        }

        if (jobStatus.status === "completed") {
          if (!jobStatus.reportId) {
            throw new Error("Completed report job did not include a report id.");
          }

          completedReportId = jobStatus.reportId;
          completedReportPayload = jobStatus.report || null;
          console.info("[report-jobs] client delivery timing", {
            reportRequestId,
            totalMs: Math.round(performance.now() - clientExecutionStartedAt),
            completionToClientMs: jobStatus.updatedAt
              ? Math.max(0, Date.now() - Date.parse(jobStatus.updatedAt))
              : null,
            transientPollFailures: totalPollFailures,
          });
          break;
        }

        pollDelayMs =
          jobStatus.status === "retry_wait"
            ? 4_000
            : jobStatus.status === "extracting" || jobStatus.status === "researching"
              ? 2_000
              : jobStatus.status === "queued" || jobStatus.status === "claimed"
                ? 1_000
                : 750;
      }

      let persistedReport = completedReportPayload;
      if (!persistedReport) {
        const reportClient = createClient();
        await restoreSupabaseSession(reportClient);
        const { data, error: persistedReportError } = await reportClient
          .from("reports")
          .select("sections,metadata")
          .eq("id", completedReportId)
          .maybeSingle();

        if (persistedReportError || !data) {
          throw new Error(
            persistedReportError?.message || "Completed report could not be loaded."
          );
        }
        persistedReport = data;
      }

      const persistedSections = Array.isArray(persistedReport.sections)
        ? (persistedReport.sections as Array<{
            field?: string;
            title?: string;
            content?: string;
          }>)
        : [];

      // CRITICAL FIX -- dual report generation / mismatched report
      // identity. reportDomain/outputFields/reportTitle above are a
      // CLIENT-SIDE guess made before the worker ever ran; in "chat" mode
      // that guess depends on the LLM-based /api/understanding call's
      // expertiseProfile.domain, which can disagree with the domain the
      // worker actually generated under (worker.ts's own inferDomain is
      // authoritative there -- it reads the report generator's own
      // reportDomain stream event). Every report schema in this codebase
      // deliberately shares zero field names with any other, so when the
      // guess is wrong, none of outputFields will ever match a persisted
      // section -- self-correct from the persisted sections' own field
      // names (the same distinguishing-field technique worker.ts's
      // inferDomain already uses) before reading them, rather than
      // rendering the wrong title over content it can't parse or failing
      // outright with an incomplete-payload error.
      if (requestedMode !== "market") {
        const persistedFieldNames = persistedSections
          .map((section) => section.field)
          .filter((field): field is string => Boolean(field));
        const clientGuessMatchesPersistedReport = outputFields.some(({ field }) =>
          persistedFieldNames.includes(field)
        );

        if (!clientGuessMatchesPersistedReport && persistedFieldNames.length > 0) {
          const correctedDomain = inferReportDomainFromFieldNames(persistedFieldNames);

          if (correctedDomain !== reportDomain) {
            console.warn("[planner] corrected report domain from persisted sections", {
              reportRequestId,
              guessedDomain: reportDomain,
              correctedDomain,
            });
            outputFields = localizeReportFields(
              getPlanFieldsForDomain(correctedDomain, submittedPrompt),
              reportLanguage
            );
            reportTitle =
              correctedDomain === "real_estate"
                ? copy.realEstateTitle
                : correctedDomain === "acquisition"
                ? getAcquisitionReportTitle(reportLanguage)
                : isSpecializedReportDomain(correctedDomain)
                  ? getSpecializedReportTitle(correctedDomain, reportLanguage)
                  : copy.planTitle;
          }
        }
      }

      // CRITICAL FIX -- find why report sanitization is not reaching
      // production output. Root cause: this LIVE, immediately-post-
      // generation report view (reportOutput / setPlanReport /
      // getReportMarkdown below, rendered through ReportPanel and
      // persisted into the chat message) reads directly from the
      // worker's persisted sections and was never routed through the
      // sanitizer at all -- report-utils.ts's normalizeReport (and its
      // sanitizeReportSectionsForPresentation call) only runs when a
      // SAVED report is later reloaded via loadUserReport, an entirely
      // different code path a user only reaches by navigating away and
      // back. A user saw the raw, unsanitized report the moment
      // generation finished, in the same session, before that ever
      // happened. Filtered here, before the extraction loop (not after),
      // so completedFields/hasCompletePayload below are computed against
      // the same, already-excluded field list -- excluding a field after
      // counting it complete would make hasCompletePayload false and the
      // whole report throw as incomplete.
      outputFields = outputFields.filter((entry) => isUniversalCustomerFacingSection(entry));

      for (const { field, title } of outputFields) {
        const persistedSection = persistedSections.find(
          (section) => section.field === field || section.title === title
        );
        const content = stripReportPresentationArtifacts(
          typeof persistedSection?.content === "string"
            ? persistedSection.content.trim()
            : ""
        );

        if (!content) {
          continue;
        }

        reportOutput[field] = content;
        markSectionComplete(field);
      }

      if (
        persistedReport.metadata &&
        typeof persistedReport.metadata === "object" &&
        !Array.isArray(persistedReport.metadata)
      ) {
        reportMetadata = persistedReport.metadata as ReportMetadata;
        setCurrentReportMetadata(reportMetadata);
        if (reportMetadata.investmentScore) {
          setCurrentReportInvestmentScore(reportMetadata.investmentScore);
        }
      }

      const hasCompletePayload =
        completedFields.size === outputFields.length &&
        outputFields.every(({ field }) => reportOutput[field]?.trim());

      if (!hasCompletePayload) {
        throw new Error(
          "Report job completed without a complete report payload."
        );
      }

      console.info("[STREAM] closed", {
        requestId: reportRequestId,
        conversationId,
        pipeline:
          "decision_intelligence_v1",
        completedFieldCount: completedFields.size,
        reportCompleted: hasCompletePayload,
      });

      return {
        reportCompleted: true,
        warnings: [] as string[],
        reportId: completedReportId,
      };
    };

    try {
      const streamOutcome = await streamFullReport();
      const warningMessage = moveReportAdvisoriesIntoWarningsSection({
        reportData: reportOutput,
        fields: outputFields,
        warnings: streamOutcome.warnings,
        language: reportLanguage,
      });

      if (requestedMode === "market") {
        setMarketReport(Object.fromEntries(
          reportFields.map(({ field }) => [field, reportOutput[field] || ""])
        ) as MarketReport);
        setPlanReport(null);
      } else {
        setPlanReport({ ...reportOutput });
        setMarketReport(null);
      }
      setReportGenerationError("");
      setReportGenerationWarning(warningMessage);
      setReportProgress(100);
      setCurrentReportSectionName("Report ready");
      setWorkflowCompletedSteps(6);
      updateAssistantMessage(
        assistantMessageId,
        getReportMarkdown(reportTitle, reportOutput, outputFields),
        "complete",
        conversationId
      );
      const savedReportId = streamOutcome.reportId;
      void persistAnalysisContext({
        reportStatus: "completed",
        ...(savedReportId ? { finalReportId: savedReportId } : {}),
        completedAt: new Date().toISOString(),
      });
      if (!savedReportId) {
        setReportGenerationWarning(
          warningMessage ||
            (reportLanguage === "Turkish"
              ? "Rapor tamamlandı ancak rapor kitaplığına kaydedilemedi."
              : "The report completed but could not be saved to the report library.")
        );
      } else {
        setActiveReportId(savedReportId);
        void attributeReportUsage(savedReportId, reportRequestId);
        console.info("[SESSION] persisted", {
          requestId: reportRequestId,
          conversationId,
          reportId: savedReportId,
          status: "completed",
        });
        void notifyReportReady(savedReportId);
      }
    } catch (error) {
      const errorMessage = getReportGenerationErrorMessage(error, copy.retryError);
      void persistAnalysisContext({
        reportStatus: "failed",
        failedAt: new Date().toISOString(),
      });
      setReportGenerationError(errorMessage);
      setResult(errorMessage);
      setPlanReport(null);
      setMarketReport(null);
      setReportProgress(0);
      setCurrentReportSectionName("Report failed");
      setWorkflowCompletedSteps(0);
      const failedReportId = await saveGeneratedReport({
        title: reportTitle,
        promptText: submittedPrompt,
        reportType:
          requestedMode === "market"
            ? "market_analysis"
            : reportDomain === "real_estate"
            ? "real_estate_investment_analysis"
            : isSpecializedReportDomain(reportDomain)
              ? `${reportDomain}_analysis`
              : "business_plan",
        workspaceId: selectedWorkspaceId,
        status: "failed",
        sections: [],
        expectedSectionCount: outputFields.length,
        metadata: reportMetadata,
      });
      await attributeReportUsage(failedReportId, reportRequestId);
      updateAssistantMessage(
        assistantMessageId,
        errorMessage,
        "failed",
        conversationId
      );
      const failureMessagePersisted = await updatePersistedMessage(
        assistantMessageId,
        errorMessage,
        "failed"
      );
      console.info(
        failureMessagePersisted
          ? "[SESSION] persisted"
          : "[SESSION] persistence failed",
        {
          requestId: reportRequestId,
          conversationId,
          reportId: failedReportId,
          status: "failed",
        }
      );
    } finally {
      if (
        activeReportRequestRef.current?.requestId === reportRequestId
      ) {
        activeReportRequestRef.current = null;
      }
      setLoading(false);
      setRegeneratingReportMode(null);
    }
  }

  const activeReportLanguage = lastRequest?.language || detectResponseLanguage(lastRequest?.prompt || prompt);
  const currentLanguageCopy = getLanguageCopy(activeReportLanguage);
  const activeReportMode = planReport
    ? "plan"
    : marketReport || activeMode === "market"
      ? "market"
      : "plan";
  const activePlanReportDomain =
    initialReport?.type === "Real Estate Investment Analysis" &&
    !lastRequest?.prompt
      ? "real_estate"
      : resolveReportDomainForSelectedMode({
          selectedMode: lastRequest?.mode || activeMode,
          inferredDomain: classifyReportDomain(
            lastRequest?.prompt || prompt,
            (lastRequest?.attachments || []).map((attachment) => ({
              name: attachment.name,
              type: attachment.mimeType,
              textContent: attachment.textContent,
            }))
          ),
          expertiseDomain:
            lastRequest?.reportReadiness?.expertiseProfile.domain,
        });
  const activeReportFields = useMemo(
    () =>
      (
        activeReportMode === "plan"
          ? localizeReportFields(
              getPlanFieldsForDomain(
                activePlanReportDomain,
                lastRequest?.prompt || prompt
              ),
              activeReportLanguage
            )
          : localizeReportFields(reportFields, activeReportLanguage)
      ).filter((entry) => isUniversalCustomerFacingSection(entry)) as Array<{
        field: keyof (MarketReport & PlanReport);
        title: string;
        icon: LucideIcon;
      }>,
    [
      activePlanReportDomain,
      activeReportLanguage,
      activeReportMode,
      lastRequest?.prompt,
      prompt,
    ]
  );
  const currentReportTitle = activeReportMode === "plan"
    ? activePlanReportDomain === "real_estate"
      ? currentLanguageCopy.realEstateTitle
      : activePlanReportDomain === "acquisition"
        ? getAcquisitionReportTitle(activeReportLanguage)
        : isSpecializedReportDomain(activePlanReportDomain)
          ? getSpecializedReportTitle(activePlanReportDomain, activeReportLanguage)
          : currentLanguageCopy.planTitle
    : currentLanguageCopy.marketTitle;
  const activeAnalysisLabel = activePlanReportDomain === "legal"
    ? getSpecializedReportTitle("legal", activeReportLanguage)
    : decisionGoalLabels[activeMode];
  const shouldShowToolbarRegenerate = true;
  const mobileConversationSummaries = useMemo(
    () =>
      [...conversations]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((conversation) => ({
          id: conversation.id,
          title: getAnalysisSessionTitle(conversation.title),
          preview: getConversationPreview(conversation),
          updatedAt: conversation.updatedAt,
        })),
    [conversations]
  );
  const mobileReportPrompt = useMemo(() => {
    const currentMessages = (activeConversation?.messages || [])
      .filter(
        (message) =>
          message.content.trim() &&
          message.status !== "failed" &&
          message.mode !== "plan" &&
          message.mode !== "market" &&
          !isReportPreparingPreview(message.content)
      )
      .slice(-12);
    const latestUserPrompt =
      [...currentMessages]
        .reverse()
        .find((message) => message.role === "user")
        ?.content.trim() ||
      initialReport?.prompt.trim() ||
      "";

    if (!latestUserPrompt) {
      return "";
    }

    const conversationContext = currentMessages
      .map(
        (message) =>
          `${message.role === "user" ? "User" : "Assistant"}: ${message.content.trim()}`
      )
      .join("\n\n");

    return [
      latestUserPrompt,
      conversationContext
        ? `Create a professional strategic report using the current conversation as context.\n\nCurrent conversation:\n${conversationContext}`
        : "Create a professional strategic report from this request.",
    ].join("\n\n");
  }, [activeConversation, initialReport?.prompt]);

  function generateMobileStrategicReport() {
    if (!mobileReportPrompt || isWorking) {
      return;
    }

    void submitForUnderstanding(mobileReportPrompt);
  }

  function backToWorkspaceFromReportRestriction() {
    setReportGenerationError("");
    setResult("");
    setWorkflowCompletedSteps(0);
    setReportProgress(0);
    setCurrentReportSectionName("");
    setActiveMode("chat");
  }

  function continueRestrictedReportAsChat() {
    const submittedPrompt = lastRequest?.prompt.trim() || "";
    const queuedAttachments = lastRequest?.attachments || [];

    if (!submittedPrompt || isWorking) {
      return;
    }

    logPlannerAttachmentTrace(
      "POINT_4_CONTINUE_AS_CHAT_CLICKED",
      queuedAttachments,
      { source: "report_restriction_card" }
    );
    backToWorkspaceFromReportRestriction();
    void sendChatMessage(submittedPrompt, false, "", queuedAttachments);
  }

  const mobileReportContent =
    isReportWorking || planReport || marketReport || result ? (
      <>
        {isReportWorking ? (
          <ReportGenerationShell
            title={currentReportTitle}
            subtitle={activeReportMode === "market" ? currentLanguageCopy.preparingSubtitle : undefined}
          />
        ) : (
          <ReportPanel
            reportData={planReport || marketReport}
            reportFields={activeReportFields}
            reportId={activeReportId}
            reportTitle={currentReportTitle}
            reportDomain={activePlanReportDomain}
            sourcePrompt={lastRequest?.prompt}
            reportLanguage={activeReportLanguage}
            waitingMessage={currentLanguageCopy.waitingSection}
            result={result}
            failureMessage={reportGenerationError}
            warningMessage={reportGenerationWarning}
            investmentScore={currentReportInvestmentScore || initialReport?.investmentScore}
            benchmarkFit={
              currentReportMetadata?.benchmarkFit || initialReport?.metadata?.benchmarkFit
            }
            benchmarkScore={
              currentReportMetadata?.benchmarkScore || initialReport?.metadata?.benchmarkScore
            }
            reportQuality={
              currentReportMetadata?.reportQuality || initialReport?.metadata?.reportQuality
            }
            isMarketIntelligence={activeReportMode === "market"}
            onContinueAsChat={continueRestrictedReportAsChat}
            onBackToWorkspace={backToWorkspaceFromReportRestriction}
          />
        )}
      </>
    ) : null;

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
      onDrop={(event) => {
        void handlePlannerDrop(event);
      }}
    >
      <MobileBottomNavigation />
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        activeMode={activeMode}
        modeSelected={hasSelectedAnalysisMode}
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

        <header className="relative z-10 hidden min-h-[76px] items-center justify-between gap-5 border-b border-white/[0.075] bg-black/70 px-5 py-3.5 shadow-[0_16px_45px_rgba(0,0,0,0.28)] backdrop-blur-2xl md:flex lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.9rem] border border-teal-200/20 bg-[linear-gradient(145deg,rgba(94,234,212,0.16),rgba(13,148,136,0.06))] shadow-[0_10px_30px_rgba(4,47,46,0.25)]">
              <Sparkles className="h-[17px] w-[17px] text-teal-200" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-semibold tracking-[0.32em] text-teal-300/70">
                  ZERINIX AI
                </p>
                <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1 text-[10px] font-medium text-zinc-400">
                  {hasSelectedAnalysisMode
                    ? activeAnalysisLabel
                    : "Select analysis type"}
                </span>
              </div>
              <h1 className="mt-1 truncate text-lg font-semibold tracking-[-0.025em] text-white md:text-xl">
                {activeConversation
                  ? getAnalysisSessionTitle(activeConversation.title)
                  : "Business Decision Advisor"}
              </h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void createNewConversation()}
              className="hidden min-h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-white/[0.14] hover:bg-white/[0.075] md:inline-flex"
            >
              <Plus className="h-4 w-4 text-teal-200" />
              New analysis
            </button>
            {shouldShowToolbarRegenerate ? (
              <button
                type="button"
                onClick={regenerateResponse}
                disabled={isWorking}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-white/[0.14] hover:bg-white/[0.075] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCcw className="h-4 w-4 text-teal-200" />
                <span className="inline">Regenerate</span>
              </button>
            ) : null}
            <Link
              href="/dashboard/settings"
              aria-label="Open account settings"
              className="hidden min-h-10 items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] px-2.5 py-1.5 transition hover:border-white/[0.14] hover:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30 lg:flex"
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

        <MobileConversationExperience
          key={`mobile-composer-${composerResetKey}`}
          activeConversationId={activeConversationId}
          conversationTitle={
            activeConversation
              ? getAnalysisSessionTitle(activeConversation.title)
              : "New conversation"
          }
          conversations={mobileConversationSummaries}
          messages={messages}
          attachments={attachments}
          attachmentError={attachmentError}
          draftSnapshotRef={composerDraftRef}
          activeAnalysisMode={activeMode}
          analysisModeSelected={hasSelectedAnalysisMode}
          analysisActive={isUnderstanding}
          chatLoading={chatLoading || isUnderstanding}
          isWorking={isWorking || isUnderstanding}
          canGenerateReport={Boolean(mobileReportPrompt)}
          reportContent={mobileReportContent}
          recommendationContent={
            isUnderstanding ? <UnderstandingLoadingState /> : null
          }
          reportUpdateKey={`${reportProgress}:${currentReportSectionName}:${activeReportId}:${result.length}`}
          conversationError={conversationError}
          onFiles={(files, draft) => {
            void handlePlannerFiles(files, draft);
          }}
          onRemoveAttachment={(id) => {
            cancelPendingUnderstanding();
            setAttachmentError("");
            setAttachments((current) =>
              current.filter((attachment) => attachment.id !== id)
            );
          }}
          onInvalidateAnalysis={cancelPendingUnderstanding}
          onAnalyze={(draft) => void submitForUnderstanding(draft)}
          onSelectAnalysisMode={selectAnalysisMode}
          onGenerateReport={generateMobileStrategicReport}
          onCreateConversation={() => void createNewConversation()}
          onSelectConversation={selectConversation}
          renderMessageContent={(message: MobileConversationMessage) => (
            <MarkdownRenderer
              content={
                message.role === "assistant" && message.mode === "market" && message.status === "complete"
                  ? getReportCompletionHeadline(message.content)
                  : message.content
              }
              streaming={message.status === "streaming"}
            />
          )}
        />

        <div
          ref={chatScrollerRef}
          onScroll={updateNearBottomState}
          className="relative z-10 hidden min-h-0 flex-1 overflow-y-auto scroll-smooth px-4 py-5 sm:px-5 md:block lg:px-8 lg:py-7"
        >
          <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 pb-48">
            <div
              className="mx-auto flex w-full flex-col gap-6 pb-14"
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

              <ChatComposer
                key={`desktop-composer-${composerResetKey}`}
                activeMode={activeMode}
                modeSelected={hasSelectedAnalysisMode}
                modeSelectionDisabled={isWorking || isUnderstanding}
                isWorking={isWorking}
                isUnderstanding={isUnderstanding}
                analysisActive={isUnderstanding}
                attachments={attachments}
                attachmentError={attachmentError}
                draftSnapshotRef={composerDraftRef}
                onAnalyze={(draft) => void submitForUnderstanding(draft)}
                onModeSelect={selectAnalysisMode}
                onInvalidateAnalysis={cancelPendingUnderstanding}
                onFiles={(files, draft) => {
                  void handlePlannerFiles(files, draft);
                }}
                onRemoveAttachment={(id) => {
                  cancelPendingUnderstanding();
                  setAttachmentError("");
                  setAttachments((current) =>
                    current.filter((attachment) => attachment.id !== id)
                  );
                }}
              />

              {isUnderstanding ? <UnderstandingLoadingState /> : null}

              <ChatMessages
                messages={messages}
                onEdit={editMessage}
                onSaveEdit={saveEditedMessage}
                onRegenerate={regenerateResponse}
              />

              {isReportWorking ? (
                <ReportGenerationShell
                  title={currentReportTitle}
                  subtitle={activeReportMode === "market" ? currentLanguageCopy.preparingSubtitle : undefined}
                />
              ) : (planReport || marketReport || result) ? (
                <ReportPanel
                  reportData={planReport || marketReport}
                  reportFields={activeReportFields}
                  reportId={activeReportId}
                  reportTitle={currentReportTitle}
                  reportDomain={activePlanReportDomain}
                  sourcePrompt={lastRequest?.prompt}
                  reportLanguage={activeReportLanguage}
                  waitingMessage={currentLanguageCopy.waitingSection}
                  result={result}
                  failureMessage={reportGenerationError}
                  warningMessage={reportGenerationWarning}
                  investmentScore={currentReportInvestmentScore || initialReport?.investmentScore}
                  benchmarkFit={currentReportMetadata?.benchmarkFit || initialReport?.metadata?.benchmarkFit}
                  benchmarkScore={currentReportMetadata?.benchmarkScore || initialReport?.metadata?.benchmarkScore}
                  reportQuality={currentReportMetadata?.reportQuality || initialReport?.metadata?.reportQuality}
                  isMarketIntelligence={activeReportMode === "market"}
                  onContinueAsChat={continueRestrictedReportAsChat}
                  onBackToWorkspace={backToWorkspaceFromReportRestriction}
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
