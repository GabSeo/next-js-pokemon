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
  alternates: { canonical: "/" },
};

export default function HomePage() {
  const cards = getAllCards();

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

      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          A card shop built to be read by humans and AI agents alike
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          {SITE_NAME} catalogs Pokémon and One Piece trading cards with a
          live last-sold price tracker. Every page also ships as a plain
          Markdown and JSON mirror, so an AI agent can read exact prices
          without ever rendering the page.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/collections/pokemon"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            Browse Pokémon cards
          </Link>
          <Link
            href="/collections/one-piece"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Browse One Piece cards
          </Link>
        </div>
        <OpenDataLinks markdownHref="/index.md" jsonHref="/api/site" className="pt-2" />
      </section>

      <section className="mt-14 space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">All cards ({cards.length})</h2>
        </div>
        <p className="text-sm text-muted-foreground">
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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
          {cards.map((card) => (
            <CardTile key={card.id} card={card} />
          ))}
        </div>
      </section>

      <section className="mt-14 space-y-3 border-t border-border pt-8">
        <h2 className="text-lg font-semibold">How the price checker works</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Enter any card ID in the tool at the bottom of every page, or visit{" "}
          <Link href="/tools/price-checker" className="underline underline-offset-4">
            the price-checker page
          </Link>{" "}
          directly, to see the last-sold price history, the most recent
          individual sales, add the card to your collection, and subscribe to
          alerts at ±50% price bands.
        </p>
      </section>
    </div>
  );
}
