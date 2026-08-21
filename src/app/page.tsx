import Link from "next/link";
import type { Metadata } from "next";
import { CardTile } from "@/components/card-tile";
import { OpenDataLinks } from "@/components/open-data-links";
import { StructuredData } from "@/components/structured-data";
import { getAllCards } from "@/lib/cards";
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: `${SITE_NAME} — Pokémon & One Piece card prices`,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/", types: { "text/markdown": "/index.md" } },
};

// 36 hours (must be a literal — Next.js statically parses this export).
// Kept in sync with apitcg.ts's REVALIDATE_SECONDS — see the comment there
// on why this window is sized around the API's monthly call quota, not just
// data freshness.
export const revalidate = 129600;

export default async function HomePage() {
  const cards = await getAllCards();

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    description: SITE_DESCRIPTION,
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <StructuredData data={websiteJsonLd} />

      <section className="space-y-6">
        <h1 className="text-[40px] font-normal leading-none tracking-[0.025em] sm:text-[48px] lg:text-[54px]">
          A card shop built to be read by humans and AI agents alike
        </h1>
        <p className="max-w-2xl text-base leading-[1.2] text-muted-foreground">
          {SITE_NAME} catalogs Pokémon and One Piece trading cards with live
          market pricing. Every page also ships as a plain Markdown and JSON
          mirror, so an AI agent can read exact prices without ever
          rendering the page.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/collections/pokemon"
            className="rounded-full bg-primary px-4 py-2 text-xs font-normal uppercase tracking-[0.08em] text-primary-foreground hover:bg-primary/80"
          >
            Browse Pokémon cards
          </Link>
          <Link
            href="/collections/one-piece"
            className="rounded-full border border-border px-4 py-2 text-xs font-normal uppercase tracking-[0.08em] hover:border-border-hover hover:bg-muted"
          >
            Browse One Piece cards
          </Link>
        </div>
        <OpenDataLinks markdownHref="/index.md" jsonHref="/api/site" okfHref="/okf/home" />
      </section>

      <section className="mt-20 space-y-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[26px] font-medium uppercase leading-[1.2] tracking-[0.18em]">
            All cards ({cards.length})
          </h2>
        </div>
        <p className="text-base leading-[1.2] text-muted-foreground">
          Two separate catalogs — Pokémon and One Piece are tracked as
          distinct groups, each with its own{" "}
          <Link href="/collections/pokemon" className="underline underline-offset-4">
            Pokémon collection
          </Link>{" "}
          and{" "}
          <Link href="/collections/one-piece" className="underline underline-offset-4">
            One Piece collection
          </Link>
          .
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          {cards.map((card) => (
            <CardTile key={card.id} card={card} />
          ))}
        </div>
      </section>

      <section className="mt-20 space-y-3 border-t border-border pt-3">
        <h2 className="text-[26px] font-medium uppercase leading-[1.2] tracking-[0.18em]">
          How the price checker works
        </h2>
        <p className="max-w-2xl text-base leading-[1.2] text-muted-foreground">
          Enter any card ID in the tool at the bottom of every page, or visit{" "}
          <Link href="/tools/price-checker" className="underline underline-offset-4">
            the price-checker page
          </Link>{" "}
          directly, to see price history, recent daily price snapshots, add
          the card to your collection, and subscribe to alerts at price
          bands from -75% to +150% in 25% steps.
        </p>
      </section>
    </div>
  );
}
