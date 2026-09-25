import test from "node:test";
import assert from "node:assert/strict";

// The other half of tests/ios-app-attest-plugin-bridge.test.mjs, and it needs
// its own process.
//
// Capacitor resolves a plugin's availability when registerPlugin runs, not on
// every query: registerPlugin records `platforms` from the header it finds at
// that moment, and isPluginAvailable answers from that record first. So the
// "plugin was never compiled into the app" state cannot be reached by clearing
// PluginHeaders after the module has loaded -- it has to be absent from the
// start, exactly as it is in an iOS build missing the native class.
//
// This is the state your physical iPhone was in: an iOS runtime, no AppAttest
// header, and the bridge must refuse cleanly rather than throw.

globalThis.window = globalThis;
globalThis.webkit = { messageHandlers: { bridge: {} } };
globalThis.Capacitor = {
  PluginHeaders: [],
  nativePromise: async (pluginName, methodName) => {
    throw new Error(
      `native was called for ${pluginName}.${methodName} although no plugin is registered`
    );
  },
};

const { isAppAttestAvailable } = await import("@/app/lib/ios-attestation/client.ts");
const { Capacitor } = await import("@capacitor/core");

test("the simulated runtime is native iOS with no AppAttest plugin", () => {
  assert.equal(Capacitor.getPlatform(), "ios");
  assert.equal(Capacitor.isPluginAvailable("AppAttest"), false);
});

test("App Attest reports unavailable when the plugin is not in the build", async () => {
  // Must be false, and must not throw: the registration form renders a plain
  // "not available on this device" message from this, so an exception here
  // would surface as a broken screen instead.
  assert.equal(await isAppAttestAvailable(), false);
});
