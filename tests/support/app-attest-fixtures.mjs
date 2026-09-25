import { execFileSync } from "node:child_process";
import { createHash, createSign, createPublicKey } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Builds real App Attest payloads -- a real certificate chain, real ECDSA
// signatures, real CBOR -- so tests exercise the verifier end to end instead
// of asserting against its own assumptions. The only thing that differs from
// Apple is the root of trust: these chains anchor at a throwaway CA that the
// test passes in explicitly, which is exactly why a test chain cannot be used
// against the real pinned Apple root.

const sha256 = (...parts) => {
  const hash = createHash("sha256");
  parts.forEach((part) => hash.update(part));
  return hash.digest();
};

// --- a CBOR encoder covering the same subset the decoder accepts -----------

function encodeHead(major, length) {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
  if (length < 0x10000) {
    const buffer = Buffer.alloc(3);
    buffer[0] = (major << 5) | 25;
    buffer.writeUInt16BE(length, 1);
    return buffer;
  }
  const buffer = Buffer.alloc(5);
  buffer[0] = (major << 5) | 26;
  buffer.writeUInt32BE(length, 1);
  return buffer;
}

export function encodeCbor(value) {
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([encodeHead(2, value.length), value]);
  }
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([encodeHead(3, bytes.length), bytes]);
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return encodeHead(0, value);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([encodeHead(4, value.length), ...value.map(encodeCbor)]);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return Buffer.concat([
      encodeHead(5, entries.length),
      ...entries.flatMap(([key, item]) => [encodeCbor(key), encodeCbor(item)]),
    ]);
  }
  throw new Error(`encodeCbor: unsupported value ${String(value)}`);
}

// --- certificate authority -------------------------------------------------

