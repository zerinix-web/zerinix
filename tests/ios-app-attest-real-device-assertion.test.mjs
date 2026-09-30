import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  verifyAppAttestAssertion,
  AppAttestError,
} from "@/app/lib/ios-attestation/app-attest.ts";
import { decodeCbor } from "@/app/lib/ios-attestation/cbor.ts";

// CAPTURED FROM A PHYSICAL iPhone, and the reason this file exists.
//
// Every genuine assertion from the device was rejected in production with
// "Authenticator data credential id runs past the end". The parser decided
// whether an attested credential block was present by testing
// `authData.length === 37`, but Apple appends CBOR extension data to assertion
// authenticator data -- {apple_bundle_version_01, apple_validation_category_01},
// 62 bytes -- so the blob is 99 bytes. Bytes 53-54 of that CBOR were read as a
// credential-id length of 25970 and the bounds check threw.
//
// The synthetic fixtures could not catch it: they emitted a bare 37-byte
// header, so the generator and the verifier agreed with each other and neither
// matched Apple. This pins the REAL wire format permanently.
const REAL_ASSERTION_BASE64 =
  "omlzaWduYXR1cmVYRzBFAiEAh+aIqp0VUJSjal6ayeZ7wAKu8dG9zCeFtKinN5/Y5WcCIEIHH6ILIk3lCiCDy2auX6GOjHcsQrpRsQlP9LHf33WecWF1dGhlbnRpY2F0b3JEYXRhWGN5Rk3poz0UeaJpjdgREn74Q8LTMgahaV88VWCmFSQs1MAAAAAEondhcHBsZV9idW5kbGVfdmVyc2lvbl8wMWEyeBxhcHBsZV92YWxpZGF0aW9uX2NhdGVnb3J5XzAxRAMAAAA=";

// The exact string the device signed over, and the public key the server
// stored when it verified this device's attestation.
const REAL_CLIENT_DATA = Buffer.from("ZX-LOCAL-TEST-0001", "utf8");
const REAL_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEeC4J2LL1IyIVGZc+SibCbSmrlWNH
kYpegVXINjUDrygoEi9ydYcBbcrYLyuS3e/MjVr3HkQbUnTxSWRIGKjyUg==
-----END PUBLIC KEY-----`;

const TEAM_ID = "7L66DBL6LV";
const BUNDLE_ID = "com.zerinix.app";
const REAL_SIGN_COUNT = 4;

const assertion = () => Buffer.from(REAL_ASSERTION_BASE64, "base64");

const verifyReal = (overrides = {}) =>
  verifyAppAttestAssertion({
    assertion: assertion(),
    clientData: REAL_CLIENT_DATA,
    publicKeyPem: REAL_PUBLIC_KEY_PEM,
    previousSignCount: 0,
    teamId: TEAM_ID,
    bundleId: BUNDLE_ID,
    ...overrides,
  });

test("a real iPhone assertion verifies, extension data and all", () => {
  // THE REGRESSION. Before the fix this threw
  // "Authenticator data credential id runs past the end".
  assert.equal(verifyReal().signCount, REAL_SIGN_COUNT);
});

test("the real assertion has the shape that broke the old parser", () => {
  // If Apple ever stops sending these bytes the test above would start
  // passing for the wrong reason, so the shape itself is pinned.
  const authData = decodeCbor(assertion()).authenticatorData;

  assert.equal(authData.length, 99, "authenticator data must carry extension data");
  assert.ok(authData.length > 37, "the old `length === 37` assumption must stay violated");
  assert.equal(authData[32], 0xc0, "flags carry AT and ED together");
  assert.ok((authData[32] & 0x40) !== 0, "AT is set even though no credential block exists");
  assert.ok((authData[32] & 0x80) !== 0, "ED is set");
  assert.match(
    authData.subarray(37).toString("utf8"),
    /apple_bundle_version_01/,
    "the trailing bytes are Apple's CBOR extensions"
  );
  // The precise trap: these two bytes were read as a credential-id length.
  assert.equal(authData.readUInt16BE(53), 25970);
});

test("the extension bytes are covered by the signature", () => {
  // This is what makes ignoring them safe rather than merely convenient.
  const tampered = assertion();
  const decoded = decodeCbor(tampered);
  const index = tampered.indexOf(decoded.authenticatorData.subarray(37, 45));
  assert.ok(index > 0, "locate the extension bytes inside the CBOR");
  tampered[index] ^= 0xff;

  assert.throws(
    () =>
      verifyAppAttestAssertion({
        assertion: tampered,
        clientData: REAL_CLIENT_DATA,
        publicKeyPem: REAL_PUBLIC_KEY_PEM,
        previousSignCount: 0,
        teamId: TEAM_ID,
        bundleId: BUNDLE_ID,
      }),
    AppAttestError,
    "flipping an extension byte must break verification"
  );
});

test("every other check still bites on the real assertion", () => {
  // The fix must not have relaxed anything else.
  assert.throws(
    () => verifyReal({ previousSignCount: REAL_SIGN_COUNT }),
    AppAttestError,
    "a replayed counter must still be refused"
  );
  assert.throws(
    () => verifyReal({ previousSignCount: REAL_SIGN_COUNT + 1 }),
    AppAttestError,
    "a rolled-back counter must still be refused"
  );
  assert.throws(
    () => verifyReal({ teamId: "OTHERTEAM1" }),
    AppAttestError,
    "a different team must still be refused"
  );
  assert.throws(
    () => verifyReal({ bundleId: "com.someone.else" }),
    AppAttestError,
    "a different bundle must still be refused"
  );
  assert.throws(
    () => verifyReal({ clientData: Buffer.from("ZX-LOCAL-TEST-0002", "utf8") }),
    AppAttestError,
    "different client data must still be refused"
  );
});

test("the real assertion is bound to this exact application", () => {
  const authData = decodeCbor(assertion()).authenticatorData;
  const expected = createHash("sha256")
    .update(Buffer.from(`${TEAM_ID}.${BUNDLE_ID}`, "utf8"))
    .digest();

  assert.deepEqual(authData.subarray(0, 32), expected);
});
