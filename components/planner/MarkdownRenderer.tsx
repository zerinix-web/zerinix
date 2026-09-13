"use client";

// Extracted verbatim from components/Planner.tsx as an incremental
// modularization step: a self-contained "markdown rendering"
// responsibility. `highlightCode`, `CodeBlock`, `InlineMarkdown`, and
// `MarkdownTable` are only ever used by MarkdownRenderer itself (all
// of their call sites lived inside this same cluster in Planner.tsx),
// so only MarkdownRenderer is exported. Its hooks are self-contained:
// CodeBlock's useState is local copy-button UI state, and
// MarkdownRenderer's useMemo calls operate only on its own `content`
// prop -- neither touches Planner's own component state.

import { useMemo, useState, type ReactNode } from "react";
import { Clipboard, ClipboardCheck } from "lucide-react";
import { normalizeReportPresentationText } from "@/app/lib/report-presentation";
import { cleanEvidenceMetadataForDisplay } from "@/components/planner/report-utils";
import { splitStreamingMarkdownIntoSettledAndActive } from "@/app/lib/streaming-markdown-split";
import { useThrottledStreamingReveal } from "@/app/lib/streaming-reveal";

function highlightCode(code: string) {
  const escaped = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .replace(
      /\b(const|let|var|function|return|async|await|if|else|for|while|type|interface|import|from|export|default|class|new|try|catch)\b/g,
      '<span class="text-teal-200">$1</span>'
    )
    .replace(/("[^"]*"|'[^']*'|`[^`]*`)/g, '<span class="text-amber-200">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="text-violet-200">$1</span>');
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  if (language.toLowerCase() === "mermaid") {
    return (
      <div className="my-4 overflow-hidden rounded-2xl border border-teal-300/20 bg-teal-300/[0.04]">
        <div className="flex items-center justify-between border-b border-teal-300/10 px-4 py-2">
          <span className="text-xs font-semibold tracking-[0.2em] text-teal-200">
            MERMAID
          </span>
          <button
            type="button"
            onClick={copyCode}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            {copied ? <ClipboardCheck className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="p-4">
          <div className="rounded-2xl border border-white/10 bg-black/40 p-4 font-mono text-xs leading-6 text-teal-50">
            {code.split("\n").map((line, index) => (
              <div key={`${line}-${index}`} className="flex gap-3">
                <span className="select-none text-zinc-600">{index + 1}</span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-white/10 bg-black/70">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2">
        <span className="text-xs font-medium text-zinc-500">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={copyCode}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
        >
          {copied ? (
            <ClipboardCheck className="h-3.5 w-3.5 text-teal-200" />
          ) : (
            <Clipboard className="h-3.5 w-3.5 text-teal-200" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-6 text-zinc-200">
        <code dangerouslySetInnerHTML={{ __html: highlightCode(code) }} />
      </pre>
    </div>
  );
}

// ROOT CAUSE FIX (deeper streaming-stability pass) -- confirmed live:
// even after the outer block-parse was memoized, already-rendered
// words kept visibly shaking during streaming. The cause was here, one
// layer deeper: every inline span/code/bold element below was keyed as
// `${part}-${index}` -- the key embedded the segment's OWN TEXT
// CONTENT, which changes on nearly every streamed token as it grows
// ("Hello wor" -> "Hello world" -> ...). React treats a changed key as
// a DIFFERENT element, not an update to the same one -- so on every
// token, React discarded the existing DOM text node for that segment
// and mounted a brand-new one in its place, forcing the browser to
// redo layout for that fragment (and often its neighbors) every single
// token. Keying purely by position (`index`) instead means the SAME
// logical segment at the SAME position is recognized as the SAME
// element across renders, so React updates its text content in place
// -- no unmount, no remount, no forced reflow -- while still correctly
// mounting a fresh element only when the text at that position
// genuinely changes shape (e.g. a `**bold**` marker completes and a
// plain-text run really does split into two segments). Index keys are
// safe here because these segments are only ever appended to or
// extended, never reordered or removed from the middle.
function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  const renderTextPart = (part: string) =>
    part.split(/(\$?\d+(?:[.,]\d+)*(?:\.\d+)?\s?(?:k|K|m|M|b|B|%|months?|days?)?)/g).map((segment, segmentIndex) => {
      const isNumberToken = /^\$?\d+(?:[.,]\d+)*(?:\.\d+)?\s?(?:k|K|m|M|b|B|%|months?|days?)?$/.test(
        segment
      );

      return (
        <span
          key={segmentIndex}
          className={isNumberToken ? "whitespace-nowrap" : undefined}
        >
          {segment}
        </span>
      );
    });

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={index}
              className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[0.92em] text-teal-100"
            >
              {part.slice(1, -1)}
            </code>
          );
        }

        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={index} className="font-semibold text-white">
              {part.slice(2, -2)}
            </strong>
          );
        }

        return <span key={index}>{renderTextPart(part)}</span>;
      })}
    </>
  );
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const rows = lines
    .filter((line) => line.includes("|"))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim())
    );
  const [header, separator, ...body] = rows;
  const bodyRows = separator?.every((cell) => /^:?-{3,}:?$/.test(cell))
    ? body
    : rows.slice(1);

  if (!header) {
    return null;
  }

  // TASK #69A-12 -- CRITICAL LAYOUT FIX: this table's ancestor
  // (MarkdownRenderer's own root div, below) applies an ambient
  // [overflow-wrap:anywhere] to every descendant so long plain-prose
  // words never overflow the chat/report column -- but that same rule
  // inherits straight into these <th>/<td> cells too, where it lets the
  // browser's table-layout:auto column-sizing algorithm satisfy a
  // shrinking column by breaking its content mid-word/mid-character
  // instead of respecting the table's own overflow-x-auto scroll
  // wrapper. A wide, dense table (e.g. a 5+ column competitor
  // comparison) then crushes its final column into a vertical,
  // word-by-word strip rather than growing past its container and
  // scrolling. [overflow-wrap:normal] restores ordinary word-wrap
  // behavior inside cells specifically (whitespace/hyphen breaks only),
  // and min-w-[7rem] gives every column a real usable floor -- together
  // these make overflow-x-auto (already present on the wrapper below)
  // the thing that actually activates once the table's genuine content
  // needs more room, exactly per this ticket's "prefer horizontal
  // scroll... over crushed text" requirement. This table renderer is
  // shared by every report type/field's raw "Details" prose -- not
  // Business Idea Validation-specific -- so this fix benefits any of
  // them without any report-specific branching.
  return (
    <div className="my-4 overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead className="bg-white/[0.04] text-zinc-200">
          <tr>
            {header.map((cell, cellIndex) => (
              <th
                key={cellIndex}
                className="min-w-[7rem] border-b border-white/10 px-4 py-3 font-semibold [overflow-wrap:normal]"
              >
                <InlineMarkdown text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10 text-zinc-300">
          {bodyRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="min-w-[7rem] px-4 py-3 align-top [overflow-wrap:normal]"
                >
                  <InlineMarkdown text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Extracted so it can be called TWICE with different, independently
// keyed inputs (see MarkdownRenderer below): once for the "settled"
// prefix of a streaming message (memoized -- only recomputes when a
// new block actually completes) and once for the small "active"
// trailing remainder still being typed (cheap regardless of how long
// the overall response has grown, since its cost is bounded by the
// CURRENT block's own size, not the whole message). `keyPrefix` keeps
// the two resulting trees' keys from ever colliding with each other.
// Byte-identical behavior to a single call over the full text when
// `text` IS the full text (the non-streaming/finalized path below) --
// this function does not change what gets rendered, only how much of
// it needs to be (re)computed on a given call.
function parseMarkdownBlocks(text: string, keyPrefix: string): ReactNode[] {
  const blocks = text.split(/```/g);

  return blocks.map((block, blockIndex) => {
    if (blockIndex % 2 === 1) {
      const [language = "", ...codeLines] = block.replace(/^\n/, "").split("\n");
      return (
        <CodeBlock
          key={`${keyPrefix}-code-${blockIndex}`}
          language={language.trim()}
          code={codeLines.join("\n").trimEnd()}
        />
      );
    }

    const lines = block.split("\n");
    const elements: ReactNode[] = [];
    let paragraph: string[] = [];
    let table: string[] = [];
    let list: string[] = [];

    const flushParagraph = () => {
      if (paragraph.length === 0) {
        return;
      }

      elements.push(
        <p
          key={`${keyPrefix}-p-${blockIndex}-${elements.length}`}
          className="max-w-4xl whitespace-pre-wrap text-zinc-300"
        >
          <InlineMarkdown text={paragraph.join("\n")} />
        </p>
      );
      paragraph = [];
    };

    const flushTable = () => {
      if (table.length === 0) {
        return;
      }

      elements.push(
        <MarkdownTable key={`${keyPrefix}-table-${blockIndex}-${elements.length}`} lines={table} />
      );
      table = [];
    };

    const flushList = () => {
      if (list.length === 0) {
        return;
      }

      elements.push(
        <ul
          key={`${keyPrefix}-list-${blockIndex}-${elements.length}`}
          className="space-y-2.5 text-zinc-300"
        >
          {list.map((item, itemIndex) => (
            <li key={itemIndex} className="flex gap-3">
              <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200/80" />
              <span>
                <InlineMarkdown text={item.replace(/^[-*]\s+/, "")} />
              </span>
            </li>
          ))}
        </ul>
      );
      list = [];
    };

    lines.forEach((line) => {
      if (!line.trim()) {
        flushParagraph();
        flushTable();
        flushList();
        return;
      }

      if (line.startsWith("### ")) {
        flushParagraph();
        flushTable();
        flushList();
        elements.push(
          <h4 key={`${keyPrefix}-h4-${blockIndex}-${elements.length}`} className="pt-2 text-base font-semibold text-white">
            <InlineMarkdown text={line.slice(4)} />
          </h4>
        );
        return;
      }

      if (line.startsWith("## ")) {
        flushParagraph();
        flushTable();
        flushList();
        elements.push(
          <h3 key={`${keyPrefix}-h3-${blockIndex}-${elements.length}`} className="pt-2 text-lg font-semibold text-white">
            <InlineMarkdown text={line.slice(3)} />
          </h3>
        );
        return;
      }

      if (/^[-*]\s+/.test(line)) {
        flushParagraph();
        flushTable();
        list.push(line);
        return;
      }

      if (line.includes("|") && line.trim().startsWith("|")) {
        flushParagraph();
        flushList();
        table.push(line);
        return;
      }

      flushTable();
      flushList();
      paragraph.push(line);
    });

    flushParagraph();
    flushTable();
    flushList();

    return elements;
  });
}

export function MarkdownRenderer({
  content,
  streaming = false,
  mobile = false,
}: {
  content: string;
  streaming?: boolean;
  // This component is shared between components/planner/ChatMessages.tsx
  // (desktop -- never passes this, stays false) and Planner.tsx's mobile
  // renderMessageContent callback feeding
  // components/planner/MobileConversationExperience.tsx (always mobile --
  // that call site passes true). It is not a live viewport check because
  // each call site is already permanently one or the other.
  mobile?: boolean;
}) {
  const renderedContent = normalizeReportPresentationText(
    cleanEvidenceMetadataForDisplay(content)
  );

  // READING-PACE FIX -- see app/lib/streaming-reveal.ts. Only throttles
  // the reveal rate on the mobile call site; desktop's ChatMessages.tsx
  // never passes `mobile`, so `enabled` is false there and this is a
  // pure passthrough (renderedContent returned unchanged, every tick).
  const revealedContent = useThrottledStreamingReveal(
    renderedContent,
    streaming,
    mobile
  );

  // ROOT CAUSE FIX (progressive-streaming pass) -- confirmed live: after
  // the previous stability fix removed the visible shake, streaming
  // felt "too static" -- text seemed to wait and catch up in bursts
  // instead of revealing continuously. Cause: useDeferredValue was
  // hiding the cost of re-parsing the WHOLE accumulated message on
  // every token behind React's low-priority scheduling -- under a
  // steady stream of new tokens (each one an "urgent" state update),
  // that low-priority render kept getting preempted before it could
  // commit, so the displayed text only advanced in irregular jumps
  // whenever a gap in incoming tokens finally let it catch up.
  // Splitting the message into a "settled" prefix (parsed once,
  // memoized, frozen -- see parseMarkdownBlocks/
  // splitStreamingMarkdownIntoSettledAndActive) and a small "active"
  // trailing remainder (cheap to re-parse on every token, since its
  // size is bounded by the current block, not the whole response)
  // removes the need for that deferral entirely: the per-token render
  // is now cheap enough to happen synchronously, so new text can
  // reveal immediately as it arrives while everything before it stays
  // untouched. The non-streaming path (finalized message) is
  // unaffected -- it parses the full content in one pass, exactly as
  // before.
  const { settled, active } = useMemo(() => {
    if (!streaming) {
      return { settled: revealedContent, active: "" };
    }

    return splitStreamingMarkdownIntoSettledAndActive(revealedContent);
  }, [revealedContent, streaming]);

  const settledBlocks = useMemo(
    () => parseMarkdownBlocks(settled, "settled"),
    [settled]
  );
  const activeBlocks = active ? parseMarkdownBlocks(active, "active") : [];

  return (
    <div className="min-w-0 space-y-4 text-[15px] leading-8 text-zinc-300 [overflow-wrap:anywhere]">
      {settledBlocks}
      {activeBlocks}
    </div>
  );
}
