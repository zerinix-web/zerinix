import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export function UnderstandingCard({
  children,
  intent,
  confidence,
}: {
  children: ReactNode;
  intent: string;
  confidence: number;
}) {
  return (
    <section
      aria-live="polite"
      className="overflow-hidden rounded-[2rem] bg-white/[0.045] shadow-2xl shadow-black/35 transition-all duration-500 ease-out"
    >
      <div className="p-5 backdrop-blur-2xl sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-200/70">
              <Sparkles className="h-3.5 w-3.5" />
              ZERINIX understood
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-white">
              {intent}
            </h2>
          </div>
          <div className="flex items-center gap-2 self-start pt-1 text-zinc-500">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em]">
              Confidence
            </span>
            <span className="text-xs font-semibold text-zinc-300">{confidence}%</span>
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}

export function UnderstandingLoadingState() {
  return (
    <section
      aria-live="polite"
      aria-busy="true"
      className="rounded-[2rem] bg-white/[0.035] px-5 py-6 shadow-xl shadow-black/25 transition-all duration-300 sm:px-7"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-200/10">
          <Sparkles className="h-4 w-4 animate-pulse text-teal-200" />
        </span>
        <div>
          <p className="text-sm font-medium text-zinc-200">
            ZERINIX is understanding your request...
          </p>
          <div className="mt-2 h-1 w-36 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-teal-200/55" />
          </div>
        </div>
      </div>
    </section>
  );
}
