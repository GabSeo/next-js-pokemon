import { formatPrice } from "@/lib/format-price";

/** One grade PSA could return, and what that grade asks today. `sale: null` means nothing is listed. */
export type ProfitLadderGrade = {
  label: string;
  sale: number | null;
  /** The grade the card's headline already prices. Sets the scale; never gets a row. */
  target?: boolean;
};

const PIPS = 24;

/** Cost is ink, profit is the brand yellow, a shortfall is the brand red, an untaken pip is grey. */
const COST_FILL = "var(--foreground)";
const PROFIT_FILL = "var(--pokemon-yellow)";
const LOSS_FILL = "var(--pokemon-red)";
const RAW_FILL = "var(--pokemon-blue)";
const EMPTY_FILL = "#f2f2f2";
const EMPTY_BORDER = "#e0e0e0";

/**
 * A green dark enough to read as text at 14px, which --success-green (#21c45d,
 * a signal dot) is not. Same reasoning as lib/chip-colors.ts: the paired text
 * shade is chosen for contrast, not borrowed from the nearest brand colour.
 */
const GAIN_TEXT = "#0a7a3d";

type Pip = { fill: string; border: string };

/**
 * One row's worth of pips on the shared scale.
 *
 * The cost segment is drawn first in ink, the remainder in the row's own tone,
 * and everything past the sale price is left grey. `headroom` reserves a
 * single pip so a profitable row always shows at least one coloured pip past
 * its cost — without it a sale that only just clears the fee rounds to an
 * all-black bar and reads as a loss.
 */
function pipsFor(sale: number, cost: number, scale: number, tone: string): Pip[] {
  if (sale <= 0 || scale <= 0) {
    return Array.from({ length: PIPS }, () => ({ fill: EMPTY_FILL, border: EMPTY_BORDER }));
  }
  const filled = Math.max(1, Math.round((sale / scale) * PIPS));
  const headroom = sale > cost ? 1 : 0;
  const costPips = Math.max(0, Math.min(filled - headroom, Math.round((cost / scale) * PIPS)));

  return Array.from({ length: PIPS }, (_, i) => {
    if (i >= filled) return { fill: EMPTY_FILL, border: EMPTY_BORDER };
    if (i < costPips) return { fill: COST_FILL, border: COST_FILL };
    return { fill: tone, border: "var(--foreground)" };
  });
}

/**
 * What each grade pays back, every row drawn on one shared scale.
 *
 * This replaces per-row percentage gauges, and the shared scale is the whole
 * point of the change. Each row used to be its own 0–100 track of "share of
 * this sale that is profit", which made the rows incomparable: a PSA 9 selling
 * for a fifth of a PSA 10 could show a longer bar, because a small sale with a
 * thin margin and a large sale with a thin margin look identical on their own
 * scales. Drawn against the highest price on the card, a weak grade is visibly
 * short and the dashed break-even line tells you at a glance which rows clear
 * their cost.
 *
 * The line is the same x on every row because the cost is the same on every
 * row — you pay the raw price and the fee whatever comes back. That is the
 * fact the whole block exists to show, and one shared reference states it
 * better than three separate percentages did.
 *
 * The target grade sets the scale but gets no row. Its price is already the
 * headline and the bar directly above this block, and a row would have printed
 * the same figure twice on one card — under a heading that asks what happens
 * when the card does NOT come back a 10, which is the one outcome it is not
 * about. Keeping it as the scale is what the rows are measured against: the
 * grey past each bar is the best case you did not get, and the footnote names
 * the grade so that grey is not a mystery.
 *
 * No chart library here. The pips are flex children, so this renders on the
 * server like the rest of the card, with no client-only mount and none of the
 * float-precision hydration trouble bklit's gauges bring.
 */
