import { conditionSearchLink } from "@/lib/ebay-search";
import { searchActiveListings, type EbayCondition, type EbayLanguage } from "@/lib/ebay-browse";
import {
  illustrativeActiveListings,
  illustrativeSoldListings,
  illustrativeVintedListings,
  VINTED_CONDITIONS,
  type VintedConditionTier,
} from "@/lib/illustrative";
import { DEFAULT_PSA_GRADING_COST_USD, gradingRoi, median } from "@/lib/roi";
import { getLocalizedName } from "@/lib/tcgdex";
import { vintedSearchLink } from "@/lib/vinted-search";
import type { Card } from "@/lib/types";

export const GRADED_MARKET_CONDITIONS: EbayCondition[] = ["PSA 10", "PSA 9", "PSA 8", "Raw"];
/**
 * eBay-backed languages only — French was removed from here (not from
 * EbayLanguage/ebay-browse.ts/ebay-search.ts themselves, which still
 * support it) after a market-fit call: eBay.fr isn't where the French
 * Pokémon TCG market actually trades, Vinted is. French gets its own
 * VintedMarketData below instead of a third entry in this array.
 */
export const GRADED_MARKET_LANGUAGES: EbayLanguage[] = ["English", "Japanese"];

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

export type GradedMarketLanguageData = {
  language: EbayLanguage;
  active: GradedMarketTypeData;
  sold: GradedMarketTypeData;
};

export type GradedMarketConditionData = {
  condition: EbayCondition;
  languages: GradedMarketLanguageData[];
};

export type GradedMarketRoi = {
  isReal: boolean;
  percent: number;
  psa10Median: number;
  rawMedian: number;
  gradingCostUsd: number;
  currency: string;
};

export type VintedConditionData = {
  condition: VintedConditionTier;
  medianPrice: number;
  currency: string;
  count: number;
  rows: GradedMarketListingRow[];
};

export type VintedMarketData = {
  /** Always false today — Vinted has no known public API (that's the next thing to go find), so this is illustrative-only, same shape as illustrativeVintedListings' own doc comment. */
  isReal: boolean;
  /** Real, working vinted.fr search-results link (see lib/vinted-search.ts) — not itemized data, but a real place to click through to regardless of the illustrative numbers above it. */
  searchUrl: string;
  conditions: VintedConditionData[];
};

export type GradedMarketData = {
  conditions: GradedMarketConditionData[];
  roi: GradedMarketRoi;
  vinted: VintedMarketData;
};

/**
 * Real active-listing fetch for one condition tier + language — failure
 * here (missing EBAY_CLIENT_ID/SECRET, no Buy API license yet, rate limit,
 * no results) must never take down whatever's consuming this (HTML page,
 * markdown export, JSON API, MCP tool), so it's caught locally and degrades
 * to an illustrative preview, same resilience shape lib/cards.ts uses for
 * apitcg.
 */
