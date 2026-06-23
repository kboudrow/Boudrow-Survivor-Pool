import type { Metadata } from "next";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";

const enableAdsense = process.env.NEXT_PUBLIC_ENABLE_ADSENSE === "true";
const adsenseClient = (process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT || process.env.NEXT_PUBLIC_ADSENSE_CLIENT || "ca-pub-7635962482487315")
  .replace(/\uFEFF/g, "")
  .trim();

export const metadata: Metadata = {
  metadataBase: new URL("https://www.survivesunday.com"),
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
    url: "https://www.survivesunday.com",
    siteName: "Survive Sunday",
    images: ["/survive-sunday-logo.png"],
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-950 antialiased">
        {enableAdsense && (
          <Script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient}`}
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
        <AppHeader />
        <div>{children}</div>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
