"use client";

import { useState } from "react";
import type { BillingPlanId } from "@/app/lib/billing/stripe";

type BillingCheckoutButtonProps = {
  planId: BillingPlanId;
  selectable: boolean;
  current: boolean;
};

function clearBillingErrorFromUrl() {
  const url = new URL(window.location.href);

  url.searchParams.delete("billing_error");
  document.querySelector("[data-billing-error-banner]")?.remove();

  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export default function BillingCheckoutButton({
  planId,
  selectable,
  current,
}: BillingCheckoutButtonProps) {
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState("");
  const disabled = !selectable || isOpening;

  async function openCheckout() {
    if (disabled) {
      return;
    }

    setError("");
    setIsOpening(true);
    clearBillingErrorFromUrl();

    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan: planId }),
      });
      const payload = (await response.json().catch(() => null)) as {
        url?: string;
      } | null;

      if (!response.ok || !payload?.url) {
        throw new Error("Checkout request failed.");
      }

      window.location.assign(payload.url);
    } catch {
      setIsOpening(false);
      setError("Billing action could not be completed. Please try again shortly.");
    }
  }

  return (
    <div className="mt-5">
      <button
        type="button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-busy={isOpening}
        onClick={openCheckout}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-teal-200/30 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-500"
      >
        {isOpening ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
            Opening checkout...
          </>
        ) : current ? (
          "Current plan"
        ) : selectable ? (
          "Select plan"
        ) : (
          "Unavailable"
        )}
      </button>
      {error ? (
        <p className="mt-3 rounded-2xl border border-red-300/20 bg-red-950/30 p-3 text-xs leading-5 text-red-100">
          {error}
        </p>
      ) : null}
    </div>
  );
}
