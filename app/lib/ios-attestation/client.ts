import { Capacitor, registerPlugin } from "@capacitor/core";

// The browser half of App Attest. Runs only inside the iOS shell, and carries
// no security of its own: every value it produces is verified server-side, so
// a patched or replaced copy of this file gains nothing. It exists to move
// bytes between the native plugin and the API.

type AppAttestBridge = {
  isSupported(): Promise<{ supported: boolean }>;
  generateKey(): Promise<{ keyId: string }>;
  attestKey(options: { keyId: string; challenge: string }): Promise<{ attestation: string }>;
  generateAssertion(options: {
    keyId: string;
    clientData: string;
  }): Promise<{ assertion: string }>;
};

// Apple's key identifier, kept so a retry reuses the key already attested.
// Re-attesting the same key is refused server-side (it would reset the sign
// counter), so losing this value means the user needs a fresh key.
const KEY_ID_STORAGE_KEY = "zerinix.appAttest.keyId";

export type RegistrationOutcome =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "unverified_device" | "invalid_email" | "weak_password" | "registration_failed" | "rate_limited" | "unavailable" };

// BUG FIX -- confirmed on a physical iPhone, where this returned undefined:
// this used to read window.Capacitor.Plugins.AppAttest. That object is NOT
// populated by the native side. In @capacitor/core 8.x it starts empty and
// gains an entry only inside registerPlugin() itself (`Plugins[pluginName] =
// proxy`). What iOS injects is a different structure, Capacitor.PluginHeaders,
// which registerPlugin consults to find the native implementation. So the old
// lookup could never succeed for a native-only plugin -- not even once the
// class was compiled into the app -- and the failure looked like a broken
// native build rather than a wrong lookup.
//
// Registered at module scope, exactly as @capacitor/splash-screen does. That
// is safe during server rendering: registerPlugin only builds a proxy, and the
// guards below mean no method is ever invoked off-device.
const AppAttest = registerPlugin<AppAttestBridge>("AppAttest");

function bridge(): AppAttestBridge | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (Capacitor.getPlatform() !== "ios") {
    return null;
  }

  // Reads the native-injected PluginHeaders, so this is false on the web, on
  // Android, and on an iOS build where the plugin was never compiled in --
  // without calling into the bridge to find out.
  if (!Capacitor.isPluginAvailable("AppAttest")) {
    return null;
  }

  return AppAttest;
}

/** False on the web, on Android, and on the Simulator, where App Attest does not exist. */
export async function isAppAttestAvailable() {
  const plugin = bridge();

  if (!plugin) {
    return false;
  }

  try {
    return (await plugin.isSupported()).supported === true;
  } catch {
    return false;
  }
}

function readStoredKeyId() {
  try {
    return window.localStorage.getItem(KEY_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeKeyId(keyId: string) {
  try {
    window.localStorage.setItem(KEY_ID_STORAGE_KEY, keyId);
  } catch {
    // A device with storage blocked simply attests again next time.
  }
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json();
  } catch {
    // An empty or non-JSON body is handled by the status check below.
  }

  return { status: response.status, ok: response.ok, payload };
}

async function requestChallenge(purpose: "attestation" | "registration") {
  const result = await postJson("/api/ios/attestation/challenge", { purpose });

  return result.ok && typeof result.payload.challenge === "string"
    ? (result.payload.challenge as string)
    : null;
}

/** Attests a key if this install has not already done so. */
async function ensureAttestedKey(plugin: AppAttestBridge) {
  const existing = readStoredKeyId();

  if (existing) {
    return existing;
  }

  const challenge = await requestChallenge("attestation");

  if (!challenge) {
    return null;
  }

  const { keyId } = await plugin.generateKey();
  const { attestation } = await plugin.attestKey({ keyId, challenge });
  const result = await postJson("/api/ios/attestation/key", { keyId, attestation, challenge });

  if (!result.ok) {
    return null;
  }

  storeKeyId(keyId);
  return keyId;
}

export async function registerWithAppAttest(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<RegistrationOutcome> {
  const plugin = bridge();

  if (!plugin) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    const keyId = await ensureAttestedKey(plugin);

    if (!keyId) {
      return { ok: false, reason: "unverified_device" };
    }

    const challenge = await requestChallenge("registration");

    if (!challenge) {
      return { ok: false, reason: "unavailable" };
    }

    const email = input.email.trim().toLowerCase();
    // Exactly the string the server rebuilds and verifies the signature over.
    const { assertion } = await plugin.generateAssertion({
      keyId,
      clientData: `${challenge}:${email}`,
    });

    const result = await postJson("/api/ios/registration", {
      keyId,
      assertion,
      challenge,
      email,
      password: input.password,
      fullName: input.fullName,
    });

    if (result.ok) {
      return { ok: true };
    }

    if (result.status === 429) {
      return { ok: false, reason: "rate_limited" };
    }

    const reason = typeof result.payload.error === "string" ? result.payload.error : "";

    if (reason === "invalid_email" || reason === "weak_password" || reason === "unverified_device") {
      return { ok: false, reason };
    }

    return { ok: false, reason: result.status === 400 ? "registration_failed" : "unavailable" };
  } catch {
    return { ok: false, reason: "unverified_device" };
  }
}
