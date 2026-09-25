import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getRequestLocale } from "@/app/lib/i18n/server";
import { NativeSplashLifecycle } from "@/components/NativeSplashLifecycle";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ZERINIX",
  description: "A premium AI operating system for founders.",
};

// BUG FIX -- iOS status bar overlapped the in-app headers. Capacitor's
// WKWebView lays the page out behind the status bar, but without
// `viewport-fit=cover` every `env(safe-area-inset-*)` value resolves to
// 0, so the safe-area padding this app already uses (bottom navigation,
// composers, mobile headers) had nothing to read and content rendered
// underneath the status bar / home indicator. `width` and `initialScale`
// restate Next's own defaults, because declaring this export replaces the
// default viewport meta rather than extending it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Matches the root background and Capacitor's native ios.backgroundColor,
  // so the status-bar area and any native chrome stay on the app's own dark
  // surface rather than defaulting to white.
  themeColor: "#050706",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Runs before the body paints, so the App Store build never shows a
            frame of website-only copy before swapping it. The Capacitor bridge
            injects window.Capacitor at document start, so it is already
            readable here.

            Two jobs, both iOS-only and both no-ops on the web, where
            window.Capacitor does not exist:

            1. Mark the document, which app/globals.css uses to choose between
               .zx-web-only and .zx-ios-only copy. NativeSplashLifecycle also
               adds this class after hydration; adding it here as well is
               idempotent and simply earlier.

            2. Send a cold launch to the sign-in screen. The shell's server.url
               has no path, so every launch loads "/" -- the public marketing
               page. An installed application opening on its own marketing site
               is a large part of what made the build read as pre-release.

               This cannot affect a signed-in user: app/page.tsx verifies the
               session server-side and redirects to /dashboard before this
               document is ever produced, so by the time this script runs the
               request had no session. It grants nothing and checks nothing --
               /login enforces exactly the authorization it always did.

               It is invisible in practice: the redirect happens before React
               hydrates, so NativeSplashLifecycle's SplashScreen.hide() cannot
               have run yet and the native splash still covers the transition.

               An inline <head> script only runs on a full document load, so it
               cannot see a next/link navigation to "/" from inside the app.
               components/HomeLink.tsx covers that half, with CSS rather than
               script, so the two together leave no route to the marketing page
               on iOS. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var c=window.Capacitor;' +
              'if(c&&typeof c.getPlatform==="function"&&c.getPlatform()==="ios"){' +
              'document.documentElement.classList.add("zx-native-ios");' +
              'if(location.pathname==="/"){location.replace("/login");}' +
              '}}catch(e){}',
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-[color:var(--background)]">
        <NativeSplashLifecycle />
        {children}
      </body>
    </html>
  );
}
