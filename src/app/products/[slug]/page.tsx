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
import { ActiveListingsPanel } from "@/components/retro/active-listings-panel";
import { ConditionFilterChips } from "@/components/retro/condition-filter-chips";
import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { InternationalPricesPanel } from "@/components/retro/international-prices-panel";
import { PopulationPanel } from "@/components/retro/population-panel";
import { PsaGradedPanel } from "@/components/retro/psa-graded-panel";
import { PsaTiltCard } from "@/components/retro/psa-tilt-card";
import { SoldListingsPanel } from "@/components/retro/sold-listings-panel";
import { computeAlertBands, franchiseLabel, getAllCards, getCardBySlug } from "@/lib/cards";
import { CARDMARKET_HOMEPAGE_URL } from "@/lib/cardmarket-search";
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
    <div className="min-h-screen bg-muted-surface">
      <StructuredData data={productJsonLd} />
      <StructuredData data={breadcrumbJsonLd} />
      <StructuredData data={faqJsonLd} />

      <div className="mx-auto max-w-[1180px] px-6 py-16">
        <nav aria-label="Breadcrumb" className="text-sm font-bold text-muted-text">
          <Link href="/" className="hover:text-foreground hover:underline">
            Home
          </Link>
          <span className="px-1.5">/</span>
          <Link href={`/collections/${card.franchise}`} className="hover:text-foreground hover:underline">
            {label}
          </Link>
          <span className="px-1.5">/</span>
          <span className="text-foreground">{card.name}</span>
        </nav>

        <div className="my-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black tracking-[-0.6px] uppercase">{card.name}</h1>
            <span className="rounded-full border-2 border-black bg-pokemon-blue px-3.5 py-1 text-xs font-black tracking-[0.35px] text-white uppercase">
              {card.set}
              {card.setCode ? ` · ${card.setCode}` : ""}
            </span>
            {card.number && (
              <span className="rounded-full border-2 border-black bg-white px-3.5 py-1 text-xs font-black tracking-[0.35px] uppercase">
                #{card.number}
              </span>
            )}
          </div>
          <span className="rounded-md border-2 border-black bg-muted-surface px-3 py-1.5 text-sm font-black">
            Card ID: {card.id}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-9 lg:grid-cols-[320px_1fr] lg:items-start">
          <div className="lg:sticky lg:top-[88px]">
            <PsaTiltCard>
              <CardImage card={card} className="aspect-[300/420] w-full" priority />
            </PsaTiltCard>

            {card.description && (
              <p className="mt-4 text-sm leading-5 text-muted-text">{card.description}</p>
            )}

            {card.sourceUrl && (
              <a
                href={card.sourceUrl}
                className="mt-4 flex items-center justify-between rounded-md border-2 border-black bg-card-surface px-4 py-3 text-sm font-black shadow-hard-sm transition-[transform,box-shadow] duration-100 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
              >
                <span className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full border-2 border-black bg-pokemon-blue" />
                  TCGplayer
                </span>
                ↗
              </a>
            )}

            <a
              href={CARDMARKET_HOMEPAGE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center justify-between rounded-md border-2 border-black bg-card-surface px-4 py-3 text-sm font-black shadow-hard-sm transition-[transform,box-shadow] duration-100 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
            >
              <span className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full border-2 border-black bg-pokemon-yellow" />
                Cardmarket
                <IllustrativeTag label="Not connected — links to homepage" />
              </span>
              ↗
            </a>

            <AddToCollectionButton cardId={card.id} />

            <OpenDataLinks
              markdownHref={`/products/${card.slug}/index.md`}
              jsonHref={`/api/${card.franchise}/${card.id}`}
              okfHref={`/okf/products/${card.slug}`}
              className="mt-4"
            />
          </div>

          <div className="space-y-10">
            {/* Real-time market data — everything here is either already
                live (TCGplayer/history) or has a real TCGGO endpoint lined
                up in tcggo-integration-plan.md §1/§2.4, once that's wired
                in. Kept together and clearly labeled so the split with the
                still-illustrative section below is legible, not implied. */}
            <section>
              <div className="mb-4 flex items-center gap-2">
                <h2 className="text-xs font-black tracking-[0.6px] text-pokemon-blue uppercase">Real-time market data</h2>
                <span className="h-px flex-1 bg-border-subtle" />
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div className="rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
                    <div className="mb-3 flex items-center gap-2 text-xs font-black tracking-[0.6px] text-muted-text uppercase">
                      🛒 TCGplayer
                      <span className="ml-auto font-bold text-[#999] normal-case">{card.asOfDate}</span>
                    </div>
                    <span className="mb-1 inline-block rounded-full border-2 border-black bg-muted-surface px-2.5 py-0.5 text-[11px] font-black tracking-[0.35px] uppercase">
                      Market price
                    </span>
                    <data value={String(card.currentPrice)} className="block text-4xl font-black tracking-[-1px] tabular-nums">
                      {card.currency} {card.currentPrice}
                    </data>
                  </div>

                  <InternationalPricesPanel card={card} />
                </div>

                <PsaGradedPanel card={card} />

                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <SoldListingsPanel card={card} />
                  <ActiveListingsPanel card={card} />
                </div>

                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-lg font-black tracking-[-0.45px]">📈 Raw Card Price History</h3>
                  <ConditionFilterChips />
                  {card.priceHistory.length > 0 ? (
                    <PriceChart history={card.priceHistory} currency={card.currency} trend={card.trend} className="w-full" />
                  ) : (
                    <p className="text-sm text-muted-text">No historical data available yet for this card.</p>
                  )}
                </div>

                <div className="rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
                  <PriceDataTabs
                    currency={card.currency}
                    recentSnapshots={card.recentSnapshots}
                    trend={card.trend}
                    priceRange={card.priceRange}
                  />
                </div>
              </div>
            </section>

            {/* Grading & population — no real source exists yet for either
                (see tcggo-integration-plan.md §1). Kept visually separate
                on purpose, not just below the fold by coincidence. */}
            <section>
              <div className="mb-4 flex items-center gap-2">
                <h2 className="text-xs font-black tracking-[0.6px] text-muted-text uppercase">Grading &amp; population — still illustrative</h2>
                <span className="h-px flex-1 bg-border-subtle" />
              </div>
              <PopulationPanel card={card} />
            </section>

            <div className="rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
              <h2 className="mb-4 text-lg font-black tracking-[-0.45px]">Price alerts</h2>
              <AlertSubscribe cardId={card.id} currency={card.currency} bands={bands} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
