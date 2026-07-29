"use client";

import { useActionState } from "react";
import {
  signUpWithPassword,
  type RegisterActionState,
} from "@/app/auth/actions";
import type { AppDictionary } from "@/app/lib/i18n/dictionaries";
import OAuthButtons from "@/components/OAuthButtons";

const initialState: RegisterActionState = {};

export default function RegisterForm({
  labels,
}: {
  labels: AppDictionary["auth"];
}) {
  const [state, formAction, pending] = useActionState(
    signUpWithPassword,
    initialState
  );

  const errorMessage = state.error ? labels[state.error] : "";

  return (
    <>
      <OAuthButtons labels={labels} />

      <form action={formAction} className="space-y-4">
        {errorMessage && (
          <p
            aria-live="polite"
            className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100"
          >
            {errorMessage}
          </p>
        )}

        {state.success && (
          <p
            aria-live="polite"
            className="rounded-2xl border border-teal-300/20 bg-teal-300/10 px-4 py-3 text-sm text-teal-100"
          >
            {labels.checkEmail}
          </p>
        )}

        <label className="block">
          <span className="text-sm font-medium text-gray-300">
            {labels.fullName}
          </span>
          <input
            type="text"
            name="fullName"
            required
            minLength={2}
            maxLength={100}
            autoComplete="name"
            placeholder={labels.fullNamePlaceholder}
            disabled={pending}
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/50 px-4 text-white outline-none transition placeholder:text-gray-600 focus:border-teal-300/70 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-300">
            {labels.email}
          </span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
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
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
            disabled={pending}
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/50 px-4 text-white outline-none transition placeholder:text-gray-600 focus:border-teal-300/70 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-300">
            {labels.confirmPassword}
          </span>
          <input
            type="password"
            name="confirmPassword"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
            disabled={pending}
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/50 px-4 text-white outline-none transition placeholder:text-gray-600 focus:border-teal-300/70 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <button
          type="submit"
          disabled={pending || state.success}
          className="h-12 w-full rounded-2xl bg-white font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? labels.creatingAccount : labels.createAccount}
        </button>
      </form>
    </>
  );
}
