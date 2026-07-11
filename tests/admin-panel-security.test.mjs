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

  assert.match(dashboard, /Total AI requests/);
  assert.match(dashboard, /Token usage/);
  assert.match(dashboard, /Recent activity/);
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

  assert.match(route, /loadSystemStatus/);
  assert.match(adminData, /cachedHealth/);
  assert.match(adminData, /expiresAt: now \+ 30_000/);
  assert.match(adminData, /No live provider call is made from admin health checks/);
  assert.doesNotMatch(adminData, /createOpenAiClient|responses\.create|fetch\(/);
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

test("admin navigation includes required modules with coming-soon fallbacks", () => {
  const shell = read("app/admin/AdminShell.tsx");
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
    assert.match(shell, new RegExp(label));
  }

  assert.match(sectionPage, /AdminComingSoon/);
  assert.match(shell, /not configured yet/i);
});