export function ProfitLadder({
  grades,
  rawPrice,
  fee,
  currency,
}: {
  /** Best grade first; never Raw, which is the input rather than an outcome. */
  grades: ProfitLadderGrade[];
  rawPrice: number;
  fee: number;
  currency: string;
}) {
  if (grades.length === 0 || rawPrice <= 0) return null;

  const cost = rawPrice + fee;
  const money = (n: number) => formatPrice(n, currency);

  // Scale spans EVERY grade, target included, even though the target is not
  // drawn. Dropping it from the scale too would stretch the weaker rows to
  // fill the width and push break-even against the right edge, which is the
  // opposite of the reading this block exists for. Cost is in the running so
  // the line stays on the chart even when no grade clears it.
  const scale = Math.max(rawPrice, cost, ...grades.map((g) => g.sale ?? 0));
  const shown = grades.filter((grade) => !grade.target);
  const breakEvenPct = Math.min(100, (cost / scale) * 100);

  const rows = shown.map((grade) => {
    if (grade.sale === null) {
      return {
        key: grade.label,
        label: grade.label,
        delta: "No listings",
        deltaColor: "var(--muted-text)",
        note: "Nothing listed at this grade — treat as unpriceable downside",
        pips: pipsFor(0, 0, scale, LOSS_FILL),
      };
    }
    const delta = grade.sale - cost;
    const gained = delta > 0;
    return {
      key: grade.label,
      label: grade.label,
      delta: `${gained ? "+" : "−"}${money(Math.abs(delta))}`,
      deltaColor: gained ? GAIN_TEXT : LOSS_FILL,
      note: gained
        ? `${money(grade.sale)} sale · ${money(cost)} in · you keep ${Math.round((delta / grade.sale) * 100)}% of the sale`
        : `${money(grade.sale)} sale · ${money(-delta)} short of your ${money(cost)}`,
      pips: pipsFor(grade.sale, cost, scale, gained ? PROFIT_FILL : LOSS_FILL),
    };
  });

  // The option the other rows are an argument against: keep the fee, skip the
  // wait, take today's raw price. Its bar starts at zero cost because there is
  // nothing to spend.
  rows.push({
    key: "raw",
    label: "Sell raw now · skip grading",
    delta: `+${money(rawPrice)}`,
    deltaColor: RAW_FILL,
    // Deliberately no turnaround figure. PSA's queue is real but this site has
    // no source for its length, and a specific number of days would be the one
    // invented fact on the card.
    note: `${money(rawPrice)} in hand today, no fee spent and no wait for grading`,
    pips: pipsFor(rawPrice, 0, scale, RAW_FILL),
  });

  return (
    <div className="mt-6 border-t-2 border-border-subtle pt-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-black tracking-[1px] text-muted-text uppercase">Profit ladder · other outcomes</span>
          <h3 className="text-[22px] leading-[27px] font-black tracking-[-0.6px]">What if it doesn&apos;t come back a 10?</h3>
        </div>
        <span className="inline-flex items-center gap-2 text-[11px] font-black tracking-[0.5px] whitespace-nowrap text-muted-text">
          <span className="h-0 w-3.5 border-t-2 border-dashed border-black" />
          BREAK-EVEN {money(cost)}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-3.5">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-sm font-black tracking-[-0.2px]">{row.label}</span>
              <span className="text-sm font-black whitespace-nowrap tabular-nums" style={{ color: row.deltaColor }}>
                {row.delta}
              </span>
            </div>

            <div className="relative flex h-[18px] gap-[3px]">
              {row.pips.map((pip, i) => (
                <span
                  // Pips have no identity beyond their position in the row.
                  key={`${row.key}-${i}`}
                  className="flex-1 border"
                  style={{ backgroundColor: pip.fill, borderColor: pip.border }}
                />
              ))}
              {/* One line, same x on every row, because the cost is the same on
                  every row. Drawn over the pips rather than between them so it
                  lands on the true value instead of the nearest pip edge. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-1 -bottom-1 w-0 border-l-2 border-dashed border-black"
                style={{ left: `${breakEvenPct}%` }}
              />
            </div>

            <span className="text-[11px] font-bold text-pretty text-[#8a8a8a]">{row.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
