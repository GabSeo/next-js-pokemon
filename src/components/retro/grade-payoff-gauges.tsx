"use client";

import { Gauge } from "@/components/charts/gauge";
import { EyebrowTitle } from "@/components/retro/eyebrow-title";
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
}: {
  /** Best grade first, and never the grade the card's headline already prices. */
  rows: GradePayoffRow[];
  /** Raw median + grading fee — identical for every row, which is the point. */
  cost: number;
  currency: string;
}) {
  const isBrowser = useIsBrowser();

  if (rows.length === 0 || cost <= 0) return null;

  const money = (n: number) => `${currency} ${Math.round(n).toLocaleString()}`;

  return (
    <div className="mt-6 border-t-2 border-border-subtle pt-5">
      <EyebrowTitle tone="ink">Other outcomes</EyebrowTitle>
      <h3 className="mt-1.5 text-lg leading-6 font-black tracking-[-0.45px] text-balance">
        What if it doesn&apos;t come back a 10?
      </h3>

      <div className="mt-4 flex flex-col gap-4">
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

              {/* One short line, not a sentence: the row above already shows
                  the profit and the track already shows the share, so this
                  only has to name the sale it came out of.

                  A losing grade never says "0% profit". The share is clamped
                  at zero so the track cannot draw backwards, but printing
                  that clamp reads as break-even — and it sat directly under a
                  red "−USD 1", contradicting it. The shortfall gets said
                  instead. */}
              <p className="mt-1 text-[10px] font-bold text-muted-text">
                {noListings ? (
                  <>Nobody is selling this grade today</>
                ) : margin >= 0 ? (
                  <>
                    {money(row.sale)} sale · {share.toFixed(0)}% profit
                  </>
                ) : (
                  <>
                    {money(row.sale)} sale · {money(Math.abs(margin))} short of your {money(cost)}
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
