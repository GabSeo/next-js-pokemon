"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useRef, useState } from "react";
import type { PriceHistoryPoint, PriceTrend } from "@/lib/types";

type PriceChartProps = {
  history: PriceHistoryPoint[];
  currency: string;
  /** Windowed averages, from card.trend — feeds both the bullish/bearish signal (day90) and the range-tab values. */
  trend?: PriceTrend | null;
  className?: string;
};

type RangeId = "7d" | "30d" | "90d" | "all";

const RANGES: { id: RangeId; label: string; days: number | null }[] = [
  { id: "7d", label: "7D", days: 7 },
  { id: "30d", label: "30D", days: 30 },
  { id: "90d", label: "90D", days: 90 },
  { id: "all", label: "All", days: null },
];

/** Trailing-N-day slice of full history, oldest-to-newest order preserved. Falls back to the full series if a window is too sparse to plot (e.g. a card with < 2 days of data). */
function sliceByDays(history: PriceHistoryPoint[], days: number | null): PriceHistoryPoint[] {
  if (days === null) return history;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const window = history.filter((p) => p.date >= cutoffStr);
  return window.length >= 2 ? window : history;
}

function average(history: PriceHistoryPoint[]): number | null {
  if (history.length === 0) return null;
  const sum = history.reduce((total, p) => total + p.price, 0);
  return Math.round((sum / history.length) * 100) / 100;
}

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
const COLOR_STABLE = "#2a78d6"; // dataviz categorical slot 1 (blue) — reads as "steady", not an alert, so kept out of the good/critical/neutral status set

type Point = { x: number; y: number; date: string; price: number };

