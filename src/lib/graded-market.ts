import { conditionSearchLink } from "@/lib/ebay-search";
import { searchActiveListings, type EbayCondition } from "@/lib/ebay-browse";
import { illustrativeActiveListings, illustrativeSoldListings } from "@/lib/illustrative";
import { DEFAULT_PSA_GRADING_COST_USD, gradingRoi, median } from "@/lib/roi";
import type { Card } from "@/lib/types";

export const GRADED_MARKET_CONDITIONS: EbayCondition[] = ["PSA 10", "PSA 9", "PSA 8", "Raw"];

export type GradedMarketListingRow = {
  date: string;
  description: string;
  price: number;
  currency: string;
  /** Real per-item link — only present for real (non-illustrative) rows. See lib/illustrative.ts on why illustrative rows never carry one. */
  url?: string;
};

export type GradedMarketTypeData = {
  isReal: boolean;
  medianPrice: number;
  currency: string;
  /** Real eBay total match count when isReal; an illustrative estimate otherwise. */
  count: number;
  seeAllUrl: string;
  rows: GradedMarketListingRow[];
};

export type GradedMarketConditionData = {
  condition: EbayCondition;
  active: GradedMarketTypeData;
  sold: GradedMarketTypeData;
};

export type GradedMarketRoi = {
  isReal: boolean;
  percent: number;
  psa10Median: number;
  rawMedian: number;
  gradingCostUsd: number;
  currency: string;
};

export type GradedMarketData = {
  conditions: GradedMarketConditionData[];
  roi: GradedMarketRoi;
};

/**
 * Real active-listing fetch for one condition tier — failure here (missing
 * EBAY_CLIENT_ID/SECRET, no Buy API license yet, rate limit, no results)
 * must never take down whatever's consuming this (HTML page, markdown
 * export, JSON API, MCP tool), so it's caught locally and degrades to an
 * illustrative preview, same resilience shape lib/cards.ts uses for apitcg.
 */
async function fetchActiveTier(card: Card, condition: EbayCondition): Promise<GradedMarketTypeData> {
  try {
    const { listings, total } = await searchActiveListings(card, condition);
    if (listings.length === 0) {
      console.warn(
        `[ebay] 0 active listings for ${card.id} [${condition}] — search succeeded but returned nothing. ` +
          `Likely conditionIds/query mismatch for this card. Falling back to preview.`
      );
    }
    const med = listings.length > 0 ? median(listings.map((l) => l.price)) : null;
    if (med !== null) {
      return {
        isReal: true,
        medianPrice: med,
        currency: card.currency,
        count: total,
        seeAllUrl: conditionSearchLink(card, condition),
        rows: listings.map((listing) => ({
          date: listing.listedDate
            ? new Date(listing.listedDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "Active",
          description: listing.title,
          price: listing.price,
          currency: listing.currency,
          url: listing.url,
        })),
      };
    }
  } catch (err) {
    console.error(`[ebay] failed to fetch active ${condition} listings for ${card.id}:`, err);
  }

  const { rows, total } = illustrativeActiveListings(card, condition);
  return {
    isReal: false,
    medianPrice: median(rows.map((r) => r.price))!,
    currency: card.currency,
    count: total,
    seeAllUrl: conditionSearchLink(card, condition),
    rows: rows.map((row) => ({ ...row, currency: card.currency })),
  };
}

/** Always illustrative — see lib/illustrative.ts's comment on why sold data can't be real here (eBay's sold-data API is restricted, closed to new applicants). */
function buildSoldTier(card: Card, condition: EbayCondition): GradedMarketTypeData {
  const { rows, total } = illustrativeSoldListings(card, condition);
  return {
    isReal: false,
    medianPrice: median(rows.map((r) => r.price))!,
    currency: card.currency,
    count: total,
    seeAllUrl: conditionSearchLink(card, condition),
    rows: rows.map((row) => ({ ...row, currency: card.currency })),
  };
}

/**
 * The single source of truth for graded-market data — fetches real active
 * listings (falling back to illustrative preview per tier) and pairs them
 * with illustrative sold data, for all 4 condition tiers plus a computed
 * ROI. Consumed identically by the React panel (components/retro/graded-
 * market-panel.tsx), the markdown export (lib/markdown.ts), the JSON API
 * (/api/[franchise]/[id]), and the MCP get_graded_market tool — one fetch
 * path, one set of real/illustrative rules, so none of those surfaces can
 * drift out of sync with each other or re-implement the eBay call.
 */
export async function getGradedMarketData(card: Card): Promise<GradedMarketData> {
  const activeResults = await Promise.all(GRADED_MARKET_CONDITIONS.map((c) => fetchActiveTier(card, c)));
  const activeByCondition = new Map(GRADED_MARKET_CONDITIONS.map((c, i) => [c, activeResults[i]]));

  const conditions: GradedMarketConditionData[] = GRADED_MARKET_CONDITIONS.map((condition) => ({
    condition,
    active: activeByCondition.get(condition)!,
    sold: buildSoldTier(card, condition),
  }));

  const psa10 = activeByCondition.get("PSA 10")!;
  const raw = activeByCondition.get("Raw")!;
  // Never mix a real median with an illustrative one in the same ROI figure
  // — if either PSA 10 or Raw failed to resolve real data, both fall back
  // to illustrative together (even if the other one *did* succeed), so the
  // result is always fully real or fully (and visibly) illustrative.
  const roiIsReal = psa10.isReal && raw.isReal;
  const psa10Median = roiIsReal ? psa10.medianPrice : median(illustrativeActiveListings(card, "PSA 10").rows.map((r) => r.price))!;
  const rawMedian = roiIsReal ? raw.medianPrice : median(illustrativeActiveListings(card, "Raw").rows.map((r) => r.price))!;

  return {
    conditions,
    roi: {
      isReal: roiIsReal,
      percent: gradingRoi(psa10Median, rawMedian) * 100,
      psa10Median,
      rawMedian,
      gradingCostUsd: DEFAULT_PSA_GRADING_COST_USD,
      currency: card.currency,
    },
  };
}
