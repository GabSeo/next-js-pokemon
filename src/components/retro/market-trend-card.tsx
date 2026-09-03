"use client";

import { AreaChart } from "@/components/charts/area-chart";
import {
  ANCHOR_VIZ,
  CurrencyBadge,
  MarketCard,
  MarketCardHead,
  SourceLockup,
  WhatThisMeans,
} from "@/components/retro/market-panel-parts";
import { formatMarketMoney, type MarketNote, type TrendIntelligence } from "@/lib/market-views";

/**
 * The EU tab's right-hand card: where Cardmarket's price has been going.
 *
 * WHY A CHART HERE AND BARS ON THE OTHER TWO TABS. The US and Japanese tabs
 * compare five different things at one moment — a marketplace, a raw copy,
 * three grades — and five unlike quantities are a length comparison. Europe
 * has one product and one seller pool; what Cardmarket publishes beyond
 * today's trend is the SAME quantity over three windows (30-day, 7-day,
 * 1-day), which is a direction, not a ranking. Drawing three points of one
 * series as three bars invites a reader to compare them as if they were
 * different things.
 *
 * The chart is bklit's Area Chart (components/charts/area-chart.tsx, which
 * documents why that file is written out rather than installed from the
 * @bklit registry). It draws SVG, so the three figures are ALSO printed as
 * text underneath — an agent parsing raw HTML reads the values there, the
 * same division of labour retro/grade-ladder-chart.tsx already documents.
 *
 * The Japanese print stays a SECONDARY insight on this tab. It earns the
 * collector-insight slot because Cardmarket is the one place two prints
 * genuinely compare — same currency, same buyers, no conversion — but the
 * tab is about the European market for the Western card, and the action at
 * the bottom is what hands a curious reader over to the Japanese view rather
 * than trying to serve both here.
 */
export function MarketTrendCard({
  intelligence,
  isActive,
  note,
}: {
  intelligence: TrendIntelligence;
  /** Closes this card — see WhatThisMeans for why the explanation lives under the evidence. */
  note: MarketNote;
  /** Whether this card's tab is on screen — the chart only mounts (and only measures) when it is. */
  isActive: boolean;
}) {
  const points = intelligence.points;
  const plottable = points.filter((p) => p.amount != null).length;

  return (
    <MarketCard>
      <MarketCardHead>
        {/* No logo here — see SourceLockup's own doc comment. This is the EU
            tab's RIGHT panel; the Cardmarket mark already sits one column to
            the left, on the valuation card, which is the only place a
            TCGplayer/Cardmarket logo shows on the US and EU tabs. */}
        <SourceLockup context={intelligence.subtitle} name={intelligence.title} />
        <CurrencyBadge currency={intelligence.currency} />
      </MarketCardHead>

      <div className={`flex flex-col border-b-2 border-border-subtle px-5 py-4 ${ANCHOR_VIZ}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">
              {intelligence.vizLabel}
            </span>
            <h4 className="mt-1 text-base font-black tracking-[-0.4px]">{intelligence.vizTitle}</h4>
          </div>
          <span className="shrink-0 rounded-sm bg-muted-surface px-1.5 py-0.5 text-[10px] font-black tracking-[0.4px] text-muted-text uppercase">
            {points.length} windows
          </span>
        </div>

        {/* Two points is the minimum a line can honestly connect. Below that
            the windows are still shown as figures underneath — a single
            published average is a fact worth printing, it just is not a
            trend. */}
        {plottable >= 2 ? (
          <div className="mt-2 flex-1">
            {/* Mounted only while this tab is on screen. The chart measures
                its own container, and a hidden container measures zero — so a
                chart mounted behind `hidden` would render at zero width and
                then jump to full size on the first frame after the tab was
                selected. Mounting on activation also puts its reveal where
                someone can see it. */}
            {isActive && (
              <AreaChart
                ariaLabel={intelligence.chartDescription}
                color="var(--pokemon-blue)"
                data={points.map((p) => ({ label: p.label, value: p.amount }))}
                formatValue={(value) => formatMarketMoney(value, intelligence.currency)}
                height={164}
              />
            )}
          </div>
        ) : (
          <p className="mt-4 flex-1 text-[12px] font-bold text-muted-text text-pretty">
            {intelligence.chartDescription}
          </p>
        )}

        {/* The figures as text, always — on the tab or off it, chart or no
            chart. This is the accessible equivalent of the plot and the only
            copy of these numbers an agent can read. */}
        <dl className="mt-3 grid grid-cols-3 gap-1.5">
          {points.map((point) => (
            <div className="rounded-md border-2 border-border-subtle bg-muted-surface px-2 py-1.5" key={point.label}>
              <dt className="text-[9px] font-black tracking-[0.4px] text-muted-text uppercase">{point.shortLabel}</dt>
              <dd className="mt-0.5 text-[13px] font-black tabular-nums">
                {point.amount == null ? (
                  <span className="text-[11px] font-bold text-muted-text">Not published</span>
                ) : (
                  formatMarketMoney(point.amount, intelligence.currency)
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <WhatThisMeans note={note} />
    </MarketCard>
  );
}
