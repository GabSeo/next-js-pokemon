import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCollectionButton } from "@/components/add-to-collection-button";
import { AlertSubscribe } from "@/components/alert-subscribe";
import { CardImage } from "@/components/card-image";
import { OpenDataLinks } from "@/components/open-data-links";
import { PriceChart } from "@/components/price-chart";
import { PriceDataTabs } from "@/components/price-data-tabs";
import { StructuredData } from "@/components/structured-data";
import { computeAlertBands, franchiseLabel, getAllCards, getCardBySlug } from "@/lib/cards";
import { absoluteUrl } from "@/lib/site";

// 36 hours (must be a literal — Next.js statically parses this export).
// Kept in sync with apitcg.ts's REVALIDATE_SECONDS.
export const revalidate = 129600;

export async function generateStaticParams() {
  const cards = await getAllCards();
  return cards.map((card) => ({ slug: card.slug }));
}

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const card = await getCardBySlug(slug);
  if (!card) return {};
  return {
    title: `${card.name} (${card.number ?? ""}) price`,
    description: `${card.name} — ${card.set} ${card.number ?? ""}. Current market price: ${card.currency} ${card.currentPrice} as of ${card.asOfDate}.`,
    alternates: {
      canonical: `/products/${card.slug}`,
      types: { "text/markdown": `/products/${card.slug}/index.md` },
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;
  const card = await getCardBySlug(slug);
  if (!card) notFound();

  const label = franchiseLabel(card.franchise);
  const bands = computeAlertBands(card.currentPrice);

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: card.name,
    sku: card.id,
    category: label,
    description: card.description ?? `${card.name} — ${card.set} ${card.number ?? ""}`,
    url: absoluteUrl(`/products/${card.slug}`),
    offers: {
      "@type": "Offer",
      price: card.currentPrice,
      priceCurrency: card.currency,
      priceValidUntil: card.asOfDate,
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
        name: `How much is ${card.name} (${card.number ?? ""}) worth right now?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `The current market price for ${card.name} (${card.set}, ${card.number ?? ""}) is ${card.currency} ${card.currentPrice} as of ${card.asOfDate}, sourced from TCGPlayer.`,
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
        <CardImage
          card={card}
          className="w-full max-w-[280px] rounded-xl"
          priority
          showCaption
        />

        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {card.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {card.set}
              {card.setCode ? ` (${card.setCode})` : ""} · {card.number ?? ""}
              {card.rarity ? ` · ${card.rarity}` : ""} · Card ID: {card.id}
            </p>
          </div>

          <p className="max-w-2xl text-sm">
            The current market price for {card.name} ({card.set}, {card.number ?? ""})
            is <strong>{card.currency} {card.currentPrice}</strong> as of{" "}
            <strong>{card.asOfDate}</strong>
            {card.sourceUrl ? (
              <>
                , sourced from{" "}
                <a href={card.sourceUrl} className="underline underline-offset-4">
                  TCGPlayer
                </a>
              </>
            ) : null}
            .
          </p>

          {card.description && (
            <p className="max-w-2xl text-sm text-muted-foreground">
              {card.description}
            </p>
          )}

          <OpenDataLinks
            markdownHref={`/products/${card.slug}/index.md`}
            jsonHref={`/api/${card.franchise}/${card.id}`}
          />

          <AddToCollectionButton cardId={card.id} />
        </div>
      </div>

      <section className="mt-12 border-t border-border pt-8">
        {card.priceHistory.length > 0 ? (
          <PriceChart
            history={card.priceHistory}
            currency={card.currency}
            trend={card.trend}
            className="w-full"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No historical data available yet for this card.
          </p>
        )}
      </section>

      <section className="mt-8 space-y-4">
        <PriceDataTabs currency={card.currency} recentSnapshots={card.recentSnapshots} trend={card.trend} />
      </section>

      <section className="mt-12 space-y-4 border-t border-border pt-8">
        <h2 className="text-lg font-semibold">Price alerts</h2>
        <AlertSubscribe cardId={card.id} currency={card.currency} bands={bands} />
      </section>
    </div>
  );
}
