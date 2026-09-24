"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  sanitizeAiResponseText,
  extractChatStreamError,
} from "@/app/lib/ai/response-sanitization";
import { splitStreamingMarkdownIntoSettledAndActive } from "@/app/lib/streaming-markdown-split";
import { useThrottledStreamingReveal } from "@/app/lib/streaming-reveal";
import { MobileBottomNavigation } from "@/components/MobileNavigation";
import {
  MOBILE_NAV_CLEARANCE,
  MOBILE_SAFE_AREA_TOP,
} from "@/components/mobile-layout";
import AdvisorProfilePanel from "@/components/chat/AdvisorProfilePanel";
import {
  formatList,
  hasProfileContent,
  parseList,
  type ChatProfile,
} from "@/components/chat/advisor-profile-types";
import {
  AlertCircle,
  Bot,
  Check,
  Clipboard,
  ClipboardCheck,
  CornerDownLeft,
  Edit3,
  FileUp,
  Loader2,
  Menu,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  User,
  X,
} from "lucide-react";
import { createClient } from "@/app/lib/supabase/client";
import {
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  serializeAttachmentsForAnalysis,
  useAttachments,
  type PlannerAttachment,
} from "@/components/planner/useAttachments";

type ChatModelPreference = "fast" | "balanced";

type ChatAttachment = {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
  textContent?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: "chat" | "plan" | "market";
  attachments?: ChatAttachment[];
  status?: "streaming" | "complete" | "failed";
  regenerating?: boolean;
  createdAt: number;
};

type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};


type ChatIssue = {
  title: string;
  message: string;
  tone: "info" | "warning" | "error";
  retryable: boolean;
};

type AIChatWorkspaceProps = {
  initialConversations?: Conversation[];
  conversationLoadError?: string;
  initialReportMemory?: {
    id: string;
    title: string;
    type: string;
  } | null;
};

// Matches this file's own `md:` usage, and is shared by the two signals
// that decide the mobile keyboard is open.
const MOBILE_KEYBOARD_BREAKPOINT_PX = 768;
const CHAT_STREAM_IDLE_TIMEOUT_MS = 60_000;
const CHAT_REQUEST_TIMEOUT_MS = 75_000;
const ACTIVE_REPORT_ID_STORAGE_KEY = "zerinix.activeReportId";

const emptyProfile: ChatProfile = {
  preferred_country: "",
  preferred_industries: [],
  investment_budget_ranges: [],
  preferred_language: "",
  experience_level: "",
  available_time: "",
  business_interests: [],
  risk_tolerance: "",
  long_term_goals: [],
};

const modelOptions: Array<{
  value: ChatModelPreference;
  label: string;
  description: string;
}> = [
  {
    value: "fast",
    label: "Fast",
    description: "Low-latency answers",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Deeper reasoning",
  },
];

const promptStarters = [
  "Evaluate this business idea and identify the highest-risk assumptions.",
  "Turn these notes into a sharper strategic recommendation.",
  "Compare bootstrapping versus raising capital for this company.",
  "Assess this customer segment and recommend a stronger ICP.",
];

function getChatIssue(rawValue: string): ChatIssue {
  const raw = rawValue.trim();
  const normalized = raw.toLowerCase();

  if (!raw) {
    return {
      title: "Something went wrong",
      message: "The advisory response could not be completed. Please try again.",
      tone: "error",
      retryable: true,
    };
  }

  if (/stopped|abort|previous answer is still available/.test(normalized)) {
    return {
      title: "Generation stopped",
      message: "Your prompt and advisory session are safe. You can retry when you are ready.",
      tone: "info",
      retryable: true,
    };
  }

  if (/timeout|timed out|stream completed|too long to finish|too long to/.test(normalized)) {
    return {
      title: "Advisor timed out",
      message: "ZERINIX took too long to finish the answer. Your prompt was kept, and you can retry safely.",
      tone: "warning",
      retryable: true,
    };
  }

  if (
    /too many|rate[- ]limit|429|daily ai usage|quota|limit reached|current usage limit/.test(
      normalized
    )
  ) {
    return {
      title: "Usage limit reached",
      message: "Your current usage limit is active. Please wait before trying again or review your plan.",
      tone: "warning",
      retryable: false,
    };
  }

  if (/network|failed to fetch|load failed|connection|offline|connection dropped/.test(normalized)) {
    return {
      title: "Connection interrupted",
      message: "The network connection dropped before ZERINIX could finish. Your prompt was kept, and you can retry.",
      tone: "warning",
      retryable: true,
    };
  }

  if (/auth|sign in|authenticated|session/.test(normalized)) {
    return {
      title: "Session needs attention",
      message: "Your session could not be verified. Sign in again, then continue with your advisor.",
      tone: "warning",
      retryable: false,
    };
  }

  if (
    /server|500|provider|openai|response failed|temporarily unavailable|service could not complete/.test(
      normalized
    )
  ) {
    return {
      title: "Advisor response unavailable",
      message: "The AI service could not complete this advisory response. Your prompt was kept, and you can retry.",
      tone: "error",
      retryable: true,
    };
  }

  return {
    title: "Advisor needs a retry",
    message: "The last advisory response could not be completed cleanly. Your session is safe, and you can try again.",
    tone: "error",
    retryable: true,
  };
}

