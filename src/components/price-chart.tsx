"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useRef, useState } from "react";
import type { PriceHistoryPoint } from "@/lib/types";

type PriceChartProps = {
  history: PriceHistoryPoint[];
  currency: string;
  /** 90-day average price, from card.trend.day90 — used for the bullish/bearish signal. */
  trendDay90?: number | null;
  className?: string;
};

// wide/flat aspect ratio (~5:1), matching a full-width dashboard-style chart
const WIDTH = 1000;
const HEIGHT = 190;
const PAD_LEFT = 16; // no left-axis price labels anymore, so minimal margin like the reference
const PAD_RIGHT = 16;
const PAD_TOP = 20;
const PAD_BOTTOM = 28;

// dataviz skill's status palette (validated, same hex both light/dark surfaces)
const COLOR_GOOD = "#0ca30c";
const COLOR_CRITICAL = "#d03b3b";
const COLOR_NEUTRAL = "#898781"; // dataviz "muted" ink

type Point = { x: number; y: number; date: string; price: number };

function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

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
 * Full-width dashboard-style price chart, styled to closely match a
 * reference design (shadcn's "Line Chart - Interactive"): bordered card,
 * title/subtitle + a bordered current-price stat box in the header, a
 * wide/flat server-rendered SVG line with evenly-spaced date ticks below,
 * and a hover crosshair layered on top for JS-enabled visitors.
 *
 * No entrance animation on the line/end-dot, on purpose: an earlier version
 * animated them in with Motion (pathLength/scale from 0), which is safe for
 * a text-reading crawler (the numbers are always in the DOM) but NOT safe
 * for an actual human with JavaScript disabled or failed — Motion renders
 * the *hidden* initial state server-side and only animates to visible after
 * hydration, so with no JS the line and dot stayed permanently invisible.
 * Confirmed by disabling JS and finding an empty chart. Fixed by keeping
 * the line/dot as plain, always-rendered SVG — they're the actual chart,
 * not decoration, so they don't get to be conditionally invisible.
 *
 * Agent-safety rules kept:
 * 1. Every static label (title, subtitle, stat box, dates) is plain HTML/
 *    SVG text, unanimated, un-gated — present in the raw server HTML
 *    immediately. Dropping the left-axis price labels and on-line min/max
 *    callouts (to match the reference's clean look) doesn't remove any
 *    data from the site — it's still fully in the JSON/Markdown mirrors,
 *    the stat box, and the hover tooltip; this only changes what's shown
 *    by default on the human page.
 * 2. The hover crosshair/tooltip IS conditionally rendered (only while the
 *    mouse is over the chart) — safe specifically because the per-point
 *    data it reveals is already fully available elsewhere (the JSON/
 *    Markdown mirrors and the "Last sold" tab carry the complete series),
 *    and because hovering is itself a JS-only interaction with no non-JS
 *    equivalent to preserve — unlike the line/dot, there's no "hidden by
 *    default" state here for a no-JS visitor to get stuck in.
 */
export function PriceChart({ history, currency, trendDay90, className }: PriceChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (history.length === 0) return null;

  const prices = history.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const baselineY = HEIGHT - PAD_BOTTOM;
  const usableWidth = WIDTH - PAD_LEFT - PAD_RIGHT;

  const points: Point[] = history.map((p, i) => ({
    x: PAD_LEFT + (i / (history.length - 1 || 1)) * usableWidth,
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

  const midY = PAD_TOP + (baselineY - PAD_TOP) / 2;
  const gridlineYs = [PAD_TOP, midY, baselineY];

  // evenly-spaced x-axis date ticks (by index, not raw pixels) — aim for
  // roughly one label per ~90px so they never collide, matching the
  // reference's "Apr 5, Apr 10, Apr 15..." cadence instead of just the
  // two endpoints.
  const tickCount = Math.max(2, Math.min(points.length, Math.floor(usableWidth / 90) + 1));
  const tickIndices = [...new Set(
    Array.from({ length: tickCount }, (_, i) => Math.round((i / (tickCount - 1 || 1)) * (points.length - 1)))
  )];

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const fraction = (relX - PAD_LEFT) / usableWidth;
    const index = Math.round(fraction * (points.length - 1));
    setHoverIndex(Math.max(0, Math.min(points.length - 1, index)));
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  // trend signal — a real derived fact (current vs its own 90-day average),
  // not a forecast. Requires at least one comparable data point.
  const trendPct =
    trendDay90 && trendDay90 > 0 ? ((last.price - trendDay90) / trendDay90) * 100 : null;
  const isBullish = trendPct !== null && trendPct > 0;
  const isBearish = trendPct !== null && trendPct < 0;
  const badgeColor = isBullish ? COLOR_GOOD : isBearish ? COLOR_CRITICAL : COLOR_NEUTRAL;

  return (
    <div className={`${className ?? "w-full"} rounded-xl border border-border bg-card p-6`}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div className="flex-1 rounded-lg border border-border p-4">
          <h2 className="text-base font-semibold">Price history</h2>
          <p className="text-sm text-muted-foreground">
            Showing price history from {formatShortDate(first.date)} to {formatShortDate(last.date)}
          </p>
        </div>

        <div className="rounded-lg border border-border p-4 sm:w-48">
          <div className="text-xs text-muted-foreground">Last price</div>
          <div className="text-xl font-bold tabular-nums">
            {currency} {last.price}
          </div>
        </div>

        <div
          className="rounded-lg border p-4 sm:w-56"
          style={{ backgroundColor: `${badgeColor}1a`, borderColor: `${badgeColor}40` }}
        >
          <div className="text-xs text-muted-foreground">Trend signal</div>
          <div className="mt-1 flex items-center gap-2">
            {isBullish ? (
              <TrendingUp size={32} strokeWidth={2.5} style={{ color: badgeColor }} />
            ) : isBearish ? (
              <TrendingDown size={32} strokeWidth={2.5} style={{ color: badgeColor }} />
            ) : (
              <Minus size={32} strokeWidth={2.5} style={{ color: badgeColor }} />
            )}
            <div>
              <div className="text-sm font-semibold" style={{ color: badgeColor }}>
                {isBullish ? "Bullish" : isBearish ? "Bearish" : "Flat"}
              </div>
              <div className="text-xs text-muted-foreground">
                {trendPct !== null
                  ? `${trendPct > 0 ? "+" : ""}${Math.round(trendPct * 10) / 10}% vs 3mo avg`
                  : "No trend data"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Price history chart from ${currency} ${min} to ${currency} ${max}, ${first.date} to ${last.date}`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <title>Price history</title>

        {gridlineYs.map((y) => (
          <line key={y} x1={PAD_LEFT} y1={y} x2={WIDTH - PAD_RIGHT} y2={y} stroke="#e1e0d9" strokeWidth={1} />
        ))}

        <path d={areaPath} fill={trendColor} fillOpacity={0.12} stroke="none" />

        <path
          d={linePath}
          fill="none"
          stroke={trendColor}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* endpoint marker, with a surface-color ring so it stays legible crossing gridlines */}
        <circle cx={last.x} cy={last.y} r={5} fill="var(--background, #fff)" />
        <circle cx={last.x} cy={last.y} r={3.5} fill={trendColor} />

        {tickIndices.map((i, tickPos) => {
          const p = points[i];
          const anchor = tickPos === 0 ? "start" : tickPos === tickIndices.length - 1 ? "end" : "middle";
          return (
            <text key={p.date} x={p.x} y={HEIGHT - 6} textAnchor={anchor} fontSize="10" fill={COLOR_NEUTRAL}>
              {formatShortDate(p.date)}
            </text>
          );
        })}

        {/* hover crosshair + tooltip — additive convenience layer, see doc comment above */}
        {hovered && (
          <g>
            <line
              x1={hovered.x}
              y1={PAD_TOP}
              x2={hovered.x}
              y2={baselineY}
              stroke={COLOR_NEUTRAL}
              strokeWidth={1}
              strokeDasharray="3,3"
            />
            <circle cx={hovered.x} cy={hovered.y} r={5} fill="var(--background, #fff)" stroke={trendColor} strokeWidth={2} />
            {(() => {
              const tooltipText = `${formatShortDate(hovered.date)}  ${currency} ${hovered.price}`;
              const tooltipWidth = tooltipText.length * 6 + 16;
              const flip = hovered.x + tooltipWidth > WIDTH - PAD_RIGHT;
              const tx = flip ? hovered.x - tooltipWidth : hovered.x;
              const ty = Math.max(PAD_TOP, hovered.y - 34);
              return (
                <g>
                  <rect x={tx} y={ty} width={tooltipWidth} height={22} rx={4} fill="var(--foreground, #0b0b0b)" fillOpacity={0.92} />
                  <text x={tx + 8} y={ty + 15} fontSize="11" fill="var(--background, #fff)">
                    {tooltipText}
                  </text>
                </g>
              );
            })()}
          </g>
        )}
      </svg>
    </div>
  );
}
