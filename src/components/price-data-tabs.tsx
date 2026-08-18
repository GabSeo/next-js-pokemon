"use client";

import { useState } from "react";
import type { PriceSnapshot, PriceTrend } from "@/lib/types";

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
};

/**
 * All three tab panels are always rendered in the DOM — only the active one
 * is visible (via the `hidden` attribute). Tab switching is a pure client-
 * side state change, no fetch. This means an AI crawler reading the raw
 * HTML sees every tab's content regardless of which one a human has open,
 * and a human never sees a loading state when switching tabs.
 */
export function PriceDataTabs({ currency, recentSnapshots, trend }: PriceDataTabsProps) {
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
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
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
            <table className="w-full max-w-xl text-sm">
              <caption className="sr-only">Last 10 price snapshots, most recent first</caption>
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 font-normal">Date</th>
                  <th className="py-1 font-normal">Price</th>
                  <th className="py-1 font-normal">Source</th>
                </tr>
              </thead>
              <tbody>
                {recentSnapshots.map((snap) => (
                  <tr key={snap.date} className="border-t border-border">
                    <td className="py-1.5">{snap.date}</td>
                    <td className="py-1.5">
                      {currency} {snap.price}
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
          <table className="w-full max-w-md text-sm">
            <caption className="sr-only">Average price by time window</caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-normal">Window</th>
                <th className="py-1 font-normal">Average price</th>
              </tr>
            </thead>
            <tbody>
              {TREND_ROWS.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-1.5">{row.label}</td>
                  <td className="py-1.5">
                    {trend[row.id] !== null ? `${currency} ${trend[row.id]}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