function ChatStatusNotice({
  issue,
  onRetry,
  onDismiss,
}: {
  issue: ChatIssue;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const toneClasses =
    issue.tone === "info"
      ? "border-teal-300/20 bg-teal-300/[0.08] text-teal-50"
      : issue.tone === "warning"
        ? "border-amber-300/20 bg-amber-300/[0.08] text-amber-50"
        : "border-red-300/20 bg-red-400/[0.08] text-red-50";
  const iconClasses =
    issue.tone === "info"
      ? "border-teal-300/20 bg-teal-300/10 text-teal-100"
      : issue.tone === "warning"
        ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
        : "border-red-300/20 bg-red-400/10 text-red-100";

  return (
    <div
      className={`rounded-3xl border p-4 text-sm leading-6 shadow-2xl shadow-black/25 ${toneClasses}`}
      role={issue.tone === "error" ? "alert" : "status"}
    >
      <div className="flex gap-3">
        <div
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border ${iconClasses}`}
        >
          <AlertCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">{issue.title}</p>
          <p className="mt-1 text-zinc-300">{issue.message}</p>
          {onRetry || onDismiss ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {onRetry && issue.retryable ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/10"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Try again
                </button>
              ) : null}
              {onDismiss ? (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="min-h-10 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-white/10"
                >
                  Dismiss
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function createMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getClientTimestamp() {
  return Date.now();
}

function createConversation(id = createMessageId()): Conversation {
  const now = Date.now();

  return {
    id,
    title: "New advisory session",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function getReportIdFromLocation() {
  if (typeof window === "undefined") {
    return "";
  }

  const params = new URLSearchParams(window.location.search);
  return (params.get("reportId") || params.get("report") || "").trim();
}

function getStoredActiveReportId() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.sessionStorage.getItem(ACTIVE_REPORT_ID_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function shouldAutoTitleConversation(title: string) {
  return (
    title === "New conversation" ||
    title === "New advisory session" ||
    title === "New ZERINIX conversation" ||
    title === "Untitled conversation"
  );
}

function generateConversationTitle(content: string) {
  const cleanTitle = content
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s.,:!?-]/gu, "")
    .trim();

  if (!cleanTitle) {
    return "New advisory session";
  }

  const title =
    cleanTitle
      .replace(/^(?:i\s+want\s+to\s+build|i\s+want\s+to\s+create|i'?m\s+building|we\s+are\s+building|build|create|start|launch)\s+/i, "")
      .replace(/^(?:an?|the)\s+/i, "")
      .replace(/[.!?]+$/g, "")
      .trim() || cleanTitle;

  return title.length > 54 ? `${title.slice(0, 54).trim()}...` : title;
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}



function normalizeProfileRow(value: unknown): ChatProfile {
  if (!value || typeof value !== "object") {
    return emptyProfile;
  }

  const row = value as Partial<ChatProfile>;

  return {
    preferred_country:
      typeof row.preferred_country === "string" ? row.preferred_country : "",
    preferred_industries: Array.isArray(row.preferred_industries)
      ? row.preferred_industries.filter((item): item is string => typeof item === "string")
      : [],
    investment_budget_ranges: Array.isArray(row.investment_budget_ranges)
      ? row.investment_budget_ranges.filter((item): item is string => typeof item === "string")
      : [],
    preferred_language:
      typeof row.preferred_language === "string" ? row.preferred_language : "",
    experience_level:
      typeof row.experience_level === "string" ? row.experience_level : "",
    available_time: typeof row.available_time === "string" ? row.available_time : "",
    business_interests: Array.isArray(row.business_interests)
      ? row.business_interests.filter((item): item is string => typeof item === "string")
      : [],
    risk_tolerance: typeof row.risk_tolerance === "string" ? row.risk_tolerance : "",
    long_term_goals: Array.isArray(row.long_term_goals)
      ? row.long_term_goals.filter((item): item is string => typeof item === "string")
      : [],
  };
}


function getConversationPreview(conversation: Conversation) {
  const message = [...conversation.messages]
    .reverse()
    .find((item) => item.content.trim());

  if (!message) {
    return "Start a strategic advisory session";
  }

  if (message.status === "failed") {
    return message.content || "Advisory response failed";
  }

  return message.content.replace(/\s+/g, " ").slice(0, 86);
}

function highlightCode(code: string) {
  return code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(
      /\b(const|let|var|function|return|if|else|async|await|import|from|export|type|interface|class|new)\b/g,
      '<span class="text-teal-200">$1</span>'
    )
    .replace(/(".*?"|'.*?'|`.*?`)/g, '<span class="text-emerald-200">$1</span>')
    .replace(/\b(\d+)\b/g, '<span class="text-amber-200">$1</span>');
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="my-4 min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-black/70">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.035] px-4 py-2">
        <span className="text-xs font-medium text-zinc-500">{language || "code"}</span>
        <button
          type="button"
          onClick={copyCode}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
        >
          {copied ? (
            <ClipboardCheck className="h-3.5 w-3.5 text-teal-200" />
          ) : (
            <Clipboard className="h-3.5 w-3.5 text-teal-200" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto overscroll-x-contain p-4 font-mono text-sm leading-6 text-zinc-200 [overflow-wrap:normal] [tab-size:2]">
        <code
          className="block min-w-max whitespace-pre [overflow-wrap:normal] [word-break:normal]"
          dangerouslySetInnerHTML={{ __html: highlightCode(code) }}
        />
      </pre>
    </div>
  );
}

// ROOT CAUSE FIX (deeper streaming-stability pass) -- confirmed live:
// this is a SEPARATE, local copy of the same hand-rolled markdown
// parser used by components/planner/MarkdownRenderer.tsx -- the "Ask"
// screen (this file) never imported that shared component, so an
// earlier fix applied there never reached here. Same defect, same
// fix: every span/code/strong element below used to be keyed by its
// own text content (`${part}-${index}`), which changes on nearly
// every streamed token, forcing React to discard and recreate the DOM
// node for that segment on every token instead of updating its text
// in place. Position-only keys (`index`) fix this -- safe here
// because these segments are only ever appended to or extended, never
// reordered or removed from the middle. Same reasoning applies to the
// table keys in MarkdownTable below.
function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*]+\*\*)/g);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={index}
              className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[0.92em] text-teal-100"
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

        return <span key={index}>{part}</span>;
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
    <div className="my-4 max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-white/10">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <thead className="bg-white/[0.04] text-zinc-200">
          <tr>
            {header.map((cell, cellIndex) => (
              <th key={cellIndex} className="border-b border-white/10 px-4 py-3 font-semibold">
                <InlineMarkdown text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10 text-zinc-300">
          {bodyRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-3 align-top">
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

function parseMarkdownSegments(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const segments: Array<
    | { type: "markdown"; content: string }
    | { type: "code"; language: string; code: string }
  > = [];
  let markdownLines: string[] = [];
  let codeLines: string[] = [];
  let codeLanguage = "";
  let inCode = false;

  const getFence = (line: string) => {
    const match = line.match(/^\s*(`{3,}|~{3,})[ \t]*([^`]*)$/);

    if (!match) {
      return null;
    }

    const marker = match[1][0];
    const info = (match[2] || "").trim();
    const language = info.split(/\s+/)[0]?.replace(/[^\w.+-]/g, "") || "";

    return { marker, language };
  };

  const flushMarkdown = () => {
    if (!markdownLines.length) {
      return;
    }

    segments.push({ type: "markdown", content: markdownLines.join("\n") });
    markdownLines = [];
  };

  const flushCode = () => {
    segments.push({
      type: "code",
      language: codeLanguage,
      code: codeLines.join("\n").replace(/\n$/, ""),
    });
    codeLines = [];
    codeLanguage = "";
  };

  for (const line of lines) {
    const fence = getFence(line);

    if (fence) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushMarkdown();
        inCode = true;
        codeLanguage = fence.language;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
    } else {
      markdownLines.push(line);
    }
  }

  if (inCode) {
    flushCode();
  } else {
    flushMarkdown();
  }

  return segments;
}

// Extracted so it can be called twice with independently keyed, disjoint
// inputs -- see MarkdownRenderer below. Same rationale and behavior as
// the identical extraction in components/planner/MarkdownRenderer.tsx's
// parseMarkdownBlocks: `keyPrefix` keeps the "settled" and "active" trees'
// keys from colliding; calling it once over the full text (the
// non-streaming path) is byte-identical to the previous single-parse
// behavior.
function parseMarkdownBlocksLocal(text: string, keyPrefix: string): ReactNode[] {
  const blocks = parseMarkdownSegments(text);

  return blocks.map((block, blockIndex) => {
      if (block.type === "code") {
        return (
          <CodeBlock
            key={`${keyPrefix}-code-${blockIndex}`}
            language={block.language}
            code={block.code}
          />
        );
      }

      const lines = block.content.split("\n");
      const elements: ReactNode[] = [];
      let paragraph: string[] = [];
      let table: string[] = [];
      let list: string[] = [];
      let listOrdered = false;

      const flushParagraph = () => {
        if (!paragraph.length) {
          return;
        }

        elements.push(
          <p key={`${keyPrefix}-p-${blockIndex}-${elements.length}`} className="whitespace-pre-wrap text-zinc-300">
            <InlineMarkdown text={paragraph.join("\n")} />
          </p>
        );
        paragraph = [];
      };

      const flushTable = () => {
        if (!table.length) {
          return;
        }

        elements.push(
          <MarkdownTable key={`${keyPrefix}-table-${blockIndex}-${elements.length}`} lines={table} />
        );
        table = [];
      };

      const flushList = () => {
        if (!list.length) {
          return;
        }

        const ListTag = listOrdered ? "ol" : "ul";

        elements.push(
          <ListTag
            key={`${keyPrefix}-list-${blockIndex}-${elements.length}`}
            className={listOrdered ? "list-decimal space-y-2.5 pl-5" : "space-y-2.5"}
          >
            {list.map((item, itemIndex) => (
              <li
                key={itemIndex}
                className={listOrdered ? "pl-1 text-zinc-300" : "flex gap-3 text-zinc-300"}
              >
                {!listOrdered ? (
                  <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200/80" />
                ) : null}
                <span className="min-w-0">
                  <InlineMarkdown text={item.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "")} />
                </span>
              </li>
            ))}
          </ListTag>
        );
        list = [];
        listOrdered = false;
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

        if (/^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
          flushParagraph();
          flushTable();
          const ordered = /^\d+[.)]\s+/.test(line);

          if (list.length && ordered !== listOrdered) {
            flushList();
          }

          listOrdered = ordered;
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

      return (
        <div key={`${keyPrefix}-block-${blockIndex}`} className="space-y-4">
          {elements}
        </div>
      );
    });
}

// /chat's <AIChatWorkspace> is a single responsive component serving
// both mobile and desktop widths (unlike the other two streaming
// renderers, which each have separate, permanently mobile-or-desktop
// call sites) -- so throttling only the mobile reading pace here needs
// a real runtime viewport check rather than a fixed prop. Mirrors this
// file's own existing 768px breakpoint convention (see the
// mobileKeyboardViewportHeight effect above).
function useIsMobileViewport(): boolean {
  const MOBILE_MARKDOWN_BREAKPOINT_PX = 768;

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.innerWidth < MOBILE_MARKDOWN_BREAKPOINT_PX;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const query = window.matchMedia(
      `(max-width: ${MOBILE_MARKDOWN_BREAKPOINT_PX - 1}px)`
    );

    const handleChange = () => setIsMobile(query.matches);
    handleChange();

    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return isMobile;
}

function MarkdownRenderer({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  // READING-PACE FIX -- see app/lib/streaming-reveal.ts. Only throttles
  // the reveal rate on mobile viewports; on desktop this is a pure
  // passthrough (content returned unchanged, every tick).
  const isMobileViewport = useIsMobileViewport();
  const revealedContent = useThrottledStreamingReveal(
    content,
    streaming,
    isMobileViewport
  );

  // ROOT CAUSE FIX (progressive-streaming pass) -- see the identical fix
  // and full explanation in components/planner/MarkdownRenderer.tsx:
  // useDeferredValue hid the cost of re-parsing the whole accumulated
  // message behind React's low-priority scheduling, which under a
  // steady stream of urgent token updates made the visible text lag and
  // catch up in bursts instead of revealing continuously. Splitting into
  // a memoized, frozen "settled" prefix and a small, cheap-to-reparse
  // "active" remainder removes the need for that deferral -- the
  // non-streaming (finalized) path still parses the full content in one
  // pass, unchanged from before.
  const { settled, active } = useMemo(() => {
    if (!streaming) {
      return { settled: revealedContent, active: "" };
    }

    return splitStreamingMarkdownIntoSettledAndActive(revealedContent);
  }, [revealedContent, streaming]);

  const settledBlocks = useMemo(
    () => parseMarkdownBlocksLocal(settled, "settled"),
    [settled]
  );
  const activeBlocks = active ? parseMarkdownBlocksLocal(active, "active") : [];

  return (
    <div className="min-w-0 max-w-full space-y-4 text-[15px] leading-8 text-zinc-300 [overflow-wrap:anywhere]">
      {settledBlocks}
      {activeBlocks}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="rounded-2xl border border-teal-300/15 bg-teal-300/[0.055] p-4 shadow-inner shadow-black/20">
      <div className="flex items-center gap-3">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-black/30">
          <span className="absolute h-6 w-6 animate-ping rounded-full bg-teal-200/15" />
          <Loader2 className="relative h-4 w-4 animate-spin text-teal-100" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">AI is thinking</p>
          <p className="text-xs text-zinc-500">
            Preparing careful guidance before streaming begins.
          </p>
        </div>
        <span className="ml-auto flex gap-1.5">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-200 [animation-delay:-0.2s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-200 [animation-delay:-0.1s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-200" />
        </span>
      </div>
      <div className="mt-5 space-y-2" aria-hidden="true">
        <div className="h-2.5 animate-pulse rounded-full bg-white/10" />
        <div className="h-2.5 w-10/12 animate-pulse rounded-full bg-white/10" />
        <div className="h-2.5 w-7/12 animate-pulse rounded-full bg-white/10" />
      </div>
    </div>
  );
}

const ChatBubble = memo(function ChatBubble({
  message,
  onSaveEdit,
  onRegenerate,
  actionDisabled = false,
}: {
  message: ChatMessage;
  onSaveEdit: (messageId: string, content: string) => void;
  onRegenerate: () => void;
  actionDisabled?: boolean;
}) {
  const isUser = message.role === "user";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);

  async function copyMessage() {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function saveEdit() {
    const cleanDraft = draft.trim();

    if (!cleanDraft) {
      return;
    }

    onSaveEdit(message.id, cleanDraft);
    setEditing(false);
  }

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser ? (
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10 shadow-lg shadow-teal-950/10">
          <Bot className="h-5 w-5 text-teal-100" />
        </div>
      ) : null}
      <article
        className={`w-full min-w-0 max-w-[min(48rem,100%)] rounded-[1.65rem] border p-4 shadow-xl shadow-black/20 transition duration-300 sm:p-5 ${
          isUser
            ? "border-teal-300/20 bg-teal-300/10"
            : "border-white/10 bg-zinc-950/80"
        }`}
        style={{ contain: message.status === "streaming" ? "layout paint" : undefined }}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold tracking-[0.2em] text-zinc-500">
            {isUser ? "YOU" : "ZERINIX"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* Only once text exists. Before the first token the big
                TypingIndicator card below ("AI is thinking") is the single
                loading state, and this badge would have said the same thing a
                second time, one line above it. The card renders on exactly the
                inverse condition (streaming && !message.content), so the two
                can never be on screen together: the card disappears the moment
                content arrives and this takes over as the streaming marker. */}
            {message.status === "streaming" && message.content ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300/20 px-2 py-1 text-xs text-teal-100">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {message.regenerating ? "Regenerating" : "Generating"}
              </span>
            ) : null}
            <button
              type="button"
              onClick={copyMessage}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:border-teal-300/20 hover:bg-white/10 hover:text-white"
            >
              {copied ? (
                <ClipboardCheck className="h-3.5 w-3.5 text-teal-200" />
              ) : (
                <Clipboard className="h-3.5 w-3.5 text-teal-200" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
            {isUser ? (
              <button
                type="button"
                onClick={() => {
                  setDraft(message.content);
                  setEditing(true);
                }}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:border-teal-300/20 hover:bg-white/10 hover:text-white"
              >
                <Edit3 className="h-3.5 w-3.5 text-teal-200" />
                Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={onRegenerate}
                disabled={actionDisabled}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:border-teal-300/20 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCcw className="h-3.5 w-3.5 text-teal-200" />
                {message.status === "failed" ? "Retry" : "Regenerate advice"}
              </button>
            )}
          </div>
        </div>

        {editing ? (
          <div className="space-y-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-black/40 p-3 text-sm leading-6 text-white outline-none focus:border-teal-300/40"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                className="rounded-xl bg-teal-300 px-3 py-2 text-xs font-semibold text-black transition hover:bg-teal-200"
              >
                Save edit
              </button>
            </div>
          </div>
        ) : message.status === "streaming" && !message.content ? (
          <TypingIndicator />
        ) : message.status === "failed" ? (
          <ChatStatusNotice
            issue={getChatIssue(message.content)}
            onRetry={actionDisabled ? undefined : onRegenerate}
          />
        ) : (
          <MarkdownRenderer
            content={message.content}
            streaming={message.status === "streaming"}
          />
        )}

        {message.attachments && message.attachments.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {message.attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-zinc-300"
              >
                <Paperclip className="h-3.5 w-3.5 text-teal-200" />
                <span className="min-w-0 truncate">{attachment.name}</span>
              </span>
            ))}
          </div>
        ) : null}
      </article>
      {isUser ? (
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] shadow-lg shadow-black/10">
          <User className="h-5 w-5 text-zinc-100" />
        </div>
      ) : null}
    </div>
  );
});

export default function AIChatWorkspace({
  initialConversations = [],
  conversationLoadError = "",
  initialReportMemory = null,
}: AIChatWorkspaceProps) {
  // Ask always opens on a clean session.
  //
  // Previously the most recently updated conversation became the active one on
  // mount, so simply tapping Ask in the bottom navigation re-opened the last
  // exchange -- and any refresh or re-entry resurrected it again. History is
  // already reachable from the left drawer, so the main route restoring it too
  // was a second, unasked-for path to the same thing.
  //
  // Nothing is deleted or hidden: every loaded conversation is kept in the
  // list below, so the drawer is unchanged and selecting one restores it in
  // full. Only the ACTIVE conversation changes -- it is a fresh, empty session
  // instead of the newest historical one.
  //
  // The fresh session is deliberately not persisted here. sendMessage calls
  // ensurePersistedConversation before writing the first message, so a session
  // the user never uses leaves no row behind and cannot clutter the drawer.
  const freshConversationId = useMemo(() => createMessageId(), []);
  const [conversations, setConversations] = useState<Conversation[]>(() => [
    createConversation(freshConversationId),
    ...initialConversations,
  ]);
  const [activeConversationId, setActiveConversationId] = useState(freshConversationId);
  const [prompt, setPrompt] = useState("");
  // Shared with the planner composer so both surfaces read file bytes,
  // validate size/MIME, and serialize attachments identically.
  const {
    attachments,
    setAttachments,
    attachmentError,
    setAttachmentError,
    isDraggingFiles,
    setIsDraggingFiles,
    handleFiles,
    handleDropFiles,
  } = useAttachments({ createId: createMessageId });
  // Binary attachment data is deliberately never persisted to ai_messages
  // (see persistMessage), so regenerating a file-backed answer needs the
  // originals from this session kept in memory for the last sent request.
  // Scoped to the conversation it belongs to, so regenerating in another
  // conversation can never reuse a previous conversation's files.
  const lastRequestAttachmentsRef = useRef<{
    conversationId: string;
    attachments: PlannerAttachment[];
  }>({ conversationId: "", attachments: [] });
  const [modelPreference, setModelPreference] = useState<ChatModelPreference>("fast");
  const [loading, setLoading] = useState(false);
  const [conversationError, setConversationError] = useState(conversationLoadError);
  const [userEmail, setUserEmail] = useState("");
  const [profile, setProfile] = useState<ChatProfile>(emptyProfile);
  const [profileDraft, setProfileDraft] = useState<ChatProfile>(emptyProfile);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [clearProfileConfirmOpen, setClearProfileConfirmOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // TASK -- Mobile Ask composer keyboard fix. Confirmed live: on the
  // iPhone Simulator, opening the software keyboard left the textarea
  // visible but hid the composer's own action row (Upload files / model
  // select / Ask advisor) underneath it. Root cause: this Capacitor
  // WebView has no @capacitor/keyboard plugin installed, and WKWebView
  // does not resize the layout viewport when the on-screen keyboard
  // appears -- it simply overlays on top, so <main>'s `h-[100dvh]
  // min-h-[100svh]` never shrinks and the bottom of this tall composer
  // (attachments preview + textarea + action row + tips row) ends up
  // underneath the keyboard. `window.visualViewport`, unlike the layout
  // viewport, DOES report the real, keyboard-reduced visible height --
  // used below to size <main> to match, which (via the EXISTING flex
  // column: header -> flex-1 min-h-0 message list -> shrink-0 composer)
  // pulls the composer's action row back above the keyboard using the
  // same flex layout already in place, with no new hardcoded offset.
  // `null` means "no override" (desktop, or keyboard closed) -- <main>
  // keeps its normal Tailwind-driven height exactly as before.
  const [mobileKeyboardViewportHeight, setMobileKeyboardViewportHeight] =
    useState<number | null>(null);
  // Second signal for the same question, because the first one is not reliable
  // on device: the visualViewport size check above only fires when iOS
  // actually shrinks the visual viewport, and in this WebView it sometimes
  // does not -- leaving the bottom navigation on screen, overlapping the "Ask
  // advisor" button, exactly when the user is typing.
  //
  // Focus is deterministic: the software keyboard is open precisely while the
  // composer has focus. The width is read at focus time rather than tracked,
  // because a rotation mid-focus is not a case worth a resize listener, and
  // this must never affect tablet or desktop, where the navigation stays.
  const [mobileComposerFocused, setMobileComposerFocused] = useState(false);
  // One question, two signals. EVERYTHING that must react to the mobile
  // keyboard reads this, so the bar's visibility and the space reserved for it
  // can never disagree -- which is exactly what went wrong: the bar was
  // hidden while its clearance padding stayed, leaving a black gap the height
  // of the bar between the composer and the keyboard, and stealing that height
  // from the message scroller.
  const mobileKeyboardOpen =
    mobileKeyboardViewportHeight !== null || mobileComposerFocused;

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) {
      return;
    }

    const viewport = window.visualViewport;
    const KEYBOARD_HEIGHT_THRESHOLD_PX = 120;

    function handleViewportResize() {
      if (window.innerWidth >= MOBILE_KEYBOARD_BREAKPOINT_PX) {
        setMobileKeyboardViewportHeight(null);
        return;
      }

      const keyboardLikelyOpen =
        window.innerHeight - viewport.height > KEYBOARD_HEIGHT_THRESHOLD_PX;
      setMobileKeyboardViewportHeight(keyboardLikelyOpen ? viewport.height : null);
    }

    handleViewportResize();
    viewport.addEventListener("resize", handleViewportResize);

    return () => viewport.removeEventListener("resize", handleViewportResize);
  }, []);
  const [activeReportMemoryId] = useState(() =>
    initialReportMemory?.id || getReportIdFromLocation() || getStoredActiveReportId()
  );
  const persistedConversationIdsRef = useRef<Set<string>>(
    new Set(initialConversations.map((conversation) => conversation.id))
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const preservedScrollTopRef = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId
  );
  const messages = activeConversation?.messages || [];
  const latestMessageContent = messages.at(-1)?.content;
  const sortedConversations = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations]
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleConversations = normalizedSearchQuery
    ? sortedConversations.filter((conversation) =>
        conversation.title.toLowerCase().includes(normalizedSearchQuery)
      )
    : sortedConversations;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      if (activeReportMemoryId) {
        window.sessionStorage.setItem(
          ACTIVE_REPORT_ID_STORAGE_KEY,
          activeReportMemoryId
        );
      }
    } catch {
      // Session storage is a convenience layer; chat still works without it.
    }
  }, [activeReportMemoryId]);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(async ({ data, error }) => {
      if (error) {
        console.error("[chat auth user failed]", error);
        setConversationError(error.message);
        return;
      }

      setUserEmail(data.user?.email || "");

      if (!data.user) {
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("ai_chat_profiles")
        .select(
          "preferred_country,preferred_industries,investment_budget_ranges,preferred_language,experience_level,available_time,business_interests,risk_tolerance,long_term_goals"
        )
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (profileError) {
        console.error("[ai_chat_profiles client select failed]", profileError);
        setProfileMessage(profileError.message);
        return;
      }

      const nextProfile = normalizeProfileRow(profileData);
      setProfile(nextProfile);
      setProfileDraft(nextProfile);
    });
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;

    if (!scroller || !shouldAutoScrollRef.current) {
      return;
    }

    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, latestMessageContent]);

  function updateScrollIntent(element: HTMLDivElement | null) {
    if (!element) {
      return;
    }

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 180;
  }

  function preserveMessageScrollAfterViewportChange() {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return;
    }

    updateScrollIntent(scroller);
    preservedScrollTopRef.current = scroller.scrollTop;

    window.setTimeout(() => {
      const nextScroller = scrollerRef.current;

      if (!nextScroller || shouldAutoScrollRef.current) {
        return;
      }

      nextScroller.scrollTop = preservedScrollTopRef.current;
    }, 80);
  }

  function updateConversation(
    conversationId: string,
    updater: (conversation: Conversation) => Conversation
  ) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId ? updater(conversation) : conversation
      )
    );
  }

  async function getCurrentUserId() {
    const supabase = createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      console.error("[chat auth missing]", error);
      return "";
    }

    return user.id;
  }

  async function saveProfile() {
    setProfileSaving(true);
    setProfileMessage("");

    const userId = await getCurrentUserId();

    if (!userId) {
      setProfileSaving(false);
      setProfileMessage("Sign in again to save your AI profile.");
      return;
    }

    const cleanProfile: ChatProfile = {
      preferred_country: profileDraft.preferred_country.trim(),
      preferred_industries: profileDraft.preferred_industries
        .map((item) => item.trim())
        .filter(Boolean),
      investment_budget_ranges: profileDraft.investment_budget_ranges
        .map((item) => item.trim())
        .filter(Boolean),
      preferred_language: profileDraft.preferred_language.trim(),
      experience_level: profileDraft.experience_level.trim(),
      available_time: profileDraft.available_time.trim(),
      business_interests: profileDraft.business_interests
        .map((item) => item.trim())
        .filter(Boolean),
      risk_tolerance: profileDraft.risk_tolerance.trim(),
      long_term_goals: profileDraft.long_term_goals
        .map((item) => item.trim())
        .filter(Boolean),
    };

    const supabase = createClient();
    const { error } = await supabase.from("ai_chat_profiles").upsert({
      user_id: userId,
      ...cleanProfile,
    });

    setProfileSaving(false);

    if (error) {
      console.error("[ai_chat_profiles upsert failed]", error);
      setProfileMessage("AI profile could not be saved. Please try again shortly.");
      return;
    }

    setProfile(cleanProfile);
    setProfileDraft(cleanProfile);
    setProfileMessage("Profile saved. Future advisory sessions will use these preferences.");
  }

  async function clearProfile() {
    setProfileSaving(true);
    setProfileMessage("");
    setClearProfileConfirmOpen(false);

    const userId = await getCurrentUserId();

    if (!userId) {
      setProfileSaving(false);
      setProfileMessage("Sign in again to clear your AI profile.");
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("ai_chat_profiles")
      .delete()
      .eq("user_id", userId);

    setProfileSaving(false);

    if (error) {
      console.error("[ai_chat_profiles delete failed]", error);
      setProfileMessage("AI profile could not be cleared. Please try again shortly.");
      return;
    }

    setProfile(emptyProfile);
    setProfileDraft(emptyProfile);
    setProfileMessage("Profile cleared.");
  }

  async function ensurePersistedConversation(conversationId: string, title: string) {
    if (persistedConversationIdsRef.current.has(conversationId)) {
      return true;
    }

    const userId = await getCurrentUserId();

    if (!userId) {
      setConversationError("No authenticated user was available for advisor session persistence.");
      window.location.assign("/login?next=/chat");
      return false;
    }

    const supabase = createClient();
    const { error } = await supabase.from("ai_conversations").insert({
      id: conversationId,
      user_id: userId,
      title,
    });

    if (error) {
      console.error("[ai_conversations insert failed]", error);
      setConversationError(error.message);
      return false;
    }

    setConversationError("");
    persistedConversationIdsRef.current.add(conversationId);
    return true;
  }

  async function persistConversationTitle(conversationId: string, title: string) {
    if (!(await ensurePersistedConversation(conversationId, title))) {
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("ai_conversations")
      .update({ title })
      .eq("id", conversationId);

    if (error) {
      console.error("[ai_conversations update failed]", error);
      setConversationError(error.message);
    } else {
      setConversationError("");
    }
  }

  async function touchPersistedConversation(conversationId: string) {
    if (!persistedConversationIdsRef.current.has(conversationId)) {
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("ai_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    if (error) {
      console.error("[ai_conversations touch failed]", error);
      setConversationError(error.message);
    }
  }

  async function persistMessage(conversationId: string, message: ChatMessage) {
    const userId = await getCurrentUserId();

    if (!userId) {
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.from("ai_messages").insert({
      id: message.id,
      conversation_id: conversationId,
      user_id: userId,
      role: message.role,
      content: message.content,
      mode: null,
      status: message.status || "complete",
      attachments: message.attachments || [],
    });

    if (error) {
      console.error("[ai_messages insert failed]", error);
      setConversationError(error.message);
      return;
    }

    await touchPersistedConversation(conversationId);
  }

  async function updatePersistedMessage(
    messageId: string,
    content: string,
    status: ChatMessage["status"] = "complete"
  ) {
    const supabase = createClient();
    const { error } = await supabase
      .from("ai_messages")
      .update({ content, status })
      .eq("id", messageId);

    if (error) {
      console.error("[ai_messages update failed]", error);
      setConversationError(error.message);
    } else {
      setConversationError("");
    }
  }

  async function deletePersistedConversation(conversationId: string) {
    if (!persistedConversationIdsRef.current.has(conversationId)) {
      return true;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("ai_conversations")
      .delete()
      .eq("id", conversationId);

    if (error) {
      console.error("[ai_conversations delete failed]", error);
      setConversationError("Advisory session could not be deleted. Please try again.");
      return false;
    }

    setConversationError("");
    return true;
  }

  function selectConversation(conversationId: string) {
    setActiveConversationId(conversationId);
    setSidebarOpen(false);
    setPrompt("");
    setAttachments([]);
  }

  async function createNewConversation() {
    const conversation = createConversation();
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setPrompt("");
    setAttachments([]);
    setSidebarOpen(false);
    await ensurePersistedConversation(conversation.id, conversation.title);
  }

  function startRename(conversation: Conversation) {
    setRenameTarget(conversation);
    setRenameDraft(conversation.title);
    setRenameError("");
  }

  function closeRenameModal() {
    setRenameTarget(null);
    setRenameDraft("");
    setRenameError("");
  }

  function commitRename() {
    if (!renameTarget) {
      return;
    }

    const cleanTitle = renameDraft.trim();

    if (!cleanTitle) {
      setRenameError("Advisory session name cannot be empty.");
      return;
    }

    updateConversation(renameTarget.id, (conversation) => ({
      ...conversation,
      title: cleanTitle,
      updatedAt: Date.now(),
    }));
    closeRenameModal();
    void persistConversationTitle(renameTarget.id, cleanTitle);
  }

  function deleteConversation(conversationId: string) {
    void deletePersistedConversation(conversationId).then((deleted) => {
      if (!deleted) {
        return;
      }

      setConversations((current) => {
        const remaining = current.filter((conversation) => conversation.id !== conversationId);

        if (remaining.length === 0) {
          const nextConversation = createConversation();
          setActiveConversationId(nextConversation.id);
          void ensurePersistedConversation(nextConversation.id, nextConversation.title);
          return [nextConversation];
        }

        if (conversationId === activeConversationId) {
          setActiveConversationId(remaining[0].id);
        }

        return remaining;
      });
      persistedConversationIdsRef.current.delete(conversationId);
    });
  }

  function removeAttachment(id: string) {
    setAttachmentError("");
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function updateAssistantMessage(
    messageId: string,
    content: string,
    status: ChatMessage["status"],
    conversationId: string,
    regenerating = false
  ) {
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === messageId ? { ...message, content, status, regenerating } : message
      ),
      updatedAt: getClientTimestamp(),
    }));
  }

  async function readStreamingText(
    response: Response,
    onChunk: (content: string) => void
  ) {
    if (!response.ok || !response.body) {
      let errorMessage = "Advisor response failed. Please try again.";

      try {
        const data = await response.json();
        errorMessage =
          typeof data?.error === "string" && data.error.trim()
            ? data.error
            : errorMessage;
      } catch {
        // Keep safe fallback.
      }

      throw new Error(errorMessage);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let output = "";
    let latestOutput = "";
    let paintHandle: number | null = null;

    // requestAnimationFrame where it exists (every browser this ships to); a
    // direct call keeps non-browser runtimes and tests behaving exactly as
    // they did before.
    const canSchedulePaint = typeof requestAnimationFrame === "function";

    function paint() {
      paintHandle = null;
      onChunk(sanitizeAiResponseText(latestOutput));
    }

    function schedulePaint() {
      if (!canSchedulePaint) {
        paint();
        return;
      }

      if (paintHandle === null) {
        paintHandle = requestAnimationFrame(paint);
      }
    }

    function cancelPendingPaint() {
      if (paintHandle !== null && canSchedulePaint) {
        cancelAnimationFrame(paintHandle);
        paintHandle = null;
      }
    }

    while (true) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(
                new Error(
                  "Advisor response timed out before the stream completed. Please try again."
                )
              ),
            CHAT_STREAM_IDLE_TIMEOUT_MS
          );
        }),
      ]).finally(() => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      });

      if (done) {
        break;
      }

      output += decoder.decode(value, { stream: true });

      const streamError = extractChatStreamError(output);
      if (streamError !== null) {
        cancelPendingPaint();
        throw new Error(streamError);
      }

      // Coalesce chunk -> UI to at most one update per animation frame.
      //
      // Painting every chunk was quadratic: sanitizeAiResponseText rescans the
      // WHOLE accumulated answer (two transforms plus four regex passes), and
      // the React update re-renders and re-parses the entire markdown message.
      // Both grow with the answer, so a long reply paid that cost once per
      // chunk -- hundreds of times, each more expensive than the last. On a
      // phone that is what made streaming crawl and then lurch.
      //
      // A frame is ~16ms, so this is not buffering: it is the fastest cadence
      // the display can actually show. Chunks still arrive and accumulate at
      // full speed; only the redundant repaints between frames are dropped,
      // and the exact final text is always flushed below.
      latestOutput = output;
      schedulePaint();
    }

    cancelPendingPaint();
    output += decoder.decode();

    const streamError = extractChatStreamError(output);
    if (streamError !== null) {
      throw new Error(streamError);
    }

    const sanitizedOutput = sanitizeAiResponseText(output);
    onChunk(sanitizedOutput);

    return sanitizedOutput;
  }

  async function sendMessage(
    promptOverride = prompt,
    addToHistory = true,
    supersededAssistantMessageId = "",
    replacementAssistantMessageId = ""
  ) {
    const submittedPrompt = promptOverride.trim();

    if (!submittedPrompt || loading) {
      return;
    }

    setLoading(true);
    setConversationError("");
    shouldAutoScrollRef.current = true;
    const conversationId = activeConversationId;
    const conversation = conversations.find((item) => item.id === conversationId);
    const title = shouldAutoTitleConversation(conversation?.title || "New conversation")
      ? generateConversationTitle(submittedPrompt)
      : conversation?.title || generateConversationTitle(submittedPrompt);
    // Regenerate (addToHistory === false) runs after the composer was
    // cleared, so it reuses the exact assets of the request it is replacing
    // instead of silently asking the model about files it never received.
    const currentAttachments = addToHistory
      ? attachments
      : lastRequestAttachmentsRef.current.conversationId === conversationId
        ? lastRequestAttachmentsRef.current.attachments
        : [];
    const currentMessages = conversation?.messages || [];
    const replacementMessage = replacementAssistantMessageId
      ? currentMessages.find((message) => message.id === replacementAssistantMessageId)
      : undefined;
    const replacementOriginalContent = replacementMessage?.content || "";
    const memoryMessages = currentMessages
      .filter(
        (message) =>
          message.content.trim() &&
          message.id !== supersededAssistantMessageId &&
          message.status !== "failed"
      )
      .map((message) => ({
        role: message.role,
        content: [
          message.content,
          message.attachments?.length
            ? `Uploaded files referenced in this message: ${message.attachments
                .map((attachment) => attachment.name)
                .join(", ")}`
            : "",
          message.mode && message.mode !== "chat"
            ? `Selected analysis type: ${message.mode}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      }));

    await ensurePersistedConversation(conversationId, title);

    if (addToHistory) {
      lastRequestAttachmentsRef.current = {
        conversationId,
        attachments: currentAttachments,
      };
      const userMessage: ChatMessage = {
        id: createMessageId(),
        role: "user",
        mode: "chat",
        content: submittedPrompt,
        // Metadata only: raw file bytes are never written to ai_messages.
        attachments: currentAttachments.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          size: attachment.size,
          mimeType: attachment.mimeType || "",
          textContent: attachment.textContent || "",
        })),
        status: "complete",
        createdAt: getClientTimestamp(),
      };

      updateConversation(conversationId, (current) => ({
        ...current,
        title,
        messages: [...current.messages, userMessage],
        updatedAt: getClientTimestamp(),
      }));
      await persistMessage(conversationId, userMessage);
      await persistConversationTitle(conversationId, title);
    }

    const assistantMessageId = replacementAssistantMessageId || createMessageId();

    if (replacementAssistantMessageId) {
      updateConversation(conversationId, (current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.id === replacementAssistantMessageId
            ? { ...message, status: "streaming", regenerating: true }
            : message
        ),
        updatedAt: getClientTimestamp(),
      }));
    } else {
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        mode: "chat",
        content: "",
        status: "streaming",
        createdAt: getClientTimestamp(),
      };

      updateConversation(conversationId, (current) => ({
        ...current,
        messages: [...current.messages, assistantMessage],
        updatedAt: getClientTimestamp(),
      }));
      void persistMessage(conversationId, assistantMessage);
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let requestTimedOut = false;
    const requestTimeoutId = setTimeout(() => {
      requestTimedOut = true;
      abortController.abort();
    }, CHAT_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Zerinix-AI-Request-Id": crypto.randomUUID(),
        },
        signal: abortController.signal,
        body: JSON.stringify({
          prompt: submittedPrompt,
          conversationId,
          modelPreference,
          attachments: serializeAttachmentsForAnalysis(currentAttachments),
          messages: memoryMessages,
          reportId: activeReportMemoryId,
        }),
      });

      const responseText = await readStreamingText(response, (content) => {
        if (!replacementAssistantMessageId) {
          updateAssistantMessage(assistantMessageId, content, "streaming", conversationId);
        }
      });
      const finalText = responseText || "I could not generate advisory guidance. Please try again.";

      updateAssistantMessage(assistantMessageId, finalText, "complete", conversationId);
      void updatePersistedMessage(assistantMessageId, finalText, "complete");
      if (addToHistory) {
        setPrompt("");
        setAttachments([]);
        setAttachmentError("");
      }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      const errorMessage = aborted
        ? requestTimedOut
          ? "Advisor response timed out before the server responded. Please try again."
          : "Generation stopped."
        : error instanceof Error
          ? error.message
          : "Advisor response failed. Please try again.";
      const friendlyMessage = getChatIssue(errorMessage).message;

      if (replacementAssistantMessageId) {
        updateAssistantMessage(
          assistantMessageId,
          replacementOriginalContent,
          "complete",
          conversationId
        );
      } else {
        updateAssistantMessage(assistantMessageId, friendlyMessage, "failed", conversationId);
        void updatePersistedMessage(assistantMessageId, friendlyMessage, "failed");
      }
      if (!aborted) {
        setConversationError(errorMessage);
      } else if (requestTimedOut) {
        setConversationError(errorMessage);
      }
    } finally {
      clearTimeout(requestTimeoutId);
      abortControllerRef.current = null;
      setLoading(false);
    }
  }

  function stopGeneration() {
    abortControllerRef.current?.abort();
  }

  function saveEditedMessage(messageId: string, content: string) {
    updateConversation(activeConversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === messageId ? { ...message, content } : message
      ),
      updatedAt: getClientTimestamp(),
    }));
    void updatePersistedMessage(messageId, content, "complete");
  }

  async function regenerateResponse() {
    if (loading) {
      return;
    }

    const previousAssistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user" && message.content.trim());

    if (!lastUserMessage) {
      return;
    }

    void sendMessage(
      lastUserMessage.content,
      false,
      previousAssistantMessage?.id,
      previousAssistantMessage?.id
    );
  }

  function retryAfterStatusNotice() {
    if (loading) {
      return;
    }

    if (messages.some((message) => message.role === "user")) {
      void regenerateResponse();
      return;
    }

    if (prompt.trim()) {
      void sendMessage();
    }
  }

  const activeModel = modelOptions.find((option) => option.value === modelPreference);
  const conversationIssue = conversationError ? getChatIssue(conversationError) : null;

  return (
    <main
      // Reserves exactly the fixed MobileBottomNavigation's own height:
      // 4.75rem is that nav's composition (pt-2 + p-1.5 twice + min-h-14 =
      // 76px, see components/MobileNavigation.tsx) and the env() term is
      // the home-indicator inset the nav itself adds. A flat `pb-28` (7rem)
      // guessed at that total, so it left slack below the composer on top
      // of the inset the nav already applies. The breakpoint matches the
      // nav's own `lg:hidden` -- with `md:pb-0` the nav stayed visible on
      // tablets while nothing reserved space for it, so it covered the
      // composer between 768px and 1024px.
      // While the mobile keyboard is open the bar is hidden, so reserving its
      // height would be reserving space for nothing: that padding was the
      // black gap above the keyboard, and the height it took came straight out
      // of the flex-1 message scroller, which is why scrolling felt stuck. The
      // inline height below already constrains the shell to the real visible
      // viewport, so with the padding gone the composer sits directly above
      // the keyboard and the scroller gets the remaining space.
      className={`flex h-[100dvh] min-h-[100svh] overflow-hidden bg-black text-white lg:pb-0 ${
        mobileKeyboardOpen ? "" : MOBILE_NAV_CLEARANCE
      }`}
      style={
        mobileKeyboardViewportHeight !== null
          ? { height: mobileKeyboardViewportHeight, minHeight: mobileKeyboardViewportHeight }
          : undefined
      }
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDraggingFiles(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDraggingFiles(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setIsDraggingFiles(false);
        }
      }}
      onDrop={handleDropFiles}
    >
      {/* Hidden while the mobile keyboard is open, by EITHER signal, and
          restored the moment it closes. Above md neither signal can be set,
          so tablet and desktop are untouched. */}
      {mobileKeyboardOpen ? null : <MobileBottomNavigation />}
      {renameTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl">
          <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-zinc-950 p-6 shadow-2xl shadow-black/60">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-teal-200/70">
              Rename advisory session
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
              Update session title
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Use a clear title so this advisory session is easy to find later.
            </p>
            <input
              value={renameDraft}
              onChange={(event) => {
                setRenameDraft(event.target.value);
                setRenameError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRename();
                }

                if (event.key === "Escape") {
                  closeRenameModal();
                }
              }}
              autoFocus
              className="mt-5 h-12 w-full rounded-2xl border border-white/10 bg-black/40 px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300/40"
              placeholder="Advisory session title"
            />
            {renameError ? (
              <p className="mt-3 text-sm text-red-300">{renameError}</p>
            ) : null}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={closeRenameModal}
                className="inline-flex flex-1 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={commitRename}
                className="inline-flex flex-1 items-center justify-center rounded-2xl bg-teal-300 px-4 py-3 text-sm font-semibold text-black transition hover:bg-teal-200"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl">
          <div className="w-full max-w-md rounded-[2rem] border border-red-300/20 bg-zinc-950 p-6 shadow-2xl shadow-black/60">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-300/20 bg-red-300/10">
              <Trash2 className="h-5 w-5 text-red-200" />
            </div>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.26em] text-red-200/70">
              Delete advisory session
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
              {deleteTarget.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              This will permanently delete the advisory session and its saved insights.
              This action cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="inline-flex flex-1 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteConversation(deleteTarget.id);
                  setDeleteTarget(null);
                }}
                className="inline-flex flex-1 items-center justify-center rounded-2xl border border-red-300/20 bg-red-300/15 px-4 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-300/20"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {clearProfileConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl">
          <div className="w-full max-w-md rounded-[2rem] border border-amber-300/20 bg-zinc-950 p-6 shadow-2xl shadow-black/60">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-300/10">
              <AlertCircle className="h-5 w-5 text-amber-200" />
            </div>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.26em] text-amber-100/70">
              Clear AI profile
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
              Remove saved chat preferences?
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Future advisory sessions will stop using your saved country, industry,
              budget, risk and goal preferences until you save a new profile.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setClearProfileConfirmOpen(false)}
                className="inline-flex flex-1 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void clearProfile()}
                className="inline-flex flex-1 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-300/15 px-4 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-300/20"
              >
                Clear profile
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isDraggingFiles ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xl">
          <div className="rounded-[2rem] border border-dashed border-teal-200/35 bg-zinc-950/90 p-8 text-center shadow-2xl shadow-teal-950/30">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-teal-200/25 bg-teal-200/10">
              <FileUp className="h-7 w-7 text-teal-200" />
            </div>
            <p className="mt-4 text-lg font-semibold">Drop files into ZERINIX Advisor</p>
            <p className="mt-2 text-sm text-zinc-500">
              Text files are read as context; other files are attached as references.
            </p>
          </div>
        </div>
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-[100dvh] max-h-[100dvh] w-[min(20rem,calc(100vw-1.25rem))] flex-col border-r border-white/10 bg-zinc-950/95 p-4 shadow-2xl shadow-black/60 backdrop-blur-2xl transition-transform [padding-bottom:calc(1rem+env(safe-area-inset-bottom))] ${MOBILE_SAFE_AREA_TOP} md:static md:w-80 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/dashboard"
            aria-label="Go to dashboard home"
            className="rounded-xl text-xl font-semibold tracking-[0.16em] text-white transition hover:text-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
          >
            ZERINIX
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="min-h-11 min-w-11 rounded-xl border border-white/10 p-2 text-zinc-300 md:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => void createNewConversation()}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-2xl border border-teal-200/25 bg-teal-200/10 px-4 py-3 text-sm font-semibold text-teal-50 shadow-lg shadow-teal-950/10 transition hover:-translate-y-0.5 hover:bg-teal-200/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
        >
          <Plus className="h-4 w-4" />
          New advisory session
        </button>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link
            href="/plan?new=1&mode=plan"
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-center text-xs font-semibold text-zinc-300 transition hover:-translate-y-0.5 hover:bg-white/10 hover:text-white"
          >
            AI Plan
          </Link>
          <Link
            href="/plan?new=1&mode=market"
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-center text-xs font-semibold text-zinc-300 transition hover:-translate-y-0.5 hover:bg-white/10 hover:text-white"
          >
            Market Analysis
          </Link>
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-500 focus-within:ring-2 focus-within:ring-teal-200/30">
          <Search className="h-4 w-4" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search advisory sessions..."
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
          />
        </div>

        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {sortedConversations.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-zinc-500">
              <p className="font-semibold text-white">No advisory sessions yet</p>
              <p className="mt-2">
                Start a new advisor session to build your ZERINIX decision history.
              </p>
            </div>
          ) : visibleConversations.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-zinc-500">
              <p className="font-semibold text-white">No advisory sessions found</p>
              <p className="mt-2">
                Try another session title or clear the search field.
              </p>
            </div>
          ) : null}

          {visibleConversations.map((conversation) => {
            const selected = conversation.id === activeConversationId;

            return (
              <div
                key={conversation.id}
                className={`group rounded-2xl border p-3 shadow-lg shadow-black/10 transition duration-300 ${
                  selected
                    ? "border-teal-200/30 bg-teal-200/10"
                    : "border-white/10 bg-white/[0.035] hover:-translate-y-0.5 hover:bg-white/[0.06]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectConversation(conversation.id)}
                  className="block min-h-11 w-full text-left"
                >
                  <span className="line-clamp-1 text-sm font-semibold text-white">
                    {conversation.title}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-5 text-zinc-500">
                    {getConversationPreview(conversation)}
                  </span>
                </button>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                    {new Date(conversation.updatedAt).toLocaleDateString()}
                  </span>
                  <div className="flex gap-1 opacity-100 md:opacity-0 md:transition md:group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => startRename(conversation)}
                      className="min-h-10 min-w-10 rounded-lg border border-white/10 p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
                      aria-label="Rename advisory session"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(conversation)}
                      className="min-h-10 min-w-10 rounded-lg border border-white/10 p-2 text-zinc-400 transition hover:bg-red-400/10 hover:text-red-200"
                      aria-label="Delete advisory session"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* The ONLY Advisor Profile slot, and it is md-and-up. From md up this
            aside is a real static sidebar, so the panel belongs here. Below md
            the same aside is the slide-over drawer, and `hidden` keeps the
            panel out of it -- nothing renders it on a phone, in the drawer or
            in the Ask column. The feature and its data model are unchanged;
            only its mobile placement is withdrawn, pending a move to
            Account. */}
        <div className="hidden md:block">
          <AdvisorProfilePanel
            profile={profile}
            profileDraft={profileDraft}
            setProfileDraft={setProfileDraft}
            profileOpen={profileOpen}
            setProfileOpen={setProfileOpen}
            profileMessage={profileMessage}
            setProfileMessage={setProfileMessage}
            profileSaving={profileSaving}
            saveProfile={saveProfile}
            setClearProfileConfirmOpen={setClearProfileConfirmOpen}
          />
        </div>

        <Link
          href="/dashboard/settings"
          aria-label="Open account settings"
          className="mt-4 block rounded-2xl border border-white/10 bg-white/[0.035] p-3 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
        >
          <p className="text-xs font-medium text-white">Signed in</p>
          <p className="mt-1 truncate text-xs text-zinc-500">
            {userEmail || "Authenticated user"}
          </p>
        </Link>
      </aside>

      {sidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar overlay"
        />
      ) : null}

      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.15),transparent_34%),linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.032)_1px,transparent_1px)] bg-[size:auto,54px_54px,54px_54px] opacity-80" />
        {/* The conversation header is the topmost element on mobile (this
            screen renders no shared MobileHeader), so it owns the top
            safe-area inset. `max()` keeps the existing py-3 / sm:py-4
            spacing on web, where the inset is 0. */}
        <header
          className={`relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-black/80 px-4 pb-3 shadow-xl shadow-black/20 backdrop-blur-xl sm:px-6 sm:pb-4 ${MOBILE_SAFE_AREA_TOP}`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="min-h-11 min-w-11 rounded-xl border border-white/10 p-2 text-zinc-200 md:hidden"
              aria-label="Open sidebar"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10 shadow-lg shadow-teal-950/10">
              <Bot className="h-5 w-5 text-teal-100" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {activeConversation?.title || "ZERINIX AI Advisor"}
              </p>
              <p className="text-xs text-zinc-500">
                AI Advisor · {activeModel?.label || "Fast"} mode · Live guidance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {modelOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setModelPreference(option.value)}
                className={`hidden rounded-2xl px-3 py-2 text-left transition sm:block ${
                  modelPreference === option.value
                    ? "bg-teal-200 text-black"
                    : "border border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/10"
                }`}
              >
                <span className="block text-xs font-semibold">{option.label}</span>
                <span
                  className={`block text-[10px] ${
                    modelPreference === option.value ? "text-black/60" : "text-zinc-600"
                  }`}
                >
                  {option.description}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={regenerateResponse}
              disabled={loading || !messages.some((message) => message.role === "user")}
              className="min-h-11 min-w-11 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Regenerate advisory response"
            >
              <RefreshCcw className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Vertical padding lives on the inner wrapper instead of this
            scroller, so the wrapper's `min-h-full` (which resolves against
            this element's content box) cannot overflow by the padding
            amount and leave the view permanently scrollable when the
            conversation is short. */}
        <div
          ref={scrollerRef}
          onScroll={(event) => updateScrollIntent(event.currentTarget)}
          className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6"
        >
          {/* BUG FIX -- this list used to carry `pb-48 sm:pb-44` (12rem)
              from when the composer was an overlay. The composer is now a
              normal `shrink-0` flex sibling below this scroller, so that
              padding reserved the composer's height a second time and
              rendered as a large empty gap under short answers. Only a
              normal reading gap is needed now; the flex column keeps the
              composer directly after the conversation. */}
          {/* `min-h-full` + `justify-end` keeps the conversation anchored to
              the bottom of this flex-1 scroller, so the composer follows the
              last message directly instead of being pushed to the viewport
              bottom with the scroller's leftover space showing as a gap.
              Longer conversations simply exceed min-h-full and scroll as
              before, so streaming and long answers are unaffected. */}
          <div className="mx-auto flex min-h-full max-w-5xl flex-col justify-end gap-5 pt-4 pb-6 sm:pt-6">
            {conversationIssue ? (
              <ChatStatusNotice
                issue={conversationIssue}
                onRetry={
                  conversationIssue.retryable && !loading ? retryAfterStatusNotice : undefined
                }
                onDismiss={() => setConversationError("")}
              />
            ) : null}

            {messages.length === 0 ? (
              // `flex-1` centres the welcome card in whatever space the
              // scroller actually has, instead of forcing a 52vh block that
              // added its own empty space above the composer.
              <div className="flex flex-1 items-center justify-center text-center">
                <div className="w-full max-w-4xl rounded-[2rem] border border-white/10 bg-white/[0.05] p-6 shadow-2xl shadow-black/40 ring-1 ring-white/[0.03] backdrop-blur-2xl sm:p-8">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl border border-teal-200/20 bg-teal-200/10 shadow-2xl shadow-teal-950/20">
                    <Sparkles className="h-6 w-6 text-teal-200" />
                  </div>
                  <h1 className="mt-6 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                    Work with your ZERINIX AI Advisor.
                  </h1>
                  <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
                    Pressure-test decisions, upload business context, refine recommendations and keep a persistent advisory history.
                  </p>
                  <div className="mt-6 grid gap-3 text-left md:grid-cols-2">
                    {promptStarters.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => setPrompt(starter)}
                        className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm leading-6 text-zinc-300 shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:border-teal-200/30 hover:bg-teal-200/[0.06] hover:text-white"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  onSaveEdit={saveEditedMessage}
                  onRegenerate={regenerateResponse}
                  actionDisabled={loading}
                />
              ))
            )}
          </div>
        </div>

        {/* Advisor Profile is DESKTOP-ONLY on Ask. It is not rendered in this
            column and not in the drawer (see the `hidden md:block` slot in the
            aside above, which the drawer's own breakpoint excludes). The
            feature, its state and its data model are untouched -- only its
            mobile placement is withdrawn, pending a move to Account. */}

        {/* The home-indicator inset belongs to whichever element actually
            sits above it. On mobile that is the fixed bottom navigation,
            which already applies `max(0.65rem,env(safe-area-inset-bottom))`,
            so repeating it here stacked the same inset twice and showed up
            as dead space between the composer and the nav. From `lg` the
            nav is hidden (`lg:hidden`) and the composer is bottom-most, so
            it takes the inset there instead. */}
        <div className="relative z-10 shrink-0 border-t border-white/10 bg-black/80 px-4 pb-2 pt-2.5 shadow-2xl shadow-black/40 backdrop-blur-2xl sm:px-6 sm:pb-4 sm:pt-4 lg:[padding-bottom:max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-5xl">
            {attachments.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300"
                  >
                    <Paperclip className="h-3.5 w-3.5 text-teal-200" />
                    <span className="min-w-0 max-w-[13rem] truncate sm:max-w-xs">
                      {attachment.name}
                    </span>
                    <span className="text-zinc-600">{formatFileSize(attachment.size)}</span>
                    {attachment.status === "processing" ? (
                      <span className="text-teal-200">Reading...</span>
                    ) : attachment.status === "error" ? (
                      <span className="text-red-200">Could not be read</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.id)}
                      className="min-h-8 min-w-8 rounded-full p-1 transition hover:bg-white/10"
                      aria-label="Remove attachment"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            {attachmentError ? (
              <div
                role="alert"
                className="mb-3 rounded-2xl border border-red-300/20 bg-red-400/[0.08] px-4 py-2.5 text-xs leading-5 text-red-100"
              >
                {attachmentError}
              </div>
            ) : null}

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-3 shadow-2xl shadow-black/50 ring-1 ring-white/[0.03] backdrop-blur-2xl">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2 pt-1">
                <span className="rounded-full border border-teal-200/20 bg-teal-200/10 px-3 py-1 text-xs font-medium text-teal-100">
                  AI Advisor
                </span>
                <span className="text-xs text-zinc-600">
                  Strategic reasoning, file context, report memory and persistent preferences.
                </span>
              </div>
              <textarea
                ref={composerRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onFocus={() => {
                  preserveMessageScrollAfterViewportChange();
                  setMobileComposerFocused(
                    window.innerWidth < MOBILE_KEYBOARD_BREAKPOINT_PX
                  );
                }}
                onBlur={() => {
                  preserveMessageScrollAfterViewportChange();
                  setMobileComposerFocused(false);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    if (prompt.trim() && !loading) {
                      void sendMessage();
                    }
                  }
                }}
                className="max-h-[32dvh] min-h-24 w-full resize-none overflow-y-auto rounded-2xl bg-black/35 p-4 text-base leading-7 text-white outline-none ring-1 ring-white/5 transition placeholder:text-zinc-600 focus:ring-teal-200/25 sm:min-h-28"
                placeholder="Ask for strategic analysis, paste business context, or upload a file..."
              />

              <div className="flex flex-col gap-3 pt-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:-translate-y-0.5 hover:bg-white/10">
                    <Paperclip className="h-4 w-4 text-teal-200" />
                    Upload files
                    <input
                      type="file"
                      multiple
                      accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
                      className="hidden"
                      onChange={(event) => void handleFiles(event.target.files)}
                    />
                  </label>
                  <select
                    value={modelPreference}
                    onChange={(event) =>
                      setModelPreference(event.target.value as ChatModelPreference)
                    }
                    className="min-h-11 rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-sm font-medium text-zinc-200 outline-none transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-teal-200/30"
                    aria-label="Select advisor response mode"
                  >
                    {modelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* One waiting state, and it is the answer card
                    (Thinking -> Generating), in context, where the user is
                    already looking. The composer adds no second spinner and no
                    second generation indicator: while a response streams it is
                    simply disabled. Stop stays available from md up, where
                    there is room for it beside the send button; on a phone the
                    composer is just inert for the duration. */}
                <div className="flex items-center gap-2">
                  {loading ? (
                    <button
                      type="button"
                      onClick={stopGeneration}
                      className="hidden min-h-12 items-center justify-center gap-2 rounded-2xl border border-red-300/20 bg-red-400/10 px-5 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-400/15 md:inline-flex"
                    >
                      <Square className="h-4 w-4" />
                      Stop
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={
                      loading ||
                      !prompt.trim() ||
                      // Never send while a file is still being read, and never
                      // send an unreadable file as if the model received it.
                      attachments.some((attachment) => attachment.status !== "ready")
                    }
                    onClick={() => void sendMessage()}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-teal-300 px-5 py-3 text-sm font-semibold text-black shadow-lg shadow-teal-950/40 transition hover:-translate-y-0.5 hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                  >
                    Ask advisor
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[11px] text-zinc-600 sm:mt-3 sm:gap-3 sm:text-xs">
              {/* Both hints below describe things a phone cannot do: there is
                  no hardware Enter key to send with, and no drag-and-drop onto
                  the window. They are hidden below sm and kept from there up,
                  where a keyboard and a pointer are the norm. The sentence
                  after them is product guidance, not a desktop shortcut, so it
                  stays on every screen. */}
              <span className="hidden items-center gap-1 sm:inline-flex">
                <CornerDownLeft className="h-3.5 w-3.5" />
                <span>Enter to send</span>
                <span className="hidden md:inline"> · Shift + Enter for newline</span>
              </span>
              <span className="hidden items-center gap-1 sm:inline-flex">
                <MoreHorizontal className="h-3.5 w-3.5" />
                Drag files anywhere
              </span>
              <span>Use AI Plan or Market Analysis for structured reports.</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
