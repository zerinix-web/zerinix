"use client";

import { useRouter } from "next/navigation";
import {
  localeCookieName,
  manualLocaleCookieName,
  supportedLocales,
  type AppLocale,
} from "@/app/lib/i18n/config";
import type { AppDictionary } from "@/app/lib/i18n/dictionaries";

type LanguageSelectorProps = {
  locale: AppLocale;
  labels: AppDictionary["language"];
  compact?: boolean;
};

const maxAgeSeconds = 60 * 60 * 24 * 365;

export default function LanguageSelector({
  locale,
  labels,
  compact = false,
}: LanguageSelectorProps) {
  const router = useRouter();

  function updateLocale(nextLocale: string) {
    document.cookie = `${localeCookieName}=${nextLocale}; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
    document.cookie = `${manualLocaleCookieName}=1; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
    router.refresh();
  }

  return (
    <label
      className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] text-sm text-zinc-300 shadow-lg shadow-black/10 transition focus-within:border-teal-300/35 ${
        compact ? "px-2 py-1.5" : "px-3 py-2"
      }`}
    >
      <span className={compact ? "sr-only" : "text-xs font-medium text-zinc-500"}>
        {labels.label}
      </span>
      <select
        value={locale}
        aria-label={labels.label}
        onChange={(event) => updateLocale(event.target.value)}
        className="bg-transparent text-xs font-semibold text-white outline-none"
      >
        {supportedLocales.map((item) => (
          <option key={item} value={item} className="bg-zinc-950 text-white">
            {item === "en"
              ? labels.english
              : item === "tr"
                ? labels.turkish
                : labels.german}
          </option>
        ))}
      </select>
    </label>
  );
}
