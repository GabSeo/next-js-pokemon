import { conditionSearchLink } from "@/lib/ebay-search";
import { searchActiveListings, type EbayCondition, type EbayLanguage } from "@/lib/ebay-browse";
import { illustrativeActiveListings, illustrativeSoldListings, illustrativeVintedFeed } from "@/lib/illustrative";
import { DEFAULT_PSA_GRADING_COST_USD, gradingRoi, median } from "@/lib/roi";
import { getVintedListingsForCard, relativeTimeLabel, TRES_BON_ETAT, vintedQueryForCard } from "@/lib/vinted-listings";
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

export type VintedDealTier = "good" | "fair" | "high";

export type VintedFeedRow = {
  timeAgo: string;
  /** Always "Très bon état" — see lib/vinted-listings.ts. Kept per-row so the renderer never has to re-assert the filter. */
  condition: string;
  price: number;
  currency: string;
  /** Signed percent vs. this card's rolling average across the feed (see VintedMarketData.avgPrice) — negative means priced below average. */
  dealPct: number;
  dealTier: VintedDealTier;
  /** Seller-written listing title — real rows only. */
  title?: string;
  /** Real per-item Vinted link — present only on real rows, never fabricated for a preview row (same rule as GradedMarketListingRow.url). */
  url?: string;
  /** The listing's own photo when the scrape returned one; real rows only. Preview rows share the card's image via VintedMarketData.imageUrl. */
  imageUrl?: string;
};

export type VintedMarketData = {
  /** True once Lobstr has scraped real "très bon état" listings for this card (see lib/vinted-listings.ts); false falls back to the clearly-tagged illustrative feed. */
  isReal: boolean;
  /** Real, working vinted.fr search-results link (see lib/vinted-search.ts) — and deliberately UNFILTERED, unlike `rows`: a human clicking through should see the whole market, not just the one condition this feed narrows to. */
  searchUrl: string;
  /** Real French name + number when TCGdex has a match, English otherwise — same string used to build searchUrl. */
  title: string;
  /** The card's own real image — every row shares it (same physical card, different sellers/conditions), never a fabricated per-listing photo. */
  imageUrl?: string;
  avgPrice: number;
  currency: string;
  rows: VintedFeedRow[];
  /** How many of `rows` are priced below `avgPrice` — a real, derived stat even when the prices it's derived from are illustrative (same honesty shape as the ROI percent below, which is real math over possibly-illustrative inputs). */
  belowAverageCount: number;
  /**
   * The single condition every row in this feed is filtered to. Carried in
   * the data (not just rendered) so the markdown export, JSON API and MCP
   * tool all state the same constraint the panel shows — a consumer reading
   * only the JSON must not mistake this for an unfiltered view of the
   * French market.
   */
  conditionFilter: string;
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

// A listing more than 8% below the feed's own rolling average reads as a
// good deal, more than 8% above reads as pricey, everything in between is
// unremarkable — thresholds are a judgment call, not derived from anything,
// same as the codebase's other illustrative-tuning constants.
const VINTED_DEAL_THRESHOLD_PCT = 8;

function vintedDealTier(deltaPct: number): VintedDealTier {
  if (deltaPct <= -VINTED_DEAL_THRESHOLD_PCT) return "good";
  if (deltaPct >= VINTED_DEAL_THRESHOLD_PCT) return "high";
  return "fair";
}

/** Shared by both branches below: the deal percentages and the below-average count are real math either way, over whichever prices the feed ended up with. */
function summarizeVintedFeed(
  prices: number[],
  toRow: (price: number, index: number, dealPct: number, dealTier: VintedDealTier) => VintedFeedRow
): { rows: VintedFeedRow[]; avgPrice: number; belowAverageCount: number } {
  const avgPrice = Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length);
  const rows = prices.map((price, i) => {
    const dealPct = Math.round(((price - avgPrice) / avgPrice) * 100);
    return toRow(price, i, dealPct, vintedDealTier(dealPct));
  });
  return { rows, avgPrice, belowAverageCount: prices.filter((price) => price < avgPrice).length };
}

/**
 * French/Vinted market view — structurally nothing like the PSA-tiered eBay
 * data above: no grading concept, no active/sold split, and exactly one
 * condition, "Très bon état". That single condition is the point of this
 * view rather than an incidental filter: it answers "what can I buy right
 * now that the seller has clearly described as very good condition", not
 * "what does the French market look like". Everything below Très bon état
 * is dropped before it reaches here (lib/vinted-listings.ts).
 *
 * Real listings come from Lobstr's Vinted Products Scraper, read back from
 * the most recent finished run (see lib/lobstr.ts for why a page render
 * reads results rather than triggering a scrape). When there are none —
 * no API key, no run yet, or genuinely nothing in that condition right now
 * — this degrades to the illustrative feed, tagged as a preview in every
 * surface that renders it. Never a silent mix: the whole feed is real or
 * the whole feed is preview.
 *
 * Searches in French when TCGdex has a French name for the card (a French
 * marketplace gets searched in French), English otherwise — see
 * vintedQueryForCard.
 */
async function buildVintedMarket(card: Card): Promise<VintedMarketData> {
  const { query, displayName, searchUrl } = await vintedQueryForCard(card);

  const real = await getVintedListingsForCard(card, displayName, searchUrl);

  if (real.length > 0) {
    const { rows, avgPrice, belowAverageCount } = summarizeVintedFeed(
      real.map((listing) => listing.price),
      (price, i, dealPct, dealTier) => ({
        timeAgo: relativeTimeLabel(real[i].listedAtMs),
        condition: real[i].condition,
        price,
        // Per-listing currency, not card.currency: Vinted France trades in
        // euros while card.currentPrice is TCGPlayer USD. Mislabelling €
        // as $ on a price comparison page would be a real error, not a
        // cosmetic one.
        currency: real[i].currency,
        dealPct,
        dealTier,
        title: real[i].title,
        url: real[i].url,
        imageUrl: real[i].imageUrl,
      })
    );

    return {
      isReal: true,
      searchUrl,
      title: query,
      imageUrl: card.imageUrl,
      avgPrice,
      currency: real[0].currency,
      rows,
      belowAverageCount,
      conditionFilter: TRES_BON_ETAT,
    };
  }

  const feed = illustrativeVintedFeed(card);
  const { rows, avgPrice, belowAverageCount } = summarizeVintedFeed(
    feed.map((listing) => listing.price),
    (price, i, dealPct, dealTier) => ({
      timeAgo: feed[i].minutesAgo === 0 ? "now" : `${feed[i].minutesAgo} min`,
      condition: feed[i].condition,
      price,
      currency: card.currency,
      dealPct,
      dealTier,
    })
  );

  return {
    isReal: false,
    searchUrl,
    title: query,
    imageUrl: card.imageUrl,
    avgPrice,
    currency: card.currency,
    rows,
    belowAverageCount,
    conditionFilter: TRES_BON_ETAT,
  };
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
