/**
 * A symmetric-log scale for the net-outcome chart, where the numbers on the
 * two sides of zero routinely differ by two orders of magnitude.
 *
 * WHY NOT LINEAR. Measured on a real card in this build: PSA 10 nets +USD 250
 * while PSA 9 nets −USD 9, PSA 8 −USD 17 and selling raw −USD 2. On one linear
 * scale the profit fills the lane and all three losses render as slivers two
 * or three pixels wide — indistinguishable from each other and from zero. The
 * losses are the half of the chart that decides whether to grade at all, so a
 * scale that erases them defeats the chart.
 *
 * WHY NOT PLAIN LOG. log(0) is negative infinity and log of a negative number
 * is undefined, so a pure log scale cannot render a break-even outcome or a
 * loss at all. Symlog is the standard answer: linear through zero, logarithmic
 * once past a threshold.
 *
 *   t(v) = log10(1 + |v| / C),  C = 5 USD
 *
 * At v = 0 this is exactly 0, so break-even sits on the zero line rather than
 * at minus infinity. Below about a dollar it is near-linear, so small amounts
 * keep their proportions to each other. Past C it compresses, so a 100x spread
 * costs roughly two lane-widths of travel instead of a hundred.
 *
 * EVERYTHING HERE IS DERIVED FROM THE VALUES PASSED IN. No constant is tuned
 * to today's figures — the assumptions panel lets a reader put in any card
 * cost and fee they like, which can turn every outcome negative, or make the
 * profit tiny and the losses large, or invert which side dominates. The scale
 * has to survive all of that, so the only fixed number in this file is C.
 */

/** The linear threshold, in the same currency unit as the values. */
export const SYMLOG_LINEAR_THRESHOLD = 5;

/** Distance from zero on the transformed scale. Always >= 0. */
export function symlogDistance(value: number, c: number = SYMLOG_LINEAR_THRESHOLD): number {
  if (!Number.isFinite(value)) return 0;
  return Math.log10(1 + Math.abs(value) / c);
}

/** One bar's geometry, as percentages of the lane's full width. */
export type SymlogBar = {
  /** Percentage offset of the bar's left edge. */
  leftPct: number;
  /** Percentage width of the bar. */
  widthPct: number;
  /** True when the value is >= 0 — the bar grows right from zero. */
  positive: boolean;
};

export type SymlogScale = {
  /** Where the zero line sits, as a percentage of lane width. */
  zeroPct: number;
  /** Percentage of the lane given to losses (left of zero). */
  negShare: number;
  /** Percentage of the lane given to profits (right of zero). */
  posShare: number;
  /** Place one value on the lane. */
  bar: (value: number) => SymlogBar;
  /** Power-of-ten gridlines that fall inside the rendered domain, both sides. */
  ticks: { value: number; leftPct: number; label: string }[];
};

/**
 * When only one sign is present the zero line still has to be visible — it is
 * the thing every bar is measured from. Parking it hard against the edge (6%
 * / 94%) keeps it on screen and gives the single populated side essentially
 * the whole lane, which is what an all-losses or all-profits card should look
 * like.
 */
const ONE_SIDED_ZERO_PCT = { positivesOnly: 6, negativesOnly: 94, empty: 50 };

export function buildSymlogScale(
  values: number[],
  { c = SYMLOG_LINEAR_THRESHOLD, currency = "USD" }: { c?: number; currency?: string } = {}
): SymlogScale {
  const finite = values.filter((v) => Number.isFinite(v));
  const positives = finite.filter((v) => v > 0);
  const negatives = finite.filter((v) => v < 0);

  const tPos = positives.length > 0 ? Math.max(...positives.map((v) => symlogDistance(v, c))) : 0;
  const tNeg = negatives.length > 0 ? Math.max(...negatives.map((v) => symlogDistance(v, c))) : 0;

  const zeroPct =
    tPos > 0 && tNeg > 0
      ? (tNeg / (tPos + tNeg)) * 100
      : tPos > 0
        ? ONE_SIDED_ZERO_PCT.positivesOnly
        : tNeg > 0
          ? ONE_SIDED_ZERO_PCT.negativesOnly
          : ONE_SIDED_ZERO_PCT.empty;

  const negShare = zeroPct;
  const posShare = 100 - zeroPct;

  const bar = (value: number): SymlogBar => {
    const positive = value >= 0;
    const side = positive ? tPos : tNeg;
    const share = positive ? posShare : negShare;
    // A side with no magnitude to scale against draws nothing rather than
    // dividing by zero — the min-width in the component keeps a break-even
    // row visible as a mark on the line.
    const frac = side > 0 ? symlogDistance(value, c) / side : 0;
    const widthPct = Math.max(0, frac * share);
    return positive
      ? { leftPct: zeroPct, widthPct, positive }
      : { leftPct: Math.max(0, zeroPct - widthPct), widthPct, positive };
  };

  /**
   * Gridlines at every power of ten the data actually spans, on both sides,
   * so the compression is legible rather than merely applied — without them a
   * reader has no way to know the scale is not linear.
   */
  const ticks: SymlogScale["ticks"] = [];
  for (const sign of [-1, 1] as const) {
    const side = sign > 0 ? tPos : tNeg;
    if (side <= 0) continue;
    for (let power = 1; power <= 6; power++) {
      const value = 10 ** power;
      if (symlogDistance(value, c) > side) break;
      const { leftPct, widthPct } = bar(sign * value);
      ticks.push({
        value: sign * value,
        leftPct: sign > 0 ? leftPct + widthPct : leftPct,
        label: `${sign < 0 ? "−" : ""}${currency} ${value.toLocaleString("en-US")}`,
      });
    }
  }

  return { zeroPct, negShare, posShare, bar, ticks };
}
