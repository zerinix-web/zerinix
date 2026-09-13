import assert from "node:assert/strict";
import test from "node:test";
import {
  computeNextRevealedLength,
  STREAMING_REVEAL_CATCHUP_TICKS,
} from "../app/lib/streaming-reveal.ts";

// ===========================================================================
// TASK -- slow the STREAMING REVEAL RATE (not the actual generation) on
// mobile to a comfortable reading pace. computeNextRevealedLength is the
// pure step function driving that: given the full content that has
// already arrived and how much of it is currently shown, it decides how
// far to advance for one tick. Correctness here means: never reveal a
// partial/unconfirmed trailing word, always advance in whole word
// groups, and reveal proportionally more per tick when a large backlog
// has piled up so the UI can catch back up instead of drifting forever.
// ===========================================================================

test("already fully revealed -- no-op", () => {
  assert.equal(computeNextRevealedLength("hello world", 11), 11);
});

test("revealedLength beyond content length clamps to content length", () => {
  assert.equal(computeNextRevealedLength("hello", 999), 5);
});

test("a single word with no trailing whitespace yet is NOT revealed -- it could still grow", () => {
  assert.equal(computeNextRevealedLength("The", 0), 0);
});

test("a single confirmed word (followed by whitespace) is revealed whole, including its trailing space", () => {
  const content = "Hello world";
  const next = computeNextRevealedLength(content, 0);

  assert.equal(next, "Hello ".length);
  assert.equal(content.slice(0, next), "Hello ");
});

test("the trailing, still-growing word is never included even when earlier words are confirmed", () => {
  const content = "Hello wor";
  const next = computeNextRevealedLength(content, 0);

  assert.equal(content.slice(0, next), "Hello ");
});

test("advancing tick by tick reveals one word group at a time under the catch-up threshold", () => {
  const content = "one two three four ";
  let revealed = 0;

  revealed = computeNextRevealedLength(content, revealed);
  assert.equal(content.slice(0, revealed), "one ");

  revealed = computeNextRevealedLength(content, revealed);
  assert.equal(content.slice(0, revealed), "one two ");

  revealed = computeNextRevealedLength(content, revealed);
  assert.equal(content.slice(0, revealed), "one two three ");

  revealed = computeNextRevealedLength(content, revealed);
  assert.equal(content.slice(0, revealed), "one two three four ");
});

test("a large backlog of confirmed words reveals more than one word group in a single tick", () => {
  const words = Array.from({ length: 40 }, (_, index) => `word${index}`);
  const content = `${words.join(" ")} `;

  const next = computeNextRevealedLength(content, 0);
  const revealedWordCount = content.slice(0, next).trim().split(/\s+/).length;

  // 40 confirmed groups / STREAMING_REVEAL_CATCHUP_TICKS ticks -- more
  // than the 1-word baseline, proving the catch-up scaling kicked in.
  assert.ok(revealedWordCount > 1);
  assert.equal(
    revealedWordCount,
    Math.ceil(40 / STREAMING_REVEAL_CATCHUP_TICKS)
  );
});

test("catch-up never overshoots past the last confirmed word group (the unconfirmed trailing word is still withheld)", () => {
  const words = Array.from({ length: 40 }, (_, index) => `word${index}`);
  const content = `${words.join(" ")} stillTyp`;

  const next = computeNextRevealedLength(content, 0);

  assert.ok(!content.slice(0, next).includes("stillTyp"));
});

test("repeatedly ticking a large backlog eventually reveals everything, never exceeding content length", () => {
  const words = Array.from({ length: 200 }, (_, index) => `word${index}`);
  const content = `${words.join(" ")} `;

  let revealed = 0;
  let previous = -1;
  let iterations = 0;

  while (revealed < content.length && iterations < 10_000) {
    previous = revealed;
    revealed = computeNextRevealedLength(content, revealed);

    // Monotonic, never decreasing, never exceeding content length.
    assert.ok(revealed >= previous);
    assert.ok(revealed <= content.length);
    iterations += 1;
  }

  assert.equal(revealed, content.length);
  assert.ok(iterations < 10_000, "must actually terminate, not loop forever");
});

test("empty content never advances", () => {
  assert.equal(computeNextRevealedLength("", 0), 0);
});

test("whitespace-only remaining content (no real word yet) does not advance", () => {
  assert.equal(computeNextRevealedLength("   ", 0), 0);
});
