"use client";

// Extracted verbatim from components/Planner.tsx as an incremental
// modularization step: the chat message rendering workspace --
// ChatMessages (the list wrapper) and its only child,
// ChatMessageBubble (an individual message bubble, memo-wrapped with
// the custom comparator areChatMessagesEqual). ChatMessageBubble's
// three useState calls are local UI-only state (edit mode, edit
// draft, copy-confirmation) that never reach into Planner's own
// component state -- only the 4 callback/data props passed in
// (message, onEdit, onSaveEdit, onRegenerate). ChatMessageBubble's one
// and only call site already lived inside ChatMessages in Planner.tsx,
// so it stays private here too. getReportCompletionHeadline is also
// exported -- Planner.tsx's own mobile message renderer needs the
// identical "completed report message shows only its title line" logic
// (see its own doc comment below) and this is its single source.

import { memo, useState } from "react";
import {
  Bot,
  Clipboard,
  ClipboardCheck,
  Edit3,
  Loader2,
  Paperclip,
  RefreshCcw,
  User,
} from "lucide-react";
import { MarkdownRenderer } from "@/components/planner/MarkdownRenderer";
import type { ChatMessage } from "@/components/Planner";

// CRITICAL FIX -- confirmed live: a completed Market Intelligence report's
// assistant message content is getReportMarkdown's full dump -- "##
// {Title}\n\n### {Section}\n{full section text}" repeated for every field,
// including TAM / SAM / SOM and Porter's Five Forces -- rendered here in
// full, in the same conversation view as the premium ReportPanel that
// presents the exact same data as structured cards immediately below.
// That produced two full, independent copies of the entire report on one
// page: the polished premium cards, and a second long-form plain-text
// version underneath, section headings and all. The underlying message
// content is never touched -- editing/copying/regenerate still operate on
// the complete real markdown (needed so the chat retains full context for
// follow-up turns and so "Continue Analysis" round-trips work), and
// nothing here changes what page.tsx's persisted dashboard view renders
// (it never reads chat messages at all). Only the INLINE render for this
// one message shape changes: a completed report-generation message shows
// just its own title line -- the premium cards below are the sole
// authoritative presentation of everything past that line.
export function getReportCompletionHeadline(content: string) {
  const titleLine = (content || "").split("\n").find((line) => line.trim());

  return titleLine && /^\s*#{1,2}\s+\S/.test(titleLine) ? titleLine : content;
}

const ChatMessageBubble = memo(function ChatMessageBubble({
  message,
  onEdit,
  onSaveEdit,
  onRegenerate,
}: {
  message: ChatMessage;
  onEdit: (message: ChatMessage) => void;
  onSaveEdit: (messageId: string, content: string) => void;
  onRegenerate: () => void;
}) {
  const isUser = message.role === "user";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);
  // Market Intelligence only, per this ticket's scope -- Business Plan/
  // Acquisition/Real Estate/domain reports (all mode === "plan") keep
  // their existing chat-message presentation completely unchanged.
  const isCompletedMarketReportMessage =
    !isUser && message.mode === "market" && message.status === "complete";
  const displayContent = isCompletedMarketReportMessage
    ? getReportCompletionHeadline(message.content)
    : message.content;

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
      <div
        className={`w-full min-w-0 max-w-3xl rounded-3xl border p-5 shadow-xl shadow-black/20 transition ${
          isUser
            ? "border-teal-300/20 bg-teal-300/10"
            : "border-white/10 bg-zinc-950/80"
        }`}
        style={{ contain: message.status === "streaming" ? "layout paint" : undefined }}
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="text-xs font-semibold tracking-[0.2em] text-zinc-500">
            {isUser ? "YOU" : "ZERINIX"}
          </p>
          <div className="flex items-center gap-2">
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
                  onEdit(message);
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
        ) : (
          <div className={message.status === "streaming" ? "min-h-28" : undefined}>
            <MarkdownRenderer
              content={displayContent}
              streaming={message.status === "streaming"}
            />
          </div>
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
      </div>
      {isUser ? (
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]">
          <User className="h-5 w-5 text-zinc-100" />
        </div>
      ) : null}
    </div>
  );
}, areChatMessagesEqual);

function areChatMessagesEqual(
  previous: {
    message: ChatMessage;
  },
  next: {
    message: ChatMessage;
  }
) {
  const previousMessage = previous.message;
  const nextMessage = next.message;

  return (
    previousMessage.id === nextMessage.id &&
    previousMessage.content === nextMessage.content &&
    previousMessage.status === nextMessage.status &&
    previousMessage.role === nextMessage.role &&
    previousMessage.mode === nextMessage.mode &&
    previousMessage.attachments === nextMessage.attachments
  );
}

export function ChatMessages({
  messages,
  onEdit,
  onSaveEdit,
  onRegenerate,
}: {
  messages: ChatMessage[];
  onEdit: (message: ChatMessage) => void;
  onSaveEdit: (messageId: string, content: string) => void;
  onRegenerate: () => void;
}) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <section className="min-h-[54vh] rounded-[2rem] border border-white/10 bg-white/[0.045] p-4 shadow-2xl shadow-black/35 ring-1 ring-white/[0.035] backdrop-blur-2xl transition-all duration-200 ease-out sm:p-6">
      <div className="space-y-6">
        {messages.map((message) => (
          <ChatMessageBubble
            key={message.id}
            message={message}
            onEdit={onEdit}
            onSaveEdit={onSaveEdit}
            onRegenerate={onRegenerate}
          />
        ))}
      </div>
    </section>
  );
}
