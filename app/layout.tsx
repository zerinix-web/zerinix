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
      <head />
      <body className="min-h-full flex flex-col">
        <NativeSplashLifecycle />
        {children}
      </body>
    </html>
  );
}
