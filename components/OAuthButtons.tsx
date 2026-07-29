"use client";

import { useState } from "react";
import type { Provider } from "@supabase/supabase-js";
import type { AppDictionary } from "@/app/lib/i18n/dictionaries";
import { createClient } from "@/app/lib/supabase/client";

type OAuthProvider = Extract<Provider, "google" | "apple">;

export default function OAuthButtons({
  labels,
}: {
  labels: AppDictionary["auth"];
}) {
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(
    null
  );
  const [error, setError] = useState("");

  async function signInWithOAuth(provider: OAuthProvider) {
    if (pendingProvider) {
      return;
    }

    setPendingProvider(provider);
    setError("");

    try {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
        },
      });

      if (oauthError) {
        setError(labels.oauthError);
        setPendingProvider(null);
      }
    } catch {
      setError(labels.oauthError);
      setPendingProvider(null);
    }
  }

  return (
    <div className="mt-8 space-y-3">
      {error && (
        <p
          aria-live="polite"
          className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100"
        >
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={pendingProvider !== null}
        onClick={() => signInWithOAuth("google")}
        className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-white/15 bg-white/[0.04] px-4 text-sm font-semibold text-white transition hover:border-teal-300/45 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-black"
        >
          G
        </span>
        {pendingProvider === "google"
          ? labels.connecting
          : labels.continueWithGoogle}
      </button>

      <button
        type="button"
        disabled={pendingProvider !== null}
        onClick={() => signInWithOAuth("apple")}
        className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-white/15 bg-white/[0.04] px-4 text-sm font-semibold text-white transition hover:border-teal-300/45 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-full border border-white/30 text-xs font-bold text-white"
        >
          A
        </span>
        {pendingProvider === "apple"
          ? labels.connecting
          : labels.continueWithApple}
      </button>

      <div className="flex items-center gap-4 py-2" aria-hidden="true">
        <span className="h-px flex-1 bg-white/10" />
        <span className="text-xs font-semibold tracking-[0.24em] text-gray-600">
          {labels.or}
        </span>
        <span className="h-px flex-1 bg-white/10" />
      </div>
    </div>
  );
}
