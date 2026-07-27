export default function SettingsLoading() {
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
              <div className="h-3 w-20 animate-pulse rounded-full bg-white/15" />
              <div className="mt-2 h-2.5 w-28 animate-pulse rounded-full bg-white/[0.07]" />
            </div>
          </div>

          <div className="mt-7 h-3 w-24 animate-pulse rounded-full bg-teal-200/10" />
          <div className="mt-4 h-10 w-36 animate-pulse rounded-xl bg-white/10" />

          <div className="mt-6 flex items-center gap-4 rounded-[1.75rem] border border-white/10 bg-white/[0.05] p-5">
            <div className="h-[4.25rem] w-[4.25rem] animate-pulse rounded-[1.4rem] bg-teal-200/10" />
            <div className="flex-1">
              <div className="h-5 w-36 animate-pulse rounded-full bg-white/10" />
              <div className="mt-3 h-3 w-48 max-w-full animate-pulse rounded-full bg-white/[0.07]" />
              <div className="mt-3 h-3 w-24 animate-pulse rounded-full bg-white/[0.06]" />
            </div>
          </div>

          <div className="mt-7 h-3 w-14 animate-pulse rounded-full bg-white/[0.07]" />
          <div className="mt-3 h-64 animate-pulse rounded-[1.6rem] border border-white/10 bg-white/[0.045]" />

          <div className="mt-7 h-3 w-16 animate-pulse rounded-full bg-white/[0.07]" />
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`mobile-account-usage-${index}`}
                className="h-32 animate-pulse rounded-[1.35rem] border border-white/10 bg-white/[0.045]"
              />
            ))}
          </div>

          {Array.from({ length: 2 }).map((_, index) => (
            <div key={`mobile-account-list-${index}`} className="mt-7">
              <div className="h-3 w-20 animate-pulse rounded-full bg-white/[0.07]" />
              <div className="mt-3 h-72 animate-pulse rounded-[1.6rem] border border-white/10 bg-white/[0.045]" />
            </div>
          ))}
        </div>
      </main>

      <div className="hidden lg:block">
        <main className="min-h-screen bg-black text-white">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="hidden w-72 border-r border-white/10 bg-zinc-950/80 p-5 lg:block">
          <div className="h-10 w-36 animate-pulse rounded-full bg-white/10" />
          <div className="mt-8 space-y-3">
            {Array.from({ length: 7 }).map((_, index) => (
              <div
                key={`settings-sidebar-skeleton-${index}`}
                className="h-11 animate-pulse rounded-2xl bg-white/[0.06]"
              />
            ))}
          </div>
        </aside>

        <section className="flex-1 px-5 py-6 sm:px-8 lg:px-10 lg:py-9">
          <div className="rounded-[2.35rem] border border-white/10 bg-white/[0.045] p-8 shadow-2xl shadow-black/35">
            <div className="h-9 w-32 animate-pulse rounded-full bg-teal-300/10" />
            <div className="mt-6 h-14 max-w-3xl animate-pulse rounded-2xl bg-white/10" />
            <div className="mt-4 h-5 max-w-2xl animate-pulse rounded-xl bg-white/[0.07]" />
          </div>

          <div className="mt-6 grid gap-5 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={`settings-panel-skeleton-${index}`}
                className="h-80 animate-pulse rounded-[1.85rem] border border-white/10 bg-white/[0.045]"
              />
            ))}
          </div>
        </section>
      </div>
        </main>
      </div>
    </>
  );
}
