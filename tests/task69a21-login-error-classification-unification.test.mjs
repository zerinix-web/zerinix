// TASK #69A-21 -- Unify login error handling before commit.
//
// CONTEXT: #69A-20's audit found that app/auth/actions.ts has two
// password-login server actions -- loginWithPassword (fixed under
// #69A-19A to distinguish a genuine Supabase connectivity outage from
// real invalid credentials) and signInWithPassword (an older,
// redirect-based path that still collapsed every failure into
// "invalid_credentials"). The audit found no live caller for
// signInWithPassword, but flagged it as a dormant landmine: if it were
// ever wired up later, it would silently reintroduce the exact
// misleading behavior #69A-19A fixed elsewhere.
//
// VERIFIED (not assumed) IN THIS TASK: a repo-wide search for every
// caller of app/auth/actions.ts's exports confirms only `signOut` is
// imported anywhere (AdminShell.tsx, SignOutButton.tsx). Neither
// `loginWithPassword` nor `signInWithPassword` (the server actions) has
// any importer outside this file itself. The real, live login path
// remains LoginForm.tsx calling supabase.auth.signInWithPassword
// directly from the browser.
//
// FIX: extracted the isAuthRetryableFetchError-based distinction into
// one shared, pure helper -- classifyPasswordSignInError
// (app/lib/supabase/auth-error-classification.ts) -- and pointed all
// three password-login call sites at it: LoginForm.tsx (the live
// path), and both loginWithPassword and signInWithPassword in
// app/auth/actions.ts (both dormant). signInWithPassword now redirects
// to a distinct /login?auth_error=connection_error value for a
// connectivity failure instead of collapsing it into
// invalid_credentials, mirroring the exact same two-bucket distinction
// loginWithPassword and LoginForm.tsx already use. Nothing about
// Supabase Auth itself, RLS, password handling, or admin behavior was
// touched.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { classifyPasswordSignInError } from "../app/lib/supabase/auth-error-classification.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const loginFormSource = readFileSync(join(repoRoot, "components/LoginForm.tsx"), "utf8");
const authActionsSource = readFileSync(join(repoRoot, "app/auth/actions.ts"), "utf8");
const classifierSource = readFileSync(
  join(repoRoot, "app/lib/supabase/auth-error-classification.ts"),
  "utf8"
);

// --- Requirement 2: signInWithPassword has no live caller (verified, not assumed) ---

test("verified (not assumed): neither loginWithPassword nor the server-action signInWithPassword has any live caller anywhere in app/ or components/", () => {
  const appAndComponentsFiles = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        appAndComponentsFiles.push(fullPath);
      }
    }
  };
  walk(join(repoRoot, "app"));
  walk(join(repoRoot, "components"));

  const importers = appAndComponentsFiles.filter((filePath) => {
    if (filePath === join(repoRoot, "app/auth/actions.ts")) {
      return false;
    }
    const source = readFileSync(filePath, "utf8");
    return /\bloginWithPassword\b/.test(source) || /\{\s*[^}]*\bsignInWithPassword\b[^}]*\}\s*from\s*["'].*auth\/actions["']/.test(source);
  });

  assert.deepEqual(importers, []);
});

