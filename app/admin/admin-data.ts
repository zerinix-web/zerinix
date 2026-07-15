import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/app/lib/supabase/server";
import { createServiceRoleClient } from "@/app/lib/supabase/admin";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/app/lib/supabase/env";
import { getStripeConfiguration } from "@/app/lib/billing/stripe";
import { getResendConfiguration } from "@/app/lib/integrations/resend";
import { estimateModelCostUsd, getModelPricing } from "@/app/lib/ai/pricing";

export type AdminUserContext = {
  user: User;
  role: string;
};

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string;
  registeredAt: string;
  lastSignInAt: string;
  plan: string;
  subscriptionStatus: string;
  accountStatus: string;
  reportCount: number;
  conversationCount: number;
  aiRequestCount: number;
  totalTokens: number;
  failedRequestCount: number;
  estimatedAiCostUsd: number;
};

export type AdminDashboardData = {
  dateRange: AdminDateRange;
  totalUsers: number;
  newUsers: number;
  activeUsers: number;
  reportsGenerated: number;
  aiConversations: number;
  workspaceCount: number;
  subscriptions: number;
  monthlyRecurringRevenue: number | null;
  aiApiCost: number;
  sourceStatus: {
    revenue: AdminMetricStatus;
    aiUsage: AdminMetricStatus;
    users: AdminMetricStatus;
    reports: AdminMetricStatus;
    workspaces: AdminMetricStatus;
    subscriptions: AdminMetricStatus;
  };
  sourceDetails: {
    revenue: string;
    aiUsage: string;
    users: string;
    reports: string;
    workspaces: string;
    subscriptions: string;
  };
  financials: {
    revenue: number | null;
    aiCost: number;
    grossProfit: number | null;
    grossMargin: number | null;
    netProfit: number | null;
    averageCostPerUser: number | null;
    averageCostPerReport: number | null;
    dailyAiCost: number | null;
    weeklyAiCost: number | null;
    monthlyAiCost: number | null;
    allTimeAiCost: number | null;
  };
  openAiAnalytics: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
    cost: number;
    costPerUser: number | null;
    costPerReport: number | null;
    costRanges: {
      today: number | null;
      thisMonth: number | null;
      last24h: number | null;
      last7d: number | null;
      last30d: number | null;
      allTime: number | null;
    };
    dailyCostHistory: AdminChartSeries[];
    featureCosts: Array<{
      feature: "AI Chat" | "Reports" | "AI CEO" | "Other AI features";
      costUsd: number | null;
      status: AdminMetricStatus;
    }>;
    costAlerts: Array<{
      id: string;
      label: string;
      thresholdUsd: number | null;
      currentUsd: number | null;
      remainingUsd: number | null;
      status: "configured" | "not_configured";
    }>;
    modelUsage: Array<{
      model: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      tokens: number;
      costUsd: number;
      status: AdminMetricStatus;
    }>;
    unknownModels: Array<{ model: string; requests: number; tokens: number }>;
  };
  userAnalytics: {
    freeUsers: number;
    proUsers: number;
    businessUsers: number;
    growthRate: number | null;
    churnRate: number | null;
    averageUsage: number | null;
  };
  topReports: {
    mostExpensive: Array<{ title: string; value: number; detail: string }>;
    mostUsed: Array<{ title: string; value: number; detail: string }>;
    mostGenerated: Array<{ title: string; value: number; detail: string }>;
  };
  alerts: AdminActivityItem[];
  userGrowth: Array<{ label: string; value: number }>;
  reportTypeDistribution: Array<{ label: string; value: number }>;
  planDistribution: Array<{ label: string; value: number }>;
  recentUsers: AdminUserRow[];
  recentActivity: AdminActivityItem[];
  charts: {
    userGrowth: AdminChartSeries[];
    activeUsers: AdminChartSeries[];
    reportsGenerated: AdminChartSeries[];
    aiRequests: AdminChartSeries[];
    tokenUsage: AdminChartSeries[];
    estimatedAiCost: AdminChartSeries[];
    revenue: AdminChartSeries[];
  };
  revenueOverview: Array<{ label: string; value: string; detail: string }>;
  costControl: AdminCostControlData;
  usageSummary: {
    totalRequests: number;
    totalTokens: number;
    cacheHits: number;
    failedRequests: number;
  };
  recentErrors: Array<{ id: string; endpoint: string; status: string; createdAt: string }>;
  systemStatus: AdminSystemStatus[];
  exportTables: AdminExportTable[];
  notifications: AdminNotificationSummary;
};

export type AdminDateRangeKey = "24h" | "7d" | "30d" | "custom";

export type AdminMetricStatus =
  | "LIVE"
  | "ESTIMATED"
  | "NOT CONNECTED"
  | "NO DATA"
  | "ERROR";

export type AdminDateRange = {
  key: AdminDateRangeKey;
  label: string;
  fromIso: string;
  toIso: string;
  bucket: "hour" | "day";
};

export type AdminSystemStatus = {
  label: string;
  status: "Healthy" | "Degraded" | "Down" | "Not Connected" | "Unknown";
  detail: string;
  lastChecked: string;
  lastSuccessfulCheck: string | null;
  responseTimeMs: number | null;
};

export type AdminActivityItem = {
  id: string;
  label: string;
  detail: string;
  severity: "info" | "success" | "warning" | "error";
  createdAt: string;
  href?: string;
};

export type AdminNotificationSummary = {
  generatedAt: string;
  newUsers: AdminActivityItem[];
  reports: AdminActivityItem[];
  failedJobs: AdminActivityItem[];
};

export type AdminChartSeries = {
  label: string;
  value: number;
};

export type AdminExportTable = {
  id: string;
  title: string;
  columns: string[];
  rows: string[][];
};

export type AdminCostControlData = {
  totalTokensToday: number;
  totalTokensThisMonth: number;
  estimatedCostToday: number | null;
  estimatedCostThisMonth: number | null;
  remainingDailyBudget: number | null;
  remainingWeeklyBudget: number | null;
  remainingMonthlyBudget: number | null;
  remainingPerUserBudget: number | null;
  averageCostPerConversation: number | null;
  averageCostPerReport: number | null;
  failedAiRequests: number;
  costTrendPercent: number | null;
  highestUsageUsers: Array<{ userId: string; tokens: number; costUsd: number }>;
  highestCostRoutes: Array<{ route: string; requests: number; costUsd: number }>;
  dateRanges: string[];
};

export type AdminSearchResultGroup = {
  label: string;
  results: Array<{
    id: string;
    title: string;
    detail: string;
    href: string;
  }>;
};

export type AdminSearchFilter = "users" | "reports" | "conversations" | "payments" | "logs";

const ADMIN_CLAIMS = new Set(["admin", "owner"]);
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;
const ADMIN_AUTH_SCAN_PAGE_SIZE = 1000;
const ADMIN_AUTH_SCAN_MAX_USERS = 5000;
let cachedHealth:
  | { expiresAt: number; data: AdminSystemStatus[] }
  | null = null;

const HEALTH_CHECK_TIMEOUT_MS = 2500;
const HEALTH_DEGRADED_LATENCY_MS = 2000;
const OPENAI_COST_CENTER_START = new Date(Date.UTC(2020, 0, 1));
const OPENAI_ORGANIZATION_USAGE_URL = "https://api.openai.com/v1/organization/usage/completions";
const OPENAI_ORGANIZATION_COSTS_URL = "https://api.openai.com/v1/organization/costs";

type OpenAiModelUsageSummary = {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  tokens: number;
  costUsd: number;
  status: AdminMetricStatus;
};

type OpenAiCostCenterData = {
  status: AdminMetricStatus;
  detail: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  costUsd: number;
  modelUsage: OpenAiModelUsageSummary[];
  dailyCostHistory: AdminChartSeries[];
  costRanges: {
    today: number | null;
    thisMonth: number | null;
    last24h: number | null;
    last7d: number | null;
    last30d: number | null;
    allTime: number | null;
  };
  featureCosts: AdminDashboardData["openAiAnalytics"]["featureCosts"];
  costAlerts: AdminDashboardData["openAiAnalytics"]["costAlerts"];
};

function isLocalAdminMockMode() {
  return process.env.NODE_ENV !== "production" && !getSupabaseServiceRoleKey();
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function roundUsd(value: number) {
  return Number(value.toFixed(6));
}

function unixSeconds(value: Date) {
  return Math.floor(value.getTime() / 1000);
}

function readNestedNumber(value: unknown, path: string[]) {
  let current = value;

  for (const key of path) {
    if (!current || typeof current !== "object") {
      return 0;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return readNumber(current);
}

function getOpenAiCostCenterKey() {
  const key =
    process.env.OPENAI_ADMIN_API_KEY ||
    (process.env.NODE_ENV === "production"
      ? process.env.OPENAI_API_KEY_PROD
      : process.env.OPENAI_API_KEY_DEV);

  return readString(key);
}

function normalizePlan(value: unknown) {
  const plan = readString(value, "free").toLowerCase();

  return plan === "pro" || plan === "business" ? plan : "free";
}

function formatMonthLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "2-digit",
  }).format(new Date(value));
}

function formatDayLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
}

function startOfUtcDay(offsetDays = 0) {
  const now = new Date();

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
}

function startOfUtcHour(offsetHours = 0) {
  const now = new Date();

  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours() + offsetHours
  ));
}

function startOfUtcMonth() {
  const now = new Date();

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function toIso(value: Date) {
  return value.toISOString();
}

function safeDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
}

function isWithinRange(value: string, range: AdminDateRange) {
  const date = safeDate(value);

  if (!date) {
    return false;
  }

  return date >= new Date(range.fromIso) && date <= new Date(range.toIso);
}

function formatHourLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function resolveAdminDateRange(input?: {
  range?: string | string[];
  from?: string | string[];
  to?: string | string[];
}): AdminDateRange {
  const rawRange = Array.isArray(input?.range) ? input?.range[0] : input?.range;
  const key: AdminDateRangeKey =
    rawRange === "24h" || rawRange === "30d" || rawRange === "custom" ? rawRange : "7d";
  const now = new Date();
  const toIsoValue = toIso(now);

  if (key === "24h") {
    return {
      key,
      label: "Last 24h",
      fromIso: toIso(startOfUtcHour(-23)),
      toIso: toIsoValue,
      bucket: "hour",
    };
  }

  if (key === "30d") {
    return {
      key,
      label: "Last 30d",
      fromIso: toIso(startOfUtcDay(-29)),
      toIso: toIsoValue,
      bucket: "day",
    };
  }

  if (key === "custom") {
    const fromInput = safeDate(Array.isArray(input?.from) ? input?.from[0] : input?.from);
    const toInput = safeDate(Array.isArray(input?.to) ? input?.to[0] : input?.to);
    const from = fromInput || startOfUtcDay(-6);
    const to = toInput || now;

    return {
      key,
      label: "Custom",
      fromIso: toIso(from <= to ? from : to),
      toIso: toIso(to >= from ? to : from),
      bucket: "day",
    };
  }

  return {
    key: "7d",
    label: "Last 7d",
    fromIso: toIso(startOfUtcDay(-6)),
    toIso: toIsoValue,
    bucket: "day",
  };
}

function normalizeSearchQuery(value: string) {
  return value
    .trim()
    .replace(/[^\w\s@.+:-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function combineMetricStatuses(...statuses: AdminMetricStatus[]): AdminMetricStatus {
  if (statuses.includes("ERROR")) {
    return "ERROR";
  }

  if (statuses.includes("NOT CONNECTED")) {
    return "NOT CONNECTED";
  }

  if (statuses.includes("LIVE")) {
    return "LIVE";
  }

  if (statuses.includes("ESTIMATED")) {
    return "ESTIMATED";
  }

  return "NO DATA";
}

function isFailedAiUsageStatus(value: unknown) {
  return readString(value).toLowerCase() === "failed";
}

async function fetchHealth(
  url: string,
  init: RequestInit,
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS
) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });

    return {
      ok: response.ok,
      status: response.status,
      responseTimeMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      responseTimeMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Provider request failed.",
    };
  } finally {
    clearTimeout(timer);
  }
}

