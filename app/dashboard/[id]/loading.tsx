export default function ReportLoading() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.14),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.06),transparent_28%)]" />
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="relative z-10 hidden w-72 border-r border-white/10 bg-zinc-950/80 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl lg:block">
          <div className="h-10 w-36 animate-pulse rounded-full border border-white/10 bg-white/10 shadow-xl shadow-black/20" />
          <div className="mt-8 space-y-3">
            {Array.from({ length: 7 }).map((_, index) => (
              <div
                key={`sidebar-skeleton-${index}`}
                className="h-11 animate-pulse rounded-2xl border border-white/10 bg-white/[0.06] shadow-lg shadow-black/10"
              />
            ))}
          </div>
        </aside>

        <section className="relative z-10 flex-1 px-4 py-5 sm:px-8 lg:px-10 lg:py-8">
          <div className="rounded-[2.15rem] border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/35 ring-1 ring-white/[0.025] backdrop-blur-xl">
            <div className="h-10 w-40 animate-pulse rounded-full border border-white/10 bg-white/10" />
            <div className="mt-8 h-12 max-w-3xl animate-pulse rounded-2xl border border-white/10 bg-white/10" />
            <div className="mt-4 h-6 max-w-xl animate-pulse rounded-xl border border-white/10 bg-white/[0.07]" />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`metric-skeleton-${index}`}
                className="h-32 min-h-[8.5rem] animate-pulse rounded-[1.5rem] border border-white/10 bg-white/[0.04] shadow-xl shadow-black/20 ring-1 ring-white/[0.02]"
              />
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="hidden h-80 animate-pulse rounded-[1.55rem] border border-white/10 bg-white/[0.035] shadow-xl shadow-black/20 ring-1 ring-white/[0.02] lg:block" />
            <div className="space-y-6">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`report-section-skeleton-${index}`}
                  className="rounded-[1.85rem] border border-white/10 bg-white/[0.035] p-6 shadow-2xl shadow-black/25 ring-1 ring-white/[0.02]"
                >
                  <div className="h-6 w-44 animate-pulse rounded-xl border border-white/10 bg-white/10" />
                  <div className="mt-6 space-y-3">
                    <div className="h-4 animate-pulse rounded bg-white/[0.07]" />
                    <div className="h-4 w-11/12 animate-pulse rounded bg-white/[0.07]" />
                    <div className="h-4 w-4/5 animate-pulse rounded bg-white/[0.07]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
