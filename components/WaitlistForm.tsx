"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import type { AppDictionary } from "@/app/lib/i18n/dictionaries";

export default function WaitlistForm({
  labels,
}: {
  labels: AppDictionary["landing"];
}) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function submitWaitlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <div id="waitlist">
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setSubmitted(false);
        }}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-teal-300 px-6 py-3 text-sm font-semibold text-black transition hover:bg-teal-200"
      >
        {labels.requestEarlyAccess}
        <ArrowRight className="h-4 w-4" />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="waitlist-title"
        >
          <div className="w-full max-w-md rounded-lg border border-white/10 bg-zinc-950 p-6 shadow-2xl shadow-black/60">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-200">
                  {labels.waitlistEyebrow}
                </p>
                <h2
                  id="waitlist-title"
                  className="mt-3 text-2xl font-semibold tracking-tight text-white"
                >
                  {labels.waitlistTitle}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-zinc-300 transition hover:border-white/25 hover:text-white"
                aria-label={labels.waitlistClose}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {submitted ? (
              <div className="mt-8 rounded-lg border border-teal-300/20 bg-teal-300/10 p-5">
                <div className="flex items-center gap-3 text-teal-100">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-teal-300 text-black">
                    <Check className="h-4 w-4" />
                  </span>
                  <p className="text-sm font-semibold">
                    {labels.waitlistThanks}
                  </p>
                </div>
              </div>
            ) : (
              <form className="mt-6 space-y-4" onSubmit={submitWaitlist}>
                <label className="block text-left text-sm font-medium text-zinc-200">
                  {labels.waitlistName}
                  <input
                    required
                    name="name"
                    autoComplete="name"
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300/70"
                    placeholder={labels.waitlistNamePlaceholder}
                  />
                </label>
                <label className="block text-left text-sm font-medium text-zinc-200">
                  {labels.waitlistEmail}
                  <input
                    required
                    type="email"
                    name="email"
                    autoComplete="email"
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300/70"
                    placeholder={labels.waitlistEmailPlaceholder}
                  />
                </label>
                <label className="block text-left text-sm font-medium text-zinc-200">
                  {labels.waitlistCompany}
                  <input
                    required
                    name="company"
                    autoComplete="organization"
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300/70"
                    placeholder={labels.waitlistCompanyPlaceholder}
                  />
                </label>
                <button
                  type="submit"
                  className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-teal-300 px-5 py-3 text-sm font-semibold text-black transition hover:bg-teal-200"
                >
                  {labels.joinWaitlist}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