function statusFromHealth(
  check: Awaited<ReturnType<typeof fetchHealth>>,
  options?: {
    allowStatuses?: number[];
    degradedStatuses?: number[];
    downStatuses?: number[];
  }
): AdminSystemStatus["status"] {
  if (check.ok || options?.allowStatuses?.includes(check.status)) {
    return check.responseTimeMs > HEALTH_DEGRADED_LATENCY_MS ? "Degraded" : "Healthy";
  }

  if (options?.degradedStatuses?.includes(check.status) || check.status === 429) {
    return "Degraded";
  }

  if (options?.downStatuses?.includes(check.status) || check.status === 401 || check.status === 403) {
    return "Down";
  }

  if (check.status === 0) {
    return "Degraded";
  }

  if (check.status >= 500) {
    return "Down";
  }

  return "Degraded";
}

function successfulCheckTime(status: AdminSystemStatus["status"], lastChecked: string) {
  return status === "Healthy" || status === "Degraded" ? lastChecked : null;
}

function buildMockAdminUsers(): AdminUserRow[] {
  const now = new Date();

  return [
    {
      id: "00000000-0000-4000-8000-000000000001",
      email: "founder@zerinix.local",
      displayName: "Local Founder",
      registeredAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
      lastSignInAt: new Date(now.getTime() - 40 * 60 * 1000).toISOString(),
      plan: "business",
      subscriptionStatus: "Active",
      accountStatus: "active",
      reportCount: 14,
      conversationCount: 28,
      aiRequestCount: 76,
      totalTokens: 184_200,
      failedRequestCount: 1,
      estimatedAiCostUsd: 18.42,
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      email: "operator@zerinix.local",
      displayName: "Local Operator",
      registeredAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      lastSignInAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      plan: "pro",
      subscriptionStatus: "Active",
      accountStatus: "active",
      reportCount: 7,
      conversationCount: 15,
      aiRequestCount: 39,
      totalTokens: 91_450,
      failedRequestCount: 0,
      estimatedAiCostUsd: 8.71,
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      email: "reviewer@zerinix.local",
      displayName: "Local Reviewer",
      registeredAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      lastSignInAt: "",
      plan: "free",
      subscriptionStatus: "Not configured",
      accountStatus: "active",
      reportCount: 2,
      conversationCount: 4,
      aiRequestCount: 9,
      totalTokens: 18_600,
      failedRequestCount: 1,
      estimatedAiCostUsd: 1.64,
    },
  ];
}

function buildMockSystemStatus(): AdminSystemStatus[] {
  const lastChecked = new Date().toISOString();

  return [
    {
      label: "ZERINIX API",
      status: "Unknown",
      detail: "Local admin mock data is active",
      lastChecked,
      lastSuccessfulCheck: null,
      responseTimeMs: null,
    },
    {
      label: "Supabase",
      status: "Not Connected",
      detail: "Admin database credential is missing in local development",
      lastChecked,
      lastSuccessfulCheck: null,
      responseTimeMs: null,
    },
    {
      label: "OpenAI",
      status: "Unknown",
      detail: "Not probed by local admin mock mode",
      lastChecked,
      lastSuccessfulCheck: null,
      responseTimeMs: null,
    },
    {
      label: "Stripe",
      status: "Not Connected",
      detail: "Billing remains disabled unless production credentials are configured",
      lastChecked,
      lastSuccessfulCheck: null,
      responseTimeMs: null,
    },
  ];
}

function buildMockAdminDashboardData(dateRange: AdminDateRange): AdminDashboardData {
  const recentUsers: AdminUserRow[] = [];
  const recentActivity: AdminActivityItem[] = [];
  const charts = {
    userGrowth: [],
    activeUsers: [],
    reportsGenerated: [],
    aiRequests: [],
    tokenUsage: [],
    estimatedAiCost: [],
    revenue: [],
  };
  const usageSummary = {
    totalRequests: 0,
    totalTokens: 0,
    cacheHits: 0,
    failedRequests: 0,
  };
  const recentErrors: Array<{ id: string; endpoint: string; status: string; createdAt: string }> = [];

  return {
    dateRange,
    totalUsers: 0,
    newUsers: 0,
    activeUsers: 0,
    reportsGenerated: 0,
    aiConversations: 0,
    workspaceCount: 0,
    subscriptions: 0,
    monthlyRecurringRevenue: null,
    aiApiCost: 0,
    sourceStatus: {
      revenue: "NOT CONNECTED",
      aiUsage: "NOT CONNECTED",
      users: "NOT CONNECTED",
      reports: "NOT CONNECTED",
      workspaces: "NOT CONNECTED",
      subscriptions: "NOT CONNECTED",
    },
    sourceDetails: {
      revenue: "Stripe billing sync is unavailable without SUPABASE_SERVICE_ROLE_KEY.",
      aiUsage: "AI usage records are unavailable without SUPABASE_SERVICE_ROLE_KEY.",
      users: "Supabase Auth users are unavailable without SUPABASE_SERVICE_ROLE_KEY.",
      reports: "Report records are unavailable without SUPABASE_SERVICE_ROLE_KEY.",
      workspaces: "Workspace records are unavailable without SUPABASE_SERVICE_ROLE_KEY.",
      subscriptions: "Billing profile records are unavailable without SUPABASE_SERVICE_ROLE_KEY.",
    },
    financials: {
      revenue: null,
      aiCost: 0,
      grossProfit: null,
      grossMargin: null,
      netProfit: null,
      averageCostPerUser: null,
      averageCostPerReport: null,
      dailyAiCost: null,
      weeklyAiCost: null,
      monthlyAiCost: null,
      allTimeAiCost: null,
    },
    openAiAnalytics: {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      cost: 0,
      costPerUser: null,
      costPerReport: null,
      costRanges: {
        today: null,
        thisMonth: null,
        last24h: null,
        last7d: null,
        last30d: null,
        allTime: null,
      },
      dailyCostHistory: [],
      featureCosts: [
        { feature: "AI Chat", costUsd: null, status: "NOT CONNECTED" },
        { feature: "Reports", costUsd: null, status: "NOT CONNECTED" },
        { feature: "AI CEO", costUsd: null, status: "NOT CONNECTED" },
        { feature: "Other AI features", costUsd: null, status: "NOT CONNECTED" },
      ],
      costAlerts: buildOpenAiCostAlerts(
        { today: null, thisMonth: null, last24h: null, last7d: null, last30d: null, allTime: null },
        0,
        []
      ),
      modelUsage: [],
      unknownModels: [],
    },
    userAnalytics: {
      freeUsers: 0,
      proUsers: 0,
      businessUsers: 0,
      growthRate: null,
      churnRate: null,
      averageUsage: null,
    },
    topReports: {
      mostExpensive: [],
      mostUsed: [],
      mostGenerated: [],
    },
    alerts: [
      {
        id: "local:service-role-missing",
        label: "Admin data source not connected",
        detail: "SUPABASE_SERVICE_ROLE_KEY is required for live admin metrics.",
        severity: "warning",
        createdAt: new Date().toISOString(),
      },
    ],
    userGrowth: [],
    reportTypeDistribution: [],
    planDistribution: [],
    recentUsers,
    recentActivity,
    charts,
    revenueOverview: buildRevenueOverview(),
    costControl: {
      totalTokensToday: 0,
      totalTokensThisMonth: 0,
      estimatedCostToday: null,
      estimatedCostThisMonth: null,
      remainingDailyBudget: null,
      remainingWeeklyBudget: null,
      remainingMonthlyBudget: null,
      remainingPerUserBudget: null,
      averageCostPerConversation: null,
      averageCostPerReport: null,
      failedAiRequests: 0,
      costTrendPercent: null,
      highestUsageUsers: [],
      highestCostRoutes: [],
      dateRanges: ["24 hours", "7 days", "30 days", "Custom range"],
    },
    usageSummary,
    recentErrors,
    systemStatus: buildMockSystemStatus(),
    exportTables: buildExportTables({
      recentUsers,
      recentActivity,
      recentErrors,
      usageSummary,
      charts,
    }),
    notifications: {
      generatedAt: new Date().toISOString(),
      newUsers: [],
      reports: [],
      failedJobs: [],
    },
  };
}

function hasAdminClaim(user: User) {
  const role = readString(user.app_metadata?.role).toLowerCase();
  const roles = Array.isArray(user.app_metadata?.roles)
    ? user.app_metadata.roles
    : [];

  return (
    ADMIN_CLAIMS.has(role) ||
    roles.some((item) => ADMIN_CLAIMS.has(readString(item).toLowerCase()))
  );
}

async function loadAdminRole(user: User) {
  if (hasAdminClaim(user)) {
    return readString(user.app_metadata?.role, "admin");
  }

  if (isLocalAdminMockMode()) {
    return "admin";
  }

  const serviceClient = createServiceRoleClient();
  const { data, error } = await serviceClient
    .from("admin_roles")
    .select("role,active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) {
    return "";
  }

  const role = readString(data.role).toLowerCase();

  return ADMIN_CLAIMS.has(role) ? role : "";
}

export async function getAdminContext(): Promise<AdminUserContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const role = await loadAdminRole(user);

  return role ? { user, role } : null;
}

export async function requireAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const role = await loadAdminRole(user);

  if (!role) {
    redirect("/dashboard");
  }

  return { user, role };
}

export async function requireAdminApi() {
  const context = await getAdminContext();

  if (!context) {
    return {
      ok: false as const,
      response: Response.json({ error: "Admin access required." }, { status: 403 }),
    };
  }

  return { ok: true as const, context };
}

function buildCountMap<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
  valueKey?: keyof T
) {
  const map = new Map<string, number>();

  rows.forEach((row) => {
    const id = readString(row[key]);

    if (!id) {
      return;
    }

    map.set(id, (map.get(id) || 0) + (valueKey ? readNumber(row[valueKey]) : 1));
  });

  return map;
}

async function listAuthUsers(page: number, perPage: number) {
  const serviceClient = createServiceRoleClient();
  const { data, error } = await serviceClient.auth.admin.listUsers({
    page,
    perPage,
  });

  if (error) {
    throw error;
  }

  return data;
}

async function listAuthUsersForAdminScan() {
  const firstPage = await listAuthUsers(1, ADMIN_AUTH_SCAN_PAGE_SIZE);
  const users = [...firstPage.users];
  const total = firstPage.total;
  const pagesToRead = Math.min(
    Math.ceil(total / ADMIN_AUTH_SCAN_PAGE_SIZE),
    Math.ceil(ADMIN_AUTH_SCAN_MAX_USERS / ADMIN_AUTH_SCAN_PAGE_SIZE)
  );

  for (let page = 2; page <= pagesToRead; page += 1) {
    const pageData = await listAuthUsers(page, ADMIN_AUTH_SCAN_PAGE_SIZE);
    users.push(...pageData.users);
  }

  return {
    users: users.slice(0, ADMIN_AUTH_SCAN_MAX_USERS),
    total,
    scanned: Math.min(users.length, ADMIN_AUTH_SCAN_MAX_USERS),
  };
}

async function loadUserAggregates(userIds: string[]) {
  const serviceClient = createServiceRoleClient();
  const [billing, statuses, reports, conversations, usage] = await Promise.all([
    serviceClient
      .from("user_billing_profiles")
      .select("user_id,plan_tier")
      .in("user_id", userIds),
    serviceClient
      .from("user_account_statuses")
      .select("user_id,status")
      .in("user_id", userIds),
    serviceClient.from("reports").select("user_id").in("user_id", userIds),
    serviceClient.from("ai_conversations").select("user_id").in("user_id", userIds),
    serviceClient
      .from("ai_usage_events")
      .select("user_id,status,total_tokens,estimated_cost_usd")
      .in("user_id", userIds),
  ]);

  const planMap = new Map(
    (billing.data || []).map((row) => [row.user_id as string, normalizePlan(row.plan_tier)])
  );
  const statusMap = new Map(
    (statuses.data || []).map((row) => [
      row.user_id as string,
      readString(row.status, "active"),
    ])
  );

  const requestCountMap = new Map<string, number>();
  const tokenMap = new Map<string, number>();
  const failedRequestMap = new Map<string, number>();
  const costMap = new Map<string, number>();

  (usage.data || []).forEach((row) => {
    const userId = readString(row.user_id);

    if (!userId) {
      return;
    }

    requestCountMap.set(userId, (requestCountMap.get(userId) || 0) + 1);
    tokenMap.set(userId, (tokenMap.get(userId) || 0) + readNumber(row.total_tokens));
    costMap.set(userId, (costMap.get(userId) || 0) + readNumber(row.estimated_cost_usd));

    if (isFailedAiUsageStatus(row.status)) {
      failedRequestMap.set(userId, (failedRequestMap.get(userId) || 0) + 1);
    }
  });

  return {
    planMap,
    statusMap,
    reportCountMap: buildCountMap(reports.data || [], "user_id"),
    conversationCountMap: buildCountMap(conversations.data || [], "user_id"),
    requestCountMap,
    tokenMap,
    failedRequestMap,
    costMap,
  };
}

