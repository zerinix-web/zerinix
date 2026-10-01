import { FileText, Search } from "lucide-react";
import type { CSSProperties } from "react";
import DashboardLoading from "../loading";

function MobileSkeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`animate-pulse rounded-2xl border border-white/10 bg-white/[0.055] shadow-xl shadow-black/20 ring-1 ring-white/[0.02] ${className}`}
    />
  );
}

export default function ReportsLoading() {
  return (
    <>
      <main className="relative min-h-screen overflow-hidden bg-black px-4 pb-[calc(8.5rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] text-white lg:hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_90%_0%,rgba(45,212,191,0.11),transparent_30%)]" />
        <div className="relative mx-auto max-w-xl">
          <div className="flex items-center gap-3 border-b border-white/10 pb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-xs font-black tracking-wider text-black">
              ZX
            </div>
            <div>
              <p className="text-sm font-bold tracking-[0.14em]">ZERINIX</p>
              <p className="text-[11px] text-zinc-500">
                AI Business Assistant
              </p>
            </div>
          </div>

          <div className="mt-7 flex items-center gap-2 text-teal-200/70">
            <FileText className="h-4 w-4" />
            <MobileSkeleton className="h-3 w-32 rounded-full" />
          </div>
          <MobileSkeleton className="mt-4 h-10 w-36" />
          <MobileSkeleton className="mt-3 h-5 w-72 max-w-full" />

          <div className="relative mt-7">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
            <MobileSkeleton className="h-13 w-full" />
          </div>
          <div className="mt-4 flex gap-2 overflow-hidden">
            {[72, 116, 126, 124].map((width) => (
              <MobileSkeleton
                key={width}
                className="h-11 shrink-0 rounded-full"
                style={{ width }}
              />
            ))}
          </div>

          <MobileSkeleton className="mt-7 h-3 w-20 rounded-full" />
          <div className="mt-4 space-y-3">
            {["first", "second", "third"].map((item) => (
              <div
                key={item}
                className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5"
              >
                <div className="flex gap-4">
                  <MobileSkeleton className="h-12 w-12 shrink-0" />
                  <div className="flex-1">
                    <MobileSkeleton className="h-3 w-28 rounded-full" />
                    <MobileSkeleton className="mt-3 h-5 w-4/5" />
                  </div>
                </div>
                <MobileSkeleton className="mt-5 h-4 w-full" />
                <MobileSkeleton className="mt-2 h-4 w-5/6" />
                <MobileSkeleton className="mt-5 h-10 w-full" />
              </div>
            ))}
          </div>
        </div>
      </main>

      <div className="hidden lg:block">
        <DashboardLoading />
      </div>
    </>
  );
}
