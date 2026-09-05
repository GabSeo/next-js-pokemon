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
 * THE VARIANT IS LABELLED whenever a card has more than one printing. A grid
 * has room for exactly one number, and the reverse holo of the same card can
 * trade at several times the normal — Venonat swsh12-001 is EUR 0.04 against
 * EUR 0.18, measured — so a bare figure would not say which object it prices.
 *
 * NOT A LINK, deliberately, and this is the honest state rather than an
 * oversight: there is no page for a catalogue card yet. Only the 11 cards in
 * data/card-refs.ts have one, because a product page needs price history
 * (apitcg, 1,000/month) and a graded market (eBay, 8 searches per card), which
 * is exactly the tier-2 spend that cannot be paid 23,546 times. Making these
 * tiles link somewhere is the next decision, not a detail.
 */
export function CatalogCardTile({
  card,
  price,
  setName,
}: {
  card: CatalogCard;
  price?: CatalogPrice;
  /** Shown only where the grid mixes sets — the set page already says which set this is. */
  setName?: string;
}) {
  const cm = price?.cardmarket?.avg;
  const tp = price?.tcgplayer?.market;
  const shown =
    cm !== undefined
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(cm)
      : tp !== undefined
        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(tp)
        : undefined;

  const variantLabel = card.variants.length > 1 ? (price?.variantType ?? primaryVariantType(card)) : undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border-2 border-black bg-card-surface shadow-hard-sm">
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
          {shown ?? <span className="font-bold text-muted-text">No price</span>}
        </span>
        {variantLabel && <span className="text-[10px] text-muted-text">{variantLabel}</span>}
      </div>
    </div>
  );
}
