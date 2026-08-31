import Link from "next/link";
import type { ReactNode } from "react";
import { AddToCollectionButton } from "@/components/add-to-collection-button";
import { AlertSubscribe } from "@/components/alert-subscribe";
import { CardImage } from "@/components/card-image";
import { OpenDataLinks } from "@/components/open-data-links";
import { PriceChart } from "@/components/price-chart";
import { PriceDataTabs } from "@/components/price-data-tabs";
import { LocaleSlot, ProductLocaleProvider, type LocaleCode } from "@/components/product-locale";
import { StructuredData } from "@/components/structured-data";
import { CardmarketPricesPanel } from "@/components/retro/cardmarket-prices-panel";
import { ConditionFilterChips } from "@/components/retro/condition-filter-chips";
import { MarketSections } from "@/components/retro/market-sections";
import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { InternationalPricesPanel } from "@/components/retro/international-prices-panel";
import { PopulationPanel } from "@/components/retro/population-panel";
import { PsaTiltCard } from "@/components/retro/psa-tilt-card";
import { TypeBadge } from "@/components/retro/type-badge";
import { computeAlertBands } from "@/lib/cards";
import { CARDMARKET_HOMEPAGE_URL } from "@/lib/cardmarket-search";
import { ONE_PIECE_MARKET_ENABLED } from "@/lib/graded-market";
import type { Card } from "@/lib/types";

/**
 * One language's worth of a card's *display* identity, plus whether that
 * language has a real source for this specific card.
 *
 * `card` is a name/set/rarity/number/image-overridden clone of the English
 * card for FR and JP, and the English card itself for US. `available:
 * false` means no real translation exists for this card (any One Piece card
 * in French — BerryWallet has zero French sets; any card whose PokéWallet /
 * BerryWallet Japanese counterpart was never confirmed), in which case
 * `card` is just the English card: the flag still switches the Market
 * Overview panel to that marketplace, but the card's own identity stays
 * English rather than wearing a foreign flag over a fabricated translation,
 * and the toggle says so on screen.
 *
 * These replaced the former per-language routes. Building all three here
 * costs nothing extra upstream: the root page already had to resolve French
 * and Japanese identity to decide whether each flag was live or inert — see
 * components/product-locale.tsx's header comment for the full cost
 * rationale, and docs/i18n-deferred.md for what a real hreflang
 * implementation would have to restore later.
 */
export type LocaleVariant = { code: LocaleCode; card: Card; available: boolean };

type ProductPageContentProps = {
  /** Source of truth for every number, search query, and history point — always the real English-identity Card, never a localized clone (see graded-market.ts's `card.tcgdexId`-based French search override). */
  card: Card;
  /**
   * Every language this card can be *displayed* in, in fixed US -> JP -> FR
   * order — also the left-to-right order of the Market Overview toggle. Used only for what's actually visible — title, breadcrumb, card
   * art, and the Cardmarket panel — never for a number, a search query or a
   * history point, which always come from `card` above (see
   * graded-market.ts's `card.tcgdexId`-based French search override for why
   * a localized clone must never leak into those).
   */
  localeVariants: LocaleVariant[];
  franchiseLabel: string;
  collectionHref: string;
  markdownHref: string;
  jsonHref: string;
  okfHref: string;
  structuredData?: { product: Record<string, unknown>; breadcrumb: Record<string, unknown>; faq: Record<string, unknown> };
};

