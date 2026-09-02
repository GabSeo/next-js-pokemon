"use client";

import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { illustrativeInternational } from "@/lib/illustrative";
import type { Card } from "@/lib/types";

export function InternationalPricesPanel({ card }: { card: Card }) {
  const rows = illustrativeInternational(card);
  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-black tracking-[0.6px] text-muted-text uppercase">
        📈 Est. International
        <IllustrativeTag />
      </div>
      {rows.map((row, i) => (
        <div
          key={row.label}
          className={`flex items-center justify-between py-2 text-sm font-bold ${i > 0 ? "border-t-2 border-dashed border-border-subtle" : ""}`}
        >
          <span>{row.label}</span>
          <b className="text-base font-black tabular-nums">
            {row.currency}
            {row.amount.toLocaleString()}
          </b>
        </div>
      ))}
    </div>
  );
}
