import "server-only";

import { createServiceRoleClient } from "@/app/lib/supabase/admin";
import { logOperationalError } from "@/app/lib/security/logging";
import { verifyStripeWebhookSignature } from "./stripe";
import {
  syncCheckoutSession,
  syncInvoice,
  syncSubscription,
} from "./stripe-sync";

type StripeWebhookEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: Record<string, unknown>;
  };
};

async function wasEventProcessed(eventId: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("stripe_webhook_events")
    .select("stripe_event_id")
    .eq("stripe_event_id", eventId)
    .maybeSingle();

  return Boolean(data);
}

async function markEventProcessed(eventId: string, eventType: string) {
  const supabase = createServiceRoleClient();

  await supabase.from("stripe_webhook_events").insert({
    stripe_event_id: eventId,
    event_type: eventType,
  });
}

export async function handleStripeWebhookPayload(input: {
  payload: string;
  signature: string;
  webhookSecret: string;
}) {
  const verified = verifyStripeWebhookSignature({
    payload: input.payload,
    signatureHeader: input.signature,
    webhookSecret: input.webhookSecret,
  });

  if (!verified) {
    return { ok: false as const, status: 400, error: "Invalid Stripe signature." };
  }

  let event: StripeWebhookEvent;

  try {
    event = JSON.parse(input.payload) as StripeWebhookEvent;
  } catch {
    return { ok: false as const, status: 400, error: "Invalid Stripe payload." };
  }

  const eventId = event.id || "";
  const eventType = event.type || "";
  const object = event.data?.object || {};

  if (!eventId || !eventType) {
    return { ok: false as const, status: 400, error: "Invalid Stripe event." };
  }

  if (await wasEventProcessed(eventId)) {
    return { ok: true as const, duplicate: true };
  }

  const supabase = createServiceRoleClient();

  try {
    if (eventType === "checkout.session.completed") {
      await syncCheckoutSession(supabase, object);
    }

    if (
      eventType === "customer.subscription.created" ||
      eventType === "customer.subscription.updated" ||
      eventType === "customer.subscription.deleted"
    ) {
      await syncSubscription(supabase, object);
    }

    if (
      eventType === "invoice.created" ||
      eventType === "invoice.finalized" ||
      eventType === "invoice.paid" ||
      eventType === "invoice.payment_failed"
    ) {
      await syncInvoice(supabase, object);
    }

    await markEventProcessed(eventId, eventType);
  } catch (error) {
    logOperationalError("[stripe:webhook]", error, {
      eventId,
      eventType,
    });

    return {
      ok: false as const,
      status: 500,
      error: "Stripe webhook processing failed.",
    };
  }

  return { ok: true as const, duplicate: false };
}