function toAdminUserRow(
  user: User,
  aggregates: Awaited<ReturnType<typeof loadUserAggregates>>
): AdminUserRow {
  const displayName = readString(user.user_metadata?.full_name);
  const plan = aggregates.planMap.get(user.id) || "free";

  return {
    id: user.id,
    email: user.email || "No email",
    displayName,
    registeredAt: user.created_at || "",
    lastSignInAt: user.last_sign_in_at || "",
    plan,
    subscriptionStatus: plan === "free" ? "Not configured" : "Active",
    accountStatus: aggregates.statusMap.get(user.id) || "active",
    reportCount: aggregates.reportCountMap.get(user.id) || 0,
    conversationCount: aggregates.conversationCountMap.get(user.id) || 0,
    aiRequestCount: aggregates.requestCountMap.get(user.id) || 0,
    totalTokens: aggregates.tokenMap.get(user.id) || 0,
    failedRequestCount: aggregates.failedRequestMap.get(user.id) || 0,
    estimatedAiCostUsd: aggregates.costMap.get(user.id) || 0,
  };
}

export async function loadAdminUsers(input: {
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  if (isLocalAdminMockMode()) {
    const page = Math.max(1, input.page || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, input.pageSize || PAGE_SIZE_DEFAULT));
    const search = readString(input.search).toLowerCase();
    const sourceUsers = buildMockAdminUsers().filter((user) => {
      if (!search) {
        return true;
      }

      return (
        user.email.toLowerCase().includes(search) ||
        user.displayName.toLowerCase().includes(search)
      );
    });
    const users = sourceUsers.slice((page - 1) * pageSize, page * pageSize);

    return {
      users,
      page,
      pageSize,
      totalUsers: sourceUsers.length,
      totalPages: Math.max(1, Math.ceil(sourceUsers.length / pageSize)),
      search,
    };
  }

  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, input.pageSize || PAGE_SIZE_DEFAULT));
  const search = readString(input.search).toLowerCase();
  const authData = await listAuthUsers(search ? 1 : page, search ? 1000 : pageSize);
  const sourceUsers = search
    ? authData.users.filter((user) => {
        const email = (user.email || "").toLowerCase();
        const name = readString(user.user_metadata?.full_name).toLowerCase();

        return email.includes(search) || name.includes(search);
      })
    : authData.users;
  const pagedUsers = search ? sourceUsers.slice((page - 1) * pageSize, page * pageSize) : sourceUsers;
  const userIds = pagedUsers.map((user) => user.id);
  const aggregates = userIds.length
    ? await loadUserAggregates(userIds)
    : {
        planMap: new Map<string, string>(),
        statusMap: new Map<string, string>(),
        reportCountMap: new Map<string, number>(),
        conversationCountMap: new Map<string, number>(),
        requestCountMap: new Map<string, number>(),
        tokenMap: new Map<string, number>(),
        failedRequestMap: new Map<string, number>(),
        costMap: new Map<string, number>(),
      };

  return {
    users: pagedUsers.map((user) => toAdminUserRow(user, aggregates)),
    page,
    pageSize,
    totalUsers: search ? sourceUsers.length : authData.total,
    totalPages: Math.max(1, Math.ceil((search ? sourceUsers.length : authData.total) / pageSize)),
    search,
  };
}

