import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const navigation = read("components/MobileNavigation.tsx");

// Every screen that renders beneath the fixed MobileBottomNavigation.
const NAV_SCREENS = [
  "components/mobile/MobileHomeDashboard.tsx",
  "components/mobile/MobileAccountHome.tsx",
  "components/mobile/MobileReportsHome.tsx",
  "components/mobile/MobileWorkspaceHome.tsx",
  "components/mobile/MobileWorkspaceDetail.tsx",
];

test("the navigation owns the shared safe-area constants", () => {
  assert.match(
    navigation,
    /export const MOBILE_SAFE_AREA_TOP = "pt-\[var\(--zx-safe-area-top\)\]";/
  );
  assert.match(
    navigation,
    /"pb-\[calc\(4\.75rem\+max\(0\.65rem,env\(safe-area-inset-bottom\)\)\)\]"/
  );
  // calc(fallback + env), never max(fallback, env): a WebView reporting the
  // inset as 0 must still get the full fallback rather than collapsing to it.
  assert.doesNotMatch(navigation, /pt-\[max\([^\]]*env\(safe-area-inset-top\)/);
  // The bar itself consumes the bottom inset for the bar, and the shared
  // clearance is the only other place a screen gets it from.
  assert.match(navigation, /pb-\[max\(0\.65rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.doesNotMatch(navigation, /pb-28/);
});

test("bottom-nav screens reserve the navigation height exactly once, from the shared constant", () => {
  for (const path of NAV_SCREENS) {
    const source = read(path);

    assert.match(source, /MOBILE_NAV_CLEARANCE/, `${path} must use the shared clearance`);
    assert.doesNotMatch(
      source,
      /pb-\[calc\(8\.\d+rem\+env\(safe-area-inset-bottom\)\)\]/,
      `${path} must not over-reserve the navigation height`
    );
    // One bottom inset per screen, and it arrives via the constant.
    assert.equal(
      (source.match(/safe-area-inset-bottom/g) || []).length,
      0,
      `${path} must not restate the bottom inset inline`
    );
    // A header that does not exist on these routes must not be subtracted.
    assert.doesNotMatch(source, /100dvh-4\.5rem/, `${path} must not subtract a phantom header`);
  }
});

test("every mobile screen begins below the iOS status bar, applying the top inset once", () => {
  for (const path of NAV_SCREENS) {
    const source = read(path);
    const topInsetCount = (source.match(/safe-area-inset-top/g) || []).length;

    assert.match(source, /MOBILE_SAFE_AREA_TOP/, `${path} must use the shared top inset`);
    assert.equal(
      topInsetCount,
      0,
      `${path} must not restate the top inset inline`
    );
    // The bare paddings that let content slide under the status bar are gone.
    assert.doesNotMatch(
      source,
      /overflow-hidden px-4 pb-\[[^\]]*\] pt-[57] text-white/,
      `${path} must not use a bare top padding`
    );
  }
});

test("the Ask shell keeps its own single top and bottom ownership", () => {
  const chat = read("components/AIChatWorkspace.tsx");

  // Ask takes the top inset from the shared constant on both its header and
  // its slide-over sidebar, and never restates it inline.
  assert.equal((chat.match(/safe-area-inset-top/g) || []).length, 0);
  assert.match(chat, /MOBILE_SAFE_AREA_TOP/);
  assert.match(chat, /MOBILE_NAV_CLEARANCE/);
  // The composer only takes the bottom inset from lg, where the fixed
  // navigation is hidden and it becomes the bottom-most element.
  assert.match(chat, /lg:\[padding-bottom:max\(1rem,env\(safe-area-inset-bottom\)\)\]/);
});

test("the Ask composer area stays compact without losing any control", () => {
  const chat = read("components/AIChatWorkspace.tsx");
  const composerStart = chat.indexOf('className="relative z-10 shrink-0 border-t border-white/10');
  const composer = chat.slice(composerStart, composerStart + 400);

  assert.match(composer, /\bpb-2\b/);
  assert.match(composer, /\bpt-2\.5\b/);
  // Desktop spacing is unchanged.
  assert.match(composer, /sm:pb-4/);
  assert.match(composer, /sm:pt-4/);

  // Helper row is tightened, not removed, and every control survives.
  assert.match(chat, /mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1/);
  assert.match(chat, /Enter to send/);
  assert.match(chat, /Upload files/);
  assert.match(chat, /aria-label="Select advisor response mode"/);
  assert.match(chat, /Ask advisor/);
});

test("no screen uses negative margins or hardcoded device offsets for safe areas", () => {
  for (const path of [...NAV_SCREENS, "components/AIChatWorkspace.tsx", "components/MobileNavigation.tsx"]) {
    const source = read(path);

    assert.doesNotMatch(
      source,
      /(?:p[btlrxy]?|m[btlrxy]?|top|bottom|inset)-\[\d+(?:\.\d+)?px\]/,
      `${path} must not hardcode a device offset`
    );
    assert.doesNotMatch(
      source,
      /className="[^"]*\s-m[btlrxy]?-/,
      `${path} must not use negative margins`
    );
  }
});

test("Home stays composer-free and keeps Ask and Account as the single destinations", () => {
  const home = read("components/mobile/MobileHomeDashboard.tsx");

  assert.doesNotMatch(home, /<textarea/);
  assert.doesNotMatch(home, /\/api\/chat/);
  assert.doesNotMatch(home, /UserRound/);
  assert.match(navigation, /href: "\/dashboard\/advisor"/);
  assert.match(navigation, /href: "\/dashboard\/settings"/);
});
