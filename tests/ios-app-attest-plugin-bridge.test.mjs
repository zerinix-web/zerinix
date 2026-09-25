import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// THE BUG THIS GUARDS, measured on a physical iPhone:
// app/lib/ios-attestation/client.ts used to look the native plugin up as
// window.Capacitor.Plugins.AppAttest. That object is never populated by the
// native side. In @capacitor/core 8.x, `Capacitor.Plugins` starts empty and
// gains an entry only inside registerPlugin() itself. iOS instead injects
// Capacitor.PluginHeaders, which registerPlugin consults. So the lookup
// returned undefined even with the plugin correctly compiled into the app,
// registration reported "not available on this device", and the symptom
// pointed at the native build rather than at the lookup.
//
// The behavioural tests below simulate the real Capacitor iOS runtime rather
// than asserting on source text: Capacitor decides the platform from
// win.webkit.messageHandlers.bridge and resolves native plugins from
// win.Capacitor.PluginHeaders, and createCapacitor MERGES onto a pre-existing
// win.Capacitor, so both can be staged before the module loads.

const APP_ATTEST_HEADER = {
  name: "AppAttest",
  methods: [
    { name: "isSupported", rtype: "promise" },
    { name: "generateKey", rtype: "promise" },
    { name: "attestKey", rtype: "promise" },
    { name: "generateAssertion", rtype: "promise" },
  ],
};

// Staged before @capacitor/core is imported anywhere, because registerPlugin
// resolves the plugin header ONCE, at the moment it is called
// (index.cjs.js: `const pluginHeader = getPluginHeader(pluginName)`). That is
// why registering at module scope is correct rather than lucky: iOS injects
// PluginHeaders through a WKUserScript at .atDocumentStart
// (JSExport.swift), so the headers always exist before any application
// JavaScript evaluates. This setup reproduces that ordering.
globalThis.window = globalThis;
globalThis.webkit = { messageHandlers: { bridge: {} } };
globalThis.Capacitor = {
  PluginHeaders: [APP_ATTEST_HEADER],
  // Stands in for the native bridge call a registered plugin method makes.
  nativePromise: async (pluginName, methodName) => {
    if (pluginName === "AppAttest" && methodName === "isSupported") {
      return { supported: true };
    }
    throw new Error(`unexpected native call ${pluginName}.${methodName}`);
  },
};

// Dynamic, so the globals above are in place first.
const { isAppAttestAvailable } = await import("@/app/lib/ios-attestation/client.ts");
const { Capacitor } = await import("@capacitor/core");

test("the simulated runtime really does look like native iOS", () => {
  // If this fails the other two tests prove nothing.
  assert.equal(Capacitor.getPlatform(), "ios");
});

test("App Attest is available when the native plugin is registered", async () => {
  // THE REGRESSION TEST for the physical-iPhone failure. Under the old
  // Capacitor.Plugins lookup this is false, because nothing ever writes to
  // that object -- which is exactly the bug that shipped.
  assert.equal(
    await isAppAttestAvailable(),
    true,
    "a registered native plugin must be found through PluginHeaders"
  );
});

test("the plugin is obtained through registerPlugin, never through Capacitor.Plugins", () => {
  const source = readFileSync(
    new URL("../app/lib/ios-attestation/client.ts", import.meta.url),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

  assert.match(
    source,
    /registerPlugin<AppAttestBridge>\("AppAttest"\)/,
    "the plugin must be registered, which is what creates a usable proxy"
  );
  assert.match(
    source,
    /Capacitor\.isPluginAvailable\("AppAttest"\)/,
    "availability must be read from the native-injected PluginHeaders"
  );
  assert.doesNotMatch(
    source,
    /Plugins\s*[?.[]/,
    "Capacitor.Plugins is never populated for a native-only plugin and must not be consulted"
  );
  assert.match(
    source,
    /Capacitor\.getPlatform\(\) !== "ios"/,
    "the bridge must stay iOS-only so web and Android are untouched"
  );
});
