import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const globals = read("app/globals.css");
const rootLayout = read("app/layout.tsx");
const capacitorConfig = read("capacitor.config.ts");

test("the root element paints the app's dark surface, not a light default", () => {
  // Under viewport-fit=cover the safe-area strips are painted by html/body,
  // so a light root background shows as a white band above the header.
  assert.match(globals, /--background: #050706;/);
  assert.doesNotMatch(globals, /--background: #ffffff;/);
  assert.match(globals, /color-scheme: dark;/);

  // Both html and body carry it, so overscroll/rubber-band stays dark too.
  assert.match(globals, /html \{[\s\S]{0,400}background: var\(--background\);/);
  assert.match(globals, /body \{[\s\S]{0,200}background: var\(--background\);/);
});

test("the root background is not conditional on the device colour scheme", () => {
  // A prefers-color-scheme override would reintroduce the white strip for
  // anyone whose device is in Light appearance.
  assert.doesNotMatch(globals, /@media \(prefers-color-scheme: dark\)/);
});

test("the dark surface reaches the physical edges of the display", () => {
  // 100vh excludes the safe-area regions under viewport-fit=cover; 100dvh
  // includes them.
  assert.match(globals, /min-height: 100dvh;/);
  assert.match(rootLayout, /viewportFit: "cover"/);
});

test("web and native agree on one background colour", () => {
  assert.match(rootLayout, /themeColor: "#050706"/);
  assert.match(rootLayout, /bg-\[color:var\(--background\)\]/);
  // Capacitor paints the native WebView with the same value, so there is no
  // seam between the native shell and the web content.
  assert.match(capacitorConfig, /backgroundColor: "#050706"/);
});

test("no hardcoded device offsets were introduced for the safe areas", () => {
  for (const source of [globals, rootLayout]) {
    // Targets spacing/positioning only. Unrelated pre-existing pixel values
    // (scrollbar width/height, landing animation transforms) are not device
    // offsets and are deliberately not matched here.
    assert.doesNotMatch(
      source,
      /(?:padding|margin|top|bottom|inset)(?:-[a-z]+)?:\s*-?\d+px/
    );
    assert.doesNotMatch(source, /margin(?:-top|-bottom)?:\s*-/);
  }
});
