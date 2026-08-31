"use client";

import { GradeLadderChart } from "@/components/retro/grade-ladder-chart";
import { ENGLISH_COLOR, JAPANESE_COLOR, type GradeTableRow } from "@/components/retro/grade-rows";
import { formatPrice } from "@/lib/format-price";

/** Below this a market gap is not worth calling out — it is inside the noise of four asks. */
const NOTABLE_GAP_PCT = 10;

function gapPct(a: number, b: number): number {
  return Math.round((1 - Math.min(a, b) / Math.max(a, b)) * 100);
}

/**
 * The one line a reader should leave with, computed from the same medians the
 * charts draw.
 *
 * Two facts, in the order they matter: how far grading moves the price, then
 * whether the other market prices that grade differently enough to care. Both
 * clauses are dropped rather than padded when the data cannot support them —
 * no raw price means no multiple, no gap over the threshold means no second
 * clause, and neither means no headline at all rather than a sentence that
 * says nothing.
 *
 * Says "asks" and never "sells". These are the cheapest live asking prices,
 * which is the caveat the whole panel is built on.
 */
function gradingInsight(rows: GradeTableRow[], market: string, currency: string): string | null {
  const priced = rows.filter((r) => (r.english?.median ?? 0) > 0 || (r.japanese?.median ?? 0) > 0);
  if (priced.length === 0) return null;

  const inMarket = (r: GradeTableRow) => (market === "Japanese" ? r.japanese : r.english);
  const raw = rows.find((r) => r.label === "Raw");
  const rawPrice = raw ? (inMarket(raw)?.median ?? 0) : 0;

  // The highest grade this card actually has a price for — LAST in the list,
  // not first: these rows are in ladder order, raw first, so `graded[0]` is
  // the lowest grade and the headline would have reported PSA 8 as the target
  // of grading. Not an assumed PSA 10 either, since One Piece cards top out
  // at whatever tier lib/graded-market.ts queried for that franchise.
  const graded = rows.filter((r) => r.label !== "Raw" && (inMarket(r)?.median ?? 0) > 0);
  const top = graded.at(-1);
  const topPrice = top ? (inMarket(top)?.median ?? 0) : 0;

  const clauses: string[] = [];
  if (top && rawPrice > 0 && topPrice > 0) {
    const multiple = topPrice / rawPrice;
    // Named market, now that the chart under it plots both. Unqualified,
    // "PSA 10 asks 3.2x a raw copy" read as a fact about the card when it is
    // a fact about one of the two series drawn below.
    clauses.push(`${market} ${top.label} asks ${multiple >= 10 ? multiple.toFixed(0) : multiple.toFixed(1)}× a raw copy`);
  } else if (top && topPrice > 0) {
    clauses.push(`${market} ${top.label} asks ${formatPrice(topPrice, currency)}`);
  }

  const widest = rows
    .filter((r) => (r.english?.median ?? 0) > 0 && (r.japanese?.median ?? 0) > 0)
    .map((r) => ({ label: r.label, pct: gapPct(r.english!.median, r.japanese!.median), jpCheaper: r.japanese!.median < r.english!.median }))
    .sort((a, b) => b.pct - a.pct)[0];

  if (widest && widest.pct >= NOTABLE_GAP_PCT) {
    clauses.push(`${widest.jpCheaper ? "Japanese" : "English"} runs ${widest.pct}% cheaper at ${widest.label}`);
  }

  return clauses.length > 0 ? `${clauses.join(" — and ")}.` : null;
}

/** A price with the number of listings behind it, demoted to a footnote-sized figure. */
function PriceCell({ value, currency }: { value: { median: number; count: number } | null; currency: string }) {
  if (!value || value.median <= 0) {
    return <span className="text-[11px] font-bold whitespace-nowrap text-muted-text">No listings</span>;
  }
  return (
    <span className="whitespace-nowrap">
      <span className="text-[13px] font-black tracking-[-0.2px] tabular-nums">{formatPrice(value.median, currency)}</span>{" "}
      {/* Kept in the markup rather than hidden behind a hover: sample size is
          a trust signal, and this site's rule is that anything on screen is as
          readable to an agent parsing raw HTML as to a human. Demoted to 9px
          muted so it stops competing with the price, with the full wording on
          the title attribute for anyone who needs it spelled out. */}
      <span className="text-[9px] font-bold text-muted-text tabular-nums" title={`${value.count} live listings`}>
        ·{value.count}
      </span>
    </span>
  );
}