function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatLongDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
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
 * title/subtitle + stat boxes in the header, a range-tab bar borrowed from
 * the same reference (7D/30D/90D/All), and a wide/flat server-rendered SVG
 * line per range with evenly-spaced date ticks and a hover crosshair below.
 *
 * Range switching follows the same pattern as PriceDataTabs: every range's
 * <PriceChartSvg> is rendered up front and only toggled via the `hidden`
 * attribute, never mounted/fetched on click. So an AI crawler reading raw
 * HTML sees all four ranges' full data regardless of which tab a human has
 * open — the reference's version, by contrast, only has one Recharts
 * <LineChart> whose data swaps client-side, which would leave the
 * non-default ranges completely absent from the server HTML.
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
 * 1. Every static label (title, subtitle, stat boxes, tab values, dates) is
 *    plain HTML/SVG text, unanimated, un-gated — present in the raw server
 *    HTML immediately. Dropping the left-axis price labels and on-line
 *    min/max callouts (to match the reference's clean look) doesn't remove
 *    any data from the site — it's still fully in the JSON/Markdown
 *    mirrors, the stat boxes, and the hover tooltip; this only changes what
 *    a human sees by default.
 * 2. The hover crosshair/tooltip IS conditionally rendered (only while the
 *    mouse is over the chart) — safe specifically because the per-point
 *    data it reveals is already fully available elsewhere (the JSON/
 *    Markdown mirrors and the "Last sold" tab carry the complete series),
 *    and because hovering is itself a JS-only interaction with no non-JS
 *    equivalent to preserve — unlike the line/dot, there's no "hidden by
 *    default" state here for a no-JS visitor to get stuck in.
 */
export function PriceChart({ history, currency, trend, className }: PriceChartProps) {
  // Defaults to "all" (not "90d") so the chart's own visible low/high always
  // matches PriceDataTabs' "Price range" stat, which is computed over the
  // full fetched history (100 days) — with the 90d default, a low/high
  // outside the trailing 90 days would show in the stat but not on screen.
  const [activeRange, setActiveRange] = useState<RangeId>("all");

  if (history.length === 0) return null;

  const last = history[history.length - 1];
  const first = history[0];

  const rangeValues: Record<RangeId, number | null> = {
    "7d": trend?.day7 ?? null,
    "30d": trend?.day30 ?? null,
    "90d": trend?.day90 ?? null,
    all: average(history),
  };

  // trend signal — a real derived fact (current vs its own 90-day average),
  // not a forecast. Requires at least one comparable data point.
  const trendDay90 = trend?.day90 ?? null;
  const trendPct =
    trendDay90 && trendDay90 > 0 ? ((last.price - trendDay90) / trendDay90) * 100 : null;

  // Within +/-5% of the 3mo avg reads as noise, not a real move — labeled
  // "Stable" instead of Bullish/Bearish so a +0.3% blip doesn't look like a
  // directional signal.
  const STABLE_THRESHOLD_PCT = 5;
  const isBullish = trendPct !== null && trendPct > STABLE_THRESHOLD_PCT;
  const isBearish = trendPct !== null && trendPct < -STABLE_THRESHOLD_PCT;
  const isStable = trendPct !== null && !isBullish && !isBearish;
  const badgeColor = isBullish
    ? COLOR_GOOD
    : isBearish
      ? COLOR_CRITICAL
      : isStable
        ? COLOR_STABLE
        : COLOR_NEUTRAL;

  return (
    <div className={`${className ?? "w-full"} rounded-lg border border-border bg-card p-6`}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div className="flex-1 rounded-lg border border-border p-4">
          <h2 className="text-xs font-normal uppercase tracking-[0.08em]">Price history</h2>
          <p className="mt-1 text-[10px] tracking-[0.02em] text-muted-foreground">
            Showing price history from {formatShortDate(first.date)} to {formatShortDate(last.date)}
          </p>
        </div>

        <div className="rounded-lg border border-border p-4 sm:w-48">
          <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Last price</div>
          <data value={String(last.price)} className="block text-xl font-normal tabular-nums">
            {currency} {last.price}
          </data>
        </div>

        <div
          className="rounded-lg border p-4 sm:w-56"
          style={{ backgroundColor: `${badgeColor}1a`, borderColor: `${badgeColor}40` }}
        >
          <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Trend signal</div>
          <div className="mt-1 flex items-center gap-2">
            {isBullish ? (
              <TrendingUp size={32} strokeWidth={2.5} style={{ color: badgeColor }} />
            ) : isBearish ? (
              <TrendingDown size={32} strokeWidth={2.5} style={{ color: badgeColor }} />
            ) : (
              <Minus size={32} strokeWidth={2.5} style={{ color: badgeColor }} />
            )}
            <div>
              <div className="text-sm font-normal" style={{ color: badgeColor }}>
                {isBullish ? "Bullish" : isBearish ? "Bearish" : isStable ? "Stable" : "Flat"}
              </div>
              <div className="text-[10px] tracking-[0.02em] text-muted-foreground">
                {trendPct !== null
                  ? `${trendPct > 0 ? "+" : ""}${Math.round(trendPct * 10) / 10}% vs 3mo avg`
                  : "No trend data"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div role="tablist" aria-label="Price history range" className="mb-4 flex rounded-lg border border-border">
        {RANGES.map((rangeDef, i) => {
          const value = rangeValues[rangeDef.id];
          return (
            <button
              key={rangeDef.id}
              type="button"
              role="tab"
              aria-selected={activeRange === rangeDef.id}
              onClick={() => setActiveRange(rangeDef.id)}
              data-active={activeRange === rangeDef.id}
              className={`flex flex-1 flex-col justify-center gap-1 px-4 py-3 text-left data-[active=true]:bg-muted/50 ${
                i > 0 ? "border-l border-border" : ""
              }`}
            >
              <span className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{rangeDef.label} avg</span>
              {value !== null ? (
                <data value={String(value)} className="block text-base font-normal tabular-nums">
                  {currency} {value}
                </data>
              ) : (
                <span className="text-base font-normal tabular-nums">—</span>
              )}
            </button>
          );
        })}
      </div>

      {RANGES.map((rangeDef) => (
        <div key={rangeDef.id} hidden={activeRange !== rangeDef.id}>
          <PriceChartSvg history={sliceByDays(history, rangeDef.days)} currency={currency} />
        </div>
      ))}
    </div>
  );
}

/** Draws one range's line — pure function of the (already-sliced) history it's given. */
function PriceChartSvg({ history, currency }: { history: PriceHistoryPoint[]; currency: string }) {
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

  return (
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
            const tooltipWidth = 168;
            const tooltipHeight = 54;
            const flip = hovered.x + tooltipWidth > WIDTH - PAD_RIGHT;
            const tx = flip ? hovered.x - tooltipWidth : hovered.x + 10;
            const ty = Math.max(PAD_TOP, hovered.y - tooltipHeight - 10);
            return (
              <foreignObject x={tx} y={ty} width={tooltipWidth} height={tooltipHeight} style={{ pointerEvents: "none", overflow: "visible" }}>
                <div
                  style={{
                    width: tooltipWidth,
                    height: tooltipHeight,
                    boxSizing: "border-box",
                    borderRadius: 10,
                    border: "1px solid var(--border, #e5e5e1)",
                    background: "var(--popover, #fff)",
                    boxShadow: "0 6px 16px rgba(0,0,0,0.14)",
                    padding: "8px 10px",
                    fontFamily: "inherit",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--popover-foreground, #0b0b0b)" }}>
                    {formatLongDate(hovered.date)}
                  </div>
                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: trendColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: "var(--muted-foreground, #737373)", flex: 1 }}>Price</span>
                    <data
                      value={String(hovered.price)}
                      style={{ fontSize: 12, fontWeight: 700, color: "var(--popover-foreground, #0b0b0b)" }}
                    >
                      {currency} {hovered.price}
                    </data>
                  </div>
                </div>
              </foreignObject>
            );
          })()}
        </g>
      )}
    </svg>
  );
}
