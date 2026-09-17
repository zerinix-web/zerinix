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
//   3. PRODUCTION_SERVER_URL -- the canonical production origin, used
//      whenever neither override applies.
//
// BUG FIX -- step 3 used to be `undefined`, which made Capacitor bake NO
// server block at all and load the bundled capacitor-web placeholder
// instead. That turned a missing environment variable into a silently
// broken native app: a plain `npx cap sync` (rather than
// `npm run mobile:sync:production`) produced an iOS build that showed the
// placeholder page instead of ZERINIX, and the failure was invisible until
// someone launched the build. Defaulting to production means a normal sync
// can never remove server.url, while both overrides above still work for
// local device testing.
const PRODUCTION_SERVER_URL = "https://zerinix.com";
const explicitDevServerUrl = process.env.CAPACITOR_SERVER_URL?.trim() || undefined;
const canonicalAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || undefined;
const canonicalAppUrlIsProduction = Boolean(canonicalAppUrl && /^https:\/\//i.test(canonicalAppUrl));

// Always a real URL -- never undefined, so the generated native config
// always carries server.url. The explicit `string` annotation keeps that
// invariant checked by the compiler rather than only true at runtime.
const mobileServerUrl: string =
  explicitDevServerUrl ||
  (canonicalAppUrlIsProduction && canonicalAppUrl
    ? canonicalAppUrl
    : PRODUCTION_SERVER_URL);
const mobileServerUsesCleartext = mobileServerUrl.startsWith("http://");

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
  try {
    return new URL(mobileServerUrl).hostname;
  } catch {
    return undefined;
  }
})();
const allowNavigationHostnames = Array.from(
  new Set(
    [mobileServerHostname, "zerinix.com", "www.zerinix.com"].filter(
      (host): host is string => Boolean(host)
    )
  )
);

const config: CapacitorConfig = {
  appId: "com.zerinix.app",
  appName: "ZERINIX",
  webDir: "capacitor-web",
  // Unconditional: mobileServerUrl always resolves to a real URL, so a sync
  // can never generate a native config without server.url.
  server: {
    url: mobileServerUrl,
    cleartext: mobileServerUsesCleartext,
    allowNavigation: allowNavigationHostnames,
  },
  ios: {
    // BUG FIX -- the iOS status bar overlapped the in-app headers even
    // after the web layer was correct (`viewport-fit=cover` in
    // app/layout.tsx plus `env(safe-area-inset-top)` padding on the
    // headers, both confirmed present in the deployed CSS). Root cause is
    // here: `contentInset` maps straight to the WKWebView UIScrollView's
    // `contentInsetAdjustmentBehavior`, and `"automatic"` hands safe-area
    // handling to UIKit -- which makes WebKit report every
    // `env(safe-area-inset-*)` as 0. The app's full-screen shells are
    // `h-[100dvh]` + `overflow-hidden`, so the document never scrolls and
    // UIKit's own adjustment has nothing to inset either: both mechanisms
    // cancel out and content renders under the status bar. `"never"` is
    // Capacitor's own documented default and returns real inset values to
    // the CSS safe-area architecture this app already uses everywhere
    // (bottom navigation, composers, mobile headers). No pixel offsets.
    contentInset: "never",
    // BUG FIX -- confirmed live on a true iOS cold launch: Capacitor's
    // CAPBridgeViewController defaults an unconfigured WKWebView (and
    // its scrollView) to UIColor.systemBackground, which is white/light
    // in the default appearance. That native WebView background is
    // exposed for real, visible time on a cold launch -- during the
    // network round-trip to https://zerinix.com and again in the gap
    // before the page's own content has painted -- producing the
    // reported white flash. Setting it here makes the WebView's native
    // background match the splash's own near-black, so there is never a
    // white surface to expose no matter how that timing lands. iOS-only
    // (nested under `ios`), so Android's own WebView background is
    // completely unaffected.
    backgroundColor: "#050706",
  },
  android: {
    allowMixedContent: mobileServerUsesCleartext,
  },
  // Premium native launch experience -- confirmed live: the web content
  // used to appear the instant the WebView had anything to paint, with
  // no deliberate branded moment beforehand. @capacitor/splash-screen
  // holds the SAME native launch screen (ios/App/App/Base.lproj/
  // LaunchScreen.storyboard on iOS; the windowSplashScreen* theme
  // attributes on Android, see android/app/src/main/res/values/styles.xml)
  // visible after launch, then fades it out.
  //
  // BUG FIX -- launchAutoHide was briefly set to `false`, relying solely
  // on components/NativeSplashLifecycle.tsx to call SplashScreen.hide()
  // once the web app mounts. That call only ever runs from whatever code
  // is ACTUALLY DEPLOYED at https://zerinix.com -- this session never
  // commits/pushes/deploys, so the production site does not yet contain
  // that component, hide() was never reachable, and the splash hung
  // forever (confirmed live). launchAutoHide is restored to `true` with
  // a bounded launchShowDuration as a GUARANTEED native-only fallback
  // that never depends on any web code existing or running. This is not
  // a race back to the original bug: SplashScreen.hide() (native side)
  // already no-ops safely once the splash is already hidden (see
  // node_modules/@capacitor/splash-screen's SplashScreen.swift/.java --
  // `if !isVisible { return }`), so once NativeSplashLifecycle.tsx's own
  // call actually ships to production, it will simply win the race and
  // hide the splash earlier, the instant real content is ready, and this
  // timer's later-scheduled callback becomes a harmless no-op -- not a
  // conflicting double-hide. Until then, this fallback is the only path
  // that ever fires, so the splash still always dismisses. The white-
  // flash fix above (ios.backgroundColor) is independent of this timing
  // and still holds even if this fallback fires before the page has
  // fully painted -- the WebView underneath is near-black either way,
  // never white. launchShowDuration is a safety-net ceiling, not the
  // primary hide trigger, so it's set generously (matching this same
  // plugin's own built-in default `showDuration` of 3000ms elsewhere)
  // rather than tuned as a tight "feels premium" number. This is a
  // shared (not iOS-only) plugin setting, so it also restores the
  // identical, already-working fallback on Android -- a safe, compatible
  // change there since Android's hide() path guards the same way. No app
  // code outside SplashScreen config/the existing hide() call changed,
  // so auth/session logic and the Home/Login routing decision remain
  // completely untouched.
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 3000,
      backgroundColor: "#050706",
      showSpinner: false,
    },
  },
};

export default config;
