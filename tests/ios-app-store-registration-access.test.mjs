import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isAppAttestedAccount,
  IOS_APP_ATTEST_REGISTRATION_SOURCE,
} from "@/app/lib/ios-app-store-access.ts";
import { authorizeStrategicReportAccess } from "@/app/lib/strategic-report-access.ts";
import { isPrivateBetaAllowed } from "@/app/lib/beta-access.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Comments here necessarily discuss the very identifiers under test ("must
// never be written to user_metadata"), so they are removed before matching.
// Imports are removed too: an import names a symbol without calling it, and
// ordering checks below compare where things actually HAPPEN.
const stripped = (path) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/^import[\s\S]*?from\s+"[^"]+";$/gm, " ");
const request = new Request("https://zerinix.com/api/plan");
const noAdminRole = async () => null;

const account = (overrides = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  email: "founder@example.com",
  app_metadata: {},
  user_metadata: {},
  identities: [],
  ...overrides,
});

const attested = () =>
  account({
    app_metadata: { registration_source: IOS_APP_ATTEST_REGISTRATION_SOURCE },
  });

const authorize = (user, allowedEmails) =>
  authorizeStrategicReportAccess({
    request,
    account: user,
    allowedEmails,
    loadAdminRole: noAdminRole,
  });

// ---------------------------------------------------------------------------
// 1. iOS App Store users are not blocked by the private-beta approval gate.
// ---------------------------------------------------------------------------

test("an account created through the iOS app reaches the product without an invitation", async () => {
  const user = attested();

  // Not on the allowlist, and the allowlist is not even populated -- exactly
  // the position a brand-new App Store user is in.
  assert.equal(isPrivateBetaAllowed(user, ""), false);

  const access = await authorize(user, "");

  assert.equal(access.allowed, true);
  assert.equal(access.branch, "attested_ios_app_store");
});

test("the iOS account keeps working whatever the private-beta allowlist says", async () => {
  // Someone else's approval, or none at all, must not change the outcome for
  // an account whose access comes from its own attested provenance.
  for (const allowedEmails of ["", "someone.else@example.com", "a@b.com,c@d.com"]) {
    const access = await authorize(attested(), allowedEmails);
    assert.equal(access.allowed, true, `allowlist ${JSON.stringify(allowedEmails)}`);
  }
});

test("the OAuth callback no longer signs an attested account straight back out", () => {
  const callback = read("app/auth/callback/route.ts");

  // The gate must be a conjunction: still denied when neither holds, allowed
  // when either does.
  assert.match(
    callback,
    /if \(!isPrivateBetaAllowed\(user\) && !isAppAttestedAccount\(user\)\)/,
    "the callback must admit attested accounts without relaxing the allowlist"
  );
  assert.match(callback, /signOut\(\)/, "a denied account must still be signed out");
});

// ---------------------------------------------------------------------------
// 2. Web beta restrictions remain intact.
// ---------------------------------------------------------------------------

test("a web account with no invitation is still denied, exactly as before", async () => {
  const access = await authorize(account(), "");

  assert.equal(access.allowed, false);
  assert.equal(access.branch, "private_beta_denied");
});

test("the private-beta allowlist still governs every account that is not attested", async () => {
  const approved = account({ email: "approved@example.com" });
  const unapproved = account({ email: "stranger@example.com" });

  const allowed = await authorize(approved, "approved@example.com");
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.branch, "approved_beta", "approval must still come from the allowlist");

  const denied = await authorize(unapproved, "approved@example.com");
  assert.equal(denied.allowed, false);
});

test("registration is unavailable unless App Attest is configured, so the web cannot self-register", async () => {
  // The feature switch IS the configuration: with no Apple team and bundle
  // identifier there is nothing to verify against, and every endpoint refuses.
  // No boolean to forget, and the safe state is the default state.
  const config = read("app/lib/ios-attestation/config.ts");
  assert.match(config, /APPLE_TEAM_ID/);
  assert.match(config, /IOS_APP_BUNDLE_ID/);
  assert.match(config, /return null;/, "missing configuration must disable the feature");

  for (const route of [
    "app/api/ios/registration/route.ts",
    "app/api/ios/attestation/key/route.ts",
    "app/api/ios/attestation/challenge/route.ts",
  ]) {
    assert.match(
      read(route),
      /getAppAttestConfig\(\)[\s\S]{0,120}status: 404/,
      `${route} must refuse when App Attest is not configured`
    );
  }
});