export function ProductPageContent({
  card,
  localeVariants,
  franchiseLabel,
  collectionHref,
  markdownHref,
  jsonHref,
  okfHref,
  structuredData,
}: ProductPageContentProps) {
  /**
   * Builds one LocaleSlot's worth of variants from a render function.
   * Unavailable locales are skipped entirely rather than mapped to English
   * text: LocaleSlot then falls back to the US nodes, which is what keeps a
   * card with no real French/Japanese print from showing English text
   * wearing a foreign flag. The toggle no longer refuses those locales — it
   * also selects the eBay/Vinted market now, and that market exists for all
   * three regardless — so it states the gap in words instead (see
   * ProductLocaleToggle).
   */
  const localized = (render: (localeCard: Card) => ReactNode): Partial<Record<LocaleCode, ReactNode>> =>
    Object.fromEntries(localeVariants.filter((v) => v.available).map((v) => [v.code, render(v.card)]));
  // Every panel below this line is a function of card.currentPrice, which
  // the offline placeholder doesn't have (see placeholderCard in
  // lib/cards.ts). Rendering them anyway would publish a wall of confident
  // $0.00 conversions, population estimates and alert triggers, so they're
  // replaced by a single honest notice until a price source is reachable
  // again. The graded-market panel and the price chart stay: their data
  // comes from eBay and from apitcg's history endpoint respectively, and
  // both already render their own empty state.
  const priceKnown = !card.priceUnavailable;
  const bands = priceKnown ? computeAlertBands(card.currentPrice) : [];

  return (
    <ProductLocaleProvider options={localeVariants.map(({ code, available }) => ({ code, available }))}>
    <div className="min-h-screen bg-muted-surface">
      {structuredData && (
        <>
          <StructuredData data={structuredData.product} />
          <StructuredData data={structuredData.breadcrumb} />
          <StructuredData data={structuredData.faq} />
        </>
      )}

      <div className="mx-auto max-w-[1180px] px-6 py-16">
        <nav aria-label="Breadcrumb" className="text-sm font-bold text-muted-text">
          <Link href="/" className="hover:text-foreground hover:underline">
            Home
          </Link>
          <span className="px-1.5">/</span>
          <Link href={collectionHref} className="hover:text-foreground hover:underline">
            {franchiseLabel}
          </Link>
          <span className="px-1.5">/</span>
          <span className="text-foreground">
            <LocaleSlot variants={localized((c) => c.name)} />
          </span>
        </nav>

        <div className="mt-5 mb-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
          <div className="flex flex-wrap items-center gap-3">
            {/* One slot for the whole identity strip rather than four —
                the h1, the type badges, the set and the number all have to
                change together or the header reads as a half-translated
                mix. printName (One Piece only, real BerryWallet print
                string — e.g. "Shanks (004) (Manga)") when there is one;
                every other card falls back to the clean name, unchanged.

                TypeBadge's colorKey stays the ENGLISH type throughout
                (`card.types`, never the localized clone) — TCGdex localizes
                the type name but the palette in lib/pokemon-types.ts is
                keyed by the English one. See TypeBadge's own doc comment. */}
            <LocaleSlot
              variants={localized((c) => (
                <>
                  <h1 className="text-2xl font-black tracking-[-0.6px] uppercase">{c.printName ?? c.name}</h1>
                  {card.types?.map((englishType, i) => (
                    <TypeBadge key={englishType} colorKey={englishType} label={c.types?.[i] ?? englishType} />
                  ))}
                  <span className="rounded-full border-2 border-black bg-pokemon-blue px-3.5 py-1 text-xs font-black tracking-[0.35px] text-white uppercase">
                    {c.set}
                    {c.setCode ? ` · ${c.setCode}` : ""}
                  </span>
                  {c.number && (
                    <span className="rounded-full border-2 border-black bg-white px-3.5 py-1 text-xs font-black tracking-[0.35px] uppercase">
                      #{c.number}
                    </span>
                  )}
                  {c.rarity && (
                    <span className="rounded-full border-2 border-black bg-pokemon-yellow px-3.5 py-1 text-xs font-black tracking-[0.35px] uppercase">
                      {c.rarity}
                    </span>
                  )}
                </>
              ))}
            />
          </div>
          <span className="rounded-md border-2 border-black bg-muted-surface px-3 py-1.5 text-sm font-black">
            Card ID: {card.id}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-9 lg:grid-cols-[320px_1fr] lg:items-start">
          <div className="lg:sticky lg:top-[88px]">
            <PsaTiltCard>
              <LocaleSlot
                variants={localized((c) => (
                  <CardImage card={c} className="aspect-[300/420] w-full" priority sizes="(min-width: 1024px) 320px, 100vw" />
                ))}
              />
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
                      <span className="ml-auto font-bold text-[#999] normal-case">{priceKnown ? card.asOfDate : "—"}</span>
                    </div>
                    <span className="mb-1 inline-block rounded-full border-2 border-black bg-muted-surface px-2.5 py-0.5 text-[11px] font-black tracking-[0.35px] uppercase">
                      Market price
                    </span>
                    {priceKnown ? (
                      <data value={String(card.currentPrice)} className="block text-4xl font-black tracking-[-1px] tabular-nums">
                        {card.currency} {card.currentPrice}
                      </data>
                    ) : (
                      <p className="block text-lg font-black tracking-[-0.4px]">
                        Temporarily unavailable
                        <span className="mt-1 block text-xs font-bold text-muted-text">
                          Our price sources couldn&apos;t be reached for this card. Nothing else on this page has changed.
                        </span>
                      </p>
                    )}
                  </div>

                  {/* Real Cardmarket EUR figures (the locale variant's own
                      `cardmarket`) replace the illustrative
                      currency-conversion panel wherever they exist —
                      currently only a One Piece card with a real
                      BerryWallet match; every other card keeps the estimate
                      panel it always had. Per-locale, not per-card: the
                      Japanese print carries its own real Cardmarket listing
                      with genuinely different numbers and a different
                      product_url from the English print's, not the English
                      one relabeled (see cards.ts's
                      getOnePieceJapaneseText). priceKnown itself still
                      checks `card`, since price *availability* is a
                      canonical fact no display override changes. */}
                  {priceKnown && (
                    <LocaleSlot
                      variants={localized((c) =>
                        c.cardmarket ? <CardmarketPricesPanel card={c} /> : <InternationalPricesPanel card={c} />
                      )}
                    />
                  )}
                </div>

                {/* Gated the same way getGradedMarketData itself is (see its
                    own comment, lib/graded-market.ts) — One Piece isn't
                    ready yet, not permanently excluded, so this mirrors
                    ONE_PIECE_MARKET_ENABLED rather than hardcoding the
                    franchise check. A One Piece card's own real price still
                    shows above regardless, via BerryWallet. */}
                {(card.franchise === "pokemon" || ONE_PIECE_MARKET_ENABLED) && (
                  <MarketSections card={card} />
                )}

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
            {priceKnown && (
              <section>
                <div className="mb-4 flex items-center gap-2">
                  <h2 className="text-xs font-black tracking-[0.6px] text-muted-text uppercase">Grading &amp; population — still illustrative</h2>
                  <span className="h-px flex-1 bg-border-subtle" />
                </div>
                <PopulationPanel card={card} />
              </section>
            )}

            <div className="rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
              <h2 className="mb-4 text-lg font-black tracking-[-0.45px]">Price alerts</h2>
              {priceKnown ? (
                <AlertSubscribe cardId={card.id} currency={card.currency} bands={bands} />
              ) : (
                <p className="text-sm text-muted-text">
                  Alert thresholds are set as a percentage of the current market price, so they&apos;re unavailable until
                  this card&apos;s price can be read again.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    </ProductLocaleProvider>
  );
}
