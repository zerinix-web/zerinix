export default function ReportLoading() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="hidden w-72 border-r border-white/10 bg-zinc-950/80 p-5 lg:block">
          <div className="h-10 w-36 animate-pulse rounded-full bg-white/10" />
          <div className="mt-8 space-y-3">
            {Array.from({ length: 7 }).map((_, index) => (
              <div
                key={`sidebar-skeleton-${index}`}
                className="h-11 animate-pulse rounded-2xl bg-white/[0.06]"
              />
            ))}
          </div>
        </aside>

        <section className="flex-1 px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.035] p-6 shadow-2xl shadow-black/30">
            <div className="h-10 w-40 animate-pulse rounded-full bg-white/10" />
            <div className="mt-8 h-12 max-w-3xl animate-pulse rounded-2xl bg-white/10" />
            <div className="mt-4 h-6 max-w-xl animate-pulse rounded-xl bg-white/[0.07]" />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`metric-skeleton-${index}`}
                className="h-28 animate-pulse rounded-[1.5rem] border border-white/10 bg-white/[0.04]"
              />
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="hidden h-80 animate-pulse rounded-[1.5rem] border border-white/10 bg-white/[0.035] lg:block" />
            <div className="space-y-5">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`report-section-skeleton-${index}`}
                  className="rounded-[1.75rem] border border-white/10 bg-white/[0.035] p-6"
                >
                  <div className="h-6 w-44 animate-pulse rounded-xl bg-white/10" />
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
