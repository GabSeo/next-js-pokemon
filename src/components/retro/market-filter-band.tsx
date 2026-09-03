"use client";

import { flagSvgUrl, useProductLocaleOptional } from "@/components/product-locale";
import { MARKET_TAB_META, MARKET_VIEW_ORDER, VIEW_BY_LOCALE } from "@/lib/market-views";

/**
 * The market filter — US / JA / EU — and the page's ONE control for it.
 *
 * There used to be two: this rich strip, which lived inside Real-time market
 * data, and a small flag pill in the breadcrumb line that existed only
 * because the rich one could not be reached from the rest of the page. Two
 * controls for one state is not a bug when they agree (they always did, both
 * write the locale context), but it is a question a reader should never have
 * to answer — "are these the same thing?" — so the small one is gone and this
 * one moved up into the page's own pinned header instead.
 *
 * WHY IT SITS IN THE HEADER BAND. A control that must be reachable at every
 * scroll position has to live at an EDGE. Pinned in the middle of the
 * scrolling column it becomes an opaque block with content sliding through
 * the gap above it — which is exactly what this strip did when it was made
 * page-wide sticky in its old home, and why it went back to being
 * section-scoped. Inside the header band there is no gap to slide through:
 * the site header, the card identity and this filter are one contiguous
 * frozen block, and content passes under a single visible edge.
 *
 * IT NEVER MOVES. The band is already at its final position on first paint —
 * see product-page-content.tsx, which drops the page's top padding at `lg:`
 * so the block starts flush under the header rather than sliding up into
 * place on the first scroll. A filter that changes seats when you scroll is a
 * filter a reader has to re-find.
 *
 * BELOW `lg:` it is `fixed` under the header rather than part of the band:
 * the card identity strip is too tall to freeze on a phone (it would take a
 * third of the screen), so only the filter itself stays. `position:fixed`
 * ignores DOM nesting, so it can be written here, inside the band, and still
 * pin itself to the viewport on a narrow screen.
 *
 * The labels come from lib/market-views.ts rather than from this file. Page
 * chrome cannot afford buildMarketViews — it needs both cards, the graded
 * market and a price lookup — and MARKET_TAB_META is the part of a view that
 * is the same for every card. One source, so the filter and the panel it
 * selects can never word the same market differently.
 */
export function MarketFilterBand() {
  const ctx = useProductLocaleOptional();
  if (!ctx || ctx.options.length === 0) return null;
  const { active, setActive, options } = ctx;

  // Ordered by the SECTION's order, not the provider's. `options` arrives as
  // US -> JP -> FR, which is the order the locale provider stores variants
  // in for its own reasons; the reader should see the order the panels are
  // built in. This component is the only consumer of `options`, so sorting
  // here reorders the control and nothing else.
  const ordered = [...options].sort(
    (a, b) => MARKET_VIEW_ORDER.indexOf(VIEW_BY_LOCALE[a.code]) - MARKET_VIEW_ORDER.indexOf(VIEW_BY_LOCALE[b.code])
  );

  return (
    // Mobile: a fixed chrome band under the 66px site header. pb-0.5 = 2px =
    // exactly the strip's own shadow-hard-sm, so the band's opaque bottom
    // edge lands ON the shadow — content vanishes at a line a reader can see
    // rather than into blank page colour, and the shadow is not clipped.
    // Desktop: back in the flow, inside the pinned band, under the identity
    // strip's own 4px shadow (lg:pt-5).
    <div className="fixed inset-x-0 top-[66px] z-30 bg-muted-surface px-4 pt-2 pb-0.5 lg:static lg:inset-x-auto lg:top-auto lg:z-auto lg:bg-transparent lg:px-0 lg:pt-5 lg:pb-0">
      {/* A group of toggle buttons, not a tablist. It reads as tabs, but it
          no longer sits above the panels it controls — it is page chrome now,
          and it moves the card art, the H1, the eBay listings and the Grading
          Center along with the market panels. `aria-pressed` describes that
          honestly; `role="tab"` would promise a tabpanel relationship this
          markup can no longer express across the page. */}
      <div
        aria-label="Market"
        className="flex gap-1 overflow-x-auto rounded-lg border-2 border-black bg-card-surface p-1 shadow-hard-sm"
        role="group"
      >
        {ordered.map((option) => {
          const meta = MARKET_TAB_META[VIEW_BY_LOCALE[option.code]];
          const isActive = option.code === active;
          return (
            <button
              aria-pressed={isActive}
              className={`flex min-w-0 flex-1 flex-col items-center rounded-md px-2 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pokemon-blue lg:px-3 ${
                isActive ? "bg-nav-dark text-white" : "text-muted-text hover:bg-muted-surface"
              }`}
              key={option.code}
              onClick={() => setActive(option.code)}
              type="button"
            >
              <span className="flex items-center gap-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- external CDN image, domain not allowlisted for next/image */}
                <img alt="" className="h-3 w-4 shrink-0 rounded-[1px] object-cover" src={flagSvgUrl(option.code)} />
                <span className="truncate text-[13px] font-black tracking-[-0.2px]">{meta.label}</span>
              </span>
              <span
                className={`mt-0.5 truncate text-[9px] font-black tracking-[0.5px] uppercase ${isActive ? "text-white/70" : "text-muted-text"}`}
              >
                {meta.hint}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
