"use client";

import {
  ANCHOR_HEAD,
  CurrencyBadge,
  Headline,
  MarketCard,
  MarketCardHead,
  REGION_HEAD_TINT,
  RegionLockup,
  SourceAction,
  SourceLockup,
  Stat,
  StatGrid,
} from "@/components/retro/market-panel-parts";
import type { MarketValuation } from "@/lib/market-views";

/**
 * The left-hand card in every tab: what this card is worth in this market,
 * according to the one source that market answers to.
 *
 * ONE COMPONENT FOR BOTH MARKETPLACES, which is the change that made the
 * three tabs read as one section. It used to be two — TcgplayerPrimary and
 * CardmarketPrimary — each with its own row set, its own absent-value
 * wording and its own idea of where the footer sat, so switching market
 * moved the headline, resized the grid and shifted the link. TCGplayer and
 * Cardmarket publish genuinely different metrics and those differences are
 * real, but they belong in the DATA (lib/market-views.ts maps each source's
 * fields to the same four labelled slots), not in two divergent layouts.
 *
 * So this component knows nothing about marketplaces. It renders a
 * MarketValuation: a headline, four statistics, one explanatory note and one
 * link. Every tab hands it the same shape, which is why the eye finds the
 * same thing in the same place across all three.
 *
 * ABSENCES ARE RENDERED, not skipped. A statistic with no figure prints why
 * ("No asks", "Not published"), because the row rhythm is load-bearing and
 * because a dropped row turns a stated absence into a silent omission — the
 * same rule lib/graded-market.ts's `noListings` follows.
 */
export function MarketValuationCard({ valuation }: { valuation: MarketValuation }) {
  return (
    <MarketCard tone={valuation.region?.tone}>
      <MarketCardHead tint={valuation.region ? REGION_HEAD_TINT[valuation.region.tone] : undefined}>
        {/* On the Japanese view the header leads with the MARKET, because two
            markets share that panel and which one you are reading is the first
            thing to establish. Everywhere else the market is settled by the tab
            and the header leads with the source instead. */}
        {valuation.region ? (
          <RegionLockup logo={valuation.logo} region={valuation.region} />
        ) : (
          <SourceLockup context={valuation.sourceContext} logo={valuation.logo} name={valuation.sourceName} />
        )}
        {/* Currency only. There was a yellow "Primary" pill beside it saying
            this source is the one its market answers to — which the tab, the
            region chip and the source lockup all say already, so it was a
            fourth voice on a settled point and it went. */}
        <span className="flex shrink-0 items-center gap-2">
          <CurrencyBadge currency={valuation.currency} />
        </span>
      </MarketCardHead>

      <Headline
        absent={valuation.headlineAbsent}
        amount={valuation.headline}
        basis={valuation.headlineBasis}
        currency={valuation.currency}
        label={valuation.headlineLabel}
        saleChip={valuation.saleChip}
      />

      <StatGrid>
        {valuation.stats.map((stat, index) => (
          <Stat
            absent={stat.absent}
            amount={stat.amount}
            currency={valuation.currency}
            index={index}
            key={stat.label}
            label={stat.label}
          />
        ))}
      </StatGrid>

      {/* "What this means" is no longer here — it sits under the evidence in
          the right-hand card, where the thing it explains actually is. This
          card is now the figure and nothing but: headline, four stats, source
          link. See WhatThisMeans for why the note survives the move. */}
      <SourceAction label={valuation.actionLabel} url={valuation.url} />
    </MarketCard>
  );
}

/**
 * The valuation card's resting shape, in the exact boxes the real one fills.
 *
 * Used while the section has no data to draw yet. Every block is the same
 * height as its live counterpart (the ANCHOR_* constants are shared), so a
 * skeleton replacing a card, or a card replacing a skeleton, moves nothing
 * on the page.
 */
export function MarketValuationSkeleton() {
  return (
    <MarketCard>
      <div className={`flex items-center gap-2.5 border-b-2 border-black bg-muted-surface px-5 py-3 ${ANCHOR_HEAD}`}>
        <SkeletonBox className="h-[30px] w-9" />
        <div className="flex flex-col gap-1.5">
          <SkeletonBox className="h-3 w-24" />
          <SkeletonBox className="h-2 w-32" />
        </div>
      </div>
      <div className="px-5 pt-5 lg:h-[140px]">
        <SkeletonBox className="h-2.5 w-28" />
        <SkeletonBox className="mt-2 h-9 w-48" />
        <SkeletonBox className="mt-3 h-2.5 w-40" />
      </div>
      <div className="mx-5 mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border-2 border-border-subtle lg:h-[152px]">
        {[0, 1, 2, 3].map((i) => (
          <div className="flex flex-col justify-center gap-2 px-3 py-2.5" key={i}>
            <SkeletonBox className="h-2.5 w-20" />
            <SkeletonBox className="h-3.5 w-16" />
          </div>
        ))}
      </div>
      <div className="mx-5 mt-4 rounded-md border-l-4 border-pokemon-blue bg-muted-surface px-3 py-2.5 lg:min-h-[84px]">
        <SkeletonBox className="h-2.5 w-28" />
        <SkeletonBox className="mt-2 h-2.5 w-full" />
      </div>
      <div className="mt-auto px-5 pt-4 pb-5">
        <SkeletonBox className="h-3 w-36" />
      </div>
    </MarketCard>
  );
}

export function SkeletonBox({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-sm bg-muted-surface ${className}`} />;
}
