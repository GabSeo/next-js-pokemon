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
 * Server-rendered SVG line chart, with a Motion-animated reveal and a hover
 * crosshair layered on top for JS-enabled visitors. Agent-safety rules kept:
 *
 * 1. Only decorative marks (line, area wash, end-dot) animate via opacity /
 *    pathLength / scale — properties that never remove content from the DOM.
 * 2. Every static label (prices, dates, the trend badge) renders
 *    immediately, unanimated, un-gated — present in the raw server HTML.
 * 3. The hover crosshair/tooltip IS conditionally rendered (only while the
 *    mouse is over the chart) — that's fine specifically because the data
 *    it reveals per point is already fully available elsewhere (the JSON/
 *    Markdown mirrors and the "Last sold" tab carry the complete series),
 *    so hiding it by default doesn't hide anything that isn't already
 *    public in full. This is a convenience view, not the only copy.
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
  const areaPath = `${linePath} L${last.x.toFixed(1)},${baselineY.toFixed(1)} L${first.x.toFixed(1)},${baselineY.toFixed(1)} Z`;

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
  const trendBadgeColor = isBullish ? COLOR_GOOD : isBearish ? COLOR_CRITICAL : COLOR_NEUTRAL;

  return (
    <div className="w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={className}
        role="img"
        aria-label={`Price history chart from ${currency} ${min} to ${currency} ${max}, ${first.date} to ${last.date}`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
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

        <motion.path
          d={areaPath}
          fill={trendColor}
          fillOpacity={0.1}
          stroke="none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={t(1.0, 0.6)}
        />
        <motion.path
          d={linePath}
          fill="none"
          stroke={trendColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={t(0, 1.2, { ease: "easeInOut" })}
        />

        {/* endpoint marker, with a surface-color ring so it stays legible crossing gridlines */}
        <circle cx={last.x} cy={last.y} r={6} fill="var(--background, #fff)" />
        <motion.circle
          cx={last.x}
          cy={last.y}
          r={4}
          fill={trendColor}
          style={{ transformOrigin: `${last.x}px ${last.y}px` }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={t(1.3, 0.4, { type: "spring", stiffness: 300, damping: 20 })}
        />

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

      <div className="mt-2 flex items-center justify-end gap-2 text-sm">
        <span className="font-semibold">
          {currency} {last.price}
        </span>
        {trendPct !== null && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ color: trendBadgeColor, backgroundColor: `${trendBadgeColor}1a` }}>
            {isBullish ? <TrendingUp size={12} /> : isBearish ? <TrendingDown size={12} /> : null}
            {isBullish ? "Bullish" : isBearish ? "Bearish" : "Flat"} {trendPct > 0 ? "+" : ""}
            {Math.round(trendPct * 10) / 10}% vs 3-month avg
          </span>
        )}
      </div>
    </div>
  );
}
