import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const billingPage = readFileSync("app/dashboard/billing/page.tsx", "utf8");
const portalButton = readFileSync(
  "app/dashboard/billing/BillingPortalButton.tsx",
  "utf8"
);
const portalRoute = readFileSync("app/api/stripe/portal/route.ts", "utf8");
const stripeFoundation = readFileSync("app/lib/billing/stripe.ts", "utf8");

test("billing page renders a non-submitting customer portal button", () => {
  assert.match(billingPage, /<BillingPortalButton available=\{portalActionsAvailable\} \/>/);
  assert.doesNotMatch(billingPage, /<form action=\{openCustomerPortal\}/);
  assert.match(portalButton, /type="button"/);
  assert.doesNotMatch(portalButton, /href=/);
});

test("customer portal button calls the server endpoint and redirects to Stripe", () => {
  assert.match(portalButton, /fetch\("\/api\/stripe\/portal"/);
  assert.match(portalButton, /method: "POST"/);
  assert.match(portalButton, /window\.location\.assign\(payload\.url\)/);
  assert.match(portalButton, /role="alert"/);
  assert.match(portalButton, /Your session has expired/);
  assert.doesNotMatch(portalButton, /customerId|stripe_customer_id/);
});

test("portal endpoint resolves the authenticated user's server-owned customer id", () => {
  assert.match(portalRoute, /getAuthenticatedUser\(supabase\)/);
  assert.match(portalRoute, /Authentication required\./);
  assert.match(portalRoute, /getUserBillingProfile\(supabase, user\.id\)/);
  assert.match(
    portalRoute,
    /customerId: billingProfile\.stripe_customer_id/
  );
  assert.match(portalRoute, /createStripeCustomerPortalSession/);
  assert.doesNotMatch(portalRoute, /req\.json|req\.formData|searchParams/);
});

test("portal endpoint handles missing customers and Stripe failures safely", () => {
  assert.match(portalRoute, /!billingProfile\?\.stripe_customer_id/);
  assert.match(portalRoute, /No Stripe customer is connected to this account/);
  assert.match(portalRoute, /Stripe customer portal could not be opened/);
  assert.match(portalRoute, /api:stripe:portal:create-session/);
  assert.match(portalRoute, /status: 401/);
  assert.match(portalRoute, /status: 409/);
  assert.match(portalRoute, /status: 502/);
});

test("Stripe portal session uses the configured application billing return URL", () => {
  assert.match(stripeFoundation, /"billing_portal\/sessions"/);
  assert.match(stripeFoundation, /return_url: `\$\{config\.appUrl\}\/billing`/);
});
