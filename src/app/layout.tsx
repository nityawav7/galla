import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { NextIntlClientProvider } from "next-intl";

import { StartObservability } from "@/components/observability/start-observability";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";

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
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_TAGLINE,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page is rendered per request, so each gets its own CSP nonce (SPEC §6.2, ADR 0015).
  await connection();
  return (
    <html
      lang={DEFAULT_LOCALE}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/* Passes the locale and messages to client components (next-intl). */}
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <StartObservability />
      </body>
    </html>
  );
}
