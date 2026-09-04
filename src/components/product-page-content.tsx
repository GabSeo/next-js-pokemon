import Link from "next/link";
import type { ReactNode } from "react";
import { AddToCollectionButton } from "@/components/add-to-collection-button";
import { AlertSubscribe } from "@/components/alert-subscribe";
import { CardImage } from "@/components/card-image";
import { META_ROW_CLASS, OpenDataLinks } from "@/components/open-data-links";
import { PriceChart } from "@/components/price-chart";
import { PriceDataTabs } from "@/components/price-data-tabs";
import { LocaleSlot, ProductLocaleProvider, type LocaleCode } from "@/components/product-locale";
import { StructuredData } from "@/components/structured-data";
import { ConditionFilterChips } from "@/components/retro/condition-filter-chips";
import { MarketSections } from "@/components/retro/market-sections";
import { MarketFilterBand } from "@/components/retro/market-filter-band";
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

      <div className="mx-auto max-w-[1180px] px-6 pt-28 pb-16 lg:pt-0">
        {/* PINNED: breadcrumb, market control and card identity, under the site
            header (66px — its height plus its 2px border).

            This block's height is a CONSTANT BY CONSTRUCTION, and that is the
            whole design. Two sticky elements have to stack — this one and the
            card art below it — and CSS cannot say "sit under that element"
            without being told its height. Measuring it at runtime worked and
            cost a client component and a ResizeObserver; padding for the worst
            case worked and cost 44px of dead air on every short-named card.
            Removing the variability instead makes one hard number correct for
            every card there will ever be: see lg:flex-nowrap on the identity
            row, which stops the only thing that changed the height.

            pb-1 = 4px = exactly the identity strip's hard shadow, and nothing
            more. Two bugs were found here in a row and they pull in opposite
            directions:

            It first had pb-12, so the 48px gap to the card art rode inside the
            pinned block — which made that gap OPAQUE. Content scrolling up
            vanished at the top of a band of page-coloured background with
            nothing in it, and the art looked clipped by empty space. The edge
            where content disappears has to be an edge a reader can see.

            Dropping the padding to zero put that edge on the strip's border,
            but the strip's shadow is drawn 4px BELOW its border box and the
            block sits at z-30 — so the art's top 4px slid under the shadow.
            Four pixels of padding puts the block's opaque edge exactly at the
            shadow's bottom: nothing hidden, nothing showing through, and the
            art rests against a line rather than against nothing.

            The resting gap lives on the GRID below (lg:mt-11), not on the
            strip. A bottom margin on the strip stops collapsing out the moment
            this block has bottom padding, so it silently joined the block's
            height — 200px instead of 152 — and put the art back underneath.
            Below lg the strip keeps its own mb-12, where nothing is pinned and
            margin collapsing is not in play.

            `lg:` only. Below it the layout is one column, so the art sits ABOVE
            the data rather than beside it, and anything pinned is guaranteed to
            cross it. Pinning is only coherent once the art has its own
            column. */}
        <div className="lg:sticky lg:top-[66px] lg:z-30 lg:-mx-6 lg:bg-muted-surface lg:px-6 lg:pt-4 lg:pb-0.5">
        {/* lg:truncate for the same reason as the identity row below: a long
            card name wrapped this line and took the pinned block's height
            with it (measured on Eustass"Captain"Kid and P-106 versus Lugia
            V). Every row in this block has to be unwrappable, or the block's
            height stops being a constant and the art's offset below becomes
            a guess. */}
        <nav aria-label="Breadcrumb" className="text-sm font-bold text-muted-text lg:block lg:min-w-0 lg:truncate">
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

        <div className="mt-5 mb-12 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md lg:mb-0 lg:flex-nowrap">
          {/* lg:flex-nowrap + lg:min-w-0 is what makes the pinned block a fixed
              height. Eustass"Captain"Kid's name wrapped this row to two lines
              and the block grew 44px, which is how the art ended up underneath
              it. On one line the height cannot move, so the art's offset is a
              number rather than a measurement.

              The h1 ellipsizes rather than the chips being dropped: the full
              name is still in the markup for a reader's tooltip, for search and
              for an agent parsing the page, and the chips are the part that
              cannot be inferred from the breadcrumb directly above. */}
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
                <h1 className="text-2xl font-black tracking-[-0.6px] uppercase lg:min-w-0 lg:truncate" title={c.printName ?? c.name}>
                  {c.printName ?? c.name}
                </h1>
                {/* The tags travel as ONE group so they can be pinned to the
                    strip's right edge rather than trailing whatever width the
                    name happened to take. Loose, they sat wherever the h1 left
                    them — a different place on every card, which is exactly
                    what a fixed strip should not do. Grouped and right-aligned
                    (justify-between on the parent), they land in the same
                    place on every card, so a reader learns one spot to look
                    for the set and the rarity.

                    lg:shrink-0 keeps the group whole and lets the h1 do the
                    ellipsising instead — the name is recoverable from the
                    breadcrumb and the title attribute, the chips are not. */}
                <div className="flex flex-wrap items-center gap-3 lg:shrink-0 lg:flex-nowrap">
                  {card.types?.map((englishType, i) => (
                    <TypeBadge key={englishType} colorKey={englishType} label={c.types?.[i] ?? englishType} />
                  ))}
                  {/* whitespace-nowrap on all three chips: a long set name wrapped
                      inside its own pill and added 8px to the strip. Every element of
                      the pinned block has to be unwrappable for its height to be the
                      constant the card art's offset assumes. */}
                  <span className="rounded-full border-2 border-black bg-pokemon-blue px-3.5 py-1 text-xs font-black tracking-[0.35px] whitespace-nowrap text-white uppercase">
                    {c.set}
                    {c.setCode ? ` · ${c.setCode}` : ""}
                  </span>
                  {c.number && (
                    <span className="rounded-full border-2 border-black bg-white px-3.5 py-1 text-xs font-black tracking-[0.35px] whitespace-nowrap uppercase">
                      #{c.number}
                    </span>
                  )}
                  {c.rarity && (
                    <span className="rounded-full border-2 border-black bg-pokemon-yellow px-3.5 py-1 text-xs font-black tracking-[0.35px] whitespace-nowrap uppercase">
                      {c.rarity}
                    </span>
                  )}
                </div>
              </>
            ))}
          />
        </div>

        {/* THE MARKET FILTER, inside the pinned block rather than down in
            Real-time market data where it used to live. That is what makes
            the frozen chrome CONTIGUOUS: header, card identity and filter are
            one block with no gap, so scrolling content passes under a single
            visible edge instead of through a 45px slot between two floating
            bars. See market-filter-band.tsx. */}
        <MarketFilterBand />
        </div>

        {/* lg:mt-11 (44px) plus the block's own 4px shadow cover is the 48px
            that used to be the strip's bottom margin. It sits here because a
            margin inside the pinned block joins its height; outside it, it just
            spaces the layout. */}
        <div className="grid grid-cols-1 gap-9 lg:mt-11 lg:grid-cols-[320px_1fr] lg:items-start">
          {/* 335 = 66 header + 225 pinned-block height + 44 (lg:mt-11, the
              same margin the grid itself sits below the block at rest) — so
              the gap a reader sees between the identity strip and the art is
              identical pinned or not. Re-measured every time the block's own
              content changed: 196 with the old rich toggle inline, 140 once
              that toggle left, 153 with a small flag pill in the breadcrumb
              row, 229 once the market filter itself moved into the block (see
              market-filter-band.tsx), 225 once the Card ID chip left it for
              the open-data rows under the art. A stale number here opens a
              gap or an overlap, never quite the 44px this margin reads as
              everywhere else.

              The pinned block's own height already covers its shadow (see the
              wrapper's lg:pb-1, sized to the identity strip's own
              shadow-hard-md offset) — nothing extra to add for that here, only
              the visual margin.

              The gap can be transparent, unlike a gap below a card full of
              rows: this is the left column and the art is the only thing in
              it, so the band shows page background at every scroll position
              rather than content sliding past underneath it.

              The constant is honest only because the block's height is fixed by
              construction (lg:truncate above, lg:flex-nowrap on the identity
              row) — the same number written against a block that could grow is
              what put the identity strip on top of this art once already. */}
          <div className="lg:sticky lg:top-[335px]">
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

            {/* The card's ID, which used to be a chip in the pinned identity
                strip. It was the widest fixed thing on that row and the h1 is
                the row's headline, so the slug was spending header width — the
                one place on this page where width is scarcest — on a string
                nobody reads unless they are addressing the card by name.

                Here it sits with the page's other machine-facing facts, in
                their style: an agent or a developer looking for how to
                identify this card finds the ID beside the Markdown, JSON and
                OKF mirrors that take it, which is where they were already
                looking. Removing it from the pinned block also took the last
                card-dependent width out of that block. */}
            <p className={`${META_ROW_CLASS} mt-1.5`}>
              <span>Card ID:</span>
              <span className="text-foreground">{card.id}</span>
            </p>
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
                on purpose, not just below the fold by coincidence.

                Population specifically is blocked upstream rather than
                unbuilt: PSA discontinued free public API access on
                2026-09-02 and now starts at $2,500/year, and their API has
                no way to reach a SpecID except through a certificate
                number. The measured findings and the build that runs the
                day access reopens are in psa-population-plan.md. */}
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
