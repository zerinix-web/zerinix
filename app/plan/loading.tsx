function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl border border-white/10 bg-white/[0.055] ${className}`}
    />
  );
}

export default function PlanLoading() {
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-black text-white md:flex-row">
      <aside className="flex border-b border-white/10 bg-black/85 p-4 shadow-2xl shadow-black/30 backdrop-blur-2xl md:h-screen md:w-[21.5rem] md:flex-col md:border-b-0 md:border-r">
        <div className="hidden md:block">
          <SkeletonBlock className="h-14 w-44" />
          <div className="mt-5 grid grid-cols-2 gap-2">
            <SkeletonBlock className="h-20" />
            <SkeletonBlock className="h-20" />
          </div>
          <SkeletonBlock className="mt-5 h-44 rounded-3xl" />
        </div>
        <div className="flex flex-1 gap-3 overflow-hidden pl-3 md:mt-4 md:block md:space-y-3 md:pl-0">
          {["one", "two", "three", "four"].map((item) => (
            <SkeletonBlock
              key={item}
              className="h-24 min-w-72 rounded-3xl md:w-full"
            />
          ))}
        </div>
      </aside>

      <section className="relative flex min-w-0 flex-1 flex-col">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.16),transparent_34%),linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.032)_1px,transparent_1px)] bg-[size:auto,54px_54px,54px_54px]" />
        <header className="relative z-10 border-b border-white/10 bg-black/65 px-5 py-4 backdrop-blur-2xl">
          <SkeletonBlock className="h-5 w-40 rounded-full" />
          <SkeletonBlock className="mt-3 h-8 max-w-xl" />
        </header>
        <div className="relative z-10 flex-1 overflow-hidden px-4 py-5 sm:px-5 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <SkeletonBlock className="h-[52vh] rounded-[2rem]" />
            <SkeletonBlock className="mt-5 h-28 rounded-[2rem]" />
          </div>
        </div>
        <div className="relative z-10 border-t border-white/10 bg-black/75 px-4 py-4 backdrop-blur-2xl sm:px-5 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <SkeletonBlock className="h-48 rounded-[2rem]" />
          </div>
        </div>
      </section>
    </main>
  );
}
