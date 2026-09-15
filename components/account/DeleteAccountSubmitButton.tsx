"use client";

import { useFormStatus } from "react-dom";

// Deletion takes a few seconds (Stripe, then every user table, then the
// auth user); disabling the button while pending prevents double submits.
export default function DeleteAccountSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="mt-3 inline-flex min-h-10 items-center justify-center rounded-2xl border border-red-300/25 bg-red-300/10 px-4 text-sm font-semibold text-red-100 transition hover:bg-red-300/15 focus:outline-none focus:ring-2 focus:ring-red-200/20 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Deleting account..." : "Permanently delete account"}
    </button>
  );
}
