"use client";

import { ChevronDown } from "lucide-react";

export function RecommendationReason({ reason }: { reason: string }) {
  return (
    <details className="group rounded-2xl bg-black/20 px-4 py-3.5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-zinc-300 marker:content-none">
        Why this recommendation?
        <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition group-open:rotate-180" />
      </summary>
      <p className="mt-3 pt-1 text-sm leading-6 text-zinc-500">
        {reason}
      </p>
    </details>
  );
}
