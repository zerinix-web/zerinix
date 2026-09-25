import { createHash, createPublicKey, createVerify, X509Certificate } from "node:crypto";
import { decodeCbor } from "./cbor.ts";
import { decodeBase64 } from "./encoding.ts";

// Apple App Attestation Root CA, fetched from
// https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
// (self-signed; SHA-256 fingerprint
// 1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32).
//
// Pinned rather than read from the system trust store: this is the ONE anchor
// that makes an attestation mean anything. If the chain could terminate at any
// publicly trusted CA, anybody able to obtain a certificate could forge a
// device attestation and the entire signal would be worthless.
export const APPLE_APP_ATTEST_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

export class AppAttestError extends Error {}

// Apple's per-credential nonce lives in this private certificate extension:
// 1.2.840.113635.100.8.2, DER-encoded as an OBJECT IDENTIFIER.
//
// The content is nine bytes -- 1.2 packs into one (0x2a), then 840, 113635,
// 100, 8 and 2 -- so the header is `06 09`. Verified against a real
// certificate rather than counted by hand; tests/ios-app-attest.test.mjs
// pins it so an off-by-one here cannot silently make every attestation fail
// (or, worse, make the extension search match the wrong bytes).
const NONCE_EXTENSION_OID = Buffer.from([
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02,
]);

// Production builds carry "appattest" + seven NUL bytes; development builds
// carry "appattestdevelop".
const AAGUID_PRODUCTION = Buffer.concat([
  Buffer.from("appattest", "utf8"),
  Buffer.alloc(7),
]);
const AAGUID_DEVELOPMENT = Buffer.from("appattestdevelop", "utf8");

const sha256 = (...parts: Buffer[]) => {
  const hash = createHash("sha256");
  parts.forEach((part) => hash.update(part));
  return hash.digest();
};

// ---------------------------------------------------------------------------
// The smallest DER reader that can reach the nonce extension.
// ---------------------------------------------------------------------------

type Tlv = {
  tag: number;
  contentStart: number;
  contentLength: number;
  end: number;
};

function readTlv(der: Buffer, offset: number): Tlv {
  if (offset + 2 > der.length) {
    throw new AppAttestError("Malformed DER: truncated tag");
  }

  const tag = der[offset];
  const first = der[offset + 1];
  let contentStart = offset + 2;
  let contentLength: number;

  if (first < 0x80) {
    contentLength = first;
  } else {
    const byteCount = first & 0x7f;

    // Indefinite length (0x80) and anything wider than four bytes are not
    // valid DER for a certificate extension.
    if (byteCount === 0 || byteCount > 4 || contentStart + byteCount > der.length) {
      throw new AppAttestError("Malformed DER: unsupported length encoding");
    }

    contentLength = 0;
    for (let index = 0; index < byteCount; index += 1) {
      contentLength = contentLength * 256 + der[contentStart + index];
    }
    contentStart += byteCount;
  }

  const end = contentStart + contentLength;

  if (end > der.length) {
    throw new AppAttestError("Malformed DER: length runs past the end");
  }

  return { tag, contentStart, contentLength, end };
}

function expectTlv(der: Buffer, offset: number, tag: number, what: string): Tlv {
  const tlv = readTlv(der, offset);

  if (tlv.tag !== tag) {
    throw new AppAttestError(
      `Malformed DER: expected ${what} (0x${tag.toString(16)}), found 0x${tlv.tag.toString(16)}`
    );
  }

  return tlv;
}

/**
 * Pulls Apple's nonce out of the leaf certificate's private extension.
 *
 * ORDERING MATTERS: this runs only AFTER the certificate chain has been
 * verified up to the pinned Apple root, so the bytes being scanned are
 * Apple-signed and cannot have been chosen by the caller. Searching for the
 * OID before that point would be reading attacker-controlled input.
 */
