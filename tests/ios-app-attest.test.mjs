import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  createTestCertificateAuthority,
  createAttestation,
  createAssertion,
  encodeCbor,
  AAGUID_DEVELOPMENT,
} from "./support/app-attest-fixtures.mjs";
import {
  APPLE_APP_ATTEST_ROOT_CA_PEM,
  AppAttestError,
  verifyAppAttestAttestation,
  verifyAppAttestAssertion,
} from "@/app/lib/ios-attestation/app-attest.ts";
import { decodeCbor } from "@/app/lib/ios-attestation/cbor.ts";
import { decodeBase64 } from "@/app/lib/ios-attestation/encoding.ts";

// These tests run against REAL payloads -- a real certificate chain, real
// ECDSA signatures, real CBOR, produced by tests/support/app-attest-fixtures.mjs
// -- rather than against hand-written objects shaped like the verifier's
// expectations. That distinction is the whole point: the verifier is the only
// thing standing between a public endpoint and unrestricted account creation,
// so each check below is broken individually and the result must be rejection.

const TEAM_ID = "TEAMID1234";
const BUNDLE_ID = "com.zerinix.app";

let ca;
test.before(() => {
  ca = createTestCertificateAuthority();
});
test.after(() => ca?.cleanup());

const verifyWithTestRoot = (attestation, overrides = {}) =>
  verifyAppAttestAttestation({
    attestationObject: attestation.attestationObject,
    keyId: attestation.keyId,
    teamId: TEAM_ID,
    bundleId: BUNDLE_ID,
    rootCertificatePem: ca.rootPem,
    ...overrides,
  });

const rejects = (fn, what) => {
  assert.throws(fn, AppAttestError, what);
};

// ---------------------------------------------------------------------------
// Attestation
// ---------------------------------------------------------------------------

test("a genuine attestation yields the device public key", () => {
  const challenge = randomBytes(32);
  const attestation = createAttestation(ca, { challenge });
  const result = verifyWithTestRoot(attestation, { challenge });

  assert.equal(result.signCount, 0);
  assert.equal(result.environment, "production");
  assert.match(result.publicKeyPem, /BEGIN PUBLIC KEY/);
});

test("the Apple root is pinned: a chain from any other CA is refused", () => {
  // THE CHECK THIS GUARDS IS THE ONE THAT MATTERS MOST. If the chain could
  // terminate at any trusted CA, anyone able to obtain a certificate could
  // mint device attestations and self-service registration would be open to
  // the world. The fixture chain is valid in every other respect -- it simply
  // is not Apple's -- and the real pinned root must reject it.
  const challenge = randomBytes(32);
  const attestation = createAttestation(ca, { challenge });

  rejects(
    () =>
      verifyAppAttestAttestation({
        attestationObject: attestation.attestationObject,
        keyId: attestation.keyId,
        challenge,
        teamId: TEAM_ID,
        bundleId: BUNDLE_ID,
        // the real, pinned Apple root
        rootCertificatePem: APPLE_APP_ATTEST_ROOT_CA_PEM,
      }),
    "a non-Apple chain must not verify"
  );
});

test("an attestation is bound to the challenge this server issued", () => {
  const attestation = createAttestation(ca, { challenge: randomBytes(32) });

  // A captured attestation replayed against a fresh challenge.
  rejects(() => verifyWithTestRoot(attestation, { challenge: randomBytes(32) }));
});

test("an attestation is bound to this exact app", () => {
  const challenge = randomBytes(32);
  const attestation = createAttestation(ca, { challenge });

  rejects(() => verifyWithTestRoot(attestation, { challenge, teamId: "OTHERTEAM1" }));
  rejects(() => verifyWithTestRoot(attestation, { challenge, bundleId: "com.someone.else" }));
});

test("a freshly attested key must start at sign count zero", () => {
  const challenge = randomBytes(32);
  const attestation = createAttestation(ca, { challenge, signCount: 7 });

  rejects(() => verifyWithTestRoot(attestation, { challenge }));
});

