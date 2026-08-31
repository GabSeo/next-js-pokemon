/**
 * Within +/-5% of the 3-month average reads as noise, not a real move, so it
 * is labelled Stable rather than Bullish/Bearish — a +0.3% blip should not
 * look like a directional signal.
 */
export const STABLE_THRESHOLD_PCT = 5;

export type TrendSignal = {
  /** Current price against its own 90-day average, in percent. Null when there is no comparable point. */
  pct: number | null;
  label: "Bullish" | "Bearish" | "Stable" | "Flat";
};

/**
 * A real derived fact — where the current price sits against its own 90-day
 * average — and never a forecast.
 *
 * Lifted out of components/price-chart.tsx when the Market Overview's vitals
 * strip needed the same verdict: two copies of the threshold would have been
 * two chances for the page to call the same card Stable in one place and
 * Bullish in another.
 */
export function trendSignal(lastPrice: number, day90: number | null | undefined): TrendSignal {
  const pct = day90 && day90 > 0 ? ((lastPrice - day90) / day90) * 100 : null;
  if (pct === null) return { pct: null, label: "Flat" };
  if (pct > STABLE_THRESHOLD_PCT) return { pct, label: "Bullish" };
  if (pct < -STABLE_THRESHOLD_PCT) return { pct, label: "Bearish" };
  return { pct, label: "Stable" };
}
