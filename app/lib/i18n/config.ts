export const supportedLocales = ["en", "tr", "de"] as const;

export type AppLocale = (typeof supportedLocales)[number];

export const defaultLocale: AppLocale = "en";
export const localeCookieName = "zerinix_locale";
export const manualLocaleCookieName = "zerinix_locale_manual";
export const autoLocaleCookieName = "zerinix_auto_locale";

const supportedLocaleSet = new Set<string>(supportedLocales);

export function normalizeLocale(value?: string | null): AppLocale {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];

  return supportedLocaleSet.has(normalized) ? (normalized as AppLocale) : defaultLocale;
}

export function detectLocaleFromAcceptLanguage(value?: string | null): AppLocale {
  const candidates = String(value || "")
    .split(",")
    .map((item) => item.trim().split(";")[0])
    .filter(Boolean);

  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate);

    if (locale !== defaultLocale || candidate.toLowerCase().startsWith(defaultLocale)) {
      return locale;
    }
  }

  return defaultLocale;
}
