import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  readReportInvestmentScore,
  type ReportInvestmentScore,
  type ReportMetadata,
} from "@/app/lib/report-investment-score";
import { dedupeReportSections } from "@/app/lib/report-section-normalization";

export type DashboardReport = {
  id: string;
  workspaceId: string;
  title: string;
  prompt: string;
  createdAt: string;
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

export type MobileReportType =
  | "Business Plan"
  | "Market Analysis"
  | "Real Estate Investment Analysis"
  | "Acquisition Due Diligence Report"
  | "Strategic Report";

export type MobileReportPreview = {
  id: string;
  workspaceId: string;
  title: string;
  summary: string;
  createdAt: string;
  type: MobileReportType;
  status: string;
  confidence?: number;
};

export type DashboardWorkspace = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  reportCount: number;
};

type ReportRow = Record<string, unknown>;
type ReportSection = DashboardReport["sections"][number];

const sectionLabels: Record<string, string> = {
  executiveSummary: "Executive Summary",
  problem: "Problem",
  solution: "Solution",
  targetCustomer: "Target Customer / ICP",
  marketOpportunity: "Market Opportunity",
  competitorLandscape: "Competitor Landscape",
  tamSamSom: "TAM / SAM / SOM",
  swotAnalysis: "SWOT Analysis",
  portersFiveForces: "Porter's Five Forces",
  pricingStrategy: "Pricing Strategy",
  goToMarketPlan: "Go-to-Market Plan",
  salesStrategy: "Sales Strategy",
  unitEconomics: "Unit Economics",
  financialDashboard: "Financial Dashboard",
  scenarioAnalysis: "Scenario Analysis: Worst / Base / Best Case",
  kpiDashboard: "KPI Dashboard",
  executiveRecommendation: "Executive Recommendation",
  kpis: "KPIs",
  founderRoadmap: "Founder Roadmap",
  roadmap306090: "30-60-90 Day Roadmap",
  financialAssumptions: "Financial Assumptions",
  founderScore: "Founder Readiness Score",
  sourcesAssumptions: "Sources / Assumptions",
  marketOverview: "Market Overview",
  industryTrends: "Industry Trends",
  competitorAnalysis: "Competitor Analysis",
  customerPainPoints: "Customer Pain Points",
  opportunities: "Opportunities",
  threats: "Threats",
  entryStrategy: "Entry Strategy",
  validationPlan: "Validation Plan",
  keyMetrics: "Key Metrics",
  sources: "Sources",
  marketAnalysis: "Market Analysis",
  businessModel: "Business Model",
  targetAudience: "Target Audience",
  revenueModel: "Revenue Model",
  roadmap90Days: "90-Day Roadmap",
  risks: "Risks",
  firstCustomerStrategy: "First Customer Strategy",
  kpiMetrics: "KPI Metrics",
  successScore: "AI Success Score",
  assetIdentification: "Asset Identification",
  extractedDocumentFacts: "Extracted Document Facts",
  ownershipTitleFindings: "Ownership and Title Findings",
  location: "Location",
  zoningLandUseStatus: "Zoning and Land-Use Status",
  accessInfrastructure: "Access and Infrastructure",
  comparableMarketEvidence: "Comparable Market Evidence",
  valuationRange: "Valuation Range",
  legalRisks: "Legal Risks",
  environmentalGeotechnicalRisks: "Environmental and Geotechnical Risks",
  liquidity: "Liquidity",
  developmentPotential: "Development Potential",
  investmentScore: "Investment Score",
  missingInformation: "Missing Information",
  recommendedDueDiligence: "Recommended Due Diligence",
  finalRecommendation: "Final Recommendation",
  subjectIdentification: "Subject Identification",
  extractedFacts: "Extracted Facts",
  externalEvidence: "External Evidence",
  domainFindings: "Domain Findings",
  regulatoryCompliance: "Regulatory and Compliance Findings",
  financialImplications: "Financial Implications",
  operationalImplications: "Operational Implications",
  riskAnalysis: "Risk Analysis",
  decisionAssessment: "Decision Assessment",
  recommendedActions: "Recommended Actions",
  executiveAcquisitionSummary: "Executive Acquisition Summary",
  targetCompanyOverview: "Target Company Overview",
  strategicFit: "Strategic Fit",
  valuationAnalysis: "Valuation Analysis (EV/ARR, Purchase Price Fairness)",
  financingStructure: "Financing Structure",
  debtCapacity: "Debt Capacity",
  roiAnalysis: "ROI Analysis",
  irrAnalysis: "IRR Analysis",
  revenueSynergies: "Revenue Synergies",
  costSynergies: "Cost Synergies",
  integrationRisks: "Integration Risks",
  operationalRisks: "Operational Risks",
  regulatoryReview: "Regulatory Review",
  competitivePosition: "Competitive Position",
  dealRisks: "Deal Risks",
  postMergerIntegrationPlan: "Post-Merger Integration Plan (30/60/90 Days)",
  finalInvestmentRecommendation: "Final Investment Recommendation",
};

