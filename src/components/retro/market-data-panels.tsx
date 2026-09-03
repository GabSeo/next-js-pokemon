"use client";

import { useCallback, useId, useMemo, useRef } from "react";

import { useProductLocale, type LocaleCode } from "@/components/product-locale";
import { MarketTrendCard } from "@/components/retro/market-trend-card";
import {
  ANCHOR_PANEL,
  ContextChips,
  MarketCard,
} from "@/components/retro/market-panel-parts";
import { MarketValuationCard, MarketValuationSkeleton, SkeletonBox } from "@/components/retro/market-valuation-card";
import { MarketComparisonCard } from "@/components/retro/price-comparison";
import type { GradedMarketData } from "@/lib/graded-market";
import {
  buildMarketViews,
  LOCALE_BY_VIEW,
  VIEW_BY_LOCALE,
  type MarketView,
  type MarketViewId,
} from "@/lib/market-views";
import type { Card } from "@/lib/types";

/**
 * Real-time market data: one section, three views of the same card.
 *
 * US market · EU market · the Japanese print across both. They are three
 * READINGS OF ONE QUESTION — what is this card worth, and where — so they
 * live in one section behind one tab strip rather than as three blocks a
 * reader has to scroll between and mentally join up.
 *
 * WHY TABS RATHER THAN A TOGGLE. This section used to be a single panel that
 * swapped its contents when the page's market control moved. That worked and
 * it hid the shape of the thing: nothing on screen said there were three
 * views, so a reader who never touched the control never learned that the
 * Japanese print has its own European listing and its own US graded ladder.
 * A tab strip states the choice, names each view, and says what currency it
 * is in before anything is clicked.
 *
 * THE TABS AND THE PAGE'S MARKET CONTROL ARE ONE STATE, not two. Both write
 * the product locale context (components/product-locale.tsx), which is also
 * what selects the card art, the H1, the eBay listings panel and the Grading
 * Center further down. Two controls for one state is usually a smell; here
 * it is the opposite of a smell, because they cannot disagree — clicking the
 * "Japanese card" tab moves the whole page to the Japanese print, which is
 * exactly what a reader asking that question wants, and the pinned control
 * stays truthful about where they are while they scroll past this section.
 *
 * EVERY PANEL STAYS IN THE DOM, inactive ones behind `hidden`. This is the
 * same rule PriceDataTabs and PriceChart already follow: an agent parsing raw
 * HTML, or a human with JavaScript disabled, gets all three markets' figures
 * rather than whichever one happened to be selected. The one exception is the
 * EU trend chart, which is SVG geometry rather than text and mounts only when
 * its tab is on screen — see market-trend-card.tsx.
 *
 * NO LAYOUT JUMP BETWEEN TABS, by construction rather than by luck: every
 * block of both cards is pinned to a shared height at `lg:` and up (the
 * ANCHOR_* constants in market-panel-parts.tsx), so the headline, the
 * statistics, the note and the source link land on the same row in all three
 * views. Below `lg:` the cards stack and every block is auto-height, because
 * a narrow column cannot honour a desktop rhythm without clipping a sentence.
 */
