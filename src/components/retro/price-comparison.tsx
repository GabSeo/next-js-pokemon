"use client";

import { motion, useReducedMotion, type Transition } from "motion/react";

import { DEFAULT_CHART_ENTER_TRANSITION } from "@/components/charts/animation";
import { MarketDataBadge } from "@/components/retro/market-data-badge";
import { MarketImage } from "@/components/retro/market-image";
import {
  ANCHOR_VIZ,
  CurrencyBadge,
  MarketCard,
  MarketCardHead,
  REGION_HEAD_TINT,
  RegionLockup,
  WhatThisMeans,
} from "@/components/retro/market-panel-parts";
import { MARKET_LOGOS } from "@/lib/market-assets";
import { formatMarketMoney, type BarsIntelligence, type ComparisonRow, type MarketNote } from "@/lib/market-views";

/**
 * Every real US price we hold for one print, as one scannable comparison.
 *
 * Sits beside the valuation card on the US and Japanese tabs, driven by the
 * same tab — no control of its own. The card on the left answers "what is it
 * worth here" in detail; these bars answer "compared to what" in a glance.
 *
 * ONE CURRENCY PER CARD, and that is what makes the bars honest. Bar length
 * is the whole point of this layout, and lengths only compare in the same
 * unit. Every row drawn here is USD — TCGplayer, eBay and PSA are all US
 * marketplaces. Cardmarket's euros are never drawn as a bar anywhere, on any
 * tab, because a euro measured against a dollar scale is a false length and
 * converting it would invent a number no marketplace published. The Japanese
 * tab's European figure is quoted as text in the strip below instead.
 *
 * A ROW WITH NO DATA STILL PRINTS, with a hatched empty track and the reason
 * on the value side. "PSA 8 · No asks" is a real answer about a thin tier,
 * and dropping the row would turn an absence into an omission. It also keeps
 * every figure on screen as TEXT rather than SVG geometry, which is what lets
 * an agent parsing raw HTML read this card — the reason these bars are two
 * divs and a percentage rather than a chart.
 */

/**
 * The bars grow rather than appear, because growing IS the comparison — a
 * length arriving from zero is read as a magnitude, where five lengths
 * appearing at once are read as a picture. The stagger says the same thing
 * about order: TCGplayer, then raw, then each grade above it.
 *
 * The house chart curve (components/charts/animation.ts) at roughly half its
 * duration. Same easing so this card and the trend chart on the EU tab move
 * the same way; shorter because that curve was tuned for one long reveal and
 * these are five short ones behind a stagger.
 */
const FILL_TRANSITION: Transition = { ...DEFAULT_CHART_ENTER_TRANSITION, duration: 0.62 };

/** Each bar starts a beat after the one above it, so the eye reads them in order rather than as one block. */
const STAGGER_SECONDS = 0.055;

export function MarketComparisonCard({
  intelligence,
  isActive,
  note,
}: {
  intelligence: BarsIntelligence;
  /** Closes this card — see WhatThisMeans for why the explanation lives under the evidence. */
  note: MarketNote;
  /**
   * Whether this card's tab is the one on screen.
   *
   * Every tab panel stays mounted (see market-data-panels.tsx on why the
   * figures have to be in the raw HTML), so "when the view appears" cannot
   * mean "on mount" — it has to mean this. The bars hold at zero length
   * while their tab is hidden and grow when it is selected, so the reveal
   * happens where someone can see it, and happens again on a later visit.
   */
  isActive: boolean;
}) {
  // Motion reads the OS setting rather than a media query we would have to
  // maintain. Hook, so it sits above every branch below.
  const reduceMotion = useReducedMotion();

  const rows = intelligence.rows;
  // Scale is the dearest row in THIS card, so every bar is measured against
  // something in its own currency and nothing is compared across tabs.
  const scale = Math.max(...rows.map((r) => r.amount ?? 0), 0);

  return (
    <MarketCard tone={intelligence.region?.tone}>
      <MarketCardHead tint={intelligence.region ? REGION_HEAD_TINT[intelligence.region.tone] : undefined}>
        {/* See MarketValuationCard: the Japanese view names its market first,
            because that panel carries two of them. */}
        {intelligence.region ? (
          <RegionLockup logo="tcgplayer" region={intelligence.region} />
        ) : (
          <span className="flex min-w-0 flex-col">
            <b className="truncate text-xs font-black tracking-[0.3px] uppercase">{intelligence.title}</b>
            <small className="truncate text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">
              {intelligence.subtitle}
            </small>
          </span>
        )}
        <span className="flex shrink-0 items-center gap-2">
          {/* Whether these rows were actually fetched, said on the box that
              shows them — the same badge and the same rule as the listings
              panel below. eBay unreachable means illustrative tiers, and a
              "Live" claim over them would contradict every other real/preview
              signal on this page. */}
          <MarketDataBadge isReal={intelligence.isReal} />
          <CurrencyBadge currency={intelligence.currency} />
        </span>
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
            {rows.length} references
          </span>
        </div>

        {/* `key` on the signature of the figures, not on the tab: a tab
            re-selection is handled by `isActive` above, while genuinely new
            numbers (a different card, a refreshed fetch) remount the list so
            the bars refill from zero instead of silently sliding to different
            lengths. Lengths are the content here, and content that changes
            without moving is content a reader can miss. */}
        <dl
          className="mt-3 flex flex-1 flex-col justify-between gap-2"
          key={rows.map((r) => `${r.label}:${r.amount ?? "x"}`).join("|")}
        >
          {rows.map((row, index) => (
            <BarRow
              currency={intelligence.currency}
              index={index}
              isActive={isActive}
              key={row.label}
              reduceMotion={Boolean(reduceMotion)}
              row={row}
              scale={scale}
              // Only the Japanese tab's bars keep the TCGplayer row mark — see
              // BarRow's own comment on why `region` is what decides it.
              showSourceLogo={Boolean(intelligence.region)}
            />
          ))}
        </dl>
      </div>

      <WhatThisMeans note={note} />
    </MarketCard>
  );
}

