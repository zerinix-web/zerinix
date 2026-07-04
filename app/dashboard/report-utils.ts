import type { SupabaseClient, User } from "@supabase/supabase-js";

export type DashboardReport = {
  id: string;
  title: string;
  createdAt: string;
  type: "Business Plan" | "Market Analysis";
  status: string;
  sections: Array<{
    title: string;
    content: string;
  }>;
};

type ReportRow = Record<string, unknown>;

const sectionLabels: Record<string, string> = {
  executiveSummary: "Executive Summary",
  marketAnalysis: "Market Analysis",
  businessModel: "Business Model",
  targetAudience: "Target Audience",
  targetCustomer: "Target Customer",
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
  const candidates = [row.report, row.report_data, row.content, row.result, row.data];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as ReportRow;
    }
  }

  return row;
}

function inferReportType(row: ReportRow) {
  const rawType = readString(row, ["type", "report_type", "kind"], "").toLowerCase();

  if (rawType.includes("market") || rawType.includes("pazar")) {
    return "Market Analysis";
  }

  return "Business Plan";
}

function normalizeSections(row: ReportRow) {
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
    title: readString(row, ["title", "name"], titleFallback),
    createdAt,
    type: reportType,
    status: readString(row, ["status", "state"], "Ready"),
    sections: normalizeSections(row),
  };
}

export async function getAuthenticatedUser(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function loadUserReports(supabase: SupabaseClient, user: User) {
  const { data, error } = await supabase
    .from("reports")
    .select("*")
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

export async function loadUserReport(
  supabase: SupabaseClient,
  user: User,
  reportId: string
) {
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("user_id", user.id)
    .eq("id", reportId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return normalizeReport(data as ReportRow);
}
