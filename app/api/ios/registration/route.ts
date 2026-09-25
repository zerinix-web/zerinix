import { NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { noStoreJson } from "@/app/lib/security/api-response";
import { checkRateLimit, getClientIpFromRequest } from "@/app/lib/security/rate-limit";
import { validateApiRequest } from "@/app/lib/security/request-validation";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/app/lib/supabase/env";
import { getAppAttestConfig } from "@/app/lib/ios-attestation/config";
import {
  CHALLENGE_PURPOSE_REGISTRATION,
  consumeChallenge,
  deleteHalfProvisionedAccount,
  loadAttestedKey,
  markAccountAsAppAttested,
  provisionFreeTier,
  recordAssertion,
} from "@/app/lib/ios-attestation/store";
import {
  AppAttestError,
  verifyAppAttestAssertion,
} from "@/app/lib/ios-attestation/app-attest";
import { decodeBase64 } from "@/app/lib/ios-attestation/encoding";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MINIMUM_PASSWORD_LENGTH = 8;

/**
 * Creates a ZERINIX account for a verified instance of the iOS app.
 *
 * The whole security of self-service registration rests on one step below:
 * the App Attest assertion. Everything a browser could send is accepted here
 * -- the endpoint is public, the shape is ordinary JSON -- and none of it
 * matters, because without an assertion that verifies against a key this
 * server previously attested to Apple's root CA, no account is ever created.
 *
 * What this does NOT do: it does not bypass email verification (Supabase
 * sends its confirmation and no session is issued here, so the account is
 * unusable until the address is confirmed), it does not grant any plan beyond
 * the existing Free tier, and it does not touch the private-beta allowlist,
 * which still governs every account that did not come through this path.
 */
export async function POST(request: NextRequest) {
  const validation = validateApiRequest(request, { maxBodyBytes: 20_000 });

  if (!validation.ok) {
    return noStoreJson({ error: validation.message }, { status: validation.status });
  }

  const config = getAppAttestConfig();

  if (!config) {
    return noStoreJson({ error: "Registration is not available." }, { status: 404 });
  }

  const ip = getClientIpFromRequest(request);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "Invalid request." }, { status: 400 });
  }

  const keyId = typeof body.keyId === "string" ? body.keyId : "";
  const assertion = typeof body.assertion === "string" ? body.assertion : "";
  const challenge = typeof body.challenge === "string" ? body.challenge : "";
  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const fullName = (typeof body.fullName === "string" ? body.fullName : "").trim();

  // Mirrors the existing signup rate limits in app/auth/actions.ts, keyed by
  // both address and origin so neither dimension alone can be used to grind.
  const rateLimit = checkRateLimit(`ios:registration:${ip}:${email}`, {
    limit: 5,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return noStoreJson({ error: "Too many requests." }, { status: 429 });
  }

  if (!keyId || !assertion || !challenge) {
    return noStoreJson({ error: "Invalid request." }, { status: 400 });
  }

  // Key identifiers are stored in exactly one canonical encoding (see
  // verifyAppAttestAttestation), so anything else cannot name a stored key
  // and is rejected before it reaches the database.
  if (!decodeBase64(keyId)) {
    return noStoreJson({ error: "unverified_device" }, { status: 401 });
  }

  if (!EMAIL_PATTERN.test(email)) {
    return noStoreJson({ error: "invalid_email" }, { status: 400 });
  }

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return noStoreJson({ error: "weak_password" }, { status: 400 });
  }

  const assertionBytes = decodeBase64(assertion);

  if (!assertionBytes) {
    return noStoreJson({ error: "unverified_device" }, { status: 401 });
  }

  // Burn the challenge first, and exactly once. Everything after this is
  // single-shot: a caller cannot probe the verification steps by retrying.
  let challengeSpent: boolean;
  try {
    challengeSpent = await consumeChallenge(challenge, CHALLENGE_PURPOSE_REGISTRATION);
  } catch (error) {
    console.error("[ios-registration] challenge consume failed", error);
    return noStoreJson({ error: "Registration is not available." }, { status: 503 });
  }

  if (!challengeSpent) {
    return noStoreJson({ error: "unverified_device" }, { status: 401 });
  }

  try {
    const attestedKey = await loadAttestedKey(keyId);

    if (!attestedKey) {
      return noStoreJson({ error: "unverified_device" }, { status: 401 });
    }

    if (attestedKey.environment === "development" && !config.allowDevelopmentAttestation) {
      return noStoreJson({ error: "unverified_device" }, { status: 401 });
    }

    // The signed client data binds the assertion to this challenge AND this
    // email address, so an assertion captured for one registration cannot be
    // replayed to create an account under a different address.
    const clientData = Buffer.from(`${challenge}:${email}`, "utf8");

    const verified = verifyAppAttestAssertion({
      assertion: assertionBytes,
      clientData,
      publicKeyPem: attestedKey.publicKeyPem,
      previousSignCount: attestedKey.signCount,
      teamId: config.teamId,
      bundleId: config.bundleId,
    });

    // The counter advance is atomic in the database, so two identical
    // assertions racing each other cannot both get through.
    if (!(await recordAssertion(keyId, verified.signCount))) {
      return noStoreJson({ error: "unverified_device" }, { status: 401 });
    }
  } catch (error) {
    if (error instanceof AppAttestError) {
      console.warn("[ios-registration] assertion rejected", { reason: error.message });
      return noStoreJson({ error: "unverified_device" }, { status: 401 });
    }

    console.error("[ios-registration] verification failed", error);
    return noStoreJson({ error: "Registration is not available." }, { status: 503 });
  }

  // From here the device is proven. Create the account.
  const supabaseUrl = getSupabaseUrl();
  const publishableKey = getSupabasePublishableKey();

  if (!supabaseUrl || !publishableKey) {
    return noStoreJson({ error: "Registration is not available." }, { status: 503 });
  }

  // A plain, cookie-free client on purpose. The cookie-bound server client
  // would persist whatever session Supabase returned, and if a project ever
  // had email confirmation switched off that would sign the user in without a
  // verified address. Here no session is ever written, so the only way into
  // the account is a normal sign-in, which enforces confirmation itself.
  const supabase = createSupabaseClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: fullName ? { full_name: fullName } : {} },
  });

  if (error || !data.user) {
    // Supabase does not distinguish "already registered" here by design, and
    // neither does this: doing so would turn the endpoint into an oracle for
    // which addresses hold ZERINIX accounts.
    console.warn("[ios-registration] sign-up rejected", { reason: error?.message });
    return noStoreJson({ error: "registration_failed" }, { status: 400 });
  }

  const marked = await markAccountAsAppAttested(data.user.id, keyId);

  if (!marked.ok) {
    // Without the marker the account exists but can never gain product
    // access, and its address is taken. Roll it back so the user can retry.
    console.error("[ios-registration] could not record provenance", { reason: marked.reason });
    await deleteHalfProvisionedAccount(data.user.id);
    return noStoreJson({ error: "Registration is not available." }, { status: 503 });
  }

  const provisioned = await provisionFreeTier(data.user.id);

  if (!provisioned.ok) {
    console.error("[ios-registration] could not provision the free tier", {
      userId: data.user.id,
    });
    await deleteHalfProvisionedAccount(data.user.id);
    return noStoreJson({ error: "Registration is not available." }, { status: 503 });
  }

  return noStoreJson({ ok: true, emailVerificationRequired: true });
}
