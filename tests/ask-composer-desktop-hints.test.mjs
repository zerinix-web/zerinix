import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chat = read("components/AIChatWorkspace.tsx");

// The helper row under the composer.
const helperRow = (() => {
  const start = chat.indexOf('className="mt-2 flex flex-wrap items-center justify-center gap-x-3');
  return chat.slice(start, chat.indexOf("</div>", chat.indexOf("Use AI Plan or Market Analysis")));
})();

// The wrapping span is the one before the hint's icon; anchoring on the text
// alone would find the inner <span> that carries no classes.
const gatedHint = (icon) => {
  const at = helperRow.indexOf(icon);
  return helperRow.slice(helperRow.lastIndexOf("<span", at), at);
};

const hintSpan = (label) => {
  const at = helperRow.indexOf(label);
  return helperRow.slice(helperRow.lastIndexOf("<span", at), at);
};

test("desktop-only composer hints are hidden on mobile", () => {
  // Neither is possible on a phone: there is no hardware Enter key to send
  // with, and nothing to drag a file from.
  for (const [label, icon] of [
    ["Enter to send", "<CornerDownLeft"],
    ["Drag files anywhere", "<MoreHorizontal"],
  ]) {
    const span = gatedHint(icon);
    assert.match(span, /\bhidden\b/, `"${label}" must be hidden by default`);
    assert.match(span, /\bsm:inline-flex\b/, `"${label}" must return from sm up`);
    assert.doesNotMatch(
      span,
      /(?<![\w:])inline-flex\b/,
      `"${label}" must not be unconditionally visible`
    );
  }
});

test("the hints are preserved on tablet and desktop", () => {
  // Hidden below sm only -- nothing removed, no text deleted.
  assert.match(helperRow, /Enter to send/);
  assert.match(helperRow, /Drag files anywhere/);
  // The Shift+Enter detail keeps its own, narrower md gate.
  assert.match(helperRow, /className="hidden md:inline"> · Shift \+ Enter for newline/);
});

test("cross-platform guidance still shows on every screen", () => {
  // Not a desktop shortcut: it applies on a phone too, so it is not gated.
  const guidance = hintSpan("Use AI Plan or Market Analysis");
  assert.equal(guidance.trim(), "<span>", "the guidance span carries no breakpoint classes");
  assert.match(helperRow, /<span>Use AI Plan or Market Analysis for structured reports\.<\/span>/);
});

test("the composer itself is untouched", () => {
  // Layout, input, and every control keep working exactly as before.
  assert.match(chat, /Upload files/);
  assert.match(chat, /aria-label="Select advisor response mode"/);
  assert.match(chat, /Ask advisor/);
  assert.match(chat, /<textarea/);
  // The row wrapper keeps its original classes.
  assert.match(
    chat,
    /className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-\[11px\] text-zinc-600 sm:mt-3 sm:gap-3 sm:text-xs"/
  );
  // Earlier mobile work stays in place.
  assert.match(chat, /className="hidden min-h-12[^"]*md:inline-flex"/, "Stop is still desktop-only");
  assert.match(chat, /const freshConversationId = useMemo\(\(\) => createMessageId\(\), \[\]\);/);
});
