import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("components/mobile/MobileHomeDashboard.tsx");
const navigation = read("components/MobileNavigation.tsx");
const dashboardPage = read("app/dashboard/page.tsx");
const dashboardTheme = read("app/lib/ui/dashboard-theme.ts");
const globals = read("app/globals.css");

// Every mobile screen that renders under the fixed bottom navigation and is
// known to scroll to its last item on a physical device.
const SIBLING_SCREENS = [
  "components/mobile/MobileAccountHome.tsx",
  "components/mobile/MobileReportsHome.tsx",
  "components/mobile/MobileWorkspaceHome.tsx",
];

// Home's root element: everything up to its header.
const root = home.slice(home.indexOf("  return (\n    <div"), home.indexOf("<header"));

test("Home's last card stays inside the NORMAL reachable scroll range", () => {
  // The regression this guards. Home used to be a h-[100dvh] column with an
  // inner overflow-y-auto scroller. Two independent reasons made its final
  // card unreachable by normal scrolling on iOS:
  //
  //   1. Under Capacitor's contentInset "automatic", UIKit applies the safe
  //      area, so the visible region is shorter than 100dvh while env()
  //      reports 0. The scroller's own VIEWPORT therefore ended off screen,
  //      behind the fixed bar -- something no amount of scrolling can raise.
  //   2. WebKit excludes a scroll container's own bottom padding from its
  //      scrollable overflow, so padding the scroller added no scroll range.
  //
  // Only UIScrollView's rubber-band exposed the card, and it snapped back on
  // release. Both failure modes exist only for a bounded inner scroller, so
  // Home must not have one: the document scrolls, and UIKit's own
  // contentInset.bottom guarantees the document's end is reachable.
  assert.equal(
    (home.match(/overflow-y-auto/g) || []).length,
    0,
    "Home must not bound its content in an inner scroll container"
  );
  assert.doesNotMatch(home, /h-\[100dvh\]/, "a viewport-height shell ends below the visible region");
  assert.doesNotMatch(home, /min-h-0/, "min-h-0 only exists to make a bounded scroller work");

  // The root grows with its content, so the document -- the thing UIKit
  // actually scrolls -- gets taller than the viewport and can reach the end.
  assert.match(root, /min-h-dvh/);
  assert.doesNotMatch(root, /\bshrink-0\b/);

  // The last section is in-flow content of that growing root, and the
  // clearance below it is ordinary padding on a block, which DOES count
  // towards the document's scroll height.
  assert.ok(
    home.indexOf("<ContinueActivitySection") < home.lastIndexOf("</div>"),
    "the last section must be in-flow content of the root"
  );
  assert.match(root, /\$\{MOBILE_NAV_CLEARANCE\}/);
});

test("Home is structurally identical to the sibling screens that scroll correctly", () => {
  // Those screens sit under the same ancestor chain and reach their last item
  // on the same device, so matching them is the evidence this fix rests on.
  for (const path of SIBLING_SCREENS) {
    const sibling = read(path);
    assert.match(sibling, /relative min-h-dvh overflow-hidden/, `${path} baseline changed`);
    assert.match(sibling, /\$\{MOBILE_NAV_CLEARANCE\}/, `${path} baseline changed`);
    assert.equal(
      (sibling.match(/overflow-y-auto/g) || []).length,
      0,
      `${path} baseline changed`
    );
  }

  assert.match(root, /relative min-h-dvh overflow-hidden/);

  // And it is wrapped the same way those screens are wrapped on their pages.
  assert.match(dashboardPage, /<section className="flex-1 lg:hidden">\s*<MobileHomeDashboard/);
});

test("no ancestor clips the document, so document scrolling is available", () => {
  // The original diagnosis -- "main clips overflow" -- was wrong, and it is
  // what drove the inner scroller. `main` is min-h-screen: its height is auto,
  // so it grows with its content and overflow-hidden never triggers
  // vertically. Keep that property visible, because losing it (a fixed height
  // or h-screen here) would silently break Home again.
  assert.match(dashboardTheme, /min-h-screen overflow-hidden/);
  // (?<![\w-]) so this does not match inside "min-h-screen" itself.
  assert.doesNotMatch(dashboardTheme, /(?<![\w-])h-screen\b/);
  assert.doesNotMatch(dashboardTheme, /(?<![\w-])h-\[100dvh\]/);
  assert.match(dashboardPage, /flex min-h-screen flex-col lg:flex-row/);
});

test("the navigation height is reserved exactly once, from the shared constant", () => {
  assert.equal(
    (home.match(/MOBILE_NAV_CLEARANCE/g) || []).length,
    2,
    "imported once, applied once"
  );
  // Reservation equals the bar's real composition, so there is no dead gap.
  assert.match(
    navigation,
    /"pb-\[calc\(4\.75rem\+max\(0\.65rem,env\(safe-area-inset-bottom\)\)\)\]"/
  );
  // The bar's own bottom inset is consumed by the bar, nowhere else.
  assert.match(navigation, /pb-\[max\(0\.65rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.equal((home.match(/safe-area-inset-bottom/g) || []).length, 0);
});

test("the scroller-only home-indicator variable is gone, not left as dead CSS", () => {
  // It existed solely to feed the bounded scroller's bottom padding, which
  // WebKit ignored anyway. Removing the scroller removes its only consumer.
  assert.equal((globals.match(/--zx-home-indicator/g) || []).length, 0);
  assert.equal((home.match(/--zx-home-indicator/g) || []).length, 0);
  // The top inset keeps its single central owner.
  assert.match(globals, /--zx-status-bar: max\(env\(safe-area-inset-top, 0px\), 2\.75rem\);/);
  assert.match(globals, /--zx-safe-area-top: calc\(1\.25rem \+ var\(--zx-status-bar\)\);/);
});

test("no pixel hacks, spacers or negative margins, and the top inset is untouched", () => {
  assert.doesNotMatch(home, /(?:p[btlrxy]?|m[btlrxy]?|top|bottom|inset)-\[\d+(?:\.\d+)?px\]/);
  assert.doesNotMatch(home, /className="[^"]*\s-m[btlrxy]?-/);
  assert.doesNotMatch(home, /<div className="pb-\[[^"]*\]" \/>/, "no spacer elements");
  assert.match(home, /\$\{MOBILE_SAFE_AREA_TOP\}/);
  assert.equal((home.match(/env\(safe-area-inset-top/g) || []).length, 0);
});
