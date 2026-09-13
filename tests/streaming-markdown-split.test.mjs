import assert from "node:assert/strict";
import test from "node:test";
import { splitStreamingMarkdownIntoSettledAndActive } from "../app/lib/streaming-markdown-split.ts";

// ===========================================================================
// TASK -- deeper streaming-stability + progressive-readability fix.
// This utility is the correctness-critical piece of the new streaming
// renderer architecture: it decides which prefix of an actively
// streaming message can be frozen (parsed once, never touched again)
// versus which small trailing remainder must still be treated as
// live/growing. Getting this wrong either (a) freezes text that could
// still change -- a real visual bug -- or (b) never freezes anything,
// silently falling back to the old "reparse everything, every token"
// cost profile. Both failure modes are covered below.
// ===========================================================================

test("empty text returns empty settled and active", () => {
  assert.deepEqual(splitStreamingMarkdownIntoSettledAndActive(""), {
    settled: "",
    active: "",
  });
});

test("no blank line yet (still inside the first paragraph) -- everything is active, nothing settled", () => {
  const text = "The market opportunity here is";
  assert.deepEqual(splitStreamingMarkdownIntoSettledAndActive(text), {
    settled: "",
    active: text,
  });
});

test("one completed paragraph followed by a growing second paragraph -- splits exactly at the blank line", () => {
  const text = "First paragraph is done.\n\nSecond paragraph is still gro";
  const result = splitStreamingMarkdownIntoSettledAndActive(text);

  assert.equal(result.settled, "First paragraph is done.\n\n");
  assert.equal(result.active, "Second paragraph is still gro");
  // Concatenation must always reproduce the original text exactly --
  // this function only ever decides WHERE to look, never rewrites.
  assert.equal(result.settled + result.active, text);
});

test("multiple completed paragraphs -- splits at the LATEST safe blank line, maximizing the settled/frozen portion", () => {
  const text = "Para one.\n\nPara two.\n\nPara three still typ";
  const result = splitStreamingMarkdownIntoSettledAndActive(text);

  assert.equal(result.settled, "Para one.\n\nPara two.\n\n");
  assert.equal(result.active, "Para three still typ");
});

test("never freezes a prefix that ends inside an open, unterminated fenced code block", () => {
  const text = "Intro text.\n\n```ts\nconst x = 1;\n\nconst y = 2;\nstill wri";
  const result = splitStreamingMarkdownIntoSettledAndActive(text);

  // The only blank line INSIDE the open fence is unsafe to split at
  // (it would cut the code block in half); the function must fall
  // back to the earlier, real paragraph-boundary blank line instead.
  assert.equal(result.settled, "Intro text.\n\n");
  assert.equal(result.active, "```ts\nconst x = 1;\n\nconst y = 2;\nstill wri");
});

test("falls back to fully active when EVERY blank line seen so far sits inside one still-open fence", () => {
  const text = "```ts\nconst x = 1;\n\nconst y = 2;\nstill wri";
  const result = splitStreamingMarkdownIntoSettledAndActive(text);

  assert.equal(result.settled, "");
  assert.equal(result.active, text);
});

test("once a fence closes, the text after it becomes eligible for a later split at its own blank line", () => {
  const text = "```ts\nconst x = 1;\n```\n\nAfter the fence, still typ";
  const result = splitStreamingMarkdownIntoSettledAndActive(text);

  assert.equal(result.settled, "```ts\nconst x = 1;\n```\n\n");
  assert.equal(result.active, "After the fence, still typ");
});

test("a blank line with trailing whitespace/tabs still counts as a real paragraph boundary", () => {
  const text = "First.\n \t\nSecond still typ";
  const result = splitStreamingMarkdownIntoSettledAndActive(text);

  assert.equal(result.settled, "First.\n \t\n");
  assert.equal(result.active, "Second still typ");
});

test("settled + active always reconstructs the exact original text, across every case above (no data loss/rewriting)", () => {
  const cases = [
    "",
    "no blank line here at all",
    "Para one.\n\nPara two still going",
    "A\n\nB\n\nC\n\nD still going",
    "```js\ncode\n\nmore code\nstill open",
    "```js\ncode\n```\n\nafter fence still going",
  ];

  for (const text of cases) {
    const { settled, active } = splitStreamingMarkdownIntoSettledAndActive(text);
    assert.equal(settled + active, text, text);
  }
});
