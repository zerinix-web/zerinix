"use client";

import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
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

type ChatModelPreference = "fast" | "balanced";

type ChatAttachment = {
  id: string;
  name: string;
  size: number;
  textContent?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: "chat" | "plan" | "market";
  attachments?: ChatAttachment[];
  status?: "streaming" | "complete" | "failed";
  createdAt: number;
};

type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

type ChatProfile = {
  preferred_country: string;
  preferred_industries: string[];
  investment_budget_ranges: string[];
  preferred_language: string;
  experience_level: string;
  available_time: string;
  business_interests: string[];
  risk_tolerance: string;
  long_term_goals: string[];
};

type AIChatWorkspaceProps = {
  initialConversations?: Conversation[];
  conversationLoadError?: string;
};

const CHAT_STREAM_IDLE_TIMEOUT_MS = 60_000;
const CHAT_REQUEST_TIMEOUT_MS = 75_000;

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
  "Review this business idea and pressure-test the risks.",
  "Turn these notes into a sharper founder pitch.",
  "Compare bootstrapping versus raising capital for my company.",
  "Analyze this customer segment and suggest a better ICP.",
];

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
    title: "New conversation",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function shouldAutoTitleConversation(title: string) {
  return (
    title === "New conversation" ||
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
    return "New conversation";
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

function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function formatList(value: string[]) {
  return value.join(", ");
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

function hasProfileContent(profile: ChatProfile) {
  return Boolean(
    profile.preferred_country ||
      profile.preferred_industries.length ||
      profile.investment_budget_ranges.length ||
      profile.preferred_language ||
      profile.experience_level ||
      profile.available_time ||
      profile.business_interests.length ||
      profile.risk_tolerance ||
      profile.long_term_goals.length
  );
}

function getConversationPreview(conversation: Conversation) {
  const message = [...conversation.messages]
    .reverse()
    .find((item) => item.content.trim());

  if (!message) {
    return "Start a new AI chat";
  }

  if (message.status === "failed") {
    return message.content || "Chat response failed";
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
    <div className="my-4 overflow-hidden rounded-2xl border border-white/10 bg-black/70">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.035] px-4 py-2">
        <span className="text-xs font-medium text-zinc-500">{language || "code"}</span>
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

        return <span key={`${part}-${index}`}>{part}</span>;
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

function MarkdownRenderer({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const deferredContent = useDeferredValue(content);
  const renderedContent = streaming ? deferredContent : content;
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
          if (!paragraph.length) {
            return;
          }

          elements.push(
            <p key={`p-${blockIndex}-${elements.length}`} className="whitespace-pre-wrap text-zinc-300">
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
            <MarkdownTable key={`table-${blockIndex}-${elements.length}`} lines={table} />
          );
          table = [];
        };

        const flushList = () => {
          if (!list.length) {
            return;
          }

          elements.push(
            <ul key={`list-${blockIndex}-${elements.length}`} className="space-y-2.5">
              {list.map((item, itemIndex) => (
                <li key={`item-${blockIndex}-${itemIndex}-${item}`} className="flex gap-3 text-zinc-300">
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

        return (
          <div key={`block-${blockIndex}`} className="space-y-4">
            {elements}
          </div>
        );
      })}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-400">
      <span>ZERINIX is thinking</span>
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-200 [animation-delay:-0.2s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-200 [animation-delay:-0.1s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-200" />
      </span>
    </div>
  );
}

const ChatBubble = memo(function ChatBubble({
  message,
  onSaveEdit,
  onRegenerate,
}: {
  message: ChatMessage;
  onSaveEdit: (messageId: string, content: string) => void;
  onRegenerate: () => void;
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
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
          <Bot className="h-5 w-5 text-teal-100" />
        </div>
      ) : null}
      <article
        className={`w-full min-w-0 max-w-3xl rounded-[1.5rem] border p-5 shadow-xl shadow-black/20 ${
          isUser
            ? "border-teal-300/20 bg-teal-300/10"
            : "border-white/10 bg-zinc-950/80"
        }`}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold tracking-[0.2em] text-zinc-500">
            {isUser ? "YOU" : "ZERINIX"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {message.status === "streaming" ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300/20 px-2 py-1 text-xs text-teal-100">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Streaming
              </span>
            ) : null}
            <button
              type="button"
              onClick={copyMessage}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
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
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
              >
                <Edit3 className="h-3.5 w-3.5 text-teal-200" />
                Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={onRegenerate}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
              >
                <RefreshCcw className="h-3.5 w-3.5 text-teal-200" />
                Regenerate
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
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-zinc-300"
              >
                <Paperclip className="h-3.5 w-3.5 text-teal-200" />
                {attachment.name}
              </span>
            ))}
          </div>
        ) : null}
      </article>
      {isUser ? (
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]">
          <User className="h-5 w-5 text-zinc-100" />
        </div>
      ) : null}
    </div>
  );
});

