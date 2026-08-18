import Link from "next/link";
import { CardImage } from "@/components/card-image";
import type { Card } from "@/lib/types";

export function CardTile({ card }: { card: Card }) {
  return (
    <Link
      href={`/products/${card.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border transition-colors hover:border-foreground/30"
    >
      <CardImage card={card} className="aspect-[300/420] w-full" />
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="text-sm font-semibold">{card.name}</h3>
        <p className="text-xs text-muted-foreground">
          {card.set} · {card.number} · {card.rarity}
        </p>
        <p className="mt-auto pt-2 text-sm font-medium">
          {card.currency} {card.currentPrice}
        </p>
      </div>
    </Link>
  );
}
