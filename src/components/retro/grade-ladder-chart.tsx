"use client";

import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { BarYAxis } from "@/components/charts/bar-y-axis";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip";
import { MarketDataBadge } from "@/components/retro/market-data-badge";

/** One grading tier's current asking level in the selected market. */
export type GradeLadderRow = {
  /** "Raw", "PSA 8", "PSA 9", "PSA 10" — the tier's own label. */
  label: string;
  /** Median of the cheapest active asks in this tier; 0 when nothing is listed. */
  median: number;
  /** Real eBay total match count for the tier. */
  count: number;
  /** eBay answered and had nothing here — distinct from a failed lookup. */
  noListings?: boolean;
};

/**
 * What grading is worth on THIS card, as one picture: median active ask per
 * tier, raw at the bottom, PSA 10 at the top.
 *
 * Why this earns its space rather than repeating the tier pills above it —
 * those pills show one tier at a time and hide the number behind a hover
 * card, so the single question this panel exists to answer ("how much does
 * the grade move the price on this card") could only be answered by hovering
 * four things and remembering four numbers. A ladder answers it at a glance,
 * and the gaps between bars are the answer.
 *
 * Deliberately ACTIVE asks only, never a mix with sold: sold figures are
 * illustrative everywhere on this site (eBay's sold API is closed, see
 * lib/illustrative.ts), and a chart is exactly the wrong place to blend a
 * real series with an invented one — bars sit side by side with no room for
 * the caveat that separates them.
 *
 * Also deliberately NOT a time series, which is the chart this data invites
 * and cannot support: there is no per-grade price history anywhere in this
 * codebase (`Card.priceHistory` is the RAW card's series from apitcg/TCGdex
 * — see GradeTierPreview's comment in graded-market-tabs.tsx). Every bar
 * here is today's asks and nothing else.
 *
 * The figures under the chart are not a caption. Bklit renders to SVG, so
 * the numbers exist as `<rect>` geometry rather than as text, and this site's
 * rule is that anything on screen has to be just as readable to an agent
 * parsing raw HTML as to a human (same rule that keeps every hidden tab in
 * the DOM). The row below is where that data actually lives; the chart is
 * the human's shortcut to it.
 */
export function GradeLadderChart({
  rows,
  currency,
  market,
  isReal,
}: {
  /** Cheapest-first order is meaningless here — pass tiers in ladder order, raw first. */
  rows: GradeLadderRow[];
  currency: string;
  market: string;
  /** False when eBay could not be reached and these are preview figures. */
  isReal: boolean;
}) {
  // Nothing to compare when every tier came back empty — an all-zero ladder
  // is four invisible bars and a shrug, worse than the empty state the rows
  // below already carry.
  if (rows.every((r) => r.median <= 0)) return null;

  const data = rows.map((r) => ({ tier: r.label, median: r.median }));

  return (
    <div className="mt-6 rounded-md border-2 border-black bg-white p-5 shadow-hard-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">Grade ladder · {market}</span>
          <p className="mt-1 text-[10px] font-bold text-muted-text">Median asking price per grade, today</p>
        </div>
        <MarketDataBadge isReal={isReal} />
      </div>

      {/* Square bar ends and a black outline, because the library's default
          is a soft rounded bar that reads as a different design system from
          the hard-bordered cards this sits inside.

          The outline is a real rule in globals.css keyed off this class, not
          a Tailwind arbitrary variant: it has to target `g[class^=bar-series-]
          > rect` (bklit's only stable hook for a bar), and an unscoped `rect`
          rule also hits the chart's own transparent bounds rect and the grid's
          fade mask, which drew two stray black boxes around the plot. Nested
          attribute selectors inside a Tailwind `[&_...]` variant don't
          compile, so the rule lives in CSS where it can say what it means.

          left: 60 makes room for the tier labels; the 40px default clipped
          "PSA 10" against the card's padding. */}
      <BarChart
        aspectRatio="5 / 2"
        barGap={0.4}
        className="grade-ladder-chart"
        data={data}
        margin={{ top: 12, right: 16, bottom: 12, left: 60 }}
        orientation="horizontal"
        xDataKey="tier"
      >
        <Grid vertical />
        <Bar dataKey="median" fill="var(--pokemon-red)" lineCap={0} />
        <BarYAxis />
        <ChartTooltip />
      </BarChart>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t-2 border-border-subtle pt-3 sm:grid-cols-4">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">{row.label}</dt>
            <dd className="text-sm font-black tracking-[-0.2px] tabular-nums">
              {row.noListings || row.median <= 0 ? (
                <span className="text-muted-text">No listings</span>
              ) : (
                <>
                  {currency} {row.median.toLocaleString()}
                  <span className="ml-1.5 text-[10px] font-bold text-muted-text">({row.count})</span>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