const sectionOrder = Object.keys(sectionLabels);

function readString(row: ReportRow, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = row[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return fallback;
}

function readReportPayload(row: ReportRow) {
  const candidates = [
    row.sections,
    row.report,
    row.report_data,
    row.content,
    row.result,
    row.data,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as ReportRow;
    }
  }

  return row;
}

function isSectionRecord(value: unknown): value is ReportSection {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as ReportRow).title === "string" &&
    typeof (value as ReportRow).content === "string"
  );
}

function inferSectionFieldFromTitle(title: string) {
  const normalizedTitle = title.trim().toLowerCase().replace(/\s+/g, " ");
  const match = Object.entries(sectionLabels).find(
    ([, label]) => label.toLowerCase().replace(/\s+/g, " ") === normalizedTitle
  );

  return match?.[0] || "";
}

function normalizeJsonSections(value: unknown) {
  if (Array.isArray(value)) {
    const sections = value
      .filter(isSectionRecord)
      .map((section) => ({
        field:
          typeof (section as ReportRow).field === "string" &&
          ((section as ReportRow).field as string).trim()
            ? ((section as ReportRow).field as string).trim()
            : inferSectionFieldFromTitle(section.title),
        title: section.title.trim(),
        content: section.content.trim(),
      }))
      .filter((section) => section.title && section.content);

    if (sections.length > 0) {
      return dedupeReportSections(sections);
    }
  }

  return null;
}

function inferReportType(row: ReportRow) {
  const rawType = readString(row, ["type", "report_type", "kind"], "").toLowerCase();

  if (
    rawType.includes("real_estate") ||
    rawType.includes("real estate") ||
    rawType.includes("gayrimenkul")
  ) {
    return "Real Estate Investment Analysis";
  }

  if (rawType.includes("market") || rawType.includes("pazar")) {
    return "Market Analysis";
  }

  // Checked before the legal/finance/... "Strategic Report" catch-all
  // below (whose substrings would never match "acquisition" anyway, but
  // keeping this alongside real_estate/market documents the acquisition
  // domain has its own dedicated report type, not a fallback into
  // "Strategic Report" or the "Business Plan" catch-all at the end --
  // both of which would misrender it through the wrong template).
  if (rawType.includes("acquisition") || rawType.includes("satın alma")) {
    return "Acquisition Due Diligence Report";
  }

  if (
    rawType.includes("legal") ||
    rawType.includes("finance") ||
    rawType.includes("accounting") ||
    rawType.includes("operations") ||
    rawType.includes("procurement")
  ) {
    return "Strategic Report";
  }

  return "Business Plan";
}

