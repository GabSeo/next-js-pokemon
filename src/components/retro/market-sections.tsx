import { ProductLocaleToggle } from "@/components/product-locale";
import { GradedMarketPanel } from "@/components/retro/graded-market-panel";
import { GradingCenterTools } from "@/components/retro/grading-center-tools";
import { franchiseLabel } from "@/lib/cards";
import { getGradedMarketData } from "@/lib/graded-market";
import type { Card } from "@/lib/types";

/**
 * Both market sections, from one fetch.
 *
 * The single fetch is the whole reason this component exists rather than each
 * panel calling getGradedMarketData itself. That function is buildCached, but
 * buildCached returns `compute()` untouched whenever the build phase is not
 * active (see lib/build-cache.ts) — so during `next build` a second call is
 * free, and everywhere else (dev, a cold ISR regeneration, any on-demand
 * render) it is a second full set of eight eBay searches plus another Vinted
 * read. lib/memo-fetch.ts would not have covered it either: it memoizes
 * apitcg and tcgdex only, not ebay-browse. Fetching here and passing the
 * result down keeps the cost identical to what it was when there was one
 * panel.
 */
export async function MarketSections({ card }: { card: Card }) {
  const data = await getGradedMarketData(card);
  if (!data) return null;

  return (
    <div className="space-y-6">
      <GradedMarketPanel card={card} data={data} />

      {/* Its own card, styled as a sibling of Market Overview rather than a
          block inside it, because it answers a different question. Market
          Overview is what is for sale, at what price, in which market. This
          is whether grading the card is worth doing — four tools that were
          previously buried under four rows of eBay listings they had nothing
          to do with.

          The heading carries a second ProductLocaleToggle. It is not second
          state: both toggles read the one ProductLocaleProvider, so either
          moves both panels. Repeating the control means the market a reader
          is looking at is adjustable from whichever section they are actually
          reading, instead of forcing a scroll back up to a control attached
          to the other one. */}
      <div className="rounded-lg border-2 border-black bg-card-surface p-7 shadow-hard-md">
        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-black tracking-[0.6px] text-pokemon-blue uppercase">
            🎓 {franchiseLabel(card.franchise)} Grading Center
          </span>
          <span className="h-px min-w-4 flex-1 bg-border-subtle" />
          <ProductLocaleToggle />
        </div>

        <GradingCenterTools conditions={data.conditions} roi={data.roi} />
      </div>
    </div>
  );
}
