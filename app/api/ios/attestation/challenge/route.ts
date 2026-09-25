import { NextRequest } from "next/server";
import { noStoreJson } from "@/app/lib/security/api-response";
import { checkRateLimit, getClientIpFromRequest } from "@/app/lib/security/rate-limit";
import { validateApiRequest } from "@/app/lib/security/request-validation";
import { getAppAttestConfig } from "@/app/lib/ios-attestation/config";
import {
  CHALLENGE_PURPOSE_ATTESTATION,
  CHALLENGE_PURPOSE_REGISTRATION,
  issueChallenge,
} from "@/app/lib/ios-attestation/store";

const PURPOSES = new Set([CHALLENGE_PURPOSE_ATTESTATION, CHALLENGE_PURPOSE_REGISTRATION]);

/**
 * Hands out a single-use App Attest challenge.
 *
 * Deliberately unauthenticated -- the caller has no account yet, that being
 * the point -- and deliberately useless on its own: a challenge only becomes
 * anything when returned inside an attestation or assertion that verifies
 * against Apple's root CA. Anyone can fetch one; nobody can do anything with
 * one without an Apple device running this app.
 */
export async function POST(request: NextRequest) {
  const validation = validateApiRequest(request, { maxBodyBytes: 1_000 });

  if (!validation.ok) {
    return noStoreJson({ error: validation.message }, { status: validation.status });
  }

  if (!getAppAttestConfig()) {
    return noStoreJson({ error: "Registration is not available." }, { status: 404 });
  }

  const ip = getClientIpFromRequest(request);
  // Bounded so challenge issuance cannot be used to flood the table.
  const rateLimit = checkRateLimit(`ios:attest:challenge:${ip}`, {
    limit: 20,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return noStoreJson({ error: "Too many requests." }, { status: 429 });
  }

  let purpose: unknown;
  try {
    purpose = (await request.json())?.purpose;
  } catch {
    return noStoreJson({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof purpose !== "string" || !PURPOSES.has(purpose)) {
    return noStoreJson({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const { challenge, expiresAt } = await issueChallenge(purpose);
    return noStoreJson({ challenge, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    console.error("[ios-attestation] challenge issue failed", error);
    return noStoreJson({ error: "Registration is not available." }, { status: 503 });
  }
}
