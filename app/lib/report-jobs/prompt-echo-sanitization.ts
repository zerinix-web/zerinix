// Pure, dependency-free helpers used by plan-executor.ts's
// sanitizeVisibleReportContent to keep the raw submitted prompt (and
// any markdown/code the prompt itself contains) from being echoed
// back as if it were generated report content. Split out of
// plan-executor.ts so this logic is unit-testable without pulling in
// that file's next/server dependency.

// Minimum length (chars) before a line is considered for prompt-echo
// removal. Kept high enough that short, legitimate business facts the
// model restates (numbers, names, short claims) are never caught --
// only long verbatim reproductions of the raw prompt (leaked
// instructions, markdown formatting requests, pasted code/tables) hit
// this length reliably.
export const LEAKED_PROMPT_ECHO_MIN_LENGTH = 48;

// This pipeline deliberately has many report sections restate the
// same "analyzed business/company description" (itself a slice of
// the raw prompt) verbatim -- that is expected, correct behavior, not
// leakage. Verbatim-overlap alone is therefore NOT a safe signal on
// its own: it must be paired with a shape that ordinary business
// prose never takes -- a markdown heading/table/blockquote line, or a
// line that opens with an imperative "please format/write/output"
// instruction. This keeps the filter targeted at the two reported
// leak shapes (formatting instructions, pasted tables) without ever
// touching legitimate restated business facts.
const promptEchoInstructionShapePattern =
  /^\s*(?:#{1,6}\s|\|.*\|\s*$|>\s|(?:please|lütfen|bitte|s'il vous plaît|por favor)\b)/i;

export function normalizeForPromptEchoComparison(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function stripLeakedPromptEchoLines(content: string, promptText: string) {
  const normalizedPrompt = normalizeForPromptEchoComparison(promptText);
  if (normalizedPrompt.length < LEAKED_PROMPT_ECHO_MIN_LENGTH) {
    return content;
  }

  return content
    .split("\n")
    .filter((line) => {
      if (!promptEchoInstructionShapePattern.test(line)) return true;
      const normalizedLine = normalizeForPromptEchoComparison(line);
      if (normalizedLine.length < LEAKED_PROMPT_ECHO_MIN_LENGTH) return true;
      return !normalizedPrompt.includes(normalizedLine);
    })
    .join("\n");
}

// A business, real-estate, or domain-analysis report field is
// prose/tables, never source code, so a code fence surviving into
// report content is always a leaked echo of the raw prompt's own
// formatting, never business evidence.
export function stripFencedCodeBlocks(content: string) {
  return content.replace(/```[\s\S]*?```/g, "").replace(/`{3,}/g, "");
}