export function MarketDataPanels({
  variants,
  priceKnown,
  gradedMarket,
}: {
  /** One entry per card language the page resolved, US first. */
  variants: { code: string; card: Card }[];
  /** Whether a canonical price resolved at all — a fact about the card, not about the tab. */
  priceKnown: boolean;
  /** Shared with MarketSections below; fetched once in page.tsx. */
  gradedMarket: GradedMarketData | null;
}) {
  const { active, setActive } = useProductLocale();
  const baseId = useId().replace(/:/g, "");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // The Western print — the card this page is about, and the only variant
  // guaranteed to exist.
  const westernCard = variants.find((v) => v.code === "US")?.card ?? variants[0]?.card;
  // The Japanese print's OWN figures, or nothing. Never the Western card as a
  // stand-in: page.tsx already refuses that substitution upstream (see its
  // `available` comment), and repeating it here would put Western euros under
  // a Japanese heading, which is the one thing this section exists not to do.
  const japaneseCard = variants.find((v) => v.code === "JP")?.card;

  const views = useMemo(
    () => (westernCard ? buildMarketViews({ westernCard, japaneseCard, gradedMarket, priceKnown }) : []),
    [westernCard, japaneseCard, gradedMarket, priceKnown]
  );

  const activeView: MarketViewId = VIEW_BY_LOCALE[active] ?? "US";

  const select = useCallback(
    (view: MarketViewId) => setActive(LOCALE_BY_VIEW[view] as LocaleCode),
    [setActive]
  );

  /**
   * Arrow keys move between tabs and select as they go, which is the
   * automatic-activation half of the WAI-ARIA tabs pattern — correct here
   * because every panel is already rendered, so moving selection costs
   * nothing and a reader arrowing across the strip sees each market in turn.
   * Home/End jump to the ends. Tab itself leaves the strip for the panel,
   * via the roving tabindex below.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      const keys: Record<string, number> = {
        ArrowRight: index + 1,
        ArrowLeft: index - 1,
        Home: 0,
        End: views.length - 1,
      };
      const next = keys[event.key];
      if (next === undefined) return;
      event.preventDefault();
      const target = views[(next + views.length) % views.length];
      if (!target) return;
      select(target.id);
      tabRefs.current[target.id]?.focus();
    },
    [select, views]
  );

  if (!westernCard || views.length === 0) return null;

  return (
    <section aria-labelledby={`${baseId}-title`}>
      {/* A real section head rather than a caption. This is the first thing on
          the page after the card itself and the most valuable thing on it, so
          it is allowed to announce itself — the live dot carries the one
          quality the rest of the page cannot claim, that these figures were
          read today. */}
      <div className="mb-4">
        <p className="flex items-center gap-2 text-[11px] font-black tracking-[0.9px] text-pokemon-blue uppercase">
          <span className="inline-block h-2 w-2 rounded-full bg-pokemon-red" />
          Live market data
        </p>
        <h2
          className="mt-1 text-[clamp(22px,3.2vw,32px)] leading-none font-black tracking-[-1px] uppercase"
          id={`${baseId}-title`}
        >
          Real-time market data
        </h2>
        <p className="mt-2 max-w-[62ch] text-[12px] font-bold text-muted-text text-pretty">
          Three markets, each in its own currency and from its own source. Nothing here is converted between EUR and
          USD.
        </p>
      </div>

      {/* The tab strip. Horizontal scroll rather than wrapping below 520px:
          three wrapped tabs read as a list of links, and the strip's job is to
          look like one control with three positions. */}
      <div
        aria-label="Market view"
        className="mb-4 flex gap-1 overflow-x-auto rounded-lg border-2 border-black bg-card-surface p-1 shadow-hard-sm"
        role="tablist"
      >
        {views.map((view, index) => {
          const selected = view.id === activeView;
          return (
            <button
              aria-controls={`${baseId}-panel-${view.id}`}
              aria-selected={selected}
              className={`flex min-w-[128px] flex-1 flex-col items-center rounded-md px-3 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pokemon-blue ${
                selected ? "bg-nav-dark text-white" : "text-muted-text hover:bg-muted-surface"
              }`}
              id={`${baseId}-tab-${view.id}`}
              key={view.id}
              onClick={() => select(view.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              ref={(node) => {
                tabRefs.current[view.id] = node;
              }}
              role="tab"
              // Roving tabindex: one stop for the whole strip, arrows move
              // within it. Without this a keyboard reader pays three tab
              // presses to get past a control they may not want.
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <span className="text-[13px] font-black tracking-[-0.2px] whitespace-nowrap">{view.tabLabel}</span>
              <span
                className={`mt-0.5 text-[9px] font-black tracking-[0.5px] whitespace-nowrap uppercase ${selected ? "text-white/70" : "text-muted-text"}`}
              >
                {view.tabHint}
              </span>
            </button>
          );
        })}
      </div>

      {views.map((view) => (
        <div
          aria-labelledby={`${baseId}-tab-${view.id}`}
          hidden={view.id !== activeView}
          id={`${baseId}-panel-${view.id}`}
          key={view.id}
          role="tabpanel"
          // Focusable so a keyboard reader arriving from the strip lands on
          // the content it just selected rather than on the first link in it.
          tabIndex={0}
        >
          <MarketPanel isActive={view.id === activeView} onNavigate={select} view={view} />
        </div>
      ))}
    </section>
  );
}

function MarketPanel({
  view,
  isActive,
  onNavigate,
}: {
  view: MarketView;
  isActive: boolean;
  onNavigate: (view: MarketViewId) => void;
}) {
  return (
    <div>
      {/* The panel's own head, inside the panel rather than above the tabs, so
          each view carries its own market, print, currency and as-of date in
          the markup — including the two that are hidden. A reader switching
          tabs sees the context change with the figures; an agent reading the
          raw HTML finds each set of numbers already labelled with the market
          and currency it belongs to. */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 lg:min-h-[54px]">
        <h3 className="text-lg font-black tracking-[-0.5px] uppercase">{view.heading}</h3>
        <ContextChips chips={view.chips} />
      </div>

      {/* Deliberately uneven in width — a bar needs length to be read as one,
          figures do not. Equal in HEIGHT though, which is what keeps the two
          cards' floors on one line whichever tab is open. */}
      <div className={`grid grid-cols-1 items-stretch gap-5 lg:grid-cols-[0.85fr_1.15fr] ${ANCHOR_PANEL}`}>
        <MarketValuationCard valuation={view.valuation} />

        {view.intelligence.kind === "bars" ? (
          <MarketComparisonCard intelligence={view.intelligence} isActive={isActive} />
        ) : (
          <MarketTrendCard intelligence={view.intelligence} isActive={isActive} onNavigate={onNavigate} />
        )}
      </div>

      <p className="mt-3 text-[11px] font-bold text-muted-text text-pretty">{view.footnote}</p>
    </div>
  );
}

/**
 * The section's resting shape, at the exact size the real one occupies.
 *
 * Every block here is built from the same ANCHOR_* constants as the live
 * cards, so a skeleton replaced by data — or data replaced by a skeleton —
 * moves nothing below it on the page. Exported for any surface that renders
 * this section behind a fetch it has to wait on; the product page itself
 * resolves its data before it renders, so it never shows this.
 */
export function MarketDataPanelsSkeleton() {
  return (
    <section aria-busy="true" aria-label="Loading market data">
      <div className="mb-4">
        <SkeletonBox className="h-3 w-32" />
        <SkeletonBox className="mt-2 h-7 w-72" />
      </div>
      <SkeletonBox className="mb-4 h-[60px] w-full rounded-lg" />
      <div className={`grid grid-cols-1 items-stretch gap-5 lg:grid-cols-[0.85fr_1.15fr] ${ANCHOR_PANEL}`}>
        <MarketValuationSkeleton />
        <MarketCard>
          <div className="flex items-center justify-between border-b-2 border-black bg-muted-surface px-5 py-3 min-h-[64px]">
            <SkeletonBox className="h-3 w-40" />
            <SkeletonBox className="h-4 w-12 rounded-full" />
          </div>
          <div className="flex flex-1 flex-col gap-3 px-5 py-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i}>
                <SkeletonBox className="h-3 w-full" />
                <SkeletonBox className="mt-1.5 h-2.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        </MarketCard>
      </div>
    </section>
  );
}
