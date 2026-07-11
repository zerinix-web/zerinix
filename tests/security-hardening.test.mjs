import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function walkFiles(relativePath, predicate) {
  const absolutePath = join(root, relativePath);
  const entries = readdirSync(absolutePath);
  const files = [];

  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") {
      continue;
    }

    const nextRelative = join(relativePath, entry);
    const nextAbsolute = join(root, nextRelative);
    const stat = statSync(nextAbsolute);

    if (stat.isDirectory()) {
      files.push(...walkFiles(nextRelative, predicate));
    } else if (!predicate || predicate(nextRelative)) {
      files.push(nextRelative);
    }
  }

  return files;
}

test("production security headers are configured with development-safe exceptions", () => {
  const config = read("next.config.ts");

  for (const header of [
    "Content-Security-Policy",
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
    "Permissions-Policy",
    "Strict-Transport-Security",
  ]) {
    assert.match(config, new RegExp(header));
  }

  assert.match(config, /frame-ancestors 'none'/);
  assert.match(config, /object-src 'none'/);
  assert.match(config, /base-uri 'self'/);
  assert.match(config, /same-origin/);
  assert.match(config, /upgrade-insecure-requests/);
  assert.match(config, /!\s*isDevelopment/);
});

test("AI API routes validate origin and request size before parsing JSON", () => {
  const routes = [
    "app/api/chat/route.ts",
    "app/api/plan/route.ts",
    "app/api/market-analysis/route.ts",
  ];

  for (const route of routes) {
    const source = read(route);
    const validationIndex = source.indexOf("validateApiRequest(req");
    const jsonIndex = source.indexOf("req.json()");

    assert.notEqual(validationIndex, -1, `${route} must validate the request`);
    assert.notEqual(jsonIndex, -1, `${route} must parse JSON`);
    assert.ok(
      validationIndex < jsonIndex,
      `${route} must validate before req.json()`
    );
  }

  const validator = read("app/lib/security/request-validation.ts");
  assert.match(validator, /Cross-origin requests are not allowed/);
  assert.match(validator, /Request body is too large/);
  assert.match(validator, /content-length/);
  assert.match(validator, /origin/);
});

test("operational API routes validate requests and disable response caching", () => {
  const routes = [
    "app/api/admin/health/route.ts",
    "app/api/reports/[id]/notify/route.ts",
    "app/api/workspace-invitations/route.ts",
  ];
  const responseHelper = read("app/lib/security/api-response.ts");

  assert.match(responseHelper, /Cache-Control/);
  assert.match(responseHelper, /no-store/);
  assert.match(responseHelper, /Pragma/);

  for (const route of routes) {
    const source = read(route);

    assert.match(source, /validateApiRequest/);
    assert.match(source, /noStoreJson/);
  }

  const stripeWebhook = read("app/api/stripe/webhook/route.ts");

  assert.match(stripeWebhook, /noStoreJson/);
  assert.match(stripeWebhook, /handleStripeWebhookPayload/);
});

test("chat file attachments are bounded and sanitized on the server", () => {
  const source = read("app/api/chat/route.ts");

  assert.match(source, /MAX_CHAT_ATTACHMENTS\s*=\s*6/);
  assert.match(source, /MAX_ATTACHMENT_SIZE_BYTES\s*=\s*5_000_000/);
  assert.match(source, /MAX_ATTACHMENT_TEXT_BYTES\s*=\s*20_000/);
  assert.match(source, /sanitizeAttachmentName/);
  assert.match(source, /getAttachmentValidationError/);
  assert.match(source, /Attachment is too large/);
  assert.match(source, /Attachment text is too large/);
});

test("authentication diagnostics and signup errors do not expose sensitive internals", () => {
  const proxy = read("app/lib/supabase/proxy.ts");
  const serverGuard = read("app/auth/server-guard.ts");
  const actions = read("app/auth/actions.ts");

  assert.doesNotMatch(proxy, /\[auth-guard:/);
  assert.doesNotMatch(serverGuard, /\[auth-guard:/);
  assert.doesNotMatch(actions, /stack:/);
  assert.doesNotMatch(actions, /raw:/);
  assert.doesNotMatch(actions, /cause=\$\{/);
  assert.match(actions, /registration_disabled/);
  assert.doesNotMatch(actions, /\.signUp\(/);
});

test("Supabase migrations enforce RLS ownership for core user data", () => {
  const migrations = walkFiles("supabase/migrations", (file) =>
    file.endsWith(".sql")
  )
    .map(read)
    .join("\n");

  for (const table of [
    "ai_conversations",
    "ai_messages",
    "reports",
    "report_workspaces",
    "ai_chat_profiles",
    "ai_usage_events",
    "ai_response_cache",
  ]) {
    assert.match(
      migrations,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
      `${table} must enable RLS`
    );
  }

  assert.match(migrations, /auth\.uid\(\) = user_id/i);
  assert.match(migrations, /ai_conversations\.user_id = auth\.uid\(\)/i);
  assert.match(migrations, /report_workspaces\.user_id = auth\.uid\(\)/i);
});

test("client-rendered files do not reference server-only secrets", () => {
  const files = walkFiles("app", (file) => /\.(ts|tsx|js|jsx)$/.test(file))
    .concat(walkFiles("components", (file) => /\.(ts|tsx|js|jsx)$/.test(file)));
  const forbidden = /OPENAI_API_KEY|SUPABASE_SERVICE|SERVICE_ROLE|DATABASE_URL/;

  for (const file of files) {
    const source = read(file);

    if (source.includes('"use client"') || file.startsWith("components/")) {
      assert.doesNotMatch(source, forbidden, `${file} exposes a server secret`);
    }
  }
});

test("code block HTML rendering escapes user code before syntax highlighting", () => {
  for (const file of ["components/Planner.tsx", "components/AIChatWorkspace.tsx"]) {
    const source = read(file);
    const functionStart = source.indexOf("function highlightCode");
    const functionEnd = source.indexOf("function CodeBlock", functionStart);
    const highlightSource = source.slice(functionStart, functionEnd);

    assert.ok(highlightSource.includes('.replace(/&/g, "&amp;")'));
    assert.ok(highlightSource.includes('.replace(/</g, "&lt;")'));
    assert.ok(highlightSource.includes('.replace(/>/g, "&gt;")'));
  }
});

test("OpenAI key selection never falls back across environments", () => {
  const source = read("app/lib/ai/runtime.ts");

  assert.match(source, /OPENAI_API_KEY_DEV/);
  assert.match(source, /OPENAI_API_KEY_PROD/);
  assert.match(source, /must not be present during development AI calls/);
  assert.match(source, /must not be present during production AI calls/);
  assert.match(source, /AI_TEST_MODE/);
});
