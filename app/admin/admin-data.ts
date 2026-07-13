import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/app/lib/supabase/server";
import { createServiceRoleClient } from "@/app/lib/supabase/admin";
import { getSupabaseServiceRoleKey } from "@/app/lib/supabase/env";
import { getStripeConfiguration } from "@/app/lib/billing/stripe";
import { getResendConfiguration } from "@/app/lib/integrations/resend";
import { getModelPricing } from "@/app/lib/ai/pricing";

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
  activeUsers: number;
  reportsGenerated: number;
  aiConversations: number;
  monthlyRecurringRevenue: number | null;
  aiApiCost: number;
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

export type AdminDateRange = {
  key: AdminDateRangeKey;
  label: string;
  fromIso: string;
  toIso: string;
  bucket: "hour" | "day";
};

export type AdminSystemStatus = {
  label: string;
  status: "Operational" | "Degraded" | "Down" | "Not configured" | "Unknown";
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

function normalizeStatusFromFailureRate(failed: number, total: number): AdminSystemStatus["status"] {
  if (total <= 0) {
    return "Unknown";
  }

  const rate = failed / total;

  if (rate >= 0.5) {
    return "Down";
  }

  if (rate >= 0.15) {
    return "Degraded";
  }

  return "Operational";
}

function buildMockSeries(range: AdminDateRange, seed: number): AdminChartSeries[] {
  return buildTimeSeries(
    Array.from({ length: range.bucket === "hour" ? 10 : 7 }, (_, index) => {
      const bucketMs = range.bucket === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      const createdAt = new Date(new Date(range.fromIso).getTime() + index * bucketMs).toISOString();

      return {
        created_at: createdAt,
        value: Math.max(0, Math.round(seed + Math.sin(index + seed) * seed * 0.24 + index * 1.7)),
      };
    }),
    range,
    "created_at",
    "value"
  );
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
      status: "Operational",
      detail: "Local admin mock data is active",
      lastChecked,
      lastSuccessfulCheck: lastChecked,
      responseTimeMs: 0,
    },
    {
      label: "Supabase",
      status: "Not configured",
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
      status: "Not configured",
      detail: "Billing remains disabled unless production credentials are configured",
      lastChecked,
      lastSuccessfulCheck: null,
      responseTimeMs: null,
    },
  ];
}

function buildMockAdminActivity(range: AdminDateRange): AdminActivityItem[] {
  const now = new Date(range.toIso);

  return [
    {
      id: "mock:user:1",
      label: "User registered",
      detail: "founder@zerinix.local",
      severity: "success",
      createdAt: new Date(now.getTime() - 70 * 60 * 1000).toISOString(),
      href: "/admin/users/00000000-0000-4000-8000-000000000001",
    },
    {
      id: "mock:report:1",
      label: "Report created",
      detail: "Local investor report validation",
      severity: "info",
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      href: "/admin/reports",
    },
    {
      id: "mock:conversation:1",
      label: "AI conversation created",
      detail: "Local admin workspace test",
      severity: "info",
      createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
      href: "/admin/ai-usage",
    },
    {
      id: "mock:failure:1",
      label: "AI request failed",
      detail: "Local mock failed job example",
      severity: "error",
      createdAt: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
      href: "/admin/logs",
    },
  ];
}

