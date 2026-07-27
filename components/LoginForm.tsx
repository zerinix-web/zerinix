"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AppDictionary } from "@/app/lib/i18n/dictionaries";
import {
  createClient,
  persistSupabaseSession,
  restoreSupabaseSession,
} from "@/app/lib/supabase/client";

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
      setError("Enter your email and password.");
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
        setError("Check your email and password, then try again.");
        return;
      }

      persistSupabaseSession(data.session);
      await restoreSupabaseSession(supabase);

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        setError("Your session could not be saved. Please sign in again.");
        return;
      }

      router.replace("/plan");
      router.refresh();
    } catch {
      setError("Sign in failed. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-4">
      {error && (
        <p className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          {error}
        </p>
      )}

      <label className="block">
        <span className="text-sm font-medium text-gray-300">{labels.email}</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@company.com"
          className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/50 px-4 text-white outline-none transition placeholder:text-gray-600 focus:border-teal-300/70"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-300">{labels.password}</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
          className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/50 px-4 text-white outline-none transition placeholder:text-gray-600 focus:border-teal-300/70"
        />
      </label>

      <div className="flex items-center text-sm">
        <label className="flex items-center gap-2 text-gray-400">
          <input
            type="checkbox"
            name="remember"
            className="h-4 w-4 rounded border-white/10 bg-black accent-white"
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
  );
}
