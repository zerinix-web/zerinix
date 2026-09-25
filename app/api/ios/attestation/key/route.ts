import { NextRequest } from "next/server";
import { noStoreJson } from "@/app/lib/security/api-response";
import { checkRateLimit, getClientIpFromRequest } from "@/app/lib/security/rate-limit";
import { validateApiRequest } from "@/app/lib/security/request-validation";
import { getAppAttestConfig } from "@/app/lib/ios-attestation/config";
import {
  CHALLENGE_PURPOSE_ATTESTATION,
  consumeChallenge,
  saveAttestedKey,
} from "@/app/lib/ios-attestation/store";
import {
  AppAttestError,
  verifyAppAttestAttestation,
} from "@/app/lib/ios-attestation/app-attest";
import { decodeBase64 } from "@/app/lib/ios-attestation/encoding";

/**
 * Registers one App Attest key, once per app install.
 *
 * This is the step that turns "a request claiming to be the iOS app" into
 * something the server has actually proved: the attestation chains to Apple's
 * pinned root CA, is bound to this server's challenge, and is bound to this
 * app's team and bundle identifier. Nothing a browser can produce passes it.
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
  const rateLimit = checkRateLimit(`ios:attest:key:${ip}`, { limit: 10, windowMs: 60_000 });

  if (!rateLimit.allowed) {
    return noStoreJson({ error: "Too many requests." }, { status: 429 });
  }

  let body: { keyId?: unknown; attestation?: unknown; challenge?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "Invalid request." }, { status: 400 });
  }

  const { keyId, attestation, challenge } = body;

  if (
    typeof keyId !== "string" ||
    typeof attestation !== "string" ||
    typeof challenge !== "string" ||
    !keyId ||
    !attestation ||
    !challenge
  ) {
    return noStoreJson({ error: "Invalid request." }, { status: 400 });
  }

  // Spent before verification, and spent exactly once: a challenge is burned
  // whether or not the attestation that follows turns out to be valid, so a
  // failed attempt cannot be retried against the same challenge.
  let challengeSpent: boolean;
  try {
    challengeSpent = await consumeChallenge(challenge, CHALLENGE_PURPOSE_ATTESTATION);
  } catch (error) {
    console.error("[ios-attestation] challenge consume failed", error);
    return noStoreJson({ error: "Registration is not available." }, { status: 503 });
  }

  if (!challengeSpent) {
    return noStoreJson({ error: "Attestation could not be verified." }, { status: 401 });
  }

  const attestationObject = decodeBase64(attestation);

  if (!attestationObject) {
    return noStoreJson({ error: "Attestation could not be verified." }, { status: 401 });
  }

  try {
    const result = verifyAppAttestAttestation({
      attestationObject,
      keyId,
      challenge: Buffer.from(challenge, "utf8"),
      teamId: config.teamId,
      bundleId: config.bundleId,
      allowDevelopmentAttestation: config.allowDevelopmentAttestation,
    });

    const saved = await saveAttestedKey({
      keyId,
      publicKeyPem: result.publicKeyPem,
      environment: result.environment,
    });

    if (!saved.ok) {
      // Almost always a duplicate key id, i.e. this key was already attested.
      // Re-attesting would reset the sign counter, so it is refused rather
      // than treated as success.
      return noStoreJson({ error: "Attestation could not be verified." }, { status: 401 });
    }

    return noStoreJson({ ok: true });
  } catch (error) {
    if (error instanceof AppAttestError) {
      // The specific reason stays server-side: telling a caller exactly which
      // check failed is a map for forging the next attempt.
      console.warn("[ios-attestation] attestation rejected", { reason: error.message });
      return noStoreJson({ error: "Attestation could not be verified." }, { status: 401 });
    }

    console.error("[ios-attestation] attestation failed", error);
    return noStoreJson({ error: "Registration is not available." }, { status: 503 });
  }
}
