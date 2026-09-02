import Link from "next/link";
import type { ReactNode } from "react";
import { AddToCollectionButton } from "@/components/add-to-collection-button";
import { AlertSubscribe } from "@/components/alert-subscribe";
import { CardImage } from "@/components/card-image";
import { OpenDataLinks } from "@/components/open-data-links";
import { PriceChart } from "@/components/price-chart";
import { PriceDataTabs } from "@/components/price-data-tabs";
import { LocaleSlot, ProductLocaleProvider, type LocaleCode } from "@/components/product-locale";
import { MarketFilterBar } from "@/components/retro/market-filter-bar";
import { StructuredData } from "@/components/structured-data";
import { ConditionFilterChips } from "@/components/retro/condition-filter-chips";
import { MarketSections } from "@/components/retro/market-sections";
import type { GradedMarketData } from "@/lib/graded-market";
import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { PopulationPanel } from "@/components/retro/population-panel";
import { PsaTiltCard } from "@/components/retro/psa-tilt-card";
import { TypeBadge } from "@/components/retro/type-badge";
import { computeAlertBands } from "@/lib/cards";
import { MarketDataPanels } from "@/components/retro/market-data-panels";
import { cardmarketHomepage } from "@/lib/cardmarket-search";
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
  /** Fetched once in page.tsx and shared by the first section and MarketSections. */
  gradedMarket: GradedMarketData | null;
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
  gradedMarket,
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
        {/* The market control shares the breadcrumb's row rather than taking a
            row of its own — it is page-level state, and this is the page-level
            line. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
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
        <MarketFilterBar />
        </div>

        <div className="mt-5 mb-12 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
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

            {/* A real per-product link whenever the card's own Cardmarket
                block carried one, the homepage otherwise. The "Unconnected"
                tag follows the same test rather than being hardcoded: it used
                to show on every card, which now contradicts the panel of real
                Cardmarket figures further down the same page. */}
            <a
              href={card.cardmarket?.url ?? cardmarketHomepage(card.franchise)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center justify-between rounded-md border-2 border-black bg-card-surface px-4 py-3 text-sm font-black shadow-hard-sm transition-[transform,box-shadow] duration-100 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
            >
              <span className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full border-2 border-black bg-pokemon-yellow" />
                Cardmarket
                {!card.cardmarket?.url && <IllustrativeTag label="Unconnected" />}
              </span>
              ↗
            </a>

            <div className="mt-4">
              <AddToCollectionButton cardId={card.id} />
            </div>

            <OpenDataLinks markdownHref={markdownHref} jsonHref={jsonHref} okfHref={okfHref} className="mt-4" />
          </div>

          {/* The rhythm between the stacked sections. Widened from 40px once the
              pinned chrome grew: a section heading arriving 40px after the last
              row of the section above it reads as part of that section when
              both are sliding under a fixed block. */}
          <div className="space-y-14">
            {/* Real-time market data — everything here is either already
                live (TCGplayer/history) or has a real TCGGO endpoint lined
                up in tcggo-integration-plan.md §1/§2.4, once that's wired
                in. Kept together and clearly labeled so the split with the
                still-illustrative section below is legible, not implied. */}
            {/* Two independent axes meet here, so this is one client
                component rather than a LocaleSlot: the card LANGUAGE decides
                which print's prices exist, the MARKET decides which source
                leads, and neither is derived from the other. See
                retro/market-data-panels.tsx. */}
            <MarketDataPanels
              gradedMarket={gradedMarket}
              priceKnown={priceKnown}
              variants={localeVariants.filter((v) => v.available).map((v) => ({ code: v.code, card: v.card }))}
            />

            <section>
              <div className="space-y-6">
                {/* Gated the same way getGradedMarketData itself is (see its same way getGradedMarketData itself is (see its
                    own comment, lib/graded-market.ts) — One Piece isn't
                    ready yet, not permanently excluded, so this mirrors
                    ONE_PIECE_MARKET_ENABLED rather than hardcoding the
                    franchise check. A One Piece card's own real price still
                    shows above regardless, via BerryWallet. */}
                {(card.franchise === "pokemon" || ONE_PIECE_MARKET_ENABLED) && (
                  <MarketSections card={card} data={gradedMarket} />
                )}

                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-lg font-black tracking-[-0.45px]">📈 Raw Card Price History</h3>
                  {/* The series is the Western print's, and only the Western
                      print has one — apitcg's history endpoint is keyed to
                      that product, and PokéWallet offers no history at all.
                      Now that the panel above switches to the Japanese card's
                      own market price, an unlabelled chart underneath would
                      read as that card's history. Said only on JP: a French
                      copy IS the Western product, so for FR this chart is
                      already its own. */}
                  <LocaleSlot
                    variants={Object.fromEntries(
                      localeVariants
                        .filter((v) => v.available)
                        .map((v) => [
                          v.code,
                          // Only when the Japanese card actually carries its
                          // own price. On a print TCGplayer does not list, the
                          // panel above already fell back to the Western
                          // figures, so there is no mismatch to explain and
                          // the note would just add doubt.
                          v.code === "JP" && v.card.currentPrice !== card.currentPrice ? (
                            <p className="mb-3 text-[11px] font-bold text-muted-text">
                              History below is the Western print&apos;s — no Japanese series is published.
                            </p>
                          ) : null,
                        ])
                    )}
                  />
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
