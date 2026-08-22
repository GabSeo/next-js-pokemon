import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { MasterballBg } from "@/components/retro/masterball-bg";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { StructuredData } from "@/components/structured-data";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/site";

// Weights 400/700/900, matching design.md's type scale exactly (400 body,
// 700 labels, 900 headings) — same three weights the mockup pulls from
// Google Fonts directly.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "700", "900"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Pokémon & One Piece card prices`,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/", types: { "text/markdown": "/index.md" } },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    sameAs: [],
  };

  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <head>
        <StructuredData data={organizationJsonLd} />
        <link rel="ai-catalog" href={absoluteUrl("/.well-known/ai-catalog.json")} />
      </head>
      <body className="min-h-full flex flex-col">
        <MasterballBg />
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
