import { NextResponse } from "next/server";
import { getStripeConfiguration } from "@/app/lib/billing/stripe";
import { handleStripeWebhookPayload } from "@/app/lib/billing/stripe-webhook";

export async function POST(req: Request) {
  const config = getStripeConfiguration();

  if (!config.configured || !config.hasWebhookSecret) {
    return NextResponse.json(
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
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    received: true,
    duplicate: result.duplicate,
  });
}
