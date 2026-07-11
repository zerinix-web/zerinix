"use client";

import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function RouteErrorState({
  title = "Something went wrong.",
  description = "ZERINIX could not load this workspace view. Try again, or return to the dashboard.",
  reset,
}: {
  title?: string;
  description?: string;
  reset: () => void;
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.15),transparent_30%),radial-gradient(circle_at_18%_18%,rgba(255,255,255,0.06),transparent_28%)]" />
      <section className="relative z-10 flex min-h-screen items-center justify-center px-5 py-12">
        <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 text-center shadow-2xl shadow-black/35 backdrop-blur-2xl sm:p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-300/10">
            <AlertTriangle className="h-6 w-6 text-amber-200" />
          </div>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-teal-100/70">
            ZERINIX
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            {title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">{description}</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black transition hover:-translate-y-0.5 hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/40"
            >
              <RotateCcw className="h-4 w-4" />
              Try again
            </button>
            <Link
              href="/dashboard"
              className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
