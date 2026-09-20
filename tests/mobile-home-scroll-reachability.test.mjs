import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const navigation = read("components/MobileNavigation.tsx");
const globals = read("app/globals.css");
const layout = read("components/mobile-layout.ts");
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

  if (/^var\(--[\w-]+\)$/.test(expr)) {
    const name = expr.slice(4, -1);
    const definition = new RegExp(`${name}:\\s*([^;]+);`).exec(globals);
    assert.ok(definition, `${name} must be defined in globals.css`);
    return evalLength(definition[1], insetPx);
  }
  if (/^env\(safe-area-inset-bottom(,[^)]*)?\)$/.test(expr)) return insetPx;
  if (/^env\(safe-area-inset-top(,[^)]*)?\)$/.test(expr)) return insetPx;
  if (expr.endsWith("rem")) return Number.parseFloat(expr) * REM;
  if (expr.endsWith("px")) return Number.parseFloat(expr);

  throw new Error(`unsupported length: ${expr}`);
}

const paddingExpression = (source, constant) =>
  new RegExp(`${constant} =\\s*"pb-\\[([^\\]]*)\\]"`).exec(source)[1];

const navClearance = paddingExpression(layout, "MOBILE_NAV_CLEARANCE");
const scrollerTail = paddingExpression(layout, "MOBILE_SCROLLER_TAIL");
const safeAreaTop = /MOBILE_SAFE_AREA_TOP = "pt-\[([^\]]*)\]"/.exec(layout)[1];

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

test("the reserved clearance equals the navigation's real height", () => {
  for (const inset of INSETS) {
    const clearance = evalLength(navClearance, inset);
    const bar = navHeightPx(inset);

    assert.ok(
      clearance >= bar,
      `clearance ${clearance}px must cover the bar's ${bar}px at inset ${inset}px`
    );
    // The bar takes max(0.65rem, inset) for itself, which a reservation cannot
    // reproduce inside calc() without a nested max() -- the construct that
    // computes to 0 on iOS WebKit. Summing the terms instead is exact where
    // there is no inset and generous by that floor where there is one.
    assert.ok(
      Math.abs(clearance - bar) < 0.01,
      `clearance ${clearance}px must equal the bar's ${bar}px at inset ${inset}px`
    );
  }
});

test("the final Home card rests fully above the bar, with a real gap below it", () => {
  for (const inset of INSETS) {
    const tail = evalLength(scrollerTail, inset);
    const bar = navHeightPx(inset);

    // Fully above: the tail covers the whole bar, so at maximum scroll the
    // last card's bottom edge is above the bar's top edge, not behind it.
    assert.ok(tail > bar, `tail ${tail}px must exceed the bar's ${bar}px at inset ${inset}px`);
    // ...by at least the reading gap, never less.
    assert.ok(
      tail - bar >= 1.5 * REM,
      `gap ${tail - bar}px must be at least 1.5rem at inset ${inset}px`
    );
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

test("no custom property holds a calc(), because var() of a calc computes to 0", () => {
  // THE ROOT CAUSE, guarded directly, from a physical-iPhone measurement.
  // --zx-safe-area-top held calc(1.25rem + var(--zx-status-bar)). It RESOLVED
  // correctly -- Web Inspector showed its value as the string
  //   "calc(1.25rem + max(62px, 2.75rem))"
  // -- and the rule consuming it, padding-top: var(--zx-safe-area-top),
  // computed to 0px anyway, while the identical expression written literally
  // computed to 82px in the same console. This WebKit rejects a var()
  // substitution whose value is itself a calc(), silently. That zeroed the
  // Home header's status-bar padding (43px tall instead of 125px).
  //
  // So: variables hold terminal values, declarations do the arithmetic.
  const declarations = [...globals.matchAll(/(--zx-[\w-]+):\s*([^;]+);/g)];
  assert.ok(declarations.length >= 2, "the inset variables must be defined");

  for (const [, name, value] of declarations) {
    assert.doesNotMatch(
      value,
      /calc\(/,
      `${name} must hold a terminal value, not a calc() (var() of a calc computes to 0 on iOS)`
    );
  }

  // The consuming classes carry the calc() instead, with only a terminal var.
  for (const constant of [safeAreaTop, navClearance, scrollerTail]) {
    assert.match(constant, /^calc\(/, "the arithmetic belongs in the declaration");
    // ...and each var() inside it names a variable proven terminal above.
    for (const [, name] of constant.matchAll(/var\((--[\w-]+)\)/g)) {
      assert.match(
        globals,
        new RegExp(`${name}:`),
        `${name} must be defined in globals.css`
      );
    }
  }

  // And every reservation still resolves to a real length, not 0.
  for (const inset of INSETS) {
    assert.ok(evalLength(navClearance, inset) > 0);
    assert.ok(evalLength(scrollerTail, inset) > 0);
  }
});
