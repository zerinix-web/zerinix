// Shared by every streaming markdown renderer (components/planner/MarkdownRenderer.tsx,
// components/AIChatWorkspace.tsx's local copy) to solve the same problem
// each of them has:
// while a response is actively streaming, re-parsing and re-rendering
// the WHOLE accumulated message on every token makes the per-token
// render cost grow with the response's own length -- expensive enough
// on longer responses (especially on mobile) that callers previously
// had to hide it behind React's useDeferredValue, which then made the
// text feel like it lagged/caught up in bursts instead of revealing
// continuously.
//
// This function splits the accumulated text into:
//   - `settled`  -- a prefix that is GUARANTEED to never change again
//                   as more tokens arrive, safe to parse once and
//                   cache/freeze.
//   - `active`   -- the small trailing remainder still being typed,
//                   which may still grow or even restructure (e.g. a
//                   `**bold` marker that only becomes real bold once
//                   its closing `**` arrives).
//
// Callers render `settled` through a memoized parse keyed on `settled`
// itself (so it only re-parses when a new block actually completes --
// rare, compared to once-per-token) and render `active` through the
// SAME parser called directly on that small remainder (cheap,
// regardless of how long the overall response has grown). The boundary
// is always a blank line -- the same signal every one of these
// parsers already uses to end whatever block (paragraph/list/table) it
// was accumulating -- so slicing there can never change how either
// half is itself parsed compared to parsing the full text in one pass.
export function splitStreamingMarkdownIntoSettledAndActive(text: string): {
  settled: string;
  active: string;
} {
  if (!text) {
    return { settled: "", active: "" };
  }

  const blankLineMatches = [...text.matchAll(/\n[ \t]*\n/g)];

  // Walk candidate split points from latest to earliest so the settled
  // prefix is as large (and the active remainder as small) as safely
  // possible.
  for (let index = blankLineMatches.length - 1; index >= 0; index -= 1) {
    const match = blankLineMatches[index];

    if (match.index === undefined) {
      continue;
    }

    const splitPoint = match.index + match[0].length;
    const candidateSettled = text.slice(0, splitPoint);

    // Never freeze a prefix that ends partway through an open fenced
    // code block -- a blank line inside a code sample is not a real
    // paragraph break, and an odd number of ``` markers in the
    // candidate prefix means whatever fence opened there has not
    // closed yet within it. Skip this boundary and try an earlier one
    // (e.g. the blank line before the fence opened).
    const fenceCount = (candidateSettled.match(/```/g) || []).length;
    if (fenceCount % 2 === 0) {
      return { settled: candidateSettled, active: text.slice(splitPoint) };
    }
  }

  // No safe boundary found yet (e.g. still inside the first block, or
  // inside one long unterminated fence spanning every blank line seen
  // so far) -- conservative fallback: nothing is settled yet.
  return { settled: "", active: text };
}
