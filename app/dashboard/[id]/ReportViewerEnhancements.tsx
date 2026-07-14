"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, Share2 } from "lucide-react";

export function ReportScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frameId = 0;

    const updateProgress = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const scrollableHeight =
          document.documentElement.scrollHeight - window.innerHeight;
        const nextProgress =
          scrollableHeight > 0
            ? Math.min(100, Math.max(0, (window.scrollY / scrollableHeight) * 100))
            : 0;

        setProgress(nextProgress);
      });
    };

    updateProgress();
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
    };
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 z-50 h-1 bg-white/5">
      <div
        className="h-full bg-gradient-to-r from-teal-300 via-cyan-200 to-white transition-[width] duration-150 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

export function CopySectionButton({
  content,
  label = "Copy section",
}: {
  content: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyContent() {
    if (!content.trim()) {
      return;
    }

    await navigator.clipboard.writeText(content.trim());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copyContent}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3.5 py-2 text-xs font-semibold text-zinc-300 shadow-lg shadow-black/10 ring-1 ring-white/[0.02] transition duration-300 hover:-translate-y-0.5 hover:border-teal-200/30 hover:bg-teal-200/10 hover:text-teal-100 hover:shadow-teal-950/10 focus:outline-none focus:ring-2 focus:ring-teal-200/30"
      aria-label={label}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function ShareReportButton({ title }: { title: string }) {
  const [shared, setShared] = useState(false);

  async function shareReport() {
    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text: "ZERINIX decision intelligence report",
          url,
        });
        setShared(true);
        window.setTimeout(() => setShared(false), 1600);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    await navigator.clipboard.writeText(url);
    setShared(true);
    window.setTimeout(() => setShared(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={shareReport}
      className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-white/10 bg-white/[0.045] px-5 py-3 text-sm font-semibold text-zinc-200 shadow-xl shadow-black/15 ring-1 ring-white/[0.02] transition duration-300 hover:-translate-y-0.5 hover:border-teal-200/30 hover:bg-teal-200/10 hover:text-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
      aria-label="Share report"
    >
      {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
      {shared ? "Link copied" : "Share Report"}
    </button>
  );
}

export function MobileReportSection({
  title,
  eyebrow,
  children,
  defaultOpen = false,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <article className="overflow-hidden rounded-[1.55rem] border border-white/10 bg-white/[0.045] shadow-xl shadow-black/25 ring-1 ring-white/[0.025]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-16 w-full items-center justify-between gap-4 p-4 text-left transition duration-300 hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-200/30"
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-200/70">
            {eyebrow}
          </span>
          <span className="mt-1 block text-base font-semibold leading-6 text-white">
            {title}
          </span>
        </span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/25">
          <ChevronDown
            className={`h-4 w-4 text-teal-200 transition duration-300 ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>
      {open ? (
        <div className="border-t border-white/10 p-4">
          {children}
        </div>
      ) : null}
    </article>
  );
}
