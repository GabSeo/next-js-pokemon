"use client";

import { Headline, Metric, MetricGrid, Note } from "@/components/retro/market-panel-parts";
import type { Card } from "@/lib/types";

/**
 * Cardmarket's figures, in two shapes: leading a market, or referencing one.
 *
 * Neither draws its own card. MarketDataPanels frames both inside a single
 * bordered surface, because two separate cards side by side read as two
 * competing answers when the point is that one leads and the other is context.
 *
 * Every figure comes straight from a Cardmarket block, never a currency
 * conversion — and no IllustrativeTag, because this codebase's convention is
 * that the *absence* of that tag is what marks a number as real (see
 * graded-market-panel.tsx's ListingRow).
 */

/**
 * Cardmarket's own row labels, so the panel and the source read the same.
 * Price trend is absent because the primary layout promotes it to the hero.
 */
const ROWS = [
  { label: "From", key: "low" },
  { label: "30-day avg", key: "avg30" },
  { label: "7-day avg", key: "avg7" },
  { label: "1-day avg", key: "avg1" },
  { label: "Avg sell", key: "avg" },
] as const;

/**
 * Two decimals always, because these are prices and Cardmarket prints them
 * that way — a bare toLocaleString renders 682.8 as "682,8", which reads as a
 * truncated number next to "725,45" rather than as €682.80.
 */
function euros(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * "Cardmarket · Japanese" rather than anything containing "Japanese market".
 * The print is Japanese; the marketplace is European, and conflating the two
 * would tell a reader these euros are a Tokyo price.
 */
export function cardmarketSourceLabel(card: Card): string {
  return card.cardmarket?.print === "japanese" ? "Cardmarket · Japanese" : "Cardmarket";
}

/**
 * Which copies the price actually covers. A Western listing prices any of six
 * languages, and the Japanese print is a different product — saying which is
 * the difference between a real number and a mislabeled one.
 */
const PRINT_NOTE: Record<"western" | "japanese", string> = {
  western: "One listing, covering EN · FR · IT · DE · ES · PT copies.",
  japanese: "The Japanese print — a separate listing from the Western one.",
};

function CardmarketLink({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <a
      className="text-xs font-black whitespace-nowrap text-pokemon-blue uppercase"
      href={url}
      rel="noopener noreferrer"
      target="_blank"
    >
      View on Cardmarket ↗
    </a>
  );
}

/**
 * `!= null` (not `!== undefined`) throughout: both sources have been seen
 * sending an explicit `null` for a figure Cardmarket has no data for yet — see
 * BerryWalletCardmarketPrices (lib/berrywallet.ts) and PokeWalletCardmarketPrice
 * (lib/pokewallet.ts). A raw null would crash toLocaleString and take the
 * static build with it, rather than dropping one row.
 */
function priced(
  card: Card,
  rows: readonly { label: string; key: "low" | "trend" | "avg30" | "avg7" | "avg1" | "avg" }[]
): { label: string; amount: number }[] {
  const cardmarket = card.cardmarket;
  if (!cardmarket) return [];
  return rows
    .map((row) => ({ label: row.label as string, amount: cardmarket[row.key] }))
    .filter((row): row is { label: string; amount: number } => row.amount != null);
}

/**
 * The Japanese market with no Japanese Cardmarket product to show.
 *
 * Exists because the alternative on this tab was showing the WESTERN listing's
 * euros under a "JP MARKET" heading. The panel labelled it correctly and the
 * layout still said something false — seen in preview, and it is the reason
 * the substitution in page.tsx was removed.
 *
 * Says which product is missing and where the one we do have lives, so the
 * absence is a fact the reader can act on rather than a blank.
 */
export function CardmarketAbsent({ hasWestern }: { hasWestern: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div>
        <p className="text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">Price trend</p>
        <p className="text-2xl font-black tracking-[-0.6px]">No Japanese listing</p>
      </div>
      <Note>
        {hasWestern
          ? "No Japanese Cardmarket product resolved for this print. The Western listing is on the US and EU tabs — it prices a different product, so its figures are not repeated here."
          : "No Japanese Cardmarket product resolved for this print."}
      </Note>
    </div>
  );
}

export function CardmarketPrimary({ card }: { card: Card }) {
  const cardmarket = card.cardmarket;
  if (!cardmarket) return null;

  const trend = cardmarket.trend;
  const rows = priced(card, ROWS);

  // No figures at all, but a real product URL: this is CardRef's link-only
  // escape hatch (see cardmarketProductUrl), for a print Cardmarket sells and
  // no price source of ours covers. Say that and hand over the link, rather
  // than dropping the panel — a reader who can see the product on Cardmarket
  // and nothing here would reasonably read the silence as "no listing exists".
  if (rows.length === 0 && trend == null) {
    if (!cardmarket.url) return null;
    return (
      <div className="flex h-full flex-col">
        <div>
          <p className="text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">Price trend</p>
          <p className="text-2xl font-black tracking-[-0.6px]">Not tracked</p>
        </div>
        <Note>Cardmarket lists this print, but no price feed we use covers it. The link goes to the product itself.</Note>
        <div className="mt-auto pt-3">
          <CardmarketLink url={cardmarket.url} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Trend rather than "From": trend is Cardmarket's own considered
          valuation, while From is whatever the cheapest seller happens to be
          asking today. */}
      {trend == null ? (
        <div>
          <p className="text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">Price trend</p>
          <p className="text-2xl font-black tracking-[-0.6px]">Not published</p>
        </div>
      ) : (
        <Headline amount={trend} currency="EUR" label="Price trend" />
      )}

      <MetricGrid>
        {rows.map((row) => (
          <Metric key={row.label} label={row.label} value={`€${euros(row.amount)}`} />
        ))}
      </MetricGrid>

      {cardmarket.print && <Note>{PRINT_NOTE[cardmarket.print]}</Note>}

      {/* mt-auto pins the link to the card's floor so both cards in the row
          end on the same line, whichever has more rows. */}
      <div className="mt-auto pt-3">
        <CardmarketLink url={cardmarket.url} />
      </div>
    </div>
  );
}

