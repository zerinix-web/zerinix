import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// App Attest's whole security model rests on the environment the device
// attests in. A build signed with `development` produces the appattestdevelop
// AAGUID, which a production deployment refuses -- correctly, because a debug
// build can be run by anyone on their own device.
//
// THE DEFECT THIS GUARDS: one entitlements file, hardcoded to `development`,
// was wired to BOTH build configurations. The App Store build would therefore
// have attested as development and every real user's registration would have
// failed with 401, while Preview looked perfectly healthy. The only way to
// "fix" it in production would have been to set
// IOS_APP_ATTEST_ALLOW_DEVELOPMENT=true, which is exactly the bypass that flag
// exists to prevent.
//
// Note which file holds which value: App.entitlements -- the default name, and
// the one a newly added configuration would most likely inherit -- is the
// PRODUCTION one. That way a misconfiguration fails closed (real devices
// rejected) rather than open (debug builds accepted).

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ENVIRONMENT_KEY = "com.apple.developer.devicecheck.appattest-environment";

function entitlementEnvironment(path) {
  const source = read(path);
  const match = source.match(
    new RegExp(`<key>${ENVIRONMENT_KEY.replace(/\./g, "\\.")}</key>\\s*<string>([a-z]+)</string>`)
  );
  assert.ok(match, `${path} must declare ${ENVIRONMENT_KEY}`);
  return match[1];
}

/** Maps each build configuration name to the entitlements file it uses. */
function entitlementsByConfiguration() {
  const project = read("ios/App/App.xcodeproj/project.pbxproj");
  const mapping = {};

  for (const block of project.matchAll(
    /isa = XCBuildConfiguration;([\s\S]*?)name = (\w+);/g
  )) {
    const [, body, name] = block;
    const entitlements = body.match(/CODE_SIGN_ENTITLEMENTS = ([^;]+);/);
    if (entitlements) {
      (mapping[name] ||= []).push(entitlements[1].trim());
    }
  }

  return mapping;
}

test("the App Store build attests in the production environment", () => {
  assert.equal(entitlementEnvironment("ios/App/App/App.entitlements"), "production");
});

test("the debug build attests in the development environment", () => {
  assert.equal(entitlementEnvironment("ios/App/App/AppDebug.entitlements"), "development");
});

test("each build configuration points at the right entitlements file", () => {
  const mapping = entitlementsByConfiguration();

  assert.deepEqual(
    mapping.Release,
    ["App/App.entitlements"],
    "Release must use the production entitlements"
  );
  assert.deepEqual(
    mapping.Debug,
    ["App/AppDebug.entitlements"],
    "Debug must use the development entitlements"
  );
});

test("no configuration ships development attestation to the App Store", () => {
  // The single assertion that would have caught the original defect: whatever
  // file Release uses must not say `development`.
  const mapping = entitlementsByConfiguration();
  const releaseFiles = mapping.Release ?? [];

  assert.ok(releaseFiles.length > 0, "Release must declare an entitlements file");

  for (const file of releaseFiles) {
    assert.equal(
      entitlementEnvironment(`ios/App/${file}`),
      "production",
      `${file} is used by Release and must attest in production`
    );
  }
});
