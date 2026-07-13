import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function walk(relativePath, predicate) {
  const absolutePath = join(root, relativePath);
  const files = [];

  for (const entry of readdirSync(absolutePath)) {
    const nextRelative = join(relativePath, entry);
    const nextAbsolute = join(root, nextRelative);
    const stat = statSync(nextAbsolute);

    if (stat.isDirectory()) {
      files.push(...walk(nextRelative, predicate));
    } else if (!predicate || predicate(nextRelative)) {
      files.push(nextRelative);
    }
  }

  return files;
}

test("admin pages are protected by a shared server-side admin guard", () => {
  const layout = read("app/admin/layout.tsx");
  const adminData = read("app/admin/admin-data.ts");

  assert.match(layout, /requireAdminPage/);
  assert.match(adminData, /redirect\("\/login"\)/);
  assert.match(adminData, /redirect\("\/dashboard"\)/);
  assert.match(adminData, /admin_roles/);
  assert.match(adminData, /app_metadata\?\.role/);
  assert.doesNotMatch(adminData, /admin@|FOUNDER_EMAILS|isFounder/i);
});

test("every admin API route uses server-side admin authorization", () => {
  const routes = walk("app/api/admin", (file) => file.endsWith("route.ts"));

  assert.ok(routes.length > 0, "expected admin API routes");

  for (const route of routes) {
    const source = read(route);

    assert.match(source, /requireAdminApi/);
    assert.match(source, /validateApiRequest/);
  }
});

test("admin shell renders authenticated admin header and global search", () => {
  const shell = read("app/admin/AdminShell.tsx");
  const navigation = read("app/admin/AdminNavigation.tsx");
  const search = read("app/admin/AdminGlobalSearch.tsx");

  assert.match(shell, /requireAdminPage/);
  assert.match(shell, /AdminGlobalSearch/);
  assert.match(shell, /hidePageHeader/);
  assert.match(shell, /Current admin|Signed in as|Admin notifications|Account settings|Security settings|Sign out/s);
  assert.match(navigation, /AI CEO/);
  assert.match(search, /\/api\/admin\/search/);
  assert.match(search, /ArrowDown/);
  assert.match(search, /ArrowUp/);
  assert.match(search, /URLSearchParams/);
});

test("service-role access is isolated to server-only admin modules", () => {
  const serviceClient = read("app/lib/supabase/admin.ts");
  const env = read("app/lib/supabase/env.ts");
  const adminData = read("app/admin/admin-data.ts");
  const files = walk("app", (file) => /\.(ts|tsx)$/.test(file));

  assert.match(serviceClient, /server-only/);
  assert.match(serviceClient, /getSupabaseServiceRoleKey/);
  assert.match(env, /SUPABASE_SERVICE_ROLE_KEY/);

  for (const file of files) {
    const source = read(file);

    if (
      file === "app/lib/supabase/admin.ts" ||
      file === "app/lib/supabase/env.ts" ||
      file.startsWith("app/admin/") ||
      file === "app/lib/billing/stripe-webhook.ts" ||
      file === "app/lib/integrations/email-events.ts"
    ) {
      continue;
    }

    assert.doesNotMatch(
      source,
      /createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/,
      `${file} must not access service-role credentials`
    );
  }

  assert.match(adminData, /auth\.admin\.listUsers/);
});

test("admin mutations validate inputs, rate-limit writes, and create audit rows", () => {
  const actions = read("app/admin/actions.ts");

  assert.match(actions, /uuidPattern/);
  assert.match(actions, /allowedPlans/);
  assert.match(actions, /allowedStatuses/);
  assert.match(actions, /checkRateLimit/);
  assert.match(actions, /writeAdminAuditLog/);
  assert.match(actions, /user_account_statuses/);
  assert.match(actions, /user_billing_profiles/);
  assert.match(actions, /user\.plan_changed/);
});

