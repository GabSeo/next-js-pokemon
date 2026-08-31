"use client";

import { GradeLadderChart, type GradeLadderRow } from "@/components/retro/grade-ladder-chart";
import { MarketGapRadar, type MarketGapRow } from "@/components/retro/market-gap-radar";

/**
 * The two market readings in one panel: what each grade is worth, and which
 * market pays more for it.
 *
 * They were two bordered cards stacked with a gap between them, which framed
 * them as unrelated widgets that happened to be adjacent. They are not — the
 * second one only means anything in terms of the first. The ladder says a PSA
 * 10 asks four times what a raw copy does; the radar says which side of the
 * Pacific that multiple is bigger on. One card, one heading, a thin rule
 * between the sections instead of a gap, and the narrative holds.
 *
 * Neither chart is touched. Both still render exactly what the charting
 * library produces; this only supplies the frame, the headings, the rhythm
 * and the divider they sit in.
 *
 * Stacked, not side by side. The radar needs its width — squeezed into a
 * column beside the ladder it lost the labels around its rim, and on a phone
 * the two would have wrapped into the same stack anyway.
 */
export function GradeAnalysisCard({
  ladder,
  ladderIsReal,
  gapRows,
  gapIsReal,
  currency,
  market,
}: {
  ladder: GradeLadderRow[];
  ladderIsReal: boolean;
  gapRows: MarketGapRow[];
  gapIsReal: boolean;
  currency: string;
  market: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border-2 border-black bg-card-surface p-5 shadow-hard-sm sm:p-6">
      {/* The one heading that says these belong together. Without it the
          sections read as two reports filed in the same folder. */}
      <div className="border-b-2 border-border-subtle pb-4">
        <h3 className="text-lg leading-6 font-black tracking-[-0.45px]">Grading economics</h3>
        <p className="mt-1 text-[11px] font-bold text-muted-text">
          What each grade is worth, and which market pays more for it
        </p>
      </div>

      <div className="pt-5">
        <GradeLadderChart currency={currency} isReal={ladderIsReal} market={market} rows={ladder} />
      </div>

      {/* A rule, not a gap. The sections are one argument in two parts. */}
      <div className="mt-6 border-t-2 border-border-subtle pt-5">
        <MarketGapRadar currency={currency} isReal={gapIsReal} rows={gapRows} />
      </div>
    </div>
  );
}
