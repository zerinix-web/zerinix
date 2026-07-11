"use client";

import { useActionState } from "react";
import { Bot, Send } from "lucide-react";
import { askAiCeo, type AiCeoActionState } from "../actions";

const suggestedPrompts = [
  "Today’s summary",
  "Cost review",
  "User growth",
  "Recent failures",
  "Report activity",
  "Security review",
];

const initialState: AiCeoActionState = {};

export function AiCeoConsole() {
  const [state, formAction, pending] = useActionState(askAiCeo, initialState);

  return (
    <div className="mt-6 grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
            <Bot className="h-5 w-5 text-teal-200" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-white">Ask AI CEO</h2>
            <p className="text-sm text-zinc-500">Grounded in approved admin aggregates only.</p>
          </div>
        </div>

        <form action={formAction} className="mt-5 space-y-4">
          <label className="block">
            <span className="sr-only">Admin question</span>
            <textarea
              name="prompt"
              rows={5}
              placeholder="Ask what changed today, where costs are rising, or what needs review first..."
              className="w-full resize-none rounded-3xl border border-white/10 bg-black/35 p-4 text-sm leading-6 text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300/35 focus:ring-2 focus:ring-teal-300/10"
            />
          </label>
          {state.error ? (
            <p className="rounded-2xl border border-red-300/20 bg-red-950/20 p-3 text-sm text-red-100">
              {state.error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {pending ? "Analyzing..." : "Ask AI CEO"}
          </button>
        </form>

        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Suggested prompts
          </p>
          <div className="mt-3 grid gap-2">
            {suggestedPrompts.map((prompt) => (
              <form key={prompt} action={formAction}>
                <input type="hidden" name="suggestion" value={prompt} />
                <button
                  type="submit"
                  disabled={pending}
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-left text-sm text-zinc-300 transition hover:border-teal-300/30 hover:text-white disabled:opacity-60"
                >
                  {prompt}
                </button>
              </form>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
        <h2 className="text-lg font-semibold text-white">Executive answer</h2>
        {state.answer ? (
          <div className="mt-5 whitespace-pre-wrap rounded-3xl border border-white/10 bg-black/25 p-5 text-sm leading-7 text-zinc-300">
            {state.answer}
          </div>
        ) : (
          <div className="mt-5 rounded-3xl border border-white/10 bg-black/25 p-6 text-sm leading-6 text-zinc-500">
            Ask a question to receive a grounded operational memo. AI CEO cannot run SQL,
            access arbitrary tables, or use unapproved user content as instructions.
          </div>
        )}
      </div>
    </div>
  );
}
