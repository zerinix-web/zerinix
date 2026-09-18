"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";

// BUG FIX -- confirmed live on a true iOS cold launch: capacitor.config.ts
// used to set `launchAutoHide: true` with a fixed `launchShowDuration`,
// so the native ZERINIX splash was dismissed unconditionally on a timer
// -- regardless of whether the WKWebView had actually finished loading
// and painting https://zerinix.com yet. On a real cold start (DNS, TLS,
// a cold server function, then hydration), that load routinely takes
// longer than the fixed timer, so the splash disappeared first and
// exposed the WebView's own blank background underneath for a visible
// stretch -- the reported white flash. (The WebView's own background is
// fixed separately via `ios.backgroundColor` in capacitor.config.ts, but
// that alone doesn't help if the splash is already gone before content
// arrives.)
//
// This component renders nothing -- it only tells the native splash to
// hide the moment THIS web app has actually mounted in the browser,
// which only happens once real page content has already parsed and
// painted. That replaces the fixed-timer guess with "hide when actually
// ready," so the dark splash stays up for exactly as long as needed and
// never artificially longer. It is a total no-op outside the native
// Capacitor shell (Capacitor.isNativePlatform() is false on the desktop/
// web build), so normal web/desktop behavior, auth/session logic, and
// the Home/Login UI are completely untouched.
export function NativeSplashLifecycle() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    // Marks the document as running inside the iOS Capacitor shell so
    // app/globals.css can clamp --zx-status-bar to a real status-bar height
    // there. Scoped to iOS because it is the iOS WebView that reports
    // env(safe-area-inset-top) as 0 under contentInset "automatic"; web,
    // desktop and Android never get the class and keep pure env() behaviour.
    if (Capacitor.getPlatform() === "ios") {
      document.documentElement.classList.add("zx-native-ios");
    }

    SplashScreen.hide().catch(() => {
      // Nothing meaningful to recover here -- the native splash simply
      // stays until the OS itself moves on. Never throw into the app's
      // own render tree over a cosmetic native bridge call.
    });
  }, []);

  return null;
}