function inferMobileReportType(row: ReportRow): MobileReportType {
  const rawType = readString(
    row,
    ["type", "report_type", "kind"],
    ""
  ).toLowerCase();

  if (
    rawType.includes("real_estate") ||
    rawType.includes("real estate") ||
    rawType.includes("gayrimenkul")
  ) {
    return "Real Estate Investment Analysis";
  }

  if (rawType.includes("market") || rawType.includes("pazar")) {
    return "Market Analysis";
  }

  if (rawType.includes("acquisition") || rawType.includes("satın alma")) {
    return "Acquisition Due Diligence Report";
  }

  if (
    rawType.includes("business") ||
    rawType.includes("plan") ||
    rawType.includes("iş plan")
  ) {
    return "Business Plan";
  }

  return "Strategic Report";
}

function normalizeReportConfidence(value: unknown) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }

  const percentage = numeric <= 1 ? numeric * 100 : numeric;
  return Math.min(100, Math.round(percentage));
}

function normalizeMobileReportPreview(row: ReportRow): MobileReportPreview {
  const type = inferMobileReportType(row);
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as ReportMetadata)
      : undefined;
  const investmentScore = readReportInvestmentScore(metadata);
  const summary = readString(
    row,
    ["prompt", "business_idea", "idea", "input", "user_input", "original_prompt"],
    ""
  );

  return {
    id: readString(row, ["id", "report_id"], crypto.randomUUID()),
    workspaceId: readString(row, ["workspace_id", "workspaceId"], ""),
    title: readString(row, ["title", "name"], `${type} Report`),
    summary,
    createdAt: readString(
      row,
      ["created_at", "createdAt", "inserted_at"],
      ""
    ),
    type,
    status: readString(row, ["status", "state"], "completed"),
    confidence: normalizeReportConfidence(investmentScore?.confidence),
  };
}

function normalizeSections(row: ReportRow) {
  const jsonSections = normalizeJsonSections(row.sections);

  if (jsonSections) {
    return jsonSections;
  }

  const payload = readReportPayload(row);
  const sections = sectionOrder
    .map((field) => {
      const content = payload[field] ?? row[field];

      if (typeof content !== "string" || !content.trim()) {
        return null;
      }

      return {
        field,
        title: sectionLabels[field],
        content: content.trim(),
      };
    })
    .filter(Boolean) as DashboardReport["sections"];

  if (sections.length > 0) {
    return dedupeReportSections(sections);
  }

  const fallbackContent = readString(row, ["body", "content", "result", "summary"]);

  return fallbackContent
    ? [{ title: "Report", content: fallbackContent }]
    : [{ title: "Report", content: "Detailed report content has not been saved yet." }];
}

export function normalizeReport(row: ReportRow): DashboardReport {
  const createdAt = readString(row, ["created_at", "createdAt", "inserted_at"], "");
  const reportType = inferReportType(row);
  const titleFallback =
    reportType === "Market Analysis"
      ? "Market Analysis Report"
      : reportType === "Real Estate Investment Analysis"
        ? "Real Estate Investment Analysis"
        : reportType === "Acquisition Due Diligence Report"
          ? "Acquisition Due Diligence Report"
          : reportType === "Strategic Report"
            ? "Strategic Decision Report"
            : "Business Plan Report";
  const sections = normalizeSections(row);
  const investmentScore = readReportInvestmentScore(row.metadata);
  const rowStatus = readString(row, ["status", "state"], "completed");
  const failedReport = rowStatus.toLowerCase() !== "completed";

  return {
    id: readString(row, ["id", "report_id"], crypto.randomUUID()),
    workspaceId: readString(row, ["workspace_id", "workspaceId"], ""),
    title: readString(row, ["title", "name"], titleFallback),
    prompt: readString(row, ["prompt", "business_idea", "idea", "input", "user_input", "original_prompt"], ""),
    createdAt,
    type: reportType,
    status: failedReport ? "failed" : rowStatus,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as ReportMetadata)
        : undefined,
    investmentScore,
    sections: failedReport ? [] : sections,
  };
}

