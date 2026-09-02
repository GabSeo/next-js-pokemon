"use client";

import { Headline, Metric, MetricGrid, Note, Stated } from "@/components/retro/market-panel-parts";
import type { Card } from "@/lib/types";

/**
 * TCGplayer's figures, in two shapes: leading a market, or referencing one.
 *
 * Neither draws its own card — MarketDataPanels frames both inside one
 * bordered surface. See cardmarket-prices-panel.tsx for the matching pair.
 *
 * THE UNLISTED CASE is the one worth knowing about. TCGplayer's coverage of
 * non-Western prints is patchy in a way that does not track how popular a card
 * is: Gengar VMAX's Japanese print, one of the most searched on this site, has
 * no listing at all (PokéWallet returns an empty `prices` array), while Lugia V
 * and Ethan's Typhlosion both have real ones. Two wrong answers were available
 * — fall back to the Western figures, which relabels one print as another, or
 * render nothing, which deletes a true fact from the markup. Everything here is
 * meant to be readable by an agent parsing raw HTML, so the absence is written
 * down, the same way lib/graded-market.ts's `noListings` writes down an empty
 * eBay tier.
 */

const SPREAD_ROWS = [
  { label: "Low", key: "low" },
  { label: "Mid", key: "mid" },
  { label: "High", key: "high" },
  { label: "Direct low", key: "directLow" },
] as const;

