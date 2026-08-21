"use client";

import { useState } from "react";
import type { PriceRange, PriceSnapshot, PriceTrend } from "@/lib/types";

type TabId = "sold" | "trend" | "ebay";

const TABS: { id: TabId; label: string }[] = [
  { id: "sold", label: "Last sold" },
  { id: "trend", label: "Price trend" },
  { id: "ebay", label: "eBay snapshots" },
];

const TREND_ROWS: { id: keyof PriceTrend; label: string }[] = [
  { id: "day1", label: "1 day" },
  { id: "day7", label: "7 days" },
  { id: "day30", label: "30 days" },
  { id: "day90", label: "3 months" },
];

type PriceDataTabsProps = {
  currency: string;
  recentSnapshots: PriceSnapshot[];
  trend: PriceTrend;
  priceRange: PriceRange | null;
};

function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * All three tab panels are always rendered in the DOM — only the active one
 * is visible (via the `hidden` attribute). Tab switching is a pure client-
 * side state change, no fetch. This means an AI crawler reading the raw
 * HTML sees every tab's content regardless of which one a human has open,
 * and a human never sees a loading state when switching tabs.
 */
export function PriceDataTabs({ currency, recentSnapshots, trend, priceRange }: PriceDataTabsProps) {
  const [active, setActive] = useState<TabId>("sold");

  return (
    <div>
      <div role="tablist" aria-label="Price data" className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-normal uppercase tracking-[0.08em] transition-colors ${
              active === tab.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="pt-4">
        <section role="tabpanel" hidden={active !== "sold"}>
          {recentSnapshots.length > 0 ? (
            <table className="w-full max-w-xl text-sm tabular-nums">
              <caption className="sr-only">Last 10 price snapshots, most recent first</caption>
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 text-[10px] font-normal uppercase tracking-[0.08em]">Date</th>
                  <th className="py-1 text-[10px] font-normal uppercase tracking-[0.08em]">Price</th>
                  <th className="py-1 text-[10px] font-normal uppercase tracking-[0.08em]">Source</th>
                </tr>
              </thead>
              <tbody>
                {recentSnapshots.map((snap) => (
                  <tr key={snap.date} className="border-t border-border">
                    <td className="py-1.5">{snap.date}</td>
                    <td className="py-1.5">
                      <data value={String(snap.price)}>
                        {currency} {snap.price}
                      </data>
                    </td>
                    <td className="py-1.5">
                      {snap.sourceUrl ? (
                        <a href={snap.sourceUrl} className="underline underline-offset-4">
                          {snap.source}
                        </a>
                      ) : (
                        snap.source
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No recent data available yet.</p>
          )}
        </section>

        <section role="tabpanel" hidden={active !== "trend"}>
          <table className="w-full max-w-md text-sm tabular-nums">
            <caption className="sr-only">Average price by time window</caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 text-[10px] font-normal uppercase tracking-[0.08em]">Window</th>
                <th className="py-1 text-[10px] font-normal uppercase tracking-[0.08em]">Average price</th>
              </tr>
            </thead>
            <tbody>
              {TREND_ROWS.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-1.5">{row.label}</td>
                  <td className="py-1.5">
                    {trend[row.id] !== null ? (
                      <data value={String(trend[row.id])}>
                        {currency} {trend[row.id]}
                      </data>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {priceRange && (
            <div className="mt-4">
              <h3 className="text-xs font-normal uppercase tracking-[0.08em]">Price range</h3>
              <p className="text-[10px] tracking-[0.02em] text-muted-foreground">
                Low and high over the available price history, {formatShortDate(priceRange.from)} to{" "}
                {formatShortDate(priceRange.to)}.
              </p>
              <table className="mt-2 w-full max-w-md text-sm tabular-nums">
                <caption className="sr-only">
                  Lowest and highest recorded price from {priceRange.from} to {priceRange.to}
                </caption>
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 text-[10px] font-normal uppercase tracking-[0.08em]">Low</th>
                    <th className="py-1 text-[10px] font-normal uppercase tracking-[0.08em]">High</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="py-1.5">
                      <data value={String(priceRange.low)}>
                        {currency} {priceRange.low}
                      </data>{" "}
                      <span className="text-muted-foreground">
                        ({formatShortDate(priceRange.lowDate)})
                      </span>
                    </td>
                    <td className="py-1.5">
                      <data value={String(priceRange.high)}>
                        {currency} {priceRange.high}
                      </data>{" "}
                      <span className="text-muted-foreground">
                        ({formatShortDate(priceRange.highDate)})
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section role="tabpanel" hidden={active !== "ebay"}>
          <p className="text-sm text-muted-foreground">
            eBay sold-listing snapshots — coming soon. This tab is reserved
            for itemized eBay sold data once that integration is built.
          </p>
        </section>
      </div>
    </div>
  );
}