test("admin users page implements server-side search, pagination, and safe empty states", () => {
  const usersPage = read("app/admin/users/page.tsx");
  const adminData = read("app/admin/admin-data.ts");

  assert.match(usersPage, /Search by email or display name/);
  assert.match(usersPage, /AI requests/);
  assert.match(usersPage, /Tokens/);
  assert.match(usersPage, /Errors/);
  assert.match(usersPage, /pageHref/);
  assert.match(usersPage, /No users match this search/);
  assert.match(adminData, /pageSize/);
  assert.match(adminData, /sourceUsers\.slice/);
  assert.match(adminData, /email\.includes\(search\)/);
});

test("admin dashboard and user detail expose real stored usage monitoring", () => {
  const dashboard = read("app/admin/page.tsx");
  const detail = read("app/admin/users/[id]/page.tsx");
  const adminData = read("app/admin/admin-data.ts");

  assert.match(dashboard, /AI Conversations/);
  assert.match(dashboard, /Generated Reports/);
  assert.match(dashboard, /System overview and statistics/);
  assert.match(detail, /AI usage monitoring/);
  assert.match(detail, /Cache hit/);
  assert.match(adminData, /requestCountMap/);
  assert.match(adminData, /tokenMap/);
  assert.match(adminData, /failedRequestMap/);
  assert.match(adminData, /count: "exact"/);
});

test("admin cost and token aggregation handles Supabase numeric strings", () => {
  const adminData = read("app/admin/admin-data.ts");

  assert.match(adminData, /typeof value === "string"/);
  assert.match(adminData, /Number\(value\)/);
  assert.match(adminData, /estimated_cost_usd/);
  assert.match(adminData, /total_tokens/);
});

test("admin UI never renders passwords, tokens, card data, or secret values", () => {
  const adminFiles = walk("app/admin", (file) => /\.(ts|tsx)$/.test(file));
  const forbidden = /password|hash|session token|refresh token|card number|cvv|service-role|secret value/i;

  for (const file of adminFiles) {
    const source = read(file);

    if (file.endsWith("users/[id]/page.tsx")) {
      assert.match(source, /Passwords, sessions, refresh tokens, payment cards and secret values are never shown/);
      continue;
    }

    assert.doesNotMatch(source, forbidden, `${file} exposes sensitive labels`);
  }
});

