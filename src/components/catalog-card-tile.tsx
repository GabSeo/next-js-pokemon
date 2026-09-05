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
 * NOT A LINK, deliberately — a product decision, not an oversight. The
 * catalogue is the FREE view and the tracked cards in data/card-refs.ts are the
 * PREMIUM one, a split that falls out of what each costs: a product page needs
 * price history (apitcg, 1,000/month), a graded market (eBay, 8 searches per
 * card) and JP/FR prints (PokéWallet, 100/hour), none of which can be paid
 * 21,066 times. Linking a tile to a thin page would advertise the premium
 * surface and then not deliver it.
 *
 * What a non-premium card page shows, and how "track this card" promotes one
 * into the metered tier, is a design job of its own — see
 * docs/pokemon-catalogue.md §8.
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
