import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";

export const metadata: Metadata = {
  title: {
    default: "Survivor Pool",
    template: "%s | Survivor Pool",
  },
  description: "Create, join, and manage NFL survivor pools with automatic pick locks, standings, and commissioner tools.",
  other: {
    "google-adsense-account": "ca-pub-7635962482487315",
  },
};

const adsenseClient = (process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT || process.env.NEXT_PUBLIC_ADSENSE_CLIENT || "")
  .replace(/\uFEFF/g, "")
  .trim();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-950 antialiased">
        {adsenseClient && (
          <Script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
        )}
        <AppHeader />
        <div>{children}</div>
      </body>
    </html>
  );
}
