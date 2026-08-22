import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { conditionSearchLink } from "@/lib/ebay-search";
import { type EbayActiveListing, type EbayCondition, searchActiveListings } from "@/lib/ebay-browse";
import { illustrativeActivePrices, illustrativeSoldListings } from "@/lib/illustrative";
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

/**
 * One row per condition tier, active (real once EBAY_CLIENT_ID/SECRET are
 * set, illustrative preview until then) and sold (illustrative — see
 * lib/illustrative.ts, no API exposes sold eBay data to this developer-
 * program tier) regrouped on the same line so they're directly comparable.
 * The ROI estimate below the table is computed from active-listing medians
 * only, and never mixes real with preview — if either PSA 10 or Raw isn't
 * real yet, both fall back to preview together so the ROI figure is either
 * fully real or fully (and clearly) illustrative, never a silent blend.
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
    <div className="rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-black tracking-[0.6px] text-pokemon-blue uppercase">🏅 Graded Market</span>
        <span className="h-px flex-1 bg-border-subtle" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-black text-left text-xs font-black tracking-[0.3px] text-muted-text uppercase">
              <th className="py-2 pr-3">Condition</th>
              <th className="py-2 pr-3">Active — last 3</th>
              <th className="py-2">
                <span className="mr-2 align-middle">Sold — last 3</span>
                <IllustrativeTag />
              </th>
            </tr>
          </thead>
          <tbody>
            {CONDITIONS.map((condition) => {
              const active = activeByCondition.get(condition)!;
              const sold = soldByGrade.get(condition);
              return (
                <tr key={condition} className="border-b border-border-subtle last:border-0">
                  <td className="py-3 pr-3 align-top font-black">{condition}</td>
                  <td className="py-3 pr-3 align-top">
                    <div className="flex flex-col gap-1.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <data value={String(active.median)} className="font-black tabular-nums">
                          {card.currency} {active.median.toLocaleString()}
                        </data>
                        {active.kind === "preview" && <IllustrativeTag label="Preview — eBay not connected yet" />}
                      </span>
                      {active.kind === "real" ? (
                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                          {active.listings.map((listing) => (
                            <a
                              key={listing.url}
                              href={listing.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-bold text-pokemon-blue underline underline-offset-2 hover:text-foreground"
                            >
                              {listing.currency} {listing.price.toLocaleString()}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          {active.prices.map((price, i) => (
                            <span key={i} className="text-xs font-bold text-muted-text">
                              {card.currency} {price.toLocaleString()}
                            </span>
                          ))}
                          <a
                            href={conditionSearchLink(card, condition)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-bold text-pokemon-blue underline underline-offset-2 hover:text-foreground"
                          >
                            Shop real listings ↗
                          </a>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="py-3 align-top text-muted-text">
                    {sold && (
                      <data value={String(sold.price)} className="font-bold tabular-nums">
                        {card.currency} {sold.price.toLocaleString()}
                      </data>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