function readNonceExtension(certificateDer: Buffer): Buffer {
  const oidIndex = certificateDer.indexOf(NONCE_EXTENSION_OID);

  if (oidIndex === -1) {
    throw new AppAttestError("Attestation certificate has no Apple nonce extension");
  }

  let cursor = oidIndex + NONCE_EXTENSION_OID.length;

  // The optional `critical` BOOLEAN sits between the OID and the value.
  const afterOid = readTlv(certificateDer, cursor);
  if (afterOid.tag === 0x01) {
    cursor = afterOid.end;
  }

  const extensionValue = expectTlv(certificateDer, cursor, 0x04, "extension OCTET STRING");
  const inner = certificateDer.subarray(extensionValue.contentStart, extensionValue.end);

  // SEQUENCE { [1] { OCTET STRING nonce } }
  const sequence = expectTlv(inner, 0, 0x30, "extension SEQUENCE");
  const context = expectTlv(inner, sequence.contentStart, 0xa1, "context tag [1]");
  const octets = expectTlv(inner, context.contentStart, 0x04, "nonce OCTET STRING");

  if (octets.contentLength !== 32) {
    throw new AppAttestError("Apple nonce extension is not a SHA-256 digest");
  }

  return Buffer.from(inner.subarray(octets.contentStart, octets.end));
}

// ---------------------------------------------------------------------------
// authenticator data
// ---------------------------------------------------------------------------

export type AuthenticatorData = {
  rpIdHash: Buffer;
  flags: number;
  signCount: number;
  aaguid: Buffer | null;
  credentialId: Buffer | null;
};

function parseAuthenticatorData(authData: Buffer): AuthenticatorData {
  if (authData.length < 37) {
    throw new AppAttestError("Authenticator data is too short");
  }

  const rpIdHash = Buffer.from(authData.subarray(0, 32));
  const flags = authData[32];
  const signCount = authData.readUInt32BE(33);

  if (authData.length === 37) {
    return { rpIdHash, flags, signCount, aaguid: null, credentialId: null };
  }

  if (authData.length < 55) {
    throw new AppAttestError("Authenticator data has a truncated attested credential");
  }

  const aaguid = Buffer.from(authData.subarray(37, 53));
  const credentialIdLength = authData.readUInt16BE(53);

  if (55 + credentialIdLength > authData.length) {
    throw new AppAttestError("Authenticator data credential id runs past the end");
  }

  const credentialId = Buffer.from(authData.subarray(55, 55 + credentialIdLength));

  return { rpIdHash, flags, signCount, aaguid, credentialId };
}

/** The relying-party identifier Apple hashes into every attestation. */
export function appIdentifier(teamId: string, bundleId: string) {
  return `${teamId}.${bundleId}`;
}

// ---------------------------------------------------------------------------
// public keys
// ---------------------------------------------------------------------------

/**
 * The uncompressed P-256 point (0x04 || X || Y) that Apple hashes to produce
 * the key identifier. Derived from the JWK rather than sliced off the end of
 * an SPKI blob, so a different curve or encoding fails loudly instead of
 * silently hashing the wrong 65 bytes.
 */
function uncompressedPoint(publicKeyPem: string): Buffer {
  const jwk = createPublicKey(publicKeyPem).export({ format: "jwk" }) as {
    kty?: string;
    crv?: string;
    x?: string;
    y?: string;
  };

  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new AppAttestError("Attested key is not an EC P-256 key");
  }

  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");

  if (x.length !== 32 || y.length !== 32) {
    throw new AppAttestError("Attested key has malformed coordinates");
  }

  return Buffer.concat([Buffer.from([0x04]), x, y]);
}

// ---------------------------------------------------------------------------
// attestation
// ---------------------------------------------------------------------------

export type AttestationInput = {
  /** The raw CBOR attestation object from DCAppAttestService.attestKey. */
  attestationObject: Buffer;
  /** The key identifier the device reported, base64. */
  keyId: string;
  /** The single-use challenge this server issued. */
  challenge: Buffer;
  teamId: string;
  bundleId: string;
  /** Overridable only so tests can pin a fixed moment. */
  now?: Date;
  /** Overridable only so tests can anchor a synthetic chain. */
  rootCertificatePem?: string;
  /** Development builds attest with a different AAGUID. */
  allowDevelopmentAttestation?: boolean;
};

export type AttestationResult = {
  publicKeyPem: string;
  signCount: number;
  environment: "production" | "development";
};

