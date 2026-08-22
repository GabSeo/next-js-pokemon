import { GradedMarketTabs, type ConditionEntry, type TypeSummary } from "@/components/retro/graded-market-tabs";
import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { conditionSearchLink } from "@/lib/ebay-search";
import { searchActiveListings, type EbayCondition } from "@/lib/ebay-browse";
import { illustrativeActiveListings, illustrativeSoldListings, type IllustrativeListingRow } from "@/lib/illustrative";
import { DEFAULT_PSA_GRADING_COST_USD, gradingRoi, median } from "@/lib/roi";
import type { Card } from "@/lib/types";

const CONDITIONS: EbayCondition[] = ["PSA 10", "PSA 9", "PSA 8", "Raw"];

/** One row, real or illustrative — real rows get a working per-item link, illustrative rows never do (see lib/illustrative.ts). */
function ListingRow({
  date,
  description,
  price,
  currency,
  href,
}: {
  date: string;
  description: string;
  price: number;
  currency: string;
  href?: string;
}) {
  return (
    <div className="grid grid-cols-[76px_1fr_auto_20px] items-center gap-3 border-t border-dashed border-border-subtle py-2.5 text-sm first:border-t-0">
      <span className="text-xs font-bold text-muted-text">{date}</span>
      <span className="truncate font-bold">{description}</span>
      <span className="font-black tabular-nums">
        {currency} {price.toLocaleString()}
      </span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-muted-text hover:text-pokemon-blue">
          ↗
        </a>
      ) : (
        <span />
      )}
    </div>
  );
}

function rowsFrom(rows: IllustrativeListingRow[], currency: string) {
  return (
    <div>
      {rows.map((row, i) => (
        <ListingRow key={i} date={row.date} description={row.description} price={row.price} currency={currency} />
      ))}
    </div>
  );
}

/**
 * Real active-listing fetch for one condition tier — failure here (missing
 * EBAY_CLIENT_ID/SECRET, no Buy API license yet, rate limit, no results)
 * must never take down the whole product/price-checker page, so it's caught
 * locally and degrades to an illustrative preview, same resilience shape
 * lib/cards.ts uses for apitcg. The preview lets the panel's full layout be
 * reviewed in the browser before real eBay credentials exist.
 */
async function buildActiveSummary(card: Card, condition: EbayCondition): Promise<TypeSummary & { medianPrice: number | null }> {
  try {
    const { listings, total } = await searchActiveListings(card, condition);
    const med = listings.length > 0 ? median(listings.map((l) => l.price)) : null;
    if (med !== null) {
      return {
        avgLabel: `${card.currency} ${med.toLocaleString()}`,
        count: total,
        isReal: true,
        seeAllHref: conditionSearchLink(card, condition),
        rows: (
          <div>
            {listings.map((listing) => (
              <ListingRow
                key={listing.url}
                date={listing.listedDate ? new Date(listing.listedDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Active"}
                description={listing.title}
                price={listing.price}
                currency={listing.currency}
                href={listing.url}
              />
            ))}
          </div>
        ),
        medianPrice: med,
      };
    }
  } catch (err) {
    console.error(`[ebay] failed to fetch active ${condition} listings for ${card.id}:`, err);
  }

  const { rows, total } = illustrativeActiveListings(card, condition);
  const med = median(rows.map((r) => r.price))!;
  return {
    avgLabel: `${card.currency} ${med.toLocaleString()}`,
    count: total,
    isReal: false,
    seeAllHref: conditionSearchLink(card, condition),
    rows: rowsFrom(rows, card.currency),
    medianPrice: med,
  };
}

/** Always illustrative — see lib/illustrative.ts's comment on why sold data can't be real here. */
function buildSoldSummary(card: Card, condition: EbayCondition): TypeSummary {
  const { rows, total } = illustrativeSoldListings(card, condition);
  const med = median(rows.map((r) => r.price))!;
  return {
    avgLabel: `${card.currency} ${med.toLocaleString()}`,
    count: total,
    isReal: false,
    seeAllHref: conditionSearchLink(card, condition),
    rows: rowsFrom(rows, card.currency),
  };
}

/**
 * One shared window: condition tabs (PSA 10/9/8/Raw) plus an active/sold
 * type toggle underneath — only one row-list is visible at a time, but all
 * 4 conditions × 2 types (8 row-sets) are server-rendered in the DOM
 * regardless, same pattern as components/price-data-tabs.tsx, so an AI
 * crawler reading raw HTML sees every combination no matter which tab/type
 * a human has selected. The ROI card at the bottom always compares
 * active-listing medians only, and never mixes real with illustrative — if
 * either PSA 10 or Raw isn't real yet, both fall back to illustrative
 * together so the figure is always fully real or fully (and visibly) fake.
 */
export async function GradedMarketPanel({ card }: { card: Card }) {
  const activeSummaries = await Promise.all(CONDITIONS.map((c) => buildActiveSummary(card, c)));
  const activeByCondition = new Map(CONDITIONS.map((c, i) => [c, activeSummaries[i]]));

  const entries: ConditionEntry[] = CONDITIONS.map((condition) => ({
    id: condition,
    label: condition,
    active: activeByCondition.get(condition)!,
    sold: buildSoldSummary(card, condition),
  }));

  const psa10 = activeByCondition.get("PSA 10")!;
  const raw = activeByCondition.get("Raw")!;
  // Never mix a real median with an illustrative one in the same ROI figure
  // — if either PSA 10 or Raw failed to resolve real data, both fall back
  // to illustrative together (even if the other one *did* succeed), so the
  // result is always fully real or fully (and visibly) illustrative.
  const roiIsReal = psa10.isReal && raw.isReal;
  const psa10Median = roiIsReal ? psa10.medianPrice! : median(illustrativeActiveListings(card, "PSA 10").rows.map((r) => r.price))!;
  const rawMedian = roiIsReal ? raw.medianPrice! : median(illustrativeActiveListings(card, "Raw").rows.map((r) => r.price))!;
  const roi = gradingRoi(psa10Median, rawMedian);

  return (
    <div className="rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-black tracking-[0.6px] text-pokemon-blue uppercase">🏅 Graded Market</span>
        <span className="h-px flex-1 bg-border-subtle" />
      </div>

      <GradedMarketTabs entries={entries} />

      <div className="mt-5 rounded-md border-2 border-black bg-muted-surface p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-black tracking-[0.3px] text-muted-text uppercase">
          Grading ROI — raw → PSA 10
          {!roiIsReal && <IllustrativeTag label="Preview — eBay not connected yet" />}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className={`text-2xl font-black tabular-nums ${roi >= 0 ? "text-success-green" : "text-pokemon-red"}`}>
            {roi >= 0 ? "+" : ""}
            {(roi * 100).toFixed(0)}%
          </span>
          <span className="text-xs font-bold text-muted-text">
            {card.currency} {rawMedian.toLocaleString()} raw + {card.currency} {DEFAULT_PSA_GRADING_COST_USD} grading vs{" "}
            {card.currency} {psa10Median.toLocaleString()} PSA 10, {roiIsReal ? "today's active listings" : "preview numbers"}.
          </span>
        </div>
      </div>
    </div>
  );
}
