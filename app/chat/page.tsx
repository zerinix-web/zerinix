import AIChatWorkspace from "@/components/AIChatWorkspace";
import WaitlistForm from "@/components/WaitlistForm";
import {
  getPrivateBetaAccessDiagnostics,
  isPrivateBetaAllowed,
  type PrivateBetaAccessDiagnostics,
} from "@/app/lib/beta-access";
import { createClient } from "@/app/lib/supabase/server";
import { loadPlanConversations } from "@/app/plan/conversations";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error("[chat auth missing]", userError?.message || "No authenticated user");
    redirect("/login?next=/chat");
  }

  if (!isPrivateBetaAllowed(user)) {
    const diagnostics = getPrivateBetaAccessDiagnostics(user);

    console.log("[private beta blocked chat]", diagnostics);

    return <PrivateBetaAccessOnly diagnostics={diagnostics} />;
  }

  const conversationResult = await loadPlanConversations(supabase, user);

  return (
    <AIChatWorkspace
      initialConversations={conversationResult.conversations}
      conversationLoadError={conversationResult.error}
    />
  );
}

function PrivateBetaAccessOnly({
  diagnostics,
}: {
  diagnostics: PrivateBetaAccessDiagnostics;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 py-10 text-white">
      <section className="w-full max-w-3xl rounded-lg border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl shadow-black/40">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-teal-200">
          ZERINIX private beta
        </p>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">
          Private beta access only
        </h1>
        <p className="mt-4 text-sm leading-6 text-zinc-300">
          AI Chat is currently limited to approved early-access accounts.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-white/12 px-5 py-3 text-sm font-semibold text-zinc-100 transition hover:border-white/30 hover:bg-white/[0.04]"
          >
            Back to Landing
          </Link>
          <WaitlistForm />
        </div>

        <div className="mt-8 rounded-lg border border-amber-300/20 bg-amber-950/20 p-5 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">
            Temporary auth diagnostics
          </p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <DiagnosticRow label="user.id" value={diagnostics.userId} />
            <DiagnosticRow label="user.email" value={diagnostics.userEmail} />
            <DiagnosticRow label="provider" value={diagnostics.provider} />
            <DiagnosticRow
              label="app_metadata.provider"
              value={diagnostics.appMetadataProvider}
            />
            <DiagnosticRow
              label="user_metadata.email"
              value={diagnostics.userMetadataEmail}
            />
            <DiagnosticRow
              label="user_metadata.full_name"
              value={diagnostics.userMetadataFullName}
            />
          </dl>

          <div className="mt-5 space-y-2">
            {diagnostics.checks.map((check) => (
              <div
                key={check.label}
                className="flex items-center justify-between gap-4 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm"
              >
                <span className="text-zinc-300">{check.label}</span>
                <span
                  className={
                    check.passed
                      ? "font-semibold text-emerald-300"
                      : "font-semibold text-red-300"
                  }
                >
                  {check.passed ? "passed" : "failed"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-3">
      <dt className="text-xs uppercase tracking-[0.16em] text-zinc-500">{label}</dt>
      <dd className="mt-1 break-words font-mono text-xs text-zinc-200">
        {value || "(empty)"}
      </dd>
    </div>
  );
}