function buildMockAdminDashboardData(dateRange: AdminDateRange): AdminDashboardData {
  const recentUsers = buildMockAdminUsers();
  const recentActivity = buildMockAdminActivity(dateRange);
  const charts = {
    userGrowth: buildMockSeries(dateRange, 4),
    activeUsers: buildMockSeries(dateRange, 3),
    reportsGenerated: buildMockSeries(dateRange, 6),
    aiRequests: buildMockSeries(dateRange, 18),
    tokenUsage: buildMockSeries(dateRange, 6800),
    estimatedAiCost: buildMockSeries(dateRange, 3),
    revenue: [],
  };
  const usageSummary = {
    totalRequests: 124,
    totalTokens: 294_250,
    cacheHits: 18,
    failedRequests: 2,
  };
  const recentErrors = [
    {
      id: "mock:error:1",
      endpoint: "/api/plan",
      status: "failed",
      createdAt: new Date(new Date(dateRange.toIso).getTime() - 5 * 60 * 60 * 1000).toISOString(),
    },
  ];

  return {
    dateRange,
    totalUsers: recentUsers.length,
    activeUsers: recentUsers.filter((user) => user.lastSignInAt).length,
    reportsGenerated: 23,
    aiConversations: 47,
    monthlyRecurringRevenue: null,
    aiApiCost: 28.77,
    userGrowth: [
      { label: "Local", value: recentUsers.length },
      { label: "Mock", value: 5 },
    ],
    reportTypeDistribution: [
      { label: "Business Plan", value: 14 },
      { label: "Market Analysis", value: 9 },
    ],
    planDistribution: [
      { label: "free", value: 1 },
      { label: "pro", value: 1 },
      { label: "business", value: 1 },
    ],
    recentUsers,
    recentActivity,
    charts,
    revenueOverview: buildRevenueOverview(),
    costControl: {
      totalTokensToday: 42_800,
      totalTokensThisMonth: usageSummary.totalTokens,
      estimatedCostToday: 4.18,
      estimatedCostThisMonth: 28.77,
      averageCostPerConversation: 0.61,
      averageCostPerReport: 1.25,
      failedAiRequests: usageSummary.failedRequests,
      costTrendPercent: 8.4,
      highestUsageUsers: recentUsers.map((user) => ({
        userId: user.id,
        tokens: user.totalTokens,
        costUsd: user.estimatedAiCostUsd,
      })),
      highestCostRoutes: [
        { route: "/api/plan", requests: 38, costUsd: 15.2 },
        { route: "/api/market-analysis", requests: 19, costUsd: 8.6 },
        { route: "/api/chat", requests: 67, costUsd: 4.97 },
      ],
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
      newUsers: recentActivity.filter((item) => item.id.includes("user")).slice(0, 5),
      reports: recentActivity.filter((item) => item.id.includes("report")).slice(0, 5),
      failedJobs: recentActivity.filter((item) => item.id.includes("failure")).slice(0, 5),
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

    if (readString(row.status).toLowerCase() === "failed") {
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

async function countTable(table: string, range?: AdminDateRange) {
  const serviceClient = createServiceRoleClient();
  let query = serviceClient
    .from(table)
    .select("id", { count: "exact", head: true });

  if (range) {
    query = query.gte("created_at", range.fromIso).lte("created_at", range.toIso);
  }

  const { count, error } = await query;

  if (error) {
    return 0;
  }

  return count || 0;
}

async function loadRecentUsage(range: AdminDateRange) {
  const serviceClient = createServiceRoleClient();
  const { data, count } = await serviceClient
    .from("ai_usage_events")
    .select("id,endpoint,model,status,total_tokens,estimated_cost_usd,cache_hit,created_at", {
      count: "exact",
    })
    .gte("created_at", range.fromIso)
    .lte("created_at", range.toIso)
    .order("created_at", { ascending: false })
    .limit(5000);

  return {
    rows: data || [],
    totalRequests: count || (data || []).length,
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

async function loadReportDistribution() {
  const serviceClient = createServiceRoleClient();
  const { data } = await serviceClient.from("reports").select("report_type");
  const map = new Map<string, number>();

  (data || []).forEach((row) => {
    const label = readString(row.report_type, "Business Plan");
    map.set(label, (map.get(label) || 0) + 1);
  });

  return [...map.entries()].map(([label, value]) => ({ label, value }));
}

async function loadPlanDistribution() {
  const serviceClient = createServiceRoleClient();
  const { data } = await serviceClient.from("user_billing_profiles").select("plan_tier");
  const map = new Map<string, number>();

  (data || []).forEach((row) => {
    const label = normalizePlan(row.plan_tier);
    map.set(label, (map.get(label) || 0) + 1);
  });

  return [...map.entries()].map(([label, value]) => ({ label, value }));
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
      .select("created_at,amount_paid")
      .gte("created_at", range.fromIso)
      .lte("created_at", range.toIso)
      .order("created_at", { ascending: true })
      .limit(5000),
  ]);
  const usersInRange = authUsers.filter((user) => isWithinRange(user.created_at || "", range));
  const activeUsersInRange = authUsers.filter((user) => isWithinRange(user.last_sign_in_at || "", range));

  return {
    userGrowth: buildTimeSeries(usersInRange, range, "created_at"),
    activeUsers: buildTimeSeries(activeUsersInRange, range, "last_sign_in_at"),
    reportsGenerated: buildTimeSeries(reports.data || [], range, "created_at"),
    aiRequests: buildTimeSeries(usage.data || [], range, "created_at"),
    tokenUsage: buildTimeSeries(usage.data || [], range, "created_at", "total_tokens"),
    estimatedAiCost: buildTimeSeries(usage.data || [], range, "created_at", "estimated_cost_usd"),
    revenue: buildTimeSeries(revenue.data || [], range, "created_at", "amount_paid"),
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
  reportsGenerated: number;
  aiConversations: number;
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
    totalTokensToday: sumTokens(todayUsage),
    totalTokensThisMonth: sumTokens(monthUsage),
    estimatedCostToday: todayUsage.length ? todayCost : null,
    estimatedCostThisMonth: monthUsage.length ? monthCost : null,
    averageCostPerConversation: input.aiConversations > 0 ? monthCost / input.aiConversations : null,
    averageCostPerReport: input.reportsGenerated > 0 ? monthCost / input.reportsGenerated : null,
    failedAiRequests: input.usage.filter((row) => readString(row.status).toLowerCase() === "failed").length,
    costTrendPercent:
      previousCost > 0 ? ((currentCost - previousCost) / previousCost) * 100 : null,
    highestUsageUsers: [...userMap.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 5),
    highestCostRoutes: [...routeMap.values()].sort((a, b) => b.costUsd - a.costUsd).slice(0, 5),
    dateRanges: ["24 hours", "7 days", "30 days", "Custom range"],
  };
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
  if (isLocalAdminMockMode()) {
    return buildMockSystemStatus();
  }

  const now = Date.now();

  if (cachedHealth && cachedHealth.expiresAt > now) {
    return cachedHealth.data;
  }

  const serviceClient = createServiceRoleClient();
  const lastChecked = new Date().toISOString();
  const supabaseStartedAt = Date.now();
  const { error } = await serviceClient
    .from("ai_usage_events")
    .select("id", { count: "exact", head: true })
    .limit(1);
  const supabaseResponseTimeMs = Date.now() - supabaseStartedAt;
  const usageStartedAt = Date.now();
  const { data: recentUsage } = await serviceClient
    .from("ai_usage_events")
    .select("status,created_at")
    .gte("created_at", toIso(startOfUtcDay(-1)))
    .order("created_at", { ascending: false })
    .limit(100);
  const usageResponseTimeMs = Date.now() - usageStartedAt;
  const recentAiFailures = (recentUsage || []).filter(
    (row) => readString(row.status).toLowerCase() === "failed"
  ).length;
  const openAiConfigured = Boolean(process.env.OPENAI_API_KEY_PROD || process.env.OPENAI_API_KEY_DEV);
  const openAiStatus = openAiConfigured
    ? normalizeStatusFromFailureRate(recentAiFailures, (recentUsage || []).length)
    : "Not configured";
  const stripe = getStripeConfiguration();
  const resend = getResendConfiguration();

  const data: AdminSystemStatus[] = [
    {
      label: "ZERINIX API",
      status: "Operational" as const,
      detail: "Admin server rendered successfully",
      lastChecked,
      lastSuccessfulCheck: lastChecked,
      responseTimeMs: 0,
    },
    {
      label: "Supabase",
      status: error ? ("Degraded" as const) : ("Operational" as const),
      detail: error ? "Database query failed" : "Database reachable",
      lastChecked,
      lastSuccessfulCheck: error ? null : lastChecked,
      responseTimeMs: supabaseResponseTimeMs,
    },
    {
      label: "OpenAI",
      status: openAiStatus,
      detail: openAiConfigured
        ? "Inferred from configuration and recent stored AI usage"
        : "OpenAI credentials are not configured",
      lastChecked,
      lastSuccessfulCheck: openAiStatus === "Operational" ? lastChecked : null,
      responseTimeMs: openAiConfigured ? usageResponseTimeMs : null,
    },
    {
      label: "Vercel application",
      status: process.env.VERCEL ? ("Operational" as const) : ("Unknown" as const),
      detail: process.env.VERCEL ? "Running in Vercel environment" : "Deployment metadata unavailable",
      lastChecked,
      lastSuccessfulCheck: process.env.VERCEL ? lastChecked : null,
      responseTimeMs: null,
    },
    {
      label: "Cloudflare/domain",
      status: "Unknown" as const,
      detail: "No safe server-side domain probe is configured",
      lastChecked,
      lastSuccessfulCheck: null,
      responseTimeMs: null,
    },
    {
      label: "Stripe",
      status: stripe.configured && stripe.enabled ? ("Operational" as const) : ("Not configured" as const),
      detail: stripe.configured && stripe.enabled ? "Stripe configuration is present" : "Stripe production credentials are absent or disabled",
      lastChecked,
      lastSuccessfulCheck: stripe.configured && stripe.enabled ? lastChecked : null,
      responseTimeMs: null,
    },
    {
      label: "Resend",
      status: resend.configured && resend.enabled ? ("Operational" as const) : ("Not configured" as const),
      detail: resend.configured && resend.enabled ? "Resend configuration is present" : "Resend production credentials are absent or disabled",
      lastChecked,
      lastSuccessfulCheck: resend.configured && resend.enabled ? lastChecked : null,
      responseTimeMs: null,
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

  const [authData, reportsGenerated, aiConversations, usageResult, recentUsers, systemStatus, statuses] =
    await Promise.all([
      listAuthUsersForAdminScan(),
      countTable("reports", dateRange),
      countTable("ai_conversations", dateRange),
      loadRecentUsage(dateRange),
      loadAdminUsers({ page: 1, pageSize: 5 }),
      loadSystemStatus(),
      loadAllAccountStatuses(),
    ]);
  const totalUsers = authData.users.filter((user) => isWithinRange(user.created_at || "", dateRange)).length;
  const activeUsers = authData.users.filter(
    (user) =>
      user.last_sign_in_at &&
      isWithinRange(user.last_sign_in_at, dateRange) &&
      statuses.get(user.id) !== "suspended"
  ).length;
  const usage = usageResult.rows;
  const aiApiCost = usage.reduce(
    (sum, row) => sum + readNumber(row.estimated_cost_usd),
    0
  );
  const failedRequests = usage.filter((row) => readString(row.status) === "failed");
  const [charts, recentActivity] = await Promise.all([
    loadAdminChartData(authData.users, dateRange),
    loadRecentActivity(authData.users, dateRange),
  ]);
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

  return {
    dateRange,
    totalUsers,
    activeUsers,
    reportsGenerated,
    aiConversations,
    monthlyRecurringRevenue: null,
    aiApiCost,
    userGrowth: await loadUserGrowth(),
    reportTypeDistribution: await loadReportDistribution(),
    planDistribution: await loadPlanDistribution(),
    recentUsers: recentUsers.users,
    recentActivity,
    charts,
    revenueOverview: buildRevenueOverview(),
    costControl: calculateCostControl({
      usage,
      reportsGenerated,
      aiConversations,
    }),
    usageSummary,
    recentErrors,
    systemStatus,
    exportTables: buildExportTables({
      recentUsers: recentUsers.users,
      recentActivity,
      recentErrors,
      usageSummary,
      charts,
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
          .select("id,stripe_invoice_id,status,amount_paid,currency,created_at")
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
        detail: `${readString(row.status, "unknown")} · ${readNumber(row.amount_paid)} ${readString(row.currency, "usd").toUpperCase()}`,
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