/**
 * Verifies an App Attest attestation and returns the device public key to
 * store.
 *
 * Every step below is load-bearing; each one is the reason a different forgery
 * does not work. They follow Apple's "Validating Apps That Connect to Your
 * Server" procedure in order.
 */
export function verifyAppAttestAttestation(input: AttestationInput): AttestationResult {
  const {
    attestationObject,
    keyId,
    challenge,
    teamId,
    bundleId,
    now = new Date(),
    rootCertificatePem = APPLE_APP_ATTEST_ROOT_CA_PEM,
    allowDevelopmentAttestation = false,
  } = input;

  if (!teamId.trim() || !bundleId.trim()) {
    throw new AppAttestError("App Attest is not configured: missing team or bundle identifier");
  }

  if (challenge.length < 16) {
    throw new AppAttestError("Attestation challenge is too short to be unguessable");
  }

  const decoded = decodeCbor(attestationObject) as {
    fmt?: unknown;
    attStmt?: { x5c?: unknown; receipt?: unknown };
    authData?: unknown;
  };

  if (decoded?.fmt !== "apple-appattest") {
    throw new AppAttestError("Attestation is not in the apple-appattest format");
  }

  const x5c = decoded.attStmt?.x5c;
  const authData = decoded.authData;

  if (!Array.isArray(x5c) || x5c.length < 2 || !x5c.every((item) => Buffer.isBuffer(item))) {
    throw new AppAttestError("Attestation statement has no certificate chain");
  }

  if (!Buffer.isBuffer(authData)) {
    throw new AppAttestError("Attestation has no authenticator data");
  }

  // 1. Chain the leaf to Apple's root. Without the pinned anchor on the far
  //    end, nothing below proves the key came from Apple hardware: anybody
  //    able to obtain a certificate from any CA could mint attestations.
  //
  //    The anchoring happens in the final iteration, where the last
  //    certificate the caller supplied is verified against `root` rather than
  //    against anything from the chain. That is the only reason this loop is
  //    a trust decision and not just an internal-consistency check, so the
  //    ternary below must never be changed to fall back to the chain itself.
  const chain = (x5c as Buffer[]).map((der) => new X509Certificate(der));
  const root = new X509Certificate(rootCertificatePem);

  for (let index = 0; index < chain.length; index += 1) {
    const certificate = chain[index];
    const issuer = index + 1 < chain.length ? chain[index + 1] : root;

    if (!certificate.checkIssued(issuer) || !certificate.verify(issuer.publicKey)) {
      throw new AppAttestError("Attestation certificate chain does not verify");
    }

    if (new Date(certificate.validFrom) > now || new Date(certificate.validTo) < now) {
      throw new AppAttestError("Attestation certificate is outside its validity window");
    }
  }

  const leaf = chain[0];

  // 2. Bind the attestation to THIS server's challenge. Without it a captured
  //    attestation could be replayed forever.
  const clientDataHash = sha256(challenge);
  const expectedNonce = sha256(authData, clientDataHash);
  const certificateNonce = readNonceExtension(Buffer.from(leaf.raw));

  if (!timingSafeEqualBuffers(expectedNonce, certificateNonce)) {
    throw new AppAttestError("Attestation nonce does not match the issued challenge");
  }

  const parsed = parseAuthenticatorData(authData);

  // 3. Bind it to THIS app. Otherwise any App Attest-enabled app would do.
  const expectedRpIdHash = sha256(Buffer.from(appIdentifier(teamId, bundleId), "utf8"));
  if (!timingSafeEqualBuffers(expectedRpIdHash, parsed.rpIdHash)) {
    throw new AppAttestError("Attestation was produced for a different application");
  }

  // 4. A fresh attested key always starts at zero.
  if (parsed.signCount !== 0) {
    throw new AppAttestError("A newly attested key must have a sign count of zero");
  }

  const environment = resolveEnvironment(parsed.aaguid, allowDevelopmentAttestation);

  // 5. The key identifier must be the hash of the attested key, and must match
  //    the identifier the client claimed -- so the client cannot attest one key
  //    and then assert with another.
  const publicKeyPem = leaf.publicKey.export({ format: "pem", type: "spki" }).toString();
  const expectedKeyId = sha256(uncompressedPoint(publicKeyPem));

  if (!parsed.credentialId || !timingSafeEqualBuffers(expectedKeyId, parsed.credentialId)) {
    throw new AppAttestError("Attested credential id is not the hash of the attested key");
  }

  // Strict, canonical base64 -- not Buffer.from(keyId, "base64"), which
  // silently discards characters it does not understand and accepts
  // base64url and unpadded input too. Several distinct strings would then
  // decode to the same key, and because the identifier is this row's primary
  // key, the same device key could be stored twice, each copy carrying its
  // own sign counter. That would reopen the counter rollback the counter
  // exists to prevent. One key, one string.
  const claimedKeyId = decodeBase64(keyId);

  if (!claimedKeyId || !timingSafeEqualBuffers(expectedKeyId, claimedKeyId)) {
    throw new AppAttestError("Key identifier does not match the attested key");
  }

  return { publicKeyPem, signCount: parsed.signCount, environment };
}

