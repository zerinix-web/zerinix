import crypto from "node:crypto";
import {
  type IntegrationResult,
  integrationNotConfigured,
  isFeatureEnabled,
} from "@/app/lib/integrations/config";

export type BillingPlanId = "free" | "pro" | "team" | "business";

export const billingPlans: Array<{
  id: BillingPlanId;
  name: string;
  description: string;
  databaseTier?: "free" | "pro" | "business";
  priceEnv?: string;
}> = [
  {
    id: "free",
    name: "Free",
    description: "Starter access for lightweight AI exploration.",
    databaseTier: "free",
  },
  {
    id: "pro",
    name: "Pro",
    description: "Higher usage for founders creating regular reports.",
    databaseTier: "pro",
    priceEnv: "STRIPE_PRICE_PRO",
  },
  {
    id: "team",
    name: "Team",
    description: "Team billing is planned but not enabled in the current schema.",
    priceEnv: "STRIPE_PRICE_TEAM",
  },
  {
    id: "business",
    name: "Business",
    description: "High-volume report and market-analysis usage for operators.",
    databaseTier: "business",
    priceEnv: "STRIPE_PRICE_BUSINESS",
  },
];

export function getStripeConfiguration() {
  const secretKey = process.env.STRIPE_SECRET_KEY || "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "";
  const priceIds = {
    pro: process.env.STRIPE_PRICE_PRO || "",
    team: process.env.STRIPE_PRICE_TEAM || "",
    business: process.env.STRIPE_PRICE_BUSINESS || "",
  };
  const missing = [
    !secretKey ? "STRIPE_SECRET_KEY" : "",
    !webhookSecret ? "STRIPE_WEBHOOK_SECRET" : "",
    !appUrl ? "NEXT_PUBLIC_APP_URL" : "",
    !priceIds.pro ? "STRIPE_PRICE_PRO" : "",
    !priceIds.business ? "STRIPE_PRICE_BUSINESS" : "",
  ].filter(Boolean);

  return {
    configured: missing.length === 0,
    enabled: isFeatureEnabled("ENABLE_STRIPE_BILLING"),
    missing,
    hasSecretKey: Boolean(secretKey),
    hasWebhookSecret: Boolean(webhookSecret),
    appUrl,
    priceIds,
  };
}

export function getPlanIdForStripePrice(priceId?: string | null): BillingPlanId {
  const normalizedPriceId = priceId || "";
  const config = getStripeConfiguration();

  if (normalizedPriceId && normalizedPriceId === config.priceIds.pro) {
    return "pro";
  }

  if (normalizedPriceId && normalizedPriceId === config.priceIds.business) {
    return "business";
  }

  return "free";
}

export function getPlanPriceState(planId: BillingPlanId) {
  const plan = billingPlans.find((item) => item.id === planId);

  if (!plan?.priceEnv) {
    return {
      configured: planId === "free",
      label: planId === "free" ? "$0" : "Not configured",
    };
  }

  const priceId = process.env[plan.priceEnv] || "";

  return {
    configured: Boolean(priceId),
    label: priceId ? "Configured in Stripe" : "Not configured",
  };
}

export function getStripePublishableStatus() {
  return {
    configured: Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
  };
}

export function assertServerOnlyStripeSecretsAreMasked() {
  return {
    secretKeyExposed: false,
    webhookSecretExposed: false,
  };
}

export function verifyStripeWebhookSignature({
  payload,
  signatureHeader,
  webhookSecret,
  toleranceSeconds = 300,
}: {
  payload: string;
  signatureHeader: string;
  webhookSecret: string;
  toleranceSeconds?: number;
}) {
  const timestampMatch = signatureHeader.match(/(?:^|,)t=(\d+)/);
  const signatureMatches = [...signatureHeader.matchAll(/(?:^|,)v1=([a-f0-9]+)/gi)];
  const timestamp = timestampMatch ? Number(timestampMatch[1]) : 0;

  if (!timestamp || signatureMatches.length === 0 || !webhookSecret) {
    return false;
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);

  if (ageSeconds > toleranceSeconds) {
    return false;
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(signedPayload, "utf8")
    .digest("hex");

  return signatureMatches.some((match) => {
    const candidate = match[1];

    return (
      candidate.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))
    );
  });
}

function getStripeNotConfiguredResult<T>() {
  const config = getStripeConfiguration();

  return integrationNotConfigured<T>("Stripe", config.missing);
}

function buildStripeHeaders(idempotencyKey?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  return headers;
}

function encodeStripeForm(payload: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }

  return params;
}