const openssl = (args, cwd) =>
  execFileSync("openssl", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

function derOf(dir, pemName) {
  openssl(["x509", "-in", pemName, "-outform", "DER", "-out", `${pemName}.der`], dir);
  return readFileSync(join(dir, `${pemName}.der`));
}

/**
 * A two-level throwaway CA: root -> intermediate, matching the shape Apple
 * uses (the device leaf is issued per attestation below).
 */
export function createTestCertificateAuthority() {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-appattest-"));

  openssl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "root.key"], dir);
  openssl(
    ["req", "-x509", "-new", "-key", "root.key", "-sha256", "-days", "3650",
     "-subj", "/CN=Test App Attest Root", "-out", "root.pem",
     "-addext", "basicConstraints=critical,CA:TRUE",
     "-addext", "keyUsage=critical,keyCertSign"],
    dir
  );

  openssl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "intermediate.key"], dir);
  openssl(
    ["req", "-new", "-key", "intermediate.key", "-subj", "/CN=Test App Attest CA",
     "-out", "intermediate.csr"],
    dir
  );
  writeFileSync(
    join(dir, "intermediate.ext"),
    "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign\n"
  );
  openssl(
    ["x509", "-req", "-in", "intermediate.csr", "-CA", "root.pem", "-CAkey", "root.key",
     "-CAcreateserial", "-days", "3650", "-sha256",
     "-extfile", "intermediate.ext", "-out", "intermediate.pem"],
    dir
  );

  return {
    dir,
    rootPem: readFileSync(join(dir, "root.pem"), "utf8"),
    intermediateDer: derOf(dir, "intermediate.pem"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** The uncompressed P-256 point Apple hashes into the key identifier. */
function pointOf(publicKeyPem) {
  const jwk = createPublicKey(publicKeyPem).export({ format: "jwk" });
  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);
}

export const AAGUID_PRODUCTION = Buffer.concat([
  Buffer.from("appattest", "utf8"),
  Buffer.alloc(7),
]);
export const AAGUID_DEVELOPMENT = Buffer.from("appattestdevelop", "utf8");

export function buildAuthenticatorData({
  appId,
  signCount = 0,
  aaguid = null,
  credentialId = null,
  rpIdHash = null,
}) {
  const head = Buffer.alloc(37);
  (rpIdHash ?? sha256(Buffer.from(appId, "utf8"))).copy(head, 0);
  head[32] = aaguid ? 0x40 : 0x00;
  head.writeUInt32BE(signCount, 33);

  if (!aaguid) return head;

  const length = Buffer.alloc(2);
  length.writeUInt16BE(credentialId.length, 0);
  return Buffer.concat([head, aaguid, length, credentialId]);
}

/**
 * A complete, verifiable attestation for `challenge`.
 *
 * Any named override produces a payload that is correct in every respect
 * except one, which is how each individual check gets its own test.
 */
export function createAttestation(ca, {
  teamId = "TEAMID1234",
  bundleId = "com.zerinix.app",
  challenge,
  aaguid = AAGUID_PRODUCTION,
  signCount = 0,
  rpIdHashOverride = null,
  nonceOverride = null,
  credentialIdOverride = null,
  fmt = "apple-appattest",
  omitIntermediate = false,
} = {}) {
  const { dir } = ca;
  const stamp = `device-${Math.random().toString(36).slice(2)}`;

  openssl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", `${stamp}.key`], dir);
  const devicePrivateKeyPem = readFileSync(join(dir, `${stamp}.key`), "utf8");
  openssl(["ec", "-in", `${stamp}.key`, "-pubout", "-out", `${stamp}.pub`], dir);
  const devicePublicKeyPem = readFileSync(join(dir, `${stamp}.pub`), "utf8");

  const keyIdBytes = sha256(pointOf(devicePublicKeyPem));
  const appId = `${teamId}.${bundleId}`;
  const authData = buildAuthenticatorData({
    appId,
    signCount,
    aaguid,
    credentialId: credentialIdOverride ?? keyIdBytes,
    rpIdHash: rpIdHashOverride,
  });

  const nonce = nonceOverride ?? sha256(authData, sha256(challenge));
  const extensionDer = Buffer.concat([
    Buffer.from([0x30, 0x24, 0xa1, 0x22, 0x04, 0x20]),
    nonce,
  ]);
  const hex = [...extensionDer].map((byte) => byte.toString(16).padStart(2, "0")).join(":");

  openssl(["req", "-new", "-key", `${stamp}.key`, "-subj", "/CN=Test Device", "-out", `${stamp}.csr`], dir);
  writeFileSync(join(dir, `${stamp}.ext`), `1.2.840.113635.100.8.2=DER:${hex}\n`);
  openssl(
    ["x509", "-req", "-in", `${stamp}.csr`, "-CA", "intermediate.pem", "-CAkey", "intermediate.key",
     "-CAcreateserial", "-days", "365", "-sha256",
     "-extfile", `${stamp}.ext`, "-out", `${stamp}.pem`],
    dir
  );

  const leafDer = derOf(dir, `${stamp}.pem`);
  const x5c = omitIntermediate ? [leafDer] : [leafDer, ca.intermediateDer];

  return {
    keyId: keyIdBytes.toString("base64"),
    devicePrivateKeyPem,
    devicePublicKeyPem,
    attestationObject: encodeCbor({
      fmt,
      attStmt: { x5c, receipt: Buffer.from("test-receipt") },
      authData,
    }),
  };
}

/** An assertion over `clientData`, signed by the attested device key. */
export function createAssertion({
  devicePrivateKeyPem,
  clientData,
  teamId = "TEAMID1234",
  bundleId = "com.zerinix.app",
  signCount = 1,
  rpIdHashOverride = null,
  signWithKeyPem = null,
}) {
  const authenticatorData = buildAuthenticatorData({
    appId: `${teamId}.${bundleId}`,
    signCount,
    rpIdHash: rpIdHashOverride,
  });
  const nonce = sha256(authenticatorData, sha256(clientData));
  const signer = createSign("sha256");
  signer.update(nonce);
  signer.end();

  return encodeCbor({
    signature: signer.sign(signWithKeyPem ?? devicePrivateKeyPem),
    authenticatorData,
  });
}