/**
 * The two market readings and the numbers behind them, as one panel.
 *
 * Three tiers, in this order. The headline is a sentence synthesised from the
 * medians — the takeaway the reader was previously left to assemble by
 * eye from a bar chart, a radar and two differently-shaped stat rows. The
 * charts are the evidence for it. The table is the detail, at the bottom, at
 * the smallest weight.
 *
 * The two stat rows are gone, replaced by one table. They described the same
 * four grades in two different shapes — a flat four-column row of single
 * prices, then a two-column list of comparisons — which is why they never
 * read as one system however their type was matched. A grade is a row; the
 * markets are columns; the gap is the column that compares them. One shape,
 * and both charts' figures live in it.
 *
 * Neither chart is touched. This supplies the frame, the heading, the rhythm
 * and the table only.
 */
export function GradeAnalysisCard({
  ladderIsReal,
  tableRows,
  currency,
  market,
}: {
  ladderIsReal: boolean;
  tableRows: GradeTableRow[];
  currency: string;
  /** The market the headline's multiple is read in — named in the sentence, since the chart now shows both. */
  market: string;
}) {
  const insight = gradingInsight(tableRows, market, currency);

  return (
    // No overflow-hidden. The chart's tooltip is an absolutely positioned
    // element inside the chart container, and for the lower bars it sits near
    // the bottom of the plot and extends past it — clipped by this card, so
    // hovering PSA 9 or PSA 10 registered (the other bars faded) but produced
    // no visible tooltip. Nothing here bleeds to the edge and needs clipping;
    // rounded-lg shapes the corners on its own.
    <div className="rounded-lg border-2 border-black bg-card-surface p-5 shadow-hard-sm sm:p-6">
      <div className="border-b-2 border-border-subtle pb-4">
        <h3 className="text-lg leading-6 font-black tracking-[-0.45px]">Grading economics</h3>
        {insight ? (
          <p className="mt-1.5 text-[15px] leading-[22px] font-bold text-pretty">{insight}</p>
        ) : (
          <p className="mt-1.5 text-[11px] font-bold text-muted-text">
            Not enough priced grades on this card to compare yet
          </p>
        )}
        <p className="mt-1.5 text-[11px] font-bold text-muted-text">
          Cheapest live asking prices, per grade and market
        </p>
      </div>

      <div className="pt-5">
        <GradeLadderChart isReal={ladderIsReal} rows={tableRows} />
      </div>

      {/* Scrolls inside its own container rather than wrapping. A four-column
          table cannot fit a phone, and the requirement that no figure ever
          breaks across two lines outranks seeing every column at once. */}
      <div className="mt-5 overflow-x-auto border-t-2 border-border-subtle pt-4">
        <table className="w-full min-w-[500px] border-collapse text-left">
          <thead>
            <tr className="text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">
              <th className="pb-2 pr-3 font-black">Grade</th>
              {/* Same square, same colour, as the bars above — the column and
                  its series have to be identifiable as one thing. */}
              <th className="pb-2 pr-3 font-black">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[2px] border border-black" style={{ backgroundColor: ENGLISH_COLOR }} />
                  English
                </span>
              </th>
              <th className="pb-2 pr-3 font-black">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[2px] border border-black" style={{ backgroundColor: JAPANESE_COLOR }} />
                  Japanese
                </span>
              </th>
              <th className="pb-2 font-black">Gap</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => {
              const en = row.english && row.english.median > 0 ? row.english : null;
              const ja = row.japanese && row.japanese.median > 0 ? row.japanese : null;
              const pct = en && ja ? gapPct(en.median, ja.median) : null;
              return (
                <tr key={row.label} className="border-t border-border-subtle">
                  <td className="py-2.5 pr-3 text-[11px] font-black tracking-[0.4px] whitespace-nowrap uppercase">
                    {row.label}
                  </td>
                  <td className="py-2.5 pr-3">
                    <PriceCell currency={currency} value={en} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <PriceCell currency={currency} value={ja} />
                  </td>
                  <td className="py-2.5 text-[11px] font-bold whitespace-nowrap text-muted-text">
                    {pct === null ? (
                      "—"
                    ) : pct === 0 ? (
                      "Level"
                    ) : (
                      <>
                        {ja!.median < en!.median ? "JP" : "EN"} {pct}% cheaper
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10px] font-bold text-muted-text">
        Small figures after each price are how many listings it was taken from.
      </p>
    </div>
  );
}
