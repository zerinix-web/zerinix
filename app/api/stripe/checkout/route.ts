import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { createClient } from "@/app/lib/supabase/server";
import { getAuthenticatedUser } from "@/app/dashboard/report-utils";
import {
  type BillingPlanId,
  billingPlans,
  createStripeCheckoutSession,
  getPlanPriceState,
  getStripeCheckoutConfiguration,
} from "@/app/lib/billing/stripe";
import { getUserBillingProfile } from "@/app/lib/billing/stripe-sync";
import { noStoreJson } from "@/app/lib/security/api-response";
import {
  checkRateLimit,
  getClientIpFromRequest,
  getRateLimitHeaders,
} from "@/app/lib/security/rate-limit";

export const dynamic = "force-dynamic";

function normalizeBillingPlan(value: unknown): BillingPlanId | "" {
  const plan = String(value || "").trim().toLowerCase();

  return plan === "free" || plan === "pro" || plan === "team" || plan === "business"
    ? plan
    : "";
}

async function readPlan(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { plan?: unknown } | null;

    return normalizeBillingPlan(body?.plan);
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await req.formData().catch(() => null);

    return normalizeBillingPlan(formData?.get("plan"));
  }

  return normalizeBillingPlan(new URL(req.url).searchParams.get("plan"));
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);

  console.log("[api:stripe:checkout] request received", {
    authenticated: Boolean(user),
    userId: user?.id || null,
    userEmail: user?.email || null,
  });

  if (!user) {
    console.log("[api:stripe:checkout] unauthenticated request");

    return noStoreJson({ error: "Authentication required." }, { status: 401 });
  }

  const ip = getClientIpFromRequest(req);
  const rateLimit = checkRateLimit(`stripe:checkout:${user.id}:${ip}`, {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    console.log("[api:stripe:checkout] rate limited", {
      userId: user.id,
      ip,
      resetAt: rateLimit.resetAt,
    });

    return noStoreJson(
      { error: "Too many billing attempts. Please wait before trying again." },
      { status: 429, headers: getRateLimitHeaders(rateLimit) }
    );
  }

  const plan = await readPlan(req);

  console.log("[api:stripe:checkout] selected plan", {
    userId: user.id,
    plan: plan || null,
  });

  if (!plan) {
    console.log("[api:stripe:checkout] invalid plan");

    return noStoreJson({ error: "Invalid billing plan." }, { status: 400 });
  }

  const planConfig = billingPlans.find((item) => item.id === plan);

  if (!planConfig?.databaseTier) {
    console.log("[api:stripe:checkout] plan has no database tier", {
      plan,
      planConfig,
    });

    return noStoreJson(
      { error: "This plan is not configured for subscriptions yet." },
      { status: 400 }
    );
  }

  const priceState = getPlanPriceState(plan);
  const checkoutConfig = getStripeCheckoutConfiguration(plan);

  console.log("[api:stripe:checkout] readiness", {
    userId: user.id,
    plan,
    priceId: checkoutConfig.priceId,
    checkoutConfigured: checkoutConfig.configured,
    checkoutMissing: checkoutConfig.missing,
    priceConfigured: priceState.configured,
    priceLabel: priceState.label,
  });

  if (!checkoutConfig.configured || !priceState.configured) {
    console.log("[api:stripe:checkout] checkout not configured", {
      userId: user.id,
      plan,
      missing: checkoutConfig.missing,
    });

    return noStoreJson(
      {
        error: "Billing is not configured yet. Your current plan was not changed.",
        missing: checkoutConfig.missing,
      },
      { status: 503 }
    );
  }

  const billingProfile = await getUserBillingProfile(supabase, user.id);

  console.log("[api:stripe:checkout] billing profile", {
    userId: user.id,
    plan,
    hasBillingProfile: Boolean(billingProfile),
    stripeCustomerId: billingProfile?.stripe_customer_id || null,
    stripeSubscriptionId: billingProfile?.stripe_subscription_id || null,
    stripeSubscriptionStatus: billingProfile?.stripe_subscription_status || null,
  });

  let checkout: Awaited<ReturnType<typeof createStripeCheckoutSession>>;
  const idempotencyKey = `checkout:${user.id}:${plan}:${randomUUID()}`;

  try {
    console.log("[api:stripe:checkout] createCheckoutSession call", {
      userId: user.id,
      plan,
      priceId: checkoutConfig.priceId,
      idempotencyKey,
    });

    checkout = await createStripeCheckoutSession({
      userId: user.id,
      userEmail: user.email || "",
      plan,
      existingCustomerId: billingProfile?.stripe_customer_id,
      idempotencyKey,
    });
  } catch (error) {
    console.error("[api:stripe:checkout] createCheckoutSession exception", {
      userId: user.id,
      plan,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });

    return noStoreJson(
      {
        error:
          process.env.NODE_ENV === "production"
            ? "Stripe checkout could not be created."
            : error instanceof Error
              ? error.message
              : String(error),
      },
      { status: 500 }
    );
  }

  console.log("[api:stripe:checkout] createCheckoutSession result", {
    userId: user.id,
    plan,
    ok: checkout.ok,
    sessionId: checkout.ok ? checkout.data.id : null,
    checkoutUrl: checkout.ok ? checkout.data.url : null,
    errorMessage: checkout.ok ? null : checkout.message,
  });

  if (!checkout.ok) {
    return noStoreJson({ error: checkout.message }, { status: 400 });
  }

  if (!checkout.data.url) {
    console.log("[api:stripe:checkout] missing checkout url", {
      userId: user.id,
      plan,
      sessionId: checkout.data.id,
    });

    return noStoreJson(
      { error: "Stripe checkout did not return a URL." },
      { status: 502 }
    );
  }

  return noStoreJson({
    id: checkout.data.id,
    url: checkout.data.url,
  });
}
