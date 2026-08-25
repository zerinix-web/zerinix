import type { CapacitorConfig } from "@capacitor/cli";

// CRITICAL FIX -- confirmed live: this used to fall back to a hardcoded
// LAN IP ("http://172.20.10.13:3000") whenever neither env var below was
// set, silently baking one developer's one-time WiFi address into
// version control. Every subsequent `cap sync` (including the one that
// produced the physical-device build reported as a black screen /
// NSURLErrorDomain -1001 timeout) reproduced that same dead address --
// the phone was never actually trying to reach production, and a Mac
// localhost/LAN dev server is never reachable from a physical device
// once it's off that specific network. Capacitor's native shell has no
// concept of "localhost relative to the Mac" either: on a physical
// device, "localhost" means the device itself, so NEXT_PUBLIC_APP_URL's
// own local-dev value (http://localhost:3000, see .env.local) is just as
// wrong a default here as the LAN IP was.
//
// Resolution order:
//   1. CAPACITOR_SERVER_URL -- explicit, developer-supplied override for
//      local development ONLY (e.g. physical-device live reload:
//      `CAPACITOR_SERVER_URL=http://<mac-lan-ip>:3000 npm run mobile:sync`).
//      Never commit a real value for this -- export it per dev session,
//      since a LAN IP is only valid on one network at a time.
//   2. NEXT_PUBLIC_APP_URL -- this repo's own already-established
//      canonical app-base-url convention (already required for Stripe
//      billing callbacks and transactional email links, see
//      app/lib/integrations/config.ts) -- trusted here ONLY when it
//      resolves to a genuine https:// URL, i.e. a real deployed
//      environment, never a local http://localhost value.
//   3. undefined -- Capacitor then loads the bundled capacitor-web
//      placeholder page instead of attempting any network request. That
//      page explicitly says "Connect the native app to a production
//      ZERINIX URL before release" -- a visible, honest signal that the
//      URL was never configured, instead of a silent black-screen
//      timeout against a stale address.
const explicitDevServerUrl = process.env.CAPACITOR_SERVER_URL?.trim() || undefined;
const canonicalAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || undefined;
const canonicalAppUrlIsProduction = Boolean(canonicalAppUrl && /^https:\/\//i.test(canonicalAppUrl));

const mobileServerUrl =
  explicitDevServerUrl || (canonicalAppUrlIsProduction ? canonicalAppUrl : undefined);
const mobileServerUsesCleartext = mobileServerUrl?.startsWith("http://") ?? false;

// CRITICAL FIX -- confirmed live: https://zerinix.com returns an HTTP 308
// redirect to https://www.zerinix.com (Vercel's standard apex-to-www
// canonicalization). Capacitor's native WKWebView navigation delegate
// (WebViewDelegationHandler.swift) only keeps a top-level navigation
// inside the WebView when the target host is either the exact configured
// server.url or explicitly listed in server.allowNavigation -- any other
// top-level navigation is treated as "external" and handed to
// UIApplication.shared.open(), i.e. Safari. The redirect's destination
// host (www.zerinix.com) matched neither, so the very first load bounced
// straight out to Safari instead of rendering in-app. Whitelisting both
// the apex and its own www redirect target keeps ZERINIX's own origin
// entirely inside the app; every other host (mailto: links, unrelated
// third-party sites) is intentionally left to fall through to Safari.
const mobileServerHostname = (() => {
  if (!mobileServerUrl) return undefined;
  try {
    return new URL(mobileServerUrl).hostname;
  } catch {
    return undefined;
  }
})();
const allowNavigationHostnames = mobileServerUrl
  ? Array.from(new Set([mobileServerHostname, "zerinix.com", "www.zerinix.com"].filter((host): host is string => Boolean(host))))
  : undefined;

const config: CapacitorConfig = {
  appId: "com.zerinix.app",
  appName: "ZERINIX",
  webDir: "capacitor-web",
  server: mobileServerUrl
    ? {
        url: mobileServerUrl,
        cleartext: mobileServerUsesCleartext,
        allowNavigation: allowNavigationHostnames,
      }
    : undefined,
  ios: {
    contentInset: "automatic",
  },
  android: {
    allowMixedContent: mobileServerUsesCleartext,
  },
};

export default config;
