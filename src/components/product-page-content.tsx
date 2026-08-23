import Link from "next/link";
import { AddToCollectionButton } from "@/components/add-to-collection-button";
import { AlertSubscribe } from "@/components/alert-subscribe";
import { CardImage } from "@/components/card-image";
import { OpenDataLinks } from "@/components/open-data-links";
import { PriceChart } from "@/components/price-chart";
import { PriceDataTabs } from "@/components/price-data-tabs";
import { StructuredData } from "@/components/structured-data";
import { ConditionFilterChips } from "@/components/retro/condition-filter-chips";
import { GradedMarketPanel } from "@/components/retro/graded-market-panel";
import type { MarketTab } from "@/components/retro/graded-market-tabs";
import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { InternationalPricesPanel } from "@/components/retro/international-prices-panel";
import { PopulationPanel } from "@/components/retro/population-panel";
import { PsaTiltCard } from "@/components/retro/psa-tilt-card";
import { TypeBadge } from "@/components/retro/type-badge";
import { computeAlertBands } from "@/lib/cards";
import { CARDMARKET_HOMEPAGE_URL } from "@/lib/cardmarket-search";
import type { Card } from "@/lib/types";

/** `code` is a real ISO 3166-1 alpha-2 country code (e.g. "US", "FR", "JP") — used both as the visible label and, lowercased, to build the flag image URL below. */
export type LocaleLink = { code: string; href: string; active: boolean };

/**
 * Flag *emoji* are unreliable cross-platform — Windows in particular often
 * has no real flag glyph for the regional-indicator-letter pairs they're
 * built from, rendering as blank/tofu instead of a flag picture even though
 * the emoji itself is correct. flagcdn.com (the static-asset CDN for the
 * well-known open-source flag-icons project) serves real flags by ISO code,
 * no key needed — verified live to resolve for every code this site uses.
 *
 * SVG specifically, not PNG/WebP/JPEG: at this toggle's small render size
 * (~16×12px) a raster tier would look soft on any 2×/3× display unless a
 * larger tier were fetched, where SVG stays crisp at any zoom/DPI for free.
 * It's also the smallest of the four formats for every flag this site
 * actually uses (verified live: US/FR/JP SVGs are 765/191/160 bytes vs.
 * 252/109/239 for the equivalent 40px-wide PNGs) — flat-color flags are
 * exactly what SVG compresses best and JPEG compresses worst (visible
 * ringing on the hard color edges a flag is made of).
 */
function flagSvgUrl(isoCode: string): string {
  return `https://flagcdn.com/${isoCode.toLowerCase()}.svg`;
}

type ProductPageContentProps = {
  /** Source of truth for every number, search query, and history point — always the real English-identity Card, never a localized clone (see graded-market.ts's `card.tcgdexId`-based French search override). */
  card: Card;
  /** Same object as `card` on the default and /ja pages; a name/set/rarity/imageUrl-overridden clone on /fr — used only for what's actually visible: title, breadcrumb, and card art. */
  displayCard: Card;
  franchiseLabel: string;
  collectionHref: string;
  markdownHref: string;
  jsonHref: string;
  okfHref: string;
  /** The visible "no orphan pages" cross-links between market variants (PLAN.md §4.3). Framed as *market* focus (US/FR/JP), not *language* — honest either way: /fr is real translated content, /ja isn't (see that route's own doc comment), but both are legitimately a different market's data for this card. */
  localeLinks: LocaleLink[];
  /** Which Pokémon Market Overview tab opens by default — English unless a locale page overrides it. */
  defaultMarketTab?: MarketTab;
  /** Omitted on the /ja workflow page: its content is identical to the English original, so it's meant to canonicalize back there rather than assert itself as separately-indexable content via schema.org. */
  structuredData?: { product: Record<string, unknown>; breadcrumb: Record<string, unknown>; faq: Record<string, unknown> };
};

export function ProductPageContent({
  card,
  displayCard,
  franchiseLabel,
  collectionHref,
  markdownHref,
  jsonHref,
  okfHref,
  localeLinks,
  defaultMarketTab,
  structuredData,
}: ProductPageContentProps) {
  const bands = computeAlertBands(card.currentPrice);

  return (
    <div className="min-h-screen bg-muted-surface">
      {structuredData && (
        <>
          <StructuredData data={structuredData.product} />
          <StructuredData data={structuredData.breadcrumb} />
          <StructuredData data={structuredData.faq} />
        </>
      )}

      <div className="mx-auto max-w-[1180px] px-6 py-16">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Breadcrumb" className="text-sm font-bold text-muted-text">
            <Link href="/" className="hover:text-foreground hover:underline">
              Home
            </Link>
            <span className="px-1.5">/</span>
            <Link href={collectionHref} className="hover:text-foreground hover:underline">
              {franchiseLabel}
            </Link>
            <span className="px-1.5">/</span>
            <span className="text-foreground">{displayCard.name}</span>
          </nav>

          {localeLinks.length > 0 && (
            <div className="flex items-center gap-2" role="group" aria-label="Market">
              <span className="text-xs font-black tracking-[0.3px] text-muted-text uppercase">Market</span>
              <div className="flex overflow-hidden rounded-md border-2 border-black">
                {localeLinks.map((l, i) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    aria-current={l.active ? "page" : undefined}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-black tracking-[0.3px] uppercase transition-colors ${
                      i > 0 ? "border-l-2 border-black" : ""
                    } ${l.active ? "bg-pokemon-red text-white" : "bg-white text-foreground hover:bg-muted-surface"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- external CDN image, domain not allowlisted for next/image */}
                    <img src={flagSvgUrl(l.code)} alt="" className="h-3 w-4 rounded-[1px] object-cover" />
                    {l.code}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 mb-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black tracking-[-0.6px] uppercase">{displayCard.name}</h1>
            {card.types?.map((englishType, i) => (
              <TypeBadge key={englishType} colorKey={englishType} label={displayCard.types?.[i] ?? englishType} />
            ))}
            <span className="rounded-full border-2 border-black bg-pokemon-blue px-3.5 py-1 text-xs font-black tracking-[0.35px] text-white uppercase">
              {displayCard.set}
              {card.setCode ? ` · ${card.setCode}` : ""}
            </span>
            {card.number && (
              <span className="rounded-full border-2 border-black bg-white px-3.5 py-1 text-xs font-black tracking-[0.35px] uppercase">
                #{card.number}
              </span>
            )}
            {displayCard.rarity && (
              <span className="rounded-full border-2 border-black bg-pokemon-yellow px-3.5 py-1 text-xs font-black tracking-[0.35px] uppercase">
                {displayCard.rarity}
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
              <CardImage card={displayCard} className="aspect-[300/420] w-full" priority />
            </PsaTiltCard>

            {card.description && <p className="mt-4 text-sm leading-5 text-muted-text">{card.description}</p>}

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
                <IllustrativeTag label="Unconnected" />
              </span>
              ↗
            </a>

            <div className="mt-4">
              <AddToCollectionButton cardId={card.id} />
            </div>

            <OpenDataLinks markdownHref={markdownHref} jsonHref={jsonHref} okfHref={okfHref} className="mt-4" />
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

                <GradedMarketPanel card={card} defaultMarket={defaultMarketTab} />

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
