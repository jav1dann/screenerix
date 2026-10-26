import type { Metadata, Viewport } from "next";
import { Archivo, Inter } from "next/font/google";
import "./globals.css";
import "@/styles/landing.css";
import "@/styles/billing.css";
import "@/styles/account.css";
import "@/styles/terminal.css";

const archivo = Archivo({
  variable: "--font-archivo",
  // latin-ext: Turkish and Azerbaijani letters (ğ, ş, ı, ə) on the localized landing pages.
  subsets: ["latin", "latin-ext"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
});

/**
 * Archivo has no Cyrillic: Russian landing text uses Inter's Cyrillic subset (Latin letters and
 * digits still come from Archivo — see `.lx-root:lang(ru)`). No metric fallback: it would be a
 * full local font that swallows the Latin glyphs too.
 */
const cyrillic = Inter({
  variable: "--font-cyr",
  subsets: ["cyrillic"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  // Resolves canonical / hreflang URLs (set AUTH_URL to the public origin in production).
  metadataBase: new URL(process.env.AUTH_URL || "http://localhost:3000"),
  title: "Screenerix — Real-time crypto screener & trading terminal",
  description:
    "Live charts, order book walls, cross-exchange spreads and funding — streamed from every major venue into one fast, focused terminal.",
};

export const viewport: Viewport = {
  themeColor: "#0B0C0E",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${cyrillic.variable}`}>
      <body>{children}</body>
    </html>
  );
}
