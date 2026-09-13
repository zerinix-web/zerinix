"use client";

// Shared by every streaming markdown renderer (components/planner/MarkdownRenderer.tsx,
// components/AIChatWorkspace.tsx, components/mobile/MobileChatHome.tsx) to
// solve a UX problem distinct from streaming-markdown-split.ts's stability
// concern: even after that fix, mobile streaming reveals new text as fast
// as tokens physically arrive over the network -- often faster than a
// person can comfortably read. The actual AI generation and network
// stream must NOT be slowed (tokens keep arriving into `content` at full
// speed); instead, this throttles how much of the already-arrived
// `content` is SHOWN at any moment, revealing it in small word groups at
// a controlled, comfortable cadence -- like ChatGPT's own reveal pace,
// not raw network speed and not character-by-character typing.
//
// `computeNextRevealedLength` is the pure, independently-testable step
// function; `useThrottledStreamingReveal` is the small React hook every
// renderer calls with it (content, streaming, enabled) -> throttled
// content string, so the rest of each renderer's existing pipeline
// (including the settled/active split) sees a normal, if more slowly
// growing, string and needs no other changes.

import { useEffect, useRef, useState } from "react";

// Baseline cadence: one confirmed word group revealed per tick. At
// 220ms/tick that is ~4.5 words/sec (~270 words/min) -- close to
// average comfortable silent-reading speed, calmer and easier to follow
// than the previous 160ms/~375wpm pace, while still clearly a
// continuous reveal rather than a sluggish crawl. Only this constant
// changed for this pass -- the word-group boundary logic, catch-up
// scaling, and instant-flush-on-completion behavior below are untouched.
export const STREAMING_REVEAL_TICK_MS = 220;

// When more content has already arrived than the baseline cadence has
// revealed (the network/model is running ahead of the reveal pace), the
// next tick reveals proportionally more word groups so the visible
// backlog keeps shrinking rather than drifting further behind
// indefinitely -- roughly converging within this many ticks, faster
// when the backlog is larger and easing back to the 1-word baseline as
// it closes in on real time.
export const STREAMING_REVEAL_CATCHUP_TICKS = 12;

// Advances `revealedLength` forward by whole "word groups" (a run of
// non-whitespace characters plus any whitespace immediately after it)
// from `content`, never mid-word -- so the visible text never flickers
// by showing half a word that then grows on the next tick. The final
// word group in `content` is only revealed once it is followed by
// whitespace (i.e. confirmed complete): while more tokens are still
// arriving, the last word could still be extended, so it stays
// unrevealed until either more content confirms it or streaming
// completes (the completion flush is the caller's responsibility, via
// `enabled`/`streaming` in useThrottledStreamingReveal below -- this
// function only ever advances by confirmed whole words).
export function computeNextRevealedLength(
  content: string,
  revealedLength: number
): number {
  if (revealedLength >= content.length) {
    return content.length;
  }

  const remaining = content.slice(revealedLength);
  const wordGroups = remaining.match(/\S+\s*/g) || [];

  if (wordGroups.length === 0) {
    return revealedLength;
  }

  const remainderEndsInWhitespace = /\s$/.test(remaining);
  const confirmedGroupCount = remainderEndsInWhitespace
    ? wordGroups.length
    : wordGroups.length - 1;

  if (confirmedGroupCount <= 0) {
    return revealedLength;
  }

  const groupsThisTick = Math.max(
    1,
    Math.ceil(confirmedGroupCount / STREAMING_REVEAL_CATCHUP_TICKS)
  );
  const groupsToReveal = Math.min(groupsThisTick, confirmedGroupCount);

  let advance = 0;
  for (let index = 0; index < groupsToReveal; index += 1) {
    advance += wordGroups[index].length;
  }

  return revealedLength + advance;
}

// `enabled` gates the whole mechanism (e.g. mobile-only): when false, or
// once `streaming` is false, the full current `content` is returned
// immediately -- this is both "desktop is unaffected" and "flush the
// remainder the instant streaming completes."
export function useThrottledStreamingReveal(
  content: string,
  streaming: boolean,
  enabled: boolean
): string {
  const active = enabled && streaming;

  // "Latest ref" pattern: written in its own effect (never during
  // render, which React disallows) so the ticking effect below can
  // always read the newest content without needing to depend on it.
  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const [revealedLength, setRevealedLength] = useState(() =>
    active ? 0 : content.length
  );

  useEffect(() => {
    if (!active) {
      return;
    }

    const interval = setInterval(() => {
      setRevealedLength((current) =>
        computeNextRevealedLength(contentRef.current, current)
      );
    }, STREAMING_REVEAL_TICK_MS);

    return () => clearInterval(interval);
    // Intentionally excludes `content`: the interval reads the latest
    // content via contentRef on every tick instead of tearing down and
    // restarting (which would fragment its steady cadence) every time a
    // new token arrives.
  }, [active]);

  if (!active) {
    return content;
  }

  return content.slice(0, Math.min(revealedLength, content.length));
}
