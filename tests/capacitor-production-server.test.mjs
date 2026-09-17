import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const configPath = new URL("../capacitor.config.ts", import.meta.url);
const configSource = readFileSync(configPath, "utf8");

// capacitor.config.ts reads process.env at module evaluation time, so each
// case needs a fresh module instance. Node caches ES modules by URL, so a
// unique query string forces re-evaluation with the env vars set below.
let caseId = 0;
async function loadConfig(env) {
  const previous = {
    CAPACITOR_SERVER_URL: process.env.CAPACITOR_SERVER_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };

  for (const key of Object.keys(previous)) {
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }

  caseId += 1;

  try {
    const loaded = await import(`${pathToFileURL(configPath.pathname).href}?case=${caseId}`);
    return loaded.default;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("a sync with no environment variables still targets production", async () => {
  const config = await loadConfig({});

  assert.equal(config.server?.url, "https://zerinix.com");
  assert.equal(config.server?.cleartext, false);
  assert.deepEqual(config.server?.allowNavigation, ["zerinix.com", "www.zerinix.com"]);
});

test("server.url can never be absent, so the bundled placeholder is never used", async () => {
  for (const env of [
    {},
    { NEXT_PUBLIC_APP_URL: "" },
    { NEXT_PUBLIC_APP_URL: "   " },
    // A local http:// value is still not trusted as a native server URL,
    // but it must fall back to production rather than to no server at all.
    { NEXT_PUBLIC_APP_URL: "http://localhost:3000" },
  ]) {
    const config = await loadConfig(env);

    assert.ok(config.server, `server block missing for ${JSON.stringify(env)}`);
    assert.match(config.server.url, /^https:\/\//);
  }

  // The generated block must not be conditional on a resolved URL.
  assert.doesNotMatch(configSource, /server: mobileServerUrl\s*\?/);
  assert.doesNotMatch(configSource, /canonicalAppUrlIsProduction \? canonicalAppUrl : undefined/);
  assert.match(configSource, /const PRODUCTION_SERVER_URL = "https:\/\/zerinix\.com";/);
});

test("an explicit deployed NEXT_PUBLIC_APP_URL still wins over the default", async () => {
  const config = await loadConfig({ NEXT_PUBLIC_APP_URL: "https://staging.zerinix.com" });

  assert.equal(config.server?.url, "https://staging.zerinix.com");
  assert.equal(config.server?.cleartext, false);
  // The apex and its www redirect target stay in-app alongside the override.
  assert.deepEqual(config.server?.allowNavigation, [
    "staging.zerinix.com",
    "zerinix.com",
    "www.zerinix.com",
  ]);
});

test("CAPACITOR_SERVER_URL still overrides everything for local device testing", async () => {
  const config = await loadConfig({
    CAPACITOR_SERVER_URL: "http://192.168.1.50:3000",
    NEXT_PUBLIC_APP_URL: "https://zerinix.com",
  });

  assert.equal(config.server?.url, "http://192.168.1.50:3000");
  // Cleartext is enabled only because the developer asked for http://.
  assert.equal(config.server?.cleartext, true);
  assert.deepEqual(config.server?.allowNavigation, [
    "192.168.1.50",
    "zerinix.com",
    "www.zerinix.com",
  ]);
});

test("the safe-area and launch behaviour of the native config is unchanged", async () => {
  const config = await loadConfig({});

  // contentInset "never" is what lets WebKit report real env(safe-area-*)
  // values to the CSS; backgroundColor matches the web root background.
  assert.equal(config.ios?.contentInset, "never");
  assert.equal(config.ios?.backgroundColor, "#050706");
  assert.equal(config.appId, "com.zerinix.app");
  assert.equal(config.webDir, "capacitor-web");
  assert.equal(config.android?.allowMixedContent, false);
});