async function postStripeForm<T>(
  path: string,
  payload: Record<string, string | number | boolean | undefined>,
  idempotencyKey?: string
): Promise<IntegrationResult<T>> {
  const config = getStripeConfiguration();

  if (!config.configured || !config.enabled) {
    return getStripeNotConfiguredResult<T>();
  }

  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: buildStripeHeaders(idempotencyKey),
    body: encodeStripeForm(payload),
  });

  if (!response.ok) {
    return {
      ok: false,
      reason: "invalid_input",
      message: "Stripe rejected the request.",
    };
  }

  const data = (await response.json()) as T;

  return { ok: true, source: "configured", data };
}

export async function createStripeCheckoutSession(input: {
  userId: string;
  userEmail: string;
  plan: BillingPlanId;
  existingCustomerId?: string | null;
  idempotencyKey: string;
}): Promise<IntegrationResult<{ id: string; url: string | null }>> {
  const config = getStripeConfiguration();
  const plan = billingPlans.find((item) => item.id === input.plan);
  const priceId = plan?.priceEnv ? process.env[plan.priceEnv] || "" : "";

  if (!config.configured || !config.enabled || !priceId) {
    return getStripeNotConfiguredResult<{ id: string; url: string | null }>();
  }

  return postStripeForm(
    "checkout/sessions",
    {
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": 1,
      customer: input.existingCustomerId || undefined,
      customer_email: input.existingCustomerId ? undefined : input.userEmail,
      client_reference_id: input.userId,
      success_url: `${config.appUrl}/dashboard/billing?checkout=success`,
      cancel_url: `${config.appUrl}/dashboard/billing?checkout=cancelled`,
      "metadata[user_id]": input.userId,
      "metadata[plan]": input.plan,
      "subscription_data[metadata][user_id]": input.userId,
      "subscription_data[metadata][plan]": input.plan,
    },
    input.idempotencyKey
  );
}

export async function createStripeCustomerPortalSession(input: {
  customerId: string;
  userId: string;
  idempotencyKey: string;
}): Promise<IntegrationResult<{ id: string; url: string }>> {
  const config = getStripeConfiguration();

  if (!config.configured || !config.enabled) {
    return getStripeNotConfiguredResult<{ id: string; url: string }>();
  }

  return postStripeForm(
    "billing_portal/sessions",
    {
      customer: input.customerId,
      return_url: `${config.appUrl}/dashboard/billing`,
      "metadata[user_id]": input.userId,
    },
    input.idempotencyKey
  );
}

export function assertStripeCustomerOwnership(input: {
  authenticatedUserId: string;
  ownerUserId: string | null | undefined;
}) {
  return Boolean(
    input.authenticatedUserId &&
      input.ownerUserId &&
      input.authenticatedUserId === input.ownerUserId
  );
}

export function normalizeStripeSubscriptionForSync(event: {
  id?: string;
  customer?: string;
  status?: string;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ price?: { id?: string } }> };
  current_period_end?: number;
  cancel_at_period_end?: boolean;
}) {
  const priceId = event.items?.data?.[0]?.price?.id || "";

  return {
    subscriptionId: event.id || "",
    customerId: event.customer || "",
    userId: event.metadata?.user_id || "",
    status: event.status || "unknown",
    priceId,
    planTier: getPlanIdForStripePrice(priceId),
    cancelAtPeriodEnd: Boolean(event.cancel_at_period_end),
    currentPeriodEnd: event.current_period_end
      ? new Date(event.current_period_end * 1000).toISOString()
      : null,
  };
}

export function normalizeStripeInvoiceForSync(event: {
  id?: string;
  customer?: string;
  subscription?: string;
  status?: string;
  total?: number;
  currency?: string;
  hosted_invoice_url?: string;
  invoice_pdf?: string;
  period_start?: number;
  period_end?: number;
  metadata?: Record<string, string>;
}) {
  return {
    invoiceId: event.id || "",
    customerId: event.customer || "",
    subscriptionId: event.subscription || "",
    userId: event.metadata?.user_id || "",
    status: event.status || "unknown",
    totalCents: event.total ?? 0,
    currency: event.currency || "usd",
    hostedInvoiceUrl: event.hosted_invoice_url || null,
    invoicePdfUrl: event.invoice_pdf || null,
    periodStart: event.period_start
      ? new Date(event.period_start * 1000).toISOString()
      : null,
    periodEnd: event.period_end
      ? new Date(event.period_end * 1000).toISOString()
      : null,
  };
}

export function buildStripeUsageRecord(input: {
  userId: string;
  mode: string;
  quantity: number;
  idempotencyKey: string;
}) {
  return {
    userId: input.userId,
    mode: input.mode,
    quantity: Math.max(0, Math.floor(input.quantity)),
    idempotencyKey: input.idempotencyKey,
  };
}
