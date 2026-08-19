"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
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
const PAD_LEFT = 104; // room for axis labels like "USD 1048.09" without clipping the left edge
const PAD_RIGHT = 16;
const PAD_TOP = 20;
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
 * Full-width dashboard-style price chart: title/subtitle + a current-price
 * stat callout in the header, a wide/flat server-rendered SVG line below,
 * with a Motion-animated reveal and hover crosshair layered on top for
 * JS-enabled visitors. Agent-safety rules kept:
 *
 * 1. Only decorative marks (line, end-dot) animate via opacity / pathLength
 *    / scale — properties that never remove content from the DOM.
 * 2. Every static label (title, subtitle, stat callout, prices, dates) is
 *    plain HTML/SVG text, unanimated, un-gated — present in the raw server
 *    HTML immediately.
 * 3. The hover crosshair/tooltip IS conditionally rendered (only while the
 *    mouse is over the chart) — safe specifically because the per-point
 *    data it reveals is already fully available elsewhere (the JSON/
 *    Markdown mirrors and the "Last sold" tab carry the complete series),
 *    so hiding it by default doesn't hide anything that isn't already
 *    public in full.
 */
export function PriceChart({ history, currency, trendDay90, className }: PriceChartProps) {
  const reduceMotion = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

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

  const minPoint = points.reduce((a, b) => (b.price < a.price ? b : a));
  const maxPoint = points.reduce((a, b) => (b.price > a.price ? b : a));
  const midPrice = Math.round(((min + max) / 2) * 100) / 100;
  const gridlines = [
    { y: PAD_TOP, label: max },
    { y: PAD_TOP + (baselineY - PAD_TOP) / 2, label: midPrice },
    { y: baselineY, label: min },
  ];

  const t = (delay: number, duration: number, extra?: Record<string, unknown>) =>
    reduceMotion ? { duration: 0 } : { delay, duration, ...extra };

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const usableWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
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
    <div className={className ?? "w-full"}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Price history</h2>
          <p className="text-sm text-muted-foreground">
            Showing price history from {first.date} to {last.date}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Current price</div>
          <div className="text-xl font-bold tabular-nums">
            {currency} {last.price}
          </div>
          {trendPct !== null && (
            <div
              className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ color: badgeColor, backgroundColor: `${badgeColor}1a` }}
            >
              {isBullish ? <TrendingUp size={12} /> : isBearish ? <TrendingDown size={12} /> : null}
              {isBullish ? "Bullish" : isBearish ? "Bearish" : "Flat"} {trendPct > 0 ? "+" : ""}
              {Math.round(trendPct * 10) / 10}% vs 3-month avg
            </div>
          )}
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

        {gridlines.map((g) => (
          <g key={g.y}>
            <line x1={PAD_LEFT} y1={g.y} x2={WIDTH - PAD_RIGHT} y2={g.y} stroke="#e1e0d9" strokeWidth={1} />
            <text x={PAD_LEFT - 8} y={g.y + 4} textAnchor="end" fontSize="11" fill={COLOR_NEUTRAL}>
              {currency} {g.label}
            </text>
          </g>
        ))}

        <motion.path
          d={linePath}
          fill="none"
          stroke={trendColor}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={t(0, 1.2, { ease: "easeInOut" })}
        />

        {/* endpoint marker, with a surface-color ring so it stays legible crossing gridlines */}
        <circle cx={last.x} cy={last.y} r={5} fill="var(--background, #fff)" />
        <motion.circle
          cx={last.x}
          cy={last.y}
          r={3.5}
          fill={trendColor}
          style={{ transformOrigin: `${last.x}px ${last.y}px` }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={t(1.3, 0.4, { type: "spring", stiffness: 300, damping: 20 })}
        />

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
              const tooltipText = `${hovered.date}  ${currency} ${hovered.price}`;
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
