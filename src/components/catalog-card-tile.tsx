import Link from "next/link";

import type { CatalogCard } from "@/lib/catalog";

/**
 * One catalogue card in a grid — the set page and the search page share this.
 *
 * NO PRICES, deliberately, and this tile used to be full of them.
 *
 * Browsing is for FINDING a card. A figure on a tile answers a different
 * question, and it could not answer it honestly at this size: a Pokemon card's
 * reverse holo is a median 3.36x its normal twin and 79.3% of snapshot rows
 * carry a distinct reverse figure, so one number per tile is either the wrong
 * printing or a claim the tile has no room to qualify. /card/[tcg]/[code]
 * answers it per printing, which is the only place it can be answered at all.
 *
 * It was also the expensive half of a page of results. Rendering a grid now
 * reads the catalogue and nothing else — no price snapshot, no per-variant
 * resolution, no whole-corpus pass for a price sort — which is what a search
 * meant to keep up with a camera needs.
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
      </div>
    </Link>
  );
}
