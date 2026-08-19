import type { PriceHistoryPoint } from "@/lib/types";

type PriceChartProps = {
  history: PriceHistoryPoint[];
  currency: string;
  className?: string;
};

const WIDTH = 640;
const HEIGHT = 220;
const PAD_LEFT = 104; // room for axis labels like "USD 1048.09" without clipping the left edge
const PAD_RIGHT = 16;
const PAD_TOP = 32; // room for the endpoint price label when the endpoint is also the chart's high
const PAD_BOTTOM = 28;

// dataviz skill's status palette (validated, same hex both light/dark surfaces)
const COLOR_GOOD = "#0ca30c";
const COLOR_CRITICAL = "#d03b3b";
const COLOR_NEUTRAL = "#898781"; // dataviz "muted" ink

type Point = { x: number; y: number; date: string; price: number };

/** Uniform Catmull-Rom to cubic-Bezier conversion — smooths the line without a library. */
function smoothPath(points: Point[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;
  }
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

/**
 * Pure server-rendered SVG line chart — no client JS, no charting library.
 * Styling follows the dataviz skill: status-colored trend line (green/red by
 * direction, gray if flat), a light area wash, smoothed curve, recessive
 * gridlines, and sparse direct labels (endpoint + extremes only — never a
 * label on every point). All of this is static markup, so it's identical
 * for a human browser and a non-JS-executing crawler.
 *
 * The underlying numbers are also present as plain text elsewhere on the
 * page (the price-data tabs), so the data isn't locked inside SVG path
 * coordinates for anything trying to read it as text.
 */
export function PriceChart({ history, currency, className }: PriceChartProps) {
  if (history.length === 0) return null;

  const prices = history.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const baselineY = HEIGHT - PAD_BOTTOM;

  const points: Point[] = history.map((p, i) => ({
    x: PAD_LEFT + (i / (history.length - 1 || 1)) * (WIDTH - PAD_LEFT - PAD_RIGHT),
    y: baselineY - ((p.price - min) / range) * (baselineY - PAD_TOP),
    date: p.date,
    price: p.price,
  }));

  const first = points[0];
  const last = points[points.length - 1];
  const trendColor =
    last.price > first.price ? COLOR_GOOD : last.price < first.price ? COLOR_CRITICAL : COLOR_NEUTRAL;

  const linePath = smoothPath(points);
  const areaPath = `${linePath} L${last.x.toFixed(1)},${baselineY.toFixed(1)} L${first.x.toFixed(1)},${baselineY.toFixed(1)} Z`;

  const minPoint = points.reduce((a, b) => (b.price < a.price ? b : a));
  const maxPoint = points.reduce((a, b) => (b.price > a.price ? b : a));
  const midPrice = Math.round(((min + max) / 2) * 100) / 100;
  const gridlines = [
    { y: PAD_TOP, label: max },
    { y: PAD_TOP + (baselineY - PAD_TOP) / 2, label: midPrice },
    { y: baselineY, label: min },
  ];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={className}
      role="img"
      aria-label={`Price history chart from ${currency} ${min} to ${currency} ${max}, ${first.date} to ${last.date}`}
    >
      <title>Price history</title>

      {gridlines.map((g) => (
        <g key={g.y}>
          <line
            x1={PAD_LEFT}
            y1={g.y}
            x2={WIDTH - PAD_RIGHT}
            y2={g.y}
            stroke="#e1e0d9"
            strokeWidth={1}
          />
          <text x={PAD_LEFT - 8} y={g.y + 4} textAnchor="end" fontSize="11" fill={COLOR_NEUTRAL}>
            {currency} {g.label}
          </text>
        </g>
      ))}

      <path d={areaPath} fill={trendColor} fillOpacity={0.1} stroke="none" />
      <path d={linePath} fill="none" stroke={trendColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

      {/* endpoint marker, with a surface-color ring so it stays legible crossing gridlines */}
      <circle cx={last.x} cy={last.y} r={6} fill="var(--background, #fff)" />
      <circle cx={last.x} cy={last.y} r={4} fill={trendColor} />

      <text x={last.x} y={last.y - 12} textAnchor="end" fontSize="12" fontWeight={600} fill="var(--foreground, #0b0b0b)">
        {currency} {last.price}
      </text>

      {minPoint.price !== last.price && minPoint.price !== first.price && (
        <text x={minPoint.x} y={minPoint.y + 16} textAnchor="middle" fontSize="10" fill={COLOR_NEUTRAL}>
          low {currency} {minPoint.price}
        </text>
      )}
      {maxPoint.price !== last.price && maxPoint.price !== first.price && (
        <text x={maxPoint.x} y={maxPoint.y - 8} textAnchor="middle" fontSize="10" fill={COLOR_NEUTRAL}>
          high {currency} {maxPoint.price}
        </text>
      )}

      <text x={first.x} y={HEIGHT - 6} textAnchor="start" fontSize="10" fill={COLOR_NEUTRAL}>
        {first.date}
      </text>
      <text x={last.x} y={HEIGHT - 6} textAnchor="end" fontSize="10" fill={COLOR_NEUTRAL}>
        {last.date}
      </text>
    </svg>
  );
}
