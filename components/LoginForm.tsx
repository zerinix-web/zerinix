"use client";

import { useActionState } from "react";
import {
  loginWithPassword,
  type LoginActionState,
} from "@/app/auth/actions";
import type { AppDictionary } from "@/app/lib/i18n/dictionaries";

const initialState: LoginActionState = {};

export default function LoginForm({
  labels,
}: {
  labels: AppDictionary["auth"];
}) {
  const [state, formAction, pending] = useActionState(
    loginWithPassword,
    initialState
  );

  return (
    <form action={formAction} className="mt-8 space-y-4">
      {state.error && (
        <p className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          {state.error}
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
