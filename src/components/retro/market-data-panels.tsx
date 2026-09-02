"use client";

import { ProductLocaleToggle, useProductLocale } from "@/components/product-locale";
import { CardmarketPrimary, cardmarketSourceLabel } from "@/components/retro/cardmarket-prices-panel";
import { InternationalPricesPanel } from "@/components/retro/international-prices-panel";
import { PriceComparison } from "@/components/retro/price-comparison";
import { TcgplayerPrimary } from "@/components/retro/tcgplayer-prices-panel";
import { MARKET_CONFIG, type Market } from "@/lib/market-config";
import type { GradedMarketData } from "@/lib/graded-market";
import type { Card } from "@/lib/types";

/**
 * The page's first section: one market, everything about it, one control.
 *
 * This replaced two designs that were both worse, and the reasons are worth
 * keeping.
 *
 * First it was two bordered cards side by side, one per marketplace, with no
 * hierarchy — which read as two competing answers to one question.
 *
 * Then it was a market toggle crossed with a card-language toggle, following
 * the architecture note's "market is not language" split. That distinction is
 * true, but expressing it as two controls pushed it onto the reader: nine
 * combinations to reach one number, two identical rows of US/JP/FR flags, and
 * changing either moved figures under both. Correct model, wrong surface.
 *
 * So the model stays and the surface collapses. One toggle selects a market;
 * the print it implies follows from it, because in practice a reader asking
 * about the Japanese market wants the Japanese print. The cross-product is
 * still reachable — the eBay and Cardmarket panels below cover both prints —
 * it just is not the thing a first glance has to navigate.
 *
 * LAYOUT: the market's authoritative source on the left, at full detail; every
 * price we hold for that market as bars on the right. Left answers "what is it
 * worth", right answers "compared to what".
 */
export function MarketDataPanels({
  variants,
  priceKnown,
  gradedMarket,
}: {
  /** One entry per card language the page resolved, US first. */
  variants: { code: string; card: Card }[];
  /** Whether a canonical price resolved at all — a fact about the card, not about the toggle. */
  priceKnown: boolean;
  /** Shared with MarketSections below; fetched once in page.tsx. */
  gradedMarket: GradedMarketData | null;
}) {
  const { active } = useProductLocale();

  // The print this market implies. Falls back to the first variant (always US)
  // when the card has no print in that language — the same fallback the card's
  // own name and art already use.
  const card = (variants.find((v) => v.code === active) ?? variants[0])?.card;
  if (!card) return null;

  const japaneseCard = variants.find((v) => v.code === "JP")?.card;
  const config = MARKET_CONFIG[active as Market] ?? MARKET_CONFIG.US;
  const tcgplayerLeads = config.primary === "tcgplayer";

  // Only a non-Western print can reach this: the Western card is the band's own
  // source, so it always has one.
  const unlistedNote =
    card.tcgplayer || active === "US"
      ? undefined
      : "TCGplayer carries no listing for this print. Its price on the English print is a different product.";

  const leadLabel = tcgplayerLeads ? "TCGplayer" : cardmarketSourceLabel(card);
  const hasCardmarket = Boolean(card.cardmarket);

  return (
    <section>
      {/* A real section head rather than a caption. This is the first thing on
          the page after the card itself and the most valuable thing on it, so
          it is allowed to announce itself — the live dot carries the one
          quality the rest of the page cannot claim, that these figures were
          read today. */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-black tracking-[0.9px] text-pokemon-blue uppercase">
            <span className="inline-block h-2 w-2 rounded-full bg-pokemon-red" />
            Live valuation
          </p>
          <h2 className="mt-1 text-[clamp(22px,3.2vw,32px)] leading-none font-black tracking-[-1px] uppercase">
            Real-time market data
          </h2>
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">Valuation market</p>
          <ProductLocaleToggle />
        </div>
      </div>

      {/* items-start so each card is as tall as its own content. Stretched,
          the comparison left a large empty box on the EU view, where it has
          two rows against the market card's eight. */}
      {/* Deliberately uneven in width — a bar needs length to be read as one,
          figures do not. Equal in HEIGHT though: the default stretch plus each
          card's own mt-auto footer means both start and end on the same line
          whatever the row count. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="flex flex-col overflow-hidden rounded-lg border-2 border-black bg-card-surface shadow-hard-md">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-black bg-muted-surface px-6 py-3 text-xs font-black tracking-[0.6px] text-muted-text uppercase">
            {tcgplayerLeads ? "🛒" : "🇪🇺"} {config.label} · {leadLabel}
            {priceKnown && !unlistedNote && <span className="font-bold text-[#999] normal-case">{card.asOfDate}</span>}
            <span className="ml-auto rounded-full border-2 border-black bg-pokemon-yellow px-2 py-0.5 text-[10px] tracking-[0.4px] text-foreground">
              Primary
            </span>
          </div>

          <div className="flex flex-1 flex-col p-6">
            {tcgplayerLeads ? (
              <TcgplayerPrimary card={card} priceKnown={priceKnown} unlistedNote={unlistedNote} />
            ) : hasCardmarket ? (
              <CardmarketPrimary card={card} />
            ) : (
              // No real Cardmarket block for this print — the illustrative
              // conversion panel stands in, badged as an estimate by its own
              // component rather than passed off as a market figure.
              <InternationalPricesPanel card={card} />
            )}
          </div>
        </div>

        {gradedMarket && (
          <PriceComparison card={card} data={gradedMarket} japaneseCard={japaneseCard} market={active as Market} />
        )}
      </div>
    </section>
  );
}
