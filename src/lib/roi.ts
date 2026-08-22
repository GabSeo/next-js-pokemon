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