test("development attestations are refused unless explicitly allowed", () => {
  // A debug build runs on any device the attacker owns, so a production
  // deployment accepting one would give away exactly what attestation buys.
  const challenge = randomBytes(32);
  const attestation = createAttestation(ca, { challenge, aaguid: AAGUID_DEVELOPMENT });

  rejects(() => verifyWithTestRoot(attestation, { challenge }));

  const allowed = verifyWithTestRoot(attestation, {
    challenge,
    allowDevelopmentAttestation: true,
  });
  assert.equal(allowed.environment, "development");
});

test("the claimed key id must be the hash of the attested key", () => {
  const challenge = randomBytes(32);
  const attestation = createAttestation(ca, { challenge });

  // Attest one key, then claim a different identifier for it.
  rejects(() =>
    verifyWithTestRoot(attestation, {
      challenge,
      keyId: randomBytes(32).toString("base64"),
    })
  );
});

test("a credential id that is not the attested key's hash is refused", () => {
  const challenge = randomBytes(32);
  const attestation = createAttestation(ca, {
    challenge,
    credentialIdOverride: randomBytes(32),
  });

  rejects(() => verifyWithTestRoot(attestation, { challenge }));
});

test("only the apple-appattest format is accepted", () => {
  const challenge = randomBytes(32);
  const attestation = createAttestation(ca, { challenge, fmt: "none" });

  rejects(() => verifyWithTestRoot(attestation, { challenge }));
});

test("a nonce the leaf certificate does not actually carry is refused", () => {
  const challenge = randomBytes(32);
  const attestation = createAttestation(ca, {
    challenge,
    nonceOverride: randomBytes(32),
  });

  rejects(() => verifyWithTestRoot(attestation, { challenge }));
});

test("a guessable challenge is refused outright", () => {
  const attestation = createAttestation(ca, { challenge: Buffer.alloc(32) });

  rejects(() => verifyWithTestRoot(attestation, { challenge: Buffer.from("short") }));
});

test("verification fails closed when the app identifiers are not configured", () => {
  const challenge = randomBytes(32);
  const attestation = createAttestation(ca, { challenge });

  rejects(() => verifyWithTestRoot(attestation, { challenge, teamId: "" }));
  rejects(() => verifyWithTestRoot(attestation, { challenge, bundleId: "  " }));
});

// ---------------------------------------------------------------------------
// Assertion -- what actually authenticates a registration request
// ---------------------------------------------------------------------------

function attestedDevice() {
  const challenge = randomBytes(32);
  const attestation = createAttestation(ca, { challenge });
  const { publicKeyPem } = verifyWithTestRoot(attestation, { challenge });

  return { publicKeyPem, devicePrivateKeyPem: attestation.devicePrivateKeyPem };
}

const verifyAssertionFor = (device, assertion, clientData, previousSignCount = 0) =>
  verifyAppAttestAssertion({
    assertion,
    clientData,
    publicKeyPem: device.publicKeyPem,
    previousSignCount,
    teamId: TEAM_ID,
    bundleId: BUNDLE_ID,
  });

test("a genuine assertion over the request's client data verifies", () => {
  const device = attestedDevice();
  const clientData = Buffer.from("challenge-abc:founder@example.com");
  const assertion = createAssertion({ ...device, clientData, signCount: 1 });

  assert.equal(verifyAssertionFor(device, assertion, clientData).signCount, 1);
});

test("an assertion cannot be reused for different client data", () => {
  // This is what binds a registration to one challenge AND one email address:
  // an assertion captured while registering one address cannot be replayed to
  // create an account under another.
  const device = attestedDevice();
  const assertion = createAssertion({
    ...device,
    clientData: Buffer.from("challenge-abc:founder@example.com"),
    signCount: 1,
  });

  rejects(() =>
    verifyAssertionFor(device, assertion, Buffer.from("challenge-abc:attacker@example.com"))
  );
});

test("a replayed assertion is refused once its counter has been recorded", () => {
  const device = attestedDevice();
  const clientData = Buffer.from("challenge-abc:founder@example.com");
  const assertion = createAssertion({ ...device, clientData, signCount: 1 });

  assert.equal(verifyAssertionFor(device, assertion, clientData, 0).signCount, 1);
  // Same assertion, replayed after the counter moved to 1.
  rejects(() => verifyAssertionFor(device, assertion, clientData, 1));
  // And a rolled-back counter, which is what a cloned key looks like.
  rejects(() => verifyAssertionFor(device, assertion, clientData, 5));
});

