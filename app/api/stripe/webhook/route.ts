import { getStripeConfiguration } from "@/app/lib/billing/stripe";
import { handleStripeWebhookPayload } from "@/app/lib/billing/stripe-webhook";
import { noStoreJson } from "@/app/lib/security/api-response";

export async function POST(req: Request) {
  const config = getStripeConfiguration();

  if (!config.configured || !config.hasWebhookSecret) {
    return noStoreJson(
      { error: "Stripe webhooks are not configured." },
      { status: 503 }
    );
  }

  const result = await handleStripeWebhookPayload({
    payload: await req.text(),
    signature: req.headers.get("stripe-signature") || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  });

  if (!result.ok) {
    return noStoreJson({ error: result.error }, { status: result.status });
  }

  return noStoreJson({
    received: true,
    duplicate: result.duplicate,
  });
}
