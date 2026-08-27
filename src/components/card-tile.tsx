import Link from "next/link";
import { CardImage } from "@/components/card-image";
import type { Card } from "@/lib/types";

/**
 * Retro-brutalist container back, but the image now sits inset on a padded
 * muted-surface "mat" instead of filling edge-to-edge against the black
 * border. The white space around the source image's own corners is baked
 * into the art itself (from apitcg.com), not something our CSS adds —
 * padding it away from the border on all sides (rather than shrinking the
 * image's own width, which only adds horizontal margin, not vertical) means
 * that baked-in margin reads as intentional matting instead of a mismatch
 * against our own clip, with genuinely equal spacing on every side.
 */
const RARITY_BADGE_PALETTE: [bg: string, text: string][] = [
  ["bg-pokemon-yellow", "text-black"],
  ["bg-pokemon-red", "text-white"],
  ["bg-pokemon-blue", "text-white"],
  ["bg-success-green", "text-white"],
];

/** Pokémon TCG has dozens of rarity tiers we can't exhaustively map to a
 *  specific color — hash each rarity string to one of the site's 4 named
 *  accent colors instead, so the same rarity always gets the same color. */
function rarityBadgeColors(rarity: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < rarity.length; i++) hash = (hash * 31 + rarity.charCodeAt(i)) >>> 0;
  return RARITY_BADGE_PALETTE[hash % RARITY_BADGE_PALETTE.length];
}

export function CardTile({ card }: { card: Card }) {
  const [badgeBg, badgeText] = card.rarity ? rarityBadgeColors(card.rarity) : [];

  return (
    <Link
      href={`/products/${card.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border-2 border-black bg-card-surface shadow-hard-sm transition-[transform,box-shadow] duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
    >
      <div className="relative bg-muted-surface p-6">
        {card.rarity && (
          <span
            className={`absolute top-3 right-3 z-10 rounded-full border-2 border-black px-2.5 py-1 text-[10px] font-black tracking-[0.3px] uppercase shadow-hard-sm ${badgeBg} ${badgeText}`}
          >
            {card.rarity}
          </span>
        )}
        <CardImage card={card} className="aspect-[300/420] w-full overflow-hidden rounded-md" sizes="(min-width: 640px) 33vw, 50vw" />
      </div>
      <div className="flex flex-1 flex-col gap-1 border-t-2 border-black p-4">
        {/* printName (One Piece only, real BerryWallet print string) when
            there is one — see Card.printName's own doc comment
            (lib/types.ts). Every Pokémon card falls back to the clean name,
            unchanged. */}
        <h3 className="text-sm font-black tracking-[-0.3px]">{card.printName ?? card.name}</h3>
        <p className="text-xs font-bold text-muted-text">
          {card.set} · {card.number ?? ""}
        </p>
        <div className="mt-auto flex items-center justify-between border-t-2 border-border-subtle pt-2">
          <span className="text-xs font-bold tracking-[0.3px] text-muted-text uppercase">Market price</span>
          {/* No price source could be reached for this card — see
              placeholderCard in lib/cards.ts. Showing the placeholder's 0
              here would read as "free", which is worse than saying so. */}
          {card.priceUnavailable ? (
            <span className="text-base font-black">—</span>
          ) : (
            <data value={String(card.currentPrice)} className="text-base font-black tabular-nums">
              {card.currency} {card.currentPrice}
            </data>
          )}
        </div>
      </div>
    </Link>
  );
}
