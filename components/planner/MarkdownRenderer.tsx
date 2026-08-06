"use client";

// Extracted verbatim from components/Planner.tsx as an incremental
// modularization step: a self-contained "markdown rendering"
// responsibility. `highlightCode`, `CodeBlock`, `InlineMarkdown`, and
// `MarkdownTable` are only ever used by MarkdownRenderer itself (all
// of their call sites lived inside this same cluster in Planner.tsx),
// so only MarkdownRenderer is exported. Its hooks are self-contained:
// CodeBlock's useState is local copy-button UI state, and
// MarkdownRenderer's useDeferredValue operates only on its own
// `content` prop -- neither touches Planner's own component state.

import { useDeferredValue, useState, type ReactNode } from "react";
import { Clipboard, ClipboardCheck } from "lucide-react";
import { normalizeReportPresentationText } from "@/app/lib/report-presentation";
import { cleanEvidenceMetadataForDisplay } from "@/components/planner/report-utils";

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

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  const renderTextPart = (part: string, partKey: string) =>
    part.split(/(\$?\d+(?:[.,]\d+)*(?:\.\d+)?\s?(?:k|K|m|M|b|B|%|months?|days?)?)/g).map((segment, segmentIndex) => {
      const isNumberToken = /^\$?\d+(?:[.,]\d+)*(?:\.\d+)?\s?(?:k|K|m|M|b|B|%|months?|days?)?$/.test(
        segment
      );

      return (
        <span
          key={`${partKey}-${segmentIndex}`}
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
              key={`${part}-${index}`}
              className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[0.92em] text-teal-100"
            >
              {part.slice(1, -1)}
            </code>
          );
        }

        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={`${part}-${index}`} className="font-semibold text-white">
              {part.slice(2, -2)}
            </strong>
          );
        }

        return <span key={`${part}-${index}`}>{renderTextPart(part, `${part}-${index}`)}</span>;
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

  return (
    <div className="my-4 overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <thead className="bg-white/[0.04] text-zinc-200">
          <tr>
            {header.map((cell, cellIndex) => (
              <th key={`header-${cellIndex}-${cell}`} className="border-b border-white/10 px-4 py-3 font-semibold">
                <InlineMarkdown text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10 text-zinc-300">
          {bodyRows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}-${row.join("-")}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`} className="px-4 py-3 align-top">
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

export function MarkdownRenderer({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const deferredContent = useDeferredValue(content);
  const renderedContent = normalizeReportPresentationText(
    cleanEvidenceMetadataForDisplay(streaming ? deferredContent : content)
  );
  const blocks = renderedContent.split(/```/g);

  return (
    <div className="min-w-0 space-y-4 text-[15px] leading-8 text-zinc-300 [overflow-wrap:anywhere]">
      {blocks.map((block, blockIndex) => {
        if (blockIndex % 2 === 1) {
          const [language = "", ...codeLines] = block.replace(/^\n/, "").split("\n");
          return (
            <CodeBlock
              key={`code-${blockIndex}`}
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
              key={`p-${blockIndex}-${elements.length}`}
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
            <MarkdownTable key={`table-${blockIndex}-${elements.length}`} lines={table} />
          );
          table = [];
        };

        const flushList = () => {
          if (list.length === 0) {
            return;
          }

          elements.push(
            <ul
              key={`list-${blockIndex}-${elements.length}`}
              className="space-y-2.5 text-zinc-300"
            >
              {list.map((item, itemIndex) => (
                <li key={`item-${blockIndex}-${itemIndex}-${item}`} className="flex gap-3">
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
              <h4 key={`h4-${blockIndex}-${elements.length}`} className="pt-2 text-base font-semibold text-white">
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
              <h3 key={`h3-${blockIndex}-${elements.length}`} className="pt-2 text-lg font-semibold text-white">
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
      })}
    </div>
  );
}