test("no registration path exists that skips attestation", () => {
  const route = stripped("app/api/ios/registration/route.ts");

  // The account is only ever created after the assertion has been verified
  // AND its counter atomically advanced.
  const consumeAt = route.indexOf("consumeChallenge(");
  const verifyAt = route.indexOf("verifyAppAttestAssertion({");
  const recordAt = route.indexOf("recordAssertion(");
  const signUpAt = route.indexOf("auth.signUp(");

  assert.ok(
    [consumeAt, verifyAt, recordAt, signUpAt].every((index) => index > -1),
    "every step of the attested path must be present"
  );
  assert.ok(verifyAt < signUpAt, "the assertion must be verified before sign-up");
  assert.ok(recordAt < signUpAt, "the sign counter must be advanced before sign-up");
  assert.ok(
    consumeAt < verifyAt,
    "the challenge must be spent before verification, so failures cannot be retried"
  );

  // The old, disabled server action must stay disabled.
  assert.match(
    read("app/auth/actions.ts"),
    /registration_disabled/,
    "the unattested sign-up action must remain disabled"
  );
});

// ---------------------------------------------------------------------------
// 3. Android beta restrictions remain intact.
// ---------------------------------------------------------------------------

test("Android cannot obtain product access, because provenance is Apple-only", async () => {
  // There is no Android equivalent of an App Attest key: the marker can only
  // be written after an assertion has been verified against Apple's root CA,
  // which requires Apple hardware. An Android account is therefore an ordinary
  // account and stays subject to the allowlist.
  const androidAccount = account({ email: "android.user@example.com" });

  const access = await authorize(androidAccount, "");
  assert.equal(access.allowed, false);
  assert.equal(access.branch, "private_beta_denied");
});

test("the native platform switch is still iOS-only, so Android behaviour is untouched", () => {
  assert.match(
    read("app/layout.tsx"),
    /getPlatform\(\)==="ios"/,
    "the platform class must remain gated on iOS"
  );
  assert.match(
    read("app/lib/ios-attestation/client.ts"),
    /Capacitor\.getPlatform\(\) !== "ios"/,
    "the client bridge must refuse to run anywhere but iOS"
  );
});

// ---------------------------------------------------------------------------
// The single most dangerous mistake this design could make.
// ---------------------------------------------------------------------------

test("provenance is read from app_metadata, which the account holder cannot write", async () => {
  // user_metadata is writable by the user with one client-side
  // auth.updateUser({ data }) call. If the marker were read from there, ANY
  // signed-in account could grant itself product access and the private beta
  // would be over. This is the test that catches that.
  const selfClaimed = account({
    user_metadata: { registration_source: IOS_APP_ATTEST_REGISTRATION_SOURCE },
    app_metadata: {},
  });

  assert.equal(isAppAttestedAccount(selfClaimed), false);

  const access = await authorize(selfClaimed, "");
  assert.equal(access.allowed, false, "a self-claimed marker must grant nothing");

  assert.equal(isAppAttestedAccount(attested()), true);
});

