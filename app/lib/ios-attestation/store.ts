import "server-only";

import { randomBytes } from "node:crypto";
import { createServiceRoleClient } from "@/app/lib/supabase/admin";

// Durable state for App Attest. Service-role only -- see
// supabase/migrations/20260925120000_create_ios_app_attest.sql, where both
// tables have RLS on with zero policies, so no client role can read or write
// them even with a valid session.

export const CHALLENGE_PURPOSE_ATTESTATION = "attestation";
export const CHALLENGE_PURPOSE_REGISTRATION = "registration";

// Long enough to survive a slow device round trip, short enough that a
// captured challenge is worthless almost immediately.
const CHALLENGE_TTL_SECONDS = 120;

/**
 * Mints a single-use challenge.
 *
 * 32 bytes from the CSPRNG: the challenge is the only thing preventing an
 * attestation from being replayed, so it must be unguessable rather than
 * merely unique.
 */
export async function issueChallenge(purpose: string) {
  const challenge = randomBytes(32).toString("base64url");
  // The RPC also purges expired challenges, so the table cannot grow without
  // bound from attempts that were started and never finished.
  const { data, error } = await createServiceRoleClient().rpc(
    "issue_ios_attestation_challenge",
    { p_challenge: challenge, p_purpose: purpose, p_ttl_seconds: CHALLENGE_TTL_SECONDS }
  );

  if (error || !Array.isArray(data) || data.length !== 1) {
    throw new Error(
      `Could not issue an attestation challenge: ${error?.message ?? "no row returned"}`
    );
  }

  return { challenge, expiresAt: new Date(data[0].expires_at as string) };
}

/**
 * Spends a challenge, returning false if it was already spent, expired, or
 * issued for a different purpose. The single-use guarantee is the database's,
 * not this function's -- see consume_ios_attestation_challenge.
 */
export async function consumeChallenge(challenge: string, purpose: string) {
  const { data, error } = await createServiceRoleClient().rpc(
    "consume_ios_attestation_challenge",
    { p_challenge: challenge, p_purpose: purpose }
  );

  if (error) {
    throw new Error(`Could not consume the attestation challenge: ${error.message}`);
  }

  return Array.isArray(data) && data.length === 1;
}

export async function saveAttestedKey(input: {
  keyId: string;
  publicKeyPem: string;
  environment: "production" | "development";
}) {
  // insert, not upsert: re-attesting an existing key id would reset its sign
  // counter, which is exactly the rollback the counter exists to detect.
  const { error } = await createServiceRoleClient()
    .from("ios_attested_keys")
    .insert({
      key_id: input.keyId,
      public_key_pem: input.publicKeyPem,
      environment: input.environment,
      sign_count: 0,
    });

  if (error) {
    return { ok: false as const, reason: error.message };
  }

  return { ok: true as const };
}

export async function loadAttestedKey(keyId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("ios_attested_keys")
    .select("key_id, public_key_pem, sign_count, environment")
    .eq("key_id", keyId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load the attested key: ${error.message}`);
  }

  return data
    ? {
        keyId: data.key_id as string,
        publicKeyPem: data.public_key_pem as string,
        signCount: Number(data.sign_count),
        environment: data.environment as "production" | "development",
      }
    : null;
}

/**
 * Advances the sign counter, and only forwards. False means the assertion was
 * a replay or came from a cloned key, and the caller must reject the request.
 */
export async function recordAssertion(keyId: string, signCount: number) {
  const { data, error } = await createServiceRoleClient().rpc(
    "record_ios_attested_assertion",
    { p_key_id: keyId, p_sign_count: signCount }
  );

  if (error) {
    throw new Error(`Could not record the assertion: ${error.message}`);
  }

  return Array.isArray(data) && data.length === 1;
}

// ---------------------------------------------------------------------------
// Account creation.
//
// These live here, beside the other service-role calls, rather than in the
// route: this repo confines service-role credentials to a small allowlist of
// server-only modules (see admin-panel-security.test.mjs), and adding one
// module to that list is better than adding several.
// ---------------------------------------------------------------------------

import { IOS_APP_ATTEST_REGISTRATION_SOURCE } from "@/app/lib/ios-app-store-access";
import { ensureFreeBillingProfile } from "@/app/lib/auth/provision-user";

/**
 * Records, in app_metadata, that this account was created through a verified
 * App Attest assertion.
 *
 * app_metadata is writable only with the service-role key. The same marker in
 * user_metadata could be set by the account holder themselves, which would let
 * anybody grant themselves product access -- see app/lib/ios-app-store-access.ts.
 */
export async function markAccountAsAppAttested(userId: string, keyId: string) {
  const { error } = await createServiceRoleClient().auth.admin.updateUserById(userId, {
    app_metadata: {
      registration_source: IOS_APP_ATTEST_REGISTRATION_SOURCE,
      attested_key_id: keyId,
      attested_at: new Date().toISOString(),
    },
  });

  return error ? { ok: false as const, reason: error.message } : { ok: true as const };
}

/**
 * Removes a half-created account.
 *
 * Only ever called when provisioning failed immediately after sign-up, so the
 * alternative is leaving an account that exists but can never gain access and
 * whose email address is now permanently taken.
 */
export async function deleteHalfProvisionedAccount(userId: string) {
  const { error } = await createServiceRoleClient().auth.admin.deleteUser(userId);

  if (error) {
    console.error("[ios-attestation] could not roll back a half-created account", {
      userId,
      reason: error.message,
    });
  }
}

/** The existing Free tier, with its existing quotas. Nothing new is granted. */
export async function provisionFreeTier(userId: string) {
  return ensureFreeBillingProfile(createServiceRoleClient(), userId);
}
