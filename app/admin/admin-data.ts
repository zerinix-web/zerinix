import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/app/lib/supabase/server";
import { createServiceRoleClient } from "@/app/lib/supabase/admin";

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
  estimatedAiCostUsd: number;
};

export type AdminDashboardData = {
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
  usageSummary: {
    totalRequests: number;
    totalTokens: number;
    cacheHits: number;
    failedRequests: number;
  };
  recentErrors: Array<{ id: string; endpoint: string; status: string; createdAt: string }>;
  systemStatus: Array<{ label: string; status: string; detail: string }>;
};

const ADMIN_CLAIMS = new Set(["admin", "owner"]);
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;
let cachedHealth:
  | { expiresAt: number; data: Array<{ label: string; status: string; detail: string }> }
  | null = null;

function readString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
      .select("user_id,estimated_cost_usd")
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

  return {
    planMap,
    statusMap,
    reportCountMap: buildCountMap(reports.data || [], "user_id"),
    conversationCountMap: buildCountMap(conversations.data || [], "user_id"),
    costMap: buildCountMap(usage.data || [], "user_id", "estimated_cost_usd"),
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
    estimatedAiCostUsd: aggregates.costMap.get(user.id) || 0,
  };
}

export async function loadAdminUsers(input: {
  page?: number;
  pageSize?: number;
  search?: string;
}) {
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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return null;
  }

  const serviceClient = createServiceRoleClient();
  const { data, error } = await serviceClient.auth.admin.getUserById(userId);

  if (error || !data.user) {
    return null;
  }

  const aggregates = await loadUserAggregates([userId]);
  const [reports, conversations, audit] = await Promise.all([
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
    auditLog: audit.data || [],
  };
}

async function countTable(table: string) {
  const serviceClient = createServiceRoleClient();
  const { count, error } = await serviceClient
    .from(table)
    .select("id", { count: "exact", head: true });

  if (error) {
    return 0;
  }

  return count || 0;
}

async function loadRecentUsage() {
  const serviceClient = createServiceRoleClient();
  const { data } = await serviceClient
    .from("ai_usage_events")
    .select("id,endpoint,status,total_tokens,estimated_cost_usd,cache_hit,created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  return data || [];
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
  const authData = await listAuthUsers(1, 1000);
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

export async function loadSystemStatus() {
  const now = Date.now();

  if (cachedHealth && cachedHealth.expiresAt > now) {
    return cachedHealth.data;
  }

  const serviceClient = createServiceRoleClient();
  const { error } = await serviceClient
    .from("ai_usage_events")
    .select("id", { count: "exact", head: true })
    .limit(1);

  const data = [
    {
      label: "Supabase",
      status: error ? "Needs attention" : "Operational",
      detail: error ? "Database query failed" : "Database reachable",
    },
    {
      label: "OpenAI",
      status: process.env.OPENAI_API_KEY_PROD || process.env.OPENAI_API_KEY_DEV ? "Configured" : "Not configured",
      detail: "No live provider call is made from admin health checks",
    },
    {
      label: "Storage",
      status: "Not configured",
      detail: "No dedicated storage integration is configured yet",
    },
    {
      label: "Email service",
      status: "Not configured",
      detail: "Transactional email provider is not connected yet",
    },
    {
      label: "Payment service",
      status: "Not configured",
      detail: "Stripe/payment provider is not connected yet",
    },
  ];

  cachedHealth = {
    expiresAt: now + 30_000,
    data,
  };

  return data;
}

export async function loadAdminDashboardData(): Promise<AdminDashboardData> {
  const [authData, reportsGenerated, aiConversations, usage, recentUsers, systemStatus] =
    await Promise.all([
      listAuthUsers(1, 1000),
      countTable("reports"),
      countTable("ai_conversations"),
      loadRecentUsage(),
      loadAdminUsers({ page: 1, pageSize: 5 }),
      loadSystemStatus(),
    ]);
  const totalUsers = authData.total;
  const activeUsers = authData.users.filter((user) => user.last_sign_in_at).length;
  const aiApiCost = usage.reduce(
    (sum, row) => sum + readNumber(row.estimated_cost_usd),
    0
  );
  const failedRequests = usage.filter((row) => readString(row.status) === "failed");

  return {
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
    usageSummary: {
      totalRequests: usage.length,
      totalTokens: usage.reduce((sum, row) => sum + readNumber(row.total_tokens), 0),
      cacheHits: usage.filter((row) => Boolean(row.cache_hit)).length,
      failedRequests: failedRequests.length,
    },
    recentErrors: failedRequests.slice(0, 6).map((row) => ({
      id: readString(row.id),
      endpoint: readString(row.endpoint, "unknown"),
      status: readString(row.status, "failed"),
      createdAt: readString(row.created_at),
    })),
    systemStatus,
  };
}

export async function writeAdminAuditLog(input: {
  adminUserId: string;
  action: string;
  targetUserId?: string;
  metadata?: Record<string, unknown>;
}) {
  const serviceClient = createServiceRoleClient();

  await serviceClient.from("admin_audit_log").insert({
    admin_user_id: input.adminUserId,
    action: input.action,
    target_user_id: input.targetUserId ?? null,
    metadata: input.metadata ?? {},
  });
}
