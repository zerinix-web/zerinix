import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chatWorkspace = read("components/AIChatWorkspace.tsx");
const rootLayout = read("app/layout.tsx");
const mobileNavigation = read("components/MobileNavigation.tsx");

test("safe-area insets resolve because the app opts into viewport-fit cover", () => {
  assert.match(rootLayout, /export const viewport: Viewport = \{/);
  assert.match(rootLayout, /viewportFit: "cover"/);
  // Declaring the export replaces Next's default meta, so the defaults
  // must be restated rather than dropped.
  assert.match(rootLayout, /width: "device-width"/);
  assert.match(rootLayout, /initialScale: 1/);
});

test("the Ask conversation header starts below the iOS status bar", () => {
  const headerStart = chatWorkspace.indexOf('<header className="relative z-10 flex shrink-0');
  const headerSource = chatWorkspace.slice(headerStart, headerStart + 400);

  assert.match(headerSource, /pt-\[max\(0\.75rem,env\(safe-area-inset-top\)\)\]/);
  assert.match(headerSource, /sm:pt-\[max\(1rem,env\(safe-area-inset-top\)\)\]/);
  // The old symmetric padding must be gone, or the inset would be ignored.
  assert.doesNotMatch(headerSource, /\bpy-3\b/);
});

test("the Ask sidebar also clears the status bar without double padding", () => {
  assert.match(chatWorkspace, /\[padding-top:max\(1rem,env\(safe-area-inset-top\)\)\]/);
  // Exactly one top-inset rule per element: the header and the sidebar.
  assert.equal(
    (chatWorkspace.match(/safe-area-inset-top/g) || []).length,
    3,
    "expected top insets only on the header (2 breakpoints) and the sidebar"
  );
});

test("the conversation list no longer reserves the composer height twice", () => {
  assert.match(chatWorkspace, /<div className="mx-auto flex max-w-5xl flex-col gap-5 pb-6">/);
  // Anchored to the class attribute so the explanatory comment above it
  // (which names the old value) does not satisfy this guard.
  assert.doesNotMatch(chatWorkspace, /className="[^"]*\bpb-48\b/);

  // The composer stays a normal flex sibling after the scroller, so the
  // conversation flows straight into it instead of being spaced away.
  const scrollerIndex = chatWorkspace.indexOf('ref={scrollerRef}');
  const composerIndex = chatWorkspace.indexOf('[padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]');
  assert.ok(scrollerIndex > -1 && composerIndex > scrollerIndex);
  assert.match(chatWorkspace, /className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  assert.match(chatWorkspace, /className="relative z-10 shrink-0 border-t border-white\/10/);
});

test("streaming stickiness stays a distance measure, not a padding artifact", () => {
  assert.match(chatWorkspace, /const distanceFromBottom = element\.scrollHeight - element\.scrollTop - element\.clientHeight/);
  assert.match(chatWorkspace, /shouldAutoScrollRef\.current = distanceFromBottom < 180/);
});

test("the bottom navigation keeps its own safe-area behavior", () => {
  assert.match(mobileNavigation, /pb-\[max\(0\.65rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(chatWorkspace, /pb-28 text-white md:pb-0/);
});
