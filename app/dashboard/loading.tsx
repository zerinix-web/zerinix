export default function DashboardLoading() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b border-white/10 bg-black/80 px-4 py-4 shadow-2xl shadow-black/30 backdrop-blur-2xl lg:min-h-screen lg:w-72 lg:border-b-0 lg:border-r lg:bg-black/65 lg:px-5 lg:py-6">
          <div className="hidden lg:block">
            <div className="h-16 animate-pulse rounded-[1.65rem] border border-white/10 bg-white/[0.045] shadow-xl shadow-black/20" />
            <div className="mt-4 h-24 animate-pulse rounded-[1.65rem] border border-teal-300/15 bg-teal-300/[0.055] shadow-xl shadow-teal-950/10" />
          </div>
          <div className="flex gap-2 lg:mt-8 lg:block lg:space-y-2">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-14 w-32 animate-pulse rounded-[1.15rem] border border-white/10 bg-white/[0.035] lg:w-full"
              />
            ))}
          </div>
        </aside>

        <section className="flex-1 px-5 py-6 sm:px-8 lg:px-10 lg:py-9">
          <div className="h-64 animate-pulse rounded-[2.25rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/35 backdrop-blur-2xl" />
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-40 animate-pulse rounded-[1.65rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/25 backdrop-blur-xl"
              />
            ))}
          </div>
          <div className="mt-8 h-20 animate-pulse rounded-[1.75rem] border border-white/10 bg-white/[0.045] backdrop-blur-xl" />
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-72 animate-pulse rounded-[1.75rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/25 backdrop-blur-xl"
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