function BarRow({
  row,
  scale,
  index,
  isActive,
  reduceMotion,
  currency,
  showSourceLogo,
}: {
  row: ComparisonRow;
  scale: number;
  index: number;
  isActive: boolean;
  reduceMotion: boolean;
  currency: BarsIntelligence["currency"];
  /**
   * Whether the TCGplayer row may show its own logo. eBay's row logo is
   * untouched by this and always shows — the US/EU-only rule is specifically
   * about the TCGplayer and Cardmarket marks, and eBay is neither.
   *
   * True only on the Japanese tab (`Boolean(intelligence.region)`), where
   * this card sits under a plain "United States market" heading with no
   * source mark of its own — the row is the only place a reader sees which
   * US marketplace the top bar came from. On the US tab that same mark
   * already leads the valuation card one column to the left, so repeating it
   * here would be the source announcing itself twice on one screen.
   */
  showSourceLogo: boolean;
}) {
  const width = row.amount != null && scale > 0 ? Math.max(4, (row.amount / scale) * 100) : 0;
  const showLogo = row.logo && (row.logo !== "tcgplayer" || showSourceLogo);

  return (
    <div>
      {/* One line: what it is on the left, what it costs on the right, and
          the depth behind it as a chip between them. */}
      <div className="flex items-baseline justify-between gap-2">
        <dt className="flex items-baseline gap-1.5 overflow-hidden">
          {showLogo && (
            <MarketImage
              asset={{ ...MARKET_LOGOS[row.logo!], alt: "", width: 24, height: 17 }}
              className="translate-y-0.5 rounded-[3px] border border-border-subtle bg-white"
            />
          )}
          <span className="truncate text-sm font-black tracking-[-0.2px]">{row.label}</span>
          {row.sample && (
            <span
              className="shrink-0 rounded-sm bg-muted-surface px-1 py-px text-[9px] font-black tracking-[0.2px] text-muted-text uppercase"
              title={row.sampleTitle}
            >
              {row.sample}
            </span>
          )}
        </dt>
        <dd
          className={`shrink-0 font-black whitespace-nowrap tabular-nums ${row.amount == null ? "text-[12px] text-muted-text" : "text-[15px]"}`}
        >
          {row.amount == null ? row.absent : formatMarketMoney(row.amount, currency)}
        </dd>
      </div>

      {/* A track behind every bar, so proportion is read against a fixed
          baseline rather than against whichever neighbour happens to sit next
          to it. An absent row keeps the track and hatches it: the rhythm
          survives, and "nothing here" stays visibly different from "a very
          small number". */}
      <div className="mt-1 h-2.5 overflow-hidden rounded-full border-2 border-black bg-muted-surface">
        {row.amount != null && scale > 0 ? (
          <motion.div
            // ONLY the fill animates. The labels, the figures and the sample
            // chips are never hidden, not even for a frame: they are the
            // content, they are what an agent reads out of the raw HTML, and
            // animating them would mean server-rendering them at opacity 0.
            animate={{ scaleX: isActive ? 1 : 0 }}
            // Reduced motion is honoured in CSS, not by branching `initial` on
            // the hook. `useReducedMotion` reads false during server rendering
            // and true in a reduced-motion browser, so a branch here rendered
            // two different `transform` styles for the same bar and React
            // reported a hydration mismatch it explicitly does not patch up —
            // measured, not theorised. `motion-reduce:scale-x-100!` is a media
            // query instead: it wins over Motion's inline transform, applies on
            // the very first paint, and needs no JavaScript to do it.
            className="h-full origin-left rounded-full motion-reduce:scale-x-100!"
            initial={{ scaleX: 0 }}
            style={{ backgroundColor: row.color, width: `${width}%` }}
            transition={reduceMotion ? { duration: 0 } : { ...FILL_TRANSITION, delay: index * STAGGER_SECONDS }}
          />
        ) : (
          <div
            className="h-full w-full"
            // Visibly hatched, not merely empty: "nothing is listed here" has
            // to look different from "a bar too short to see".
            style={{ backgroundImage: "repeating-linear-gradient(135deg, #c9c6bd 0 4px, #eceae4 4px 9px)" }}
          />
        )}
      </div>
    </div>
  );
}
