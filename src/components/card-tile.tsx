import Link from "next/link";
import { CardImage } from "@/components/card-image";
import type { Card } from "@/lib/types";

/**
 * Retro-brutalist container back, but the image now sits inset on a padded
 * muted-surface "mat" instead of filling edge-to-edge against the black
 * border. The white space around the source image's own corners is baked
 * into the art itself (from apitcg.com), not something our CSS adds —
 * sized down to 78% of the mat (rather than filling it) so that margin
 * reads as intentional matting instead of a mismatch against our own clip.
 */
export function CardTile({ card }: { card: Card }) {
  return (
    <Link
      href={`/products/${card.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border-2 border-black bg-card-surface shadow-hard-sm transition-[transform,box-shadow] duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
    >
      <div className="bg-muted-surface p-4">
        <CardImage card={card} className="mx-auto aspect-[300/420] w-[78%] overflow-hidden rounded-md" />
      </div>
      <div className="flex flex-1 flex-col gap-1 border-t-2 border-black p-4">
        <h3 className="text-sm font-black tracking-[-0.3px]">{card.name}</h3>
        <p className="text-xs font-bold text-muted-text">
          {card.set} · {card.number ?? ""} · {card.rarity ?? ""}
        </p>
        <div className="mt-auto flex items-center justify-between border-t-2 border-border-subtle pt-2">
          <span className="text-xs font-bold tracking-[0.3px] text-muted-text uppercase">Market price</span>
          <data value={String(card.currentPrice)} className="text-base font-black tabular-nums">
            {card.currency} {card.currentPrice}
          </data>
        </div>
      </div>
    </Link>
  );
}
