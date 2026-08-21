import Link from "next/link";
import { CardImage } from "@/components/card-image";
import type { Card } from "@/lib/types";

export function CardTile({ card }: { card: Card }) {
  return (
    <Link
      href={`/products/${card.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border transition-colors hover:border-border-hover"
    >
      <CardImage card={card} className="aspect-[300/420] w-full" />
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="text-xs font-normal uppercase tracking-[0.08em]">{card.name}</h3>
        <p className="text-[10px] tracking-[0.02em] text-muted-foreground">
          {card.set} · {card.number ?? ""} · {card.rarity ?? ""}
        </p>
        <data value={String(card.currentPrice)} className="mt-auto block pt-2 text-sm font-normal tabular-nums">
          {card.currency} {card.currentPrice}
        </data>
      </div>
    </Link>
  );
}