test("the marker is only ever written with service-role credentials", () => {
  const store = stripped("app/lib/ios-attestation/store.ts");

  assert.match(
    store,
    /auth\.admin\.updateUserById\([\s\S]{0,200}app_metadata/,
    "provenance must be written through the admin API"
  );
  assert.doesNotMatch(
    store,
    /user_metadata:\s*\{[\s\S]{0,120}registration_source/,
    "provenance must never be written to user_metadata"
  );

  // And nothing outside that one server-only module writes it.
  for (const path of [
    "app/api/ios/registration/route.ts",
    "app/lib/ios-app-store-access.ts",
    "app/lib/ios-attestation/client.ts",
  ]) {
    assert.doesNotMatch(
      stripped(path),
      /updateUserById|user_metadata/,
      `${path} must not be able to set provenance`
    );
  }
});

test("only the existing Free tier is provisioned -- no new entitlement", () => {
  const store = stripped("app/lib/ios-attestation/store.ts");

  assert.match(store, /ensureFreeBillingProfile/);
  assert.doesNotMatch(
    store,
    /plan_tier:\s*["'](?!free)/,
    "registration must not grant any plan other than the existing free tier"
  );
});

test("email verification is not weakened: registration issues no session", () => {
  const route = stripped("app/api/ios/registration/route.ts");

  assert.match(
    route,
    /persistSession:\s*false/,
    "sign-up must use a cookie-free client so no session is ever written"
  );
  assert.doesNotMatch(
    route,
    /email_confirm\s*:\s*true/,
    "registration must never mark an address as confirmed"
  );
  assert.match(route, /emailVerificationRequired/);
});

test("challenge storage is bounded: issuing one purges the expired", () => {
  // FOUND IN AUDIT. Consuming a challenge deletes only the row it spends, so
  // every abandoned or failed attempt used to leave a row behind forever --
  // unbounded growth, and a cheap way to inflate storage at whatever rate
  // challenge issuance allows. The purge lives in the issue path because that
  // is where the growth comes from.
  const migration = read("supabase/migrations/20260925120000_create_ios_app_attest.sql");

  const issueAt = migration.indexOf("function public.issue_ios_attestation_challenge");
  assert.ok(issueAt > -1, "challenges must be issued through the RPC");

  const body = migration.slice(issueAt, migration.indexOf("$$;", issueAt));
  assert.match(
    body,
    /delete from public\.ios_attestation_challenges where expires_at <= now\(\)/,
    "issuing a challenge must purge the expired ones"
  );
  assert.match(body, /insert into public\.ios_attestation_challenges/);

  assert.match(
    read("app/lib/ios-attestation/store.ts"),
    /rpc\(\s*\n?\s*"issue_ios_attestation_challenge"/,
    "the application must issue through the purging RPC, not a bare insert"
  );
});

test("the migration is service-role only and additive", () => {
  const migration = read("supabase/migrations/20260925120000_create_ios_app_attest.sql");

  for (const table of ["ios_attestation_challenges", "ios_attested_keys"]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`),
      `${table} must have RLS enabled`
    );
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from anon, authenticated`),
      `${table} must be unreachable from client roles`
    );
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }

  // Zero policies, so RLS denies every role except service_role.
  assert.doesNotMatch(migration, /create policy/i, "these tables must have no policies at all");
  // Purely additive: nothing pre-existing is altered or dropped.
  assert.doesNotMatch(migration, /drop table|drop function|alter table (?!public\.ios_)/i);
  for (const fn of [
    "issue_ios_attestation_challenge",
    "consume_ios_attestation_challenge",
    "record_ios_attested_assertion",
  ]) {
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${fn}[^;]*to service_role`),
      `${fn} must be granted only to service_role`
    );
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${fn}[\\s\\S]{0,80}from public, anon, authenticated`),
      `${fn} must be revoked from client roles`
    );
  }
  // security definer functions must pin an empty search_path.
  assert.equal(
    (migration.match(/security definer/g) || []).length,
    (migration.match(/set search_path = ''/g) || []).length,
    "every security-definer function must pin search_path"
  );
});

test("no client-controlled signal can unlock registration", () => {
  // The reason this whole mechanism exists. A User-Agent, a custom header, a
  // cookie or a hostname are all things a browser can send just as easily as
  // the app, so none of them may take part in the decision. The only thing
  // that does is a signature the server verifies against Apple's root CA.
  for (const path of [
    "app/api/ios/registration/route.ts",
    "app/api/ios/attestation/key/route.ts",
    "app/api/ios/attestation/challenge/route.ts",
    "app/lib/ios-attestation/app-attest.ts",
    "app/lib/ios-attestation/store.ts",
    "app/lib/ios-app-store-access.ts",
  ]) {
    assert.doesNotMatch(
      stripped(path),
      /user-?agent|x-platform|x-capacitor|x-native|isNativePlatform|getPlatform/i,
      `${path} must not consult any client-declared platform signal`
    );
  }

  // And the root of trust really is Apple's, pinned in the source rather than
  // taken from the system trust store or supplied by the caller.
  const verifier = stripped("app/lib/ios-attestation/app-attest.ts");
  assert.match(verifier, /APPLE_APP_ATTEST_ROOT_CA_PEM\s*=\s*`-----BEGIN CERTIFICATE-----/);
  assert.match(verifier, /rootCertificatePem = APPLE_APP_ATTEST_ROOT_CA_PEM/);
});
