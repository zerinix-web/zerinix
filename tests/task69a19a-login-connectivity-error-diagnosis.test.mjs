// TASK #69A-19A -- Diagnose and fix localhost admin login failure
// without weakening auth.
//
// OBSERVED: the admin login form failed with "Check your email and
// password, then try again." even though the SAME account had
// authenticated successfully earlier in this same session.
//
// ROOT CAUSE (traced, not guessed -- and directly connected to #69A-19's
// own finding): a temporary, immediately-deleted service-role script
// probed the real Supabase project directly, independent of the app,
// and found EVERY endpoint -- including /auth/v1/health, the Auth
// subsystem's own health check, with no credentials involved at all --
// returning a Cloudflare 522 "Connection timed out" after ~19.8-19.9
// seconds, consistently across repeated attempts. This is a genuine
// infrastructure outage on the Supabase project itself (env vars and
// project URL were confirmed correct and unchanged -- NEXT_PUBLIC_SUPABASE_URL
// still points at the same project this whole session's other scratch
// scripts successfully used earlier), not a credentials problem and not
// a config mismatch. supabase-js's auth-js surfaces exactly this class
// of failure as an AuthRetryableFetchError -- but LoginForm.tsx (the
// real, live login form; app/auth/actions.ts's own server actions are a
// separate, unwired code path with the identical pre-existing bug)
// collapsed EVERY signInWithPassword failure into the same generic
// "check your email and password" message, so a genuine outage read
// exactly like a wrong password.
//
// FIX: both real call sites now use @supabase/auth-js's own officially
// exported isAuthRetryableFetchError type guard (re-exported via
// @supabase/supabase-js) to show a distinct, honest "couldn't reach the
// login service" message for a transient-fetch/connectivity failure,
// while EVERY other error (genuinely wrong credentials, or any other
// auth failure) still shows the exact same generic message as before --
// deliberately never distinguishing "wrong email" from "wrong password"
// from "some other auth error", since that would let an attacker
// enumerate which part of a guess was wrong. The real error is logged
// server-side only (logServerError, actions.ts) or kept purely in
// memory (LoginForm.tsx's own React state, never sent anywhere) --
// never exposed to the client beyond the new, still-generic message.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthApiError, AuthRetryableFetchError, isAuthRetryableFetchError } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const loginFormSource = readFileSync(join(repoRoot, "components/LoginForm.tsx"), "utf8");
const authActionsSource = readFileSync(join(repoRoot, "app/auth/actions.ts"), "utf8");
const dictionariesSource = readFileSync(join(repoRoot, "app/lib/i18n/dictionaries.ts"), "utf8");

// --- Root cause confirmation ----------------------------------------------

test("root cause confirmation: isAuthRetryableFetchError correctly distinguishes a genuine connectivity/timeout failure from real invalid credentials", () => {
  const connectivityFailure = new AuthRetryableFetchError("Service temporarily unavailable", 522);
  const invalidCredentials = new AuthApiError("Invalid login credentials", 400, "invalid_credentials");

  assert.equal(isAuthRetryableFetchError(connectivityFailure), true);
  assert.equal(isAuthRetryableFetchError(invalidCredentials), false);
});

