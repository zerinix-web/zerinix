import {
  autoLocaleCookieName,
  defaultLocale,
  localeCookieName,
  manualLocaleCookieName,
  supportedLocales,
  type AppLocale,
} from "@/app/lib/i18n/config";

function buildBrowserLocaleScript(serverLocale: AppLocale) {
  return `
(function () {
  var supported = ${JSON.stringify(supportedLocales)};
  var fallback = ${JSON.stringify(defaultLocale)};
  var manualCookie = ${JSON.stringify(localeCookieName)};
  var manualMarkerCookie = ${JSON.stringify(manualLocaleCookieName)};
  var autoCookie = ${JSON.stringify(autoLocaleCookieName)};
  var maxAge = 60 * 60 * 24 * 365;

  function readCookie(name) {
    return document.cookie
      .split("; ")
      .find(function (row) { return row.indexOf(name + "=") === 0; })
      ?.split("=")[1] || "";
  }

  function normalize(value) {
    var base = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
    return supported.indexOf(base) >= 0 ? base : fallback;
  }

  if (readCookie(manualMarkerCookie) === "1" && readCookie(manualCookie)) {
    return;
  }

  var languages = navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language || fallback];
  var detected = fallback;

  for (var i = 0; i < languages.length; i += 1) {
    var candidate = normalize(languages[i]);
    if (candidate !== fallback || String(languages[i] || "").toLowerCase().indexOf(fallback) === 0) {
      detected = candidate;
      break;
    }
  }

  if (readCookie(autoCookie) !== detected) {
    document.cookie = autoCookie + "=" + detected + "; path=/; max-age=" + maxAge + "; samesite=lax";
  }

  if (${JSON.stringify(serverLocale)} !== detected) {
    window.location.replace(window.location.href);
  }
})();`;
}

export default function BrowserLocaleScript({
  locale,
}: {
  locale: AppLocale;
}) {
  return (
    <script
      dangerouslySetInnerHTML={{ __html: buildBrowserLocaleScript(locale) }}
    />
  );
}
