import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const globals = read("app/globals.css");
const navigation = read("components/MobileNavigation.tsx");
const layout = read("components/mobile-layout.ts");
const nativeLifecycle = read("components/NativeSplashLifecycle.tsx");
const chat = read("components/AIChatWorkspace.tsx");
const home = read("components/mobile/MobileHomeDashboard.tsx");

const TOP_INSET_SCREENS = [
  "components/mobile/MobileHomeDashboard.tsx",
  "components/mobile/MobileAccountHome.tsx",
  "components/mobile/MobileReportsHome.tsx",
  "components/mobile/MobileWorkspaceHome.tsx",
  "components/mobile/MobileWorkspaceDetail.tsx",
  "components/AIChatWorkspace.tsx",
];

test("the top safe area has exactly one definition, in globals.css", () => {
  assert.match(globals, /--zx-status-bar: env\(safe-area-inset-top, 0px\);/);
  // The addition lives in the consuming class now, not in a variable: a
  // calc()-valued custom property computes to 0 through var() on iOS.
  assert.doesNotMatch(globals, /--zx-safe-area-top:/);
  assert.match(layout, /pt-\[calc\(1\.25rem\+var\(--zx-status-bar\)\)\]/);

  // Declared once each: a second definition would be a competing owner.
  assert.equal((globals.match(/--zx-safe-area-top:/g) || []).length, 0, "the calc-valued variable is gone");
  assert.equal((globals.match(/--zx-status-bar:/g) || []).length, 2, "base value plus the native clamp");
});

test("the native iOS shell clamps the strip without hardcoding a device offset", () => {
  // The clamp is kept: a max() of plain lengths is a terminal value, and the
  // device measured calc(1.25rem + var(--zx-status-bar)) at 82px with it in
  // place. Only calc()-VALUED variables are forbidden (see globals.css).
  assert.match(globals, /html\.zx-native-ios \{\s*--zx-status-bar: max\(env\(safe-area-inset-top, 0px\), 2\.75rem\);/);
  assert.doesNotMatch(globals, /--zx-status-bar: 2\.75rem;/);
  assert.doesNotMatch(globals, /--zx-status-bar: \d+px;/);
});

test("the status-bar strip keeps the app background while content scrolls under it", () => {
  const scrim = globals.slice(globals.indexOf("html.zx-native-ios::before"));

  assert.match(scrim, /position: fixed;/);
  assert.match(scrim, /height: var\(--zx-status-bar\);/);
  assert.match(scrim, /background: var\(--background\);/);
  assert.match(scrim, /pointer-events: none;/);
  // Same colour as the page, so it masks scrolled text without being visible
  // and without reintroducing a light strip.
  assert.doesNotMatch(scrim, /background: #fff/i);
});

test("only the iOS Capacitor shell is tagged, so web and Android keep pure env()", () => {
  assert.match(nativeLifecycle, /Capacitor\.getPlatform\(\) === "ios"/);
  assert.match(nativeLifecycle, /classList\.add\("zx-native-ios"\)/);
  assert.match(nativeLifecycle, /if \(!Capacitor\.isNativePlatform\(\)\)/);
});

test("every mobile screen consumes the shared variable and restates no inset", () => {
  assert.match(layout, /export const MOBILE_SAFE_AREA_TOP = "pt-\[calc\(1\.25rem\+var\(--zx-status-bar\)\)\]";/);

  for (const path of TOP_INSET_SCREENS) {
    const source = read(path);

    assert.match(source, /MOBILE_SAFE_AREA_TOP/, `${path} must use the shared top inset`);
    assert.equal(
      (source.match(/env\(safe-area-inset-top/g) || []).length,
      0,
      `${path} must not restate the top inset`
    );
  }
});

test("bottom safe-area behaviour is unchanged", () => {
  // The bar still consumes the inset directly, in the navigation markup...
  assert.match(navigation, /pb-\[max\(0\.65rem,env\(safe-area-inset-bottom\)\)\]/);
  // ...and the matching reservation is declared in the plain layout module.
  assert.match(
    layout,
    /"pb-\[calc\(4\.75rem\+var\(--zx-home-indicator\)\)\]"/
  );
  // The top fix must not have touched the bottom variable space.
  assert.doesNotMatch(globals, /--zx-status-bar-bottom/);
});

test("Home remains composer-free and Ask keeps every control", () => {
  assert.doesNotMatch(home, /<textarea/);
  assert.doesNotMatch(home, /\/api\/chat/);
  assert.match(home, /Your decision workspace/);

  assert.match(chat, /Upload files/);
  assert.match(chat, /aria-label="Select advisor response mode"/);
  assert.match(chat, /Ask advisor/);
  assert.match(chat, /extractChatStreamError/);
});