function normalizeWorkspace(row: ReportRow): DashboardWorkspace {
  const reports = Array.isArray(row.reports) ? row.reports : [];

  return {
    id: readString(row, ["id"], crypto.randomUUID()),
    name: readString(row, ["name"], "General"),
    createdAt: readString(row, ["created_at", "createdAt"], ""),
    updatedAt: readString(row, ["updated_at", "updatedAt"], ""),
    reportCount: reports.length,
  };
}

export async function getAuthenticatedUser(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function ensureDefaultWorkspace(supabase: SupabaseClient, user: User) {
  const { data: existingWorkspace } = await supabase
    .from("report_workspaces")
    .select("id")
    .eq("user_id", user.id)
    .eq("name", "General")
    .maybeSingle();

  if (existingWorkspace?.id) {
    return existingWorkspace.id as string;
  }

  const { data: createdWorkspace, error } = await supabase
    .from("report_workspaces")
    .insert({
      user_id: user.id,
      name: "General",
    })
    .select("id")
    .single();

  if (error || !createdWorkspace?.id) {
    const { data: retryWorkspace } = await supabase
      .from("report_workspaces")
      .select("id")
      .eq("user_id", user.id)
      .eq("name", "General")
      .maybeSingle();

    return (retryWorkspace?.id as string | undefined) || "";
  }

  return createdWorkspace.id as string;
}

export async function loadUserWorkspaces(supabase: SupabaseClient, user: User) {
  const { data, error } = await supabase
    .from("report_workspaces")
    .select("id,user_id,name,created_at,updated_at,reports(id)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    return { workspaces: [] as DashboardWorkspace[], error: error.message };
  }

  return {
    workspaces: (data || []).map((row) => normalizeWorkspace(row as ReportRow)),
    error: "",
  };
}

export async function loadUserReports(supabase: SupabaseClient, user: User) {
  const { data, error } = await supabase
    .from("reports")
    .select("id,user_id,workspace_id,title,prompt,report_type,status,created_at,updated_at,sections,metadata")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return { reports: [] as DashboardReport[], error: error.message };
  }

  return {
    reports: (data || []).map((row) => normalizeReport(row as ReportRow)),
    error: "",
  };
}

// Same DashboardReport shape as loadUserReports/normalizeReport, but never
// selects or normalizes `sections` -- for callers that only need
// list-level fields (title, type, status, createdAt, prompt, id) across a
// user's whole report history and must not pay to fetch and normalize
// every report's full section content just to render a list. `sections`
// is always `[]` and `investmentScore` is always `undefined` here; a
// caller that needs one specific report's real content/score should
// fetch it separately with loadUserReport(supabase, user, reportId) --
// see app/dashboard/page.tsx's decision-signal card for the pattern
// (find the right report id from this summary list first, then fetch
// only that one report's real content).
function normalizeReportSummary(row: ReportRow): DashboardReport {
  const createdAt = readString(row, ["created_at", "createdAt", "inserted_at"], "");
  const reportType = inferReportType(row);
  const titleFallback =
    reportType === "Market Analysis"
      ? "Market Analysis Report"
      : reportType === "Real Estate Investment Analysis"
        ? "Real Estate Investment Analysis"
        : reportType === "Acquisition Due Diligence Report"
          ? "Acquisition Due Diligence Report"
          : reportType === "Strategic Report"
            ? "Strategic Decision Report"
            : "Business Plan Report";
  const rowStatus = readString(row, ["status", "state"], "completed");
  const failedReport = rowStatus.toLowerCase() !== "completed";

  return {
    id: readString(row, ["id", "report_id"], crypto.randomUUID()),
    workspaceId: readString(row, ["workspace_id", "workspaceId"], ""),
    title: readString(row, ["title", "name"], titleFallback),
    prompt: readString(row, ["prompt", "business_idea", "idea", "input", "user_input", "original_prompt"], ""),
    createdAt,
    type: reportType,
    status: failedReport ? "failed" : rowStatus,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as ReportMetadata)
        : undefined,
    investmentScore: undefined,
    sections: [],
  };
}

