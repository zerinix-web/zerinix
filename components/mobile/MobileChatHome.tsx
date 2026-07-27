"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeDollarSign,
  BarChart3,
  Bot,
  ChartSpline,
  FileText,
  Loader2,
  Rocket,
  Send,
  Sparkles,
  User,
  type LucideIcon,
} from "lucide-react";
import {
  Fragment,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { sanitizeAiResponseText } from "@/app/lib/ai/response-sanitization";
import {
  createClient,
  restoreSupabaseSession,
} from "@/app/lib/supabase/client";

const MOBILE_CONVERSATION_STORAGE_KEY = "zerinix.mobileChatConversationId";
const INTERNAL_REPORT_DIAGNOSTIC_LINE =
  /(^|\n)\s*(?:No report is attached to this chat request\.?|No saved report memory is attached to this chat request\.?|Debug reason:[^\n]*|Open AI Chat from a saved report[^\n]*)\s*(?=\n|$)/gi;

function sanitizeMobileChatResponse(value: string) {
  return sanitizeAiResponseText(value)
    .replace(INTERNAL_REPORT_DIAGNOSTIC_LINE, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type MobileChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "failed";
};

type MobileRecommendation = {
  label: string;
  description: string;
  prompt: string;
  icon: LucideIcon;
};

type ContextualAction = MobileRecommendation & {
  keywords: RegExp;
};

const QUICK_START_PROMPTS = [
  "Validate my startup idea",
  "Analyze my competitors",
  "Build a business plan",
  "Estimate market size",
  "Create a go-to-market strategy",
];

const MOBILE_RECOMMENDATIONS: MobileRecommendation[] = [
  {
    label: "Validate Business Idea",
    description: "Validate and improve your startup idea.",
    prompt:
      "Help me validate my business idea. Start by asking me the most important question.",
    icon: Rocket,
  },
  {
    label: "Market Intelligence",
    description: "Research markets, customers and competitors.",
    prompt:
      "Help me understand my market, customers, competitors, and the most important opportunities.",
    icon: BarChart3,
  },
  {
    label: "Strategic Report",
    description: "Generate an executive-level business report.",
    prompt:
      "Help me develop the context for a professional strategic report. Ask what you need to know first.",
    icon: FileText,
  },
];

const CONTEXTUAL_ACTIONS: ContextualAction[] = [
  {
    label: "Business Idea",
    description: "Pressure-test the opportunity and sharpen the concept.",
    prompt:
      "Based on everything I have shared, help me validate and improve this business idea.",
    icon: Rocket,
    keywords:
      /\b(idea|startup|product|business|build|launch|validate|problem|solution|founder)\b/gi,
  },
  {
    label: "Market Intelligence",
    description: "Map the market, customers, and competitive landscape.",
    prompt:
      "Use our conversation context to analyze the market, target customers, and competitors.",
    icon: BarChart3,
    keywords:
      /\b(market|competitor|customer|audience|segment|industry|tam|sam|som|demand)\b/gi,
  },
  {
    label: "Strategic Report",
    description: "Turn the discussion into executive-level direction.",
    prompt:
      "Help me organize everything we have discussed into the strongest strategic direction for an executive report.",
    icon: FileText,
    keywords:
      /\b(strategy|strategic|plan|report|decision|roadmap|executive|investor|business plan)\b/gi,
  },
  {
    label: "Pricing Strategy",
    description: "Define positioning, packaging, and monetization.",
    prompt:
      "Using the business context from our conversation, help me design the right pricing strategy.",
    icon: BadgeDollarSign,
    keywords:
      /\b(price|pricing|revenue|subscription|monetize|monetization|package|margin|charge)\b/gi,
  },
  {
    label: "Financial Forecast",
    description: "Model the assumptions that matter most.",
    prompt:
      "Using what you already know about the business, help me build a practical financial forecast.",
    icon: ChartSpline,
    keywords:
      /\b(financial|forecast|cost|budget|cash|profit|revenue|margin|runway|unit economics)\b/gi,
  },
];

function getContextualActions(context: string) {
  const normalizedContext = context.toLowerCase();
  const resultCount = normalizedContext.length >= 140 ? 3 : 2;

  return CONTEXTUAL_ACTIONS.map((action, index) => ({
    action,
    index,
    score: (normalizedContext.match(action.keywords) || []).length,
  }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, resultCount)
    .map(({ action }) => action);
}

function MobileInlineMarkdown({ text }: { text: string }) {
  const parts = text.split(
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g
  );

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={`${part}-${index}`}
              className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.9em] text-teal-100"
            >
              {part.slice(1, -1)}
            </code>
          );
        }

        if (
          (part.startsWith("**") && part.endsWith("**")) ||
          (part.startsWith("__") && part.endsWith("__"))
        ) {
          return (
            <strong
              key={`${part}-${index}`}
              className="font-semibold text-zinc-50"
            >
              {part.slice(2, -2)}
            </strong>
          );
        }

        if (
          (part.startsWith("*") && part.endsWith("*")) ||
          (part.startsWith("_") && part.endsWith("_"))
        ) {
          return (
            <em
              key={`${part}-${index}`}
              className="italic text-zinc-200"
            >
              {part.slice(1, -1)}
            </em>
          );
        }

        return <span key={`${part}-${index}`}>{part}</span>;
      })}
    </>
  );
}

function parseMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownTableDivider(line: string) {
  const cells = parseMarkdownTableRow(line);

  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}

function buildMobileMarkdown(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const elements: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let listOrdered = false;
  let code: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }

    elements.push(
      <p
        key={`paragraph-${elements.length}`}
        className="whitespace-pre-wrap text-pretty"
      >
        <MobileInlineMarkdown text={paragraph.join(" ")} />
      </p>
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list.length) {
      return;
    }

    const ListTag = listOrdered ? "ol" : "ul";

    elements.push(
      <ListTag
        key={`list-${elements.length}`}
        className={
          listOrdered
            ? "list-decimal space-y-3.5 pl-6 marker:font-semibold marker:text-zinc-500"
            : "space-y-3.5"
        }
      >
        {list.map((item, index) => (
          <li
            key={`${item}-${index}`}
            className={
              listOrdered
                ? "pl-1.5"
                : "flex items-start gap-3.5"
            }
          >
            {!listOrdered ? (
              <span className="mt-[0.78rem] h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200/70 shadow-[0_0_8px_rgba(94,234,212,0.22)]" />
            ) : null}
            <span className="min-w-0">
              <MobileInlineMarkdown
                text={item
                  .replace(/^[-*+]\s+/, "")
                  .replace(/^\d+[.)]\s+/, "")}
              />
            </span>
          </li>
        ))}
      </ListTag>
    );
    list = [];
    listOrdered = false;
  };

  const flushCode = () => {
    if (!code.length) {
      return;
    }

    elements.push(
      <pre
        key={`code-${elements.length}`}
        className="max-w-full overflow-x-auto rounded-2xl border border-white/[0.09] bg-black/45 p-4 font-mono text-[13px] leading-6 text-zinc-300 shadow-inner shadow-black/30 [scrollbar-width:thin]"
      >
        <code>{code.join("\n")}</code>
      </pre>
    );
    code = [];
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    if (/^\s*```/.test(line)) {
      flushParagraph();
      flushList();

      if (inCode) {
        flushCode();
      }

      inCode = !inCode;
      continue;
    }

    if (inCode) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    if (
      line.includes("|") &&
      lineIndex + 1 < lines.length &&
      isMarkdownTableDivider(lines[lineIndex + 1])
    ) {
      flushParagraph();
      flushList();
      const headers = parseMarkdownTableRow(line);
      const rows: string[][] = [];

      lineIndex += 2;

      while (
        lineIndex < lines.length &&
        lines[lineIndex].trim() &&
        lines[lineIndex].includes("|")
      ) {
        rows.push(parseMarkdownTableRow(lines[lineIndex]));
        lineIndex += 1;
      }

      lineIndex -= 1;

      elements.push(
        <div
          key={`table-${elements.length}`}
          className="max-w-full overflow-x-auto rounded-2xl border border-white/[0.09] bg-black/20 [scrollbar-width:thin]"
        >
          <table className="min-w-[34rem] w-full border-collapse text-left text-[13px] leading-5">
            <thead className="bg-white/[0.055] text-zinc-100">
              <tr>
                {headers.map((header, index) => (
                  <th
                    key={`${header}-${index}`}
                    scope="col"
                    className="border-b border-white/[0.09] px-3.5 py-3 font-semibold"
                  >
                    <MobileInlineMarkdown text={header} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.065] text-zinc-400">
              {rows.map((row, rowIndex) => (
                <tr
                  key={`${row.join("-")}-${rowIndex}`}
                  className="transition-colors hover:bg-white/[0.025]"
                >
                  {headers.map((_, cellIndex) => (
                    <td
                      key={`${row[cellIndex] || ""}-${cellIndex}`}
                      className="px-3.5 py-3 align-top"
                    >
                      <MobileInlineMarkdown text={row[cellIndex] || ""} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^#{1,4}\s+/.test(line)) {
      flushParagraph();
      flushList();
      const level = line.match(/^#+/)?.[0].length || 3;
      const heading = line.replace(/^#{1,4}\s+/, "");
      const HeadingTag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      const headingClassName =
        level === 1
          ? "pt-2 text-[20px] font-semibold leading-7 tracking-[-0.025em] text-white"
          : level === 2
            ? "pt-1.5 text-[18px] font-semibold leading-7 tracking-[-0.018em] text-white"
            : "pt-1 text-[16px] font-semibold leading-6 text-zinc-100";

      elements.push(
        <HeadingTag
          key={`heading-${elements.length}`}
          className={headingClassName}
        >
          <MobileInlineMarkdown text={heading} />
        </HeadingTag>
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      const quoteLines = [line.replace(/^>\s?/, "")];

      while (
        lineIndex + 1 < lines.length &&
        /^>\s?/.test(lines[lineIndex + 1])
      ) {
        lineIndex += 1;
        quoteLines.push(lines[lineIndex].replace(/^>\s?/, ""));
      }

      elements.push(
        <blockquote
          key={`quote-${elements.length}`}
          className="rounded-r-xl border-l-2 border-teal-200/45 bg-teal-200/[0.045] py-2.5 pl-4 pr-3 italic text-zinc-300"
        >
          <MobileInlineMarkdown text={quoteLines.join(" ")} />
        </blockquote>
      );
      continue;
    }

    if (/^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      flushParagraph();
      const ordered = /^\d+[.)]\s+/.test(line);

      if (list.length && listOrdered !== ordered) {
        flushList();
      }

      listOrdered = ordered;
      list.push(line);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (inCode) {
    flushCode();
  } else {
    flushParagraph();
  }
  flushList();

  return elements;
}

function MobileAssistantContent({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  const deferredContent = useDeferredValue(content);
  const renderedContent = streaming ? deferredContent : content;
  const markdown = useMemo(
    () => buildMobileMarkdown(renderedContent),
    [renderedContent]
  );

  return (
    <div className="min-w-0 space-y-6 text-[15.5px] leading-[2.05] tracking-[-0.006em] text-zinc-300 [overflow-wrap:anywhere]">
      {markdown}
      {streaming && renderedContent ? (
        <span
          aria-hidden="true"
          className="ml-1 inline-block h-4 w-[2px] animate-pulse rounded-full bg-teal-100/55 align-[-2px]"
        />
      ) : null}
    </div>
  );
}

const MobileMessageRow = memo(function MobileMessageRow({
  message,
}: {
  message: MobileChatMessage;
}) {
  const isUser = message.role === "user";

  return (
    <article
      className={`flex items-start gap-3 ${
        isUser ? "justify-end" : ""
      }`}
    >
      {!isUser ? (
        <span className="mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/[0.09] shadow-[0_10px_24px_rgba(20,184,166,0.08)]">
          <Bot className="h-[1.05rem] w-[1.05rem] text-teal-100" />
        </span>
      ) : null}

      <div
        className={`min-w-0 ${
          isUser
            ? "max-w-[84%] whitespace-pre-wrap rounded-[1.5rem] rounded-tr-md border border-white/[0.09] bg-white/[0.085] px-4 py-3.5 text-[15px] leading-[1.65] text-zinc-100 shadow-[0_12px_28px_rgba(0,0,0,0.18)]"
            : message.status === "failed"
              ? "flex-1 rounded-[1.6rem] rounded-tl-md border border-red-200/10 bg-red-300/[0.04] px-4 py-3.5 text-[15px] leading-7 text-red-200"
              : "flex-1 rounded-[1.6rem] rounded-tl-md border border-white/[0.065] bg-white/[0.025] px-4 py-4 shadow-[0_14px_34px_rgba(0,0,0,0.16)]"
        }`}
      >
        {message.status === "streaming" && !message.content ? (
          <span
            role="status"
            className="inline-flex min-h-8 items-center gap-2.5 py-1 text-[13px] font-medium text-zinc-500"
          >
            <Loader2
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin text-teal-100/65"
            />
            <span>ZERINIX is thinking…</span>
          </span>
        ) : isUser || message.status === "failed" ? (
          message.content
        ) : (
          <MobileAssistantContent
            content={message.content}
            streaming={message.status === "streaming"}
          />
        )}
      </div>

      {isUser ? (
        <span className="mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/[0.09] bg-white/[0.055]">
          <User className="h-[1.05rem] w-[1.05rem] text-zinc-300" />
        </span>
      ) : null}
    </article>
  );
});

const RecommendedNextSteps = memo(function RecommendedNextSteps({
  actions,
  onSelect,
}: {
  actions: ContextualAction[];
  onSelect: (prompt: string) => void;
}) {
  return (
    <section
      aria-label="Recommended next step"
      className="ml-12"
    >
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        Recommended next step
      </p>
      <div className="space-y-2.5">
        {actions.map((action) => {
          const Icon = action.icon;

          return (
            <button
              key={action.label}
              type="button"
              onClick={() => onSelect(action.prompt)}
              className="group flex min-h-[4.75rem] w-full items-center gap-3.5 rounded-2xl border border-white/[0.14] bg-white/[0.05] px-3.5 py-3 text-left shadow-[0_14px_32px_rgba(0,0,0,0.26)] ring-1 ring-white/[0.02] transition duration-200 hover:-translate-y-0.5 hover:border-teal-200/25 hover:bg-white/[0.07] active:-translate-y-1 active:scale-[0.99]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-zinc-400 transition duration-200 group-hover:border-teal-200/20 group-hover:bg-teal-200/10 group-hover:text-teal-100">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-zinc-100">
                  {action.label}
                </span>
                <span className="mt-1 block text-[11px] leading-4 text-zinc-500">
                  {action.description}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600 transition duration-200 group-hover:translate-x-0.5 group-hover:text-zinc-300" />
            </button>
          );
        })}
      </div>
    </section>
  );
});

function StrategicReportCta() {
  return (
    <aside className="ml-12 rounded-[1.6rem] border border-teal-200/20 bg-[linear-gradient(145deg,rgba(45,212,191,0.1),rgba(255,255,255,0.035))] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.28)]">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-teal-200/20 bg-teal-200/10 text-teal-100">
        <FileText className="h-4 w-4" />
      </span>
      <p className="mt-4 text-[15px] font-semibold leading-6 text-white">
        Ready for a complete executive report?
      </p>
      <p className="mt-1.5 text-xs leading-5 text-zinc-500">
        Turn this conversation into a structured strategic deliverable.
      </p>
      <Link
        href="/plan?mode=plan"
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal-200 px-4 py-2.5 text-sm font-semibold text-black shadow-lg shadow-teal-950/20 transition duration-200 hover:-translate-y-0.5 hover:bg-teal-100 active:-translate-y-1 active:scale-[0.99]"
      >
        Generate Strategic Report
        <ArrowRight className="h-4 w-4" />
      </Link>
    </aside>
  );
}

function createMessageId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const randomValue = Math.floor(Math.random() * 16);
    const value = character === "x" ? randomValue : (randomValue & 0x3) | 0x8;

    return value.toString(16);
  });
}

function generateConversationTitle(content: string) {
  const title = content
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s.,:!?-]/gu, "")
    .trim()
    .replace(/[.!?]+$/g, "");

  if (!title) {
    return "New conversation";
  }

  return title.length > 54 ? `${title.slice(0, 54).trim()}...` : title;
}

async function getAuthenticatedSession() {
  const supabase = createClient();
  const session = await restoreSupabaseSession(supabase);

  if (!session?.access_token) {
    throw new Error("Your session is unavailable. Please sign in again.");
  }

  return session;
}

export default function MobileChatHome({
  featureFlagEnabled,
}: {
  featureFlagEnabled: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<MobileChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [hasEnteredConversation, setHasEnteredConversation] = useState(false);
  const [persistenceError, setPersistenceError] = useState("");
  const landingScrollRef = useRef<HTMLDivElement | null>(null);
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const landingTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const conversationIdRef = useRef(createMessageId());
  const sessionRef = useRef<Session | null>(null);
  const isConversationPersistedRef = useRef(false);
  const isPinnedToBottomRef = useRef(true);
  const savedScrollTopRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function restoreConversation() {
      try {
        const session = await getAuthenticatedSession();

        if (cancelled) {
          return;
        }

        sessionRef.current = session;

        const storedConversationId =
          window.sessionStorage.getItem(MOBILE_CONVERSATION_STORAGE_KEY) || "";
        const conversationId =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            storedConversationId
          )
            ? storedConversationId
            : createMessageId();

        conversationIdRef.current = conversationId;
        window.sessionStorage.setItem(
          MOBILE_CONVERSATION_STORAGE_KEY,
          conversationId
        );

        if (!storedConversationId) {
          return;
        }

        const supabase = createClient();
        const { data: conversation, error: conversationError } =
          await supabase
            .from("ai_conversations")
            .select("id")
            .eq("id", conversationId)
            .eq("user_id", session.user.id)
            .maybeSingle();

        if (conversationError) {
          throw conversationError;
        }

        if (!conversation) {
          window.sessionStorage.setItem(
            MOBILE_CONVERSATION_STORAGE_KEY,
            conversationId
          );
          return;
        }

        isConversationPersistedRef.current = true;

        const { data: persistedMessages, error: messagesError } =
          await supabase
            .from("ai_messages")
            .select("id,role,content,status")
            .eq("conversation_id", conversationId)
            .eq("user_id", session.user.id)
            .order("created_at", { ascending: true });

        if (messagesError) {
          throw messagesError;
        }

        if (!cancelled) {
          setMessages(
            (persistedMessages || [])
              .flatMap((message) => {
                if (
                  (message.role !== "user" && message.role !== "assistant") ||
                  typeof message.content !== "string"
                ) {
                  return [];
                }

                const content =
                  message.role === "assistant"
                    ? sanitizeMobileChatResponse(message.content)
                    : message.content.trim();

                if (!content) {
                  return [];
                }

                return [{
                  id: message.id,
                  role: message.role as MobileChatMessage["role"],
                  content,
                  status:
                    message.status === "failed"
                      ? "failed" as const
                      : "complete" as const,
                }];
              })
          );
        }
      } catch (error) {
        if (!cancelled) {
          setPersistenceError(
            error instanceof Error
              ? error.message
              : "Conversation history could not be restored."
          );
        }
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    }

    void restoreConversation();

    return () => {
      cancelled = true;
    };
  }, [featureFlagEnabled]);

  useEffect(() => {
    const scrollArea = conversationScrollRef.current;

    if (!scrollArea || !isPinnedToBottomRef.current) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      scrollArea.scrollTo({
        top: scrollArea.scrollHeight,
        behavior:
          messages.at(-1)?.status === "streaming" ? "auto" : "smooth",
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [messages]);

  useEffect(() => {
    const viewport = window.visualViewport;

    if (!viewport) {
      return;
    }

    const handleViewportResize = () => {
      const scrollArea = conversationScrollRef.current;

      if (!scrollArea) {
        return;
      }

      window.requestAnimationFrame(() => {
        scrollArea.scrollTop = isPinnedToBottomRef.current
          ? scrollArea.scrollHeight
          : savedScrollTopRef.current;
      });
    };

    viewport.addEventListener("resize", handleViewportResize);

    return () => viewport.removeEventListener("resize", handleViewportResize);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [prompt]);

  useEffect(() => {
    if (!hasEnteredConversation) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const promptLength = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(promptLength, promptLength);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [hasEnteredConversation]);

  const insertLandingPrompt = useCallback((value: string) => {
    setPrompt(value);

    window.requestAnimationFrame(() => {
      landingTextareaRef.current?.focus();
      landingTextareaRef.current?.setSelectionRange(value.length, value.length);
    });
  }, []);

  const insertConversationPrompt = useCallback((value: string) => {
    setPrompt(value);
    isPinnedToBottomRef.current = true;

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(value.length, value.length);
    });
  }, []);

  function updateAssistantMessage(
    messageId: string,
    content: string,
    status: MobileChatMessage["status"]
  ) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? { ...message, content, status }
          : message
      )
    );
  }

  async function ensurePersistedConversation(
    session: Session,
    title: string
  ) {
    if (isConversationPersistedRef.current) {
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("ai_conversations")
      .insert({
        id: conversationIdRef.current,
        user_id: session.user.id,
        title,
      });

    if (error) {
      throw error;
    }

    isConversationPersistedRef.current = true;
  }

  async function persistMessage(
    session: Session,
    message: MobileChatMessage
  ) {
    const supabase = createClient();
    const { error } = await supabase
      .from("ai_messages")
      .insert({
        id: message.id,
        conversation_id: conversationIdRef.current,
        user_id: session.user.id,
        role: message.role,
        content: message.content,
        mode: "chat",
        status: message.status,
        attachments: [],
      });

    if (error) {
      throw error;
    }

    const { error: touchError } = await supabase
      .from("ai_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationIdRef.current)
      .eq("user_id", session.user.id);

    if (touchError) {
      throw touchError;
    }
  }

  async function updatePersistedMessage(
    messageId: string,
    content: string,
    status: MobileChatMessage["status"]
  ) {
    const session = sessionRef.current;

    if (!session || !isConversationPersistedRef.current) {
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("ai_messages")
      .update({ content, status })
      .eq("id", messageId)
      .eq("user_id", session.user.id);

    if (error) {
      throw error;
    }
  }

  function reportPersistenceError(error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Conversation history could not be saved.";

    console.error("[mobile chat persistence failed]", error);
    setPersistenceError(message);
  }

  async function submitMessage() {
    const submittedPrompt = prompt.trim();

    if (!submittedPrompt || isLoading || isInitializing) {
      return;
    }

    const userMessage: MobileChatMessage = {
      id: createMessageId(),
      role: "user",
      content: submittedPrompt,
      status: "complete",
    };
    const assistantMessageId = createMessageId();
    const assistantMessage: MobileChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      status: "streaming",
    };
    const availableMemoryMessages = messages
      .filter(
        (message) =>
          message.content.trim() &&
          message.status !== "failed"
      );
    const contextualMemoryMessages =
      availableMemoryMessages.length <= 10
        ? availableMemoryMessages
        : [
            ...availableMemoryMessages.slice(0, 2),
            ...availableMemoryMessages.slice(-8),
          ];
    const memoryMessages = contextualMemoryMessages
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    setPrompt("");
    setIsLoading(true);
    isPinnedToBottomRef.current = true;
    setMessages((current) => [
      ...current,
      userMessage,
      assistantMessage,
    ]);
    let streamingAnimationFrame: number | null = null;

    try {
      const session =
        sessionRef.current ||
        (await getAuthenticatedSession());

      sessionRef.current = session;
      setPersistenceError("");

      try {
        await ensurePersistedConversation(
          session,
          generateConversationTitle(submittedPrompt)
        );
        await persistMessage(session, userMessage);
        await persistMessage(session, assistantMessage);
      } catch (error) {
        reportPersistenceError(error);
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          prompt: submittedPrompt,
          conversationId: conversationIdRef.current,
          modelPreference: "fast",
          attachments: [],
          messages: memoryMessages,
          reportId: "",
        }),
      });

      if (!response.ok || !response.body) {
        let message = "ZERINIX could not respond. Please try again.";

        try {
          const payload = await response.json();

          if (typeof payload?.error === "string" && payload.error.trim()) {
            message = payload.error;
          }
        } catch {
          // Keep the user-facing fallback when the API does not return JSON.
        }

        throw new Error(message);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let responseText = "";
      let pendingStreamingText = "";

      const scheduleStreamingUpdate = () => {
        if (streamingAnimationFrame !== null) {
          return;
        }

        streamingAnimationFrame = window.requestAnimationFrame(() => {
          streamingAnimationFrame = null;
          updateAssistantMessage(
            assistantMessageId,
            pendingStreamingText,
            "streaming"
          );
        });
      };

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        responseText += decoder.decode(value, { stream: true });
        pendingStreamingText = sanitizeMobileChatResponse(responseText);
        scheduleStreamingUpdate();
      }

      responseText += decoder.decode();
      const finalText =
        sanitizeMobileChatResponse(responseText) ||
        "I could not generate a response. Please try again.";

      if (streamingAnimationFrame !== null) {
        window.cancelAnimationFrame(streamingAnimationFrame);
      }

      updateAssistantMessage(assistantMessageId, finalText, "complete");
      void updatePersistedMessage(
        assistantMessageId,
        finalText,
        "complete"
      ).catch(reportPersistenceError);
    } catch (error) {
      if (streamingAnimationFrame !== null) {
        window.cancelAnimationFrame(streamingAnimationFrame);
      }

      const errorMessage =
        error instanceof Error
          ? error.message
          : "ZERINIX could not respond. Please try again.";

      updateAssistantMessage(
        assistantMessageId,
        errorMessage,
        "failed"
      );
      void updatePersistedMessage(
        assistantMessageId,
        errorMessage,
        "failed"
      ).catch(reportPersistenceError);
    } finally {
      if (streamingAnimationFrame !== null) {
        window.cancelAnimationFrame(streamingAnimationFrame);
      }

      setIsLoading(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    void submitMessage();
  }

  function handleConversationScroll() {
    const scrollArea = conversationScrollRef.current;

    if (!scrollArea) {
      return;
    }

    savedScrollTopRef.current = scrollArea.scrollTop;
    isPinnedToBottomRef.current =
      scrollArea.scrollHeight -
        scrollArea.scrollTop -
        scrollArea.clientHeight <
      96;
  }

  function enterConversation(nextPrompt?: string) {
    if (typeof nextPrompt === "string") {
      setPrompt(nextPrompt);
    }

    setHasEnteredConversation(true);
  }

  function handleLandingPromptChange(value: string) {
    setPrompt(value);

    if (value.length > 0) {
      setHasEnteredConversation(true);
    }
  }

  function handleLandingKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    setHasEnteredConversation(true);
    void submitMessage();
  }

  const showLanding =
    !isInitializing &&
    messages.length === 0 &&
    !hasEnteredConversation;

  useEffect(() => {
    if (!showLanding) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      landingScrollRef.current?.scrollTo({
        top: 0,
        behavior: "auto",
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [showLanding]);

  const userContext = messages
    .filter((message) => message.role === "user" && message.status !== "failed")
    .map((message) => message.content)
    .join("\n");
  const completedAssistantMessages = messages.filter(
    (message) =>
      message.role === "assistant" &&
      message.status === "complete" &&
      message.content.trim()
  );
  const contextualActions = useMemo(
    () => getContextualActions(userContext),
    [userContext]
  );
  const firstCompletedAssistantId = completedAssistantMessages[0]?.id || "";
  const reportReady =
    (completedAssistantMessages.length >= 2 &&
      messages.filter((message) => message.role === "user").length >= 2) ||
    (completedAssistantMessages.length >= 1 && userContext.length >= 320);
  const reportCtaAfterMessageId = reportReady
    ? completedAssistantMessages[
        Math.min(1, completedAssistantMessages.length - 1)
      ]?.id || ""
    : "";

  return (
    <section className="relative z-10 flex h-[100dvh] min-h-[100svh] w-full flex-col overflow-hidden bg-black text-white lg:hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_0%,rgba(45,212,191,0.16),transparent_36%),radial-gradient(circle_at_0%_62%,rgba(20,184,166,0.07),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_42%)]" />

      <header className="relative z-10 flex shrink-0 items-center gap-3 border-b border-white/10 bg-black/80 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-xl shadow-black/20 backdrop-blur-2xl">
        <span className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-white text-xs font-black tracking-[0.12em] text-black shadow-lg shadow-white/10">
          ZX
        </span>
        <div>
          <p className="text-sm font-bold tracking-[0.16em] text-white">
            ZERINIX
          </p>
          <p className="text-[11px] text-zinc-500">
            AI Business Assistant
          </p>
        </div>
      </header>

      <div className="relative z-10 min-h-0 flex-1">
        {isInitializing ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-teal-200" />
          </div>
        ) : null}

        <div
          ref={landingScrollRef}
          aria-hidden={!showLanding}
          className={`absolute inset-0 overflow-y-auto overscroll-contain px-4 pb-8 pt-[max(3rem,env(safe-area-inset-top))] [scroll-padding-top:max(3rem,env(safe-area-inset-top))] [-webkit-overflow-scrolling:touch] transition-all duration-500 ease-out ${
            showLanding
              ? "translate-y-0 opacity-100"
              : "pointer-events-none -translate-y-4 opacity-0"
          }`}
        >
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
            <div className="mb-5">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10 shadow-[0_16px_40px_rgba(20,184,166,0.12)]">
                <Sparkles className="h-5 w-5 text-teal-100" />
              </span>
              <h1 className="mt-8 max-w-md text-[2.55rem] font-semibold leading-[1.02] tracking-[-0.055em] text-white">
                What would you like to build today?
              </h1>
              <p className="mt-5 max-w-sm text-[15px] leading-7 text-zinc-400">
                Describe your startup, business, or challenge in natural
                language.
              </p>
            </div>

            <div className="rounded-[1.55rem] border border-white/[0.11] bg-white/[0.055] p-2 shadow-[0_20px_55px_rgba(0,0,0,0.42)] ring-1 ring-white/[0.02] backdrop-blur-2xl transition duration-300 focus-within:border-teal-200/30 focus-within:bg-white/[0.07]">
              <textarea
                ref={landingTextareaRef}
                value={prompt}
                onChange={(event) =>
                  handleLandingPromptChange(event.target.value)
                }
                onKeyDown={handleLandingKeyDown}
                rows={2}
                tabIndex={showLanding ? 0 : -1}
                aria-label="Ask ZERINIX about your business"
                placeholder="Ask anything about your business..."
                className="min-h-[4.75rem] w-full resize-none bg-transparent px-3 py-2.5 text-[16px] leading-6 text-white outline-none placeholder:text-zinc-500"
              />
              <div className="flex items-center justify-between gap-3 px-2 pb-1">
                <p className="text-[11px] tracking-[0.01em] text-zinc-600">
                  Shift + Enter for a new line
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setHasEnteredConversation(true);
                    void submitMessage();
                  }}
                  disabled={!prompt.trim() || isLoading || isInitializing}
                  tabIndex={showLanding ? 0 : -1}
                  aria-label="Send message"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-lg shadow-white/10 transition duration-200 hover:scale-[1.03] hover:bg-teal-100 active:scale-95 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-600 disabled:shadow-none"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>

            <section aria-label="Quick Start" className="mt-7">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Quick Start
              </p>
              <div className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {QUICK_START_PROMPTS.map((quickPrompt) => (
                  <button
                    key={quickPrompt}
                    type="button"
                    onClick={() => insertLandingPrompt(quickPrompt)}
                    tabIndex={showLanding ? 0 : -1}
                    className="min-h-11 shrink-0 snap-start whitespace-nowrap rounded-full border border-white/[0.1] bg-white/[0.045] px-5 py-3 text-[12px] font-medium leading-5 text-zinc-300 shadow-md shadow-black/15 transition duration-200 hover:-translate-y-0.5 hover:border-teal-200/20 hover:bg-white/[0.07] hover:text-white active:scale-[0.97]"
                  >
                    {quickPrompt}
                  </button>
                ))}
              </div>
            </section>

            <div className="mt-10 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)_+_0.75rem))]">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Suggested analyses
              </p>
              <div className="space-y-3">
              {MOBILE_RECOMMENDATIONS.map((recommendation) => {
                const Icon = recommendation.icon;

                return (
                  <button
                    key={recommendation.label}
                    type="button"
                    onClick={() => enterConversation(recommendation.prompt)}
                    tabIndex={showLanding ? 0 : -1}
                    className="group flex min-h-[5.5rem] w-full items-center gap-4 rounded-2xl border border-white/[0.09] bg-white/[0.035] px-4 py-3.5 text-left shadow-[0_12px_35px_rgba(0,0,0,0.2)] transition duration-300 hover:-translate-y-0.5 hover:border-teal-200/20 hover:bg-white/[0.06] active:-translate-y-1 active:scale-[0.99]"
                  >
                    <span className="flex h-[3.1rem] w-[3.1rem] shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.05] text-zinc-400 transition duration-300 group-hover:border-teal-200/20 group-hover:bg-teal-200/10 group-hover:text-teal-100">
                      <Icon className="h-[1.3rem] w-[1.3rem]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold leading-5 text-zinc-100">
                        {recommendation.label}
                      </span>
                      <span className="mt-1 block text-[12px] leading-5 text-zinc-500">
                        {recommendation.description}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600 transition duration-300 group-hover:translate-x-0.5 group-hover:text-zinc-300" />
                  </button>
                );
              })}
              </div>
            </div>
          </div>
        </div>

        <div
          ref={conversationScrollRef}
          onScroll={handleConversationScroll}
          aria-hidden={showLanding}
          className={`absolute inset-0 overflow-y-auto overscroll-contain px-3.5 pb-12 pt-7 [scroll-padding-bottom:4rem] [-webkit-overflow-scrolling:touch] transition-all duration-500 ease-out ${
            !isInitializing && !showLanding
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-3 opacity-0"
          }`}
        >
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
            {messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center pb-16 text-center">
                <div>
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
                    <Sparkles className="h-5 w-5 text-teal-100" />
                  </span>
                  <p className="mt-5 text-sm leading-6 text-zinc-500">
                    Continue your thought below.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-7 pb-5 pt-1">
                {messages.map((message) => (
                  <Fragment key={message.id}>
                    <MobileMessageRow message={message} />
                    {message.id === firstCompletedAssistantId ? (
                      <RecommendedNextSteps
                        actions={contextualActions}
                        onSelect={insertConversationPrompt}
                      />
                    ) : null}
                    {message.id === reportCtaAfterMessageId ? (
                      <StrategicReportCta />
                    ) : null}
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        aria-hidden={showLanding}
        className={`relative z-10 shrink-0 border-t border-white/[0.08] bg-black/90 px-3 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)_+_0.5rem))] pt-3 shadow-[0_-12px_38px_rgba(0,0,0,0.34)] backdrop-blur-2xl transition-all duration-500 ease-out ${
          !isInitializing && !showLanding
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-full opacity-0"
        }`}
      >
        {persistenceError ? (
          <p
            className="mx-auto mb-2 max-w-3xl px-2 text-xs text-amber-200"
            role="status"
          >
            Chat is available, but conversation history could not be saved.
          </p>
        ) : null}
        <div className="mx-auto flex min-h-[3.75rem] max-w-3xl items-end gap-2 rounded-[1.7rem] border border-white/[0.11] bg-white/[0.06] p-2 pl-4.5 shadow-[0_16px_38px_rgba(0,0,0,0.38)] ring-1 ring-white/[0.018] transition duration-300 focus-within:border-teal-200/30 focus-within:bg-white/[0.075] focus-within:shadow-[0_18px_44px_rgba(0,0,0,0.44)]">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            rows={1}
            tabIndex={showLanding ? -1 : 0}
            aria-label="Message ZERINIX"
            placeholder="Ask anything about your business..."
            className="max-h-40 min-h-11 flex-1 resize-none overflow-y-auto bg-transparent py-2.5 text-[15.5px] leading-6 text-white outline-none transition-[height] duration-150 ease-out placeholder:font-normal placeholder:tracking-[-0.01em] placeholder:text-zinc-500"
          />
          <button
            type="button"
            onClick={() => void submitMessage()}
            disabled={!prompt.trim() || isLoading || isInitializing}
            tabIndex={showLanding ? -1 : 0}
            aria-label={isLoading ? "ZERINIX is responding" : "Send message"}
            className="inline-flex h-[3.125rem] w-[3.125rem] shrink-0 self-end items-center justify-center rounded-full bg-white text-black shadow-md shadow-white/5 transition duration-200 hover:scale-[1.02] active:scale-95 active:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-600 disabled:shadow-none"
          >
            <Send className="h-[1.2rem] w-[1.2rem]" />
          </button>
        </div>
      </div>
    </section>
  );
}
