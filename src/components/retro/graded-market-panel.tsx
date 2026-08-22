import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { conditionSearchLink } from "@/lib/ebay-search";
import { type EbayActiveListing, type EbayCondition, searchActiveListings } from "@/lib/ebay-browse";
import { illustrativeActivePrices, illustrativeSoldListings, type IllustrativeSoldListing } from "@/lib/illustrative";
import { DEFAULT_PSA_GRADING_COST_USD, gradingRoi, median } from "@/lib/roi";
import type { Card } from "@/lib/types";

const CONDITIONS: EbayCondition[] = ["PSA 10", "PSA 9", "PSA 8", "Raw"];

const GRADE_CLASSES: Record<EbayCondition, string> = {
  "PSA 10": "bg-success-green",
  "PSA 9": "bg-pokemon-blue",
  "PSA 8": "bg-pokemon-red",
  Raw: "bg-foreground",
};

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

/** One condition tier, in its own fully-bordered box — not a table row — so each tier reads on its own instead of competing for attention in one dense grid. */
function ConditionCard({
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
    <div className="rounded-lg border-2 border-black bg-card-surface p-5 shadow-hard-md">
      <span
        className={`inline-block rounded-full border-2 border-black px-3 py-1 text-xs font-black tracking-[0.35px] text-white uppercase ${GRADE_CLASSES[condition]}`}
      >
        {condition}
      </span>

      <div className="mt-4">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-black tracking-[0.3px] text-muted-text uppercase">
          Active — last 3
          {active.kind === "preview" && <IllustrativeTag label="Preview — eBay not connected yet" />}
        </div>
        <data value={String(active.median)} className="block text-2xl font-black tracking-[-0.5px] tabular-nums">
          {card.currency} {active.median.toLocaleString()}
        </data>
        <div className="mt-2 flex flex-col gap-1">
          {active.kind === "real" ? (
            active.listings.map((listing) => (
              <a
                key={listing.url}
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-pokemon-blue underline underline-offset-2 hover:text-foreground"
              >
                {listing.currency} {listing.price.toLocaleString()}
              </a>
            ))
          ) : (
            <>
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                {active.prices.map((price, i) => (
                  <span key={i} className="text-xs font-bold text-muted-text">
                    {card.currency} {price.toLocaleString()}
                  </span>
                ))}
              </div>
              <a
                href={conditionSearchLink(card, condition)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-pokemon-blue underline underline-offset-2 hover:text-foreground"
              >
                Shop real listings ↗
              </a>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 border-t-2 border-border-subtle pt-3">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-black tracking-[0.3px] text-muted-text uppercase">
          Sold — last 3
          <IllustrativeTag />
        </div>
        {sold && (
          <data value={String(sold.price)} className="font-bold text-muted-text tabular-nums">
            {card.currency} {sold.price.toLocaleString()}
          </data>
        )}
      </div>
    </div>
  );
}

/**
 * Four condition tiers, each its own boxed card (active real-once-connected/
 * preview-until-then, plus illustrative sold), and a separate ROI card below
 * computed from active-listing medians only — never mixing real and preview:
 * if either PSA 10 or Raw isn't real yet, both fall back to preview together
 * so the figure is always fully real or fully (and visibly) illustrative.
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

  return (
    <div className="space-y-6">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-xs font-black tracking-[0.6px] text-pokemon-blue uppercase">🏅 Graded Market</span>
        <span className="h-px flex-1 bg-border-subtle" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CONDITIONS.map((condition) => (
          <ConditionCard
            key={condition}
            card={card}
            condition={condition}
            active={activeByCondition.get(condition)!}
            sold={soldByGrade.get(condition)}
          />
        ))}
      </div>

      <div className="rounded-lg border-2 border-black bg-muted-surface p-5 shadow-hard-md">
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
