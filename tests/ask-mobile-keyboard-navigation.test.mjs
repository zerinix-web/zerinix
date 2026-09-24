import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chat = read("components/AIChatWorkspace.tsx");
const navigation = read("components/MobileNavigation.tsx");

const navRender = chat.slice(
  chat.indexOf("mobileKeyboardViewportHeight === null &&"),
  chat.indexOf("mobileKeyboardViewportHeight === null &&") + 220
);

test("the bottom navigation is hidden while the mobile keyboard is open", () => {
  // THE BUG: the navigation stayed on screen while typing and covered the
  // "Ask advisor" button. It was already gated on the visualViewport size
  // check, but that signal does not fire reliably in this WebView -- iOS does
  // not always shrink the visual viewport when the keyboard opens.
  assert.match(navRender, /!mobileComposerFocused/, "focus must also hide it");
  assert.match(navRender, /<MobileBottomNavigation \/>/);

  // Focus is the deterministic signal: set on composer focus...
  assert.match(
    chat,
    /onFocus=\{\(\) => \{[\s\S]*?setMobileComposerFocused\(\s*window\.innerWidth < MOBILE_KEYBOARD_BREAKPOINT_PX\s*\);[\s\S]*?\}\}/,
    "focus sets the signal, guarded by viewport width"
  );
});

test("the navigation returns when the keyboard closes", () => {
  // Blur is the only thing that clears it, so the navigation comes back as
  // soon as the composer loses focus -- nothing latches.
  assert.match(
    chat,
    /onBlur=\{\(\) => \{[\s\S]*?setMobileComposerFocused\(false\);[\s\S]*?\}\}/,
    "blur must clear the signal"
  );
  assert.match(chat, /const \[mobileComposerFocused, setMobileComposerFocused\] = useState\(false\);/);
  assert.equal(
    (chat.match(/setMobileComposerFocused\(/g) || []).length,
    2,
    "set on focus, cleared on blur -- no other writers"
  );
  // Rendering is conditional, not a CSS class that could be left behind.
  assert.match(navRender, /\? \(\s*<MobileBottomNavigation \/>\s*\) : null/);
});

test("tablet and desktop navigation behaviour is unchanged", () => {
  // Neither signal can be set above md: the viewport effect nulls out at the
  // breakpoint, and focus reads the same width before setting anything.
  assert.match(chat, /const MOBILE_KEYBOARD_BREAKPOINT_PX = 768;/);
  assert.match(chat, /window\.innerWidth >= MOBILE_KEYBOARD_BREAKPOINT_PX/);
  assert.match(chat, /window\.innerWidth < MOBILE_KEYBOARD_BREAKPOINT_PX/);
  // One constant, so the two signals can never disagree about what "mobile" is.
  assert.doesNotMatch(chat, /MOBILE_BREAKPOINT_PX/);
  // The bar itself is untouched, including its own lg:hidden and safe area.
  assert.match(navigation, /fixed inset-x-0 bottom-0 z-40/);
  assert.match(navigation, /lg:hidden/);
  assert.match(navigation, /pb-\[max\(0\.65rem,env\(safe-area-inset-bottom\)\)\]/);
});

test("the whole composer stays reachable while typing", () => {
  // With the bar gone, nothing overlaps the composer: the textarea, Upload
  // files, the Fast selector and the submit button are all in the same
  // shrink-0 block, which the shell keeps above the keyboard.
  const composer = chat.slice(
    chat.indexOf('className="relative z-10 shrink-0 border-t border-white/10'),
    chat.indexOf("</section>")
  );
  assert.match(composer, /<textarea/);
  assert.match(composer, /Upload files/);
  assert.match(composer, /aria-label="Select advisor response mode"/);
  assert.match(composer, /Ask advisor/);

  // The existing viewport-height override still drives the shell, so the
  // composer is pulled above the keyboard when iOS does report a resize.
  assert.match(
    chat,
    /mobileKeyboardViewportHeight !== null\s*\? \{ height: mobileKeyboardViewportHeight, minHeight: mobileKeyboardViewportHeight \}/
  );
  // Earlier mobile decisions survive: no Stop on phones, one loading element.
  assert.match(chat, /className="hidden min-h-12[^"]*md:inline-flex"/);
  assert.match(chat, /\{message\.status === "streaming" && message\.content \? \(/);
});
