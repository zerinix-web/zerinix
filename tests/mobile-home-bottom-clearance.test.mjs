import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("components/mobile/MobileHomeDashboard.tsx");
const navigation = read("components/MobileNavigation.tsx");
const dashboardPage = read("app/dashboard/page.tsx");
const dashboardTheme = read("app/lib/ui/dashboard-theme.ts");
const rootLayout = read("app/layout.tsx");
const sidebar = read("app/dashboard/DashboardSidebar.tsx");

// --- A real (small) JSX element tree, so the assertions below are about
// structure -- what contains what -- rather than "this class appears
// somewhere in the file". Every failure mode this guards was invisible to
// class-presence checks: the classes were all present and still wrong.
function parseTree(source) {
  // Start at the exported component, not at the first `return (` in the
  // file (SummaryMetric above it has one too).
  const componentStart = source.indexOf("export default function MobileHomeDashboard");
  assert.ok(componentStart > 0, "the exported component must be found");
  const jsx = source.slice(
    source.indexOf("  return (\n", componentStart),
    source.lastIndexOf("  );\n}")
  );
  const root = { tag: "#root", className: "", children: [] };
  const stack = [root];
  const tagPattern = /<(\/?)([A-Za-z][\w.]*)((?:[^<>]|=>)*?)(\/?)>/g;

  for (const [, closing, tag, attrs, selfClosing] of jsx.matchAll(tagPattern)) {
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const className = /className=\{?["`]([^"`]*)["`]/.exec(attrs)?.[1] ?? "";
    const node = { tag, className, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }

  return root.children[0];
}

const shell = parseTree(home);
const elements = (node) => [node, ...node.children.flatMap(elements)];
const descendants = (node) => elements(node).slice(1);
const scrollers = (node) =>
  elements(node).filter((el) => /overflow-(y-)?(auto|scroll)/.test(el.className));

test("Home has exactly ONE vertical scroll owner", () => {
  const owners = scrollers(shell);
  assert.equal(owners.length, 1, "exactly one scroll container in the Home tree");

  // ...and it is not nested inside another one, so nothing competes for the
  // gesture and no inner range can be stranded inside an outer one.
  const [owner] = owners;
  assert.equal(scrollers(owner).length, 1, "the scroll owner contains no nested scroller");
});

test("the scroll owner's viewport is bounded, and its content is free to grow", () => {
  const [owner] = scrollers(shell);

  // Bounded: the shell is fixed to the viewport, so the scroller's height is
  // the viewport minus the header -- it cannot be stretched by its content,
  // and no ancestor height participates in it at all.
  assert.match(shell.className, /\bfixed\b/);
  assert.match(shell.className, /\binset-0\b/);
  assert.match(shell.className, /\bflex\b/);
  assert.match(shell.className, /\bflex-col\b/);
  assert.match(owner.className, /\bflex-1\b/);
  assert.match(owner.className, /\bmin-h-0\b/, "without min-h-0 a flex child cannot scroll");

  // Free to grow: nothing inside the scroller may cap its height to the
  // viewport or its parent, which would strand content below the cap.
  // (Fixed icon/card sizes in rem are unrelated and allowed.)
  for (const el of descendants(owner)) {
    assert.doesNotMatch(
      el.className,
      /(?:^|\s)(?:max-)?h-(?:screen|full|\[[^\]]*(?:vh|%)\])/,
      `${el.tag} must not cap the height of scrollable content`
    );
  }
});

test("the header is a sibling of the scroll owner, not part of its content", () => {
  const [header, scroller] = shell.children;

  assert.equal(shell.children.length, 2, "the shell is exactly a header plus one scroller");
  assert.equal(header.tag, "header");
  assert.match(header.className, /\bshrink-0\b/, "the header must not be squeezed");
  assert.equal(scroller, scrollers(shell)[0]);
});

test("navigation clearance is inside the real scrollable content, not simulated outside it", () => {
  const [owner] = scrollers(shell);
  const [content] = owner.children;

  // The regression this exists for. The clearance must live on an IN-FLOW
  // child of the scroller: padding on such a child is part of the scrollable
  // overflow region, so it genuinely extends scrollHeight.
  assert.equal(owner.children.length, 1, "the scroller wraps its content in one in-flow block");
  assert.match(content.attrs, /\$\{MOBILE_NAV_CLEARANCE\}/);

  // It must NOT be on the scroll container itself: WebKit excludes a scroll
  // container's own padding-bottom from its scrollable overflow, so that
  // padding adds no scroll range (this shipped twice and failed twice).
  assert.doesNotMatch(owner.className, /(?:^|\s)p[btlrxy]?-/, "no padding on the scroll container");
  assert.doesNotMatch(owner.attrs, /MOBILE_NAV_CLEARANCE/);

  // ...nor on the shell, where it only shortens the viewport.
  assert.doesNotMatch(shell.attrs, /MOBILE_NAV_CLEARANCE/);
  assert.equal((home.match(/MOBILE_NAV_CLEARANCE/g) || []).length, 2, "imported once, applied once");
});

test("the final Home card is part of the scroll owner's scrollHeight", () => {
  const [owner] = scrollers(shell);
  const [content] = owner.children;
  const last = content.children[content.children.length - 1];

  // "Continue where you left off" is the last section, it is in flow inside
  // the padded content block, and the clearance therefore sits BELOW it --
  // which is what makes it scrollable into view above the fixed bar.
  assert.equal(last.tag, "ContinueActivitySection");
  assert.ok(
    descendants(owner).includes(last),
    "the last section must be a descendant of the scroll owner"
  );
  assert.doesNotMatch(last.attrs, /position|fixed|absolute/);
});

test("no ancestor between the document root and Home can clip or shrink it", () => {
  // Home is fixed, so it escapes ancestor overflow entirely -- but only while
  // no ancestor establishes a containing block for fixed descendants.
  for (const [name, source] of [
    ["root layout", rootLayout],
    ["dashboard theme", dashboardTheme],
  ]) {
    assert.doesNotMatch(
      source,
      /\b(?:transform|filter|backdrop-filter|will-change|contain)\s*:/,
      `${name} must not create a containing block for fixed descendants`
    );
  }
  // The same, expressed in the utility classes the page actually uses.
  assert.doesNotMatch(dashboardTheme.match(/page:[\s\S]*?",/)[0], /transform|scale-|rotate-|translate-/);

  // The fixed bottom navigation already proves fixed positioning resolves
  // correctly in this tree; Home must sit below it, never above.
  assert.match(navigation, /fixed inset-x-0 bottom-0 z-40/);
  const shellZ = Number(/\bz-(\d+)\b/.exec(shell.className)[1]);
  assert.ok(shellZ < 40, `Home shell z-${shellZ} must stay under the navigation's z-40`);
});

test("Home is not re-wrapped in the flex-1 section that clipped it", () => {
  // On this route Home would be the ONLY in-flow child of the page column
  // (the sidebar's aside is hidden below lg, and its mobile header is off),
  // and a lone `flex: 1 1 0%` child leaves that column at min-h-screen in
  // WebKit -- so Home's overflow was clipped by main's overflow-hidden and
  // could not be scrolled or rubber-banded into view.
  assert.doesNotMatch(dashboardPage, /<section className="flex-1 lg:hidden">\s*<MobileHomeDashboard/);
  assert.match(dashboardPage, /<DashboardSidebar showMobileNavigation=\{!mobileChatHomeEnabled\} \/>/);
  assert.match(sidebar, /<aside className=\{`hidden /, "the sidebar contributes no mobile flow height");
});

test("document scrolling is not mixed with the bounded scroller", () => {
  // A fixed shell adds no document height, so the page behind it stays at
  // viewport height and there is no second scroll surface.
  assert.doesNotMatch(shell.className, /min-h-dvh|min-h-screen|h-\[100dvh\]/);
  assert.match(dashboardTheme, /min-h-screen overflow-hidden/, "the page behind Home is unchanged");
});

test("no pixel hacks, spacers, negative margins or restated insets", () => {
  assert.doesNotMatch(home, /(?:p[btlrxy]?|m[btlrxy]?|top|bottom|inset)-\[\d+(?:\.\d+)?px\]/);
  assert.doesNotMatch(home, /className="[^"]*\s-m[btlrxy]?-/);
  for (const el of elements(shell)) {
    assert.ok(
      el.children.length > 0 || !/^(?:div)$/.test(el.tag) || el.className.includes("min-w-0"),
      "no empty spacer divs"
    );
  }
  assert.match(home, /\$\{MOBILE_SAFE_AREA_TOP\}/);
  assert.equal((home.match(/safe-area-inset-top/g) || []).length, 0);
  assert.equal((home.match(/safe-area-inset-bottom/g) || []).length, 0);
});
