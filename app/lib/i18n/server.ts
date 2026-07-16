import { cookies, headers } from "next/headers";
import {
  autoLocaleCookieName,
  defaultLocale,
  detectLocaleFromAcceptLanguage,
  localeCookieName,
  manualLocaleCookieName,
  normalizeLocale,
  type AppLocale,
} from "./config";
import { getDictionary } from "./dictionaries";

export async function getRequestLocale(): Promise<AppLocale> {
  const cookieStore = await cookies();
  const manualLocale = cookieStore.get(localeCookieName)?.value;
  const hasManualPreference = cookieStore.get(manualLocaleCookieName)?.value === "1";

  if (hasManualPreference && manualLocale) {
    return normalizeLocale(manualLocale);
  }

  const autoLocale = cookieStore.get(autoLocaleCookieName)?.value;

  if (autoLocale) {
    return normalizeLocale(autoLocale);
  }

  const headerStore = await headers();

  return detectLocaleFromAcceptLanguage(headerStore.get("accept-language")) || defaultLocale;
}

export async function getRequestDictionary() {
  const locale = await getRequestLocale();

  return {
    locale,
    dictionary: getDictionary(locale),
  };
}