test("an assertion signed by any other key is refused", () => {
  const device = attestedDevice();
  const impostor = attestedDevice();
  const clientData = Buffer.from("challenge-abc:founder@example.com");
  const assertion = createAssertion({
    devicePrivateKeyPem: impostor.devicePrivateKeyPem,
    clientData,
    signCount: 1,
  });

  rejects(() => verifyAssertionFor(device, assertion, clientData));
});

test("an assertion produced for a different app is refused", () => {
  const device = attestedDevice();
  const clientData = Buffer.from("challenge-abc:founder@example.com");
  const assertion = createAssertion({
    ...device,
    clientData,
    signCount: 1,
    rpIdHashOverride: randomBytes(32),
  });

  rejects(() => verifyAssertionFor(device, assertion, clientData));
});

test("a malformed assertion is refused rather than partially trusted", () => {
  const device = attestedDevice();
  const clientData = Buffer.from("challenge-abc:founder@example.com");

  rejects(() =>
    verifyAssertionFor(device, encodeCbor({ signature: Buffer.alloc(0) }), clientData)
  );
  assert.throws(() => verifyAssertionFor(device, Buffer.from("not cbor at all"), clientData));
});

// ---------------------------------------------------------------------------
// Parsing primitives
// ---------------------------------------------------------------------------

test("the CBOR decoder refuses everything outside the subset Apple sends", () => {
  // Indefinite-length map.
  assert.throws(() => decodeCbor(Buffer.from([0xbf, 0xff])));
  // Trailing bytes: two readings of one payload.
  assert.throws(() => decodeCbor(Buffer.concat([encodeCbor(1), Buffer.from([0x01])])));
  // Truncated byte string.
  assert.throws(() => decodeCbor(Buffer.from([0x42, 0x01])));
  // Duplicate keys.
  assert.throws(() =>
    decodeCbor(Buffer.concat([Buffer.from([0xa2]), encodeCbor("a"), encodeCbor(1), encodeCbor("a"), encodeCbor(2)]))
  );
});

test("a decoded map cannot reach Object.prototype", () => {
  const decoded = decodeCbor(
    Buffer.concat([Buffer.from([0xa1]), encodeCbor("__proto__"), encodeCbor("polluted")])
  );

  assert.equal(Object.getPrototypeOf(decoded), null);
  assert.equal({}.polluted, undefined);
});

test("base64 decoding is strict, so malformed input cannot slip through", () => {
  assert.ok(decodeBase64(Buffer.from("hello world!!").toString("base64")));
  assert.equal(decodeBase64("not valid base64 at all"), null);
  assert.equal(decodeBase64("aGVsbG8"), null); // unpadded
  assert.equal(decodeBase64("aGVs*G8="), null);
});

test("a key identifier is accepted in exactly one canonical encoding", () => {
  // FOUND IN AUDIT. Buffer.from(value, "base64") silently drops characters it
  // does not understand and accepts base64url and unpadded input, so several
  // different strings decode to the same key. The identifier is the primary
  // key of the table that holds the sign counter, so a second encoding would
  // store the SAME device key a second time with its counter reset to zero --
  // reopening exactly the rollback the counter exists to prevent.
  const challenge = randomBytes(32);
  const attestation = createAttestation(ca, { challenge });
  const canonical = attestation.keyId;

  assert.equal(verifyWithTestRoot(attestation, { challenge }).signCount, 0);

  const variants = [
    canonical.replace(/\+/g, "-").replace(/\//g, "_"), // base64url
    canonical.replace(/=+$/, ""), // unpadded
    ` ${canonical}`, // whitespace
  ].filter((variant) => variant !== canonical);

  assert.ok(variants.length > 0, "the fixture must produce at least one variant to test");

  for (const variant of variants) {
    rejects(
      () => verifyWithTestRoot(attestation, { challenge, keyId: variant }),
      `"${variant}" must not be accepted as an alias for the canonical key id`
    );
  }
});
