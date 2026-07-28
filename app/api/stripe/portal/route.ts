import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { createClient } from "@/app/lib/supabase/server";
import { getAuthenticatedUser } from "@/app/dashboard/report-utils";
import { createStripeCustomerPortalSession } from "@/app/lib/billing/stripe";
import { getUserBillingProfile } from "@/app/lib/billing/stripe-sync";
import { noStoreJson } from "@/app/lib/security/api-response";
import { logServerError } from "@/app/lib/security/errors";
import {
  checkRateLimit,
  getClientIpFromRequest,
  getRateLimitHeaders,
} from "@/app/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);

  if (!user) {
    return noStoreJson({ error: "Authentication required." }, { status: 401 });
  }

  const ip = getClientIpFromRequest(req);
  const rateLimit = checkRateLimit(`stripe:portal:${user.id}:${ip}`, {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return noStoreJson(
      { error: "Too many billing attempts. Please wait before trying again." },
      { status: 429, headers: getRateLimitHeaders(rateLimit) }
    );
  }

  const billingProfile = await getUserBillingProfile(supabase, user.id);

  if (!billingProfile?.stripe_customer_id) {
    return noStoreJson(
      {
        error:
          "No Stripe customer is connected to this account. Start a subscription before opening the customer portal.",
      },
      { status: 409 }
    );
  }

  let portal: Awaited<ReturnType<typeof createStripeCustomerPortalSession>>;

  try {
    portal = await createStripeCustomerPortalSession({
      customerId: billingProfile.stripe_customer_id,
      userId: user.id,
      idempotencyKey: `portal:${user.id}:${randomUUID()}`,
    });
  } catch (error) {
    logServerError("api:stripe:portal:create-session", error);

    return noStoreJson(
      { error: "Stripe customer portal could not be opened. Please try again." },
      { status: 500 }
    );
  }

  if (!portal.ok) {
    logServerError(
      "api:stripe:portal:create-session-failed",
      new Error(portal.message)
    );

    return noStoreJson(
      {
        error:
          portal.reason === "not_configured"
            ? "Customer portal is not configured yet."
            : "Stripe customer portal could not be opened. Please try again.",
      },
      { status: portal.reason === "not_configured" ? 503 : 502 }
    );
  }

  if (!portal.data.url) {
    logServerError(
      "api:stripe:portal:missing-url",
      new Error("Stripe customer portal did not return a URL.")
    );

    return noStoreJson(
      { error: "Stripe customer portal could not be opened. Please try again." },
      { status: 502 }
    );
  }

  return noStoreJson({
    id: portal.data.id,
    url: portal.data.url,
  });
}
