function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl border border-white/10 bg-white/[0.055] ${className}`}
    />
  );
}

export default function ChatLoading() {
  return (
    <main className="flex h-screen overflow-hidden bg-black text-white">
      <aside className="hidden w-80 flex-col border-r border-white/10 bg-zinc-950/95 p-4 shadow-2xl shadow-black/60 backdrop-blur-2xl md:flex">
        <SkeletonBlock className="h-8 w-40" />
        <SkeletonBlock className="mt-6 h-12 rounded-2xl" />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <SkeletonBlock className="h-12 rounded-2xl" />
          <SkeletonBlock className="h-12 rounded-2xl" />
        </div>
        <SkeletonBlock className="mt-5 h-10 rounded-2xl" />
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-hidden">
          {["one", "two", "three", "four", "five"].map((item) => (
            <SkeletonBlock key={item} className="h-24 rounded-2xl" />
          ))}
        </div>
        <SkeletonBlock className="mt-4 h-28 rounded-2xl" />
      </aside>

      <section className="relative flex min-w-0 flex-1 flex-col">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.16),transparent_34%),linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.032)_1px,transparent_1px)] bg-[size:auto,54px_54px,54px_54px]" />
        <header className="relative z-10 border-b border-white/10 bg-black/75 px-4 py-4 backdrop-blur-xl sm:px-6">
          <SkeletonBlock className="h-10 max-w-sm" />
        </header>
        <div className="relative z-10 flex-1 overflow-hidden px-4 py-6 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <SkeletonBlock className="h-[52vh] rounded-[2rem]" />
          </div>
        </div>
        <div className="relative z-10 border-t border-white/10 bg-black/80 px-4 py-4 backdrop-blur-2xl sm:px-6">
          <div className="mx-auto max-w-5xl">
            <SkeletonBlock className="h-44 rounded-[2rem]" />
          </div>
        </div>
      </section>
    </main>
  );
}
