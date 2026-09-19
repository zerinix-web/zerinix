import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const navigation = read("components/MobileNavigation.tsx");
const home = read("components/mobile/MobileHomeDashboard.tsx");

// --- A CSS length evaluator, so this file proves the geometry numerically
// instead of asserting that some class string is present. Every Home scroll
// bug so far shipped with all the right classes in the wrong places or with a
// reservation that did not actually cover the bar.
const REM = 16;

function splitTop(expression, separator) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (const char of expression) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts;
}

function evalLength(expression, insetPx) {
  const expr = expression.trim();

  if (expr.startsWith("calc(")) return evalLength(expr.slice(5, -1), insetPx);

  const sum = splitTop(expr, "+");
  if (sum.length > 1) {
    return sum.reduce((total, part) => total + evalLength(part, insetPx), 0);
  }

  if (expr.startsWith("max(")) {
    return Math.max(
      ...splitTop(expr.slice(4, -1), ",").map((part) => evalLength(part, insetPx))
    );
  }

  if (expr === "env(safe-area-inset-bottom)") return insetPx;
  if (expr.endsWith("rem")) return Number.parseFloat(expr) * REM;
  if (expr.endsWith("px")) return Number.parseFloat(expr);

  throw new Error(`unsupported length: ${expr}`);
}

const paddingExpression = (source, constant) =>
  new RegExp(`${constant} =\\s*"pb-\\[([^\\]]*)\\]"`).exec(source)[1];

const navClearance = paddingExpression(navigation, "MOBILE_NAV_CLEARANCE");
const scrollerTail = paddingExpression(navigation, "MOBILE_SCROLLER_TAIL");

// The bar's real composed height, read from the navigation's own markup
// rather than restated here: pt-2 + pill p-1.5 (top and bottom) + a min-h-14
// row + its own bottom inset padding.
const TAILWIND_SPACING = { "2": 0.5, "1.5": 0.375, "14": 3.5 };
function navHeightPx(insetPx) {
  const bar = /className="pointer-events-none fixed[^"]*"/.exec(navigation)[0];
  const pill = /className="pointer-events-auto mx-auto grid[^"]*"/.exec(navigation)[0];
  const row = /className=\{`flex min-h-14[^`]*/.exec(navigation)[0];

  const pt = TAILWIND_SPACING[/\bpt-([\d.]+)\b/.exec(bar)[1]] * REM;
  const pillPadding = TAILWIND_SPACING[/\bp-([\d.]+)\b/.exec(pill)[1]] * REM * 2;
  const rowHeight = TAILWIND_SPACING[/\bmin-h-(\d+)\b/.exec(row)[1]] * REM;
  const pb = evalLength(/pb-\[([^\]]*)\]/.exec(bar)[1], insetPx);

  return pt + pillPadding + rowHeight + pb;
}

// Devices with no bottom inset (web, older phones) and with one (the iPhone
// the screenshots come from reports 34px).
const INSETS = [0, 34];

test("the reserved clearance equals the navigation's real height, at every inset", () => {
  for (const inset of INSETS) {
    assert.equal(
      evalLength(navClearance, inset),
      navHeightPx(inset),
      `clearance must equal the bar's composed height at inset ${inset}px`
    );
  }
});

test("the final Home card rests fully above the bar, with a real gap below it", () => {
  for (const inset of INSETS) {
    const tail = evalLength(scrollerTail, inset);
    const bar = navHeightPx(inset);
    const gap = tail - bar;

    // Fully above: the tail covers the whole bar, so at maximum scroll the
    // last card's bottom edge is above the bar's top edge, not behind it.
    assert.ok(tail > bar, `tail ${tail}px must exceed the bar's ${bar}px at inset ${inset}px`);
    // A small natural gap, not a device-specific pad: one rhythm step.
    assert.equal(gap, 1.5 * REM, `gap must be 1.5rem at inset ${inset}px`);
  }
});

test("the tail is the clearance plus the gap, so the two can never drift apart", () => {
  for (const inset of INSETS) {
    assert.equal(
      evalLength(scrollerTail, inset),
      evalLength(navClearance, inset) + 1.5 * REM,
      `the tail must stay derived from the same bar height at inset ${inset}px`
    );
  }
});

test("that reservation is real scrollable height, not decoration outside it", () => {
  // It must sit on an in-flow child of the scroller. On the scroll container
  // itself WebKit leaves padding-bottom out of the scrollable overflow region,
  // so it would add no reachable range at all -- the bug that shipped twice.
  const scroller = /className="min-h-0 flex-1 overflow-y-auto[^"]*"/.exec(home)[0];
  assert.doesNotMatch(scroller, /\bp[btlrxy]?-/, "no padding on the scroll container");

  const wrapper = /<div className=\{`px-4 pt-6 \$\{MOBILE_SCROLLER_TAIL\}`\}>/.exec(home);
  assert.ok(wrapper, "the tail belongs on the in-flow content wrapper");
  assert.ok(
    home.indexOf(wrapper[0]) < home.indexOf("<ContinueActivitySection"),
    "the last section must live inside the padded wrapper"
  );

  // And the shell must not steal it back: clearance on the shell only shortens
  // the viewport, which reserves space without adding any scroll range.
  const shell = /<div className="fixed inset-0[^"]*">/.exec(home)[0];
  assert.doesNotMatch(shell, /\bp[btlrxy]?-/);
  assert.doesNotMatch(shell, /MOBILE_SCROLLER_TAIL|MOBILE_NAV_CLEARANCE/);
});

test("Home reserves the tail exactly once and restates no inset inline", () => {
  assert.equal((home.match(/MOBILE_SCROLLER_TAIL/g) || []).length, 2, "imported once, applied once");
  assert.equal((home.match(/safe-area-inset-bottom/g) || []).length, 0);
  assert.doesNotMatch(home, /(?:p[btlrxy]?|m[btlrxy]?)-\[\d+(?:\.\d+)?px\]/);
});