/** Two decimals, matching the Cardmarket side and TCGplayer's own display. */
export function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "holofoil" -> "Holofoil", "reverseHolofoil" -> "Reverse holofoil". */
function variantLabel(variant: string): string {
  const spaced = variant.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * `!= null` rather than `!== undefined`: these blocks reach us from three
 * different upstreams and BerryWallet is known to send explicit nulls for a
 * figure it has no data for. A raw null would crash toLocaleString below, and
 * the static build with it, instead of dropping one row.
 */
function spread(
  card: Card,
  rows: readonly { label: string; key: "low" | "mid" | "high" | "directLow" }[]
): { label: string; amount: number }[] {
  const band = card.tcgplayer;
  if (!band) return [];
  return rows
    .map((row) => ({ label: row.label as string, amount: band[row.key] }))
    .filter((row): row is { label: string; amount: number } => row.amount != null);
}

/**
 * TCGplayer as one line under Cardmarket, for the JA market only.
 *
 * The Japanese print is the one product two marketplaces both really carry:
 * Americans buy it on TCGplayer, Europeans on Cardmarket. US and FR each have
 * a single authoritative source, so they lead with it and show nothing else —
 * JA has two, and hiding one of them would be hiding a real price.
 *
 * A strip rather than a second full panel because Cardmarket still leads here
 * (MARKET_CONFIG.JP), and two equal blocks read as two competing answers to
 * one question — the exact failure the market card was rebuilt to fix. This
 * says the US number exists, in its own currency, without arguing with the
 * European one.
 *
 * NO CONVERSION, and none is implied: the euros above and the dollars here are
 * two marketplaces' own figures for one product, and the only honest thing to
 * do with them is show both and label them.
 */
export function TcgplayerStrip({ card }: { card: Card }) {
  const band = card.tcgplayer;

  // "US market", not "TCGplayer": the section's vocabulary is markets, and this
  // line answers what the Japanese print costs in the US one. The marketplace
  // is what the link goes to, not what the label argues about.
  const label = <span className="block text-[10px] font-black tracking-[0.4px] text-muted-text uppercase">US market · Japanese print</span>;

  // Absent, and said so rather than dropped. The two franchises are absent for
  // different reasons and only one of them is a fact about TCGplayer, so they
  // do not get the same sentence: PokéWallet returns an empty `prices` array
  // for a Japanese print TCGplayer genuinely does not carry (Gengar VMAX's
  // High-Class Deck promo), while BerryWallet returns `tcgplayer: null` on
  // every Japanese One Piece row — which says BerryWallet has no figures, not
  // that TCGplayer has no listing. Claiming the first for the second would be
  // asserting something nobody checked.
  //
  // Quieter than the live bar — subtle border, no arrow, nothing to click —
  // because there is nowhere to go. Same box either way, so the JA market card
  // keeps its height whether or not a US price exists for the print.
  if (!band?.market) {
    return (
      <div className="mt-3 rounded-md border-2 border-border-subtle bg-muted-surface px-3 py-2">
        {label}
        <p className="mt-0.5 text-[12px] font-bold text-muted-text text-pretty">
          {card.franchise === "one-piece"
            ? "No TCGplayer figures for the Japanese print in our sources."
            : "TCGplayer carries no listing for this print."}
        </p>
      </div>
    );
  }

  // The whole bar is the link. It was a label, a price and a separate "View on
  // TCGplayer" line, which wrapped on this column's width and read as leftover
  // text under the Cardmarket link rather than as one element. One target, one
  // arrow, one row.
  // Stacked, not label-left/price-right: at this column's width the label wraps
  // to two lines and a vertically centred price beside it reads as a mistake.
  // Stacking also gives the live and absent states the same shape, so switching
  // cards does not move the box.
  return (
    <a
      className="mt-3 block rounded-md border-2 border-black bg-muted-surface px-3 py-2 transition-colors hover:bg-card-surface"
      href={card.sourceUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      {label}
      <span className="mt-0.5 flex items-baseline gap-1.5">
        {/* Same `data value` convention as Headline: the exact figure stays in
            the markup for an agent while a person reads the formatted one.
            Market price alone — the spread belongs to the panel whose market
            this is, and repeating it here would turn a one-line cross-reference
            back into the second competing block it replaced. */}
        <data className="text-sm font-black tabular-nums" value={String(band.market)}>
          {money(band.market, card.currency)}
        </data>
        <span className="text-xs font-black text-pokemon-blue">↗</span>
      </span>
    </a>
  );
}

function TcgplayerLink({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <a
      className="text-xs font-black whitespace-nowrap text-pokemon-blue uppercase"
      href={url}
      rel="noopener noreferrer"
      target="_blank"
    >
      View on TCGplayer ↗
    </a>
  );
}

export function TcgplayerPrimary({
  card,
  priceKnown,
  unlistedNote,
}: {
  card: Card;
  priceKnown: boolean;
  /** Set when TCGplayer does not carry this print — the sentence to print in place of a price. */
  unlistedNote?: string;
}) {
  if (unlistedNote) {
    return <Stated label="Market price" note={unlistedNote} value="Not listed" />;
  }
  if (!priceKnown) {
    return (
      <Stated
        label="Market price"
        note="Our price sources couldn't be reached for this card. Nothing else on this page has changed."
        value="Temporarily unavailable"
      />
    );
  }

  const rows = spread(card, SPREAD_ROWS);
  const band = card.tcgplayer;

  return (
    <div className="flex h-full flex-col">
      <Headline amount={card.currentPrice} currency={card.currency} label="Market price" />

      {rows.length > 0 && (
        <MetricGrid>
          {rows.map((row) => (
            <Metric key={row.label} label={row.label} value={money(row.amount, card.currency)} />
          ))}
        </MetricGrid>
      )}

      {/* Short, because it is a definition and not an argument — but it stays,
          because without it the market price sitting outside its own low/high
          reads as a bug. Shanks OP09-004 shows a 1,795 market price under a
          2,499.99 low: the card stopped selling and only dear listings remain. */}
      <Note>
        {band?.variant ? `${variantLabel(band.variant)}. ` : ""}
        Market price = recent sales. Low/mid/high = live listings.
      </Note>

      <div className="mt-auto pt-3">
        <TcgplayerLink url={card.sourceUrl} />
      </div>
    </div>
  );
}

