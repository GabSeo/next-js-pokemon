"use client";

import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { BarYAxis } from "@/components/charts/bar-y-axis";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip";
import { EyebrowTitle } from "@/components/retro/eyebrow-title";
import { ENGLISH_COLOR, JAPANESE_COLOR, type GradeTableRow } from "@/components/retro/grade-rows";
import { MarketDataBadge } from "@/components/retro/market-data-badge";

/**
 * Median asking price per grade, English against Japanese, as paired bars.
 *
 * It used to plot one market — whichever the toggle had selected — which left
 * the reader holding three views of one comparison and no way to see it: this
 * chart showed a single side, a radar showed the ratio between the sides in
 * indexed units, and the table stated both in numbers. Paired bars put the
 * comparison on the axis the prices already share, which is what made the
 * radar redundant enough to remove rather than shrink.
 *
 * A market with no listings for a grade draws no bar, and that is the honest
 * shape: a stub would read as a very cheap listing and a zero-height bar as a
 * rendering fault. The line under the chart names any grade missing a side, so
 * an absent bar is explained rather than guessed at, and the table says it
 * again in words.
 *
 * The figures live in the table under the card, not here — bklit draws SVG, so
 * these bars are geometry rather than text, and the table is where an agent
 * parsing raw HTML reads them.
 */
export function GradeLadderChart({ rows, isReal }: { rows: GradeTableRow[]; isReal: boolean }) {
  // Nothing to compare when every grade came back empty in both markets: four
  // absent bars and a shrug, worse than the table's own empty state.
  const priced = rows.filter((r) => (r.english?.median ?? 0) > 0 || (r.japanese?.median ?? 0) > 0);
  if (priced.length === 0) return null;

  // 0 is how a missing market reaches the chart — visx needs a number, and a
  // zero-length bar is simply not drawn. `absent` below is what tells the
  // reader why, because the chart itself cannot.
  const data = rows.map((r) => ({
    tier: r.label,
    english: r.english?.median ?? 0,
    japanese: r.japanese?.median ?? 0,
  }));

  const absent = rows
    .filter((r) => ((r.english?.median ?? 0) > 0) !== ((r.japanese?.median ?? 0) > 0))
    .map((r) => `${r.label}: no ${(r.english?.median ?? 0) > 0 ? "Japanese" : "English"} listings`);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <EyebrowTitle tone="blue">Grade ladder · English vs Japanese</EyebrowTitle>
          <p className="mt-1.5 text-[11px] font-bold text-muted-text">Median asking price per grade, today</p>
        </div>
        {!isReal && <MarketDataBadge isReal={isReal} />}
      </div>

      {/* The legend the radar used to carry. It belongs to the bars now. */}
      <div className="mb-2 flex flex-wrap items-center gap-4">
        {[
          { label: "English", color: ENGLISH_COLOR },
          { label: "Japanese", color: JAPANESE_COLOR },
        ].map((series) => (
          <span
            key={series.label}
            className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.5px] text-muted-text uppercase"
          >
            <span className="h-2.5 w-2.5 rounded-[2px] border-2 border-black" style={{ backgroundColor: series.color }} />
            {series.label}
          </span>
        ))}
      </div>

      {/* Two <Bar> children with stacking left off is what makes bklit group
          them side by side inside each grade's band (see seriesCount in
          bar.tsx). Nothing else changed from the single-series version. */}
      <BarChart
        aspectRatio="5 / 3"
        barGap={0.35}
        className="grade-ladder-chart"
        data={data}
        margin={{ top: 12, right: 16, bottom: 12, left: 60 }}
        orientation="horizontal"
        xDataKey="tier"
      >
        <Grid vertical />
        <Bar dataKey="english" fill={ENGLISH_COLOR} lineCap={0} />
        <Bar dataKey="japanese" fill={JAPANESE_COLOR} lineCap={0} />
        <BarYAxis />
        <ChartTooltip />
      </BarChart>

      {absent.length > 0 && <p className="mt-2 text-[10px] font-bold text-muted-text">{absent.join(" · ")}</p>}
    </div>
  );
}
