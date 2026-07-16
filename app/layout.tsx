import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getRequestLocale } from "@/app/lib/i18n/server";
import BrowserLocaleScript from "@/components/BrowserLocaleScript";
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
        <BrowserLocaleScript locale={locale} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
