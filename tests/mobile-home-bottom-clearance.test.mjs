import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("components/mobile/MobileHomeDashboard.tsx");
const navigation = read("components/MobileNavigation.tsx");
const dashboardPage = read("app/dashboard/page.tsx");
const dashboardTheme = read("app/lib/ui/dashboard-theme.ts");

test("Home's root cannot be compressed by the page's flex column", () => {
  const root = home.slice(home.indexOf("<div className=\"relative z-10 flex"));

  // The page wrapper is a flex column and Home is a direct item of it, so a
  // shrinkable root gets squeezed below its content height and the overflow
  // is clipped by overflow-hidden on the page main -- the document then stops
  // scrolling before the last card is reachable.
  assert.match(dashboardPage, /flex min-h-screen flex-col/);
  assert.match(dashboardTheme, /overflow-hidden/);
  assert.match(root.slice(0, 200), /\bshrink-0\b/, "Home root must not shrink");
  assert.match(root.slice(0, 200), /\bmin-h-dvh\b/);
});

test("Home reserves the navigation height plus the bottom inset, from the shared constant", () => {
  // One shared definition, so the reserved space cannot drift from the bar.
  assert.match(navigation, /export const MOBILE_NAV_CLEARANCE =\s*\n?\s*"pb-\[calc\(4\.75rem\+max\(0\.65rem,env\(safe-area-inset-bottom\)\)\)\]"/);
  assert.match(home, /\$\{MOBILE_NAV_CLEARANCE\}/);
  assert.equal(
    (home.match(/MOBILE_NAV_CLEARANCE/g) || []).length,
    2,
    "imported once and applied once"
  );

  // 4.75rem is the bar's own composition and the env() term is the inset the
  // bar itself adds, so the reservation equals the bar exactly -- no gap.
  assert.match(navigation, /pt-2/);
  assert.match(navigation, /min-h-14/);
  assert.match(navigation, /p-1\.5/);
  assert.match(navigation, /pb-\[max\(0\.65rem,env\(safe-area-inset-bottom\)\)\]/);
});

test("the clearance sits on the element that wraps the last section", () => {
  const contentStart = home.indexOf("${MOBILE_NAV_CLEARANCE}");
  const continueSection = home.indexOf("<ContinueActivitySection");

  assert.ok(contentStart > -1 && continueSection > contentStart,
    "the last section must live inside the element carrying the clearance");
});

test("the fix adds no device-specific offset, spacer or negative margin", () => {
  assert.doesNotMatch(home, /(?:p[btlrxy]?|m[btlrxy]?|top|bottom|inset)-\[\d+(?:\.\d+)?px\]/);
  assert.doesNotMatch(home, /className="[^"]*\s-m[btlrxy]?-/);
  assert.doesNotMatch(home, /<div className="pb-\[[^"]*\]" \/>/);
});

test("the top safe-area implementation is untouched", () => {
  assert.match(home, /\$\{MOBILE_SAFE_AREA_TOP\}/);
  assert.equal((home.match(/env\(safe-area-inset-top/g) || []).length, 0);
  assert.match(navigation, /export const MOBILE_SAFE_AREA_TOP = "pt-\[var\(--zx-safe-area-top\)\]";/);
});