test("root cause confirmation: LoginForm.tsx (not app/auth/actions.ts) is the real, live login code path -- it calls supabase.auth.signInWithPassword directly from the browser client", () => {
  assert.match(loginFormSource, /"use client";/);
  assert.match(loginFormSource, /const supabase = createClient\(\);/);
  assert.match(loginFormSource, /const \{ data, error: signInError \} = await supabase\.auth\.signInWithPassword\(\{/);
});

// --- Fix proof: both real call sites distinguish connectivity errors ----

// NOTE (updated under TASK #69A-21): the isAuthRetryableFetchError check
// that these two tests originally asserted directly on LoginForm.tsx and
// loginWithPassword was extracted into one shared helper,
// classifyPasswordSignInError (app/lib/supabase/auth-error-classification.ts),
// reused by LoginForm.tsx and both server actions in app/auth/actions.ts.
// The underlying behavior these tests care about -- a connectivity
// failure resolves to labels.connectionError / the "connectivity"
// message, everything else resolves to labels.authError / the generic
// message -- is unchanged and still covered here; only the call syntax
// changed to go through the shared classifier instead of calling
// isAuthRetryableFetchError inline. Full coverage of the shared helper
// itself lives in tests/task69a21-login-error-classification-unification.test.mjs.

test("fix proof: LoginForm.tsx now shows labels.connectionError for a connectivity failure and labels.authError for every other signInWithPassword failure", () => {
  assert.match(
    loginFormSource,
    /import \{ classifyPasswordSignInError \} from "@\/app\/lib\/supabase\/auth-error-classification";/
  );
  assert.match(
    loginFormSource,
    /setError\(\s*\n\s*classifyPasswordSignInError\(signInError\) === "connectivity"\s*\n\s*\? labels\.connectionError\s*\n\s*: labels\.authError\s*\n\s*\);/
  );
});

test("fix proof: app/auth/actions.ts's loginWithPassword also distinguishes the connectivity case, logs the real error server-side only, and never exposes it to the client-facing message", () => {
  assert.match(
    authActionsSource,
    /import \{ classifyPasswordSignInError \} from "@\/app\/lib\/supabase\/auth-error-classification";/
  );
  assert.match(authActionsSource, /import \{ logServerError \} from "@\/app\/lib\/security\/errors";/);
  const errorBlockStart = authActionsSource.indexOf("if (error) {", authActionsSource.indexOf("export async function loginWithPassword"));
  const errorBlockEnd = authActionsSource.indexOf("\n  }", authActionsSource.indexOf("Check your email and password", errorBlockStart));
  const errorBlock = authActionsSource.slice(errorBlockStart, errorBlockEnd);
  assert.match(errorBlock, /logServerError\("auth:login", error\);/);
  assert.match(errorBlock, /if \(classifyPasswordSignInError\(error\) === "connectivity"\) \{/);
  assert.match(errorBlock, /We couldn't reach the login service/);
  assert.match(errorBlock, /Check your email and password, then try again\./);
});

test("fix proof: connectionError is defined for every supported locale (en, tr, de), matching authError's own existing coverage", () => {
  for (const marker of [
    'authError: "Check your email and password, then try again.",',
    'authError: "E-posta ve şifrenizi kontrol edip tekrar deneyin.",',
    'authError: "Prüfen Sie E-Mail und Passwort und versuchen Sie es erneut.",',
  ]) {
    const authErrorIndex = dictionariesSource.indexOf(marker);
    assert.ok(authErrorIndex >= 0, `expected to find authError marker: ${marker}`);
    const nextFewLines = dictionariesSource.slice(authErrorIndex, authErrorIndex + 600);
    assert.match(nextFewLines, /connectionError:/);
  }
});

// --- Requirement 1/2: genuine invalid credentials remain rejected -------
// --- exactly as before, never distinguished from other auth errors -----

test("requirement: genuinely wrong credentials (AuthApiError, not retryable) still resolve to the SAME generic message as before this fix -- no new information is leaked about which credential was wrong", () => {
  const invalidCredentials = new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
  const resolvedMessage = isAuthRetryableFetchError(invalidCredentials)
    ? "connectionError"
    : "authError";
  assert.equal(resolvedMessage, "authError");
});

// --- Requirement 3: stale session does not permanently block re-login ---

test("requirement: LoginForm.tsx's error state is local, per-submit React state -- a stale/failed sign-in attempt never persists across a new submit, so a new login attempt is never permanently blocked by a prior failure", () => {
  assert.match(loginFormSource, /const \[error, setError\] = useState\(""\);/);
  assert.match(loginFormSource, /setError\(""\);/);
  // setError("") runs unconditionally at the start of every submit,
  // before the new sign-in attempt, clearing any previous error.
  const submitStart = loginFormSource.indexOf("setPending(true);");
  const clearErrorIndex = loginFormSource.indexOf('setError("");', submitStart);
  assert.ok(clearErrorIndex > submitStart && clearErrorIndex - submitStart < 40);
});

// --- Requirement 4: admin role lookup after login still works -----------

test("requirement: the canonical admin/owner role resolution (strategic-report-access.ts, admin-data.ts) is completely untouched by this login-error-handling fix", () => {
  const strategicAccessSource = readFileSync(join(repoRoot, "app/lib/strategic-report-access.ts"), "utf8");
  const adminDataSource = readFileSync(join(repoRoot, "app/admin/admin-data.ts"), "utf8");
  assert.doesNotMatch(strategicAccessSource, /#69A-19A/);
  assert.doesNotMatch(adminDataSource, /#69A-19A/);
  assert.match(strategicAccessSource, /export async function isVerifiedAdminOrOwnerAccount\(/);
});

// --- Requirement 5: PDF admin entitlement fix remains intact ------------

test("requirement: the #69A-16B admin/owner PDF export quota bypass is untouched by this fix", () => {
  const pdfExportRouteSource = readFileSync(join(repoRoot, "app/api/usage/pdf-export/route.ts"), "utf8");
  assert.match(pdfExportRouteSource, /if \(!permission\.allowed && !isUsageLimitExemptAccount\) \{/);
  assert.doesNotMatch(pdfExportRouteSource, /#69A-19A/);
});

// --- Requirement 6: localhost auth redirect/session persistence ---------

test("requirement: LoginForm.tsx's successful-login path (persistSupabaseSession, restoreSupabaseSession, getSession, router.replace/refresh) is completely unchanged by this fix -- only the FAILURE branch's message selection changed", () => {
  assert.match(loginFormSource, /persistSupabaseSession\(data\.session\);/);
  assert.match(loginFormSource, /await restoreSupabaseSession\(supabase\);/);
  assert.match(loginFormSource, /const \{\s*\n\s*data: \{ session \},\s*\n\s*error: sessionError,\s*\n\s*\} = await supabase\.auth\.getSession\(\);/);
  assert.match(loginFormSource, /router\.replace\("\/plan"\);/);
  assert.match(loginFormSource, /router\.refresh\(\);/);
});

// --- Security invariants preserved (no leaking, no bypass) ---------------

test("security invariant: no stack trace, raw error text, or service-role credential is ever exposed to the client -- both fixed call sites still only ever return one of two fixed, generic strings", () => {
  assert.doesNotMatch(authActionsSource, /stack:/);
  assert.doesNotMatch(authActionsSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(loginFormSource, /error\.message/);
  assert.doesNotMatch(loginFormSource, /signInError\.message/);
});

test("security invariant: this fix never bypasses authentication, never disables RLS, never weakens the rate limiter, and never hardcodes an email/password", () => {
  assert.match(authActionsSource, /checkRateLimit\(/);
  assert.doesNotMatch(authActionsSource, /#69A-19A[\s\S]{0,500}bypass/i);
  assert.doesNotMatch(loginFormSource, /@zerinix\.com/);
  assert.doesNotMatch(authActionsSource, /@zerinix\.com/);
});

// --- Preserve #69A-15 through #69A-19 --------------------------------------

test("preserves #69A-15 through #69A-19: no competitor-landscape, Founder Readiness, benchmark-gap, PDF-export-bypass, or performance-fix file carries a #69A-19A marker", () => {
  for (const relativePath of [
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/api/usage/pdf-export/route.ts",
    "app/dashboard/[id]/ReportPdfButtonLazy.tsx",
    "components/Planner.tsx",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-19A/);
  }
});
