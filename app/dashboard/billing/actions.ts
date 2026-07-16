"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/app/lib/supabase/server";
import {
  checkRateLimit,
  getServerActionClientIp,
} from "@/app/lib/security/rate-limit";
import { getAuthenticatedUser } from "../report-utils";
import {
  type BillingPlanId,
  billingPlans,
  createStripeCheckoutSession,
  createStripeCustomerPortalSession,
  getPlanPriceState,
  getStripeCheckoutConfiguration,
  getStripePortalConfiguration,
} from "@/app/lib/billing/stripe";
import { getUserBillingProfile } from "@/app/lib/billing/stripe-sync";

const checkoutLocks = new Map<string, number>();
const LOCK_TTL_MS = 2 * 60 * 1000;

function normalizeBillingPlan(value: FormDataEntryValue | null): BillingPlanId | "" {
  const plan = String(value || "").trim().toLowerCase();

  return plan === "free" || plan === "pro" || plan === "team" || plan === "business"
    ? plan
    : "";
}

function billingRedirect(params: Record<string, string>): never {
  const searchParams = new URLSearchParams(params);

  redirect(`/dashboard/billing?${searchParams.toString()}`);
}

async function getBillingActionContext(action: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);

  if (!user) {
    redirect("/login?next=/dashboard/billing");
  }

  const ip = await getServerActionClientIp();
  const rateLimit = checkRateLimit(`billing:${action}:${user.id}:${ip}`, {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    billingRedirect({
      billing_error: "Too many billing attempts. Please wait before trying again.",
    });
  }

  return { supabase, user };
}

function preventDuplicateCheckout(userId: string, plan: BillingPlanId) {
  const key = `${userId}:${plan}`;
  const now = Date.now();
  const lockedUntil = checkoutLocks.get(key) || 0;

  if (lockedUntil > now) {
    return false;
  }

  checkoutLocks.set(key, now + LOCK_TTL_MS);

  return true;
}

export async function startPlanChange(formData: FormData) {
  const plan = normalizeBillingPlan(formData.get("plan"));
  const { supabase, user } = await getBillingActionContext("plan-change");

  if (!plan) {
    billingRedirect({ billing_error: "Invalid billing plan." });
  }

  const planConfig = billingPlans.find((item) => item.id === plan);

  if (!planConfig?.databaseTier) {
    billingRedirect({
      billing_error: "This plan is not configured for subscriptions yet.",
    });
  }

  if (!preventDuplicateCheckout(user.id, plan)) {
    billingRedirect({
      billing_error: "A billing request is already in progress. Please wait a moment.",
    });
  }

  const priceState = getPlanPriceState(plan);
  const checkoutConfig = getStripeCheckoutConfiguration(plan);

  if (!checkoutConfig.configured || !priceState.configured) {
    billingRedirect({
      billing_notice: "Billing is not configured yet. Your current plan was not changed.",
    });
  }

  const billingProfile = await getUserBillingProfile(supabase, user.id);
  const checkout = await createStripeCheckoutSession({
    userId: user.id,
    userEmail: user.email || "",
    plan,
    existingCustomerId: billingProfile?.stripe_customer_id,
    idempotencyKey: `checkout:${user.id}:${plan}:${randomUUID()}`,
  });

  if (!checkout.ok) {
    billingRedirect({
      billing_error: checkout.message,
    });
  }

  if (!checkout.data.url) {
    billingRedirect({ billing_error: "Stripe checkout did not return a URL." });
  }

  redirect(checkout.data.url);
}

export async function openCustomerPortal() {
  const { supabase, user } = await getBillingActionContext("portal");
  const stripeConfig = getStripePortalConfiguration();

  if (!stripeConfig.configured) {
    billingRedirect({
      billing_notice: "Billing is not configured yet. The customer portal is unavailable.",
    });
  }

  const billingProfile = await getUserBillingProfile(supabase, user.id);
  const activeSubscriptionStatuses = new Set(["active", "trialing"]);

  if (!billingProfile?.stripe_customer_id) {
    billingRedirect({
      billing_notice: "You don't have an active subscription yet.",
    });
  }

  if (
    !billingProfile.stripe_subscription_id ||
    !activeSubscriptionStatuses.has(
      String(billingProfile.stripe_subscription_status || "").toLowerCase()
    )
  ) {
    billingRedirect({
      billing_notice: "You don't have an active subscription yet.",
    });
  }

  const portal = await createStripeCustomerPortalSession({
    customerId: billingProfile.stripe_customer_id,
    userId: user.id,
    idempotencyKey: `portal:${user.id}`,
  });

  if (!portal.ok) {
    billingRedirect({
      billing_error: portal.message,
    });
  }

  if (!portal.data.url) {
    billingRedirect({ billing_error: "Stripe customer portal did not return a URL." });
  }

  redirect(portal.data.url);
}

export async function confirmDowngrade(formData: FormData) {
  const plan = normalizeBillingPlan(formData.get("plan"));
  await getBillingActionContext("downgrade");

  if (!plan || plan === "team") {
    billingRedirect({ billing_error: "Invalid downgrade target." });
  }

  const stripeConfig = getStripePortalConfiguration();

  if (!stripeConfig.configured) {
    billingRedirect({
      billing_notice: "Billing is not configured yet. Downgrade was not applied.",
    });
  }

  billingRedirect({
    billing_notice: "Use the secure Stripe customer portal to complete subscription changes.",
  });
}

export async function requestCancellation() {
  await getBillingActionContext("cancel");
  const stripeConfig = getStripePortalConfiguration();

  if (!stripeConfig.configured) {
    billingRedirect({
      billing_notice: "Billing is not configured yet. No subscription was cancelled.",
    });
  }

  billingRedirect({
    billing_notice: "Use the secure Stripe customer portal to complete subscription cancellation.",
  });
}
