import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCollectionButton } from "@/components/add-to-collection-button";
import { AlertSubscribe } from "@/components/alert-subscribe";
import { CardImage } from "@/components/card-image";
import { OpenDataLinks } from "@/components/open-data-links";
import { PriceChart } from "@/components/price-chart";
import { StructuredData } from "@/components/structured-data";
import { computeAlertBands, franchiseLabel, getAllCards, getCardBySlug } from "@/lib/cards";
import { absoluteUrl } from "@/lib/site";

export function generateStaticParams() {
  return getAllCards().map((card) => ({ slug: card.slug }));
}

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const card = getCardBySlug(slug);
  if (!card) return {};
  return {
    title: `${card.name} (${card.number}) price`,
    description: `${card.name} — ${card.set} ${card.number}. Last sold for ${card.currency} ${card.lastSoldPrice} on ${card.lastSoldDate}.`,
    alternates: {
      canonical: `/products/${card.slug}`,
      types: { "text/markdown": `/products/${card.slug}/index.md` },
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;
  const card = getCardBySlug(slug);
  if (!card) notFound();

  const label = franchiseLabel(card.franchise);
  const bands = computeAlertBands(card.currentPrice);

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: card.name,
    sku: card.id,
    category: label,
    description: card.description,
    url: absoluteUrl(`/products/${card.slug}`),
    offers: {
      "@type": "Offer",
      price: card.lastSoldPrice,
      priceCurrency: card.currency,
      priceValidUntil: card.lastSoldDate,
      availability: "https://schema.org/InStock",
      url: absoluteUrl(`/products/${card.slug}`),
    },
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      {
        "@type": "ListItem",
        position: 2,
        name: `${label} collection`,
        item: absoluteUrl(`/collections/${card.franchise}`),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: card.name,
        item: absoluteUrl(`/products/${card.slug}`),
      },
    ],
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `How much is ${card.name} (${card.number}) worth right now?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `The last recorded sale for ${card.name} (${card.set}, ${card.number}) was ${card.currency} ${card.lastSoldPrice} on ${card.lastSoldDate}.`,
        },
      },
    ],
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <StructuredData data={productJsonLd} />
      <StructuredData data={breadcrumbJsonLd} />
      <StructuredData data={faqJsonLd} />

      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground hover:underline">
          Home
        </Link>
        <span className="px-1.5">/</span>
        <Link href={`/collections/${card.franchise}`} className="hover:text-foreground hover:underline">
          {label}
        </Link>
        <span className="px-1.5">/</span>
        <span>{card.name}</span>
      </nav>

      <div className="grid grid-cols-1 gap-8 sm:grid-cols-[280px_1fr]">
        <CardImage card={card} className="w-full max-w-[280px] rounded-xl" />

        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {card.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {card.set} ({card.setCode}) · {card.number} · {card.rarity} ·
              Card ID: {card.id}
            </p>
          </div>

          <p className="max-w-2xl text-sm">
            The last recorded sale for {card.name} ({card.set}, {card.number})
            was <strong>{card.currency} {card.lastSoldPrice}</strong> on{" "}
            <strong>{card.lastSoldDate}</strong>.
          </p>

          <p className="max-w-2xl text-sm text-muted-foreground">
            {card.description}
          </p>

          <OpenDataLinks
            markdownHref={`/products/${card.slug}/index.md`}
            jsonHref={`/api/${card.franchise}/${card.id}`}
          />

          <AddToCollectionButton cardId={card.id} />
        </div>
      </div>

      <section className="mt-12 space-y-4 border-t border-border pt-8">
        <h2 className="text-lg font-semibold">Price history</h2>
        <PriceChart history={card.priceHistory} currency={card.currency} className="w-full max-w-2xl" />
        <table className="w-full max-w-md text-sm">
          <caption className="sr-only">Monthly price history for {card.name}</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-normal">Date</th>
              <th className="py-1 font-normal">Price</th>
            </tr>
          </thead>
          <tbody>
            {card.priceHistory.map((point) => (
              <tr key={point.date} className="border-t border-border">
                <td className="py-1.5">{point.date}</td>
                <td className="py-1.5">
                  {card.currency} {point.price}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-12 space-y-4 border-t border-border pt-8">
        <h2 className="text-lg font-semibold">Last sold items</h2>
        <table className="w-full max-w-2xl text-sm">
          <caption className="sr-only">Most recent sales for {card.name}</caption>
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
                <td className="py-1.5">
                  {card.currency} {sale.price}
                </td>
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
      </section>

      <section className="mt-12 space-y-4 border-t border-border pt-8">
        <h2 className="text-lg font-semibold">Price alerts</h2>
        <AlertSubscribe cardId={card.id} currency={card.currency} bands={bands} />
      </section>
    </div>
  );
}
