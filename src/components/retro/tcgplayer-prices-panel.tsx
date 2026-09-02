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

