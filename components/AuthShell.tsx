import Link from "next/link";
import type { ReactNode } from "react";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footerText: string;
  footerHref: string;
  footerLinkText: string;
};

export default function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footerText,
  footerHref,
  footerLinkText,
}: AuthShellProps) {
  return (
    <main className="relative flex min-h-screen overflow-hidden bg-black px-6 py-8 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.12),transparent_34%),linear-gradient(135deg,rgba(20,184,166,0.12),transparent_32%),linear-gradient(225deg,rgba(255,255,255,0.08),transparent_28%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:72px_72px] opacity-25" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col">
        <nav className="flex items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-[0.12em]">
            ZERINIX
          </Link>

          <Link
            href="/plan"
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-gray-300 transition hover:border-white/30 hover:text-white"
          >
            Hedefimi Planla
          </Link>
        </nav>

        <section className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1fr_460px]">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-[0.45em] text-teal-300/80">
              {eyebrow}
            </p>
            <h1 className="mt-6 text-5xl font-bold leading-[1.04] md:text-6xl">
              {title}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-gray-300">
              {subtitle}
            </p>

            <div className="mt-10 grid max-w-xl grid-cols-3 gap-3 border-y border-white/10 py-5 text-sm text-gray-400">
              <div>
                <p className="text-2xl font-bold text-white">OS</p>
                <p>strateji</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-white">AI</p>
                <p>planlama</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-white">HQ</p>
                <p>operasyon</p>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-zinc-950/85 p-6 shadow-2xl shadow-black/50 backdrop-blur-xl">
            {children}

            <p className="mt-6 text-center text-sm text-gray-500">
              {footerText}{" "}
              <Link href={footerHref} className="font-medium text-white">
                {footerLinkText}
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
