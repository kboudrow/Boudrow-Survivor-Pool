import type { Metadata } from "next";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { cleanEnvValue } from "@/lib/env";
import { SITE_URL } from "@/lib/site";

const enableAdsense = process.env.NEXT_PUBLIC_ENABLE_ADSENSE === "true";
const adsenseClient = cleanEnvValue(process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT || process.env.NEXT_PUBLIC_ADSENSE_CLIENT);
const shouldLoadAdsense = enableAdsense && Boolean(adsenseClient && /^ca-pub-\d+$/.test(adsenseClient));

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Survive Sunday",
    template: "%s | Survive Sunday",
  },
  description: "Create, join, and manage NFL survivor pools with automatic pick locks, standings, and commissioner tools.",
  icons: {
    icon: [
      { url: "/favicon.ico?v=3", sizes: "any" },
      { url: "/icon.png?v=3", type: "image/png", sizes: "32x32" },
    ],
    shortcut: "/favicon.ico?v=3",
    apple: [{ url: "/apple-touch-icon.png?v=3", type: "image/png", sizes: "180x180" }],
  },
  openGraph: {
    title: "Survive Sunday",
    description: "Create, join, and manage NFL survivor pools with automatic pick locks, standings, and commissioner tools.",
    url: SITE_URL,
    siteName: "Survive Sunday",
    images: ["/survive-sunday-logo.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Survive Sunday",
    description: "Create, join, and manage NFL survivor pools with automatic pick locks, standings, and commissioner tools.",
    images: ["/survive-sunday-logo.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-slate-50 text-slate-950 antialiased">
        {shouldLoadAdsense && (
          <Script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient}`}
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
        <AppHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
