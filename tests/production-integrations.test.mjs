import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const envExample = readFileSync(".env.example", "utf8");
const integrationConfig = readFileSync("app/lib/integrations/config.ts", "utf8");
const integrationAudit = readFileSync("app/lib/integrations/audit.ts", "utf8");
const resend = readFileSync("app/lib/integrations/resend.ts", "utf8");
const storage = readFileSync("app/lib/integrations/storage.ts", "utf8");
const notifications = readFileSync("app/lib/integrations/notifications.ts", "utf8");
const stripe = readFileSync("app/lib/billing/stripe.ts", "utf8");

test("production integration environment variables are documented", () => {
  for (const name of [
    "ENABLE_STRIPE_BILLING",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ZERINIX_VERBOSE_LOGS",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "STRIPE_PRICE_PRO",
    "STRIPE_PRICE_BUSINESS",
    "ENABLE_RESEND_EMAILS",
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "RESEND_REPLY_TO_EMAIL",
    "RESEND_MAX_RETRIES",
    "ENABLE_SUPABASE_STORAGE",
    "SUPABASE_STORAGE_AVATAR_BUCKET",
    "SUPABASE_STORAGE_USER_FILES_BUCKET",
    "ENABLE_IN_APP_NOTIFICATIONS",
  ]) {
    assert.match(envExample, new RegExp(`^${name}=`, "m"));
  }
});

test("central integration config reports missing secrets without exposing values", () => {
  assert.match(integrationConfig, /getProductionIntegrationStatuses/);
  assert.match(integrationConfig, /readRequiredEnv/);
  assert.match(integrationConfig, /integrationNotConfigured/);
  assert.match(integrationConfig, /missing/);
  assert.doesNotMatch(integrationConfig, /process\.env\[[^\]]+\]\s*\}/);
});

test("stripe foundation supports checkout portal webhooks sync and usage without client secrets", () => {
  assert.match(stripe, /createStripeCheckoutSession/);
  assert.match(stripe, /createStripeCustomerPortalSession/);
  assert.match(stripe, /verifyStripeWebhookSignature/);
  assert.match(stripe, /normalizeStripeSubscriptionForSync/);
  assert.match(stripe, /normalizeStripeInvoiceForSync/);
  assert.match(stripe, /buildStripeUsageRecord/);
  assert.match(stripe, /Idempotency-Key/);
  assert.match(stripe, /assertStripeCustomerOwnership/);
  assert.doesNotMatch(stripe, /NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY[\s\S]{0,80}Authorization/);
});

test("resend integration is server-only and refuses to send when disabled", () => {
  assert.match(resend, /import "server-only"/);
  assert.match(resend, /getResendConfiguration/);
  assert.match(resend, /ENABLE_RESEND_EMAILS/);
  assert.match(resend, /integrationNotConfigured\("Resend"/);
  assert.match(resend, /email_verification/);
  assert.match(resend, /password_reset/);
  assert.match(resend, /welcome/);
  assert.match(resend, /workspace_invitation/);
  assert.match(resend, /report_ready/);
  assert.match(resend, /billing_receipt/);
  assert.match(resend, /subscription/);
  assert.match(resend, /security_alert/);
  assert.doesNotMatch(resend, /NEXT_PUBLIC_RESEND|RESEND_API_KEY.*return/);
});

test("storage integration validates ownership before signed reads", () => {
  assert.match(storage, /import "server-only"/);
  assert.match(storage, /SUPABASE_STORAGE_AVATAR_BUCKET/);
  assert.match(storage, /SUPABASE_STORAGE_USER_FILES_BUCKET/);
  assert.match(storage, /createSignedUserUploadUrl/);
  assert.match(storage, /createOwnedSignedReadUrl/);
  assert.match(storage, /assertUserOwnsStoragePath/);
  assert.match(storage, /path\.startsWith\(`\$\{userId\}\/`\)/);
  assert.match(storage, /!\s*path\.includes\("\.\."\)/);
});

test("notification foundation supports email and in-app read state without fake data", () => {
  assert.match(notifications, /getNotificationConfiguration/);
  assert.match(notifications, /createInAppNotification/);
  assert.match(notifications, /markNotificationRead/);
  assert.match(notifications, /sendEmailNotification/);
  assert.match(notifications, /read_at/);
  assert.match(notifications, /eq\("user_id", input\.userId\)/);
  assert.match(notifications, /integrationNotConfigured\("In-app notifications"/);
});

test("integration audit logging redacts sensitive metadata", () => {
  assert.match(integrationAudit, /recordIntegrationAuditEvent/);
  assert.match(integrationAudit, /admin_audit_log/);
  assert.match(integrationAudit, /secret\|token\|key\|password\|card\|authorization/i);
  assert.match(integrationAudit, /\[redacted\]/);
});
