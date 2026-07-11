export default function AdminLoading() {
  return (
    <main className="min-h-screen bg-black p-6 text-white">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="h-28 animate-pulse rounded-[2rem] border border-white/10 bg-white/[0.045]" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={`admin-loading-card-${index}`}
              className="h-32 animate-pulse rounded-[1.65rem] border border-white/10 bg-white/[0.045]"
            />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-[1.75rem] border border-white/10 bg-white/[0.045]" />
      </div>
    </main>
  );
}
