"use client";

import {
  Bot,
  FileText,
  History,
  Loader2,
  MessageSquarePlus,
  Send,
  User,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export type MobileConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "streaming" | "complete" | "failed";
};

export type MobileConversationSummary = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
};

type MobileConversationExperienceProps = {
  activeConversationId: string;
  conversationTitle: string;
  conversations: MobileConversationSummary[];
  messages: MobileConversationMessage[];
  prompt: string;
  suggestions: string[];
  chatLoading: boolean;
  isWorking: boolean;
  canGenerateReport: boolean;
  reportContent?: ReactNode;
  reportUpdateKey: string;
  conversationError?: string;
  onPromptChange: (value: string) => void;
  onSuggestionClick: (value: string) => void;
  onSubmit: () => void;
  onGenerateReport: () => void;
  onCreateConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
  renderMessageContent: (message: MobileConversationMessage) => ReactNode;
};

export function MobileConversationExperience({
  activeConversationId,
  conversationTitle,
  conversations,
  messages,
  prompt,
  suggestions,
  chatLoading,
  isWorking,
  canGenerateReport,
  reportContent,
  reportUpdateKey,
  conversationError,
  onPromptChange,
  onSuggestionClick,
  onSubmit,
  onGenerateReport,
  onCreateConversation,
  onSelectConversation,
  renderMessageContent,
}: MobileConversationExperienceProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

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

    if (prompt.trim() && !isWorking) {
      onSubmit();
    }
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
          <h1 className="truncate text-sm font-semibold text-white">
            {conversationTitle}
          </h1>
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
                How can I help?
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">
                Explore a business idea, validate a market, or work through a strategic
                decision. Generate a professional report whenever you are ready.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => onSuggestionClick(suggestion)}
                    className="rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-3 text-left text-xs font-medium leading-5 text-zinc-300 transition active:bg-white/[0.08]"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
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

          {reportContent ? <div className="mt-6">{reportContent}</div> : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-white/10 bg-black/90 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-[1.6rem] border border-white/10 bg-white/[0.065] p-2 pl-4 shadow-2xl shadow-black/40 focus-within:border-teal-200/30">
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            rows={1}
            aria-label="Message ZERINIX AI"
            placeholder="Message ZERINIX AI"
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 text-white outline-none placeholder:text-zinc-600"
          />
          <button
            type="button"
            onClick={onSubmit}
            disabled={!prompt.trim() || isWorking}
            aria-label={chatLoading ? "ZERINIX is responding" : "Send message"}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition active:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-600"
          >
            {chatLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
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
}
