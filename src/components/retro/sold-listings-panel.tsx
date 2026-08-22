import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { illustrativeSoldListings } from "@/lib/illustrative";
import type { Card } from "@/lib/types";

export function SoldListingsPanel({ card }: { card: Card }) {
  const rows = illustrativeSoldListings(card);
  return (
    <div className="rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-black tracking-[0.6px] text-muted-text uppercase">
        🔗 Recent Sold Listings
        <IllustrativeTag label="Illustrative — no fake links" />
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.grade}
            className="flex items-center justify-between rounded-md border-2 border-black bg-muted-surface px-4 py-2.5 text-sm"
          >
            <span className="font-black">{row.grade}</span>
            <span className="font-bold text-muted-text">{row.daysAgo}d ago</span>
            <data value={String(row.price)} className="font-black tabular-nums">
              {card.currency} {row.price.toLocaleString()}
            </data>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-text">
        Real, individually-linked sold listings arrive once eBay sold-listing data is wired in — see{" "}
        <code>tcggo-integration-plan.md</code> §2.4.
      </p>
    </div>
  );
}
