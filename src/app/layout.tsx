import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { NavMenu } from "@/components/nav-menu";
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
  title: "Stock Research",
  description: "個別株リサーチ・ダッシュボード（リアルタイム）",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
        <header className="border-b border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 relative">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-bold text-lg tracking-tight">
              Stock Research
            </Link>
            <NavMenu />
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
          {children}
        </main>
        <footer className="border-t border-black/10 dark:border-white/10 py-4 text-center text-xs text-neutral-500">
          価格: Yahoo Finance（リアルタイム） / マクロ: Stooq + FRED / 財務: J-Quants v2
        </footer>
      </body>
    </html>
  );
}
