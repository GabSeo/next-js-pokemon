import { GradedMarketTabs } from "@/components/retro/graded-market-tabs";
import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { conditionSearchLink } from "@/lib/ebay-search";
import { type EbayActiveListing, type EbayCondition, searchActiveListings } from "@/lib/ebay-browse";
import { illustrativeActivePrices, illustrativeSoldListings, type IllustrativeSoldListing } from "@/lib/illustrative";
import { DEFAULT_PSA_GRADING_COST_USD, gradingRoi, median } from "@/lib/roi";
import type { Card } from "@/lib/types";

const CONDITIONS: EbayCondition[] = ["PSA 10", "PSA 9", "PSA 8", "Raw"];

type RealActiveTier = { kind: "real"; listings: EbayActiveListing[]; median: number };
type PreviewActiveTier = { kind: "preview"; prices: number[]; median: number };
type ActiveTier = RealActiveTier | PreviewActiveTier;

/**
 * Failure here (missing EBAY_CLIENT_ID/SECRET, no Buy API license yet, rate
 * limit, no results) must never take down the whole product/price-checker
 * page — it's caught locally and degrades that one tier to an illustrative
 * preview, the same resilience shape lib/cards.ts uses for apitcg. The
 * preview lets the panel's full layout be reviewed in the browser before
 * real eBay credentials exist, same reasoning as everything in
 * lib/illustrative.ts — it's replaced by real data automatically the moment
 * a fetch for that tier succeeds.
 */
async function fetchActiveTier(card: Card, condition: EbayCondition): Promise<ActiveTier> {
  try {
    const listings = await searchActiveListings(card, condition);
    const med = listings.length > 0 ? median(listings.map((l) => l.price)) : null;
    if (med !== null) return { kind: "real", listings, median: med };
  } catch (err) {
    console.error(`[ebay] failed to fetch active ${condition} listings for ${card.id}:`, err);
  }
  const prices = illustrativeActivePrices(card, condition);
  return { kind: "preview", prices, median: median(prices)! };
}

/** One condition tier's content — Active then Sold, stacked. Lives inside a GradedMarketTabs panel, so it carries no border/shadow of its own. */
function ConditionTabContent({
  card,
  condition,
  active,
  sold,
}: {
  card: Card;
  condition: EbayCondition;
  active: ActiveTier;
  sold: IllustrativeSoldListing | undefined;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-black tracking-[0.3px] text-muted-text uppercase">
          Active — last 3
          {active.kind === "preview" && <IllustrativeTag label="Preview — eBay not connected yet" />}
        </div>
        <data value={String(active.median)} className="block text-3xl font-black tracking-[-0.5px] tabular-nums">
          {card.currency} {active.median.toLocaleString()}
        </data>
        <div className="mt-3 flex flex-col gap-2">
          {active.kind === "real"
            ? active.listings.map((listing) => (
                <div key={listing.url} className="flex items-center justify-between gap-3 border-b border-border-subtle pb-2 last:border-0">
                  <span className="text-sm font-bold tabular-nums">
                    {listing.currency} {listing.price.toLocaleString()}
                  </span>
                  <a
                    href={listing.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs font-bold text-pokemon-blue underline underline-offset-2 hover:text-foreground"
                  >
                    Shop ↗
                  </a>
                </div>
              ))
            : active.prices.map((price, i) => (
                <div key={i} className="flex items-center justify-between gap-3 border-b border-border-subtle pb-2 last:border-0">
                  <span className="text-sm font-bold tabular-nums text-muted-text">
                    {card.currency} {price.toLocaleString()}
                  </span>
                </div>
              ))}
        </div>

        <a
          href={conditionSearchLink(card, condition)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block text-xs font-black text-pokemon-red underline underline-offset-2 hover:text-foreground"
        >
          See all {condition} listings ↗
        </a>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black tracking-[0.3px] text-muted-text uppercase">
          Sold — last 3
          <IllustrativeTag />
        </div>
        {sold && (
          <data value={String(sold.price)} className="block text-3xl font-black tracking-[-0.5px] text-muted-text tabular-nums">
            {card.currency} {sold.price.toLocaleString()}
          </data>
        )}
      </div>
    </div>
  );
}

/**
 * One shared window: a condition tab-switcher (PSA 10/9/8/Raw) — active
 * (real once EBAY_CLIENT_ID/SECRET work, preview until then) and illustrative
 * sold, stacked for whichever tier is selected — plus a persistent ROI card
 * below computed from active-listing medians only, never mixing real and
 * preview: if either PSA 10 or Raw isn't real yet, both fall back to preview
 * together so the figure is always fully real or fully (and visibly)
 * illustrative.
 */
export async function GradedMarketPanel({ card }: { card: Card }) {
  const activeResults = await Promise.all(CONDITIONS.map((c) => fetchActiveTier(card, c)));
  const activeByCondition = new Map(CONDITIONS.map((c, i) => [c, activeResults[i]]));

  const soldRows = illustrativeSoldListings(card);
  const soldByGrade = new Map(soldRows.map((s) => [s.grade, s]));

  const psa10Active = activeByCondition.get("PSA 10")!;
  const rawActive = activeByCondition.get("Raw")!;
  const roiIsReal = psa10Active.kind === "real" && rawActive.kind === "real";
  const roi = gradingRoi(psa10Active.median, rawActive.median);

  const tabs = CONDITIONS.map((condition) => ({
    id: condition,
    label: condition,
    content: (
      <ConditionTabContent
        card={card}
        condition={condition}
        active={activeByCondition.get(condition)!}
        sold={soldByGrade.get(condition)}
      />
    ),
  }));

  return (
    <div className="rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-black tracking-[0.6px] text-pokemon-blue uppercase">🏅 Graded Market</span>
        <span className="h-px flex-1 bg-border-subtle" />
      </div>

      <GradedMarketTabs tabs={tabs} />

      <div className="mt-5 rounded-md border-2 border-black bg-muted-surface p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-black tracking-[0.3px] text-muted-text uppercase">
          Grading ROI — raw → PSA 10
          <IllustrativeTag label={roiIsReal ? "Estimate, active listings only" : "Preview — eBay not connected yet"} />
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className={`text-2xl font-black tabular-nums ${roi >= 0 ? "text-success-green" : "text-pokemon-red"}`}>
            {roi >= 0 ? "+" : ""}
            {(roi * 100).toFixed(0)}%
          </span>
          <span className="text-xs font-bold text-muted-text">
            {card.currency} {rawActive.median.toLocaleString()} raw + {card.currency} {DEFAULT_PSA_GRADING_COST_USD} grading vs{" "}
            {card.currency} {psa10Active.median.toLocaleString()} PSA 10, {roiIsReal ? "today's active listings" : "preview numbers"}.
          </span>
        </div>
      </div>
    </div>
  );
}