async function fetchActiveTier(card: Card, condition: EbayCondition, language: EbayLanguage): Promise<GradedMarketTypeData> {
  try {
    const { listings, total } = await searchActiveListings(card, condition, language);
    if (listings.length === 0) {
      console.warn(
        `[ebay] 0 active listings for ${card.id} [${condition}/${language}] — search succeeded but returned nothing. ` +
          `Likely conditionIds/aspect_filter/query mismatch for this card. Falling back to preview.`
      );
    }
    const med = listings.length > 0 ? median(listings.map((l) => l.price)) : null;
    if (med !== null) {
      return {
        isReal: true,
        medianPrice: med,
        currency: card.currency,
        count: total,
        seeAllUrl: conditionSearchLink(card, condition, language),
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
    console.error(`[ebay] failed to fetch active ${condition}/${language} listings for ${card.id}:`, err);
  }

  const { rows, total } = illustrativeActiveListings(card, condition);
  return {
    isReal: false,
    medianPrice: median(rows.map((r) => r.price))!,
    currency: card.currency,
    count: total,
    seeAllUrl: conditionSearchLink(card, condition, language),
    rows: rows.map((row) => ({ ...row, currency: card.currency })),
  };
}

/**
 * Always illustrative — see lib/illustrative.ts's comment on why sold data
 * can't be real here (eBay's sold-data API is restricted, closed to new
 * applicants).
 */
function buildSoldTier(card: Card, condition: EbayCondition, language: EbayLanguage): GradedMarketTypeData {
  const { rows, total } = illustrativeSoldListings(card, condition);
  return {
    isReal: false,
    medianPrice: median(rows.map((r) => r.price))!,
    currency: card.currency,
    count: total,
    seeAllUrl: conditionSearchLink(card, condition, language),
    rows: rows.map((row) => ({ ...row, currency: card.currency })),
  };
}

/**
 * French/Vinted market view — structurally nothing like the PSA-tiered
 * eBay data above: no grading concept, no active/sold split, Vinted's own
 * condition vocabulary (see illustrativeVintedListings). Still uses the
 * real French card name when one exists (via card.tcgdexId, same TCGdex
 * lookup the old French eBay tab used) — a French marketplace should be
 * searched in French, illustrative pricing or not. Falls back to the
 * English name if no French match exists (One Piece, or an unmatched
 * Pokémon card) so the search link is always at least usable.
 */
async function buildVintedMarket(card: Card): Promise<VintedMarketData> {
  const frenchName = card.tcgdexId ? await getLocalizedName(card.tcgdexId, "fr").catch(() => undefined) : undefined;
  const query = frenchName ? `${frenchName} ${card.number ?? ""}`.trim() : `${card.name} ${card.number ?? ""}`.trim();

  const conditions: VintedConditionData[] = VINTED_CONDITIONS.map((condition) => {
    const { rows, total } = illustrativeVintedListings(card, condition);
    return {
      condition,
      medianPrice: median(rows.map((r) => r.price))!,
      currency: card.currency,
      count: total,
      rows: rows.map((row) => ({ ...row, currency: card.currency })),
    };
  });

  return { isReal: false, searchUrl: vintedSearchLink(query), conditions };
}

/**
 * The single source of truth for graded-market data — fetches real active
 * listings per condition tier x language (falling back to illustrative
 * preview per combination) and pairs them with illustrative sold data, plus
 * a separate illustrative Vinted market view. Consumed identically by the
 * React panel (components/retro/graded-market-panel.tsx), the markdown
 * export (lib/markdown.ts), the JSON API (/api/[franchise]/[id]), and the
 * MCP get_graded_market tool — one fetch path, one set of real/illustrative
 * rules, so none of those surfaces can drift out of sync with each other or
 * re-implement the eBay call.
 *
 * Cost note: this is 4 conditions x 2 languages = 8 real eBay searches per
 * card (down from 12 now that French no longer goes through eBay at all —
 * sold stays illustrative-only regardless of language, so it adds no API
 * cost), each cached for 1h. Fine at this site's scale; worth revisiting if
 * traffic grows enough to approach eBay's 5,000 calls/day default limit.
 */
export async function getGradedMarketData(card: Card): Promise<GradedMarketData> {
  const activeResults = await Promise.all(
    GRADED_MARKET_CONDITIONS.flatMap((condition) => GRADED_MARKET_LANGUAGES.map((language) => fetchActiveTier(card, condition, language)))
  );
  // flatMap order is condition-major, language-minor — same order as the
  // nested loop above, so this index math recovers [condition][language].
  const activeByKey = new Map<string, GradedMarketTypeData>();
  let i = 0;
  for (const condition of GRADED_MARKET_CONDITIONS) {
    for (const language of GRADED_MARKET_LANGUAGES) {
      activeByKey.set(`${condition}:${language}`, activeResults[i++]);
    }
  }

  const conditions: GradedMarketConditionData[] = GRADED_MARKET_CONDITIONS.map((condition) => ({
    condition,
    languages: GRADED_MARKET_LANGUAGES.map((language) => ({
      language,
      active: activeByKey.get(`${condition}:${language}`)!,
      sold: buildSoldTier(card, condition, language),
    })),
  }));

  // ROI always compares English active listings — the default/primary
  // market, and the only one guaranteed to exist for every card. Never
  // mixes a real median with an illustrative one: if either PSA 10 or Raw
  // failed to resolve real data (in English), both fall back to
  // illustrative together, so the result is always fully real or fully
  // (and visibly) illustrative.
  const psa10 = activeByKey.get("PSA 10:English")!;
  const raw = activeByKey.get("Raw:English")!;
  const roiIsReal = psa10.isReal && raw.isReal;
  const psa10Median = roiIsReal ? psa10.medianPrice : median(illustrativeActiveListings(card, "PSA 10").rows.map((r) => r.price))!;
  const rawMedian = roiIsReal ? raw.medianPrice : median(illustrativeActiveListings(card, "Raw").rows.map((r) => r.price))!;

  const vinted = await buildVintedMarket(card);

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
    vinted,
  };
}
