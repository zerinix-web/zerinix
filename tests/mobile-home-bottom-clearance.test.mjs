import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("components/mobile/MobileHomeDashboard.tsx");
const chat = read("components/AIChatWorkspace.tsx");
const navigation = read("components/MobileNavigation.tsx");
const dashboardPage = read("app/dashboard/page.tsx");
const dashboardTheme = read("app/lib/ui/dashboard-theme.ts");
const rootLayout = read("app/layout.tsx");
const globals = read("app/globals.css");

// The Home shell: everything up to the header.
const shell = home.slice(
  home.indexOf('<div\n      className={`relative z-10 flex h-[100dvh]'),
  home.indexOf("<header")
);
// The element that actually scrolls.
const scroller = home.slice(
  home.indexOf('className="min-h-0 flex-1 overflow-y-auto'),
  home.indexOf('className="min-h-0 flex-1 overflow-y-auto') + 160
);

test("the ancestor chain still clips, so Home must not depend on document scrolling", () => {
  // These are the constraints that made document scrolling unusable:
  // html is height:100%, and main clips its overflow, so content taller than
  // main never becomes scrollable height.
  assert.match(rootLayout, /className=\{`\$\{geistSans\.variable\} \$\{geistMono\.variable\} h-full/);
  assert.match(dashboardTheme, /min-h-screen overflow-hidden/);
  assert.match(dashboardPage, /flex min-h-screen flex-col lg:flex-row/);
});

test("Home owns its scrolling in one bounded inner scroller", () => {
  // Shell is viewport-height and hides its own overflow, so nothing depends
  // on the clipped document height.
  assert.match(shell, /h-\[100dvh\]/);
  assert.match(shell, /overflow-hidden/);
  assert.match(shell, /flex-col/);

  // Exactly one scroll owner inside Home.
  assert.equal(
    (home.match(/overflow-y-auto/g) || []).length,
    1,
    "Home must have exactly one vertical scroll container"
  );
  assert.match(scroller, /min-h-0/, "a flex child needs min-h-0 or it cannot scroll");
  assert.match(scroller, /flex-1/);
  assert.match(scroller, /overscroll-contain/);

  // The old document-scrolling model must not come back.
  assert.doesNotMatch(shell, /min-h-dvh/);
});

test("the header cannot be squeezed by the scroller", () => {
  const header = home.slice(home.indexOf("<header"), home.indexOf("</header>"));

  assert.match(header, /shrink-0/);
  // Header precedes the scroller, so the scroller gets the remaining height.
  assert.ok(home.indexOf("<header") < home.indexOf("overflow-y-auto"));
});

test("navigation clearance sits on the shell, not inside the scroller", () => {
  // On the shell it shortens the scroll viewport, so the last card scrolls
  // into view above the bar. Inside the scroller it would only pad content
  // that the shell still renders underneath the bar.
  assert.match(shell, /\$\{MOBILE_NAV_CLEARANCE\}/);
  assert.doesNotMatch(scroller, /MOBILE_NAV_CLEARANCE/);
  assert.equal((home.match(/MOBILE_NAV_CLEARANCE/g) || []).length, 2, "imported once, applied once");

  // Reservation equals the bar's real height, so there is no dead gap.
  assert.match(
    navigation,
    /"pb-\[calc\(4\.75rem\+max\(0\.65rem,env\(safe-area-inset-bottom\)\)\)\]"/
  );
});

test("Home matches the Ask shell that already scrolls correctly on device", () => {
  // Same proven primitives: viewport-height column, hidden overflow, nav
  // clearance on the shell, and a min-h-0 flex-1 scroller inside.
  assert.match(chat, /h-\[100dvh\][^"`]*overflow-hidden/);
  assert.match(chat, /\$\{MOBILE_NAV_CLEARANCE\}/);
  assert.match(chat, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  assert.match(scroller, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);
});

test("the last Continue section is inside the scroller and ends with modest padding", () => {
  const scrollerStart = home.indexOf('className="min-h-0 flex-1 overflow-y-auto');
  const continueSection = home.indexOf("<ContinueActivitySection");

  assert.ok(continueSection > scrollerStart, "the last section must be scrollable content");
  assert.match(scroller, /pb-\[calc\(1\.5rem\+var\(--zx-home-indicator\)\)\]/);
});

test("no pixel hacks, spacers or negative margins, and the top inset is untouched", () => {
  assert.doesNotMatch(home, /(?:p[btlrxy]?|m[btlrxy]?|top|bottom|inset)-\[\d+(?:\.\d+)?px\]/);
  assert.doesNotMatch(home, /className="[^"]*\s-m[btlrxy]?-/);
  assert.match(home, /\$\{MOBILE_SAFE_AREA_TOP\}/);
  assert.equal((home.match(/env\(safe-area-inset-top/g) || []).length, 0);
});

test("the final card stays inside the reachable scroll range, not just visually cleared", () => {
  // The shell reserves the bar OUTSIDE the scroller -- visual clearance only.
  // On iOS the scroller viewport additionally loses the home-indicator strip
  // to UIKit while env() reports 0, so the scroller bottom edge lands behind
  // the fixed bar. Without content-space reservation the scroll range ends
  // with the last card still covered, which is exactly why only rubber-band
  // revealed it. The strip must be scrollable content inside the scroller.
  assert.match(
    scroller,
    /var\(--zx-home-indicator\)/,
    "the scroller must reserve the lost strip as real scroll space"
  );
  assert.match(shell, /\$\{MOBILE_NAV_CLEARANCE\}/, "the shell still reserves the bar height");

  // One term per element: the shell reserves the bar, the scroller the strip.
  assert.doesNotMatch(shell, /--zx-home-indicator/);
  assert.doesNotMatch(scroller, /MOBILE_NAV_CLEARANCE/);
});

test("the home-indicator strip has one central definition a real inset can win", () => {
  assert.match(globals, /--zx-home-indicator: env\(safe-area-inset-bottom, 0px\);/);
  assert.match(
    globals,
    /html\.zx-native-ios \{[\s\S]*?--zx-home-indicator: max\(env\(safe-area-inset-bottom, 0px\), 2\.125rem\);/
  );
  // A base value and one native clamp -- no third owner.
  assert.equal((globals.match(/--zx-home-indicator:/g) || []).length, 2);
  // Mirrors the status-bar strip, so top and bottom follow one pattern.
  assert.match(globals, /--zx-status-bar: max\(env\(safe-area-inset-top, 0px\), 2\.75rem\);/);
});
