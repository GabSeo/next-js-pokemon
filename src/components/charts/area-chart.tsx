"use client";

import { LinearGradient } from "@visx/gradient";
import { GridRows } from "@visx/grid";
import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "d3-shape";
import { motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { DEFAULT_CHART_ENTER_TRANSITION } from "./animation";
import { chartCssVars } from "./chart-context";

/**
 * Bklit's Area Chart, for an ordered series of a handful of points.
 *
 * WHY THIS FILE EXISTS RATHER THAN `shadcn add @bklit/area-chart`. Every
 * other chart in this folder was installed from the @bklit registry
 * (components.json's `registries`), and this one was meant to be too. The
 * registry host is not reachable from this environment — `npx shadcn add
 * @bklit/area-chart` fails at `https://ui.bklit.com/r/area-chart.json`, and
 * so does a plain fetch of the same URL, with the egress proxy answering 403
 * for the host rather than the request 404ing. So the component is written
 * here against the same foundations the installed bklit charts use — visx
 * scales and shapes, Motion for the reveal, and this folder's own
 * `chartCssVars` / `DEFAULT_CHART_ENTER_TRANSITION` — instead of pulling in a
 * second charting library beside it.
 *
 * It is deliberately a small surface: `data`, an accessor pair, a colour, a
 * formatter. When the registry is reachable again, `shadcn add
 * @bklit/area-chart` can replace this file wholesale; the one consumer
 * (retro/market-trend-card.tsx) passes plain rows and a formatter, which is
 * the shape bklit's own chart takes.
 *
 * WHAT IT IS NOT: the source of truth for the figures. bklit draws SVG, so
 * everything in here is geometry rather than text — an agent parsing raw
 * HTML reads none of it. The consumer prints the same values as real text
 * underneath, the same division of labour retro/grade-ladder-chart.tsx
 * already documents.
 *
 * ACCESSIBILITY. The plot is one `role="img"` with a spoken description of
 * the whole series, because three separate focusable points describing
 * "893.64 euros" one at a time is a worse reading of a trend than one
 * sentence. Hovering or focusing the visible value chips beneath the chart
 * (the consumer's job) is what surfaces per-point detail for a mouse; the
 * tooltip here is a pointer affordance layered on top of that, never the
 * only route to a number.
 */

export type AreaChartPoint = {
  /** X label, printed under the point. */
  label: string;
  /** Y value. `null` renders as a gap — never as zero. */
  value: number | null;
};

export interface AreaChartProps {
  data: AreaChartPoint[];
  /** Formats a value for the tooltip and the point labels. */
  formatValue: (value: number) => string;
  /** Series colour. Any CSS colour, including a `var(--…)` token. */
  color?: string;
  /** Spoken description of the whole series — this is the chart's accessible name. */
  ariaLabel: string;
  /** Plot height in px. The container reserves it up front, so nothing shifts when the chart measures itself. */
  height?: number;
  className?: string;
  /**
   * `"loading"` draws a dimension-identical shimmer instead of the series.
   * The chart also shows it while it has no measured width yet, which is
   * every render before the browser has laid the container out.
   */
  status?: "ready" | "loading";
}

const MARGIN = { top: 18, right: 16, bottom: 14, left: 16 };

export function AreaChart({
  data,
  formatValue,
  color = "var(--pokemon-blue)",
  ariaLabel,
  height = 168,
  className,
  status = "ready",
}: AreaChartProps) {
  return (
    <div className={cn("relative w-full", className)} style={{ height }}>
      <ParentSize debounceTime={0}>
        {({ width }) =>
          width < 1 || status === "loading" ? (
            <AreaChartSkeleton height={height} />
          ) : (
            <AreaChartPlot
              ariaLabel={ariaLabel}
              color={color}
              data={data}
              formatValue={formatValue}
              height={height}
              width={width}
            />
          )
        }
      </ParentSize>
    </div>
  );
}

/**
 * The resting shape of the chart, in the exact box the real one occupies.
 * Shown before the container has been measured as well as for an explicit
 * `status="loading"`, so the block never collapses and then re-expands.
 */
function AreaChartSkeleton({ height }: { height: number }) {
  return (
    <div
      aria-hidden
      className="h-full w-full animate-pulse rounded-md bg-[linear-gradient(180deg,var(--muted-surface),transparent)]"
      style={{ height }}
    />
  );
}

function AreaChartPlot({
  ariaLabel,
  color,
  data,
  formatValue,
  height,
  width,
}: {
  ariaLabel: string;
  color: string;
  data: AreaChartPoint[];
  formatValue: (value: number) => string;
  height: number;
  width: number;
}) {
  const gradientId = useId().replace(/:/g, "");
  const reduceMotion = useReducedMotion();
  const [hovered, setHovered] = useState<number | null>(null);

  const innerWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(1, height - MARGIN.top - MARGIN.bottom);

  const plotted = data.map((d, i) => ({ ...d, index: i })).filter((d) => d.value != null);
  const values = plotted.map((d) => d.value as number);

  // A flat series still has to draw as a line rather than as a division by
  // zero, so an all-equal domain is padded rather than collapsed.
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 1;
  const pad = max === min ? Math.max(max * 0.1, 1) : (max - min) * 0.12;

  const xScale = scaleLinear<number>({
    domain: [0, Math.max(1, data.length - 1)],
    range: [0, innerWidth],
  });
  const yScale = scaleLinear<number>({
    domain: [min - pad, max + pad],
    range: [innerHeight, 0],
    nice: true,
  });

  const x = (d: { index: number }) => xScale(d.index);
  const y = (d: { value: number | null }) => yScale(d.value as number);

  return (
    <div className="relative h-full w-full">
      <svg
        aria-label={ariaLabel}
        className="block overflow-visible"
        height={height}
        role="img"
        width={width}
      >
        <LinearGradient from={color} fromOpacity={0.28} id={gradientId} to={color} toOpacity={0} />
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          <GridRows
            height={innerHeight}
            numTicks={3}
            scale={yScale}
            stroke={chartCssVars.grid}
            strokeDasharray="3 4"
            width={innerWidth}
          />

          {plotted.length > 1 && (
            // The reveal is a clip that widens, which is how every cartesian
            // chart in this folder enters (see clipRevealTransition in
            // animation.ts). With reduced motion the clip starts full width,
            // so the series is complete on first paint rather than animated
            // quickly.
            <>
              <clipPath id={`${gradientId}-clip`}>
                <motion.rect
                  animate={{ width: innerWidth }}
                  height={innerHeight + MARGIN.top}
                  initial={reduceMotion ? false : { width: 0 }}
                  transition={DEFAULT_CHART_ENTER_TRANSITION}
                  width={innerWidth}
                  x={0}
                  y={-MARGIN.top}
                />
              </clipPath>
              <g clipPath={`url(#${gradientId}-clip)`}>
                <AreaClosed
                  curve={curveMonotoneX}
                  data={plotted}
                  fill={`url(#${gradientId})`}
                  x={x}
                  y={y}
                  yScale={yScale}
                />
                <LinePath
                  curve={curveMonotoneX}
                  data={plotted}
                  stroke={color}
                  strokeLinecap="round"
                  strokeWidth={3}
                  x={x}
                  y={y}
                />
              </g>
            </>
          )}

          {plotted.map((d) => (
            <g key={d.label}>
              <circle
                cx={x(d)}
                cy={y(d)}
                fill="var(--card-surface)"
                r={5}
                stroke={color}
                strokeWidth={3}
              />
              {/* A generous invisible target so the tooltip is reachable with
                  a mouse without shrinking the visible dot to a pinprick. */}
              <rect
                fill="transparent"
                height={innerHeight + MARGIN.top}
                onMouseEnter={() => setHovered(d.index)}
                onMouseLeave={() => setHovered(null)}
                width={Math.max(24, innerWidth / Math.max(1, data.length))}
                x={x(d) - Math.max(12, innerWidth / Math.max(1, data.length) / 2)}
                y={-MARGIN.top}
              />
            </g>
          ))}
        </g>
      </svg>

      {/* The tooltip is HTML rather than SVG text so it inherits the page's
          type and the card's own surface tokens, and so it can never be
          clipped by the plot's own viewBox. */}
      {hovered != null && data[hovered]?.value != null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border-2 border-black bg-card-surface px-2 py-1 text-[11px] font-black whitespace-nowrap shadow-hard-sm"
          role="presentation"
          style={{
            left: Math.min(Math.max(MARGIN.left + xScale(hovered), 44), width - 44),
            top: MARGIN.top + yScale(data[hovered].value as number) - 10,
          }}
        >
          <span className="text-muted-text">{data[hovered].label} · </span>
          {formatValue(data[hovered].value as number)}
        </div>
      )}
    </div>
  );
}
