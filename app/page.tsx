import Link from "next/link";
import { LockKeyhole, Sparkles } from "lucide-react";
import WaitlistForm from "@/components/WaitlistForm";

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent_28%),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:auto,72px_72px,72px_72px]" />
      <section className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8">
        <nav className="flex items-center justify-between">
          <Link href="/" className="text-xl font-semibold tracking-[0.28em] text-white">
            ZERINIX
          </Link>
          <Link
            href="/login?next=/plan"
            className="inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-teal-300/60 hover:text-white"
          >
            <LockKeyhole className="h-4 w-4" />
            Developer Login
          </Link>
        </nav>

        <div className="flex flex-1 items-center py-16">
          <div className="max-w-3xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-4 py-2 text-sm font-medium text-teal-100">
              <Sparkles className="h-4 w-4" />
              Private beta access
            </div>
            <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-white sm:text-7xl">
              ZERINIX is launching soon
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-zinc-300 sm:text-xl">
              AI business planning, market intelligence and strategic reports for
              founders.
            </p>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <WaitlistForm />
              <Link
                href="/login?next=/plan"
                className="inline-flex items-center justify-center rounded-full border border-white/12 px-6 py-3 text-sm font-semibold text-zinc-100 transition hover:border-white/30 hover:bg-white/[0.04]"
              >
                Developer Login
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
