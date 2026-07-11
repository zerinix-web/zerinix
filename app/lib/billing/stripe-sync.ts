import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPlanIdForStripePrice,
  normalizeStripeInvoiceForSync,
  normalizeStripeSubscriptionForSync,
} from "./stripe";

type StripeCheckoutSession = {
  id?: string;
  customer?: string;
  subscription?: string;
  client_reference_id?: string;
  metadata?: Record<string, string>;
};

type StripeSubscription = Parameters<typeof normalizeStripeSubscriptionForSync>[0];
type StripeInvoice = Parameters<typeof normalizeStripeInvoiceForSync>[0];

function readUserId(value?: string | null) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export async function getUserBillingProfile(
  supabase: SupabaseClient,
  userId: string
) {
  const { data, error } = await supabase
    .from("user_billing_profiles")
    .select(
      "user_id,plan_tier,stripe_customer_id,stripe_subscription_id,stripe_subscription_status,stripe_price_id,stripe_current_period_end,stripe_cancel_at_period_end"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data as {
    user_id: string;
    plan_tier: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    stripe_subscription_status: string | null;
    stripe_price_id: string | null;
    stripe_current_period_end: string | null;
    stripe_cancel_at_period_end: boolean | null;
  } | null;
}

export async function syncCheckoutSession(
  supabase: SupabaseClient,
  session: StripeCheckoutSession
) {
  const userId = readUserId(session.client_reference_id || session.metadata?.user_id);

  if (!userId || !session.customer) {
    return { ok: false, reason: "missing_user_or_customer" };
  }

  const { error } = await supabase.from("user_billing_profiles").upsert(
    {
      user_id: userId,
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription || null,
      stripe_checkout_session_id: session.id || null,
    },
    { onConflict: "user_id" }
  );

  return { ok: !error, reason: error?.message || "" };
}

export async function syncSubscription(
  supabase: SupabaseClient,
  subscription: StripeSubscription
) {
  const normalized = normalizeStripeSubscriptionForSync(subscription);
  let userId = readUserId(normalized.userId);

  if (!userId && normalized.customerId) {
    const { data } = await supabase
      .from("user_billing_profiles")
      .select("user_id")
      .eq("stripe_customer_id", normalized.customerId)
      .maybeSingle();

    userId = readUserId(data?.user_id);
  }

  if (!userId || !normalized.customerId) {
    return { ok: false, reason: "missing_user_or_customer" };
  }

  const activeStatuses = new Set(["active", "trialing"]);
  const planTier = activeStatuses.has(normalized.status)
    ? normalized.planTier
    : "free";

  const { error } = await supabase.from("user_billing_profiles").upsert(
    {
      user_id: userId,
      plan_tier: planTier,
      stripe_customer_id: normalized.customerId,
      stripe_subscription_id: normalized.subscriptionId || null,
      stripe_subscription_status: normalized.status,
      stripe_price_id: normalized.priceId || null,
      stripe_current_period_end: normalized.currentPeriodEnd,
      stripe_cancel_at_period_end: normalized.cancelAtPeriodEnd,
    },
    { onConflict: "user_id" }
  );

  return { ok: !error, reason: error?.message || "", userId, planTier };
}

export async function syncInvoice(
  supabase: SupabaseClient,
  invoice: StripeInvoice
) {
  const normalized = normalizeStripeInvoiceForSync(invoice);
  let userId = readUserId(normalized.userId);

  if (!userId && normalized.customerId) {
    const { data } = await supabase
      .from("user_billing_profiles")
      .select("user_id")
      .eq("stripe_customer_id", normalized.customerId)
      .maybeSingle();

    userId = readUserId(data?.user_id);
  }

  if (!userId || !normalized.invoiceId) {
    return { ok: false, reason: "missing_user_or_invoice" };
  }

  const { error } = await supabase.from("stripe_invoices").upsert(
    {
      user_id: userId,
      stripe_invoice_id: normalized.invoiceId,
      stripe_customer_id: normalized.customerId || null,
      stripe_subscription_id: normalized.subscriptionId || null,
      status: normalized.status,
      total_cents: normalized.totalCents,
      currency: normalized.currency,
      hosted_invoice_url: normalized.hostedInvoiceUrl,
      invoice_pdf_url: normalized.invoicePdfUrl,
      period_start: normalized.periodStart,
      period_end: normalized.periodEnd,
    },
    { onConflict: "stripe_invoice_id" }
  );

  return { ok: !error, reason: error?.message || "", userId };
}

export function planTierFromStripePrice(priceId?: string | null) {
  return getPlanIdForStripePrice(priceId);
}
