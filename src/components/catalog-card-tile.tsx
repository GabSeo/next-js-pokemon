import Link from "next/link";

import type { CatalogCard } from "@/lib/catalog";
import { primaryVariantType, type CatalogPrice } from "@/lib/catalog-prices";

/**
 * One catalogue card in a grid — the set page and the search page share this.
 *
 * Shows the Cardmarket average when there is one and the TCGplayer market
 * price otherwise, NEVER both and never a figure derived from the other. The
 * site-wide rule holds here as everywhere else: Cardmarket is EUR, TCGplayer
 * is USD, and no conversion exists between them (lib/market-views.ts).
 *
 * EVERY PRICED PRINTING IS SHOWN, headline first, each labelled. A grid tile
 * used to have room for exactly one number and took the headline, which was
 * honest — it said which printing it quoted — but left the others unreachable.
 * That is most of the card's value for a reverse holo: 79.3% of snapshot rows
 * carry a distinct reverse figure, a median 3.36x from the normal one (Venonat
 * swsh12-001 is EUR 0.04 against EUR 0.18). Extra printings render smaller than
 * the headline, so the tile still reads as one price at a glance.
 *
 * LINKS TO /card/pokemon/[tcgdexId], which it did not used to. The old comment
 * here argued the tile should NOT be a link, because the only card page was
 * /products/[slug] — a premium surface needing price history (apitcg,
 * 1,000/month), a graded market (eBay, 8 searches per card) and JP/FR prints
 * (PokéWallet, 100/hour), none of which can be paid 21,066 times. Linking a
 * tile to a thin imitation of it would have advertised the premium surface and
 * then not delivered.
 *
 * That reasoning held until there was a real free destination. There is now:
 * /card/[tcg]/[code] renders every printing of a card from disk, costs no
 * metered call, and is the page a scan will land on. The premium split is
 * unchanged — it moved from "do not link" to "link to the free page".
 */
/**
 * The one figure a tile quotes for a printing: Cardmarket's average when there
 * is one, TCGplayer's market price otherwise. Never both, never converted.
 */
function money(price: CatalogPrice): string | undefined {
  const cm = price.cardmarket?.avg;
  if (cm !== undefined) return new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(cm);
  const tp = price.tcgplayer?.market;
  if (tp !== undefined) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(tp);
  return undefined;
}

export function CatalogCardTile({
  card,
  prices,
  setName,
}: {
  card: CatalogCard;
  /** Every priced printing, headline first — see getCatalogPricesByVariant. */
  prices?: CatalogPrice[];
  /** Shown only where the grid mixes sets — the set page already says which set this is. */
  setName?: string;
}) {
  const priced = (prices ?? []).map((price) => ({ price, shown: money(price) })).filter((row) => row.shown);
  const headline = priced[0];
  const others = priced.slice(1);

  // Labelled only when the card really has several printings; on a
  // single-printing card the type is noise.
  const multi = card.variants.length > 1;
  const headlineLabel = multi ? (headline?.price.variantType ?? primaryVariantType(card)) : undefined;

  return (
    <Link
      href={`/card/pokemon/${card.tcgdexId}`}
      className="flex h-full flex-col overflow-hidden rounded-lg border-2 border-black bg-card-surface shadow-hard-sm transition-transform hover:-translate-y-0.5"
    >
      <div className="bg-muted-surface p-2">
        {card.image ? (
          /* eslint-disable-next-line @next/next/no-img-element -- TCGdex asset host: the URL needs a quality/extension suffix appended, which next/image's loader would not produce */
          <img
            src={`${card.image}/low.webp`}
            alt={card.name}
            loading="lazy"
            className="aspect-[300/420] w-full rounded object-contain"
          />
        ) : (
          <div className="aspect-[300/420] w-full rounded bg-card-surface" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 border-t-2 border-black p-2">
        <span className="truncate text-xs font-bold" title={card.name}>
          {card.name}
        </span>
        <span className="truncate text-[10px] text-muted-text" title={setName}>
          {setName ? `${setName} · ` : ""}#{card.localId}
          {card.rarity ? ` · ${card.rarity}` : ""}
        </span>
        <span className="mt-auto pt-1 text-xs font-black">
          {headline?.shown ?? <span className="font-bold text-muted-text">No price</span>}
        </span>
        {headlineLabel && <span className="text-[10px] text-muted-text">{headlineLabel}</span>}
        {others.map(({ price, shown }) => (
          <span key={price.variantType ?? shown} className="text-[10px] text-muted-text">
            <span className="font-bold text-foreground">{shown}</span> {price.variantType}
          </span>
        ))}
      </div>
    </Link>
  );
}