export async function loadAdminUserDetail(userId: string) {
  if (isLocalAdminMockMode()) {
    const user = buildMockAdminUsers().find((item) => item.id === userId);

    if (!user) {
      return null;
    }

    return {
      user,
      reports: [
        {
          id: "mock-report-1",
          title: "Local investor report validation",
          report_type: "Business Plan",
          status: "complete",
          created_at: new Date().toISOString(),
        },
      ],
      conversations: [
        {
          id: "mock-conversation-1",
          title: "Local admin workspace test",
          mode: "chat",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      usage: [
        {
          id: "mock-usage-1",
          endpoint: "/api/chat",
          model: "mock",
          status: "complete",
          total_tokens: user.totalTokens,
          estimated_cost_usd: user.estimatedAiCostUsd,
          cache_hit: false,
          created_at: new Date().toISOString(),
        },
      ],
      auditLog: [],
    };
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return null;
  }

  const serviceClient = createServiceRoleClient();
  const { data, error } = await serviceClient.auth.admin.getUserById(userId);

  if (error || !data.user) {
    return null;
  }

  const aggregates = await loadUserAggregates([userId]);
  const [reports, conversations, usage, audit] = await Promise.all([
    serviceClient
      .from("reports")
      .select("id,title,report_type,status,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
    serviceClient
      .from("ai_conversations")
      .select("id,title,mode,created_at,updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(10),
    serviceClient
      .from("ai_usage_events")
      .select("id,endpoint,model,status,total_tokens,estimated_cost_usd,cache_hit,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    serviceClient
      .from("admin_audit_log")
      .select("id,action,metadata,created_at")
      .eq("target_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return {
    user: toAdminUserRow(data.user, aggregates),
    reports: reports.data || [],
    conversations: conversations.data || [],
    usage: usage.data || [],
    auditLog: audit.data || [],
  };
}

async function countTableDetailed(table: string, range?: AdminDateRange) {
  const serviceClient = createServiceRoleClient();
  let query = serviceClient
    .from(table)
    .select("id", { count: "exact", head: true });

  if (range) {
    query = query.gte("created_at", range.fromIso).lte("created_at", range.toIso);
  }

  const { count, error } = await query;

  if (error) {
    console.error("[admin:data] table count failed", {
      table,
      message: error.message,
      code: error.code,
    });

    return {
      count: 0,
      status: "ERROR" as AdminMetricStatus,
      detail: `${table} could not be queried.`,
    };
  }

  const resolvedCount = count || 0;

  return {
    count: resolvedCount,
    status: resolvedCount > 0 ? "LIVE" as AdminMetricStatus : "NO DATA" as AdminMetricStatus,
    detail: resolvedCount > 0
      ? `Read from ${table}.`
      : `${table} query succeeded, but no records exist in the selected range.`,
  };
}

async function loadRecentUsage(range: AdminDateRange) {
  const serviceClient = createServiceRoleClient();
  const { data, count, error } = await serviceClient
    .from("ai_usage_events")
    .select(
      "id,user_id,endpoint,report_field,report_id,conversation_id,report_request_id,model,status,prompt_tokens,completion_tokens,total_tokens,estimated_cost_usd,cache_hit,metadata,created_at",
      { count: "exact" }
    )
    .gte("created_at", range.fromIso)
    .lte("created_at", range.toIso)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    console.error("[admin:data] ai usage query failed", {
      message: error.message,
      code: error.code,
    });

    return {
      rows: [] as Array<Record<string, unknown>>,
      totalRequests: 0,
      status: "ERROR" as AdminMetricStatus,
      detail: "ai_usage_events could not be queried.",
    };
  }

  return {
    rows: data || [],
    totalRequests: count || (data || []).length,
    status: (count || (data || []).length) > 0 ? "LIVE" as AdminMetricStatus : "NO DATA" as AdminMetricStatus,
    detail: (count || (data || []).length) > 0
      ? "Read from ai_usage_events for the selected date range."
      : "ai_usage_events query succeeded, but no records exist in the selected date range.",
  };
}

async function loadAllAccountStatuses() {
  const serviceClient = createServiceRoleClient();
  const { data } = await serviceClient.from("user_account_statuses").select("user_id,status");

  return new Map(
    (data || []).map((row) => [
      readString(row.user_id),
      readString(row.status, "active").toLowerCase(),
    ])
  );
}

async function loadReportDistribution(range?: AdminDateRange) {
  const serviceClient = createServiceRoleClient();
  let query = serviceClient.from("reports").select("report_type");

  if (range) {
    query = query.gte("created_at", range.fromIso).lte("created_at", range.toIso);
  }

  const { data } = await query;
  const map = new Map<string, number>();

  (data || []).forEach((row) => {
    const label = readString(row.report_type, "Business Plan");
    map.set(label, (map.get(label) || 0) + 1);
  });

  return [...map.entries()].map(([label, value]) => ({ label, value }));
}

async function loadReportStatusSummary(range: AdminDateRange) {
  const serviceClient = createServiceRoleClient();
  const { data, error } = await serviceClient
    .from("reports")
    .select("status")
    .gte("created_at", range.fromIso)
    .lte("created_at", range.toIso)
    .limit(5000);

  if (error) {
    console.error("[admin:data] report status summary query failed", {
      message: error.message,
      code: error.code,
    });

    return {
      completed: 0,
      failed: 0,
      detail: "Report status counts could not be queried.",
      status: "ERROR" as AdminMetricStatus,
    };
  }

  const rows = data || [];
  const completed = rows.filter((row) => ["complete", "completed"].includes(readString(row.status).toLowerCase())).length;
  const failed = rows.filter((row) => readString(row.status).toLowerCase() === "failed").length;

  return {
    completed,
    failed,
    detail: rows.length
      ? `${completed} completed, ${failed} failed reports in the selected range.`
      : "No report status records exist in the selected range.",
    status: rows.length ? "LIVE" as AdminMetricStatus : "NO DATA" as AdminMetricStatus,
  };
}

async function loadBillingSummary() {
  const serviceClient = createServiceRoleClient();
  const { data, error } = await serviceClient
    .from("user_billing_profiles")
    .select("plan_tier");
  const map = new Map<string, number>();

  if (error) {
    console.error("[admin:data] billing summary query failed", {
      message: error.message,
      code: error.code,
    });

    return {
      planDistribution: [] as Array<{ label: string; value: number }>,
      activePaidSubscriptions: 0,
      status: "ERROR" as AdminMetricStatus,
      detail: "Billing profiles could not be queried.",
    };
  }

  (data || []).forEach((row) => {
    const label = normalizePlan(row.plan_tier);

    map.set(label, (map.get(label) || 0) + 1);
  });

  return {
    planDistribution: [...map.entries()].map(([label, value]) => ({ label, value })),
    activePaidSubscriptions: 0,
    status: (data || []).length ? ("LIVE" as const) : ("NO DATA" as const),
    detail: (data || []).length
      ? "Read from user_billing_profiles."
      : "No billing profile records exist yet.",
  };
}

async function loadUserGrowth() {
  const authData = await listAuthUsersForAdminScan();
  const map = new Map<string, number>();

  authData.users.forEach((user) => {
    const createdAt = user.created_at;

    if (!createdAt) {
      return;
    }

    const label = formatMonthLabel(createdAt);
    map.set(label, (map.get(label) || 0) + 1);
  });

  return [...map.entries()].slice(-6).map(([label, value]) => ({ label, value }));
}

function buildTimeSeries<T extends object>(
  rows: T[],
  range: AdminDateRange,
  dateKey: keyof T,
  valueKey?: keyof T
): AdminChartSeries[] {
  const from = new Date(range.fromIso);
  const to = new Date(range.toIso);
  const bucketMs = range.bucket === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const bucketCount = Math.min(60, Math.max(1, Math.floor((to.getTime() - from.getTime()) / bucketMs) + 1));
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const date = new Date(from.getTime() + index * bucketMs);
    const normalized = range.bucket === "hour"
      ? new Date(Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          date.getUTCHours()
        ))
      : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

    return {
      date: normalized,
      key: range.bucket === "hour"
        ? normalized.toISOString().slice(0, 13)
        : normalized.toISOString().slice(0, 10),
      label: range.bucket === "hour"
        ? formatHourLabel(normalized.toISOString())
        : formatDayLabel(normalized.toISOString()),
      value: 0,
    };
  });
  const map = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  rows.forEach((row) => {
    const value = readString(row[dateKey]);

    if (!value) {
      return;
    }

    const date = new Date(value);
    const key = range.bucket === "hour"
      ? date.toISOString().slice(0, 13)
      : date.toISOString().slice(0, 10);
    const bucket = map.get(key);

    if (!bucket) {
      return;
    }

    bucket.value += valueKey ? readNumber(row[valueKey]) : 1;
  });

  return buckets.map(({ label, value }) => ({ label, value }));
}

async function fetchOpenAiOrganizationData(
  endpoint: string,
  key: string,
  params: Record<string, string | number>
) {
  const allBuckets: Array<Record<string, unknown>> = [];
  let page: string | null = null;

  for (let index = 0; index < 20; index += 1) {
    const url = new URL(endpoint);

    Object.entries(params).forEach(([paramKey, value]) => {
      url.searchParams.set(paramKey, String(value));
    });

    if (page) {
      url.searchParams.set("page", page);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI organization API returned ${response.status}: ${body.slice(0, 240)}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const buckets = Array.isArray(payload.data) ? payload.data : [];

    allBuckets.push(...(buckets as Array<Record<string, unknown>>));

    const nextPage = readString(payload.next_page);
    const hasMore = Boolean(payload.has_more);

    if (!hasMore || !nextPage) {
      break;
    }

    page = nextPage;
  }

  return allBuckets;
}

function extractOpenAiCostFromResult(result: Record<string, unknown>) {
  return (
    readNestedNumber(result, ["amount", "value"]) ||
    readNestedNumber(result, ["amount", "usd"]) ||
    readNumber(result.amount) ||
    readNumber(result.cost) ||
    readNumber(result.cost_usd)
  );
}

function sumOpenAiCostBuckets(buckets: Array<Record<string, unknown>>) {
  return buckets.reduce((sum, bucket) => {
    const results = Array.isArray(bucket.results) ? bucket.results : [];
    const bucketCost = results.reduce((resultSum, result) => {
      if (!result || typeof result !== "object") {
        return resultSum;
      }

      return resultSum + extractOpenAiCostFromResult(result as Record<string, unknown>);
    }, 0);

    return sum + bucketCost;
  }, 0);
}

function buildOpenAiDailyCostHistory(buckets: Array<Record<string, unknown>>) {
  return buckets.map((bucket) => {
    const startTime = readNumber(bucket.start_time);
    const label = startTime
      ? formatDayLabel(new Date(startTime * 1000).toISOString())
      : "Day";

    return {
      label,
      value: roundUsd(sumOpenAiCostBuckets([bucket])),
    };
  });
}

function buildOpenAiModelCostMap(buckets: Array<Record<string, unknown>>) {
  const map = new Map<string, number>();

  buckets.forEach((bucket) => {
    const results = Array.isArray(bucket.results) ? bucket.results : [];

    results.forEach((result) => {
      if (!result || typeof result !== "object") {
        return;
      }

      const row = result as Record<string, unknown>;
      const model = readString(row.model);

      if (!model) {
        return;
      }

      map.set(model, (map.get(model) || 0) + extractOpenAiCostFromResult(row));
    });
  });

  return map;
}

function parseOpenAiUsageBuckets(
  buckets: Array<Record<string, unknown>>,
  officialCostUsd: number,
  officialModelCosts: Map<string, number>
) {
  const modelMap = new Map<string, OpenAiModelUsageSummary>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let totalTokens = 0;

  buckets.forEach((bucket) => {
    const results = Array.isArray(bucket.results) ? bucket.results : [];

    results.forEach((result) => {
      if (!result || typeof result !== "object") {
        return;
      }

      const row = result as Record<string, unknown>;
      const model = readString(row.model, "unknown");
      const rowInputTokens = readNumber(row.input_tokens);
      const rowOutputTokens = readNumber(row.output_tokens);
      const rowCachedTokens = readNumber(row.input_cached_tokens);
      const rowTokens = rowInputTokens + rowOutputTokens;
      const summary = modelMap.get(model) || {
        model,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        tokens: 0,
        costUsd: 0,
        status: "LIVE" as const,
      };

      summary.requests += readNumber(row.num_model_requests) || 1;
      summary.inputTokens += rowInputTokens;
      summary.outputTokens += rowOutputTokens;
      summary.cachedTokens += rowCachedTokens;
      summary.tokens += rowTokens;

      inputTokens += rowInputTokens;
      outputTokens += rowOutputTokens;
      cachedTokens += rowCachedTokens;
      totalTokens += rowTokens;
      modelMap.set(model, summary);
    });
  });

  const hasOfficialModelCosts = officialModelCosts.size > 0;
  const modelUsage = [...modelMap.values()].map((model) => {
    const groupedCost = officialModelCosts.get(model.model);

    return {
      ...model,
      costUsd:
        typeof groupedCost === "number"
          ? roundUsd(groupedCost)
          : totalTokens > 0
            ? roundUsd((officialCostUsd * model.tokens) / totalTokens)
            : 0,
      status: hasOfficialModelCosts ? "LIVE" as const : "ESTIMATED" as const,
    };
  });

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens,
    modelUsage: modelUsage.sort((a, b) => b.costUsd - a.costUsd),
  };
}

function mapAiFeature(value: unknown): OpenAiCostCenterData["featureCosts"][number]["feature"] {
  const text = readString(value).toLowerCase();

  if (text.includes("chat")) {
    return "AI Chat";
  }

  if (text.includes("plan") || text.includes("market") || text.includes("report")) {
    return "Reports";
  }

  if (text.includes("ceo")) {
    return "AI CEO";
  }

  return "Other AI features";
}

function readUsageMetadata(row: Record<string, unknown>) {
  return row.metadata && typeof row.metadata === "object"
    ? row.metadata as Record<string, unknown>
    : {};
}

function readUsageReportId(row: Record<string, unknown>) {
  const metadata = readUsageMetadata(row);

  return (
    readString(row.report_id) ||
    readString(metadata.report_id) ||
    readString(metadata.reportId) ||
    readString(metadata.saved_report_id) ||
    readString(metadata.savedReportId) ||
    readString(metadata.report_uuid) ||
    readString(metadata.reportUuid)
  );
}

function buildOpenAiFeatureCosts(
  usage: Array<Record<string, unknown>>,
  officialCostUsd: number,
  status: AdminMetricStatus
): OpenAiCostCenterData["featureCosts"] {
  const features: OpenAiCostCenterData["featureCosts"] = [
    { feature: "AI Chat", costUsd: null, status: "NO DATA" },
    { feature: "Reports", costUsd: null, status: "NO DATA" },
    { feature: "AI CEO", costUsd: null, status: "NO DATA" },
    { feature: "Other AI features", costUsd: null, status: "NO DATA" },
  ];

  if (status !== "LIVE" || officialCostUsd <= 0 || !usage.length) {
    return features;
  }

  const localCostTotal = usage.reduce((sum, row) => sum + readNumber(row.estimated_cost_usd), 0);

  if (localCostTotal <= 0) {
    return features;
  }

  const featureTotals = new Map<string, number>();

  usage.forEach((row) => {
    const feature = mapAiFeature(readString(row.endpoint) || readString(row.report_field));
    const weight = readNumber(row.estimated_cost_usd);

    featureTotals.set(feature, (featureTotals.get(feature) || 0) + weight);
  });

  const denominator = [...featureTotals.values()].reduce((sum, value) => sum + value, 0);

  return features.map((item) => {
    const value = featureTotals.get(item.feature) || 0;

    return {
      ...item,
      costUsd: denominator > 0 ? roundUsd((officialCostUsd * value) / denominator) : null,
      status: value > 0 ? "ESTIMATED" : "NO DATA",
    };
  });
}

function readCostLimitEnv(name: string) {
  const value = readNumber(process.env[name]);

  return value > 0 ? value : null;
}

function buildOpenAiCostAlerts(
  ranges: OpenAiCostCenterData["costRanges"],
  totalUsers: number,
  usage: Array<Record<string, unknown>>
): OpenAiCostCenterData["costAlerts"] {
  const dailyThreshold = readCostLimitEnv("OPENAI_DAILY_COST_LIMIT_USD");
  const weeklyThreshold = readCostLimitEnv("OPENAI_WEEKLY_COST_LIMIT_USD");
  const monthlyThreshold = readCostLimitEnv("OPENAI_MONTHLY_COST_LIMIT_USD");
  const perUserThreshold = readCostLimitEnv("OPENAI_COST_LIMIT_PER_USER_USD");
  const userCostMap = new Map<string, number>();

  usage.forEach((row) => {
    const userId = readString(row.user_id, "unknown");
    userCostMap.set(userId, (userCostMap.get(userId) || 0) + readNumber(row.estimated_cost_usd));
  });

  const maxUserCost = [...userCostMap.values()].sort((a, b) => b - a)[0] ?? null;

  return [
    {
      id: "openai-cost-daily",
      label: "Daily limit",
      thresholdUsd: dailyThreshold,
      currentUsd: ranges.today,
      remainingUsd:
        dailyThreshold !== null && ranges.today !== null
          ? roundUsd(Math.max(0, dailyThreshold - ranges.today))
          : null,
      status: dailyThreshold ? "configured" as const : "not_configured" as const,
    },
    {
      id: "openai-cost-weekly",
      label: "Weekly limit",
      thresholdUsd: weeklyThreshold,
      currentUsd: ranges.last7d,
      remainingUsd:
        weeklyThreshold !== null && ranges.last7d !== null
          ? roundUsd(Math.max(0, weeklyThreshold - ranges.last7d))
          : null,
      status: weeklyThreshold ? "configured" as const : "not_configured" as const,
    },
    {
      id: "openai-cost-monthly",
      label: "Monthly limit",
      thresholdUsd: monthlyThreshold,
      currentUsd: ranges.thisMonth,
      remainingUsd:
        monthlyThreshold !== null && ranges.thisMonth !== null
          ? roundUsd(Math.max(0, monthlyThreshold - ranges.thisMonth))
          : null,
      status: monthlyThreshold ? "configured" as const : "not_configured" as const,
    },
    {
      id: "openai-cost-user",
      label: "Per-user cost threshold",
      thresholdUsd: perUserThreshold,
      currentUsd: totalUsers > 0 ? maxUserCost : null,
      remainingUsd:
        perUserThreshold !== null && maxUserCost !== null
          ? roundUsd(Math.max(0, perUserThreshold - maxUserCost))
          : null,
      status: perUserThreshold ? "configured" as const : "not_configured" as const,
    },
  ];
}

function disconnectedOpenAiCostCenter(detail: string): OpenAiCostCenterData {
  const emptyRanges = {
    today: null,
    thisMonth: null,
    last24h: null,
    last7d: null,
    last30d: null,
    allTime: null,
  };

  return {
    status: "NOT CONNECTED",
    detail,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    modelUsage: [],
    dailyCostHistory: [],
    costRanges: emptyRanges,
    featureCosts: [
      { feature: "AI Chat", costUsd: null, status: "NOT CONNECTED" },
      { feature: "Reports", costUsd: null, status: "NOT CONNECTED" },
      { feature: "AI CEO", costUsd: null, status: "NOT CONNECTED" },
      { feature: "Other AI features", costUsd: null, status: "NOT CONNECTED" },
    ],
    costAlerts: buildOpenAiCostAlerts(emptyRanges, 0, []),
  };
}

async function loadOpenAiCostCenter(input: {
  range: AdminDateRange;
  usage: Array<Record<string, unknown>>;
  totalUsers: number;
}): Promise<OpenAiCostCenterData> {
  const key = getOpenAiCostCenterKey();

  if (!key) {
    return disconnectedOpenAiCostCenter("OpenAI organization usage is not connected. Configure OPENAI_ADMIN_API_KEY or the active OpenAI API key.");
  }

  const now = new Date();
  const selectedStart = new Date(input.range.fromIso);

  try {
    const [selectedUsage, selectedCosts, costsToday, costsThisMonth, costs24h, costs7d, costs30d, costsAllTime] =
      await Promise.all([
        fetchOpenAiOrganizationData(OPENAI_ORGANIZATION_USAGE_URL, key, {
          start_time: unixSeconds(selectedStart),
          end_time: unixSeconds(new Date(input.range.toIso)),
          bucket_width: input.range.bucket === "hour" ? "1h" : "1d",
          group_by: "model",
          limit: 180,
        }),
        fetchOpenAiOrganizationData(OPENAI_ORGANIZATION_COSTS_URL, key, {
          start_time: unixSeconds(selectedStart),
          end_time: unixSeconds(new Date(input.range.toIso)),
          bucket_width: "1d",
          group_by: "model",
          limit: 180,
        }),
        fetchOpenAiOrganizationData(OPENAI_ORGANIZATION_COSTS_URL, key, {
          start_time: unixSeconds(startOfUtcDay()),
          end_time: unixSeconds(now),
          bucket_width: "1d",
          limit: 7,
        }),
        fetchOpenAiOrganizationData(OPENAI_ORGANIZATION_COSTS_URL, key, {
          start_time: unixSeconds(startOfUtcMonth()),
          end_time: unixSeconds(now),
          bucket_width: "1d",
          limit: 45,
        }),
        fetchOpenAiOrganizationData(OPENAI_ORGANIZATION_COSTS_URL, key, {
          start_time: unixSeconds(startOfUtcHour(-23)),
          end_time: unixSeconds(now),
          bucket_width: "1d",
          limit: 7,
        }),
        fetchOpenAiOrganizationData(OPENAI_ORGANIZATION_COSTS_URL, key, {
          start_time: unixSeconds(startOfUtcDay(-6)),
          end_time: unixSeconds(now),
          bucket_width: "1d",
          limit: 14,
        }),
        fetchOpenAiOrganizationData(OPENAI_ORGANIZATION_COSTS_URL, key, {
          start_time: unixSeconds(startOfUtcDay(-29)),
          end_time: unixSeconds(now),
          bucket_width: "1d",
          limit: 45,
        }),
        fetchOpenAiOrganizationData(OPENAI_ORGANIZATION_COSTS_URL, key, {
          start_time: unixSeconds(OPENAI_COST_CENTER_START),
          end_time: unixSeconds(now),
          bucket_width: "1d",
          limit: 1800,
        }),
      ]);
    const selectedCost = roundUsd(sumOpenAiCostBuckets(selectedCosts));
    const parsedUsage = parseOpenAiUsageBuckets(
      selectedUsage,
      selectedCost,
      buildOpenAiModelCostMap(selectedCosts)
    );
    const costRanges = {
      today: roundUsd(sumOpenAiCostBuckets(costsToday)),
      thisMonth: roundUsd(sumOpenAiCostBuckets(costsThisMonth)),
      last24h: roundUsd(sumOpenAiCostBuckets(costs24h)),
      last7d: roundUsd(sumOpenAiCostBuckets(costs7d)),
      last30d: roundUsd(sumOpenAiCostBuckets(costs30d)),
      allTime: roundUsd(sumOpenAiCostBuckets(costsAllTime)),
    };

    return {
      status: "LIVE",
      detail: "Read from OpenAI organization Usage and Costs APIs.",
      inputTokens: parsedUsage.inputTokens,
      outputTokens: parsedUsage.outputTokens,
      cachedTokens: parsedUsage.cachedTokens,
      totalTokens: parsedUsage.totalTokens,
      costUsd: selectedCost,
      modelUsage: parsedUsage.modelUsage,
      dailyCostHistory: buildOpenAiDailyCostHistory(selectedCosts),
      costRanges,
      featureCosts: buildOpenAiFeatureCosts(input.usage, selectedCost, "LIVE"),
      costAlerts: buildOpenAiCostAlerts(costRanges, input.totalUsers, input.usage),
    };
  } catch (error) {
    console.error("[admin:openai-cost-center] official usage/cost fetch failed", {
      message: error instanceof Error ? error.message : String(error),
    });

    return disconnectedOpenAiCostCenter("OpenAI organization Usage or Costs API is unavailable for the configured key.");
  }
}

async function loadAdminChartData(authUsers: User[], range: AdminDateRange) {
  const serviceClient = createServiceRoleClient();
  const [reports, usage, revenue] = await Promise.all([
    serviceClient
      .from("reports")
      .select("created_at")
      .gte("created_at", range.fromIso)
      .lte("created_at", range.toIso)
      .order("created_at", { ascending: true })
      .limit(5000),
    serviceClient
      .from("ai_usage_events")
      .select("created_at,total_tokens,estimated_cost_usd")
      .gte("created_at", range.fromIso)
      .lte("created_at", range.toIso)
      .order("created_at", { ascending: true })
      .limit(5000),
    serviceClient
      .from("stripe_invoices")
      .select("created_at,total_cents,status")
      .gte("created_at", range.fromIso)
      .lte("created_at", range.toIso)
      .order("created_at", { ascending: true })
      .limit(5000),
  ]);
  const usersInRange = authUsers.filter((user) => isWithinRange(user.created_at || "", range));
  const activeUsersInRange = authUsers.filter((user) => isWithinRange(user.last_sign_in_at || "", range));
  const paidRevenueRows = (revenue.data || [])
    .filter((row) => ["paid", "succeeded", "complete"].includes(readString(row.status).toLowerCase()))
    .map((row) => ({
      created_at: readString(row.created_at),
      revenue_usd: readNumber(row.total_cents) / 100,
    }));

  return {
    userGrowth: buildTimeSeries(usersInRange, range, "created_at"),
    activeUsers: buildTimeSeries(activeUsersInRange, range, "last_sign_in_at"),
    reportsGenerated: buildTimeSeries(reports.data || [], range, "created_at"),
    aiRequests: buildTimeSeries(usage.data || [], range, "created_at"),
    tokenUsage: buildTimeSeries(usage.data || [], range, "created_at", "total_tokens"),
    estimatedAiCost: buildTimeSeries(usage.data || [], range, "created_at", "estimated_cost_usd"),
    revenue: buildTimeSeries(paidRevenueRows, range, "created_at", "revenue_usd"),
  };
}

async function loadRevenueSummary(range: AdminDateRange) {
  const stripe = getStripeConfiguration();
  if (!stripe.configured || !stripe.enabled) {
    const missing = stripe.enabled
      ? stripe.missing.join(", ")
      : "ENABLE_STRIPE_BILLING";

    return {
      value: null,
      status: "NOT CONNECTED" as AdminMetricStatus,
      detail: `Stripe is not connected. Missing or disabled: ${missing || "Stripe billing"}.`,
    };
  }

  const serviceClient = createServiceRoleClient();
  const { data, error } = await serviceClient
    .from("stripe_invoices")
    .select("created_at,total_cents,status,currency")
    .gte("created_at", range.fromIso)
    .lte("created_at", range.toIso)
    .order("created_at", { ascending: true })
    .limit(5000);

  if (error) {
    console.error("[admin:data] revenue query failed", {
      message: error.message,
      code: error.code,
    });

    return {
      value: null,
      status: "ERROR" as AdminMetricStatus,
      detail: "stripe_invoices could not be queried.",
    };
  }

  const paidRows = (data || []).filter((row) =>
    ["paid", "succeeded", "complete"].includes(readString(row.status).toLowerCase())
  );
  const value = paidRows.reduce((sum, row) => sum + readNumber(row.total_cents) / 100, 0);

  return {
    value: value > 0 ? value : null,
    status: paidRows.length ? ("LIVE" as const) : ("NO DATA" as const),
    detail: paidRows.length
      ? "Read from paid Stripe invoice sync records."
      : "Stripe is configured, but no paid invoices exist in the selected range.",
  };
}

function buildRevenueOverview() {
  const stripe = getStripeConfiguration();
  const configured = stripe.configured && stripe.enabled;
  const notConfigured = configured ? "No data available" : "Not configured";
  const detail = configured
    ? "Billing sync tables are ready for production Stripe data."
    : "Stripe production billing is not configured.";

  return [
    "Revenue this month",
    "MRR",
    "Active subscriptions",
    "Trial users",
    "Paid conversion rate",
    "Failed payments",
    "Refunds",
    "Churn rate",
  ].map((label) => ({ label, value: notConfigured, detail }));
}

function calculateCostControl(input: {
  usage: Array<Record<string, unknown>>;
  official?: OpenAiCostCenterData;
}): AdminCostControlData {
  const today = startOfUtcDay();
  const month = startOfUtcMonth();
  const previousStart = startOfUtcDay(-60);
  const currentStart = startOfUtcDay(-30);
  const usageWithKnownPricing = input.usage.filter((row) => getModelPricing(readString(row.model)));
  const todayUsage = usageWithKnownPricing.filter((row) => new Date(readString(row.created_at)) >= today);
  const monthUsage = usageWithKnownPricing.filter((row) => new Date(readString(row.created_at)) >= month);
  const currentPeriodUsage = usageWithKnownPricing.filter((row) => new Date(readString(row.created_at)) >= currentStart);
  const previousPeriodUsage = usageWithKnownPricing.filter((row) => {
    const createdAt = new Date(readString(row.created_at));

    return createdAt >= previousStart && createdAt < currentStart;
  });
  const sumCost = (rows: Array<Record<string, unknown>>) =>
    rows.reduce((sum, row) => sum + readNumber(row.estimated_cost_usd), 0);
  const sumTokens = (rows: Array<Record<string, unknown>>) =>
    rows.reduce((sum, row) => sum + readNumber(row.total_tokens), 0);
  const todayCost = sumCost(todayUsage);
  const monthCost = sumCost(monthUsage);
  const previousCost = sumCost(previousPeriodUsage);
  const currentCost = sumCost(currentPeriodUsage);
  const userMap = new Map<string, { userId: string; tokens: number; costUsd: number }>();
  const routeMap = new Map<string, { route: string; requests: number; costUsd: number }>();

  usageWithKnownPricing.forEach((row) => {
    const userId = readString(row.user_id, "unknown");
    const route = readString(row.endpoint, "unknown");
    const userSummary = userMap.get(userId) || { userId, tokens: 0, costUsd: 0 };
    const routeSummary = routeMap.get(route) || { route, requests: 0, costUsd: 0 };

    userSummary.tokens += readNumber(row.total_tokens);
    userSummary.costUsd += readNumber(row.estimated_cost_usd);
    routeSummary.requests += 1;
    routeSummary.costUsd += readNumber(row.estimated_cost_usd);

    userMap.set(userId, userSummary);
    routeMap.set(route, routeSummary);
  });

  return {
    totalTokensToday: input.official?.status === "LIVE" ? input.official.totalTokens : sumTokens(todayUsage),
    totalTokensThisMonth: input.official?.status === "LIVE" ? input.official.totalTokens : sumTokens(monthUsage),
    estimatedCostToday: input.official?.costRanges.today ?? (todayUsage.length ? todayCost : null),
    estimatedCostThisMonth: input.official?.costRanges.thisMonth ?? (monthUsage.length ? monthCost : null),
    remainingDailyBudget:
      input.official?.costAlerts.find((alert) => alert.id === "openai-cost-daily")?.remainingUsd ?? null,
    remainingWeeklyBudget:
      input.official?.costAlerts.find((alert) => alert.id === "openai-cost-weekly")?.remainingUsd ?? null,
    remainingMonthlyBudget:
      input.official?.costAlerts.find((alert) => alert.id === "openai-cost-monthly")?.remainingUsd ?? null,
    remainingPerUserBudget:
      input.official?.costAlerts.find((alert) => alert.id === "openai-cost-user")?.remainingUsd ?? null,
    averageCostPerConversation: null,
    averageCostPerReport: null,
    failedAiRequests: input.usage.filter((row) => isFailedAiUsageStatus(row.status)).length,
    costTrendPercent:
      previousCost > 0 ? ((currentCost - previousCost) / previousCost) * 100 : null,
    highestUsageUsers: [...userMap.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 5),
    highestCostRoutes: [...routeMap.values()].sort((a, b) => b.costUsd - a.costUsd).slice(0, 5),
    dateRanges: ["24 hours", "7 days", "30 days", "Custom range"],
  };
}

function calculateFinancials(input: {
  revenue: number | null;
  aiCost: number;
  aiCostConnected?: boolean;
  totalUsers: number;
  usage: Array<Record<string, unknown>>;
  openAiCostRanges?: OpenAiCostCenterData["costRanges"];
}) {
  const today = startOfUtcDay();
  const week = startOfUtcDay(-6);
  const month = startOfUtcMonth();
  const costSince = (date: Date) =>
    input.usage
      .filter((row) => new Date(readString(row.created_at)) >= date)
      .reduce((sum, row) => sum + readNumber(row.estimated_cost_usd), 0);
  const grossProfit =
    input.revenue === null || !input.aiCostConnected
      ? null
      : Number((input.revenue - input.aiCost).toFixed(2));
  const grossMargin =
    input.revenue && input.revenue > 0 && grossProfit !== null
      ? Number(((grossProfit / input.revenue) * 100).toFixed(1))
      : null;

  return {
    revenue: input.revenue,
    aiCost: input.aiCost,
    grossProfit,
    grossMargin,
    netProfit: null,
    averageCostPerUser:
      input.totalUsers > 0 ? Number((input.aiCost / input.totalUsers).toFixed(4)) : null,
    averageCostPerReport: null,
    dailyAiCost: input.openAiCostRanges?.today ?? costSince(today),
    weeklyAiCost: input.openAiCostRanges?.last7d ?? costSince(week),
    monthlyAiCost: input.openAiCostRanges?.thisMonth ?? costSince(month),
    allTimeAiCost: input.openAiCostRanges?.allTime ?? null,
  };
}

function calculateOpenAiAnalytics(input: {
  usage: Array<Record<string, unknown>>;
  totalUsers: number;
  official?: OpenAiCostCenterData;
}) {
  if (input.official?.status === "LIVE") {
    const cost = input.official.costUsd;

    return {
      inputTokens: input.official.inputTokens,
      outputTokens: input.official.outputTokens,
      cachedTokens: input.official.cachedTokens,
      totalTokens: input.official.totalTokens,
      cost,
      costPerUser: input.totalUsers > 0 ? Number((cost / input.totalUsers).toFixed(4)) : null,
      costPerReport: null,
      costRanges: input.official.costRanges,
      dailyCostHistory: input.official.dailyCostHistory,
      featureCosts: input.official.featureCosts,
      costAlerts: input.official.costAlerts,
      modelUsage: input.official.modelUsage.map((model) => ({
        model: model.model,
        requests: model.requests,
        inputTokens: model.inputTokens,
        outputTokens: model.outputTokens,
        cachedTokens: model.cachedTokens,
        tokens: model.tokens,
        costUsd: model.costUsd,
        status: model.status,
      })),
      unknownModels: [],
    };
  }

  const inputTokens = input.usage.reduce((sum, row) => sum + readNumber(row.prompt_tokens), 0);
  const outputTokens = input.usage.reduce((sum, row) => sum + readNumber(row.completion_tokens), 0);
  const cachedTokens = input.usage.reduce((sum, row) => {
    const metadata = row.metadata && typeof row.metadata === "object"
      ? row.metadata as Record<string, unknown>
      : {};

    return sum + (
      readNumber(metadata.cached_tokens) ||
      readNumber(metadata.cachedTokens) ||
      readNumber(metadata.input_cached_tokens)
    );
  }, 0);
  const totalTokens = input.usage.reduce((sum, row) => {
    const metadata = readUsageMetadata(row);
    const rowInputTokens = readNumber(row.prompt_tokens);
    const rowOutputTokens = readNumber(row.completion_tokens);
    const rowCachedTokens =
      readNumber(metadata.cached_tokens) ||
      readNumber(metadata.cachedTokens) ||
      readNumber(metadata.input_cached_tokens);

    return sum + (readNumber(row.total_tokens) || rowInputTokens + rowOutputTokens + rowCachedTokens);
  }, 0);
  const cost = input.usage.reduce((sum, row) => sum + readNumber(row.estimated_cost_usd), 0);
  const modelMap = new Map<
    string,
    {
      model: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      tokens: number;
      costUsd: number;
      status: AdminMetricStatus;
    }
  >();

  input.usage.forEach((row) => {
    const model = readString(row.model, "unknown_model");
    const metadata = readUsageMetadata(row);
    const rowInputTokens = readNumber(row.prompt_tokens);
    const rowOutputTokens = readNumber(row.completion_tokens);
    const rowCachedTokens =
      readNumber(metadata.cached_tokens) ||
      readNumber(metadata.cachedTokens) ||
      readNumber(metadata.input_cached_tokens);
    const rowTotalTokens = readNumber(row.total_tokens) || rowInputTokens + rowOutputTokens + rowCachedTokens;
    const storedCostUsd = readNumber(row.estimated_cost_usd);
    const estimatedCostUsd = storedCostUsd > 0
      ? storedCostUsd
      : estimateModelCostUsd(model, {
          promptTokens: rowInputTokens,
          completionTokens: rowOutputTokens,
          totalTokens: rowTotalTokens,
        });
    const summary = modelMap.get(model) || {
      model,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      tokens: 0,
      costUsd: 0,
      status: getModelPricing(model) ? ("ESTIMATED" as const) : ("NO DATA" as const),
    };

    summary.requests += 1;
    summary.inputTokens += rowInputTokens;
    summary.outputTokens += rowOutputTokens;
    summary.cachedTokens += rowCachedTokens;
    summary.tokens += rowTotalTokens;
    summary.costUsd += estimatedCostUsd ?? 0;
    if (storedCostUsd > 0) {
      summary.status = "LIVE";
    } else if (estimatedCostUsd !== null) {
      summary.status = summary.status === "LIVE" ? "LIVE" : "ESTIMATED";
    }
    modelMap.set(model, summary);
  });

  const modelUsage = [...modelMap.values()].sort((a, b) => b.costUsd - a.costUsd);

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens,
    cost,
    costPerUser: input.totalUsers > 0 ? Number((cost / input.totalUsers).toFixed(4)) : null,
    costPerReport: null,
    costRanges: {
      today: null,
      thisMonth: null,
      last24h: null,
      last7d: null,
      last30d: null,
      allTime: null,
    },
    dailyCostHistory: [],
    featureCosts: buildOpenAiFeatureCosts(
      input.usage,
      cost,
      input.usage.length && cost > 0 ? "LIVE" : "NO DATA"
    ),
    costAlerts: buildOpenAiCostAlerts(
      { today: null, thisMonth: null, last24h: null, last7d: null, last30d: null, allTime: null },
      input.totalUsers,
      input.usage
    ),
    modelUsage,
    unknownModels: modelUsage
      .filter((item) => !getModelPricing(item.model))
      .map((item) => ({ model: item.model, requests: item.requests, tokens: item.tokens })),
  };
}

function calculateUserAnalytics(input: {
  planDistribution: Array<{ label: string; value: number }>;
  userGrowth: AdminChartSeries[];
  totalUsers: number;
  totalRequests: number;
}) {
  const getPlanCount = (plan: string) =>
    input.planDistribution.find((item) => item.label.toLowerCase() === plan)?.value || 0;
  const currentGrowth = input.userGrowth.at(-1)?.value ?? 0;
  const previousGrowth = input.userGrowth.at(-2)?.value ?? 0;
  const growthRate =
    previousGrowth > 0 ? Number((((currentGrowth - previousGrowth) / previousGrowth) * 100).toFixed(1)) : null;

  return {
    freeUsers: getPlanCount("free"),
    proUsers: getPlanCount("pro"),
    businessUsers: getPlanCount("business"),
    growthRate,
    churnRate: null,
    averageUsage:
      input.totalUsers > 0 ? Number((input.totalRequests / input.totalUsers).toFixed(2)) : null,
  };
}

async function buildTopReports(input: {
  reportTypeDistribution: Array<{ label: string; value: number }>;
  usage: Array<Record<string, unknown>>;
}) {
  const reportCostMap = new Map<string, number>();

  input.usage.forEach((row) => {
    const reportId = readUsageReportId(row);
    const cost = readNumber(row.estimated_cost_usd);

    if (!reportId || cost <= 0) {
      return;
    }

    reportCostMap.set(reportId, (reportCostMap.get(reportId) || 0) + cost);
  });

  let mostExpensive: Array<{ title: string; value: number; detail: string }> = [];

  if (reportCostMap.size > 0) {
    const serviceClient = createServiceRoleClient();
    const reportIds = [...reportCostMap.keys()].slice(0, 100);
    const { data, error } = await serviceClient
      .from("reports")
      .select("id,title,report_type,created_at")
      .in("id", reportIds);

    if (error) {
      console.error("[admin:data] report cost attribution query failed", {
        message: error.message,
        code: error.code,
      });
    } else {
      mostExpensive = (data || [])
        .map((row) => ({
          title: readString(row.title, "Untitled report"),
          value: roundUsd(reportCostMap.get(readString(row.id)) || 0),
          detail: `${readString(row.report_type, "Report")} · ${readString(row.created_at)}`,
        }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);
    }
  }

  return {
    mostExpensive,
    mostUsed: [],
    mostGenerated: input.reportTypeDistribution
      .slice()
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map((item) => ({
        title: item.label,
        value: item.value,
        detail: "Generated report type",
      })),
  };
}

function buildAdminAlerts(input: {
  aiCost: number;
  failedRequests: number;
  unknownModels: Array<{ model: string; requests: number; tokens: number }>;
  tokenUsage: number;
  systemStatus: AdminSystemStatus[];
}) {
  const alerts: AdminActivityItem[] = [];
  const now = new Date().toISOString();

  if (input.aiCost > 100) {
    alerts.push({
      id: "alert:high-ai-cost",
      label: "High AI cost",
      detail: `Stored AI cost reached $${input.aiCost.toFixed(2)} in the selected range.`,
      severity: "warning",
      createdAt: now,
      href: "/admin/ai-usage",
    });
  }

  if (input.failedRequests > 0) {
    alerts.push({
      id: "alert:failed-ai-requests",
      label: "Failed AI jobs",
      detail: `${input.failedRequests} failed AI requests were recorded in the selected range.`,
      severity: "error",
      createdAt: now,
      href: "/admin/logs",
    });
  }

  if (input.unknownModels.length) {
    alerts.push({
      id: "alert:unknown-models",
      label: "Unknown model usage",
      detail: `${input.unknownModels.length} model names do not have pricing metadata.`,
      severity: "warning",
      createdAt: now,
      href: "/admin/ai-usage",
    });
  }

  if (input.tokenUsage > 1_000_000) {
    alerts.push({
      id: "alert:high-token-usage",
      label: "High token usage",
      detail: `${input.tokenUsage.toLocaleString("en-US")} tokens were recorded in the selected range.`,
      severity: "warning",
      createdAt: now,
      href: "/admin/ai-usage",
    });
  }

  input.systemStatus
    .filter((item) => item.status === "Degraded" || item.status === "Down")
    .forEach((item) => {
      alerts.push({
        id: `alert:system:${item.label}`,
        label: `${item.label} ${item.status.toLowerCase()}`,
        detail: item.detail,
        severity: item.status === "Down" ? "error" : "warning",
        createdAt: item.lastChecked || now,
        href: "/admin/security",
      });
    });

  return alerts.slice(0, 8);
}

async function loadRecentActivity(authUsers: User[], range: AdminDateRange) {
  const serviceClient = createServiceRoleClient();
  const [reports, conversations, usageFailures, audit] = await Promise.all([
    serviceClient
      .from("reports")
      .select("id,title,user_id,created_at")
      .gte("created_at", range.fromIso)
      .lte("created_at", range.toIso)
      .order("created_at", { ascending: false })
      .limit(10),
    serviceClient
      .from("ai_conversations")
      .select("id,title,user_id,created_at")
      .gte("created_at", range.fromIso)
      .lte("created_at", range.toIso)
      .order("created_at", { ascending: false })
      .limit(10),
    serviceClient
      .from("ai_usage_events")
      .select("id,user_id,endpoint,status,created_at")
      .eq("status", "failed")
      .gte("created_at", range.fromIso)
      .lte("created_at", range.toIso)
      .order("created_at", { ascending: false })
      .limit(10),
    serviceClient
      .from("admin_audit_log")
      .select("id,admin_user_id,target_user_id,action,created_at")
      .gte("created_at", range.fromIso)
      .lte("created_at", range.toIso)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const userEvents: AdminActivityItem[] = authUsers
    .filter((user) => isWithinRange(user.created_at || "", range))
    .slice()
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 10)
    .map((user) => ({
      id: `user:${user.id}`,
      label: "User registered",
      detail: user.email || user.id,
      severity: "success",
      createdAt: user.created_at || "",
      href: `/admin/users/${user.id}`,
    }));
  const reportEvents: AdminActivityItem[] = (reports.data || []).map((row) => ({
    id: `report:${readString(row.id)}`,
    label: "Report created",
    detail: readString(row.title, "Untitled report"),
    severity: "info",
    createdAt: readString(row.created_at),
    href: "/admin/reports",
  }));
  const conversationEvents: AdminActivityItem[] = (conversations.data || []).map((row) => ({
    id: `conversation:${readString(row.id)}`,
    label: "AI conversation created",
    detail: readString(row.title, "Untitled conversation"),
    severity: "info",
    createdAt: readString(row.created_at),
    href: "/admin/ai-usage",
  }));
  const failureEvents: AdminActivityItem[] = (usageFailures.data || []).map((row) => ({
    id: `failure:${readString(row.id)}`,
    label: "AI request failed",
    detail: readString(row.endpoint, "unknown endpoint"),
    severity: "error",
    createdAt: readString(row.created_at),
    href: "/admin/logs",
  }));
  const auditEvents: AdminActivityItem[] = (audit.data || []).map((row) => ({
    id: `audit:${readString(row.id)}`,
    label: "Admin action",
    detail: readString(row.action, "admin action"),
    severity: "warning",
    createdAt: readString(row.created_at),
    href: readString(row.target_user_id) ? `/admin/users/${readString(row.target_user_id)}` : "/admin/logs",
  }));

  return [...userEvents, ...reportEvents, ...conversationEvents, ...failureEvents, ...auditEvents]
    .filter((item) => item.createdAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 12);
}

export async function loadAdminNotifications(range = resolveAdminDateRange({ range: "24h" })) {
  if (isLocalAdminMockMode()) {
    return buildMockAdminDashboardData(range).notifications;
  }

  const authData = await listAuthUsersForAdminScan();
  const recentActivity = await loadRecentActivity(authData.users, range);

  return {
    generatedAt: new Date().toISOString(),
    newUsers: recentActivity.filter((item) => item.id.startsWith("user:")).slice(0, 5),
    reports: recentActivity.filter((item) => item.id.startsWith("report:")).slice(0, 5),
    failedJobs: recentActivity.filter((item) => item.id.startsWith("failure:")).slice(0, 5),
  };
}

export async function loadSystemStatus() {
  const now = Date.now();

  if (cachedHealth && cachedHealth.expiresAt > now) {
    return cachedHealth.data;
  }

  const lastChecked = new Date().toISOString();
  const stripe = getStripeConfiguration();
  const resend = getResendConfiguration();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "";
  const normalizedAppUrl = appUrl
    ? appUrl.startsWith("http")
      ? appUrl
      : `https://${appUrl}`
    : "";
  const productionDomain = process.env.NEXT_PUBLIC_APP_URL || "";

  const supabaseUrl = getSupabaseUrl();
  const supabaseServiceRoleKey = getSupabaseServiceRoleKey();
  let supabaseStatus: AdminSystemStatus = {
    label: "Supabase",
    status: "Not Connected",
    detail: "Supabase URL or service-role key is missing.",
    lastChecked,
    lastSuccessfulCheck: null,
    responseTimeMs: null,
  };
  let recentUsage: Array<{ status: string | null }> = [];

  if (supabaseUrl && supabaseServiceRoleKey) {
    const startedAt = Date.now();

    try {
      const serviceClient = createServiceRoleClient();
      const { error } = await serviceClient
        .from("ai_usage_events")
        .select("id", { count: "exact", head: true })
        .limit(1);
      const responseTimeMs = Date.now() - startedAt;

      supabaseStatus = {
        label: "Supabase",
        status: error
          ? "Down"
          : responseTimeMs > HEALTH_DEGRADED_LATENCY_MS
            ? "Degraded"
            : "Healthy",
        detail: error ? "Supabase database health query failed." : "Supabase database query succeeded.",
        lastChecked,
        lastSuccessfulCheck: error ? null : lastChecked,
        responseTimeMs,
      };

      if (!error) {
        const { data } = await serviceClient
          .from("ai_usage_events")
          .select("status")
          .gte("created_at", toIso(startOfUtcDay(-1)))
          .order("created_at", { ascending: false })
          .limit(100);

        recentUsage = data || [];
      }
    } catch {
      supabaseStatus = {
        label: "Supabase",
        status: "Down",
        detail: "Supabase service-role client could not complete a database health query.",
        lastChecked,
        lastSuccessfulCheck: null,
        responseTimeMs: Date.now() - startedAt,
      };
    }
  }

  const recentAiFailures = recentUsage.filter((row) => isFailedAiUsageStatus(row.status)).length;
  const openAiKey = getOpenAiCostCenterKey();
  const openAiCheck = openAiKey
    ? await fetchHealth("https://api.openai.com/v1/models", {
        headers: {
          Authorization: `Bearer ${openAiKey}`,
        },
      })
    : null;
  const openAiStatus: AdminSystemStatus["status"] = openAiCheck
    ? statusFromHealth(openAiCheck)
    : "Not Connected";
  const stripeCheck =
    stripe.configured && stripe.enabled
      ? await fetchHealth("https://api.stripe.com/v1/balance", {
          headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          },
        })
      : null;
  const stripeStatus: AdminSystemStatus["status"] = stripeCheck
    ? statusFromHealth(stripeCheck)
    : "Not Connected";
  const resendCheck =
    resend.configured && resend.enabled
      ? await fetchHealth("https://api.resend.com/domains", {
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          },
        })
      : null;
  const resendStatus: AdminSystemStatus["status"] = resendCheck
    ? statusFromHealth(resendCheck)
    : "Not Connected";
  const vercelCheck = normalizedAppUrl
    ? await fetchHealth(normalizedAppUrl, {
        headers: {
          Accept: "text/html",
        },
      })
    : null;
  const vercelStatus: AdminSystemStatus["status"] = vercelCheck
    ? statusFromHealth(vercelCheck)
    : "Unknown";
  const domainUrl = productionDomain
    ? productionDomain.startsWith("http")
      ? productionDomain
      : `https://${productionDomain}`
    : "";
  const domainCheck = domainUrl
    ? await fetchHealth(domainUrl, {
        headers: {
          Accept: "text/html",
        },
      })
    : null;
  const domainStatus: AdminSystemStatus["status"] = domainCheck
    ? statusFromHealth(domainCheck)
    : "Not Connected";
  const apiCheck = normalizedAppUrl
    ? await fetchHealth(`${normalizedAppUrl.replace(/\/$/, "")}/api/admin/health`, {
        headers: {
          Accept: "application/json",
        },
      })
    : null;
  const apiStatus: AdminSystemStatus["status"] = apiCheck
    ? statusFromHealth(apiCheck, { allowStatuses: [401, 403] })
    : "Unknown";

  const data: AdminSystemStatus[] = [
    {
      label: "ZERINIX API",
      status: apiStatus,
      detail: apiCheck
        ? apiCheck.ok
          ? "Admin health endpoint returned a successful response."
          : apiCheck.status === 401 || apiCheck.status === 403
            ? "Admin health endpoint is reachable and protected."
            : `Admin health endpoint failed with status ${apiCheck.status || "network"}.`
        : "No application URL is configured for an internal API health check.",
      lastChecked,
      lastSuccessfulCheck: successfulCheckTime(apiStatus, lastChecked),
      responseTimeMs: apiCheck?.responseTimeMs ?? null,
    },
    supabaseStatus,
    {
      label: "OpenAI",
      status: openAiStatus,
      detail: openAiCheck
        ? openAiCheck.ok
          ? recentAiFailures > 0
            ? "OpenAI models endpoint is reachable; recent failed AI jobs were found in stored usage."
            : "OpenAI models endpoint returned a successful authenticated response."
          : `OpenAI health probe failed with status ${openAiCheck.status || "network"}.`
        : "OpenAI credentials are not configured.",
      lastChecked,
      lastSuccessfulCheck: successfulCheckTime(openAiStatus, lastChecked),
      responseTimeMs: openAiCheck?.responseTimeMs ?? null,
    },
    {
      label: "Vercel application",
      status: vercelStatus,
      detail: vercelCheck
        ? vercelCheck.ok
          ? "Configured application URL is reachable."
          : `Application URL probe failed with status ${vercelCheck.status || "network"}.`
        : "No application URL is configured for a server-side health probe",
      lastChecked,
      lastSuccessfulCheck: successfulCheckTime(vercelStatus, lastChecked),
      responseTimeMs: vercelCheck?.responseTimeMs ?? null,
    },
    {
      label: "Cloudflare/domain",
      status: domainStatus,
      detail: domainCheck
        ? domainCheck.ok
          ? "Configured public domain is reachable."
          : `Public domain probe failed with status ${domainCheck.status || "network"}.`
        : "NEXT_PUBLIC_APP_URL is not configured for a production domain probe.",
      lastChecked,
      lastSuccessfulCheck: successfulCheckTime(domainStatus, lastChecked),
      responseTimeMs: domainCheck?.responseTimeMs ?? null,
    },
    {
      label: "Stripe",
      status: stripeStatus,
      detail: stripeCheck
        ? stripeCheck.ok
          ? "Stripe balance endpoint reachable."
          : `Stripe health probe failed with status ${stripeCheck.status || "network"}.`
        : `Stripe is not connected. Missing or disabled: ${
            stripe.enabled ? stripe.missing.join(", ") : "ENABLE_STRIPE_BILLING"
          }.`,
      lastChecked,
      lastSuccessfulCheck: successfulCheckTime(stripeStatus, lastChecked),
      responseTimeMs: stripeCheck?.responseTimeMs ?? null,
    },
    {
      label: "Resend",
      status: resendStatus,
      detail: resendCheck
        ? resendCheck.ok
          ? "Resend domains endpoint reachable."
          : `Resend health probe failed with status ${resendCheck.status || "network"}.`
        : `Resend is not connected. Missing or disabled: ${
            resend.enabled ? resend.missing.join(", ") : "ENABLE_RESEND_EMAILS"
          }.`,
      lastChecked,
      lastSuccessfulCheck: successfulCheckTime(resendStatus, lastChecked),
      responseTimeMs: resendCheck?.responseTimeMs ?? null,
    },
  ];

  cachedHealth = {
    expiresAt: now + 30_000,
    data,
  };

  return data;
}

function buildExportTables(input: {
  recentUsers: AdminUserRow[];
  recentActivity: AdminActivityItem[];
  recentErrors: Array<{ id: string; endpoint: string; status: string; createdAt: string }>;
  usageSummary: AdminDashboardData["usageSummary"];
  charts: AdminDashboardData["charts"];
}): AdminExportTable[] {
  return [
    {
      id: "recent-users",
      title: "Recent users",
      columns: ["Email", "Plan", "Status", "Reports", "Last sign-in"],
      rows: input.recentUsers.map((user) => [
        user.email,
        user.plan,
        user.accountStatus,
        String(user.reportCount),
        user.lastSignInAt,
      ]),
    },
    {
      id: "recent-activity",
      title: "Recent activity",
      columns: ["Event", "Detail", "Severity", "Created at"],
      rows: input.recentActivity.map((item) => [
        item.label,
        item.detail,
        item.severity,
        item.createdAt,
      ]),
    },
    {
      id: "failed-jobs",
      title: "Failed jobs",
      columns: ["Endpoint", "Status", "Created at"],
      rows: input.recentErrors.map((item) => [item.endpoint, item.status, item.createdAt]),
    },
    {
      id: "ai-usage",
      title: "AI usage summary",
      columns: ["Metric", "Value"],
      rows: [
        ["Requests", String(input.usageSummary.totalRequests)],
        ["Tokens", String(input.usageSummary.totalTokens)],
        ["Cache hits", String(input.usageSummary.cacheHits)],
        ["Failures", String(input.usageSummary.failedRequests)],
      ],
    },
    {
      id: "chart-series",
      title: "Analytics chart series",
      columns: ["Series", "Label", "Value"],
      rows: Object.entries(input.charts).flatMap(([series, values]) =>
        values.map((item) => [series, item.label, String(item.value)])
      ),
    },
  ];
}

export async function loadAdminDashboardData(input?: {
  range?: AdminDateRange;
}): Promise<AdminDashboardData> {
  const dateRange = input?.range || resolveAdminDateRange();

  if (isLocalAdminMockMode()) {
    return buildMockAdminDashboardData(dateRange);
  }

  const [authData, reportCount, conversationCount, workspaceSummary, usageResult, recentUsers, systemStatus, statuses] =
    await Promise.all([
      listAuthUsersForAdminScan(),
      countTableDetailed("reports", dateRange),
      countTableDetailed("ai_conversations", dateRange),
      countTableDetailed("report_workspaces", dateRange),
      loadRecentUsage(dateRange),
      loadAdminUsers({ page: 1, pageSize: 5 }),
      loadSystemStatus(),
      loadAllAccountStatuses(),
    ]);
  const reportsGenerated = reportCount.count;
  const aiConversations = conversationCount.count;
  const workspaceCount = workspaceSummary.count;
  const totalUsers = authData.total || authData.users.length;
  const newUsers = authData.users.filter((user) => isWithinRange(user.created_at || "", dateRange)).length;
  const activeUsers = authData.users.filter(
    (user) =>
      user.last_sign_in_at &&
      isWithinRange(user.last_sign_in_at, dateRange) &&
      statuses.get(user.id) !== "suspended"
  ).length;
  const usage = usageResult.rows;
  const openAiCostCenter = await loadOpenAiCostCenter({
    range: dateRange,
    usage,
    totalUsers,
  });
  const localAiApiCost = usage.reduce((sum, row) => sum + readNumber(row.estimated_cost_usd), 0);
  const aiUsageSourceStatus: AdminMetricStatus =
    openAiCostCenter.status === "LIVE"
      ? "LIVE"
      : usageResult.status === "LIVE"
        ? "ESTIMATED"
        : usageResult.status;
  const aiApiCost = openAiCostCenter.status === "LIVE" ? openAiCostCenter.costUsd : localAiApiCost;
  const failedRequests = usage.filter((row) => isFailedAiUsageStatus(row.status));
  const [charts, recentActivity, revenueSummary] = await Promise.all([
    loadAdminChartData(authData.users, dateRange),
    loadRecentActivity(authData.users, dateRange),
    loadRevenueSummary(dateRange),
  ]);
  const adminCharts = {
    ...charts,
    estimatedAiCost:
      openAiCostCenter.status === "LIVE"
        ? openAiCostCenter.dailyCostHistory
        : [],
  };
  const usageSummary = {
    totalRequests: usageResult.totalRequests,
    totalTokens: usage.reduce((sum, row) => sum + readNumber(row.total_tokens), 0),
    cacheHits: usage.filter((row) => Boolean(row.cache_hit)).length,
    failedRequests: failedRequests.length,
  };
  const recentErrors = failedRequests.slice(0, 6).map((row) => ({
    id: readString(row.id),
    endpoint: readString(row.endpoint, "unknown"),
    status: readString(row.status, "failed"),
    createdAt: readString(row.created_at),
  }));
  const notifications = {
    generatedAt: new Date().toISOString(),
    newUsers: recentActivity.filter((item) => item.id.startsWith("user:")).slice(0, 5),
    reports: recentActivity.filter((item) => item.id.startsWith("report:")).slice(0, 5),
    failedJobs: recentActivity.filter((item) => item.id.startsWith("failure:")).slice(0, 5),
  };

  const [userGrowth, reportTypeDistribution, reportStatusSummary, billingSummary] = await Promise.all([
    loadUserGrowth(),
    loadReportDistribution(dateRange),
    loadReportStatusSummary(dateRange),
    loadBillingSummary(),
  ]);
  const revenueValue = revenueSummary.value;
  const planDistribution = billingSummary.planDistribution;
  const subscriptions = billingSummary.activePaidSubscriptions;
  const financials = calculateFinancials({
    revenue: revenueValue,
    aiCost: aiApiCost,
    aiCostConnected: openAiCostCenter.status === "LIVE",
    totalUsers,
    usage,
    openAiCostRanges: openAiCostCenter.costRanges,
  });
  const openAiAnalytics = calculateOpenAiAnalytics({
    usage,
    totalUsers,
    official: openAiCostCenter,
  });
  const userAnalytics = calculateUserAnalytics({
    planDistribution,
    userGrowth,
    totalUsers,
    totalRequests: usageSummary.totalRequests,
  });
  const topReports = await buildTopReports({ reportTypeDistribution, usage });
  const alerts = buildAdminAlerts({
    aiCost: aiApiCost,
    failedRequests: usageSummary.failedRequests,
    unknownModels: openAiAnalytics.unknownModels,
    tokenUsage: openAiAnalytics.totalTokens,
    systemStatus,
  });
  const userSourceStatus: AdminMetricStatus = totalUsers > 0 || newUsers > 0 || activeUsers > 0
    ? "LIVE"
    : "NO DATA";
  const activeUserDetail = activeUsers > 0
    ? `${activeUsers} users have last_sign_in_at inside the selected date range.`
    : "No users have last_sign_in_at activity inside the selected date range.";
  const reportsSourceStatus = combineMetricStatuses(
    reportCount.status,
    reportStatusSummary.status
  );

  return {
    dateRange,
    totalUsers,
    newUsers,
    activeUsers,
    reportsGenerated,
    aiConversations,
    workspaceCount,
    subscriptions,
    monthlyRecurringRevenue: revenueValue,
    aiApiCost,
	    sourceStatus: {
	      revenue: revenueSummary.status,
	      aiUsage: aiUsageSourceStatus,
	      users: userSourceStatus,
	      reports: reportsSourceStatus,
	      workspaces: workspaceSummary.status,
	      subscriptions: billingSummary.status,
	    },
	    sourceDetails: {
	      revenue: revenueSummary.detail,
	      aiUsage: openAiCostCenter.status === "LIVE"
	        ? openAiCostCenter.detail
	        : `${usageResult.detail} Official OpenAI organization cost data is unavailable: ${openAiCostCenter.detail}`,
	      users: userSourceStatus === "LIVE"
	        ? `Read from Supabase Auth admin users. Total users are all-time; new users use created_at in the selected date range. ${activeUserDetail}`
	        : "Supabase Auth query succeeded, but no users were returned.",
	      reports: reportsSourceStatus === "LIVE"
	        ? `Read from reports.created_at for the selected date range. ${reportStatusSummary.detail}`
	        : `${reportCount.detail} ${reportStatusSummary.detail}`,
	      workspaces: workspaceSummary.detail,
	      subscriptions: billingSummary.detail,
	    },
    financials,
    openAiAnalytics,
    userAnalytics,
    topReports,
    alerts,
    userGrowth,
    reportTypeDistribution,
    planDistribution,
    recentUsers: recentUsers.users,
    recentActivity,
    charts: adminCharts,
    revenueOverview: buildRevenueOverview(),
    costControl: calculateCostControl({
      usage,
      official: openAiCostCenter,
    }),
    usageSummary,
    recentErrors,
    systemStatus,
    exportTables: buildExportTables({
      recentUsers: recentUsers.users,
      recentActivity,
      recentErrors,
      usageSummary,
      charts: adminCharts,
    }),
    notifications,
  };
}

function parseAdminSearchFilters(value?: string): AdminSearchFilter[] {
  const allowed: AdminSearchFilter[] = ["users", "reports", "conversations", "payments", "logs"];
  const requested = readString(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean) as AdminSearchFilter[];
  const filters = requested.filter((item) => allowed.includes(item));

  return filters.length ? filters : allowed;
}

export async function searchAdminRecords(
  query: string,
  options?: { filters?: string }
): Promise<AdminSearchResultGroup[]> {
  const normalized = normalizeSearchQuery(query);

  if (normalized.length < 2) {
    return [];
  }

  if (isLocalAdminMockMode()) {
    const lower = normalized.toLowerCase();
    const filters = parseAdminSearchFilters(options?.filters);
    const users = filters.includes("users")
      ? buildMockAdminUsers()
          .filter((user) => user.email.toLowerCase().includes(lower) || user.displayName.toLowerCase().includes(lower))
          .slice(0, 5)
          .map((user) => ({
            id: user.id,
            title: user.email,
            detail: user.displayName || "Local mock user",
            href: `/admin/users/${user.id}`,
          }))
      : [];
    const reports = filters.includes("reports") && "local investor report validation".includes(lower)
      ? [
          {
            id: "mock-report-1",
            title: "Local investor report validation",
            detail: "Business Plan",
            href: "/admin/reports",
          },
        ]
      : [];

    return [
      { label: "Users", results: users },
      { label: "Reports", results: reports },
    ].filter((group) => group.results.length > 0);
  }

  const serviceClient = createServiceRoleClient();
  const authData = await listAuthUsers(1, 1000);
  const lower = normalized.toLowerCase();
  const filters = parseAdminSearchFilters(options?.filters);
  const reportFilter = isUuid(normalized)
    ? `title.ilike.%${normalized}%,id.eq.${normalized}`
    : `title.ilike.%${normalized}%`;
  const users = filters.includes("users") ? authData.users
    .filter((user) => {
      const email = (user.email || "").toLowerCase();
      const name = readString(user.user_metadata?.full_name).toLowerCase();

      return user.id.includes(normalized) || email.includes(lower) || name.includes(lower);
    })
    .slice(0, 5)
    .map((user) => ({
      id: user.id,
      title: user.email || user.id,
      detail: readString(user.user_metadata?.full_name, "User account"),
      href: `/admin/users/${user.id}`,
    })) : [];
  const [reports, conversations, payments, logs] = await Promise.all([
    filters.includes("reports")
      ? serviceClient
          .from("reports")
          .select("id,title,report_type,created_at")
          .or(reportFilter)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
    filters.includes("conversations")
      ? serviceClient
          .from("ai_conversations")
          .select("id,title,mode,created_at")
          .or(reportFilter)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
    filters.includes("payments")
      ? serviceClient
          .from("stripe_invoices")
          .select("id,stripe_invoice_id,status,total_cents,currency,created_at")
          .or(`stripe_invoice_id.ilike.%${normalized}%,status.ilike.%${normalized}%`)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
    filters.includes("logs")
      ? serviceClient
          .from("admin_audit_log")
          .select("id,action,target_user_id,created_at")
          .or(`action.ilike.%${normalized}%,target_user_id.ilike.%${normalized}%`)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
  ]);

  return [
    { label: "Users", results: users },
    {
      label: "Reports",
      results: (reports.data || []).map((row) => ({
        id: readString(row.id),
        title: readString(row.title, "Untitled report"),
        detail: readString(row.report_type, "Report"),
        href: "/admin/reports",
      })),
    },
    {
      label: "Conversations",
      results: (conversations.data || []).map((row) => ({
        id: readString(row.id),
        title: readString(row.title, "Untitled conversation"),
        detail: readString(row.mode, "AI conversation"),
        href: "/admin/ai-usage",
      })),
    },
    {
      label: "Payments",
      results: (payments.data || []).map((row) => ({
        id: readString(row.id),
        title: readString(row.stripe_invoice_id, "Invoice"),
        detail: `${readString(row.status, "unknown")} · ${(readNumber(row.total_cents) / 100).toFixed(2)} ${readString(row.currency, "usd").toUpperCase()}`,
        href: "/admin/payments",
      })),
    },
    {
      label: "Logs",
      results: (logs.data || []).map((row) => ({
        id: readString(row.id),
        title: readString(row.action, "Admin log"),
        detail: readString(row.target_user_id, "Audit event"),
        href: "/admin/logs",
      })),
    },
  ].filter((group) => group.results.length > 0);
}

export async function loadAiCeoContext() {
  const data = await loadAdminDashboardData();

  return {
    generatedAt: new Date().toISOString(),
    timeRange: "Latest stored admin aggregates; cost trend compares last 30 days with previous 30 days.",
    facts: {
      users: {
        total: data.totalUsers,
        active: data.activeUsers,
      },
      reportsGenerated: data.reportsGenerated,
      aiConversations: data.aiConversations,
      usage: data.usageSummary,
      costControl: data.costControl,
      systemStatus: data.systemStatus,
      revenueOverview: data.revenueOverview,
      recentActivity: data.recentActivity.slice(0, 8),
      recentErrors: data.recentErrors,
    },
    limitations: [
      "Revenue remains unavailable until Stripe production credentials and billing sync are configured.",
      "Cloudflare/domain health is not actively probed by the admin dashboard.",
      "The assistant can only answer from predefined admin aggregates and cannot execute SQL.",
    ],
  };
}

export async function writeAdminAuditLog(input: {
  adminUserId: string;
  action: string;
  targetUserId?: string;
  metadata?: Record<string, unknown>;
}) {
  if (isLocalAdminMockMode()) {
    return;
  }

  const serviceClient = createServiceRoleClient();

  await serviceClient.from("admin_audit_log").insert({
    admin_user_id: input.adminUserId,
    action: input.action,
    target_user_id: input.targetUserId ?? null,
    metadata: input.metadata ?? {},
  });
}
