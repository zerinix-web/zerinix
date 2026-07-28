import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const billingPage = readFileSync("app/dashboard/billing/page.tsx", "utf8");
const checkoutButton = readFileSync(
  "app/dashboard/billing/BillingCheckoutButton.tsx",
  "utf8"
);

test("active paid subscription requires a paid tier and an active Stripe status", () => {
  assert.match(billingPage, /billing\.planTier !== "free"/);
  assert.match(
    billingPage,
    /activePaidSubscriptionStatuses = new Set\(\["active", "trialing"\]\)/
  );
  assert.match(billingPage, /hasActivePaidSubscription/);
});

test("subscription management actions render only for active paid subscribers", () => {
  assert.match(
    billingPage,
    /\{hasActivePaidSubscription \? \(\s*<section[\s\S]*?Secure actions/
  );
  assert.match(billingPage, /<BillingPortalButton available=\{portalActionsAvailable\} \/>/);
  assert.match(billingPage, /Cancel subscription/);
  assert.match(billingPage, /Downgrade plan/);
});

test("free and canceled users see only Pro and Business subscription cards", () => {
  assert.match(
    billingPage,
    /\{!hasActivePaidSubscription \? \(\s*<section[\s\S]*?Choose the right operating tier/
  );
  assert.match(
    billingPage,
    /\.filter\(\(plan\) => plan\.id === "pro" \|\| plan\.id === "business"\)/
  );
  assert.match(billingPage, /ZERINIX \{plan\.name\}/);
  assert.match(billingPage, /current=\{false\}/);
  assert.match(checkoutButton, /"Subscribe"/);
});

test("canceled users are not blocked by a stale current plan tier", () => {
  const inactivePlanSection = billingPage.slice(
    billingPage.indexOf("{!hasActivePaidSubscription ? ("),
    billingPage.indexOf("<div className=\"mt-6 grid gap-5 xl:grid-cols-2\">")
  );

  assert.doesNotMatch(inactivePlanSection, /!plan\.current/);
  assert.doesNotMatch(inactivePlanSection, /current=\{plan\.current\}/);
});
