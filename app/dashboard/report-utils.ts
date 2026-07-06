import type { SupabaseClient, User } from "@supabase/supabase-js";

export type DashboardReport = {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  type: "Business Plan" | "Market Analysis";
  status: string;
  sections: Array<{
    title: string;
    content: string;
  }>;
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
  pricingStrategy: "Pricing Strategy",
  goToMarketPlan: "Go-to-Market Plan",
  salesStrategy: "Sales Strategy",
  kpis: "KPIs",
  roadmap306090: "30-60-90 Day Roadmap",
  financialAssumptions: "Financial Assumptions",
  founderScore: "AI Founder Score out of 100",
  marketAnalysis: "Market Analysis",
  businessModel: "Business Model",
  targetAudience: "Target Audience",
  revenueModel: "Revenue Model",
  roadmap90Days: "90-Day Roadmap",
  risks: "Risks",
  firstCustomerStrategy: "First Customer Strategy",
  kpiMetrics: "KPI Metrics",
  successScore: "AI Success Score",
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

function normalizeJsonSections(value: unknown) {
  if (Array.isArray(value)) {
    const sections = value
      .filter(isSectionRecord)
      .map((section) => ({
        title: section.title.trim(),
        content: section.content.trim(),
      }))
      .filter((section) => section.title && section.content);

    if (sections.length > 0) {
      return sections;
    }
  }

  return null;
}

function inferReportType(row: ReportRow) {
  const rawType = readString(row, ["type", "report_type", "kind"], "").toLowerCase();

  if (rawType.includes("market") || rawType.includes("pazar")) {
    return "Market Analysis";
  }

  return "Business Plan";
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
        title: sectionLabels[field],
        content: content.trim(),
      };
    })
    .filter(Boolean) as DashboardReport["sections"];

  if (sections.length > 0) {
    return sections;
  }

  const fallbackContent = readString(row, ["body", "content", "result", "summary"]);

  return fallbackContent
    ? [{ title: "Report", content: fallbackContent }]
    : [{ title: "Report", content: "Bu raporun detay içeriği henüz kaydedilmemiş." }];
}

export function normalizeReport(row: ReportRow): DashboardReport {
  const createdAt = readString(row, ["created_at", "createdAt", "inserted_at"], "");
  const reportType = inferReportType(row);
  const titleFallback =
    reportType === "Market Analysis" ? "Market Analysis Report" : "Business Plan Report";

  return {
    id: readString(row, ["id", "report_id"], crypto.randomUUID()),
    workspaceId: readString(row, ["workspace_id", "workspaceId"], ""),
    title: readString(row, ["title", "name"], titleFallback),
    createdAt,
    type: reportType,
    status: readString(row, ["status", "state"], "completed"),
    sections: normalizeSections(row),
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
    .select("id,user_id,workspace_id,title,prompt,report_type,status,created_at,updated_at,sections")
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
    .select("id,user_id,workspace_id,title,prompt,report_type,status,created_at,updated_at,sections")
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
    .select("id,user_id,workspace_id,title,prompt,report_type,status,created_at,updated_at,sections")
    .eq("user_id", user.id)
    .eq("id", reportId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return normalizeReport(data as ReportRow);
}
