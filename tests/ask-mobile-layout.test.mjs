import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chatWorkspace = read("components/AIChatWorkspace.tsx");
const rootLayout = read("app/layout.tsx");
const mobileNavigation = read("components/MobileNavigation.tsx");
const capacitorConfig = read("capacitor.config.ts");
// The baked native copies are `npx cap sync` output and are gitignored, so
// they only exist in a synced working copy -- never in CI or a fresh clone.
const readIfPresent = (path) => {
  try {
    return read(path);
  } catch {
    return null;
  }
};
const nativeConfigs = [
  "ios/App/App/capacitor.config.json",
  "android/app/src/main/assets/capacitor.config.json",
].map(readIfPresent);

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

test("iOS lets WebKit report real safe-area insets to the CSS architecture", () => {
  // "automatic" hands safe-area handling to UIKit, which zeroes every
  // env(safe-area-inset-*) value and silently defeats the CSS above.
  assert.match(capacitorConfig, /contentInset: "never"/);
  assert.doesNotMatch(capacitorConfig, /contentInset: "automatic"/);

  // The native projects build from their synced copies, so where those
  // exist locally they must not still carry the old value.
  for (const nativeConfig of nativeConfigs) {
    if (!nativeConfig) {
      continue;
    }

    assert.match(nativeConfig, /"contentInset": "never"/);
    assert.doesNotMatch(nativeConfig, /"contentInset": "automatic"/);
  }
});

test("the conversation anchors to the composer instead of leaving a gap", () => {
  assert.match(
    chatWorkspace,
    /<div className="mx-auto flex min-h-full max-w-5xl flex-col justify-end gap-5 pt-4 pb-6 sm:pt-6">/
  );
  // min-h-full resolves against the scroller's content box, so the scroller
  // must not add vertical padding on top of it or the view stays scrollable
  // by that amount even when the conversation is short.
  assert.match(
    chatWorkspace,
    /className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6"/
  );
  // The welcome card sizes to the available space rather than a fixed 52vh
  // block that manufactured its own gap above the composer.
  assert.match(chatWorkspace, /<div className="flex flex-1 items-center justify-center text-center">/);
  assert.doesNotMatch(chatWorkspace, /className="[^"]*min-h-\[52vh\]/);
});

test("the conversation list no longer reserves the composer height twice", () => {
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
