import type { Metadata } from "next";
import Link from "next/link";
import HomeLink from "@/components/HomeLink";
import { CheckCircle2, Sparkles } from "lucide-react";
import ClearDeletedAccountSession from "@/components/account/ClearDeletedAccountSession";

// Destination of the in-app deletion flow (deleteAccount in
// app/dashboard/settings/actions.ts) after the account has been deleted.
// Public and static like /delete-account; not indexed.
export const metadata: Metadata = {
  title: "Account Deleted | ZERINIX",
  description: "Your ZERINIX account has been deleted.",
  robots: {
    index: false,
    follow: false,
  },
};

const CONTACT_EMAIL = "zerinix@zerinix.com";

const linkClassName =
  "font-medium text-teal-200 underline decoration-teal-200/40 underline-offset-2 hover:text-teal-100";

export default function AccountDeletedPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <ClearDeletedAccountSession />

      <header className="border-b border-white/10 bg-black/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5 sm:px-8">
          <HomeLink className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06]">
              <Sparkles className="h-3.5 w-3.5 text-teal-200" />
            </span>
            <span className="text-sm font-semibold tracking-[0.28em] text-white">
              ZERINIX
            </span>
          </HomeLink>
          <HomeLink className="text-sm font-medium text-zinc-400 transition hover:text-white">
            Back to ZERINIX
          </HomeLink>
        </nav>
      </header>

      <article className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-16">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/[0.06]">
          <CheckCircle2 className="h-5 w-5 text-teal-200" />
        </span>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Your ZERINIX account has been deleted
        </h1>
        <div className="mt-6 space-y-4 text-[15px] leading-7 text-zinc-400">
          <p>
            Your account and its associated data have been deleted, and you
            have been signed out on this device.
          </p>
          <p>
            A small set of billing, accounting, and security records is kept,
            as described on the{" "}
            <Link href="/delete-account" className={linkClassName}>
              Delete Your ZERINIX Account
            </Link>{" "}
            page.
          </p>
          <p>
            If you have questions, contact us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className={linkClassName}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </div>
      </article>
    </main>
  );
}