function resolveEnvironment(aaguid: Buffer | null, allowDevelopment: boolean) {
  if (aaguid && timingSafeEqualBuffers(aaguid, AAGUID_PRODUCTION)) {
    return "production" as const;
  }

  if (aaguid && timingSafeEqualBuffers(aaguid, AAGUID_DEVELOPMENT)) {
    if (!allowDevelopment) {
      // A development attestation is produced by a debug build, which an
      // attacker can run on their own device. It must never be accepted by a
      // production deployment.
      throw new AppAttestError("Development attestations are not accepted here");
    }

    return "development" as const;
  }

  throw new AppAttestError("Attestation has an unrecognised AAGUID");
}

// ---------------------------------------------------------------------------
// assertion
// ---------------------------------------------------------------------------

export type AssertionInput = {
  /** The raw CBOR assertion from DCAppAttestService.generateAssertion. */
  assertion: Buffer;
  /** Exactly the bytes the client signed over. */
  clientData: Buffer;
  /** The public key stored when this key was attested. */
  publicKeyPem: string;
  /** The highest sign count already recorded for this key. */
  previousSignCount: number;
  teamId: string;
  bundleId: string;
};

export type AssertionResult = {
  signCount: number;
};

/**
 * Verifies one App Attest assertion.
 *
 * The assertion, not the attestation, is what authenticates an individual
 * request: the attestation happens once per install, while every protected
 * call carries a fresh assertion over that call's own client data.
 */
export function verifyAppAttestAssertion(input: AssertionInput): AssertionResult {
  const { assertion, clientData, publicKeyPem, previousSignCount, teamId, bundleId } = input;

  if (!teamId.trim() || !bundleId.trim()) {
    throw new AppAttestError("App Attest is not configured: missing team or bundle identifier");
  }

  const decoded = decodeCbor(assertion) as {
    signature?: unknown;
    authenticatorData?: unknown;
  };

  const signature = decoded?.signature;
  const authenticatorData = decoded?.authenticatorData;

  if (!Buffer.isBuffer(signature) || !Buffer.isBuffer(authenticatorData)) {
    throw new AppAttestError("Assertion is missing its signature or authenticator data");
  }

  const parsed = parseAuthenticatorData(authenticatorData);

  const expectedRpIdHash = sha256(Buffer.from(appIdentifier(teamId, bundleId), "utf8"));
  if (!timingSafeEqualBuffers(expectedRpIdHash, parsed.rpIdHash)) {
    throw new AppAttestError("Assertion was produced for a different application");
  }

  // Strictly increasing, so a captured assertion cannot be replayed and two
  // copies of the same key (a clone) cannot both stay usable.
  if (parsed.signCount <= previousSignCount) {
    throw new AppAttestError("Assertion sign count did not increase");
  }

  const clientDataHash = sha256(clientData);
  const nonce = sha256(authenticatorData, clientDataHash);

  const verifier = createVerify("sha256");
  verifier.update(nonce);
  verifier.end();

  if (!verifier.verify(createPublicKey(publicKeyPem), signature)) {
    throw new AppAttestError("Assertion signature does not verify");
  }

  return { signCount: parsed.signCount };
}

function timingSafeEqualBuffers(a: Buffer, b: Buffer) {
  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }

  return difference === 0;
}
