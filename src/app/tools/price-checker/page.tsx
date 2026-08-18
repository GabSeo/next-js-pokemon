import type { Metadata } from "next";
import Link from "next/link";
import { AddToCollectionButton } from "@/components/add-to-collection-button";
import { AlertSubscribe } from "@/components/alert-subscribe";
import { OpenDataLinks } from "@/components/open-data-links";
import { PriceCheckerForm } from "@/components/price-checker-form";
import { PriceChart } from "@/components/price-chart";
import { StructuredData } from "@/components/structured-data";
import { computeAlertBands, findCard, franchiseLabel, getAllCards } from "@/lib/cards";
import { SITE_NAME, absoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Price checker",
  description:
    "Enter a Pokémon or One Piece card ID to see last-sold prices, price history, and set a price alert.",
  alternates: { canonical: "/tools/price-checker" },
};

type PageProps = { searchParams: Promise<{ cardId?: string }> };

export default async function PriceCheckerPage({ searchParams }: PageProps) {
  const { cardId } = await searchParams;
  const card = cardId ? findCard(cardId) : undefined;
  const bands = card ? computeAlertBands(card.currentPrice) : [];

  const webAppJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: `${SITE_NAME} price checker`,
    url: absoluteUrl("/tools/price-checker"),
    applicationCategory: "Price tracking tool",
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    potentialAction: {
      "@type": "SearchAction",
      target: `${absoluteUrl("/tools/price-checker")}?cardId={cardId}`,
      "query-input": "required name=cardId",
    },
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <StructuredData data={webAppJsonLd} />

      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Price checker
      </h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Enter a card ID (e.g. <code>base1-4</code> or <code>op01-025</code>)
        to see last-sold prices. Works without JavaScript — this is a
        standard HTML form.
      </p>

      <div className="mt-6">
        <PriceCheckerForm defaultValue={cardId} />
      </div>

      <OpenDataLinks
        markdownHref="/tools/price-checker.md"
        jsonHref={`/api/price-check${cardId ? `?cardId=${encodeURIComponent(cardId)}` : ""}`}
        className="mt-4"
      />

      {cardId && !card && (
        <p className="mt-8 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          No card found for &ldquo;{cardId}&rdquo;. Try one of the IDs listed
          below.
        </p>
      )}

      {card && (
        <div className="mt-8 space-y-8 border-t border-border pt-8">
          <div>
            <h2 className="text-lg font-semibold">
              <Link href={`/products/${card.slug}`} className="hover:underline">
                {card.name}
              </Link>{" "}
              <span className="font-normal text-muted-foreground">
                — {franchiseLabel(card.franchise)}, {card.set} ({card.number})
              </span>
            </h2>
            <p className="mt-1 text-sm">
              Last sold for <strong>{card.currency} {card.lastSoldPrice}</strong> on{" "}
              <strong>{card.lastSoldDate}</strong>.
            </p>
          </div>

          <PriceChart history={card.priceHistory} currency={card.currency} className="w-full max-w-xl" />

          <div>
            <h3 className="text-sm font-semibold">Last sold items</h3>
            <table className="mt-2 w-full max-w-xl text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 font-normal">Date</th>
                  <th className="py-1 font-normal">Price</th>
                  <th className="py-1 font-normal">Condition</th>
                  <th className="py-1 font-normal">Source</th>
                </tr>
              </thead>
              <tbody>
                {card.recentSales.map((sale) => (
                  <tr key={`${sale.date}-${sale.price}`} className="border-t border-border">
                    <td className="py-1.5">{sale.date}</td>
                    <td className="py-1.5">{card.currency} {sale.price}</td>
                    <td className="py-1.5">{sale.condition}</td>
                    <td className="py-1.5">
                      <a href={sale.url} className="underline underline-offset-4">
                        {sale.source}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <AddToCollectionButton cardId={card.id} />

          <div>
            <h3 className="text-sm font-semibold">Price alerts</h3>
            <div className="mt-2">
              <AlertSubscribe cardId={card.id} currency={card.currency} bands={bands} />
            </div>
          </div>
        </div>
      )}

      <div className="mt-12 border-t border-border pt-6">
        <h3 className="text-sm font-semibold">Available card IDs</h3>
        <ul className="mt-2 grid grid-cols-2 gap-1 text-sm text-muted-foreground sm:grid-cols-3">
          {getAllCards().map((c) => (
            <li key={c.id}>
              <Link href={`/tools/price-checker?cardId=${c.id}`} className="hover:text-foreground hover:underline">
                {c.id} — {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
