import Link from "next/link";
import { CardImage } from "@/components/card-image";
import type { Card } from "@/lib/types";

export function CardTile({ card }: { card: Card }) {
  return (
    <Link
      href={`/products/${card.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border-2 border-black bg-card-surface shadow-hard-sm transition-[transform,box-shadow] duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
    >
      <CardImage card={card} className="aspect-[300/420] w-full border-b-2 border-black" />
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="text-sm font-black tracking-[-0.3px]">{card.name}</h3>
        <p className="text-xs font-bold text-muted-text">
          {card.set} · {card.number ?? ""} · {card.rarity ?? ""}
        </p>
        <data value={String(card.currentPrice)} className="mt-auto block pt-2 text-base font-black tabular-nums">
          {card.currency} {card.currentPrice}
        </data>
      </div>
    </Link>
  );
}
