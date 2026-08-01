"use client";

import {
  Bot,
  Check,
  FileText,
  History,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Send,
  User,
  X,
} from "lucide-react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { getComposerSuggestions } from "./composer-suggestions";

export type MobileConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "streaming" | "complete" | "failed";
};

export type MobileComposerAttachment = {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
  status?: "processing" | "ready" | "error";
  progress?: number;
  error?: string;
};

export type MobileConversationSummary = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
};

export type MobileAnalysisMode = "plan" | "market" | "chat";

type MobileConversationExperienceProps = {
  activeConversationId: string;
  conversationTitle: string;
  conversations: MobileConversationSummary[];
  messages: MobileConversationMessage[];
  attachments: MobileComposerAttachment[];
  attachmentError?: string;
  draftSnapshotRef: { current: string };
  activeAnalysisMode: MobileAnalysisMode;
  analysisModeSelected: boolean;
  analysisActive: boolean;
  chatLoading: boolean;
  isWorking: boolean;
  canGenerateReport: boolean;
  reportContent?: ReactNode;
  recommendationContent?: ReactNode;
  reportUpdateKey: string;
  conversationError?: string;
  onFiles: (files: FileList | null, prompt: string) => void;
  onRemoveAttachment: (id: string) => void;
  onInvalidateAnalysis: () => void;
  onAnalyze: (prompt: string) => void;
  onSelectAnalysisMode: (mode: MobileAnalysisMode) => void;
  onGenerateReport: () => void;
  onCreateConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
  renderMessageContent: (message: MobileConversationMessage) => ReactNode;
};

