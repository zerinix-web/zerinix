"use client";

import { FileText, Loader2, MessageSquare } from "lucide-react";

export type RecommendationAction =
  | "generate_strategic_report"
  | "continue_as_chat";

export function RecommendationActions({
  isWorking,
  primaryDisabled = false,
  primaryLabel = "Generate Strategic Report",
  secondaryLabel = "Continue as Chat",
  onAction,
}: {
  isWorking: boolean;
  primaryDisabled?: boolean;
  primaryLabel?: string;
  secondaryLabel?: string;
  onAction: (action: RecommendationAction) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1.35fr_0.65fr]">
      <button
        type="button"
        data-recommendation-action="generate_strategic_report"
        onClick={() => onAction("generate_strategic_report")}
        disabled={isWorking || primaryDisabled}
        className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-teal-200 px-5 text-sm font-semibold text-black shadow-xl shadow-teal-950/35 transition hover:-translate-y-0.5 hover:bg-teal-100 hover:shadow-2xl hover:shadow-teal-950/45 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
      >
        {isWorking ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FileText className="h-4 w-4" />
        )}
        {primaryLabel}
      </button>
      <button
        type="button"
        data-recommendation-action="continue_as_chat"
        onClick={() => onAction("continue_as_chat")}
        disabled={isWorking}
        className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-white/[0.045] px-4 text-sm font-medium text-zinc-200 transition hover:-translate-y-0.5 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
      >
        <MessageSquare className="h-4 w-4 text-teal-200" />
        {secondaryLabel}
      </button>
    </div>
  );
}
