/**
 * Rough estimate of PSA's standard-tier submission fee — not fetched from
 * anywhere, PSA's real pricing varies by declared value and turnaround
 * speed. Treat as a configurable assumption, not a verified figure; shown
 * next to the ROI result so it's never presented as more precise than it is.
 */
export const DEFAULT_PSA_GRADING_COST_USD = 25;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * ROI of raw -> PSA 10 -> sell, using active-listing medians only (never the
 * illustrative sold data — see GradedMarketPanel). rawMedian is what you'd
 * pay to buy the raw card today; psa10Median is what a PSA 10 of the same
 * card is asking today; gradingCost is the assumed submission fee.
 */
export function gradingRoi(
  psa10Median: number,
  rawMedian: number,
  gradingCost: number = DEFAULT_PSA_GRADING_COST_USD
): number {
  const totalCost = rawMedian + gradingCost;
  return (psa10Median - totalCost) / totalCost;
}

/**
 * The three numbers a reader is allowed to change, and the only inputs to
 * every figure in the verdict.
 *
 * `cardCost` is what YOU pay for the raw card, which is not the same thing as
 * the raw market median even though the median is its default. A reader who
 * already owns the card, or who bought it in a lot, has a different number —
 * and until this was editable the whole verdict silently assumed everyone
 * paid today's asking price.
 *
 * `feeRate` is a FRACTION (0.13), not a percentage (13). The control shows
 * percent because that is how marketplaces quote it; everything below the
 * control works in the fraction, so no formula has to remember to divide.
 */
export type GradingAssumptions = {
  /** What the raw card costs you. */
  cardCost: number;
  /** PSA's submission fee, per card. */
  gradingFee: number;
  /** Marketplace commission as a fraction of the sale price, 0–0.99. */
  feeRate: number;
};

/**
 * Every assumption forced into a range the formulas below can survive.
 *
 * Called at the boundary rather than inside each formula, so the maths reads
 * as maths. The clamps are not cosmetic: a fee of 100% makes
 * `breakEvenSalePrice` divide by zero, and a negative cost turns a loss into
 * a profit — both reachable from a number input, and both nonsense a reader
 * would then have to distrust the rest of the panel over.
 */
export function normalizeAssumptions(input: Partial<GradingAssumptions>): GradingAssumptions {
  const finite = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return {
    cardCost: Math.max(0, finite(input.cardCost, 0)),
    gradingFee: Math.max(0, finite(input.gradingFee, DEFAULT_PSA_GRADING_COST_USD)),
    // 0.99 rather than 1: at exactly 1 the marketplace takes everything and
    // break-even is infinite, which is a division to avoid rather than a
    // number to show.
    feeRate: Math.min(0.99, Math.max(0, finite(input.feeRate, DEFAULT_MARKETPLACE_FEE_RATE))),
  };
}

/**
 * eBay's headline final-value fee for trading cards, as a starting point
 * rather than a quote. Real rates move with category, store subscription and
 * promoted-listing choices, which is exactly why the control that carries
 * this number is editable.
 */
export const DEFAULT_MARKETPLACE_FEE_RATE = 0.13;

/** What you keep after a GRADED sale: proceeds, less the marketplace's cut, less both costs. */
export function gradedNetProfit(salePrice: number, a: GradingAssumptions): number {
  return salePrice * (1 - a.feeRate) - a.cardCost - a.gradingFee;
}

/** What you keep selling it RAW — the same sale minus the same commission, but no grading fee. */
export function rawNetProfit(salePrice: number, a: GradingAssumptions): number {
  return salePrice * (1 - a.feeRate) - a.cardCost;
}

/**
 * Return on the money actually put at risk — card plus grading fee.
 *
 * Null when nothing was spent. A percentage of zero outlay is either infinite
 * or meaningless depending on the sign, and neither belongs on screen; the
 * caller shows the cash figure alone instead.
 */
export function roiPercent(netProfit: number, a: GradingAssumptions): number | null {
  const outlay = a.cardCost + a.gradingFee;
  return outlay > 0 ? (netProfit / outlay) * 100 : null;
}

/** The sale price at which a graded copy finally repays card + grading + commission. */
export function breakEvenSalePrice(a: GradingAssumptions): number {
  return (a.cardCost + a.gradingFee) / (1 - a.feeRate);
}
