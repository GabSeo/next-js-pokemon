import Link from "next/link";
import { CardImage } from "@/components/card-image";
import type { Card } from "@/lib/types";

/**
 * Retro-brutalist container back, but the image now sits inset on a padded
 * muted-surface "mat" instead of filling edge-to-edge against the black
 * border. Real card art has its own corner rounding baked into the source
 * image, at a radius that doesn't reliably match ours — with the image
 * touching the border directly, that mismatch showed as a visible gap right
 * on the line. Padding it away from the border means any residual mismatch
 * just blends into the mat instead of sitting against a hard black edge.
 */
export function CardTile({ card }: { card: Card }) {
  return (
    <Link
      href={`/products/${card.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border-2 border-black bg-card-surface shadow-hard-sm transition-[transform,box-shadow] duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
    >
      <div className="bg-muted-surface p-4">
        <CardImage card={card} className="aspect-[300/420] w-full overflow-hidden rounded-md" />
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
