"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  isAppAttestAvailable,
  registerWithAppAttest,
  type RegistrationOutcome,
} from "@/app/lib/ios-attestation/client";

type Labels = {
  fullName: string;
  email: string;
  password: string;
  createAccount: string;
  creating: string;
  checkEmail: string;
  weakPassword: string;
  invalidRegistration: string;
  registrationFailed: string;
  registrationRateLimited: string;
  unavailable: string;
  signIn: string;
  alreadyHaveAccount: string;
};

const MESSAGE_FOR: Record<
  Exclude<RegistrationOutcome & { ok: false }, never>["reason"],
  keyof Labels
> = {
  unsupported: "unavailable",
  unavailable: "unavailable",
  // Deliberately the same wording as any other failure: the device check is
  // not something the person can act on, and naming it would only tell an
  // attacker which step rejected them.
  unverified_device: "unavailable",
  invalid_email: "invalidRegistration",
  weak_password: "weakPassword",
  registration_failed: "registrationFailed",
  rate_limited: "registrationRateLimited",
};

/**
 * Self-service registration for the App Store build.
 *
 * Rendered only inside the iOS shell, but that is presentation, not security:
 * the endpoint behind it refuses anything without a verified Apple App Attest
 * assertion, so a browser that renders this form anyway still cannot create
 * an account. Nothing here is a gate.
 */
export default function IosRegistrationForm({ labels }: { labels: Labels }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;

    isAppAttestAvailable().then((supported) => {
      if (active) {
        setAvailable(supported);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");

    const outcome = await registerWithAppAttest({
      fullName: String(form.get("fullName") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });

    if (outcome.ok) {
      setDone(true);
    } else {
      setError(labels[MESSAGE_FOR[outcome.reason]]);
    }

    setSubmitting(false);
  }

  // Until the native check answers, render nothing rather than flashing a form
  // that may not be usable on this device.
  if (available === null) {
    return null;
  }

  if (!available) {
    return <p className="text-sm leading-6 text-zinc-400">{labels.unavailable}</p>;
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-6 text-teal-100">{labels.checkEmail}</p>
        <Link
          href="/login"
          className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-white px-5 text-sm font-semibold text-black"
        >
          {labels.signIn}
        </Link>
      </div>
    );
  }

  const field =
    "min-h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-teal-200/50";

  return (
    <form className="space-y-4" onSubmit={submit}>
      <label className="grid gap-2 text-sm font-medium text-zinc-300">
        {labels.fullName}
        <input name="fullName" type="text" autoComplete="name" className={field} />
      </label>

      <label className="grid gap-2 text-sm font-medium text-zinc-300">
        {labels.email}
        <input name="email" type="email" required autoComplete="email" className={field} />
      </label>

      <label className="grid gap-2 text-sm font-medium text-zinc-300">
        {labels.password}
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={field}
        />
      </label>

      {error ? (
        <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-white px-5 text-sm font-semibold text-black transition disabled:opacity-60"
      >
        {submitting ? labels.creating : labels.createAccount}
      </button>

      <p className="text-center text-sm text-zinc-400">
        {labels.alreadyHaveAccount}{" "}
        <Link href="/login" className="font-semibold text-white underline-offset-4 hover:underline">
          {labels.signIn}
        </Link>
      </p>
    </form>
  );
}