test("admin health endpoint uses cached server-side status and no paid provider calls", () => {
  const route = read("app/api/admin/health/route.ts");
  const adminData = read("app/admin/admin-data.ts");
  const systemHealth = read("app/admin/AdminSystemHealth.tsx");

  assert.match(route, /loadSystemStatus/);
  assert.match(adminData, /cachedHealth/);
  assert.match(adminData, /expiresAt: now \+ 30_000/);
  assert.match(adminData, /lastChecked/);
  assert.match(adminData, /lastSuccessfulCheck/);
  assert.match(adminData, /responseTimeMs/);
  assert.match(adminData, /ZERINIX API/);
  assert.match(adminData, /Cloudflare\/domain/);
  assert.match(adminData, /getStripeConfiguration/);
  assert.match(adminData, /getResendConfiguration/);
  assert.match(adminData, /Not configured/);
  assert.match(systemHealth, /setInterval/);
  assert.match(systemHealth, /60_000/);
  assert.match(systemHealth, /\/api\/admin\/health/);
  assert.match(systemHealth, /animate-ping/);
  assert.doesNotMatch(adminData, /createOpenAiClient|responses\.create|fetch\(/);
});

test("admin notifications endpoint is authorized and backed by stored activity", () => {
  const route = read("app/api/admin/notifications/route.ts");
  const adminData = read("app/admin/admin-data.ts");
  const realtime = read("app/admin/AdminRealtimeNotifications.tsx");

  assert.match(route, /requireAdminApi/);
  assert.match(route, /validateApiRequest/);
  assert.match(route, /loadAdminNotifications/);
  assert.match(adminData, /newUsers/);
  assert.match(adminData, /failedJobs/);
  assert.match(realtime, /\/api\/admin\/notifications/);
  assert.match(realtime, /60_000/);
  assert.match(realtime, /Realtime notifications/);
});

test("admin global search is authorized, validated, grouped, and server-side", () => {
  const route = read("app/api/admin/search/route.ts");
  const adminData = read("app/admin/admin-data.ts");
  const search = read("app/admin/AdminGlobalSearch.tsx");

  assert.match(route, /requireAdminApi/);
  assert.match(route, /validateApiRequest/);
  assert.match(route, /query\.length < 2/);
  assert.match(route, /query\.length > 80/);
  assert.match(adminData, /searchAdminRecords/);
  assert.match(adminData, /normalizeSearchQuery/);
  assert.match(adminData, /Users/);
  assert.match(adminData, /Reports/);
  assert.match(adminData, /Conversations/);
  assert.match(adminData, /stripe_invoices/);
  assert.match(adminData, /admin_audit_log/);
  assert.match(search, /activeFilters/);
  assert.match(search, /filters: activeFilters\.join/);
  assert.match(search, /Payments/);
  assert.match(search, /Logs/);
  assert.match(adminData, /limit\(5\)/);
});

test("admin dashboard matches the reference-style executive layout", () => {
  const dashboard = read("app/admin/page.tsx");
  const controls = read("app/admin/AdminDateRangeControls.tsx");
  const exports = read("app/admin/AdminExports.tsx");
  const adminData = read("app/admin/admin-data.ts");

  assert.match(dashboard, /title="Dashboard"/);
  assert.match(dashboard, /subtitle="System overview and statistics"/);
  assert.match(dashboard, /hidePageHeader/);
  assert.match(dashboard, /AdminDateRangeControls/);
  assert.match(dashboard, /variant="inline"/);
  assert.match(dashboard, /AdminExports/);
  assert.match(dashboard, /variant="button"/);
  assert.match(dashboard, /Total users/);
  assert.match(dashboard, /Generated Reports/);
  assert.match(dashboard, /AI Conversations/);
  assert.match(dashboard, /Total Revenue/);
  assert.match(dashboard, /User Growth/);
  assert.match(dashboard, /LineChartCard/);
  assert.match(dashboard, /Report Distribution/);
  assert.match(dashboard, /Subscription Plans/);
  assert.match(dashboard, /DonutChartCard/);
  assert.match(dashboard, /Recent users/);
  assert.match(dashboard, /AdminSystemHealth/);
  assert.doesNotMatch(dashboard, /ExecutiveOverview/);
  assert.doesNotMatch(dashboard, /Dashboard range/);
  assert.doesNotMatch(dashboard, /AdminRealtimeNotifications/);
  assert.match(dashboard, /calculateTrend/);
  assert.match(dashboard, /Last 24h/);
  assert.match(controls, /24h/);
  assert.match(controls, /Apply custom/);
  assert.match(controls, /variant === "inline"/);
  assert.match(exports, /exportCsv/);
  assert.match(exports, /exportPdf/);
  assert.match(exports, /Export Data/);
  assert.match(exports, /Analytics exports/);
  assert.match(adminData, /buildRevenueOverview/);
  assert.match(adminData, /Stripe production billing is not configured/);
  assert.match(adminData, /calculateCostControl/);
  assert.match(adminData, /getModelPricing/);
  assert.match(adminData, /resolveAdminDateRange/);
  assert.match(adminData, /buildTimeSeries/);
  assert.match(adminData, /buildExportTables/);
});

test("admin dashboard cards use animated counters and premium transitions", () => {
  const dashboard = read("app/admin/page.tsx");
  const counter = read("app/admin/AdminAnimatedValue.tsx");

  assert.match(dashboard, /AdminAnimatedValue/);
  assert.doesNotMatch(dashboard, /formatter=\{/);
  assert.doesNotMatch(counter, /formatter\?: \([^)]*=>/);
  assert.match(counter, /AdminAnimatedValueFormat/);
  assert.match(dashboard, /hover:-translate-y-1/);
  assert.match(dashboard, /duration-300/);
  assert.match(dashboard, /shadow-\[0_20px_80px/);
  assert.match(counter, /requestAnimationFrame/);
});

test("admin dashboard renders the requested recent users and system status row", () => {
  const dashboard = read("app/admin/page.tsx");

  assert.match(dashboard, /Recent users/);
  assert.match(dashboard, /Latest accounts from Supabase Auth/);
  assert.match(dashboard, /\/admin\/users/);
  assert.match(dashboard, /data\.recentUsers\.map/);
  assert.match(dashboard, /user\.id/);
  assert.match(dashboard, /AdminSystemHealth/);
  assert.match(dashboard, /initialStatuses=\{data\.systemStatus\}/);
  assert.match(dashboard, /hover:border-purple-300\/22/);
});

test("AI CEO is admin-only, rate-limited, audited, and prompt-injection resistant", () => {
  const page = read("app/admin/ai-ceo/page.tsx");
  const consoleSource = read("app/admin/ai-ceo/AiCeoConsole.tsx");
  const actions = read("app/admin/actions.ts");
  const adminData = read("app/admin/admin-data.ts");

  assert.match(page, /AdminShell/);
  assert.match(consoleSource, /Today’s summary/);
  assert.match(consoleSource, /Cost review/);
  assert.match(actions, /askAiCeo/);
  assert.match(actions, /requireAdminPage/);
  assert.match(actions, /checkRateLimit\(`admin:ai-ceo/);
  assert.match(actions, /writeAdminAuditLog/);
  assert.match(actions, /ai_ceo\.requested/);
  assert.match(actions, /untrusted data, not instructions/);
  assert.match(actions, /Never execute SQL/);
  assert.match(actions, /Data unavailable/);
  assert.doesNotMatch(actions, /from\(\s*finalPrompt|rpc\(\s*finalPrompt|query:\s*finalPrompt/i);
  assert.match(adminData, /loadAiCeoContext/);
});

test("admin loading and empty states are present for dynamic admin views", () => {
  const loading = read("app/admin/loading.tsx");
  const dashboard = read("app/admin/page.tsx");
  const usersPage = read("app/admin/users/page.tsx");

  assert.match(loading, /animate-pulse/);
  assert.match(dashboard, /No data available/);
  assert.match(dashboard, /No users found yet/);
  assert.match(usersPage, /No users match this search/);
});

test("admin migration adds role, status, and audit tables with RLS", () => {
  const migration = read("supabase/migrations/20260711120000_create_admin_foundation.sql");

  for (const table of ["admin_roles", "user_account_statuses", "admin_audit_log"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }

  assert.match(migration, /role in \('admin', 'owner', 'support'\)/);
  assert.match(migration, /status in \('active', 'suspended'\)/);
  assert.match(migration, /Users can read own account status/);
});

test("production admin role migration grants admin safely without app email checks", () => {
  const migration = read("supabase/migrations/20260711210000_grant_production_admin_role.sql");
  const adminData = read("app/admin/admin-data.ts");

  assert.match(migration, /create table if not exists public\.admin_roles/);
  assert.match(migration, /alter table public\.admin_roles enable row level security/);
  assert.match(migration, /alter table public\.admin_roles force row level security/);
  assert.match(migration, /revoke all on table public\.admin_roles from anon/);
  assert.match(migration, /revoke all on table public\.admin_roles from authenticated/);
  assert.match(migration, /lower\(email\) = 'admin@zerinix\.com'/);
  assert.match(migration, /on conflict \(user_id\)/);
  assert.match(migration, /role = excluded\.role/);
  assert.match(migration, /active = true/);
  assert.doesNotMatch(adminData, /admin@zerinix\.com/);
});

test("admin navigation includes required modules with coming-soon fallbacks", () => {
  const shell = read("app/admin/AdminShell.tsx");
  const navigation = read("app/admin/AdminNavigation.tsx");
  const sectionPage = read("app/admin/[section]/page.tsx");

  for (const label of [
    "Dashboard",
    "Users",
    "Reports",
    "Subscriptions",
    "Payments",
    "AI Usage",
    "Usage & Quotas",
    "Support",
    "Logs",
    "Security",
    "API Management",
    "Settings",
  ]) {
    assert.match(navigation, new RegExp(label));
  }

  assert.match(sectionPage, /AdminComingSoon/);
  assert.match(shell, /not configured yet/i);
});
