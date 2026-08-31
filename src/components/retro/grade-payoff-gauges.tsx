"use client";

import { Gauge } from "@/components/charts/gauge";
import { MarketDataBadge } from "@/components/retro/market-data-badge";
import { useIsBrowser } from "@/components/retro/use-is-browser";

/** One grade PSA could come back with, and what that grade is asking today. */
export type GradePayoffRow = {
  /** "PSA 10", "PSA 9", "PSA 8" — grading outcomes only, never Raw. */
  label: string;
  /** Median of the cheapest active asks in that grade; 0 when nothing is listed. */
  sale: number;
};

const TRACK_HEIGHT = 12;

/**
 * What each grade pays back, for the same card and the same money spent.
 *
 * The Grading ROI callout above answers one question — raw to PSA 10 — and
 * quietly assumes the answer. You do not choose to receive a 10. You pay the
 * same raw price and the same fee whatever comes back, and the grade is the
 * part you are betting on. This is that bet's payoff table: cost is fixed
 * across every row, only the sale changes.
 *
 * Worth reading for how uneven it usually is. On Gengar VMAX the English PSA
 * 8 tier asks more than the PSA 9 tier, off three listings against sixteen —
 * so "one grade lower" is not a smooth step down, and a thin tier can price
 * above a deeper one for no reason a buyer should trust.
 *
 * The bars are margin as a share of the sale, the same measure the dial in
 * the ROI callout uses, so the two read on one scale. Deliberately not the
 * ROI percentage, which is unbounded and cannot be a filled track, and
 * deliberately not the sale price, which the grade ladder at the top of the
 * panel already plots.
 *
 * A grade that sells below cost shows an empty track rather than a bar drawn
 * backwards, with the shortfall stated next to it. A grade with no listings
 * is kept and marked: "nobody is selling this grade" is a real answer about a
 * possible outcome, and dropping the row would quietly shorten the odds.
 *
 * Every figure here is also plain text in the rows, which is what an agent
 * reading raw HTML gets — the gauges are client-only (see useIsBrowser).
 */
export function GradePayoffGauges({
  rows,
  cost,
  currency,
  market,
  isReal,
}: {
  /** Best grade first. */
  rows: GradePayoffRow[];
  /** Raw median + grading fee — identical for every row, which is the point. */
  cost: number;
  currency: string;
  market: string;
  isReal: boolean;
}) {
  const isBrowser = useIsBrowser();

  if (rows.length === 0 || cost <= 0) return null;

  const money = (n: number) => `${currency} ${Math.round(n).toLocaleString()}`;

  return (
    <div className="h-full rounded-lg border-2 border-black bg-white p-5 shadow-hard-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">
            If it doesn&apos;t come back a 10 · {market}
          </span>
          <p className="mt-1 text-[10px] font-bold text-muted-text">
            You pay {money(cost)} either way — the grade decides what you get back. Bars show the share of each sale that is
            profit.
          </p>
        </div>
        {/* Only when this block specifically is not real. The panel head
            carries one LIVE badge for the section, and four more saying the
            same thing would be noise — but a block that is preview while the
            rest is live still has to say so. */}
        {!isReal && <MarketDataBadge isReal={isReal} />}
      </div>

      <div className="flex flex-col gap-4">
        {rows.map((row) => {
          const margin = row.sale - cost;
          const share = row.sale > 0 ? Math.max(0, Math.min(100, (margin / row.sale) * 100)) : 0;
          const noListings = row.sale <= 0;

          return (
            <div key={row.label}>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-[11px] font-black tracking-[0.4px] uppercase">{row.label}</span>
                {noListings ? (
                  <span className="text-[10px] font-bold text-muted-text">No listings today</span>
                ) : (
                  <span className={`text-xs font-black tabular-nums ${margin >= 0 ? "text-foreground" : "text-pokemon-red"}`}>
                    {margin >= 0 ? "+" : "−"}
                    {money(Math.abs(margin))}
                  </span>
                )}
              </div>

              {/* Reserved height so the row does not jump when the track
                  mounts client-side. */}
              <div className="flex items-center" style={{ height: TRACK_HEIGHT }}>
                {isBrowser && !noListings && (
                  <Gauge
                    activeFill="var(--pokemon-red)"
                    inactiveFill="var(--foreground)"
                    inactiveFillOpacity={0.12}
                    linearHeight={TRACK_HEIGHT}
                    minWidth={120}
                    orientation="linear"
                    totalNotches={32}
                    value={share}
                  />
                )}
              </div>

              <p className="mt-1 text-[10px] font-bold text-muted-text">
                {noListings ? (
                  <>Nobody is asking for this grade right now, so there is no price to compare against.</>
                ) : margin >= 0 ? (
                  <>
                    Sells for {money(row.sale)} — {share.toFixed(0)}% of it profit
                  </>
                ) : (
                  <>
                    Sells for {money(row.sale)} — {money(Math.abs(margin))} less than you spent
                  </>
                )}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
