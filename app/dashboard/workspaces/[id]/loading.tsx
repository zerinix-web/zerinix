export default function WorkspaceReportsLoading() {
  return (
    <>
      <main className="relative min-h-screen overflow-hidden bg-black px-4 pb-[calc(8.75rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] text-white lg:hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_92%_0%,rgba(45,212,191,0.12),transparent_30%)]" />
        <div className="relative mx-auto max-w-xl">
          <div className="h-11 w-32 animate-pulse rounded-2xl border border-white/10 bg-white/[0.05]" />
          <div className="mt-7 h-3 w-24 animate-pulse rounded-full bg-teal-200/10" />
          <div className="mt-4 h-10 w-56 animate-pulse rounded-xl bg-white/10" />
          <div className="mt-3 h-5 w-80 max-w-full animate-pulse rounded-full bg-white/[0.07]" />
          <div className="mt-4 h-8 w-32 animate-pulse rounded-full bg-white/[0.06]" />

          <div className="mt-8 h-3 w-40 animate-pulse rounded-full bg-white/[0.07]" />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="h-32 animate-pulse rounded-[1.35rem] border border-white/10 bg-white/[0.045]" />
            <div className="h-32 animate-pulse rounded-[1.35rem] border border-white/10 bg-white/[0.045]" />
          </div>
          <div className="mt-3 h-12 animate-pulse rounded-2xl bg-white/10" />

          {["reports", "conversations"].map((section) => (
            <div key={section} className="mt-8">
              <div className="h-3 w-32 animate-pulse rounded-full bg-white/[0.07]" />
              <div className="mt-3 overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.04]">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`${section}-${index}`}
                    className="flex h-20 items-center gap-3 border-b border-white/[0.07] px-4 last:border-b-0"
                  >
                    <div className="h-10 w-10 animate-pulse rounded-xl bg-white/[0.07]" />
                    <div className="flex-1">
                      <div className="h-4 w-3/5 animate-pulse rounded-full bg-white/10" />
                      <div className="mt-2 h-3 w-2/5 animate-pulse rounded-full bg-white/[0.06]" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>

      <div className="hidden lg:block">
        <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <aside className="hidden w-72 border-r border-white/10 bg-zinc-950/80 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl lg:block">
          <div className="h-10 w-36 animate-pulse rounded-full border border-white/10 bg-white/10 shadow-xl shadow-black/20" />
          <div className="mt-8 space-y-3">
            {Array.from({ length: 7 }).map((_, index) => (
              <div
                key={`workspace-sidebar-skeleton-${index}`}
                className="h-11 animate-pulse rounded-2xl border border-white/10 bg-white/[0.06] shadow-lg shadow-black/10"
              />
            ))}
          </div>
        </aside>

        <section className="flex-1 px-4 py-5 sm:px-8 lg:px-10 lg:py-9">
          <div className="rounded-[2.25rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/35 ring-1 ring-white/[0.025] backdrop-blur-2xl sm:p-8 lg:p-10">
            <div className="h-10 w-44 animate-pulse rounded-2xl border border-white/10 bg-white/10" />
            <div className="mt-8 h-12 max-w-lg animate-pulse rounded-2xl border border-white/10 bg-white/10" />
            <div className="mt-4 h-5 max-w-2xl animate-pulse rounded-xl bg-white/[0.07]" />
            <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`workspace-stat-skeleton-${index}`}
                  className="h-28 animate-pulse rounded-2xl border border-white/10 bg-black/25 shadow-inner shadow-black/20 ring-1 ring-white/[0.015]"
                />
              ))}
            </div>
          </div>

          <div className="mt-8 rounded-[2.05rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/35 ring-1 ring-white/[0.025] backdrop-blur-xl">
            <div className="h-14 animate-pulse rounded-[1.35rem] border border-white/10 bg-black/35" />
            <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={`workspace-report-skeleton-${index}`}
                  className="h-[22rem] animate-pulse rounded-[1.75rem] border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/25 ring-1 ring-white/[0.02]"
                />
              ))}
            </div>
          </div>
        </section>
      </div>
        </main>
      </div>
    </>
  );
}