// The dashboard only ever displays the 4 most recent reports
// (recentReports.slice(0, 4)) and, for the mobile "active workspace"
// preview card, the most recent report within whichever single workspace
// is currently most active. 50 gives that second lookup a wide safety
// margin (a workspace would need 50+ MORE-recently-created reports in
// every OTHER workspace before its own latest report could fall outside
// this window) while still cutting a full, unbounded history scan down to
// a small, constant-size page for every account regardless of how many
// reports it has. The two account-wide totals the page also displays
// (total report count, completed count) are sourced independently --
// see totalReports (already computed from loadUserWorkspaces' own
// per-workspace counts) and countUserCompletedReports below -- so neither
// depends on this list being complete.
const DASHBOARD_RECENT_REPORTS_LIMIT = 50;

export async function loadUserReportSummaries(supabase: SupabaseClient, user: User) {
  const { data, error } = await supabase
    .from("reports")
    .select("id,user_id,workspace_id,title,prompt,report_type,status,created_at,metadata")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(DASHBOARD_RECENT_REPORTS_LIMIT);

  if (error) {
    return { reports: [] as DashboardReport[], error: error.message };
  }

  return {
    reports: (data || []).map((row) => normalizeReportSummary(row as ReportRow)),
    error: "",
  };
}

// Same "completed" semantics as normalizeReportSummary above (case
// -insensitive; a missing/blank status defaults to completed), computed
// from a single `status`-only column fetch across the user's whole report
// history -- an accurate account-wide count without paying to fetch
// title/prompt/metadata/etc. for every row just to derive one number.
export async function countUserCompletedReports(
  supabase: SupabaseClient,
  user: User
): Promise<number> {
  const { data, error } = await supabase
    .from("reports")
    .select("status")
    .eq("user_id", user.id);

  if (error || !data) {
    return 0;
  }

  return data.reduce((count, row) => {
    const status = readString(row as ReportRow, ["status", "state"], "completed");
    return status.toLowerCase() === "completed" ? count + 1 : count;
  }, 0);
}

export async function loadUserReportPreviews(
  supabase: SupabaseClient,
  user: User
) {
  const { data, error } = await supabase
    .from("reports")
    .select(
      "id,user_id,workspace_id,title,prompt,report_type,status,created_at,metadata"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return {
      reports: [] as MobileReportPreview[],
      error: error.message,
    };
  }

  return {
    reports: (data || []).map((row) =>
      normalizeMobileReportPreview(row as ReportRow)
    ),
    error: "",
  };
}

export async function loadUserReportCount(
  supabase: SupabaseClient,
  user: User
) {
  const { count, error } = await supabase
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  return {
    count: error ? 0 : count || 0,
    error: error?.message || "",
  };
}

export async function loadWorkspaceReports(
  supabase: SupabaseClient,
  user: User,
  workspaceId: string
) {
  const { data: workspace, error: workspaceError } = await supabase
    .from("report_workspaces")
    .select("id,user_id,name,created_at,updated_at")
    .eq("user_id", user.id)
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceError || !workspace) {
    return null;
  }

  const { data, error } = await supabase
    .from("reports")
    .select("id,user_id,workspace_id,title,prompt,report_type,status,created_at,updated_at,sections,metadata")
    .eq("user_id", user.id)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  return {
    workspace: normalizeWorkspace({
      ...(workspace as ReportRow),
      reports: data || [],
    }),
    reports: error ? [] : (data || []).map((row) => normalizeReport(row as ReportRow)),
    error: error?.message || "",
  };
}

export async function loadUserReport(
  supabase: SupabaseClient,
  user: User,
  reportId: string
) {
  const { data, error } = await supabase
    .from("reports")
    .select("id,user_id,workspace_id,title,prompt,report_type,status,created_at,updated_at,sections,metadata")
    .eq("user_id", user.id)
    .eq("id", reportId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return normalizeReport(data as ReportRow);
}
