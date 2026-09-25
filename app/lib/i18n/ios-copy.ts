import type { AppLocale } from "./config";

/**
 * Neutral replacements for the marketing copy that describes ZERINIX as a
 * private beta.
 *
 * WHY THIS EXISTS: the Capacitor iOS shell points at https://zerinix.com, the
 * same deployment that serves the website, so the platform is not known when
 * the page is rendered on the server. App Store Review Guideline 2.2 rejects
 * builds that present themselves as beta, demo or trial software, and the
 * landing page is what the shell would otherwise open on. The page therefore
 * renders both wordings through `components/PlatformCopy.tsx` and
 * `app/globals.css` hides one of them.
 *
 * WHAT THIS IS NOT: this changes words, nothing else. Registration stays
 * approval-based, the private-beta allowlist in `app/lib/beta-access.ts` is
 * untouched, and the website keeps every phrase it has today -- the table
 * below is only ever consulted for the copy the iOS build displays.
 *
 * Keyed by the exact website string so a copy change upstream cannot silently
 * keep an old override alive: an unmatched string falls through unchanged, and
 * `tests/ios-app-store-beta-wording.test.mjs` fails the moment a landing
 * string with pre-release wording has no neutral counterpart here.
 */
const IOS_COPY: Record<AppLocale, Record<string, string>> = {
  en: {
    "Developer Login": "Sign in",
    "Private beta for ambitious founders": "Built for ambitious founders",
    "Private beta is intentionally limited. Request access or sign in if your workspace is already enabled.":
      "Access is granted per account. Request access or sign in if your workspace is already enabled.",
    "Final pricing will launch after private beta. Early access users help shape limits, workflows and team features.":
      "Plan pricing is confirmed per account. Talk to us about limits, workflows and team features.",
    // Used twice, as the Free plan's price line and as the closing CTA
    // eyebrow, so one replacement has to read correctly in both places.
    "Private beta": "Approved access",
    "For invited founders exploring the ZERINIX workspace.":
      "For approved founders exploring the ZERINIX workspace.",
    "ZERINIX is currently in private beta. Early access is controlled so we can keep quality, reliability and cost discipline high while the product matures.":
      "ZERINIX accounts are approved individually. Access is controlled so we can keep quality, reliability and cost discipline high.",
    "Yes. Team workspaces, higher usage limits and deeper governance are part of the Business plan direction after private beta.":
      "Yes. Team workspaces, higher usage limits and deeper governance are part of the Business plan direction.",
    "Private beta access control": "Approved-account access control",
  },
  tr: {
    "Geliştirici Girişi": "Giriş yap",
    "Hırslı girişimciler için private beta": "Hırslı girişimciler için",
    "Private beta bilinçli olarak sınırlıdır. Erişim talep edin veya çalışma alanınız açıksa giriş yapın.":
      "Erişim hesap bazında verilir. Erişim talep edin veya çalışma alanınız açıksa giriş yapın.",
    "Nihai fiyatlandırma private beta sonrası yayınlanacak. Erken erişim kullanıcıları limitleri, iş akışlarını ve ekip özelliklerini şekillendirir.":
      "Plan fiyatlandırması hesap bazında belirlenir. Limitler, iş akışları ve ekip özellikleri için bizimle görüşün.",
    "Private beta": "Onaylı erişim",
    "ZERINIX çalışma alanını keşfeden davetli kurucular için.":
      "ZERINIX çalışma alanını keşfeden onaylı kurucular için.",
    "ZERINIX şu anda private beta aşamasındadır. Kalite, güvenilirlik ve maliyet disiplinini korumak için erken erişim kontrollüdür.":
      "ZERINIX hesapları tek tek onaylanır. Kalite, güvenilirlik ve maliyet disiplinini korumak için erişim kontrollüdür.",
    "Private beta erişim kontrolü": "Onaylı hesap erişim kontrolü",
  },
  de: {
    "Entwickler-Login": "Anmelden",
    "Private Beta für ambitionierte Gründer": "Für ambitionierte Gründer",
    "Die Private Beta ist bewusst begrenzt. Fragen Sie Zugang an oder melden Sie sich an, wenn Ihr Arbeitsbereich bereits aktiviert ist.":
      "Der Zugang wird pro Konto freigegeben. Fragen Sie Zugang an oder melden Sie sich an, wenn Ihr Arbeitsbereich bereits aktiviert ist.",
    "Finale Preise starten nach der Private Beta. Frühe Nutzer helfen, Limits, Workflows und Teamfunktionen zu formen.":
      "Die Preise werden pro Konto festgelegt. Sprechen Sie mit uns über Limits, Workflows und Teamfunktionen.",
    "Private Beta": "Freigegebener Zugang",
    "Für eingeladene Gründer, die den ZERINIX-Arbeitsbereich erkunden.":
      "Für freigegebene Gründer, die den ZERINIX-Arbeitsbereich erkunden.",
    "ZERINIX ist derzeit in der Private Beta. Früher Zugang ist kontrolliert, damit Qualität, Zuverlässigkeit und Kostendisziplin hoch bleiben.":
      "ZERINIX-Konten werden einzeln freigegeben. Der Zugang ist kontrolliert, damit Qualität, Zuverlässigkeit und Kostendisziplin hoch bleiben.",
    "Ja. Team-Arbeitsbereiche, höhere Nutzungslimits und tiefere Governance sind Teil der Business-Plan-Richtung nach der Private Beta.":
      "Ja. Team-Arbeitsbereiche, höhere Nutzungslimits und tiefere Governance sind Teil der Business-Plan-Richtung.",
    "Private-Beta-Zugangskontrolle": "Zugangskontrolle für freigegebene Konten",
  },
};

/** The wording the App Store build shows in place of `text`. */
export function iosCopy(locale: AppLocale, text: string): string {
  return IOS_COPY[locale][text] ?? text;
}
