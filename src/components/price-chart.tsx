import type { PriceHistoryPoint } from "@/lib/types";

type PriceChartProps = {
  history: PriceHistoryPoint[];
  currency: string;
  className?: string;
};

const WIDTH = 640;
const HEIGHT = 200;
const PADDING = 24;

/**
 * Pure server-rendered SVG line chart — no client JS, no charting library.
 * The underlying numbers are also present as plain text below the chart
 * (see the price table on the product page) so the data isn't locked inside
 * SVG path coordinates for anything trying to read it as text.
 */
export function PriceChart({ history, currency, className }: PriceChartProps) {
  if (history.length === 0) return null;

  const prices = history.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const points = history.map((p, i) => {
    const x =
      PADDING + (i / (history.length - 1 || 1)) * (WIDTH - PADDING * 2);
    const y =
      HEIGHT - PADDING - ((p.price - min) / range) * (HEIGHT - PADDING * 2);
    return { x, y, point: p };
  });

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={className}
      role="img"
      aria-label={`Price history chart from ${currency} ${min} to ${currency} ${max}`}
    >
      <title>Price history</title>
      <line
        x1={PADDING}
        y1={HEIGHT - PADDING}
        x2={WIDTH - PADDING}
        y2={HEIGHT - PADDING}
        className="stroke-border"
        strokeWidth={1}
      />
      <path
        d={path}
        fill="none"
        className="stroke-foreground"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p) => (
        <circle
          key={p.point.date}
          cx={p.x}
          cy={p.y}
          r={3}
          className="fill-foreground"
        />
      ))}
    </svg>
  );
}