export default function AIChatWorkspace({
  initialConversations = [],
  conversationLoadError = "",
}: AIChatWorkspaceProps) {
  const initialConversationId = useMemo(
    () => initialConversations[0]?.id || createMessageId(),
    [initialConversations]
  );
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    initialConversations.length > 0
      ? initialConversations
      : [createConversation(initialConversationId)]
  );
  const [activeConversationId, setActiveConversationId] = useState(initialConversationId);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const persistedConversationIdsRef = useRef<Set<string>>(
    new Set(initialConversations.map((conversation) => conversation.id))
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
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
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, latestMessageContent]);

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
      setProfileMessage(error.message);
      return;
    }

    setProfile(cleanProfile);
    setProfileDraft(cleanProfile);
    setProfileMessage("Profile saved. Future chats will use these preferences.");
  }

  async function clearProfile() {
    const shouldClear = window.confirm(
      "Clear your saved AI Chat profile? Future chats will stop using these preferences."
    );

    if (!shouldClear) {
      return;
    }

    setProfileSaving(true);
    setProfileMessage("");

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
      setProfileMessage(error.message);
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
      setConversationError("No authenticated user was available for chat persistence.");
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

  async function deletePersistedMessage(messageId: string) {
    const supabase = createClient();
    const { error } = await supabase.from("ai_messages").delete().eq("id", messageId);

    if (error) {
      console.error("[ai_messages delete failed]", error);
      setConversationError(error.message);
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
      setConversationError(error.message);
      window.alert("Conversation could not be deleted. Please try again.");
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
      setRenameError("Conversation name cannot be empty.");
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

  async function readAttachmentText(file: File) {
    const textLike =
      file.type.startsWith("text/") ||
      /\.(txt|md|csv|json|ts|tsx|js|jsx|css|html|sql)$/i.test(file.name);

    if (!textLike || file.size > 220_000) {
      return "";
    }

    try {
      return (await file.text()).slice(0, 20_000);
    } catch (error) {
      console.error("[attachment text read failed]", error);
      return "";
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) {
      return;
    }

    const uploadedFiles = await Promise.all(
      Array.from(files).map(async (file) => ({
        id: createMessageId(),
        name: file.name,
        size: file.size,
        textContent: await readAttachmentText(file),
      }))
    );

    setAttachments((current) => [...current, ...uploadedFiles]);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function handleDropFiles(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDraggingFiles(false);
    void handleFiles(event.dataTransfer.files);
  }

  function updateAssistantMessage(
    messageId: string,
    content: string,
    status: ChatMessage["status"],
    conversationId: string
  ) {
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === messageId ? { ...message, content, status } : message
      ),
      updatedAt: getClientTimestamp(),
    }));
  }

  async function readStreamingText(
    response: Response,
    onChunk: (content: string) => void
  ) {
    if (!response.ok || !response.body) {
      let errorMessage = "Chat response failed. Please try again.";

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

    while (true) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(
                new Error(
                  "Chat response timed out before the stream completed. Please try again."
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
      onChunk(output);
    }

    output += decoder.decode();
    onChunk(output);

    return output.trim();
  }

  async function sendMessage(
    promptOverride = prompt,
    addToHistory = true,
    supersededAssistantMessageId = ""
  ) {
    const submittedPrompt = promptOverride.trim();

    if (!submittedPrompt || loading) {
      return;
    }

    setLoading(true);
    setConversationError("");
    const conversationId = activeConversationId;
    const conversation = conversations.find((item) => item.id === conversationId);
    const title = shouldAutoTitleConversation(conversation?.title || "New conversation")
      ? generateConversationTitle(submittedPrompt)
      : conversation?.title || generateConversationTitle(submittedPrompt);
    const currentAttachments = attachments;
    const currentMessages = conversation?.messages || [];
    const memoryMessages = currentMessages
      .filter(
        (message) =>
          message.content.trim() &&
          message.id !== supersededAssistantMessageId &&
          message.status !== "failed"
      )
      .slice(-16)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    await ensurePersistedConversation(conversationId, title);

    if (addToHistory) {
      const userMessage: ChatMessage = {
        id: createMessageId(),
        role: "user",
        mode: "chat",
        content: submittedPrompt,
        attachments: currentAttachments,
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

    const assistantMessageId = createMessageId();
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
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          prompt: submittedPrompt,
          conversationId,
          modelPreference,
          attachments: currentAttachments.map((attachment) => ({
            name: attachment.name,
            size: attachment.size,
            textContent: attachment.textContent || "",
          })),
          messages: memoryMessages,
        }),
      });

      const responseText = await readStreamingText(response, (content) =>
        updateAssistantMessage(assistantMessageId, content, "streaming", conversationId)
      );
      const finalText = responseText || "I could not generate a response. Please try again.";

      updateAssistantMessage(assistantMessageId, finalText, "complete", conversationId);
      void updatePersistedMessage(assistantMessageId, finalText, "complete");
      setPrompt("");
      setAttachments([]);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      const errorMessage = aborted
        ? requestTimedOut
          ? "Chat response timed out before the server responded. Please try again."
          : "Generation stopped."
        : error instanceof Error
          ? error.message
          : "Chat response failed. Please try again.";

      updateAssistantMessage(assistantMessageId, errorMessage, "failed", conversationId);
      void updatePersistedMessage(assistantMessageId, errorMessage, "failed");
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

    if (previousAssistantMessage) {
      updateConversation(activeConversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.filter(
          (message) => message.id !== previousAssistantMessage.id
        ),
        updatedAt: getClientTimestamp(),
      }));
      await deletePersistedMessage(previousAssistantMessage.id);
    }

    void sendMessage(lastUserMessage.content, false, previousAssistantMessage?.id);
  }

  const activeModel = modelOptions.find((option) => option.value === modelPreference);

  return (
    <main
      className="flex h-screen overflow-hidden bg-black text-white"
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
      {renameTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl">
          <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-zinc-950 p-6 shadow-2xl shadow-black/60">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-teal-200/70">
              Rename conversation
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
              Update conversation title
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Use a clear title so this conversation is easy to find later.
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
              placeholder="Conversation title"
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
              Delete conversation
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
              {deleteTarget.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              This will permanently delete the conversation and its saved messages.
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

      {isDraggingFiles ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl">
          <div className="rounded-[2rem] border border-teal-200/30 bg-zinc-950/90 p-8 text-center shadow-2xl shadow-teal-950/30">
            <FileUp className="mx-auto h-10 w-10 text-teal-200" />
            <p className="mt-4 text-lg font-semibold">Drop files into ZERINIX Chat</p>
            <p className="mt-2 text-sm text-zinc-500">
              Text files are read as context; other files are attached as references.
            </p>
          </div>
        </div>
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-80 flex-col border-r border-white/10 bg-zinc-950/95 p-4 shadow-2xl shadow-black/60 backdrop-blur-2xl transition-transform md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="text-xl font-semibold tracking-[0.16em] text-white">
            ZERINIX
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-xl border border-white/10 p-2 text-zinc-300 md:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => void createNewConversation()}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-2xl border border-teal-200/25 bg-teal-200/10 px-4 py-3 text-sm font-semibold text-teal-50 transition hover:bg-teal-200/15"
        >
          <Plus className="h-4 w-4" />
          New conversation
        </button>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link
            href="/plan"
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-center text-xs font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            AI Plan
          </Link>
          <Link
            href="/plan"
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-center text-xs font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            Market Analysis
          </Link>
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-500">
          <Search className="h-4 w-4" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search conversations..."
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
          />
        </div>

        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {sortedConversations.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-zinc-500">
              <p className="font-semibold text-white">No conversations yet</p>
              <p className="mt-2">
                Start a new chat to build your ZERINIX conversation history.
              </p>
            </div>
          ) : visibleConversations.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-zinc-500">
              <p className="font-semibold text-white">No conversations found</p>
              <p className="mt-2">
                Try another title or clear the search field.
              </p>
            </div>
          ) : null}

          {visibleConversations.map((conversation) => {
            const selected = conversation.id === activeConversationId;

            return (
              <div
                key={conversation.id}
                className={`group rounded-2xl border p-3 transition ${
                  selected
                    ? "border-teal-200/30 bg-teal-200/10"
                    : "border-white/10 bg-white/[0.035] hover:bg-white/[0.06]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectConversation(conversation.id)}
                  className="block w-full text-left"
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
                      className="rounded-lg border border-white/10 p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
                      aria-label="Rename conversation"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(conversation)}
                      className="rounded-lg border border-white/10 p-1.5 text-zinc-400 transition hover:bg-red-400/10 hover:text-red-200"
                      aria-label="Delete conversation"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
          <button
            type="button"
            onClick={() => {
              setProfileDraft(profile);
              setProfileOpen((current) => !current);
              setProfileMessage("");
            }}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="block text-xs font-medium text-white">AI Chat Profile</span>
              <span className="mt-1 block text-xs text-zinc-500">
                {hasProfileContent(profile)
                  ? "Saved preferences active"
                  : "Add preferences to reduce repeat questions"}
              </span>
            </span>
            <User className="h-4 w-4 text-teal-200" />
          </button>

          {profileOpen ? (
            <div className="mt-4 space-y-3">
              <label className="block text-xs text-zinc-500">
                Country / market
                <input
                  value={profileDraft.preferred_country}
                  onChange={(event) =>
                    setProfileDraft((current) => ({
                      ...current,
                      preferred_country: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
                  placeholder="Turkey, UAE, Germany..."
                />
              </label>

              <label className="block text-xs text-zinc-500">
                Preferred industries
                <input
                  value={formatList(profileDraft.preferred_industries)}
                  onChange={(event) =>
                    setProfileDraft((current) => ({
                      ...current,
                      preferred_industries: parseList(event.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
                  placeholder="AI, healthcare, real estate"
                />
              </label>

              <label className="block text-xs text-zinc-500">
                Budget ranges
                <input
                  value={formatList(profileDraft.investment_budget_ranges)}
                  onChange={(event) =>
                    setProfileDraft((current) => ({
                      ...current,
                      investment_budget_ranges: parseList(event.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
                  placeholder="$10k-$50k, $1M+"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-zinc-500">
                  Language
                  <input
                    value={profileDraft.preferred_language}
                    onChange={(event) =>
                      setProfileDraft((current) => ({
                        ...current,
                        preferred_language: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
                    placeholder="English"
                  />
                </label>

                <label className="block text-xs text-zinc-500">
                  Risk
                  <input
                    value={profileDraft.risk_tolerance}
                    onChange={(event) =>
                      setProfileDraft((current) => ({
                        ...current,
                        risk_tolerance: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
                    placeholder="Medium"
                  />
                </label>
              </div>

              <label className="block text-xs text-zinc-500">
                Experience
                <input
                  value={profileDraft.experience_level}
                  onChange={(event) =>
                    setProfileDraft((current) => ({
                      ...current,
                      experience_level: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
                  placeholder="Beginner, founder, operator..."
                />
              </label>

              <label className="block text-xs text-zinc-500">
                Available time
                <input
                  value={profileDraft.available_time}
                  onChange={(event) =>
                    setProfileDraft((current) => ({
                      ...current,
                      available_time: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
                  placeholder="10 hours/week, part-time..."
                />
              </label>

              <label className="block text-xs text-zinc-500">
                Business interests
                <input
                  value={formatList(profileDraft.business_interests)}
                  onChange={(event) =>
                    setProfileDraft((current) => ({
                      ...current,
                      business_interests: parseList(event.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
                  placeholder="SaaS, franchises, e-commerce"
                />
              </label>

              <label className="block text-xs text-zinc-500">
                Long-term goals
                <input
                  value={formatList(profileDraft.long_term_goals)}
                  onChange={(event) =>
                    setProfileDraft((current) => ({
                      ...current,
                      long_term_goals: parseList(event.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
                  placeholder="Cash flow, exit, passive income"
                />
              </label>

              {profileMessage ? (
                <p className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs leading-5 text-zinc-300">
                  {profileMessage}
                </p>
              ) : null}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void saveProfile()}
                  disabled={profileSaving}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-200 px-3 py-2 text-xs font-semibold text-black transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {profileSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => void clearProfile()}
                  disabled={profileSaving || !hasProfileContent(profile)}
                  className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
          <p className="text-xs font-medium text-white">Signed in</p>
          <p className="mt-1 truncate text-xs text-zinc-500">
            {userEmail || "Authenticated user"}
          </p>
        </div>
      </aside>

      {sidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar overlay"
        />
      ) : null}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/80 px-4 py-4 backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-xl border border-white/10 p-2 text-zinc-200 md:hidden"
              aria-label="Open sidebar"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
              <Bot className="h-5 w-5 text-teal-100" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {activeConversation?.title || "AI Chat"}
              </p>
              <p className="text-xs text-zinc-500">
                AI Chat · {activeModel?.label || "Fast"} model · Streaming enabled
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
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Regenerate response"
            >
              <RefreshCcw className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          <div className="mx-auto flex max-w-5xl flex-col gap-5 pb-44">
            {conversationError ? (
              <div className="rounded-3xl border border-red-300/20 bg-red-950/30 p-4 text-sm leading-6 text-red-100 shadow-2xl shadow-black/30">
                <p className="font-semibold text-red-50">Chat persistence warning</p>
                <p className="mt-1 break-words text-red-100/80">{conversationError}</p>
              </div>
            ) : null}

            {messages.length === 0 ? (
              <div className="flex min-h-[52vh] items-center justify-center text-center">
                <div className="w-full max-w-4xl rounded-[2rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/40 backdrop-blur-2xl sm:p-8">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl border border-teal-200/20 bg-teal-200/10 shadow-2xl shadow-teal-950/20">
                    <Sparkles className="h-6 w-6 text-teal-200" />
                  </div>
                  <h1 className="mt-6 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                    Chat with ZERINIX AI.
                  </h1>
                  <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
                    Ask questions, upload context, edit messages, regenerate answers, and keep a persistent conversation history.
                  </p>
                  <div className="mt-6 grid gap-3 text-left md:grid-cols-2">
                    {promptStarters.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => setPrompt(starter)}
                        className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm leading-6 text-zinc-300 transition hover:border-teal-200/30 hover:bg-teal-200/[0.06] hover:text-white"
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
                />
              ))
            )}
          </div>
        </div>

        <div className="border-t border-white/10 bg-black/80 px-4 py-4 backdrop-blur-2xl sm:px-6">
          <div className="mx-auto max-w-5xl">
            {attachments.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300"
                  >
                    <Paperclip className="h-3.5 w-3.5 text-teal-200" />
                    {attachment.name}
                    <span className="text-zinc-600">{formatFileSize(attachment.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.id)}
                      className="rounded-full p-0.5 transition hover:bg-white/10"
                      aria-label="Remove attachment"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-3 shadow-2xl shadow-black/50 backdrop-blur-2xl">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2 pt-1">
                <span className="rounded-full border border-teal-200/20 bg-teal-200/10 px-3 py-1 text-xs font-medium text-teal-100">
                  AI Chat
                </span>
                <span className="text-xs text-zinc-600">
                  Markdown, code blocks, tables, file context and persistent memory.
                </span>
              </div>
              <textarea
                ref={composerRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                className="min-h-28 w-full resize-none rounded-2xl bg-black/30 p-3 text-base leading-7 text-white outline-none ring-1 ring-white/5 transition placeholder:text-zinc-600 focus:ring-teal-200/25"
                placeholder="Ask ZERINIX anything, paste context, or upload a file..."
              />

              <div className="flex flex-col gap-3 pt-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10">
                    <Paperclip className="h-4 w-4 text-teal-200" />
                    Upload files
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => void handleFiles(event.target.files)}
                    />
                  </label>
                  <select
                    value={modelPreference}
                    onChange={(event) =>
                      setModelPreference(event.target.value as ChatModelPreference)
                    }
                    className="rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-sm font-medium text-zinc-200 outline-none transition hover:bg-white/10"
                    aria-label="Select chat model"
                  >
                    {modelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  {loading ? (
                    <button
                      type="button"
                      onClick={stopGeneration}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-300/20 bg-red-400/10 px-5 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-400/15"
                    >
                      <Square className="h-4 w-4" />
                      Stop
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={!prompt.trim() || loading}
                    onClick={() => void sendMessage()}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-teal-300 px-5 py-3 text-sm font-semibold text-black shadow-lg shadow-teal-950/40 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? "Streaming..." : "Send"}
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-center text-xs text-zinc-600">
              <span className="inline-flex items-center gap-1">
                <CornerDownLeft className="h-3.5 w-3.5" />
                Cmd/Ctrl + Enter to send
              </span>
              <span className="inline-flex items-center gap-1">
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
