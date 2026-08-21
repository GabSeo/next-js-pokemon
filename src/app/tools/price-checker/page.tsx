import type { Metadata } from "next";
import Link from "next/link";
import { AddToCollectionButton } from "@/components/add-to-collection-button";
import { AlertSubscribe } from "@/components/alert-subscribe";
import { OpenDataLinks } from "@/components/open-data-links";
import { PriceCheckerForm } from "@/components/price-checker-form";
import { PriceChart } from "@/components/price-chart";
import { PriceDataTabs } from "@/components/price-data-tabs";
import { StructuredData } from "@/components/structured-data";
import { computeAlertBands, findCard, franchiseLabel } from "@/lib/cards";
import { SITE_NAME, absoluteUrl } from "@/lib/site";
import { cardRefs } from "@/data/card-refs";

type PageProps = { searchParams: Promise<{ cardId?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { cardId } = await searchParams;
  const card = cardId ? await findCard(cardId) : undefined;
  const markdownHref = card
    ? `/tools/price-checker.md?cardId=${encodeURIComponent(cardId!)}`
    : "/tools/price-checker.md";

  return {
    title: card ? `${card.name} price checker` : "Price checker",
    description: card
      ? `${card.name} — current market price ${card.currency} ${card.currentPrice} as of ${card.asOfDate}.`
      : "Enter a Pokémon or One Piece card ID to see current market prices, price history, and set a price alert.",
    alternates: {
      canonical: "/tools/price-checker",
      types: { "text/markdown": markdownHref },
    },
  };
}

export default async function PriceCheckerPage({ searchParams }: PageProps) {
  const { cardId } = await searchParams;
  const card = cardId ? await findCard(cardId) : undefined;
  const bands = card ? computeAlertBands(card.currentPrice) : [];

  const webAppJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: `${SITE_NAME} price checker`,
    url: absoluteUrl("/tools/price-checker"),
    applicationCategory: "Price tracking tool",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    potentialAction: {
      "@type": "SearchAction",
      target: `${absoluteUrl("/tools/price-checker")}?cardId={cardId}`,
      "query-input": "required name=cardId",
    },
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <StructuredData data={webAppJsonLd} />

      <h1 className="text-[32px] leading-tight font-black tracking-[-1px] sm:text-[40px]">
        Price checker
      </h1>
      <p className="mt-3 max-w-xl text-base leading-6 text-muted-text">
        Enter a card ID (see the list below) to see current market prices.
        Works without JavaScript — this is a standard HTML form.
      </p>

      <div className="mt-6">
        <PriceCheckerForm defaultValue={cardId} />
      </div>

      <OpenDataLinks
        markdownHref={`/tools/price-checker.md${cardId ? `?cardId=${encodeURIComponent(cardId)}` : ""}`}
        jsonHref={`/api/price-check${cardId ? `?cardId=${encodeURIComponent(cardId)}` : ""}`}
        okfHref={`/okf/tools/price-checker${cardId ? `?cardId=${encodeURIComponent(cardId)}` : ""}`}
        className="mt-5"
      />

      {cardId && !card && (
        <p className="mt-8 rounded-lg border-2 border-black bg-pokemon-red/10 px-4 py-3 text-sm font-bold text-pokemon-red shadow-hard-sm">
          No card found for &ldquo;{cardId}&rdquo;. Try one of the IDs listed
          below.
        </p>
      )}

      {card && (
        <div className="mt-10 space-y-8 border-t-2 border-black pt-8">
          <div>
            <h2 className="text-2xl font-black tracking-[-0.6px]">
              <Link href={`/products/${card.slug}`} className="hover:underline">
                {card.name}
              </Link>{" "}
              <span className="font-bold text-muted-text">
                — {franchiseLabel(card.franchise)}, {card.set} ({card.number ?? ""})
              </span>
            </h2>
            <p className="mt-2 text-sm">
              Current market price: <strong><data value={String(card.currentPrice)} className="tabular-nums">{card.currency} {card.currentPrice}</data></strong> as of{" "}
              <strong>{card.asOfDate}</strong>.
            </p>
          </div>

          {card.priceHistory.length > 0 && (
            <PriceChart
              history={card.priceHistory}
              currency={card.currency}
              trend={card.trend}
              className="w-full"
            />
          )}

          <PriceDataTabs
            currency={card.currency}
            recentSnapshots={card.recentSnapshots}
            trend={card.trend}
            priceRange={card.priceRange}
          />

          <AddToCollectionButton cardId={card.id} />

          <div>
            <h3 className="text-lg font-black tracking-[-0.5px]">Price alerts</h3>
            <div className="mt-3">
              <AlertSubscribe cardId={card.id} currency={card.currency} bands={bands} />
            </div>
          </div>
        </div>
      )}

      <div className="mt-16 border-t-2 border-black pt-8">
        <h3 className="text-lg font-black tracking-[-0.5px]">Available card IDs</h3>
        <ul className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold text-muted-text sm:grid-cols-3">
          {cardRefs.map((ref) => (
            <li key={ref.slug}>
              <Link href={`/tools/price-checker?cardId=${ref.slug}`} className="hover:text-foreground hover:underline">
                {ref.slug} — {ref.displayName}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
