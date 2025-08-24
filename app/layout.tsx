import type { Metadata } from "next";
import "./globals.css";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Survivor Pool",
  description: "NFL Survivor Pool",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-black">
        {/* Global Header (shows on every page) */}
        <header className="w-full border-b border-gray-200">
          <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
            <Link href="/" className="flex items-center gap-3">
              {/* Football logo from /public/football.png */}
              <Image
                src="/football.png"
                alt="Football"
                width={40}
                height={40}
                priority
              />
              <span className="text-xl font-bold">Survivor Pool</span>
            </Link>
          </div>
        </header>

        {/* Page content */}
        <div className="mx-auto max-w-5xl px-4">{children}</div>
      </body>
    </html>
  );
}