test("verified: the real, live login path is LoginForm.tsx calling supabase.auth.signInWithPassword directly, not the server actions", () => {
  assert.match(loginFormSource, /"use client";/);
  assert.match(loginFormSource, /const supabase = createClient\(\);/);
  assert.match(loginFormSource, /await supabase\.auth\.signInWithPassword\(\{/);
});

// --- Requirement 3/6: one shared classifier, reused everywhere -------------

test("fix proof: classifyPasswordSignInError exists as a small, pure, shared helper", () => {
  assert.match(classifierSource, /export function classifyPasswordSignInError/);
  assert.match(classifierSource, /isAuthRetryableFetchError\(error\)/);
  assert.match(classifierSource, /"connectivity"/);
  assert.match(classifierSource, /"credentials"/);
});

test("fix proof: LoginForm.tsx, loginWithPassword, and signInWithPassword all import and use the shared classifier instead of re-implementing isAuthRetryableFetchError themselves", () => {
  for (const source of [loginFormSource, authActionsSource]) {
    assert.match(
      source,
      /import \{ classifyPasswordSignInError \} from "@\/app\/lib\/supabase\/auth-error-classification";/
    );
    assert.doesNotMatch(source, /isAuthRetryableFetchError/);
  }

  const loginWithPasswordBody = authActionsSource.slice(
    authActionsSource.indexOf("export async function loginWithPassword"),
    authActionsSource.indexOf("export async function signInWithPassword")
  );
  const signInWithPasswordBody = authActionsSource.slice(
    authActionsSource.indexOf("export async function signInWithPassword"),
    authActionsSource.indexOf("export async function signUpWithPassword")
  );

  assert.match(loginWithPasswordBody, /classifyPasswordSignInError\(error\) === "connectivity"/);
  assert.match(signInWithPasswordBody, /classifyPasswordSignInError\(error\) === "connectivity"/);
  assert.match(loginFormSource, /classifyPasswordSignInError\(signInError\) === "connectivity"/);
});

// --- Requirement 4: correct distinctions preserved --------------------------

test("classifier correctly distinguishes a genuine connectivity/service-unavailable failure from real invalid credentials", () => {
  const connectivityFailure = new AuthRetryableFetchError("Service temporarily unavailable", 522);
  const invalidCredentials = new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
  const unexpectedFailure = new AuthApiError("Unexpected error", 500, "unexpected_failure");

  assert.equal(classifyPasswordSignInError(connectivityFailure), "connectivity");
  assert.equal(classifyPasswordSignInError(invalidCredentials), "credentials");
  assert.equal(classifyPasswordSignInError(unexpectedFailure), "credentials");
});

test("app-level rate limiting remains a distinct, separate concern from the classifier -- both login server actions still check checkRateLimit before ever calling signInWithPassword", () => {
  assert.match(authActionsSource, /checkRateLimit\(`auth:login:/);
  assert.match(authActionsSource, /checkRateLimit\(`auth:signin:/);
  assert.match(authActionsSource, /Too many attempts\. Please wait a moment and try again\./);
  assert.match(authActionsSource, /auth_error=rate_limited/);
});

test("signInWithPassword now uses a distinct redirect value for connectivity failures instead of collapsing them into invalid_credentials", () => {
  const signInWithPasswordBody = authActionsSource.slice(
    authActionsSource.indexOf("export async function signInWithPassword"),
    authActionsSource.indexOf("export async function signUpWithPassword")
  );
  assert.match(signInWithPasswordBody, /auth_error=connection_error/);
  assert.match(signInWithPasswordBody, /auth_error=invalid_credentials/);
});

// --- Requirement 7: #69A-19A behavior preserved -----------------------------

test("preserves #69A-19A: LoginForm.tsx still shows a distinct connectionError message (never the generic authError message) for a connectivity failure", () => {
  assert.match(loginFormSource, /labels\.connectionError/);
  assert.match(loginFormSource, /labels\.authError/);
});

test("preserves #69A-19A: loginWithPassword still logs the real error server-side only and never exposes it in the client-facing message", () => {
  const loginWithPasswordBody = authActionsSource.slice(
    authActionsSource.indexOf("export async function loginWithPassword"),
    authActionsSource.indexOf("export async function signInWithPassword")
  );
  assert.match(loginWithPasswordBody, /logServerError\("auth:login", error\);/);
  assert.doesNotMatch(loginWithPasswordBody, /error\.message/);
});

test("fix proof: signInWithPassword now also logs the real error server-side only, matching loginWithPassword's diagnosability", () => {
  const signInWithPasswordBody = authActionsSource.slice(
    authActionsSource.indexOf("export async function signInWithPassword"),
    authActionsSource.indexOf("export async function signUpWithPassword")
  );
  assert.match(signInWithPasswordBody, /logServerError\("auth:signin", error\);/);
  assert.doesNotMatch(signInWithPasswordBody, /error\.message/);
});

// --- Requirement 5: no security weakening ------------------------------------

test("security invariant: no path bypasses Supabase Auth, hardcodes credentials, or exposes stack traces / service-role keys", () => {
  assert.doesNotMatch(authActionsSource, /stack:/);
  assert.doesNotMatch(authActionsSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(authActionsSource, /@zerinix\.com/);
  assert.doesNotMatch(loginFormSource, /@zerinix\.com/);
  assert.match(authActionsSource, /await supabase\.auth\.signInWithPassword\(\{/);
});

test("security invariant: genuinely wrong credentials still resolve to the exact same generic bucket as every other non-connectivity failure -- no new information is leaked about which field was wrong", () => {
  const wrongPassword = new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
  const wrongEmail = new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
  assert.equal(classifyPasswordSignInError(wrongPassword), classifyPasswordSignInError(wrongEmail));
});

// --- Requirement: unrelated architecture untouched --------------------------

test("no #69A-21 marker leaks into unrelated files -- scope stayed limited to the shared classifier and its three call sites", () => {
  for (const relativePath of [
    "app/lib/strategic-report-access.ts",
    "app/api/usage/pdf-export/route.ts",
    "app/lib/supabase/server.ts",
    "app/lib/supabase/client.ts",
    "app/login/page.tsx",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-21/);
  }
});
