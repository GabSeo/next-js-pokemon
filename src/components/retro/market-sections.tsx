import { GradedMarketPanel } from "@/components/retro/graded-market-panel";
import { GradingCenterSection } from "@/components/retro/grading-center-section";
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

      <GradingCenterSection card={card} data={data} />
    </div>
  );
}
