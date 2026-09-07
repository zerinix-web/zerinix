"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AppDictionary } from "@/app/lib/i18n/dictionaries";
import {
  createClient,
  persistSupabaseSession,
  restoreSupabaseSession,
} from "@/app/lib/supabase/client";
import { classifyPasswordSignInError } from "@/app/lib/supabase/auth-error-classification";
import OAuthButtons from "@/components/OAuthButtons";

export default function LoginForm({
  labels,
}: {
  labels: AppDictionary["auth"];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      setError(labels.missingCredentials);
      return;
    }

    setPending(true);
    setError("");

    try {
      const supabase = createClient();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        // TASK #69A-19A -- ROOT CAUSE FIX (classifier extracted to
        // classifyPasswordSignInError under #69A-21 so this and both
        // server-action login paths in app/auth/actions.ts share one
        // truthful distinction instead of each re-implementing it):
        // this is the real, live login form (LoginForm.tsx calls
        // supabase.auth.signInWithPassword directly; app/auth/actions.ts's
        // own server actions are a separate, unwired code path). Every
        // signInWithPassword failure used to collapse into the SAME
        // "check your email and password" message regardless of cause
        // -- confirmed live, a genuine Supabase connectivity outage (the
        // auth service itself unreachable) was indistinguishable here
        // from real invalid credentials. That misleads someone with a
        // CORRECT password into doubting it, and makes a real
        // infrastructure incident look like a login bug. Every other
        // error (genuinely wrong credentials, or any other auth
        // failure) still shows the exact same generic message as
        // before -- this deliberately never distinguishes "wrong
        // email" from "wrong password" from "some other auth error",
        // since that would let an attacker enumerate which part of a
        // guess was wrong.
        setError(
          classifyPasswordSignInError(signInError) === "connectivity"
            ? labels.connectionError
            : labels.authError
        );
        return;
      }

      persistSupabaseSession(data.session);
      await restoreSupabaseSession(supabase);

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        setError(labels.sessionError);
        return;
      }

      router.replace("/plan");
      router.refresh();
    } catch {
      setError(labels.authError);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <OAuthButtons labels={labels} />

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p
            aria-live="polite"
            className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100"
          >
            {error}
          </p>
        )}

        <label className="block">
          <span className="text-sm font-medium text-gray-300">
            {labels.email}
          </span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
            disabled={pending}
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/50 px-4 text-white outline-none transition placeholder:text-gray-600 focus:border-teal-300/70 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-300">
            {labels.password}
          </span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
            disabled={pending}
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/50 px-4 text-white outline-none transition placeholder:text-gray-600 focus:border-teal-300/70 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <div className="flex items-center text-sm">
          <label className="flex items-center gap-2 text-gray-400">
            <input
              type="checkbox"
              name="remember"
              disabled={pending}
              className="h-4 w-4 rounded border-white/10 bg-black accent-white disabled:cursor-not-allowed disabled:opacity-60"
            />
            {labels.rememberMe}
          </label>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="h-12 w-full rounded-2xl bg-white font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? labels.signingIn : labels.signInButton}
        </button>
      </form>
    </>
  );
}
