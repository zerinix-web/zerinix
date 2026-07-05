import Planner from "@/components/Planner";
import { isPrivateBetaAllowed } from "@/app/lib/beta-access";
import { createClient } from "@/app/lib/supabase/server";
import { loadPlanConversations } from "./conversations";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error("[plan auth missing]", userError?.message || "No authenticated user");
    redirect("/login?next=/plan");
  }

  if (!isPrivateBetaAllowed(user.email)) {
    return <PrivateBetaAccessOnly />;
  }

  const conversationResult = await loadPlanConversations(supabase, user);

  return (
    <Planner
      initialConversations={conversationResult.conversations}
      conversationLoadError={conversationResult.error}
    />
  );
}

function PrivateBetaAccessOnly() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
      <section className="w-full max-w-xl rounded-lg border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl shadow-black/40">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-teal-200">
          ZERINIX private beta
        </p>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">
          Private beta access only
        </h1>
        <p className="mt-4 text-sm leading-6 text-zinc-300">
          This workspace is currently limited to approved early-access accounts.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-white/12 px-5 py-3 text-sm font-semibold text-zinc-100 transition hover:border-white/30 hover:bg-white/[0.04]"
          >
            Back to Landing
          </Link>
          <a
            href="mailto:yesilovaibrahim38@gmail.com?subject=ZERINIX%20private%20beta%20access"
            className="inline-flex items-center justify-center rounded-full bg-teal-300 px-5 py-3 text-sm font-semibold text-black transition hover:bg-teal-200"
          >
            Request Early Access
          </a>
        </div>
      </section>
    </main>
  );
}
