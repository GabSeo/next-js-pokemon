"use client";

import { RadarChart } from "@/components/charts/radar-chart";
import { RadarArea } from "@/components/charts/radar-area";
import { RadarAxis } from "@/components/charts/radar-axis";
import { RadarLabels } from "@/components/charts/radar-labels";
import { MarketDataBadge } from "@/components/retro/market-data-badge";

/** One grading tier priced in both eBay markets on the same day. */
export type MarketGapRow = {
  /** "Raw", "PSA 8", "PSA 9", "PSA 10". */
  label: string;
  /** Median of the cheapest active English asks. */
  english: number;
  /** Median of the cheapest active Japanese asks. */
  japanese: number;
};

const ENGLISH_COLOR = "var(--pokemon-blue)";
const JAPANESE_COLOR = "var(--pokemon-red)";

/** At least three axes, or the polygon collapses to a line and says nothing. */
const MIN_AXES = 3;

/**
 * Where the same card is cheaper — eBay's English market or its Japanese one,
 * grade by grade.
 *
 * This is the one comparison the panel already pays for and never showed. The
 * two markets are fetched for every tier on every card, but the toggle shows
 * one at a time, so answering "is the Japanese print cheaper in PSA 10" meant
 * flipping the flag back and forth and holding four numbers in your head. The
 * gap between the two polygons is that answer.
 *
 * WHY EACH AXIS IS INDEXED, and the honest cost of it: a radar shares one
 * radial scale across every axis, so plotting raw dollars would put PSA 10
 * near the rim and Raw near the centre, and the English/Japanese gap on the
 * cheap tiers — the whole point — would vanish into a few pixels. Every axis
 * is therefore scaled to the pricier of the two markets FOR THAT GRADE (100),
 * with the cheaper market drawn as its percentage of it. The radius is a
 * ratio, not a price, and different axes are different dollars. That is a
 * real limitation, not a detail: the ladder above is where absolute levels
 * are read, this is only for the gap. Real medians and the gap in both
 * percent and currency are in the row underneath, which is also what an agent
 * parsing raw HTML gets, since bklit draws SVG paths rather than text.
 *
 * Tiers where either market has no listings are dropped rather than plotted
 * at zero — a ratio against nothing is not a cheaper market, it is an absent
 * one, and a spike to the centre would read as a 100% discount. If that
 * leaves fewer than three tiers the whole chart is dropped; the panel says
 * nothing rather than drawing a degenerate shape.
 *
 * France is deliberately absent. Vinted has no grading tiers to compare
 * against and its feed is newest-first rather than cheapest-first, so it
 * shares no axis with these two (see graded-market-tabs.tsx).
 */
export function MarketGapRadar({
  rows,
  currency,
  isReal,
}: {
  /** Ladder order, raw first. Tiers missing either market must already be filtered out. */
  rows: MarketGapRow[];
  currency: string;
  /** False when eBay could not be reached and these are preview figures. */
  isReal: boolean;
}) {
  if (rows.length < MIN_AXES) return null;

  const metrics = rows.map((row) => ({ key: row.label, label: row.label }));
  const index = (value: number, other: number) => Math.round((value / Math.max(value, other)) * 100);

  const data = [
    {
      label: "English",
      color: ENGLISH_COLOR,
      values: Object.fromEntries(rows.map((r) => [r.label, index(r.english, r.japanese)])),
    },
    {
      label: "Japanese",
      color: JAPANESE_COLOR,
      values: Object.fromEntries(rows.map((r) => [r.label, index(r.japanese, r.english)])),
    },
  ];

  // Bigger polygon first, so the smaller one is painted on top.
  //
  // Not cosmetic — it is the difference between one series being hoverable
  // and not. The areas are filled, and a filled polygon takes the pointer
  // across its whole interior, so whichever is drawn last owns every point
  // inside it. When Japanese is pricier on every grade its polygon encloses
  // English completely, and drawing it last made English unreachable: its
  // tooltip could never open anywhere. Painted in descending size the outer
  // one still owns the ring between the two, the inner one owns its own
  // interior, and both stay reachable whichever way round this card falls.
  //
  // Sorted per render rather than fixed, because which market is dearer is a
  // property of the card, not of the chart.
  const drawOrder = data
    .map((series, i) => ({ i, total: Object.values(series.values).reduce((sum, v) => sum + v, 0) }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="mt-6 rounded-md border-2 border-black bg-white p-5 shadow-hard-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">Market gap · English vs Japanese</span>
          <p className="mt-1 text-[10px] font-bold text-muted-text">
            Each grade indexed to the pricier market of the two — the radius is a ratio, not a price
          </p>
        </div>
        <MarketDataBadge isReal={isReal} />
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-4">
        {data.map((series) => (
          <span key={series.label} className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-black" style={{ backgroundColor: series.color }} />
            {series.label}
          </span>
        ))}
      </div>

      {/* Axes drawn in the site's own subtle border rather than the library's
          `var(--border)`, which this project never defines as a raw custom
          property — only as the `--color-border` theme mapping — so it would
          have fallen back to black and buried the polygons in scaffolding.

          No <RadarGrid>. Its concentric rings are computed from their own
          angles — `i * step + step / 2`, with no -PI/2 offset — while the
          areas and the axes both use the context's getAngle, which does
          offset. The rings therefore render rotated against the data they are
          meant to be read against; on three metrics that draws a triangle
          pointing the opposite way from the polygons. Dropped rather than
          patched: components/charts is vendored and the next `shadcn add`
          overwrites it. The spokes end at 100, so the rim is still legible. */}
      {/* Explicit size, centred: left to fill its container the radar takes
          the panel's full width as a square, which made this card twice the
          height of everything around it for a shape carrying three points.
          300 also still fits inside the card's padding at a 375px viewport,
          so it never needs to scroll sideways. */}
      <div className="market-gap-radar flex justify-center">
        <RadarChart data={data} levels={4} margin={44} metrics={metrics} size={300}>
          <RadarAxis stroke="var(--border-subtle)" strokeOpacity={1} />
          <RadarLabels fontSize={10} />
          {drawOrder.map(({ i }) => (
            <RadarArea color={data[i].color} index={i} key={data[i].label} />
          ))}
        </RadarChart>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 border-t-2 border-border-subtle pt-3 sm:grid-cols-2">
        {rows.map((row) => {
          const cheaperIsJapanese = row.japanese < row.english;
          const gapPct = Math.round((1 - Math.min(row.english, row.japanese) / Math.max(row.english, row.japanese)) * 100);
          return (
            <div key={row.label} className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">{row.label}</dt>
              <dd className="text-xs font-black tabular-nums">
                {currency} {row.english.toLocaleString()}
                <span className="mx-1 font-bold text-muted-text">vs</span>
                {currency} {row.japanese.toLocaleString()}
                {/* No colour on the gap: neither market is the "good" one — which
                    is cheaper depends on what the reader is trying to do, so this
                    states the fact and stops. */}
                <span className="ml-1.5 text-[10px] font-bold text-muted-text">
                  {gapPct === 0 ? "level" : `${cheaperIsJapanese ? "JP" : "EN"} ${gapPct}% cheaper`}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
