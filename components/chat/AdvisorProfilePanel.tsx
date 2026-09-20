"use client";

import { Check, Loader2, User } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { ChatProfile } from "@/components/chat/advisor-profile-types";
import {
  formatList,
  hasProfileContent,
  parseList,
} from "@/components/chat/advisor-profile-types";

// The Advisor Profile panel, extracted so it has exactly ONE implementation
// and ONE source of truth (every value below is a prop; all state lives in
// AIChatWorkspace). It used to be written inline inside <aside>, which is the
// mobile drawer -- so opening the hamburger on a phone showed the whole
// preferences form underneath the session list, mixing navigation with main
// content. The panel now renders in whichever slot the breakpoint calls for:
// the sidebar from md up, the Ask content column below it. Only one slot is
// displayed at a time, and neither copy owns any state of its own.

export type AdvisorProfilePanelProps = {
  profile: ChatProfile;
  profileDraft: ChatProfile;
  setProfileDraft: Dispatch<SetStateAction<ChatProfile>>;
  profileOpen: boolean;
  setProfileOpen: Dispatch<SetStateAction<boolean>>;
  profileMessage: string;
  setProfileMessage: Dispatch<SetStateAction<string>>;
  profileSaving: boolean;
  saveProfile: () => Promise<void> | void;
  setClearProfileConfirmOpen: Dispatch<SetStateAction<boolean>>;
};

export default function AdvisorProfilePanel({
  profile,
  profileDraft,
  setProfileDraft,
  profileOpen,
  setProfileOpen,
  profileMessage,
  setProfileMessage,
  profileSaving,
  saveProfile,
  setClearProfileConfirmOpen,
}: AdvisorProfilePanelProps) {
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
      <button
        type="button"
        onClick={() => {
          setProfileDraft(profile);
          setProfileOpen((current) => !current);
          setProfileMessage("");
        }}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span>
          <span className="block text-xs font-medium text-white">Advisor Profile</span>
          <span className="mt-1 block text-xs text-zinc-500">
            {hasProfileContent(profile)
              ? "Saved preferences active"
              : "Add preferences to reduce repeat questions"}
          </span>
        </span>
        <User className="h-4 w-4 text-teal-200" />
      </button>

      {profileOpen ? (
        <div className="mt-4 space-y-3">
          <label className="block text-xs text-zinc-500">
            Country / market
            <input
              value={profileDraft.preferred_country}
              onChange={(event) =>
                setProfileDraft((current) => ({
                  ...current,
                  preferred_country: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
              placeholder="Turkey, UAE, Germany..."
            />
          </label>

          <label className="block text-xs text-zinc-500">
            Preferred industries
            <input
              value={formatList(profileDraft.preferred_industries)}
              onChange={(event) =>
                setProfileDraft((current) => ({
                  ...current,
                  preferred_industries: parseList(event.target.value),
                }))
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
              placeholder="AI, healthcare, real estate"
            />
          </label>

          <label className="block text-xs text-zinc-500">
            Budget ranges
            <input
              value={formatList(profileDraft.investment_budget_ranges)}
              onChange={(event) =>
                setProfileDraft((current) => ({
                  ...current,
                  investment_budget_ranges: parseList(event.target.value),
                }))
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
              placeholder="$10k-$50k, $1M+"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-zinc-500">
              Language
              <input
                value={profileDraft.preferred_language}
                onChange={(event) =>
                  setProfileDraft((current) => ({
                    ...current,
                    preferred_language: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
                placeholder="English"
              />
            </label>

            <label className="block text-xs text-zinc-500">
              Risk
              <input
                value={profileDraft.risk_tolerance}
                onChange={(event) =>
                  setProfileDraft((current) => ({
                    ...current,
                    risk_tolerance: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
                placeholder="Medium"
              />
            </label>
          </div>

          <label className="block text-xs text-zinc-500">
            Experience
            <input
              value={profileDraft.experience_level}
              onChange={(event) =>
                setProfileDraft((current) => ({
                  ...current,
                  experience_level: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
              placeholder="Beginner, founder, operator..."
            />
          </label>

          <label className="block text-xs text-zinc-500">
            Available time
            <input
              value={profileDraft.available_time}
              onChange={(event) =>
                setProfileDraft((current) => ({
                  ...current,
                  available_time: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
              placeholder="10 hours/week, part-time..."
            />
          </label>

          <label className="block text-xs text-zinc-500">
            Business interests
            <input
              value={formatList(profileDraft.business_interests)}
              onChange={(event) =>
                setProfileDraft((current) => ({
                  ...current,
                  business_interests: parseList(event.target.value),
                }))
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
              placeholder="SaaS, franchises, e-commerce"
            />
          </label>

          <label className="block text-xs text-zinc-500">
            Long-term goals
            <input
              value={formatList(profileDraft.long_term_goals)}
              onChange={(event) =>
                setProfileDraft((current) => ({
                  ...current,
                  long_term_goals: parseList(event.target.value),
                }))
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-teal-200/40"
              placeholder="Cash flow, exit, passive income"
            />
          </label>

          {profileMessage ? (
            <p className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs leading-5 text-zinc-300">
              {profileMessage}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void saveProfile()}
              disabled={profileSaving}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-200 px-3 py-2 text-xs font-semibold text-black transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {profileSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => setClearProfileConfirmOpen(true)}
              disabled={profileSaving || !hasProfileContent(profile)}
              className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
