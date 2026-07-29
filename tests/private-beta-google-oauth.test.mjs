import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isPrivateBetaEmailAllowed,
  normalizePrivateBetaEmail,
  parsePrivateBetaAllowedEmails,
} from "../app/lib/private-beta-access.mjs";

test("allowed Google OAuth users match the normalized private beta list", () => {
  const allowedEmails = "  Approved.User@Example.com, tester@example.com  ";

  assert.equal(
    normalizePrivateBetaEmail(" Approved.User@Example.com "),
    "approved.user@example.com"
  );
  assert.deepEqual(parsePrivateBetaAllowedEmails(allowedEmails), [
    "approved.user@example.com",
    "tester@example.com",
  ]);
  assert.equal(
    isPrivateBetaEmailAllowed(" APPROVED.USER@example.COM ", allowedEmails),
    true
  );
});

test("denied Google OAuth users are rejected by the private beta list", () => {
  assert.equal(
    isPrivateBetaEmailAllowed(
      "not-approved@example.com",
      "approved.user@example.com,tester@example.com"
    ),
    false
  );
  assert.equal(isPrivateBetaEmailAllowed("approved.user@example.com", ""), false);
});

test("Google OAuth callback provisions allowed users and signs out denied users", () => {
  const callback = readFileSync("app/auth/callback/route.ts", "utf8");

  assert.match(callback, /exchangeCodeForSession\(code\)/);
  assert.match(callback, /isPrivateBetaAllowed\(user\)/);
  assert.match(callback, /ensureFreeBillingProfile\(supabase, user\.id\)/);
  assert.equal(callback.includes('new URL("/dashboard"'), true);
  assert.match(callback, /supabase\.auth\.signOut\(\)/);
  assert.match(callback, /login\?error=beta_access_required/);
});

test("OAuth errors render separately from password credential errors", () => {
  const loginPage = readFileSync("app/login/page.tsx", "utf8");

  assert.match(loginPage, /error === "beta_access_required"/);
  assert.match(loginPage, /dictionary\.auth\.betaAccessRequired/);
  assert.match(loginPage, /error === "oauth_callback_failed"/);
  assert.match(loginPage, /dictionary\.auth\.oauthError/);
  assert.match(loginPage, /authError[\s\S]*dictionary\.auth\.authError/);
});
