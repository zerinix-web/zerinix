import { Folder } from "lucide-react";
import DashboardLoading from "../loading";

function WorkspaceSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl border border-white/10 bg-white/[0.055] shadow-xl shadow-black/20 ring-1 ring-white/[0.02] ${className}`}
    />
  );
}

export default function WorkspacesLoading() {
  return (
    <>
      <main className="relative min-h-screen overflow-hidden bg-black px-4 pb-[calc(8.75rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] text-white lg:hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_92%_0%,rgba(45,212,191,0.12),transparent_30%)]" />
        <div className="relative mx-auto max-w-xl">
          <div className="flex items-center gap-3 border-b border-white/10 pb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-xs font-black tracking-wider text-black">
              ZX
            </div>
            <div>
              <WorkspaceSkeleton className="h-3 w-20 rounded-full" />
              <WorkspaceSkeleton className="mt-2 h-2.5 w-28 rounded-full" />
            </div>
          </div>

          <div className="mt-7 flex items-center gap-2 text-teal-200/70">
            <Folder className="h-4 w-4" />
            <WorkspaceSkeleton className="h-3 w-28 rounded-full" />
          </div>
          <WorkspaceSkeleton className="mt-4 h-10 w-44" />
          <WorkspaceSkeleton className="mt-3 h-5 w-80 max-w-full" />
          <WorkspaceSkeleton className="mt-5 h-8 w-28 rounded-full" />

          <WorkspaceSkeleton className="mt-8 h-3 w-28 rounded-full" />
          <div className="mt-4 space-y-3">
            {["one", "two", "three", "four"].map((item) => (
              <div
                key={item}
                className="rounded-[1.6rem] border border-white/10 bg-white/[0.045] p-5"
              >
                <div className="flex gap-4">
                  <WorkspaceSkeleton className="h-12 w-12 shrink-0" />
                  <div className="flex-1">
                    <WorkspaceSkeleton className="h-5 w-3/5" />
                    <WorkspaceSkeleton className="mt-3 h-3 w-24 rounded-full" />
                  </div>
                </div>
                <WorkspaceSkeleton className="mt-5 h-11 w-full" />
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
