"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

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
      className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-zinc-400 transition duration-200 hover:-translate-y-0.5 hover:border-teal-200/30 hover:bg-teal-200/10 hover:text-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-200/30"
      aria-label={label}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
