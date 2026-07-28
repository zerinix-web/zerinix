"use client";

import { useState } from "react";

export default function BillingPortalButton({
  available,
}: {
  available: boolean;
}) {
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState("");
  const disabled = !available || isOpening;

  async function openPortal() {
    if (disabled) {
      return;
    }

    setError("");
    setIsOpening(true);

    try {
      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        url?: string;
      } | null;

      if (!response.ok || !payload?.url) {
        throw new Error(
          response.status === 401
            ? "Your session has expired. Please sign in again."
            : payload?.error || "Customer portal could not be opened."
        );
      }

      window.location.assign(payload.url);
    } catch (portalError) {
      setIsOpening(false);
      setError(
        portalError instanceof Error
          ? portalError.message
          : "Customer portal could not be opened. Please try again."
      );
    }
  }

  return (
    <div className="mt-5">
      <button
        type="button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-busy={isOpening}
        onClick={openPortal}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-teal-200/30 disabled:cursor-not-allowed disabled:border disabled:border-white/10 disabled:bg-white/10 disabled:text-zinc-500"
      >
        {isOpening
          ? "Opening customer portal..."
          : available
            ? "Open customer portal"
            : "Customer portal unavailable"}
      </button>
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-2xl border border-red-300/20 bg-red-950/30 p-3 text-xs leading-5 text-red-100"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