export const MobileConversationExperience = memo(function MobileConversationExperience({
  activeConversationId,
  conversationTitle,
  conversations,
  messages,
  attachments,
  attachmentError,
  draftSnapshotRef,
  activeAnalysisMode,
  analysisModeSelected,
  analysisActive,
  chatLoading,
  isWorking,
  canGenerateReport,
  reportContent,
  recommendationContent,
  reportUpdateKey,
  conversationError,
  onFiles,
  onRemoveAttachment,
  onInvalidateAnalysis,
  onAnalyze,
  onSelectAnalysisMode,
  onGenerateReport,
  onCreateConversation,
  onSelectConversation,
  renderMessageContent,
}: MobileConversationExperienceProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const suggestions = useMemo(() => getComposerSuggestions(prompt), [prompt]);

  useEffect(() => {
    const scrollArea = scrollAreaRef.current;

    if (!scrollArea) {
      return;
    }

    scrollArea.scrollTo({
      top: scrollArea.scrollHeight,
      behavior: messages.length <= 2 ? "auto" : "smooth",
    });
  }, [messages, reportUpdateKey]);

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();

    if (
      analysisModeSelected &&
      (prompt.trim() || attachments.length > 0) &&
      !isWorking
    ) {
      onAnalyze(prompt);
    }
  }

  function updatePrompt(value: string) {
    setPrompt(value);
    draftSnapshotRef.current = value;

    if (analysisActive) {
      onInvalidateAnalysis();
    }
  }

  function applySuggestion(suggestion: string) {
    updatePrompt(`${prompt.trim()}\n\nFocus on: ${suggestion}`);
  }

  return (
    <section className="relative z-10 flex min-h-0 flex-1 flex-col bg-black md:hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-black/85 px-4 py-3 backdrop-blur-2xl">
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          aria-label="Open conversation history"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-zinc-300 transition active:bg-white/10"
        >
          <History className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-teal-200/70">
            ZERINIX AI
          </p>
          <h1 className="mt-0.5 truncate text-sm font-semibold text-white">
            {conversationTitle}
          </h1>
          <span className="mt-1 inline-block max-w-full truncate rounded-full border border-white/10 bg-white/[0.045] px-2 py-0.5 text-[9px] font-medium text-zinc-400">
            {analysisModeSelected
              ? activeAnalysisMode === "plan"
                ? "Business Idea Validation"
                : activeAnalysisMode === "market"
                  ? "Market Intelligence"
                  : "Strategic Advisory"
              : "Select analysis type"}
          </span>
        </div>

        <button
          type="button"
          onClick={onGenerateReport}
          disabled={!canGenerateReport || isWorking}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-teal-200 px-3.5 py-2 text-xs font-semibold text-black shadow-lg shadow-teal-950/30 transition active:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isWorking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileText className="h-3.5 w-3.5" />
          )}
          Report
        </button>
      </header>

      <div ref={scrollAreaRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-8 pt-5">
          {conversationError ? (
            <div className="mb-5 rounded-2xl border border-red-300/20 bg-red-950/30 p-4 text-sm leading-6 text-red-100">
              Conversation history could not be loaded or saved. Please try again shortly.
            </div>
          ) : null}

          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col justify-center pb-10">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
                <Bot className="h-6 w-6 text-teal-100" />
              </span>
              <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white">
                New analysis session
              </h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-zinc-500">
                Tell ZERINIX what you want to accomplish.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((message) => {
                const isUser = message.role === "user";

                return (
                  <article
                    key={message.id}
                    className={`flex items-start gap-3 ${isUser ? "justify-end" : ""}`}
                  >
                    {!isUser ? (
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-teal-200/20 bg-teal-200/10">
                        <Bot className="h-4 w-4 text-teal-100" />
                      </span>
                    ) : null}
                    <div
                      className={`min-w-0 text-sm leading-7 ${
                        isUser
                          ? "max-w-[84%] rounded-3xl bg-white/[0.09] px-4 py-2.5 text-zinc-100"
                          : "flex-1 py-1 text-zinc-200"
                      }`}
                    >
                      {message.status === "streaming" && !message.content ? (
                        <span className="inline-flex items-center gap-2 text-zinc-500">
                          <Loader2 className="h-4 w-4 animate-spin text-teal-200" />
                          Thinking
                        </span>
                      ) : (
                        renderMessageContent(message)
                      )}
                    </div>
                    {isUser ? (
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06]">
                        <User className="h-4 w-4 text-zinc-200" />
                      </span>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}

          {recommendationContent ? (
            <div className="mt-6">{recommendationContent}</div>
          ) : null}
          {reportContent ? <div className="mt-6">{reportContent}</div> : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-white/10 bg-black/90 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-2xl">
        <div className="mx-auto mb-2 grid max-w-3xl grid-cols-3 gap-1.5">
          {[
            ["plan", "Business Idea Validation"],
            ["market", "Market Intelligence"],
            ["chat", "Strategic Advisory"],
          ].map(([mode, label]) => {
            const selected =
              analysisModeSelected && activeAnalysisMode === mode;

            return (
              <button
                key={mode}
                type="button"
                onClick={() =>
                  onSelectAnalysisMode(mode as MobileAnalysisMode)
                }
                disabled={isWorking}
                aria-pressed={selected}
                className={`relative min-h-11 rounded-xl border px-1.5 py-1 text-[10px] font-semibold leading-4 transition ${
                  selected
                    ? "border-teal-200/60 bg-teal-200/12 text-teal-50 shadow-[0_0_18px_rgba(45,212,191,0.16)]"
                    : "border-white/[0.07] bg-white/[0.055] text-zinc-400 active:bg-white/10"
                } disabled:cursor-not-allowed disabled:opacity-45`}
              >
                {selected ? (
                  <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-teal-200 text-black">
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                ) : null}
                {label}
              </button>
            );
          })}
        </div>
        {suggestions.length > 0 ? (
          <div className="mx-auto mb-2 flex max-w-3xl gap-1.5 overflow-x-auto">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => applySuggestion(suggestion)}
                className="shrink-0 rounded-full bg-white/[0.055] px-3 py-1.5 text-xs font-medium text-zinc-300 transition active:bg-teal-200/10 active:text-teal-100"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="mx-auto mb-2 flex max-w-3xl gap-2 overflow-x-auto">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white/[0.07] py-1 pl-3 pr-1 text-xs text-zinc-300"
              >
                <Paperclip className="h-3 w-3 text-teal-200" />
                <span className="min-w-0">
                  <span className="block max-w-44 truncate">{attachment.name}</span>
                  <span className="block text-[9px] text-zinc-500">
                    {attachment.mimeType || "Unknown type"} ·{" "}
                    {attachment.size >= 1_000_000
                      ? `${(attachment.size / 1_000_000).toFixed(1)} MB`
                      : `${Math.max(1, Math.round(attachment.size / 1_000))} KB`}
                  </span>
                  {attachment.status === "processing" ? (
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10">
                      <span
                        className="block h-full bg-teal-300"
                        style={{ width: `${attachment.progress || 15}%` }}
                      />
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.name}`}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-500 active:bg-white/10"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {attachmentError ? (
          <p
            role="alert"
            className="mx-auto mb-2 max-w-3xl rounded-xl bg-red-300/10 px-3 py-2 text-xs text-red-200"
          >
            {attachmentError}
          </p>
        ) : null}
        <div className="mx-auto flex max-w-3xl items-end gap-1.5 rounded-[1.6rem] border border-white/10 bg-white/[0.065] p-2 pl-2 shadow-2xl shadow-black/40 focus-within:border-teal-200/30">
          <label className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-zinc-400 transition active:bg-white/10 active:text-white">
            <Paperclip className="h-4 w-4" />
            <span className="sr-only">Attach files</span>
            <input
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.tsv,.txt,.md,.json,.zip,.png,.jpg,.jpeg,.webp,.gif,.heic,.avif"
              className="sr-only"
              onChange={(event) => {
                onFiles(event.target.files, prompt);
                event.target.value = "";
              }}
            />
          </label>
          <textarea
            value={prompt}
            onChange={(event) => updatePrompt(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            rows={1}
            aria-label="Message ZERINIX AI"
            placeholder="Describe a business decision, opportunity or challenge…"
            className="max-h-36 min-h-12 flex-1 resize-none bg-transparent py-3 text-[15px] leading-6 text-white outline-none placeholder:text-zinc-600"
          />
          <button
            type="button"
            onClick={() => onAnalyze(prompt)}
            disabled={
              !analysisModeSelected ||
              (!prompt.trim() && attachments.length === 0) ||
              isWorking ||
              attachments.some((attachment) => attachment.status !== "ready")
            }
            aria-label={chatLoading ? "ZERINIX is sending" : "Send request"}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-black transition active:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-600"
          >
            {chatLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="hidden min-[390px]:inline">Send</span>
          </button>
        </div>
        {!analysisModeSelected ? (
          <p className="mt-2 text-center text-[11px] font-medium text-amber-200/80">
            Select an analysis type to continue.
          </p>
        ) : null}
        <p className="mt-2 text-center text-[10px] text-zinc-600">
          ZERINIX can make mistakes. Verify important decisions.
        </p>
      </div>

      {historyOpen ? (
        <div className="absolute inset-0 z-50 flex bg-black/70 backdrop-blur-sm">
          <aside className="flex h-full w-[86%] max-w-sm flex-col border-r border-white/10 bg-zinc-950 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-200/70">
                  Conversations
                </p>
                <p className="mt-1 text-sm text-zinc-500">Your recent history</p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close conversation history"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-zinc-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3">
              <button
                type="button"
                onClick={() => {
                  setHistoryOpen(false);
                  onCreateConversation();
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-teal-200/20 bg-teal-200/10 px-4 text-sm font-semibold text-teal-50"
              >
                <MessageSquarePlus className="h-4 w-4 text-teal-200" />
                New conversation
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-6">
              {conversations.map((conversation) => {
                const active = conversation.id === activeConversationId;

                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => {
                      setHistoryOpen(false);
                      onSelectConversation(conversation.id);
                    }}
                    className={`w-full rounded-2xl px-4 py-3 text-left transition ${
                      active ? "bg-white/[0.09]" : "active:bg-white/[0.05]"
                    }`}
                  >
                    <p className="truncate text-sm font-medium text-zinc-100">
                      {conversation.title}
                    </p>
                    <p className="mt-1 truncate text-xs text-zinc-600">
                      {conversation.preview || "Start a new conversation"}
                    </p>
                  </button>
                );
              })}
            </div>
          </aside>
          <button
            type="button"
            aria-label="Close conversation history"
            onClick={() => setHistoryOpen(false)}
            className="flex-1"
          />
        </div>
      ) : null}
    </section>
  );
});
