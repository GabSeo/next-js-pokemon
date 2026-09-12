import Link from "next/link";

import type { CatalogPriceRange } from "@/lib/catalog-prices";
import type { CatalogCard } from "@/lib/catalog";
import { formatCatalogPriceRange } from "@/lib/format-price";

/**
 * One catalogue card in a grid — the set page and the search page share this.
 *
 * A RANGE, WHICH IS THE THIRD ANSWER TO A QUESTION THAT LOOKED BINARY.
 *
 * This tile used to be full of prices, then carried none at all, and both were
 * answers to the same real problem: a Pokemon card is several objects sharing
 * one picture, and they do not trade together. Measured on the current
 * snapshot, 60.3% of priced cards carry two distinct Cardmarket figures, a
 * median 3.45x apart and 10.5x at the 90th percentile. So one number on a tile
 * is the wrong object's price for six cards in ten, with no room to say which
 * object it priced — and removing it was right as long as the choice was
 * between one number and nothing.
 *
 * "EUR 0.60 - 2.07" costs the same one line and claims nothing false. A card
 * with a single printing collapses to a single figure rather than printing a
 * spread it does not have.
 *
 * IT IS STILL NOT THE ANSWER TO "what is mine worth" — that is per printing and
 * per condition, and /card/[tcg]/[code] is still the only place it can be
 * answered. The range is for browsing: which cards in this set are the
 * expensive ones.
 *
 * THE COST IS A MAP LOOKUP, which is what makes this affordable now and did not
 * used to be. The page reads one memoised snapshot and hands each tile a
 * resolved range; there is no per-tile fetch, no per-variant work at render
 * time, and no whole-corpus pass. See getCatalogPriceRanges — snapshot only,
 * deliberately, because a grid is a bulk operation.
 *
 * WHY LINKING HERE IS FINE, unchanged: /card/[tcg]/[code] renders every
 * printing from disk and costs no metered call. The premium split moved from
 * "do not link" to "link to the free page".
 */
export function CatalogCardTile({
  card,
  setName,
  label,
  imageUrl,
  price,
}: {
  card: CatalogCard;
  /** Shown only where the grid mixes sets — the set page already says which set this is. */
  setName?: string;
  /**
   * The Latin label for the card, from lib/card-label.
   *
   * Passed in rather than derived here: this is a client component and the
   * label needs the catalogue on disk. Absent means the card's own name is
   * already Latin, which is every English card.
   */
  label?: string;
  /**
   * The artwork URL, already resolved. Passed in for the same reason `label`
   * is: a Japanese card's picture may come from the official Japanese data
   * rather than from TCGdex, and working that out needs the catalogue on disk.
   * Absent falls back to the card's own TCGdex image.
   */
  imageUrl?: string;
  /**
   * The cheapest and dearest printing, already resolved.
   *
   * Passed in rather than read here for the same reason `label` and `imageUrl`
   * are: this is a client component, and the snapshot lives on disk. Absent
   * means the snapshot has no figure for this card — 3% of the catalogue, plus
   * every Japanese card, whose source prices nothing.
   */
  price?: CatalogPriceRange;
}) {
  const src = imageUrl ?? (card.image ? `${card.image}/low.webp` : undefined);

  return (
    <Link
      href={`/card/pokemon/${card.tcgdexId}`}
      className="flex h-full flex-col overflow-hidden rounded-lg border-2 border-black bg-card-surface shadow-hard-sm transition-transform hover:-translate-y-0.5"
    >
      <div className="bg-muted-surface p-2">
        {src ? (
          /* eslint-disable-next-line @next/next/no-img-element -- TCGdex asset host and our own Japanese proxy both serve pre-sized files; next/image would re-optimize on a metered quota */
          <img
            src={src}
            alt={label ?? card.name}
            loading="lazy"
            className="aspect-[300/420] w-full rounded object-contain"
          />
        ) : (
          <div className="flex aspect-[300/420] w-full items-center justify-center rounded bg-card-surface p-2 text-center text-[10px] text-muted-text">
            No picture published
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 border-t-2 border-black p-2">
        <span className="truncate text-xs font-bold" title={label ?? card.name}>
          {label ?? card.name}
        </span>
        <span className="truncate text-[10px] text-muted-text" title={setName}>
          {setName ? `${setName} · ` : ""}#{card.localId}
          {card.rarity ? ` · ${card.rarity}` : ""}
        </span>
        {/* PUSHED TO THE BOTTOM with mt-auto, so the price sits on one line
            across a row whose titles wrap to different heights. A figure that
            floats at a different height in each tile is unreadable as a column,
            which is the way a grid of prices is actually scanned. */}
        {price ? (
          <span
            className="mt-auto truncate pt-1 text-[11px] font-black tabular-nums"
            title={
              // Only where the range ACTUALLY spans two figures. A card with two
              // printings that happen to trade at the same price collapses to
              // one number, and a tooltip promising separate prices behind it
              // would be the same false claim this range exists to avoid.
              price.max > price.min
                ? `${price.printings} printings priced separately — see the card page for each`
                : undefined
            }
          >
            {formatCatalogPriceRange(price.min, price.max, price.currency)}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
